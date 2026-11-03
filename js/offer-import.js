// ============================================================================
// Importador de HISTÓRICOS de ofertas desde Excel/CSV (v83): LÓGICA PURA — sin DOM ni Firebase.
// La ventana está en components/offer-import-modal.js y la escritura en data/offer-import.js.
//
// Para qué: Métricas (flow-metrics.js) compara comerciales, años y revisiones; con solo las ofertas creadas en
// Chusy desde la v55 no hay historia suficiente. Aquí se leen las ofertas de antes (una hoja de Excel o un CSV
// con una fila por oferta) y se convierten en ofertas «históricas» de Ofertas, que Métricas lee igual que las
// demás — usando los MISMOS campos que ya existen (nada nuevo en el modal de tareas):
//
//   Columna del archivo        →  dónde se guarda en la oferta
//   Oferta (título)            →  `title`
//   Comercial                  →  campo personalizado «Comercial» (`customFields.comercial`)
//   Fecha (de la oferta)       →  `createdAt` (de ahí salen Año y Mes de los filtros)
//   Revisiones                 →  `revisions[]`: fila A1 «Versión original» + una fila por revisión (A2, A3…);
//                                 el campo «Versión» queda en A(n+1)
//   Resultado                  →  `importedOutcome` («ganada» | «descartada» | «entregada» | «en_curso») y
//                                 `isComplete`; una ganada además lleva `convertedAt` (no tiene `convertedProjectId`:
//                                 el proyecto de entonces no existe en Chusy)
//   Fecha cierre (opcional)    →  `completedAt` (y `convertedAt` si es ganada): da el «tiempo de ciclo»
//   Sector / Ubicación / ID    →  campos «Sector» y «Ubicación»; el ID del archivo solo sirve para no duplicar
//
// Columnas obligatorias: Oferta, Comercial, Fecha y Resultado. Revisiones es opcional (sin ella, 0).
// Reconoce los encabezados por sinónimos (sin mayúsculas, tildes ni signos): ver HEADER_ALIASES.
//
// NO DUPLICA: una fila cuyo «título + día + comercial» (o cuyo ID) ya existe como oferta, o ya apareció antes en
// el archivo, se salta — se puede volver a importar el mismo archivo sin miedo.
// ============================================================================
import {
  normalizeName,
  suggestionKey,
  cleanSuggestionText,
  matchSector,
  makeOriginalRevision,
  nextOfferVersion,
  OFFER_FIRST_VERSION,
  OFFER_SECTION_CLOSED,
  OFFER_SECTION_DELIVERED,
  findOffersSection,
  findOfferCommercialField,
  findOfferVersionField,
  findOfferSectorField,
  findOfferLocationField,
  isOffersProject,
  defaultSectorValue,
} from "./offers.js";
import { toDate, plainTitleText } from "./utils.js";

/** Máximo de revisiones que se admiten en una fila (más es casi seguro un error de escritura). */
export const MAX_IMPORT_REVISIONS = 30;
/** Texto de cada fila de revisión importada (no se sabe qué se pidió: solo que hubo revisión). */
export const IMPORTED_REVISION_TEXT = "Revisión importada del histórico";

/** Plantilla descargable (separador «;», el de Excel en español). */
export const OFFER_IMPORT_TEMPLATE_CSV =
  "Oferta;Comercial;Fecha;Revisiones;Resultado;Fecha cierre;Sector;Ubicación\n" +
  "Cabina de pintura cliente ejemplo;Juan Pérez;15/03/2024;2;Ganada;02/05/2024;Industria;\n" +
  "Línea de tratamiento superficial ejemplo;Ana Ruiz;10/06/2024;0;Perdida;;Automoción;\n";

// ---------------------------------------------------------------- CSV

/** Texto CSV → filas de celdas (texto). Detecta «;», tabulador o «,»; admite comillas dobles y BOM. Sin filas vacías. */
export function parseDelimited(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) || "";
  const counts = { ";": 0, "\t": 0, ",": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const delimiter = counts[";"] >= counts["\t"] && counts[";"] >= counts[","] && counts[";"] > 0 ? ";" : counts["\t"] >= counts[","] && counts["\t"] > 0 ? "\t" : ",";

  const rows = [];
  let row = [], cell = "", quoted = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); if (row.some((c) => String(c).trim() !== "")) rows.push(row.map((c) => String(c).trim())); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { /* se ignora: el \n cierra la fila */ }
    else cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

// ---------------------------------------------------------------- fechas

