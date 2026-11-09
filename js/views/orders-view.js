// ============================================================================
// Vista «Pedidos» (v86) — la sección transversal de Compras. Toda la lógica (qué tareas son pedidos, en qué bloque
// está cada una, filtros y búsqueda) es pura y vive en js/orders.js; aquí solo hay pantalla.
//
//  · Cabecera: BÚSQUEDA instantánea (<input type="search">, con lupa y botón × para limpiar; filtra mientras se
//    teclea por cualquier fragmento del Nº de pedido, del Código Proveedor, de la tarea o del proyecto) y cinco
//    desplegables combinables: Comercial · Proyecto · Proveedor · Sector · Responsable.
//  · Tres pestañas con su contador: «Pendientes de pedir», «Pedidos realizados» y «Completados / Recibidos».
//  · Cada fila: tarea (con el check que completa la etapa y dispara el relevo a Recepción/Fabricación), proyecto (código
//    YYXXX), Comercial, responsable de Compra, Proveedor / Nº de pedido / Código Proveedor EDITABLES EN LÍNEA (se guardan
//    al terminar de escribir) y plazo o fecha prevista. Un clic en el resto de la fila abre la ventana de la tarea.
//
// El estado (pestaña, filtros, orden) lo guarda app.js solo de sesión (`onStateChange`, que NO repinta): buscar o filtrar
// repinta solo las pestañas y la tabla, nunca la cabecera, para no perder el foco del cuadro de búsqueda. Si llega un dato
// nuevo de Firestore mientras se escribe en un campo, el repintado conserva el foco, el texto y el cursor.
// ============================================================================
import { escapeHtml, formatDate, isOverdue, initials, colorFromString, badgeHtml, renderTitleHtml, showToast } from "../utils.js";
import { toggleTaskWithWorkflow } from "../components/stage-handoff.js";
import { stageBadgeHtml } from "../components/stage-badge.js";
import { celebrateTask } from "../components/celebration.js";
import { updateOrderTrace } from "../data/tasks.js";
import { attachSupplierSuggest } from "../components/text-suggest.js";
import { resolveColumns, columnHeaderCellsHtml, wireColumnResize } from "../components/table-columns.js";
import { openTaskContextMenu } from "./list-view.js";
import { SECTOR_FILTER_OPTIONS, normalizeSectorFilter } from "../project-properties.js";
import { suggestionKey } from "../offers.js";
import {
  ORDER_TABS, emptyOrdersState, applyOrderFilters, hasActiveOrderFilters, orderFilterOptions, groupOrdersByStatus, sortOrderRows,
  countOrdersByStatus,
} from "../orders.js";
import { PURCHASE_TRACE_MAX } from "../workflow-stages.js";

/** Columnas de la tabla (el ancho se puede cambiar arrastrando el borde; se guarda por persona bajo el ámbito «orders»). */
const ORDER_COLUMNS = [
  { key: "title", label: "Tarea", defaultWidth: 250, minWidth: 150, locked: true },
  { key: "project", label: "Proyecto", defaultWidth: 200, minWidth: 110 },
  { key: "commercial", label: "Comercial", defaultWidth: 120, minWidth: 80 },
  { key: "buyer", label: "Resp. Compra", defaultWidth: 130, minWidth: 90 },
  { key: "supplier", label: "Proveedor", defaultWidth: 160, minWidth: 100 },
  { key: "orderNumber", label: "Nº de pedido", defaultWidth: 130, minWidth: 90 },
  { key: "supplierCode", label: "Código Proveedor", defaultWidth: 140, minWidth: 90 },
  { key: "deadline", label: "Plazo / Prevista", defaultWidth: 110, minWidth: 80 },
];
/** Tope de filas pintadas de golpe (el bloque de completados crece sin parar); la búsqueda y los filtros sirven para acotar. */
export const ORDERS_RENDER_LIMIT = 200;

