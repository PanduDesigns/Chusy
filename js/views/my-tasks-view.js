// ============================================================================
// Vista "Mis tareas": todo lo asignado a la persona, en cualquier proyecto
// (más sus recordatorios personales), agrupado por urgencia de fecha
// (Vencidas / Hoy / Mañana / Próximos 7 días / Más adelante / Sin fecha,
// como la vista personal de Asana) y con columnas ordenables.
// Además de las columnas de siempre, cada persona puede definir sus
// propios campos personalizados (botón "+ Campo personalizado") — son
// solo suyos y se aplican a cualquier tarea que vea aquí. Las columnas se
// pueden redimensionar y reordenar arrastrando su cabecera — el orden es el
// mismo que en la vista de Lista de cualquier proyecto (ver
// components/table-columns.js).
//
// v93: QUÉ columnas se ven lo elige cada persona en el menú «⚙️ Columnas»
// (catálogo en my-tasks-columns.js: proyecto/oferta, código, sector, cliente,
// comercial, tipo, sección, etapa de flujo, pedido, estado, fechas y los campos
// personalizados de los proyectos) y se recuerda por persona y navegador
// (localStorage `chusy_my_tasks_columns_<uid>`). Debajo de la barra, filtros
// ampliados (texto, tipo/proyecto, sector, comercial, etapa, proveedor, etiqueta).
// ============================================================================
import { escapeHtml, formatDate, isOverdue, toDate, initials, colorFromString, textColorFor, projectIcon, setListHtml, getTaskProjectIds, renderTitleHtml, debounce } from "../utils.js";
import { toggleTaskWithWorkflow } from "../components/stage-handoff.js";
import { stageBadgeHtml } from "../components/stage-badge.js";
import { getOffersProject } from "../data/projects.js";
import { isUpcomingForUser, upcomingStageOf, STAGE_SHORT } from "../workflow-stages.js";
import { celebrateTask } from "../components/celebration.js";
import { openTaskContextMenu } from "./list-view.js";
import { openCustomFieldsModal } from "../components/custom-fields-modal.js";
import { updateUserProfile } from "../data/users.js";
import { resolveColumns, columnHeaderCellsHtml, wireColumnResize, wireColumnReorder } from "../components/table-columns.js";
import {
  MY_TASKS_AVAILABLE_COLUMNS, DEFAULT_MY_TASKS_COLUMNS, MY_TASKS_CUSTOM_WIDTH, MY_TASKS_STAGE_KEYS, MY_TASKS_STAGE_LABELS,
  MY_TASKS_TYPE_ALL, MY_TASKS_TYPE_PROJECTS, MY_TASKS_TYPE_OFFERS,
  normalizeMyTasksColumns, loadMyTasksColumns, saveMyTasksColumns, readSavedMyTasksColumns, resetMyTasksColumns, toggleMyTasksColumn,
  myTaskContext, myTasksProjectFieldColumns, myTaskProjectFieldValue, myTasksFilterOptions, emptyMyTasksFilters, normalizeMyTasksFilters,
  hasActiveMyTasksFilters, filterMyTasksItems,
} from "../my-tasks-columns.js";
import { createSelectionController } from "../components/bulk-selection.js";
import { renderBulkToolbar, removeBulkToolbar } from "../components/bulk-toolbar.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const PRIORITY_COLORS = { urgente: "var(--color-danger)", alta: "var(--color-signal)", media: "#78848C", baja: "var(--color-text-faint)" };
const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };

// La columna «Nombre» siempre va (bloqueada, como en la Lista); las demás salen del catálogo de my-tasks-columns.js.
const TITLE_COLUMN = { key: "title", label: "Nombre", defaultWidth: 280, minWidth: 160, locked: true };

// v93: estos helpers viven en my-tasks-columns.js (puros, sin DOM) y se re-exportan aquí: es «la vista» la que los nombra.
export {
  MY_TASKS_AVAILABLE_COLUMNS, DEFAULT_MY_TASKS_COLUMNS, normalizeMyTasksColumns, loadMyTasksColumns, saveMyTasksColumns, filterMyTasksItems,
};

const SCOPE_KEY = "mytasks";

// v84: la sección plegable «Próximas etapas asignadas a mí» (tareas con etapas que aún no me tocan). Vive fuera de la
// función para sobrevivir a los repintados; arranca plegada para no mezclarla con el trabajo de hoy.
let upcomingOpen = false;

