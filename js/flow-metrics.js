// ============================================================================
// Métricas directivas PASIVAS (v81) — LÓGICA PURA: sin DOM ni Firebase. Las pinta
// js/views/metrics-view.js («Embudo de ofertas» y «Salud del flujo»).
//
// «Pasivas» = salen solo de lo que ya se guarda al trabajar con Chusy (secciones,
// fechas de creación/completado/conversión): nadie imputa horas ni rellena nada.
//
//  · EMBUDO DE OFERTAS (offerFunnel): cuántas ofertas hay en curso, entregadas
//    (completadas, aún sin proyecto) y convertidas en proyecto; el ratio de
//    conversión (convertidas / resueltas, donde «resueltas» = entregadas +
//    convertidas: una oferta en curso aún no ha tenido ocasión de convertirse,
//    así que no baja el ratio); el tiempo medio hasta entregar (createdAt →
//    completedAt) y hasta convertir (createdAt → convertedAt), en días naturales;
//    y el reparto por sección de Ofertas (en qué punto del embudo está cada una).
//
//  · SALUD DEL FLUJO (flowHealth): cuánto lleva cada tarea ABIERTA en su sección
//    actual, en DÍAS HÁBILES según el calendario laboral (js/work-calendar.js:
//    sin fines de semana ni festivos). «Entró en su sección» = `sectionEnteredAt`
//    (lo anota data/tasks.js cada vez que la tarea cambia de sección o proyecto)
//    y, para las tareas que nunca se han movido, `updatedAt` y, si tampoco, `createdAt`.
//    Estancada = lleva MÁS de STAGNANT_WORKING_DAYS (7) días hábiles en la misma sección.
//    Los hitos (puntos, no trabajo) y las tareas completadas no cuentan.
//
//  · ANALÍTICA DE OFERTAS (v83, al final del archivo): lee cada oferta como un «registro» normalizado
//    (readOfferRecord: Comercial, nº de revisiones, fechas, resultado) tanto de las ofertas que siguen en
//    Ofertas —activas, entregadas o ya convertidas en proyecto— como, si la tarea original ya no está
//    (borrada o en la papelera), del proyecto en que se convirtió (readProjectOfferRecord). Sobre esos
//    registros: filtros por Comercial/Año/Mes, ranking de efectividad por Comercial, evolución mensual y
//    la correlación «revisiones ↔ cierre». Todo puro: sin DOM ni Firebase.
//
// Quién ve qué (alcance por departamento/Responsable) se decide fuera: estas
// funciones reciben las tareas que ya se pueden ver.
// ============================================================================
import { toDate, getTaskSectionForProject } from "./utils.js";
import { countWorkingDays } from "./work-calendar.js";
import { isOffersProject, findOfferCommercialField, countOfferRevisions, cleanSuggestionText, suggestionKey, collectSuggestions } from "./offers.js";
import { parseProjectCode } from "./project-codes.js";

/** Días hábiles en la misma sección a partir de los cuales una tarea abierta se considera estancada (> 7). */
export const STAGNANT_WORKING_DAYS = 7;

// ---------------------------------------------------------------- escritura: sectionEnteredAt

/**
 * Entrada en la sección actual: devuelve `fields` con `sectionEnteredAt: stamp` añadido SOLO si
 * esa escritura cambia la sección o el proyecto principal de la tarea (función PURA: el sello,
 * un serverTimestamp() o una fecha, lo pone quien llama).
 *  · `prev` = cómo estaba la tarea antes ({ projectId, sectionId }; basta con eso). Con `prev`, solo se
 *    sella si el `sectionId`/`projectId` nuevo es distinto del anterior: guardar el modal sin tocar la
 *    sección, o reordenar dentro de la misma columna, NO reinicia el contador.
 *  · Sin `prev` y con `sectionId` o `projectId` en `fields`, se sella (no se sabe de dónde viene: es un
 *    movimiento a una sección dada, p. ej. mover varias tareas a otro proyecto).
 *  · Mover una tarea dentro de un proyecto ADICIONAL (`extraSections.<id>`) no cuenta: se mide la
 *    sección del proyecto principal.
 */