const localNoon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
function validYmd(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = localNoon(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/**
 * Una celda → Date (a mediodía local, para que el huso horario no la mueva de día), o null si no es una fecha.
 * Admite: Date; número de serie de Excel (entre 20.000 y 80.000, es decir, de 1954 a 2119); y textos
 * `dd/mm/aaaa`, `d/m/aa`, `dd-mm-aaaa`, `dd.mm.aaaa` (día primero, como en España) y `aaaa-mm-dd`.
 * Un día imposible (31/02/2024) no es fecha.
 */
export function parseHistoricalDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : localNoon(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === "number") {
    if (!(value >= 20000 && value <= 80000)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const text = String(value).trim();
  if (/^\d{5}(\.\d+)?$/.test(text)) return parseHistoricalDate(Number(text));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validYmd(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

// ---------------------------------------------------------------- encabezados

/** Un encabezado sin mayúsculas, tildes ni signos («Nº revisiones» → «n revisiones»). */
const headerKey = (text) => normalizeName(text).replace(/[^a-z0-9]+/g, " ").trim();

/** Sinónimos admitidos por columna (ya normalizados con headerKey). */
export const HEADER_ALIASES = {
  title: ["oferta", "titulo", "nombre", "nombre oferta", "nombre de la oferta", "proyecto", "referencia", "ref"],
  commercial: ["comercial", "vendedor", "agente", "responsable comercial"],
  date: ["fecha", "fecha oferta", "fecha de oferta", "fecha creacion", "fecha de creacion", "fecha alta", "fecha de alta", "fecha presupuesto"],
  revisions: ["revisiones", "n revisiones", "num revisiones", "numero de revisiones", "n de revisiones", "no revisiones", "revs", "rev"],
  outcome: ["resultado", "estado", "situacion", "resolucion", "cierre"],
  closedAt: ["fecha cierre", "fecha de cierre", "fecha resolucion", "fecha de resolucion", "fecha adjudicacion", "fecha de adjudicacion", "fecha aprobacion", "fecha de aprobacion"],
  sector: ["sector"],
  location: ["ubicacion", "carpeta", "ruta"],
  code: ["id", "codigo", "id oferta", "codigo oferta", "n oferta", "num oferta"],
};
const REQUIRED_COLUMNS = ["title", "commercial", "date", "outcome"];
const COLUMN_LABELS = { title: "Oferta", commercial: "Comercial", date: "Fecha", outcome: "Resultado", revisions: "Revisiones", closedAt: "Fecha cierre", sector: "Sector", location: "Ubicación", code: "ID" };

/** `{ title: 0, commercial: 1, … }` con la posición de cada columna reconocida en una fila de encabezados. */
export function mapHeaders(headerRow) {
  const columns = {};
  (headerRow || []).forEach((cell, index) => {
    const key = headerKey(cell);
    if (!key) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (columns[field] === undefined && aliases.includes(key)) { columns[field] = index; break; }
    }
  });
  return columns;
}

/** Índice de la fila de encabezados: la primera (de las 10 primeras) con al menos 3 columnas reconocidas; -1 si ninguna. */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(10, (rows || []).length); i++) if (Object.keys(mapHeaders(rows[i])).length >= 3) return i;
  return -1;
}

// ---------------------------------------------------------------- valores

const OUTCOME_WORDS = {
  ganada: ["ganada", "ganado", "convertida", "convertido", "aprobada", "aprobado", "adjudicada", "adjudicado", "cerrada ganada", "si", "1", "true", "ok", "won"],
  descartada: ["perdida", "perdido", "descartada", "descartado", "rechazada", "rechazado", "caida", "cancelada", "no", "no ganada", "sin convertir", "0", "false", "lost"],
  entregada: ["entregada", "entregado", "enviada", "presentada", "pendiente", "en espera"],
  en_curso: ["en curso", "abierta", "activa", "en proceso", "en estudio", "en preparacion"],
};

/** Resultado escrito → «ganada» | «descartada» | «entregada» | «en_curso», o null si no se reconoce. */
export function parseOutcome(value) {
  const key = headerKey(value);
  if (!key) return null;
  for (const [outcome, words] of Object.entries(OUTCOME_WORDS)) if (words.includes(key)) return outcome;
  return null;
}

/** Revisiones escritas → `{ value }` o `{ error }`. Vacío = 0; «2», «2 revisiones» y «a la primera»/«ninguna» valen. */
export function parseRevisionCount(value) {
  if (value === null || value === undefined || String(value).trim() === "") return { value: 0, defaulted: true };
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= MAX_IMPORT_REVISIONS ? { value } : { error: `Revisiones no válidas: ${value}` };
  const text = normalizeName(value); // sin tildes ni mayúsculas, pero con el signo: «-1» NO es 1
  if (["a la primera", "primera", "ninguna", "sin revisiones", "sin"].includes(headerKey(value))) return { value: 0 };
  const m = /^(\d{1,3})(?:\s+revisiones?)?$/.exec(text);
  if (!m) return { error: `Revisiones no válidas: «${String(value).trim()}»` };
  const n = Number(m[1]);
  return n <= MAX_IMPORT_REVISIONS ? { value: n } : { error: `Demasiadas revisiones (${n}; el máximo es ${MAX_IMPORT_REVISIONS})` };
}

// ---------------------------------------------------------------- tabla → registros

/**
 * Las filas de un archivo (ya leído: CSV con parseDelimited o hoja de Excel como matriz) → registros listos para
 * planificar. Nunca lanza: lo que no vale se devuelve en `errors` (con el número de fila del archivo) y las
 * advertencias —filas que entran pero con algo que revisar— en `warnings`.
 * @returns {{ headerRow: number, columns: object, missing: string[], records: object[], errors: {line:number,message:string}[], warnings: {line:number,message:string}[], rowCount: number }}
 */
export function parseOfferHistoryRows(rows) {
  const out = { headerRow: -1, columns: {}, missing: [], records: [], errors: [], warnings: [], rowCount: 0 };
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    out.missing = REQUIRED_COLUMNS.map((c) => COLUMN_LABELS[c]);
    return out;
  }
  const columns = mapHeaders(rows[headerRow]);
  out.headerRow = headerRow;
  out.columns = columns;
  out.missing = REQUIRED_COLUMNS.filter((c) => columns[c] === undefined).map((c) => COLUMN_LABELS[c]);
  if (out.missing.length) return out;

  const get = (row, field) => (columns[field] === undefined ? "" : row[columns[field]] ?? "");
  let defaultedRevisions = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    out.rowCount++;
    const line = i + 1;
    const problems = [];

    const title = String(get(row, "title") ?? "").trim();
    if (!title) problems.push("falta el nombre de la oferta");
    const createdAt = parseHistoricalDate(get(row, "date"));
    if (!createdAt) problems.push(`fecha no válida: «${String(get(row, "date")).trim()}»`);
    const outcome = parseOutcome(get(row, "outcome"));
    if (!outcome) problems.push(`resultado no reconocido: «${String(get(row, "outcome")).trim()}»`);
    const revisions = parseRevisionCount(get(row, "revisions"));
    if (revisions.error) problems.push(revisions.error);
    if (problems.length) { out.errors.push({ line, message: problems.join("; ") }); continue; }

    const commercial = cleanSuggestionText(get(row, "commercial"));
    if (!commercial) out.warnings.push({ line, message: "sin comercial (se importa como «Sin comercial»)" });
    if (revisions.defaulted && columns.revisions !== undefined) defaultedRevisions++;

    let closedAt = null;
    const closedRaw = get(row, "closedAt");
    if (String(closedRaw ?? "").trim() !== "") {
      closedAt = parseHistoricalDate(closedRaw);
      if (!closedAt) out.warnings.push({ line, message: `fecha de cierre no válida («${String(closedRaw).trim()}»): se ignora` });
      else if (closedAt < createdAt) { out.warnings.push({ line, message: "la fecha de cierre es anterior a la de la oferta: se ignora" }); closedAt = null; }
    }
    if (outcome === "en_curso") closedAt = null;

    out.records.push({
      line,
      title,
      commercial,
      createdAt,
      revisions: revisions.value,
      outcome,
      closedAt,
      sector: matchSector(get(row, "sector")),
      location: String(get(row, "location") ?? "").trim(),
      code: String(get(row, "code") ?? "").trim(),
    });
  }
  if (columns.revisions === undefined && out.records.length) out.warnings.unshift({ line: headerRow + 1, message: "no hay columna «Revisiones»: todas las ofertas se importan con 0 revisiones" });
  if (defaultedRevisions) out.warnings.push({ line: headerRow + 1, message: `${defaultedRevisions} fila(s) sin nº de revisiones: se cuentan como 0` });
  return out;
}

