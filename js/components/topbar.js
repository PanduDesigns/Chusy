// ============================================================================
// Topbar: título del proyecto, contador de tareas, cambio de vista,
// "Insertar producto" (Creación Rápida — se llamó "Nueva cabina" hasta la
// v55) y nueva tarea.
//
// En Ofertas (v56, ver offers.js) el vocabulario pasa a ser el de una
// oferta ("+ Nueva oferta", "3 ofertas") y el botón de Insertar producto
// no se pinta: crear las tareas predefinidas de un producto no tiene
// sentido en esa sección.
// ============================================================================
import { escapeHtml, projectIcon } from "../utils.js";
import { isOffersProject } from "../offers.js";

const VIEWS = [
  { id: "list", label: "Lista" },
  { id: "board", label: "Tablero" },
  { id: "calendar", label: "Calendario" },
  { id: "timeline", label: "Línea de tiempo" },
];

export function renderTopbar(container, { project, taskCount, currentView, onViewChange, onNewTask, onToggleSidebar, quickCreateEnabled, isAdmin, onOpenQuickCreate }) {
  const viewButtons = VIEWS.map(
    (v) => `<button class="topbar__view-btn${v.id === currentView ? " is-active" : ""}" data-view="${v.id}">${v.label}</button>`
  ).join("");

  // El botón siempre se ve (para que todo el equipo sepa que existe), pero
  // solo se puede pulsar siendo admin o con "Insertar producto" ya activado para
  // todo el mundo (interruptor del panel "Creación Rápida" — ver
  // quick-create-admin-modal.js) — así un admin puede dejarlo todo
  // preparado (productos configurados) antes de anunciarlo.
  const isOffers = isOffersProject(project);
  const noun = isOffers ? { one: "oferta", many: "ofertas" } : { one: "tarea", many: "tareas" };
  const canUseQuickCreate = isAdmin || quickCreateEnabled;
  const quickCreateTitle = canUseQuickCreate
    ? "Crear un conjunto de tareas predefinido en este proyecto"
    : "Un administrador debe activar esta función para todo el equipo antes de que puedas usarla";

  container.innerHTML = `
    <button class="btn btn--ghost btn--sm sidebar-toggle" id="btn-toggle-sidebar" style="display:none;">☰</button>
    <div>
      <span class="topbar__title">${escapeHtml(projectIcon(project))} ${escapeHtml(project.name)}</span>
      <span class="topbar__count">${taskCount} ${taskCount === 1 ? noun.one : noun.many}</span>
    </div>
    <div class="topbar__views">${viewButtons}</div>
    ${isOffers ? "" : `<button class="btn btn--ghost btn--sm" id="btn-quick-create" type="button" ${canUseQuickCreate ? "" : "disabled"} title="${quickCreateTitle}">⚡ Insertar producto</button>`}
    <button class="btn btn--primary btn--sm" id="btn-new-task">+ Nueva ${noun.one}</button>
  `;

  container.querySelectorAll(".topbar__view-btn").forEach((btn) => {
    btn.addEventListener("click", () => onViewChange(btn.dataset.view));
  });
  const quickCreateBtn = container.querySelector("#btn-quick-create");
  if (quickCreateBtn && canUseQuickCreate) quickCreateBtn.addEventListener("click", onOpenQuickCreate);
  container.querySelector("#btn-new-task").addEventListener("click", () => onNewTask());
  const toggleBtn = container.querySelector("#btn-toggle-sidebar");
  if (window.innerWidth <= 860) toggleBtn.style.display = "inline-flex";
  toggleBtn.addEventListener("click", onToggleSidebar);
}
