// ============================================================================
// Papelera (v67): eliminar una tarea o un proyecto ya no lo borra de golpe —
// se guarda 30 días en la colección `trash/{id}` y se puede restaurar desde
// «Papelera» (barra lateral). Pasado ese tiempo se borra para siempre.
//
// Por qué una colección aparte y no una marca (`deletedAt`) en la propia
// tarea: así NINGUNA consulta ni vista existente cambia — las tareas y los
// proyectos eliminados simplemente no están donde se leen — y no cuestan
// lecturas a nadie mientras no se abra la Papelera. Además el permiso de
// borrar sigue siendo el de siempre: mover a la papelera es UN batch que crea
// la copia y borra el original, y si las reglas no dejan borrar ese original
// el batch entero falla y no pasa nada.
//
// Documento de la papelera:
//   kind: "task" | "project"
//   deletedBy, deletedByName, deletedAt (serverTimestamp)
//   title: el título de la tarea / el nombre del proyecto, para el listado
//   task:    copia de los datos de la tarea (sin su id)             [kind task]
//   taskId:  su id de siempre, para restaurarla con el mismo id     [kind task]
//   projectId / projectName: proyecto que tenía (copia del nombre)  [kind task]
//   groupId: si se eliminó DENTRO de un proyecto, el id del documento de
//            papelera de ese proyecto (y entonces no sale suelta)   [kind task]
//   project: copia de los datos del proyecto (sin su id)            [kind project]
//   projectId: su id de siempre                                     [kind project]
//   taskCount: cuántas tareas se fueron con él                      [kind project]
//   extraRefs: [{taskId, sectionId}] tareas que lo tenían solo como proyecto
//              ADICIONAL (a esas no se las borra: se les quitó la referencia,
//              y al restaurar el proyecto se les vuelve a poner)    [kind project]
//
// LOS COMENTARIOS NO SE COPIAN. Una subcolección sobrevive aunque se borre su
// documento padre, así que los comentarios de una tarea eliminada se quedan
// donde estaban y reaparecen solos al restaurarla con el mismo id. Es además lo
// único que cuadra con las reglas: borrar o recrear el comentario de otra
// persona exige ser admin. Solo se borran (si quien purga es admin) cuando la
// tarea se elimina para siempre.
//
// Quién ve qué: cada persona, lo que ELLA eliminó; un admin, todo. Lo exigen
// las reglas (firestore.rules, `trash`), no solo la interfaz.
//
// Caducidad: 30 días desde `deletedAt`. No hay servidor que lo ejecute, así que
// la purga la hace el primer admin que entre cada sesión (purgeExpiredTrash);
// mientras tanto, lo caducado no se muestra (topLevelTrashItems) aunque siga
// guardado.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove,
  deleteField,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { toDate } from "../utils.js";

export const TRASH_DAYS = 30;
const DAY_MS = 86400000;
const BATCH_CHUNK = 450;

// ----------------------------------------------------------------------------
// Ayudantes puros (sin Firestore)
// ----------------------------------------------------------------------------

/** Cuándo se eliminó: un Date, o null si el servidor aún no ha confirmado la hora (serverTimestamp pendiente en local). */
export function trashDeletedAt(item) {
  const d = toDate(item && item.deletedAt);
  return d && !isNaN(d.getTime()) ? d : null;
}

/** Cuándo caduca (se borra para siempre), o null si aún no se conoce la hora de eliminación. */
export function trashExpiresAt(item) {
  const d = trashDeletedAt(item);
  return d ? new Date(d.getTime() + TRASH_DAYS * DAY_MS) : null;
}

/** Días que le quedan (de TRASH_DAYS a 0). Una eliminación recién hecha, aún sin hora del servidor, cuenta como «hoy». */
export function trashDaysLeft(item, now = new Date()) {
  const expires = trashExpiresAt(item);
  if (!expires) return TRASH_DAYS;
  return Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / DAY_MS));
}

export function isTrashExpired(item, now = new Date()) {
  const expires = trashExpiresAt(item);
  return !!expires && expires.getTime() <= now.getTime();
}

