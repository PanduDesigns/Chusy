// v88 · Cronograma de Pedidos (tabla fija + rejilla de semanas ISO) y chips rápidos de proveedor.
//  1) Chips de proveedor: proveedores únicos con contadores, «Sin proveedor», filtro y estado activo.
//  2) Columnas del cronograma: normalización, persistencia (localStorage), conmutador y campos personalizados.
//  3) Rango de fechas de un pedido (etapas purchase/production o fechas de la tarea) y semanas ISO (S46…).
//  4) Rejilla: días, semanas, meses, ventana (4/8/12 semanas, todo el rango), colocación y orden.
//  5) Interfaz con jsdom: conmutador Tabla/Cronograma, chips sincronizados con el desplegable, cabecera, barras con el Nº
//     de pedido, sombreado de fines de semana y festivos, hoy, «Sin fecha», columnas elegibles, navegación y arrastre.
//  6) Entrega: CSS, ?v=88, package.json, Novedades, README, app.js y node scripts/check-integrity.mjs.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
freezeNow("2026-11-10T10:00:00"); // martes, semana ISO 46

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const mouse = (el, type, x) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 }));
globalThis.__fb = { collections: {}, sets: [], hooks: {} };

const ws = await import("../js/workflow-stages.js");
const orders = await import("../js/orders.js");

const OFF = "OFFERS";
const members = [
  { uid: "compras", name: "Carlos Ruiz", role: "member" },
  { uid: "taller", name: "Tomás Gil", role: "member" },
];
const projects = [
  { id: "P1", name: "Cabina Talgo", code: "26001", color: "#FCD000", icon: "📁", properties: { comercial: "Juan Pérez", sector: "Industria" }, customFieldDefs: [{ id: "f1", name: "TIPO" }, { id: "f2", name: "Plano" }] },
  { id: "P2", name: "Línea Togg", code: "26002", color: "#3b82f6", icon: "🚗", properties: { comercial: "Marta Ruiz", sector: "Automoción" }, customFieldDefs: [{ id: "g1", name: "tipo" }] },
  { id: "P3", name: "Horno Stelia", code: "26003", color: "#10b981", icon: "🔥", properties: { comercial: "Juan Pérez", sector: "Industria" } },
  { id: OFF, name: "Ofertas", exclusive: true, icon: "💼" },
];

function task(id, projectId, title, { stage = "purchase", purchase = {}, production = {}, isComplete = false, extra = {} } = {}) {
  let wf = ws.workflowFromEnabled(["design", "purchase", "production"], {
    purchase: { assigneeId: "compras", dueDate: null, ...purchase },
    production: { assigneeId: "taller", dueDate: null, ...production },
  });
  wf = { ...wf, design: { ...wf.design, completed: true } };
  if (stage === "production" || stage === "done") wf = { ...wf, purchase: { ...wf.purchase, completed: true } };
  if (stage === "done") wf = { ...wf, production: { ...wf.production, completed: true } };
  return { id, projectId, title, workflow: wf, isComplete, assigneeIds: [], priority: "media", tags: [], ...ws.purchaseTraceFields(wf), ...extra };
}

const tasks = [
  task("t1", "P1", "Cilindro hidráulico", { purchase: { supplier: "Hidráulica Sur", orderNumber: "2314", supplierCode: "AB-77", startDate: "2026-11-09", dueDate: "2026-11-13" }, production: { startDate: "2026-11-16", dueDate: "2026-11-20" }, extra: { priority: "alta", customFields: { f1: "Cabina", f2: "PL-9" } } }),
  task("t2", "P1", "Válvula", { purchase: { supplier: "hidraulica  sur", orderNumber: "2315", startDate: "2026-11-10", dueDate: "2026-11-12" } }),
  task("t3", "P2", "Bomba de vacío", { purchase: { supplier: "Aceros Norte", orderNumber: "2713" }, extra: { customFields: { g1: "Horno" } } }), // sin fechas → «Sin fecha»
  task("t4", "P3", "Quemador", { purchase: {}, extra: { startDate: "2026-11-17", dueDate: "2026-11-19" } }), // sin proveedor, fechas de la tarea
  task("t5", "P2", "Motor", { stage: "production", purchase: { supplier: "Aceros Norte", orderNumber: "2400", startDate: "2026-10-01", dueDate: "2026-10-05" }, production: { startDate: "2026-10-06", dueDate: "2026-10-09" } }),
];
const rows = orders.collectOrderRows(tasks, { projects, members, offersProjectId: OFF });
const byId = (id) => rows.find((r) => r.id === id);
const cfg = { holidays: [{ id: "h1", date: "2026-11-11", name: "Festivo de prueba", scope: "empresa" }], absences: [] };

