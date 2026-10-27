// Fechas laborables de Creación Rápida (v79): planTaskDates / describeSkipped / previousWorkingDay.
import { check, eq, done } from "./support/assert.mjs";
import { planTaskDates, describeSkipped, formatPlanDate } from "../js/quick-create-schedule.js";
import { normalizeWorkCalendar, previousWorkingDay, dateKey, isWorkingDay, parseDateKey } from "../js/work-calendar.js";

// Noviembre de 2026: jue 5, vie 6, sáb 7, dom 8, lun 9, mar 10, mié 11, jue 12, vie 13.
const wd = (k) => parseDateKey(k).getDay();
check("calendario de partida: 5/11/2026 es jueves", wd("2026-11-05") === 4);
check("… y 7/11 sábado", wd("2026-11-07") === 6);

const EMPTY = normalizeWorkCalendar({ holidays: [], absences: [] });
const cal = (holidays = [], absences = []) => normalizeWorkCalendar({
  holidays: holidays.map((date, i) => ({ id: "h" + i, date, name: "Fiesta " + date.slice(8), scope: "empresa" })),
  absences: absences.map(([userId, startDate, endDate, type], i) => ({ id: "a" + i, userId, startDate, endDate, type: type || "vacaciones", note: "" })),
});
const plan = (o) => planTaskDates({ insertionDate: "2026-11-05", deliveryDate: "2026-12-31", cfg: EMPTY, ...o });

// --- previousWorkingDay
eq("previousWorkingDay: un sábado → el viernes", dateKey(previousWorkingDay("2026-11-07", EMPTY)), "2026-11-06");
eq("previousWorkingDay: un laborable devuelve el mismo día", dateKey(previousWorkingDay("2026-11-05", EMPTY)), "2026-11-05");
eq("previousWorkingDay: sábado + lunes festivo… sigue hacia atrás", dateKey(previousWorkingDay("2026-11-09", cal(["2026-11-09"]))), "2026-11-06");
eq("previousWorkingDay: fecha inválida → null", previousWorkingDay("nope", EMPTY), null);

// --- N días laborables (antes: naturales)
let r = plan({ durationDays: 3 });
eq("3 días desde un jueves → el martes (antes: domingo)", r.dueKey, "2026-11-10");
eq("… empieza hoy", r.startKey, "2026-11-05");
check("… sin avisos", !r.skipped.length && !r.overrun && !r.dueAdjusted && !r.startShifted);
eq("1 día desde un jueves → viernes", plan({ durationDays: 1 }).dueKey, "2026-11-06");
eq("2 días desde un jueves → el lunes", plan({ durationDays: 2 }).dueKey, "2026-11-09");
eq("0 días = el mismo día", plan({ durationDays: 0 }).dueKey, "2026-11-05");
r = plan({ insertionDate: "2026-11-07", durationDays: 0 });
eq("0 días insertado un sábado → el lunes (siguiente laborable)", [r.startKey, r.dueKey], ["2026-11-09", "2026-11-09"]);
check("… y avisa de que el inicio se movió", r.startShifted);
r = plan({ insertionDate: "2026-11-07", durationDays: 1 });
eq("1 día insertado un sábado → martes (cuenta desde el inicio laborable)", [r.startKey, r.dueKey], ["2026-11-09", "2026-11-10"]);

// --- festivos de la empresa
r = plan({ durationDays: 3, cfg: cal(["2026-11-09"]) });
eq("lunes festivo: 3 días desde el jueves → el miércoles", r.dueKey, "2026-11-11");
eq("… y lo anota como saltado", r.skipped.map((s) => [s.date, s.kind]), [["2026-11-09", "holiday"]]);
r = plan({ durationDays: 3, cfg: cal(["2026-11-14"]) });
check("un festivo en sábado no se anota (ya era fin de semana)", !r.skipped.length);

// --- ausencias de quien tiene la tarea
const vac = cal([], [["ana", "2026-11-06", "2026-11-10"]]);
r = plan({ durationDays: 2, cfg: vac, assigneeIds: ["ana"] });
eq("Ana de vacaciones vie-mar: 2 días → jue 12 (miércoles 11 es el 1.º, jueves el 2.º)", r.dueKey, "2026-11-12");
eq("… anota la ausencia de Ana en los 3 días laborables que se salta", r.skipped.map((s) => s.date), ["2026-11-06", "2026-11-09", "2026-11-10"]);
check("… todas son de Ana y de tipo vacaciones", r.skipped.every((s) => s.kind === "absence" && s.userId === "ana" && s.type === "vacaciones"));
r = plan({ durationDays: 2, cfg: vac, assigneeIds: ["luis"] });
eq("la misma tarea para Luis (sin ausencia) no cambia", r.dueKey, "2026-11-09");
r = plan({ durationDays: 2, cfg: vac, assigneeIds: ["luis", "ana"] });
eq("con Ana y Luis, manda la ausencia de Ana", r.dueKey, "2026-11-12");
eq("sin responsables solo cuenta la empresa", plan({ durationDays: 2, cfg: vac }).dueKey, "2026-11-09");
r = plan({ durationDays: 0, cfg: cal([], [["ana", "2026-11-05", "2026-11-06"]]), assigneeIds: ["ana"] });
eq("0 días con Ana ausente hoy y mañana → el lunes", [r.startKey, r.dueKey], ["2026-11-09", "2026-11-09"]);

