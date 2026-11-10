// ============================================================================
// «Pedidos» (v86) — LÓGICA PURA: sin DOM ni Firebase, así se prueba suelta en Node.
//
// «Pedidos» es una vista TRANSVERSAL para Compras: recoge, de todos los proyectos activos, las tareas que
//  1) tienen habilitada la etapa Compra/Pedido (`workflow.purchase.enabled === true`), y
//  2) YA han llegado a ella: si llevan etapa de Diseño, esta está completada (`workflow.design.completed === true`);
//     si no la llevan, entran directamente.
// Quedan fuera las tareas de Ofertas y las personales (no llevan flujo, ver workflow-stages.js) y las de proyectos
// archivados (no están en la lista de proyectos activos que recibe collectOrderRows).
//
// Cada tarea cae en UN bloque (orderStatus):
//   pending   «Pendientes de pedir (En Compra/Pedido)»            su etapa activa es purchase (purchase.completed === false)
//   placed    «Pedidos realizados (En espera de Recepción/Fab.)»   purchase.completed === true y sigue en Recepción/Fabricación
//   done      «Completados / Recibidos»                            Recepción/Fab. hecha (o sin esa etapa) o tarea completada
//
// Cada fila (orderRow) lleva lo que Compras necesita de un vistazo: proyecto (código YYXXX incluido), tarea, Comercial
// (heredado de las propiedades del proyecto), responsable de Compra, Proveedor, Nº de pedido, Código Proveedor y plazo.
// Los tres textos de trazabilidad salen de la etapa (`workflow.purchase`, la fuente de verdad) y, si faltaran, de su copia en
// la tarea (`task.supplier` / `orderNumber` / `supplierCode`).
//
// Filtros (applyOrderFilters), todos combinables (AND): Comercial · Proyecto · Proveedor · Sector · Responsable y la
// BÚSQUEDA POR TEXTO instantánea, que mira cualquier fragmento del Nº de pedido, del Código Proveedor, del título de la
// tarea y del nombre o código del proyecto (sin distinguir mayúsculas ni tildes; en los códigos tampoco cuentan guiones,
// espacios ni barras: «po2026» encuentra «PO-2026/0012»).
//
// v88 · CRONOGRAMA (al final de este archivo, también PURO): la misma sección tiene dos modos de vista, «Tabla» y «Cronograma»
// (tabla fija a la izquierda + rejilla de días y semanas ISO a la derecha). Aquí viven los chips de proveedor (con
// contadores), las columnas elegibles del cronograma (y su persistencia), el rango de fechas de cada pedido, las semanas ISO,
// la ventana temporal con sus zooms, la ordenación y el texto del tooltip. La pantalla está en views/orders-timeline.js.
// ============================================================================
import { taskWorkflow, purchaseTrace, PURCHASE_TRACE_MAX, STAGE_TIMELINE_COLORS, STAGE_TIMELINE_LABELS } from "./workflow-stages.js";
import { dateKey, parseDateKey, isWeekend, getHoliday, formatDayMonth } from "./work-calendar.js";
import { collectSuggestions, cleanSuggestionText, suggestionKey } from "./offers.js";
import { projectSectorKey, normalizeSectorFilter, SECTOR_FILTER_ALL } from "./project-properties.js";
import { normalizeForSearch, plainTitleText, effectiveProjectIcon } from "./utils.js";

/** Los tres bloques de la vista, en orden. `label` es el texto de la pestaña. */
export const ORDER_TABS = Object.freeze([
  Object.freeze({ key: "pending", label: "Pendientes de pedir", hint: "En Compra/Pedido" }),
  Object.freeze({ key: "placed", label: "Pedidos realizados", hint: "En espera de Recepción/Fab." }),
  Object.freeze({ key: "done", label: "Completados / Recibidos", hint: "" }),
]);
export const ORDER_STATUS_KEYS = Object.freeze(ORDER_TABS.map((t) => t.key));

const clean = (v) => cleanSuggestionText(v);
const compactCode = (v) => normalizeForSearch(v).replace(/[^a-z0-9]+/g, "");

// ------------------------------------------------------------------ qué tareas son pedidos

/**
 * En qué bloque está la tarea: 'pending' | 'placed' | 'done', o null si NO es un pedido (sin flujo, de Ofertas, personal,
 * sin Compra/Pedido habilitada, o todavía en Diseño).
 */
export function orderStatus(task, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf || wf.purchase.enabled !== true) return null;
  const reached = !wf.design.enabled || wf.design.completed === true;
  if (!reached) return null;
  if (task.isComplete) return "done";
  if (wf.purchase.completed !== true) return "pending";
  const prod = wf.production;
  return prod.enabled && !prod.completed ? "placed" : "done";
}

