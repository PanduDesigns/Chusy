// ============================================================================
// Higiene de las sugerencias al escribir (v93) — LÓGICA PURA: sin DOM ni Firebase, así se prueba suelta en Node.
//
// Cómo funcionan las sugerencias (text-suggest.js): NO hay un historial guardado. Cada vez que se abre el desplegable se
// recalcula con los valores que están ESCRITOS AHORA en las tareas, ofertas y proyectos cargados (Comercial: ofertas +
// propiedades de proyecto; Proveedor: tareas y su etapa Compra/Pedido). Por eso, cuando se corrige el último registro que
// tenía un valor mal escrito, ese valor deja de sugerirse solo — no hay nada que purgar.
//
// Lo que SÍ hay que recordar es lo que una persona ha «quitado» de las sugerencias mientras algún registro aún lo lleva
// (🗑️ «Quitar sugerencia»): esa memoria es por persona y navegador (localStorage `chusy_suggest_hidden_<uid>`, con reserva en
// la clave general) y se sincroniza con los valores vivos: en cuanto ningún registro lleva ya ese valor, la entrada se borra
// (`pruneHiddenSuggestions`) y la memoria no crece con basura.
//
// «Corregir en todo Chusy» (✏️): planSuggestedValueReplacement calcula qué documentos cambian (tareas, su etapa de compra, el campo
// Comercial de las ofertas y las propiedades de los proyectos) sin tocar nada; data/suggest-edit.js lo escribe por lotes.
// ============================================================================
import { cleanSuggestionText, suggestionKey, findOfferCommercialField, isOffersProject } from "./offers.js";

export const SUGGEST_HIDDEN_KEY = "chusy_suggest_hidden";
/** Los campos con sugerencias que se pueden corregir o quitar. */
export const SUGGEST_FIELDS = Object.freeze(["commercial", "supplier"]);

const uidOf = (userId) => (typeof userId === "string" ? userId.trim() : "");
const storageOf = (storage) => storage || (typeof localStorage !== "undefined" ? localStorage : null);
const liveTask = (t) => !!t && !t.deleted && !t.trashed && !t.deletedAt;

export function suggestHiddenKey(userId) {
  const uid = uidOf(userId);
  return uid ? `${SUGGEST_HIDDEN_KEY}_${uid}` : SUGGEST_HIDDEN_KEY;
}

/** `{ commercial: string[], supplier: string[] }` — lo que esa persona ha quitado de las sugerencias (vacío si nada o si falla). */
export function loadHiddenSuggestions(userId, storage) {
  const out = { commercial: [], supplier: [] };
  try {
    const st = storageOf(storage);
    if (!st) return out;
    let raw = uidOf(userId) ? st.getItem(suggestHiddenKey(userId)) : null;
    if (raw == null) raw = st.getItem(SUGGEST_HIDDEN_KEY);
    const parsed = raw == null ? null : JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    SUGGEST_FIELDS.forEach((f) => {
      out[f] = Array.isArray(parsed[f]) ? parsed[f].map((v) => cleanSuggestionText(v)).filter(Boolean).slice(0, 500) : [];
    });
  } catch (e) { /* guardado dañado o sin localStorage: nada oculto */ }
  return out;
}

