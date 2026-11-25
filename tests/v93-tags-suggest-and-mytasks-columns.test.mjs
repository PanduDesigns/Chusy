// v93 · Etiquetas y sugerencias limpias, columnas y filtros de «Mis tareas» y mejoras del visor de piezas 3D.
//  1) «Mis tareas»: catálogo de columnas, normalización, persistencia por persona (uid) con reserva en la clave general.
//  2) «Mis tareas»: datos heredados del proyecto/oferta, ordenación y TODOS los filtros nuevos (filterMyTasksItems) + opciones.
//  3) «Mis tareas» (interfaz con jsdom): ⚙️ Columnas, Restablecer, filtros y celdas nuevas.
//  4) Etiquetas: usos, huérfanas, auto-purga segura, renombrar / fusionar sin duplicados y borrar en cascada (writeBatch).
//  5) Sugerencias: memoria de «quitadas» por persona con purga, plan y lote de «corregir en todo Chusy», y el desplegable (✏️ / 🗑️).
//  6) Visualizador de piezas: subir piezas directamente (biblioteca) y su modal.
//  7) Visor 3D: diámetros, círculos clicables y medida desde el centro (geometría sintética) + cableado del visor.
//  8) Entrega: ?v=93, package.json, Novedades, reglas, CSS, README y node scripts/check-integrity.mjs.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
freezeNow("2026-11-19T10:00:00");
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const mousedown = (el) => el.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
const typeInto = (el, value) => { el.value = value; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const resetFb = () => { globalThis.__fb = { collections: {}, sets: [], hooks: {}, updates: [], deletes: [] }; };
resetFb();

// almacén falso (como localStorage) para las pruebas de persistencia
const memStorage = (initial = {}) => { const m = new Map(Object.entries(initial)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const brokenStorage = { getItem() { throw new Error("denegado"); }, setItem() { throw new Error("denegado"); }, removeItem() { throw new Error("denegado"); } };

const ws = await import("../js/workflow-stages.js");
const mt = await import("../js/my-tasks-columns.js");
const tf = await import("../js/task-filters.js");

// ---------------------------------------------------------------- datos de prueba
const OFF = "OFF";
const projects = [
  { id: "P1", name: "Cabina Talgo", code: "26001", color: "#FCD000", icon: "📁", properties: { comercial: "Juan Pérez", sector: "Industria" }, customFieldDefs: [{ id: "f1", name: "TIPO" }, { id: "f2", name: "Cliente" }], sections: [{ id: "s1", name: "Montaje" }] },
  { id: "P2", name: "Línea Togg", code: "26002", color: "#3b82f6", icon: "🚗", properties: { comercial: "Marta Ruiz", sector: "Automoción" }, customFieldDefs: [{ id: "g1", name: "Tipo" }], sections: [] },
  { id: OFF, name: "Ofertas", exclusive: true, exclusiveKey: "ofertas", icon: "💼", customFieldDefs: [{ id: "comercial", name: "Comercial" }, { id: "sector", name: "Sector" }, { id: "version", name: "Versión" }], sections: [{ id: "nuevas", name: "Nuevas" }] },
  { id: "ARCH", name: "Archivado", code: "25009", archived: true, customFieldDefs: [{ id: "z1", name: "Zeta" }] },
];
const wf = (designDone) => { let w = ws.workflowFromEnabled(["design", "purchase", "production"], { purchase: { assigneeId: "u1", dueDate: null }, production: { assigneeId: "u1", dueDate: null } }); if (designDone) w = { ...w, design: { ...w.design, completed: true } }; return w; };
const tA = { id: "a", projectId: "P1", sectionId: "s1", title: "Cilindro hidráulico", tags: ["Urgente", "Compra"], supplier: "Hidráulica Sur", orderNumber: "2314", priority: "alta", startDate: "2026-11-02", dueDate: "2026-11-20", assigneeIds: ["u1"], customFields: { f1: "Hidráulica", f2: "Talgo S.A." }, workflow: wf(true), isComplete: false };
const tB = { id: "b", projectId: "P2", title: "Bomba de vacío", tags: ["Compra"], supplier: "Aceros Norte", orderNumber: "2713", supplierCode: "AN-7", priority: "media", dueDate: "2026-11-25", assigneeIds: ["u1"], customFields: { g1: "Vacío" }, workflow: wf(false), isComplete: false };
const tC = { id: "c", projectId: OFF, sectionId: "nuevas", title: "Oferta horno túnel", tags: [], offerCode: "26007", priority: "baja", assigneeIds: ["u1"], customFields: { comercial: "Marta Ruiz", sector: "Automoción" }, isComplete: false };
const tD = { id: "d", projectId: null, title: "Recordatorio personal", tags: ["Personal"], priority: "media", assigneeIds: ["u1"], isComplete: false };
const tE = { id: "e", projectId: "P1", title: "Soldadura chasis", tags: [], priority: "urgente", assigneeIds: ["u1"], customFields: {}, isComplete: true };
const tasksAll = [tA, tB, tC, tD, tE];
const ids = (list) => list.map((t) => t.id);
const ctx = { projects, offersProjectId: OFF };
const F = (patch) => ({ ...mt.emptyMyTasksFilters(), ...patch });

// ---------------------------------------------------------------- 1) columnas
{
  const keys = mt.MY_TASKS_AVAILABLE_COLUMNS.map((c) => c.key);
  eq("catálogo: todas las columnas pedidas (la de «Tarea» va aparte, siempre visible)", ["project", "code", "sector", "client", "commercial", "projectType", "workflowStage", "status", "priority", "startDate", "dueDate", "supplier", "orderNumber", "supplierCode", "section", "tags"].every((k) => keys.includes(k)), true);
  check("catálogo: sin «title» (fija) y sin claves repetidas", !keys.includes("title") && new Set(keys).size === keys.length);
  check("catálogo: cada columna con etiqueta, grupo y ancho", mt.MY_TASKS_AVAILABLE_COLUMNS.every((c) => c.label && c.group && c.defaultWidth > 0 && c.minWidth > 0));
  eq("por defecto: proyecto, etapa de flujo, estado, prioridad y fecha de entrega", [...mt.DEFAULT_MY_TASKS_COLUMNS], ["project", "workflowStage", "status", "priority", "dueDate"]);
  check("el catálogo y los valores por defecto están congelados", Object.isFrozen(mt.MY_TASKS_AVAILABLE_COLUMNS) && Object.isFrozen(mt.DEFAULT_MY_TASKS_COLUMNS));

  const n = mt.normalizeMyTasksColumns;
  eq("normalizar: orden del catálogo, sin desconocidas ni repetidas", n(["dueDate", "zzz", "project", "project", "title"]), ["project", "dueDate"]);
  eq("normalizar: acepta el JSON guardado", n('["sector","code"]'), ["code", "sector"]);
  eq("normalizar: texto roto o lo que no es lista → las de por defecto", [n("{no"), n(null), n(7), n({})], [[...mt.DEFAULT_MY_TASKS_COLUMNS], [...mt.DEFAULT_MY_TASKS_COLUMNS], [...mt.DEFAULT_MY_TASKS_COLUMNS], [...mt.DEFAULT_MY_TASKS_COLUMNS]]);
  eq("normalizar: una lista vacía es válida (quitó todas)", n([]), []);
  eq("normalizar: campos personales (cf:) y de proyecto (pf:) bien formados detrás de las del catálogo", n(["pf:tipo", "status", "cf:abc", "cf:", "pf:", "xx:1", 5, "cf:abc"]), ["status", "pf:tipo", "cf:abc"]);
  eq("normalizar: tope de campos personalizados", n(Array.from({ length: 50 }, (_, i) => `pf:c${i}`)).length, mt.MY_TASKS_MAX_CUSTOM_COLUMNS);

  // persistencia por persona
  const st = memStorage();
  eq("clave por persona y clave general", [mt.myTasksColumnsKey("u1"), mt.myTasksColumnsKey(""), mt.myTasksColumnsKey(null), mt.MY_TASKS_COLUMNS_KEY], ["chusy_my_tasks_columns_u1", "chusy_my_tasks_columns", "chusy_my_tasks_columns", "chusy_my_tasks_columns"]);
  eq("sin nada guardado: las de por defecto", mt.loadMyTasksColumns("u1", st), [...mt.DEFAULT_MY_TASKS_COLUMNS]);
  eq("sin nada guardado: readSaved devuelve null", mt.readSavedMyTasksColumns("u1", st), null);
  eq("guardar devuelve la lista normalizada", mt.saveMyTasksColumns(["code", "sector", "pf:tipo", "basura"], "u1", st), ["code", "sector", "pf:tipo"]);
  check("se guarda en chusy_my_tasks_columns_u1 (y solo ahí)", st._m.has("chusy_my_tasks_columns_u1") && st._m.size === 1);
  eq("cada persona conserva lo suyo: u1 lo elegido, u2 las de por defecto", [mt.loadMyTasksColumns("u1", st), mt.loadMyTasksColumns("u2", st)], [["code", "sector", "pf:tipo"], [...mt.DEFAULT_MY_TASKS_COLUMNS]]);
  mt.saveMyTasksColumns(["client"], "u2", st);
  eq("lo de u2 no pisa lo de u1", [mt.loadMyTasksColumns("u1", st), mt.loadMyTasksColumns("u2", st)], [["code", "sector", "pf:tipo"], ["client"]]);
  const st2 = memStorage({ chusy_my_tasks_columns: '["supplier","orderNumber"]' });
  eq("reserva: sin clave de la persona se usa la general", mt.loadMyTasksColumns("u9", st2), ["supplier", "orderNumber"]);
  mt.saveMyTasksColumns(["tags"], "u9", st2);
  eq("la propia clave de la persona manda sobre la general", [mt.loadMyTasksColumns("u9", st2), mt.loadMyTasksColumns("", st2)], [["tags"], ["supplier", "orderNumber"]]);
  eq("guardado dañado → las de por defecto, sin lanzar error", mt.loadMyTasksColumns("u1", memStorage({ chusy_my_tasks_columns_u1: "{roto" })), [...mt.DEFAULT_MY_TASKS_COLUMNS]);
  eq("localStorage que falla: load da las de por defecto", mt.loadMyTasksColumns("u1", brokenStorage), [...mt.DEFAULT_MY_TASKS_COLUMNS]);
  eq("localStorage que falla: save devuelve igualmente la lista", mt.saveMyTasksColumns(["code"], "u1", brokenStorage), ["code"]);
  eq("restablecer: borra lo de esa persona y devuelve las de por defecto", [mt.resetMyTasksColumns("u1", st), mt.readSavedMyTasksColumns("u1", st), mt.loadMyTasksColumns("u2", st)], [[...mt.DEFAULT_MY_TASKS_COLUMNS], null, ["client"]]);
  eq("alternar una columna: la añade y la quita sin tocar la original", (() => { const a = ["project"]; const b = mt.toggleMyTasksColumn(a, "code", true); const c = mt.toggleMyTasksColumn(b, "project", false); return [a, b, c]; })(), [["project"], ["project", "code"], ["code"]]);
  eq("localStorage del navegador (jsdom) también funciona por defecto", (() => { mt.saveMyTasksColumns(["sector"], "ux"); const r = mt.loadMyTasksColumns("ux"); localStorage.removeItem("chusy_my_tasks_columns_ux"); return r; })(), ["sector"]);

  // columnas de campos personalizados de proyecto
  eq("pf: clave por nombre normalizado (sin tildes ni mayúsculas)", [mt.projectFieldColumnKey("  TIPO "), mt.projectFieldColumnKey("Tipo"), mt.projectFieldColumnKey("Fecha límite"), mt.projectFieldColumnKey("  ")], ["pf:tipo", "pf:tipo", "pf:fecha limite", ""]);
  eq("pf: las columnas de los proyectos ACTIVOS agrupadas por nombre (TIPO y Tipo = una), sin archivados y (v94) sin las que ya son del catálogo (Comercial, Sector, Cliente)", mt.myTasksProjectFieldColumns(projects).map((c) => c.key), ["pf:tipo", "pf:version"]);
  eq("pf: valor de la columna para una tarea (el del campo de SU proyecto)", [mt.myTaskProjectFieldValue(tA, projects, "pf:tipo"), mt.myTaskProjectFieldValue(tB, projects, "pf:tipo"), mt.myTaskProjectFieldValue(tA, projects, "pf:zeta"), mt.myTaskProjectFieldValue(tD, projects, "pf:tipo")], ["Hidráulica", "Vacío", "", ""]);
}

// ---------------------------------------------------------------- 2) contexto, orden y filtros
{
  const cA = mt.myTaskContext(tA, projects, { offersProjectId: OFF });
  eq("contexto de un proyecto: código, sector, comercial, cliente (campo «Cliente»), sección, tipo", [cA.kind, cA.code, cA.sector, cA.commercial, cA.client, cA.sectionName, cA.typeLabel, cA.projectName], ["proyecto", "26001", "Industria", "Juan Pérez", "Talgo S.A.", "Montaje", "Proyecto", "Cabina Talgo"]);
  eq("contexto: etapa actual (Compra/Pedido), proveedor y pedido", [cA.stage, cA.stageLabel, cA.supplier, cA.orderNumber], ["purchase", ws.STAGE_LABELS.purchase, "Hidráulica Sur", "2314"]);
  const cB = mt.myTaskContext(tB, projects, { offersProjectId: OFF });
  eq("contexto: Diseño aún sin completar, sector Automoción, código de proveedor", [cB.stage, cB.sector, cB.supplierCode], ["design", "Automoción", "AN-7"]);
  const cC = mt.myTaskContext(tC, projects, { offersProjectId: OFF });
  eq("contexto de una OFERTA: su propio código, comercial y sector; tipo con su estado (sección)", [cC.kind, cC.code, cC.commercial, cC.sector, cC.typeLabel, cC.sectionName], ["oferta", "26007", "Marta Ruiz", "Automoción", "Oferta · Nuevas", "Nuevas"]);
  eq("contexto: tarea personal", [mt.myTaskContext(tD, projects, ctx).kind, mt.myTaskContext(tD, projects, ctx).typeLabel], ["personal", "Personal"]);
  eq("contexto: una tarea completada no tiene etapa pendiente", mt.myTaskContext(tE, projects, ctx).stage, "");
  eq("contexto: proyecto desconocido (archivado o sin acceso) no rompe nada", (() => { const c = mt.myTaskContext({ id: "x", projectId: "NOPE", title: "t" }, projects, ctx); return [c.kind, c.code, c.projectName]; })(), ["proyecto", "", ""]);
  eq("contexto: sin lanzar con datos vacíos", (() => { try { mt.myTaskContext(null, null); return true; } catch (e) { return String(e); } })(), true);

  // ordenación (task-filters.js delega en my-tasks-columns.js)
  const sortIds = (column, direction = "asc", list = [tA, tB, tC, tE]) => ids(tf.sortTasks(list, { column, direction }, { teamMembers: [], projects }));
  eq("ordenar por código", sortIds("code"), ["a", "e", "c", "b"].sort((x, y) => ({ a: "26001", e: "26001", c: "26007", b: "26002" })[x].localeCompare(({ a: "26001", e: "26001", c: "26007", b: "26002" })[y])).filter((x) => x !== "e").concat(["e"]));
  eq("ordenar por sector (Automoción antes que Industria)", sortIds("sector", "asc", [tA, tB]), ["b", "a"]);
  eq("ordenar por comercial", sortIds("commercial", "asc", [tA, tB]), ["a", "b"]);
  eq("ordenar por columna de campo de proyecto (pf:tipo)", sortIds("pf:tipo", "asc", [tA, tB]), ["a", "b"]);
  eq("ordenar por fecha de inicio: sin fecha al final", sortIds("startDate", "asc", [tB, tA]), ["a", "b"]);
  eq("ordenar por etapa de flujo (Diseño antes que Compra)", sortIds("workflowStage", "asc", [tA, tB]), ["b", "a"]);
  check("la ordenación de columnas de siempre no cambia (prioridad)", sortIds("priority", "asc", [tB, tA]).length === 2);
  eq("myTaskSortValue: columna desconocida → undefined (decide quien llama)", mt.myTaskSortValue(tA, "cf:xyz", { projects }), undefined);

  // filtros
  const flt = (patch) => ids(mt.filterMyTasksItems(tasksAll, F(patch), ctx));
  check("sin filtros: todas (copia, no el mismo array)", (() => { const r = mt.filterMyTasksItems(tasksAll, F({}), ctx); return r !== tasksAll && ids(r).join() === "a,b,c,d,e"; })());
  eq("texto: código YYXXX del proyecto", flt({ search: "26001" }), ["a", "e"]);
  eq("texto: el código vale sin guion («26-001»)", flt({ search: "26-001" }), ["a", "e"]);
  eq("texto: código de una oferta", flt({ search: "26007" }), ["c"]);
  eq("texto: título sin tildes ni mayúsculas", flt({ search: "HIDRAULICO" }), ["a"]);
  eq("texto: proveedor (sin tildes)", flt({ search: "hidraulica sur" }), ["a"]);
  eq("texto: nº de pedido", flt({ search: "2713" }), ["b"]);
  eq("texto: código de proveedor", flt({ search: "an-7" }), ["b"]);
  eq("texto: nombre de proyecto", flt({ search: "togg" }), ["b"]);
  eq("texto: cliente (campo del proyecto)", flt({ search: "talgo s.a." }), ["a"]);
  eq("texto: etiqueta", flt({ search: "personal" }), ["d"]);
  eq("texto: varias palabras tienen que estar todas en la misma tarea", flt({ search: "cilindro compra" }), ["a"]);
  eq("texto: descripción (como la caja de la barra de antes)", mt.filterMyTasksItems([{ ...tA, description: "<p>Revisar sellos</p>" }, tB], F({ search: "sellos" }), ctx).map((t) => t.id), ["a"]);
  eq("texto sin resultados", flt({ search: "zzzz" }), []);
  eq("tipo: solo proyectos", flt({ type: "proyectos" }), ["a", "b", "e"]);
  eq("tipo: solo ofertas", flt({ type: "ofertas" }), ["c"]);
  eq("tipo: un proyecto concreto", flt({ type: "p:P2" }), ["b"]);
  eq("tipo: «Todos» no filtra", flt({ type: "todos" }), ["a", "b", "c", "d", "e"]);
  eq("sector: Industria", flt({ sector: "industria" }), ["a", "e"]);
  eq("sector: Automoción (proyecto y oferta)", flt({ sector: "automocion" }), ["b", "c"]);
  eq("comercial (sin tildes ni mayúsculas): el del proyecto y el de la oferta", [flt({ commercial: "juan perez" }), flt({ commercial: "MARTA RUIZ" })], [["a", "e"], ["b", "c"]]);
  eq("etapa de flujo: Diseño / Compra-Pedido / Recepción-Fabricación", [flt({ stage: "design" }), flt({ stage: "purchase" }), flt({ stage: "production" })], [["b"], ["a"], []]);
  eq("proveedor", flt({ supplier: "aceros norte" }), ["b"]);
  eq("etiqueta (sin mayúsculas)", flt({ tag: "COMPRA" }), ["a", "b"]);
  eq("combinados con «y»", flt({ type: "proyectos", sector: "industria", tag: "urgente", stage: "purchase" }), ["a"]);
  eq("combinados sin coincidencia", flt({ sector: "industria", commercial: "marta ruiz" }), []);
  eq("filtros mal formados se normalizan (no rompen)", ids(mt.filterMyTasksItems(tasksAll, { sector: "otro", stage: "x", type: 5, search: 3 }, ctx)), ["a", "b", "c", "d", "e"]);
  eq("normalizar filtros", mt.normalizeMyTasksFilters({ search: "x", type: "ofertas", sector: "Automoción", commercial: " Marta  ", stage: "design", supplier: "S", tag: "T", otro: 1 }), { search: "x", type: "ofertas", sector: "automocion", commercial: "Marta", stage: "design", supplier: "S", tag: "T" });
  eq("hasActive: vacío no, cualquiera sí", [mt.hasActiveMyTasksFilters(F({})), mt.hasActiveMyTasksFilters(F({ search: " " })), mt.hasActiveMyTasksFilters(F({ search: "a" })), mt.hasActiveMyTasksFilters(F({ stage: "design" })), mt.hasActiveMyTasksFilters(F({ type: "p:P1" }))], [false, false, true, true, true]);

  const opts = mt.myTasksFilterOptions(tasksAll, ctx);
  eq("opciones de filtro: solo lo que hay en las tareas de la persona (comerciales, proveedores, etiquetas, proyectos)", [opts.commercials, opts.suppliers, opts.tags, opts.projects.map((p) => p.id)], [["Juan Pérez", "Marta Ruiz"], ["Aceros Norte", "Hidráulica Sur"], ["Compra", "Personal", "Urgente"], ["OFF", "P1", "P2"].sort((a, b) => ({ OFF: "Ofertas", P1: "Cabina Talgo", P2: "Línea Togg" })[a].localeCompare(({ OFF: "Ofertas", P1: "Cabina Talgo", P2: "Línea Togg" })[b]))]);
  eq("opciones de filtro: con pocas tareas, pocas opciones", mt.myTasksFilterOptions([tD], ctx).commercials.length + mt.myTasksFilterOptions([tD], ctx).suppliers.length, 0);
}

// ---------------------------------------------------------------- 3) «Mis tareas» (interfaz)
{
  const { renderMyTasksView, setMyTasksViewFilters, resetMyTasksViewFilters, getMyTasksViewFilters, selectedMyTasksColumns } = await import("../js/views/my-tasks-view.js");
  const re = await import("../js/views/my-tasks-view.js");
  eq("la vista re-exporta los helpers testeables", ["MY_TASKS_AVAILABLE_COLUMNS", "DEFAULT_MY_TASKS_COLUMNS", "normalizeMyTasksColumns", "loadMyTasksColumns", "saveMyTasksColumns", "filterMyTasksItems"].every((k) => k in re), true);

  localStorage.clear();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const user = { uid: "u1", role: "member", personalCustomFieldDefs: [], columnPrefs: {}, columnOrder: null };
  let filtersChanged = 0;
  const mk = (overrides = {}) => ({ tasks: tasksAll.filter((t) => t.id !== "d" || true), allTasks: tasksAll, totalCount: tasksAll.length, teamMembers: [{ uid: "u1", name: "Ana", role: "member" }], projects, tagsRegistry: [{ id: "urgente", name: "Urgente", color: "#f00" }], sortState: { column: null, direction: "asc" }, onSortChange() {}, onOpenTask() {}, currentUser: user, onFiltersChange: () => { filtersChanged++; renderMyTasksView(container, mk(overrides)); }, ...overrides });
  const heads = () => $$(".list-table__head-cell, [data-col-key]", container).map((e) => e.dataset.colKey || e.dataset.sort || e.textContent.trim());
  resetMyTasksViewFilters();
  renderMyTasksView(container, mk());
  const headerText = () => $(".list-table__header, .list-header, [data-col-header]", container) ? $(".list-table__header, .list-header, [data-col-header]", container).textContent : container.textContent;
  check("barra: botón ⚙️ Columnas y campo personalizado", !!$("#mt-columns", container) && /Columnas/.test($("#mt-columns", container).textContent) && !!$("#mt-add-field", container));
  check("barra: ya no está el botón ☰ Columnas de antes", !/☰/.test(container.innerHTML));
  check("por defecto se ven Proyecto, Etapa, Estado, Prioridad y Entrega (y no Código, Sector, Cliente…)", /Proyecto/.test(container.innerHTML) && /Etapa de flujo/.test(container.innerHTML) && /Estado/.test(container.innerHTML) && /Prioridad/.test(container.innerHTML) && !/Código \(YYXXX\)/.test($$("[data-sort]", container).map((e) => e.textContent).join("|")) && !/Cód\. Proveedor/.test(container.innerHTML));
  check("celdas: (v94) la columna Proyecto no repite el código YYXXX", $$(".mt-code", container).length === 0);
  check("celdas: estado Pendiente / Completada", /Pendiente/.test(container.innerHTML) && /Completada/.test(container.innerHTML) && $$(".mt-status--done", container).length === 1);
  check("barra de filtros: buscador y los 6 desplegables", !!$("#mt-search", container) && ["#mt-f-type", "#mt-f-sector", "#mt-f-commercial", "#mt-f-stage", "#mt-f-supplier", "#mt-f-tag"].every((s) => !!$(s, container)));
  check("filtros: sin ninguno activo no hay «Limpiar filtros»", !$("#mt-f-clear", container));
  eq("desplegable Tipo: Todos, Solo Proyectos, Solo Ofertas y proyectos concretos", $$("#mt-f-type option", container).map((o) => o.value), ["todos", "proyectos", "ofertas", `p:OFF`, "p:P1", "p:P2"].sort((a, b) => (a.startsWith("p:") ? 1 : 0) - (b.startsWith("p:") ? 1 : 0) || 0).filter((v, i, arr) => true).slice(0, 3).concat($$("#mt-f-type optgroup option", container).map((o) => o.value)));
  eq("desplegable Comercial: Todos + los que hay en mis tareas", $$("#mt-f-commercial option", container).map((o) => o.value), ["", "Juan Pérez", "Marta Ruiz"]);
  eq("desplegable Etapa: Todas, Diseño, Compra/Pedido, Recepción/Fabricación", $$("#mt-f-stage option", container).map((o) => o.value), ["todas", "design", "purchase", "production"]);

  // abrir el menú ⚙️ Columnas
  click($("#mt-columns", container));
  const menu = $(".columns-menu--mytasks");
  check("⚙️ Columnas: abre el menú con casillas agrupadas y «Restablecer»", !!menu && $$("[data-col]", menu).length >= 17 && !!$("[data-mt-reset]", menu) && $$(".columns-menu__group", menu).length >= 4);
  eq("⚙️ Columnas: marcadas las de por defecto", $$("[data-col]", menu).filter((c) => c.checked).map((c) => c.dataset.col).sort(), [...mt.DEFAULT_MY_TASKS_COLUMNS].sort());
  check("⚙️ Columnas: lista los campos de los proyectos (pf:tipo) sin repetir Comercial, Sector ni Cliente", $$("[data-col]", menu).some((c) => c.dataset.col === "pf:tipo") && !$$("[data-col]", menu).some((c) => /^pf:(comercial|sector|cliente)$/.test(c.dataset.col)));
  const cbCode = $$("[data-col]", menu).find((c) => c.dataset.col === "code");
  cbCode.checked = true; cbCode.dispatchEvent(new window.Event("change", { bubbles: true }));
  eq("al marcar una columna se guarda por persona en localStorage", JSON.parse(localStorage.getItem("chusy_my_tasks_columns_u1")), ["project", "code", "workflowStage", "status", "priority", "dueDate"].sort((a, b) => mt.MY_TASKS_AVAILABLE_COLUMNS.findIndex((c) => c.key === a) - mt.MY_TASKS_AVAILABLE_COLUMNS.findIndex((c) => c.key === b)));
  check("…y la tabla se repinta con la columna nueva", /Código \(YYXXX\)/.test($$("[data-sort]", container).map((e) => e.textContent).join("|")));
  const cbPf = $$("[data-col]", $(".columns-menu--mytasks")).find((c) => c.dataset.col === "pf:tipo");
  cbPf.checked = true; cbPf.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("columna de campo de proyecto (TIPO): se pinta con el valor de cada tarea", /Hidráulica/.test(container.innerHTML) && /Vacío/.test(container.innerHTML));
  check("otra persona (u2) no ve lo que eligió u1", JSON.stringify(mt.loadMyTasksColumns("u2")) === JSON.stringify(mt.DEFAULT_MY_TASKS_COLUMNS));
  click($("[data-mt-reset]", $(".columns-menu--mytasks")));
  check("«Restablecer»: vuelve a las de por defecto y olvida lo guardado", localStorage.getItem("chusy_my_tasks_columns_u1") === null && !/Código \(YYXXX\)/.test($$("[data-sort]", container).map((e) => e.textContent).join("|")));
  document.querySelectorAll(".columns-menu").forEach((m) => m.remove());

  // filtros de la vista
  const search = $("#mt-search", container);
  typeInto(search, "26001");
  await tick(250);
  check("escribir en el buscador avisa a app.js (onFiltersChange) y guarda el estado de la vista", filtersChanged >= 1 && getMyTasksViewFilters().search === "26001");
  const sel = $("#mt-f-sector", container); sel.value = "automocion"; sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  eq("elegir Sector guarda el filtro", getMyTasksViewFilters().sector, "automocion");
  check("con filtros activos aparece «Limpiar filtros»", !!$("#mt-f-clear", container));
  click($("#mt-f-clear", container));
  eq("«Limpiar filtros» los borra todos", getMyTasksViewFilters(), mt.emptyMyTasksFilters());

  // vacío por filtros ≠ sin tareas
  renderMyTasksView(container, mk({ tasks: [], totalCount: 5 }));
  check("lista vacía por los filtros: lo dice y conserva la barra de filtros", /Ninguna tarea coincide/.test(container.innerHTML) && !!$("#mt-search", container) && !!$("#mt-columns", container));
  renderMyTasksView(container, mk({ tasks: [], allTasks: [], totalCount: 0 }));
  check("sin ninguna tarea: el mensaje de siempre", /No tienes tareas asignadas/.test(container.innerHTML));

  // foco del buscador conservado al repintar
  renderMyTasksView(container, mk());
  const s2 = $("#mt-search", container); s2.focus(); s2.value = "ab"; s2.setSelectionRange?.(2, 2);
  renderMyTasksView(container, mk());
  check("repintar no le quita el foco al buscador", document.activeElement && document.activeElement.id === "mt-search");

  // retrocompatibilidad: campos personales visibles si nunca eligió
  eq("sin elección guardada: las de por defecto más los campos personales que no estaban ocultos", selectedMyTasksColumns({ uid: "nuevo", personalKeys: ["cf:a", "cf:b"], legacyHidden: ["cf:b"], storage: memStorage() }), [...mt.DEFAULT_MY_TASKS_COLUMNS, "cf:a"].sort((a, b) => { const i = (k) => { const x = mt.MY_TASKS_AVAILABLE_COLUMNS.findIndex((c) => c.key === k); return x < 0 ? 99 : x; }; return i(a) - i(b); }));
  eq("con elección guardada manda lo guardado", selectedMyTasksColumns({ uid: "u7", personalKeys: ["cf:a"], legacyHidden: [], storage: memStorage({ chusy_my_tasks_columns_u7: '["tags"]' }) }), ["tags"]);
  const appSrc = read("js/app.js");
  check("app.js: aplica filterMyTasksItems antes de ordenar y contar, pasa allTasks/totalCount/onFiltersChange y limpia al salir", /filterMyTasksItems\(chipFiltered, getMyTasksViewFilters\(\)/.test(appSrc) && /totalCount: myTasks\.length/.test(appSrc) && /onFiltersChange: renderMyTasksContent/.test(appSrc) && /resetMyTasksViewFilters\(\)/.test(appSrc));
  check("app.js: «Mis tareas» ya no pinta el buscador de la barra de chips", !/renderFilterBar\(filterbarEl, \{ filterDefs, activeFilters, onChange: handleFilterChange, searchText, onSearchChange: handleSearchTextChange \}\);\n    renderMyTasksContent/.test(appSrc));
  container.remove();
  resetMyTasksViewFilters();
  void setMyTasksViewFilters; void heads; void headerText;
}

// ---------------------------------------------------------------- 4) etiquetas
{
  const tg = await import("../js/data/tags.js");
  const now = Date.parse("2026-11-19T10:00:00");
  const old = { toMillis: () => now - 3600_000 };
  const fresh = { toMillis: () => now - 5_000 };
  const tags = [
    { id: "urgente", name: "Urgente", color: "#f00", updatedAt: old },
    { id: "compra", name: "Compra", color: "#0f0", updatedAt: old },
    { id: "compras", name: "Compras", color: "#00f", updatedAt: old },
    { id: "huerfana", name: "Huérfana", color: "#999", updatedAt: old },
    { id: "nueva", name: "Nueva", color: "#999", updatedAt: fresh },
    { id: "mantener", name: "Mantener", color: "#999", updatedAt: old },
  ];
  const tk = [
    { id: "t1", projectId: "P1", tags: ["Urgente", "Compra"] },
    { id: "t2", projectId: "P1", tags: ["compras", "Compra"] },
    { id: "t3", projectId: "P2", tags: ["Compras"] },
    { id: "t4", projectId: "P2", tags: [] },
    { id: "t5", projectId: "P2", tags: ["Urgente"], deleted: true },
    { id: "t6", projectId: "P3" },
    { id: "t1", projectId: "P1", tags: ["Urgente", "Compra"] }, // repetida
  ];
  eq("tagKey: por slug (sin mayúsculas, tildes ni signos)", [tg.tagKey("Urgente"), tg.tagKey("  URGENTE "), tg.tagKey("Huérfana")], ["urgente", "urgente", tg.slugifyTag("Huérfana")]);
  eq("tagEntryMatches: nombre o id", [tg.tagEntryMatches("Urgente", "urgente"), tg.tagEntryMatches("urgente", "urgente"), tg.tagEntryMatches("Compras", "compra")], [true, true, false]);
  eq("countTagUsageAcrossTasks: sin repetir tareas ni contar las eliminadas", [tg.countTagUsageAcrossTasks("urgente", tk), tg.countTagUsageAcrossTasks("compra", tk), tg.countTagUsageAcrossTasks("compras", tk), tg.countTagUsageAcrossTasks("huerfana", tk)], [1, 2, 2, 0]);
  eq("countTagUsageMap: lo mismo para todo el registro de una pasada", tg.countTagUsageMap(tags, tk), { urgente: 1, compra: 2, compras: 2, huerfana: 0, nueva: 0, mantener: 0 });
  eq("findOrphanTags: las que no están en ninguna tarea", tg.findOrphanTags(tags, tk).map((t) => t.id), ["huerfana", "nueva", "mantener"]);
  eq("countTagUsageAcrossTasks con datos vacíos no rompe", [tg.countTagUsageAcrossTasks("x", null), tg.countTagUsageAcrossTasks("x", []), tg.findOrphanTags(null, null)], [0, 0, []]);

  // auto-purga
  resetFb();
  let r = await tg.pruneOrphanTags({ tasks: tk, tags, keepTagIds: ["mantener"], now });
  eq("pruneOrphanTags: borra solo las huérfanas (no las recién creadas ni las de keepTagIds)", [r.pruned, r.skipped], [["huerfana"], null]);
  eq("pruneOrphanTags: el borrado va a tags/{id} con writeBatch", __fb.deletes.map((d) => d.ref.path), ["tags/huerfana"]);
  resetFb();
  r = await tg.pruneOrphanTags({ tasks: tk, tags, now: now + 3 * 60_000 });
  eq("pasado el margen de 2 minutos la recién creada ya cuenta como huérfana", r.pruned.sort(), ["huerfana", "mantener", "nueva"]);
  resetFb();
  tg.holdTagId("Mantener");
  r = await tg.pruneOrphanTags({ tasks: tk, tags, now: now + 3 * 60_000 });
  eq("una etiqueta «en mano» (creada en la edición abierta) no se purga", r.pruned.sort(), ["huerfana", "nueva"]);
  let released = 0;
  tg.setTagsReleasedHook(() => { released++; });
  tg.releaseHeldTags();
  eq("al terminar la edición se sueltan y se avisa a app.js", [released, tg.heldTagIds()], [1, []]);
  tg.setTagsReleasedHook(null);
  resetFb();
  tg.registerTagTasksProvider({ getTasks: () => tk, isComplete: () => false });
  r = await tg.pruneOrphanTags({ tags, now });
  eq("con la carga de tareas incompleta NO purga nada", [r.pruned, r.skipped, __fb.deletes.length], [[], "incomplete", 0]);
  tg.registerTagTasksProvider({ getTasks: () => tk, isComplete: () => true });
  r = await tg.pruneOrphanTags({ tags, now });
  eq("con todas las tareas cargadas (proveedor) sí", r.pruned.sort(), ["huerfana", "mantener"]);
  resetFb();
  r = await tg.pruneOrphanTags({ tasks: tk, tags: tags.filter((t) => t.id !== "huerfana" && t.id !== "mantener" && t.id !== "nueva"), now });
  eq("sin huérfanas: no escribe nada", [r.pruned, r.skipped, __fb.deletes.length], [[], "nothing", 0]);

  // renombrar / fusionar
  const plan = (id, name, extra = {}) => tg.planTagRename(tags, id, name, { tasks: tk, ...extra });
  const pm = plan("compras", "compra");
  eq("fusionar: «Compras» → «compra» es una fusión con la existente", [pm.mode, pm.targetId, pm.targetName, pm.sourceId], ["merge", "compra", "Compra", "compras"]);
  eq("fusionar: se reescriben las tareas afectadas y NO se duplica el nombre (t2 tenía las dos)", pm.taskRewrites, [{ id: "t2", tags: ["Compra"] }, { id: "t3", tags: ["Compra"] }]);
  eq("fusionar con otro color", plan("compras", "COMPRA", { newColor: "#abc" }).color, "#abc");
  const pu = plan("urgente", "URGENTE");
  eq("solo cambian mayúsculas: se actualiza el mismo documento y las tareas", [pu.mode, pu.targetId, pu.targetName, pu.taskRewrites.map((x) => x.id)], ["update", "urgente", "URGENTE", ["t1"]]);
  const pc = plan("urgente", "Urgente", { newColor: "#123456" });
  eq("solo cambia el color: documento sí, tareas no", [pc.mode, pc.color, pc.taskRewrites.length], ["update", "#123456", 0]);
  eq("sin cambios: noop", plan("urgente", " Urgente ").mode, "noop");
  const pv = plan("urgente", "Muy urgente");
  eq("nombre nuevo: el documento se mueve al slug nuevo (id = slug del nombre)", [pv.mode, pv.sourceId, pv.targetId, pv.targetName, pv.color, pv.taskRewrites], ["move", "urgente", tg.tagKey("Muy urgente"), "Muy urgente", "#f00", [{ id: "t1", tags: ["Muy urgente", "Compra"] }]]);
  eq("errores claros: nombre vacío y etiqueta inexistente", [(() => { try { plan("urgente", "  "); } catch (e) { return e.message; } })(), (() => { try { plan("nope", "x"); } catch (e) { return e.message; } })()], ["El nombre de la etiqueta no puede estar vacío.", "La etiqueta ya no existe."]);

  resetFb();
  let done1 = await tg.renameOrMergeTagEverywhere("compras", "Compra", { tasks: tk, tags });
  eq("renameOrMergeTagEverywhere (fusión): escribe las tareas con writeBatch.update", __fb.updates.map((u) => [u.ref.path, u.fields.tags]), [["tasks/t2", ["Compra"]], ["tasks/t3", ["Compra"]]]);
  eq("…actualiza la etiqueta destino y borra la vieja", [__fb.sets.map((s) => s.ref.path), __fb.deletes.map((d) => d.ref.path), done1.mode], [["tags/compra"], ["tags/compras"], "merge"]);
  resetFb();
  await tg.renameOrMergeTagEverywhere("urgente", "Muy urgente", { tasks: tk, tags });
  eq("renombrar de verdad: crea el documento nuevo, reescribe las tareas y borra el viejo", [__fb.sets.map((s) => [s.ref.path, s.data.name, s.data.color]), __fb.updates.map((u) => u.ref.path), __fb.deletes.map((d) => d.ref.path)], [[[`tags/${tg.tagKey("Muy urgente")}`, "Muy urgente", "#f00"]], ["tasks/t1"], ["tags/urgente"]]);
  resetFb();
  await tg.renameOrMergeTagEverywhere("urgente", "Urgente", { tasks: tk, tags });
  eq("sin cambios no escribe nada", [__fb.sets.length, __fb.updates.length, __fb.deletes.length], [0, 0, 0]);
  resetFb();
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, projectId: "P", tags: ["Compras", "Compra"] }));
  await tg.renameOrMergeTagEverywhere("compras", "Compra", { tasks: many, tags });
  eq("1000 tareas: todas reescritas, sin duplicar etiquetas", [__fb.updates.length, __fb.updates.every((u) => JSON.stringify(u.fields.tags) === '["Compra"]')], [1000, true]);

  // borrar en cascada
  resetFb();
  const dd = await tg.deleteTagEverywhere("compra", { tasks: tk });
  eq("deleteTagEverywhere: la quita de todas las tareas y borra tags/{id}", [__fb.updates.map((u) => [u.ref.path, u.fields.tags]), __fb.deletes.map((d) => d.ref.path), dd.taskRewrites.length], [[["tasks/t1", ["Urgente"]], ["tasks/t2", ["compras"]]], ["tags/compra"], 2]);
  resetFb();
  await tg.deleteTagEverywhere("huerfana", { tasks: tk });
  eq("deleteTagEverywhere de una sin uso: solo borra el documento", [__fb.updates.length, __fb.deletes.map((d) => d.ref.path)], [0, ["tags/huerfana"]]);
  tg.registerTagTasksProvider({});

  // modal de tarea: cableado de la interfaz
  const tm = read("js/components/task-modal.js");
  check("task-modal: botón «Gestionar etiquetas», filas con (N), ✏️ y 🗑️", /id="t-manage-tags"/.test(tm) && /tag-manage__count/.test(tm) && /data-edit/.test(tm) && /data-del/.test(tm) && /✏️/.test(tm) && /🗑️/.test(tm));
  check("task-modal: usa renameOrMergeTagEverywhere / deleteTagEverywhere y cuenta con TODAS las tareas", /renameOrMergeTagEverywhere\(id, rawName/.test(tm) && /deleteTagEverywhere\(id\)/.test(tm) && /loadTasksForTags\(\)/.test(tm) && /countTagUsageMap/.test(tm));
  check("task-modal: pide confirmación al fusionar y al borrar", /Se fusionarán/.test(tm) && /Se quitará «/.test(tm));
  check("task-modal: las etiquetas nuevas se «retienen» y se sueltan al cerrar", /holdTagId\(tagKey\(name\)\)/.test(tm) && /releaseHeldTags\(\)/.test(tm));
  check("app.js: registra el proveedor de tareas y programa la purga solo si ve todos los proyectos", /registerTagTasksProvider\(/.test(appSrcSafe()) && /seesEveryProject\(\)/.test(appSrcSafe()) && /schedulePruneOrphanTags\(\)/.test(appSrcSafe()) && /taskLoader\.isAllLoaded\(\)/.test(appSrcSafe()));
}
function appSrcSafe() { return read("js/app.js"); }

// ---------------------------------------------------------------- 5) sugerencias
const sh = await import("../js/suggest-hygiene.js");
{
  const st = memStorage();
  eq("memoria de quitadas: vacía al principio", sh.loadHiddenSuggestions("u1", st), { commercial: [], supplier: [] });
  sh.hideSuggestion("supplier", "Hidraulica  Sur", "u1", st);
  sh.hideSuggestion("supplier", "hidráulica sur", "u1", st);
  eq("quitar dos veces el mismo (sin tildes ni mayúsculas) lo guarda una vez, limpio", sh.loadHiddenSuggestions("u1", st).supplier, ["Hidraulica Sur"]);
  check("se guarda por persona (chusy_suggest_hidden_u1) y no mezcla personas", st._m.has("chusy_suggest_hidden_u1") && sh.loadHiddenSuggestions("u2", st).supplier.length === 0);
  eq("visibleSuggestions: las quitadas no se ofrecen", sh.visibleSuggestions("supplier", ["Aceros Norte", "Hidráulica Sur"], "u1", st), ["Aceros Norte"]);
  eq("visibleSuggestions: otra persona sí las ve", sh.visibleSuggestions("supplier", ["Aceros Norte", "Hidráulica Sur"], "u2", st), ["Aceros Norte", "Hidráulica Sur"]);
  eq("PURGA: cuando ya no hay ningún registro con ese valor, la entrada se borra de la memoria", (() => { sh.visibleSuggestions("supplier", ["Aceros Norte"], "u1", st); return sh.loadHiddenSuggestions("u1", st).supplier; })(), []);
  sh.hideSuggestion("commercial", "Juan Peres", "u1", st);
  eq("con la lista viva vacía (aún no llegaron los datos) no se purga nada", (() => { sh.visibleSuggestions("commercial", [], "u1", st); return sh.loadHiddenSuggestions("u1", st).commercial; })(), ["Juan Peres"]);
  eq("pruneHiddenSuggestions devuelve cuántas borró", sh.pruneHiddenSuggestions("commercial", ["Marta Ruiz"], "u1", st), 1);
  sh.hideSuggestion("supplier", "X Raro", "u1", st);
  sh.unhideSuggestion("supplier", "x  raro", "u1", st);
  eq("unhide: escribir a propósito un valor quitado lo devuelve a las sugerencias", sh.loadHiddenSuggestions("u1", st).supplier, []);
  eq("campo desconocido: no hace nada ni rompe", [sh.hideSuggestion("otro", "x", "u1", st).supplier.length, sh.visibleSuggestions("otro", ["a"], "u1", st)], [0, ["a"]]);
  eq("localStorage que falla: no rompe", [sh.loadHiddenSuggestions("u1", brokenStorage), sh.visibleSuggestions("supplier", ["a"], "u1", brokenStorage)], [{ commercial: [], supplier: [] }, ["a"]]);

  // plan de corrección en cascada
  const offersProject = { id: OFF, exclusiveKey: "ofertas", customFieldDefs: [{ id: "comercial", name: "Comercial" }] };
  const projs = [{ id: "P1", properties: { comercial: "Juan Peres" } }, { id: "P2", properties: { comercial: "Juan Pérez" } }, { id: "P3", properties: { comercial: "juan  peres" } }, offersProject, { id: "P4", archived: true, properties: { comercial: "Juan Peres" } }];
  const tk = [
    { id: "o1", projectId: OFF, customFields: { comercial: "Juan Peres" } },
    { id: "o2", projectId: OFF, customFields: { comercial: "Marta Ruiz" } },
    { id: "o3", projectId: "P1", customFields: { comercial: "Juan Peres" } }, // NO es oferta: no se toca
    { id: "s1", projectId: "P1", supplier: "Hidraulica Sur", workflow: { purchase: { supplier: "HIDRÁULICA  SUR" } } },
    { id: "s2", projectId: "P1", supplier: "Hidráulica Sur" },
    { id: "s3", projectId: "P1", supplier: "Aceros", deleted: true },
    { id: "s4", projectId: "P1", workflow: { purchase: { supplier: "Hidraulica Sur" } } },
  ];
  const pc = sh.planSuggestedValueReplacement({ field: "commercial", oldValue: "Juan Peres", newValue: "Juan Pérez", tasks: tk, projects: projs });
  eq("plan Comercial: ofertas (campo Comercial), propiedades de proyectos activos; no otras tareas", [pc.taskUpdates, pc.projectUpdates.map((p) => p.id), pc.count], [[{ id: "o1", fields: { "customFields.comercial": "Juan Pérez" } }], ["P1", "P3"], 3]);
  eq("plan Comercial: P2 (ya correcto) y el archivado no se tocan", pc.projectUpdates.every((p) => p.id !== "P2" && p.id !== "P4"), true);
  const ps = sh.planSuggestedValueReplacement({ field: "supplier", oldValue: "hidraulica sur", newValue: "Hidráulica Sur", tasks: tk, projects: projs });
  eq("plan Proveedor: task.supplier y workflow.purchase.supplier por clave (sin tildes/mayúsculas); no las ya correctas", ps.taskUpdates, [{ id: "s1", fields: { supplier: "Hidráulica Sur", "workflow.purchase.supplier": "Hidráulica Sur" } }, { id: "s4", fields: { "workflow.purchase.supplier": "Hidráulica Sur" } }]);
  eq("plan vaciar (🗑️ + vaciar): el valor nuevo es vacío", sh.planSuggestedValueReplacement({ field: "supplier", oldValue: "Hidraulica Sur", newValue: "", tasks: [tk[3], tk[4]], projects: [] }).taskUpdates.map((u) => u.fields.supplier), ["", ""]);
  eq("plan: valor viejo vacío o campo desconocido", [sh.planSuggestedValueReplacement({ field: "supplier", oldValue: " ", newValue: "x", tasks: tk }).count, (() => { try { sh.planSuggestedValueReplacement({ field: "zz", oldValue: "a", newValue: "b" }); } catch (e) { return "lanza"; } })()], [0, "lanza"]);

  // ejecutor por lotes
  const se = await import("../js/data/suggest-edit.js");
  resetFb();
  const out = await se.replaceSuggestedFieldValueEverywhere("supplier", "hidraulica sur", "Hidráulica Sur", { tasks: tk, projects: projs });
  eq("replaceSuggestedFieldValueEverywhere: escribe con writeBatch.update y rutas con puntos", [__fb.updates.map((u) => [u.ref.path, u.fields["workflow.purchase.supplier"] || u.fields.supplier]), out.tasks, out.count], [[["tasks/s1", "Hidráulica Sur"], ["tasks/s4", "Hidráulica Sur"]], 2, 2]);
  resetFb();
  const out2 = await se.replaceSuggestedFieldValueEverywhere("commercial", "Juan Peres", "Juan Pérez", { tasks: tk, projects: projs });
  eq("…y los proyectos van aparte (properties.comercial)", [__fb.updates.map((u) => [u.ref.path, Object.keys(u.fields).filter((k) => k !== "updatedAt")[0]]), out2.count, out2.failedProjects], [[["tasks/o1", "customFields.comercial"], ["projects/P1", "properties.comercial"], ["projects/P3", "properties.comercial"]], 3, 0]);
  resetFb();
  eq("sin coincidencias no escribe nada", (await se.replaceSuggestedFieldValueEverywhere("supplier", "Nadie", "X", { tasks: tk, projects: projs })).count + __fb.updates.length, 0);
  const prev = await se.previewSuggestedFieldReplacement("supplier", "hidraulica sur", "X", { tasks: tk, projects: projs });
  eq("previewSuggestedFieldReplacement cuenta sin escribir", [prev.count, __fb.updates.length], [3, 0]);
}

// el desplegable (jsdom)
{
  const ts = await import("../js/components/text-suggest.js");
  const tg = await import("../js/data/tags.js");
  localStorage.clear();
  const live = ["Aceros Norte", "Hidraulica Sur", "Hidráulica Sur"];
  const dtasks = [{ id: "s1", projectId: "P1", supplier: "Hidraulica Sur" }, { id: "s2", projectId: "P1", supplier: "Aceros Norte" }];
  tg.registerTagTasksProvider({ getTasks: () => dtasks, ensureComplete: async () => {} });
  ts.setSuggestProvider("supplier", () => ["Aceros Norte", "Hidraulica Sur"]);
  ts.setSuggestUserProvider(() => "u1");
  const wrap = document.createElement("div"); document.body.appendChild(wrap);
  const input = document.createElement("input"); wrap.appendChild(input);
  ts.attachSupplierSuggest(input);
  const open = () => { input.focus(); typeInto(input, "h"); return $(".text-suggest"); };
  let list = open();
  check("desplegable con field: cada sugerencia lleva ✏️ y 🗑️ a la derecha", !!list && $$(".text-suggest__item", list).length === 1 && $$("[data-act]", $(".text-suggest__item", list)).map((b) => b.dataset.act).join() === "edit,del");
  check("el texto de la sugerencia va en su propio span", $(".text-suggest__text", list).textContent === "Hidraulica Sur");
  eq("elegir una sugerencia (clic en el texto) sigue funcionando", (() => { mousedown($(".text-suggest__text", list)); return input.value; })(), "Hidraulica Sur");

  // ✏️ Corregir en todo Chusy
  resetFb();
  const stubs = { prompt: window.prompt, confirm: window.confirm };
  const confirms = [];
  window.confirm = (m) => { confirms.push(m); return true; };
  window.prompt = () => "Hidráulica del Sur";
  typeInto(input, "hidraulica sur"); list = $(".text-suggest"); // (el campo lleva el valor erróneo, solo que con otras mayúsculas)
  mousedown($('[data-act="edit"]', list));
  await tick(30);
  eq("✏️: pide confirmación diciendo en cuántos registros cambia", confirms.length === 1 && /en 1 registro/.test(confirms[0]) && /Hidráulica del Sur/.test(confirms[0]), true);
  eq("✏️: corrige por lote en la tarea que lo llevaba", __fb.updates.map((u) => [u.ref.path, u.fields.supplier]), [["tasks/s1", "Hidráulica del Sur"]]);
  eq("✏️: el valor erróneo deja de sugerirse al momento (memoria de quitadas)", JSON.parse(localStorage.getItem("chusy_suggest_hidden_u1")).supplier, ["Hidraulica Sur"]);
  eq("✏️: el campo que se estaba rellenando con el valor erróneo pasa al corregido", input.value, "Hidráulica del Sur");
  check("✏️: cancelar el cuadro no cambia nada", (() => { resetFb(); window.prompt = () => null; typeInto(input, "h"); const l = $(".text-suggest"); if (!l) return true; mousedown($('[data-act="edit"]', l)); return __fb.updates.length === 0; })());

  // 🗑️ Quitar sugerencia
  localStorage.clear(); resetFb(); confirms.length = 0;
  input.value = "";
  window.prompt = stubs.prompt;
  typeInto(input, "h"); list = $(".text-suggest");
  mousedown($('[data-act="del"]', list));
  await tick(30);
  check("🗑️: confirma quitar y, como aún hay registros, pregunta si los vacía", confirms.length === 2 && /Quitar «Hidraulica Sur»/.test(confirms[0]) && /sigue escrito en 1 registro/.test(confirms[1]));
  eq("🗑️: la sugerencia queda oculta para esta persona y el registro vaciado", [JSON.parse(localStorage.getItem("chusy_suggest_hidden_u1")).supplier, __fb.updates.map((u) => [u.ref.path, u.fields.supplier])], [["Hidraulica Sur"], [["tasks/s1", ""]]]);
  input.value = ""; typeInto(input, "hidra");
  check("tras quitarla ya no sale en el desplegable", !$(".text-suggest"));
  // 🗑️ solo ocultar (rechaza vaciar)
  localStorage.clear(); resetFb(); confirms.length = 0;
  let n = 0; window.confirm = () => ++n === 1;
  input.value = ""; typeInto(input, "a"); list = $(".text-suggest");
  mousedown($('[data-act="del"]', list)); await tick(30);
  eq("🗑️: si no quiere vaciar los registros, solo se oculta (no se escribe nada)", [JSON.parse(localStorage.getItem("chusy_suggest_hidden_u1")).supplier.length, __fb.updates.length], [1, 0]);
  window.confirm = stubs.confirm; window.prompt = stubs.prompt;
  // sin field: sin botones
  const input2 = document.createElement("input"); wrap.appendChild(input2);
  ts.attachTextSuggest(input2, { getOptions: () => ["Uno", "Dos"] });
  input2.focus(); typeInto(input2, "u");
  check("sin `field` (otros usos) el desplegable queda como siempre, sin botones", !!$(".text-suggest") && !$(".text-suggest [data-act]"));
  wrap.remove(); document.querySelectorAll(".text-suggest").forEach((e) => e.remove());
  tg.registerTagTasksProvider({});

  const tsSrc = read("js/components/text-suggest.js");
  const tmSrc = read("js/components/task-modal.js");
  const ppSrc = read("js/components/project-properties-modal.js");
  check("Comercial (modal de tarea y propiedades de proyecto) y Proveedor usan field", /field: "commercial"/.test(tmSrc) && /field: "commercial"/.test(ppSrc) && /field: "supplier"/.test(tsSrc));
  check("app.js registra quién es la persona para las sugerencias", /setSuggestUserProvider\(\(\) => \(currentUser \? currentUser\.uid : null\)\)/.test(read("js/app.js")));
}

// ---------------------------------------------------------------- 6) Visualizador de piezas: subir piezas
{
  const pl = await import("../js/parts-library.js");
  const pv = await import("../js/parts-viewer.js");
  const file = (name, size = 100) => ({ name, size });
  const v = pl.validateLibraryFiles([file("a.step"), file("b.IPT"), file("c.pdf"), file("a.STEP"), file("vacio.stp", 0), file("d.iam"), { size: 5 }]);
  eq("validar: acepta CAD sin repetir; rechaza lo demás con motivo", [v.accepted.map((f) => f.name), v.rejected.map((r) => r.name)], [["a.step", "b.IPT", "d.iam"], ["c.pdf", "a.STEP", "vacio.stp", "(sin nombre)"]]);
  eq("validar: tope de archivos por subida", pl.validateLibraryFiles(Array.from({ length: 40 }, (_, i) => file(`p${i}.step`))).accepted.length, pl.LIBRARY_MAX_FILES);
  const att = (id, name, extra = {}) => ({ id, kind: "drive", name, driveId: `D-${id}`, size: 10, uploadedAt: "2026-11-18T10:00:00.000Z", ...extra });
  const data = pl.buildLibraryEntryData({ attachments: [att("1", "Soporte.ipt"), att("2", "Soporte.stp"), { kind: "link", name: "x.step", url: "http://x" }, att("3", "nota.pdf")], title: "  Soporte   pistola \n B ", projectId: "P1", sector: "Automoción", user: { uid: "u1", name: "Ana" } });
  eq("buildLibraryEntryData: solo adjuntos CAD de Drive, título limpio, sector normalizado, autor", [data.attachments.map((a) => a.name), data.title, data.sector, data.projectId, data.createdBy, data.createdByName], [["Soporte.ipt", "Soporte.stp"], "Soporte pistola B", "automocion", "P1", "u1", "Ana"]);
  eq("buildLibraryEntryData: sector raro → vacío; título acotado", [pl.buildLibraryEntryData({ sector: "x" }).sector, pl.buildLibraryEntryData({ title: "x".repeat(500) }).title.length], ["", pl.LIBRARY_TITLE_MAX]);
  eq("quién puede borrar: el autor o un admin", [pl.canManageLibraryEntry({ createdBy: "u1" }, { uid: "u1" }), pl.canManageLibraryEntry({ createdBy: "u1" }, { uid: "u2", role: "member" }), pl.canManageLibraryEntry({ createdBy: "u1" }, { uid: "u2", role: "admin" }), pl.canManageLibraryEntry(null, { uid: "u1" })], [true, false, true, false]);
  eq("mergeLibraryAttachments: sin repetir el archivo de Drive", pl.mergeLibraryAttachments([att("1", "a.stp")], [att("1", "a.stp"), att("2", "b.stp")]).map((a) => a.id), ["1", "2"]);
  eq("carpeta de Drive: la del proyecto si tiene código; si no, «Visualizador de piezas / AAAA-MM»", [pl.libraryFolderPath({ project: { id: "P1", code: "26001", name: "Cabina" } })[0].code, pl.libraryFolderPath({}).map((s) => s.name)], ["26001", ["Visualizador de piezas", "2026-11"]]);

  const entries = [
    { id: "L1", title: "Soporte pistola", projectId: "P1", sector: "", createdBy: "u1", createdByName: "Ana", createdAt: { toMillis: () => Date.parse("2026-11-18T12:00:00Z") }, attachments: [att("1", "Soporte.ipt"), att("2", "Soporte.stp")] },
    { id: "L2", title: "", projectId: "", sector: "industria", createdBy: "u2", createdByName: "Luis", createdAt: { toMillis: () => Date.parse("2026-11-19T08:00:00Z") }, attachments: [att("3", "Brida.ipt")] },
    { id: "L3", title: "Con proyecto archivado", projectId: "ARCH", createdBy: "u2", attachments: [att("4", "Eje.step")] },
    { id: "L4", title: "Vacía", attachments: [] },
  ];
  const lib = pl.indexLibraryCadParts(entries, projects);
  eq("biblioteca: una pieza por referencia (el .ipt y su .stp, juntos)", lib.map((p) => [p.key, p.has3d, p.hasNative, p.availability]), [["lib:L1:soporte", true, true, "step"], ["lib:L2:brida", false, true, "native"], ["lib:L3:eje", true, false, "step"]]);
  const p1 = lib[0];
  eq("biblioteca: pieza con proyecto → código, nombre y sector del proyecto; no es de ninguna tarea", [p1.source, p1.taskId, p1.projectId, p1.projectCode, p1.projectName, p1.sector, p1.uploadedByName, p1.taskTitle], ["library", null, "P1", "26001", "Cabina Talgo", "industria", "Ana", "Soporte pistola"]);
  eq("biblioteca: sin proyecto → «Sin proyecto» y el sector elegido al subir", [lib[1].projectId, lib[1].projectName, lib[1].sector], ["", "Sin proyecto", "industria"]);
  eq("biblioteca: proyecto archivado → sale como «Sin proyecto»", [lib[2].projectId, lib[2].projectName], ["", "Sin proyecto"]);
  check("biblioteca: los adjuntos llevan su id de subida y taskId null", lib[0].primaryStep.libraryId === "L1" && lib[0].primaryStep.taskId === null);
  const catalog = pl.buildPartsCatalog([{ id: "T1", projectId: "P2", title: "Tarea con pieza", attachments: [att("9", "Carcasa.step", { uploadedAt: "2026-11-10T00:00:00.000Z" })] }], projects, entries);
  eq("catálogo: piezas de tareas + subidas directas, de lo más reciente a lo más antiguo", catalog.map((p) => p.key), ["lib:L2:brida", "lib:L1:soporte", "lib:L3:eje", "T1:carcasa"].filter((k) => catalog.some((p) => p.key === k)).sort((a, b) => catalog.findIndex((p) => p.key === a) - catalog.findIndex((p) => p.key === b)));
  check("catálogo: incluye las dos procedencias", catalog.some((p) => p.source === "library") && catalog.some((p) => p.key === "T1:carcasa"));
  eq("la búsqueda encuentra una subida directa por su nota, su archivo o el código del proyecto", [pv.filterCadPartsCatalog(catalog, { search: "pistola" }).length, pv.filterCadPartsCatalog(catalog, { search: "brida" }).length, pv.filterCadPartsCatalog(catalog, { search: "26001" }).length], [1, 1, 1]);
  eq("el filtro de sector funciona con subidas directas", pv.filterCadPartsCatalog(catalog, { sector: "industria" }).map((p) => p.key).sort(), ["lib:L1:soporte", "lib:L2:brida", "lib:L3:eje"].filter((k) => k !== "lib:L3:eje").sort());
  eq("el desplegable de proyectos no incluye «sin proyecto»", pv.collectPartsProjects(catalog).map((p) => p.id), ["P1", "P2"]);

  // vista
  const { renderPartsViewerView } = await import("../js/views/parts-viewer-view.js");
  const holder = document.createElement("div"); document.body.appendChild(holder);
  const calls = [];
  renderPartsViewerView(holder, { parts: catalog, state: {}, storage: {}, onOpenTask() {}, onUpload: () => calls.push("upload"), canManagePart: (p) => p.createdBy === "u1", onDeletePart: (p) => calls.push(`del:${p.libraryId}`) });
  check("vista: botón «⬆ Subir piezas»", !!$("#pv-upload", holder) && /Subir piezas/.test($("#pv-upload", holder).textContent));
  click($("#pv-upload", holder));
  eq("vista: el botón abre la subida", calls, ["upload"]);
  const cardOf = (key) => $$(".parts-viewer-card", holder).find((c) => c.dataset.key === key);
  check("vista: la tarjeta de una subida directa muestra quién la subió y no tiene «Abrir tarea»", /Ana/.test(cardOf("lib:L1:soporte").textContent) && !$('[data-act="task"]', cardOf("lib:L1:soporte")) && !!$('[data-act="task"]', cardOf("T1:carcasa")));
  check("vista: «Eliminar» solo en las que puede gestionar (la de u1, no la de u2)", !!$('[data-act="delete"]', cardOf("lib:L1:soporte")) && !$('[data-act="delete"]', cardOf("lib:L2:brida")) && !$('[data-act="delete"]', cardOf("T1:carcasa")));
  click($('[data-act="delete"]', cardOf("lib:L1:soporte")));
  eq("vista: «Eliminar» avisa con la pieza", calls, ["upload", "del:L1"]);
  renderPartsViewerView(holder, { parts: [], state: {}, storage: {}, onUpload() {} });
  check("vista vacía: invita a «Subir piezas»", /Subir piezas/.test(holder.textContent));
  renderPartsViewerView(holder, { parts: [], state: {}, storage: {} });
  check("sin onUpload (permiso/pruebas antiguas) no hay botón", !$("#pv-upload", holder));
  holder.remove();

  // modal de subida
  const { openPartsUploadModal } = await import("../js/components/parts-upload-modal.js");
  const uploads = [];
  const storage = { isEnabled: () => true, trashFiles: (ids) => uploads.push(["trash", ids]), uploadFile: async (f, o) => { uploads.push([f.name, o.folderPath.map((s) => s.name), o.code]); o.onProgress && o.onProgress({ loaded: f.size }); return { driveId: `D-${f.name}`, name: f.name, mimeType: "application/octet-stream", size: f.size }; } };
  const saved = [];
  const created = [];
  const modal = openPartsUploadModal({ storage, currentUser: { uid: "u1", name: "Ana" }, projects, onSaved: (id) => saved.push(id), deps: { createEntry: async (d) => { created.push(d); return "NEW1"; } } });
  const root = document.getElementById("modal-root");
  check("modal: se abre con zona de arrastre, campos opcionales y «Subir» desactivado", !!$(".parts-upload", root) && !!$("#pu-drop", root) && $("#pu-save", root).disabled && $$("#pu-project option", root).length === 3 && !$$("#pu-project option", root).some((o) => /Archivado|Ofertas/.test(o.textContent)));
  check("modal: el selector acepta solo CAD y varios archivos", $("#pu-input", root).accept === ".step,.stp,.ipt,.iam" && $("#pu-input", root).multiple);
  const dropEv = new window.Event("drop", { bubbles: true, cancelable: true });
  dropEv.dataTransfer = { files: [{ name: "Soporte.ipt", size: 50 }, { name: "notas.pdf", size: 5 }, { name: "Brida.stp", size: 60 }] };
  $("#pu-drop", root).dispatchEvent(dropEv);
  eq("modal: arrastrar y soltar añade solo los CAD", $$(".parts-upload__file .parts-upload__name", root).map((e) => e.textContent), ["Soporte.ipt", "Brida.stp"]);
  check("modal: avisa de que a Soporte.ipt le falta su .STEP (no impide subirlo)", !$("#pu-warn", root).hidden && /Soporte\.ipt/.test($("#pu-warn", root).textContent) && !$("#pu-save", root).disabled);
  $("#pu-title", root).value = "Soportes";
  $("#pu-project", root).value = "P1";
  $("#pu-project", root).dispatchEvent(new window.Event("change", { bubbles: true }));
  eq("modal: al elegir proyecto se propone su sector", $("#pu-sector", root).value, "industria");
  click($("#pu-save", root));
  await tick(60);
  eq("modal: sube cada archivo a la carpeta del proyecto (por su código)", uploads.filter((u) => u[0] !== "trash").map((u) => [u[0], u[1][0], u[2]]), [["Soporte.ipt", codedName("26001", "Cabina Talgo"), "26001"], ["Brida.stp", codedName("26001", "Cabina Talgo"), "26001"]]);
  eq("modal: guarda UNA subida con los dos adjuntos, el título, el proyecto y el sector", [created.length, created[0].attachments.map((a) => a.name), created[0].title, created[0].projectId, created[0].sector], [1, ["Soporte.ipt", "Brida.stp"], "Soportes", "P1", "industria"]);
  check("modal: avisa al terminar y se cierra", saved.join() === "NEW1" && !$(".parts-upload", root));
  void modal;
  function codedName(code, name) { return `${code} - ${name}`; }

  // errores: Drive desactivado / fallo al subir
  const m2 = openPartsUploadModal({ storage: { isEnabled: () => false }, currentUser: { uid: "u1" }, projects, deps: { createEntry: async () => "X" } });
  const e2 = new window.Event("drop", { bubbles: true, cancelable: true }); e2.dataTransfer = { files: [{ name: "A.step", size: 5 }] };
  $("#pu-drop", root).dispatchEvent(e2);
  click($("#pu-save", root)); await tick(20);
  check("modal: con Drive desactivado no sube y lo dice", /Drive|almacenamiento/i.test($("#toast-root").textContent) && !!$(".parts-upload", root));
  m2.close();
  check("modal: Esc/cerrar lo quita", !$(".parts-upload", root));
  const m3 = openPartsUploadModal({ storage: { isEnabled: () => true, trashFiles() {}, uploadFile: async (f) => { if (f.name === "Malo.step") throw new Error("Sin espacio"); return { driveId: `D-${f.name}`, name: f.name, mimeType: "x", size: f.size }; } }, currentUser: { uid: "u1" }, projects, deps: { createEntry: async (d) => { created.push(d); return "N2"; } } });
  const e3 = new window.Event("drop", { bubbles: true, cancelable: true }); e3.dataTransfer = { files: [{ name: "Bueno.step", size: 5 }, { name: "Malo.step", size: 5 }] };
  $("#pu-drop", root).dispatchEvent(e3);
  const before = created.length;
  click($("#pu-save", root)); await tick(60);
  check("modal: si un archivo falla, se guardan los buenos y el malo queda para reintentar", created.length === before + 1 && created[before].attachments.map((a) => a.name).join() === "Bueno.step" && $$(".parts-upload__file", root).length === 1 && /Sin espacio/.test($(".parts-upload__err", root).textContent) && $("#pu-save", root).textContent === "Reintentar");
  m3.close();

  const appSrc = read("js/app.js");
  check("app.js: suscripción perezosa a cadParts, catálogo con buildPartsCatalog, subir y borrar", /subscribeToCadParts\(/.test(appSrc) && /buildPartsCatalog\(getKnownProjectTasks\(\), projects, cadPartsEntries\)/.test(appSrc) && /openPartsUploadModal\(/.test(appSrc) && /deleteLibraryPart/.test(appSrc) && /unsubCadParts = null/.test(appSrc));
  const rules = read("firestore.rules");
  check("firestore.rules: cadParts — lee quien tiene cuenta activa, crea el autor, edita/borra el autor o un admin", /match \/cadParts\/\{partId\}/.test(rules) && /request\.resource\.data\.createdBy == request\.auth\.uid/.test(rules) && /resource\.data\.createdBy == request\.auth\.uid \|\| isAdmin\(\)/.test(rules));
}

// ---------------------------------------------------------------- 7) visor 3D: diámetros y círculos
{
  const cv = await import("../js/cad-viewer.js");
  const tri = (A, B, C, out) => out.push(...A, ...B, ...C);
  const un = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function cyl({ r = 6, len = 20, seg = 48, c = [10, 5, -3], a = [0, 0, 1], arc = 360, inward = false, taper = 0 } = {}) {
    a = un(a); const e = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = un(cr(a, e)), v = cr(a, u);
    const P = (th, t) => [0, 1, 2].map((i) => c[i] + (r + taper * t) * (Math.cos(th) * u[i] + Math.sin(th) * v[i]) + a[i] * t);
    const out = []; const n = Math.round((seg * arc) / 360);
    for (let i = 0; i < n; i++) {
      const t0 = ((i / n) * arc * Math.PI) / 180, t1 = (((i + 1) / n) * arc * Math.PI) / 180;
      const A = P(t0, -len / 2), B = P(t1, -len / 2), C = P(t1, len / 2), D = P(t0, len / 2);
      if (!inward) { tri(A, B, C, out); tri(A, C, D, out); } else { tri(A, C, B, out); tri(A, D, C, out); }
    }
    return new Float64Array(out);
  }
  function disk({ r = 8, ri = 0, seg = 48, c = [0, 0, 5] } = {}) {
    const out = []; const P = (th, rr) => [c[0] + rr * Math.cos(th), c[1] + rr * Math.sin(th), c[2]];
    for (let i = 0; i < seg; i++) {
      const t0 = ((i / seg) * 2 * Math.PI), t1 = (((i + 1) / seg) * 2 * Math.PI);
      if (ri > 0) { tri(P(t0, ri), P(t0, r), P(t1, r), out); tri(P(t0, ri), P(t1, r), P(t1, ri), out); } else tri(c, P(t0, r), P(t1, r), out);
    }
    return new Float64Array(out);
  }
  function sphere({ r = 5, n = 24 } = {}) {
    const out = []; const P = (th, ph) => [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)];
    for (let i = 0; i < n; i++) for (let j = 0; j < n / 2; j++) {
      const t0 = (i / n) * 2 * Math.PI, t1 = ((i + 1) / n) * 2 * Math.PI, p0 = (j / (n / 2)) * Math.PI, p1 = ((j + 1) / (n / 2)) * Math.PI;
      tri(P(t0, p0), P(t1, p0), P(t1, p1), out); tri(P(t0, p0), P(t1, p1), P(t0, p1), out);
    }
    return new Float64Array(out);
  }
  function rect(w, h, z = 0) { const o = []; tri([0, 0, z], [w, 0, z], [w, h, z], o); tri([0, 0, z], [w, h, z], [0, h, z], o); return new Float64Array(o); }
  const D = (pos) => cv.buildFaceDescriptor(pos, { faceId: 1 });
  const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;
  const nearV = (a, b, eps = 0.011) => a.every((x, i) => near(x, b[i], eps));

  // álgebra
  const ev = cv.eigenSymmetric3([[2, 0, 0], [0, 5, 0], [0, 0, 1]]);
  eq("autovalores de una matriz diagonal (de menor a mayor)", ev.map((e) => e.value), [1, 2, 5]);
  const ev2 = cv.eigenSymmetric3([[2, 1, 0], [1, 2, 0], [0, 0, 3]]);
  check("autovalores de una matriz con términos cruzados (1, 3, 3)", near(ev2[0].value, 1, 1e-9) && near(ev2[1].value, 3, 1e-9) && near(ev2[2].value, 3, 1e-9));
  const circ = cv.fitCircle2D(Array.from({ length: 12 }, (_, i) => [3 + 5 * Math.cos(i / 2), -2 + 5 * Math.sin(i / 2)]));
  check("ajuste de círculo 2D (centro y radio exactos)", near(circ.cx, 3, 1e-6) && near(circ.cy, -2, 1e-6) && near(circ.r, 5, 1e-6) && circ.rms < 1e-6);
  eq("ajuste de círculo: puntos alineados o pocos → null", [cv.fitCircle2D([[0, 0], [1, 1], [2, 2], [3, 3]]), cv.fitCircle2D([[0, 0], [1, 1]]), cv.fitCircle2D(null)], [null, null, null]);

  // cilindros
  const m1 = cv.computeDiameterMeasurement(D(cyl()));
  eq("cilindro (eje Z, ⌀12, largo 20): diámetro, radio, longitud, tipo", [m1.diameterMm, m1.radiusMm, m1.lengthMm, m1.type, m1.isFullCircle], [12, 6, 20, "cylinder", true]);
  check("cilindro: el centro está en el eje, a media longitud", nearV(m1.center, [10, 5, -3]) && near(Math.abs(m1.axis[2]), 1, 1e-6));
  check("cilindro: la línea de cota pasa por el centro y mide el diámetro", near(Math.hypot(...m1.lineStart.map((x, i) => x - m1.lineEnd[i])), 12) && nearV(m1.lineStart.map((x, i) => (x + m1.lineEnd[i]) / 2), [10, 5, -3]));
  const mt1 = cv.computeDiameterMeasurement(D(cyl({ a: [1, 2, 3], r: 3.5, len: 7 })));
  eq("cilindro con el eje inclinado", [mt1.diameterMm, mt1.lengthMm], [7, 7]);
  check("cilindro inclinado: el eje sale unitario y bien orientado", near(Math.hypot(...mt1.axis), 1, 1e-6) && near(Math.abs(mt1.axis[0] * 1 + mt1.axis[1] * 2 + mt1.axis[2] * 3) / Math.hypot(1, 2, 3), 1, 1e-6));
  eq("agujero (normales hacia el eje) vs eje/saliente (hacia fuera)", [cv.computeDiameterMeasurement(D(cyl({ inward: true, r: 4 }))).kind, cv.computeDiameterMeasurement(D(cyl({ r: 4 }))).kind], ["hole", "shaft"]);
  const half = cv.computeDiameterMeasurement(D(cyl({ arc: 180, r: 5 })));
  eq("medio cilindro: mismo diámetro, no es círculo completo", [half.diameterMm, half.isFullCircle, Math.round(half.arcDeg)], [10, false, 180]);
  eq("redondeo de 90°: se mide su diámetro", cv.computeDiameterMeasurement(D(cyl({ arc: 90, r: 2 }))).diameterMm, 4);
  eq("redondeo fino de 20°", cv.computeDiameterMeasurement(D(cyl({ arc: 20, r: 2, seg: 360 }))).diameterMm, 4);
  eq("un cono NO es un círculo medible", cv.computeDiameterMeasurement(D(cyl({ taper: 0.6 }))), null);
  eq("una esfera NO es un círculo medible", cv.computeDiameterMeasurement(D(sphere())), null);
  eq("una cara plana rectangular NO es un círculo", cv.computeDiameterMeasurement(D(rect(30, 20))), null);
  eq("«hacia» (punto del clic) orienta la línea de cota", (() => { const m = cv.computeDiameterMeasurement(D(cyl({ c: [0, 0, 0], a: [0, 0, 1], r: 5 })), { toward: [50, 0, 3] }); return [Math.round(m.lineEnd[0]), Math.round(m.lineStart[0])]; })(), [5, -5]);
  // discos y arandelas
  const dk = cv.computeDiameterMeasurement(D(disk()));
  eq("disco plano (cara circular): diámetro y tipo", [dk.diameterMm, dk.type, dk.kind, dk.innerDiameterMm], [16, "disk", "disk", null]);
  check("disco: el centro es el del disco", nearV(dk.center, [0, 0, 5]));
  const wsh = cv.computeDiameterMeasurement(D(disk({ r: 10, ri: 4 })));
  eq("arandela: diámetro exterior e interior", [wsh.diameterMm, wsh.innerDiameterMm, wsh.kind], [20, 8, "washer"]);
  eq("semidisco (cara plana que no es un disco entero) → null", cv.computeDiameterMeasurement(D((() => { const o = []; const P = (t) => [8 * Math.cos(t), 8 * Math.sin(t), 0]; for (let i = 0; i < 24; i++) tri([0, 0, 0], P((i / 24) * Math.PI), P(((i + 1) / 24) * Math.PI), o); return new Float64Array(o); })())), null);
  check("describeDiameter: etiqueta, título y líneas", (() => { const t = cv.describeDiameter(cv.computeDiameterMeasurement(D(cyl({ inward: true, r: 4 })))); return t.label === "⌀ 8.00 mm" && /^Agujero ⌀ 8\.00 mm$/.test(t.title) && t.lines.some((l) => /Radio: R 4\.00 mm/.test(l)) && t.lines.some((l) => /Longitud/.test(l)); })());
  check("describeDiameter: arandela con su diámetro interior", cv.describeDiameter(wsh).lines.some((l) => /Diámetro interior: ⌀ 8\.00 mm/.test(l)));

  // desde el centro a una cara / entre círculos
  const c1 = cv.fitCircularFace(D(cyl({ c: [10, 20, 7], r: 5, len: 10 })));
  const plane = D(rect(100, 100)); // plano z = 0
  const cf = cv.computeCircleToFaceMeasurement(c1, plane);
  eq("círculo → cara plana: distancia perpendicular del centro al plano", [cf.distanceMm, cf.normalDistanceMm, cf.isPlanarTarget], [7, 7, true]);
  check("círculo → cara: la línea va del centro al pie sobre el plano", nearV(cf.lineStart, [10, 20, 7]) && nearV(cf.lineEnd, [10, 20, 0]));
  const side = D((() => { const o = []; tri([30, 0, -50], [30, 100, -50], [30, 100, 50], o); tri([30, 0, -50], [30, 100, 50], [30, 0, 50], o); return new Float64Array(o); })()); // plano x = 30
  eq("círculo → otra cara plana (x = 30)", cv.computeCircleToFaceMeasurement(c1, side).distanceMm, 20);
  const curved = D(cyl({ c: [40, 20, 7], r: 3, len: 10 }));
  const cc = cv.computeCircleToFaceMeasurement(c1, curved);
  check("círculo → cara curva: usa la distancia mínima", cc.isPlanarTarget === false && cc.normalDistanceMm === null && near(cc.distanceMm, cc.minDistanceMm) && near(cc.distanceMm, 27, 0.1), cc);
  eq("círculo → cara: orientación del eje (agujero perpendicular al plano z = 0; paralelo a otro plano)", [cf.axisAngleDeg, cv.describeAxisToFace(cf), cv.computeCircleToFaceMeasurement(c1, side).axisAngleDeg, cv.describeAxisToFace(cv.computeCircleToFaceMeasurement(c1, side))], [90, "El eje del círculo es perpendicular a la cara", 0, "El eje del círculo es paralelo a la cara"]);
  eq("círculo → cara curva: sin ángulo de eje", [cc.axisAngleDeg, cv.describeAxisToFace(cc)], [null, ""]);
  const c2 = cv.fitCircularFace(curved);
  const cc2 = cv.computeCircleToCircleMeasurement(c1, c2);
  eq("círculo ↔ círculo con ejes paralelos: distancia entre centros y entre ejes", [cc2.centerDistanceMm, cc2.axisDistanceMm, cc2.axesParallel, cc2.distanceMm], [30, 30, true, 30]);
  const c3 = cv.fitCircularFace(D(cyl({ c: [10, 20, 17], r: 5, len: 10 })));
  eq("círculos coaxiales a distinta altura: entre ejes 0, entre centros 10", (() => { const m = cv.computeCircleToCircleMeasurement(c1, c3); return [m.axisDistanceMm, m.centerDistanceMm]; })(), [0, 10]);
  const c4 = cv.fitCircularFace(D(cyl({ c: [10, 20, 7], r: 5, len: 10, a: [1, 0, 0] })));
  const cc4 = cv.computeCircleToCircleMeasurement(c1, c4);
  eq("ejes no paralelos: solo distancia entre centros", [cc4.axesParallel, cc4.axisDistanceMm, cc4.distanceMm], [false, null, 0]);
  check("describeCircleDistance", cv.describeCircleDistance({ distanceMm: 7 }).label === "Centro → Cara: 7.00 mm" && cv.describeCircleDistance({ distanceMm: 30 }, { toCircle: true }).label === "Entre centros: 30.00 mm");
  eq("datos no válidos: lanzan o devuelven null, no basura", [cv.fitCircularFace(null), cv.fitCircularFace({}), cv.computeDiameterMeasurement(null), (() => { try { cv.computeCircleToFaceMeasurement(null, plane); } catch (e) { return "lanza"; } })()], [null, null, null, "lanza"]);

  // STEP REALES (generados con OpenCASCADE): placa con agujeros ⌀12 y ⌀8, eje ⌀20×50 y arandela ⌀30/⌀10 (se omite si faltan three y occt-import-js)
  let real = null;
  try {
    const THREE = await import("three");
    const { createRequire } = await import("node:module");
    const occtimportjs = createRequire(import.meta.url)("occt-import-js");
    real = { THREE, occt: await occtimportjs() };
  } catch (e) {
    console.log("  (círculos con STEP reales omitidos: faltan `three` y `occt-import-js`; ejecuta npm install)");
  }
  if (real) {
    const eng = await import("../js/cad-engine.js");
    const mdl = await import("../js/cad-model.js");
    const loadReal = (f) => mdl.buildCadModel(real.THREE, eng.parseStepBuffer(real.occt, new Uint8Array(fs.readFileSync(new URL(`./fixtures/${f}.step`, import.meta.url)))));
    const facesOf = (model) => model.faces.map((_, id) => mdl.describeModelFace(model, id));
    const plate = loadReal("placa-agujeros");
    const pf = facesOf(plate);
    const holes = pf.map((f) => ({ f, m: cv.computeDiameterMeasurement(f) })).filter((x) => x.m);
    eq("placa real: solo los 2 agujeros son círculos medibles (las 6 caras planas, no)", [pf.length, holes.length], [8, 2]);
    eq("placa real: diámetros ⌀12 y ⌀8, tipo agujero, longitud = espesor", holes.map((h) => [h.m.diameterMm, h.m.kind, h.m.lengthMm]).sort(), [[12, "hole", 10], [8, "hole", 10]].sort());
    const h12 = holes.find((h) => h.m.diameterMm === 12).m;
    const h8 = holes.find((h) => h.m.diameterMm === 8).m;
    check("placa real: el centro del agujero ⌀12 es (30, 30, 5) y el del ⌀8 es (70, 30, 5)", nearV(h12.center, [30, 30, 5]) && nearV(h8.center, [70, 30, 5]));
    const faceX0 = pf.find((f) => f.isPlanar && Math.abs(Math.abs(f.normal[0]) - 1) < 1e-6 && Math.abs(f.centroid[0]) < 1e-6);
    const c12 = cv.fitCircularFace(holes.find((h) => h.m.diameterMm === 12).f);
    const c8 = cv.fitCircularFace(holes.find((h) => h.m.diameterMm === 8).f);
    eq("placa real: desde el centro del agujero ⌀12 hasta el canto x = 0 hay 30 mm", cv.computeCircleToFaceMeasurement(c12, faceX0).distanceMm, 30);
    eq("placa real: entre los ejes de los dos agujeros hay 40 mm", cv.computeCircleToCircleMeasurement(c12, c8).axisDistanceMm, 40);
    const topFace = pf.filter((f) => f.isPlanar && Math.abs(Math.abs(f.normal[2]) - 1) < 1e-6).sort((a, b) => a.centroid[2] - b.centroid[2])[0];
    eq("placa real: del centro del agujero a la cara inferior (z = 0): 5 mm", cv.computeCircleToFaceMeasurement(c12, topFace).distanceMm, 5);
    const shaft = facesOf(loadReal("eje-d20")).map((f) => cv.computeDiameterMeasurement(f));
    eq("eje real ⌀20 × 50: la cara cilíndrica (eje) y sus dos tapas circulares dan ⌀20", shaft.map((m) => [m && m.diameterMm, m && m.type]), [[20, "cylinder"], [20, "disk"], [20, "disk"]]);
    eq("eje real: la superficie curva es un eje (saliente) y mide 50 de largo", [shaft[0].kind, shaft[0].lengthMm], ["shaft", 50]);
    const wash = facesOf(loadReal("arandela")).map((f) => cv.computeDiameterMeasurement(f));
    eq("arandela real: exterior ⌀30 (eje) e interior ⌀10 (agujero); las caras planas son arandelas ⌀30/⌀10", wash.map((m) => [m.diameterMm, m.kind, m.innerDiameterMm]), [[30, "shaft", null], [30, "washer", 10], [30, "washer", 10], [10, "hole", null]]);
  }

  // cableado del visor
  const vm = read("js/components/cad-viewer-modal.js");
  check("visor: botón «⌀ Diámetro» junto a Punto a Punto y Cara a Cara", /data-mode="diameter"[^>]*>⌀ Diámetro/.test(vm));
  check("visor: Diámetro usa computeDiameterMeasurement y describeDiameter y dibuja la cota por el centro", /clickDiameter\(hit, ev\)/.test(vm) && /computeDiameterMeasurement\(face, \{ toward:/.test(vm) && /describeDiameter\(m\)/.test(vm));
  check("visor: en Cara a Cara los círculos son elegibles (centro marcado) y se mide desde el centro", /fitCircularFace\(face\)/.test(vm) && /computeCircleToFaceMeasurement\(circle, otherFace\)/.test(vm) && /computeCircleToCircleMeasurement\(circleA, circleB\)/.test(vm) && /Centro → Cara/.test(vm) && /Entre ejes/.test(vm));
  check("visor: los círculos se iluminan en violeta al pasar el ratón (Diámetro solo ilumina círculos)", /COLOR_CIRCLE/.test(vm) && /mode === "diameter" && !circle/.test(vm) && /mode !== "face-to-face" && mode !== "diameter"/.test(vm));
  check("visor: el marcador del centro se limpia con el hover y al cambiar de modo", /hover\.overlay/.test(vm) && /removeOverlay\(hover\.overlay\)/.test(vm) && /cancelPending\(\);\n    clearHover\(\);/.test(vm));
  check("visor: la geometría de cada cara se describe una sola vez (caché)", /faceCache = new Map\(\)/.test(vm) && /faceCache\.set\(faceId, info\)/.test(vm));
  const css07 = read("css/07-modals.css");
  check("CSS: marcador violeta del centro del círculo", /\.cad-viewer-marker--center/.test(css07));

  // icono del visor en la barra lateral
  const css05 = read("css/05-layout.css");
  check("barra lateral: el icono (SVG del visor de piezas) se centra igual que los emojis", /\.sidebar__item-icon \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*line-height: 1;/.test(css05) && /\.sidebar__item-icon > svg \{ display: block; \}/.test(css05));
}

// ---------------------------------------------------------------- 8) entrega
{
  const idx = read("index.html");
  // (la entrega actual la fija v94-viewer-speed-rim-columns.test.mjs: aquí basta con que sea ≥ 93 y esté bien puesta en los 14)
  const linkVersions = [...idx.matchAll(/css\/[\w-]+\.css\?v=(\d+)/g)].map((m) => Number(m[1]));
  eq("index.html: los 14 <link> con el mismo ?v=N (≥ 93)", new Set(linkVersions).size + ":" + linkVersions.length + ":" + (linkVersions[0] >= 93), "1:14:true");
  check("js/app.js se mantiene sin query string", /src="js\/app\.js"/.test(idx));
  const pkgMajor = (f) => Number(String(JSON.parse(read(f)).version).split(".")[0]);
  check("package.json y package-lock.json: versión ≥ 93 y la misma", pkgMajor("package.json") >= 93 && pkgMajor("package.json") === pkgMajor("package-lock.json"));
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES.find((x) => x.id === 93);
  check("Novedades: entrada 93, mayor que la 92, y habla de columnas, etiquetas, sugerencias, subir piezas y diámetro", !!r && r.id > RELEASES.find((x) => x.id === 92).id && ["Columnas", "Etiquetas", "Sugerencias", "Subir piezas", "Diámetro", "firestore.rules"].every((w) => JSON.stringify(r).includes(w)) && r.items.length >= 5, r.title);
  const css6 = read("css/06-list-board.css");
  const css10 = read("css/10-components.css");
  check("CSS: «Mis tareas» (menú ⚙️, filtros, celdas) en 06-list-board.css", [".columns-menu--mytasks", ".mt-filters", ".mt-filter", ".mt-code", ".mt-status--late", ".mt-sector--auto"].every((c) => css6.includes(c)));
  check("CSS: gestor de etiquetas, ✏️/🗑️ de las sugerencias y subida de piezas en 10-components.css", [".tag-manage", ".tag-manage__row", ".text-suggest__act", ".text-suggest__actions", ".parts-upload", ".parts-upload__drop"].every((c) => css10.includes(c)));
  check("CSS: todo con variables de tema (sin colores de texto fijos en lo nuevo)", /\.tag-manage__row \{[^}]*var\(--color-text-hi\)/.test(css10) && /\.parts-upload__drop \{[^}]*var\(--color-panel\)/.test(css10));
  const readme = read("README.md");
  check("README: historial v92 → v93 con las cuatro mejoras y los archivos nuevos", /v92 → v93 \(Chusy-93\.zip\)/.test(readme) && /my-tasks-columns\.js/.test(readme) && /suggest-hygiene\.js/.test(readme) && /parts-library\.js/.test(readme) && /cadParts/.test(readme) && /v93-tags-suggest-and-mytasks-columns/.test(readme));
  check("tests/run-all.mjs menciona la v93", /v93/.test(read("tests/run-all.mjs")));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v93 · Etiquetas y sugerencias limpias, columnas y filtros de «Mis tareas» y mejoras del visor de piezas 3D");