// ---------------------------------------------------------------- registros → documentos

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dedupeKey = (title, date, commercial) => `${suggestionKey(plainTitleText(title))}|${dayKey(date)}|${suggestionKey(commercial)}`;

/**
 * El documento de Firestore (campos de la tarea) de una oferta histórica. `ctx`: { offersProject, makeId, batchId }.
 * Función pura: ni genera ids ni lee el reloj (`makeId` y `batchId` los pone quien llama).
 */
export function buildHistoricalOfferDoc(record, { offersProject, makeId, batchId }) {
  const customFields = {};
  const commercialField = findOfferCommercialField(offersProject);
  if (commercialField && record.commercial) customFields[commercialField.id] = record.commercial;
  const versionField = findOfferVersionField(offersProject);
  const revisions = [makeOriginalRevision({ id: makeId(), createdAt: record.createdAt.toISOString() })];
  let version = OFFER_FIRST_VERSION;
  for (let i = 0; i < record.revisions; i++) {
    version = nextOfferVersion(version);
    revisions.push({ id: makeId(), version, changes: IMPORTED_REVISION_TEXT, createdAt: record.createdAt.toISOString() });
  }
  if (versionField) customFields[versionField.id] = version;
  const sector = defaultSectorValue(offersProject, record.sector);
  if (sector) customFields[sector.fieldId] = sector.value;
  const locationField = findOfferLocationField(offersProject);
  if (locationField && record.location) customFields[locationField.id] = record.location;

  const section =
    record.outcome === "ganada" ? findOffersSection(offersProject, OFFER_SECTION_CLOSED)
    : record.outcome === "en_curso" ? findOffersSection(offersProject, record.revisions > 0 ? "revisiones" : "nuevas")
    : findOffersSection(offersProject, OFFER_SECTION_DELIVERED);
  const finished = record.outcome !== "en_curso";
  return {
    title: record.title,
    projectId: offersProject.id,
    sectionId: section ? section.id : null,
    customFields,
    revisions,
    isComplete: finished,
    importedHistorical: true,
    importedOutcome: record.outcome,
    importBatchId: batchId,
    createdAt: record.createdAt,
    completedAt: finished ? record.closedAt : null,
    convertedAt: record.outcome === "ganada" ? record.closedAt || record.createdAt : null,
  };
}

