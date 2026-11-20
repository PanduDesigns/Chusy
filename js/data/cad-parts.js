// ============================================================================
// Subidas directas del «Visualizador de piezas» (v93): colección `cadParts/{id}` (ver js/parts-library.js para el formato).
// La suscripción solo se abre cuando alguien entra al Visualizador (app.js): no cuesta lecturas a quien nunca lo usa.
// ============================================================================
import { db } from "../firebase-init.js";
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { buildLibraryEntryData, mergeLibraryAttachments } from "../parts-library.js";

/** Escucha todas las subidas; `callback(entries)` con `[{ id, …doc }]`. Devuelve la función para dejar de escuchar. */
export function subscribeToCadParts(callback, onError) {
  return onSnapshot(
    collection(db, "cadParts"),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("cadParts:", err); if (onError) onError(err); callback([]); }
  );
}

/** Guarda una subida nueva. Devuelve su id. */
export async function createCadPart({ attachments, title, projectId, sector, user }) {
  const data = buildLibraryEntryData({ attachments, title, projectId, sector, user });
  if (!data.attachments.length) throw new Error("No hay ningún archivo CAD que guardar.");
  const ref = await addDoc(collection(db, "cadParts"), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

/** Añade archivos a una subida que ya existe (p. ej. el .STEP que faltaba), sin repetir. */
export async function addAttachmentsToCadPart(entry, attachments) {
  const merged = mergeLibraryAttachments(entry.attachments, attachments);
  await updateDoc(doc(db, "cadParts", entry.id), { attachments: merged, updatedAt: serverTimestamp() });
  return merged;
}

export async function deleteCadPart(id) {
  await deleteDoc(doc(db, "cadParts", id));
}
