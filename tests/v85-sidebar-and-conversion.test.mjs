// v85 · sidebar, conversión de ofertas, bloque de etapas y línea de tiempo.
//  1) Bloque «Flujo de Etapas» del modal de tarea: reglas CSS anti-desbordamiento y estructura en 3 sub-filas.
//  2) Línea de tiempo: desglose y proyección de TODAS las etapas habilitadas (lógica pura + dibujo en jsdom).
//  3) Barra lateral: el scrollTop se conserva al repintar (clic en un proyecto).
//  4) Convertir una oferta en proyecto: icono y color elegidos en el propio modal pasan a convertOfferToProject/createProject.
//  5) Filtro por sector (Todos | Industria | Automoción): normalización, filtrado, persistencia, barra lateral y línea de tiempo.
//  6) Entrega: ?v=85, package.json, Novedades y README.
import fs from "node:fs";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
window.HTMLElement.prototype.scrollTo = () => {}; // jsdom no lo trae (la línea de tiempo se centra en hoy)
freezeNow("2026-11-04T12:00:00"); // miércoles

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el, props = {}) => { Object.assign(el, props); el.dispatchEvent(new window.Event("change", { bubbles: true })); };

/** Cuerpo de la PRIMERA regla CSS cuyo selector es exactamente `selector` ('' si no existe). Ignora @media (busca fuera de ellos y dentro). */
function cssRule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[1] : "";
}
const iconBtn = (icon) => [...document.querySelectorAll("#pp-appearance [data-icon]")].find((b) => b.dataset.icon === icon); // jsdom no admite emojis en selectores CSS
const has = (body, decl) => body.replace(/\s+/g, " ").includes(decl);

const ws = await import("../js/workflow-stages.js");
const wc = await import("../js/work-calendar.js");
const cfg = wc.normalizeWorkCalendar({
  holidays: wc.officialHolidays(2026),
  absences: [{ id: "a1", userId: "compras", startDate: "2026-11-10", endDate: "2026-11-11", type: "vacaciones", note: "" }],
});