/** ¿Es un pedido de la sección «Pedidos»? (cualquiera de los tres bloques) */
export function isOrderTask(task, offersProjectId) {
  return orderStatus(task, offersProjectId) !== null;
}

// ------------------------------------------------------------------ filas

/** El plazo que se enseña en cada bloque: el de Compra/Pedido, la fecha prevista de recepción, o la última conocida. */
function deadlineOf(wf, task, status) {
  if (status === "pending") return wf.purchase.dueDate || task.dueDate || null;
  if (status === "placed") return wf.production.dueDate || wf.production.startDate || task.dueDate || null;
  return wf.production.dueDate || wf.purchase.dueDate || task.dueDate || null;
}

/**
 * Una fila de «Pedidos» a partir de una tarea que SÍ es un pedido.
 *   ctx: { offersProjectId, projectsById: Map(id → proyecto activo), nameOf(uid) → nombre }
 * Devuelve null si no es un pedido o si ninguno de sus proyectos está entre los activos.
 */
export function orderRow(task, { offersProjectId, projectsById, nameOf } = {}) {
  const status = orderStatus(task, offersProjectId);
  if (!status) return null;
  const wf = taskWorkflow(task, offersProjectId);
  const candidates = [task.projectId, ...(Array.isArray(task.extraProjectIds) ? task.extraProjectIds : [])]
    .map((id) => (projectsById && id ? projectsById.get(id) : null))
    .filter(Boolean);
  const project = candidates[0];
  if (!project) return null; // proyecto archivado, eliminado o no visible: no cuenta como pedido activo
  const props = (p) => (p && p.properties) || {};
  const commercial = clean((candidates.find((p) => clean(props(p).comercial)) || {}).properties?.comercial || "");
  const sectorOwner = candidates.find((p) => projectSectorKey(p));
  const trace = purchaseTrace(wf);
  const pick = (f) => trace[f] || clean(task[f]).slice(0, PURCHASE_TRACE_MAX[f]);
  const buyerId = wf.purchase.assigneeId || null;
  return {
    id: task.id,
    task,
    status,
    projectId: project.id,
    projectName: project.name || "",
    projectCode: project.code || "",
    projectColor: project.color || "",
    projectIcon: effectiveProjectIcon(project), // v87: el coche en un proyecto de Automoción con la carpeta por defecto
    sector: sectorOwner ? projectSectorKey(sectorOwner) : "",
    customFieldDefs: Array.isArray(project.customFieldDefs) ? project.customFieldDefs : [], // v88: columnas personalizadas del cronograma
    title: plainTitleText(task.title || ""),
    commercial,
    buyerId,
    buyerName: buyerId ? (typeof nameOf === "function" ? nameOf(buyerId) : "") || "" : "",
    supplier: pick("supplier"),
    orderNumber: pick("orderNumber"),
    supplierCode: pick("supplierCode"),
    deadline: deadlineOf(wf, task, status),
  };
}

/**
 * Las filas de todos los pedidos de `tasks` (sin repetir tareas), de los proyectos activos de `projects`.
 *   opts: { projects, members, offersProjectId }
 */
export function collectOrderRows(tasks, { projects, members, offersProjectId } = {}) {
  const projectsById = new Map((projects || []).filter((p) => p && !p.exclusive && !p.archived).map((p) => [p.id, p]));
  const names = new Map((members || []).map((m) => [m.uid, m.name || ""]));
  const nameOf = (uid) => names.get(uid) || "";
  const seen = new Set();
  const rows = [];
  for (const t of tasks || []) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    const row = orderRow(t, { offersProjectId, projectsById, nameOf });
    if (row) rows.push(row);
  }
  return rows;
}

/** Cuántos pedidos hay en cada bloque: { pending, placed, done }. */
export function countOrdersByStatus(rows) {
  const out = { pending: 0, placed: 0, done: 0 };
  for (const r of rows || []) out[r.status] += 1;
  return out;
}

/** El contador de la barra lateral: pedidos pendientes de tramitar (bloque «Pendientes de pedir»). */
export function pendingOrdersCount(tasks, ctx) {
  return countOrdersByStatus(collectOrderRows(tasks, ctx)).pending;
}

/** Las filas repartidas por bloque. */
export function groupOrdersByStatus(rows) {
  const out = { pending: [], placed: [], done: [] };
  for (const r of rows || []) out[r.status].push(r);
  return out;
}

// ------------------------------------------------------------------ filtros y búsqueda

/** El estado de la vista «Pedidos» al entrar: bloque «Pendientes de pedir», sin filtros ni orden elegido. Solo de sesión. */
export function emptyOrdersState() {
  return { tab: "pending", filters: emptyOrderFilters(), sort: { column: null, direction: "asc" }, timeline: emptyTimelineState() };
}

