// ============================================================================
// Selector de icono + color de un proyecto: una rejilla de emojis relacionados
// con procesos industriales para elegir rápido, un desplegable con más
// variedad para otros casos, y un campo para pegar/escribir cualquier otro
// emoji (así hay tantas posibilidades como emojis existen). El color elegido
// se usa para "sombrear" el fondo del icono y así distinguir proyectos entre
// sí de un vistazo. Compartido entre crear proyecto y editar uno existente.
// ============================================================================
import { escapeHtml, hexToRgba, FOLDER_ICON, CAR_ICON, defaultIconForSector } from "../utils.js";

export { FOLDER_ICON, CAR_ICON, defaultIconForSector };

export const PROJECT_COLORS = ["#FCD000", "#78848C", "#4E9E9E", "#C4703E", "#6B9E78", "#8B85C4", "#D9776B", "#6BA4D9"];

/** Iconos a mano, pensados para proyectos de procesos industriales. */
export const CURATED_ICONS = [
  FOLDER_ICON, "🏭", "⚙️", "🔩", "🛠️", "🏗️", "🧱", "🪵",
  "🧰", "📦", "🚲", "🚆", "✈️", "🚢", "🔌", "⚡",
];

/**
 * v87 · Coches y vehículos, para que el equipo de Automoción distinga sus proyectos de un vistazo. Cada uno es un
 * emoji (igual que el resto de iconos: es el valor que se guarda en `project.icon`) y `label` es su nombre en el
 * tooltip. El primero, el coche, es el icono por defecto de un proyecto de Automoción (CAR_ICON).
 */
export const AUTOMOTIVE_ICONS = [
  { icon: CAR_ICON, label: "Coche turismo / sedán" },
  { icon: "🏎️", label: "Deportivo / coupé" },
  { icon: "🚙", label: "SUV / todoterreno / 4x4" },
  { icon: "🚐", label: "Furgoneta / vehículo comercial" },
  { icon: "🚛", label: "Camión / vehículo industrial" },
  { icon: "🔧", label: "Chasis / carrocería / taller" },
];

/** Más variedad, para cuando ninguno de los anteriores encaja. */
const MORE_ICONS = [
  "🧪", "🖥️", "🖨️", "📐", "📏", "🔨", "🪛", "🧲",
  "🛞", "🏢", "🏠", "🌍", "🌬️", "☀️", "💧", "🔥",
  "♻️", "🧯", "🦺", "📡", "🚀", "🚁", "🛰️", "⛴️",
  "🚜", "🚚", "🏔️", "🌳", "📊", "🗺️",
];

function badgeStyle(color) {
  return `background:${hexToRgba(color, 0.2)};box-shadow:inset 0 0 0 1px ${hexToRgba(color, 0.6)};`;
}

/**
 * Monta el selector dentro de `container`. Llama a `onChange({icon, color})`
 * cada vez que cambia alguno de los dos (incluida una notificación inicial
 * con los valores de partida, ya resueltos con sus valores por defecto).
 *
 * v87: `sector` (opcional) fija el icono de partida cuando no se pasa `icon`: el coche para «Automoción», la carpeta
 * para el resto. Devuelve `{ applySector(sector) }`: al cambiar el Sector del formulario se le avisa, y mientras la
 * persona NO haya elegido un icono ella misma (ni pulsando uno ni pegando un emoji) y siga el de por defecto
 * (carpeta o coche), el selector pasa al que toca al sector; si ya eligió uno a mano, su elección no se toca.
 */
export function mountAppearancePicker(container, { icon, color, sector, onChange }) {
  let state = { icon: icon || defaultIconForSector(sector) || CURATED_ICONS[0], color: color || PROJECT_COLORS[0] };
  let showMore = false;
  let touched = false; // v87: ¿ha elegido el usuario un icono a mano?

  function iconBtnHtml(i, label) {
    return `<button type="button" class="icon-grid__btn${i === state.icon ? " is-selected" : ""}" data-icon="${escapeHtml(i)}" title="${escapeHtml(label || i)}">${i}</button>`;
  }

  function render() {
    container.innerHTML = `
      <div class="appearance-picker">
        <span class="project-badge project-badge--lg" style="${badgeStyle(state.color)}">${escapeHtml(state.icon)}</span>
        <div class="appearance-picker__body">
          <div class="icon-grid">${CURATED_ICONS.map(iconBtnHtml).join("")}</div>
          <div class="appearance-picker__group" id="ap-automotive">
            <span class="appearance-picker__group-label">Automoción</span>
            <div class="icon-grid">${AUTOMOTIVE_ICONS.map(({ icon: i, label }) => iconBtnHtml(i, label)).join("")}</div>
          </div>
          <button type="button" class="appearance-picker__more" id="ap-toggle-more">${showMore ? "Menos iconos ▴" : "Más iconos ▾"}</button>
          ${showMore ? `<div class="icon-grid" style="margin-top:6px;">${MORE_ICONS.map(iconBtnHtml).join("")}</div>` : ""}
          <input type="text" class="field__input appearance-picker__custom" id="ap-custom" placeholder="…o pega aquí otro emoji" maxlength="8">
        </div>
      </div>
      <div class="chip-select" style="margin-top:10px;">
        ${PROJECT_COLORS.map((c) => `<button type="button" class="chip color-swatch${c === state.color ? " is-selected" : ""}" data-color="${c}" style="border-color:${c}"><span class="chip__dot" style="background:${c}"></span></button>`).join("")}
      </div>
    `;
    wire();
  }

  function setIcon(newIcon) {
    const trimmed = (newIcon || "").trim();
    if (!trimmed) return;
    touched = true;
    state = { ...state, icon: trimmed };
    render();
    onChange({ ...state });
  }
  /** v87: el formulario cambió de Sector → el icono por defecto (carpeta ↔ coche) lo sigue, salvo que ya lo eligieran a mano. */
  function applySector(newSector) {
    if (touched) return;
    if (state.icon !== FOLDER_ICON && state.icon !== CAR_ICON) return;
    const wanted = defaultIconForSector(newSector);
    if (state.icon === wanted) return;
    state = { ...state, icon: wanted };
    render();
    onChange({ ...state });
  }
  function setColor(newColor) {
    state = { ...state, color: newColor };
    render();
    onChange({ ...state });
  }

  function wire() {
    container.querySelectorAll("[data-icon]").forEach((btn) => {
      btn.addEventListener("click", () => setIcon(btn.dataset.icon));
    });
    container.querySelector("#ap-toggle-more").addEventListener("click", () => {
      showMore = !showMore;
      render();
    });
    container.querySelectorAll("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => setColor(btn.dataset.color));
    });
    const custom = container.querySelector("#ap-custom");
    custom.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); setIcon(custom.value); }
    });
    custom.addEventListener("blur", () => setIcon(custom.value));
  }

  render();
  onChange({ ...state });
  return { applySector };
}