// ---------------------------------------------------------------- 1) bloque «Flujo de Etapas»: reglas anti-desbordamiento
{
  const css = read("css/07-modals.css");
  const section = cssRule(css, ".wf-section");
  check("CSS: .wf-section → box-sizing border-box + max-width 100% (v87: overflow visible; el overflow hidden de la v85 lo aplastaba, ver v87-automotive-icons.test.mjs)", has(section, "box-sizing: border-box") && has(section, "max-width: 100%") && has(section, "overflow: visible"), section);
  const row = cssRule(css, ".wf-row");
  check("CSS: .wf-row (cada etapa) → box-sizing border-box + max-width 100% + min-width 0 (v87: overflow visible)", has(row, "box-sizing: border-box") && has(row, "max-width: 100%") && has(row, "overflow: visible") && has(row, "min-width: 0"), row);
  const head = cssRule(css, ".wf-row__head");
  check("CSS: sub-fila 1 (cabecera) → flex con gap 10px", has(head, "display: flex") && has(head, "gap: 10px"), head);
  check("CSS: … el nombre va en negrita 600 y el estado a la derecha (margin-left: auto), sin pisarse", has(cssRule(css, ".wf-row__name"), "font-weight: 600") && has(cssRule(css, ".wf-row__state"), "margin-left: auto"));
  const controls = cssRule(css, ".wf-row__controls");
  check("CSS: sub-fila 2 → rejilla minmax(140px, 1.3fr) minmax(115px, 1fr) minmax(115px, 1fr), gap 8px, width 100%", has(controls, "display: grid") && has(controls, "grid-template-columns: minmax(140px, 1.3fr) minmax(115px, 1fr) minmax(115px, 1fr)") && has(controls, "gap: 8px") && has(controls, "width: 100%") && has(controls, "box-sizing: border-box"), controls);
  const ctlFields = cssRule(css, ".wf-row__controls .field__select, .wf-row__controls .field__input");
  check("CSS: el <select> y las dos fechas → min-width 0, width 100%, box-sizing border-box", has(ctlFields, "min-width: 0") && has(ctlFields, "width: 100%") && has(ctlFields, "box-sizing: border-box"), ctlFields);
  const note = cssRule(css, ".wf-row__note");
  check("CSS: sub-fila 3 (nota de relevo) → width 100%, min-width 0, box-sizing border-box", has(note, "width: 100%") && has(note, "min-width: 0") && has(note, "box-sizing: border-box") && has(note, "max-width: 100%"), note);
  check("CSS: en pantallas estrechas (<560px) la rejilla pasa a 1fr 1fr", /@media \(max-width: 560px\)\s*\{[^}]*\.wf-row__controls\s*\{\s*grid-template-columns:\s*1fr 1fr/.test(css.replace(/\s+/g, " ")));
  check("CSS: ya no queda la rejilla antigua de una sola línea con 6 columnas", !/\.wf-row\s*\{[^}]*grid-template-columns/.test(css));

  // Estructura real en jsdom
  const { openTaskModal } = await import("../js/components/task-modal.js");
  const project = { id: "P", name: "Proyecto", sections: [{ id: "s1", name: "S", order: 0 }] };
  const members = [{ uid: "disenador", name: "Diana", role: "member" }, { uid: "compras", name: "Carlos", role: "member" }, { uid: "taller", name: "Tomás", role: "member" }];
  openTaskModal({ project, teamMembers: members, allProjects: [project], tagsRegistry: [], currentUserProfile: { uid: "disenador", name: "Diana", role: "member" }, onSaved() {}, onClosed() {} });
  await tick(20);
  const rows = [...document.querySelectorAll(".wf-row")];
  eq("modal: 3 etapas activas por defecto, una fila cada una", rows.length, 3);
  // v86: la etapa Compra/Pedido añade una sub-fila propia («wf-row__trace», datos de la compra) entre los controles y la nota; las demás siguen con 3.
  check("… cada etapa son sub-filas hijas directas: cabecera, controles y nota (v86: Compra/Pedido lleva además la de datos de compra)", rows.every((r) => [...r.children].map((c) => c.className.split(" ").find((k) => k.startsWith("wf-row__"))).join() === (/Compra/.test($(".wf-row__name", r).textContent) ? "wf-row__head,wf-row__controls,wf-row__trace,wf-row__note" : "wf-row__head,wf-row__controls,wf-row__note")), rows.map((r) => [...r.children].map((c) => c.className)));
  check("… la cabecera lleva el punto + nombre y el estado en elementos aparte (no se pisan)", rows.every((r) => $(".wf-row__head .wf-row__name .wf-dot", r) && $(".wf-row__head .wf-row__state", r) && !$(".wf-row__name", r).contains($(".wf-row__state", r))));
  check("… los controles son: responsable (select) + inicio + fin, y la nota va fuera de ellos", rows.every((r) => { const c = $(".wf-row__controls", r); return c.children.length === 3 && c.children[0].tagName === "SELECT" && c.children[1].type === "date" && c.children[2].type === "date" && !c.contains($(".wf-row__note", r)); }));
  check("… el responsable ofrece «Sin responsable» completo y conserva sus atributos data-wf-*", rows.every((r) => /Sin responsable/.test($("[data-wf-who]", r).textContent) && $("[data-wf-start]", r) && $("[data-wf-due]", r) && $("[data-wf-note]", r)));
  const names = rows.map((r) => $(".wf-row__name", r).textContent.trim());
  eq("… los nombres Compra/Pedido y Recepción/Fab. salen completos en su propia celda", names, ["Diseño", "Compra/Pedido", "Recepción/Fab."]);
  globalThis.confirm = () => true;
  document.querySelector("#t-cancel").click();
}

// ---------------------------------------------------------------- 2) línea de tiempo: desglose y proyección de las 3 etapas
const designDated = (extra = {}) => ({
  id: "T1", title: "Cabina completa", projectId: "P", isComplete: false, isMilestone: false, assigneeIds: ["disenador"], priority: "media", tags: [],
  startDate: "2026-11-03", dueDate: "2026-11-06",
  workflow: ws.workflowFromEnabled(["design", "purchase", "production"], { design: { assigneeId: "disenador", startDate: "2026-11-03", dueDate: "2026-11-06" } }),
  ...extra,
});
{
  const segs = ws.timelineStages(designDated(), { cfg });
  eq("tarea en Diseño con solo Diseño fechado: salen las 3 etapas, en orden", segs.map((s) => s.key), ["design", "purchase", "production"]);
  eq("… con las etiquetas Diseño / Compra / Recepción/Fab.", segs.map((s) => s.label), ["Diseño", "Compra", "Recepción/Fab."]);
  eq("… estados: en curso, pendiente, pendiente", segs.map((s) => s.status), ["current", "pending", "pending"]);
  eq("… solo las dos últimas son proyectadas", segs.map((s) => s.projected), [false, true, true]);
  eq("… Diseño conserva sus fechas exactas", [segs[0].startDate, segs[0].dueDate], ["2026-11-03", "2026-11-06"]);
  // Compra: empieza el primer laborable tras el 6/11 (vie) → lunes 9/11; +5 laborables = 16/11
  eq("… Compra se proyecta a continuación del fin de Diseño (lunes 9/11) y dura 5 días laborables", [segs[1].startDate, segs[1].dueDate], ["2026-11-09", "2026-11-16"]);
  eq("… Recepción/Fab. se proyecta tras Compra y dura la estimación visible (5 laborables)", [segs[2].startDate, segs[2].dueDate], ["2026-11-17", "2026-11-24"]);
  check("… la cadena no se solapa (cada etapa empieza después de que acabe la anterior)", segs[1].startDate > segs[0].dueDate && segs[2].startDate > segs[1].dueDate);
  check("la constante de la estimación de Recepción/Fab. es pública y vale 5", ws.PRODUCTION_PROJECTED_DAYS === 5 && ws.PURCHASE_DEFAULT_DAYS === 5);
  eq("colores propios por etapa: azul, ámbar y esmeralda", [ws.STAGE_TIMELINE_COLORS.design, ws.STAGE_TIMELINE_COLORS.purchase, ws.STAGE_TIMELINE_COLORS.production], ["#3b82f6", "#f59e0b", "#10b981"]);

  // Con ausencia del responsable de Compra: su tramo proyectado respeta sus días laborables
  const withBuyer = designDated({ workflow: ws.workflowFromEnabled(["design", "purchase", "production"], { design: { assigneeId: "disenador", startDate: "2026-11-03", dueDate: "2026-11-06" }, purchase: { assigneeId: "compras" } }) });
  const sb = ws.timelineStages(withBuyer, { cfg });
  eq("el comprador de vacaciones 10–11/11: Compra proyectada 9/11 + 5 laborables (sin contar sus 2 días) = 18/11", [sb[1].startDate, sb[1].dueDate], ["2026-11-09", "2026-11-18"]);

  // Fechas reales: se pintan exactas, sin proyectar
  const real = designDated({ workflow: ws.workflowFromEnabled(["design", "purchase", "production"], {
    design: { assigneeId: "disenador", startDate: "2026-11-03", dueDate: "2026-11-06", completed: true },
    purchase: { assigneeId: "compras", startDate: "2026-11-09", dueDate: "2026-11-13" },
    production: { assigneeId: "taller", startDate: "2026-11-30", dueDate: "2026-12-11" },
  }) });
  const sr = ws.timelineStages(real, { cfg });
  eq("etapas con fechas propias: exactas, ninguna proyectada", sr.map((s) => [s.startDate, s.dueDate, s.projected]), [["2026-11-03", "2026-11-06", false], ["2026-11-09", "2026-11-13", false], ["2026-11-30", "2026-12-11", false]]);
  eq("… estados: completada, en curso (Compra), pendiente", sr.map((s) => s.status), ["done", "current", "pending"]);
  // Mezcla: Compra con fechas y Recepción sin ellas → proyecta desde el fin de Compra
  const mix = designDated({ workflow: ws.workflowFromEnabled(["design", "purchase", "production"], {
    design: { startDate: "2026-11-03", dueDate: "2026-11-06", completed: true },
    purchase: { startDate: "2026-11-09", dueDate: "2026-11-13" },
  }) });
  const sm = ws.timelineStages(mix, { cfg });
  eq("Recepción/Fab. sin fechas cuelga del fin REAL de Compra (13/11 → lunes 16/11)", [sm[2].startDate, sm[2].projected], ["2026-11-16", true]);

  // 1 o 2 etapas habilitadas
  eq("solo Diseño + Recepción/Fab.: 2 etapas (Compra no sale)", ws.timelineStages(designDated({ workflow: ws.workflowFromEnabled(["design", "production"], { design: { startDate: "2026-11-03", dueDate: "2026-11-06" } }) }), { cfg }).map((s) => s.key), ["design", "production"]);
  eq("solo Diseño: 1 etapa", ws.timelineStages(designDated({ workflow: ws.workflowFromEnabled(["design"], { design: { startDate: "2026-11-03", dueDate: "2026-11-06" } }) }), { cfg }).map((s) => s.key), ["design"]);
  eq("sin flujo (tarea antigua): ninguna", ws.timelineStages({ id: "x", projectId: "P", startDate: "2026-11-03", dueDate: "2026-11-06" }, { cfg }), []);
  eq("tarea de Ofertas: ninguna", ws.timelineStages(designDated({ projectId: "OFF" }), { cfg, offersProjectId: "OFF" }), []);
  eq("tarea completada: todas sus etapas salen como completadas", ws.timelineStages(designDated({ isComplete: true }), { cfg }).map((s) => s.status), ["done", "done", "done"]);
  eq("etapa activa sin fechas propias usa las de la tarea", ws.timelineStages(designDated({ workflow: ws.workflowFromEnabled(["design", "purchase"]) }), { cfg }).map((s) => [s.key, s.startDate, s.dueDate]), [["design", "2026-11-03", "2026-11-06"], ["purchase", "2026-11-09", "2026-11-16"]]);
  eq("sin ninguna fecha de la que colgar: no se inventa nada", ws.timelineStages({ id: "n", projectId: "P", isComplete: false, workflow: ws.workflowFromEnabled(["design", "purchase", "production"]) }, { cfg }), []);

  // Tooltip
  const tip = ws.describeTimelineSegment(segs[1], (u) => (u === "compras" ? "Carlos" : ""));
  check("tooltip: etapa y estado, responsable y fechas (proyectadas)", /Compra\/Pedido · Pendiente/.test(tip) && /Responsable: Sin responsable/.test(tip) && /Fechas: 09\/11–16\/11/.test(tip) && /proyectadas/.test(tip), tip);
  const tip2 = ws.describeTimelineSegment({ ...sb[1], status: "current" }, (u) => (u === "compras" ? "Carlos" : ""));
  check("tooltip: con responsable lo nombra y una etapa fechada no dice «proyectadas»", /Responsable: Carlos/.test(tip2) && /En curso/.test(tip2) && !/proyectadas/.test(describeSafe(sr[0])), tip2);
  function describeSafe(seg) { return ws.describeTimelineSegment(seg, () => "Diana"); }
}

// ---- dibujo real de la línea de tiempo
const members2 = [{ uid: "admin", name: "Admin", role: "admin" }, { uid: "disenador", name: "Diana", role: "member" }, { uid: "compras", name: "Carlos", role: "member" }, { uid: "taller", name: "Tomás", role: "member" }];
const { renderTimelineView } = await import("../js/views/timeline-view.js");
function renderTl({ tasks, project, sectorFilter, onSectorFilterChange, groups, zoom = "day" } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  renderTimelineView(container, {
    groups: groups || [{ id: "P", label: "Proyecto", color: "#c00", code: "26001", sections: [], tasks }], zoom, onZoomChange() {}, viewMode: "tasks", onViewModeChange() {},
    expandedSections: new Set(), onToggleSectionExpand() {}, showHolidays: false, onToggleHolidays() {}, onOpenTask() {}, exportTitle: "x", groupLabel: "Proyecto",
    teamMembers: members2, currentUser: members2[0], workCalendar: cfg, groupBy: "project", onGroupByChange() {}, departmentFilter: "", onDepartmentFilterChange() {},
    project, sectorFilter, onSectorFilterChange,
  });
  return container;
}
{
  const c = renderTl({ tasks: [designDated()] });
  const bars = [...c.querySelectorAll(".tl-bar--seg")];
  eq("Gantt: la tarea con solo Diseño fechado dibuja las 3 etapas", bars.map((b) => b.dataset.stage), ["design", "purchase", "production"]);
  eq("… con etiquetas Diseño / Compra / Recepción/Fab.", bars.map((b) => b.querySelector(".tl-bar__code").textContent.trim()), ["Diseño", "Compra", "Recepción/Fab."]);
  eq("… estado por clase: en curso, pendiente, pendiente", bars.map((b) => ["is-current", "is-pending", "is-done"].find((k) => b.classList.contains(k))), ["is-current", "is-pending", "is-pending"]);
  check("… las dos proyectadas llevan is-projected y data-projected; la fechada no", !bars[0].classList.contains("is-projected") && bars[1].classList.contains("is-projected") && bars[2].classList.contains("is-projected") && bars[1].dataset.projected === "1" && !bars[0].hasAttribute("data-projected"));
  const col = (b) => parseInt(b.style.gridColumn, 10);
  check("… están encadenadas de izquierda a derecha (cada una empieza después de la anterior)", col(bars[0]) < col(bars[1]) && col(bars[1]) < col(bars[2]), bars.map((b) => b.style.gridColumn));
  check("… tooltip con etapa, estado, responsable y fechas", /Compra\/Pedido · Pendiente/.test(bars[1].title) && /Responsable:/.test(bars[1].title) && /Fechas: 09\/11–16\/11/.test(bars[1].title) && /Cabina completa/.test(bars[1].title), bars[1].title);
  check("… no se arrastran (las fechas de cada etapa se editan en el modal)", bars.every((b) => !b.hasAttribute("data-drag-task")) && bars.every((b) => b.dataset.open === "T1"));
  check("… hay leyenda de colores de las etapas", !!c.querySelector(".tl-stage-legend"));

  const done3 = renderTl({ tasks: [designDated({ isComplete: true })] });
  const doneBars = [...done3.querySelectorAll(".tl-bar--seg")];
  check("tarea completada: 3 tramos completados con ✓ en la etiqueta", doneBars.length === 3 && doneBars.every((b) => b.classList.contains("is-done") && /^✓/.test(b.querySelector(".tl-bar__code").textContent.trim())));

  const plain = { id: "L2", title: "Sin etapas", projectId: "P", startDate: "2026-11-03", dueDate: "2026-11-06", assigneeIds: ["compras"], isComplete: false, isMilestone: false, priority: "media", tags: [] };
  const cp = renderTl({ tasks: [plain] });
  check("una tarea sin etapas conserva su barra normal arrastrable y sin leyenda", !cp.querySelector(".tl-bar--seg") && !!cp.querySelector('.tl-bar[data-drag-task="L2"]') && !cp.querySelector(".tl-stage-legend"));

  // La escala incluye lo proyectado: una tarea con la etapa 1 muy corta no recorta la cadena
  const far = renderTl({ tasks: [designDated({ startDate: "2026-11-03", dueDate: "2026-11-03", workflow: ws.workflowFromEnabled(["design", "purchase", "production"], { design: { startDate: "2026-11-03", dueDate: "2026-11-03" } }) })] });
  check("la escala se amplía para que se vean las 3 barras aunque las proyectadas caigan lejos", far.querySelectorAll(".tl-bar--seg").length === 3);

  // Tarea sin fechas propias pero con etapa fechada → se dibuja igual (cuenta como «con fechas»)
  const onlyStage = renderTl({ tasks: [designDated({ startDate: null, dueDate: null, workflow: ws.workflowFromEnabled(["design", "purchase"], { purchase: { startDate: "2026-11-09", dueDate: "2026-11-13" } }) })] });
  check("una tarea sin fechas principales pero con fechas en una etapa también se dibuja", onlyStage.querySelectorAll(".tl-bar--seg").length >= 1);

  // CSS
  const tcss = read("css/08-calendar-timeline.css");
  check("CSS: colores #3b82f6 / #f59e0b / #10b981 por etapa", /--tl-stage-design:\s*#3b82f6/.test(tcss) && /--tl-stage-purchase:\s*#f59e0b/.test(tcss) && /--tl-stage-production:\s*#10b981/.test(tcss));
  check("CSS: completada atenuada, en curso con anillo/sombra, pendiente discontinua con trama", /\.tl-bar--seg\.is-done\s*\{[^}]*opacity:\s*0\.\d+/.test(tcss) && /\.tl-bar--seg\.is-current\s*\{[^}]*box-shadow/.test(tcss) && /\.tl-bar--seg\.is-pending\s*\{[^}]*dashed/.test(tcss) && /repeating-linear-gradient/.test(tcss));
}

// ---------------------------------------------------------------- 3) barra lateral: conserva el scroll al repintar
const { renderSidebar, captureSidebarScroll, restoreSidebarScroll } = await import("../js/components/sidebar.js");
const sectorOf = (i) => (i % 3 === 0 ? "Industria" : i % 3 === 1 ? "Automoción" : "");
const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Proyecto ${i}`, color: "#FCD000", icon: "📁", exclusive: false, properties: { sector: sectorOf(i) } }));
const offers = { id: "off", name: "Ofertas", exclusive: true, icon: "💼", color: "#8B85C4" };
const user = { uid: "u1", name: "Ramón", email: "r@x.es", role: "admin", department: "" };
const sbBase = (over = {}) => ({
  projects: [offers, ...many], currentProjectId: null, isMyTasksActive: false, isTimelineActive: false, isArchiveActive: false, isTrashActive: false, myTasksCount: 0,
  userProfile: user, isCollapsed: false, onToggleCollapse() {}, isNavCollapsed: false, onToggleNav() {}, sectorFilter: "todos", onSectorFilterChange() {},
  onSelectProject() {}, onSelectMyTasks() {}, onSelectTimeline() {}, onSelectArchive() {}, onSelectTrash() {}, onSelectMetrics() {}, onCreateProject() {}, onOpenSearch() {},
  onOpenAccount() {}, onOpenWhatsNew() {}, onOpenTeamAdmin() {}, onOpenDepartmentAccess() {}, onOpenWorkCalendar() {}, onOpenOutlookBridge() {}, onOpenDriveStorage() {},
  onOpenAsanaImport() {}, onOpenQuickCreateAdmin() {}, onOpenProjectProperties() {}, onLogout() {}, ...over,
});
{
  const side = document.createElement("aside");
  side.id = "sidebar-test";
  side.className = "sidebar";
  document.body.appendChild(side);
  let current = null;
  const paint = () => renderSidebar(side, sbBase({ currentProjectId: current, onSelectProject: (id) => { current = id; paint(); } }));
  paint();
  const list0 = $("#projectList", side);
  check("la lista de proyectos tiene id projectList y sigue siendo .sidebar__list", !!list0 && list0.classList.contains("sidebar__list"));
  list0.scrollTop = 420;
  side.scrollTop = 33;
  // Clic real sobre un proyecto de la parte baja: app.js selecciona y repinta la barra
  click($('[data-project-id="p35"]', side));
  const list1 = $("#projectList", side);
  check("tras el clic la lista es un nodo NUEVO (innerHTML repintado)…", list1 !== list0);
  eq("… pero conserva el scrollTop de la lista de proyectos (420)", list1.scrollTop, 420);
  eq("… y el de la propia barra (33)", side.scrollTop, 33);
  check("… y el proyecto clicado queda marcado como activo", $('[data-project-id="p35"]', side).classList.contains("is-active"));
  click($('[data-project-id="p36"]', side));
  eq("segundo repintado seguido: el scroll sigue en 420", $("#projectList", side).scrollTop, 420);

  // Funciones auxiliares sueltas
  const snap = captureSidebarScroll(side);
  check("captureSidebarScroll recoge barra y lista", snap.self === 33 && snap.nodes.some(([sel, top]) => sel === "#projectList" && top === 420), snap);
  const empty = document.createElement("div");
  restoreSidebarScroll(empty, snap); // sin lista: no debe lanzar
  restoreSidebarScroll(null, snap);
  check("restoreSidebarScroll tolera un contenedor sin lista o nulo", empty.scrollTop === 33);

  const src = read("js/components/sidebar.js");
  const iCapture = src.indexOf("const scrollSnapshot = captureSidebarScroll(container)");
  const iHtml = src.indexOf("container.innerHTML = `");
  const iRestore = src.lastIndexOf("restoreSidebarScroll(container, scrollSnapshot)");
  check("sidebar.js: se captura ANTES de container.innerHTML y se restaura DESPUÉS, de forma síncrona", iCapture > 0 && iCapture < iHtml && iRestore > iHtml && !/requestAnimationFrame|setTimeout/.test(src.slice(iRestore - 50, iRestore + 80)));
  check("CSS: la lista de proyectos mantiene su overflow-y: auto", /\.sidebar__list\s*\{[^}]*overflow-y:\s*auto/.test(read("css/05-layout.css")));
  const appSrc = read("js/app.js");
  check("app.js: el cambio de sector repinta solo la barra (renderSidebarOnly) fuera de la línea de tiempo", /function renderSidebarOnly\(\)/.test(appSrc) && /else renderSidebarOnly\(\)/.test(appSrc));
}

// ---------------------------------------------------------------- 4) convertir oferta en proyecto: icono y color
{
  const { openOfferConversionModal, openProjectPropertiesModal } = await import("../js/components/project-properties-modal.js");
  const offersProject = { id: "off", name: "Ofertas", exclusive: true, customFieldDefs: [], sections: [] };
  const offer = { id: "O1", title: "Cabina Talgo", projectId: "off", offerCode: "00126", dueDate: "2026-12-01", customFields: {}, revisions: [] };
  let confirmed = null;
  openOfferConversionModal({ offer, offersProject, today: "2026-11-04", getCommercialOptions: () => [], onConfirm: async (r) => { confirmed = r; } });
  const picker = $("#pp-appearance .appearance-picker");
  check("el modal de conversión incrusta el selector de icono y color (project-appearance-picker)", !!picker && !!$("#pp-appearance .icon-grid") && document.querySelectorAll("#pp-appearance .color-swatch").length === 8);
  check("… con un campo etiquetado «Icono y color del proyecto» bajo el nombre", /Icono y color del proyecto/.test($("#pp-appearance-field").textContent) && $("#pp-name").compareDocumentPosition($("#pp-appearance-field")) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  click(iconBtn("🏭"));
  click($('#pp-appearance [data-color="#6BA4D9"]'));
  check("… elegir icono y color repinta el selector con la selección", iconBtn("🏭").classList.contains("is-selected") && $('#pp-appearance [data-color="#6BA4D9"]').classList.contains("is-selected"));
  click($("#pp-confirm"));
  await tick(10);
  check("onConfirm recibe name, properties, icon y color elegidos", !!confirmed && confirmed.icon === "🏭" && confirmed.color === "#6BA4D9" && confirmed.name === "Cabina Talgo" && !!confirmed.properties, confirmed);

  // Sin tocar nada: valores por defecto (📁 / dorado) y elegir no ensucia el formulario inicial
  confirmed = null;
  openOfferConversionModal({ offer, offersProject, today: "2026-11-04", getCommercialOptions: () => [], onConfirm: async (r) => { confirmed = r; } });
  click($("#pp-confirm"));
  await tick(10);
  check("sin elegir nada, el proyecto sale con el icono y el color de partida (📁 y #FCD000)", !!confirmed && confirmed.icon === "📁" && confirmed.color === "#FCD000", confirmed);

  // «Propiedades» de un proyecto ya creado NO lleva el selector
  openProjectPropertiesModal({ project: { id: "p1", name: "Proyecto", properties: {} }, onSave() {}, getCommercialOptions: () => [] });
  check("«Propiedades» de un proyecto existente no incluye el selector (eso es «Editar proyecto»)", !$("#pp-appearance") && !$("#pp-appearance-field"));
  document.querySelector("#pp-cancel").click();

  // La escritura: convertOfferToProject → createProject (addDoc) con icon y color
  const { convertOfferToProject } = await import("../js/data/offer-conversion.js");
  const created = [];
  globalThis.__fb = { collections: {}, sets: [], hooks: { addDoc: async (ref, data) => { created.push({ ref, data }); return { id: "NEWPROJ" }; }, updateDoc: async () => {} } };
  const moveFolder = async () => ({ status: "none", folderId: null });
  const r1 = await convertOfferToProject({ offer, name: "Cabina Talgo", properties: { sector: "Industria" }, creatorUid: "u1", offersProject, icon: "🏭", color: "#6BA4D9", moveFolder });
  const proj1 = created.find((c) => c.ref.path === "projects");
  check("convertOfferToProject crea el proyecto con el icono y el color elegidos", !!proj1 && proj1.data.icon === "🏭" && proj1.data.color === "#6BA4D9" && r1.projectId === "NEWPROJ", proj1 && proj1.data);
  check("… y conserva propiedades (sector) e ID heredado de la oferta", proj1.data.properties.sector === "Industria" && proj1.data.code === "00126");
  created.length = 0;
  await convertOfferToProject({ offer, name: "Otra", properties: {}, creatorUid: "u1", offersProject, moveFolder });
  const proj2 = created.find((c) => c.ref.path === "projects");
  check("sin icon/color (llamada antigua) el proyecto nace con 📁 y el dorado de siempre", proj2.data.icon === "📁" && proj2.data.color === "#FCD000", proj2.data);
  created.length = 0;
  await convertOfferToProject({ offer, name: "Vacíos", properties: {}, creatorUid: "u1", offersProject, icon: "", color: "", moveFolder });
  check("icon/color vacíos se tratan como no elegidos", created.find((c) => c.ref.path === "projects").data.icon === "📁");
  delete globalThis.__fb;

  const appSrc = read("js/app.js");
  check("app.js pasa icon y color de la ventana de conversión a convertOfferToProject", /onConfirm:\s*async\s*\(\{\s*name,\s*properties,\s*icon,\s*color\s*\}\)/.test(appSrc) && /convertOfferToProject\(\{[^}]*icon,\s*color[^}]*\}\)/.test(appSrc));
}