// ---------------------------------------------------------------- 1) chips de proveedor
{
  const pend = rows.filter((r) => r.status === "pending");
  eq("hay 4 pendientes y 1 realizado", [pend.length, rows.length - pend.length], [4, 1]);
  const chips = orders.supplierChips(pend);
  eq("chips: total, sin proveedor y proveedores únicos con contador (variantes de «Hidráulica Sur» juntas)", [chips.all, chips.none, chips.suppliers.map((s) => `${s.name}:${s.count}`)], [4, 1, ["Aceros Norte:1", "Hidráulica Sur:2"]]);
  eq("chips: sobre un conjunto vacío", orders.supplierChips([]), { all: 0, none: 0, suppliers: [] });
  check("chips: estado activo (Todos, nombre sin distinguir tildes/mayúsculas, sin proveedor)", orders.supplierChipActive("", "") && !orders.supplierChipActive("", "Aceros Norte") && orders.supplierChipActive("ACEROS norte", "Aceros Norte") && orders.supplierChipActive(orders.SUPPLIER_NONE, orders.SUPPLIER_NONE) && !orders.supplierChipActive(orders.SUPPLIER_NONE, "Aceros Norte") && !orders.supplierChipActive("Aceros Norte", ""));
  eq("filtro «Sin proveedor»", orders.applyOrderFilters(rows, { supplier: orders.SUPPLIER_NONE }).map((r) => r.id), ["t4"]);
  eq("filtro por proveedor sin distinguir variantes", orders.applyOrderFilters(rows, { supplier: "Hidráulica Sur" }).map((r) => r.id).sort(), ["t1", "t2"]);
  check("hasActiveOrderFilters reconoce «Sin proveedor»", orders.hasActiveOrderFilters({ supplier: orders.SUPPLIER_NONE }));
}

// ---------------------------------------------------------------- 2) columnas
{
  eq("columnas: por defecto Proveedor, Nº Pedido y Etapa/Estado", orders.normalizeTimelineColumns(undefined), ["supplier", "orderNumber", "stageStatus"]);
  eq("columnas: texto corrupto → por defecto", orders.normalizeTimelineColumns("{no json"), ["supplier", "orderNumber", "stageStatus"]);
  eq("columnas: array vacío es válido (todas desmarcadas)", orders.normalizeTimelineColumns([]), []);
  eq("columnas: descarta claves desconocidas y repetidas; estándar en orden canónico, personalizadas al final", orders.normalizeTimelineColumns(["cf:tipo", "dueDateText", "supplier", "basura", "supplier", "cf:", 7, "cf:plano", "cf:tipo"]), ["supplier", "dueDateText", "cf:tipo", "cf:plano"]);
  eq("columnas: acepta el JSON guardado", orders.normalizeTimelineColumns('["priority","assignee"]'), ["priority", "assignee"]);
  eq("columnas estándar: las 9 del pedido", orders.TIMELINE_COLUMN_DEFS.map((c) => c.key), ["supplier", "orderNumber", "supplierCode", "stageStatus", "priority", "assignee", "commercial", "sector", "dueDateText"]);

  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  eq("persistencia: sin nada guardado, las de por defecto", orders.loadTimelineColumns(storage), ["supplier", "orderNumber", "stageStatus"]);
  orders.saveTimelineColumns(["sector", "supplier", "cf:tipo", "zzz"], storage);
  eq("persistencia: se guarda en chusy_orders_timeline_columns, normalizado", JSON.parse(mem.get("chusy_orders_timeline_columns")), ["supplier", "sector", "cf:tipo"]);
  eq("persistencia: se recupera igual", orders.loadTimelineColumns(storage), ["supplier", "sector", "cf:tipo"]);
  mem.set("chusy_orders_timeline_columns", "[[[");
  eq("persistencia: valor corrupto → por defecto", orders.loadTimelineColumns(storage), ["supplier", "orderNumber", "stageStatus"]);
  eq("persistencia: un localStorage que falla no rompe", orders.loadTimelineColumns({ getItem() { throw new Error("x"); } }), ["supplier", "orderNumber", "stageStatus"]);
  check("persistencia: guardar con localStorage roto devuelve igualmente la lista", orders.saveTimelineColumns(["supplier"], { setItem() { throw new Error("x"); } }).join() === "supplier");
  eq("conmutador de columna: marcar y desmarcar", [orders.toggleTimelineColumn(["supplier"], "priority", true), orders.toggleTimelineColumn(["supplier", "priority"], "supplier", false)], [["supplier", "priority"], ["priority"]]);
  eq("conmutador: los personalizados conservan el orden en que se marcan", orders.toggleTimelineColumn(["cf:tipo"], "cf:plano", true), ["cf:tipo", "cf:plano"]);

  const custom = orders.timelineCustomColumns(rows);
  eq("campos personalizados: uno por nombre (TIPO de dos proyectos = una columna), ordenados", custom.map((c) => `${c.key}|${c.label}`), ["cf:plano|Plano", "cf:tipo|TIPO"]);
  eq("columnas resueltas: estándar marcadas + personalizadas que existen (una inexistente no se pinta)", orders.resolveTimelineColumns(["supplier", "cf:tipo", "cf:no-existe", "orderNumber"], custom).map((c) => c.key), ["supplier", "orderNumber", "cf:tipo"]);
  eq("valor personalizado: el campo de ESE proyecto con ese nombre", [orders.customFieldValue(byId("t1"), "cf:tipo"), orders.customFieldValue(byId("t3"), "cf:tipo"), orders.customFieldValue(byId("t1"), "cf:plano"), orders.customFieldValue(byId("t3"), "cf:plano"), orders.customFieldValue(byId("t4"), "cf:tipo")], ["Cabina", "Horno", "PL-9", "", ""]);
  eq("modo de vista: normaliza y persiste", [orders.normalizeViewMode("timeline"), orders.normalizeViewMode("otra"), orders.loadViewMode(storage), orders.saveViewMode("timeline", storage), orders.loadViewMode(storage), mem.get("chusy_orders_view_mode")], ["timeline", "table", "table", "timeline", "timeline", "timeline"]);
}

