// v89 · Cronograma de Pedidos interactivo: columnas redimensionables, preferencias por usuario y navegador, y barras que se mueven y se estiran.
//  1) Anchos de columna: límites 60–520 px, normalización y persistencia aislada por usuario (con reserva en la clave general de la v88).
//  2) Columnas visibles, modo de vista, escala y orden por usuario, 100 % compatibles con las llamadas de la v88 (sin uid).
//  3) Mover y estirar una barra: rango nuevo (computeOrderBarDrag) y parche (buildOrderTimelineDatePatch) con fechas de la tarea y con etapas.
//  4) Interfaz con jsdom y eventos de ratón REALES: tiradores de cabecera (en vivo, límites, guardado, doble clic, «Restablecer anchos»),
//     tiradores de barra (mover, estirar, aviso flotante, umbral de clic, «Deshacer», error), asignar fecha en «Sin fecha» y scroll conservado.
//  5) Entrega: ?v=89, package.json, Novedades, CSS, README y node scripts/check-integrity.mjs.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
freezeNow("2026-11-10T10:00:00"); // martes, semana ISO 46

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const dbl = (el) => el.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
const mouse = (el, type, x) => { const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 }); el.dispatchEvent(e); return e; };
globalThis.__fb = { collections: {}, sets: [], hooks: {} };

// scrollLeft/scrollTop que SÍ se guardan (jsdom no los implementa): así se prueba el scroll conservado
const scrollVals = new WeakMap();
for (const prop of ["scrollLeft", "scrollTop"]) {
  Object.defineProperty(window.Element.prototype, prop, {
    configurable: true,
    get() { return (scrollVals.get(this) || {})[prop] || 0; },
    set(v) { scrollVals.set(this, { ...(scrollVals.get(this) || {}), [prop]: Number(v) || 0 }); },
  });
}

const ws = await import("../js/workflow-stages.js");
const orders = await import("../js/orders.js");

const OFF = "OFFERS";
const members = [{ uid: "compras", name: "Carlos Ruiz", role: "member" }, { uid: "taller", name: "Tomás Gil", role: "member" }];
const projects = [
  { id: "P1", name: "Cabina Talgo", code: "26001", color: "#FCD000", icon: "📁", properties: { comercial: "Juan Pérez", sector: "Industria" }, customFieldDefs: [{ id: "f1", name: "TIPO" }] },
  { id: "P2", name: "Línea Togg", code: "26002", color: "#3b82f6", icon: "🚗", properties: { comercial: "Marta Ruiz", sector: "Automoción" } },
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
const t1 = task("t1", "P1", "Cilindro hidráulico", { purchase: { supplier: "Hidráulica Sur", orderNumber: "2314", startDate: "2026-11-09", dueDate: "2026-11-13" }, production: { startDate: "2026-11-16", dueDate: "2026-11-20" } });
const t2 = task("t2", "P1", "Válvula", { purchase: { supplier: "Hidráulica Sur", orderNumber: "2315", startDate: "2026-11-10", dueDate: "2026-11-12" } });
const t3 = task("t3", "P2", "Bomba de vacío", { purchase: { supplier: "Aceros Norte", orderNumber: "2713" } }); // sin fechas
const t4 = task("t4", "P3", "Quemador", { purchase: {}, extra: { startDate: "2026-11-17", dueDate: "2026-11-19" } }); // fechas de la tarea
const t5 = task("t5", "P2", "Motor", { stage: "production", purchase: { startDate: "2026-10-01", dueDate: "2026-10-05" }, production: { startDate: "2026-10-06", dueDate: "2026-10-09" } });
const t6 = task("t6", "P1", "Solo fecha", { purchase: {}, extra: { dueDate: "2026-11-12" } }); // solo dueDate
const t7 = task("t7", "P1", "Compra de un día", { purchase: { dueDate: "2026-11-12" } }); // etapa con una sola fecha
const mkRows = (tasks) => orders.collectOrderRows(tasks, { projects, members, offersProjectId: OFF });
const cfg = { holidays: [{ id: "h1", date: "2026-11-11", name: "Festivo de prueba", scope: "empresa" }], absences: [] };
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- 1) anchos de columna
{
  eq("límites: 60–520 px", [orders.TIMELINE_COL_MIN_W, orders.TIMELINE_COL_MAX_W], [60, 520]);
  eq("recorte: por debajo, por encima, dentro, texto numérico y redondeo", [10, 9999, 200, "250", 99.6, -5].map(orders.clampTimelineColumnWidth), [60, 520, 200, 250, 100, 60]);
  eq("recorte: lo que no es número → null", ["abc", NaN, null, undefined, "", true, {}].map(orders.clampTimelineColumnWidth), [null, null, null, null, null, null, null]);
  eq("anchos por defecto: fijas, estándar y personalizadas; clave desconocida → null", ["project", "title", "supplier", "orderNumber", "cf:tipo", "zzz"].map(orders.defaultTimelineColumnWidth), [190, 240, 130, 90, 100, null]);

  const norm = orders.normalizeOrdersTimelineColumnWidths;
  eq("normalizar: claves conocidas recortadas; desconocidas, repetidas raras y valores no numéricos fuera", norm({ project: 10, title: 9999, supplier: "150", basura: 100, orderNumber: "x", "cf:tipo": 130, "cf:": 100, priority: null }), { project: 60, title: 520, supplier: 150, "cf:tipo": 130 });
  eq("normalizar: acepta el JSON guardado", norm('{"project":210,"sector":99}'), { project: 210, sector: 99 });
  eq("normalizar: texto corrupto, array, null o número → {}", [norm("{no json"), norm([1, 2]), norm(null), norm(7), norm(undefined)], [{}, {}, {}, {}, {}]);
  const many = {}; for (let i = 0; i < 40; i++) many[`cf:campo${i}`] = 100;
  check("normalizar: tope de campos personalizados", Object.keys(norm(many)).length === orders.TIMELINE_MAX_CUSTOM_COLUMNS);

  // persistencia aislada por usuario, con reserva en la clave general del navegador
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  eq("sin nada guardado: todos por defecto ({})", [orders.loadOrdersTimelineColumnWidths("ana", storage), orders.loadOrdersTimelineColumnWidths(null, storage)], [{}, {}]);
  orders.saveOrdersTimelineColumnWidths({ project: 250, supplier: 5 }, "ana", storage);
  orders.saveOrdersTimelineColumnWidths({ title: 300 }, "luis", storage);
  eq("cada usuario guarda en SU clave", [mem.has("chusy_orders_timeline_col_widths_ana"), mem.has("chusy_orders_timeline_col_widths_luis"), mem.has("chusy_orders_timeline_col_widths")], [true, true, false]);
  eq("… y recupera lo suyo (normalizado: 5 → 60)", [orders.loadOrdersTimelineColumnWidths("ana", storage), orders.loadOrdersTimelineColumnWidths("luis", storage)], [{ project: 250, supplier: 60 }, { title: 300 }]);
  eq("un tercero sin nada propio ni general: por defecto", orders.loadOrdersTimelineColumnWidths("eva", storage), {});
  mem.set("chusy_orders_timeline_col_widths", '{"orderNumber":111}'); // lo que hubiera en la clave general (navegador)
  eq("reserva: sin clave propia se lee la general del navegador; la propia manda", [orders.loadOrdersTimelineColumnWidths("eva", storage), orders.loadOrdersTimelineColumnWidths(null, storage), orders.loadOrdersTimelineColumnWidths("ana", storage)], [{ orderNumber: 111 }, { orderNumber: 111 }, { project: 250, supplier: 60 }]);
  orders.saveOrdersTimelineColumnWidths({ title: 280 }, null, storage);
  eq("sin usuario se guarda en la clave general", JSON.parse(mem.get("chusy_orders_timeline_col_widths")), { title: 280 });
  eq("guardar devuelve el mapa normalizado", orders.saveOrdersTimelineColumnWidths({ project: 9999, x: 1 }, "ana", storage), { project: 520 });
  mem.set("chusy_orders_timeline_col_widths_ana", "[[[");
  eq("valor corrupto → por defecto", orders.loadOrdersTimelineColumnWidths("ana", storage), {});
  eq("un localStorage que falla no rompe (cargar → {}; guardar devuelve igualmente)", [orders.loadOrdersTimelineColumnWidths("ana", { getItem() { throw new Error("x"); } }), orders.saveOrdersTimelineColumnWidths({ title: 300 }, "ana", { setItem() { throw new Error("x"); } })], [{}, { title: 300 }]);

  // utilidades puras
  eq("setTimelineColumnWidth: guarda recortado; igual al de por defecto = se quita; no toca el original", (() => { const w = { supplier: 150 }; const a = orders.setTimelineColumnWidth(w, "project", 260); const b = orders.setTimelineColumnWidth(a, "supplier", 130); const c = orders.setTimelineColumnWidth(b, "title", 5); return [a, b, c, w]; })(), [{ supplier: 150, project: 260 }, { project: 260 }, { project: 260, title: 60 }, { supplier: 150 }]);
  eq("resetTimelineColumnWidths: una columna, o todas", [orders.resetTimelineColumnWidths({ project: 260, title: 300 }, "project"), orders.resetTimelineColumnWidths({ project: 260 })], [{ title: 300 }, {}]);
  eq("applyTimelineColumnWidths: pone el ancho propio y deja el resto", orders.applyTimelineColumnWidths([{ key: "project", width: 190 }, { key: "supplier", width: 130 }], { project: 300 }).map((c) => c.width), [300, 130]);
}

