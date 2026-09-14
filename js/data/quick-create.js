// ============================================================================
// Acceso a datos: Creación Rápida.
//
// Un "producto" (quickCreateProducts/{id}) es una plantilla reutilizable
// para montar, de un par de clics, un conjunto de tareas dentro de un
// proyecto — pensada para procesos que se repiten con variantes (p.ej.
// "Cabina de pintura", con un grupo "Tipo de flujo" que añade unas tareas u
// otras según la opción elegida). Cada tarea de la plantilla puede llevar
// opcionalmente unos "días necesarios" (`durationDays`, número o null), que
// quick-create-modal.js usa para calcular su fecha límite al insertar el
// producto de verdad. Ver el apartado 3 del README ("Creación Rápida") para
// el porqué y el apartado 5 para la forma exacta del documento.
//
// Ni los productos ni el ajuste de habilitación (meta/quickCreate) dependen
// de ningún proyecto concreto — son configuración del equipo, como los
// dominios de correo permitidos — así que se leen con getDocs/getDoc
// sueltos en vez de una suscripción en tiempo real: los dos sitios que los
// usan (el panel de administración y el propio selector "Nueva cabina") los
// cargan una vez al abrirse, igual que ya hace getTeamConfig() en users.js.
// La excepción es subscribeToQuickCreateConfig(), más abajo: ESA sí necesita
// tiempo real, porque de ella depende si el botón "Nueva cabina" del topbar
// de un proyecto se puede pulsar o no para todo el mundo, no solo para
// quien tenga el panel de administración abierto en ese momento.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/** Todos los productos configurados, ordenados por nombre. */
export async function getQuickCreateProducts() {
  const snap = await getDocs(collection(db, "quickCreateProducts"));
  const products = [];
  snap.forEach((d) => products.push({ id: d.id, ...d.data() }));
  products.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return products;
}

export async function createQuickCreateProduct(data) {
  const ref = await addDoc(collection(db, "quickCreateProducts"), {
    name: data.name,
    icon: data.icon || "📦",
    color: data.color || "#FCD000",
    baseTasks: data.baseTasks || [],
    groups: data.groups || [],
    createdBy: data.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function updateQuickCreateProduct(productId, data) {
  return updateDoc(doc(db, "quickCreateProducts", productId), { ...data, updatedAt: serverTimestamp() });
}

export function deleteQuickCreateProduct(productId) {
  return deleteDoc(doc(db, "quickCreateProducts", productId));
}

/**
 * Si el botón "Nueva cabina" está abierto a todo el equipo o reservado a
 * administradores — en tiempo real (ver el comentario de cabecera): un
 * admin puede activarlo desde otra pestaña/dispositivo y el topbar de
 * cualquier proyecto abierto en ese momento debe reflejarlo sin recargar.
 * Sin documento todavía (equipo que nunca lo ha tocado): se trata como
 * deshabilitado, el estado de partida más prudente.
 */
export function subscribeToQuickCreateConfig(callback) {
  return onSnapshot(
    doc(db, "meta", "quickCreate"),
    (snap) => callback(snap.exists() ? snap.data() : { enabled: false }),
    (err) => {
      console.error("subscribeToQuickCreateConfig:", err);
      callback({ enabled: false });
    }
  );
}

/** Solo administradores (lo exigen las reglas de Firestore). */
export function setQuickCreateEnabled(enabled) {
  return setDoc(doc(db, "meta", "quickCreate"), { enabled }, { merge: true });
}

/**
 * A partir de un producto y las opciones marcadas en cada uno de sus
 * grupos, calcula la lista final de tareas de la PLANTILLA a crear: las
 * tareas base (siempre) más las de cada opción elegida — cada una tal cual
 * está guardada en el producto, `durationDays` incluido. `selections` tiene
 * la forma `{ [groupId]: Set(optionId) }` — un grupo de selección única
 * (`selectionType: "single"`) nunca llega a tener más de un elemento en su
 * Set (lo garantiza quick-create-modal.js al marcar las opciones), pero se
 * lee igual como Set en los dos casos para no bifurcar esta función por
 * tipo de grupo. Pura (no toca Firestore) y no sabe nada de fechas ni de
 * responsables — eso lo añade quick-create-modal.js por encima, con la
 * "tarea principal" (que no viene de ninguna plantilla) y las fechas
 * calculadas a partir de la fecha de entrega — ver ese archivo.
 */
export function resolveQuickCreateTasks(product, selections) {
  const tasks = [...(product.baseTasks || [])];
  (product.groups || []).forEach((group) => {
    const chosen = selections[group.id];
    if (!chosen || !chosen.size) return;
    (group.options || []).forEach((opt) => {
      if (chosen.has(opt.id)) tasks.push(...(opt.tasks || []));
    });
  });
  return tasks;
}

const BATCH_CHUNK = 450; // por debajo del límite de 500 escrituras/lote de Firestore — mismo criterio que tasks.js

/**
 * Crea una tarea de proyecto por cada entrada de `tasks` — ya resueltas del
 * todo por quick-create-modal.js antes de llamar aquí: título, descripción,
 * `startDate`/`dueDate` (strings "YYYY-MM-DD" o null, igual que guarda el
 * propio modal de tarea) y `assigneeIds` ya calculados a partir de la
 * asignación rápida. Esta función no sabe nada de productos, plantillas ni
 * fechas — solo escribe lo que se le pasa. Todas en `sectionId` dentro de
 * `projectId`, con prioridad "media" igual que cualquier tarea nueva creada
 * a mano. En lotes de como mucho 450 (`writeBatch`, mismo límite que ya
 * respeta tasks.js), con `order` creciente para que salgan en Lista/Tablero
 * en el mismo orden en que venían en `tasks` (la tarea principal primero).
 */
export async function createTasksFromQuickCreateInsertion(tasks, { projectId, sectionId, createdBy }) {
  const baseOrder = Date.now();
  for (let i = 0; i < tasks.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    tasks.slice(i, i + BATCH_CHUNK).forEach((t, j) => {
      const ref = doc(collection(db, "tasks"));
      batch.set(ref, {
        projectId,
        ownerId: null,
        sectionId: sectionId || null,
        extraProjectIds: [],
        extraSections: {},
        title: t.title,
        description: t.description || "",
        assigneeIds: t.assigneeIds || [],
        dueDate: t.dueDate || null,
        startDate: t.startDate || null,
        priority: "media",
        tags: [],
        dependsOn: [],
        subtasks: [],
        attachments: [],
        customFields: {},
        isComplete: false,
        isMilestone: false,
        completedAt: null,
        order: baseOrder + i + j,
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
  return tasks.length;
}