export function emptyOrderFilters() {
  return { commercial: "", projectId: "", supplier: "", sector: SECTOR_FILTER_ALL, assigneeId: "", search: "" };
}

/** ¿Coincide la fila con lo escrito en la búsqueda instantánea? (vacío = sí a todo) */
export function orderMatchesSearch(row, text) {
  const q = normalizeForSearch(clean(text));
  if (!q) return true;
  const qc = compactCode(q);
  const plain = (v) => normalizeForSearch(v).includes(q);
  const code = (v) => normalizeForSearch(v).includes(q) || (qc !== "" && compactCode(v).includes(qc));
  return code(row.orderNumber) || code(row.supplierCode) || code(row.projectCode) || plain(row.title) || plain(row.projectName);
}

/** Aplica los filtros (todos a la vez) a las filas. `filters` como emptyOrderFilters(); un campo vacío no filtra. */
export function applyOrderFilters(rows, filters) {
  const f = { ...emptyOrderFilters(), ...(filters || {}) };
  const commercialKey = f.commercial ? suggestionKey(f.commercial) : "";
  const noSupplier = f.supplier === SUPPLIER_NONE; // v88: el chip «Sin proveedor»
  const supplierKey = f.supplier && !noSupplier ? suggestionKey(f.supplier) : "";
  const sector = normalizeSectorFilter(f.sector);
  return (rows || []).filter((r) => {
    if (commercialKey && suggestionKey(r.commercial) !== commercialKey) return false;
    if (f.projectId && r.projectId !== f.projectId) return false;
    if (noSupplier && clean(r.supplier)) return false;
    if (supplierKey && suggestionKey(r.supplier) !== supplierKey) return false;
    if (sector !== SECTOR_FILTER_ALL && r.sector !== sector) return false;
    if (f.assigneeId && r.buyerId !== f.assigneeId) return false;
    return orderMatchesSearch(r, f.search);
  });
}

/** ¿Hay algún filtro o texto aplicado? (para enseñar «Limpiar filtros») */
export function hasActiveOrderFilters(filters) {
  const f = { ...emptyOrderFilters(), ...(filters || {}) };
  return !!(f.commercial || f.projectId || f.supplier || f.assigneeId || clean(f.search) || normalizeSectorFilter(f.sector) !== SECTOR_FILTER_ALL);
}

/**
 * Las opciones de los desplegables, sacadas de TODAS las filas (no de las ya filtradas, para que elegir un Comercial no
 * deje sin opciones a los demás): { commercials: string[], suppliers: string[], projects: [{id,name,code}], assignees: [{uid,name}] }.
 */
export function orderFilterOptions(rows) {
  const projects = new Map();
  const assignees = new Map();
  for (const r of rows || []) {
    if (!projects.has(r.projectId)) projects.set(r.projectId, { id: r.projectId, name: r.projectName, code: r.projectCode });
    if (r.buyerId && !assignees.has(r.buyerId)) assignees.set(r.buyerId, { uid: r.buyerId, name: r.buyerName || "Sin nombre" });
  }
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "", "es", { sensitivity: "base" });
  const byCode = (a, b) => (a.code || "￿").localeCompare(b.code || "￿", "es", { numeric: true }) || byName(a, b); // por código YYXXX; sin código al final
  return {
    commercials: collectSuggestions((rows || []).map((r) => r.commercial)),
    suppliers: collectSuggestions((rows || []).map((r) => r.supplier)),
    projects: [...projects.values()].sort(byCode),
    assignees: [...assignees.values()].sort(byName),
  };
}

// ------------------------------------------------------------------ orden

export const ORDER_SORT_COLUMNS = Object.freeze(["project", "title", "commercial", "buyer", "supplier", "orderNumber", "supplierCode", "deadline"]);

const sortValue = (r, col) => {
  switch (col) {
    case "project": return `${r.projectCode} ${r.projectName}`;
    case "title": return r.title;
    case "commercial": return r.commercial;
    case "buyer": return r.buyerName;
    case "supplier": return r.supplier;
    case "orderNumber": return r.orderNumber;
    case "supplierCode": return r.supplierCode;
    case "deadline": return r.deadline || "";
    default: return "";
  }
};

/**
 * Copia ordenada por una columna (texto sin distinguir tildes, con los números «naturales»: «PO-9» < «PO-10»).
 * Los vacíos van SIEMPRE al final, ordenes como ordenes. Sin columna: por plazo (el más próximo primero) y, a igualdad, por proyecto.
 */
