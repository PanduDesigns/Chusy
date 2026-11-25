// ============================================================================
// «Mis tareas» (v93) — columnas elegibles por persona y filtros ampliados. LÓGICA PURA: sin DOM ni Firebase, así se
// prueba suelta en Node. La vista (views/my-tasks-view.js) solo pinta lo que sale de aquí.
//
//   MY_TASKS_AVAILABLE_COLUMNS   el catálogo de columnas fijas (la columna «Tarea» va siempre y no está aquí)
//   DEFAULT_MY_TASKS_COLUMNS     las que se ven si la persona nunca ha elegido
//   normalizeMyTasksColumns      cualquier cosa → lista limpia (claves conocidas del catálogo + `pf:`/`cf:` bien formadas)
//   loadMyTasksColumns / saveMyTasksColumns   por persona y navegador: localStorage `chusy_my_tasks_columns_<uid>`,
//                                con reserva en la clave general `chusy_my_tasks_columns` (mismo patrón que Pedidos, orders.js)
//   myTaskContext / myTaskCellValue   los datos de una tarea que vienen de su proyecto u oferta (código, sector, cliente,
//                                comercial, tipo, sección…) y de su flujo de etapas, listos para pintar, ordenar y filtrar
//   filterMyTasksItems           los filtros de la barra de «Mis tareas» (texto, tipo/proyecto, sector, comercial, etapa,
//                                proveedor y etiqueta)
//
// Claves de columna: las del catálogo (`project`, `code`…); `cf:<id>` = un campo personalizado PERSONAL de la persona (ya
// existía antes de la v93); `pf:<nombre>` = un campo personalizado de PROYECTO agrupado por nombre normalizado («TIPO» de
// dos proyectos es una sola columna, como en el cronograma de Pedidos).
// ============================================================================
import { getTaskProjectIds, getTaskSectionForProject, normalizeForSearch, plainTitleText, stripHtmlToText, effectiveProjectIcon } from "./utils.js";
import { cleanSuggestionText, isOffersProject, findOfferCommercialField, findOfferSectorField, matchSector } from "./offers.js";
import { projectSectorKey, normalizeSectorKey } from "./project-properties.js";
import { taskWorkflow, currentStageKey, purchaseTrace, STAGE_KEYS, STAGE_LABELS } from "./workflow-stages.js";

export const MY_TASKS_COLUMNS_KEY = "chusy_my_tasks_columns";

/** Las columnas del catálogo, en el orden en que se enseñan en el menú. `group` solo sirve para agruparlas en él. */
export const MY_TASKS_AVAILABLE_COLUMNS = Object.freeze([
  Object.freeze({ key: "project", label: "Proyecto", group: "Proyecto u oferta", defaultWidth: 150, minWidth: 80 }), // v94: solo el proyecto; su código es la columna «Código» (antes salía en las dos)
  Object.freeze({ key: "code", label: "Código (YYXXX)", group: "Proyecto u oferta", defaultWidth: 84, minWidth: 64 }),
  Object.freeze({ key: "sector", label: "Sector", group: "Proyecto u oferta", defaultWidth: 92, minWidth: 64 }),
  Object.freeze({ key: "client", label: "Cliente", group: "Proyecto u oferta", defaultWidth: 120, minWidth: 70 }),
  Object.freeze({ key: "commercial", label: "Comercial", group: "Proyecto u oferta", defaultWidth: 110, minWidth: 70 }),
  Object.freeze({ key: "projectType", label: "Tipo (Proyecto / Oferta)", group: "Proyecto u oferta", defaultWidth: 120, minWidth: 80 }),
  Object.freeze({ key: "section", label: "Sección", group: "Proyecto u oferta", defaultWidth: 110, minWidth: 70 }),
  Object.freeze({ key: "workflowStage", label: "Etapa de flujo", group: "Flujo y pedidos", defaultWidth: 120, minWidth: 80 }),
  Object.freeze({ key: "supplier", label: "Proveedor", group: "Flujo y pedidos", defaultWidth: 120, minWidth: 70 }),
  Object.freeze({ key: "orderNumber", label: "Nº Pedido", group: "Flujo y pedidos", defaultWidth: 90, minWidth: 64 }),
  Object.freeze({ key: "supplierCode", label: "Cód. Proveedor", group: "Flujo y pedidos", defaultWidth: 104, minWidth: 70 }),
  Object.freeze({ key: "status", label: "Estado", group: "Tarea", defaultWidth: 92, minWidth: 70 }),
  Object.freeze({ key: "priority", label: "Prioridad", group: "Tarea", defaultWidth: 80, minWidth: 64 }),
  Object.freeze({ key: "assignee", label: "Responsables", group: "Tarea", defaultWidth: 96, minWidth: 60 }),
  Object.freeze({ key: "tags", label: "Etiquetas", group: "Tarea", defaultWidth: 160, minWidth: 90 }),
  Object.freeze({ key: "startDate", label: "Fecha inicio", group: "Fechas", defaultWidth: 90, minWidth: 70 }),
  Object.freeze({ key: "dueDate", label: "Fecha entrega / vencimiento", group: "Fechas", defaultWidth: 108, minWidth: 80 }),
]);

