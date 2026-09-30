// ============================================================================
// Ofertas (v56): helpers PUROS (sin Firebase ni DOM) del funcionamiento
// especial de la sección exclusiva "Ofertas" — la v55 la creó como un
// proyecto más con dos secciones (Nuevas / Revisiones) y tres campos
// personalizados (Comercial / Versión / Ubicación, este último desde la
// v56); la v56 le añade encima el flujo de revisiones:
//
//   oferta nueva → sección "Nuevas", versión A1 → se completa → el
//   comercial pide un cambio → "Nueva versión" (botón del modal de la
//   oferta): vuelve a quedar sin completar, pasa a "Revisiones", sube a A2
//   y se apunta una fila nueva en el histórico de revisiones (`revisions`
//   de la tarea) donde se escribe qué cambia y por qué.
//
// v57: el histórico arranca de serie con una fila A1 «Versión original»
// (ver makeOriginalRevision), el campo Comercial sugiere lo ya escrito
// (ver collectSuggestions) y una oferta aprobada se puede convertir en
// proyecto (ver project-properties.js y data/offer-conversion.js).
//
// Nada de esto es un dato nuevo del proyecto: la versión sigue siendo el
// campo personalizado "Versión" de siempre (texto libre, editable a mano
// para cualquier ajuste), y las secciones siguen siendo las del proyecto —
// aquí solo se ENCUENTRAN por su id de fábrica ("nuevas"/"revisiones") o,
// si alguien las recreó, por su nombre. Quien llama (task-modal.js,
// topbar.js y las vistas) decide qué hacer con lo que devuelven.
// ============================================================================

/** `exclusiveKey` del proyecto Ofertas (ver EXCLUSIVE_PROJECT_SEEDS en data/projects.js). */
export const OFFERS_KEY = "ofertas";

/** Versión con la que nace cualquier oferta nueva. */
export const OFFER_FIRST_VERSION = "A1";

/** ¿Es este el proyecto Ofertas? (null/undefined → false) */
export function isOffersProject(project) {
  return !!project && project.exclusiveKey === OFFERS_KEY;
}

