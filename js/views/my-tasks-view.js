// ============================================================================
// Vista "Mis tareas": todo lo asignado a la persona, en cualquier proyecto
// (más sus recordatorios personales), agrupado por urgencia de fecha
// (Vencidas / Hoy / Mañana / Próximos 7 días / Más adelante / Sin fecha,
// como la vista personal de Asana) y con columnas ordenables.
// Además de las columnas de siempre, cada persona puede definir sus
// propios campos personalizados (botón "+ Campo personalizado") — son
// solo suyos y se aplican a cualquier tarea que vea aquí. Las columnas se
// pueden redimensionar, reordenar arrastrando su cabecera y ocultar/
// mostrar, también de forma personal — el orden es el mismo que en la
// vista de Lista de cualquier proyecto (ver components/table-columns.js).
// ============================================================================
import { escapeHtml, formatDate, isOverdue, toDate, initials, colorFromString, textColorFor, projectIcon, setListHtml } from "../utils.js";
import { toggleTaskComplete } from "../data/tasks.js";
import { celebrateTask } from "../components/celebration.js";
import { openTaskContextMenu } from "./list-view.js";
import { openCustomFieldsModal } from "../components/custom-fields-modal.js";
import { updateUserProfile } from "../data/users.js";
import { resolveColumns, columnHeaderCellsHtml, wireColumnResize, wireColumnReorder, openColumnsMenu } from "../components/table-columns.js";
import { createSelectionController } from "../components/bulk-selection.js";
import { renderBulkToolbar, removeBulkToolbar } from "../components/bulk-toolbar.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const PRIORITY_COLORS = { urgente: "var(--color-danger)", alta: "var(--color-signal)", media: "#78848C", baja: "var(--color-text-faint)" };
const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };

const BASE_COLUMNS = [
  { key: "title", label: "Nombre", defaultWidth: 280, minWidth: 160, locked: true },
  { key: "dueDate", label: "Fecha límite", defaultWidth: 88, minWidth: 70 },
  { key: "assignee", label: "Responsables", defaultWidth: 96, minWidth: 60 },
  { key: "priority", label: "Prioridad", defaultWidth: 80, minWidth: 64 },
  { key: "tags", label: "Etiquetas", defaultWidth: 160, minWidth: 90 },
  { key: "project", label: "Proyecto", defaultWidth: 140, minWidth: 80 },
];

const SCOPE_KEY = "mytasks";

// Selección múltiple: vive fuera de renderMyTasksView() para sobrevivir a
// que esta función se vuelva a llamar (cada cambio de filtro/orden, cada
// actualización en tiempo real de Firestore...) — mismo patrón que
// list-view.js, ver bulk-selection.js. Aquí no hace falta un equivalente a
// "lastProjectId" para invalidarla: Mis tareas no cambia de proyecto, así
// que la selección solo se poda cuando una tarea deja de estar en la lista
// (se completa y el filtro la oculta, deja de estar asignada a ti...).
const selection = createSelectionController();

export function renderMyTasksView(container, opts) {
  const { tasks, teamMembers, projects, tagsRegistry, sortState, onSortChange, onOpenTask, currentUser } = opts;
  selection.prune(tasks.map((t) => t.id));

  /** Vuelve a pintar esta misma vista con los mismos datos — para cuando
   * solo cambia la selección (Ctrl/Shift+clic, "✕"), sin esperar a que
   * llegue un dato nuevo de Firestore. */
  function rerenderSelf() { renderMyTasksView(container, opts); }

  const customCols = (currentUser.personalCustomFieldDefs || []).map((f) => ({ key: `cf:${f.id}`, label: f.name, fieldId: f.id, defaultWidth: 120, minWidth: 70 }));
  const allColumns = [...BASE_COLUMNS, ...customCols];
  const prefs = (currentUser.columnPrefs || {})[SCOPE_KEY];
  const { visible, gridTemplate, widthOf } = resolveColumns(allColumns, prefs, currentUser.columnOrder);

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

  function wireColumnsToolbar() {
    container.querySelector("#mt-add-field")?.addEventListener("click", () =>
      openCustomFieldsModal({
        title: "Campos personalizados de Mis tareas",
        hint: "Son solo tuyos: se aplican a cualquier tarea que veas aquí, sin afectar a lo que ve el resto del equipo.",
        fields: currentUser.personalCustomFieldDefs,
        onSave: (defs) => updateUserProfile(currentUser.uid, { personalCustomFieldDefs: defs }),
      })
    );
    container.querySelector("#btn-columns")?.addEventListener("click", (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      openColumnsMenu({ x: rect.left, y: rect.bottom + 4, allColumns, order: currentUser.columnOrder, hidden: prefs?.hidden, scopeKey: SCOPE_KEY, currentUserUid: currentUser.uid });
    });
  }

  const toolbarHtml = `
    <div class="table-toolbar">
      <button type="button" class="btn btn--ghost btn--sm" id="btn-columns">☰ Columnas</button>
      <button type="button" class="btn btn--ghost btn--sm" id="mt-add-field">+ Campo personalizado</button>
    </div>`;

  if (!nonEmpty.length) {
    removeBulkToolbar(); // no puede haber selección con la lista vacía (ya podada arriba), pero la barra pudo quedar pintada de un render anterior
    container.innerHTML = `
      ${toolbarHtml}
      <div class="empty-state">
        <span class="empty-state__eyebrow">— MIS TAREAS —</span>
        <h2>No tienes tareas asignadas</h2>
        <p>Cuando alguien te asigne una tarea en cualquier proyecto, o crees un recordatorio personal, aparecerá aquí.</p>
      </div>`;
    wireColumnsToolbar();
    return;
  }

  const headerHtml = `
    <div class="list-table__header" style="grid-template-columns:${gridTemplate};">
      ${columnHeaderCellsHtml(visible, widthOf, sortState)}
    </div>`;

  const rowHtml = (task) => {
    const project = projects.find((p) => p.id === task.projectId);
    const overdue = isOverdue(task.dueDate, task.isComplete);
    const assignees = task.assigneeIds.map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
    const cellsHtml = visible
      .map((col) => {
        if (col.key === "title") {
          return `
            <span class="list-row__title-cell">
              <span class="task-row__priority priority-${task.priority}${task.priority === "urgente" && !task.isComplete ? " is-pulse" : ""}"></span>
              <button class="task-row__check${task.isComplete ? " is-checked" : ""}" data-check="${task.id}">${task.isComplete ? "✓" : ""}</button>
              <span class="task-row__title" data-open="${task.id}">${task.isMilestone ? "🚩 " : ""}${escapeHtml(task.title)}</span>
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
          return !task.projectId
            ? `<span class="tag-pill" style="background:var(--color-signal-soft);color:var(--color-signal);">🔒 Personal</span>`
            : project
            ? `<span class="tag-pill" style="background:${project.color};color:${textColorFor(project.color)};">${escapeHtml(projectIcon(project))} ${escapeHtml(project.name)}</span>`
            : `<span class="list-table__cell-text">—</span>`;
        }
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

  setListHtml(container, `${toolbarHtml}<div class="list-table-scroll"><div class="list-table">${headerHtml}${sectionsHtml}</div></div>`);

  container.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSortChange(btn.dataset.sort));
  });
  wireColumnsToolbar();
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
      const willComplete = !task.isComplete;
      toggleTaskComplete(task.id, willComplete);
      if (willComplete) celebrateTask(btn); // pequeña recompensa — solo al completar, no al desmarcar
    });
  });
  container.querySelectorAll(".list-row").forEach((row) => {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = tasks.find((t) => t.id === row.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
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