export const DEFAULT_MY_TASKS_COLUMNS = Object.freeze(["project", "workflowStage", "status", "priority", "dueDate"]);

const STANDARD_KEYS = MY_TASKS_AVAILABLE_COLUMNS.map((c) => c.key);
// v94 · Un campo personalizado de proyecto cuyo NOMBRE es el de una columna del catálogo (el «Comercial» o el «Sector» de las
// ofertas, el «Cliente» de un proyecto…) no es una columna más: es la misma información, y ofrecerla en dos sitios creaba dos
// columnas iguales. Esas se quedan solo en el catálogo (que ya lee ese campo en ofertas y proyectos) y desaparecen de la lista de
// «Campos de los proyectos»; si alguien ya había marcado la de campo personalizado (v93), se convierte en la del catálogo.
const FIELD_NAME_TO_CATALOG = Object.freeze({ comercial: "commercial", sector: "sector", cliente: "client", proveedor: "supplier" });
const CF_PERSONAL = "cf:";
const CF_PROJECT = "pf:";
export const MY_TASKS_MAX_CUSTOM_COLUMNS = 30;
export const MY_TASKS_CUSTOM_WIDTH = 120;

const clean = (v) => cleanSuggestionText(v);
const norm = (v) => normalizeForSearch(clean(v)).replace(/\s+/g, " ").trim();

/** Si `key` es la columna de un campo de proyecto que duplica una del catálogo (`pf:comercial`), la clave del catálogo; si no, la misma. */
function catalogKeyForDuplicate(key) {
  if (typeof key !== "string" || !key.startsWith(CF_PROJECT)) return key;
  return FIELD_NAME_TO_CATALOG[key.slice(CF_PROJECT.length)] || key;
}

/** La clave de la columna de un campo personalizado de PROYECTO: por NOMBRE normalizado. "" si no hay nombre. */
export function projectFieldColumnKey(name) {
  const n = norm(name);
  return n ? CF_PROJECT + n : "";
}

/**
 * Una lista de columnas (array, o su texto JSON) → la lista limpia: las del catálogo en el orden del catálogo y las
 * `cf:`/`pf:` bien formadas en el orden dado, sin repetir. Un array vacío es válido (la persona las quitó todas);
 * cualquier otra cosa que no sea un array → las de por defecto.
 */
export function normalizeMyTasksColumns(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  if (!Array.isArray(list)) return [...DEFAULT_MY_TASKS_COLUMNS];
  list = list.map(catalogKeyForDuplicate); // v94: `pf:comercial` → `commercial` (misma columna, no dos)
  const wanted = new Set(list.filter((k) => typeof k === "string"));
  const standard = STANDARD_KEYS.filter((k) => wanted.has(k));
  const custom = [];
  for (const k of list) {
    if (typeof k !== "string" || custom.includes(k) || custom.length >= MY_TASKS_MAX_CUSTOM_COLUMNS) continue;
    const prefix = k.startsWith(CF_PERSONAL) ? CF_PERSONAL : k.startsWith(CF_PROJECT) ? CF_PROJECT : "";
    if (!prefix || k.length <= prefix.length || k.length > 90) continue;
    custom.push(k);
  }
  return [...standard, ...custom];
}

