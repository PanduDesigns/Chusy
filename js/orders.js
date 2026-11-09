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
// ============================================================================
import { taskWorkflow, purchaseTrace, PURCHASE_TRACE_MAX } from "./workflow-stages.js";
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
  return { tab: "pending", filters: emptyOrderFilters(), sort: { column: null, direction: "asc" } };
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
  const supplierKey = f.supplier ? suggestionKey(f.supplier) : "";
  const sector = normalizeSectorFilter(f.sector);
  return (rows || []).filter((r) => {
    if (commercialKey && suggestionKey(r.commercial) !== commercialKey) return false;
    if (f.projectId && r.projectId !== f.projectId) return false;
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
