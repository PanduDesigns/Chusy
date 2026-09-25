// ============================================================================
// Notificaciones — de momento, un único disparador: te avisan cuando
// alguien te asigna una tarea (el uso principal pedido: "que no se te
// pase" una tarea nueva). El modelo deja sitio a más tipos en el futuro
// vía el campo `type`. Hoy hay dos, los dos del mismo disparador:
//   - `task_assigned`: una tarea concreta (desde el modal de tarea, o
//     desde las acciones de asignar de la selección múltiple). Lleva el
//     `taskId` que se abre al pulsarla.
//   - `tasks_assigned_bulk` (v52): "Nueva cabina" asignó VARIAS tareas de
//     golpe a la misma persona — un único aviso resumen (con `count`) en
//     vez de uno por tarea, que en una cabina de 20-30 tareas se comería
//     el límite de 20 avisos por persona (ver LÍMITE más abajo) y, de
//     paso, borraría los anteriores que siguieran sin leer. Al pulsarlo
//     se abre el PROYECTO, no una tarea suelta. Si a una persona le toca
//     una sola tarea de esa cabina, se le manda un `task_assigned`
//     normal, como si la hubieran asignado a mano.
//
// Colección propia, `notifications/{id}`: userId (para quién es), type,
// taskId, taskTitle (copiado tal cual estaba al crear el aviso, no se
// actualiza si la tarea cambia de nombre después — en un
// `tasks_assigned_bulk`, la primera tarea asignada, solo como respaldo),
// count (solo en `tasks_assigned_bulk`: cuántas tareas), projectId y
// projectName (ambos null si es una tarea personal — projectName
// también copiado tal cual al crear el aviso, mismo motivo que
// taskTitle), fromUserId, fromName, read, createdAt.
//
// Los usuarios ficticios del importador de Asana (isImported, ver
// asana-import.js) nunca reciben notificaciones — no hay nadie al otro
// lado que las vaya a leer.
//
// Sin orderBy() en la consulta a propósito — mismo motivo que en
// tasks.js: combinar where() con orderBy() sobre un campo distinto pide
// un índice compuesto; el orden se hace en el cliente, después de
// recibir los datos, con un único índice de campo simple (automático).
//
// LÍMITE (NOTIF_VISIBLE_LIMIT, 20 — también lo usa notification-bell.js
// para saber cuántas pintar): cada vez que a alguien le llega una
// actualización en vivo de sus notificaciones (subscribeToNotifications
// — es decir, cada vez que recibe una nueva, o que cambia alguna suya),
// se comprueba solo su propia lista, ya en memoria, sin ninguna lectura
// aparte:
//   1. Si tiene más de 20 SIN LEER, las más antiguas de ese exceso se
//      marcan leídas — el panel solo pinta las 20 más recientes en
//      total (leídas o no), así que una sin leer más allá de esas 20
//      nunca se va a poder abrir a mano para marcarla; se marca ella
//      sola para no quedarse acumulada para siempre.
//   2. Si en total tiene más de 20 (contando ya el punto 1), se borran
//      las LEÍDAS más antiguas hasta dejar como mucho 20 — nunca una
//      que siga sin leer.
// Esto SOLO puede ejecutarlo el propio dueño de esas notificaciones: la
// regla de Firestore exige que quien borra/actualiza sea
// `resource.data.userId == request.auth.uid`. Por eso vive aquí, en la
// suscripción de quien RECIBE, y no en notifyNewAssignees (eso lo
// ejecuta quien ASIGNA la tarea, con su propia sesión — no tiene permiso
// para tocar las notificaciones de otra persona).
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const NOTIF_VISIBLE_LIMIT = 20;
export const NOTIF_TYPE_ASSIGNED = "task_assigned";
export const NOTIF_TYPE_ASSIGNED_BULK = "tasks_assigned_bulk";