// ---------------------------------------------------------------- 2) columnas, modo, escala y orden por usuario
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  eq("userScopedKey: con uid y sin él", [orders.userScopedKey("chusy_x", "ana"), orders.userScopedKey("chusy_x", " ana "), orders.userScopedKey("chusy_x", ""), orders.userScopedKey("chusy_x", null), orders.userScopedKey("chusy_x")], ["chusy_x_ana", "chusy_x_ana", "chusy_x", "chusy_x", "chusy_x"]);
  eq("columnas: sin nada, las de por defecto", orders.loadOrdersTimelineColumns("ana", storage), ["supplier", "orderNumber", "stageStatus"]);
  orders.saveOrdersTimelineColumns(["sector", "supplier", "cf:tipo", "zzz"], "ana", storage);
  eq("columnas: se guardan en la clave del usuario, normalizadas", [JSON.parse(mem.get("chusy_orders_timeline_columns_ana")), mem.has("chusy_orders_timeline_columns")], [["supplier", "sector", "cf:tipo"], false]);
  eq("columnas: otro usuario no ve las de ana", orders.loadOrdersTimelineColumns("luis", storage), ["supplier", "orderNumber", "stageStatus"]);
  mem.set("chusy_orders_timeline_columns", '["priority"]'); // lo guardado por la v88 (clave general)
  eq("columnas: reserva en la general (lo de la v88 no se pierde); la propia manda", [orders.loadOrdersTimelineColumns("luis", storage), orders.loadOrdersTimelineColumns("ana", storage)], [["priority"], ["supplier", "sector", "cf:tipo"]]);
  // compatibilidad con las llamadas de la v88 (sin uid)
  eq("v88: loadTimelineColumns/saveTimelineColumns(storage) siguen igual", [orders.loadTimelineColumns(storage), orders.saveTimelineColumns(["sector"], storage), JSON.parse(mem.get("chusy_orders_timeline_columns"))], [["priority"], ["sector"], ["sector"]]);
  eq("v88: loadOrdersTimelineColumns sin uid = clave general", orders.loadOrdersTimelineColumns(undefined, storage), ["sector"]);
  eq("columnas: localStorage roto → por defecto, y guardar devuelve igualmente", [orders.loadOrdersTimelineColumns("ana", { getItem() { throw new Error("x"); } }), orders.saveOrdersTimelineColumns(["supplier"], "ana", { setItem() { throw new Error("x"); } })], [["supplier", "orderNumber", "stageStatus"], ["supplier"]]);

  eq("modo de vista: por usuario y con reserva", (() => {
    const out = [orders.loadOrdersViewMode("ana", storage)];
    out.push(orders.saveOrdersViewMode("timeline", "ana", storage), orders.loadOrdersViewMode("ana", storage), orders.loadOrdersViewMode("luis", storage));
    mem.set("chusy_orders_view_mode", "timeline");
    out.push(orders.loadOrdersViewMode("luis", storage), mem.get("chusy_orders_view_mode_ana"));
    return out;
  })(), ["table", "timeline", "timeline", "table", "timeline", "timeline"]);
  eq("modo de vista: sin uid = clave general; valor raro → table", [orders.saveOrdersViewMode("otra", null, storage), mem.get("chusy_orders_view_mode")], ["table", "table"]);

  eq("escala y orden: por defecto, guardado por usuario (normalizado) y reserva", (() => {
    const out = [orders.loadOrdersTimelinePrefs("ana", storage)];
    out.push(orders.saveOrdersTimelinePrefs({ zoom: "8w", sort: "supplier" }, "ana", storage), orders.loadOrdersTimelinePrefs("ana", storage), orders.loadOrdersTimelinePrefs("luis", storage));
    out.push(orders.saveOrdersTimelinePrefs({ zoom: "zzz", sort: "yyy" }, "luis", storage));
    mem.set("chusy_orders_timeline_scale", "all"); mem.set("chusy_orders_timeline_sort", "date");
    out.push(orders.loadOrdersTimelinePrefs("eva", storage), [mem.get("chusy_orders_timeline_scale_ana"), mem.get("chusy_orders_timeline_sort_ana")]);
    return out;
  })(), [{ zoom: "4w", sort: "project" }, { zoom: "8w", sort: "supplier" }, { zoom: "8w", sort: "supplier" }, { zoom: "4w", sort: "project" }, { zoom: "4w", sort: "project" }, { zoom: "all", sort: "date" }, ["8w", "supplier"]]);
}

