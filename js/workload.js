// ============================================================================
// Carga de trabajo por persona (v79) — LÓGICA PURA: sin DOM ni Firebase (usa
// work-calendar.js y departments.js). La pinta timeline-view.js («Agrupar por:
// Persona (carga)» de la línea de tiempo global).
//
// Para qué: ver la carga y la capacidad del equipo en el tiempo SIN que nadie
// imputa horas. Solo se usan datos que ya existen: las tareas asignadas con sus
// fechas, y el calendario laboral (festivos y ausencias, v78).
//
// Reglas:
//  · QUIÉN SE VE (workloadWorkers): el mismo alcance por departamento que
//    Métricas (v77, metricsScopeFor): un admin ve a todos y puede acotar por
//    departamento; el resto, solo a las personas de su GRUPO de departamento
//    (los dos Diseño van juntos); sin departamento reconocido, solo a sí mismo
//    (verse a uno mismo no enseña nada ajeno). No salen las cuentas borradas ni
//    las ficticias de la importación de Asana.
//  · TAREA ACTIVA = sin completar y que no sea un hito (un hito es un punto, no
//    ocupa tiempo). Ocupa cada día de su rango inicio→límite; con una sola fecha
//    ocupa solo ese día. Solo cuentan los días LABORABLES de esa persona (no
//    fines de semana, festivos ni sus ausencias): una tarea larga que cruza unas
//    vacaciones no «carga» esos días.
//  · SATURACIÓN de un día: nivel según tareas activas — 1-2 «ok», ≥3
//    (OVERLOAD_THRESHOLD) «high», ≥5 «critical».
//  · ENTREGAS SIMULTÁNEAS: ≥2 tareas de la misma persona con la misma fecha límite.
//  · ENTREGA EN AUSENCIA: inicio o límite de una tarea en un día en que esa
//    persona está de vacaciones/ausente (taskCalendarIssues, v78).
//  · Los totales de la cabecera de cada persona (`stats`) miran de HOY en
//    adelante: lo pasado ya no se puede mover.
// ============================================================================
import { metricsScopeFor, memberMatchesDepartmentFilter } from "./departments.js";
import { dateKey, parseDateKey, isWeekend, isWorkingDay, getHoliday, getAbsence, taskCalendarIssues, formatDayMonth, ABSENCE_TYPES } from "./work-calendar.js";

/** Tareas activas el mismo día a partir de las cuales una persona está saturada. */
export const OVERLOAD_THRESHOLD = 3;
/** Con este número de tareas activas el mismo día, la saturación es crítica. */
export const CRITICAL_THRESHOLD = 5;
/** Entregas (fecha límite) el mismo día de una misma persona a partir de las cuales se avisa. */
export const CLASH_THRESHOLD = 2;

const step = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Tope de días recorridos por tarea (una tarea con un rango absurdo no debe colgar la vista). */
const MAX_TASK_DAYS = 1500;

/** Nivel de saturación de un día con `active` tareas activas: 'none' | 'ok' | 'high' | 'critical'. */
export function loadLevel(active) {
  if (!active) return "none";
  if (active >= CRITICAL_THRESHOLD) return "critical";
  if (active >= OVERLOAD_THRESHOLD) return "high";
  return "ok";
}

/**
 * Las personas que `viewer` puede ver en la carga. `departmentFilter`: el filtro de
 * departamento que elige un admin (ver metricsScopeFor; los demás roles lo ignoran).
 * Ordenadas por nombre.
 */
