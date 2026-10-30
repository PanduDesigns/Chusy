// Carga por persona (v79) — renderizado REAL de js/views/timeline-view.js en jsdom: un bloque por
// persona visible según el departamento, franja de carga con saturación, ausencias sombreadas,
// código del proyecto en las barras y conmutador «Agrupar por».
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow } from "./support/dom.mjs";

setupDom();
freezeNow("2026-11-02T12:00:00"); // lunes
const { renderTimelineView } = await import("../js/views/timeline-view.js");
const { normalizeWorkCalendar } = await import("../js/work-calendar.js");

const members = [
  { uid: "admin", name: "Admin", role: "admin" },
  { uid: "ana", name: "Ana", role: "member", department: "tecnicos", isDepartmentHead: true }, // v81: Responsable de Técnicos
  { uid: "bea", name: "Bea", role: "member", department: "diseno-industria", isDepartmentHead: true }, // Responsable de Diseño
  { uid: "luis", name: "Luis", role: "member", department: "produccion" }, // trabajador normal
  { uid: "zoe", name: "Zoe", role: "member", isDepartmentHead: true }, // marca de Responsable SIN departamento: no vale
];
const calendar = normalizeWorkCalendar({
  holidays: [{ id: "h1", date: "2026-11-09", name: "Fiesta local", scope: "local" }],
  absences: [{ id: "a1", userId: "ana", startDate: "2026-11-11", endDate: "2026-11-12", type: "vacaciones", note: "boda" }],
});
const T = (id, projectId, start, due, who, extra = {}) => ({ id, title: "Tarea " + id, projectId, startDate: start, dueDate: due, assigneeIds: who, isComplete: false, isMilestone: false, priority: "media", tags: [], ...extra });
// Ana: tres tareas se pisan el jueves 5 (saturado) y una vence en sus vacaciones (jueves 12).
const p1 = [T("a1", "P1", "2026-11-03", "2026-11-05", ["ana"]), T("a2", "P1", "2026-11-04", "2026-11-06", ["ana"]), T("a3", "P1", "2026-11-05", "2026-11-05", ["ana"]), T("a4", "P1", "2026-11-10", "2026-11-12", ["ana"])];
const p2 = [T("l1", "P2", "2026-11-03", "2026-11-04", ["luis"], { title: "Solo de Luis" }), T("b1", "P2", "2026-11-05", "2026-11-06", ["bea"]), T("s1", "P2", "2026-11-05", "2026-11-05", ["ana", "luis"], { title: "Compartida" })];
const groups = [
  { id: "P1", label: "Proyecto Uno", color: "#c00", code: "26001", sections: [], tasks: p1 },
  { id: "P2", label: "Proyecto Dos", color: "#0a0", code: "26002", sections: [], tasks: p2 },
];

const calls = { groupBy: [], dept: [], open: [] };
function render(viewer, { groupBy = "person", departmentFilter = "", zoom = "day", project } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  renderTimelineView(container, {
    groups, zoom, onZoomChange() {}, viewMode: "tasks", onViewModeChange() {}, expandedSections: new Set(), onToggleSectionExpand() {},
    showHolidays: false, onToggleHolidays() {}, onOpenTask: (id) => calls.open.push(id), exportTitle: "x", groupLabel: "Proyecto",
    teamMembers: members, currentUser: viewer, workCalendar: calendar, project,
    groupBy, onGroupByChange: (v) => calls.groupBy.push(v), departmentFilter, onDepartmentFilterChange: (v) => calls.dept.push(v),
  });
  return container;
}
const people = (c) => [...c.querySelectorAll("[data-person]")].map((e) => e.dataset.person);
const admin = members[0];