// ---------------------------------------------------------------- persistencia por persona

const uidOf = (userId) => (typeof userId === "string" ? userId.trim() : "");
const storageOf = (storage) => storage || (typeof localStorage !== "undefined" ? localStorage : null);

/** `chusy_my_tasks_columns_<uid>` si hay usuario; la clave general si no. */
export function myTasksColumnsKey(userId) {
  const uid = uidOf(userId);
  return uid ? `${MY_TASKS_COLUMNS_KEY}_${uid}` : MY_TASKS_COLUMNS_KEY;
}

/**
 * Lo guardado en este navegador para esa persona; si no hay nada suyo, lo de la clave general (reserva). `null` si la
 * persona nunca ha elegido (la vista usa entonces las de por defecto). Un valor corrupto también da `null`.
 */
export function readSavedMyTasksColumns(userId, storage) {
  try {
    const st = storageOf(storage);
    if (!st) return null;
    let raw = uidOf(userId) ? st.getItem(myTasksColumnsKey(userId)) : null;
    if (raw == null) raw = st.getItem(MY_TASKS_COLUMNS_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeMyTasksColumns(parsed) : null;
  } catch (e) {
    return null;
  }
}

/** Las columnas elegidas por esa persona (las de por defecto si nunca eligió o localStorage falla). */
export function loadMyTasksColumns(userId, storage) {
  return readSavedMyTasksColumns(userId, storage) || [...DEFAULT_MY_TASKS_COLUMNS];
}

/** Guarda SOLO en la clave de la persona (lo de una no pisa lo de otra) y devuelve la lista normalizada; si localStorage falla, la devuelve igual. */
export function saveMyTasksColumns(columns, userId, storage) {
  const cols = normalizeMyTasksColumns(Array.isArray(columns) ? columns : []);
  try {
    const st = storageOf(storage);
    if (st) st.setItem(myTasksColumnsKey(userId), JSON.stringify(cols));
  } catch (e) { /* localStorage no disponible */ }
  return cols;
}

/** «Restablecer»: olvida la elección de esa persona (vuelven las de por defecto). */
export function resetMyTasksColumns(userId, storage) {
  try {
    const st = storageOf(storage);
    if (st) st.removeItem(myTasksColumnsKey(userId));
  } catch (e) { /* localStorage no disponible */ }
  return [...DEFAULT_MY_TASKS_COLUMNS];
}

/** Marca o desmarca una columna y devuelve la lista normalizada (no toca la original). */
export function toggleMyTasksColumn(columns, key, on) {
  const current = normalizeMyTasksColumns(columns).filter((k) => k !== key);
  if (on) current.push(key);
  return normalizeMyTasksColumns(current);
}

// ---------------------------------------------------------------- datos de la tarea que vienen de su proyecto u oferta

const STAGE_FILTER_KEYS = Object.freeze(["design", "purchase", "production"]);
export const MY_TASKS_TYPE_ALL = "todos";
export const MY_TASKS_TYPE_PROJECTS = "proyectos";
export const MY_TASKS_TYPE_OFFERS = "ofertas";

/** El valor de un campo personalizado de proyecto como texto (listas → «a, b»). */
function fieldText(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => clean(x)).filter(Boolean).join(", ");
  return typeof v === "object" ? "" : clean(v);
}

/** El valor del campo personalizado de `project` cuyo nombre normalizado es `name` (p. ej. «cliente»), de esa tarea. */
function projectFieldByName(task, project, name) {
  const def = ((project && project.customFieldDefs) || []).find((d) => d && norm(d.name) === name);
  return def && task && task.customFields ? fieldText(task.customFields[def.id]) : "";
}

