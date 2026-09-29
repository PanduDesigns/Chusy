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