/**
 * Lo que enseña la Papelera: sin lo caducado y sin las tareas que se fueron
 * dentro de un proyecto eliminado (esas salen dentro de su proyecto, no sueltas
 * — salvo que el proyecto ya no esté, y entonces sí).
 */
export function topLevelTrashItems(items, now = new Date()) {
  const projectIds = new Set((items || []).filter((i) => i.kind === "project").map((i) => i.id));
  return (items || []).filter((i) => !isTrashExpired(i, now) && !(i.groupId && projectIds.has(i.groupId)));
}

/** Copia sin las claves `undefined` (Firestore las rechaza). Solo recorre objetos planos y listas: un Timestamp se deja tal cual. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
    return out;
  }
  return value;
}

function withoutId(obj) {
  const { id, ...rest } = obj;
  return rest;
}

const hasSection = (project, sectionId) => !!(project && (project.sections || []).some((s) => s.id === sectionId));

function permissionDenied(message) {
  return Object.assign(new Error(message), { code: "permission-denied" });
}

async function commitInChunks(operations) {
  for (let i = 0; i < operations.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    operations.slice(i, i + BATCH_CHUNK).forEach((op) => op(batch));
    await batch.commit();
  }
}

// ----------------------------------------------------------------------------
// Mover a la papelera
// ----------------------------------------------------------------------------

/**
 * Mueve tareas a la papelera. Cada una va en su propio batch (copia + borrado
 * del original, atómico), así que si las reglas no dejan borrar alguna, solo
 * esa falla y las demás sí se mueven — igual que ya hacía el borrado masivo.
 * Devuelve `trashed` ([{taskId, trashId}], lo que hace falta para deshacer),
 * `failedIds` y, si hubo fallos, el código del primer error.
 * `user`: quien elimina ({uid, name}); `projects`: para guardar el nombre del
 * proyecto de cada tarea (solo para enseñarlo en la Papelera).
 */
export async function trashTasks(tasks, { user, projects = [] }) {
  // El nombre del proyecto se guarda solo para enseñarlo en la Papelera. Sale de
  // `projects` si quien llama lo tiene a mano; si no (las vistas que no reciben
  // la lista), se lee una vez por proyecto distinto.
  const names = new Map(projects.map((p) => [p.id, p.name || ""]));
  for (const projectId of new Set(tasks.map((t) => t.projectId).filter(Boolean))) {
    if (names.has(projectId)) continue;
    try {
      const snap = await getDoc(doc(db, "projects", projectId));
      names.set(projectId, snap.exists() ? snap.data().name || "" : "");
    } catch (err) {
      names.set(projectId, "");
    }
  }
  const projectName = (id) => names.get(id) || "";
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const trashRef = doc(collection(db, "trash"));
      const batch = writeBatch(db);
      batch.set(trashRef, {
        kind: "task",
        taskId: task.id,
        title: task.title || "",
        projectId: task.projectId || null,
        projectName: task.projectId ? projectName(task.projectId) : "",
        task: clean(withoutId(task)),
        groupId: null,
        deletedBy: user.uid,
        deletedByName: user.name || "",
        deletedAt: serverTimestamp(),
      });
      batch.delete(doc(db, "tasks", task.id));
      await batch.commit();
      return { taskId: task.id, trashId: trashRef.id };
    })
  );
  const trashed = [];
  const failedIds = [];
  let errorCode = null;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") trashed.push(r.value);
    else {
      failedIds.push(tasks[i].id);
      if (!errorCode) errorCode = (r.reason && r.reason.code) || "unknown";
    }
  });
  return { trashed, failedIds, errorCode };
}

/**
 * Mueve un proyecto a la papelera, con las tareas que lo tienen como PRINCIPAL.
 * Las que lo tienen solo como adicional no se tocan, salvo quitarles la
 * referencia (como siempre), que se apunta en `extraRefs` para ponérsela de
 * nuevo al restaurar. Solo puede quien creó el proyecto o un admin (lo exigen
 * las reglas): se comprueba antes de mover nada.
 *
 * Orden (el mismo de siempre, que las reglas necesitan: el permiso para borrar
 * una tarea mira el proyecto, así que el proyecto se borra el último): primero
 * las tareas, en lotes; luego el proyecto. Si ese último paso fallara, las
 * tareas ya movidas se devuelven a su sitio antes de propagar el error.
 * Devuelve `{ trashId, taskCount }`.
 */