/**
 * Lo que una tarea hereda de su proyecto (o de su oferta) más lo suyo, listo para columnas y filtros. `projects` son los
 * proyectos activos conocidos; la tarea puede estar en varios (el primero que se conoce es el principal).
 * Devuelve siempre un objeto con todas las claves (texto vacío si no hay dato):
 *   kind 'oferta' | 'proyecto' | 'personal' · projectId/projectName/projectColor/projectIcon · code · sector ('Industria' | 'Automoción' | '')
 *   client · commercial · typeLabel · sectionName · stage ('design' | 'purchase' | 'production' | '') · stageLabel · supplier · orderNumber · supplierCode
 */
export function myTaskContext(task, projects, { offersProjectId = null } = {}) {
  const byId = new Map((projects || []).filter(Boolean).map((p) => [p.id, p]));
  const ids = getTaskProjectIds(task || {});
  const owned = ids.map((id) => byId.get(id)).filter(Boolean);
  const project = owned[0] || null;
  const inOffers = owned.find((p) => isOffersProject(p) || p.id === offersProjectId) || null;
  const ctx = {
    kind: !ids.length ? "personal" : inOffers ? "oferta" : "proyecto",
    projectId: project ? project.id : "",
    projectName: project ? clean(project.name) : "",
    projectColor: project ? project.color || "" : "",
    projectIcon: project ? effectiveProjectIcon(project) : "",
    code: "",
    sector: "",
    client: "",
    commercial: "",
    typeLabel: "",
    sectionName: "",
    stage: "",
    stageLabel: "",
    supplier: clean(task && task.supplier),
    orderNumber: clean(task && task.orderNumber),
    supplierCode: clean(task && task.supplierCode),
  };
  if (ctx.kind === "personal") { ctx.typeLabel = "Personal"; return ctx; }
  const t = task || {};

  if (inOffers) {
    // Una OFERTA es una tarea de «Ofertas»: su ID, su Comercial y su Sector son los suyos (campos de la propia tarea).
    ctx.code = clean(t.offerCode);
    const cf = t.customFields || {};
    const comField = findOfferCommercialField(inOffers);
    ctx.commercial = comField ? fieldText(cf[comField.id]) : "";
    const secField = findOfferSectorField(inOffers);
    ctx.sector = secField ? matchSector(fieldText(cf[secField.id])) : "";
    ctx.client = projectFieldByName(t, inOffers, "cliente");
    const section = (inOffers.sections || []).find((s) => s.id === getTaskSectionForProject(t, inOffers.id));
    ctx.sectionName = section ? clean(section.name) : "";
    ctx.typeLabel = ctx.sectionName ? `Oferta · ${ctx.sectionName}` : "Oferta";
  } else {
    // `project` puede faltar (la tarea es de un proyecto que no se conoce aquí: archivado, o que esta persona no ve): sin datos heredados.
    const pj = project || {};
    const props = pj.properties || {};
    ctx.code = clean(pj.code);
    ctx.commercial = clean(props.comercial);
    const sectorKey = (owned.find((p) => projectSectorKey(p)) || null);
    ctx.sector = sectorKey ? matchSector(sectorKey.properties && sectorKey.properties.sector) : "";
    ctx.client = clean(props.cliente) || projectFieldByName(t, project, "cliente");
    const section = (pj.sections || []).find((s) => s.id === getTaskSectionForProject(t, pj.id));
    ctx.sectionName = section ? clean(section.name) : "";
    ctx.typeLabel = "Proyecto";
  }

  const wf = taskWorkflow(t, offersProjectId);
  const current = wf ? currentStageKey(wf) : null;
  if (current && !t.isComplete) { ctx.stage = current; ctx.stageLabel = STAGE_LABELS[current] || ""; }
  // Como en «Pedidos» (orders.js, orderRow): lo anotado en la etapa Compra/Pedido manda sobre la copia que lleva la tarea.
  const trace = purchaseTrace(wf);
  ctx.supplier = trace.supplier || ctx.supplier;
  ctx.orderNumber = trace.orderNumber || ctx.orderNumber;
  ctx.supplierCode = trace.supplierCode || ctx.supplierCode;
  return ctx;
}