// ---------------------------------------------------------------- 3) rangos de fechas y semanas ISO
{
  const r1 = orders.orderDateRange(byId("t1"), OFF);
  eq("rango con las dos etapas: de la primera a la última fecha", [r1.source, r1.start, r1.end, r1.segments.map((s) => `${s.key}:${s.startDate}>${s.dueDate}`)], ["stages", "2026-11-09", "2026-11-20", ["purchase:2026-11-09>2026-11-13", "production:2026-11-16>2026-11-20"]]);
  const r2 = orders.orderDateRange(byId("t2"), OFF);
  eq("rango con solo Compra/Pedido con fechas (Recepción sin fechas no cuenta)", [r2.source, r2.segments.length, r2.start, r2.end], ["stages", 1, "2026-11-10", "2026-11-12"]);
  const r4 = orders.orderDateRange(byId("t4"), OFF);
  eq("sin fechas en las etapas → startDate/dueDate de la tarea", [r4.source, r4.start, r4.end, r4.segments.map((s) => s.key)], ["task", "2026-11-17", "2026-11-19", ["task"]]);
  check("sin ninguna fecha → null («Sin fecha»)", orders.orderDateRange(byId("t3"), OFF) === null);
  const one = orders.orderDateRange({ task: task("x", "P1", "x", { purchase: { dueDate: "2026-11-12" } }) }, OFF);
  eq("una sola fecha → un día", [one.start, one.end], ["2026-11-12", "2026-11-12"]);
  const swapped = orders.orderDateRange({ task: task("x", "P1", "x", { purchase: { startDate: "2026-11-20", dueDate: "2026-11-10" } }) }, OFF);
  eq("fechas al revés se ordenan", [swapped.start, swapped.end], ["2026-11-10", "2026-11-20"]);
  const overlap = orders.orderDateRange({ task: task("x", "P1", "x", { purchase: { startDate: "2026-11-09", dueDate: "2026-11-13" }, production: { startDate: "2026-11-12", dueDate: "2026-11-18" } }) }, OFF);
  eq("tramos solapados: el segundo se dibuja desde el día siguiente; las fechas reales no cambian", overlap.segments.map((s) => `${s.key}:${s.drawStart}>${s.drawEnd}:${s.startDate}`), ["purchase:2026-11-09>2026-11-13:2026-11-09", "production:2026-11-14>2026-11-18:2026-11-12"]);
  const inside = orders.orderDateRange({ task: task("x", "P1", "x", { purchase: { startDate: "2026-11-09", dueDate: "2026-11-20" }, production: { startDate: "2026-11-12", dueDate: "2026-11-15" } }) }, OFF);
  check("tramo entero debajo del anterior: no se dibuja", inside.segments[1].drawn === false && inside.segments[0].drawn === true);
  const tip = orders.describeOrderBar(byId("t1"), r1);
  check("tooltip: proyecto, tarea, proveedor, Nº, código y fechas por etapa", /Proyecto: 26001 · Cabina Talgo/.test(tip) && /Tarea: Cilindro hidráulico/.test(tip) && /Proveedor: Hidráulica Sur/.test(tip) && /Nº de pedido: 2314/.test(tip) && /Cód\. Proveedor: AB-77/.test(tip) && /Compra: 09\/11–13\/11/.test(tip) && /Recepción\/Fab\.: 16\/11–20\/11/.test(tip), tip);
  check("tooltip sin fechas", /Fechas: sin fecha/.test(orders.describeOrderBar(byId("t3"), null)));

  eq("semana ISO: 9-nov-2026 es la S46", [orders.isoWeek("2026-11-09"), orders.isoWeekLabel("2026-11-09"), orders.isoWeekLabel("2026-11-15"), orders.isoWeekLabel("2026-11-16")], [{ year: 2026, week: 46 }, "S46", "S46", "S47"]);
  eq("semana ISO: cambios de año (29-dic-2025 = S01 de 2026; 1-ene-2027 = S53 de 2026; 4-ene-2027 = S01)", [orders.isoWeek("2025-12-29"), orders.isoWeek("2027-01-01"), orders.isoWeekLabel("2027-01-04")], [{ year: 2026, week: 1 }, { year: 2026, week: 53 }, "S01"]);
  eq("semana ISO: etiqueta de dos cifras y fecha inválida", [orders.isoWeekLabel("2026-02-02"), orders.isoWeekLabel("nada"), orders.isoWeek(null)], ["S06", "", null]);
}

