// ============================================================================
// Acceso a «Visualizador de piezas» por departamento (v90): el documento de Firestore. Calca data/orders-access.js.
//
//   meta/partsViewerAccess  { allowedDepartments: ['diseno', …], updatedBy, updatedAt }
//
// UN documento, no un campo de un proyecto: el visualizador no es un proyecto sino una vista transversal. Lectura para
// cualquier cuenta activa (la barra lateral de cada persona necesita saber si pinta el botón) y escritura solo para
// administradores — ver firestore.rules (que hay que republicar). La lógica (valor por defecto, quién entra) es pura y vive
// en departments.js (normalizePartsViewerAllowed, canViewPartsViewer).
//
// Entra por js/store.js (rebanada `partsViewerAccess`, clave `partsViewerAccess:doc`) a través de
// data/store-subscriptions.js: una sola escucha para toda la sesión.
// ============================================================================
import { db } from "../firebase-init.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { subscribeToStoreDoc } from "./store-subscriptions.js";
import { normalizePartsViewerAllowed } from "../departments.js";

const ref = () => doc(db, "meta", "partsViewerAccess");

/**
 * Escucha el permiso en tiempo real: `callback(allowedGroups)` con la lista ya normalizada (sin documento todavía → el
 * valor por defecto). Si la lectura falla (reglas sin republicar), el callback no se llama y la app sigue con el valor
 * por defecto. Devuelve la función que cancela.
 */
export function subscribeToPartsViewerAccess(callback) {
  return subscribeToStoreDoc({
    key: "partsViewerAccess:doc",
    slice: "partsViewerAccess",
    attach: (observer) => onSnapshot(ref(), observer),
    callback: (d) => callback(normalizePartsViewerAllowed(d)),
  });
}

/** Guarda qué grupos ven «Visualizador de piezas» (solo un admin; lo exigen las reglas). Lanza si Firestore lo rechaza. */
export function setPartsViewerAccess(allowedDepartments, uid) {
  const clean = normalizePartsViewerAllowed({ allowedDepartments });
  return setDoc(ref(), { allowedDepartments: clean, updatedBy: uid || null, updatedAt: serverTimestamp() });
}