export function sortOrderRows(rows, column, direction = "asc") {
  const col = ORDER_SORT_COLUMNS.includes(column) ? column : "deadline";
  const dir = direction === "desc" ? -1 : 1;
  const cmp = (a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base", numeric: true });
  return [...(rows || [])].sort((a, b) => {
    const va = sortValue(a, col), vb = sortValue(b, col);
    if (!va && vb) return 1;
    if (va && !vb) return -1;
    const main = va || vb ? dir * cmp(va, vb) : 0;
    return main || cmp(sortValue(a, "project"), sortValue(b, "project")) || cmp(a.title, b.title);
  });
}

// ------------------------------------------------------------------ memoria del campo Proveedor

/**
 * Los proveedores ya escritos, sin repetir (sin distinguir mayúsculas, tildes ni espacios: «Hidraulica  Sur» y
 * «hidráulica sur» son uno, se queda la variante mejor escrita) y ordenados — lo que sugiere el campo «Proveedor».
 * Mira la etapa (`workflow.purchase.supplier`) y la copia de la tarea (`supplier`) de CADA tarea que se le pase, aunque
 * hoy tenga Compra/Pedido desmarcada: un proveedor usado alguna vez sigue siendo una sugerencia.
 */
export function collectSupplierOptions(tasks) {
  const values = [];
  for (const t of tasks || []) {
    if (!t) continue;
    values.push(t.supplier);
    const wf = t.workflow;
    if (wf && wf.purchase) values.push(wf.purchase.supplier);
  }
  return collectSuggestions(values);
}

// ============================================================================
// v88 · CRONOGRAMA DE PEDIDOS — lógica pura
// ============================================================================

// ------------------------------------------------------------------ modo de vista (Tabla | Cronograma)

export const ORDERS_VIEW_MODE_KEY = "chusy_orders_view_mode";
export const ORDERS_VIEW_MODES = Object.freeze([
  Object.freeze({ key: "table", label: "Tabla", icon: "📋" }),
  Object.freeze({ key: "timeline", label: "Cronograma", icon: "📅" }),
]);

/** Cualquier valor → 'table' | 'timeline' ('table' si no es uno de los dos). */
export function normalizeViewMode(value) {
  return value === "timeline" ? "timeline" : "table";
}

const storageOf = (storage) => storage || (typeof localStorage !== "undefined" ? localStorage : null);

/** El modo guardado en este navegador ('table' si no hay nada o localStorage falla). */
export function loadViewMode(storage) {
  try {
    const st = storageOf(storage);
    return st ? normalizeViewMode(st.getItem(ORDERS_VIEW_MODE_KEY)) : "table";
  } catch (e) {
    return "table";
  }
}

/** Guarda el modo (normalizado) y lo devuelve; si localStorage falla, lo devuelve igual (vale para esta sesión). */
export function saveViewMode(value, storage) {
  const mode = normalizeViewMode(value);
  try {
    const st = storageOf(storage);
    if (st) st.setItem(ORDERS_VIEW_MODE_KEY, mode);
  } catch (e) { /* localStorage no disponible */ }
  return mode;
}

// ------------------------------------------------------------------ chips rápidos de proveedor

/** Valor del filtro `supplier` para «pedidos sin proveedor» (no puede ser un nombre real de proveedor). */
export const SUPPLIER_NONE = "__none__";

/**
 * Los chips de acceso rápido: { all, none, suppliers: [{ key, name, count }] } a partir de las filas que se le pasen
 * (la vista le da las del bloque actual con todos los filtros MENOS el de proveedor, así el contador es lo que saldría al
 * pulsar el chip). Los proveedores se juntan sin distinguir mayúsculas, tildes ni espacios y se enseña la variante mejor
 * escrita; salen ordenados por nombre.
 */
export function supplierChips(rows) {
  const list = rows || [];
  const best = new Map(collectSuggestions(list.map((r) => r.supplier)).map((name) => [suggestionKey(name), name]));
  const counts = new Map();
  let none = 0;
  for (const r of list) {
    const name = clean(r.supplier);
    if (!name) { none += 1; continue; }
    const key = suggestionKey(name);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const suppliers = [...counts.entries()]
    .map(([key, count]) => ({ key, name: best.get(key) || key, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  return { all: list.length, none, suppliers };
}

/** ¿Está activo este valor de filtro en el chip? `chipValue`: '' (Todos), SUPPLIER_NONE o un nombre de proveedor. */
export function supplierChipActive(filterValue, chipValue) {
  const f = filterValue || "";
  if (!f || !chipValue) return !f && !chipValue;
  if (f === SUPPLIER_NONE || chipValue === SUPPLIER_NONE) return f === chipValue;
  return suggestionKey(f) === suggestionKey(chipValue);
}

// ------------------------------------------------------------------ columnas del cronograma

export const TIMELINE_COLUMNS_KEY = "chusy_orders_timeline_columns";

/** Columnas opcionales estándar (Proyecto y Descripción son fijas y no están aquí). `width` en px. */
export const TIMELINE_COLUMN_DEFS = Object.freeze([
  Object.freeze({ key: "supplier", label: "Proveedor", width: 130 }),
  Object.freeze({ key: "orderNumber", label: "Nº Pedido", width: 90 }),
  Object.freeze({ key: "supplierCode", label: "Cód. Proveedor", width: 110 }),
  Object.freeze({ key: "stageStatus", label: "Etapa / Estado", width: 130 }),
  Object.freeze({ key: "priority", label: "Prioridad", width: 84 }),
  Object.freeze({ key: "assignee", label: "Responsable", width: 120 }),
  Object.freeze({ key: "commercial", label: "Comercial", width: 110 }),
  Object.freeze({ key: "sector", label: "Sector", width: 92 }),
  Object.freeze({ key: "dueDateText", label: "Fecha Fin / Entrega", width: 104 }),
]);
export const TIMELINE_DEFAULT_COLUMNS = Object.freeze(["supplier", "orderNumber", "stageStatus"]);
export const TIMELINE_CUSTOM_WIDTH = 100;
export const TIMELINE_MAX_CUSTOM_COLUMNS = 20;
const CUSTOM_PREFIX = "cf:";
const STANDARD_KEYS = TIMELINE_COLUMN_DEFS.map((c) => c.key);

/** La clave de la columna de un campo personalizado: por NOMBRE («TIPO» de dos proyectos = una sola columna). */
export function customColumnKey(name) {
  const n = normalizeForSearch(clean(name)).replace(/\s+/g, " ").trim();
  return n ? CUSTOM_PREFIX + n : "";
}

/**
 * Una lista de columnas (array, o su texto JSON) → la lista limpia: solo claves estándar conocidas (en el orden
 * de TIMELINE_COLUMN_DEFS) y claves `cf:nombre` bien formadas (en el orden dado), sin repetir. Un array vacío es válido
 * (el usuario las desmarcó todas); cualquier otra cosa que no sea un array → las de por defecto.
 */
export function normalizeTimelineColumns(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  if (!Array.isArray(list)) return [...TIMELINE_DEFAULT_COLUMNS];
  const wanted = new Set(list.filter((k) => typeof k === "string"));
  const standard = STANDARD_KEYS.filter((k) => wanted.has(k));
  const custom = [];
  for (const k of list) {
    if (typeof k !== "string" || !k.startsWith(CUSTOM_PREFIX) || k.length <= CUSTOM_PREFIX.length || k.length > 90) continue;
    if (!custom.includes(k) && custom.length < TIMELINE_MAX_CUSTOM_COLUMNS) custom.push(k);
  }
  return [...standard, ...custom];
}

/** Las columnas guardadas en este navegador (las de por defecto si no hay nada o está corrupto). */
export function loadTimelineColumns(storage) {
  try {
    const st = storageOf(storage);
    const raw = st ? st.getItem(TIMELINE_COLUMNS_KEY) : null;
    return raw == null ? [...TIMELINE_DEFAULT_COLUMNS] : normalizeTimelineColumns(raw);
  } catch (e) {
    return [...TIMELINE_DEFAULT_COLUMNS];
  }
}

/** Guarda las columnas (normalizadas) y las devuelve; si localStorage falla, las devuelve igual. */
export function saveTimelineColumns(columns, storage) {
  const cols = normalizeTimelineColumns(columns);
  try {
    const st = storageOf(storage);
    if (st) st.setItem(TIMELINE_COLUMNS_KEY, JSON.stringify(cols));
  } catch (e) { /* localStorage no disponible */ }
  return cols;
}

/** Marca o desmarca una columna y devuelve la lista normalizada (no toca la original; los personalizados conservan el orden en que se marcaron). */
export function toggleTimelineColumn(columns, key, on) {
  const current = normalizeTimelineColumns(columns).filter((k) => k !== key);
  if (on) current.push(key);
  return normalizeTimelineColumns(current);
}

/** Los campos personalizados que existen en los proyectos de estas filas: [{ key, label }], uno por nombre, ordenados. */
export function timelineCustomColumns(rows) {
  const labels = new Map(); // key → nombres escritos
  for (const r of rows || []) {
    for (const def of (r && r.customFieldDefs) || []) {
      const name = clean(def && def.name);
      const key = customColumnKey(name);
      if (!key) continue;
      if (!labels.has(key)) labels.set(key, []);
      labels.get(key).push(name);
    }
  }
  return [...labels.entries()]
    .map(([key, names]) => ({ key, label: names[0] }))
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));
}

/** Las columnas OPCIONALES a pintar, con etiqueta y ancho: las estándar marcadas y las `cf:` marcadas que existen en `customCols`. */
export function resolveTimelineColumns(selected, customCols) {
  const sel = normalizeTimelineColumns(selected);
  const out = TIMELINE_COLUMN_DEFS.filter((c) => sel.includes(c.key)).map((c) => ({ key: c.key, label: c.label, width: c.width, custom: false }));
  const byKey = new Map((customCols || []).map((c) => [c.key, c]));
  for (const k of sel) {
    const c = k.startsWith(CUSTOM_PREFIX) ? byKey.get(k) : null;
    if (c) out.push({ key: k, label: c.label, width: TIMELINE_CUSTOM_WIDTH, custom: true });
  }
  return out;
}

/** El valor de un campo personalizado (columna `cf:nombre`) para una fila: el del campo de ESE proyecto con ese nombre. */
export function customFieldValue(row, key) {
  const def = ((row && row.customFieldDefs) || []).find((d) => d && customColumnKey(d.name) === key);
  if (!def) return "";
  const v = row.task && row.task.customFields ? row.task.customFields[def.id] : null;
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => clean(x)).filter(Boolean).join(", ");
  return clean(typeof v === "object" ? "" : v);
}

// ------------------------------------------------------------------ fechas de un pedido

const MS_DAY = 86400000;
const utcDay = (key) => { const d = parseDateKey(key); return d ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) : NaN; };

/** Días entre dos claves 'YYYY-MM-DD' (b − a; NaN si alguna no es válida). */
export function dayDiff(a, b) { return Math.round((utcDay(b) - utcDay(a)) / MS_DAY); }

/** 'YYYY-MM-DD' + n días → 'YYYY-MM-DD' (null si la clave no es válida). */
export function addDaysKey(key, n) {
  const d = parseDateKey(key);
  return d ? dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) : null;
}

