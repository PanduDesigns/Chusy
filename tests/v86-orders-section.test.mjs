// v86 · sección «Pedidos», trazabilidad de compras y búsqueda instantánea.
//  1) Modelo: Proveedor / Nº de pedido / Código Proveedor en la etapa purchase (y solo en ella) y su copia en la tarea.
//  2) «Pedidos»: qué tareas han llegado a Compra/Pedido y en qué bloque cae cada una.
//  3) Persistencia y sugerencias de Proveedor (memoria sin duplicados, registro de fuentes, escritura real a Firestore falso).
//  4) Filtrado combinado por Comercial / Proyecto / Proveedor / Sector / Responsable.
//  5) Búsqueda instantánea por Nº de pedido, Código Proveedor, tarea y proyecto.
//  6) Permisos de visibilidad de «Pedidos» por departamento (lógica, barra lateral y modal de accesos).
//  7) Interfaz con jsdom: modal de tarea, ventana de relevo y vista «Pedidos» (la búsqueda filtra al teclear).
//  8) Entrega: CSS, ?v=86, package.json, Novedades, README y reglas.
import fs from "node:fs";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
freezeNow("2026-11-06T10:00:00"); // viernes

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const typeInto = (el, value) => { el.value = value; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
globalThis.__fb = { collections: {}, sets: [], hooks: {} };

const ws = await import("../js/workflow-stages.js");
const orders = await import("../js/orders.js");
const dep = await import("../js/departments.js");
const suggest = await import("../js/components/text-suggest.js");

const OFF = "OFFERS";
const members = [
  { uid: "disenador", name: "Diana", role: "member" },
  { uid: "compras", name: "Carlos", role: "member" },
  { uid: "taller", name: "Tomás", role: "member" },
];
const projects = [
  { id: "P1", name: "Cabina Talgo", code: "26001", color: "#FCD000", icon: "📁", properties: { comercial: "Juan Pérez", sector: "Industria" } },
  { id: "P2", name: "Línea Togg", code: "26002", color: "#3b82f6", icon: "🚗", properties: { comercial: "Marta Ruiz", sector: "Automoción" } },
  { id: "P3", name: "Horno Stelia", code: "26003", color: "#10b981", icon: "🔥", properties: { comercial: "juan  perez", sector: "Industria" } }, // el mismo comercial escrito distinto
  { id: OFF, name: "Ofertas", exclusive: true, icon: "💼" },
];

/** Una tarea con flujo; `purchase` lleva los datos de compra, `stage` en qué punto está. */
function task(id, projectId, title, { design = true, stage = "purchase", purchase = {}, isComplete = false, extra = {} } = {}) {
  const enabled = [design ? "design" : null, "purchase", "production"].filter(Boolean);
  let wf = ws.workflowFromEnabled(enabled, { purchase: { assigneeId: "compras", dueDate: "2026-11-12", ...purchase }, production: { assigneeId: "taller", dueDate: "2026-11-30" } });
  if (stage === "design") wf = { ...wf };
  if (stage !== "design" && design) wf = { ...wf, design: { ...wf.design, completed: true } };
  if (stage === "production" || stage === "done") wf = { ...wf, purchase: { ...wf.purchase, completed: true } };
  if (stage === "done") wf = { ...wf, production: { ...wf.production, completed: true } };
  return { id, projectId, title, workflow: wf, isComplete, assigneeIds: [], priority: "media", tags: [], ...ws.purchaseTraceFields(wf), ...extra };
}

// ---------------------------------------------------------------- 1) modelo
{
  const wf = ws.defaultWorkflow();
  eq("modelo: la etapa purchase lleva supplier, orderNumber y supplierCode", Object.keys(wf.purchase).sort(), ["assigneeId", "completed", "completedAt", "completedBy", "dueDate", "enabled", "note", "orderNumber", "startDate", "supplier", "supplierCode"]);
  eq("modelo: design y production conservan exactamente sus claves de siempre (sin campos de compra)", Object.keys(wf.design).sort(), ["assigneeId", "completed", "completedAt", "completedBy", "dueDate", "enabled", "note", "startDate"]);
  check("modelo: production tampoco los lleva", !("supplier" in wf.production) && !("orderNumber" in wf.production));

  const w2 = ws.updateStage(wf, "purchase", { supplier: "  Hidráulica   Sur ", orderNumber: "PO-2026/0012", supplierCode: "AB-77" });
  eq("updateStage: normaliza espacios y guarda los tres", ws.purchaseTrace(w2), { supplier: "Hidráulica Sur", orderNumber: "PO-2026/0012", supplierCode: "AB-77" });
  eq("updateStage: un número se guarda como texto", ws.purchaseTrace(ws.updateStage(wf, "purchase", { orderNumber: 4521 })).orderNumber, "4521");
  eq("updateStage: respeta el máximo (120 / 60 / 60)", [ws.purchaseTrace(ws.updateStage(wf, "purchase", { supplier: "x".repeat(300) })).supplier.length, ws.purchaseTrace(ws.updateStage(wf, "purchase", { orderNumber: "y".repeat(300) })).orderNumber.length], [120, 60]);
  check("updateStage: en design el patch de compra se ignora", !("supplier" in ws.updateStage(wf, "design", { supplier: "Nadie" }).design));
  eq("normalizeWorkflow: un flujo antiguo (sin los campos) sale con cadenas vacías", ws.purchaseTrace(ws.normalizeWorkflow({ purchase: { enabled: true } })), { supplier: "", orderNumber: "", supplierCode: "" });
  eq("normalizeWorkflow: basura (objetos, null) → cadenas vacías", ws.purchaseTrace(ws.normalizeWorkflow({ purchase: { enabled: true, supplier: { a: 1 }, orderNumber: null } })), { supplier: "", orderNumber: "", supplierCode: "" });

  const patch = ws.workflowTaskPatch(w2);
  check("workflowTaskPatch: copia supplier, orderNumber y supplierCode a la tarea", patch.supplier === "Hidráulica Sur" && patch.orderNumber === "PO-2026/0012" && patch.supplierCode === "AB-77", patch);
  const off = ws.workflowTaskPatch(ws.setStageEnabled(w2, "purchase", false));
  eq("workflowTaskPatch: con Compra/Pedido desmarcada la copia queda vacía", [off.supplier, off.orderNumber, off.supplierCode], ["", "", ""]);
  eq("… pero la etapa conserva sus datos por si se vuelve a marcar", ws.purchaseTrace(ws.setStageEnabled(ws.setStageEnabled(w2, "purchase", false), "purchase", true)).orderNumber, "PO-2026/0012");
  const dup = ws.resetWorkflow(w2);
  eq("resetWorkflow (duplicar): conserva el Proveedor pero NO el Nº de pedido ni el Código Proveedor", ws.purchaseTrace(dup), { supplier: "Hidráulica Sur", orderNumber: "", supplierCode: "" });
  check("hasPurchaseTrace: detecta datos en la etapa o en la copia", ws.hasPurchaseTrace({ workflow: w2 }) && ws.hasPurchaseTrace({ supplier: "X" }) && !ws.hasPurchaseTrace({ workflow: wf }) && !ws.hasPurchaseTrace(null));

  // relevo: al completar Compra/Pedido, el diálogo manda los tres campos
  let flow = ws.workflowFromEnabled(["purchase", "production"], { purchase: { assigneeId: "compras" } });
  const handoff = { assigneeId: "taller", startDate: "2026-11-09", dueDate: "2026-11-27", note: "", purchase: { supplier: " Aceros Norte ", orderNumber: "PO-1", supplierCode: "ALB-9" } };
  const res = ws.completeCurrentStage(flow, { userId: "compras", handoff });
  check("completeCurrentStage: el relevo de Compra guarda los tres campos en la etapa completada", res && ws.purchaseTrace(res.workflow).supplier === "Aceros Norte" && res.workflow.purchase.completed === true && ws.purchaseTrace(res.workflow).supplierCode === "ALB-9");
  const noPurchase = ws.completeCurrentStage(flow, { userId: "compras", handoff: { ...handoff, purchase: undefined } });
  eq("… sin `handoff.purchase` no borra lo que ya hubiera", ws.purchaseTrace(noPurchase.workflow), { supplier: "", orderNumber: "", supplierCode: "" });
  const prefilled = ws.updateStage(flow, "purchase", { supplier: "Previo", orderNumber: "PO-0" });
  eq("… ni lo pisa si no viene en el relevo", ws.purchaseTrace(ws.completeCurrentStage(prefilled, { userId: "compras", handoff: { ...handoff, purchase: undefined } }).workflow).supplier, "Previo");
  const adv = ws.advanceTaskPatch({ id: "T", projectId: "P1", workflow: ws.updateStage(flow, "purchase", {}), isComplete: false }, { userId: "compras", handoff, offersProjectId: OFF });
  check("advanceTaskPatch: el parche incluye la copia de la tarea (supplier/orderNumber/supplierCode)", adv && adv.patch.supplier === "Aceros Norte" && adv.patch.orderNumber === "PO-1" && adv.patch.supplierCode === "ALB-9", adv && adv.patch);
}

// ---------------------------------------------------------------- 2) qué tareas son pedidos y en qué bloque
{
  const S = (t) => orders.orderStatus(t, OFF);
  eq("sin etapa de Diseño: entra directamente, pendiente de pedir", S(task("a", "P1", "A", { design: false })), "pending");
  eq("con Diseño sin completar: NO ha llegado a Compra/Pedido", S(task("b", "P1", "B", { stage: "design" })), null);
  eq("con Diseño completado: pendiente de pedir", S(task("c", "P1", "C")), "pending");
  eq("Compra completada y en Recepción/Fab.: pedido realizado", S(task("d", "P1", "D", { stage: "production" })), "placed");
  eq("Recepción/Fab. completada: completado/recibido", S(task("e", "P1", "E", { stage: "done" })), "done");
  eq("tarea completada: completado/recibido", S(task("f", "P1", "F", { stage: "done", isComplete: true })), "done");
  const noPurchaseWf = ws.workflowFromEnabled(["design", "production"]);
  eq("sin etapa de Compra/Pedido habilitada: no es un pedido", S({ id: "g", projectId: "P1", workflow: noPurchaseWf }), null);
  eq("sin flujo (tarea antigua): no es un pedido", S({ id: "h", projectId: "P1", title: "Vieja" }), null);
  eq("tarea personal: no es un pedido", S({ id: "i", projectId: null, workflow: ws.defaultWorkflow() }), null);
  eq("tarea de Ofertas: no es un pedido", S({ id: "j", projectId: OFF, workflow: ws.defaultWorkflow() }), null);
  const lastPurchase = ws.workflowFromEnabled(["purchase"], { purchase: { assigneeId: "compras" } });
  eq("Compra/Pedido como última etapa y completada: completado", S({ id: "k", projectId: "P1", workflow: { ...lastPurchase, purchase: { ...lastPurchase.purchase, completed: true } } }), "done");
  check("isOrderTask coincide con orderStatus", orders.isOrderTask(task("c", "P1", "C"), OFF) && !orders.isOrderTask(task("b", "P1", "B", { stage: "design" }), OFF));

  const tasks = [
    task("t1", "P1", "Cilindro", { purchase: { supplier: "Hidráulica Sur", orderNumber: "PO-2026/0012", supplierCode: "AB-77" } }),
    task("t2", "P2", "Motor", { stage: "production", purchase: { supplier: "Aceros Norte", orderNumber: "PO-2026/0013", supplierCode: "ALB-9" } }),
    task("t3", "P3", "Quemador", { stage: "done", purchase: { supplier: "hidráulica sur", orderNumber: "PO-2026/0014", supplierCode: "ZX-1" } }),
    task("t4", "P1", "Pendiente de diseño", { stage: "design" }),
    task("t5", "ARCH", "De un proyecto archivado"),
    { id: "t6", projectId: OFF, title: "Oferta", workflow: ws.defaultWorkflow() },
    task("t1", "P1", "Cilindro (repetida)"),
  ];
  const ctx = { projects, members, offersProjectId: OFF };
  const rows = orders.collectOrderRows(tasks, ctx);
  eq("collectOrderRows: solo los 3 pedidos de proyectos activos, sin repetir", rows.map((r) => r.id), ["t1", "t2", "t3"]);
  eq("countOrdersByStatus", orders.countOrdersByStatus(rows), { pending: 1, placed: 1, done: 1 });
  eq("pendingOrdersCount (contador de la barra lateral)", orders.pendingOrdersCount(tasks, ctx), 1);
  check("un proyecto archivado (fuera de la lista) no cuenta", !rows.some((r) => r.id === "t5"));
  const r1 = rows[0];
  check("fila: proyecto con código, Comercial heredado del proyecto, responsable de Compra y los tres datos", r1.projectCode === "26001" && r1.projectName === "Cabina Talgo" && r1.commercial === "Juan Pérez" && r1.buyerName === "Carlos" && r1.supplier === "Hidráulica Sur" && r1.orderNumber === "PO-2026/0012" && r1.supplierCode === "AB-77", r1);
  eq("fila: el plazo es el de Compra/Pedido (pendiente), la fecha prevista de recepción (realizado)", [rows[0].deadline, rows[1].deadline], ["2026-11-12", "2026-11-30"]);
  eq("fila: el sector sale de las propiedades del proyecto", rows.map((r) => r.sector), ["industria", "automocion", "industria"]);
  const grouped = orders.groupOrdersByStatus(rows);
  eq("groupOrdersByStatus", [grouped.pending.length, grouped.placed.length, grouped.done.length], [1, 1, 1]);
  // la copia de la tarea sirve si la etapa no trae el dato (datos antiguos o migrados)
  const legacy = { ...task("t7", "P1", "Copia sola"), supplier: "Solo en la copia", orderNumber: "PO-7" };
  eq("fila: si la etapa no trae el dato, se lee la copia de la tarea", [orders.collectOrderRows([legacy], ctx)[0].supplier, orders.collectOrderRows([legacy], ctx)[0].orderNumber], ["Solo en la copia", "PO-7"]);
  check("ORDER_TABS tiene los 3 bloques con sus nombres", orders.ORDER_TABS.map((t) => t.label).join("|") === "Pendientes de pedir|Pedidos realizados|Completados / Recibidos");

  // ------------------------------------------------------------ 3) sugerencias de Proveedor
  const opts = orders.collectSupplierOptions([...tasks, { id: "x", supplier: "ACEROS NORTE" }, { id: "y", workflow: { purchase: { supplier: "  " } } }, null]);
  eq("collectSupplierOptions: únicos (sin distinguir mayúsculas ni tildes), ordenados", opts, ["Aceros Norte", "Hidráulica Sur"]);
  eq("collectSupplierOptions: sin tareas → vacío", orders.collectSupplierOptions([]), []);
  suggest.setSuggestProvider("supplier", () => opts);
  eq("registro de sugerencias: getSuggestOptions('supplier')", suggest.getSuggestOptions("supplier"), ["Aceros Norte", "Hidráulica Sur"]);
  eq("… un nombre sin registrar da lista vacía", suggest.getSuggestOptions("nada"), []);
  suggest.setSuggestProvider("rota", () => { throw new Error("boom"); });
  const realErr = console.error; console.error = () => {};
  eq("… una fuente que falla da lista vacía (no rompe el campo)", suggest.getSuggestOptions("rota"), []);
  console.error = realErr;

  // ---------------------------------------------------------- 4) filtros combinados
  const A = orders.applyOrderFilters;
  const f = (o) => A(rows, o).map((r) => r.id);
  eq("sin filtros: todo", f({}), ["t1", "t2", "t3"]);
  eq("Comercial (sin distinguir mayúsculas ni espacios: «Juan Pérez» = «juan  perez»)", f({ commercial: "Juan Pérez" }), ["t1", "t3"]);
  eq("Proyecto", f({ projectId: "P2" }), ["t2"]);
  eq("Proveedor (sin distinguir mayúsculas ni tildes)", f({ supplier: "Hidráulica Sur" }), ["t1", "t3"]);
  eq("Sector Industria", f({ sector: "industria" }), ["t1", "t3"]);
  eq("Sector Automoción", f({ sector: "automocion" }), ["t2"]);
  eq("Responsable (de Compra)", f({ assigneeId: "compras" }), ["t1", "t2", "t3"]);
  eq("Responsable sin tareas", f({ assigneeId: "taller" }), []);
  eq("combinado Comercial + Proveedor", f({ commercial: "Juan Pérez", supplier: "Hidráulica Sur" }), ["t1", "t3"]);
  eq("combinado Comercial + Proveedor + Proyecto", f({ commercial: "Juan Pérez", supplier: "Hidráulica Sur", projectId: "P3" }), ["t3"]);
  eq("combinado que no coincide con nada", f({ commercial: "Marta Ruiz", supplier: "Hidráulica Sur" }), []);
  eq("combinado con Sector y texto", f({ sector: "industria", search: "0014" }), ["t3"]);
  check("hasActiveOrderFilters", !orders.hasActiveOrderFilters({}) && orders.hasActiveOrderFilters({ supplier: "X" }) && orders.hasActiveOrderFilters({ search: " a " }) && !orders.hasActiveOrderFilters({ search: "   " }) && orders.hasActiveOrderFilters({ sector: "industria" }));
  const fo = orders.orderFilterOptions(rows);
  eq("opciones: Comercial únicos", fo.commercials, ["Juan Pérez", "Marta Ruiz"]);
  eq("opciones: Proveedor únicos", fo.suppliers, ["Aceros Norte", "Hidráulica Sur"]);
  eq("opciones: Proyectos con su código", fo.projects.map((p) => p.code), ["26001", "26002", "26003"]);
  eq("opciones: Responsables", fo.assignees, [{ uid: "compras", name: "Carlos" }]);

  // ---------------------------------------------------------- 5) búsqueda instantánea
  const s = (text) => A(rows, { search: text }).map((r) => r.id);
  eq("búsqueda: fragmento del Nº de pedido", s("0013"), ["t2"]);
  eq("búsqueda: fragmento más corto, varias coincidencias", s("2026/001"), ["t1", "t2", "t3"]);
  eq("búsqueda: fragmento del Código Proveedor", s("AB-7"), ["t1"]);
  eq("búsqueda: sin distinguir mayúsculas", s("alb-9"), ["t2"]);
  eq("búsqueda: sin guiones ni barras en los códigos («po20260014»)", s("po20260014"), ["t3"]);
  eq("búsqueda: «zx 1» (con espacio) encuentra «ZX-1»", s("zx 1"), ["t3"]);
  eq("búsqueda: por título de tarea, sin tildes", s("quemador"), ["t3"]);
  eq("búsqueda: por código de proyecto", s("26002"), ["t2"]);
  eq("búsqueda: por nombre de proyecto", s("togg"), ["t2"]);
  eq("búsqueda: nada que coincida", s("no-existe"), []);
  eq("búsqueda vacía o con solo espacios: todo", [s("").length, s("   ").length], [3, 3]);
  eq("la búsqueda NO mira el nombre del proveedor (solo lo que dice el rótulo)", s("Aceros"), []);
  const sorted = (col, dir) => orders.sortOrderRows(rows, col, dir).map((r) => r.id);
  eq("orden por Nº de pedido ascendente / descendente", [sorted("orderNumber", "asc"), sorted("orderNumber", "desc")], [["t1", "t2", "t3"], ["t3", "t2", "t1"]]);
  const withEmpty = [...rows, { ...rows[0], id: "t9", orderNumber: "" }];
  eq("orden: los vacíos van siempre al final (asc y desc)", [orders.sortOrderRows(withEmpty, "orderNumber", "asc").pop().id, orders.sortOrderRows(withEmpty, "orderNumber", "desc").pop().id], ["t9", "t9"]);
  eq("orden natural de códigos (PO-9 < PO-10)", orders.sortOrderRows([{ ...rows[0], id: "a", orderNumber: "PO-10" }, { ...rows[0], id: "b", orderNumber: "PO-9" }], "orderNumber").map((r) => r.id), ["b", "a"]);

  // ---------------------------------------------------------- 3b) persistencia real (Firestore falso)
  const writes = [];
  globalThis.__fb.hooks.updateDoc = async (ref, data) => { writes.push({ ref, data }); };
  const { updateOrderTrace } = await import("../js/data/tasks.js");
  const base = task("w1", "P1", "Escribir", { purchase: { supplier: "Viejo", orderNumber: "PO-OLD" } });
  const out = await updateOrderTrace(base, { supplier: "  Nuevo   Proveedor ", orderNumber: "PO-NEW" });
  const w = writes[0] && writes[0].data;
  check("updateOrderTrace escribe en la tarea correcta", writes[0] && writes[0].ref.path === "tasks/w1" || writes[0].ref.id === "w1", writes[0] && writes[0].ref);
  check("… etapa (workflow.purchase) y copia a la vez, ya normalizados", w && w.workflow.purchase.supplier === "Nuevo Proveedor" && w.supplier === "Nuevo Proveedor" && w.workflow.purchase.orderNumber === "PO-NEW" && w.orderNumber === "PO-NEW", w);
  check("… sin tocar responsable, fechas ni asignados", w && !("assigneeIds" in w) && !("dueDate" in w) && w.workflow.purchase.assigneeId === "compras" && w.workflow.purchase.dueDate === "2026-11-12");
  check("… devuelve lo escrito", out && out.patch.supplier === "Nuevo Proveedor");
  eq("updateOrderTrace en una tarea sin Compra/Pedido no escribe nada", [await updateOrderTrace({ id: "n", projectId: "P1", workflow: ws.workflowFromEnabled(["design"]) }, { supplier: "X" }), writes.length], [null, 1]);
  // la tarea reescrita sigue siendo un pedido con los datos nuevos (ida y vuelta)
  const after = { ...base, workflow: w.workflow, supplier: w.supplier, orderNumber: w.orderNumber };
  eq("ida y vuelta: la fila refleja lo guardado", [orders.collectOrderRows([after], ctx)[0].supplier, orders.collectOrderRows([after], ctx)[0].orderNumber], ["Nuevo Proveedor", "PO-NEW"]);
  const created = [];
  globalThis.__fb.hooks.addDoc = async (_c, data) => { created.push(data); return { id: "new1" }; };
  const { createTask } = await import("../js/data/tasks.js");
  const wfNew = ws.updateStage(ws.defaultWorkflow(), "purchase", { supplier: "Prov", orderNumber: "PO-5", supplierCode: "C-5" });
  await createTask("P1", { title: "Nueva", sectionId: "s1", ...ws.workflowTaskPatch(wfNew) });
  check("createTask guarda la copia supplier / orderNumber / supplierCode", created[0] && created[0].supplier === "Prov" && created[0].orderNumber === "PO-5" && created[0].supplierCode === "C-5" && created[0].workflow.purchase.supplier === "Prov", created[0] && { s: created[0].supplier, o: created[0].orderNumber });
  delete globalThis.__fb.hooks.addDoc;
}

// ---------------------------------------------------------------- 6) permisos por departamento
{
  eq("sin configurar: por defecto los Técnicos", dep.normalizeOrdersAllowed(null), ["tecnicos"]);
  eq("documento sin lista: por defecto", dep.normalizeOrdersAllowed({}), ["tecnicos"]);
  eq("configurado: solo valores conocidos y sin repetir", dep.normalizeOrdersAllowed({ allowedDepartments: ["produccion", "produccion", "inventado", 7, "tecnicos"] }), ["produccion", "tecnicos"]);
  eq("configurado vacío: nadie salvo admins", dep.normalizeOrdersAllowed({ allowedDepartments: [] }), []);
  const U = (role, department) => ({ uid: "u", role, department });
  const def = dep.normalizeOrdersAllowed(null);
  check("admin: siempre, aunque no esté en la lista ni tenga departamento", dep.canViewOrders(U("admin", null), []) && dep.canViewOrders(U("admin", "produccion"), ["diseno"]));
  check("por defecto: Técnicos sí; Producción, Diseño y sin departamento no", dep.canViewOrders(U("member", "tecnicos"), def) && !dep.canViewOrders(U("member", "produccion"), def) && !dep.canViewOrders(U("member", "diseno-industria"), def) && !dep.canViewOrders(U("member", null), def));
  check("el grupo «Diseño» incluye a Diseño - Industria y Diseño - Automoción", dep.canViewOrders(U("member", "diseno-industria"), ["diseno"]) && dep.canViewOrders(U("member", "diseno-automocion"), ["diseno"]));
  check("un Revisor se rige por su departamento, como un miembro", dep.canViewOrders(U("revisor", "tecnicos"), def) && !dep.canViewOrders(U("revisor", "produccion"), def));
  check("sin sesión: no", !dep.canViewOrders(null, def));
  check("lista no válida → el valor por defecto", dep.canViewOrders(U("member", "tecnicos"), undefined));
  check("lista vacía: un miembro de Técnicos ya no entra", !dep.canViewOrders(U("member", "tecnicos"), []));

  // barra lateral
  const { renderSidebar } = await import("../js/components/sidebar.js");
  const user = { uid: "u1", name: "Ramón", email: "r@x.es", role: "member", department: "tecnicos" };
  const sbBase = (over = {}) => ({
    projects: [projects[0]], currentProjectId: null, isMyTasksActive: false, isTimelineActive: false, isArchiveActive: false, isTrashActive: false, myTasksCount: 0,
    userProfile: user, isCollapsed: false, onToggleCollapse() {}, isNavCollapsed: false, onToggleNav() {}, sectorFilter: "todos", onSectorFilterChange() {},
    onSelectProject() {}, onSelectMyTasks() {}, onSelectTimeline() {}, onSelectArchive() {}, onSelectTrash() {}, onSelectMetrics() {}, onCreateProject() {}, onOpenSearch() {},
    onOpenAccount() {}, onOpenWhatsNew() {}, onOpenTeamAdmin() {}, onOpenDepartmentAccess() {}, onOpenWorkCalendar() {}, onOpenOutlookBridge() {}, onOpenDriveStorage() {},
    onOpenAsanaImport() {}, onOpenQuickCreateAdmin() {}, onOpenProjectProperties() {}, onLogout() {}, ...over,
  });
  const side = document.createElement("aside"); side.className = "sidebar"; document.body.appendChild(side);
  renderSidebar(side, sbBase({ showOrders: false, ordersPendingCount: 4 }));
  check("barra lateral: sin permiso no hay botón «Pedidos» ni contador", !$("#btn-orders", side) && !$("#orders-count", side));
  let went = 0;
  renderSidebar(side, sbBase({ showOrders: true, ordersPendingCount: 4, onSelectOrders: () => went++ }));
  const btn = $("#btn-orders", side);
  check("barra lateral: con permiso sale «Pedidos» con el icono 📦 y el contador de pendientes", btn && /Pedidos/.test(btn.textContent) && btn.textContent.includes("📦") && $("#orders-count", side).textContent === "4");
  click(btn);
  eq("… y al hacer clic va a «Pedidos»", went, 1);
  check("… está en el bloque de navegación, junto a las demás secciones fijas", btn.parentElement.classList.contains("sidebar__nav-items") || !!btn.closest(".sidebar__nav"));
  renderSidebar(side, sbBase({ showOrders: true, ordersPendingCount: 0, isOrdersActive: true }));
  check("contador a cero: no se pinta; sección activa marcada", !$("#orders-count", side) && $("#btn-orders", side).classList.contains("is-active"));

  // modal de accesos por departamento
  const { openDepartmentAccessModal } = await import("../js/components/department-access-modal.js");
  const sets = [];
  globalThis.__fb.hooks.setDoc = async (ref, data) => { sets.push({ ref, data }); };
  openDepartmentAccessModal({ exclusiveProjects: [{ id: OFF, name: "Ofertas", icon: "💼", color: "#8B85C4", allowedDepartments: ["diseno"] }], ordersAccess: ["tecnicos"], currentUser: { uid: "admin1" } });
  await tick(5);
  const card = $('[data-da-card="orders"]');
  check("modal de accesos: tarjeta «Pedidos» junto a Ofertas con las mismas casillas", card && /Pedidos/.test(card.textContent) && $$("input[type=checkbox]", card).length === dep.DEPARTMENT_GROUPS.length && $$("input[type=checkbox]").length === dep.DEPARTMENT_GROUPS.length * 2);
  const checked = (c) => $$("input[type=checkbox]", c).filter((i) => i.checked).map((i) => i.dataset.dept);
  eq("… marcada por defecto solo Técnicos", checked(card), ["tecnicos"]);
  const prod = $$("input[type=checkbox]", card).find((i) => i.dataset.dept === "produccion");
  prod.checked = true; fire(prod, "change");
  await tick(10);
  check("… marcar Producción guarda meta/ordersAccess con Técnicos + Producción y quién lo hizo", sets.length === 1 && sets[0].ref.path === "meta/ordersAccess" && JSON.stringify(sets[0].data.allowedDepartments.sort()) === JSON.stringify(["produccion", "tecnicos"]) && sets[0].data.updatedBy === "admin1", sets[0]);
  document.querySelector("#close")?.click();
  delete globalThis.__fb.hooks.setDoc;
}

// ---------------------------------------------------------------- 7) interfaz con jsdom
{
  // modal de tarea: sub-fila de Compra/Pedido
  const { openTaskModal } = await import("../js/components/task-modal.js");
  const project = { id: "P1", name: "Cabina Talgo", sections: [{ id: "s1", name: "S", order: 0 }] };
  suggest.setSuggestProvider("supplier", () => ["Aceros Norte", "Hidráulica Sur"]);
  openTaskModal({ project, teamMembers: members, allProjects: [project], tagsRegistry: [], currentUserProfile: { uid: "disenador", name: "Diana", role: "member" }, onSaved() {}, onClosed() {} });
  await tick(20);
  const purchaseRow = $$(".wf-row").find((r) => /Compra/.test($(".wf-row__name", r).textContent));
  const trace = purchaseRow && $("[data-wf-trace-row]", purchaseRow);
  check("modal de tarea: la etapa Compra/Pedido lleva la sub-fila de datos de compra", !!trace);
  eq("… con los tres inputs en orden: Proveedor, Nº de pedido, Código Proveedor", $$("[data-wf-trace]", trace).map((i) => i.dataset.wfTrace), ["supplier", "orderNumber", "supplierCode"]);
  eq("… y sus rótulos", $$(".wf-trace__label", trace).map((l) => l.textContent), ["Proveedor", "Nº de pedido", "Código Proveedor"]);
  check("… Diseño y Recepción/Fab. no la llevan", $$(".wf-row").filter((r) => $("[data-wf-trace-row]", r)).length === 1);
  const sup = $('[data-wf-trace="supplier"]', trace);
  typeInto(sup, "Hidr");
  await tick(5);
  const list = document.querySelector(".text-suggest");
  check("… «Proveedor» enseña las sugerencias de los ya usados", !!list && /Hidráulica Sur/.test(list.textContent) && !/Aceros/.test(list.textContent), list && list.textContent);
  typeInto($('[data-wf-trace="orderNumber"]', trace), "PO-9");
  // al desmarcar Compra/Pedido los campos desaparecen
  const purchaseCheck = $$("input[type=checkbox]").find((c) => c.dataset && c.dataset.wfEnable === "purchase");
  check("… el interruptor de la etapa existe", !!purchaseCheck);
  if (purchaseCheck) { purchaseCheck.checked = false; fire(purchaseCheck, "change"); }
  await tick(10);
  check("… al desmarcar Compra/Pedido, los tres campos se ocultan", !$("[data-wf-trace-row]"));
  if (purchaseCheck) { const again = $$("input[type=checkbox]").find((c) => c.dataset && c.dataset.wfEnable === "purchase"); again.checked = true; fire(again, "change"); await tick(10); }
  check("… y al volver a marcarla reaparecen con lo que se había escrito (PO-9)", $('[data-wf-trace="orderNumber"]') && $('[data-wf-trace="orderNumber"]').value === "PO-9", $('[data-wf-trace="orderNumber"]') && $('[data-wf-trace="orderNumber"]').value);
  globalThis.confirm = () => true;
  document.querySelector("#t-cancel").click();
  await tick(5);

  // ventana de relevo Compra → Recepción
  const { openStageHandoffDialog } = await import("../js/components/stage-handoff.js");
  const wfH = ws.updateStage(ws.workflowFromEnabled(["purchase", "production"], { purchase: { assigneeId: "compras" } }), "purchase", { supplier: "Aceros Norte", orderNumber: "PO-77" });
  const p1 = openStageHandoffDialog({ workflow: wfH, from: "purchase", to: "production", taskTitle: "Motor", teamMembers: members, today: "2026-11-06", projectName: "Cabina Talgo" });
  await tick(5);
  const tr = $("[data-handoff-trace]");
  check("relevo Compra → Recepción: lleva Proveedor, Nº de pedido y Código Proveedor", !!tr && !!$("#sh-supplier") && !!$("#sh-order") && !!$("#sh-supcode"));
  eq("… precargados con lo que ya estaba escrito", [$("#sh-supplier").value, $("#sh-order").value, $("#sh-supcode").value], ["Aceros Norte", "PO-77", ""]);
  typeInto($("#sh-supcode"), "ALB-9");
  fire($("#sh-supplier"), "focus");
  const whoSel = $("#sh-who"); whoSel.value = "taller"; fire(whoSel, "change");
  const due = $("#sh-due"); due.value = "2026-11-27"; fire(due, "change");
  click($("#sh-ok"));
  const hand = await p1;
  check("… al confirmar, el relevo devuelve los tres campos junto a la fecha prevista", hand && hand.dueDate === "2026-11-27" && hand.assigneeId === "taller" && hand.purchase && hand.purchase.supplier === "Aceros Norte" && hand.purchase.orderNumber === "PO-77" && hand.purchase.supplierCode === "ALB-9", hand);
  const p2 = openStageHandoffDialog({ workflow: ws.workflowFromEnabled(["design", "purchase"], {}), from: "design", to: "purchase", taskTitle: "X", teamMembers: members, today: "2026-11-06", projectName: "P" });
  await tick(5);
  check("relevo Diseño → Compra: NO lleva los campos de compra", !$("[data-handoff-trace]") && !$("#sh-supplier"));
  click($("#sh-cancel")); await p2;

  // vista «Pedidos»
  const { renderOrdersView } = await import("../js/views/orders-view.js");
  const tasks = [
    task("t1", "P1", "Cilindro hidráulico", { purchase: { supplier: "Hidráulica Sur", orderNumber: "PO-2026/0012", supplierCode: "AB-77" } }),
    task("t8", "P2", "Bomba de vacío", { purchase: { supplier: "Aceros Norte", orderNumber: "PO-2026/0020", supplierCode: "QQ-20" } }),
    task("t2", "P2", "Motor", { stage: "production", purchase: { supplier: "Aceros Norte", orderNumber: "PO-2026/0013", supplierCode: "ALB-9" } }),
    task("t3", "P3", "Quemador", { stage: "done", purchase: { supplier: "Hidráulica Sur", orderNumber: "PO-2026/0014", supplierCode: "ZX-1" } }),
  ];
  const rows = orders.collectOrderRows(tasks, { projects, members, offersProjectId: OFF });
  const host = document.createElement("div"); document.body.appendChild(host);
  let saved = null;
  const opts = { rows, onStateChange: (st) => { saved = st; }, onOpenTask() {}, currentUser: { uid: "compras", name: "Carlos", role: "member" }, teamMembers: members, projects };
  renderOrdersView(host, { ...opts, state: orders.emptyOrdersState() });
  const tabText = () => $$(".orders-tab", host).map((t) => `${$(".orders-tab__name", t).textContent}:${$(".orders-tab__count", t).textContent}`);
  eq("vista: tres pestañas con su contador", tabText(), ["Pendientes de pedir:2", "Pedidos realizados:1", "Completados / Recibidos:1"]);
  const search = $("#orders-search", host);
  check("vista: la búsqueda es un <input type=search> con el texto de ayuda pedido", search.tagName === "INPUT" && search.type === "search" && search.placeholder === "Buscar por Nº de pedido, Código proveedor o tarea...");
  check("vista: lupa y botón × (oculto mientras no hay texto)", !!$(".orders-search__icon", host) && $("#orders-search-clear", host).hidden === true);
  eq("vista: Comercial, Proyecto, Proveedor, Sector y Responsable son desplegables <select>", ["of-commercial", "of-project", "of-supplier", "of-sector", "of-assignee"].map((id) => $("#" + id, host).tagName), Array(5).fill("SELECT"));
  eq("vista: el Sector ofrece Todos / Industria / Automoción", $$("#of-sector option", host).map((o) => o.textContent), ["Todos", "Industria", "Automoción"]);
  const rowsShown = () => $$(".orders-row", host).map((r) => r.dataset.taskId);
  eq("pestaña «Pendientes»: sus dos pedidos", rowsShown().sort(), ["t1", "t8"]);
  const first = $(".orders-row", host);
  const cells = first.textContent;
  check("fila: proyecto con código, comercial y responsable de Compra", /26001/.test(cells) && /Cabina Talgo/.test(cells) && /Juan Pérez/.test(cells) && /Carlos/.test(cells), cells);
  check("fila: Proveedor, Nº de pedido y Código Proveedor son campos editables", $$(".orders-input", first).length === 3 && $$(".orders-input", first).map((i) => i.value).join("|") === "Hidráulica Sur|PO-2026/0012|AB-77");
  check("fila: lleva el check que completa la etapa", !!$("[data-check]", first));

  // búsqueda INSTANTÁNEA: sin esperar, en cada pulsación
  typeInto($("#orders-search", host), "0020");
  eq("búsqueda al teclear «0020»: solo la bomba, en el mismo instante", rowsShown(), ["t8"]);
  check("… aparece el botón × y se avisa del filtro", $("#orders-search-clear", host).hidden === false && $("#of-clear", host).hidden === false);
  eq("… los contadores de las pestañas siguen la búsqueda", tabText(), ["Pendientes de pedir:1", "Pedidos realizados:0", "Completados / Recibidos:0"]);
  check("… el cuadro conserva el foco y lo escrito (la cabecera no se repinta)", $("#orders-search", host) === search && search.value === "0020");
  typeInto(search, "alb-9");
  check("búsqueda por Código Proveedor que está en OTRO bloque: este queda vacío y se ofrece el atajo", $$(".orders-row", host).length === 0 && /Pedidos realizados \(1\)/.test($(".orders-empty", host).textContent));
  click($("[data-goto-tab=placed]", host));
  eq("… el atajo lleva a «Pedidos realizados» con ese pedido", rowsShown(), ["t2"]);
  check("… el estado se comunica a quien lo guarda (pestaña y texto)", saved && saved.tab === "placed" && saved.filters.search === "alb-9", saved);
  click($("#orders-search-clear", host));
  check("× limpia la búsqueda y devuelve el foco al cuadro", search.value === "" && document.activeElement === search && $("#orders-search-clear", host).hidden === true);
  click($$(".orders-tab", host)[0]);
  typeInto(search, "bomba");
  eq("búsqueda por título de tarea", rowsShown(), ["t8"]);
  typeInto(search, "26001");
  eq("búsqueda por código de proyecto", rowsShown(), ["t1"]);
  typeInto(search, "");
  // filtros combinados en la interfaz
  const pick = (id, value) => { const s = $("#" + id, host); s.value = value; fire(s, "change"); };
  pick("of-supplier", "Aceros Norte");
  eq("filtro Proveedor", rowsShown(), ["t8"]);
  pick("of-commercial", "Juan Pérez");
  eq("Proveedor + Comercial incompatibles → vacío", rowsShown(), []);
  click($("#of-clear", host));
  eq("«Limpiar filtros» restablece todo (y los desplegables a «Todos»)", [rowsShown().sort().join(), $("#of-supplier", host).value, $("#orders-search", host).value], ["t1,t8", "", ""]);
  pick("of-sector", "automocion");
  eq("filtro Sector Automoción", rowsShown(), ["t8"]);
  pick("of-sector", "todos");

  // repintado con foco en un campo de la fila (llega un dato de Firestore mientras se escribe)
  const inp = $('.orders-input[data-task="t1"][data-trace="orderNumber"]', host);
  inp.focus(); inp.value = "PO-2026/0012-B";
  renderOrdersView(host, { ...opts, state: saved });
  const inp2 = $('.orders-input[data-task="t1"][data-trace="orderNumber"]', host);
  check("repintar con un campo a medio escribir conserva foco y texto", document.activeElement === inp2 && inp2.value === "PO-2026/0012-B", inp2.value);

  // edición en línea → Firestore
  const writes = [];
  globalThis.__fb.hooks.updateDoc = async (ref, data) => { writes.push({ ref, data }); };
  const sup1 = $('.orders-input[data-task="t1"][data-trace="supplierCode"]', host);
  sup1.value = "  NUEVO-1 "; fire(sup1, "change");
  await tick(20);
  check("edición en línea: el Código Proveedor se guarda en la etapa y en la copia", writes.length === 1 && writes[0].data.supplierCode === "NUEVO-1" && writes[0].data.workflow.purchase.supplierCode === "NUEVO-1", writes[0] && writes[0].data);
  const sup2 = $('.orders-input[data-task="t8"][data-trace="supplierCode"]', host);
  sup2.value = "  QQ-20 "; fire(sup2, "change");
  await tick(5);
  check("… un cambio que deja el mismo valor (solo espacios de más) no escribe", writes.length === 1);
  delete globalThis.__fb.hooks.updateDoc;

  // pestaña de completados
  click($$(".orders-tab", host)[2]);
  eq("pestaña «Completados / Recibidos»", rowsShown(), ["t3"]);
  check("… su check está marcado (permite devolver a la etapa anterior)", $(".task-row__check", host).classList.contains("is-checked"));
  // vacío
  renderOrdersView(host, { ...opts, rows: [], state: orders.emptyOrdersState() });
  check("sin pedidos: mensaje que explica cuándo llegan tareas", /Compra\/Pedido/.test($(".orders-empty", host).textContent));
  host.remove();
}

// ---------------------------------------------------------------- 8) entrega
{
  const css = [read("css/05-layout.css"), read("css/06-list-board.css"), read("css/07-modals.css")].join("\n");
  const has = (body, decl) => body.replace(/\s+/g, " ").includes(decl);
  const rule = (selector) => { const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}(?:,[^{]*)?\\s*\\{([^}]*)\\}`, "m")); return m ? m[1] : ""; };
  const grid = rule(".wf-row__trace");
  check("CSS: sub-fila de compra → rejilla 1.2fr 1fr 1fr, width 100%, min-width 0, box-sizing border-box", has(grid, "display: grid") && has(grid, "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)") && has(grid, "width: 100%") && has(grid, "min-width: 0") && has(grid, "box-sizing: border-box") && has(grid, "max-width: 100%"), grid);
  check("CSS: pasa a 1 columna en pantallas estrechas", /@media \(max-width: 560px\)\s*\{[^}]*\.wf-row__trace[^}]*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/.test(css.replace(/\s+/g, " ")));
  check("CSS: cada campo de la sub-fila no desborda (min-width 0, width 100%)", has(rule(".wf-trace__cell .field__input"), "min-width: 0") && has(rule(".wf-trace__cell .field__input"), "width: 100%"));
  check("CSS: «Pedidos» tiene cabecera, búsqueda, pestañas y tabla", ["orders-view", "orders-search", "orders-select", "orders-tab", "orders-input", "orders-project"].every((c) => css.includes(`.${c}`)));
  const idx = read("index.html");
  eq("index.html: los 14 <link> a ?v=86", (idx.match(/css\/[\w-]+\.css\?v=86/g) || []).length, 14);
  check("index.html: ningún <link> se ha quedado en una versión anterior", !/\.css\?v=(?!86)\d+/.test(idx));
  check("package.json: 86.0.0", JSON.parse(read("package.json")).version === "86.0.0");
  const { RELEASES } = await import("../js/whats-new.js");
  check("Novedades: entrada 86 la primera y con «Pedidos»", RELEASES[0].id === 86 && /Pedidos/.test(RELEASES[0].title) && RELEASES[0].items.length >= 3 && RELEASES[0].id > RELEASES[1].id);
  const readme = read("README.md");
  check("README: apartado 3.19, historial v85 → v86 y el índice de Firestore", /### 3\.19 Pedidos/.test(readme) && /v85 → v86 \(Chusy-86\.zip\)/.test(readme) && /workflow\.purchase\.enabled/.test(readme) && /orders\.js/.test(readme));
  const rules = read("firestore.rules");
  check("firestore.rules: bloque meta/ordersAccess (lectura cuenta activa, escritura admin, forma exacta)", /match \/meta\/ordersAccess \{[^}]*allow read: if isActiveUser\(\);[^}]*allow create, update: if isAdmin\(\)[^}]*hasOnly\(\['allowedDepartments', 'updatedBy', 'updatedAt'\]\)/s.test(rules));
  const app = read("js/app.js");
  check("app.js: registra «Pedidos» (selectOrders, permiso, contador y fuente de sugerencias)", /function selectOrders\(\)/.test(app) && /canViewOrders\(currentUser, ordersAllowed\)/.test(app) && /setSuggestProvider\("supplier"/.test(app) && /mode === "orders"/.test(app) && /saved\.mode === "orders"/.test(app));
  check("app.js: sin permiso, «Pedidos» cae a «Mis tareas» (al entrar y al repintar)", /if \(!canSeeOrders\(\)\) \{ selectMyTasks\(\); return; \}/.test(app));
  check("store.js: rebanada ordersAccess registrada", /ordersAccess: "id"/.test(read("js/store.js")));
}

done("v86 · Pedidos, trazabilidad de compras y búsqueda instantánea");
