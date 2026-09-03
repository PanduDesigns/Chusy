// ============================================================================
// Acceso a datos: perfil de usuario (colección `users`) y configuración del
// equipo (`meta/config`). El registro y las operaciones de Firebase Auth en
// sí (contraseña, nombre visible del propio Auth) viven en auth.js; aquí
// solo se toca el documento de Firestore.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/** Actualiza campos del perfil en Firestore (users/{uid}), p.ej. el nombre. */
export function updateUserProfile(uid, data) {
  return updateDoc(doc(db, "users", uid), data);
}

/** Solo administradores (lo exigen las reglas de Firestore): cambia el rol de alguien. */
export function updateUserRole(uid, role) {
  return updateDoc(doc(db, "users", uid), { role });
}

/** Configuración del equipo: por ahora, los dominios de correo permitidos al registrarse. */
export async function getTeamConfig() {
  const snap = await getDoc(doc(db, "meta", "config"));
  return snap.exists() ? snap.data() : {};
}

/** Solo administradores (lo exigen las reglas de Firestore). */
export function updateTeamConfig(data) {
  return setDoc(doc(db, "meta", "config"), data, { merge: true });
}

/**
 * Preferencias de columnas de una tabla (ancho / ocultas), por persona y
 * por "ámbito" (un proyecto concreto o "mytasks"). Viven en el propio
 * perfil (`users/{uid}.columnPrefs.<scopeKey>`), así que cada quien tiene
 * las suyas sin tocar las de nadie más. Se escriben con rutas de campo en
 * punto para no tener que leer-y-fusionar antes de guardar.
 */
export function setColumnWidth(uid, scopeKey, colKey, widthPx) {
  return updateDoc(doc(db, "users", uid), {
    [`columnPrefs.${scopeKey}.widths.${colKey}`]: widthPx,
  });
}

export function setColumnHidden(uid, scopeKey, colKey, hidden) {
  return updateDoc(doc(db, "users", uid), {
    [`columnPrefs.${scopeKey}.hidden`]: hidden ? arrayUnion(colKey) : arrayRemove(colKey),
  });
}

/**
 * Orden de columnas de las tablas de tareas (Lista de proyecto y Mis
 * tareas) — a diferencia del ancho y de qué columnas están ocultas (que
 * son por "ámbito": un proyecto concreto o "mytasks", ver arriba), el
 * ORDEN es una preferencia única y GLOBAL de cada persona: reordenar
 * columnas en cualquier sitio las reordena en todos. Vive suelto en el
 * perfil (`users/{uid}.columnOrder`, fuera de `columnPrefs`) como un
 * array con las claves de columna en el orden elegido — ver
 * `applyColumnOrder()` en `components/table-columns.js` para cómo se
 * interpreta (una clave ausente aquí se coloca al final).
 */
export function setColumnOrder(uid, order) {
  return updateDoc(doc(db, "users", uid), { columnOrder: order });
}

/**
 * Orden de una tabla de tareas (columna + dirección) — mismo bucket que el
 * ancho y las columnas ocultas de esa tabla (`columnPrefs.<scopeKey>`, ver
 * arriba), así que cada persona recupera el orden que dejó la última vez
 * que pulsó una columna en Mis tareas o en un proyecto, sin tener que
 * volver a aplicarlo cada vez que entra.
 */
export function setSortPref(uid, scopeKey, sort) {
  return updateDoc(doc(db, "users", uid), {
    [`columnPrefs.${scopeKey}.sort`]: sort,
  });
}

/**
 * Elimina (o reactiva) una cuenta desde el panel de administración: no
 * borra su documento ni su cuenta de Firebase Auth (borrar la cuenta de
 * Auth de otra persona exige el SDK de administración, con un backend que
 * este proyecto no tiene — ver el apartado 6 del README), marca `deleted`.
 * Mientras esté a `true`, `firestore.rules` (función `isActiveUser()`) le
 * corta el acceso a todo salvo su propio documento (que tampoco puede
 * tocar ni para dejarlo igual) y, en cuanto lo note, la propia app le
 * cierra la sesión (ver `onAuthChange` en auth.js) — de inmediato si tenía
 * una sesión abierta en ese momento. El documento se conserva a propósito:
 * sus tareas y comentarios pasados se siguen viendo con normalidad (con
 * «· Eliminado» en los selectores de responsable, igual que ya pasa con
 * las cuentas ficticias del importador de Asana), y "Reactivar" (guardar
 * `deleted: false`) es instantáneo si se elimina a quien no tocaba por
 * error — no hace falta recrear nada de verdad.
 */
export function setUserDeleted(uid, deleted) {
  return updateDoc(doc(db, "users", uid), { deleted });
}
