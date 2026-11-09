// ============================================================================
// Acceso a «Pedidos» por departamento (v86): el documento de Firestore.
//
//   meta/ordersAccess  { allowedDepartments: ['tecnicos', …], updatedBy, updatedAt }
//
// UN documento (como meta/workCalendar), no un campo de un proyecto: «Pedidos» no es un proyecto sino una vista
// transversal. Lectura para cualquier cuenta activa (la barra lateral de cada persona necesita saber si pinta el
// botón) y escritura solo para administradores — ver firestore.rules. La lógica (valor por defecto, quién entra) es
// pura y vive en departments.js (normalizeOrdersAllowed, canViewOrders).
//
// Entra por js/store.js (rebanada `ordersAccess`, clave `ordersAccess:doc`) a través de data/store-subscriptions.js:
// una sola escucha para toda la sesión.
// ============================================================================
import { db } from "../firebase-init.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { subscribeToStoreDoc } from "./store-subscriptions.js";
import { normalizeOrdersAllowed } from "../departments.js";

const ref = () => doc(db, "meta", "ordersAccess");

/**
 * Escucha el permiso en tiempo real: `callback(allowedGroups)` con la lista ya normalizada (sin documento todavía →
 * el valor por defecto). Si la lectura falla (reglas sin republicar), el callback no se llama y la app sigue con el
 * valor por defecto. Devuelve la función que cancela.
 */
export function subscribeToOrdersAccess(callback) {
  return subscribeToStoreDoc({
    key: "ordersAccess:doc",
    slice: "ordersAccess",
    attach: (observer) => onSnapshot(ref(), observer),
    callback: (d) => callback(normalizeOrdersAllowed(d)),
  });
}

/** Guarda qué grupos ven «Pedidos» (solo un admin; lo exigen las reglas). Lanza si Firestore lo rechaza. */
export function setOrdersAccess(allowedDepartments, uid) {
  const clean = normalizeOrdersAllowed({ allowedDepartments });
  return setDoc(ref(), { allowedDepartments: clean, updatedBy: uid || null, updatedAt: serverTimestamp() });
}