/** El lunes de la semana de esa fecha. */
export function mondayOf(key) {
  const d = parseDateKey(key);
  return d ? addDaysKey(key, -((d.getDay() + 6) % 7)) : null;
}

/**
 * El rango de un pedido para el cronograma:
 *   { start, end, source: 'stages' | 'task', segments: [{ key, label, color, startDate, dueDate, drawStart, drawEnd, drawn }] }
 * o null si no tiene ninguna fecha («Sin fecha»).
 *  · Prioridad a las etapas de Compra/Pedido (`purchase`) y Recepción/Fabricación (`production`) habilitadas que tengan alguna
 *    fecha (si solo tienen una, dura ese día; si vienen al revés se ordenan).
 *  · Si ninguna tiene fechas, las de la propia tarea (`startDate`/`dueDate`), un único tramo «Pedido».
 *  · `drawStart/drawEnd`: lo que se pinta — un tramo que se solapa con el anterior se recorta para no taparlo (y si queda
 *    entero debajo, `drawn` = false). Las fechas reales (startDate/dueDate) no se tocan: son las del tooltip.
 */
export function orderDateRange(row, offersProjectId) {
  const task = row && row.task;
  if (!task) return null;
  const wf = taskWorkflow(task, offersProjectId);
  const mk = (key, label, color, a, b) => {
    a = dateKey(a); b = dateKey(b);
    if (!a && !b) return null;
    a = a || b; b = b || a;
    if (a > b) [a, b] = [b, a];
    return { key, label, color, startDate: a, dueDate: b };
  };
  let segments = [];
  let source = "stages";
  if (wf) {
    for (const k of ["purchase", "production"]) {
      const s = wf[k];
      if (!s || !s.enabled) continue;
      const seg = mk(k, STAGE_TIMELINE_LABELS[k], STAGE_TIMELINE_COLORS[k], s.startDate, s.dueDate);
      if (seg) segments.push(seg);
    }
  }
  if (!segments.length) {
    const seg = mk("task", "Pedido", STAGE_TIMELINE_COLORS.purchase, task.startDate, task.dueDate);
    if (!seg) return null;
    segments = [seg];
    source = "task";
  }
  segments.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  let cursor = null;
  for (const seg of segments) {
    let ds = seg.startDate;
    if (cursor && ds <= cursor) ds = addDaysKey(cursor, 1);
    seg.drawStart = ds;
    seg.drawEnd = seg.dueDate;
    seg.drawn = ds <= seg.dueDate;
    if (!cursor || seg.dueDate > cursor) cursor = seg.dueDate;
  }
  return { start: segments[0].startDate, end: cursor, source, segments };
}