// ---------------------------------------------------------------- visibilidad por departamento
let c = render(admin);
eq("admin: ve a todos", people(c), ["admin", "ana", "bea", "luis", "zoe"]);
c = render(admin, { departmentFilter: "tecnicos" });
eq("admin filtra por Técnicos: solo Ana", people(c), ["ana"]);
check("… y no aparece ninguna tarea de Luis ni de Bea", !c.textContent.includes("Solo de Luis") && !c.textContent.includes("Tarea b1"));
check("… pero sí la compartida de Ana", c.textContent.includes("Compartida"));
c = render(admin, { departmentFilter: "diseno" });
eq("admin filtra por el grupo Diseño: Bea", people(c), ["bea"]);
c = render(members[1]); // Ana, Responsable de Técnicos
eq("v81: la Responsable de Técnicos solo ve a Técnicos", people(c), ["ana"]);
check("… no ve el selector de departamento, sino su departamento", !c.querySelector("#tl-dept-filter") && c.textContent.includes("Departamento: Técnicos"));
check("… y ve el conmutador «Persona (carga)»", !!c.querySelector('[data-groupby="person"]'));
check("… no ve las tareas de otros", !c.textContent.includes("Solo de Luis"));
c = render(members[2]); // Bea, Responsable de Diseño - Industria
eq("v81: la Responsable de Diseño ve el grupo Diseño (aquí solo Bea)", people(c), ["bea"]);
// v81: quien no es admin ni Responsable NO ve la carga de nadie
c = render(members[3]); // Luis, trabajador normal de Producción, pide el modo Persona
eq("v81: un trabajador normal no ve ningún bloque de persona (ni el suyo)", people(c), []);
check("… ni el conmutador «Agrupar por»", !c.querySelector("[data-groupby]"));
check("… vuelve a la línea de tiempo por Proyecto (Secciones/Tareas visibles, sin leyenda de carga)", !!c.querySelector("[data-viewmode]") && !c.querySelector(".tl-wl-legend"));
check("… y las tareas de todos siguen saliendo agrupadas por proyecto (no se pierde nada)", c.textContent.includes("Proyecto Uno") && c.textContent.includes("Proyecto Dos"));
c = render(members[3], { groupBy: "workload" }); // el valor que guardaba la idea original
eq("v81: un valor «workload» forzado tampoco abre la carga", people(c), []);
c = render(members[4]); // Zoe: marca de Responsable pero sin departamento
eq("v81: la marca de Responsable sin departamento no vale: nadie", people(c), []);
check("… y no hay conmutador", !c.querySelector("[data-groupby]"));
c = render({ uid: "viejo", role: "member", name: "Viejo", department: "tecnicos" }); // cuenta anterior a la v81 (sin marca)
eq("v81: una cuenta anterior, sin marca de Responsable, no ve la carga", people(c), []);
c = render(admin);
const sel = c.querySelector("#tl-dept-filter");
check("el admin tiene el selector de departamento con todos los grupos", !!sel && [...sel.options].map((o) => o.value).join() === ",diseno,diseno-industria,diseno-automocion,tecnicos,produccion,none", sel && [...sel.options].map((o) => o.value));
sel.value = "produccion"; sel.dispatchEvent(new window.Event("change", { bubbles: true }));
eq("cambiar el selector avisa a la app", calls.dept, ["produccion"]);

