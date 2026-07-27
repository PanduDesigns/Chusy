// ============================================================================
// Vista de Lista: tabla con columnas (Nombre, Fecha límite, Responsables,
// Prioridad y los campos personalizados del proyecto), agrupada por
// sección. Cada columna se puede pulsar para ordenar (alfabético / fecha /
// prioridad / valor del campo), con flecha indicando la dirección. El "+"
// al final de la cabecera abre la definición de campos personalizados.
// ============================================================================
import { escapeHtml, formatDate, isOverdue, initials, colorFromString, textColorFor, showToast } from "../utils.js";
import { toggleTaskComplete, duplicateTask, updateTask, deleteTask } from "../data/tasks.js";
import { openContextMenu } from "../components/context-menu.js";
import { openCustomFieldsModal } from "../components/custom-fields-modal.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const BASE_COLUMNS = [
  { key: "title", label: "Nombre" },
  { key: "dueDate", label: "Fecha límite" },
  { key: "assignee", label: "Responsables" },
  { key: "priority", label: "Prioridad" },
];

export function renderListView(container, { project, tasks, teamMembers, tagsRegistry, sortState, onSortChange, onOpenTask, onAddTask }) {
  const customCols = (project.customFieldDefs || []).map((f) => ({ key: `cf:${f.id}`, label: f.name, fieldId: f.id }));
  const columns = [...BASE_COLUMNS, ...customCols];
  const gridTemplate = `1fr 96px 132px 84px ${customCols.map(() => "120px").join(" ")} 34px`;

  const bySection = new Map(project.sections.map((s) => [s.id, []]));
  tasks.forEach((t) => {
    if (!bySection.has(t.sectionId)) bySection.set(t.sectionId, []);
    bySection.get(t.sectionId).push(t);
  });
  const sectionsSorted = [...project.sections].sort((a, b) => a.order - b.order);

  const headerHtml = `
    <div class="list-table__header" style="grid-template-columns:${gridTemplate};">
      ${columns
        .map((col) => {
          const isActive = sortState && sortState.column === col.key;
          const arrow = isActive ? (sortState.direction === "desc" ? "↓" : "↑") : "";
          return `<button type="button" class="list-table__col${isActive ? " is-sorted" : ""}" data-sort="${col.key}">${escapeHtml(col.label)} <span class="list-table__arrow">${arrow}</span></button>`;
        })
        .join("")}
      <button type="button" class="list-table__col-add" id="list-add-field" title="Añadir campo personalizado">+</button>
    </div>`;

  const sectionsHtml = sectionsSorted
    .map((section) => {
      const sectionTasks = bySection.get(section.id) || [];
      const rows = sectionTasks
        .map((task) => {
          const overdue = isOverdue(task.dueDate, task.isComplete);
          const assignees = task.assigneeIds.map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
          const customCells = customCols
            .map((c) => `<span class="list-table__cell-text">${escapeHtml(task.customFields?.[c.fieldId] ?? "—")}</span>`)
            .join("");
          return `
        <div class="list-row${task.isComplete ? " is-complete" : ""}" data-task-id="${task.id}" style="grid-template-columns:${gridTemplate};">
          <span class="list-row__title-cell">
            <span class="task-row__priority priority-${task.priority}${task.priority === "urgente" && !task.isComplete ? " is-pulse" : ""}"></span>
            <button class="task-row__check${task.isComplete ? " is-checked" : ""}" data-check="${task.id}">${task.isComplete ? "✓" : ""}</button>
            <span class="task-row__title" data-open="${task.id}">${task.isMilestone ? "🚩 " : ""}${escapeHtml(task.title)}</span>
            ${task.tags.slice(0, 2).map((t) => tagPill(t, tagsRegistry)).join("")}
          </span>
          <span class="list-table__cell-text${overdue ? " is-overdue" : ""}">${task.dueDate ? formatDate(task.dueDate) : "—"}</span>
          <span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("") || `<span class="list-table__cell-text">—</span>`}</span>
          <span class="tag-pill" style="background:${priorityColor(task.priority)};color:${textColorFor(priorityColor(task.priority))};">${priorityLabel(task.priority)}</span>
          ${customCells}
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

  container.innerHTML = `<div class="list-table">${headerHtml}${sectionsHtml}</div>`;

  container.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSortChange(btn.dataset.sort));
  });
  container.querySelector("#list-add-field").addEventListener("click", () => openCustomFieldsModal({ project }));

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
