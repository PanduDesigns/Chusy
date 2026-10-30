// ============================================================================
// Acceso a datos: proyectos.
// ============================================================================
import { db } from "../firebase-init.js";
import { departmentHasAccess } from "../departments.js";
import {
  OFFERS_KEY,
  SECTOR_OPTIONS,
  OFFER_SECTION_DELIVERED,
  OFFER_SECTION_CLOSED,
  normalizeName,
  isOffersProject,
  planOfferRepositioning,
} from "../offers.js";
import { PROJECT_CODE_SEED } from "../project-codes.js";
// v74 (Etapa 2 del Store): proyectos, archivados, proyecto abierto y personas se
// escuchan a través del store (js/store.js) — ver store-subscriptions.js.
import { store } from "../store.js";
import { subscribeToStoreList } from "./store-subscriptions.js";
import { allocateProjectCode, backfillProjectCodes, healProjectCodes } from "./project-codes.js";
// v75: al editar el nombre de un proyecto con carpeta en Drive, esa carpeta se renombra (`YYXXX - Nombre`).
import { renameDriveFolder } from "../drive-service.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  deleteField,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const DEFAULT_SECTIONS = [
  { id: "por-hacer", name: "Por hacer", order: 0 },
  { id: "en-progreso", name: "En progreso", order: 1 },
  { id: "hecho", name: "Hecho", order: 2 },
];

/**
 * Crea un proyecto nuevo. El creador queda como miembro automáticamente.
 *
 * Los últimos cinco parámetros (customFieldDefs/exclusive/exclusiveKey/
 * allowedDepartments, v55, y seedVersion, v56) solo los rellena
 * ensureExclusiveProjectsSeeded() más abajo, para crear una "sección
 * exclusiva" como Ofertas ya lista de fábrica (secciones + campos
 * personalizados + a qué departamentos se ve) — "+ Nuevo proyecto"
 * (project-modal.js) nunca los manda, así que un proyecto normal ni los
 * pregunta ni los guarda. Se añaden con spread condicional (no con `|| valor
 * por defecto` como el resto de campos) a propósito: Firestore rechaza
 * escribir una clave con valor `undefined`, así que un proyecto normal no
 * debe ni mencionar estas claves, no vale con dejarlas "vacías".
 *
 * `properties` (v57) — las propiedades del proyecto (Comercial, Ubicación,
 * versión aprobada, fechas, histórico; ver project-properties.js) — solo
 * las manda la conversión de una oferta en proyecto (offer-conversion.js);
 * "+ Nuevo proyecto" no las pregunta, y se rellenan después desde
 * "Propiedades" en el menú de clic derecho del proyecto.
 *
 * `code` (v70) — el ID del proyecto (YYXXX, ver project-codes.js). Si no se
 * pasa, se reparte uno nuevo ahora; solo lo pasa la conversión de una oferta
 * (offer-conversion.js), porque el proyecto HEREDA el ID de la oferta. Los
 * proyectos exclusivos (Ofertas, la «sección», no una oferta) no llevan ID.
 * Si no se puede repartir (sin conexión, reglas sin publicar), lanza y el
 * proyecto NO se crea: no debe haber proyectos sin ID.
 *
 * `driveFolderId` (v75) — la carpeta de Google Drive del proyecto: solo la manda la conversión de una
 * oferta que ya tenía carpeta (offer-conversion.js); el proyecto CONSERVA ese mismo id, porque la carpeta
 * es la misma (pasa de `Ofertas` a `Proyectos`).
 */
export async function createProject({ name, description, color, icon, creatorUid, sections, customFieldDefs, exclusive, exclusiveKey, allowedDepartments, seedVersion, properties, code, driveFolderId }) {
  const projectCode = exclusive ? null : code || (await allocateProjectCode());
  const ref = await addDoc(collection(db, "projects"), {
    name,
    description: description || "",
    color: color || "#FCD000",
    icon: icon || "📁",
    // Array.isArray() a propósito, no "sections && sections.length": con
    // sections.length===0 (el usuario quitó las 3 sugeridas de serie a
    // mano en el modal, a propósito) ese && daba falsy y esto caía igual
    // en DEFAULT_SECTIONS — el proyecto se creaba con secciones aunque se
    // hubieran quitado todas. Solo hay que aplicar el valor por defecto
    // cuando de verdad no se ha proporcionado nada (undefined/null).
    sections: Array.isArray(sections) ? sections : DEFAULT_SECTIONS,
    memberIds: [creatorUid],
    createdBy: creatorUid,
    createdAt: serverTimestamp(),
    archived: false,
    ...(customFieldDefs ? { customFieldDefs } : {}),
    ...(exclusive ? { exclusive: true, exclusiveKey, allowedDepartments: allowedDepartments || [] } : {}),
    ...(seedVersion ? { seedVersion } : {}),
    ...(properties ? { properties } : {}),
    ...(projectCode ? { code: projectCode } : {}),
    ...(projectCode && driveFolderId ? { driveFolderId } : {}),
  });
  return ref.id;
}

