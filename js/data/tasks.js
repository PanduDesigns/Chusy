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
  deleteField,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { toEditableHtml, escapeHtml, renderTitleHtml, uid, showToast } from "../utils.js";
import { offerCompletionFields, planTaskToOffer } from "../offers.js";
import { getOffersProject } from "./projects.js";
import { allocateProjectCode } from "./project-codes.js";
import { trashTasks } from "./trash.js";
// v81: `withSectionEnteredAt` (pura) anota cuándo entra una tarea en su sección actual, para medir el flujo sin imputar horas.
import { withSectionEnteredAt } from "../flow-metrics.js";
// v73 (Etapa 1 del Store): las tareas de un proyecto se escuchan a través del
// store (js/store.js), que las guarda UNA vez en memoria y no abre dos veces la
// misma escucha — ver subscribeToProjectTasks y getTask más abajo.
import { store } from "../store.js";
// v68 — archivos adjuntos en Google Drive (ver drive-service.js): duplicar una
// tarea COPIA sus archivos en Drive, y combinar duplicadas no se lleva los de
// la tarea que se conserva a la papelera. (Los archivos de las tareas eliminadas
// van a la papelera de Drive al ELIMINAR PARA SIEMPRE, en data/trash.js.)
import { copyAttachmentsForDuplicate } from "../drive-service.js";
import { attachmentKey, isDriveAttachment } from "../drive-files.js";

/**
 * Crea una tarea. v70: si es una OFERTA (pertenece a Ofertas, como proyecto
 * principal o como adicional) nace con su ID (`offerCode`, ver project-codes.js).
 * `data.offerCode` lo trae quien ya lo había pedido antes de guardar (el
 * formulario de una oferta nueva con archivos subidos: van a la carpeta de Drive
 * de ese ID); si no viene, se reparte uno aquí — así toda vía de crear ofertas
 * (formulario, macro de Outlook, duplicar) lo recibe sin hacer nada. Si no se
 * puede repartir, lanza y la oferta NO se crea.
 */
export async function createTask(projectId, data) {
  const offers = getOffersProject();
  const isOffer = !!offers && (projectId === offers.id || (data.extraProjectIds || []).includes(offers.id));
  const offerCode = isOffer ? data.offerCode || (await allocateProjectCode()) : null;
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
    // v57: solo una oferta lo manda (nace con su fila A1 «Versión original»,
    // ver task-modal.js); una tarea normal no gana un `revisions` vacío.
    ...(Array.isArray(data.revisions) ? { revisions: data.revisions } : {}),
    ...(offerCode ? { offerCode } : {}),
    // v75: la carpeta de Drive de la oferta, si ya se creó al subir archivos antes de guardarla. Solo la trae
    // el formulario; duplicar una oferta NO la copia (la copia tiene su propio ID, y su propia carpeta).
    ...(offerCode && data.driveFolderId ? { driveFolderId: data.driveFolderId } : {}),
    isComplete: data.isComplete || false,
    isMilestone: data.isMilestone || false,
    completedAt: null,
    order: data.order ?? Date.now(),
    createdBy: data.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    sectionEnteredAt: serverTimestamp(), // v81: entra en su sección al crearse
  });
  return ref.id;
}

/**
 * Copia una tarea existente (sin comentarios, sin marcar como completada).
 * v68: los archivos de Drive se COPIAN en Drive (la copia y el original no
 * comparten archivo, o quitar el adjunto de una rompería el de la otra); los
 * enlaces pasan tal cual. Si algún archivo no se pudo copiar se avisa.
 */
export async function duplicateTask(task) {
  const { attachments, skipped } = await copyAttachmentsForDuplicate(task.attachments || []);
  const newId = await createTask(task.projectId, {
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
    attachments,
    isMilestone: task.isMilestone,
    createdBy: task.createdBy,
    order: Date.now(),
  });
  if (skipped) showToast(`${skipped === 1 ? "Un archivo no se pudo copiar" : `${skipped} archivos no se pudieron copiar`} a la tarea duplicada.`, "error");
  return newId;
}

export function updateTask(taskId, data, prev) {
  // v81: `prev` (opcional) = la tarea tal como estaba; con él, `sectionEnteredAt` solo se anota si de verdad cambia de sección o proyecto.
  return updateDoc(doc(db, "tasks", taskId), { ...withSectionEnteredAt(data, prev, serverTimestamp()), updatedAt: serverTimestamp() });
}

// Eliminar tareas ya no se hace aquí: desde la v67 va a la papelera (trashTasks
// en data/trash.js), que las guarda 30 días. El borrado directo solo lo hace
// la purga de la propia papelera.