/** Sin mayúsculas, sin tildes y sin espacios sobrantes — para comparar nombres a mano. */
export function normalizeName(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * La sección "nuevas" o "revisiones" de un proyecto Ofertas: primero por su
 * id de fábrica (sobrevive a que alguien le cambie el nombre en "🗂
 * Secciones") y, si esa sección se borró y se volvió a crear a mano, por
 * su nombre. Devuelve `null` si no hay ninguna de las dos cosas — quien
 * llama decide entonces qué hacer (task-modal.js, por ejemplo, deja la
 * oferta donde estaba).
 */
export function findOffersSection(project, kind) {
  const sections = (project && project.sections) || [];
  return sections.find((s) => s.id === kind) || sections.find((s) => normalizeName(s.name) === kind) || null;
}

/**
 * La definición del campo personalizado "Versión" del proyecto Ofertas:
 * por su id de fábrica ("version") o, si se recreó a mano, por su nombre.
 * `null` si el proyecto ya no tiene ese campo.
 */
export function findOfferVersionField(project) {
  const defs = (project && project.customFieldDefs) || [];
  return defs.find((f) => f.id === "version") || defs.find((f) => normalizeName(f.name) === "version") || null;
}

/**
 * La versión que sigue a `current`: sube en uno el número final ("A1" →
 * "A2", "A9" → "A10", "B03" → "B04", "v2.3" → "v2.4"). Sin versión
 * escrita se da por hecho que la actual era la primera (A1), así que la
 * siguiente es A2. Si lo escrito no acaba en número ("Final") se le añade
 * un 2 ("Final2") — no hay una respuesta "correcta" ahí, y la versión
 * siempre se puede corregir a mano en la propia oferta.
 */
export function nextOfferVersion(current) {
  const v = String(current ?? "").trim();
  if (!v) return "A2";
  const m = v.match(/^(.*?)(\d+)$/);
  if (m) {
    const [, prefix, digits] = m;
    return prefix + String(Number(digits) + 1).padStart(digits.length, "0");
  }
  return `${v}2`;
}

// ----------------------------------------------------------------------------
// v57
// ----------------------------------------------------------------------------

/** Texto de la primera fila del histórico de revisiones de toda oferta. */
export const ORIGINAL_REVISION_TEXT = "Versión original";

/**
 * La fila con la que arranca el histórico de una oferta: versión A1 y, en
 * "Cambios", «Versión original». `id` y `createdAt` (ISO) los pone quien
 * llama — este archivo no genera ids ni lee el reloj.
 */
export function makeOriginalRevision({ id, createdAt }) {
  return { id, version: OFFER_FIRST_VERSION, changes: ORIGINAL_REVISION_TEXT, createdAt: createdAt || null };
}

/**
 * ¿Le falta a este histórico la fila «A1 · Versión original»? Sí, salvo que
 * alguna fila ya sea la A1 o se llame «Versión original» (sin mirar
 * mayúsculas, tildes ni espacios). Cubre tanto el histórico vacío (una oferta
 * nueva, o una anterior a la v57 que nunca pulsó «Nueva versión») como uno ya
 * empezado en la v56 — donde la primera fila era la A2, porque la A1 no se
 * apuntaba — sin tocar uno que ya la tenga aunque le hayan cambiado el texto.
 */
export function lacksOriginalRevision(revisions) {
  const firstVersion = normalizeName(OFFER_FIRST_VERSION);
  const originalText = normalizeName(ORIGINAL_REVISION_TEXT);
  return !(revisions || []).some((r) => normalizeName(r.version) === firstVersion || normalizeName(r.changes) === originalText);
}

/** Un campo personalizado de Ofertas por su id de fábrica o, si se recreó a mano, por su nombre (sin tildes ni mayúsculas). */
function findOfferField(project, key) {
  const defs = (project && project.customFieldDefs) || [];
  return defs.find((f) => f.id === key) || defs.find((f) => normalizeName(f.name) === key) || null;
}

/** El campo "Comercial" de Ofertas (id de fábrica "comercial"); `null` si el proyecto ya no lo tiene. */
export function findOfferCommercialField(project) {
  return findOfferField(project, "comercial");
}

/** El campo "Ubicación" de Ofertas (id de fábrica "ubicacion"); `null` si el proyecto ya no lo tiene. */
export function findOfferLocationField(project) {
  return findOfferField(project, "ubicacion");
}

/**
 * Clave para decidir si dos escrituras son "el mismo valor": sin tildes,
 * sin mayúsculas y con los espacios sobrantes (también los del medio)
 * colapsados — "Juan  Pérez " y "juan perez" comparten clave.
 */
export function suggestionKey(text) {
  return normalizeName(String(text ?? "").replace(/\s+/g, " "));
}

/** Espacios sobrantes fuera, y un único espacio entre palabras. */
export function cleanSuggestionText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Cuánta "pinta de bien escrito" tiene una variante: con tildes y con mayúsculas y minúsculas mezcladas. Solo para desempatar. */
function spellingScore(text) {
  const hasAccent = /[\u0300-\u036f]/.test(text.normalize("NFD"));
  const mixedCase = text !== text.toLowerCase() && text !== text.toUpperCase();
  return (hasAccent ? 1 : 0) + (mixedCase ? 1 : 0);
}

/**
 * Los valores distintos de una lista de textos, listos para sugerirlos al
 * escribir (campo Comercial, v57). Dos escrituras que solo se diferencian
 * en mayúsculas, tildes o espacios cuentan como una — de cada grupo se
 * queda la variante que más veces aparece y, en un empate, la que mejor
 * pinta tenga (tildes y mayúsculas mezcladas). Vacíos y no-textos fuera.
 * Devuelve la lista ordenada alfabéticamente (sin distinguir tildes).
 */
export function collectSuggestions(values) {
  const groups = new Map(); // clave → Map(variante → veces)
  for (const raw of values || []) {
    if (typeof raw !== "string") continue;
    const text = cleanSuggestionText(raw);
    if (!text) continue;
    const key = suggestionKey(text);
    if (!groups.has(key)) groups.set(key, new Map());
    const variants = groups.get(key);
    variants.set(text, (variants.get(text) || 0) + 1);
  }
  const result = [];
  for (const variants of groups.values()) {
    const best = [...variants.entries()].sort(
      (a, b) => b[1] - a[1] || spellingScore(b[0]) - spellingScore(a[0]) || a[0].localeCompare(b[0], "es")
    )[0][0];
    result.push(best);
  }
  return result.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}