/**
 * Cambia campos de un proyecto. v75: si cambia el NOMBRE de un proyecto con ID, su carpeta de Drive
 * (si tiene) se renombra a `YYXXX - Nombre nuevo`, por su cuenta y sin hacer esperar: ordenar Drive nunca
 * debe impedir ni retrasar guardar el proyecto (ver renameDriveFolder en drive-service.js).
 */
export async function updateProject(projectId, data) {
  // Se mira ANTES de escribir (el store aún tiene el nombre de antes); sin el proyecto en memoria no se renombra.
  const before = data && data.name !== undefined ? store.getById("projects", projectId) : null;
  await updateDoc(doc(db, "projects", projectId), data);
  if (before && !before.exclusive && before.code && String(before.name || "").trim() !== String(data.name || "").trim()) {
    syncProjectDriveFolder(projectId, before, data.name);
  }
}

/** Renombra la carpeta de Drive de un proyecto (si la tiene) y anota su `driveFolderId` si faltaba. Nunca lanza. */
function syncProjectDriveFolder(projectId, project, newName) {
  renameDriveFolder({ code: project.code, name: newName, folderId: project.driveFolderId || null })
    .then((r) => {
      if (r.folderId && r.folderId !== project.driveFolderId) return updateDoc(doc(db, "projects", projectId), { driveFolderId: r.folderId });
    })
    .catch((e) => console.warn("syncProjectDriveFolder:", e));
}

/**
 * v75: anota la carpeta de Drive del proyecto (`driveFolderId`) cuando se sube un archivo a una carpeta
 * recién creada o encontrada. Solo escribe si es distinta de la anotada. Un extra: si falla, la carpeta
 * se sigue encontrando por el ID del proyecto.
 */
export async function rememberProjectDriveFolder(projectId, folderId) {
  if (!projectId || !folderId) return;
  const current = store.getById("projects", projectId);
  if (current && current.driveFolderId === folderId) return;
  await updateDoc(doc(db, "projects", projectId), { driveFolderId: folderId });
}

export function archiveProject(projectId, archived = true) {
  return updateDoc(doc(db, "projects", projectId), { archived });
}

export function deleteProject(projectId) {
  return deleteDoc(doc(db, "projects", projectId));
}

// Eliminar un proyecto con sus tareas ya no se hace aquí: desde la v67 va a la
// papelera (trashProject en data/trash.js), que lo guarda 30 días y permite
// restaurarlo con sus tareas.

export function addMemberToProject(projectId, uid) {
  return updateDoc(doc(db, "projects", projectId), { memberIds: arrayUnion(uid) });
}

export function removeMemberFromProject(projectId, uid) {
  return updateDoc(doc(db, "projects", projectId), { memberIds: arrayRemove(uid) });
}

/** Añade/edita/elimina secciones (columnas) de un proyecto. */
export function setProjectSections(projectId, sections) {
  return updateDoc(doc(db, "projects", projectId), { sections });
}

/**
 * Igual que setProjectSections, pero además se encarga de las tareas que
 * se quedan huérfanas cuando una sección desaparece de la lista: en vez
 * de dejarlas apuntando a un id de sección que ya no existe (con lo que
 * dejarían de verse en Lista/Tablero), las pasa a "sin sección" — nunca se
 * borran tareas por borrar una sección.
 *
 * Repara las dos formas en que una tarea puede pertenecer a este proyecto:
 * si lo tiene como PRINCIPAL, poniendo `sectionId: null`; si lo tiene como
 * ADICIONAL (ver extraProjectIds), limpiando solo su entrada dentro de
 * `extraSections` — sin tocar la sección que tenga en su proyecto
 * principal ni en ningún otro adicional.
 */
