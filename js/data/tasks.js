// ============================================================================
// Acceso a datos: tareas.
//
// Tareas personales: si `projectId` es null y no hay ningún adicional
// (`extraProjectIds` vacío), es un recordatorio sin proyecto — lo ve quien
// conste en `ownerId` y cualquiera en `assigneeIds` (se puede asignar a
// otras personas sin meterla en ningún proyecto, ver task-modal.js). Se
// guarda en la misma colección para reutilizar toda la lógica de fechas,
// prioridad, subtareas, etc. — las reglas de Firestore son las que hacen
// que solo esas personas puedan verla.
//
// Varios proyectos a la vez: el proyecto PRINCIPAL sigue siendo
// `projectId`/`sectionId` (igual que siempre — de ahí cuelga buena parte
// del permiso de lectura/escritura abierto a todo el equipo, ver
// firestore.rules). Cualquier proyecto ADICIONAL vive en
// `extraProjectIds[]` + `extraSections{[projectId]: sectionId}` — un mapa,
// porque cada proyecto tiene sus propias secciones y una tarea puede estar
// en una sección distinta dentro de cada uno. `js/utils.js` tiene los dos
// helpers (`getTaskProjectIds`, `getTaskSectionForProject`) que combinan
// ambos; el resto del código nunca lee `extraProjectIds`/`extraSections`
// directamente. Quitarle a una tarea su último proyecto sin que tenga
// `ownerId` la dejaría invisible para todo el mundo salvo un admin — ver
// el comentario de `computeOwnerIdOnSave` en task-modal.js para cómo se
// evita.
//
// Nota sobre orden: no usamos orderBy() en la consulta de Firestore a
// propósito, para no depender de un índice compuesto. El orden (por
// sección/columna y por prioridad) se calcula en el cliente, en las vistas.
// El campo `order` en sí es único y global por tarea, no por proyecto — una
// tarea en dos proyectos a la vez comparte el mismo valor en los dos
// tableros; con departamentos de este tamaño no se nota (ver apartado 7
// del README).
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
import { toEditableHtml, escapeHtml } from "../utils.js";

