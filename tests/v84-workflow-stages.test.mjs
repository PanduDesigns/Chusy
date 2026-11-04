// Flujo de trabajo multietapa industrial (v84): Diseño → Compra/Pedido → Recepción/Fabricación.
//  1) Lógica pura (js/workflow-stages.js): etapas, etapa activa, campos principales, relevos con días laborables de
//     Albacete, tareas de 1 o 2 etapas, devolver a etapa anterior, tareas de Ofertas y antiguas.
//  2) Carga por persona por etapa (js/workload.js) y tramos del Gantt.
//  3) Relevo REAL en jsdom: el círculo de completar abre la ventana, escribe el parche y avisa al nuevo responsable.
//  4) Plantillas de Creación Rápida con etapas encadenadas, botón de importar oculto y entrega (versión, CSS, README…).
import fs from "node:fs";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
window.HTMLElement.prototype.scrollTo = () => {}; // jsdom no lo trae (la línea de tiempo se centra en hoy)
freezeNow("2026-11-03T12:00:00"); // martes

const ws = await import("../js/workflow-stages.js");
const wc = await import("../js/work-calendar.js");
const { personWorkload } = await import("../js/workload.js");
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// Calendario de Albacete 2026 (nacionales + Castilla-La Mancha + San Juan/Feria…) y una ausencia del comprador.
const cfg = wc.normalizeWorkCalendar({
  holidays: wc.officialHolidays(2026),
  absences: [{ id: "a1", userId: "compras", startDate: "2026-11-10", endDate: "2026-11-11", type: "vacaciones", note: "" }],
});
// Cuenta N días laborables DESPUÉS de `startKey` a mano (sin addWorkingDays), para contrastar el cálculo.
function workdaysAfter(startKey, n, ids = []) {
  let d = wc.parseDateKey(startKey), left = n;
  while (left > 0) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (wc.isWeekend(d) || wc.getHoliday(d, cfg) || ids.some((id) => wc.getAbsence(id, d, cfg))) continue;
    left--;
  }
  return wc.dateKey(d);
}

// ---------------------------------------------------------------- 1) etapas: activación y defecto
const wfDef = ws.defaultWorkflow();
eq("tarea nueva: las 3 etapas marcadas por defecto", ws.enabledStageKeys(wfDef), ["design", "purchase", "production"]);
eq("etapa activa inicial = Diseño", ws.currentStageKey(wfDef), "design");
eq("cada etapa guarda enabled/completed/completedAt/completedBy/assigneeId/startDate/dueDate/note", Object.keys(wfDef.design).sort(), ["assigneeId", "completed", "completedAt", "completedBy", "dueDate", "enabled", "note", "startDate"]);
check("Compra/Pedido tiene 5 días laborables por defecto", ws.PURCHASE_DEFAULT_DAYS === 5);
eq("progreso inicial: «Diseño 1/3»", ws.stageProgress(wfDef).text, "Diseño 1/3");

// Desmarcar etapas con los checkboxes independientes
const soloDiseno = ws.setStageEnabled(ws.setStageEnabled(wfDef, "purchase", false), "production", false);
eq("solo Diseño: una etapa habilitada", ws.enabledStageKeys(soloDiseno), ["design"]);
eq("solo Diseño: la insignia es solo «Diseño» (sin 1/1)", ws.stageProgress(soloDiseno).text, "Diseño");
const sinCompra = ws.setStageEnabled(wfDef, "purchase", false);
eq("Diseño + Recepción/Fab.: la insignia cuenta 1/2", ws.stageProgress(sinCompra).text, "Diseño 1/2");
const sinDiseno = ws.setStageEnabled(wfDef, "design", false);
eq("sin Diseño, la etapa activa pasa a Compra/Pedido (1/2)", [ws.currentStageKey(sinDiseno), ws.stageProgress(sinDiseno).text], ["purchase", "Compra/Pedido 1/2"]);
check("desmarcar no borra el responsable ni las fechas de la etapa", (() => {
  let w = ws.updateStage(wfDef, "purchase", { assigneeId: "compras", startDate: "2026-11-09", dueDate: "2026-11-16" });
  w = ws.setStageEnabled(ws.setStageEnabled(w, "purchase", false), "purchase", true);
  return w.purchase.assigneeId === "compras" && w.purchase.dueDate === "2026-11-16";
})());

// Retrocompatibilidad
check("tarea antigua (sin workflow): sin etapas", ws.normalizeWorkflow(undefined) === null && ws.taskWorkflow({ projectId: "P" }) === null && ws.taskStageBadge({ projectId: "P" }) === null);
check("workflow con todo apagado: sin etapas en uso", ws.taskWorkflow({ projectId: "P", workflow: ws.workflowFromEnabled([]) }) === null);
eq("tarea antigua: el círculo se comporta como siempre (legacy)", ws.planTaskCheck({ projectId: "P", isComplete: false }).kind, "legacy");
check("basura en workflow no rompe nada", ws.normalizeWorkflow({ design: "x", purchase: { enabled: "sí", assigneeId: 7 } }).purchase.enabled === false);