const EMPTY_TEXT = {
  pending: "No hay pedidos pendientes de tramitar. Las tareas llegan aquí cuando tienen Compra/Pedido habilitada y su Diseño está completado (o no lleva Diseño).",
  placed: "No hay pedidos realizados a la espera de Recepción/Fabricación.",
  done: "Todavía no hay pedidos completados o recibidos.",
};
const CHECK_TITLE = {
  pending: "Completar Compra/Pedido y pasar a Recepción/Fab.",
  placed: "Marcar como recibido (completa la tarea)",
  done: "Devolver a la etapa anterior",
};
const DEADLINE_TITLE = { pending: "Plazo de Compra/Pedido", placed: "Fecha prevista de recepción", done: "Última fecha conocida" };

let inlineSuggests = []; // desplegables de «Proveedor» de la tabla actual (se rehacen en cada repintado)

/**
 * @param {HTMLElement} container
 * @param {{ rows: object[], state?: object, onStateChange?: (state: object) => void, onOpenTask: (id: string) => void,
 *           currentUser: object, teamMembers: object[], projects: object[] }} opts
 *   `rows`: TODOS los pedidos (collectOrderRows), sin filtrar; la vista aplica los filtros del estado.
 */
export function renderOrdersView(container, opts) {
  const { rows, onStateChange, onOpenTask, currentUser, teamMembers, projects } = opts;
  const state = { ...emptyOrdersState(), ...(opts.state || {}) };
  state.filters = { ...emptyOrdersState().filters, ...(state.filters || {}) };
  state.sort = { ...emptyOrdersState().sort, ...(state.sort || {}) };

  // ---- qué tenía el foco antes de repintar (para devolvérselo después)
  const active = document.activeElement;
  let restore = null;
  if (active && container.contains(active)) {
    if (active.id === "orders-search") restore = { sel: "#orders-search", value: active.value, start: active.selectionStart, end: active.selectionEnd };
    else if (active.dataset && active.dataset.trace && active.dataset.task) {
      restore = { task: active.dataset.task, trace: active.dataset.trace, value: active.value, start: active.selectionStart, end: active.selectionEnd, dirty: active.value !== active.defaultValue };
    }
  }

  const options = orderFilterOptions(rows);
  const scopeKey = "orders";
  const prefs = (currentUser.columnPrefs || {})[scopeKey];
  const { visible, gridTemplate, widthOf } = resolveColumns(ORDER_COLUMNS, prefs, null);

  const optionList = (items, selected, getValue, getLabel) => {
    const list = [...items];
    if (selected && !list.some((i) => getValue(i) === selected || suggestionKey(getValue(i)) === suggestionKey(selected))) list.push(selected); // el elegido sigue visible aunque ya no haya filas
    return list;
  };
  const f = state.filters;
  const select = (id, label, optsHtml) => `<label class="orders-select"><span class="orders-select__label">${label}</span><select class="field__select" id="${id}">${optsHtml}</select></label>`;
  const opt = (value, label, selected) => `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const commercials = optionList(options.commercials, f.commercial, (v) => v);
  const suppliers = optionList(options.suppliers, f.supplier, (v) => v);

  container.innerHTML = `
    <div class="orders-view">
      <div class="orders-filters" id="orders-filters">
        <div class="orders-search">
          <span class="orders-search__icon" aria-hidden="true">🔍</span>
          <input type="search" class="orders-search__input" id="orders-search" placeholder="Buscar por Nº de pedido, Código proveedor o tarea..." value="${escapeHtml(f.search)}" autocomplete="off" aria-label="Buscar pedidos">
          <button type="button" class="orders-search__clear" id="orders-search-clear" aria-label="Limpiar búsqueda" title="Limpiar búsqueda"${f.search ? "" : " hidden"}>×</button>
        </div>
        <div class="orders-selects">
          ${select("of-commercial", "Comercial", opt("", "Todos", !f.commercial) + commercials.map((c) => opt(c, c, suggestionKey(c) === suggestionKey(f.commercial) && !!f.commercial)).join(""))}
          ${select("of-project", "Proyecto", opt("", "Todos", !f.projectId) + options.projects.map((p) => opt(p.id, `${p.code ? p.code + " · " : ""}${p.name}`, p.id === f.projectId)).join(""))}
          ${select("of-supplier", "Proveedor", opt("", "Todos", !f.supplier) + suppliers.map((s) => opt(s, s, suggestionKey(s) === suggestionKey(f.supplier) && !!f.supplier)).join(""))}
          ${select("of-sector", "Sector", SECTOR_FILTER_OPTIONS.map((o) => opt(o.key, o.label, o.key === normalizeSectorFilter(f.sector))).join(""))}
          ${select("of-assignee", "Responsable", opt("", "Todos", !f.assigneeId) + optionList(options.assignees, f.assigneeId, (a) => a.uid).map((a) => (typeof a === "string" ? opt(a, "Responsable", true) : opt(a.uid, a.name, a.uid === f.assigneeId))).join(""))}
          <button type="button" class="filterbar__clear" id="of-clear" hidden>✕ Limpiar filtros</button>
        </div>
      </div>
      <div class="orders-tabs" id="orders-tabs" role="tablist"></div>
      <div class="orders-results" id="orders-results"></div>
    </div>`;

  const $ = (sel) => container.querySelector(sel);

  // ---- repintado parcial: pestañas + tabla (la cabecera NO se toca)
  function paintResults() {
    inlineSuggests.forEach((h) => h.destroy());
    inlineSuggests = [];
    const filtered = applyOrderFilters(rows, state.filters);
    const counts = countOrdersByStatus(filtered);
    const grouped = groupOrdersByStatus(filtered);
    const tab = ORDER_TABS.some((t) => t.key === state.tab) ? state.tab : "pending";
    $("#orders-search-clear").hidden = !state.filters.search;
    $("#of-clear").hidden = !hasActiveOrderFilters(state.filters);

    $("#orders-tabs").innerHTML = ORDER_TABS.map(
      (t) => `<button type="button" class="orders-tab${t.key === tab ? " is-active" : ""}" role="tab" aria-selected="${t.key === tab}" data-tab="${t.key}"><span class="orders-tab__name">${escapeHtml(t.label)}</span>${t.hint ? `<span class="orders-tab__hint">${escapeHtml(t.hint)}</span>` : ""}<span class="orders-tab__count">${counts[t.key]}</span></button>`
    ).join("");
    $("#orders-tabs").querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; notify(); paintResults(); }));

    const sort = state.sort.column ? state.sort : { column: "deadline", direction: tab === "done" ? "desc" : "asc" };
    const sorted = sortOrderRows(grouped[tab], sort.column, sort.direction);
    const shown = sorted.slice(0, ORDERS_RENDER_LIMIT);
    const box = $("#orders-results");

    if (!sorted.length) {
      // Si la búsqueda/los filtros dejan este bloque vacío pero hay resultados en otro, se avisa con un atajo.
      const others = ORDER_TABS.filter((t) => t.key !== tab && counts[t.key] > 0);
      const filtering = hasActiveOrderFilters(state.filters);
      box.innerHTML = `<div class="orders-empty">
        <p>${filtering ? "Ningún pedido de este bloque coincide con la búsqueda o los filtros." : escapeHtml(EMPTY_TEXT[tab])}</p>
        ${filtering && others.length ? `<p class="orders-empty__jump">Sí hay resultados en: ${others.map((t) => `<button type="button" class="link-btn" data-goto-tab="${t.key}">${escapeHtml(t.label)} (${counts[t.key]})</button>`).join(" · ")}</p>` : ""}
      </div>`;
      box.querySelectorAll("[data-goto-tab]").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.gotoTab; notify(); paintResults(); }));
      return;
    }

    const header = `<div class="list-table__header" style="grid-template-columns:${gridTemplate};">${columnHeaderCellsHtml(visible, widthOf, state.sort.column ? state.sort : null).replace(/ draggable="true"/g, "")}<span></span></div>`;
    const memberById = new Map((teamMembers || []).map((m) => [m.uid, m]));
    const cell = (col, r) => {
      const t = r.task;
      switch (col.key) {
        case "title":
          return `<span class="list-row__title-cell">
            <button type="button" class="task-row__check${r.status === "done" ? " is-checked" : ""}" data-check="${escapeHtml(r.id)}" title="${escapeHtml(CHECK_TITLE[r.status])}" aria-label="${escapeHtml(CHECK_TITLE[r.status])}">${r.status === "done" ? "✓" : ""}</button>
            <span class="task-row__title" data-open="${escapeHtml(r.id)}">${renderTitleHtml(t.title)}</span>${stageBadgeHtml(t)}</span>`;
        case "project":
          return `<span class="orders-project" title="${escapeHtml(`${r.projectCode ? r.projectCode + " · " : ""}${r.projectName}`)}">${badgeHtml(r.projectIcon, r.projectColor, "project-badge--sm")}${r.projectCode ? `<span class="orders-project__code">${escapeHtml(r.projectCode)}</span>` : ""}<span class="orders-project__name">${escapeHtml(r.projectName)}</span></span>`;
        case "commercial":
          return `<span class="list-table__cell-text">${r.commercial ? escapeHtml(r.commercial) : "—"}</span>`;
        case "buyer": {
          const m = r.buyerId ? memberById.get(r.buyerId) : null;
          return r.buyerId
            ? `<span class="orders-buyer"><span class="avatar avatar--sm" style="background:${colorFromString(r.buyerId)}">${escapeHtml(initials(r.buyerName || (m && m.name) || ""))}</span><span class="orders-buyer__name">${escapeHtml(r.buyerName || "Sin nombre")}</span></span>`
            : `<span class="list-table__cell-text">—</span>`;
        }
        case "supplier":
        case "orderNumber":
        case "supplierCode":
          return `<input class="orders-input" type="text" data-task="${escapeHtml(r.id)}" data-trace="${col.key}" maxlength="${PURCHASE_TRACE_MAX[col.key]}" autocomplete="off" placeholder="—" value="${escapeHtml(r[col.key])}" aria-label="${escapeHtml(col.label)}">`;
        case "deadline":
          return `<span class="list-table__cell-text${r.status !== "done" && r.deadline && isOverdue(r.deadline, false) ? " is-overdue" : ""}" title="${escapeHtml(DEADLINE_TITLE[r.status])}">${r.deadline ? escapeHtml(formatDate(r.deadline)) : "—"}</span>`;
        default:
          return "";
      }
    };
    const body = shown
      .map((r) => `<div class="list-row orders-row${r.status === "done" ? " is-complete" : ""}" data-task-id="${escapeHtml(r.id)}" style="grid-template-columns:${gridTemplate};">${visible.map((c) => cell(c, r)).join("")}<span></span></div>`)
      .join("");
    box.innerHTML = `<div class="list-table-scroll"><div class="list-table">${header}${body}</div></div>${sorted.length > shown.length ? `<p class="orders-more">Mostrando ${shown.length} de ${sorted.length}. Usa la búsqueda o los filtros para acotar.</p>` : ""}`;

    box.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      const key = b.dataset.sort;
      state.sort = { column: key, direction: state.sort.column === key && state.sort.direction === "asc" ? "desc" : "asc" };
      notify();
      paintResults();
    }));
    wireColumnResize(box, { visible, widthOf, scopeKey, currentUserUid: currentUser.uid });

    const rowById = new Map(shown.map((r) => [r.id, r]));
    box.querySelectorAll("[data-check]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = rowById.get(btn.dataset.check);
      if (r) toggleTaskWithWorkflow(r.task, { currentUser, teamMembers, projects, onFinish: () => celebrateTask(btn) });
    }));
    box.querySelectorAll(".orders-row").forEach((rowEl) => {
      rowEl.addEventListener("click", (e) => {
        if (e.target.closest("input, button, .text-suggest, .col-resize-handle")) return;
        onOpenTask(rowEl.dataset.taskId);
      });
      rowEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const r = rowById.get(rowEl.dataset.taskId);
        if (r) openTaskContextMenu(e.clientX, e.clientY, r.task, onOpenTask, currentUser, teamMembers, projects);
      });
    });

    // Edición en línea: «Proveedor» sugiere los ya usados (se engancha ANTES de añadir el listener propio de `change`).
    box.querySelectorAll(".orders-input").forEach((inp) => {
      if (inp.dataset.trace === "supplier") inlineSuggests.push(attachSupplierSuggest(inp));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.defaultPrevented) { e.preventDefault(); inp.blur(); }
        else if (e.key === "Escape" && !e.defaultPrevented) { inp.value = inp.defaultValue; inp.blur(); }
      });
      inp.addEventListener("change", async () => {
        const r = rowById.get(inp.dataset.task);
        if (!r) return;
        const value = inp.value;
        if (value.trim() === (r[inp.dataset.trace] || "")) return;
        inp.disabled = true;
        try {
          const res = await updateOrderTrace(r.task, { [inp.dataset.trace]: value });
          if (!res) throw new Error("sin etapa de compra");
        } catch (err) {
          console.error("updateOrderTrace:", err);
          inp.value = inp.defaultValue;
          showToast("No se pudo guardar el dato del pedido. Inténtalo de nuevo.", "error");
        }
        inp.disabled = false;
      });
    });
  }

  function notify() { if (typeof onStateChange === "function") onStateChange({ tab: state.tab, filters: { ...state.filters }, sort: { ...state.sort } }); }
  function setFilter(patch) { state.filters = { ...state.filters, ...patch }; notify(); paintResults(); }

  // ---- cabecera: búsqueda instantánea (en cada pulsación, sin retardo) y desplegables
  const searchInput = $("#orders-search");
  searchInput.addEventListener("input", () => setFilter({ search: searchInput.value }));
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape" && searchInput.value) { e.preventDefault(); searchInput.value = ""; setFilter({ search: "" }); } });
  $("#orders-search-clear").addEventListener("click", () => { searchInput.value = ""; setFilter({ search: "" }); searchInput.focus(); });
  $("#of-commercial").addEventListener("change", (e) => setFilter({ commercial: e.target.value }));
  $("#of-project").addEventListener("change", (e) => setFilter({ projectId: e.target.value }));
  $("#of-supplier").addEventListener("change", (e) => setFilter({ supplier: e.target.value }));
  $("#of-sector").addEventListener("change", (e) => setFilter({ sector: e.target.value }));
  $("#of-assignee").addEventListener("change", (e) => setFilter({ assigneeId: e.target.value }));
  $("#of-clear").addEventListener("click", () => {
    searchInput.value = "";
    state.filters = emptyOrdersState().filters;
    notify();
    renderOrdersView(container, { ...opts, state: { ...state } }); // los desplegables también vuelven a «Todos»
  });

  paintResults();

  // ---- devolver el foco (y lo escrito) a donde estaba antes del repintado
  if (restore) {
    const node = restore.sel
      ? container.querySelector(restore.sel)
      : [...container.querySelectorAll(".orders-input")].find((i) => i.dataset.task === restore.task && i.dataset.trace === restore.trace);
    if (node) {
      if (restore.dirty !== undefined && restore.dirty) node.value = restore.value;
      try { node.focus({ preventScroll: true }); if (restore.start != null) node.setSelectionRange(restore.start, restore.end); } catch (e) { /* tipo sin selección */ }
    }
  }
}
