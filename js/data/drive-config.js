// ============================================================================
// Archivos en Google Drive (v68): el ajuste del equipo en Firestore.
//
//   meta/driveStorage  { enabled, gatewayUrl, maxFileMB, updatedBy, updatedAt }
//     enabled     ¿se pueden subir archivos a las tareas?
//     gatewayUrl  la «URL de la aplicación web» del puente de Apps Script (acaba en /exec)
//     maxFileMB   tamaño máximo por archivo
//
// Lectura para cualquier cuenta activa (cada navegador necesita saber a qué
// puente llamar) y escritura solo para administradores — ver firestore.rules.
// La dirección del puente NO es un secreto: el puente solo da permiso a quien
// presente una sesión activa de Chusy (ver assets/drive/ChusyDrive.gs).
// ============================================================================
import { db } from "../firebase-init.js";
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { normalizeDriveConfig } from "../drive-files.js";

/**
 * Escucha el ajuste en tiempo real (un administrador puede activarlo desde otro
 * dispositivo y se nota sin recargar). Sin documento todavía → apagado.
 * `callback` recibe siempre la configuración ya normalizada.
 */
export function subscribeToDriveConfig(callback) {
  return onSnapshot(
    doc(db, "meta", "driveStorage"),
    (snap) => callback(normalizeDriveConfig(snap.exists() ? snap.data() : null)),
    (err) => {
      console.error("subscribeToDriveConfig:", err);
      callback(normalizeDriveConfig(null));
    }
  );
}

/** Solo administradores (lo exigen las reglas de Firestore). */
export function saveDriveConfig({ enabled, gatewayUrl, maxFileMB }, uid) {
  const clean = normalizeDriveConfig({ enabled, gatewayUrl, maxFileMB });
  return setDoc(
    doc(db, "meta", "driveStorage"),
    { enabled: clean.enabled, gatewayUrl: clean.gatewayUrl, maxFileMB: clean.maxFileMB, updatedBy: uid || null, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