/** Cuántas tareas representa un aviso: una (`task_assigned`) o las `count` de un resumen de "Nueva cabina" (`tasks_assigned_bulk`). */
export function notificationTaskCount(n) {
  return n && n.type === NOTIF_TYPE_ASSIGNED_BULK ? Math.max(1, Number(n.count) || 1) : 1;
}

/**
 * `onNewNotifications`, si se pasa, se llama SOLO con notificaciones que
 * llegan de verdad mientras la sesión ya está abierta — nunca con las
 * que ya existieran al arrancar la suscripción (el primer snapshot de
 * Firestore siempre trae TODO el resultado actual marcado como "added",
 * así que hace falta descartar explícitamente esa primera vuelta, o
 * cualquiera que abriera la app con notificaciones pendientes vería un
 * aviso emergente por cada una de golpe). Pensado para el aviso
 * "llamativo" de notification-bell.js — el puntito de la campana, en
 * cambio, sí debe reflejar también las que ya hubiera de antes, por eso
 * `callback` (la lista completa) no tiene este filtro.
 */
export function subscribeToNotifications(uid, callback, onNewNotifications) {
  const q = query(collection(db, "notifications"), where("userId", "==", uid));
  let isFirstSnapshot = true;
  return onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      callback(list);
      if (!isFirstSnapshot && onNewNotifications) {
        const added = snap.docChanges()
          .filter((c) => c.type === "added")
          .map((c) => ({ id: c.doc.id, ...c.doc.data() }));
        if (added.length) onNewNotifications(added);
      }
      isFirstSnapshot = false;
      enforceNotificationLimits(list).catch((err) => console.error("enforceNotificationLimits:", err));
    },
    (err) => {
      console.error("subscribeToNotifications:", err);
      callback([]); // no dejar el estado de notificaciones colgado si esta consulta en concreto falla
    }
  );
}

/** Ver el bloque de comentarios de arriba (LÍMITE) — `list` ya viene ordenada de más nueva a más vieja. */
async function enforceNotificationLimits(list) {
  if (list.length <= NOTIF_VISIBLE_LIMIT) return;

  const batch = writeBatch(db);
  let touched = false;

  const unread = list.filter((n) => !n.read);
  const autoRead = new Set();
  if (unread.length > NOTIF_VISIBLE_LIMIT) {
    unread.slice(NOTIF_VISIBLE_LIMIT).forEach((n) => {
      batch.update(doc(db, "notifications", n.id), { read: true });
      autoRead.add(n.id);
      touched = true;
    });
  }

  const excess = list.length - NOTIF_VISIBLE_LIMIT;
  if (excess > 0) {
    const readOldestFirst = list
      .filter((n) => n.read || autoRead.has(n.id))
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    readOldestFirst.slice(0, excess).forEach((n) => {
      batch.delete(doc(db, "notifications", n.id));
      touched = true;
    });
  }

  if (touched) await batch.commit();
}

/**
 * Crea un aviso de "te han asignado esta tarea" para cada persona nueva
 * en `newAssigneeUids` — nunca para `fromUser.uid` (no hay que avisarte
 * a ti mismo/a de algo que acabas de hacer tú) ni para nadie marcado
 * como `isImported` en `teamMembers` (un usuario ficticio del
 * importador de Asana no tiene a nadie detrás que pueda leer nada). Se
 * llama SIEMPRE después de guardar la tarea con éxito (task-modal.js,
 * bulk-toolbar.js), nunca antes: si el guardado falla, no debe salir
 * ningún aviso de algo que no ha llegado a pasar de verdad.
 */