/** El texto del tooltip de la barra de un pedido (varias líneas): proyecto, tarea, proveedor, Nº, código y fechas. */
export function describeOrderBar(row, range) {
  const lines = [
    `Proyecto: ${row.projectCode ? row.projectCode + " · " : ""}${row.projectName}`,
    `Tarea: ${row.title}`,
    `Proveedor: ${row.supplier || "—"}`,
    `Nº de pedido: ${row.orderNumber || "—"}`,
    `Cód. Proveedor: ${row.supplierCode || "—"}`,
  ];
  if (!range) { lines.push("Fechas: sin fecha"); return lines.join("\n"); }
  for (const seg of range.segments) {
    const a = formatDayMonth(seg.startDate), b = formatDayMonth(seg.dueDate);
    lines.push(`${seg.label}: ${a && b && a !== b ? `${a}–${b}` : a || b}`);
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ semanas ISO y rejilla de días

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"]; // lunes primero

/** { year, week } ISO 8601 de una fecha (el jueves de la semana decide el año), o null. */
export function isoWeek(value) {
  const key = dateKey(value);
  const d = key ? parseDateKey(key) : null;
  if (!d) return null;
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / MS_DAY + 1) / 7);
  return { year, week };
}

/** «S46» (dos cifras: «S07»), o '' si no es una fecha. */
export function isoWeekLabel(value) {
  const w = isoWeek(value);
  return w ? `S${String(w.week).padStart(2, "0")}` : "";
}

