// ============================================================================
// Propiedades de un proyecto (v57): helpers PUROS (sin Firebase ni DOM) de
// los metadatos que cuelgan de un proyecto y del tránsito oferta → proyecto.
//
// Viven en `projects/{id}.properties` (ver el modelo de datos en el
// README) y son, a propósito, un dato APARTE de las tareas del proyecto:
//
//   comercial, ubicacion        texto libre (Comercial con sugerencias)
//   approvedVersion             la versión de la oferta que se aprobó ("A3")
//   deliveryDate / sentDate /   fechas "YYYY-MM-DD" (o null)
//   approvalDate                entrega, envío y aprobación
//   history[]                   histórico del proyecto, con el mismo formato
//                               que el de una oferta: {id, version, changes,
//                               createdAt}
//   sourceOfferId /             solo si el proyecto nació de "Convertir en
//   sourceOfferTitle            proyecto": qué oferta fue (para mostrarlo)
//
// Aquí se decide cómo se NORMALIZA lo leído de Firestore para el formulario,
// cómo se LIMPIA lo escrito antes de guardarlo, y qué valores de una oferta
// pasan a qué propiedad al convertirla (propertiesFromOffer). El formulario
// en sí está en components/project-properties-modal.js y la escritura en
// data/offer-conversion.js.
// ============================================================================
import {
  OFFER_FIRST_VERSION,
  nextOfferVersion,
  makeOriginalRevision,
  lacksOriginalRevision,
  findOfferCommercialField,
  findOfferLocationField,
  findOfferVersionField,
  cleanSuggestionText,
} from "./offers.js";
import { uid, toDate, toDateInputValue, plainTitleText } from "./utils.js";

/** Las tres fechas de las propiedades, en el orden en el que se enseñan. */
export const PROPERTY_DATE_FIELDS = [
  { key: "deliveryDate", label: "Fecha de entrega" },
  { key: "sentDate", label: "Fecha de envío" },
  { key: "approvalDate", label: "Fecha de aprobación" },
];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOrNull(value) {
  return toDateInputValue(value) || null;
}

function isoOrNull(value) {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

/** Una fila del histórico tal como la usa el formulario (siempre con id). */
function historyRow(row) {
  const r = row || {};
  return {
    id: r.id || uid(),
    version: String(r.version ?? ""),
    changes: String(r.changes ?? ""),
    createdAt: isoOrNull(r.createdAt),
  };
}

/**
 * Lo que hay en Firestore (`projects/{id}.properties`, que puede no existir
 * todavía) → el estado con el que trabaja el formulario. Nunca devuelve
 * `undefined` en ningún campo, para que los inputs siempre tengan valor.
 */
export function normalizeProperties(raw) {
  const p = raw || {};
  return {
    comercial: text(p.comercial),
    ubicacion: text(p.ubicacion),
    approvedVersion: text(p.approvedVersion),
    deliveryDate: dateOrNull(p.deliveryDate),
    sentDate: dateOrNull(p.sentDate),
    approvalDate: dateOrNull(p.approvalDate),
    history: (Array.isArray(p.history) ? p.history : []).map(historyRow),
    sourceOfferId: p.sourceOfferId || null,
    sourceOfferTitle: text(p.sourceOfferTitle),
  };
}

/**
 * El estado del formulario → lo que se guarda en Firestore. Recorta los
 * textos (y, en Comercial y Ubicación, colapsa los espacios de en medio para
 * que "Juan  Pérez" y "Juan Pérez" no cuenten como dos valores) y deja las
 * fechas vacías como `null`. `sourceOfferId`/`sourceOfferTitle` solo se
 * escriben si existen: un proyecto que no nació de una oferta no guarda dos
 * claves vacías.
 */
export function propertiesForSave(state) {
  const out = {
    comercial: cleanSuggestionText(state.comercial),
    ubicacion: cleanSuggestionText(state.ubicacion),
    approvedVersion: text(state.approvedVersion),
    deliveryDate: state.deliveryDate || null,
    sentDate: state.sentDate || null,
    approvalDate: state.approvalDate || null,
    history: (state.history || []).map((r) => ({
      id: r.id,
      version: text(r.version),
      changes: text(r.changes),
      createdAt: r.createdAt || null,
    })),
  };
  if (state.sourceOfferId) {
    out.sourceOfferId = state.sourceOfferId;
    out.sourceOfferTitle = text(state.sourceOfferTitle);
  }
  return out;
}

/**
 * La versión de una fila NUEVA del histórico del proyecto ("+ Nueva
 * versión"): la que sigue a la última fila; sin filas, la que sigue a la
 * versión aprobada; y sin ninguna de las dos, la primera (A1).
 */
export function nextHistoryVersion(state) {
  const rows = state.history || [];
  const base = (rows.length && text(rows[rows.length - 1].version)) || text(state.approvedVersion);
  return base ? nextOfferVersion(base) : OFFER_FIRST_VERSION;
}

/**
 * Los valores de partida al CONVERTIR una oferta en proyecto: todo lo que
 * la oferta ya tenía rellenado, colocado en su propiedad. Es solo el punto
 * de partida — quien convierte lo ve y lo ajusta en la ventana antes de
 * crear nada (ver openOfferConversionModal).
 *
 *   Comercial / Ubicación → los campos personalizados de la oferta
 *   Versión aprobada      → la versión que tenga la oferta ahora (su campo
 *                           Versión; si está vacío, la de la última fila del
 *                           histórico; y si tampoco hay, A1)
 *   Fecha de entrega      → la fecha límite de la oferta
 *   Fecha de envío        → vacía (la oferta no guarda cuándo se envió)
 *   Fecha de aprobación   → hoy (`today`, "YYYY-MM-DD")
 *   Histórico             → el histórico de revisiones de la oferta, con su
 *                           fila de partida (A1, «Versión original») delante
 *                           si le faltaba (ver lacksOriginalRevision)
 *
 * Devuelve `{ name, properties }`: el nombre propuesto para el proyecto (el
 * título de la oferta sin las marcas de negrita) y las propiedades.
 */
export function propertiesFromOffer({ offer, offersProject, today }) {
  const values = offer.customFields || {};
  const commercialDef = findOfferCommercialField(offersProject);
  const locationDef = findOfferLocationField(offersProject);
  const versionDef = findOfferVersionField(offersProject);

  // Igual que al abrir la oferta (task-modal.js, ensureOriginalRevision): si
  // al histórico le falta la fila A1 «Versión original» —vacío, o ya
  // empezado en la v56 con A2, A3…—, se antepone al trasladarlo.
  let history = (Array.isArray(offer.revisions) ? offer.revisions : []).map(historyRow);
  if (lacksOriginalRevision(history)) {
    history = [makeOriginalRevision({ id: uid(), createdAt: isoOrNull(offer.createdAt) }), ...history];
  }

  const currentVersion = versionDef ? text(values[versionDef.id]) : "";
  const approvedVersion = currentVersion || text(history[history.length - 1].version) || OFFER_FIRST_VERSION;

  return {
    name: plainTitleText(offer.title).trim(),
    properties: {
      comercial: commercialDef ? text(values[commercialDef.id]) : "",
      ubicacion: locationDef ? text(values[locationDef.id]) : "",
      approvedVersion,
      deliveryDate: dateOrNull(offer.dueDate),
      sentDate: null,
      approvalDate: today || null,
      history,
      sourceOfferId: offer.id || null,
      sourceOfferTitle: plainTitleText(offer.title).trim(),
    },
  };
}