export async function trashProject(project, { user }) {
  if (project.createdBy !== user.uid && user.role !== "admin") {
    throw permissionDenied("Solo quien creó el proyecto o un admin puede eliminarlo.");
  }
  const primarySnap = await getDocs(query(collection(db, "tasks"), where("projectId", "==", project.id)));
  const extraSnap = await getDocs(
    query(collection(db, "tasks"), where("extraProjectIds", "array-contains", project.id), where("projectId", "!=", null))
  );
  const projectTrashRef = doc(collection(db, "trash"));
  const base = { deletedBy: user.uid, deletedByName: user.name || "", deletedAt: serverTimestamp() };

  const taskOps = primarySnap.docs.map((d) => (batch) => {
    batch.set(doc(collection(db, "trash")), {
      kind: "task",
      taskId: d.id,
      title: d.data().title || "",
      projectId: project.id,
      projectName: project.name || "",
      task: clean(d.data()),
      groupId: projectTrashRef.id,
      ...base,
    });
    batch.delete(d.ref);
  });
  // Dos operaciones por tarea: lotes de la mitad de tamaño.
  for (let i = 0; i < taskOps.length; i += BATCH_CHUNK / 2) {
    const batch = writeBatch(db);
    taskOps.slice(i, i + BATCH_CHUNK / 2).forEach((op) => op(batch));
    await batch.commit();
  }

  const primaryIds = new Set(primarySnap.docs.map((d) => d.id));
  const extraOnlyDocs = extraSnap.docs.filter((d) => !primaryIds.has(d.id));
  const finalBatch = writeBatch(db);
  finalBatch.set(projectTrashRef, {
    kind: "project",
    projectId: project.id,
    title: project.name || "",
    project: clean(withoutId(project)),
    taskCount: primarySnap.docs.length,
    extraRefs: extraOnlyDocs.map((d) => ({ taskId: d.id, sectionId: (d.data().extraSections || {})[project.id] ?? null })),
    ...base,
  });
  finalBatch.delete(doc(db, "projects", project.id));
  try {
    await finalBatch.commit();
  } catch (err) {
    // No se pudo borrar el proyecto: que las tareas no se queden en la papelera con el proyecto vivo.
    try { await restoreGroupTasks(projectTrashRef.id, { user, cache: new Map() }); } catch (rollbackErr) { console.error("trashProject (deshacer lo movido):", rollbackErr); }
    throw err;
  }

  await commitInChunks(
    extraOnlyDocs.map((d) => (batch) =>
      batch.update(d.ref, { extraProjectIds: arrayRemove(project.id), [`extraSections.${project.id}`]: deleteField() })
    )
  );
  return { trashId: projectTrashRef.id, taskCount: primarySnap.docs.length };
}

// ----------------------------------------------------------------------------
// Restaurar
// ----------------------------------------------------------------------------

async function projectOf(projectId, cache) {
  if (!cache.has(projectId)) {
    const snap = await getDoc(doc(db, "projects", projectId));
    cache.set(projectId, snap.exists() ? snap.data() : null);
  }
  return cache.get(projectId);
}

/**
 * Los datos con los que se vuelve a crear una tarea, adaptados a cómo está el
 * resto AHORA: si su proyecto ya no existe, pasa a ser una tarea personal de
 * quien la restaura (o, si seguía en otros proyectos, el primero que quede pasa
 * a ser el principal); si su sección ya no está, queda «Sin sección». Devuelve
 * también un aviso (`note`) si hubo que cambiar algo que se nota: "personal"
 * (sin proyecto) o "section".
 */