export function withSectionEnteredAt(fields, prev, stamp) {
  if (!fields || typeof fields !== "object") return fields;
  const hasSection = Object.prototype.hasOwnProperty.call(fields, "sectionId");
  const hasProject = Object.prototype.hasOwnProperty.call(fields, "projectId");
  if (!hasSection && !hasProject) return fields;
  if (prev) {
    const norm = (v) => (v === undefined || v === "" ? null : v);
    const sectionChanged = hasSection && norm(fields.sectionId) !== norm(prev.sectionId);
    const projectChanged = hasProject && norm(fields.projectId) !== norm(prev.projectId);
    if (!sectionChanged && !projectChanged) return fields;
  }
  return { ...fields, sectionEnteredAt: stamp };
}

// ---------------------------------------------------------------- utilidades

const validDate = (value) => {
  const d = toDate(value);
  return d && !isNaN(d.getTime()) ? d : null;
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const nextDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const round1 = (n) => Math.round(n * 10) / 10;
const mean = (list) => (list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null);
const MS_DAY = 86400000;

/** Cuándo entró la tarea en su sección actual (Date) o null: `sectionEnteredAt`, si no `updatedAt`, si no `createdAt`. */
export function flowEnteredAt(task) {
  if (!task) return null;
  return validDate(task.sectionEnteredAt) || validDate(task.updatedAt) || validDate(task.createdAt) || null;
}

/**
 * Días HÁBILES transcurridos desde que `entered` (Date) hasta `now` (Date), sin contar el propio día de
 * entrada: entrar el lunes y mirar el martes son 1; el mismo día, 0. `cfg` es el calendario laboral
 * (festivos/ausencias; sin él, solo cuentan los fines de semana). Las ausencias personales no se aplican:
 * una tarea parada es de la sección, no de quien esté de vacaciones.
 */
export function workingDaysInSection(entered, now, cfg) {
  if (!entered || !now) return 0;
  const from = nextDay(startOfDay(entered));
  const to = startOfDay(now);
  return countWorkingDays(from, to, cfg);
}

/** ¿Es una tarea que cuenta para el flujo? De proyecto, sin completar y que no sea un hito. */
export const isFlowTask = (t) => !!t && !!t.projectId && !t.isComplete && !t.isMilestone;

// ---------------------------------------------------------------- salud del flujo

/**
 * @param {{ tasks: object[], projects: object[], cfg?: object, now?: Date, threshold?: number }} args
 * @returns {{ threshold: number, count: number, avgDays: number|null, stagnant: Array<{task, days, sectionName, project}>, bySection: Array<{key, name, count, avgDays, stagnant}> }}
 *   `stagnant`: de más a menos días. `bySection`: tareas abiertas agrupadas por NOMBRE de sección (todas las
 *   «En curso» de todos los proyectos juntas; sin sección → «Sin sección»), de más a menos tiempo medio.
 */
export function flowHealth({ tasks, projects, cfg, now = new Date(), threshold = STAGNANT_WORKING_DAYS }) {
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const rows = [];
  const seen = new Set();
  for (const task of tasks || []) {
    if (!isFlowTask(task) || seen.has(task.id)) continue;
    seen.add(task.id);
    const entered = flowEnteredAt(task);
    const project = projectById.get(task.projectId) || null;
    const section = project && task.sectionId ? (project.sections || []).find((s) => s.id === task.sectionId) : null;
    const sectionName = section && section.name ? section.name : "Sin sección";
    rows.push({ task, project, sectionName, days: entered ? workingDaysInSection(entered, now, cfg) : 0 });
  }

  const groups = new Map();
  for (const r of rows) {
    const key = r.sectionName.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, name: r.sectionName, days: [], stagnant: 0 });
    const g = groups.get(key);
    g.days.push(r.days);
    if (r.days > threshold) g.stagnant++;
  }
  const bySection = [...groups.values()]
    .map((g) => ({ key: g.key, name: g.name, count: g.days.length, avgDays: mean(g.days), stagnant: g.stagnant }))
    .sort((a, b) => b.avgDays - a.avgDays || b.count - a.count || a.name.localeCompare(b.name));

  const stagnant = rows
    .filter((r) => r.days > threshold)
    .sort((a, b) => b.days - a.days || String(a.task.title || "").localeCompare(String(b.task.title || "")));

  return { threshold, count: rows.length, avgDays: mean(rows.map((r) => r.days)), stagnant, bySection };
}