/** Los campos personalizados de PROYECTO que existen en los proyectos activos: `[{ key: 'pf:nombre', label }]`, uno por nombre, ordenados. */
export function myTasksProjectFieldColumns(projects) {
  const labels = new Map();
  for (const p of projects || []) {
    if (!p || p.archived) continue;
    for (const def of p.customFieldDefs || []) {
      const key = projectFieldColumnKey(def && def.name);
      if (!key || catalogKeyForDuplicate(key) !== key) continue; // v94: ya es una columna del catálogo (Comercial, Sector, Cliente, Proveedor)
      if (!labels.has(key)) labels.set(key, clean(def.name));
    }
  }
  return [...labels.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));
}

/** El valor (texto) de una columna `pf:nombre` para una tarea: el del campo de SU proyecto con ese nombre. */
export function myTaskProjectFieldValue(task, projects, key) {
  const byId = new Map((projects || []).filter(Boolean).map((p) => [p.id, p]));
  for (const id of getTaskProjectIds(task || {})) {
    const p = byId.get(id);
    if (!p) continue;
    const def = (p.customFieldDefs || []).find((d) => d && projectFieldColumnKey(d.name) === key);
    if (def) return task && task.customFields ? fieldText(task.customFields[def.id]) : "";
  }
  return "";
}

const PRIORITY_RANK = { urgente: 0, alta: 1, media: 2, baja: 3 };
const SORT_FROM_CONTEXT = new Set(["code", "sector", "client", "commercial", "projectType", "section", "workflowStage"]);

/** El valor con el que se ORDENA una columna del catálogo o `pf:` (null = vacío, va al final). task-filters.js lo usa. */
export function myTaskSortValue(task, column, { projects = [], offersProjectId = null } = {}) {
  if (column.startsWith(CF_PROJECT)) {
    const v = myTaskProjectFieldValue(task, projects, column);
    if (!v) return null;
    const n = Number(v);
    return Number.isNaN(n) ? v.toLowerCase() : n;
  }
  if (column === "status") return task && task.isComplete ? 1 : 0;
  if (column === "startDate") return (task && task.startDate) || null;
  if (!SORT_FROM_CONTEXT.has(column)) return undefined; // no es una columna de esta lista: que decida quien llama (y no se calcula el contexto en vano)
  const ctx = myTaskContext(task, projects, { offersProjectId });
  const text = (v) => (v ? String(v).toLowerCase() : null);
  switch (column) {
    case "code": return text(ctx.code);
    case "sector": return text(ctx.sector);
    case "client": return text(ctx.client);
    case "commercial": return text(ctx.commercial);
    case "projectType": return text(ctx.typeLabel);
    case "section": return text(ctx.sectionName);
    case "workflowStage": return ctx.stage ? STAGE_FILTER_KEYS.indexOf(ctx.stage) : null;
    default: return undefined;
  }
}

// ---------------------------------------------------------------- filtros

export function emptyMyTasksFilters() {
  return { search: "", type: MY_TASKS_TYPE_ALL, sector: "todos", commercial: "", stage: "todas", supplier: "", tag: "" };
}

/** Cualquier valor → un estado de filtros válido (campos desconocidos fuera, textos recortados). */
export function normalizeMyTasksFilters(raw) {
  const base = emptyMyTasksFilters();
  const f = raw && typeof raw === "object" ? raw : {};
  const sector = normalizeSectorKey(f.sector);
  return {
    search: typeof f.search === "string" ? f.search : "",
    type: typeof f.type === "string" && f.type ? f.type : base.type,
    sector: sector === "industria" || sector === "automocion" ? sector : "todos",
    commercial: clean(f.commercial),
    stage: STAGE_FILTER_KEYS.includes(f.stage) ? f.stage : "todas",
    supplier: clean(f.supplier),
    tag: clean(f.tag),
  };
}

export function hasActiveMyTasksFilters(filters) {
  const f = normalizeMyTasksFilters(filters);
  const b = emptyMyTasksFilters();
  return Object.keys(b).some((k) => (k === "search" ? clean(f.search) !== "" : f[k] !== b[k]));
}

/** Compara textos sin mayúsculas, tildes ni espacios sobrantes. */
const same = (a, b) => norm(a) === norm(b);

