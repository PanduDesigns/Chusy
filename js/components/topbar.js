// ============================================================================
// Topbar: título del proyecto, contador de tareas, cambio de vista, nueva tarea.
// ============================================================================
import { escapeHtml, projectIcon } from "../utils.js";

const VIEWS = [
  { id: "list", label: "Lista" },
  { id: "board", label: "Tablero" },
  { id: "calendar", label: "Calendario" },
  { id: "timeline", label: "Línea de tiempo" },
];

export function renderTopbar(container, { project, taskCount, currentView, onViewChange, onNewTask, onToggleSidebar }) {
  const viewButtons = VIEWS.map(
    (v) => `<button class="topbar__view-btn${v.id === currentView ? " is-active" : ""}" data-view="${v.id}">${v.label}</button>`
  ).join("");

  container.innerHTML = `
    <button class="btn btn--ghost btn--sm sidebar-toggle" id="btn-toggle-sidebar" style="display:none;">☰</button>
    <div>
      <span class="topbar__title">${escapeHtml(projectIcon(project))} ${escapeHtml(project.name)}</span>
      <span class="topbar__count">${taskCount} ${taskCount === 1 ? "tarea" : "tareas"}</span>
    </div>
    <div class="topbar__views">${viewButtons}</div>
    <button class="btn btn--primary btn--sm" id="btn-new-task">+ Nueva tarea</button>
  `;

  container.querySelectorAll(".topbar__view-btn").forEach((btn) => {
    btn.addEventListener("click", () => onViewChange(btn.dataset.view));
  });
  container.querySelector("#btn-new-task").addEventListener("click", () => onNewTask());
  const toggleBtn = container.querySelector("#btn-toggle-sidebar");
  if (window.innerWidth <= 860) toggleBtn.style.display = "inline-flex";
  toggleBtn.addEventListener("click", onToggleSidebar);
}
