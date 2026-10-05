// ============================================================================
// Buzón de ofertas de Outlook (v61): todo el acceso a Firestore del puente
// entre la macro de Outlook y Chusy. La lógica de qué oferta se crea vive en
// outlook-offer.js (pura) y el orden de los pasos en outlook-listener.js.
//
//   offerInbox/{id}     la petición que deja la macro SIN iniciar sesión
//                       (REST); la atiende la pestaña de Chusy abierta de
//                       su destinatario y se borra al terminar
//   meta/outlookBridge  { key } — la clave compartida con la macro; solo un
//                       administrador la ve (reglas de Firestore)
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  runTransaction,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const INBOX = "offerInbox";
const BRIDGE_DOC = ["meta", "outlookBridge"];

/**
 * Escucha las peticiones dirigidas a este correo. `callback` recibe
 * `{ isFirst, all, added }`: en la PRIMERA llamada `all` trae lo que ya
 * esperaba cuando se abrió la sesión (restos de macros anteriores: no se
 * atienden, la oferta debía crearse con Chusy abierto) y `added` va vacío; en
 * las siguientes, `added` trae solo las peticiones que acaban de llegar.
 * Devuelve la función para dejar de escuchar.
 */
export function subscribeToOutlookRequests(email, callback, onError) {
  const q = query(collection(db, INBOX), where("targetEmail", "==", String(email || "").trim().toLowerCase()));
  let isFirst = true;
  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const added = isFirst
        ? []
        : snap
            .docChanges()
            .filter((change) => change.type === "added")
            .map((change) => ({ id: change.doc.id, ...change.doc.data() }));
      const first = isFirst;
      isFirst = false;
      callback({ isFirst: first, all, added });
    },
    (err) => {
      console.error("subscribeToOutlookRequests:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * Se queda con la petición: pasa de «pending» a «processing» dentro de una
 * transacción, así que si Chusy está abierto en dos pestañas solo UNA crea la
 * oferta (la otra recibe `false`). Cualquier fallo también devuelve `false`.
 */
export async function claimOutlookRequest(id, sessionId) {
  const ref = doc(db, INBOX, id);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status !== "pending") return false;
      tx.update(ref, { status: "processing", claimedBy: sessionId });
      return true;
    });
  } catch (err) {
    console.error("claimOutlookRequest:", err);
    return false;
  }
}

/** Apunta el resultado en la petición (la macro lo está leyendo). Si ya no existe, no pasa nada. */
export async function finishOutlookRequest(id, fields) {
  try {
    await updateDoc(doc(db, INBOX, id), fields);
    return true;
  } catch (err) {
    console.error("finishOutlookRequest:", err);
    return false;
  }
}

/** Borra la petición (lleva el texto del correo: no debe quedarse ahí). */
export async function deleteOutlookRequest(id) {
  try {
    await deleteDoc(doc(db, INBOX, id));
  } catch (err) {
    console.error("deleteOutlookRequest:", err);
  }
}

/** Los títulos de las ofertas que ya existen (para no repetir nombre). */
export async function fetchOfferTitles(offersProjectId) {
  const snap = await getDocs(query(collection(db, "tasks"), where("projectId", "==", offersProjectId)));
  return snap.docs.map((d) => d.data().title || "");
}

// ---- Clave compartida con la macro (solo administradores) ----

/** La clave actual, o "" si todavía no hay (el puente está apagado). */
export async function getOutlookKey() {
  const snap = await getDoc(doc(db, ...BRIDGE_DOC));
  return snap.exists() ? String(snap.data().key || "") : "";
}

export async function setOutlookKey(key, uidOfAdmin) {
  await setDoc(doc(db, ...BRIDGE_DOC), { key, updatedBy: uidOfAdmin, updatedAt: serverTimestamp() });
}

/** Apaga el puente: sin esta clave las reglas rechazan cualquier petición nueva de la macro. */
export async function removeOutlookKey() {
  await deleteDoc(doc(db, ...BRIDGE_DOC));
}