// Selección múltiple: vive fuera de renderMyTasksView() para sobrevivir a
// que esta función se vuelva a llamar (cada cambio de filtro/orden, cada
// actualización en tiempo real de Firestore...) — mismo patrón que
// list-view.js, ver bulk-selection.js. Aquí no hace falta un equivalente a
// "lastProjectId" para invalidarla: Mis tareas no cambia de proyecto, así
// que la selección solo se poda cuando una tarea deja de estar en la lista
// (se completa y el filtro la oculta, deja de estar asignada a ti...).
const selection = createSelectionController();

// v93: los filtros ampliados (texto, tipo/proyecto, sector, comercial, etapa, proveedor, etiqueta) viven aquí, fuera de la
// función, para sobrevivir a los repintados (cada dato nuevo de Firestore la vuelve a llamar). app.js los lee para aplicar
// `filterMyTasksItems` ANTES de ordenar y contar; la vista solo los pinta y avisa con `onFiltersChange`. Son de esta sesión
// (como el cuadro de búsqueda del resto de la app): un texto olvidado en la caja dejaría la lista «vacía» sin que se vea por qué.
let viewFilters = emptyMyTasksFilters();
export function getMyTasksViewFilters() { return { ...viewFilters }; }
export function setMyTasksViewFilters(next) { viewFilters = normalizeMyTasksFilters(next); }
export function resetMyTasksViewFilters() { viewFilters = emptyMyTasksFilters(); }

/** Las columnas que se ven AHORA: lo que eligió la persona o, si nunca eligió, las de por defecto (más sus campos personales visibles de antes de la v93). */
export function selectedMyTasksColumns({ uid, personalKeys = [], legacyHidden = [], storage } = {}) {
  const saved = readSavedMyTasksColumns(uid, storage);
  if (saved) return saved;
  const hidden = new Set(legacyHidden || []);
  return normalizeMyTasksColumns([...DEFAULT_MY_TASKS_COLUMNS, ...personalKeys.filter((k) => !hidden.has(k))]);
}

/** Popover «⚙️ Columnas»: casillas agrupadas + «Restablecer». Cada cambio se guarda al momento (onChange) y repinta la tabla. */
function openMyTasksColumnsMenu({ x, y, groups, selected, onChange, onReset }) {
  document.querySelectorAll(".columns-menu").forEach((m) => m.remove());
  let current = new Set(selected);
  const groupsHtml = groups
    .filter((g) => g.columns.length)
    .map((g) => `
      <div class="columns-menu__group">${escapeHtml(g.label)}</div>
      ${g.columns.map((c) => `
      <label class="columns-menu__item">
        <input type="checkbox" data-col="${escapeHtml(c.key)}" ${current.has(c.key) ? "checked" : ""}>
        ${escapeHtml(c.label)}
      </label>`).join("")}`)
    .join("");
  const menu = document.createElement("div");
  menu.className = "columns-menu columns-menu--mytasks";
  menu.innerHTML = `
    <div class="columns-menu__title">Columnas de Mis tareas</div>
    <div class="columns-menu__scroll">${groupsHtml}</div>
    <div class="columns-menu__foot"><button type="button" class="btn btn--ghost btn--sm" data-mt-reset>↺ Restablecer</button></div>`;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

  menu.querySelectorAll("[data-col]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const next = toggleMyTasksColumn([...current], cb.dataset.col, cb.checked);
      current = new Set(next);
      onChange(next);
    });
  });
  menu.querySelector("[data-mt-reset]").addEventListener("click", () => {
    const next = onReset();
    current = new Set(next);
    menu.querySelectorAll("[data-col]").forEach((cb) => { cb.checked = current.has(cb.dataset.col); });
  });

  function close() {
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
    menu.remove();
  }
  function onOutside(e) { if (!menu.contains(e.target) && !e.target.closest("#mt-columns")) close(); }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  setTimeout(() => { document.addEventListener("click", onOutside); document.addEventListener("keydown", onKeydown); }, 0);
}

