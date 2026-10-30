// ============================================================================
// ID de oferta y de proyecto (v70): la parte que habla con Firestore. Qué es el
// ID, su formato (YYXXX desde la v82; XXXYY antes) y el orden en que se numera lo
// anterior: ../project-codes.js.
//
// Quien reparte los números es el contador del AÑO del ID, `{ next }` (el próximo
// número de orden libre de ese año): `meta/projectCounter` para 2026 (el de la v70)
// y `meta/projectCounter-27`, `-28`… para los siguientes, que se crean solos al
// pedir el primer ID del año — así el número de orden se reinicia en 000 cada
// año. Repartir uno es una TRANSACCIÓN —leer `next`, escribir `next + 1`—, así que
// dos personas que crean a la vez nunca reciben el mismo; si una colisión obliga a
// repetir, Firestore reintenta solo. Las reglas solo dejan subir cada contador de
// uno en uno (firestore.rules), para que nada pueda «rebobinarlo» y repetir un ID.
//
// Un número gastado no se devuelve: si se pide un ID y luego la oferta no llega a
// guardarse, queda un hueco en la numeración. Es el precio de que jamás se repita.
//
// v82 · Migración XXXYY → YYXXX (migrateLegacyCodesToYYXXX, al final): la primera vez que entra
// un administrador con esta versión, los IDs antiguos de proyectos, ofertas y Papelera se pasan al
// formato nuevo (`00126` → `26001`; el número de orden se conserva, solo cambia dónde va el año) y
// `meta/projectCounter` se marca con `formatVersion: 'YYXXX'` para no repetirlo. Los contadores
// NO cambian: siguen repartiendo el mismo número de orden de cada año.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  formatProjectCode,
  planCodeBackfill,
  planLegacyCodeMigration,
  idYear,
  counterDocId,
  FIRST_ID_YEAR,
  CODE_FORMAT_VERSION,
  ID_ERROR_MESSAGE,
} from "../project-codes.js";
import { findOfferLocationField, isOffersProject } from "../offers.js";
import { renameDriveFolder } from "../drive-service.js";
import { showToast } from "../utils.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/** El contador del año `year` (4 cifras; ver counterDocId en ../project-codes.js). */
const counterRef = (year) => doc(db, "meta", counterDocId(year));

/**
 * Reparte el siguiente ID (p. ej. «26000») del año de `date` (por defecto, hoy;
 * nunca antes de 2026): el número de orden sale del contador de ESE año y el
 * sufijo YY es ese año. Lanza si no se puede (sin conexión, o las reglas sin
 * publicar): quien crea la oferta o el proyecto no debe seguir sin ID.
 */
export async function allocateProjectCode({ date = new Date() } = {}) {
  const year = idYear(date);
  const ref = counterRef(year);
  try {
    const seq = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const n = snap.exists() ? Number(snap.data().next) || 0 : 0;
      // merge: no pisa `formatVersion` (v82), la marca de que la migración YYXXX ya se hizo.
      tx.set(ref, { next: n + 1 }, { merge: true });
      return n;
    });
    return formatProjectCode(seq, year);
  } catch (e) {
    console.error("allocateProjectCode:", e);
    throw new Error(ID_ERROR_MESSAGE);
  }
}

/**
 * Pone el ID a una «entidad» del plan (ver planCodeBackfill): una oferta y/o los
 * proyectos que nacieron de ella, que comparten el mismo. Todo en UNA transacción
 * —los documentos, el contador de su año— y volviendo a mirar cada documento dentro, así
 * que si dos administradores numeran a la vez, el que llega segundo no pisa
 * nada: ve que ya tiene ID y no gasta número. Devuelve cuántos documentos
 * recibieron ID. No toca `updatedAt`: numerar no es «editar» la tarea.
 */
export async function assignCodesToEntity(entity) {
  const year = entity.year || idYear(null); // sin fecha de creación: el año de hoy
  const refs = entity.targets.map((t) => ({
    ref: doc(db, t.kind === "offer" ? "tasks" : "projects", t.id),
    field: t.field,
  }));
  return runTransaction(db, async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r.ref)));
    const missing = [];
    let code = entity.existingCode || null;
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return; // se eliminó mientras tanto
      const have = snap.data()[refs[i].field];
      if (have) code = code || have;
      else missing.push(refs[i]);
    });
    if (!missing.length) return 0;
    if (!code) {
      const cSnap = await tx.get(counterRef(year));
      const n = cSnap.exists() ? Number(cSnap.data().next) || 0 : 0;
      code = formatProjectCode(n, year);
      tx.set(counterRef(year), { next: n + 1 }, { merge: true });
    }
    missing.forEach((m) => tx.update(m.ref, { [m.field]: code }));
    return missing.length;
  });
}