// ---------------------------------------------------------------- 4) rejilla, ventana, colocación y orden
{
  eq("lunes de la semana y suma de días", [orders.mondayOf("2026-11-10"), orders.mondayOf("2026-11-15"), orders.addDaysKey("2026-11-30", 1), orders.dayDiff("2026-11-02", "2026-11-29")], ["2026-11-09", "2026-11-09", "2026-12-01", 27]);
  const days = orders.buildTimelineDays("2026-11-09", "2026-11-22", cfg);
  eq("días: 14, con inicial (L M X J V S D), fines de semana y festivo del calendario", [days.length, days.slice(0, 7).map((d) => d.letter).join(""), days.filter((d) => d.weekend).map((d) => d.key), days.filter((d) => d.holiday).map((d) => `${d.key}:${d.holiday}`), days.filter((d) => d.nonWorking).length], [14, "LMXJVSD", ["2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22"], ["2026-11-11:Festivo de prueba"], 5]);
  eq("semanas ISO de la rejilla (con la primera cortada)", orders.groupTimelineWeeks(orders.buildTimelineDays("2026-11-12", "2026-11-23", cfg)).map((w) => `${w.label}:${w.start}+${w.span}`), ["S46:0+4", "S47:4+7", "S48:11+1"]);
  eq("meses de la rejilla", orders.groupTimelineMonths(orders.buildTimelineDays("2026-11-28", "2026-12-03", cfg)).map((m) => `${m.label}:${m.span}`), ["Noviembre 2026:3", "Diciembre 2026:3"]);
  check("rejilla vacía si el rango es inválido", orders.buildTimelineDays("2026-11-10", "2026-11-01", cfg).length === 0);

  const w4 = orders.timelineWindow(rows, { zoom: "4w", today: "2026-11-10" });
  eq("ventana de 4 semanas: arranca el lunes de la semana anterior a hoy", [w4.start, w4.end, w4.weeks], ["2026-11-02", "2026-11-29", 4]);
  eq("ventana de 8 y 12 semanas", [orders.timelineWindow(rows, { zoom: "8w", today: "2026-11-10" }).end, orders.timelineWindow(rows, { zoom: "12w", today: "2026-11-10" }).end], ["2026-12-27", "2027-01-24"]);
  eq("Anterior/Siguiente mueven 2 semanas", [orders.timelineWindow(rows, { zoom: "4w", offset: 2, today: "2026-11-10" }).start, orders.timelineWindow(rows, { zoom: "4w", offset: -2, today: "2026-11-10" }).start], ["2026-11-16", "2026-10-19"]);
  const all = orders.timelineWindow(rows, { zoom: "all", today: "2026-11-10", offersProjectId: OFF });
  eq("todo el rango: de una semana antes del primer pedido (1-oct) a una después del último (20-nov), en semanas enteras", [all.start, all.end, all.weeks], ["2026-09-21", "2026-11-29", 10]);
  eq("zoom desconocido → 4 semanas", orders.normalizeTimelineZoom("zzz"), "4w");
  const far = orders.timelineWindow([{ id: "z", task: task("z", "P1", "z", { purchase: { startDate: "2020-01-01", dueDate: "2020-01-02" } }) }], { zoom: "all", today: "2026-11-10", offersProjectId: OFF });
  check("todo el rango con un pedido antiquísimo: tope de semanas y sigue conteniendo hoy", far.weeks <= 78 && far.start <= "2026-11-10" && far.end >= "2026-11-10", far);

  eq("colocación: dentro, cortada por ambos lados, antes y después", [orders.placeInWindow("2026-11-09", "2026-11-13", "2026-11-02", "2026-11-29"), orders.placeInWindow("2026-10-25", "2026-12-05", "2026-11-02", "2026-11-29"), orders.placeInWindow("2026-10-01", "2026-10-09", "2026-11-02", "2026-11-29"), orders.placeInWindow("2026-12-01", "2026-12-02", "2026-11-02", "2026-11-29")],
    [{ offset: 7, span: 5, clipLeft: false, clipRight: false }, { offset: 0, span: 28, clipLeft: true, clipRight: true }, { before: true }, { after: true }]);

  eq("orden por proyecto: código y, dentro, fecha (sin fecha al final)", orders.sortTimelineRows(rows, "project", OFF).map((r) => r.id), ["t1", "t2", "t5", "t3", "t4"]);
  eq("orden por fecha: la más temprana primero, sin fecha al final", orders.sortTimelineRows(rows, "date", OFF).map((r) => r.id), ["t5", "t1", "t2", "t4", "t3"]);
  eq("orden por proveedor: sin proveedor al final; a igual proveedor, por proyecto y fecha (sin fecha después)", orders.sortTimelineRows(rows, "supplier", OFF).map((r) => r.id), ["t5", "t3", "t1", "t2", "t4"]);
  eq("orden desconocido → proyecto; no toca el array original", [orders.sortTimelineRows(rows, "zz", OFF).map((r) => r.id).join(), rows.map((r) => r.id).join()], ["t1,t2,t5,t3,t4", "t1,t2,t3,t4,t5"]);
}