// --- tope en la fecha de entrega
r = plan({ durationDays: 10, deliveryDate: "2026-11-10" });
eq("la duración se pasa de la entrega → se recorta a ella", r.dueKey, "2026-11-10");
r = plan({ durationDays: 10, deliveryDate: "2026-11-08" });
eq("entrega en domingo y duración larga → viernes anterior", r.dueKey, "2026-11-06");
check("… marcada como adelantada", r.dueAdjusted && !r.overrun);
r = plan({ durationDays: null, deliveryDate: "2026-11-11" });
eq("sin duración: la entrega tal cual si es laborable", r.dueKey, "2026-11-11");
check("… sin marcas", !r.dueAdjusted);
r = plan({ isMain: true, durationDays: 2, deliveryDate: "2026-11-14" });
eq("tarea principal: va a la entrega, no a su duración, y un sábado pasa al viernes", r.dueKey, "2026-11-13");
check("… adelantada", r.dueAdjusted);
r = plan({ isMain: true, deliveryDate: "2026-11-11", cfg: cal(["2026-11-11"]) });
eq("entrega en festivo → el laborable anterior", r.dueKey, "2026-11-10");
eq("… y lo anota", r.skipped.map((s) => s.date), ["2026-11-11"]);

// --- imposible: no cabe ningún día laborable antes de la entrega
r = plan({ insertionDate: "2026-11-07", deliveryDate: "2026-11-08", durationDays: 1 });
check("insertado el sábado con entrega el domingo → se pasa", r.overrun && r.dueKey === "2026-11-09" && r.startKey === "2026-11-09");
r = plan({ deliveryDate: "2026-11-06", cfg: cal([], [["ana", "2026-11-05", "2026-11-13"]]), assigneeIds: ["ana"], durationDays: 1 });
check("Ana ausente hasta después de la entrega → se pasa, con el inicio en su vuelta", r.overrun && r.startKey === "2026-11-16");
r = plan({ deliveryDate: "2026-11-01", durationDays: 2 });
check("fecha de entrega ya pasada → se pasa y no se inventa nada anterior a hoy", r.overrun && r.dueKey === r.startKey);
r = plan({ deliveryDate: null, durationDays: 2 });
eq("sin fecha de entrega, solo cuenta la duración", r.dueKey, "2026-11-09");
r = plan({ insertionDate: "garbage" });
check("inserción inválida → failed, sin explotar", r.failed && r.startKey === null);

// --- barrido: da igual el caso, lo que sale es siempre un día válido
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const base = Date.UTC(2026, 10, 1);
const iso = (off) => dateKey(new Date(base + off * 86400000));
let bad = 0, total = 0;
for (let i = 0; i < 600; i++) {
  const people = ["a", "b", "c"].slice(0, rnd(4));
  const hol = Array.from({ length: rnd(5) }, () => iso(rnd(60)));
  const abs = Array.from({ length: rnd(4) }, () => { const s = rnd(50); return [["a", "b", "c"][rnd(3)], iso(s), iso(s + rnd(8))]; });
  const cfg = cal(hol, abs);
  const o = { insertionDate: iso(rnd(30)), deliveryDate: iso(rnd(70)), durationDays: rnd(3) === 0 ? null : rnd(12), assigneeIds: people, isMain: rnd(5) === 0, cfg };
  const p = planTaskDates(o);
  total++;
  const okDays = isWorkingDay(p.start, cfg, people) && isWorkingDay(p.due, cfg, people);
  const order = p.due >= p.start;
  const withinDelivery = p.overrun || p.dueKey <= o.deliveryDate;
  if (!(okDays && order && withinDelivery && p.start >= parseDateKey(o.insertionDate))) { bad++; if (bad < 4) console.error("  contraejemplo", JSON.stringify({ o: { ...o, cfg: undefined }, p: { s: p.startKey, d: p.dueKey, ov: p.overrun } })); }
}
eq(`barrido de ${total} combinaciones al azar: todas dan días laborables válidos, en orden y sin pasarse (salvo aviso)`, bad, 0);

// --- textos
const nameOf = (u) => ({ ana: "Ana" }[u]);
eq("describeSkipped: vacío si no hay nada", describeSkipped([], nameOf), "");
const d = describeSkipped(plan({ durationDays: 3, cfg: cal(["2026-11-09"], [["ana", "2026-11-06", "2026-11-06"]]), assigneeIds: ["ana"] }).skipped, nameOf);
check("describeSkipped nombra el festivo y las vacaciones de Ana", d.includes("festivo Fiesta 09 (09/11)") && d.includes("vacaciones de Ana (06/11)"), d);
eq("formatPlanDate", formatPlanDate("2026-11-10"), "mar 10/11");
eq("formatPlanDate inválida", formatPlanDate("x"), "");

done("Creación Rápida · fechas laborables");
