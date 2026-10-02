// ============================================================================
// Topbar: título del proyecto, contador de tareas, cambio de vista,
// "Insertar producto" (Creación Rápida — se llamó "Nueva cabina" hasta la
// v55) y nueva tarea.
//
// En Ofertas (v56, ver offers.js) el vocabulario pasa a ser el de una
// oferta ("+ Nueva oferta", "3 ofertas") y el botón de Insertar producto
// no se pinta: crear las tareas predefinidas de un producto no tiene
// sentido en esa sección.
//
// v60: si el proyecto tiene rellena la «Ubicación» de sus Propiedades (v57),
// aparece el botón «Abrir Ubicación» (ver components/open-location.js). Esta
// barra va justa de ancho, así que el botón se encoge con la pantalla (CSS,
// `.open-location-btn--topbar`): con texto en pantallas anchas, solo el icono
// 📂 en las intermedias y oculto en las estrechas — siempre queda el de la
// ficha de la oferta y el de Propiedades.
// ============================================================================
import { escapeHtml, projectIcon } from "../utils.js";
import { isOffersProject } from "../offers.js";
import { hasLocation, normalizeLocation, OPEN_LOCATION_ICON, OPEN_LOCATION_TEXT } from "../location.js";
import { openLocation } from "./open-location.js";

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

  // v60: «Abrir Ubicación» solo si la Ubicación de las Propiedades del
  // proyecto está rellena (en Ofertas no hay Propiedades: ahí el botón vive
  // en la ficha de cada oferta).
  const locationValue = project.properties ? project.properties.ubicacion : "";
  const showOpenLocation = hasLocation(locationValue);

  container.innerHTML = `
    <button class="btn btn--ghost btn--sm sidebar-toggle" id="btn-toggle-sidebar" style="display:none;">☰</button>
    <div>
      <span class="topbar__title">${escapeHtml(projectIcon(project))} ${escapeHtml(project.name)}</span>
      <span class="topbar__count">${taskCount} ${taskCount === 1 ? noun.one : noun.many}</span>
    </div>
    <div class="topbar__views">${viewButtons}</div>
    ${showOpenLocation ? `<button class="btn btn--ghost btn--sm open-location-btn open-location-btn--topbar" id="btn-open-location" type="button" data-keep-label aria-label="${OPEN_LOCATION_TEXT}" title="${OPEN_LOCATION_TEXT}: ${escapeHtml(normalizeLocation(locationValue).value)}"><span aria-hidden="true">${OPEN_LOCATION_ICON}</span><span class="open-location-btn__label">${OPEN_LOCATION_TEXT}</span></button>` : ""}
    ${isOffers ? "" : `<button class="btn btn--ghost btn--sm" id="btn-quick-create" type="button" ${canUseQuickCreate ? "" : "disabled"} title="${quickCreateTitle}">⚡ Insertar producto</button>`}
    <button class="btn btn--primary btn--sm" id="btn-new-task">+ Nueva ${noun.one}</button>
  `;

  container.querySelectorAll(".topbar__view-btn").forEach((btn) => {
    btn.addEventListener("click", () => onViewChange(btn.dataset.view));
  });
  const openLocationBtn = container.querySelector("#btn-open-location");
  if (openLocationBtn) openLocationBtn.addEventListener("click", () => { openLocation(locationValue, openLocationBtn); });
  const quickCreateBtn = container.querySelector("#btn-quick-create");
  if (quickCreateBtn && canUseQuickCreate) quickCreateBtn.addEventListener("click", onOpenQuickCreate);
  container.querySelector("#btn-new-task").addEventListener("click", () => onNewTask());
  const toggleBtn = container.querySelector("#btn-toggle-sidebar");
  if (window.innerWidth <= 860) toggleBtn.style.display = "inline-flex";
  toggleBtn.addEventListener("click", onToggleSidebar);
}