export async function saveProjectSections(project, newSections) {
  const keptIds = new Set(newSections.map((s) => s.id));
  const removedIds = (project.sections || []).map((s) => s.id).filter((id) => !keptIds.has(id));

  if (removedIds.length) {
    const primarySnap = await getDocs(query(collection(db, "tasks"), where("projectId", "==", project.id)));
    const orphanedPrimary = primarySnap.docs.filter((d) => removedIds.includes(d.data().sectionId));
    for (let i = 0; i < orphanedPrimary.length; i += 450) {
      const batch = writeBatch(db);
      orphanedPrimary.slice(i, i + 450).forEach((d) => batch.update(d.ref, { sectionId: null }));
      await batch.commit();
    }

    const extraSnap = await getDocs(
      query(collection(db, "tasks"), where("extraProjectIds", "array-contains", project.id), where("projectId", "!=", null))
    );
    const orphanedExtra = extraSnap.docs.filter((d) => removedIds.includes((d.data().extraSections || {})[project.id]));
    for (let i = 0; i < orphanedExtra.length; i += 450) {
      const batch = writeBatch(db);
      orphanedExtra.slice(i, i + 450).forEach((d) => batch.update(d.ref, { [`extraSections.${project.id}`]: null }));
      await batch.commit();
    }
  }
  return setProjectSections(project.id, newSections);
}

/**
 * ¿Puede esta persona VER este proyecto? Para uno normal, siempre sí — el
 * modelo de "todo el departamento ve todo" (ver la cabecera de
 * firestore.rules) no cambia con la v55. Solo entra en juego para un
 * proyecto EXCLUSIVO (`exclusive: true`, ver EXCLUSIVE_PROJECT_SEEDS más
 * abajo): un admin siempre; el resto, solo si su departamento
 * (users/{uid}.department) está entre los `allowedDepartments` de ESTE
 * proyecto en concreto — configurable desde "Accesos por departamento"
 * (department-access-modal.js).
 *
 * Se aplica en app.js, en el único sitio donde `projects` sale de
 * subscribeToAllProjects (ver bootstrap()) — así que todo lo que se
 * alimenta de esa variable (barra lateral, buscador global, línea de
 * tiempo global, los filtros por proyecto...) queda ya filtrado sin tocar
 * nada más. Ojo: esto decide qué aparece en la INTERFAZ, no es una regla
 * de seguridad de Firestore — las reglas siguen dejando leer/escribir
 * cualquier proyecto a cualquier cuenta activa, mismo criterio ya usado
 * para Métricas/Revisor en la v54 (ver el porqué en su historial, y
 * Limitaciones en el README).
 */
export function isProjectVisibleToUser(project, user) {
  if (!project.exclusive) return true;
  if (!user) return false;
  if (user.role === "admin") return true;
  return departmentHasAccess(user.department, project.allowedDepartments);
}

/**
 * "Secciones exclusivas" (v55): proyectos especiales que funcionan como
 * cualquier otro por debajo (tareas, secciones propias, campos
 * personalizados, Lista/Tablero/Calendario/Línea de tiempo...) pero no
 * aparecen en la lista "Proyectos" de la barra lateral — tienen su propio
 * botón fijo, como "Mis tareas" o "Archivo" (ver sidebar.js) — ni son
 * visibles para quien no tenga acceso (ver isProjectVisibleToUser arriba).
 *
 * Esta lista es lo único que hace falta tocar para que una FUTURA sección
 * exclusiva se cree sola: ensureExclusiveProjectsSeeded() (llamada una vez
 * por sesión desde bootstrap() en app.js, solo si currentUser es admin)
 * crea el proyecto que falte, ya con sus secciones y campos personalizados
 * listos — así nadie tiene que montarlo a mano desde la consola de
 * Firebase ni desde la propia interfaz la primera vez que se publique esta
 * versión.
 *
 * `seedVersion` + `fieldsAddedIn` (v56): cómo se AÑADE algo a una sección
 * que ya existe en Firestore. Crear el proyecto de cero solo ocurre una
 * vez, así que un campo nuevo en `customFieldDefs` no le llegaría nunca a
 * uno ya creado. Cada proyecto guarda la `seedVersion` con la que se creó
 * o se puso al día (ausente = 1, la de la v55); si aquí es mayor, se le
 * añaden los campos listados en `fieldsAddedIn[versión]` de cada versión
 * intermedia (por id) — UNA sola vez: al terminar se guarda la nueva
 * `seedVersion`, así que un campo que alguien borre a mano después NO
 * vuelve a aparecer solo. Un campo nuevo, por tanto, se añade en dos
 * sitios: a `customFieldDefs` (para los proyectos que se creen de cero) y
 * a `fieldsAddedIn` de la versión que lo trae (para los ya creados).
 *
 * `sectionsAddedIn` (v58): lo mismo que `fieldsAddedIn`, pero para
 * SECCIONES (por id): la v58 trae «Entregadas» y «Cerradas» — se añaden al
 * FINAL de las que ya tuviera el proyecto (sin tocar el orden ni el nombre
 * de ninguna), una sola vez, y sin duplicar si alguien ya había creado a
 * mano una sección con ese mismo nombre. Además, y solo esta vez, la
 * migración recoloca las ofertas que ya existían (ver
 * repositionExistingOffers más abajo).
 *
 * Importante: la comprobación de "ya existe" solo mira proyectos NO
 * archivados (subscribeToAllProjects no trae los archivados) — si alguna
 * vez se archiva o se borra una de estas secciones, la próxima vez que un
 * admin entre se crea una nueva desde cero, vacía. Ver Limitaciones en el
 * README.
 */
