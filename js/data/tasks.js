// ============================================================================
// Acceso a datos: tareas.
//
// Tareas personales: si `projectId` es null, es una tarea privada de una
// sola persona (recordatorio en "Mis tareas"), marcada con `ownerId`. Se
// guarda en la misma colección para reutilizar toda la lógica de fechas,
// prioridad, subtareas, etc. — las reglas de Firestore son las que hacen
// que solo su dueña/o pueda verla.
//
// Nota sobre orden: no usamos orderBy() en la consulta de Firestore a
// propósito, para no depender de un índice compuesto. El orden (por
// sección/columna y por prioridad) se calcula en el cliente, en las vistas.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export async function createTask(projectId, data) {
  const ref = await addDoc(collection(db, "tasks"), {
    projectId: projectId || null,
    ownerId: data.ownerId || null,
    sectionId: data.sectionId || null,
    title: data.title,
    description: data.description || "",
    assigneeIds: data.assigneeIds || [],
    dueDate: data.dueDate || null,
    startDate: data.startDate || null,
    priority: data.priority || "media",
    tags: data.tags || [],
    dependsOn: data.dependsOn || [],
    subtasks: data.subtasks || [],
    attachments: data.attachments || [],
    customFields: data.customFields || {},
    isComplete: data.isComplete || false,
    isMilestone: data.isMilestone || false,
    completedAt: null,
    order: data.order ?? Date.now(),
    createdBy: data.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Copia una tarea existente (sin comentarios, sin marcar como completada). */
export async function duplicateTask(task) {
  return createTask(task.projectId, {
    ownerId: task.ownerId,
    sectionId: task.sectionId,
    title: `${task.title} (copia)`,
    description: task.description,
    assigneeIds: task.assigneeIds,
    dueDate: task.dueDate,
    startDate: task.startDate,
    priority: task.priority,
    tags: task.tags,
    dependsOn: [],
    subtasks: (task.subtasks || []).map((s) => ({ ...s, done: false })),
    attachments: task.attachments,
    isMilestone: task.isMilestone,
    createdBy: task.createdBy,
    order: Date.now(),
  });
}

export function updateTask(taskId, data) {
  return updateDoc(doc(db, "tasks", taskId), { ...data, updatedAt: serverTimestamp() });
}

export function deleteTask(taskId) {
  return deleteDoc(doc(db, "tasks", taskId));
}

export function toggleTaskComplete(taskId, isComplete) {
  return updateDoc(doc(db, "tasks", taskId), {
    isComplete,
    completedAt: isComplete ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

/** Cambia una tarea de sección/columna (drag & drop en el tablero). */
export function moveTask(taskId, sectionId, order) {
  return updateDoc(doc(db, "tasks", taskId), { sectionId, order, updatedAt: serverTimestamp() });
}

/** Lectura única (no en tiempo real) — usada al abrir el modal para editar. */
export async function getTask(taskId) {
  const snap = await getDoc(doc(db, "tasks", taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeToProjectTasks(projectId, callback) {
  const q = query(collection(db, "tasks"), where("projectId", "==", projectId));
  return onSnapshot(
    q,
    (snap) => {
      const tasks = [];
      snap.forEach((d) => tasks.push({ id: d.id, ...d.data() }));
      callback(tasks);
    },
    (err) => console.error("subscribeToProjectTasks:", err)
  );
}

export function subscribeToTask(taskId, callback) {
  return onSnapshot(doc(db, "tasks", taskId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Tareas asignadas a `uid` en cualquier proyecto, MÁS sus tareas
 * personales — de cara a quien la usa es un solo listener para toda la
 * vista "Mis tareas". Por dentro son DOS consultas separadas, a
 * propósito: la regla de lectura de `tasks` es "o es una tarea de
 * proyecto, o es tuya, o eres admin", y esa condición depende de
 * `projectId`/`ownerId` — campos que un único
 * `where("assigneeIds","array-contains",uid)` no acota para nada.
 * Firestore no puede demostrar que la consulta es segura sin esa
 * acotación y la rechaza entera para cualquiera que no sea admin (por
 * eso solo un admin veía sus tareas, y el resto del equipo no veía las
 * suyas). Acotando cada consulta al campo exacto que la regla necesita,
 * las dos quedan verificables para cualquier persona con sesión
 * iniciada, sea admin o no.
 *
 * La primera vez que se ejecute, Firestore puede pedir crear un índice
 * compuesto para la consulta de proyecto (assigneeIds + projectId) — es
 * el mismo aviso con enlace de siempre, solo hay que pulsarlo una vez.
 */
export function subscribeToMyTasks(uid, callback) {
  let projectTasks = [];
  let personalTasks = [];
  let projectLoaded = false;
  let personalLoaded = false;
  const emit = () => {
    if (!projectLoaded || !personalLoaded) return; // esperar a tener las dos partes antes del primer aviso
    callback([...projectTasks, ...personalTasks]);
  };

  const qProject = query(
    collection(db, "tasks"),
    where("assigneeIds", "array-contains", uid),
    where("projectId", "!=", null)
  );
  const unsubProject = onSnapshot(
    qProject,
    (snap) => {
      projectTasks = [];
      snap.forEach((d) => projectTasks.push({ id: d.id, ...d.data() }));
      projectLoaded = true;
      emit();
    },
    (err) => console.error("subscribeToMyTasks (proyecto):", err)
  );

  const qPersonal = query(collection(db, "tasks"), where("ownerId", "==", uid));
  const unsubPersonal = onSnapshot(
    qPersonal,
    (snap) => {
      personalTasks = [];
      snap.forEach((d) => personalTasks.push({ id: d.id, ...d.data() }));
      personalLoaded = true;
      emit();
    },
    (err) => console.error("subscribeToMyTasks (personal):", err)
  );

  return () => { unsubProject(); unsubPersonal(); };
}

// ============================================================================
// Ediciones masivas (selección múltiple en la vista de Lista).
//
// El permiso de ACTUALIZAR una tarea de proyecto es abierto a todo el
// equipo (ver firestore.rules), así que estas operaciones pueden ir en
// writeBatch — son atómicas y rápidas. El BORRADO en cambio está
// restringido a quien la creó/es su dueña o a un admin, así que
// bulkDeleteTasks NO usa un batch (un solo documento sin permiso haría
// fallar el lote entero): borra una a una con Promise.allSettled para
// poder informar de cuántas se borraron de verdad.
//
// Todas trocean en grupos de 450 para no chocar con el límite de 500
// escrituras por batch de Firestore.
// ============================================================================
const BATCH_CHUNK = 450;

async function runBatchedUpdate(taskIds, buildFieldsFor) {
  for (let i = 0; i < taskIds.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    taskIds.slice(i, i + BATCH_CHUNK).forEach((id) => {
      batch.update(doc(db, "tasks", id), { ...buildFieldsFor(id), updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }
}

/** Aplica los mismos campos (sección, proyecto, responsable, fechas, hito…) a todas las tareas indicadas. */
export function bulkUpdateTasks(taskIds, data) {
  return runBatchedUpdate(taskIds, () => data);
}

/** Marca/desmarca como completadas todas las tareas indicadas de una vez. */
export function bulkSetComplete(taskIds, isComplete) {
  return runBatchedUpdate(taskIds, () => ({
    isComplete,
    completedAt: isComplete ? serverTimestamp() : null,
  }));
}

/** Añade responsables SIN quitar los que ya tuviera cada tarea ("agregar colaboradores"). */
export function bulkAddAssignees(taskIds, uidsToAdd) {
  return runBatchedUpdate(taskIds, () => ({ assigneeIds: arrayUnion(...uidsToAdd) }));
}

/** Contrario de bulkAddAssignees (para poder deshacer una casilla marcada por error). */
export function bulkRemoveAssignees(taskIds, uidsToRemove) {
  return runBatchedUpdate(taskIds, () => ({ assigneeIds: arrayRemove(...uidsToRemove) }));
}

/**
 * Borra varias tareas a la vez. Devuelve qué ids se borraron de verdad y
 * cuáles no (por ejemplo, por no ser ni su dueña ni admin) para poder
 * avisar en vez de fallar en silencio.
 */
export async function bulkDeleteTasks(taskIds) {
  const results = await Promise.allSettled(taskIds.map((id) => deleteDoc(doc(db, "tasks", id))));
  const succeededIds = [];
  const failedIds = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? succeededIds : failedIds).push(taskIds[i]));
  return { succeededIds, failedIds };
}

/**
 * Combina varias tareas "duplicadas" en una sola (`survivorId`), y borra
 * las demás. Se unen responsables, etiquetas, subtareas, adjuntos y
 * dependencias (sin duplicar), y se trasladan los comentarios a la tarea
 * que sobrevive conservando su autor y fecha original.
 *
 * Trasladar un comentario ajeno exige ser admin (misma regla que usa el
 * importador de Asana para reasignar autoría histórica — ver
 * firestore.rules). Si quien combina no es admin, sus propios
 * comentarios sí se trasladan; los de otras personas se quedan colgando
 * en la tarea que se va a borrar (igual que ya ocurre hoy al borrar una
 * tarea suelta desde el menú contextual, que tampoco limpia sus
 * comentarios) — por eso se cuentan aparte en `skippedComments`.
 */
export async function mergeTasks(survivorId, duplicateIds) {
  const survivorSnap = await getDoc(doc(db, "tasks", survivorId));
  if (!survivorSnap.exists()) throw new Error("La tarea principal ya no existe.");
  const survivor = survivorSnap.data();

  const dupSnaps = await Promise.all(duplicateIds.map((id) => getDoc(doc(db, "tasks", id))));
  const dups = dupSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));

  const assigneeIds = new Set(survivor.assigneeIds || []);
  const tagsByLower = new Map((survivor.tags || []).map((t) => [t.toLowerCase(), t]));
  const dependsOn = new Set(survivor.dependsOn || []);
  const subtasks = [...(survivor.subtasks || [])];
  const attachments = [...(survivor.attachments || [])];
  const attachmentUrls = new Set(attachments.map((a) => a.url));
  let description = survivor.description || "";

  dups.forEach((t) => {
    (t.assigneeIds || []).forEach((id) => assigneeIds.add(id));
    (t.tags || []).forEach((tag) => { if (!tagsByLower.has(tag.toLowerCase())) tagsByLower.set(tag.toLowerCase(), tag); });
    (t.dependsOn || []).forEach((id) => dependsOn.add(id));
    (t.subtasks || []).forEach((s) => subtasks.push(s));
    (t.attachments || []).forEach((a) => { if (!attachmentUrls.has(a.url)) { attachments.push(a); attachmentUrls.add(a.url); } });
    if (t.description && t.description.trim() && t.description.trim() !== description.trim()) {
      description += `${description ? "\n\n" : ""}— Combinado desde «${t.title}» —\n${t.description}`;
    }
  });
  dependsOn.delete(survivorId); // por si alguna dependía de la propia superviviente

  await updateTask(survivorId, {
    assigneeIds: [...assigneeIds],
    tags: [...tagsByLower.values()],
    dependsOn: [...dependsOn],
    subtasks,
    attachments,
    description,
  });

  let skippedComments = 0;
  for (const t of dups) {
    const commentsSnap = await getDocs(collection(db, "tasks", t.id, "comments"));
    for (const c of commentsSnap.docs) {
      try {
        await addDoc(collection(db, "tasks", survivorId, "comments"), { ...c.data(), mergedFrom: t.title });
        await deleteDoc(c.ref);
      } catch (e) {
        skippedComments++;
      }
    }
  }

  for (let i = 0; i < dups.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    dups.slice(i, i + BATCH_CHUNK).forEach((t) => batch.delete(doc(db, "tasks", t.id)));
    await batch.commit();
  }

  return { mergedCount: dups.length, skippedComments };
}