export async function notifyNewAssignees({ newAssigneeUids, taskId, taskTitle, projectId, projectName, fromUser, teamMembers }) {
  const importedUids = new Set((teamMembers || []).filter((m) => m.isImported).map((m) => m.uid));
  const targets = [...new Set(newAssigneeUids || [])].filter((uid) => uid && uid !== fromUser.uid && !importedUids.has(uid));
  if (!targets.length) return;
  const batch = writeBatch(db);
  targets.forEach((uid) => {
    const ref = doc(collection(db, "notifications"));
    batch.set(ref, {
      userId: uid,
      type: NOTIF_TYPE_ASSIGNED,
      taskId,
      taskTitle,
      projectId: projectId || null,
      projectName: projectName || null,
      fromUserId: fromUser.uid,
      fromName: fromUser.name,
      read: false,
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

/**
 * Aviso de "Nueva cabina" (v52): a partir de las tareas que se acaban de
 * crear (`createdTasks`, cada una `{id, title, assigneeIds}` — lo que
 * devuelve createTasksFromQuickCreateInsertion), manda UN aviso por
 * persona asignada, no uno por tarea:
 *  - a quien le tocó una sola tarea, un `task_assigned` normal (se abre
 *    esa tarea, igual que si se la hubieran asignado a mano);
 *  - a quien le tocaron varias, un `tasks_assigned_bulk` con el total
 *    (`count`) — se abre el proyecto. Ver la cabecera de este archivo
 *    para el porqué de no mandar uno por tarea.
 * Mismas exclusiones que notifyNewAssignees: nunca a `fromUser` (quien
 * crea la cabina no necesita un aviso de lo que acaba de hacer) ni a un
 * usuario ficticio del importador de Asana. Se llama SIEMPRE después de
 * crear las tareas con éxito, nunca antes. Como mucho una notificación
 * por persona del equipo, así que va en un único lote. Devuelve a
 * cuántas personas se avisó.
 */
export async function notifyBulkAssignment({ createdTasks, projectId, projectName, fromUser, teamMembers }) {
  const importedUids = new Set((teamMembers || []).filter((m) => m.isImported).map((m) => m.uid));
  const tasksByUid = new Map();
  (createdTasks || []).forEach((t) => {
    new Set(t.assigneeIds || []).forEach((uid) => {
      if (!uid || uid === fromUser.uid || importedUids.has(uid)) return;
      if (!tasksByUid.has(uid)) tasksByUid.set(uid, []);
      tasksByUid.get(uid).push(t);
    });
  });
  if (!tasksByUid.size) return 0;

  const batch = writeBatch(db);
  tasksByUid.forEach((tasks, uid) => {
    const first = tasks[0];
    const base = {
      userId: uid,
      taskId: first.id,
      taskTitle: first.title,
      projectId: projectId || null,
      projectName: projectName || null,
      fromUserId: fromUser.uid,
      fromName: fromUser.name,
      read: false,
      createdAt: serverTimestamp(),
    };
    batch.set(
      doc(collection(db, "notifications")),
      tasks.length === 1
        ? { ...base, type: NOTIF_TYPE_ASSIGNED }
        : { ...base, type: NOTIF_TYPE_ASSIGNED_BULK, count: tasks.length }
    );
  });
  await batch.commit();
  return tasksByUid.size;
}

export function markNotificationRead(id) {
  return updateDoc(doc(db, "notifications", id), { read: true });
}

/**
 * Marca como leídas todas las de `notifications` que sigan sin leer. Una
 * escritura por aviso (como mucho NOTIF_VISIBLE_LIMIT, 20) y no un lote, a
 * propósito: el panel llama a esto al CERRARSE con la lista que tenía
 * abierta, y en ese rato alguna pudo desaparecer por la autolimpieza (ver
 * LÍMITE arriba) — un `update` sobre un documento borrado falla, y en un
 * lote esa sola escritura tumbaría las demás, dejando el puntito de la
 * campana encendido sin motivo. Así, las que ya no existen se ignoran y
 * el resto se marcan igualmente.
 */
export async function markAllNotificationsRead(notifications) {
  const unread = (notifications || []).filter((n) => !n.read);
  if (!unread.length) return;
  const results = await Promise.allSettled(unread.map((n) => markNotificationRead(n.id)));
  results.forEach((r) => {
    if (r.status === "rejected") console.warn("markAllNotificationsRead:", r.reason);
  });
}