// ---------------------------------------------------------------- franja de carga de Ana
c = render(admin, { departmentFilter: "tecnicos" });
const heat = [...c.querySelectorAll(".tl-wl-cell")];
const heatAt = (txt) => heat.find((e) => e.title.startsWith(txt));
check("hay una celda por día", heat.length > 10, heat.length);
const thu = heatAt("05/11");
check("jueves 5: 4 tareas activas (3 de P1 + la compartida) → saturado", thu && thu.textContent === "4" && thu.classList.contains("tl-wl-cell--high"), thu && [thu.textContent, thu.className]);
check("… con entregas simultáneas (a1, a3 y la compartida vencen el 5)", thu.classList.contains("has-clash"));
check("lunes 2: sin tareas, sin número", heatAt("02/11").textContent === "" && heatAt("02/11").classList.contains("tl-wl-cell--none"));
check("martes 3: 1 tarea → nivel ok", heatAt("03/11").classList.contains("tl-wl-cell--ok") && heatAt("03/11").textContent === "1");
const pill = c.querySelector('[data-person="ana"] .tl-wl-pill');
check("la cabecera de Ana avisa (⚠) y su tooltip lo explica", pill && /⚠/.test(pill.textContent) && /saturado/.test(pill.title) && /ausencia/.test(pill.title), pill && [pill.textContent, pill.title]);
check("estado de alerta: su tarea a4 vence en sus vacaciones", pill.classList.contains("tl-wl-pill--alert"));
// Ausencias sombreadas
const abs = [...c.querySelectorAll('.tl-wl-absence[data-absent-uid="ana"]')];
check("las vacaciones de Ana (11 y 12) se sombrean en dos columnas", abs.length === 2, abs.length);
check("el sombreado cubre todo su bloque (cabecera + 5 tareas)", abs.every((a) => /grid-row:\s*\d+ \/ \d+/.test(a.getAttribute("style"))));
check("el festivo del 9 se sombrea (columna de festivo de la v78)", c.querySelectorAll(".tl-cal-holiday-col").length >= 1);
// Barras y códigos
const bars = [...c.querySelectorAll(".tl-bar")];
check("cada barra lleva el código YYXXX de su proyecto", bars.length >= 5 && bars.every((b) => /^(26001|26002)$/.test((b.querySelector(".tl-bar__code") || {}).textContent)), bars.map((b) => b.textContent));
check("la etiqueta de la tarea también lleva el código", [...c.querySelectorAll(".tl-code")].some((e) => e.textContent === "26001"));
check("las barras que coinciden en el día saturado llevan el contorno rojo", c.querySelector('.tl-bar[data-task-id="a1"]').classList.contains("tl-bar--hot") && !c.querySelector('.tl-bar[data-task-id="a4"]').classList.contains("tl-bar--hot"));
check("la tarea compartida sale en el bloque de Ana", !!c.querySelector('[data-task-id="s1"]'));
c = render(admin, { departmentFilter: "produccion" });
check("y también en el de Luis", !!c.querySelector('[data-task-id="s1"]') && !!c.querySelector('[data-task-id="l1"]'));
const luisPill = c.querySelector('[data-person="luis"] .tl-wl-pill');
check("Luis (sin saturación ni ausencias) muestra su contador sin aviso", luisPill && !/⚠/.test(luisPill.textContent) && luisPill.textContent === "2 act.", luisPill && luisPill.textContent);
// Clic en una barra abre la tarea
c.querySelector('[data-task-id="l1"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
eq("clic en una barra abre la tarea", calls.open.slice(-1), ["l1"]);

// ---------------------------------------------------------------- zoom semana
c = render(admin, { departmentFilter: "tecnicos", zoom: "week" });
check("en zoom de semana también hay franja de carga con pico semanal", [...c.querySelectorAll(".tl-wl-cell")].some((e) => e.textContent === "4" && /pico/.test(e.title)));
check("… y festivo y vacaciones se sombrean por fracción de la semana", c.querySelectorAll(".tl-wl-holiday").length >= 1 && c.querySelectorAll(".tl-wl-absence").length >= 1);

// ---------------------------------------------------------------- conmutador y modo proyecto
c = render(admin, { groupBy: "project" });
check("modo Proyecto: sin bloques de persona", people(c).length === 0);
check("modo Proyecto: el conmutador marca «Proyecto» y están los botones Secciones/Tareas", c.querySelector('[data-groupby="project"]').classList.contains("is-active") && !!c.querySelector("[data-viewmode]"));
check("modo Proyecto: sin códigos en las barras (como antes)", !c.querySelector(".tl-bar__code") && !c.querySelector(".tl-wl-legend"));
c.querySelector('[data-groupby="person"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
eq("pulsar «Persona (carga)» avisa a la app", calls.groupBy, ["person"]);
c = render(admin, { groupBy: "person" });
check("modo Persona: botones Secciones/Tareas ocultos, leyenda visible", !c.querySelector("[data-viewmode]") && !!c.querySelector(".tl-wl-legend"));
c = render(admin, { groupBy: "person", project: { id: "P1", name: "Proyecto Uno", sections: [] } });
check("en la línea de tiempo de un proyecto NO hay conmutador ni modo Persona", !c.querySelector("[data-groupby]") && people(c).length === 0);

// Responsable de un departamento cuyo único miembro es otro
c = render({ uid: "nuevo", role: "member", name: "Nuevo", department: "produccion", isDepartmentHead: true });
// (su alcance es Producción: Luis; él mismo no está en `members`)
eq("alcance Producción: solo Luis", people(c), ["luis"]);
const none = render(admin, { departmentFilter: "none", groupBy: "person" });
eq("admin con «sin departamento»: Admin y Zoe", people(none), ["admin", "zoe"]);
// v81: el estado «Persona» en app.js (groupBy) de un admin sigue funcionando
c = render(admin, { groupBy: "person", project: undefined });
check("admin: el conmutador sigue visible", !!c.querySelector('[data-groupby="person"]'));

done("Carga por persona · línea de tiempo (jsdom)");
process.exit(0);