// ---------------------------------------------------------------- embudo de ofertas

const inOffers = (task, offersProject) => !!task && (task.projectId === offersProject.id || (task.extraProjectIds || []).includes(offersProject.id));

/** Días naturales entre dos fechas (con decimales), o null si falta alguna o salen al revés. */
function daysBetween(from, to) {
  const a = validDate(from), b = validDate(to);
  if (!a || !b) return null;
  const d = (b.getTime() - a.getTime()) / MS_DAY;
  return d < 0 ? null : d;
}

/**
 * El embudo de ofertas.
 * @param {{ tasks: object[], offersProject: object|null }} args  `tasks`: cualquier lista de tareas (se quedan las de Ofertas).
 * @returns {null | { total, active, delivered, converted, resolved, conversionPct: number|null,
 *                    avgDeliveryDays: number|null, avgConversionDays: number|null,
 *                    bySection: Array<{id, name, count}> }}
 *   `null` si no hay proyecto Ofertas. `active` = sin completar; `delivered` = completadas sin convertir;
 *   `converted` = con proyecto asociado (`convertedProjectId`). `conversionPct` = convertidas / (entregadas +
 *   convertidas); null mientras no haya ninguna resuelta. Los tiempos son medias en días naturales (1 decimal),
 *   null sin datos; `avgDeliveryDays` incluye las convertidas (una oferta convertida también se entregó).
 */