export function workloadWorkers({ viewer, members, departmentFilter }) {
  if (!viewer) return [];
  const scope = metricsScopeFor(viewer, departmentFilter);
  return (members || [])
    .filter((m) => m && m.uid && !m.deleted && !m.isImported)
    .filter((m) => memberMatchesDepartmentFilter(m, scope) || (viewer.role !== "admin" && m.uid === viewer.uid))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/** ¿Ocupa tiempo? (sin completar y no es un hito) */
export const isLoadTask = (t) => !!t && !t.isComplete && !t.isMilestone;

/** El rango de días de una tarea como `{ s, e }` ('YYYY-MM-DD'), o null sin fechas. Con las fechas al revés, las endereza. */
export function taskDayRange(task) {
  const a = dateKey(task && task.startDate);
  const b = dateKey(task && task.dueDate);
  if (!a && !b) return null;
  if (!a || !b) return { s: a || b, e: a || b };
  return a <= b ? { s: a, e: b } : { s: b, e: a };
}

/**
 * La carga de UNA persona.
 *   uid, tasks (las tareas candidatas: se quedan las asignadas a `uid`), cfg (calendario laboral),
 *   from / to ('YYYY-MM-DD', opcional: solo se calculan los días de esa ventana), today (Date)
 * Devuelve:
 *   tasks    sus tareas sin completar CON fecha, ordenadas por fecha ({ task, issues, hot })
 *   undated  cuántas tareas sin completar no tienen ninguna fecha (no se pueden situar)
 *   days     Map 'YYYY-MM-DD' → { active, ids[], due[] }  (solo días laborables para `active`)
 *   stats    { peak, overloadDays, clashDays, absenceClashes, activeTasks, status: 'ok'|'warn'|'alert' }
 */
export function personWorkload({ uid, tasks, cfg, from, to, today = new Date() }) {
  const mine = (tasks || []).filter((t) => t && !t.isComplete && Array.isArray(t.assigneeIds) && t.assigneeIds.includes(uid));
  const undated = mine.filter((t) => !taskDayRange(t)).length;
  const dated = mine.filter((t) => taskDayRange(t));
  const days = new Map();
  const slot = (k) => { let v = days.get(k); if (!v) { v = { active: 0, ids: [], due: [] }; days.set(k, v); } return v; };

  for (const t of dated) {
    const dueKey = dateKey(t.dueDate);
    if (isLoadTask(t) && dueKey && (!from || dueKey >= from) && (!to || dueKey <= to)) slot(dueKey).due.push(t.id);
    if (!isLoadTask(t)) continue;
    const r = taskDayRange(t);
    let n = 0;
    for (let d = parseDateKey(r.s); dateKey(d) <= r.e && n < MAX_TASK_DAYS; d = step(d, 1), n++) {
      const k = dateKey(d);
      if (from && k < from) continue;
      if (to && k > to) break;
      if (!isWorkingDay(d, cfg, uid)) continue;
      const v = slot(k);
      v.active++;
      v.ids.push(t.id);
    }
  }

  const todayKey = dateKey(today);
  const hotIds = new Set();
  let peak = 0, overloadDays = 0, clashDays = 0;
  for (const [k, v] of days) {
    if (v.active >= OVERLOAD_THRESHOLD) v.ids.forEach((id) => hotIds.add(id));
    if (k < todayKey) continue;
    peak = Math.max(peak, v.active);
    if (v.active >= OVERLOAD_THRESHOLD) overloadDays++;
    if (v.due.length >= CLASH_THRESHOLD) clashDays++;
  }

  const rows = dated
    .map((task) => ({ task, issues: taskCalendarIssues(task, cfg, [uid]), hot: hotIds.has(task.id) }))
    .sort((a, b) => {
      const ra = taskDayRange(a.task), rb = taskDayRange(b.task);
      return ra.s < rb.s ? -1 : ra.s > rb.s ? 1 : ra.e < rb.e ? -1 : ra.e > rb.e ? 1 : 0;
    });
  // Entregas en ausencia: inicio o límite en un día de ausencia de esta persona, de hoy en adelante.
  const absenceClashes = rows.filter(({ task, issues }) => {
    if (!isLoadTask(task) && !task.isMilestone) return false;
    const r = taskDayRange(task);
    return r.e >= todayKey && issues.some((i) => i.kind === "absence");
  }).length;

  const status = peak >= CRITICAL_THRESHOLD || absenceClashes > 0 ? "alert" : overloadDays > 0 || clashDays > 0 ? "warn" : "ok";
  return {
    tasks: rows,
    undated,
    days,
    stats: { peak, overloadDays, clashDays, absenceClashes, activeTasks: dated.filter(isLoadTask).length, status },
  };
}

/**
 * Resumen de una columna del eje temporal (`start`..`end`, Date) para una persona: pico de tareas
 * activas, entregas simultáneas y cuánto de la columna es festivo o ausencia.
 *   → { peak, level, clash, weekdays, holidays, absent, absence }
 * `holidays` y `absent` cuentan días ENTRE SEMANA (los fines de semana no son «ausencia»);
 * `absence` es la primera ausencia que toca la columna (para el tooltip).
 */
export function columnSummary(workload, uid, col, cfg) {
  let peak = 0, clash = false, weekdays = 0, holidays = 0, absent = 0, absence = null, holiday = null;
  for (let d = col.start; d <= col.end; d = step(d, 1)) {
    const v = workload.days.get(dateKey(d));
    if (v) {
      peak = Math.max(peak, v.active);
      if (v.due.length >= CLASH_THRESHOLD) clash = true;
    }
    if (isWeekend(d)) continue;
    weekdays++;
    const h = getHoliday(d, cfg);
    if (h) { holidays++; holiday = holiday || h; continue; }
    const a = getAbsence(uid, d, cfg);
    if (a) { absent++; absence = absence || a; }
  }
  return { peak, level: loadLevel(peak), clash, weekdays, holidays, absent, absence, holiday };
}

/** «Vacaciones 22/06–26/06» (con la nota solo si `withNote`). */
export function describeAbsence(absence, withNote = false) {
  if (!absence) return "";
  const kind = ABSENCE_TYPES[absence.type] || "Ausencia";
  const range = absence.startDate === absence.endDate ? formatDayMonth(absence.startDate) : `${formatDayMonth(absence.startDate)}–${formatDayMonth(absence.endDate)}`;
  return `${kind} ${range}${withNote && absence.note ? ` (${absence.note})` : ""}`;
}

/** El texto del indicador de la cabecera de una persona: «⚠ 2 días saturados · 1 entrega en ausencia», o «» si todo va bien. */
export function describeStats(stats) {
  const parts = [];
  if (stats.overloadDays) parts.push(`${stats.overloadDays} ${stats.overloadDays === 1 ? "día saturado" : "días saturados"} (pico ${stats.peak})`);
  if (stats.clashDays) parts.push(`${stats.clashDays} ${stats.clashDays === 1 ? "día con entregas simultáneas" : "días con entregas simultáneas"}`);
  if (stats.absenceClashes) parts.push(`${stats.absenceClashes} ${stats.absenceClashes === 1 ? "tarea con fecha en ausencia" : "tareas con fecha en ausencia"}`);
  return parts.join(" · ");
}