// ---------------------------------------------------------------- 5) interfaz (jsdom)
{
  localStorage.clear();
  const { renderOrdersView } = await import("../js/views/orders-view.js");
  const host = document.createElement("div");
  document.body.appendChild(host);
  let saved = null;
  const opened = [];
  const opts = { rows, onStateChange: (st) => { saved = st; }, onOpenTask: (id) => opened.push(id), currentUser: { uid: "compras", name: "Carlos Ruiz", role: "member" }, teamMembers: members, projects, workCalendar: cfg, offersProjectId: OFF };
  renderOrdersView(host, { ...opts, state: orders.emptyOrdersState() });
  const ids = () => $$(".orders-row", host).map((r) => r.dataset.taskId).sort();

  // conmutador y modo por defecto
  const toggle = $$("[data-view-mode]", host);
  eq("conmutador: 📋 Tabla y 📅 Cronograma, Tabla activa por defecto", [toggle.map((b) => b.textContent.trim()), toggle.map((b) => b.getAttribute("aria-pressed"))], [["📋 Tabla", "📅 Cronograma"], ["true", "false"]]);
  check("modo Tabla: la vista de siempre (filas con campos editables y sin cronograma)", $$(".orders-row", host).length === 4 && $$(".orders-input", host).length === 12 && !$(".orders-timeline", host));

  // chips
  const chipText = () => $$(".orders-chip", host).map((c) => `${$(".orders-chip__name", c).textContent}${$(".orders-chip__count", c).textContent}`);
  eq("chips del bloque «Pendientes»: Todos, proveedores con contador y Sin proveedor", chipText(), ["Todos(4)", "Aceros Norte(1)", "Hidráulica Sur(2)", "Sin proveedor(1)"]);
  check("chip activo = Todos", $(".orders-chip.is-active", host).dataset.supplier === "");
  click($$(".orders-chip", host).find((c) => c.dataset.supplier === "Hidráulica Sur"));
  eq("clic en un chip filtra al instante la Tabla", ids(), ["t1", "t2"]);
  check("… el desplegable «Proveedor» sigue al chip y el estado se comunica", $("#of-supplier", host).value === "Hidráulica Sur" && saved.filters.supplier === "Hidráulica Sur");
  eq("… los chips siguen mostrando los proveedores del resto de filtros (no solo el elegido)", chipText(), ["Todos(4)", "Aceros Norte(1)", "Hidráulica Sur(2)", "Sin proveedor(1)"]);
  check("… y el chip elegido está activo", $(".orders-chip.is-active", host).dataset.supplier === "Hidráulica Sur" && $(".orders-chip.is-active", host).getAttribute("aria-pressed") === "true");
  const sel = $("#of-supplier", host);
  sel.value = "Aceros Norte"; fire(sel, "change");
  check("cambiar el desplegable mueve el chip activo (sincronía bidireccional)", $(".orders-chip.is-active", host).dataset.supplier === "Aceros Norte" && ids().join() === "t3");
  click($$(".orders-chip", host).find((c) => c.dataset.supplier === orders.SUPPLIER_NONE));
  eq("chip «Sin proveedor»", ids(), ["t4"]);
  check("… y el desplegable lo refleja (opción «Sin proveedor»)", sel.value === orders.SUPPLIER_NONE && $$("#of-supplier option", host).some((o) => o.textContent === "Sin proveedor"));
  click($$(".orders-chip", host)[0]);
  eq("chip «Todos» quita el filtro", [ids().length, sel.value, saved.filters.supplier], [4, "", ""]);
  const search = $("#orders-search", host);
  search.value = "2314"; fire(search, "input");
  eq("los contadores de los chips respetan la búsqueda", chipText(), ["Todos(1)", "Hidráulica Sur(1)"]);
  search.value = ""; fire(search, "input");

  // paso a Cronograma
  click(toggle[1]);
  check("clic en Cronograma: se guarda en localStorage y se pinta", localStorage.getItem("chusy_orders_view_mode_compras") === "timeline" && !!$(".orders-timeline", host) && $$(".orders-row", host).length === 0 && toggle[1].classList.contains("is-active") && toggle[0].getAttribute("aria-pressed") === "false");
  const trs = () => $$(".orders-timeline__row", host);
  eq("cronograma: una fila por pedido del bloque, por proyecto", trs().map((r) => r.dataset.taskId), ["t1", "t2", "t3", "t4"]);

  // cabecera de semanas ISO y días
  const weeksHead = $$(".orders-timeline__hcell--week", host).map((w) => w.textContent);
  eq("cabecera: semanas ISO S45–S48 (4 semanas desde el lunes anterior a hoy)", weeksHead, ["S45", "S46", "S47", "S48"]);
  eq("cabecera: 28 días y mes", [$$(".orders-timeline__hcell--day", host).length, $$(".orders-timeline__hcell--month", host).map((m) => m.textContent)], [28, ["Noviembre 2026"]]);
  check("cabecera: número de día e inicial", $(".orders-timeline__hcell--day", host).textContent === "2L" && $$(".orders-timeline__hcell--day", host)[5].textContent === "7S");
  eq("cabecera: el día de hoy (10) resaltado", $$(".orders-timeline__hcell--day.is-today", host).map((d) => d.textContent), ["10M"]);
  eq("cabecera: fines de semana + festivo = no laborables (9 días: 4 sábados/domingos ×2 semanas… y el 11)", $$(".orders-timeline__hcell--day.is-nonworking", host).length, 9);
  eq("rejilla: columnas sombreadas de fin de semana (8), festivo (1) y hoy (1)", [$$(".orders-timeline__col.is-weekend", host).length, $$(".orders-timeline__col.is-holiday", host).length, $$(".orders-timeline__col.is-today", host).length], [8, 1, 1]);
  check("rejilla: el festivo lleva su nombre", $(".orders-timeline__col.is-holiday", host).title === "Festivo de prueba");

  // izquierda
  const row1 = trs()[0];
  const leftHeads = $$(".orders-timeline__hl", host).map((h) => h.textContent);
  eq("columnas por defecto a la izquierda: Proyecto, Descripción, Proveedor, Nº Pedido, Etapa / Estado", leftHeads, ["Proyecto", "Descripción", "Proveedor", "Nº Pedido", "Etapa / Estado"]);
  const proj = $(".orders-timeline__cell--project", row1);
  check("Proyecto: código y nombre, borde y fondo teñidos con el color del proyecto", /26001/.test(proj.textContent) && /Cabina Talgo/.test(proj.textContent) && /border-left:\s*4px solid #FCD000/i.test(proj.getAttribute("style")) && /linear-gradient/.test(proj.getAttribute("style")), proj.getAttribute("style"));
  check("Descripción: título clicable", $(".orders-timeline__title", row1).textContent === "Cilindro hidráulico");
  eq("celdas de proveedor y Nº de pedido", [$(".orders-timeline__cell--supplier", row1).textContent, $(".orders-timeline__cell--orderNumber", row1).textContent, $(".orders-timeline__cell--supplier", trs()[3]).textContent], ["Hidráulica Sur", "2314", "—"]);
  check("Etapa / Estado: insignia de etapa", !!$(".orders-timeline__cell--stageStatus .wf-badge", row1));
  eq("separador entre proyectos al ordenar por proyecto", trs().map((r) => r.classList.contains("is-group-start")), [false, false, true, true]);

  // barras
  const bars = (r) => $$(".orders-timeline__bar", r);
  eq("pedido con dos etapas: dos barras con el Nº de pedido dentro", [bars(row1).length, bars(row1).map((b) => b.textContent), bars(row1).map((b) => b.dataset.seg)], [2, ["2314", "2314"], ["purchase", "production"]]);
  const b0 = bars(row1)[0];
  check("barra de compra: 5 días (09–13/11) desde el día 7 de la ventana, color del proyecto y franja ámbar", /left:\s*240px/.test(b0.getAttribute("style")) && /width:\s*166px/.test(b0.getAttribute("style")) && /background:\s*#FCD000/i.test(b0.getAttribute("style")) && /245,\s*158,\s*11|#f59e0b/i.test(b0.getAttribute("style")), b0.getAttribute("style"));
  check("tooltip completo en la barra", /Proveedor: Hidráulica Sur/.test(b0.title) && /Nº de pedido: 2314/.test(b0.title) && /Compra: 09\/11–13\/11/.test(b0.title));
  eq("pedido solo con Compra/Pedido: una barra; fechas de la tarea: una barra «Quemador» sin Nº → título", [bars(trs()[1]).length, bars(trs()[3]).map((b) => b.textContent)], [1, ["Quemador"]]);
  const nodate = $(".orders-timeline__nodate", trs()[2]);
  check("sin fecha: la fila sigue y muestra «Sin fecha · asignar»", !!nodate && /Sin fecha/.test(nodate.textContent) && bars(trs()[2]).length === 0);
  click(nodate);
  eq("clic en «Sin fecha» abre la tarea", opened.slice(-1), ["t3"]);
  click(b0);
  eq("clic en una barra abre la tarea", opened.slice(-1), ["t1"]);
  click($(".orders-timeline__title", trs()[1]));
  eq("clic en el título abre la tarea", opened.slice(-1), ["t2"]);

  // columnas elegibles
  const colBtn = $("#orders-col-btn", host);
  check("menú «⚙️ Columnas» cerrado al empezar", $("#orders-col-menu", host).hidden === true);
  click(colBtn);
  check("… se abre y ofrece las 9 estándar y los campos personalizados", $("#orders-col-menu", host).hidden === false && $$("[data-col]", host).length === 11 && $$("[data-col]", host).filter((i) => i.checked).map((i) => i.dataset.col).join() === "supplier,orderNumber,stageStatus" && $$(".orders-colmenu__item", host).some((l) => l.textContent.trim() === "TIPO"));
  const tick1 = (key) => { const i = $$("[data-col]", host).find((x) => x.dataset.col === key); i.checked = !i.checked; fire(i, "change"); };
  tick1("commercial"); tick1("dueDateText"); tick1("cf:tipo"); tick1("supplier");
  eq("marcar/desmarcar repinta las columnas y se guarda", [$$(".orders-timeline__hl", host).map((h) => h.textContent), JSON.parse(localStorage.getItem("chusy_orders_timeline_columns_compras"))], [["Proyecto", "Descripción", "Nº Pedido", "Etapa / Estado", "Comercial", "Fecha Fin / Entrega", "TIPO"], ["orderNumber", "stageStatus", "commercial", "dueDateText", "cf:tipo"]]);
  check("… el menú sigue abierto tras marcar", $("#orders-col-menu", host).hidden === false);
  const r1b = trs()[0], r3b = trs()[2];
  eq("celdas nuevas: comercial, fecha fin (corta) y campo personalizado por nombre (TIPO de P1 y «tipo» de P2)", [$(".orders-timeline__cell--commercial", r1b).textContent, $(".orders-timeline__cell--dueDateText", r1b).textContent, $(".orders-timeline__cell--custom", r1b).textContent, $(".orders-timeline__cell--custom", r3b).textContent, $(".orders-timeline__cell--custom", trs()[3]).textContent, $(".orders-timeline__cell--dueDateText", r3b).textContent], ["Juan Pérez", "20 nov", "Cabina", "Horno", "—", "—"]);
  click(document.body);
  check("clic fuera cierra el menú", $("#orders-col-menu", host).hidden === true);
  // un repintado completo (llega un dato) conserva las columnas elegidas
  renderOrdersView(host, { ...opts, state: saved });
  check("tras repintar la vista, las columnas guardadas se mantienen y el modo Cronograma también", $$(".orders-timeline__hl", host).length === 7 && !!$(".orders-timeline", host));

  // filtros en cronograma (chips)
  click($$(".orders-chip", host).find((c) => c.dataset.supplier === "Aceros Norte"));
  eq("chip de proveedor filtra también el Cronograma", trs().map((r) => r.dataset.taskId), ["t3"]);
  click($$(".orders-chip", host)[0]);
  eq("… y «Todos» lo restablece", trs().length, 4);

  // navegación y zoom
  const range = () => $(".orders-timeline__range", host).textContent;
  eq("rango visible", range().startsWith("S45–S48"), true);
  click($("[data-tl-nav=next]", host));
  eq("Siguiente ▶: 2 semanas adelante (S47–S50) y se comunica", [range().startsWith("S47–S50"), saved.timeline.offset], [true, 2]);
  eq("… la cabecera cambia de ventana", $$(".orders-timeline__hcell--week", host).map((w) => w.textContent), ["S47", "S48", "S49", "S50"]);
  eq("… en esa ventana solo cabe la etapa de Recepción/Fab. del primer pedido (la de Compra quedó atrás)", bars(trs()[0]).map((b) => b.dataset.seg), ["production"]);
  click($("[data-tl-nav=prev]", host)); click($("[data-tl-nav=prev]", host));
  eq("◀ Anterior ×2: S43–S46", [range().startsWith("S43–S46"), saved.timeline.offset], [true, -2]);
  check("… y el pedido de octubre entra en la ventana (pedido t5 no, está en otro bloque)", trs().length === 4);
  click($("[data-tl-nav=today]", host));
  eq("Hoy: vuelve a la ventana actual", [range().startsWith("S45–S48"), saved.timeline.offset], [true, 0]);
  click($('[data-tl-zoom="8w"]', host));
  eq("zoom 8 semanas: 56 días, S45–S52", [$$(".orders-timeline__hcell--day", host).length, range().startsWith("S45–S52"), saved.timeline.zoom], [56, true, "8w"]);
  click($('[data-tl-zoom="12w"]', host));
  eq("zoom 12 semanas: 84 días", $$(".orders-timeline__hcell--day", host).length, 84);
  click($('[data-tl-zoom="all"]', host));
  check("«Todo el rango»: ventana ajustada a los pedidos (en semanas enteras)", $$(".orders-timeline__hcell--day", host).length % 7 === 0 && $$(".orders-timeline__hcell--day", host).length >= 28);
  click($('[data-tl-zoom="4w"]', host));
  const sortSel = $("#orders-timeline-sort", host);
  eq("selector «Ordenar»: Proyecto | Fecha | Proveedor", $$("option", sortSel).map((o) => o.textContent), ["Proyecto", "Fecha", "Proveedor"]);
  sortSel.value = "supplier"; fire(sortSel, "change");
  eq("ordenar por Proveedor (sin proveedor al final)", [trs().map((r) => r.dataset.taskId).join(), saved.timeline.sort], ["t3,t1,t2,t4", "supplier"]);
  check("… sin separadores de proyecto fuera del orden por proyecto", !$(".orders-timeline__row.is-group-start", host));
  sortSel.value = "project"; fire(sortSel, "change");

  // pedido fuera de la ventana
  click($$(".orders-tab", host)[1]);
  const farRow = $(".orders-timeline__row", host);
  check("pedido realizado de octubre (fuera de la ventana): insignia «◀ Antes» y no desaparece", !!farRow && !!$(".orders-timeline__offrange.is-before", farRow) && /Antes/.test($(".orders-timeline__offrange", farRow).textContent), farRow && farRow.innerHTML.slice(0, 200));
  click($$(".orders-tab", host)[0]);

  // arrastrar la rejilla
  const scroller = $("#orders-timeline-scroll", host);
  const cal = $(".orders-timeline__cal", host);
  const opensBefore = opened.length;
  const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 300, button: 0 });
  cal.dispatchEvent(down);
  check("arrastre: el mousedown llama a preventDefault (no compite con la selección de texto) y marca el modo", down.defaultPrevented === true && scroller.classList.contains("is-dragging"));
  mouse(document, "mousemove", 250);
  mouse(document, "mouseup", 250);
  check("arrastre: al soltar se quita el modo", !scroller.classList.contains("is-dragging"));
  click(bars(trs()[0])[0]);
  eq("un arrastre real no abre la tarea al soltar", opened.length, opensBefore);
  await tick(5);
  click(bars(trs()[0])[0]);
  eq("… pero el clic siguiente sí", opened.length, opensBefore + 1);
  cal.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 300, button: 0 }));
  mouse(document, "mouseup", 301);
  click(bars(trs()[0])[0]);
  eq("un clic sin mover (<4 px) abre la tarea", opened.length, opensBefore + 2);

  // vuelta a la Tabla
  click(toggle[0]);
  check("de vuelta a Tabla: se guarda y se pintan las filas de siempre", localStorage.getItem("chusy_orders_view_mode_compras") === "table" && $$(".orders-row", host).length === 4 && !$(".orders-timeline", host));
  // bloque vacío en cronograma
  click(toggle[1]);
  renderOrdersView(host, { ...opts, rows: [], state: orders.emptyOrdersState() });
  check("sin pedidos: mensaje de siempre, sin cronograma ni chips", /Compra\/Pedido/.test($(".orders-empty", host).textContent) && !$(".orders-timeline", host) && $("#orders-chips", host).hidden === true);
  host.remove();
}

