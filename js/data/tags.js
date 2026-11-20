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
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { subscribeToStoreList } from "./store-subscriptions.js";
import { store } from "../store.js";

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

// ============================================================================
// v93 · Higiene de etiquetas: contar usos, borrar las huérfanas solas, y corregir / fusionar / borrar una etiqueta EN
// CASCADA en todas las tareas donde está.
//
// Cómo se guarda una etiqueta (importante para todo lo de abajo): `tasks/{id}.tags` es una lista de NOMBRES («Urgente»), no
// de ids, y el documento `tags/{id}` tiene por id el slug de su nombre (slugifyTag). Dos etiquetas son «la misma» si tienen el
// mismo slug (sin mayúsculas, tildes ni signos), y renombrar una cambia su slug — por eso renombrar = crear el documento con el
// slug nuevo + reescribir las tareas + borrar el viejo (si solo se cambiara el `name` del documento viejo, la próxima vez que
// alguien escribiera el nombre antiguo, `upsertTag` recrearía la etiqueta que se acaba de corregir).
//
// Alcance: las tareas que este navegador conoce (las de los proyectos activos cargados + las suyas personales). Las de
// proyectos archivados y las tareas personales de otras personas no se pueden leer desde aquí (firestore.rules) y conservan el
// texto antiguo — se ve con el color gris de «etiqueta sin registro», no se rompe nada. El borrado automático solo actúa
// cuando se sabe que están cargadas TODAS las tareas de los proyectos activos (registerTagTasksProvider).
// ============================================================================

const BATCH_CHUNK = 450;
const NEW_TAG_GRACE_MS = 2 * 60 * 1000;

const cleanTagName = (name) => String(name ?? "").replace(/\s+/g, " ").trim();

/** El slug que identifica una etiqueta (el de un nombre o el de un id ya sluggeado). */
export function tagKey(nameOrId) {
  return slugifyTag(String(nameOrId ?? ""));
}

/** ¿Es la entrada `entry` de `task.tags` la etiqueta `tagId`? (por slug: «urgente» = «Urgente» = «URGENTE») */
export function tagEntryMatches(entry, tagId) {
  const k = tagKey(entry);
  return !!k && k === tagKey(tagId);
}

const liveTask = (t) => !!t && !t.deleted && !t.trashed && !t.deletedAt;

/** En cuántas tareas (sin repetir y sin las eliminadas) está asignada la etiqueta `tagId`. */
export function countTagUsageAcrossTasks(tagId, tasks) {
  const seen = new Set();
  let n = 0;
  for (const t of tasks || []) {
    if (!liveTask(t) || (t.id && seen.has(t.id))) continue;
    if (t.id) seen.add(t.id);
    if (Array.isArray(t.tags) && t.tags.some((e) => tagEntryMatches(e, tagId))) n++;
  }
  return n;
}

/** `{ [tagId]: usos }` de todas las etiquetas del registro, recorriendo las tareas UNA vez. */
export function countTagUsageMap(tags, tasks) {
  const counts = {};
  (tags || []).forEach((t) => { counts[t.id] = 0; });
  const byKey = new Map((tags || []).map((t) => [tagKey(t.id), t.id]));
  const seen = new Set();
  for (const t of tasks || []) {
    if (!liveTask(t) || (t.id && seen.has(t.id))) continue;
    if (t.id) seen.add(t.id);
    const ids = new Set((Array.isArray(t.tags) ? t.tags : []).map((e) => byKey.get(tagKey(e))).filter(Boolean));
    ids.forEach((id) => { counts[id]++; });
  }
  return counts;
}

/** Las etiquetas del registro que no está asignada a ninguna de esas tareas. */
export function findOrphanTags(tags, tasks) {
  const counts = countTagUsageMap(tags, tasks);
  return (tags || []).filter((t) => counts[t.id] === 0);
}

/** Milisegundos desde que se tocó la etiqueta (un `updatedAt` aún sin confirmar por el servidor cuenta como «ahora mismo»). */
function tagAgeMs(tag, now) {
  const u = tag && tag.updatedAt;
  const ms = u && typeof u.toMillis === "function" ? u.toMillis() : u && typeof u.seconds === "number" ? u.seconds * 1000 : typeof u === "number" ? u : null;
  return ms === null ? 0 : Math.max(0, now - ms);
}

