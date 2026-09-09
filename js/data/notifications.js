// ============================================================================
// Notificaciones — de momento, un único disparador: te avisan cuando
// alguien te asigna una tarea (el uso principal pedido: "que no se te
// pase" una tarea nueva). El modelo deja sitio a más tipos en el futuro
// vía el campo `type`, pero solo se crean notificaciones de
// `task_assigned` por ahora.
//
// Colección propia, `notifications/{id}`: userId (para quién es), type,
// taskId, taskTitle (copiado tal cual estaba al crear el aviso, no se
// actualiza si la tarea cambia de nombre después), projectId y
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
      type: "task_assigned",
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

export function markNotificationRead(id) {
  return updateDoc(doc(db, "notifications", id), { read: true });
}

export function markAllNotificationsRead(notifications) {
  const unread = notifications.filter((n) => !n.read);
  if (!unread.length) return Promise.resolve();
  const batch = writeBatch(db);
  unread.forEach((n) => batch.update(doc(db, "notifications", n.id), { read: true }));
  return batch.commit();
}