// ---------------------------------------------------------------- 6) entrega
{
  const idx = read("index.html");
  eq("index.html: los 14 <link> con el mismo ?v=N (≥ 88; la entrega actual lo fija en v89-orders-timeline-interactive.test.mjs)", new Set([...idx.matchAll(/css\/[\w-]+\.css\?v=(\d+)/g)].map((m) => m[1])).size + ":" + (idx.match(/css\/[\w-]+\.css\?v=\d+/g) || []).length, "1:14");
  check("index.html: ningún <link> se ha quedado en una versión anterior a la 88", [...idx.matchAll(/\.css\?v=(\d+)/g)].every((m) => Number(m[1]) >= 88));
  check("package.json y package-lock.json: versión ≥ 88", parseInt(JSON.parse(read("package.json")).version, 10) >= 88 && parseInt(JSON.parse(read("package-lock.json")).version, 10) >= 88);
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES.find((x) => x.id === 88);
  check("Novedades: entrada 88, mayor que la 87, sobre Cronograma, proveedor y columnas", !!r && r.id > RELEASES.find((x) => x.id === 87).id && /Cronograma/.test(r.title) && /proveedor/i.test(JSON.stringify(r)) && /Columnas/.test(JSON.stringify(r)) && r.items.length >= 3, r && r.id);
  const css = [read("css/06-list-board.css"), read("css/08-calendar-timeline.css")].join("\n");
  check("CSS: chips, conmutador, menú de columnas y cronograma (.orders-timeline__*)", [".orders-chip", ".orders-viewtoggle", ".orders-colmenu", ".orders-timeline__scroll", ".orders-timeline__head", ".orders-timeline__left", ".orders-timeline__bar", ".orders-timeline__col.is-weekend", ".orders-timeline__col.is-holiday", ".orders-timeline__col.is-today", ".orders-timeline__hcell--week"].every((c) => css.includes(c)));
  check("CSS: bloque izquierdo y cabecera sticky; el sombreado usa variables del tema", /\.orders-timeline__left\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0/.test(css) && /\.orders-timeline__head\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/.test(css) && /\.orders-timeline__col\.is-weekend\s*\{\s*background:\s*var\(--color-dim\)/.test(css));
  check("CSS: modo de columnas anchas (.is-wide): Proyecto y Descripción siguen fijas, el resto se desplaza", /\.orders-timeline__scroll\.is-wide \.orders-timeline__cell--title[^{]*\{[^}]*position:\s*sticky/.test(css) && /display:\s*contents/.test(css) && /is-wide/.test(read("js/views/orders-timeline.js")));
  const view = read("js/views/orders-view.js");
  check("orders-view.js: integra conmutador, chips y el módulo del cronograma", /renderOrdersTimeline/.test(view) && /data-view-mode/.test(view) && /id="orders-chips"/.test(view) && /supplierChips/.test(view) && /saveOrdersViewMode/.test(view));
  const app = read("js/app.js");
  check("app.js: pasa el calendario laboral y la oferta a la vista de Pedidos", /workCalendar: getWorkCalendar\(\), offersProjectId/.test(app));
  const readme = read("README.md");
  check("README: apartado 3.21, historial v87 → v88 y los archivos nuevos", /### 3\.21 Cronograma de Pedidos/.test(readme) && /v87 → v88 \(Chusy-88\.zip\)/.test(readme) && /orders-timeline\.js/.test(readme) && /chusy_orders_view_mode/.test(readme) && /chusy_orders_timeline_columns/.test(readme));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v88 · Cronograma de Pedidos y chips rápidos de proveedor");