async function restoredTaskData(item, { user, cache }) {
  const data = { ...item.task };
  let note = null;

  if (data.projectId) {
    const project = await projectOf(data.projectId, cache);
    if (!project) {
      data.projectId = null;
      data.sectionId = null;
    } else if (data.sectionId && !hasSection(project, data.sectionId)) {
      data.sectionId = null;
      note = "section";
    }
  }

  const keep = [];
  const sections = {};
  for (const pid of data.extraProjectIds || []) {
    const project = await projectOf(pid, cache);
    if (!project) continue;
    keep.push(pid);
    const sid = (data.extraSections || {})[pid];
    sections[pid] = sid && hasSection(project, sid) ? sid : null;
  }
  if (!data.projectId && keep.length) {
    data.projectId = keep.shift();
    data.sectionId = sections[data.projectId] ?? null;
    delete sections[data.projectId];
  }
  data.extraProjectIds = keep;
  data.extraSections = sections;

  if (!data.projectId) {
    if (item.task.projectId) note = "personal";
    // Una tarea personal la ve y borra su dueño/a: si quien restaura no lo era ni es admin, pasa a serlo (las reglas no dejan crearla a nombre de otra persona).
    if (user.role !== "admin" && data.ownerId !== user.uid) data.ownerId = user.uid;
  }
  return { data, note };
}

async function restoreOneTask(item, ctx) {
  const taskRef = doc(db, "tasks", item.taskId);
  const existing = await getDoc(taskRef);
  const batch = writeBatch(db);
  let note = null;
  if (!existing.exists()) {
    const resolved = await restoredTaskData(item, ctx);
    note = resolved.note;
    batch.set(taskRef, { ...resolved.data, updatedAt: serverTimestamp() });
  }
  // Si por lo que fuera ya había una tarea con ese id, no se pisa: solo se limpia la papelera.
  batch.delete(doc(db, "trash", item.id));
  await batch.commit();
  return { note, alreadyThere: existing.exists() };
}

async function restoreGroupTasks(groupId, ctx) {
  const groupSnap = await getDocs(query(collection(db, "trash"), where("groupId", "==", groupId)));
  const notes = [];
  for (const d of groupSnap.docs) {
    const r = await restoreOneTask({ id: d.id, ...d.data() }, ctx);
    if (r.note) notes.push(r.note);
  }
  return { count: groupSnap.docs.length, notes };
}

async function restoreProjectItem(item, ctx) {
  const project = item.project || {};
  if (project.exclusiveKey) {
    const same = await getDocs(query(collection(db, "projects"), where("exclusiveKey", "==", project.exclusiveKey)));
    if (!same.empty) return { ok: false, reason: "exclusive-exists" };
  }
  const projectRef = doc(db, "projects", item.projectId);
  if (!(await getDoc(projectRef)).exists()) {
    const batch = writeBatch(db);
    batch.set(projectRef, clean(project));
    await batch.commit();
  }
  ctx.cache.set(item.projectId, project);

  const { count, notes } = await restoreGroupTasks(item.id, ctx);

  for (const ref of item.extraRefs || []) {
    const taskSnap = await getDoc(doc(db, "tasks", ref.taskId));
    if (!taskSnap.exists()) continue;
    await updateDoc(doc(db, "tasks", ref.taskId), {
      extraProjectIds: arrayUnion(item.projectId),
      [`extraSections.${item.projectId}`]: ref.sectionId && hasSection(project, ref.sectionId) ? ref.sectionId : null,
    });
  }
  await deleteDoc(doc(db, "trash", item.id));
  return { ok: true, restoredTasks: count, notes };
}

/**
 * Restaura un elemento de la papelera (una tarea suelta o un proyecto con sus
 * tareas). Devuelve `{ ok, kind, notes, restoredTasks?, reason? }`:
 *  - `notes`: avisos de lo que hubo que adaptar ("personal": su proyecto ya no
 *    existía y quedó como tarea personal; "section": su sección ya no estaba).
 *  - `ok: false, reason: "exclusive-exists"`: se eliminó una sección exclusiva
 *    (Ofertas) y mientras tanto se creó otra nueva — restaurar la vieja las
 *    duplicaría, así que no se hace.
 */
export async function restoreTrashItem(item, { user }) {
  const ctx = { user, cache: new Map() };
  if (item.kind === "project") {
    const r = await restoreProjectItem(item, ctx);
    return { ...r, kind: "project", notes: r.notes || [] };
  }
  const r = await restoreOneTask(item, ctx);
  return { ok: true, kind: "task", notes: r.note ? [r.note] : [], restoredTasks: 1 };
}

