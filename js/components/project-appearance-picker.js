// ============================================================================
// Selector de icono + color de un proyecto: una rejilla de emojis relacionados
// con procesos industriales para elegir rápido, un desplegable con más
// variedad para otros casos, y un campo para pegar/escribir cualquier otro
// emoji (así hay tantas posibilidades como emojis existen). El color elegido
// se usa para "sombrear" el fondo del icono y así distinguir proyectos entre
// sí de un vistazo. Compartido entre crear proyecto y editar uno existente.
// ============================================================================
import { escapeHtml, hexToRgba } from "../utils.js";

export const PROJECT_COLORS = ["#FCD000", "#78848C", "#4E9E9E", "#C4703E", "#6B9E78", "#8B85C4", "#D9776B", "#6BA4D9"];

/** Iconos a mano, pensados para proyectos de procesos industriales. */
export const CURATED_ICONS = [
  "📁", "🏭", "⚙️", "🔩", "🛠️", "🏗️", "🧱", "🪵",
  "🚗", "🚚", "🚲", "🚆", "✈️", "🚢", "🔌", "⚡",
];

/** Más variedad, para cuando ninguno de los anteriores encaja. */
const MORE_ICONS = [
  "🧰", "📦", "🧪", "🖥️", "🖨️", "📐", "📏", "🔧",
  "🔨", "🪛", "🧲", "🛞", "🏢", "🏠", "🌍", "🌬️",
  "☀️", "💧", "🔥", "♻️", "🧯", "🦺", "📡", "🚀",
  "🚁", "🛰️", "⛴️", "🚜", "🏔️", "🌳", "📊", "🗺️",
];

function badgeStyle(color) {
  return `background:${hexToRgba(color, 0.2)};box-shadow:inset 0 0 0 1px ${hexToRgba(color, 0.6)};`;
}

/**
 * Monta el selector dentro de `container`. Llama a `onChange({icon, color})`
 * cada vez que cambia alguno de los dos (incluida una notificación inicial
 * con los valores de partida, ya resueltos con sus valores por defecto).
 */
export function mountAppearancePicker(container, { icon, color, onChange }) {
  let state = { icon: icon || CURATED_ICONS[0], color: color || PROJECT_COLORS[0] };
  let showMore = false;

  function iconBtnHtml(i) {
    return `<button type="button" class="icon-grid__btn${i === state.icon ? " is-selected" : ""}" data-icon="${escapeHtml(i)}" title="${escapeHtml(i)}">${i}</button>`;
  }

  function render() {
    container.innerHTML = `
      <div class="appearance-picker">
        <span class="project-badge project-badge--lg" style="${badgeStyle(state.color)}">${escapeHtml(state.icon)}</span>
        <div class="appearance-picker__body">
          <div class="icon-grid">${CURATED_ICONS.map(iconBtnHtml).join("")}</div>
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
    state = { ...state, icon: trimmed };
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
}