// Ofertas y personales: no llevan etapas
const OFF = "OFFERS";
const conFlujo = { id: "x", projectId: "P", workflow: wfDef, assigneeIds: ["d"] };
check("tarea de Ofertas (principal o adicional): sin etapas", ws.taskWorkflow({ ...conFlujo, projectId: OFF }, OFF) === null && ws.taskWorkflow({ ...conFlujo, extraProjectIds: [OFF] }, OFF) === null);
check("tarea personal (sin proyecto): sin etapas", ws.taskWorkflow({ ...conFlujo, projectId: null }, OFF) === null);
check("tarea de proyecto normal: con etapas", !!ws.taskWorkflow(conFlujo, OFF));

// ---------------------------------------------------------------- sincronización con los campos principales
let wf = ws.updateStage(wfDef, "design", { assigneeId: "disenador", startDate: "2026-11-03", dueDate: "2026-11-06" });
wf = ws.updateStage(wf, "purchase", { assigneeId: "compras" });
wf = ws.updateStage(wf, "production", { assigneeId: "taller", dueDate: "2026-12-04" });
let patch = ws.workflowTaskPatch(wf);
eq("la etapa activa manda: responsable y fechas principales = los de Diseño", [patch.assigneeIds, patch.startDate, patch.dueDate], [["disenador"], "2026-11-03", "2026-11-06"]);
eq("las etapas futuras quedan en upcomingAssigneeIds (sin repetir al activo)", patch.upcomingAssigneeIds, ["compras", "taller"]);
check("sin etapa activa con fechas/responsable, los campos de la tarea no se tocan", (() => { const p = ws.workflowTaskPatch(ws.defaultWorkflow()); return !("assigneeIds" in p) && !("startDate" in p) && !("dueDate" in p); })());
eq("quien ya es el activo no aparece como «próximo»", ws.upcomingAssigneeIds(ws.updateStage(ws.updateStage(wfDef, "design", { assigneeId: "x" }), "production", { assigneeId: "x" })), []);

// ---------------------------------------------------------------- relevo Diseño → Compra/Pedido (+5 laborables, Albacete)
const buy1 = ws.planPurchaseHandoff({ buyerId: "compras", today: "2026-11-03", cfg });
eq("relevo a Compra: inicio hoy, fin = +5 días laborables (el comprador está de vacaciones 10 y 11/11)", [buy1.startDate, buy1.dueDate], ["2026-11-03", workdaysAfter("2026-11-03", 5, ["compras"])]);
eq("… que salta las vacaciones del comprador: 4,5,6,9 y 12/11 → jueves 12", buy1.dueDate, "2026-11-12");
const buy2 = ws.planPurchaseHandoff({ buyerId: "otro", today: "2026-11-03", cfg });
eq("sin ausencias el mismo relevo acaba el martes 10/11", buy2.dueDate, "2026-11-10");
const buyDic = ws.planPurchaseHandoff({ buyerId: "otro", today: "2026-12-02", cfg });
check("diciembre: el festivo del 8 (Inmaculada) no cuenta", wc.getHoliday("2026-12-08", cfg) && buyDic.dueDate === workdaysAfter("2026-12-02", 5) && buyDic.dueDate === "2026-12-10", buyDic);
const buySab = ws.planPurchaseHandoff({ buyerId: "otro", today: "2026-11-07", cfg }); // sábado
eq("un relevo en fin de semana empieza el siguiente día hábil (lunes 9/11)", [buySab.startDate, buySab.dueDate], ["2026-11-09", workdaysAfter("2026-11-09", 5)]);
const buySS = ws.planPurchaseHandoff({ buyerId: "otro", today: "2026-04-01", cfg }); // Semana Santa 2026
check("Semana Santa: jueves/viernes santo y Lunes de Pascua no cuentan", buySS.dueDate === workdaysAfter("2026-04-01", 5) && wc.getHoliday("2026-04-03", cfg) && buySS.dueDate >= "2026-04-10", buySS);

let r = ws.completeCurrentStage(wf, { userId: "disenador", now: "2026-11-06T10:00:00Z", handoff: buy1 });
check("completar Diseño: no termina la tarea y activa Compra/Pedido", r && !r.finished && r.completedKey === "design" && r.activatedKey === "purchase");
check("… Diseño queda completada con quién y cuándo", r.workflow.design.completed && r.workflow.design.completedBy === "disenador" && r.workflow.design.completedAt === "2026-11-06T10:00:00.000Z");
eq("… Compra/Pedido recibe responsable y fechas del relevo", [r.workflow.purchase.assigneeId, r.workflow.purchase.startDate, r.workflow.purchase.dueDate], ["compras", "2026-11-03", "2026-11-12"]);
eq("… la etapa activa ahora es Compra/Pedido 2/3", ws.stageProgress(r.workflow).text, "Compra/Pedido 2/3");
patch = ws.workflowTaskPatch(r.workflow);
eq("… responsable y fechas de la TAREA pasan a ser los de Compra", [patch.assigneeIds, patch.startDate, patch.dueDate], [["compras"], "2026-11-03", "2026-11-12"]);
eq("… y el comprador deja de figurar como etapa futura", patch.upcomingAssigneeIds, ["taller"]);
const adv1 = ws.advanceTaskPatch({ ...conFlujo, workflow: wf }, { userId: "disenador", handoff: buy1, offersProjectId: OFF });
check("el parche de la tarea NO la marca completada globalmente", adv1.patch.isComplete === false && adv1.activatedKey === "purchase");