// -- etiquetas «en mano»: las que se crearon en la edición que está abierta y todavía no están en ninguna tarea guardada
const held = new Set();
let onReleased = null;
/** El modal de tarea avisa de una etiqueta recién creada: no se borrará como huérfana mientras siga la edición. */
export function holdTagId(id) { if (id) held.add(tagKey(id)); }
/** Fin de la edición (guardada o no): las etiquetas en mano vuelven a poder purgarse si siguen sin uso. */
export function releaseHeldTags() { held.clear(); if (typeof onReleased === "function") { try { onReleased(); } catch (e) { console.error("tags:", e); } } }
export function heldTagIds() { return [...held]; }
/** app.js se apunta aquí para volver a mirar las huérfanas cuando termina una edición. */
export function setTagsReleasedHook(fn) { onReleased = typeof fn === "function" ? fn : null; }

// -- de dónde salen «todas las tareas» (lo registra app.js; por defecto, lo que haya en el store)
let provider = {
  getTasks: () => store.getList("tasks"),
  isComplete: () => false,
  ensureComplete: async () => {},
};
export function registerTagTasksProvider(p) {
  provider = { getTasks: () => [], isComplete: () => false, ensureComplete: async () => {}, ...(p || {}) };
}
/** Espera a que estén cargadas todas las tareas activas (si el proveedor sabe) y las devuelve. */
export async function loadTasksForTags() {
  try { await provider.ensureComplete(); } catch (e) { console.warn("tags: no se pudieron cargar todas las tareas", e); }
  return provider.getTasks();
}
/** Mismo nombre más claro para quien no habla de etiquetas (corrección de sugerencias, data/suggest-edit.js). */
export const loadAllKnownTasks = loadTasksForTags;
/** Las tareas conocidas ahora mismo, sin esperar a nada. */
export function knownTasksForTags() { return provider.getTasks(); }

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_CHUNK).forEach((op) => op(batch));
    await batch.commit();
  }
}

/**
 * Borra las etiquetas que ya no están en ninguna tarea. Segura por diseño:
 *   · solo actúa si se sabe que `tasks` es TODO (se pasa `tasks`, o el proveedor dice `isComplete()`): con carga parcial, una
 *     etiqueta usada en un proyecto aún sin cargar parecería huérfana;
 *   · respeta `keepTagIds` y las etiquetas en mano (holdTagId) y las tocadas hace menos de 2 minutos (otra persona puede estar
 *     creándola en este mismo momento, antes de guardar su tarea);
 *   · un solo writeBatch por cada 450 borrados.
 * Devuelve `{ pruned: [ids], skipped: null | 'incomplete' | 'nothing' }`.
 */
export async function pruneOrphanTags({ keepTagIds = [], tasks = null, tags = null, now = Date.now() } = {}) {
  const complete = tasks !== null || provider.isComplete();
  if (!complete) return { pruned: [], skipped: "incomplete" };
  const taskList = tasks !== null ? tasks : provider.getTasks();
  const tagList = tags !== null ? tags : store.getList("tags");
  const keep = new Set([...keepTagIds, ...held].map(tagKey));
  const doomed = findOrphanTags(tagList, taskList).filter((t) => !keep.has(tagKey(t.id)) && tagAgeMs(t, now) >= NEW_TAG_GRACE_MS);
  if (!doomed.length) return { pruned: [], skipped: "nothing" };
  await commitInChunks(doomed.map((t) => (batch) => batch.delete(doc(db, "tags", t.id))));
  return { pruned: doomed.map((t) => t.id), skipped: null };
}

// ---------------------------------------------------------------- renombrar / fusionar / borrar en cascada