/** Las tareas de Ofertas: las que lo tienen como proyecto principal y las que lo tienen como adicional (las mismas dos consultas que ya usa el resto de la app). */
async function fetchOffers(offersProjectId) {
  const [primary, extra] = await Promise.all([
    getDocs(query(collection(db, "tasks"), where("projectId", "==", offersProjectId))),
    getDocs(query(collection(db, "tasks"), where("extraProjectIds", "array-contains", offersProjectId), where("projectId", "!=", null))),
  ]);
  const byId = new Map();
  [...primary.docs, ...extra.docs].forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  return [...byId.values()];
}

async function runPlan(plan, onProgress) {
  let assigned = 0;
  for (let i = 0; i < plan.length; i++) {
    assigned += await assignCodesToEntity(plan[i]);
    if (onProgress) onProgress({ done: i + 1, total: plan.length });
  }
  return assigned;
}

/**
 * v70, UNA sola vez (la lanza la migración de la semilla de Ofertas, ver
 * migrateSeededProject en projects.js): numera las ofertas y los proyectos que
 * ya existían, de más antiguo a más nuevo, empezando por 000 en cada año (lo
 * anterior a 2026 cuenta como 2026). Una oferta ya convertida y su proyecto reciben el mismo ID. Es seguro repetirlo: lo que ya
 * tiene ID se salta, así que si se corta a medias, la siguiente vez continúa.
 * Un número por documento y secuencial (no en paralelo): todos pelean por el
 * mismo contador, así que en paralelo solo se estorbarían.
 */
export async function backfillProjectCodes({ offersProject }) {
  const [projectsSnap, offers] = await Promise.all([
    getDocs(collection(db, "projects")),
    offersProject ? fetchOffers(offersProject.id) : Promise.resolve([]),
  ]);
  const projects = projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const plan = planCodeBackfill({ projects, offers });
  if (!plan.length) return { entities: 0, assigned: 0 };
  showToast("Numerando las ofertas y los proyectos que ya existían… (un momento)");
  const assigned = await runPlan(plan);
  showToast(`IDs asignados a ${assigned} ${assigned === 1 ? "oferta o proyecto" : "ofertas y proyectos"} que ya existían.`);
  return { entities: plan.length, assigned };
}

/**
 * Cada vez que entra un administrador (tras la migración): los proyectos ya cargados
 * en memoria que se hayan quedado sin ID —uno restaurado de la Papelera que era de
 * antes de la v70, por ejemplo— reciben el suyo. No cuesta ninguna lectura si no
 * falta ninguno. (Las ofertas sin ID las numera el formulario al guardarlas.)
 */
export async function healProjectCodes(projects) {
  const plan = planCodeBackfill({ projects: (projects || []).filter((p) => !p.exclusive && !p.code), offers: [] });
  return plan.length ? runPlan(plan) : 0;
}

// ---------------------------------------------------------------------------
// v82 · Migración XXXYY → YYXXX
// ---------------------------------------------------------------------------

const MIGRATION_BATCH = 400;

/** Escribe `[{ ref, fields }]` en lotes (un `update` por documento; no toca `updatedAt`: renumerar no es «editar»). Devuelve cuántos escribió. */
async function commitUpdates(updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += MIGRATION_BATCH) {
    const batch = writeBatch(db);
    updates.slice(i, i + MIGRATION_BATCH).forEach(({ ref, fields }) => batch.update(ref, fields));
    await batch.commit();
    written += Math.min(MIGRATION_BATCH, updates.length - i);
  }
  return written;
}

/**
 * Renombra, EN SEGUNDO PLANO y de una en una, las carpetas de Drive de lo que se migró
 * (`26001 - Cliente`). Nunca lanza ni se espera: renameDriveFolder devuelve `failed`/`disabled` si Drive no
 * está disponible, y entonces la carpeta se pone al día sola la próxima vez que se abra o se suba un archivo
 * (drive-storage.js reconoce el ID antiguo en su clave y en su nombre). Devuelve cuántas renombró.
 */
export async function renameMigratedDriveFolders(folders, rename = renameDriveFolder) {
  let renamed = 0;
  for (const f of folders || []) {
    try {
      const r = await rename({ code: f.code, name: f.name, folderId: f.folderId });
      if (r && (r.status === "renamed" || r.status === "moved")) renamed++;
      if (r && r.status === "disabled") break; // Drive apagado: ni intentar las demás
    } catch (e) {
      console.warn("migrateLegacyCodesToYYXXX: carpeta de Drive", f.code, e);
    }
  }
  return renamed;
}

