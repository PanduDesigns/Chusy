// ============================================================================
// Creación Rápida — fechas en DÍAS LABORABLES (v79). LÓGICA PURA: sin DOM ni
// Firebase (solo usa work-calendar.js), así se prueba suelta en Node.
//
// Hasta la v78, «Insertar producto» sumaba días NATURALES: inserción + N días,
// con tope en la fecha de entrega. Una tarea de «3 días» insertada un jueves
// vencía el domingo, y nadie miraba si caía en festivo o en las vacaciones de
// quien la tiene asignada. Ahora cada fecha sale del calendario laboral
// (js/work-calendar.js) y de las personas asignadas a ESA tarea.
//
// Reglas de planTaskDates():
//  · Un día vale si NO es fin de semana, NO es festivo y NINGUNA de las personas
//    asignadas está ausente (sin nadie asignado cuenta solo la empresa).
//  · INICIO: hoy si es laborable; si no, el siguiente laborable.
//  · FECHA LÍMITE de una tarea con `durationDays` = N: N días laborables DESPUÉS
//    del inicio (como WORKDAY de Excel; 0 = el mismo día de inicio). Nunca más
//    allá de la entrega: el tope es el último día laborable ≤ fecha de entrega.
//  · Sin `durationDays`, y la tarea principal de cada producto: la fecha de
//    entrega, y si esa fecha no es laborable, el último laborable ANTERIOR (nunca
//    se pasa de la fecha que el usuario eligió: se adelanta).
//  · Si entre el inicio y el tope no hay ni un día laborable, la fecha límite
//    es el propio inicio y se marca `overrun` (se pasa de la entrega): es lo más
//    honesto que se puede hacer, y la vista previa lo enseña.
//  · `skipped`: los festivos y ausencias (entre semana) que el cálculo ha tenido
//    que saltar, para el pequeño indicador de la vista previa. Los fines de
//    semana no cuentan como «saltados»: son lo normal.
// ============================================================================
import { nextWorkingDay, previousWorkingDay, addWorkingDays, dateKey, parseDateKey, isWeekend, getHoliday, getAbsence, formatDayMonth } from "./work-calendar.js";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const toIdList = (ids) => (Array.isArray(ids) ? ids : ids ? [ids] : []).filter(Boolean);
/** Cualquier fecha → Date local a medianoche (o null). */
const day = (v) => { const k = dateKey(v); return k ? parseDateKey(k) : null; };
const step = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** «vie 12/06» (vacío si la fecha no vale). */
export function formatPlanDate(value) {
  const d = day(value);
  return d ? `${DIAS[d.getDay()]} ${formatDayMonth(d)}` : "";
}

/** Festivos y ausencias (entre semana) de [from, to], los dos incluidos. */
function skippedBetween(from, to, ids, cfg) {
  const out = [];
  if (!from || !to) return out;
  for (let d = from; d <= to; d = step(d, 1)) {
    if (isWeekend(d)) continue;
    const holiday = getHoliday(d, cfg);
    if (holiday) { out.push({ date: dateKey(d), kind: "holiday", name: holiday.name }); continue; }
    for (const id of ids) {
      const absence = getAbsence(id, d, cfg);
      if (absence) out.push({ date: dateKey(d), kind: "absence", userId: id, type: absence.type });
    }
  }
  return out;
}

/**
 * Fechas de UNA tarea de Creación Rápida.
 *   insertionDate  el día en que se inserta (hoy)
 *   deliveryDate   la fecha de entrega del producto (puede faltar: entonces no hay tope)
 *   durationDays   los «días necesarios» de la plantilla (número ≥ 0) o null/undefined
 *   assigneeIds    las personas asignadas a esta tarea ([] = solo la empresa)
 *   isMain         la tarea principal (su fecha límite es la entrega, sin duración)
 *   cfg            el calendario laboral (puede ser null)
 * Devuelve { start, due (Date), startKey, dueKey ('YYYY-MM-DD'), skipped, startShifted,
 *            dueAdjusted, overrun, failed }.
 */
export function planTaskDates({ insertionDate, deliveryDate, durationDays, assigneeIds, isMain = false, cfg }) {
  const ids = toIdList(assigneeIds);
  const ins = day(insertionDate);
  const deliv = day(deliveryDate);
  const result = (start, due, extra) => ({
    start, due, startKey: dateKey(start), dueKey: dateKey(due), skipped: [], startShifted: false,
    dueAdjusted: false, overrun: false, failed: false, ...extra,
  });
  if (!ins) return result(null, null, { failed: true });

  const start = nextWorkingDay(ins, cfg, ids);
  // Sin ningún día laborable en ~10 años (todo festivo o ausente): se deja como estaba, avisando.
  if (!start) return result(ins, deliv || ins, { failed: true });

  const cap = deliv ? previousWorkingDay(deliv, cfg, ids) : null;
  const fromDelivery = isMain || durationDays === null || durationDays === undefined || !Number.isFinite(Number(durationDays));
  let due;
  let capped = false; // la duración se pasaba de la entrega y se recortó a ella
  if (fromDelivery) {
    due = deliv ? cap : start; // sin entrega y sin duración no hay nada que calcular: el propio inicio
  } else {
    const n = Math.max(0, Math.trunc(Number(durationDays)));
    const candidate = n === 0 ? start : addWorkingDays(start, n, cfg, ids);
    capped = !!(candidate && cap && candidate > cap);
    due = capped ? cap : candidate;
  }
  let overrun = false;
  if (!due || due < start) { // entre el inicio y la entrega no cabe ni un día laborable
    due = start;
    overrun = !!deliv && start > deliv;
  }

  // Si la fecha límite sale de la entrega y no coincide con ella, es porque se ha adelantado.
  const dueAdjusted = !!deliv && (fromDelivery || capped) && !overrun && due.getTime() !== deliv.getTime();
  const skippedTo = dueAdjusted ? deliv : due;
  return result(start, due, {
    skipped: skippedBetween(ins, skippedTo, ids, cfg),
    startShifted: start.getTime() !== ins.getTime(),
    dueAdjusted,
    overrun,
  });
}

/**
 * Una línea corta con lo que se ha saltado, p. ej. «festivo San Juan (24/06) · vacaciones de Ana
 * (22/06, 23/06)». `nameOf(userId)` pone el nombre de la persona. «» si no se ha saltado nada.
 */
export function describeSkipped(skipped, nameOf) {
  if (!skipped || !skipped.length) return "";
  const parts = [];
  const holidays = skipped.filter((s) => s.kind === "holiday");
  if (holidays.length) parts.push(`festivo${holidays.length > 1 ? "s" : ""} ${holidays.map((h) => `${h.name} (${formatDayMonth(h.date)})`).join(", ")}`);
  const byPerson = new Map();
  for (const s of skipped) if (s.kind === "absence") byPerson.set(`${s.userId}|${s.type}`, [...(byPerson.get(`${s.userId}|${s.type}`) || []), s]);
  for (const list of byPerson.values()) {
    const who = (nameOf && nameOf(list[0].userId)) || "un responsable";
    const kind = list[0].type === "vacaciones" ? "vacaciones" : "ausencia";
    parts.push(`${kind} de ${who} (${list.map((s) => formatDayMonth(s.date)).join(", ")})`);
  }
  return parts.join(" · ");
}