/**
 * Lo que se va a hacer con los registros: cuáles se crean y cuáles se saltan por duplicadas (ya existe una
 * oferta con ese título, día y comercial —o ese ID—, o ya apareció antes en el archivo).
 * @param {object[]} records  parseOfferHistoryRows(...).records
 * @param {{ offersProject: object|null, existing?: object[], makeId: Function, batchId: string }} ctx
 *   `existing`: tareas de Ofertas que ya hay (se leen título, creación, Comercial e ID).
 * @returns {{ blocking: string|null, toCreate: Array<{record, doc}>, duplicates: Array<{record, reason: string}> }}
 *   `blocking`: motivo por el que no se puede importar nada (no hay Ofertas, o le falta el campo Comercial).
 */
export function planOfferHistoryImport(records, { offersProject, existing = [], makeId, batchId }) {
  if (!offersProject || !isOffersProject(offersProject)) return { blocking: "No se encuentra la sección Ofertas.", toCreate: [], duplicates: [] };
  const commercialField = findOfferCommercialField(offersProject);
  if (!commercialField) return { blocking: "Ofertas ya no tiene el campo «Comercial»: sin él no se puede guardar el comercial de cada oferta.", toCreate: [], duplicates: [] };

  const keys = new Set();
  const codes = new Set();
  for (const t of existing) {
    if (!t) continue;
    const created = toDate(t.createdAt);
    const commercial = (t.customFields && t.customFields[commercialField.id]) || "";
    if (created && !isNaN(created.getTime())) keys.add(dedupeKey(t.title || "", created, commercial));
    if (t.offerCode) codes.add(String(t.offerCode));
  }
  const toCreate = [], duplicates = [];
  for (const record of records) {
    const key = dedupeKey(record.title, record.createdAt, record.commercial);
    if (keys.has(key) || (record.code && codes.has(record.code))) { duplicates.push({ record, reason: "ya existe" }); continue; }
    keys.add(key);
    if (record.code) codes.add(record.code);
    toCreate.push({ record, doc: buildHistoricalOfferDoc(record, { offersProject, makeId, batchId }) });
  }
  return { blocking: null, toCreate, duplicates };
}

/** Texto corto del resultado para las tablas de vista previa. */
export const OUTCOME_LABELS = { ganada: "Ganada", descartada: "Descartada", entregada: "Entregada", en_curso: "En curso" };
