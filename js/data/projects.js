// ============================================================================
// Acceso a datos: proyectos.
// ============================================================================
import { db } from "../firebase-init.js";
import { OFFERS_KEY, normalizeName } from "../offers.js";
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
 */
export async function createProject({ name, description, color, icon, creatorUid, sections, customFieldDefs, exclusive, exclusiveKey, allowedDepartments, seedVersion, properties }) {
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
  });
  return ref.id;
}

export function updateProject(projectId, data) {
  return updateDoc(doc(db, "projects", projectId), data);
}

export function archiveProject(projectId, archived = true) {
  return updateDoc(doc(db, "projects", projectId), { archived });
}

export function deleteProject(projectId) {
  return deleteDoc(doc(db, "projects", projectId));
}

/**
 * Borra el proyecto Y todas las tareas que lo tienen como PRINCIPAL (con
 * sus comentarios) — se hace en lotes de como mucho 450 operaciones para
 * no chocar con el límite de 500 escrituras por batch de Firestore, de
 * sobra para el tamaño de un departamento, pero así no revienta si algún
 * proyecto acumula muchas tareas con muchos comentarios.
 *
 * Las tareas que tienen este proyecto solo como ADICIONAL (ver
 * extraProjectIds en el modelo de datos) no se borran — seguirían
 * perteneciendo a su proyecto principal, o siendo un recordatorio de
 * alguien — solo se les quita la referencia a este proyecto concreto de
 * `extraProjectIds` y su entrada correspondiente dentro de
 * `extraSections`.
 */
export async function deleteProjectWithTasks(projectId) {
  const primarySnap = await getDocs(query(collection(db, "tasks"), where("projectId", "==", projectId)));
  const extraSnap = await getDocs(
    query(collection(db, "tasks"), where("extraProjectIds", "array-contains", projectId), where("projectId", "!=", null))
  );

  const deletions = [];
  for (const taskDoc of primarySnap.docs) {
    const commentsSnap = await getDocs(collection(db, "tasks", taskDoc.id, "comments"));
    commentsSnap.forEach((c) => deletions.push(c.ref));
    deletions.push(taskDoc.ref);
  }
  deletions.push(doc(db, "projects", projectId));

  for (let i = 0; i < deletions.length; i += 450) {
    const batch = writeBatch(db);
    deletions.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  const primaryIds = new Set(primarySnap.docs.map((d) => d.id));
  const extraOnlyDocs = extraSnap.docs.filter((d) => !primaryIds.has(d.id)); // por si acaso; no debería solaparse nunca
  for (let i = 0; i < extraOnlyDocs.length; i += 450) {
    const batch = writeBatch(db);
    extraOnlyDocs.slice(i, i + 450).forEach((d) => {
      batch.update(d.ref, {
        extraProjectIds: arrayRemove(projectId),
        [`extraSections.${projectId}`]: deleteField(),
      });
    });
    await batch.commit();
  }
}

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
  return !!user.department && (project.allowedDepartments || []).includes(user.department);
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
 * Importante: la comprobación de "ya existe" solo mira proyectos NO
 * archivados (subscribeToAllProjects no trae los archivados) — si alguna
 * vez se archiva o se borra una de estas secciones, la próxima vez que un
 * admin entre se crea una nueva desde cero, vacía. Ver Limitaciones en el
 * README.
 */
const EXCLUSIVE_PROJECT_SEEDS = [
  {
    exclusiveKey: OFFERS_KEY,
    seedVersion: 2,
    fieldsAddedIn: { 2: ["ubicacion"] }, // v56: Ubicación
    name: "Ofertas",
    icon: "💼",
    color: "#8B85C4",
    sections: [
      { id: "nuevas", name: "Nuevas", order: 0, color: null },
      { id: "revisiones", name: "Revisiones", order: 1, color: null },
    ],
    customFieldDefs: [
      { id: "comercial", name: "Comercial", type: "texto", options: [] },
      { id: "version", name: "Versión", type: "texto", options: [] },
      { id: "ubicacion", name: "Ubicación", type: "texto", options: [] },
    ],
    allowedDepartments: ["diseno"],
  },
];

/**
 * Pone al día un proyecto exclusivo YA creado con lo que trajeron las
 * versiones de su seed posteriores a la suya (ver `seedVersion` arriba).
 * No toca nada más de lo que el equipo haya cambiado a mano (nombre,
 * color, secciones, otros campos...): solo AÑADE los campos que falten, y
 * si ya hay uno con ese mismo nombre (alguien lo creó a mano antes, con
 * otro id) no lo duplica — solo da la migración por hecha.
 */
async function migrateSeededProject(project, seed) {
  const have = project.seedVersion || 1;
  if (have >= seed.seedVersion) return;
  const defs = [...(project.customFieldDefs || [])];
  for (let v = have + 1; v <= seed.seedVersion; v++) {
    for (const fieldId of (seed.fieldsAddedIn && seed.fieldsAddedIn[v]) || []) {
      const def = seed.customFieldDefs.find((f) => f.id === fieldId);
      if (!def) continue;
      const alreadyThere = defs.some((d) => d.id === def.id || normalizeName(d.name) === normalizeName(def.name));
      if (!alreadyThere) defs.push({ ...def });
    }
  }
  await updateProject(project.id, { customFieldDefs: defs, seedVersion: seed.seedVersion });
}

export async function ensureExclusiveProjectsSeeded(currentProjects, creatorUid) {
  for (const seed of EXCLUSIVE_PROJECT_SEEDS) {
    const existing = currentProjects.find((p) => p.exclusiveKey === seed.exclusiveKey);
    try {
      if (existing) {
        await migrateSeededProject(existing, seed);
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
}

/**
 * Escucha en tiempo real TODOS los proyectos del equipo (no solo los tuyos):
 * en un departamento pequeño, todo el mundo debe poder ver cualquier
 * proyecto y las tareas que haya dentro, esté o no asignado a esa persona.
 */
export function subscribeToAllProjects(callback) {
  const q = query(collection(db, "projects"), where("archived", "==", false));
  return onSnapshot(q, (snap) => {
    const projects = [];
    snap.forEach((d) => projects.push({ id: d.id, ...d.data() }));
    projects.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(projects);
  }, (err) => console.error("subscribeToAllProjects:", err));
}

/** Proyectos archivados (el "Archivo") — se guardan, no se ven en la lista principal. */
export function subscribeToArchivedProjects(callback) {
  const q = query(collection(db, "projects"), where("archived", "==", true));
  return onSnapshot(q, (snap) => {
    const projects = [];
    snap.forEach((d) => projects.push({ id: d.id, ...d.data() }));
    projects.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(projects);
  }, (err) => console.error("subscribeToArchivedProjects:", err));
}

export function subscribeToProject(projectId, callback) {
  return onSnapshot(doc(db, "projects", projectId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/** Lista completa de personas del equipo (para selectores de responsable/miembros). */
export function subscribeToAllUsers(callback) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const users = [];
    snap.forEach((d) => users.push({ uid: d.id, ...d.data() }));
    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(users);
  });
}