// ---------------------------------------------------------------- 3) mover y estirar: rango nuevo y parche
{
  const rangeOf = (t) => orders.orderDateRange({ task: t }, OFF);
  const r1 = rangeOf(t1), r4 = rangeOf(t4);
  const pair = (r) => r && [r.start, r.end];
  eq("gestos válidos", orders.ORDER_BAR_DRAG_MODES, ["move", "resize-left", "resize-right"]);
  eq("mover (etapas 09–20/11): conserva la duración", pair(orders.computeOrderBarDrag(r1, "move", 2)), ["2026-11-11", "2026-11-22"]);
  eq("mover hacia atrás", pair(orders.computeOrderBarDrag(r1, "move", -9)), ["2026-10-31", "2026-11-11"]);
  eq("estirar izquierda: solo el inicio", pair(orders.computeOrderBarDrag(r1, "resize-left", -2)), ["2026-11-07", "2026-11-20"]);
  eq("estirar izquierda hacia dentro: sin pasar del fin de la PRIMERA etapa (13/11)", [pair(orders.computeOrderBarDrag(r1, "resize-left", 3)), pair(orders.computeOrderBarDrag(r1, "resize-left", 30))], [["2026-11-12", "2026-11-20"], ["2026-11-13", "2026-11-20"]]);
  eq("estirar derecha: solo el fin", pair(orders.computeOrderBarDrag(r1, "resize-right", 4)), ["2026-11-09", "2026-11-24"]);
  eq("estirar derecha hacia dentro: sin quedar antes del inicio de la ÚLTIMA etapa (16/11)", [pair(orders.computeOrderBarDrag(r1, "resize-right", -2)), pair(orders.computeOrderBarDrag(r1, "resize-right", -30))], [["2026-11-09", "2026-11-18"], ["2026-11-09", "2026-11-16"]]);
  eq("fechas de la tarea (17–19/11): topes en el propio rango", [pair(orders.computeOrderBarDrag(r4, "resize-left", 9)), pair(orders.computeOrderBarDrag(r4, "resize-right", -9))], [["2026-11-19", "2026-11-19"], ["2026-11-17", "2026-11-17"]]);
  eq("sin cambio o gesto/rango inválido → null", [orders.computeOrderBarDrag(r1, "move", 0), orders.computeOrderBarDrag(r1, "move", NaN), orders.computeOrderBarDrag(r1, "zzz", 3), orders.computeOrderBarDrag(null, "move", 3), orders.computeOrderBarDrag(r4, "resize-left", 0), orders.computeOrderBarDrag(r4, "resize-right", -0)], [null, null, null, null, null, null]);
  eq("texto del aviso: «09/11 → 13/11 · 5d»", [orders.formatOrderDragRange("2026-11-09", "2026-11-13"), orders.formatOrderDragRange("2026-11-12", "2026-11-12"), orders.orderRangeDays("2026-11-09", "2026-11-13")], ["09/11 → 13/11 · 5d", "12/11 → 12/11 · 1d", 5]);
  eq("último tramo del rango: el que acaba el pedido", orders.orderLastSegment(r1).key, "production");

  const patch = orders.buildOrderTimelineDatePatch;
  // tarea con startDate/dueDate (sin fechas en etapas): se escriben las de la tarea y se sincroniza la etapa activa
  const before4 = clone(t4);
  const p4 = patch(t4, "2026-11-18", "2026-11-20", OFF);
  eq("tarea con fechas estándar: startDate/dueDate nuevos", [p4.startDate, p4.dueDate], ["2026-11-18", "2026-11-20"]);
  eq("… y la etapa activa (Compra/Pedido) sigue a la tarea", [p4.workflow.purchase.startDate, p4.workflow.purchase.dueDate, p4.workflow.production.startDate], ["2026-11-18", "2026-11-20", null]);
  eq("… sin tocar la tarea original", t4, before4);
  const p6 = patch(t6, "2026-11-13", "2026-11-15", OFF);
  eq("tarea con SOLO dueDate: startDate y dueDate nuevos", [p6.startDate, p6.dueDate], ["2026-11-13", "2026-11-15"]);
  eq("fechas al revés se ordenan", [patch(t4, "2026-11-20", "2026-11-18", OFF).startDate, patch(t4, "2026-11-20", "2026-11-18", OFF).dueDate], ["2026-11-18", "2026-11-20"]);
  eq("sin cambio → null; fechas inválidas → null", [patch(t4, "2026-11-17", "2026-11-19", OFF), patch(t4, "no", "2026-11-19", OFF), patch(null, "2026-11-17", "2026-11-19", OFF)], [null, null, null]);
  const t8 = task("t8", "P1", "Personal sin flujo", { extra: { startDate: "2026-11-10", dueDate: "2026-11-12", workflow: undefined } });
  eq("tarea sin flujo (solo fechas): startDate y dueDate, nada más", Object.keys(patch({ ...t8, workflow: null }, "2026-11-11", "2026-11-13", OFF)).sort(), ["dueDate", "startDate"]);

  // tarea con etapas (Compra 09–13 y Recepción 16–20)
  const before1 = clone(t1);
  const m1 = patch(t1, "2026-11-11", "2026-11-22", OFF);
  eq("etapas, mover +2: desplaza Compra y Recepción a la vez", [m1.workflow.purchase.startDate, m1.workflow.purchase.dueDate, m1.workflow.production.startDate, m1.workflow.production.dueDate], ["2026-11-11", "2026-11-15", "2026-11-18", "2026-11-22"]);
  eq("… y los campos de la tarea siguen a la etapa activa (Compra)", [m1.startDate, m1.dueDate], ["2026-11-11", "2026-11-15"]);
  const l1 = patch(t1, "2026-11-07", "2026-11-20", OFF);
  eq("etapas, estirar izquierda: solo el inicio de la PRIMERA etapa", [l1.workflow.purchase.startDate, l1.workflow.purchase.dueDate, l1.workflow.production.startDate, l1.workflow.production.dueDate], ["2026-11-07", "2026-11-13", "2026-11-16", "2026-11-20"]);
  const r1p = patch(t1, "2026-11-09", "2026-11-24", OFF);
  eq("etapas, estirar derecha: solo el fin de la ÚLTIMA etapa (Recepción)", [r1p.workflow.purchase.startDate, r1p.workflow.purchase.dueDate, r1p.workflow.production.startDate, r1p.workflow.production.dueDate], ["2026-11-09", "2026-11-13", "2026-11-16", "2026-11-24"]);
  eq("… la tarea sigue a la etapa ACTIVA (Compra), no a la que se estiró", [r1p.startDate, r1p.dueDate], ["2026-11-09", "2026-11-13"]);
  const lr = patch(t1, "2026-11-08", "2026-11-25", OFF);
  eq("etapas, inicio y fin distintos a la vez: primera y última", [lr.workflow.purchase.startDate, lr.workflow.production.dueDate], ["2026-11-08", "2026-11-25"]);
  const c1 = patch(t1, "2026-11-20", "2026-11-20", OFF);
  eq("etapas: el inicio no pasa del fin de su propia etapa (13/11)", [c1.workflow.purchase.startDate, c1.workflow.purchase.dueDate, c1.workflow.production.dueDate], ["2026-11-13", "2026-11-13", "2026-11-20"]);
  eq("… las etapas completadas/trazabilidad no se tocan", [m1.workflow.purchase.supplier, m1.workflow.purchase.orderNumber, m1.workflow.design.completed, m1.workflow.purchase.assigneeId], ["Hidráulica Sur", "2314", true, "compras"]);
  eq("… la tarea original no se muta", t1, before1);
  const p5 = patch(t5, "2026-10-02", "2026-10-10", OFF); // pedido realizado: la etapa activa es Recepción/Fab.
  eq("pedido realizado (activa Recepción/Fab.): mover +1 desplaza ambas y la tarea sigue a Recepción", [p5.workflow.purchase.startDate, p5.workflow.production.startDate, p5.startDate, p5.dueDate], ["2026-10-02", "2026-10-07", "2026-10-07", "2026-10-10"]);
  const p7 = patch(t7, "2026-11-12", "2026-11-15", OFF);
  eq("etapa con una sola fecha: al estirar se escriben las DOS", [p7.workflow.purchase.startDate, p7.workflow.purchase.dueDate], ["2026-11-12", "2026-11-15"]);
  eq("sin cambio en etapas → null", patch(t1, "2026-11-09", "2026-11-20", OFF), null);

  // «Deshacer»: el parche inverso devuelve lo que había
  const u1 = orders.buildOrderDatesUndoPatch(t1, m1);
  eq("parche inverso (etapas): el flujo original y las fechas que había (null si no tenía)", [u1.workflow.purchase.startDate, u1.workflow.production.dueDate, u1.startDate, u1.dueDate], ["2026-11-09", "2026-11-20", null, null]);
  const u4 = orders.buildOrderDatesUndoPatch(t4, p4);
  eq("parche inverso (tarea): fechas anteriores y flujo anterior", [u4.startDate, u4.dueDate, u4.workflow.purchase.startDate], ["2026-11-17", "2026-11-19", null]);
  check("parche inverso: copia independiente (no comparte objetos con la tarea)", u1.workflow !== t1.workflow && u1.workflow.purchase !== t1.workflow.purchase);
  // «Sin fecha»: asignar un día
  const p3 = patch(t3, "2026-11-10", "2026-11-12", OFF);
  eq("«Sin fecha»: asignar un rango escribe tarea y etapa activa", [p3.startDate, p3.dueDate, p3.workflow.purchase.startDate, p3.workflow.purchase.dueDate], ["2026-11-10", "2026-11-12", "2026-11-10", "2026-11-12"]);
  // coherencia: lo que escribe el parche es lo que luego dibuja el cronograma
  eq("coherencia: tras aplicar el parche, orderDateRange da exactamente el rango pedido", (() => {
    const out = [];
    for (const [t, a, b] of [[t1, "2026-11-11", "2026-11-22"], [t1, "2026-11-07", "2026-11-20"], [t1, "2026-11-09", "2026-11-24"], [t4, "2026-11-18", "2026-11-20"], [t3, "2026-11-10", "2026-11-12"], [t7, "2026-11-12", "2026-11-15"], [t6, "2026-11-13", "2026-11-15"]]) {
      const np = patch(t, a, b, OFF);
      const rg = rangeOf({ ...t, ...np });
      out.push(rg.start === a && rg.end === b);
    }
    return out;
  })(), [true, true, true, true, true, true, true]);
}