const EXCLUSIVE_PROJECT_SEEDS = [
  {
    exclusiveKey: OFFERS_KEY,
    seedVersion: PROJECT_CODE_SEED, // 4 (v70): numera las ofertas y proyectos que ya existían — no añade ningún campo ni sección
    fieldsAddedIn: { 2: ["ubicacion"], 3: ["sector"] }, // v56: Ubicación · v58: Sector
    sectionsAddedIn: { 3: [OFFER_SECTION_DELIVERED, OFFER_SECTION_CLOSED] }, // v58: Entregadas, Cerradas
    name: "Ofertas",
    icon: "💼",
    color: "#8B85C4",
    sections: [
      { id: "nuevas", name: "Nuevas", order: 0, color: null },
      { id: "revisiones", name: "Revisiones", order: 1, color: null },
      { id: OFFER_SECTION_DELIVERED, name: "Entregadas", order: 2, color: null },
      { id: OFFER_SECTION_CLOSED, name: "Cerradas", order: 3, color: null },
    ],
    customFieldDefs: [
      { id: "comercial", name: "Comercial", type: "texto", options: [] },
      { id: "version", name: "Versión", type: "texto", options: [] },
      { id: "ubicacion", name: "Ubicación", type: "texto", options: [] },
      { id: "sector", name: "Sector", type: "lista", options: [...SECTOR_OPTIONS] },
    ],
    // Grupos de acceso (v63, ver departments.js): «diseno» abre Ofertas a
    // Diseño - Industria, Diseño - Automoción y al «Diseño» antiguo.
    allowedDepartments: ["diseno"],
  },
];

/**
 * Pone al día un proyecto exclusivo YA creado con lo que trajeron las
 * versiones de su seed posteriores a la suya (ver `seedVersion` arriba).
 * No toca nada más de lo que el equipo haya cambiado a mano (nombre,
 * color, secciones, otros campos...): solo AÑADE los campos y secciones
 * que falten, y si ya hay uno con ese mismo nombre (alguien lo creó a
 * mano antes, con otro id) no lo duplica — solo da la migración por hecha.
 *
 * Orden de las escrituras (v58): primero el proyecto con lo nuevo (campos y
 * secciones, SIN la `seedVersion`), después —solo en Ofertas al pasar a la
 * v58— se recolocan sus ofertas ya existentes, y solo al final se guarda
 * la `seedVersion`. Así, si algo falla a medias, la próxima vez que un
 * admin entre se repite entero (todos los pasos son idempotentes) en vez
 * de darse por hecho con las ofertas sin recolocar.
 *
 * v70: el paso 4 de la semilla de Ofertas solo numera lo que ya existía (ver
 * backfillProjectCodes, data/project-codes.js). Devuelve true si numeró.
 */
