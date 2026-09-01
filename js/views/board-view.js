// ============================================================================
// Vista de Tablero (Kanban): columnas = secciones, arrastrar y soltar entre
// columnas y para reordenar dentro de la misma columna.
// ============================================================================
import { escapeHtml, formatDate, isOverdue, initials, colorFromString, textColorFor, getTaskSectionForProject } from "../utils.js";
import { moveTask } from "../data/tasks.js";
import { openTaskContextMenu } from "./list-view.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const PRIORITY_COLORS = {
  urgente: "var(--color-danger)",
  alta: "var(--color-signal)",
  media: "#78848C",
  baja: "var(--color-text-faint)",
};

export function renderBoardView(container, { project, tasks, teamMembers, tagsRegistry, onOpenTask, onAddTask }) {
  const bySection = new Map(project.sections.map((s) => [s.id, []]));
  const noSectionTasks = [];
  tasks.forEach((t) => {
    // La sección de la tarea DENTRO de este proyecto en concreto: si este
    // proyecto es su principal, es t.sectionId de siempre; si lo tiene
    // como adicional (ver extraProjectIds), sale de t.extraSections — ver
    // getTaskSectionForProject en utils.js.
    const sid = getTaskSectionForProject(t, project.id);
    if (bySection.has(sid)) bySection.get(sid).push(t);
    else noSectionTasks.push(t); // sin sección, o de una sección ya eliminada
  });
  const sectionsSorted = [...project.sections].sort((a, b) => a.order - b.order);
  // "Sin sección" es una columna más para poder arrastrar tareas dentro y
  // fuera de ella (con id "" — moveTask la guarda como sectionId: null,
  // ver más abajo), pero solo aparece si hace falta: no tiene sentido
  // mostrarla vacía todo el rato en un proyecto sin tareas huérfanas.
  // Va PRIMERA, no al final: una columna huérfana al fondo del tablero es
  // fácil de perder de vista (hay que hacer scroll horizontal para verla)
  // y esas tareas acaban olvidadas sin clasificar.
  const columnsToRender = noSectionTasks.length
    ? [{ id: "", name: "Sin sección" }, ...sectionsSorted]
    : sectionsSorted;

  container.innerHTML = `<div class="board">
    ${columnsToRender
      .map((section) => {
        const colTasks = (section.id ? bySection.get(section.id) : noSectionTasks) || [];
        colTasks.sort((a, b) => (a.order || 0) - (b.order || 0));
        return `
        <div class="board-col">
          <div class="board-col__header">
            <span class="board-col__name">${escapeHtml(section.name)}</span>
            <span class="board-col__count">${colTasks.length}</span>
          </div>
          <div class="board-col__body" data-drop-section="${section.id}">
            ${colTasks.map((task) => cardHtml(task, teamMembers, tagsRegistry)).join("")}
          </div>
          <button class="board-col__add" data-add-section="${section.id}">+ Tarea</button>
        </div>`;
      })
      .join("")}
  </div>`;

  container.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("click", () => onOpenTask(card.dataset.taskId));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = tasks.find((t) => t.id === card.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
    });
    card.addEventListener("dragstart", (e) => {
      card.classList.add("is-dragging");
      e.dataTransfer.setData("text/plain", card.dataset.taskId);
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
  });

  container.querySelectorAll("[data-add-section]").forEach((btn) => {
    btn.addEventListener("click", () => onAddTask(btn.dataset.addSection));
  });

  container.querySelectorAll(".board-col__body").forEach((colBody) => {
    colBody.addEventListener("dragover", (e) => {
      e.preventDefault();
      colBody.classList.add("is-drag-over");
    });
    colBody.addEventListener("dragleave", () => colBody.classList.remove("is-drag-over"));
    colBody.addEventListener("drop", (e) => {
      e.preventDefault();
      colBody.classList.remove("is-drag-over");
      const taskId = e.dataTransfer.getData("text/plain");
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const sectionId = colBody.dataset.dropSection || null; // "" (columna "Sin sección") se guarda como null, igual que en el resto de la app
      const siblings = [...colBody.querySelectorAll(".task-card")].filter((c) => c.dataset.taskId !== taskId);
      const afterEl = getDragAfterElement(colBody, e.clientY);
      let newOrder;
      if (!afterEl) {
        const lastEl = siblings[siblings.length - 1];
        const lastTask = lastEl ? tasks.find((t) => t.id === lastEl.dataset.taskId) : null;
        newOrder = (lastTask ? lastTask.order : 0) + 1;
      } else {
        const idx = siblings.indexOf(afterEl);
        const afterTask = tasks.find((t) => t.id === afterEl.dataset.taskId);
        const beforeEl = siblings[idx - 1];
        const beforeTask = beforeEl ? tasks.find((t) => t.id === beforeEl.dataset.taskId) : null;
        newOrder = beforeTask ? (beforeTask.order + afterTask.order) / 2 : afterTask.order - 1;
      }
      moveTask(taskId, sectionId, newOrder, project.id, task.projectId !== project.id);
    });
  });
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll(".task-card:not(.is-dragging)")];
  return cards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function cardHtml(task, teamMembers, tagsRegistry) {
  const overdue = isOverdue(task.dueDate, task.isComplete);
  const assignees = task.assigneeIds.map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
  return `
    <div class="task-card" draggable="true" data-task-id="${task.id}" style="border-left-color:${PRIORITY_COLORS[task.priority] || "var(--color-line-bright)"}">
      <div class="task-card__title" style="${task.isComplete ? "text-decoration:line-through;color:var(--color-text-faint);" : ""}">${task.isMilestone ? "🚩 " : ""}${escapeHtml(task.title)}</div>
      ${task.tags.length ? `<div class="task-card__tags">${task.tags.slice(0, 3).map((t) => tagPill(t, tagsRegistry)).join("")}</div>` : ""}
      <div class="task-card__footer">
        ${task.dueDate ? `<span class="task-card__due${overdue ? " is-overdue" : ""}">${formatDate(task.dueDate)}</span>` : ""}
        <span class="task-card__spacer"></span>
        ${task.subtasks.length ? `<span class="task-card__subtasks">${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}</span>` : ""}
        <div class="avatar-stack">
          ${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("")}
        </div>
      </div>
    </div>`;
}
