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
