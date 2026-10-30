// Carga por persona (v79) — lógica pura de js/workload.js: quién se ve (departamentos), cómo se cuenta
// la carga por día, saturación, entregas simultáneas, entregas en ausencia y resumen por columna.
import { check, eq, done } from "./support/assert.mjs";
import { workloadWorkers, resolveTimelineGroupBy, personWorkload, columnSummary, loadLevel, taskDayRange, describeStats, describeAbsence, OVERLOAD_THRESHOLD } from "../js/workload.js";
import { normalizeWorkCalendar } from "../js/work-calendar.js";
import { canViewWorkload, isDepartmentHead } from "../js/departments.js";

const D = (k) => new Date(k + "T12:00:00");
// Noviembre de 2026: lun 2, mar 3, mié 4, jue 5, vie 6, sáb 7, dom 8, lun 9, mar 10, mié 11, jue 12, vie 13.
const cfg = normalizeWorkCalendar({
  holidays: [{ id: "h1", date: "2026-11-09", name: "Fiesta local", scope: "local" }],
  absences: [{ id: "a1", userId: "ana", startDate: "2026-11-11", endDate: "2026-11-12", type: "vacaciones", note: "boda" }],
});
const t = (id, start, due, extra = {}) => ({ id, title: id, startDate: start, dueDate: due, assigneeIds: ["ana"], isComplete: false, isMilestone: false, ...extra });

// ---------------------------------------------------------------- nivel
eq("loadLevel", [0, 1, 2, 3, 4, 5, 9].map(loadLevel), ["none", "ok", "ok", "high", "high", "critical", "critical"]);
check("el umbral de saturación es 3", OVERLOAD_THRESHOLD === 3);

// ---------------------------------------------------------------- rango de una tarea
eq("rango con las dos fechas", taskDayRange(t("x", "2026-11-03", "2026-11-05")), { s: "2026-11-03", e: "2026-11-05" });
eq("rango con una sola fecha = ese día", taskDayRange(t("x", null, "2026-11-05")), { s: "2026-11-05", e: "2026-11-05" });
eq("fechas al revés se enderezan", taskDayRange(t("x", "2026-11-05", "2026-11-03")), { s: "2026-11-03", e: "2026-11-05" });
eq("sin fechas → null", taskDayRange(t("x", null, null)), null);

// ---------------------------------------------------------------- quién se ve
const members = [
  { uid: "admin", name: "Admin", role: "admin" },
  { uid: "ana", name: "Ana", role: "member", department: "tecnicos", isDepartmentHead: true }, // v81: Responsable de Técnicos
  { uid: "bea", name: "Bea", role: "member", department: "diseno-industria", isDepartmentHead: true }, // Responsable de Diseño
  { uid: "carlos", name: "Carlos", role: "member", department: "diseno-automocion" },
  { uid: "luis", name: "Luis", role: "member", department: "produccion" },
  { uid: "zoe", name: "Zoe", role: "member" },
  { uid: "borrada", name: "Borrada", role: "member", department: "tecnicos", deleted: true },
  { uid: "fantasma", name: "Fantasma", role: "member", department: "tecnicos", isImported: true },
];
const names = (viewer, filter) => workloadWorkers({ viewer, members, departmentFilter: filter }).map((m) => m.name);
const byUid = (uid) => members.find((m) => m.uid === uid);
eq("admin ve a todos (menos borradas y ficticias), por nombre", names(byUid("admin")), ["Admin", "Ana", "Bea", "Carlos", "Luis", "Zoe"]);
eq("admin filtra por Técnicos", names(byUid("admin"), "tecnicos"), ["Ana"]);
eq("admin filtra por el grupo Diseño → los dos Diseño", names(byUid("admin"), "diseno"), ["Bea", "Carlos"]);
eq("admin filtra por un Diseño concreto", names(byUid("admin"), "diseno-automocion"), ["Carlos"]);
eq("admin filtra por «sin departamento»", names(byUid("admin"), "none"), ["Admin", "Zoe"]);
eq("v81: la Responsable de Técnicos solo ve a Técnicos", names(byUid("ana")), ["Ana"]);
eq("… y no puede ampliar su alcance con el filtro", names(byUid("ana"), ""), ["Ana"]);
eq("… ni pidiendo otro departamento", names(byUid("ana"), "produccion"), ["Ana"]);
eq("la Responsable de Diseño - Industria ve también a Diseño - Automoción (mismo grupo)", names(byUid("bea")), ["Bea", "Carlos"]);
eq("v81: un trabajador normal (Luis, Producción) no ve a nadie, ni a sí mismo", names(byUid("luis")), []);
eq("… aunque pida el filtro de su departamento o «todos»", [names(byUid("luis"), "produccion"), names(byUid("luis"), "")], [[], []]);
eq("sin departamento y sin marca: nadie", names(byUid("zoe")), []);
eq("sin sesión: nadie", names(null), []);