/** La lista de etiquetas de una tarea con `fromId` sustituida por `toName` (o quitada si `toName` es null), sin duplicar. */
function rewriteTags(taskTags, fromId, toName) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(taskTags) ? taskTags : []) {
    const value = tagEntryMatches(entry, fromId) ? toName : entry;
    if (value === null || value === undefined) continue;
    const k = tagKey(value) || String(value);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

/** Las tareas (vivas, sin repetir) que llevan la etiqueta, con su lista de etiquetas ya reescrita: `[{ id, tags }]`. */
function planTaskRewrites(tasks, fromId, toName) {
  const seen = new Set();
  const out = [];
  for (const t of tasks || []) {
    if (!liveTask(t) || !t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    if (!Array.isArray(t.tags) || !t.tags.some((e) => tagEntryMatches(e, fromId))) continue;
    out.push({ id: t.id, tags: rewriteTags(t.tags, fromId, toName) });
  }
  return out;
}

/**
 * El PLAN (puro) de renombrar la etiqueta `tagId` a `newName`:
 *   mode 'merge'   ya existe OTRA con ese nombre (sin mayúsculas ni tildes): se unen, la vieja desaparece
 *   mode 'update'  solo cambia mayúsculas, tildes o el color: mismo documento
 *   mode 'move'    nombre nuevo de verdad: documento nuevo con su slug, el viejo desaparece
 *   mode 'noop'    nada que cambiar
 * `targetId`/`targetName`/`color` son los de la etiqueta que queda; `taskRewrites` las tareas a escribir.
 */
export function planTagRename(tags, tagId, newName, { newColor = null, tasks = [] } = {}) {
  const name = cleanTagName(newName);
  const source = (tags || []).find((t) => t.id === tagId) || null;
  if (!source) throw new Error("La etiqueta ya no existe.");
  const newId = tagKey(name);
  if (!newId) throw new Error("El nombre de la etiqueta no puede estar vacío.");
  const other = (tags || []).find((t) => t.id !== tagId && tagKey(t.id) === newId);
  if (other) {
    return { mode: "merge", sourceId: tagId, targetId: other.id, targetName: other.name, color: newColor || other.color, taskRewrites: planTaskRewrites(tasks, tagId, other.name) };
  }
  const color = newColor || source.color;
  if (newId === tagKey(tagId)) {
    const same = name === source.name && color === source.color;
    return { mode: same ? "noop" : "update", sourceId: tagId, targetId: tagId, targetName: name, color, taskRewrites: name === source.name ? [] : planTaskRewrites(tasks, tagId, name) };
  }
  return { mode: "move", sourceId: tagId, targetId: newId, targetName: name, color, taskRewrites: planTaskRewrites(tasks, tagId, name) };
}

/** Escribe las tareas primero (si se corta a medias, repetir la operación termina el trabajo) y el registro de etiquetas al final. */
async function applyTagPlan(plan) {
  await commitInChunks(plan.taskRewrites.map((r) => (batch) => batch.update(doc(db, "tasks", r.id), { tags: r.tags, updatedAt: serverTimestamp() })));
  const ops = [];
  if (plan.mode === "update" || plan.mode === "move" || (plan.mode === "merge")) {
    ops.push((batch) => batch.set(doc(db, "tags", plan.targetId), { name: plan.targetName, color: plan.color, updatedAt: serverTimestamp() }, { merge: true }));
  }
  if (plan.mode === "merge" || plan.mode === "move") ops.push((batch) => batch.delete(doc(db, "tags", plan.sourceId)));
  if (ops.length) await commitInChunks(ops);
}

/**
 * Corrige el nombre (y, si se pasa, el color) de una etiqueta en TODAS las tareas donde está. Si el nombre nuevo coincide con otra
 * etiqueta existente, las fusiona: sustituye una por otra en cada tarea sin duplicarla y borra la vieja. Devuelve el plan hecho
 * (`mode`, `targetId`, `targetName`, `taskRewrites`: cuántas tareas cambiaron es `taskRewrites.length`).
 */
export async function renameOrMergeTagEverywhere(tagId, newName, { newColor = null, tasks = null, tags = null } = {}) {
  const taskList = tasks !== null ? tasks : await loadTasksForTags();
  const plan = planTagRename(tags !== null ? tags : store.getList("tags"), tagId, newName, { newColor, tasks: taskList });
  if (plan.mode !== "noop") await applyTagPlan(plan);
  return plan;
}

/** El plan (puro) de borrar una etiqueta: quitarla de cada tarea y borrar su documento. */
export function planTagDelete(tagId, tasks) {
  return { mode: "delete", sourceId: tagId, taskRewrites: planTaskRewrites(tasks, tagId, null) };
}

/** Borra la etiqueta de Firestore y la quita de todas las tareas donde estuviera asignada. */
export async function deleteTagEverywhere(tagId, { tasks = null } = {}) {
  const taskList = tasks !== null ? tasks : await loadTasksForTags();
  const plan = planTagDelete(tagId, taskList);
  await commitInChunks(plan.taskRewrites.map((r) => (batch) => batch.update(doc(db, "tasks", r.id), { tags: r.tags, updatedAt: serverTimestamp() })));
  await commitInChunks([(batch) => batch.delete(doc(db, "tags", tagId))]);
  return plan;
}