async function migrateSeededProject(project, seed) {
  const have = project.seedVersion || 1;
  if (have >= seed.seedVersion) return false;
  const defs = [...(project.customFieldDefs || [])];
  const sections = [...(project.sections || [])];
  let nextOrder = sections.reduce((max, s) => Math.max(max, Number.isFinite(s.order) ? s.order : -1), -1) + 1;
  for (let v = have + 1; v <= seed.seedVersion; v++) {
    for (const fieldId of (seed.fieldsAddedIn && seed.fieldsAddedIn[v]) || []) {
      const def = seed.customFieldDefs.find((f) => f.id === fieldId);
      if (!def) continue;
      const alreadyThere = defs.some((d) => d.id === def.id || normalizeName(d.name) === normalizeName(def.name));
      if (!alreadyThere) defs.push({ ...def, options: [...(def.options || [])] });
    }
    for (const sectionId of (seed.sectionsAddedIn && seed.sectionsAddedIn[v]) || []) {
      const def = seed.sections.find((sec) => sec.id === sectionId);
      if (!def) continue;
      const alreadyThere = sections.some((sec) => sec.id === def.id || normalizeName(sec.name) === normalizeName(def.name));
      if (!alreadyThere) sections.push({ ...def, order: nextOrder++ });
    }
  }
  const updated = { ...project, customFieldDefs: defs, sections };
  await updateProject(project.id, { customFieldDefs: defs, sections });
  if (isOffersProject(project) && have < 3) await repositionExistingOffers(updated);
  // v70: numerar las ofertas y proyectos de antes. Como el resto de pasos, es idempotente
  // y va ANTES de guardar la `seedVersion`: si se corta a medias, la próxima vez que
  // entre un admin continúa donde se quedó.
  const numbered = isOffersProject(project) && have < PROJECT_CODE_SEED;
  if (numbered) await backfillProjectCodes({ offersProject: updated });
  await updateProject(project.id, { seedVersion: seed.seedVersion });
  return numbered;
}

/**
 * Todas las tareas de un proyecto, las que lo tienen como principal y las
 * que lo tienen como adicional, sin duplicados — lectura única (no en
 * tiempo real). Las mismas dos consultas que ya usan saveProjectSections y
 * subscribeToProjectTasks, así que no hace falta ningún índice nuevo.
 */
async function fetchProjectTasksOnce(projectId) {
  const [primarySnap, extraSnap] = await Promise.all([
    getDocs(query(collection(db, "tasks"), where("projectId", "==", projectId))),
    getDocs(query(collection(db, "tasks"), where("extraProjectIds", "array-contains", projectId), where("projectId", "!=", null))),
  ]);
  const byId = new Map();
  [...primarySnap.docs, ...extraSnap.docs].forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  return [...byId.values()];
}

/**
 * v58, una sola vez: coloca las ofertas que ya existían donde ahora les
 * toca — las convertidas en proyecto en «Cerradas», las completadas en
 * «Entregadas» (qué se mueve exactamente lo decide planOfferRepositioning,
 * offers.js). Es la misma regla que se aplica de ahí en adelante al
 * completar o convertir una oferta; esto solo la aplica a lo anterior.
 */
async function repositionExistingOffers(project) {
  const plan = planOfferRepositioning(project, await fetchProjectTasksOnce(project.id));
  for (let i = 0; i < plan.length; i += 450) {
    const batch = writeBatch(db);
    plan.slice(i, i + 450).forEach(({ taskId, fields }) => batch.update(doc(db, "tasks", taskId), { ...fields, updatedAt: serverTimestamp() }));
    await batch.commit();
  }
}

export async function ensureExclusiveProjectsSeeded(currentProjects, creatorUid) {
  let numbered = false;
  for (const seed of EXCLUSIVE_PROJECT_SEEDS) {
    const existing = currentProjects.find((p) => p.exclusiveKey === seed.exclusiveKey);
    try {
      if (existing) {
        numbered = (await migrateSeededProject(existing, seed)) || numbered;
        continue;
      }
      await createProject({
        name: seed.name,
        icon: seed.icon,
        color: seed.color,
        sections: seed.sections,
        customFieldDefs: seed.customFieldDefs,
        exclusive: true,
        exclusiveKey: seed.exclusiveKey,
        allowedDepartments: seed.allowedDepartments,
        seedVersion: seed.seedVersion,
        creatorUid,
      });
    } catch (e) {
      console.error("ensureExclusiveProjectsSeeded:", seed.exclusiveKey, e);
    }
  }
  // v70: cada vez que entra un admin, los proyectos que se hayan quedado sin ID (uno
  // restaurado de la Papelera que era de antes de la v70, por ejemplo) reciben el suyo.
  // Si la migración acaba de numerar todo, no hace falta: esta lista es la de antes.
  if (!numbered) {
    try { await healProjectCodes(currentProjects); } catch (e) { console.error("healProjectCodes:", e); }
  }
}

const byName = (a, b) => (a.name || "").localeCompare(b.name || "");

/**
 * Escucha en tiempo real TODOS los proyectos del equipo (no solo los tuyos):
 * en un departamento pequeño, todo el mundo debe poder ver cualquier
 * proyecto y las tareas que haya dentro, esté o no asignado a esa persona.
 *
 * v74: pasa por el store (clave `projects:active`, ver store-subscriptions.js).
 */