/** Guarda SOLO en la clave de la persona; devuelve lo guardado (aunque localStorage falle). */
export function saveHiddenSuggestions(hidden, userId, storage) {
  const clean = {};
  SUGGEST_FIELDS.forEach((f) => {
    const seen = new Set();
    clean[f] = ((hidden && hidden[f]) || []).map((v) => cleanSuggestionText(v)).filter((v) => {
      const k = suggestionKey(v);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
  try {
    const st = storageOf(storage);
    if (st) st.setItem(suggestHiddenKey(userId), JSON.stringify(clean));
  } catch (e) { /* localStorage no disponible */ }
  return clean;
}

/** 🗑️: deja de sugerir ese valor a esta persona. */
export function hideSuggestion(field, value, userId, storage) {
  if (!SUGGEST_FIELDS.includes(field)) return loadHiddenSuggestions(userId, storage);
  const hidden = loadHiddenSuggestions(userId, storage);
  hidden[field] = [...hidden[field], cleanSuggestionText(value)];
  return saveHiddenSuggestions(hidden, userId, storage);
}

/** Vuelve a sugerir un valor (p. ej. porque la persona lo ha escrito a propósito). Sin cambios si no estaba oculto. */
export function unhideSuggestion(field, value, userId, storage) {
  const hidden = loadHiddenSuggestions(userId, storage);
  if (!SUGGEST_FIELDS.includes(field)) return hidden;
  const k = suggestionKey(value);
  const next = hidden[field].filter((v) => suggestionKey(v) !== k);
  if (next.length === hidden[field].length) return hidden;
  hidden[field] = next;
  return saveHiddenSuggestions(hidden, userId, storage);
}

/**
 * Las sugerencias que se enseñan: `rawOptions` (lo que hay vivo) sin las que esa persona quitó. De paso PURGA la memoria: una
 * entrada oculta que ya no está en ningún registro vivo se borra. Con `rawOptions` vacío no se purga nada (puede ser que aún no
 * hayan llegado los datos). Devuelve la lista filtrada (mismo orden).
 */
export function visibleSuggestions(field, rawOptions, userId, storage) {
  const raw = Array.isArray(rawOptions) ? rawOptions : [];
  if (!SUGGEST_FIELDS.includes(field)) return raw;
  const hidden = loadHiddenSuggestions(userId, storage);
  if (!hidden[field].length) return raw;
  const live = new Set(raw.map((o) => suggestionKey(o)));
  const kept = raw.length ? hidden[field].filter((v) => live.has(suggestionKey(v))) : hidden[field];
  if (kept.length !== hidden[field].length) saveHiddenSuggestions({ ...hidden, [field]: kept }, userId, storage);
  const hiddenKeys = new Set(kept.map((v) => suggestionKey(v)));
  return raw.filter((o) => !hiddenKeys.has(suggestionKey(o)));
}

/** Para pruebas y para quien necesite saberlo: la purga a secas (devuelve cuántas entradas se borraron). */
export function pruneHiddenSuggestions(field, liveValues, userId, storage) {
  const before = (loadHiddenSuggestions(userId, storage)[field] || []).length;
  visibleSuggestions(field, liveValues, userId, storage); // la propia consulta purga
  return before - (loadHiddenSuggestions(userId, storage)[field] || []).length;
}

// ---------------------------------------------------------------- corregir en cascada

/**
 * Qué cambiaría al sustituir `oldValue` por `newValue` (vacío = limpiar el valor) en el campo `field`:
 *   { taskUpdates: [{ id, fields }], projectUpdates: [{ id, fields }], count }
 * `fields` usa rutas con puntos (`workflow.purchase.supplier`, `customFields.<id>`, `properties.comercial`) para escribir SOLO ese
 * campo con `update`. Un registro cuenta si su valor actual tiene la misma clave que `oldValue` (sin mayúsculas, tildes ni espacios
 * de más: «juan perez» y «Juan  Pérez» son el mismo) y no es ya exactamente `newValue`.
 *   field 'supplier'    task.supplier y task.workflow.purchase.supplier de cada tarea
 *   field 'commercial'  el campo «Comercial» de las ofertas (customFields) y `properties.comercial` de cada proyecto
 */
export function planSuggestedValueReplacement({ field, oldValue, newValue, tasks = [], projects = [] } = {}) {
  if (!SUGGEST_FIELDS.includes(field)) throw new Error(`Campo de sugerencias desconocido: ${field}`);
  const oldKey = suggestionKey(oldValue);
  const next = cleanSuggestionText(newValue);
  const plan = { taskUpdates: [], projectUpdates: [], count: 0 };
  if (!oldKey) return plan;
  const matches = (v) => typeof v === "string" && suggestionKey(v) === oldKey && cleanSuggestionText(v) !== next;
  const offersProject = (projects || []).find((p) => isOffersProject(p)) || null;
  const commercialField = field === "commercial" && offersProject ? findOfferCommercialField(offersProject) : null;
  const offersId = offersProject && offersProject.id;

  const seen = new Set();
  for (const t of tasks || []) {
    if (!liveTask(t) || !t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    const fields = {};
    if (field === "supplier") {
      if (matches(t.supplier)) fields.supplier = next;
      const wf = t.workflow;
      if (wf && wf.purchase && matches(wf.purchase.supplier)) fields["workflow.purchase.supplier"] = next;
    } else if (commercialField && offersId && (t.projectId === offersId || (t.extraProjectIds || []).includes(offersId)) && !String(commercialField.id).includes(".")) {
      if (matches((t.customFields || {})[commercialField.id])) fields[`customFields.${commercialField.id}`] = next;
    }
    if (Object.keys(fields).length) plan.taskUpdates.push({ id: t.id, fields });
  }
  if (field === "commercial") {
    for (const p of projects || []) {
      if (p && p.id && !p.archived && p.properties && matches(p.properties.comercial)) plan.projectUpdates.push({ id: p.id, fields: { "properties.comercial": next } });
    }
  }
  plan.count = plan.taskUpdates.length + plan.projectUpdates.length;
  return plan;
}