// ---------------------------------------------------------------- 4) interfaz (jsdom)
const { renderOrdersView } = await import("../js/views/orders-view.js");
const { dismissUndoToast } = await import("../js/components/undo-toast.js");
{
  localStorage.clear();
  const rows = mkRows([t1, t2, t3, t4, t5, t6, t7]);
  const host = document.createElement("div");
  document.body.appendChild(host);
  let saved = null;
  const opened = [];
  const calls = [];
  let failNext = false;
  const onDatesChange = async (id, patch, row) => { calls.push({ id, patch, row }); if (failNext) { failNext = false; throw new Error("permission-denied"); } };
  const mk = (uid) => ({ rows, onStateChange: (st) => { saved = st; }, onOpenTask: (id) => opened.push(id), currentUser: { uid, name: uid, role: "member" }, teamMembers: members, projects, workCalendar: cfg, offersProjectId: OFF, onDatesChange });
  const opts = mk("compras");
  localStorage.setItem("chusy_orders_view_mode_compras", "timeline");
  renderOrdersView(host, { ...opts, state: orders.emptyOrdersState() });
  const trs = () => $$(".orders-timeline__row", host);
  const row = (id) => trs().find((r) => r.dataset.taskId === id);
  const root = () => $(".orders-timeline", host);
  const cssVar = (n) => root().style.getPropertyValue(n);
  check("modo Cronograma recordado por usuario (clave _compras)", !!root() && $$(".orders-row", host).length === 0);
  eq("filas del bloque Pendientes (t1, t2, t3, t4, t6, t7)", trs().map((r) => r.dataset.taskId).sort(), ["t1", "t2", "t3", "t4", "t6", "t7"]);

  // ---- tiradores de columna
  const heads = $$(".orders-timeline__hl", host);
  const resizers = $$(".orders-tl-col-resizer", host);
  check("cada cabecera de la izquierda lleva su tirador .orders-tl-col-resizer (Proyecto, Descripción y las 3 opcionales)", heads.length === 5 && resizers.length === 5 && heads.every((h, i) => h.contains(resizers[i])));
  eq("el texto de la cabecera no cambia (el tirador no lleva texto)", heads.map((h) => h.textContent), ["Proyecto", "Descripción", "Proveedor", "Nº Pedido", "Etapa / Estado"]);
  check("el tirador es accesible (separator vertical) y explica el gesto", resizers.every((r) => r.getAttribute("role") === "separator" && r.getAttribute("aria-orientation") === "vertical" && /doble clic/i.test(r.title)));
  eq("anchos por defecto en variables CSS (190, 240, 130, 90, 130)", [0, 1, 2, 3, 4].map((i) => cssVar(`--tl-w-${i}`)), ["190px", "240px", "130px", "90px", "130px"]);
  eq("las celdas de cada fila usan esas variables (una por columna)", $$(".orders-timeline__cell", row("t1")).map((c) => c.style.width), [0, 1, 2, 3, 4].map((i) => `var(--tl-w-${i})`));
  eq("ancho total del bloque izquierdo", cssVar("--tl-left-w"), "780px");

  // arrastrar el tirador de Proyecto: en vivo, sin repintar
  const gridBefore = $(".orders-timeline__grid", host);
  const down = mouse(resizers[0], "mousedown", 100);
  check("mousedown en el tirador: preventDefault (sin selección de texto) y marca el modo", down.defaultPrevented === true && resizers[0].classList.contains("is-active") && document.body.classList.contains("is-col-resizing"));
  check("… y NO arranca el arrastre-de-scroll de la rejilla", !$("#orders-timeline-scroll", host).classList.contains("is-dragging"));
  mouse(document.body, "mousemove", 160);
  eq("en vivo: +60 px → Proyecto 250 px y el bloque izquierdo 840 px", [cssVar("--tl-w-0"), cssVar("--tl-left-w"), cssVar("--tl-fixed-w")], ["250px", "840px", "250px"]);
  check("… sin repintar la rejilla (mismo nodo)", $(".orders-timeline__grid", host) === gridBefore);
  mouse(document.body, "mousemove", -900);
  eq("límite mínimo: 60 px", cssVar("--tl-w-0"), "60px");
  mouse(document.body, "mousemove", 5000);
  eq("límite máximo: 520 px", cssVar("--tl-w-0"), "520px");
  mouse(document.body, "mousemove", 140);
  mouse(document.body, "mouseup", 140);
  eq("al soltar se guarda por usuario (solo la columna tocada)", JSON.parse(localStorage.getItem("chusy_orders_timeline_col_widths_compras")), { project: 230 });
  check("… no se escribe en la clave general ni en la de otro usuario", localStorage.getItem("chusy_orders_timeline_col_widths") === null && localStorage.getItem("chusy_orders_timeline_col_widths_otro") === null);
  eq("… y tras repintar, cabecera y celdas llevan el ancho nuevo", [cssVar("--tl-w-0"), cssVar("--tl-left-w"), document.body.classList.contains("is-col-resizing")], ["230px", "820px", false]);
  const opensBefore = opened.length;
  click($$(".orders-tl-col-resizer", host)[0]);
  check("un clic en el tirador no abre nada", opened.length === opensBefore);

  // otra columna (Descripción) y una personalizada no afectan a la anterior
  const r1 = $$(".orders-tl-col-resizer", host)[1];
  mouse(r1, "mousedown", 400); mouse(document.body, "mousemove", 350); mouse(document.body, "mouseup", 350);
  eq("segunda columna: se acumulan los anchos", JSON.parse(localStorage.getItem("chusy_orders_timeline_col_widths_compras")), { project: 230, title: 190 });
  // sin movimiento: no repinta ni guarda
  const wBefore = localStorage.getItem("chusy_orders_timeline_col_widths_compras");
  const gridNow = $(".orders-timeline__grid", host);
  mouse($$(".orders-tl-col-resizer", host)[2], "mousedown", 10); mouse(document.body, "mouseup", 10);
  check("pulsar y soltar sin mover no cambia nada", localStorage.getItem("chusy_orders_timeline_col_widths_compras") === wBefore && $(".orders-timeline__grid", host) === gridNow);

  // doble clic: restablece esa columna
  dbl($$(".orders-tl-col-resizer", host)[0]);
  eq("doble clic en el tirador: esa columna vuelve a 190 px (la otra se queda)", [cssVar("--tl-w-0"), cssVar("--tl-w-1"), JSON.parse(localStorage.getItem("chusy_orders_timeline_col_widths_compras"))], ["190px", "190px", { title: 190 }]);
  // botón «Restablecer anchos» del menú
  click($("#orders-col-btn", host));
  const resetBtn = $("[data-reset-widths]", host);
  check("el menú «⚙️ Columnas» ofrece «Restablecer anchos»", !!resetBtn && /Restablecer anchos/.test(resetBtn.textContent) && $("#orders-col-menu", host).hidden === false);
  click(resetBtn);
  eq("«Restablecer anchos»: todas por defecto, guardado y menú abierto", [cssVar("--tl-w-1"), JSON.parse(localStorage.getItem("chusy_orders_timeline_col_widths_compras")), $("#orders-col-menu", host).hidden], ["240px", {}, false]);
  click(document.body);

  // aislamiento y reserva entre usuarios en la interfaz
  localStorage.setItem("chusy_orders_timeline_col_widths_compras", JSON.stringify({ project: 300 }));
  const host2 = document.createElement("div"); document.body.appendChild(host2);
  localStorage.setItem("chusy_orders_view_mode_otro", "timeline");
  renderOrdersView(host2, { ...mk("otro"), state: orders.emptyOrdersState() });
  eq("otro usuario: sus anchos son los de por defecto (no los de compras)", $(".orders-timeline", host2).style.getPropertyValue("--tl-w-0"), "190px");
  localStorage.setItem("chusy_orders_timeline_col_widths", JSON.stringify({ title: 300 })); // reserva: clave general (v88)
  renderOrdersView(host2, { ...mk("otro"), state: orders.emptyOrdersState() });
  eq("… y sin clave propia hereda la general del navegador", $(".orders-timeline", host2).style.getPropertyValue("--tl-w-1"), "300px");
  host2.remove();
  localStorage.removeItem("chusy_orders_timeline_col_widths");
  localStorage.removeItem("chusy_orders_timeline_col_widths_compras");
  renderOrdersView(host, { ...opts, state: saved });

  // ---- escala, orden y columnas por usuario
  click($('[data-tl-zoom="8w"]', host));
  const sortSel = $("#orders-timeline-sort", host);
  sortSel.value = "supplier"; sortSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  eq("escala y orden se guardan por usuario", [localStorage.getItem("chusy_orders_timeline_scale_compras"), localStorage.getItem("chusy_orders_timeline_sort_compras"), localStorage.getItem("chusy_orders_timeline_scale")], ["8w", "supplier", null]);
  renderOrdersView(host, { ...opts, state: orders.emptyOrdersState() });
  eq("al volver a entrar (estado de sesión nuevo) se recuperan", [$('[data-tl-zoom].is-active', host).dataset.tlZoom, $("#orders-timeline-sort", host).value], ["8w", "supplier"]);
  const host3 = document.createElement("div"); document.body.appendChild(host3);
  localStorage.setItem("chusy_orders_view_mode_ana", "timeline");
  renderOrdersView(host3, { ...mk("ana"), state: orders.emptyOrdersState() });
  eq("otro usuario arranca con los valores por defecto", [$('[data-tl-zoom].is-active', host3).dataset.tlZoom, $("#orders-timeline-sort", host3).value], ["4w", "project"]);
  host3.remove();
  click($('[data-tl-zoom="4w"]', host)); sortSel.value = "project";
  const sortSel2 = $("#orders-timeline-sort", host); sortSel2.value = "project"; sortSel2.dispatchEvent(new window.Event("change", { bubbles: true }));

  // ---- barras: tiradores
  const barsOf = (id) => $$(".orders-tl-bar", row(id));
  const handles = (b) => $$(".orders-tl-bar-handle", b).map((h) => h.classList.contains("handle-left") ? "L" : "R");
  check("las barras llevan .orders-tl-bar (junto a la clase de siempre)", $$(".orders-timeline__bar", host).length > 0 && $$(".orders-timeline__bar", host).every((b) => b.classList.contains("orders-tl-bar")));
  eq("t2 (una etapa): tirador izquierdo y derecho", handles(barsOf("t2")[0]), ["L", "R"]);
  eq("t1 (Compra + Recepción/Fab.): el izquierdo solo en la primera barra y el derecho solo en la última", barsOf("t1").map(handles), [["L"], ["R"]]);
  eq("t4 (fechas de la tarea): los dos", handles(barsOf("t4")[0]), ["L", "R"]);
  check("los tiradores son .handle-left / .handle-right y no tapan la etiqueta", $$(".orders-tl-bar-handle.handle-left", host).length > 0 && $$(".orders-tl-bar-handle.handle-right", host).length > 0 && barsOf("t2")[0].textContent === "2315");
  const left = (b) => parseFloat(b.style.left), width = (b) => parseFloat(b.style.width);
  const tip = () => $(".orders-tl-drag-tip");
  const flush = () => tick(5);
  const repaint = () => renderOrdersView(host, { ...opts, state: saved }); // el dato que llega de Firestore repinta la vista entera
  eq("posición inicial de t2 (10–12/11): día 8 de la ventana", [left(barsOf("t2")[0]), width(barsOf("t2")[0])], [274, 98]);

  // mover el cuerpo
  const bar2 = barsOf("t2")[0];
  const d1 = mouse(bar2, "mousedown", 500);
  check("mousedown en la barra: preventDefault, sin arrastre-de-scroll de la rejilla", d1.defaultPrevented === true && !$("#orders-timeline-scroll", host).classList.contains("is-dragging"));
  mouse(document.body, "mousemove", 502);
  check("un movimiento de ≤ 3 px aún es un clic (nada cambia)", left(bar2) === 274 && !tip() && !document.body.classList.contains("tl-dragging-bar"));
  mouse(document.body, "mousemove", 568); // +68 px = +2 días
  eq("mover +2 días: la barra se desplaza EN VIVO sin cambiar de ancho", [left(bar2), width(bar2)], [342, 98]);
  eq("aviso flotante con el nuevo rango", tip() && tip().textContent, "12/11 → 14/11 · 3d");
  check("sin selección de texto en la página mientras se arrastra", document.body.classList.contains("tl-dragging-bar") && bar2.classList.contains("is-dragging"));
  mouse(document.body, "mouseup", 568);
  check("al soltar: se quita el aviso y el modo", !tip() && !document.body.classList.contains("tl-dragging-bar") && !bar2.classList.contains("is-dragging"));
  const opensA = opened.length;
  click(bar2);
  check("el clic que sigue a un arrastre real NO abre la tarea", opened.length === opensA);
  await flush();
  eq("se guarda UNA vez, con el parche de las etapas (Compra 12–14/11)", [calls.length, calls[0].id, calls[0].patch.workflow.purchase.startDate, calls[0].patch.workflow.purchase.dueDate, calls[0].patch.startDate, calls[0].patch.dueDate], [1, "t2", "2026-11-12", "2026-11-14", "2026-11-12", "2026-11-14"]);
  const toast = $(".toast--undo");
  check("sale el aviso con «Deshacer»", !!toast && /Deshacer/.test(toast.textContent) && /12\/11 → 14\/11 · 3d/.test(toast.textContent));
  click($(".toast__action", toast));
  await flush();
  eq("«Deshacer» vuelve a escribir las fechas de antes", [calls.length, calls[1].id, calls[1].patch.workflow.purchase.startDate, calls[1].patch.workflow.purchase.dueDate, calls[1].patch.startDate, calls[1].patch.dueDate], [2, "t2", "2026-11-10", "2026-11-12", null, null]);
  dismissUndoToast();
  repaint();

  // clic limpio y arrastre sin cambio de día
  calls.length = 0;
  const bar2b = barsOf("t2")[0];
  mouse(bar2b, "mousedown", 500); mouse(document.body, "mouseup", 500);
  const o1 = opened.length; click(bar2b);
  check("clic limpio sin arrastrar: abre la tarea y no guarda", opened.length === o1 + 1 && opened[o1] === "t2" && calls.length === 0);
  mouse(bar2b, "mousedown", 500); mouse(document.body, "mousemove", 510); mouse(document.body, "mouseup", 510);
  const o2 = opened.length; click(bar2b);
  await flush();
  check("arrastre real de 10 px (0 días): no guarda, la barra vuelve a su sitio y el clic no abre", calls.length === 0 && opened.length === o2 && left(bar2b) === 274 && width(bar2b) === 98);

  // estirar derecha
  const barR = barsOf("t2")[0];
  const hR = $(".handle-right", barR);
  mouse(hR, "mousedown", 700);
  mouse(document.body, "mousemove", 802); // +102 px = +3 días
  eq("estirar el borde derecho +3 días: crece el ancho, el inicio no se mueve", [left(barR), width(barR)], [274, 200]);
  eq("aviso: 10/11 → 15/11 · 6d", tip() && tip().textContent, "10/11 → 15/11 · 6d");
  mouse(document.body, "mouseup", 802);
  await flush();
  eq("parche: solo cambia el fin de la etapa (Compra 10–15/11)", [calls.length, calls[0].patch.workflow.purchase.startDate, calls[0].patch.workflow.purchase.dueDate], [1, "2026-11-10", "2026-11-15"]);
  dismissUndoToast();
  repaint();

  // estirar izquierda
  calls.length = 0;
  const barL = barsOf("t2")[0];
  mouse($(".handle-left", barL), "mousedown", 900);
  mouse(document.body, "mousemove", 832); // −68 px = −2 días
  eq("estirar el borde izquierdo −2 días: la barra se desplaza y se ensancha lo mismo (el fin queda fijo)", [left(barL), width(barL)], [206, 166]);
  eq("aviso: 08/11 → 12/11 · 5d", tip() && tip().textContent, "08/11 → 12/11 · 5d");
  mouse(document.body, "mouseup", 832);
  await flush();
  eq("parche: solo cambia el inicio (Compra 08–12/11)", [calls.length, calls[0].patch.workflow.purchase.startDate, calls[0].patch.workflow.purchase.dueDate], [1, "2026-11-08", "2026-11-12"]);
  dismissUndoToast();
  repaint();

  // un pedido con dos tramos se mueve entero
  calls.length = 0;
  const [pb, qb] = barsOf("t1");
  const startsBefore = [left(pb), left(qb)];
  mouse(pb, "mousedown", 100); mouse(document.body, "mousemove", 134);
  eq("t1: mover +1 día desplaza LOS DOS tramos", [left(pb) - startsBefore[0], left(qb) - startsBefore[1]], [34, 34]);
  mouse(document.body, "mouseup", 134); await flush();
  const w1 = calls[0].patch.workflow;
  eq("… y se guardan las dos etapas", [w1.purchase.startDate, w1.purchase.dueDate, w1.production.startDate, w1.production.dueDate], ["2026-11-10", "2026-11-14", "2026-11-17", "2026-11-21"]);
  dismissUndoToast();
  repaint();

  // fechas estándar de la tarea (t4): se escribe startDate/dueDate
  calls.length = 0;
  const b4 = barsOf("t4")[0];
  mouse(b4, "mousedown", 100); mouse(document.body, "mousemove", 168); mouse(document.body, "mouseup", 168); await flush();
  eq("t4 (fechas estándar): startDate/dueDate +2 días", [calls[0].patch.startDate, calls[0].patch.dueDate], ["2026-11-19", "2026-11-21"]);
  dismissUndoToast();
  repaint();

  // un error al guardar: aviso y la barra vuelve a su sitio
  calls.length = 0;
  failNext = true;
  const realConsoleError = console.error; console.error = () => {}; // el error esperado no ensucia la salida
  const bF = barsOf("t2")[0];
  mouse(bF, "mousedown", 100); mouse(document.body, "mousemove", 168); mouse(document.body, "mouseup", 168); await flush();
  console.error = realConsoleError;
  const errToast = $$(".toast").find((t) => /No se pudieron actualizar las fechas/.test(t.textContent));
  check("si falla el guardado: aviso de error y la barra repintada en su sitio", !!errToast && left(barsOf("t2")[0]) === 274, left(barsOf("t2")[0]));

  // ---- «Sin fecha»: clic en un día
  calls.length = 0;
  const cal3 = $(".orders-timeline__cal", row("t3"));
  check("fila «Sin fecha»: calendario marcado para asignar y botón de siempre", cal3.classList.contains("orders-tl-assign") && !!$(".orders-timeline__nodate", cal3) && /Sin fecha/.test($(".orders-timeline__nodate", cal3).textContent));
  const d3 = mouse(cal3, "mousedown", 34 * 8 + 5); // día 8 de la ventana = 10/11
  check("mousedown en un día vacío: preventDefault y franja de previsualización", d3.defaultPrevented === true && !!$(".orders-tl-assign-band", cal3) && !$("#orders-timeline-scroll", host).classList.contains("is-dragging"));
  eq("aviso con el día", tip() && tip().textContent, "10/11 → 10/11 · 1d");
  const oS = opened.length;
  mouse(document.body, "mouseup", 34 * 8 + 5);
  click(cal3);
  await flush();
  check("clic en un día: se le asigna ese día y no se abre la tarea", calls.length === 1 && calls[0].id === "t3" && calls[0].patch.startDate === "2026-11-10" && calls[0].patch.dueDate === "2026-11-10" && calls[0].patch.workflow.purchase.startDate === "2026-11-10" && opened.length === oS && !$(".orders-tl-assign-band", cal3) && !tip());
  dismissUndoToast();
  calls.length = 0;
  mouse(cal3, "mousedown", 34 * 10 + 5); mouse(document.body, "mousemove", 34 * 8 + 5);
  eq("arrastrar sobre varios días (de derecha a izquierda): aviso con el rango", tip() && tip().textContent, "10/11 → 12/11 · 3d");
  mouse(document.body, "mouseup", 34 * 8 + 5); await flush();
  eq("… se asigna el rango entero (ordenado)", [calls[0].patch.startDate, calls[0].patch.dueDate, calls[0].patch.workflow.purchase.dueDate], ["2026-11-10", "2026-11-12", "2026-11-12"]);
  dismissUndoToast();
  calls.length = 0;
  const oN = opened.length;
  click($(".orders-timeline__nodate", cal3));
  check("el botón «Sin fecha · asignar» sigue abriendo la tarea", opened.length === oN + 1 && opened[oN] === "t3" && calls.length === 0);

  // ---- el drag-to-scroll de la rejilla sigue funcionando fuera de barras y filas «Sin fecha»
  const cal1 = $(".orders-timeline__cal", row("t1"));
  const ds = mouse(cal1, "mousedown", 300);
  check("el fondo de una fila con fechas sigue arrastrando la rejilla", ds.defaultPrevented && $("#orders-timeline-scroll", host).classList.contains("is-dragging"));
  mouse(document.body, "mouseup", 300);
  check("… y al soltar se quita el modo", !$("#orders-timeline-scroll", host).classList.contains("is-dragging"));

  // ---- el scroll se conserva
  renderOrdersView(host, { ...opts, state: saved });
  const sc = () => $("#orders-timeline-scroll", host);
  sc().scrollLeft = 500; sc().scrollTop = 40;
  sc().dispatchEvent(new window.Event("scroll"));
  renderOrdersView(host, { ...opts, state: saved }); // llega un dato: la vista entera se repinta
  eq("repintado completo: scrollLeft y scrollTop se conservan", [sc().scrollLeft, sc().scrollTop], [500, 40]);
  click($$(".orders-chip", host).find((c) => c.dataset.supplier === "Hidráulica Sur"));
  eq("filtrar por proveedor: se conservan", [sc().scrollLeft, sc().scrollTop], [500, 40]);
  click($$(".orders-chip", host)[0]);
  const ws0 = $$(".orders-tl-col-resizer", host)[0];
  mouse(ws0, "mousedown", 100); mouse(document.body, "mousemove", 140); mouse(document.body, "mouseup", 140);
  eq("cambiar un ancho de columna: se conserva", [sc().scrollLeft, sc().scrollTop], [500, 40]);
  dbl($$(".orders-tl-col-resizer", host)[0]);
  eq("restablecer un ancho: se conserva", [sc().scrollLeft, sc().scrollTop], [500, 40]);
  mouse(barsOf("t2")[0], "mousedown", 100); mouse(document.body, "mousemove", 168); mouse(document.body, "mouseup", 168); await flush(); dismissUndoToast();
  eq("mover una barra: se conserva", [sc().scrollLeft, sc().scrollTop], [500, 40]);
  click($('[data-tl-zoom="8w"]', host));
  eq("cambiar de escala sí centra «hoy» (ventana nueva)", sc().scrollLeft, 8 * 34);
  click($('[data-tl-zoom="4w"]', host));

  // «Todo el rango»: si cambian las fechas y la ventana se mueve, el calendario sigue en el mismo DÍA
  click($('[data-tl-zoom="all"]', host));
  const pending = [t1, t2, t3, t4, t6, t7]; // lo que enseña el bloque «Pendientes»
  const winA = orders.timelineWindow(mkRows(pending), { zoom: "all", today: "2026-11-10", offersProjectId: OFF });
  sc().scrollLeft = 340; sc().dispatchEvent(new window.Event("scroll"));
  const old = task("t9", "P1", "Pedido antiguo", { purchase: { supplier: "X", orderNumber: "1", startDate: "2026-08-03", dueDate: "2026-08-05" } });
  const rows2 = mkRows([...pending, old]);
  const winB = orders.timelineWindow(rows2, { zoom: "all", today: "2026-11-10", offersProjectId: OFF });
  renderOrdersView(host, { ...opts, rows: rows2, state: saved });
  const shift = orders.dayDiff(winB.start, winA.start);
  check("la ventana de «Todo el rango» se ha movido", shift > 0, shift);
  eq("… y el scroll sigue en el mismo día (se desplaza lo que se movió la ventana)", sc().scrollLeft, 340 + shift * 34);
  click($('[data-tl-zoom="4w"]', host));

  host.remove();
  dismissUndoToast();
}