export function renderMyTasksView(container, opts) {
  const { tasks: allMine, teamMembers, projects, tagsRegistry, sortState, onSortChange, onOpenTask, currentUser } = opts;
  // v84: lo que aún no me toca (una etapa futura de una tarea con flujo) va aparte; el resto es mi trabajo de siempre.
  const offersId = (getOffersProject() || {}).id;
  const upcoming = allMine.filter((t) => isUpcomingForUser(t, currentUser.uid, offersId));
  const tasks = allMine.filter((t) => !upcoming.includes(t));
  selection.prune(tasks.map((t) => t.id));

  /** Vuelve a pintar esta misma vista con los mismos datos — para cuando
   * solo cambia la selección (Ctrl/Shift+clic, "✕"), sin esperar a que
   * llegue un dato nuevo de Firestore. */
  function rerenderSelf() { renderMyTasksView(container, opts); }

  const offersProjectId = offersId;
  const personalCols = (currentUser.personalCustomFieldDefs || []).map((f) => ({ key: `cf:${f.id}`, label: f.name, fieldId: f.id, defaultWidth: MY_TASKS_CUSTOM_WIDTH, minWidth: 70 }));
  const projectCols = myTasksProjectFieldColumns(projects).map((c) => ({ ...c, projectField: true, defaultWidth: MY_TASKS_CUSTOM_WIDTH, minWidth: 70 }));
  const allColumns = [TITLE_COLUMN, ...MY_TASKS_AVAILABLE_COLUMNS, ...personalCols, ...projectCols];
  const prefs = (currentUser.columnPrefs || {})[SCOPE_KEY];
  const selected = new Set(selectedMyTasksColumns({ uid: currentUser.uid, personalKeys: personalCols.map((c) => c.key), legacyHidden: prefs?.hidden }));
  // Qué se ve lo decide la selección de la persona (localStorage); el ancho y el orden siguen siendo los de siempre (perfil).
  const hiddenKeys = allColumns.filter((c) => !c.locked && !selected.has(c.key)).map((c) => c.key);
  const { visible, gridTemplate, widthOf } = resolveColumns(allColumns, { widths: prefs?.widths, hidden: hiddenKeys }, currentUser.columnOrder);
  const filterOptions = myTasksFilterOptions(opts.allTasks || allMine, { projects, offersProjectId });
  const filtersActive = hasActiveMyTasksFilters(viewFilters);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekLimit = new Date(todayStart);
  weekLimit.setDate(weekLimit.getDate() + 7);

  const groups = { vencidas: [], hoy: [], manana: [], semana: [], adelante: [], sinFecha: [] };
  tasks.forEach((task) => {
    if (!task.dueDate) { groups.sinFecha.push(task); return; }
    const d = toDate(task.dueDate);
    if (!d) { groups.sinFecha.push(task); return; }
    if (d.getTime() < todayStart.getTime()) {
      (task.isComplete ? groups.hoy : groups.vencidas).push(task);
    } else if (d.getTime() === todayStart.getTime()) {
      groups.hoy.push(task);
    } else if (d.getTime() === tomorrowStart.getTime()) {
      groups.manana.push(task);
    } else if (d.getTime() < weekLimit.getTime()) {
      groups.semana.push(task);
    } else {
      groups.adelante.push(task);
    }
  });
  Object.values(groups).forEach((list) => list.sort((a, b) => (a.isComplete === b.isComplete ? 0 : a.isComplete ? 1 : -1)));

  const sections = [
    { key: "vencidas", label: "Vencidas" },
    { key: "hoy", label: "Hoy" },
    { key: "manana", label: "Mañana" },
    { key: "semana", label: "Próximos 7 días" },
    { key: "adelante", label: "Más adelante" },
    { key: "sinFecha", label: "Sin fecha" },
  ];
  const nonEmpty = sections.filter((s) => groups[s.key].length);

  /** Cambia un filtro de la barra de debajo y avisa a app.js (que es quien filtra, ordena y cuenta). */
  function changeFilters(patch) {
    viewFilters = normalizeMyTasksFilters({ ...viewFilters, ...patch });
    if (typeof opts.onFiltersChange === "function") opts.onFiltersChange(); else rerenderSelf();
  }

  /** Los menús del menú «⚙️ Columnas»: las del catálogo por grupos, más los campos personales y los de proyecto. */
  function columnGroups() {
    const groups = [];
    MY_TASKS_AVAILABLE_COLUMNS.forEach((c) => {
      let g = groups.find((x) => x.label === c.group);
      if (!g) { g = { label: c.group, columns: [] }; groups.push(g); }
      g.columns.push(c);
    });
    groups.push({ label: "Mis campos personalizados", columns: personalCols });
    groups.push({ label: "Campos de los proyectos", columns: projectCols });
    return groups;
  }

  function wireColumnsToolbar() {
    container.querySelector("#mt-add-field")?.addEventListener("click", () =>
      openCustomFieldsModal({
        title: "Campos personalizados de Mis tareas",
        hint: "Son solo tuyos: se aplican a cualquier tarea que veas aquí, sin afectar a lo que ve el resto del equipo.",
        fields: currentUser.personalCustomFieldDefs,
        onSave: (defs) => updateUserProfile(currentUser.uid, { personalCustomFieldDefs: defs }),
      })
    );
    container.querySelector("#mt-columns")?.addEventListener("click", (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      openMyTasksColumnsMenu({
        x: rect.left, y: rect.bottom + 4, groups: columnGroups(), selected: [...selected],
        // Guarda al momento (por persona) y repinta; el menú sigue abierto para marcar varias seguidas.
        onChange: (next) => { saveMyTasksColumns(next, currentUser.uid); rerenderSelf(); },
        onReset: () => { const def = resetMyTasksColumns(currentUser.uid); rerenderSelf(); return def; },
      });
    });
    const search = container.querySelector("#mt-search");
    if (search) search.addEventListener("input", debounce(() => changeFilters({ search: search.value }), 160));
    [["#mt-f-type", "type"], ["#mt-f-sector", "sector"], ["#mt-f-commercial", "commercial"], ["#mt-f-stage", "stage"], ["#mt-f-supplier", "supplier"], ["#mt-f-tag", "tag"]]
      .forEach(([sel, key]) => container.querySelector(sel)?.addEventListener("change", (e) => changeFilters({ [key]: e.target.value })));
    container.querySelector("#mt-f-clear")?.addEventListener("click", () => { resetMyTasksViewFilters(); if (typeof opts.onFiltersChange === "function") opts.onFiltersChange(); else rerenderSelf(); });
  }

  const optionHtml = (value, label, current) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const selectHtml = (id, label, optionsHtml) => `<label class="mt-filter"><span class="mt-filter__label">${label}</span><select class="field__select" id="${id}">${optionsHtml}</select></label>`;
  const f = viewFilters;
  const filtersHtml = `
    <div class="mt-filters">
      <div class="orders-search mt-filters__search">
        <span class="orders-search__icon" aria-hidden="true">🔍</span>
        <input type="search" class="orders-search__input" id="mt-search" placeholder="Tarea, código (26001), proyecto, cliente, proveedor, nº pedido o etiqueta…" value="${escapeHtml(f.search)}" autocomplete="off" aria-label="Buscar en Mis tareas">
      </div>
      ${selectHtml("mt-f-type", "Tipo / Proyecto",
        optionHtml(MY_TASKS_TYPE_ALL, "Todos", f.type) + optionHtml(MY_TASKS_TYPE_PROJECTS, "Solo Proyectos", f.type) + optionHtml(MY_TASKS_TYPE_OFFERS, "Solo Ofertas", f.type)
        + (filterOptions.projects.length ? `<optgroup label="Proyecto concreto">${filterOptions.projects.map((p) => optionHtml(`p:${p.id}`, `${p.code ? p.code + " · " : ""}${p.name}`, f.type)).join("")}</optgroup>` : ""))}
      ${selectHtml("mt-f-sector", "Sector", optionHtml("todos", "Todos", f.sector) + optionHtml("industria", "Industria", f.sector) + optionHtml("automocion", "Automoción", f.sector))}
      ${selectHtml("mt-f-commercial", "Comercial", optionHtml("", "Todos", f.commercial) + filterOptions.commercials.map((c) => optionHtml(c, c, f.commercial)).join(""))}
      ${selectHtml("mt-f-stage", "Etapa de flujo", optionHtml("todas", "Todas", f.stage) + MY_TASKS_STAGE_KEYS.map((k) => optionHtml(k, MY_TASKS_STAGE_LABELS[k], f.stage)).join(""))}
      ${selectHtml("mt-f-supplier", "Proveedor", optionHtml("", "Todos", f.supplier) + filterOptions.suppliers.map((c) => optionHtml(c, c, f.supplier)).join(""))}
      ${selectHtml("mt-f-tag", "Etiqueta", optionHtml("", "Todas", f.tag) + filterOptions.tags.map((c) => optionHtml(c, c, f.tag)).join(""))}
      ${filtersActive ? `<button type="button" class="filterbar__clear" id="mt-f-clear">✕ Limpiar filtros</button>` : ""}
    </div>`;

  const toolbarHtml = `
    <div class="table-toolbar">
      <button type="button" class="btn btn--ghost btn--sm" id="mt-columns" title="Elige qué columnas ver en Mis tareas (se recuerda para ti)">⚙️ Columnas</button>
      <button type="button" class="btn btn--ghost btn--sm" id="mt-add-field">+ Campo personalizado</button>
    </div>
    ${filtersHtml}`;

  // El cuadro de búsqueda se vuelve a crear en cada repintado (llega un dato nuevo, cambia un filtro…): se le devuelve el
  // foco y el cursor donde estaban para no cortar a quien está escribiendo.
  const searchWasFocused = typeof document !== "undefined" && document.activeElement && document.activeElement.id === "mt-search";
  const caret = searchWasFocused ? document.activeElement.selectionStart : null;
  function restoreSearchFocus() {
    if (!searchWasFocused) return;
    const input = container.querySelector("#mt-search");
    if (!input) return;
    input.focus();
    try { input.setSelectionRange(caret, caret); } catch (e) { /* type=search sin selección: da igual */ }
  }

  if (!nonEmpty.length && !upcoming.length) {
    removeBulkToolbar(); // no puede haber selección con la lista vacía (ya podada arriba), pero la barra pudo quedar pintada de un render anterior
    const filteredOut = (opts.totalCount || 0) > 0;
    container.innerHTML = `
      ${toolbarHtml}
      <div class="empty-state">
        <span class="empty-state__eyebrow">— MIS TAREAS —</span>
        <h2>${filteredOut ? "Ninguna tarea coincide con los filtros" : "No tienes tareas asignadas"}</h2>
        <p>${filteredOut ? "Prueba a quitar algún filtro o a borrar el texto de la búsqueda." : "Cuando alguien te asigne una tarea en cualquier proyecto, o crees un recordatorio personal, aparecerá aquí."}</p>
      </div>`;
    wireColumnsToolbar();
    restoreSearchFocus();
    return;
  }

  const headerHtml = `
    <div class="list-table__header" style="grid-template-columns:${gridTemplate};">
      ${columnHeaderCellsHtml(visible, widthOf, sortState)}
    </div>`;

  const rowHtml = (task) => {
    const upcomingTask = upcoming.includes(task);
    const taskProjectIds = getTaskProjectIds(task);
    const ctx = myTaskContext(task, projects, { offersProjectId });
    const overdue = isOverdue(task.dueDate, task.isComplete);
    const assignees = task.assigneeIds.map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
    const cellsHtml = visible
      .map((col) => {
        if (col.key === "title") {
          return `
            <span class="list-row__title-cell">
              <span class="task-row__priority priority-${task.priority}${task.priority === "urgente" && !task.isComplete ? " is-pulse" : ""}"></span>
              ${upcomingTask
                ? `<button class="task-row__check is-waiting" disabled title="Aún no te toca: espera a que se complete la etapa anterior"></button>`
                : `<button class="task-row__check${task.isComplete ? " is-checked" : ""}" data-check="${task.id}">${task.isComplete ? "✓" : ""}</button>`}
              <span class="task-row__title" data-open="${task.id}">${task.isMilestone ? "🚩 " : ""}${renderTitleHtml(task.title)}</span>
              ${upcomingTask ? `<span class="wf-badge wf-badge--waiting" title="Aún no te toca: espera a la etapa anterior">Te tocará: ${escapeHtml(STAGE_SHORT[upcomingStageOf(task, currentUser.uid, offersId)] || "")}</span>` : (selected.has("workflowStage") ? "" : stageBadgeHtml(task))}
            </span>`;
        }
        if (col.key === "dueDate") {
          return `<span class="list-table__cell-text${overdue ? " is-overdue" : ""}">${task.dueDate ? formatDate(task.dueDate) : "—"}</span>`;
        }
        if (col.key === "assignee") {
          return `<span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("") || `<span class="list-table__cell-text">—</span>`}</span>`;
        }
        if (col.key === "priority") {
          return `<span class="tag-pill" style="background:${PRIORITY_COLORS[task.priority] || "#8B959C"};color:${textColorFor(PRIORITY_COLORS[task.priority] || "#8B959C")};">${PRIORITY_LABELS[task.priority] || task.priority}</span>`;
        }
        if (col.key === "tags") {
          return task.tags && task.tags.length
            ? `<span class="list-table__tags-cell">${task.tags.map((t) => tagPill(t, tagsRegistry)).join("")}</span>`
            : `<span class="list-table__cell-text">—</span>`;
        }
        if (col.key === "project") {
          // Una tarea puede estar en varios proyectos a la vez (ver
          // getTaskProjectIds) — se muestra el principal y, si hay más,
          // un indicador "+N" con sus nombres al pasar el ratón, en vez
          // de amontonar todas las insignias en una columna estrecha.
          if (!taskProjectIds.length) {
            return `<span class="tag-pill" style="background:var(--color-signal-soft);color:var(--color-signal);">🔒 Personal</span>`;
          }
          const primary = projects.find((p) => p.id === taskProjectIds[0]);
          // v93: junto al nombre, el código YYXXX (el del proyecto o el de la propia oferta).
          const codeChip = ctx.code ? `<span class="mt-code" title="Código de ${ctx.kind === "oferta" ? "la oferta" : "el proyecto"}">${escapeHtml(ctx.code)}</span>` : "";
          const primaryBadge = primary
            ? `<span class="list-table__tags-cell"><span class="tag-pill" style="background:${primary.color};color:${textColorFor(primary.color)};">${escapeHtml(projectIcon(primary))} ${escapeHtml(primary.name)}</span>${codeChip}</span>`
            : `<span class="list-table__cell-text">—</span>`;
          const extraIds = taskProjectIds.slice(1);
          if (!extraIds.length) return primaryBadge;
          const extraNames = extraIds.map((id) => projects.find((p) => p.id === id)?.name).filter(Boolean).join(", ");
          return `<span class="list-table__tags-cell">${primaryBadge}<span class="tag-pill" style="background:var(--color-panel-raised);color:var(--color-text-lo);" title="${escapeHtml(extraNames)}">+${extraIds.length}</span></span>`;
        }
        // ---- v93: columnas nuevas
        const text = (v) => `<span class="list-table__cell-text">${v ? escapeHtml(v) : "—"}</span>`;
        if (col.key === "code") return ctx.code ? `<span class="mt-code">${escapeHtml(ctx.code)}</span>` : text("");
        if (col.key === "sector") return ctx.sector ? `<span class="tag-pill mt-sector mt-sector--${ctx.sector === "Automoción" ? "auto" : "ind"}">${escapeHtml(ctx.sector)}</span>` : text("");
        if (col.key === "client") return text(ctx.client);
        if (col.key === "commercial") return text(ctx.commercial);
        if (col.key === "projectType") return `<span class="tag-pill mt-type mt-type--${ctx.kind}">${escapeHtml(ctx.typeLabel || "—")}</span>`;
        if (col.key === "section") return text(ctx.sectionName);
        if (col.key === "workflowStage") return stageBadgeHtml(task) || text("");
        if (col.key === "status") {
          const label = task.isComplete ? "Completada" : overdue ? "Vencida" : "Pendiente";
          const kind = task.isComplete ? "done" : overdue ? "late" : "open";
          return `<span class="tag-pill mt-status mt-status--${kind}">${label}</span>`;
        }
        if (col.key === "startDate") return text(task.startDate ? formatDate(task.startDate) : "");
        if (col.key === "supplier") return text(ctx.supplier);
        if (col.key === "orderNumber") return text(ctx.orderNumber);
        if (col.key === "supplierCode") return text(ctx.supplierCode);
        if (col.projectField) return text(myTaskProjectFieldValue(task, projects, col.key));
        return `<span class="list-table__cell-text">${escapeHtml(task.customFields?.[col.fieldId] ?? "—")}</span>`;
      })
      .join("");
    return `
      <div class="list-row${task.isComplete ? " is-complete" : ""}${selection.has(task.id) ? " is-selected" : ""}" data-task-id="${task.id}" style="grid-template-columns:${gridTemplate};">
        ${cellsHtml}
      </div>`;
  };

  // Orden real en pantalla (puede cruzar los grupos de fecha), para que
  // Shift+clic sepa qué tramo seleccionar — mismo papel que
  // `orderedTaskIds` en list-view.js.
  const orderedTaskIds = nonEmpty.flatMap(({ key }) => groups[key].map((t) => t.id));

  const sectionsHtml = nonEmpty
    .map(
      ({ key, label }) => `
      <div class="section-block">
        <div class="section-header">
          <span class="section-header__name">${label}</span>
          <span class="section-header__count">${groups[key].length}</span>
        </div>
        ${groups[key].map(rowHtml).join("")}
      </div>`
    )
    .join("");

  const upcomingHtml = upcoming.length
    ? `
      <div class="section-block wf-upcoming">
        <button type="button" class="section-header wf-upcoming__toggle" id="mt-upcoming-toggle" aria-expanded="${upcomingOpen}">
          <span class="tl-agg-chevron">${upcomingOpen ? "▾" : "▸"}</span>
          <span class="section-header__name">Próximas etapas asignadas a mí (en espera de etapa previa)</span>
          <span class="section-header__count">${upcoming.length}</span>
        </button>
        ${upcomingOpen ? upcoming.map(rowHtml).join("") : ""}
      </div>`
    : "";
  const emptyTodayHtml = !nonEmpty.length ? `<p class="field__hint" style="padding:10px;">No tienes tareas activas ahora mismo.</p>` : "";

  setListHtml(container, `${toolbarHtml}<div class="list-table-scroll"><div class="list-table">${headerHtml}${emptyTodayHtml}${sectionsHtml}${upcomingHtml}</div></div>`);
  const upToggle = container.querySelector("#mt-upcoming-toggle");
  if (upToggle) upToggle.addEventListener("click", () => { upcomingOpen = !upcomingOpen; renderMyTasksView(container, opts); });

  container.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSortChange(btn.dataset.sort));
  });
  wireColumnsToolbar();
  restoreSearchFocus();
  wireColumnResize(container, { visible, widthOf, scopeKey: SCOPE_KEY, currentUserUid: currentUser.uid });
  wireColumnReorder(container, { allColumns, order: currentUser.columnOrder, currentUserUid: currentUser.uid });

  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", (e) => {
      // Con Ctrl/Cmd o Shift pulsados, el clic es para seleccionar (más
      // abajo, a nivel de fila) — no para abrir el detalle de la tarea.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      onOpenTask(elx.dataset.open);
    });
  });
  container.querySelectorAll("[data-check]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const task = tasks.find((t) => t.id === btn.dataset.check);
      if (!task) return;
      // v84: con etapas el círculo hace el relevo a la siguiente (ver components/stage-handoff.js); sin etapas, como siempre.
      toggleTaskWithWorkflow(task, { currentUser, teamMembers, projects, onFinish: () => celebrateTask(btn) });
    });
  });
  container.querySelectorAll(".list-row").forEach((row) => {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = allMine.find((t) => t.id === row.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask, currentUser, teamMembers, projects);
    });
    // Selección múltiple al estilo Asana, igual que en la vista de Lista:
    // Ctrl/Cmd+clic añade o quita esa tarea sola; Shift+clic selecciona
    // todo el tramo desde la última tocada (puede cruzar los grupos de
    // fecha). Un clic normal no toca la selección (solo abre la tarea, ver
    // el listener de [data-open] de arriba).
    row.addEventListener("click", (e) => {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
      if (e.target.closest("[data-check]")) return;
      e.preventDefault();
      const taskId = row.dataset.taskId;
      if (e.shiftKey) selection.selectRange(orderedTaskIds, taskId);
      else selection.toggle(taskId);
      rerenderSelf();
    });
  });

  syncBulkToolbar();

  function syncBulkToolbar() {
    const selectedTasks = tasks.filter((t) => selection.has(t.id));
    if (!selectedTasks.length) { removeBulkToolbar(); return; }
    renderBulkToolbar({
      selectedTasks,
      teamMembers,
      // Sin "project": la selección puede mezclar tareas de varios
      // proyectos y recordatorios personales — ver la nota en
      // bulk-toolbar.js sobre qué cambia cuando se omite.
      projects: projects || [],
      currentUser,
      onClearSelection: () => { selection.clear(); rerenderSelf(); },
    });
  }
}