// v81: quién puede ver la carga
const headNoDept = { uid: "h", role: "member", isDepartmentHead: true };
const headBadDept = { uid: "h2", role: "member", isDepartmentHead: true, department: "inexistente" };
const notHead = { uid: "n", role: "member", department: "tecnicos", isDepartmentHead: false };
const reviewer = { uid: "r", role: "revisor", department: "tecnicos" };
check("admin: puede", canViewWorkload(byUid("admin")));
check("Responsable con departamento: puede", canViewWorkload(byUid("ana")) && isDepartmentHead(byUid("ana")));
check("Responsable sin departamento: no puede (no habría a quién enseñar)", !canViewWorkload(headNoDept) && !canViewWorkload(headBadDept));
check("trabajador normal, marca a false, cuenta anterior sin marca: no pueden", !canViewWorkload(notHead) && !canViewWorkload({ uid: "x", role: "member", department: "tecnicos" }));
check("un Revisor tampoco por serlo: la carga es de admin y Responsables", !canViewWorkload(reviewer));
check("sin sesión: no", !canViewWorkload(null) && !canViewWorkload(undefined));
check("la marca solo vale como booleano true (un «true» en texto no)", !canViewWorkload({ uid: "s", role: "member", department: "tecnicos", isDepartmentHead: "true" }));
eq("resolveTimelineGroupBy: admin y Responsable pueden «person»", [resolveTimelineGroupBy(byUid("admin"), "person"), resolveTimelineGroupBy(byUid("ana"), "person"), resolveTimelineGroupBy(byUid("ana"), "workload")], ["person", "person", "person"]);
eq("resolveTimelineGroupBy: trabajador normal siempre «project» (incluido un «workload» guardado)", [resolveTimelineGroupBy(byUid("luis"), "person"), resolveTimelineGroupBy(byUid("luis"), "workload"), resolveTimelineGroupBy(null, "person")], ["project", "project", "project"]);
eq("resolveTimelineGroupBy: lo no pedido o raro es «project»", [resolveTimelineGroupBy(byUid("admin"), undefined), resolveTimelineGroupBy(byUid("admin"), "otra")], ["project", "project"]);

// ---------------------------------------------------------------- carga por día
// Ana: A (mar 3 → jue 5), B (mié 4 → vie 6), C (jue 5 → jue 5), D sin fecha, E completada, F hito, G de otro.
const tasks = [
  t("A", "2026-11-03", "2026-11-05"), t("B", "2026-11-04", "2026-11-06"), t("C", null, "2026-11-05"),
  t("D", null, null), t("E", "2026-11-03", "2026-11-05", { isComplete: true }),
  t("F", null, "2026-11-04", { isMilestone: true }), t("G", "2026-11-03", "2026-11-06", { assigneeIds: ["luis"] }),
];
let wl = personWorkload({ uid: "ana", tasks, cfg, today: D("2026-11-02") });
const act = (k) => (wl.days.get(k) || { active: 0 }).active;
eq("martes: solo A", act("2026-11-03"), 1);
eq("miércoles: A + B (el hito no cuenta)", act("2026-11-04"), 2);
eq("jueves: A + B + C = 3 → saturado", act("2026-11-05"), 3);
eq("viernes: solo B", act("2026-11-06"), 1);
eq("las completadas y las de otro no cuentan (jueves seguiría en 3)", act("2026-11-05"), 3);
eq("sus tareas con fecha (sin la completada ni la sin fecha)", wl.tasks.map((r) => r.task.id), ["A", "F", "B", "C"]); // por inicio y, a igualdad, por fin
eq("una sin fecha, aparte", wl.undated, 1);
eq("tareas activas (sin hito)", wl.stats.activeTasks, 3);
eq("pico", wl.stats.peak, 3);
eq("1 día saturado", wl.stats.overloadDays, 1);
check("jueves: A, B y C son «calientes»", ["A", "B", "C"].every((id) => wl.tasks.find((r) => r.task.id === id).hot));
check("y el hito no", !wl.tasks.find((r) => r.task.id === "F").hot);
eq("estado: aviso (3 no es crítico)", wl.stats.status, "warn");

// Los días no laborables no cargan: una tarea larga que cruza fin de semana, festivo y vacaciones
wl = personWorkload({ uid: "ana", tasks: [t("L", "2026-11-05", "2026-11-13")], cfg, today: D("2026-11-02") });
const a2 = (k) => (wl.days.get(k) || { active: 0 }).active;
eq("jueves y viernes cargan", [a2("2026-11-05"), a2("2026-11-06")], [1, 1]);
eq("sábado y domingo no", [a2("2026-11-07"), a2("2026-11-08")], [0, 0]);
eq("el lunes festivo no", a2("2026-11-09"), 0);
eq("martes carga; miércoles y jueves (vacaciones de Ana) no", [a2("2026-11-10"), a2("2026-11-11"), a2("2026-11-12")], [1, 0, 0]);
eq("viernes 13 carga", a2("2026-11-13"), 1);
eq("la tarea avisa de las ausencias de dentro del rango", wl.tasks[0].issues.map((i) => i.kind), ["absence-range"]);
eq("pero no cuenta como entrega en ausencia (el límite es un día laborable suyo)", wl.stats.absenceClashes, 0);

