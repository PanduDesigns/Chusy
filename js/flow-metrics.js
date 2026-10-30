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
// Quién ve qué (alcance por departamento/Responsable) se decide fuera: estas
// funciones reciben las tareas que ya se pueden ver.
// ============================================================================
import { toDate, getTaskSectionForProject } from "./utils.js";
import { countWorkingDays } from "./work-calendar.js";

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