// ---------------------------------------------------------------- 5) filtro por sector
const pp = await import("../js/project-properties.js");
{
  check("la clave de localStorage es chusy_sidebar_sector_filter", pp.SECTOR_FILTER_KEY === "chusy_sidebar_sector_filter");
  eq("opciones, en orden: Todos | Industria | Automoción", pp.SECTOR_FILTER_OPTIONS.map((o) => o.label), ["Todos", "Industria", "Automoción"]);
  eq("normaliza mayúsculas y tildes del sector del proyecto", ["Industria", "INDUSTRIA", " industria ", "Automoción", "AUTOMOCIÓN", "automocion", "Automocion "].map((s) => pp.projectSectorKey({ properties: { sector: s } })), ["industria", "industria", "industria", "automocion", "automocion", "automocion", "automocion"]);
  eq("sin sector, sector raro o sin propiedades: ''", [{ properties: { sector: "" } }, { properties: { sector: "Servicios" } }, { properties: {} }, {}, null].map(pp.projectSectorKey), ["", "", "", "", ""]);
  eq("normalizeSectorFilter: acepta etiquetas y claves, cae a 'todos'", ["Automoción", "AUTOMOCION", "industria", "Todos", "x", null, undefined].map(pp.normalizeSectorFilter), ["automocion", "automocion", "industria", "todos", "todos", "todos", "todos"]);

  const list = [
    { id: "a", properties: { sector: "Industria" } }, { id: "b", properties: { sector: "AUTOMOCIÓN" } }, { id: "c", properties: { sector: "industria " } },
    { id: "d", properties: {} }, { id: "e", properties: { sector: "automocion" } },
  ];
  eq("filtro «Todos»: todos, también los sin sector", pp.filterProjectsBySector(list, "todos").map((p) => p.id), ["a", "b", "c", "d", "e"]);
  eq("filtro «Industria»: solo los de Industria (sin los sin sector)", pp.filterProjectsBySector(list, "industria").map((p) => p.id), ["a", "c"]);
  eq("filtro «Automoción»: acepta AUTOMOCIÓN y automocion", pp.filterProjectsBySector(list, "automocion").map((p) => p.id), ["b", "e"]);
  eq("filtro con valor desconocido: no filtra", pp.filterProjectsBySector(list, "zzz").length, 5);
  check("filtrar no toca el array original y mantiene el orden", (() => { const copy = list.slice(); pp.filterProjectsBySector(list, "industria"); return list.every((p, i) => p === copy[i]); })());
  eq("entrada no array: lista vacía", pp.filterProjectsBySector(undefined, "industria"), []);

  // Persistencia
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  eq("sin nada guardado: 'todos'", pp.loadSectorFilter(storage), "todos");
  eq("saveSectorFilter guarda la clave normalizada y la devuelve", [pp.saveSectorFilter("Automoción", storage), mem.get("chusy_sidebar_sector_filter")], ["automocion", "automocion"]);
  eq("loadSectorFilter la recupera", pp.loadSectorFilter(storage), "automocion");
  mem.set("chusy_sidebar_sector_filter", "basura");
  eq("un valor guardado inválido vuelve a 'todos'", pp.loadSectorFilter(storage), "todos");
  const broken = { getItem() { throw new Error("sin almacenamiento"); }, setItem() { throw new Error("sin almacenamiento"); } };
  check("sin localStorage disponible no lanza (vale para la sesión)", pp.loadSectorFilter(broken) === "todos" && pp.saveSectorFilter("industria", broken) === "industria");
  pp.saveSectorFilter("industria"); // localStorage de jsdom
  eq("… y con el localStorage real de jsdom también persiste", window.localStorage.getItem("chusy_sidebar_sector_filter"), "industria");
  pp.saveSectorFilter("todos");

  // Barra lateral
  const side = document.createElement("aside");
  side.className = "sidebar";
  document.body.appendChild(side);
  const calls = [];
  const paintF = (f) => renderSidebar(side, sbBase({ sectorFilter: f, onSectorFilterChange: (k) => calls.push(k) }));
  paintF("todos");
  const pills = [...side.querySelectorAll(".sidebar__sector .sector-filter__pill")];
  eq("barra lateral: tres píldoras Todos | Industria | Automoción", pills.map((p) => p.textContent.trim()), ["Todos", "Industria", "Automoción"]);
  check("… encima de la lista de proyectos", $(".sidebar__sector", side).compareDocumentPosition($("#projectList", side)) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  eq("… «Todos» activa y lista completa (40 proyectos)", [pills.map((p) => p.classList.contains("is-active")), side.querySelectorAll("#projectList [data-project-id]").length], [[true, false, false], 40]);
  paintF("industria");
  const ids = [...side.querySelectorAll("#projectList [data-project-id]")].map((b) => b.dataset.projectId);
  check("«Industria»: solo proyectos de Industria (los i múltiplos de 3)", ids.length === many.filter((_, i) => i % 3 === 0).length && ids.every((id) => Number(id.slice(1)) % 3 === 0), ids);
  check("… la píldora activa cambia y aria-pressed la acompaña", side.querySelector('[data-sector-filter="industria"]').classList.contains("is-active") && side.querySelector('[data-sector-filter="industria"]').getAttribute("aria-pressed") === "true" && side.querySelector('[data-sector-filter="todos"]').getAttribute("aria-pressed") === "false");
  check("… el botón fijo de Ofertas (exclusivo) no se filtra", !!side.querySelector('.sidebar__nav [data-project-id="off"]'));
  paintF("automocion");
  const idsA = [...side.querySelectorAll("#projectList [data-project-id]")].map((b) => b.dataset.projectId);
  check("«Automoción»: solo los de Automoción (i % 3 === 1)", idsA.length === many.filter((_, i) => i % 3 === 1).length && idsA.every((id) => Number(id.slice(1)) % 3 === 1));
  click(side.querySelector('[data-sector-filter="industria"]'));
  click(side.querySelector('[data-sector-filter="todos"]'));
  eq("clic en una píldora avisa con su clave", calls, ["industria", "todos"]);
  renderSidebar(side, sbBase({ projects: [offers, ...many.filter((_, i) => i % 3 === 0)], sectorFilter: "automocion" }));
  check("filtro sin coincidencias: mensaje «Ningún proyecto de Automoción»", /Ningún proyecto de Automoción/.test($("#projectList", side).textContent));

  // Línea de tiempo (global)
  const groups = [
    { id: "pi", label: "Industrial", color: "#c00", code: "", sections: [], tasks: [{ id: "ti", title: "Tarea ind", projectId: "pi", startDate: "2026-11-03", dueDate: "2026-11-06", assigneeIds: [], isComplete: false, isMilestone: false, priority: "media", tags: [] }] },
  ];
  const tlCalls = [];
  const tg = renderTl({ groups, sectorFilter: "industria", onSectorFilterChange: (k) => tlCalls.push(k) });
  eq("línea de tiempo global: píldoras de sector con «Industria» activa", [...tg.querySelectorAll(".tl-sector .sector-filter__pill")].map((p) => [p.textContent.trim(), p.classList.contains("is-active")]), [["Todos", false], ["Industria", true], ["Automoción", false]]);
  click(tg.querySelector('.tl-sector [data-sector-filter="automocion"]'));
  eq("… clic en una píldora avisa a app.js", tlCalls, ["automocion"]);
  const tp = renderTl({ tasks: [designDated()], project: { id: "P", name: "P", sections: [] }, sectorFilter: "industria", onSectorFilterChange() {} });
  check("en la línea de tiempo de UN proyecto no hay filtro de sector", !tp.querySelector(".tl-sector"));
  const tEmpty = renderTl({ groups: [{ id: "pi", label: "Industrial", color: "#c00", sections: [], tasks: [] }], sectorFilter: "automocion", onSectorFilterChange() {} });
  check("… y el filtro sigue visible aunque no quede nada que mostrar (para poder quitarlo)", !!tEmpty.querySelector(".tl-sector") && !!tEmpty.querySelector(".empty-state"));

  const appSrc = read("js/app.js");
  check("app.js: la línea de tiempo global usa filterProjectsBySector con el filtro compartido", /filterProjectsBySector\(projects,\s*sectorFilter\)\.map/.test(appSrc) && /let sectorFilter = loadSectorFilter\(\)/.test(appSrc) && /saveSectorFilter\(/.test(appSrc));
  check("el filtro lee el campo `sector` que ya existe (no crea ningún campo nuevo)", /project\.properties\.sector/.test(read("js/project-properties.js")) && !/sectorFilter\s*:\s*\{/.test(read("js/data/projects.js")));
}

// ---------------------------------------------------------------- 6) entrega
{
  const idx = read("index.html");
  const major = parseInt(JSON.parse(read("package.json")).version, 10);
  check("package.json (≥ 85) y los 14 <link> CSS van a la par, ninguno con ?v=84", major >= 85 && (idx.match(new RegExp(`\\?v=${major}\\b`, "g")) || []).length === 14 && !/\?v=84/.test(idx));
  const wn = await import("../js/whats-new.js");
  const r = wn.RELEASES.find((x) => x.id === 85);
  check("Novedades: la v85 consta y habla de sector, icono/color, etapas y barra lateral", !!r && wn.RELEASES[0].id >= 85 && /sector/i.test(JSON.stringify(r)) && /icono/i.test(JSON.stringify(r)) && /etapas/i.test(JSON.stringify(r)) && /barra lateral/i.test(JSON.stringify(r)));
  const readme = read("README.md");
  check("README documenta la v85 (Chusy-85, filtro por sector, proyección de etapas y test nuevo)", /v85/.test(readme) && /Chusy-85/.test(readme) && /chusy_sidebar_sector_filter/.test(readme) && /timelineStages/.test(readme) && /v85-sidebar-and-conversion/.test(readme));
  check("el CSS nuevo vive en los archivos pedidos (07-modals, 08-calendar-timeline, 05-layout)", /\.wf-row__controls/.test(read("css/07-modals.css")) && /\.tl-bar--seg\.is-pending/.test(read("css/08-calendar-timeline.css")) && /\.sector-filter__pill/.test(read("css/05-layout.css")));
}

done("v85 · barra lateral, conversión de ofertas, bloque de etapas y línea de tiempo");