/** Restaura por id de papelera (lo que devuelve trashTasks/trashProject) — para el «Deshacer» de un borrado. Ignora los que ya no estén. */
export async function restoreTrashByIds(trashIds, { user }) {
  const summary = { tasks: 0, projects: 0, projectTasks: 0, notes: [], failed: 0 };
  for (const id of trashIds) {
    try {
      const snap = await getDoc(doc(db, "trash", id));
      if (!snap.exists()) continue;
      const r = await restoreTrashItem({ id: snap.id, ...snap.data() }, { user });
      if (!r.ok) { summary.failed++; continue; }
      if (r.kind === "project") { summary.projects++; summary.projectTasks += r.restoredTasks || 0; }
      else summary.tasks += r.restoredTasks || 1;
      summary.notes.push(...(r.notes || []));
    } catch (err) {
      console.error("restoreTrashByIds:", err);
      summary.failed++;
    }
  }
  return summary;
}

// ----------------------------------------------------------------------------
// Eliminar para siempre
// ----------------------------------------------------------------------------

/**
 * Borra para siempre estos elementos de la papelera (y, si son un proyecto, las
 * tareas que se fueron con él). Si quien lo hace es admin, también borra los
 * comentarios de esas tareas (los de otras personas solo los puede borrar un
 * admin; si no lo es, quedan sueltos, como ya pasaba al borrar una tarea).
 * Devuelve cuántos elementos de primer nivel se borraron.
 */
export async function purgeTrashItems(items, { isAdmin = false } = {}) {
  const refs = new Map(); // ruta -> ref, para no borrar dos veces lo mismo
  const add = (ref) => refs.set(ref.path, ref);
  const addComments = async (taskId) => {
    if (!isAdmin || !taskId) return;
    const comments = await getDocs(collection(db, "tasks", taskId, "comments"));
    comments.forEach((c) => add(c.ref));
  };
  for (const item of items) {
    if (item.kind === "project") {
      const group = await getDocs(query(collection(db, "trash"), where("groupId", "==", item.id)));
      for (const d of group.docs) {
        await addComments(d.data().taskId);
        add(d.ref);
      }
    } else {
      await addComments(item.taskId);
    }
    add(doc(db, "trash", item.id));
  }
  await commitInChunks([...refs.values()].map((ref) => (batch) => batch.delete(ref)));
  return items.length;
}

/**
 * Purga lo caducado (más de TRASH_DAYS días). Solo un admin puede borrar lo de
 * todo el mundo, así que solo se llama desde sesiones de admin (app.js, una
 * vez por sesión). Devuelve cuántos documentos de la papelera borró.
 */
export async function purgeExpiredTrash({ now = new Date() } = {}) {
  const cutoff = Timestamp.fromDate(new Date(now.getTime() - TRASH_DAYS * DAY_MS));
  const snap = await getDocs(query(collection(db, "trash"), where("deletedAt", "<", cutoff)));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!items.length) return 0;
  await purgeTrashItems(items, { isAdmin: true });
  return items.length;
}

// ----------------------------------------------------------------------------
// Suscripción (solo cuando se abre la Papelera)
// ----------------------------------------------------------------------------

/**
 * La papelera de esta persona (lo que ella eliminó) o, si es admin, la de todo
 * el equipo. Más reciente primero. Una eliminación recién hecha, aún sin la
 * hora del servidor, va la primera.
 */
export function subscribeToTrash({ uid, isAdmin }, callback) {
  const source = isAdmin ? collection(db, "trash") : query(collection(db, "trash"), where("deletedBy", "==", uid));
  return onSnapshot(
    source,
    (snap) => {
      const items = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
      const when = (i) => { const d = trashDeletedAt(i); return d ? d.getTime() : Infinity; };
      items.sort((a, b) => when(b) - when(a));
      callback(items);
    },
    (err) => {
      console.error("subscribeToTrash:", err);
      callback([]);
    }
  );
}