// ---------------------------------------------------------------- 5) entrega
{
  const idx = read("index.html");
  eq("index.html: los 14 <link> a ?v=89", (idx.match(/css\/[\w-]+\.css\?v=89/g) || []).length, 14);
  check("index.html: ningún <link> se ha quedado en otra versión", !/\.css\?v=(?!89)\d+/.test(idx));
  check("package.json y package-lock.json: 89.0.0", JSON.parse(read("package.json")).version === "89.0.0" && JSON.parse(read("package-lock.json")).version === "89.0.0");
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES[0];
  check("Novedades: entrada 89 la primera, mayor que la 88, sobre columnas, usuario y arrastrar", r.id === 89 && r.id > RELEASES[1].id && /Cronograma/.test(r.title) && /ancho/i.test(JSON.stringify(r)) && /navegador/i.test(JSON.stringify(r)) && /arrast/i.test(JSON.stringify(r)) && r.items.length >= 4, r && r.id);
  const css = [read("css/06-list-board.css"), read("css/08-calendar-timeline.css")].join("\n");
  check("CSS: tirador de columna, tiradores de barra, franja de asignación, aviso flotante y «Restablecer anchos»", [".orders-tl-col-resizer", ".orders-tl-bar-handle", ".orders-tl-bar-handle.handle-left", ".orders-tl-bar-handle.handle-right", ".orders-tl-assign-band", ".orders-tl-drag-tip", ".orders-colmenu__reset"].every((c) => css.includes(c)));
  check("CSS: tirador de 6 px con cursor col-resize y tiradores de barra con ew-resize", /\.orders-tl-col-resizer\s*\{[^}]*width:\s*6px;[^}]*cursor:\s*col-resize/.test(css) && /\.orders-tl-bar-handle\s*\{[^}]*cursor:\s*ew-resize/.test(css) && /\.orders-timeline__bar\.orders-tl-bar\s*\{\s*cursor:\s*grab/.test(css) && /\.orders-tl-bar\.is-dragging\s*\{\s*cursor:\s*grabbing/.test(css));
  const tlJs = read("js/views/orders-timeline.js");
  check("orders-timeline.js: tiradores, variables de ancho, preventDefault/stopPropagation, umbral de 3 px y Deshacer", /orders-tl-col-resizer/.test(tlJs) && /orders-tl-bar-handle/.test(tlJs) && /--tl-w-/.test(tlJs) && /e\.preventDefault\(\)/.test(tlJs) && /e\.stopPropagation\(\)/.test(tlJs) && /DRAG_THRESHOLD_PX = 3/.test(tlJs) && /showUndoToast/.test(tlJs) && /buildOrderTimelineDatePatch/.test(tlJs));
  const view = read("js/views/orders-view.js");
  check("orders-view.js: modo de vista, escala y orden por usuario", /loadOrdersViewMode/.test(view) && /saveOrdersViewMode/.test(view) && /loadOrdersTimelinePrefs/.test(view) && /userId/.test(view));
  const readme = read("README.md");
  check("README: apartado 3.22, historial v88 → v89 y las claves por usuario", /### 3\.22 Cronograma de Pedidos interactivo/.test(readme) && /v88 → v89 \(Chusy-89\.zip\)/.test(readme) && /chusy_orders_timeline_col_widths/.test(readme) && /buildOrderTimelineDatePatch/.test(readme) && /v89-orders-timeline-interactive/.test(readme));
  const runAll = read("tests/run-all.mjs");
  check("tests/run-all.mjs recoge los *.test.mjs (incluido este) y lo menciona", /\.test\.mjs/.test(runAll) && /v89/.test(runAll));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v89 · Cronograma de Pedidos interactivo (anchos, preferencias por usuario y arrastre de barras)");