// ---------------------------------------------------------------- relevo Compra → Recepción/Fab.
const handProd = { assigneeId: "taller", startDate: "2026-11-12", dueDate: "2026-12-04", note: "Plazo del proveedor: 3 semanas" };
const r2 = ws.completeCurrentStage(r.workflow, { userId: "compras", handoff: handProd });
check("completar Compra: activa Recepción/Fabricación con su responsable, fechas y nota", r2.activatedKey === "production" && !r2.finished && r2.workflow.production.assigneeId === "taller" && r2.workflow.production.dueDate === "2026-12-04" && r2.workflow.production.note.startsWith("Plazo"));
eq("… progreso «Recepción/Fab. 3/3»", ws.stageProgress(r2.workflow).text, "Recepción/Fab. 3/3");
eq("… el círculo ahora completa la última etapa (finish)", ws.planTaskCheck({ ...conFlujo, workflow: r2.workflow }, OFF), { kind: "finish", from: "production" });
const planProd = ws.planStageHandoff(ws.updateStage(wfDef, "production", { assigneeId: "taller", dueDate: "2026-12-04" }), "production", { today: "2026-11-12", cfg });
eq("propuesta de relevo a Recepción/Fab.: responsable precargado, inicio hoy y fin el ya definido", [planProd.assigneeId, planProd.startDate, planProd.dueDate], ["taller", "2026-11-12", "2026-12-04"]);
check("Recepción/Fab. no inventa una fecha fin", ws.planStageHandoff(wfDef, "production", { today: "2026-11-12", cfg }).dueDate === null);

// Última etapa → tarea completada
const r3 = ws.completeCurrentStage(r2.workflow, { userId: "taller" });
check("completar la última etapa: tarea terminada y ninguna etapa activa", r3.finished && r3.activatedKey === null && ws.currentStageKey(r3.workflow) === null);
check("… advanceTaskPatch marca isComplete", ws.advanceTaskPatch({ ...conFlujo, workflow: r2.workflow }, { userId: "taller", offersProjectId: OFF }).patch.isComplete === true);

// Tareas de 1 o 2 etapas
const one = { ...conFlujo, workflow: soloDiseno };
eq("1 etapa: el círculo termina la tarea (finish)", ws.planTaskCheck(one, OFF), { kind: "finish", from: "design" });
check("1 etapa: completarla completa la tarea", ws.advanceTaskPatch(one, { userId: "d", offersProjectId: OFF }).patch.isComplete === true);
const two = { ...conFlujo, workflow: sinCompra };
eq("2 etapas (Diseño + Recepción): Diseño hace relevo directo a Recepción/Fab.", ws.planTaskCheck(two, OFF), { kind: "handoff", from: "design", to: "production" });
const two2 = ws.advanceTaskPatch(two, { userId: "d", handoff: { assigneeId: "taller", startDate: "2026-11-09", dueDate: "2026-11-20" }, offersProjectId: OFF });
check("2 etapas: tras Diseño se activa Recepción/Fab. y la tarea sigue abierta", two2.activatedKey === "production" && two2.patch.isComplete === false && ws.stageProgress(two2.patch.workflow).text === "Recepción/Fab. 2/2");
eq("2 etapas: el círculo de una tarea con la 2.ª etapa activa la termina", ws.planTaskCheck({ ...conFlujo, workflow: two2.patch.workflow }, OFF).kind, "finish");

// ---------------------------------------------------------------- devolver a etapa anterior
const enCompra = { ...conFlujo, workflow: r.workflow };
check("hay algo que devolver desde Compra/Pedido", ws.canReturnToPreviousStage(r.workflow) && !ws.canReturnToPreviousStage(wf));
const back = ws.returnTaskPatch({ ...enCompra, isComplete: false }, OFF);
eq("devolver desde Compra reabre Diseño y le devuelve la asignación y las fechas", [back.reopenedKey, back.patch.assigneeIds, back.patch.startDate, back.patch.dueDate, back.patch.isComplete], ["design", ["disenador"], "2026-11-03", "2026-11-06", false]);
check("… Diseño ya no está completada (sin completedBy)", back.patch.workflow.design.completed === false && back.patch.workflow.design.completedBy === null && ws.currentStageKey(back.patch.workflow) === "design");
const doneTask = { ...conFlujo, workflow: r3.workflow, isComplete: true };
eq("con la tarea completada el círculo la devuelve a su última etapa", ws.planTaskCheck(doneTask, OFF), { kind: "reopen", stage: "production" });
const back2 = ws.returnTaskPatch(doneTask, OFF);
check("… la tarea vuelve a estar abierta, en Recepción/Fab., con su responsable", back2.patch.isComplete === false && back2.patch.assigneeIds[0] === "taller" && ws.currentStageKey(back2.patch.workflow) === "production");
const reopened = ws.reopenStage(r2.workflow, "design");
check("desmarcar una etapa completada reabre también las posteriores", reopened.design.completed === false && reopened.purchase.completed === false && ws.currentStageKey(reopened) === "design");
check("devolver sin nada completado → null", ws.returnTaskPatch({ ...conFlujo, isComplete: false }, OFF) === null && ws.reopenStage(wfDef, "design") === null);
eq("tarea completada antes de tener etapas: se reabre como siempre", ws.planTaskCheck({ projectId: "P", isComplete: true, workflow: wfDef }, OFF).kind, "legacy");