/**
 * Las tareas que pasan los filtros de «Mis tareas» (todo se combina con «y»; no toca el array original).
 *   filters: { search, type ('todos' | 'proyectos' | 'ofertas' | 'p:<idProyecto>'), sector ('todos' | 'industria' | 'automocion'),
 *              commercial, stage ('todas' | 'design' | 'purchase' | 'production'), supplier, tag }
 *   ctx:     { projects, offersProjectId }
 * La búsqueda mira título, descripción, código YYXXX (también sin guion: «26-001» = «26001»), proyecto, cliente, comercial,
 * proveedor, nº de pedido, código de proveedor y etiquetas.
 */
export function filterMyTasksItems(tasks, filters, { projects = [], offersProjectId = null } = {}) {
  const f = normalizeMyTasksFilters(filters);
  const q = norm(f.search);
  const words = q ? q.split(" ").filter(Boolean) : [];
  const squash = (v) => v.replace(/[\s\-_./\\]+/g, "");
  const list = Array.isArray(tasks) ? tasks : [];
  if (!hasActiveMyTasksFilters(f)) return list.slice();
  return list.filter((task) => {
    const ctx = myTaskContext(task, projects, { offersProjectId });
    if (f.type === MY_TASKS_TYPE_PROJECTS && ctx.kind !== "proyecto") return false;
    if (f.type === MY_TASKS_TYPE_OFFERS && ctx.kind !== "oferta") return false;
    if (f.type.startsWith("p:") && !getTaskProjectIds(task).includes(f.type.slice(2))) return false;
    if (f.sector !== "todos" && normalizeSectorKey(ctx.sector) !== f.sector) return false;
    if (f.commercial && !same(ctx.commercial, f.commercial)) return false;
    if (f.stage !== "todas" && ctx.stage !== f.stage) return false;
    if (f.supplier && !same(ctx.supplier, f.supplier)) return false;
    if (f.tag && !(task.tags || []).some((t) => same(t, f.tag))) return false;
    if (q) {
      const parts = [
        plainTitleText(task.title || ""), stripHtmlToText(task.description || ""), ctx.code, ctx.projectName, ctx.client,
        ctx.commercial, ctx.supplier, ctx.orderNumber, ctx.supplierCode, ...(task.tags || []),
      ];
      const hay = norm(parts.join(" "));
      const compact = squash(norm([ctx.code, ctx.orderNumber, ctx.supplierCode].join(" ")));
      // Cada palabra tiene que aparecer (en cualquier orden y sitio); un código también vale sin guiones («26-001» = «26001»).
      if (!words.every((w) => hay.includes(w) || (squash(w) && compact.includes(squash(w))))) return false;
    }
    return true;
  });
}

/**
 * Las opciones de los desplegables de filtro: SOLO lo que hay en las tareas de la persona (no en toda la empresa).
 *   { commercials: string[], suppliers: string[], tags: string[], projects: [{ id, name, code, color }] }
 */
export function myTasksFilterOptions(tasks, { projects = [], offersProjectId = null } = {}) {
  const commercials = new Map();
  const suppliers = new Map();
  const tags = new Map();
  const projectIds = new Map();
  const add = (map, value) => { const t = clean(value); if (t && !map.has(norm(t))) map.set(norm(t), t); };
  const byId = new Map((projects || []).filter(Boolean).map((p) => [p.id, p]));
  for (const task of tasks || []) {
    const ctx = myTaskContext(task, projects, { offersProjectId });
    add(commercials, ctx.commercial);
    add(suppliers, ctx.supplier);
    (task.tags || []).forEach((t) => add(tags, t));
    getTaskProjectIds(task).forEach((id) => { if (byId.has(id)) projectIds.set(id, byId.get(id)); });
  }
  const sorted = (map) => [...map.values()].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  return {
    commercials: sorted(commercials),
    suppliers: sorted(suppliers),
    tags: sorted(tags),
    projects: [...projectIds.values()]
      .map((p) => ({ id: p.id, name: clean(p.name), code: clean(p.code), color: p.color || "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
  };
}

export { STAGE_KEYS as MY_TASKS_STAGE_KEYS, STAGE_LABELS as MY_TASKS_STAGE_LABELS, PRIORITY_RANK as MY_TASKS_PRIORITY_RANK };