export function subscribeToAllProjects(callback) {
  const q = query(collection(db, "projects"), where("archived", "==", false));
  const unsubscribe = subscribeToStoreList({
    key: "projects:active",
    slice: "projects",
    attach: (observer) => onSnapshot(q, observer),
    sort: byName,
    callback: (projects) => {
      // v58: se guarda SIN filtrar por departamento (ver getOffersProject).
      offersProjectCache = projects.find((p) => isOffersProject(p)) || null;
      callback(projects);
    },
  });
  return () => { unsubscribe(); offersProjectCache = null; };
}

/**
 * El proyecto Ofertas tal como llegó de la última suscripción de
 * subscribeToAllProjects (v58), o `null` si aún no ha llegado o no existe.
 * Lo usan data/tasks.js (completar una oferta la lleva a «Entregadas»)
 * para saber qué secciones tiene Ofertas sin que cada vista tenga que
 * pasarle los proyectos. Se guarda SIN filtrar por departamento a
 * propósito: quien no puede VER Ofertas en la interfaz sí puede tener una
 * oferta asignada en «Mis tareas» y completarla desde ahí — y esa oferta
 * tiene que moverse igual (el acceso por departamento es solo de
 * interfaz, ver isProjectVisibleToUser). Se vacía al cancelar la
 * suscripción (cerrar sesión).
 */
let offersProjectCache = null;
export function getOffersProject() {
  return offersProjectCache;
}

/** Proyectos archivados (el "Archivo") — se guardan, no se ven en la lista principal. (v74: por el store, clave `projects:archived`.) */
export function subscribeToArchivedProjects(callback) {
  const q = query(collection(db, "projects"), where("archived", "==", true));
  return subscribeToStoreList({
    key: "projects:archived",
    slice: "projects",
    attach: (observer) => onSnapshot(q, observer),
    sort: byName,
    callback,
  });
}

/**
 * Un proyecto por su id, en tiempo real (el que se está viendo). v74: sale del
 * store — la lista de proyectos (o la de archivados) ya lo tiene al día, así
 * que NO se abre una escucha propia: se avisa al instante con lo que hay y de
 * cada cambio de ESE documento. Solo si el store no lo tiene (un proyecto
 * archivado antes de abrir «Archivo», un enlace directo) o lo pierde de las
 * listas (se archivó, o se borró) se abre la escucha del documento
 * (`project:<id>`), que además es la que sabe decir «ya no existe» → `null`.
 * El objeto es el del store: quien lo reciba no debe modificarlo.
 */
export function subscribeToProject(projectId, callback) {
  const docKey = `project:${projectId}`;
  let released = false;
  let docHandle = null;
  let fallbackTimer = null;

  const openDoc = () => {
    if (docHandle || released) return;
    docHandle = store.listen(
      docKey,
      "projects",
      (observer) => onSnapshot(doc(db, "projects", projectId), observer),
      { keepAlive: false }
    );
  };
  // Al archivar (o restaurar) un proyecto, una lista dice «quitado» y la otra «añadido»
  // en dos avisos seguidos, en el orden que sea: se espera un instante antes de dar el
  // proyecto por perdido, para no abrir una escucha propia por una pérdida de un instante.
  const scheduleFallback = () => {
    if (fallbackTimer) return;
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!released && !store.getById("projects", projectId)) openDoc();
    }, 0);
  };
  const emit = (isFirst) => {
    if (released) return;
    const project = store.getById("projects", projectId);
    if (project) { callback(project); return; }
    if (!docHandle) { if (isFirst) openDoc(); else scheduleFallback(); return; } // no está en ninguna lista: se pide el documento
    if (store.isLoaded(docKey)) callback(null); // el documento dice que ya no existe
  };

  const unsubStore = store.subscribe("projects", (_data, change) => {
    if (change.type === "sync" || change.type === "reset") return;
    const touches = (list) => list.some((d) => d.id === projectId);
    if (change.key === docKey || touches(change.added) || touches(change.modified) || touches(change.removed)) emit(false);
  });

  emit(true);

  return () => {
    if (released) return;
    released = true;
    clearTimeout(fallbackTimer);
    unsubStore();
    if (docHandle) docHandle.release();
  };
}

/** Lista completa de personas del equipo (para selectores de responsable/miembros). v74: por el store, clave `users:all`. */
export function subscribeToAllUsers(callback) {
  return subscribeToStoreList({
    key: "users:all",
    slice: "users",
    attach: (observer) => onSnapshot(collection(db, "users"), observer),
    sort: byName,
    callback,
  });
}