export function offerFunnel({ tasks, offersProject }) {
  if (!offersProject) return null;
  const seen = new Set();
  const offers = (tasks || []).filter((t) => {
    if (!inOffers(t, offersProject) || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const converted = offers.filter((t) => !!t.convertedProjectId);
  const delivered = offers.filter((t) => t.isComplete && !t.convertedProjectId);
  const active = offers.filter((t) => !t.isComplete && !t.convertedProjectId);
  const resolved = converted.length + delivered.length;

  const deliveryDays = [...delivered, ...converted].map((t) => daysBetween(t.createdAt, t.completedAt)).filter((d) => d !== null);
  const conversionDays = converted.map((t) => daysBetween(t.createdAt, t.convertedAt)).filter((d) => d !== null);

  const sections = (offersProject.sections || []).map((s) => ({ id: s.id, name: s.name || "(sin nombre)", count: 0 }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  let none = 0;
  for (const t of offers) {
    const sid = getTaskSectionForProject(t, offersProject.id);
    const s = sid && byId.get(sid);
    if (s) s.count++; else none++;
  }
  if (none) sections.unshift({ id: "", name: "Sin sección", count: none }); // «Sin sección» primero, como en el resto de la app

  return {
    total: offers.length,
    active: active.length,
    delivered: delivered.length,
    converted: converted.length,
    resolved,
    conversionPct: resolved ? Math.round((converted.length / resolved) * 100) : null,
    avgDeliveryDays: mean(deliveryDays),
    avgConversionDays: mean(conversionDays),
    bySection: sections,
  };
}

// ============================================================================
// v83 — ANALÍTICA DE OFERTAS: Comercial, Año/Mes, efectividad y revisiones ↔ cierre
// ============================================================================
//
// DÓNDE ESTÁ CADA DATO (se inspeccionó el modelo real, no se creó ningún campo nuevo):
//   · Comercial   → campo personalizado «Comercial» de Ofertas: `task.customFields[<id del campo>]`
//                   (id de fábrica «comercial»; findOfferCommercialField lo encuentra aunque lo recrearan).
//                   En el proyecto en que se convierte: `project.properties.comercial`.
//   · Revisiones  → `task.revisions[]`: la fila A1 «Versión original» más una fila por revisión
//                   (countOfferRevisions las cuenta sin la original). En el proyecto: `properties.history`
//                   (y, desde la v83, `properties.offerRevisionCount`, la cuenta al convertir).
//   · Fechas      → `createdAt`, `completedAt`, `convertedAt`; el año/mes de una oferta es el de su creación
//                   y, si faltara, el año del prefijo YYXXX de su ID (`offerCode`).
//   · Resultado   → `convertedProjectId` (convertida/ganada); completada sin proyecto = entregada, sin
//                   convertir; y, para el histórico importado de Excel/CSV, `importedOutcome`
//                   («ganada» | «descartada» | «entregada» | «en_curso», ver js/offer-import.js).
//   · Vínculo     → `task.convertedProjectId` ↔ `project.properties.sourceOfferId` (los dos sentidos).
//
// «% ÉXITO» = convertidas / (convertidas + sin convertir). Una oferta en curso aún no ha tenido ocasión de
// cerrarse y no baja el porcentaje (mismo criterio que la conversión del embudo de la v81). «Sin convertir» =
// entregadas que no pasaron a proyecto + descartadas (marcadas así en un histórico importado).

export const NO_COMMERCIAL_LABEL = "Sin comercial";
/** Valor del filtro de Comercial que selecciona las ofertas sin comercial escrito. */
export const NO_COMMERCIAL_VALUE = "__none__";
export const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
/** Muestra mínima de ofertas resueltas para fiarse de un porcentaje (por debajo se avisa). */
export const MIN_RELIABLE_SAMPLE = 5;

/** Resultado de una oferta: «converted» | «discarded» | «delivered» | «active». */
export function offerOutcome(task) {
  if (!task) return "active";
  if (task.convertedProjectId || task.importedOutcome === "ganada") return "converted";
  if (task.importedOutcome === "descartada") return "discarded";
  if (task.isComplete || task.importedOutcome === "entregada") return "delivered";
  return "active";
}

/** Año (y mes si se sabe) de una oferta: el de su creación; si falta, el año del prefijo YYXXX de su ID. */
function yearMonthOf(createdAt, code) {
  const d = validDate(createdAt);
  if (d) return { year: d.getFullYear(), month: d.getMonth() + 1 };
  const parsed = parseProjectCode(code);
  return parsed ? { year: parsed.year, month: null } : { year: null, month: null };
}

const closeDays = (createdAt, closedAt) => {
  const days = daysBetween(createdAt, closedAt);
  return days === null ? null : days;
};

/** El Comercial escrito en una oferta: su campo, o (si está vacío) el del proyecto en que se convirtió. "" si no hay. */
function commercialOfTask(task, offersProject, projectById) {
  const field = findOfferCommercialField(offersProject);
  const values = task.customFields || {};
  const own = field ? values[field.id] : undefined;
  let text = typeof own === "string" ? cleanSuggestionText(own) : "";
  if (!text && typeof values.comercial === "string") text = cleanSuggestionText(values.comercial);
  if (!text && task.convertedProjectId) {
    const project = projectById.get(task.convertedProjectId);
    const fromProject = project && project.properties && project.properties.comercial;
    if (typeof fromProject === "string") text = cleanSuggestionText(fromProject);
  }
  return text;
}

/**
 * Una oferta (tarea de Ofertas) como registro normalizado. `ctx`: { offersProject, projectById }.
 * @returns {{ id, source: "offer", title, commercial, commercialKey, revisions: number, createdAt: Date|null,
 *   year: number|null, month: number|null, outcome, closedAt: Date|null, cycleDays: number|null,
 *   sectionId: string, code: string, projectId: string|null }}
 */
export function readOfferRecord(task, ctx) {
  const { offersProject, projectById = new Map() } = ctx;
  const outcome = offerOutcome(task);
  const createdAt = validDate(task.createdAt);
  const closedAt = outcome === "converted" ? validDate(task.convertedAt) || validDate(task.completedAt) : outcome === "active" ? null : validDate(task.completedAt);
  const { year, month } = yearMonthOf(task.createdAt, task.offerCode);
  const commercial = commercialOfTask(task, offersProject, projectById);
  return {
    id: task.id,
    source: "offer",
    title: task.title || "",
    commercial,
    commercialKey: suggestionKey(commercial),
    revisions: countOfferRevisions(task.revisions),
    createdAt,
    year,
    month,
    outcome,
    closedAt,
    cycleDays: closedAt ? closeDays(task.createdAt, closedAt) : null,
    sectionId: offersProject ? getTaskSectionForProject(task, offersProject.id) || "" : "",
    code: task.offerCode || "",
    projectId: task.convertedProjectId || null,
  };
}

/**
 * Una oferta CONVERTIDA leída desde su PROYECTO (para cuando la tarea de la oferta ya no está: borrada o en la
 * papelera). Todo sale de lo que la conversión copió al proyecto (`properties`, ver propertiesFromOffer):
 * Comercial, histórico/nº de revisiones, cuándo nació la oferta (`offerCreatedAt`, v83) y `sourceOfferId`.
 * Devuelve null si el proyecto no nació de una oferta.
 */
export function readProjectOfferRecord(project) {
  const props = project && project.properties;
  if (!props || !props.sourceOfferId) return null;
  const commercial = typeof props.comercial === "string" ? cleanSuggestionText(props.comercial) : "";
  const stored = props.offerRevisionCount;
  const revisions = stored !== null && stored !== undefined && Number.isFinite(Number(stored)) ? Math.max(0, Math.floor(Number(stored))) : countOfferRevisions(props.history);
  const createdAt = validDate(props.offerCreatedAt);
  const closedAt = validDate(props.approvalDate) || validDate(project.createdAt);
  const { year, month } = yearMonthOf(props.offerCreatedAt, project.code);
  return {
    id: props.sourceOfferId,
    source: "project",
    title: props.sourceOfferTitle || project.name || "",
    commercial,
    commercialKey: suggestionKey(commercial),
    revisions,
    createdAt,
    year,
    month,
    outcome: "converted",
    closedAt,
    cycleDays: createdAt && closedAt ? closeDays(createdAt, closedAt) : null,
    sectionId: "",
    code: project.code || "",
    projectId: project.id,
  };
}

/**
 * Todas las ofertas como registros: las tareas de Ofertas (activas, entregadas y convertidas) más, para cada
 * proyecto nacido de una oferta cuya tarea ya no está entre `tasks`, el registro leído del propio proyecto.
 * El Comercial se unifica ("juan perez" y "Juan Pérez" son el mismo, con la grafía más usada).
 */
export function collectOfferRecords({ tasks, projects, offersProject }) {
  if (!offersProject || !isOffersProject(offersProject)) return [];
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const seen = new Set();
  const records = [];
  for (const task of tasks || []) {
    if (!inOffers(task, offersProject) || seen.has(task.id)) continue;
    seen.add(task.id);
    records.push(readOfferRecord(task, { offersProject, projectById }));
  }
  const linkedProjects = new Set(records.filter((r) => r.projectId).map((r) => r.projectId));
  for (const project of projects || []) {
    if (!project || project.exclusive) continue;
    const props = project.properties;
    if (!props || !props.sourceOfferId || seen.has(props.sourceOfferId) || linkedProjects.has(project.id)) continue;
    const rec = readProjectOfferRecord(project);
    if (rec) { seen.add(rec.id); records.push(rec); }
  }
  // Comercial: una sola grafía por persona.
  const label = new Map(collectSuggestions(records.map((r) => r.commercial)).map((l) => [suggestionKey(l), l]));
  for (const r of records) if (r.commercialKey && label.has(r.commercialKey)) r.commercial = label.get(r.commercialKey);
  return records;
}

// ---------------------------------------------------------------- filtros

/** Lo que se ofrece en los desplegables: comerciales reales (ordenados), años (del más reciente al más antiguo) y si hay ofertas sin comercial. */
export function offerFilterOptions(records) {
  const byKey = new Map();
  let withoutCommercial = false;
  const years = new Set();
  for (const r of records || []) {
    if (r.commercialKey) { if (!byKey.has(r.commercialKey)) byKey.set(r.commercialKey, r.commercial); } else withoutCommercial = true;
    if (r.year) years.add(r.year);
  }
  const commercials = [...byKey.values()].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).map((label) => ({ value: suggestionKey(label), label }));
  if (withoutCommercial) commercials.push({ value: NO_COMMERCIAL_VALUE, label: NO_COMMERCIAL_LABEL });
  return { commercials, years: [...years].sort((a, b) => b - a) };
}

/**
 * Deja las ofertas que cumplen los filtros. `commercial`: "" (todos), NO_COMMERCIAL_VALUE o la clave de un
 * comercial (suggestionKey); `year`: "" o un año; `month`: "" o 1..12. Una oferta sin fecha ni ID de año
 * solo entra con «todos los años»; una con año pero sin mes (solo conocemos el prefijo del ID) no entra al
 * filtrar por mes.
 */
export function applyOfferFilters(records, { commercial = "", year = "", month = "" } = {}) {
  const y = year === "" || year === null || year === undefined ? null : Number(year);
  const m = month === "" || month === null || month === undefined ? null : Number(month);
  const c = commercial || "";
  return (records || []).filter((r) => {
    if (c === NO_COMMERCIAL_VALUE ? r.commercialKey : c && r.commercialKey !== c) return false;
    if (y !== null && r.year !== y) return false;
    if (m !== null && r.month !== m) return false;
    return true;
  });
}

// ---------------------------------------------------------------- resumen, ranking, evolución

const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

/** Los totales de un grupo de ofertas (los de las tarjetas del embudo y los de cada fila del ranking). */
export function summarizeOffers(records) {
  const list = records || [];
  const count = (o) => list.filter((r) => r.outcome === o).length;
  const converted = count("converted");
  const delivered = count("delivered");
  const discarded = count("discarded");
  const active = count("active");
  const notConverted = delivered + discarded;
  const resolved = converted + notConverted;
  const revisionsTotal = list.reduce((a, r) => a + r.revisions, 0);
  const cycle = (rs) => mean(rs.map((r) => r.cycleDays).filter((d) => d !== null));
  return {
    total: list.length,
    active,
    delivered,
    discarded,
    converted,
    notConverted,
    resolved,
    conversionPct: pctOf(converted, resolved),
    avgCycleDays: cycle(list.filter((r) => r.outcome !== "active")),
    avgConversionDays: cycle(list.filter((r) => r.outcome === "converted")),
    revisionsTotal,
    revisionsAvg: list.length ? round1(revisionsTotal / list.length) : null,
  };
}

/**
 * Efectividad por Comercial: una fila por comercial (y «Sin comercial» si hay) con sus totales, ordenada por %
 * de éxito (de más a menos; sin resueltas, al final), y a igualdad por más ofertas resueltas. `lowSample`: menos
 * de MIN_RELIABLE_SAMPLE ofertas resueltas (el % engaña con tan pocas).
 */
export function commercialRanking(records) {
  const groups = new Map();
  for (const r of records || []) {
    const key = r.commercialKey || NO_COMMERCIAL_VALUE;
    if (!groups.has(key)) groups.set(key, { key, name: r.commercialKey ? r.commercial : NO_COMMERCIAL_LABEL, records: [] });
    groups.get(key).records.push(r);
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, name: g.name, ...summarizeOffers(g.records) }))
    .map((row) => ({ ...row, lowSample: row.resolved < MIN_RELIABLE_SAMPLE }))
    .sort((a, b) => (b.conversionPct ?? -1) - (a.conversionPct ?? -1) || b.resolved - a.resolved || b.total - a.total || a.name.localeCompare(b.name, "es"));
}

/**
 * Evolución de las ofertas: con un año elegido, los 12 meses de ese año (por mes de creación); con «todos los
 * años», un punto por año. Respeta el filtro de Comercial pero NO el de mes (se ve el año entero y el mes
 * elegido solo se resalta). `undated`: ofertas del filtro cuyo mes no se conoce (solo se sabe el año por su ID).
 * @returns {{ kind: "month"|"year", rows: Array<{key, label, total, active, converted, notConverted, resolved, conversionPct}>, undated: number }}
 */
export function evolutionSeries(records, { commercial = "", year = "" } = {}) {
  const base = applyOfferFilters(records, { commercial, year });
  const row = (key, label, rs) => { const s = summarizeOffers(rs); return { key, label, total: s.total, active: s.active, converted: s.converted, notConverted: s.notConverted, resolved: s.resolved, conversionPct: s.conversionPct }; };
  if (year !== "" && year !== null && year !== undefined) {
    const rows = MONTH_SHORT.map((label, i) => row(i + 1, label, base.filter((r) => r.month === i + 1)));
    return { kind: "month", rows, undated: base.filter((r) => !r.month).length };
  }
  const years = [...new Set(base.filter((r) => r.year).map((r) => r.year))].sort((a, b) => a - b);
  return { kind: "year", rows: years.map((y) => row(y, String(y), base.filter((r) => r.year === y))), undated: base.filter((r) => !r.year).length };
}

/** Cuántas ofertas hay en cada sección de Ofertas ahora (solo las que siguen como tarea; las leídas del proyecto no tienen sección). */
export function sectionBreakdown(records, offersProject) {
  if (!offersProject) return [];
  const sections = (offersProject.sections || []).map((s) => ({ id: s.id, name: s.name || "(sin nombre)", count: 0 }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  let none = 0;
  for (const r of records || []) {
    if (r.source !== "offer") continue;
    const s = r.sectionId && byId.get(r.sectionId);
    if (s) s.count++; else none++;
  }
  if (none) sections.unshift({ id: "", name: "Sin sección", count: none });
  return sections;
}

// ---------------------------------------------------------------- revisiones ↔ cierre

/** Los tramos de la matriz «Impacto de las revisiones en el cierre». */
export const REVISION_BUCKETS = [
  { key: "0", label: "0 revisiones (a la primera)", min: 0, max: 0 },
  { key: "1", label: "1 revisión", min: 1, max: 1 },
  { key: "2", label: "2 revisiones", min: 2, max: 2 },
  { key: "3+", label: "3 o más revisiones", min: 3, max: Infinity },
];

/** El tramo (key) que le corresponde a un número de revisiones. */
export const revisionBucketKey = (n) => (REVISION_BUCKETS.find((b) => n >= b.min && n <= b.max) || REVISION_BUCKETS[0]).key;

/**
 * La correlación revisiones ↔ cierre: por tramo, ofertas totales, convertidas (ganadas), sin convertir, en
 * curso, % de éxito (sobre las resueltas) y media de días de ciclo (de las ya cerradas).
 */
export function revisionCorrelation(records) {
  return REVISION_BUCKETS.map((b) => {
    const rs = (records || []).filter((r) => revisionBucketKey(r.revisions) === b.key);
    const s = summarizeOffers(rs);
    return { key: b.key, label: b.label, total: s.total, converted: s.converted, notConverted: s.notConverted, active: s.active, resolved: s.resolved, conversionPct: s.conversionPct, avgDays: s.avgCycleDays };
  });
}

const fmtPct = (n) => `${n}%`;
const fmtD = (n) => String(n).replace(".", ",");

/**
 * El resumen automático e interpretable de la correlación: compara las ofertas aprobadas «a la primera» con las
 * que pasaron por alguna revisión (y, si hay datos, las de 3 o más con las de 1-2).
 * @returns {{ direction: "first"|"revised"|"equal"|"unknown", diffPts: number|null, reliable: boolean, summary: string, details: string[] }}
 *   `direction`: «first» = se cierran más las de a la primera; «revised» = más las revisadas; «equal»: diferencia
 *   de menos de 5 puntos; «unknown»: falta alguno de los dos grupos con ofertas resueltas.
 */
export function revisionInsight(buckets) {
  const by = new Map((buckets || []).map((b) => [b.key, b]));
  const first = by.get("0") || { resolved: 0, converted: 0, total: 0, avgDays: null };
  const revisedBuckets = ["1", "2", "3+"].map((k) => by.get(k)).filter(Boolean);
  const revised = {
    total: revisedBuckets.reduce((a, b) => a + b.total, 0),
    resolved: revisedBuckets.reduce((a, b) => a + b.resolved, 0),
    converted: revisedBuckets.reduce((a, b) => a + b.converted, 0),
  };
  const details = [];
  if (!first.resolved || !revised.resolved) {
    return {
      direction: "unknown", diffPts: null, reliable: false,
      summary: "Todavía no hay ofertas resueltas en los dos grupos (sin revisiones y con revisiones) para compararlos.",
      details,
    };
  }
  const pctFirst = pctOf(first.converted, first.resolved);
  const pctRevised = pctOf(revised.converted, revised.resolved);
  const diff = pctFirst - pctRevised;
  const reliable = first.resolved >= MIN_RELIABLE_SAMPLE && revised.resolved >= MIN_RELIABLE_SAMPLE;
  let direction, summary;
  if (Math.abs(diff) < 5) {
    direction = "equal";
    summary = `Revisar una oferta no cambia de forma apreciable su cierre: ${fmtPct(pctFirst)} de éxito a la primera frente a ${fmtPct(pctRevised)} con revisiones.`;
  } else if (diff > 0) {
    direction = "first";
    summary = `Las ofertas aprobadas a la primera se cierran más: ${fmtPct(pctFirst)} de éxito frente a ${fmtPct(pctRevised)} de las que pasan por revisiones (${Math.abs(diff)} puntos más).`;
  } else {
    direction = "revised";
    summary = `Las ofertas con revisiones se cierran más: ${fmtPct(pctRevised)} de éxito frente a ${fmtPct(pctFirst)} de las aprobadas a la primera (${Math.abs(diff)} puntos más).`;
  }
  const low = by.get("1"), mid = by.get("2"), high = by.get("3+");
  const lowMid = { resolved: (low ? low.resolved : 0) + (mid ? mid.resolved : 0), converted: (low ? low.converted : 0) + (mid ? mid.converted : 0) };
  if (high && high.resolved && lowMid.resolved) {
    const pHigh = pctOf(high.converted, high.resolved);
    const pLow = pctOf(lowMid.converted, lowMid.resolved);
    details.push(
      Math.abs(pHigh - pLow) < 5
        ? `Con 3 o más revisiones el éxito es ${fmtPct(pHigh)}, parecido al de 1-2 revisiones (${fmtPct(pLow)}).`
        : pHigh < pLow
          ? `Con 3 o más revisiones el éxito baja a ${fmtPct(pHigh)} (con 1-2 revisiones es ${fmtPct(pLow)}): a partir de la tercera, la oferta tiende a no cerrarse.`
          : `Con 3 o más revisiones el éxito sube a ${fmtPct(pHigh)} (con 1-2 revisiones es ${fmtPct(pLow)}): insistir con el cliente compensa.`
    );
  }
  const closedDays = revisedBuckets.filter((b) => b.avgDays !== null && b.resolved);
  if (first.avgDays !== null && closedDays.length) {
    const num = closedDays.reduce((a, b) => a + b.avgDays * b.resolved, 0);
    const den = closedDays.reduce((a, b) => a + b.resolved, 0);
    const avgRevised = round1(num / den);
    const gap = round1(avgRevised - first.avgDays);
    if (Math.abs(gap) >= 1) details.push(`Las ofertas con revisiones tardan de media ${fmtD(avgRevised)} días en cerrarse, ${fmtD(Math.abs(gap))} ${gap > 0 ? "más" : "menos"} que las de a la primera (${fmtD(first.avgDays)} días).`);
  }
  if (!reliable) details.push(`Muestra pequeña (menos de ${MIN_RELIABLE_SAMPLE} ofertas resueltas en algún grupo): toma esta lectura con cautela.`);
  return { direction, diffPts: diff, reliable, summary, details };
}
