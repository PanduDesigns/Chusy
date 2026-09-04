// ============================================================================
// Notificaciones — de momento, un único disparador: te avisan cuando
// alguien te asigna una tarea (el uso principal pedido: "que no se te
// pase" una tarea nueva). El modelo dej sitio a más tipos en el futuro
// vía el campo `type`, pero solo se crean notificaciones de
// `task_assigned` por ahora.
//
// Colección propia, `notifications/{id}`: userId (para quién es),
// type, taskId, taskTitle (copiado tal cual estaba al crear el aviso,
// no se actualiza si la tarea cambia de nombre después), projectId
// (null si es personal), fromUserId, fromName, read, createdAt.
//
// Sin orderBy() en la consulta a propósito — mismo motivo que en
// tasks.js: combinar where() con orderBy() sobre un campo distinto pide
// un índice compuesto; el orden se hace en el cliente, después de
// recibir los datos, con un único índice de campo simple (automático).
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

export function subscribeToNotifications(uid, callback) {
  const q = query(collection(db, "notifications"), where("userId", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      callback(list);
    },
    (err) => {
      console.error("subscribeToNotifications:", err);
      callback([]); // no dejar el estado de notificaciones colgado si esta consulta en concreto falla
    }
  );
}

/**
 * Crea un aviso de "te han asignado esta tarea" para cada persona nueva
 * en `newAssigneeUids` — nunca para `fromUser.uid` (no hay que avisarte
 * a ti mismo/a de algo que acabas de hacer tú). Se llama SIEMPRE después
 * de guardar la tarea con éxito (task-modal.js, bulk-toolbar.js), nunca
 * antes: si el guardado falla, no debe salir ningún aviso de algo que no
 * ha llegado a pasar de verdad.
 */
export async function notifyNewAssignees({ newAssigneeUids, taskId, taskTitle, projectId, fromUser }) {
  const targets = [...new Set(newAssigneeUids || [])].filter((uid) => uid && uid !== fromUser.uid);
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
