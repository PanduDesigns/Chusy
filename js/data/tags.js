// ============================================================================
// Registro compartido de etiquetas: nombre + color, uno por equipo (no por
// tarea). Así "Urgente" es siempre del mismo color la use quien la use, y
// si alguien le cambia el color más adelante, cambia en todas las tareas
// que la llevan.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { subscribeToStoreList } from "./store-subscriptions.js";

export const TAG_COLOR_PALETTE = [
  "#B892FF", // violeta
  "#3DDC97", // verde
  "#8B959C", // gris
  "#E8963C", // naranja
  "#5B9BD5", // azul
  "#FF6B8B", // rosa/rojo
  "#4EC9C9", // turquesa
  "#FCD000", // dorado (acento de marca)
  "#7C86D9", // índigo
  "#C4703E", // óxido/marrón
];

/** slug seguro para usarlo como id de documento / clave de mapa. */
export function slugifyTag(name) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Crea la etiqueta si no existe, o le actualiza el color si ya existía. */
export function upsertTag({ name, color }) {
  const slug = slugifyTag(name);
  if (!slug) return Promise.resolve();
  return setDoc(
    doc(db, "tags", slug),
    { name: name.trim(), color, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Todas las etiquetas del registro. v74: por el store, clave `tags:all` (ver store-subscriptions.js). */
export function subscribeToAllTags(callback) {
  return subscribeToStoreList({
    key: "tags:all",
    slice: "tags",
    attach: (observer) => onSnapshot(collection(db, "tags"), observer),
    sort: (a, b) => (a.name || "").localeCompare(b.name || ""),
    callback,
  });
}
