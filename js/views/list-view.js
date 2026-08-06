// ============================================================================
// Vista de Lista: tabla con columnas (Nombre, Fecha límite, Responsables,
// Prioridad y los campos personalizados del proyecto), agrupada por
// sección. Cada columna se puede pulsar para ordenar (alfabético / fecha /
// prioridad / valor del campo), con flecha indicando la dirección.
// Las columnas se pueden redimensionar arrastrando su borde derecho y
// ocultar/mostrar desde "Columnas" — son preferencias de cada persona.
// ============================================================================
import { escapeHtml, formatDate, isOverdue, initials, colorFromString, textColorFor, showToast } from "../utils.js";
import { toggleTaskComplete, duplicateTask, updateTask, deleteTask } from "../data/tasks.js";
import { updateProject } from "../data/projects.js";
import { openContextMenu } from "../components/context-menu.js";
import { openCustomFieldsModal } from "../components/custom-fields-modal.js";
import { resolveColumns, columnHeaderCellsHtml, wireColumnResize, openColumnsMenu } from "../components/table-columns.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const BASE_COLUMNS = [
  { key: "title", label: "Nombre", defaultWidth: 260, minWidth: 160, locked: true },
  { key: "dueDate", label: "Fecha límite", defaultWidth: 88, minWidth: 70 },
  { key: "assignee", label: "Responsables", defaultWidth: 96, minWidth: 60 },
  { key: "priority", label: "Prioridad", defaultWidth: 80, minWidth: 64 },
];

export function renderListView(container, { project, tasks, teamMembers, tagsRegistry, sortState, onSortChange, onOpenTask, onAddTask, currentUser }) {
  const customCols = (project.customFieldDefs || []).map((f) => ({ key: `cf:${f.id}`, label: f.name, fieldId: f.id, defaultWidth: 120, minWidth: 70 }));
  const allColumns = [...BASE_COLUMNS, ...customCols];
  const scopeKey = `project:${project.id}`;
  const prefs = (currentUser.columnPrefs || {})[scopeKey];
  const { visible, gridTemplate, widthOf } = resolveColumns(allColumns, prefs);

  const bySection = new Map(project.sections.map((s) => [s.id, []]));
  tasks.forEach((t) => {
    if (!bySection.has(t.sectionId)) bySection.set(t.sectionId, []);
    bySection.get(t.sectionId).push(t);
  });
  const sectionsSorted = [...project.sections].sort((a, b) => a.order - b.order);

  const headerHtml = `
    <div class="list-table__header" style="grid-template-columns:${gridTemplate};">
      ${columnHeaderCellsHtml(visible, widthOf, sortState)}
      <span></span>
    </div>`;

  const sectionsHtml = sectionsSorted
    .map((section) => {
      const sectionTasks = bySection.get(section.id) || [];
      const rows = sectionTasks
        .map((task) => {
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
                  ${task.tags.slice(0, 2).map((t) => tagPill(t, tagsRegistry)).join("")}
                </span>`;
              }
              if (col.key === "dueDate") {
                return `<span class="list-table__cell-text${overdue ? " is-overdue" : ""}">${task.dueDate ? formatDate(task.dueDate) : "—"}</span>`;
              }
              if (col.key === "assignee") {
                return `<span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("") || `<span class="list-table__cell-text">—</span>`}</span>`;
              }
              if (col.key === "priority") {
                return `<span class="tag-pill" style="background:${priorityColor(task.priority)};color:${textColorFor(priorityColor(task.priority))};">${priorityLabel(task.priority)}</span>`;
              }
              return `<span class="list-table__cell-text">${escapeHtml(task.customFields?.[col.fieldId] ?? "—")}</span>`;
            })
            .join("");
          return `
        <div class="list-row${task.isComplete ? " is-complete" : ""}" data-task-id="${task.id}" style="grid-template-columns:${gridTemplate};">
          ${cellsHtml}
          <span></span>
        </div>`;
        })
        .join("");

      return `
      <div class="section-block">
        <div class="section-header">
          <span class="section-header__name">${escapeHtml(section.name)}</span>
          <span class="section-header__count">${sectionTasks.length}</span>
          <button class="section-header__add" data-add-section="${section.id}">+ Añadir tarea</button>
        </div>
        ${rows || `<p style="color:var(--color-text-faint);font-size:12.5px;padding:8px 10px;">Sin tareas en esta sección.</p>`}
      </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="table-toolbar">
      <button type="button" class="btn btn--ghost btn--sm" id="btn-columns">☰ Columnas</button>
      <button type="button" class="btn btn--ghost btn--sm" id="list-add-field">+ Campo personalizado</button>
    </div>
    <div class="list-table-scroll"><div class="list-table">${headerHtml}${sectionsHtml}</div></div>`;

  container.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSortChange(btn.dataset.sort));
  });
  container.querySelector("#list-add-field").addEventListener("click", () =>
    openCustomFieldsModal({
      title: "Campos personalizados",
      hint: "Se podrán rellenar en cada tarea de este proyecto y usarse como columna y como filtro.",
      fields: project.customFieldDefs,
      onSave: (defs) => updateProject(project.id, { customFieldDefs: defs }),
    })
  );
  container.querySelector("#btn-columns").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openColumnsMenu({ x: rect.left, y: rect.bottom + 4, allColumns, hidden: prefs?.hidden, scopeKey, currentUserUid: currentUser.uid });
  });
  wireColumnResize(container, { visible, widthOf, scopeKey, currentUserUid: currentUser.uid });

  container.querySelectorAll("[data-check]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const task = tasks.find((t) => t.id === btn.dataset.check);
      toggleTaskComplete(task.id, !task.isComplete);
    });
  });
  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => onOpenTask(elx.dataset.open));
  });
  container.querySelectorAll("[data-add-section]").forEach((btn) => {
    btn.addEventListener("click", () => onAddTask(btn.dataset.addSection));
  });
  container.querySelectorAll(".list-row").forEach((row) => {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = tasks.find((t) => t.id === row.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
    });
  });
}

const PRIORITY_COLORS = { urgente: "var(--color-danger)", alta: "var(--color-signal)", media: "#78848C", baja: "var(--color-text-faint)" };
const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
function priorityColor(p) { return PRIORITY_COLORS[p] || "var(--color-line-bright)"; }
function priorityLabel(p) { return PRIORITY_LABELS[p] || p; }

export function openTaskContextMenu(x, y, task, onOpenTask) {
  openContextMenu({
    x, y,
    items: [
      { label: task.isComplete ? "Marcar como pendiente" : "Marcar como completada", icon: "✓", onClick: () => toggleTaskComplete(task.id, !task.isComplete) },
      { label: "Duplicar tarea", icon: "⧉", onClick: async () => { await duplicateTask(task); showToast("Tarea duplicada."); } },
      { label: task.isMilestone ? "Quitar de hitos" : "Convertir en hito", icon: "🚩", onClick: () => updateTask(task.id, { isMilestone: !task.isMilestone }) },
      { label: "Abrir detalles", icon: "↗", onClick: () => onOpenTask(task.id) },
      { divider: true },
      { label: "Eliminar tarea", icon: "🗑", danger: true, onClick: () => {
        if (confirm(`¿Eliminar "${task.title}"? No se puede deshacer.`)) { deleteTask(task.id); showToast("Tarea eliminada."); }
      } },
    ],
  });
}