// Entregas simultáneas y críticas
const crowd = ["P", "Q", "R", "S", "T"].map((id) => t(id, "2026-11-03", "2026-11-03"));
wl = personWorkload({ uid: "ana", tasks: crowd, cfg, today: D("2026-11-02") });
eq("5 tareas el mismo día → crítico", [wl.stats.peak, wl.stats.status], [5, "alert"]);
eq("5 entregas el mismo día: un día con entregas simultáneas", wl.stats.clashDays, 1);
wl = personWorkload({ uid: "ana", tasks: [t("P", "2026-11-02", "2026-11-03"), t("Q", "2026-11-03", "2026-11-03")], cfg, today: D("2026-11-02") });
eq("2 entregas el mismo día sin saturación → aviso", [wl.stats.clashDays, wl.stats.overloadDays, wl.stats.status], [1, 0, "warn"]);

// Entrega en ausencia
wl = personWorkload({ uid: "ana", tasks: [t("V", "2026-11-05", "2026-11-12")], cfg, today: D("2026-11-02") });
eq("límite en vacaciones de Ana → entrega en ausencia", [wl.stats.absenceClashes, wl.stats.status], [1, "alert"]);
wl = personWorkload({ uid: "luis", tasks: [t("V", "2026-11-05", "2026-11-12", { assigneeIds: ["luis"] })], cfg, today: D("2026-11-02") });
eq("la misma tarea para Luis (sin ausencias): sin avisos", [wl.stats.absenceClashes, wl.stats.status], [0, "ok"]);
wl = personWorkload({ uid: "ana", tasks: [t("V", "2026-11-05", "2026-11-12")], cfg, today: D("2026-11-20") });
eq("lo pasado no cuenta para el resumen (hoy es 20/11)", [wl.stats.absenceClashes, wl.stats.peak, wl.stats.status], [0, 0, "ok"]);

// Tarea con ambas asignadas: cuenta para cada una
const shared = t("S1", "2026-11-03", "2026-11-03", { assigneeIds: ["ana", "luis"] });
eq("una tarea compartida carga a las dos", ["ana", "luis"].map((u) => personWorkload({ uid: u, tasks: [shared], cfg, today: D("2026-11-02") }).stats.activeTasks), [1, 1]);

// ---------------------------------------------------------------- columnas (zooms)
wl = personWorkload({ uid: "ana", tasks, cfg, today: D("2026-11-02") });
let cs = columnSummary(wl, "ana", { start: D("2026-11-05"), end: D("2026-11-05") }, cfg);
eq("columna de día: jueves 5 → 3 tareas activas, nivel alto", [cs.peak, cs.level], [3, "high"]);
cs = columnSummary(wl, "ana", { start: D("2026-11-02"), end: D("2026-11-08") }, cfg);
eq("columna de semana: pico de la semana = 3", [cs.peak, cs.weekdays, cs.holidays, cs.absent], [3, 5, 0, 0]);
cs = columnSummary(wl, "ana", { start: D("2026-11-09"), end: D("2026-11-15") }, cfg);
eq("semana del 9: 1 festivo y 2 días de vacaciones de 5", [cs.holidays, cs.absent, cs.weekdays], [1, 2, 5]);
check("… con la ausencia a mano para el tooltip", cs.absence && cs.absence.type === "vacaciones" && cs.holiday.name === "Fiesta local");
cs = columnSummary(wl, "luis", { start: D("2026-11-09"), end: D("2026-11-15") }, cfg);
eq("para Luis, la misma semana solo tiene el festivo", [cs.holidays, cs.absent], [1, 0]);
cs = columnSummary(wl, "ana", { start: D("2026-11-07"), end: D("2026-11-08") }, cfg);
eq("un fin de semana no es «ausencia»", [cs.weekdays, cs.absent, cs.holidays], [0, 0, 0]);

// ---------------------------------------------------------------- textos
const adminV = { uid: "admin", role: "admin" };
check("describeAbsence con rango", describeAbsence(cfg.absences[0]) === "Vacaciones 11/11–12/11", describeAbsence(cfg.absences[0]));
check("describeAbsence con nota si se permite", describeAbsence(cfg.absences[0], true).includes("(boda)"));
check("describeStats vacío si todo bien", describeStats({ overloadDays: 0, clashDays: 0, absenceClashes: 0, peak: 1 }) === "");
check("describeStats junta los avisos", /2 días saturados \(pico 4\).*1 tarea con fecha en ausencia/.test(describeStats({ overloadDays: 2, clashDays: 0, absenceClashes: 1, peak: 4 })));
void adminV;

// ---------------------------------------------------------------- rendimiento razonable
const many = Array.from({ length: 800 }, (_, i) => t("m" + i, "2026-01-05", "2027-12-31"));
const t0 = Date.now();
personWorkload({ uid: "ana", tasks: many, cfg, today: D("2026-11-02") });
check("800 tareas de dos años calculan en menos de 3 s", Date.now() - t0 < 3000, Date.now() - t0);

done("Carga por persona · lógica");