export const TIMELINE_MAX_DAYS = 7 * 78;

/**
 * Los días de la rejilla, de `startKey` a `endKey` (incluidos, tope TIMELINE_MAX_DAYS):
 *   [{ key, day, dow (0 = lunes), letter, weekend, holiday (nombre o ''), nonWorking }]
 * `cfg` es el calendario laboral (festivos): un festivo o un fin de semana es no laborable.
 */
export function buildTimelineDays(startKey, endKey, cfg) {
  const out = [];
  const n = Math.min(dayDiff(startKey, endKey) + 1, TIMELINE_MAX_DAYS);
  if (!(n > 0)) return out;
  for (let i = 0; i < n; i++) {
    const key = addDaysKey(startKey, i);
    const date = parseDateKey(key);
    const dow = (date.getDay() + 6) % 7;
    const h = getHoliday(date, cfg);
    const weekend = isWeekend(date);
    out.push({ key, day: date.getDate(), dow, letter: DAY_LETTERS[dow], weekend, holiday: h ? clean(h.name) || "Festivo" : "", nonWorking: weekend || !!h });
  }
  return out;
}

/** Las semanas ISO de la rejilla: [{ label: 'S46', year, week, start (índice del primer día), span }] (la primera/última pueden quedar cortadas). */
export function groupTimelineWeeks(days) {
  const out = [];
  (days || []).forEach((d, i) => {
    const w = isoWeek(d.key);
    const last = out[out.length - 1];
    if (last && last.year === w.year && last.week === w.week) last.span += 1;
    else out.push({ label: isoWeekLabel(d.key), year: w.year, week: w.week, start: i, span: 1 });
  });
  return out;
}