/**
 * Marca/desmarca UNA tarea como completada. Recibe la tarea entera (no solo
 * su id) desde la v58: si es una oferta, completarla la lleva a la sección
 * «Entregadas» de Ofertas (y reabrirla desde ahí la devuelve a «Nuevas» o
 * «Revisiones») en la MISMA escritura que el `isComplete` — ver
 * offerCompletionFields en offers.js para la regla exacta. Una tarea que
 * no es una oferta se escribe igual que siempre.
 */
export function toggleTaskComplete(task, isComplete) {
  return updateDoc(doc(db, "tasks", task.id), {
    isComplete,
    completedAt: isComplete ? serverTimestamp() : null,
    // v81: una oferta que se completa o reabre cambia de sección (Entregadas/Nuevas/Revisiones): se anota la entrada.
    ...withSectionEnteredAt(offerCompletionFields(getOffersProject(), task, isComplete), task, serverTimestamp()),
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
export function moveTask(taskId, sectionId, order, contextProjectId, isExtraProject, prev) {
  // v81: `prev` = la tarea antes de moverla (sin él, se anota siempre); dentro de un proyecto adicional no se anota (se mide la sección del principal).
  const fields = isExtraProject ? { [`extraSections.${contextProjectId}`]: sectionId } : withSectionEnteredAt({ sectionId }, prev, serverTimestamp());
  return updateDoc(doc(db, "tasks", taskId), { ...fields, order, updatedAt: serverTimestamp() });
}

/**
 * Copia de un documento de tarea que se puede modificar sin tocar el original:
 * listas y objetos planos se copian a fondo; lo demás (un Timestamp de
 * Firestore, que es inmutable) se deja tal cual. Mismo criterio que `copy` en
 * undo.js. Hace falta porque el modal de tarea se queda con las listas del
 * documento (subtareas, adjuntos…) y las edita en su borrador: sin copia,
 * cancelar el modal dejaría esos cambios a medias en las listas de la pantalla.
 */
function cloneTaskDoc(value) {
  if (Array.isArray(value)) return value.map(cloneTaskDoc);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneTaskDoc(v);
    return out;
  }
  return value;
}

/**
 * Una tarea por su id — usada al abrir el modal para editar (y la oferta que se
 * va a convertir en proyecto). Primero se busca en el store, que ya tiene al día
 * (por su escucha en tiempo real) las tareas de los proyectos que se han abierto
 * (v73) y las de «Mis tareas» — asignadas a ti o personales tuyas (v74): si está,
 * se devuelve al instante, sin gastar una lectura de Firestore. Solo si NO está
 * (una tarea de un proyecto que aún no se ha cargado, un enlace directo, una
 * archivada) se hace el `getDoc` de siempre. Devuelve `null` si no existe.
 * Siempre es una copia: quien la reciba puede modificarla sin tocar la del store.
 */
export async function getTask(taskId) {
  const cached = store.getById("tasks", taskId);
  if (cached) return cloneTaskDoc(cached);
  const snap = await getDoc(doc(db, "tasks", taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Claves de las dos escuchas (en el store) de las tareas de un proyecto. */
export function projectTasksListenerKeys(projectId) {
  return { primary: `tasks:project:${projectId}:primary`, extra: `tasks:project:${projectId}:extra` };
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
 *
 * v73: las dos escuchas pasan por el store (js/store.js) con una clave por
 * proyecto y consulta (`tasks:project:<id>:primary` / `:extra`):
 *   · si ya hay una escucha abierta con esa clave NO se abre otro `onSnapshot`:
 *     se reutiliza y `callback` recibe al instante lo que ya hay en memoria;
 *   · las instantáneas entran por `docChanges()` (solo se toca el documento que
 *     cambió) y cada tarea existe UNA vez en el store aunque la traigan las dos
 *     consultas, o dos proyectos a la vez;
 *   · `callback(tasks)` recibe el array de ese proyecto (principales + adicionales,
 *     sin duplicados) cuando ya han contestado las dos consultas — o una ha
 *     fallado (índice que falta, permisos…): se enseña lo que trajo la otra
 *     antes que dejar el proyecto sin tareas a la espera de algo que no llegará.
 *     Se vuelve a llamar solo cuando cambia algo de ESTE proyecto.
 * Devuelve la función que cancela: suelta las dos escuchas, y el store las cierra
 * (y olvida sus tareas) cuando nadie más las usa.
 */
export function subscribeToProjectTasks(projectId, callback) {
  const keys = projectTasksListenerKeys(projectId);
  const qPrimary = query(collection(db, "tasks"), where("projectId", "==", projectId));
  const qExtra = query(
    collection(db, "tasks"),
    where("extraProjectIds", "array-contains", projectId),
    where("projectId", "!=", null)
  );
  return subscribeToTaskQueries(
    [{ key: keys.primary, query: qPrimary }, { key: keys.extra, query: qExtra }],
    callback
  );
}

/**
 * Lo que comparten las suscripciones de tareas que combinan varias consultas
 * (las de un proyecto y «Mis tareas»): cada consulta se abre con `store.listen()`
 * y su clave, `callback(tasks)` recibe las tareas de TODAS ellas sin duplicados
 * cuando ya han contestado todas (o alguna ha fallado: se enseña lo que trajeron
 * las otras), y se vuelve a llamar solo cuando cambia algo de estas consultas.
 * Devuelve la función que cancela: suelta las escuchas y el store las cierra
 * (y olvida sus tareas) cuando nadie más las usa.
 */
function subscribeToTaskQueries(specs, callback) {
  const keys = specs.map((spec) => spec.key);
  let released = false;
  let sentOnce = false;
  let handles = null;

  const ready = () => keys.every((k) => store.isLoaded(k));
  const emit = () => {
    if (released || !handles || !ready()) return;
    const byId = new Map();
    handles.forEach((h) => h.docs().forEach((t) => byId.set(t.id, t)));
    sentOnce = true;
    callback([...byId.values()]);
  };

  // Se suscribe al store ANTES de abrir las escuchas: si una llega de inmediato
  // (una simulada, o una ya cargada) no se pierde el aviso.
  const unsubStore = store.subscribe("tasks", (_data, change) => {
    // «sync» (el servidor confirma lo que ya había) no cambia nada que enseñar.
    if (change.type === "sync" || !keys.includes(change.key)) return;
    emit();
  });

  // keepAlive: false → las escuchas se cierran cuando se suelta la última petición
  // (quien llama decide cuánto se quedan abiertas: task-loader.js, o app.js para «Mis tareas»).
  handles = specs.map((spec) =>
    store.listen(spec.key, "tasks", (observer) => onSnapshot(spec.query, observer), { keepAlive: false })
  );

  // Escuchas que ya estaban abiertas y cargadas: no habrá instantánea nueva, se enseña lo que hay.
  if (!sentOnce) emit();

  return () => {
    if (released) return;
    released = true;
    unsubStore();
    handles.forEach((h) => h.release());
  };
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
  const qAssigned = query(collection(db, "tasks"), where("assigneeIds", "array-contains", uid));
  const qOwned = query(collection(db, "tasks"), where("ownerId", "==", uid));
  // v74: por el store, como las tareas de un proyecto (claves `tasks:mine:<uid>:assigned` /
  // `:owned`; la misma colección `tasks` del store, así que una tarea que sea a la vez de un
  // proyecto abierto y tuya existe una sola vez y `getTask` la encuentra por cualquiera de las dos).
  // Si una de las dos consultas falla se enseña lo que trajo la otra, como siempre.
  return subscribeToTaskQueries(
    [
      { key: `tasks:mine:${uid}:assigned`, query: qAssigned },
      { key: `tasks:mine:${uid}:owned`, query: qOwned },
    ],
    callback
  );
}

// ============================================================================
// Ediciones masivas (selección múltiple en la vista de Lista).
//
// El permiso de ACTUALIZAR una tarea de proyecto es abierto a todo el
// equipo (ver firestore.rules), así que estas operaciones pueden ir en
// writeBatch — son atómicas y rápidas. El BORRADO en cambio está
// restringido a quien la creó/es su dueña o a un admin, así que
// trashTasks (data/trash.js, que es lo que usa «Eliminar» desde la v67) NO
// mete todas las tareas en un mismo batch (un solo documento sin permiso
// haría fallar el lote entero): usa un batch POR TAREA con Promise.allSettled
// para poder informar de cuántas se eliminaron de verdad.
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
    return t && t.projectId === projectId ? withSectionEnteredAt({ sectionId }, t, serverTimestamp()) : { [`extraSections.${projectId}`]: sectionId };
  });
}

/**
 * Marca/desmarca como completadas todas las tareas indicadas de una vez.
 * Recibe las tareas enteras (no solo sus ids) desde la v58, por lo mismo
 * que toggleTaskComplete: una oferta completada pasa a «Entregadas» — cada
 * una según su propio estado (una ya convertida en proyecto se queda en
 * «Cerradas»), por eso el campo de sección se calcula tarea a tarea.
 */
export function bulkSetComplete(tasks, isComplete) {
  const offersProject = getOffersProject();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return runBatchedUpdate(tasks.map((t) => t.id), (id) => ({
    isComplete,
    completedAt: isComplete ? serverTimestamp() : null,
    ...withSectionEnteredAt(offerCompletionFields(offersProject, byId.get(id), isComplete), byId.get(id), serverTimestamp()), // v81
  }));
}

/** Añade responsables SIN quitar los que ya tuviera cada tarea ("agregar colaboradores"). */
export function bulkAddAssignees(taskIds, uidsToAdd) {
  return runBatchedUpdate(taskIds, () => ({ assigneeIds: arrayUnion(...uidsToAdd) }));
}

/** Contrario de bulkAddAssignees (para poder deshacer una casilla marcada por error). Nunca hace falta que transfiera el ownerId: solo QUITA, nunca dejaría fuera a quien ya estaba de todos modos si sigue marcado. Para el caso de quitar justo a quien fuera su dueña/o, ver bulkRemoveAssigneeWithOwnerTransfer. */
export function bulkRemoveAssignees(taskIds, uidsToRemove) {
  return runBatchedUpdate(taskIds, () => ({ assigneeIds: arrayRemove(...uidsToRemove) }));
}

/**
 * A quién le "toca" ser dueña/o de una tarea PERSONAL (sin proyecto)
 * después de cambiarle los responsables. Filosofía (ver el historial de
 * la v41): una tarea personal es de quien la lleve en cada momento, no
 * un dato fijo de quién la creó — si se la asignas a otra persona, pasa
 * a ser SU tarea personal (puede editarla, completarla Y borrarla); si
 * se la queda alguien más aparte, no cambia nada.
 *  - Si `currentOwnerId` sigue entre los nuevos responsables: no cambia.
 *  - Si no: pasa a ser de quien encabece la lista nueva.
 *  - Si se queda sin nadie asignado: se queda con quien ya la tuviera,
 *    para no dejarla huérfana (sin nadie que pueda verla ni editarla).
 */
export function nextPersonalOwnerId(currentOwnerId, newAssigneeIds) {
  if (!newAssigneeIds || !newAssigneeIds.length) return currentOwnerId;
  if (currentOwnerId && newAssigneeIds.includes(currentOwnerId)) return currentOwnerId;
  return newAssigneeIds[0];
}

function isPersonalTask(t) {
  return !!t && !t.projectId && !(t.extraProjectIds || []).length;
}

/**
 * Sustituye los responsables de varias tareas por una única persona
 * ("Asignar a…" de la selección múltiple) — recibe las tareas enteras
 * (no solo sus ids) porque, a diferencia de bulkUpdateTasks, aquí el
 * ownerId de cada una depende de su estado actual: si es personal, pasa
 * a serlo también de `uid` (ver nextPersonalOwnerId); si tiene
 * proyecto, no se toca su ownerId — el acceso ya lo da el proyecto.
 */
export function bulkAssignSingle(tasks, uid) {
  return runBatchedUpdate(tasks.map((t) => t.id), (id) => {
    const t = tasks.find((x) => x.id === id);
    const fields = { assigneeIds: [uid] };
    if (isPersonalTask(t)) fields.ownerId = nextPersonalOwnerId(t.ownerId, [uid]);
    return fields;
  });
}

/**
 * Igual que bulkRemoveAssignees, pero para cuando lo que se desmarca en
 * "Agregar colaboradores" pudiera ser justo quien figuraba como dueña/o
 * de alguna tarea personal — en ese caso, transfiere el ownerId a quien
 * le quede asignado (ver nextPersonalOwnerId). Recibe las tareas enteras
 * por el mismo motivo que bulkAssignSingle.
 */
export function bulkRemoveAssigneeWithOwnerTransfer(tasks, uid) {
  return runBatchedUpdate(tasks.map((t) => t.id), (id) => {
    const t = tasks.find((x) => x.id === id);
    const fields = { assigneeIds: arrayRemove(uid) };
    if (isPersonalTask(t) && t.ownerId === uid) {
      const remaining = (t.assigneeIds || []).filter((a) => a !== uid);
      fields.ownerId = nextPersonalOwnerId(uid, remaining);
    }
    return fields;
  });
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
 * «Convertir en oferta» (v64): traslada las tareas indicadas a Ofertas como
 * ofertas nuevas — ver planTaskToOffer en offers.js para lo que se escribe en
 * cada una (sección, versión A1, Sector por defecto, histórico). Las que ya
 * son ofertas se saltan. `defaultSector` es el Sector del departamento de
 * quien convierte (defaultSectorOf en departments.js; "" = ninguno).
 * Devuelve cuántas se convirtieron y cuántas se saltaron.
 */
export async function bulkConvertToOffers(tasks, { defaultSector } = {}) {
  const offersProject = getOffersProject();
  const now = new Date();
  const plans = new Map();
  for (const t of tasks) {
    const fields = planTaskToOffer(offersProject, t, { defaultSector, makeId: uid, now });
    // v70: una tarea que pasa a ser oferta recibe su ID (uno por tarea, en orden)
    if (fields) plans.set(t.id, { ...fields, offerCode: t.offerCode || (await allocateProjectCode({ date: now })) });
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  if (plans.size) await runBatchedUpdate([...plans.keys()], (id) => withSectionEnteredAt(plans.get(id), taskById.get(id), serverTimestamp())); // v81
  return { converted: plans.size, skipped: tasks.length - plans.size };
}

/**
 * «Deshacer» (v67): devuelve a cada tarea los valores que tenía ANTES de una
 * acción (la foto que sacó takeTaskSnapshot, js/undo.js). Un campo que no
 * existía se vuelve a quitar. Cada tarea va por su cuenta: si una ya no existe
 * o ya no se puede editar (p. ej. una personal que acabas de asignar a otra
 * persona), las demás sí se restauran. Devuelve cuántas se restauraron y cuántas no.
 */
export async function restoreTaskSnapshot(snapshot) {
  const results = await Promise.allSettled(
    snapshot.map((entry) => {
      const data = { ...entry.values };
      entry.absent.forEach((field) => { data[field] = deleteField(); });
      return updateDoc(doc(db, "tasks", entry.id), { ...data, updatedAt: serverTimestamp() });
    })
  );
  const restored = results.filter((r) => r.status === "fulfilled").length;
  return { restored, failed: results.length - restored };
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
export async function mergeTasks(survivorId, duplicateIds, { user, projects = [] }) {
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
  // v68: la clave de un adjunto es su URL (enlace) o su archivo de Drive; solo
  // con la URL todos los archivos de Drive (que no tienen `url`) contarían
  // como «el mismo» y se perderían al combinar.
  const attachmentKeys = new Set(attachments.map(attachmentKey));
  let description = toEditableHtml(survivor.description || "");

  dups.forEach((t) => {
    (t.assigneeIds || []).forEach((id) => assigneeIds.add(id));
    (t.tags || []).forEach((tag) => { if (!tagsByLower.has(tag.toLowerCase())) tagsByLower.set(tag.toLowerCase(), tag); });
    (t.dependsOn || []).forEach((id) => dependsOn.add(id));
    (t.subtasks || []).forEach((s) => subtasks.push(s));
    (t.attachments || []).forEach((a) => { const k = attachmentKey(a); if (!attachmentKeys.has(k)) { attachments.push(a); attachmentKeys.add(k); } });
    if (t.description && t.description.trim()) {
      const dupHtml = toEditableHtml(t.description);
      if (dupHtml && dupHtml !== description) {
        description += `<p>— Combinado desde «${renderTitleHtml(t.title)}» —</p>${dupHtml}`;
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

  // v68: los archivos de Drive de las duplicadas ya son de la superviviente. Se
  // les quitan a las duplicadas ANTES de mandarlas a la papelera: si no, al
  // eliminarlas para siempre se mandarían a la papelera de Drive archivos que
  // la superviviente sigue usando. (Restaurar una duplicada la devuelve sin
  // sus archivos de Drive; los enlaces sí se los lleva.)
  const dupsToTrash = [];
  for (const t of dups) {
    const attachmentsOfDup = t.attachments || [];
    const linksOnly = attachmentsOfDup.filter((a) => !isDriveAttachment(a));
    if (linksOnly.length !== attachmentsOfDup.length) {
      try { await updateTask(t.id, { attachments: linksOnly }); } catch (e) { /* si no se puede editar, tampoco se podrá eliminar: se avisa abajo */ }
    }
    dupsToTrash.push({ ...t, attachments: linksOnly });
  }

  // Las duplicadas no se borran: van a la papelera (v67), por si la combinación
  // fue un error. (Sus comentarios ya se han trasladado a la superviviente.)
  const { trashed, failedIds } = await trashTasks(dupsToTrash, { user, projects });
  if (failedIds.length) throw new Error(`No se pudieron eliminar ${failedIds.length} de las tareas combinadas.`);

  return { mergedCount: dups.length, skippedComments, trashIds: trashed.map((t) => t.trashId) };
}
