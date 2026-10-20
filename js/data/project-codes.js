// ============================================================================
// ID de oferta y de proyecto (v70): la parte que habla con Firestore. Qué es el
// ID, su formato y el orden en que se numera lo anterior: ../project-codes.js.
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
// ============================================================================
import { db } from "../firebase-init.js";
import { formatProjectCode, planCodeBackfill, idYear, counterDocId, ID_ERROR_MESSAGE } from "../project-codes.js";
import { showToast } from "../utils.js";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/** El contador del año `year` (4 cifras; ver counterDocId en ../project-codes.js). */
const counterRef = (year) => doc(db, "meta", counterDocId(year));

/**
 * Reparte el siguiente ID (p. ej. «00026») del año de `date` (por defecto, hoy;
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
      tx.set(ref, { next: n + 1 });
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
      tx.set(counterRef(year), { next: n + 1 });
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