/**
 * v82, UNA sola vez (la lanza app.js cuando entra un administrador, ver bootstrap): pasa los IDs del
 * formato antiguo XXXYY a YYXXX en TODO lo que los lleve —proyectos (también archivados), ofertas y su
 * copia en la Papelera— y deja `meta/projectCounter.formatVersion = 'YYXXX'`.
 *
 *   · `code` / `offerCode`: `00126` → `26001`;
 *   · `name` / `title` y la Ubicación (`properties.ubicacion`, o el campo Ubicación de la oferta) que
 *     empiecen por el ID antiguo: `00126 - Cliente` → `26001 - Cliente`, sin duplicar el prefijo;
 *   · la carpeta de Drive (si el documento tiene `driveFolderId`) se renombra después, en segundo plano.
 *
 * Es seguro repetirlo y de bajo coste cuando ya está hecho (una sola lectura del contador): un documento
 * ya en YYXXX no genera ninguna escritura, y la marca solo se pone si NO hubo errores ni conflictos
 * (un ID nuevo que ya llevara otro documento se deja sin tocar y se avisa en la consola).
 *
 * @param {{ offersProject?: object|null, now?: Date, rename?: Function }} args
 * @returns {Promise<{ skipped: boolean, projects: number, offers: number, trash: number, conflicts: number, marked: boolean, drive: Promise<number> }>}
 */
export async function migrateLegacyCodesToYYXXX({ offersProject = null, now = new Date(), rename = renameDriveFolder } = {}) {
  const result = { skipped: false, projects: 0, offers: 0, trash: 0, conflicts: 0, marked: false, drive: Promise.resolve(0) };
  const markerRef = counterRef(FIRST_ID_YEAR); // la marca vive SIEMPRE en meta/projectCounter (el de 2026), seamos del año que seamos
  const counterSnap = await getDoc(markerRef);
  if (counterSnap.exists() && counterSnap.data().formatVersion === CODE_FORMAT_VERSION) return { ...result, skipped: true, marked: true };

  const [projectsSnap, offers, trashSnap] = await Promise.all([
    getDocs(collection(db, "projects")),
    offersProject && isOffersProject(offersProject) ? fetchOffers(offersProject.id) : Promise.resolve([]),
    getDocs(collection(db, "trash")).catch((e) => { console.warn("migrateLegacyCodesToYYXXX: no se pudo leer la Papelera", e); return null; }),
  ]);
  const projects = projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const trash = trashSnap ? trashSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const locationField = offersProject ? findOfferLocationField(offersProject) : null;

  const plan = planLegacyCodeMigration({
    projects,
    offers,
    trash,
    locationFieldId: locationField ? locationField.id : null,
    expectedYear: now.getFullYear() % 100,
  });
  result.conflicts = plan.conflicts.length;
  plan.conflicts.forEach((c) => console.warn("migrateLegacyCodesToYYXXX: conflicto, no se toca", c));

  const total = plan.projects.length + plan.offers.length + plan.trash.length;
  let failed = false;
  if (total) {
    showToast("Actualizando los IDs al formato nuevo (AÑO + número)… (un momento)");
    const steps = [
      ["projects", plan.projects.map((u) => ({ ref: doc(db, "projects", u.id), fields: u.fields }))],
      ["offers", plan.offers.map((u) => ({ ref: doc(db, "tasks", u.id), fields: u.fields }))],
      ["trash", plan.trash.map((u) => ({ ref: doc(db, "trash", u.id), fields: u.fields }))],
    ];
    for (const [key, updates] of steps) {
      try {
        result[key] = await commitUpdates(updates);
      } catch (e) {
        failed = true;
        console.error(`migrateLegacyCodesToYYXXX (${key}):`, e);
      }
    }
    if (!failed) showToast(`IDs actualizados al formato AÑO+número (${plan.projects.length + plan.offers.length} entre proyectos y ofertas).`);
  }

  // La marca solo si todo salió bien (si no, la próxima entrada de un admin continúa donde se quedó).
  if (!failed && !plan.conflicts.length) {
    try {
      if (counterSnap.exists()) await updateDoc(markerRef, { next: Number(counterSnap.data().next) || 0, formatVersion: CODE_FORMAT_VERSION });
      else await setDoc(markerRef, { next: 0, formatVersion: CODE_FORMAT_VERSION });
      result.marked = true;
    } catch (e) {
      console.error("migrateLegacyCodesToYYXXX (marca formatVersion):", e);
    }
  }

  // Drive, aparte y sin esperar: nada de lo anterior depende de ello.
  if (!failed && plan.folders.length) result.drive = renameMigratedDriveFolders(plan.folders, rename).catch(() => 0);
  return result;
}