// Selección múltiple: completar todo / reabrir
const bulkOn = ws.bulkCompleteExtras({ ...conFlujo, workflow: wf }, true, { userId: "boss", offersProjectId: OFF });
check("completar varias tareas deja todas sus etapas hechas", ["design", "purchase", "production"].every((k) => bulkOn.workflow[k].completed && bulkOn.workflow[k].completedBy === "boss") && bulkOn.upcomingAssigneeIds.length === 0);
check("reabrirla vuelve a su última etapa; sin etapas no toca nada", ws.bulkCompleteExtras({ ...conFlujo, workflow: bulkOn.workflow }, false, { offersProjectId: OFF }).workflow.production.completed === false && Object.keys(ws.bulkCompleteExtras({ projectId: "P" }, true)).length === 0);

// «Mis tareas»: próximas etapas
const mine = { ...conFlujo, assigneeIds: ["disenador"], ownerId: null, workflow: wf };
check("Compras ve la tarea como «próxima etapa»; el diseñador, como activa", ws.isUpcomingForUser(mine, "compras", OFF) && !ws.isUpcomingForUser(mine, "disenador", OFF));
eq("… y sabe qué etapa le tocará", ws.upcomingStageOf(mine, "compras", OFF), "purchase");
check("al activarse su etapa deja de ser «próxima»", !ws.isUpcomingForUser({ ...mine, assigneeIds: ["compras"], workflow: r.workflow }, "compras", OFF));
check("una tarea completada no es «próxima»", !ws.isUpcomingForUser({ ...mine, isComplete: true }, "compras", OFF));

// ---------------------------------------------------------------- 2) carga por persona por etapa + Gantt
const flowTask = {
  id: "F1", title: "Equipo completo", projectId: "P", isComplete: false, isMilestone: false,
  assigneeIds: ["disenador"], startDate: "2026-11-03", dueDate: "2026-11-06", // el lunes 2/11 es festivo (Todos los Santos)
  workflow: ws.workflowFromEnabled(["design", "purchase", "production"], {
    design: { assigneeId: "disenador", startDate: "2026-11-03", dueDate: "2026-11-06" },
    purchase: { assigneeId: "compras", startDate: "2026-11-09", dueDate: "2026-11-16" },
    production: { assigneeId: "taller", startDate: "2026-11-17", dueDate: "2026-12-01" },
  }),
};
const daysOf = (uid, tasks = [flowTask]) => [...personWorkload({ uid, tasks, cfg, today: new Date("2026-11-03T12:00:00") }).days.entries()].filter(([, v]) => v.active).map(([k]) => k).sort();
const dis = daysOf("disenador"), com = daysOf("compras"), tal = daysOf("taller");
check("el diseñador solo computa carga los días de Diseño (3–6/11)", dis[0] === "2026-11-03" && dis[dis.length - 1] === "2026-11-06" && dis.length === 4, dis);
check("el comprador computa los días de Compra/Pedido (9–16/11, sin su ausencia 10–11)", com[0] === "2026-11-09" && com[com.length - 1] === "2026-11-16" && com.length === 4 && !com.includes("2026-11-10") && !com.includes("2026-11-11"), com);
check("el taller computa Recepción/Fab. (17/11–1/12)", tal[0] === "2026-11-17" && tal[tal.length - 1] === "2026-12-01", tal);
check("ninguno computa los días de otra fase", !dis.includes("2026-11-09") && !com.includes("2026-11-06") && !tal.includes("2026-11-16"));
const wlTaller = personWorkload({ uid: "taller", tasks: [flowTask], cfg, today: new Date("2026-11-03T12:00:00") });
eq("la fila del taller lleva las fechas de SU etapa y la marca de etapa", [wlTaller.tasks[0].task.startDate, wlTaller.tasks[0].task.dueDate, wlTaller.tasks[0].task.workflowStage], ["2026-11-17", "2026-12-01", "production"]);
const doneDesign = { ...flowTask, workflow: ws.completeCurrentStage(flowTask.workflow, { userId: "disenador", handoff: {} }).workflow };
check("con Diseño terminado, el diseñador ya no computa carga y el comprador sí", daysOf("disenador", [doneDesign]).length === 0 && daysOf("compras", [doneDesign]).length > 0);
// Etapa futura sin fechas propias: no ocupa; la activa sin fechas usa las de la tarea
const sinFechas = { ...flowTask, workflow: ws.workflowFromEnabled(["design", "purchase"], { design: { assigneeId: "disenador" }, purchase: { assigneeId: "compras" } }) };
check("etapa activa sin fechas propias: usa las de la tarea; la futura sin fechas no ocupa a nadie", daysOf("disenador", [sinFechas]).length === 4 && daysOf("compras", [sinFechas]).length === 0);
// Sin etapas: igual que siempre
const legacy = { id: "L", title: "L", projectId: "P", isComplete: false, assigneeIds: ["ana", "luis"], startDate: "2026-11-03", dueDate: "2026-11-04" };
check("una tarea sin etapas cuenta para todos sus responsables como siempre", daysOf("ana", [legacy]).length === 2 && daysOf("luis", [legacy]).length === 2);
eq("loadSlices: sin etapas, una porción por responsable", ws.loadSlices(legacy).map((s) => s.uid), ["ana", "luis"]);
const segs = ws.stageSegments(flowTask, OFF);
eq("Gantt: un tramo por etapa con fechas, la activa marcada", segs.map((s) => [s.key, s.status]), [["design", "current"], ["purchase", "pending"], ["production", "pending"]]);
eq("Gantt: tras completar Diseño, ese tramo sale como hecho", ws.stageSegments(doneDesign, OFF).map((s) => s.status), ["done", "current", "pending"]);
check("Gantt: una tarea sin etapas no tiene tramos", ws.stageSegments(legacy, OFF).length === 0);
eq("al mover la barra, la etapa activa se mueve con ella", ws.syncActiveStageDates(flowTask, { startDate: "2026-11-03", dueDate: "2026-11-09" }, OFF).workflow.design.dueDate, "2026-11-09");

