// ============================================================================
// Vista "Mis tareas": todo lo asignado a la persona, en cualquier proyecto
// (más sus recordatorios personales), agrupado por urgencia de fecha y
// con columnas ordenables (como la vista personal de Asana).
// ============================================================================
import { escapeHtml, formatDate, isOverdue, toDate, initials, colorFromString, textColorFor } from "../utils.js";
import { openTaskContextMenu } from "./list-view.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const PRIORITY_COLORS = { urgente: "var(--color-danger)", alta: "var(--color-signal)", media: "#78848C", baja: "var(--color-text-faint)" };
const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
const GRID_TEMPLATE = "1fr 96px 132px 84px 140px";

const COLUMNS = [
  { key: "title", label: "Nombre" },
  { key: "dueDate", label: "Fecha límite" },
  { key: "assignee", label: "Responsables" },
  { key: "priority", label: "Prioridad" },
  { key: "project", label: "Proyecto" },
];

export function renderMyTasksView(container, { tasks, teamMembers, projects, tagsRegistry, sortState, onSortChange, onOpenTask }) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekLimit = new Date(todayStart);
  weekLimit.setDate(weekLimit.getDate() + 7);

  const groups = { vencidas: [], hoy: [], semana: [], adelante: [], sinFecha: [] };
  tasks.forEach((task) => {
    if (!task.dueDate) { groups.sinFecha.push(task); return; }
    const d = toDate(task.dueDate);
    if (!d) { groups.sinFecha.push(task); return; }
    if (d.getTime() < todayStart.getTime()) {
      (task.isComplete ? groups.hoy : groups.vencidas).push(task);
    } else if (d.getTime() === todayStart.getTime()) {
      groups.hoy.push(task);
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
    { key: "semana", label: "Esta semana" },
    { key: "adelante", label: "Más adelante" },
    { key: "sinFecha", label: "Sin fecha" },
  ];
  const nonEmpty = sections.filter((s) => groups[s.key].length);

  if (!nonEmpty.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__eyebrow">— MIS TAREAS —</span>
        <h2>No tienes tareas asignadas</h2>
        <p>Cuando alguien te asigne una tarea en cualquier proyecto, o crees un recordatorio personal, aparecerá aquí.</p>
      </div>`;
    return;
  }

  const headerHtml = `
    <div class="list-table__header" style="grid-template-columns:${GRID_TEMPLATE};">
      ${COLUMNS.map((col) => {
        const isActive = sortState && sortState.column === col.key;
        const arrow = isActive ? (sortState.direction === "desc" ? "↓" : "↑") : "";
        return `<button type="button" class="list-table__col${isActive ? " is-sorted" : ""}" data-sort="${col.key}">${escapeHtml(col.label)} <span class="list-table__arrow">${arrow}</span></button>`;
      }).join("")}
    </div>`;

  const rowHtml = (task) => {
    const project = projects.find((p) => p.id === task.projectId);
    const overdue = isOverdue(task.dueDate, task.isComplete);
    const assignees = task.assigneeIds.map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
    const projectLabel = !task.projectId
      ? `<span class="tag-pill" style="background:var(--color-signal-soft);color:var(--color-signal);">🔒 Personal</span>`
      : project
      ? `<span class="tag-pill" style="background:${project.color};color:${textColorFor(project.color)};">${escapeHtml(project.name)}</span>`
      : `<span class="list-table__cell-text">—</span>`;
    return `
      <div class="list-row${task.isComplete ? " is-complete" : ""}" data-task-id="${task.id}" style="grid-template-columns:${GRID_TEMPLATE};">
        <span class="list-row__title-cell">
          <span class="task-row__priority priority-${task.priority}${task.priority === "urgente" && !task.isComplete ? " is-pulse" : ""}"></span>
          <span class="task-row__title" data-open="${task.id}">${task.isMilestone ? "🚩 " : ""}${escapeHtml(task.title)}</span>
          ${task.tags.slice(0, 2).map((t) => tagPill(t, tagsRegistry)).join("")}
        </span>
        <span class="list-table__cell-text${overdue ? " is-overdue" : ""}">${task.dueDate ? formatDate(task.dueDate) : "—"}</span>
        <span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("") || `<span class="list-table__cell-text">—</span>`}</span>
        <span class="tag-pill" style="background:${PRIORITY_COLORS[task.priority] || "#8B959C"};color:${textColorFor(PRIORITY_COLORS[task.priority] || "#8B959C")};">${PRIORITY_LABELS[task.priority] || task.priority}</span>
        ${projectLabel}
      </div>`;
  };

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

  container.innerHTML = `<div class="list-table">${headerHtml}${sectionsHtml}</div>`;

  container.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSortChange(btn.dataset.sort));
  });
  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => onOpenTask(elx.dataset.open));
  });
  container.querySelectorAll(".list-row").forEach((row) => {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = tasks.find((t) => t.id === row.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
    });
  });
}