/** Los meses de la rejilla: [{ label: 'Noviembre 2026', start, span }]. */
export function groupTimelineMonths(days) {
  const out = [];
  (days || []).forEach((d, i) => {
    const date = parseDateKey(d.key);
    const label = `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    const last = out[out.length - 1];
    if (last && last.label === label) last.span += 1;
    else out.push({ label, start: i, span: 1 });
  });
  return out;
}

// ------------------------------------------------------------------ ventana temporal, zoom y navegación

export const TIMELINE_ZOOMS = Object.freeze([
  Object.freeze({ key: "4w", label: "4 Semanas", weeks: 4 }),
  Object.freeze({ key: "8w", label: "8 Semanas", weeks: 8 }),
  Object.freeze({ key: "12w", label: "12 Semanas", weeks: 12 }),
  Object.freeze({ key: "all", label: "Todo el rango", weeks: null }),
]);
export const TIMELINE_NAV_WEEKS = 2; // lo que desplazan «Anterior» y «Siguiente»
export const TIMELINE_SORTS = Object.freeze([
  Object.freeze({ key: "project", label: "Proyecto" }),
  Object.freeze({ key: "date", label: "Fecha" }),
  Object.freeze({ key: "supplier", label: "Proveedor" }),
]);

export const normalizeTimelineZoom = (v) => (TIMELINE_ZOOMS.some((z) => z.key === v) ? v : "4w");
export const normalizeTimelineSort = (v) => (TIMELINE_SORTS.some((s) => s.key === v) ? v : "project");

/** El estado del cronograma al entrar (solo de sesión): ordenado por proyecto, 4 semanas, sin desplazar. */
export function emptyTimelineState() {
  return { sort: "project", zoom: "4w", offset: 0 };
}

/**
 * La ventana de días que se pinta: { start, end, weeks, zoom }.
 *  · 4/8/12 semanas: arranca el lunes de la semana ANTERIOR a hoy (+ `offset` semanas, que mueven Anterior/Siguiente).
 *  · «Todo el rango»: desde una semana antes del primer pedido (o de hoy) hasta una después del último (o de hoy), con tope de
 *    TIMELINE_MAX_DAYS; si no cabe, se queda con lo que rodea a hoy. `offset` no se usa (ahí se navega con el scroll).
 */
export function timelineWindow(rows, { zoom, offset = 0, today, offersProjectId } = {}) {
  const z = TIMELINE_ZOOMS.find((x) => x.key === normalizeTimelineZoom(zoom));
  const todayKey = dateKey(today) || dateKey(new Date());
  if (z.weeks) {
    const start = addDaysKey(mondayOf(todayKey), -7 + 7 * (Number(offset) || 0));
    return { start, end: addDaysKey(start, z.weeks * 7 - 1), weeks: z.weeks, zoom: z.key };
  }
  let min = todayKey, max = todayKey;
  for (const r of rows || []) {
    const range = orderDateRange(r, offersProjectId);
    if (!range) continue;
    if (range.start < min) min = range.start;
    if (range.end > max) max = range.end;
  }
  let start = mondayOf(addDaysKey(min, -7));
  let end = addDaysKey(mondayOf(addDaysKey(max, 7)), 6);
  if (dayDiff(start, end) + 1 > TIMELINE_MAX_DAYS) {
    start = [start, addDaysKey(mondayOf(todayKey), -26 * 7)].sort().pop();
    const cap = addDaysKey(start, TIMELINE_MAX_DAYS - 1);
    if (end > cap) end = cap;
  }
  return { start, end, weeks: (dayDiff(start, end) + 1) / 7, zoom: "all" };
}

/**
 * Dónde cae un tramo [a, b] en la ventana [winStart, winEnd]:
 *   { offset (días desde winStart), span (días), clipLeft, clipRight }  si se ve total o parcialmente,
 *   { before: true } si termina antes de la ventana, { after: true } si empieza después.
 */
export function placeInWindow(a, b, winStart, winEnd) {
  if (b < winStart) return { before: true };
  if (a > winEnd) return { after: true };
  const s = a < winStart ? winStart : a;
  const e = b > winEnd ? winEnd : b;
  return { offset: dayDiff(winStart, s), span: dayDiff(s, e) + 1, clipLeft: a < winStart, clipRight: b > winEnd };
}

/**
 * Copia de las filas ordenada para el cronograma:
 *  · 'project': por código de proyecto (los sin código al final) y nombre — así todas las filas de un proyecto quedan juntas —,
 *    y dentro, por fecha de inicio (sin fecha al final) y tarea.
 *  · 'date': por fecha de inicio, luego fin (sin fecha al final) y proyecto.
 *  · 'supplier': por proveedor (sin proveedor al final), luego proyecto y fecha.
 */
export function sortTimelineRows(rows, sortKey, offersProjectId) {
  const key = normalizeTimelineSort(sortKey);
  const ranges = new Map((rows || []).map((r) => [r.id, orderDateRange(r, offersProjectId)]));
  const cmp = (a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base", numeric: true });
  const empty = (a, b, f) => { const va = f(a), vb = f(b); if (!va && vb) return 1; if (va && !vb) return -1; return va && vb ? cmp(va, vb) : 0; };
  const startOf = (r) => (ranges.get(r.id) || {}).start || "";
  const endOf = (r) => (ranges.get(r.id) || {}).end || "";
  const byProject = (a, b) => empty(a, b, (r) => r.projectCode) || cmp(a.projectName, b.projectName) || cmp(a.projectId, b.projectId);
  return [...(rows || [])].sort((a, b) => {
    if (key === "date") return empty(a, b, startOf) || empty(a, b, endOf) || byProject(a, b) || cmp(a.title, b.title);
    if (key === "supplier") return empty(a, b, (r) => r.supplier) || byProject(a, b) || empty(a, b, startOf) || cmp(a.title, b.title);
    return byProject(a, b) || empty(a, b, startOf) || cmp(a.title, b.title);
  });
}

/** ISO 'YYYY-MM-DD' de hoy (o de `now`) — la fecha que marca la columna «Hoy». */
export function todayKeyOf(now) { return dateKey(now || new Date()); }