// ---------------------------------------------------------------- 3) relevo real en jsdom
globalThis.__fb = { collections: {}, sets: [], hooks: {} };
const writes = [];
globalThis.__fb.hooks.updateDoc = async (ref, fields) => { writes.push({ ref, fields }); };
const { toggleTaskWithWorkflow, openStageHandoffDialog } = await import("../js/components/stage-handoff.js");
const { stageBadgeHtml } = await import("../js/components/stage-badge.js");
const members = [
  { uid: "disenador", name: "Diana", role: "member" },
  { uid: "compras", name: "Carlos", role: "member" },
  { uid: "taller", name: "Tomás", role: "member" },
];
const $ = (sel) => document.querySelector(sel);
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el, props = {}) => { Object.assign(el, props); el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const fromUser = { uid: "disenador", name: "Diana" };

const badge = (task) => { const d = document.createElement("div"); d.innerHTML = stageBadgeHtml(task); return d.firstElementChild; };
const b1 = badge({ ...conFlujo, workflow: wf });
check("insignia de Diseño con progreso 1/3 y su color de fase", b1 && b1.textContent === "Diseño 1/3" && b1.classList.contains("wf-badge--design"));
const b2 = badge({ ...conFlujo, workflow: r.workflow });
check("insignia de Compra/Pedido 2/3 con color distinto", b2.textContent === "Compra/Pedido 2/3" && b2.classList.contains("wf-badge--purchase"));
check("insignia de Recepción/Fab. 3/3", badge({ ...conFlujo, workflow: r2.workflow }).textContent === "Recepción/Fab. 3/3");
check("solo Diseño: la insignia dice «Diseño»", badge({ ...conFlujo, workflow: soloDiseno }).textContent === "Diseño");
check("sin etapas, completada o de Ofertas: ninguna insignia", stageBadgeHtml({ projectId: "P" }) === "" && stageBadgeHtml({ ...conFlujo, workflow: wf, isComplete: true }) === "");

const taskDesign = { id: "T1", title: "Equipo X", projectId: "P", isComplete: false, assigneeIds: ["disenador"], startDate: "2026-11-03", dueDate: "2026-11-06", workflow: wf };
const p1 = toggleTaskWithWorkflow(taskDesign, { currentUser: fromUser, teamMembers: members, projects: [{ id: "P", name: "Proyecto P" }] });
await tick(5);
check("el círculo de Diseño abre el micro-modal de relevo", !!$("[data-stage-handoff]"));
check("… responsable de Compra precargado (ya preasignado) y plazo +5 laborables", $("#sh-who").value === "compras" && $("#sh-start").value === "2026-11-03");
const dueSuggested = $("#sh-due").value;
check("… fecha fin = +5 días laborables desde hoy", /^2026-11-1\d$/.test(dueSuggested) && dueSuggested >= "2026-11-10", dueSuggested);
click($("#sh-ok"));
const res1 = await p1;
check("confirmar en 1 clic: la tarea NO se completa", res1.completed === false && writes.length === 1 && writes[0].fields.isComplete === false);
const w1 = writes[0].fields;
check("… Diseño queda completada y la activa es Compra/Pedido", w1.workflow.design.completed && w1.workflow.design.completedBy === "disenador" && ws.currentStageKey(w1.workflow) === "purchase");
eq("… responsable y fechas de la tarea = los de Compra", [w1.assigneeIds, w1.startDate, w1.dueDate], [["compras"], "2026-11-03", dueSuggested]);
await tick(5);
const notif = (globalThis.__fb.sets || []).map((s) => s.data).filter((d) => d && d.type === "task_assigned");
check("… se avisa al comprador, con la etapa que le toca", notif.length === 1 && notif[0].userId === "compras" && notif[0].stageLabel === "Compra/Pedido", notif);
check("… y el micro-modal se cierra", !$("[data-stage-handoff]"));

// Relevo sin responsable: la ventana no deja confirmar
writes.length = 0;
const taskNoBuyer = { ...taskDesign, id: "T2", workflow: ws.updateStage(wf, "purchase", { assigneeId: null }) };
const p2 = toggleTaskWithWorkflow(taskNoBuyer, { currentUser: fromUser, teamMembers: members });
await tick(5);
check("sin responsable de Compra preasignado, empieza vacío", $("#sh-who").value === "");
click($("#sh-ok"));
check("… y no deja confirmar hasta elegir responsable", !!$("[data-stage-handoff]") && !$("#sh-error").hidden && writes.length === 0);
change($("#sh-who"), { value: "compras" });
check("… al elegirlo se calculan las fechas (+5 laborables con sus ausencias)", $("#sh-start").value === "2026-11-03" && $("#sh-due").value !== "");
click($("#sh-cancel"));
const res2 = await p2;
check("cancelar el relevo no cambia nada", res2.cancelled === true && writes.length === 0 && !$("[data-stage-handoff]"));

// Compra → Recepción/Fab.: pide fecha prevista
writes.length = 0;
const taskCompra = { ...taskDesign, id: "T3", assigneeIds: ["compras"], workflow: ws.updateStage(r.workflow, "production", { dueDate: null, assigneeId: "taller" }) };
const p3 = toggleTaskWithWorkflow(taskCompra, { currentUser: { uid: "compras", name: "Carlos" }, teamMembers: members });
await tick(5);
check("el círculo de Compra abre el relevo a Recepción/Fab. pidiendo fecha prevista", !!$("[data-stage-handoff]") && /Recepción\/Fabricación/.test($("[data-stage-handoff]").textContent) && $("#sh-who").value === "taller" && $("#sh-due").value === "");
click($("#sh-ok"));
check("… exige la fecha prevista de recepción / fin de fabricación", !!$("[data-stage-handoff]") && writes.length === 0);
change($("#sh-due"), { value: "2026-12-04" });
click($("#sh-ok"));
const res3 = await p3;
const w3 = writes[0].fields;
check("… al confirmar: Compra completada, Recepción/Fab. activa con su responsable y fecha", res3.completed === false && w3.workflow.purchase.completed && ws.currentStageKey(w3.workflow) === "production" && w3.assigneeIds[0] === "taller" && w3.dueDate === "2026-12-04" && w3.isComplete === false);

// Última etapa: sin ventana, tarea completada
writes.length = 0;
let celebrated = 0;
const taskLast = { ...taskDesign, id: "T4", assigneeIds: ["taller"], workflow: r2.workflow };
const res4 = await toggleTaskWithWorkflow(taskLast, { currentUser: { uid: "taller", name: "Tomás" }, teamMembers: members, onFinish: () => celebrated++ });
check("el círculo de la última etapa completa la tarea (sin ventana) y celebra", res4.completed === true && writes[0].fields.isComplete === true && celebrated === 1 && !$("[data-stage-handoff]"));
// Pasar de etapa no celebra
const res5 = (async () => { const p = toggleTaskWithWorkflow({ ...taskDesign, id: "T5" }, { currentUser: fromUser, teamMembers: members, onFinish: () => celebrated++ }); await tick(5); click($("#sh-ok")); return p; })();
await res5;
check("pasar de etapa no celebra", celebrated === 1);

// Devolver desde el círculo
writes.length = 0;
const res6 = await toggleTaskWithWorkflow({ ...taskDesign, id: "T6", assigneeIds: ["taller"], isComplete: true, workflow: r3.workflow }, { currentUser: { uid: "boss", name: "Jefe" }, teamMembers: members });
check("el círculo de una tarea completada la devuelve a su última etapa", res6.completed === false && writes[0].fields.isComplete === false && ws.currentStageKey(writes[0].fields.workflow) === "production" && writes[0].fields.assigneeIds[0] === "taller");
// Tarea sin etapas: como siempre
writes.length = 0;
await toggleTaskWithWorkflow({ id: "T7", title: "Vieja", projectId: "P", isComplete: false, assigneeIds: ["ana"] }, { currentUser: fromUser, teamMembers: members });
check("una tarea sin etapas se completa de golpe como siempre", writes.length === 1 && writes[0].fields.isComplete === true && !("workflow" in writes[0].fields) && !$("[data-stage-handoff]"));

// Diálogo suelto con el calendario de Albacete
const pd = openStageHandoffDialog({ workflow: ws.updateStage(wfDef, "purchase", { assigneeId: "compras" }), from: "design", to: "purchase", taskTitle: "T", teamMembers: members, cfg, today: "2026-11-03" });
check("el diálogo respeta las ausencias del comprador (vacaciones 10–11/11 → fin 12/11)", $("#sh-due").value === "2026-11-12", $("#sh-due").value);
click($("#sh-cancel")); await pd;

// ---------------------------------------------------------------- 4) plantillas de Creación Rápida
const tpl = ws.normalizeTemplateStages(undefined);
check("plantilla por defecto: 3 etapas activas y Compra/Pedido con 5 días", tpl.design.enabled && tpl.purchase.enabled && tpl.production.enabled && tpl.purchase.days === 5 && tpl.design.days === null);
check("plantilla: se pueden apagar etapas y preasignar responsable y días", (() => { const t = ws.normalizeTemplateStages({ design: { enabled: false }, production: { assigneeId: "taller", days: "10" } }); return !t.design.enabled && t.production.assigneeId === "taller" && t.production.days === 10 && t.purchase.enabled; })());
const plan = ws.planTemplateWorkflow({ stages: { design: { days: 3, assigneeId: "disenador" }, purchase: {}, production: { days: 10, assigneeId: "taller" } }, assigneeIds: [], insertionDate: "2026-11-03", cfg });
eq("tarea de plantilla: etapas encadenadas en laborables (Diseño 3 d → Compra 5 d → Recepción 10 d)", [plan.workflow.design.startDate, plan.workflow.design.dueDate, plan.workflow.purchase.startDate, plan.workflow.purchase.dueDate, plan.workflow.production.startDate, plan.workflow.production.dueDate], ["2026-11-03", "2026-11-06", "2026-11-09", workdaysAfter("2026-11-09", 5), "2026-11-17", workdaysAfter("2026-11-17", 10, ["taller"])]);
eq("… la tarea nace con la etapa activa (Diseño): responsable, fechas y etapas futuras", [plan.patch.assigneeIds, plan.patch.dueDate, plan.patch.upcomingAssigneeIds], [["disenador"], "2026-11-06", ["taller"]]);
const planSolo = ws.planTemplateWorkflow({ stages: { design: { enabled: true }, purchase: { enabled: false }, production: { enabled: false } }, durationDays: 3, assigneeIds: ["ana"], insertionDate: "2026-11-03", cfg, firstPlan: { startKey: "2026-11-03", dueKey: "2026-11-06" } });
check("una etapa y los días necesarios de la tarea: la etapa los hereda y el primer asignado se encarga", planSolo.workflow.design.dueDate === "2026-11-06" && planSolo.workflow.design.assigneeId === "ana" && ws.enabledStageKeys(planSolo.workflow).length === 1);
check("sin ninguna etapa marcada: sin flujo", ws.planTemplateWorkflow({ stages: { design: { enabled: false }, purchase: { enabled: false }, production: { enabled: false } }, insertionDate: "2026-11-03", cfg }) === null);

// Importar histórico: oculto pero conservado
const metricsSrc = read("js/views/metrics-view.js");
check("Métricas: el botón «Importar histórico» está oculto por un interruptor", /OFFER_IMPORT_BUTTON_VISIBLE\s*=\s*false/.test(metricsSrc) && /canImport:\s*isAdmin\s*&&\s*OFFER_IMPORT_BUTTON_VISIBLE/.test(metricsSrc));
check("… y los tres archivos del importador siguen en el proyecto", ["js/offer-import.js", "js/data/offer-import.js", "js/components/offer-import-modal.js"].every((f) => fs.existsSync(new URL(`../${f}`, import.meta.url))));

// Entrega
const idx = read("index.html");
check("package.json y el ?v= de index.html son 84", JSON.parse(read("package.json")).version === "84.0.0" && (idx.match(/\?v=84/g) || []).length === 14 && !/\?v=83/.test(idx));
check("CSS: insignias (list-board), ventana y sección (modals), tramos del Gantt (calendar-timeline)", /\.wf-badge--design/.test(read("css/06-list-board.css")) && /\.wf-row\b/.test(read("css/07-modals.css")) && /\.stage-handoff/.test(read("css/07-modals.css")) && /\.tl-seg--purchase/.test(read("css/08-calendar-timeline.css")));
const wn = await import("../js/whats-new.js");
check("Novedades: la v84 es la más reciente y habla de etapas, relevo y carga", wn.RELEASES[0].id === 84 && /etapas/i.test(JSON.stringify(wn.RELEASES[0])) && /relevo/i.test(JSON.stringify(wn.RELEASES[0])) && /carga/i.test(JSON.stringify(wn.RELEASES[0])));
check("README documenta la v84", /v84/.test(read("README.md")) && /Chusy-84/.test(read("README.md")) && /workflow-stages/.test(read("README.md")));
check("Reglas de Firestore: la consulta de próximas etapas puede leer", /upcomingAssigneeIds/.test(read("firestore.rules")) && /upcomingAssigneeIds/.test(read("js/data/tasks.js")));


// ---------------------------------------------------------------- 5) modal de tarea (jsdom): sección de etapas y relevo sobre el borrador
{
  const { openTaskModal } = await import("../js/components/task-modal.js");
  const project = { id: "P", name: "Proyecto", sections: [{ id: "s1", name: "S", order: 0 }] };
  openTaskModal({ project, teamMembers: members, allProjects: [project], tagsRegistry: [], currentUserProfile: { uid: "disenador", name: "Diana", role: "member" }, onSaved() {}, onClosed() {} });
  await tick(20);
  const box = $("#t-workflow");
  check("modal de tarea nueva en un proyecto: sección «Flujo de Etapas» visible", !!box && !box.hidden && /Flujo de Etapas/.test(box.textContent));
  eq("… con las 3 etapas marcadas por defecto y una fila por etapa", [[...document.querySelectorAll("[data-wf-enable]")].map((c) => c.checked), document.querySelectorAll(".wf-row").length], [[true, true, true], 3]);
  const cbx = document.querySelector('[data-wf-enable="purchase"]');
  change(cbx, { checked: false });
  eq("… desmarcar Compra/Pedido deja 2 filas", document.querySelectorAll(".wf-row").length, 2);
  change(cbx, { checked: true });
  change(document.querySelector('[data-wf-who="design"]'), { value: "disenador" });
  check("… elegir el responsable de Diseño marca su chip de Responsables", document.querySelector('#t-assignees .chip[data-uid="disenador"]').classList.contains("is-selected"));
  change(document.querySelector('[data-wf-due="design"]'), { value: "2026-11-06" });
  eq("… la fecha fin de la etapa activa se refleja en la fecha límite de la tarea", $("#t-due").value, "2026-11-06");
  change(document.querySelector('[data-wf-who="purchase"]'), { value: "compras" });
  const titleBox = $("#t-title"); titleBox.value = "Equipo"; titleBox.dispatchEvent(new window.Event("input", { bubbles: true }));
  click($("#t-complete"));
  await tick(10);
  check("el círculo del modal abre el relevo a Compra/Pedido con el comprador precargado", !!$("[data-stage-handoff]") && $("#sh-who").value === "compras");
  click($("#sh-ok"));
  await tick(10);
  check("… al confirmar, la tarea del borrador NO queda completada y pasa a Compra/Pedido", !$("#t-complete").classList.contains("is-checked") && /En curso/.test(document.querySelector('.wf-row[data-stage="purchase"] .wf-row__state').textContent) && /Completada/.test(document.querySelector('.wf-row[data-stage="design"] .wf-row__state').textContent));
  check("… y los Responsables pasan a ser el comprador", document.querySelector('#t-assignees .chip[data-uid="compras"]').classList.contains("is-selected") && !document.querySelector('#t-assignees .chip[data-uid="disenador"]').classList.contains("is-selected"));
  check("… con «Devolver a etapa anterior» disponible", !!$("#wf-return"));
  click($("#wf-return"));
  check("… que reabre Diseño y devuelve el responsable anterior", /En curso/.test(document.querySelector('.wf-row[data-stage="design"] .wf-row__state').textContent) && document.querySelector('#t-assignees .chip[data-uid="disenador"]').classList.contains("is-selected"));
  globalThis.confirm = () => true; // «¿Descartar cambios?»
  document.querySelector("#t-cancel").click();
}

// ---------------------------------------------------------------- 6) línea de tiempo (jsdom): tramos por etapa y carga por persona
{
  const { renderTimelineView } = await import("../js/views/timeline-view.js");
  const tlMembers = [{ uid: "admin", name: "Admin", role: "admin" }, ...members];
  const full = { ...flowTask, priority: "media", tags: [] };
  const plain = { id: "L2", title: "Sin etapas", projectId: "P", startDate: "2026-11-03", dueDate: "2026-11-06", assigneeIds: ["compras"], isComplete: false, isMilestone: false, priority: "media", tags: [] };
  const renderTl = (groupBy, tasks) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderTimelineView(container, {
      groups: [{ id: "P", label: "Proyecto", color: "#c00", code: "26001", sections: [], tasks }], zoom: "day", onZoomChange() {}, viewMode: "tasks", onViewModeChange() {},
      expandedSections: new Set(), onToggleSectionExpand() {}, showHolidays: false, onToggleHolidays() {}, onOpenTask() {}, exportTitle: "x", groupLabel: "Proyecto",
      teamMembers: tlMembers, currentUser: tlMembers[0], workCalendar: cfg, groupBy, onGroupByChange() {}, departmentFilter: "", onDepartmentFilterChange() {},
    });
    return container;
  };
  const c1 = renderTl("project", [full, plain]);
  const segsEls = [...c1.querySelectorAll(".tl-bar--seg")];
  eq("Gantt (proyecto): una tarea con 3 etapas con fechas se dibuja como 3 tramos de fase", segsEls.map((e) => [...e.classList].find((k) => k.startsWith("tl-seg--"))), ["tl-seg--design", "tl-seg--purchase", "tl-seg--production"]);
  check("… el tramo activo va marcado y los tramos no se arrastran", segsEls[0].classList.contains("is-current") && segsEls.every((e) => !e.hasAttribute("data-drag-task")));
  check("… una tarea sin etapas conserva su barra normal arrastrable", !!c1.querySelector('.tl-bar[data-drag-task="L2"]'));
  const c2 = renderTl("person", [full]);
  const tallerBars = [...c2.querySelectorAll(".tl-bar")].filter((b) => b.title.includes("Equipo completo") && b.title.includes("Recepción/Fabricación"));
  check("Gantt (persona): cada trabajador ve la barra de SU etapa, no arrastrable", tallerBars.length === 1 && !tallerBars[0].hasAttribute("data-drag-task"));
}

done("v84 · flujo multietapa: etapas, relevos, carga por etapa, plantillas y entrega");