export async function createTask(projectId, data) {
  const ref = await addDoc(collection(db, "tasks"), {
    projectId: projectId || null,
    ownerId: data.ownerId || null,
    sectionId: data.sectionId || null,
    extraProjectIds: data.extraProjectIds || [],
    extraSections: data.extraSections || {},
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
    extraProjectIds: task.extraProjectIds,
    extraSections: task.extraSections,
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

/**
 * Cambia una tarea de sección/columna (drag & drop en el tablero).
 * `contextProjectId` es el proyecto del tablero donde se ha soltado, e
 * `isExtraProject` dice si ese proyecto es el principal de la tarea o uno
 * adicional (lo calcula quien llama, comparando `task.projectId` con el
 * proyecto del tablero — ver board-view.js): si es el principal se
 * actualiza `sectionId` como siempre; si es uno adicional, solo su entrada
 * dentro de `extraSections`, sin tocar la sección que tenga en su proyecto
 * principal ni en ningún otro adicional.
 */
export function moveTask(taskId, sectionId, order, contextProjectId, isExtraProject) {
  const fields = isExtraProject ? { [`extraSections.${contextProjectId}`]: sectionId } : { sectionId };
  return updateDoc(doc(db, "tasks", taskId), { ...fields, order, updatedAt: serverTimestamp() });
}

/** Lectura única (no en tiempo real) — usada al abrir el modal para editar. */
export async function getTask(taskId) {
  const snap = await getDoc(doc(db, "tasks", taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Todas las tareas de un proyecto: las que lo tienen como principal, MÁS
 * las que lo tienen como adicional (ver extraProjectIds en el modelo de
 * datos) — dos consultas por debajo, combinadas y sin duplicados, mismo
 * motivo y mismo patrón que subscribeToMyTasks un poco más abajo: la
 * segunda consulta acota también por `projectId != null`, que para estos
 * documentos siempre es verdad por construcción (un proyecto solo entra en
 * `extraProjectIds` cuando ya hay uno principal, nunca antes — ver
 * task-modal.js), pero hace falta escribirlo en la propia consulta para
 * que Firestore pueda demostrar que cumple la regla de lectura sin tener
 * que confiar en ese invariante a ciegas.
 */
export function subscribeToProjectTasks(projectId, callback) {
  let primaryTasks = [];
  let extraTasks = [];
  let primaryLoaded = false;
  let extraLoaded = false;
  const emit = () => {
    if (!primaryLoaded || !extraLoaded) return;
    const byId = new Map();
    [...primaryTasks, ...extraTasks].forEach((t) => byId.set(t.id, t));
    callback([...byId.values()]);
  };

  const qPrimary = query(collection(db, "tasks"), where("projectId", "==", projectId));
  const unsubPrimary = onSnapshot(
    qPrimary,
    (snap) => {
      primaryTasks = [];
      snap.forEach((d) => primaryTasks.push({ id: d.id, ...d.data() }));
      primaryLoaded = true;
      emit();
    },
    (err) => console.error("subscribeToProjectTasks (principal):", err)
  );

  const qExtra = query(
    collection(db, "tasks"),
    where("extraProjectIds", "array-contains", projectId),
    where("projectId", "!=", null)
  );
  const unsubExtra = onSnapshot(
    qExtra,
    (snap) => {
      extraTasks = [];
      snap.forEach((d) => extraTasks.push({ id: d.id, ...d.data() }));
      extraLoaded = true;
      emit();
    },
    (err) => console.error("subscribeToProjectTasks (adicional):", err)
  );

  return () => { unsubPrimary(); unsubExtra(); };
}

export function subscribeToTask(taskId, callback) {
  return onSnapshot(doc(db, "tasks", taskId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Tareas asignadas a `uid` (de proyecto o personales, ver más abajo), MÁS
 * las personales que haya creado aunque ya no conste como responsable de
 * ellas — de cara a quien la usa es un solo listener para toda la vista
 * "Mis tareas". Por dentro son DOS consultas separadas, a propósito: la
 * regla de lectura de `tasks` es "tiene proyecto, o eres su dueño/a, o
 * eres uno de sus responsables, o eres admin", y Firestore necesita poder
 * demostrar que una consulta cumple la regla a partir de sus propios
 * filtros, no basta con que los documentos que devuelva la cumplan de
 * hecho.
 *
 * `where("assigneeIds","array-contains",uid)` sola YA es una consulta
 * verificable por sí misma: coincide exactamente con la rama "eres uno de
 * sus responsables" de la regla (mismo campo, mismo valor — `uid` es
 * siempre `request.auth.uid` de quien pregunta), así que ya no hace falta
 * acotarla también por `projectId` como en versiones anteriores de este
 * archivo — esa acotación extra solo hacía falta porque la regla de
 * entonces no tenía una rama para "responsable de una tarea personal", así
 * que había que demostrar la cosa por el lado de "tiene proyecto" en su
 * lugar. Ahora esta única consulta trae de una vez tanto tareas de
 * proyecto como personales en las que constes como responsable, sea quien
 * sea quien las haya creado.
 *
 * La segunda consulta, `where("ownerId","==",uid)`, sigue haciendo falta
 * aparte: cubre tareas personales tuyas en las que, por lo que sea, ya no
 * estés en `assigneeIds` (te has quitado a ti mismo/a sin dejar de ser su
 * dueño/a) — un caso raro, pero que de no cubrirse haría "desaparecer" una
 * tarea de Mis tareas sin haberla borrado ni completado. Combinar las dos
 * sin duplicados es solo por si una tarea cumple ambas condiciones a la
 * vez (normal: la mayoría de tareas personales llevan a su propio dueño/a
 * también en `assigneeIds`).
 *
 * La primera vez que se ejecute cada una, Firestore puede pedir crear un
 * índice — es el mismo aviso con enlace de siempre, solo hay que
 * pulsarlo una vez.
 */
export function subscribeToMyTasks(uid, callback) {
  let assignedTasks = [];
  let ownedTasks = [];
  let assignedLoaded = false;
  let ownedLoaded = false;
  const emit = () => {
    if (!assignedLoaded || !ownedLoaded) return; // esperar a tener las dos partes antes del primer aviso
    const byId = new Map();
    [...assignedTasks, ...ownedTasks].forEach((t) => byId.set(t.id, t));
    callback([...byId.values()]);
  };

  const qAssigned = query(collection(db, "tasks"), where("assigneeIds", "array-contains", uid));
  const unsubAssigned = onSnapshot(
    qAssigned,
    (snap) => {
      assignedTasks = [];
      snap.forEach((d) => assignedTasks.push({ id: d.id, ...d.data() }));
      assignedLoaded = true;
      emit();
    },
    (err) => console.error("subscribeToMyTasks (responsable):", err)
  );

  const qOwned = query(collection(db, "tasks"), where("ownerId", "==", uid));
  const unsubOwned = onSnapshot(
    qOwned,
    (snap) => {
      ownedTasks = [];
      snap.forEach((d) => ownedTasks.push({ id: d.id, ...d.data() }));
      ownedLoaded = true;
      emit();
    },
    (err) => console.error("subscribeToMyTasks (dueño/a):", err)
  );

  return () => { unsubAssigned(); unsubOwned(); };
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

/**
 * Mueve varias tareas a una sección de UN proyecto concreto (acción "Mover
 * a otra sección" de la barra de selección múltiple, solo en Lista). A
 * diferencia de bulkUpdateTasks, aquí el campo que toca escribir depende
 * de cada tarea: si ese proyecto es su principal, `sectionId`; si es uno
 * adicional (ver extraProjectIds), su entrada dentro de `extraSections` —
 * por eso recibe las tareas enteras (`tasks`), no solo sus ids, y no
 * `bulkUpdateTasks` (que aplica el mismo campo a todas por igual).
 */
export function bulkMoveToSectionInProject(tasks, projectId, sectionId) {
  return runBatchedUpdate(tasks.map((t) => t.id), (id) => {
    const t = tasks.find((x) => x.id === id);
    return t && t.projectId === projectId ? { sectionId } : { [`extraSections.${projectId}`]: sectionId };
  });
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
 * Saca las tareas de su proyecto y las convierte en tareas personales de
 * `uid` — quedan solo en "Mis tareas" de quien ejecuta la acción (nunca de
 * quien tuvieran asignado antes), igual que un recordatorio creado a mano
 * ahí. Como una tarea personal solo la ve su dueña/o, se sustituyen los
 * responsables anteriores por quien la mueve (si ya era responsable, no
 * cambia nada de cara a ella/él; si no lo era, queda asignada
 * automáticamente) — dejar ahí a otras personas como "responsables" no
 * tendría sentido: ya no podrían ni verla.
 */
export function bulkMoveToMyTasks(taskIds, uid) {
  return runBatchedUpdate(taskIds, () => ({
    projectId: null,
    ownerId: uid,
    sectionId: null,
    assigneeIds: [uid],
    extraProjectIds: [],
    extraSections: {},
  }));
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
  let description = toEditableHtml(survivor.description || "");

  dups.forEach((t) => {
    (t.assigneeIds || []).forEach((id) => assigneeIds.add(id));
    (t.tags || []).forEach((tag) => { if (!tagsByLower.has(tag.toLowerCase())) tagsByLower.set(tag.toLowerCase(), tag); });
    (t.dependsOn || []).forEach((id) => dependsOn.add(id));
    (t.subtasks || []).forEach((s) => subtasks.push(s));
    (t.attachments || []).forEach((a) => { if (!attachmentUrls.has(a.url)) { attachments.push(a); attachmentUrls.add(a.url); } });
    if (t.description && t.description.trim()) {
      const dupHtml = toEditableHtml(t.description);
      if (dupHtml && dupHtml !== description) {
        description += `<p>— Combinado desde «${escapeHtml(t.title)}» —</p>${dupHtml}`;
      }
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
