// ============================================================================
// Barra de filtros: un cuadro de búsqueda por texto (opcional, ver
// `onSearchChange` más abajo) seguido de un botón por cada columna
// filtrable (Responsable, Prioridad, Estado, Etiquetas y cualquier campo
// personalizado del proyecto). Cada botón abre un desplegable con
// casillas; todo se aplica al momento, sin botón de confirmar.
// ============================================================================
import { escapeHtml, badgeHtml, debounce } from "../utils.js";

/**
 * filterDefs: [{ key, label, options: [{ value, label, color?, icon? }] }]
 * activeFilters: { [key]: Set(valores) }
 *
 * searchText/onSearchChange (opcionales): si se pasa `onSearchChange`, se
 * muestra el cuadro de búsqueda por texto al principio de la barra. Se
 * llama con un pequeño retardo tras dejar de teclear (debounce, no en cada
 * pulsación) para no recalcular la lista filtrada más veces de las
 * necesarias en listas largas — quien llama (app.js) es responsable de NO
 * volver a pintar esta misma barra en la respuesta a ese cambio (solo el
 * contenido de debajo), o el cuadro perdería el foco a media escritura.
 */
export function renderFilterBar(container, { filterDefs, activeFilters, onChange, searchText = "", onSearchChange }) {
  const defs = filterDefs || [];
  const showSearch = typeof onSearchChange === "function";
  if (!defs.length && !showSearch) { container.innerHTML = ""; return; }

  const hasActive = Object.values(activeFilters || {}).some((s) => s && s.size > 0);

  container.innerHTML = `
    <div class="filterbar__row">
      ${showSearch ? `
        <div class="filterbar__search-wrap">
          <span class="filterbar__search-icon">🔍</span>
          <input type="text" class="filterbar__search" id="fb-search" placeholder="Buscar por nombre o descripción…" value="${escapeHtml(searchText)}" autocomplete="off">
        </div>` : ""}
      ${defs.length ? `<span class="filterbar__label">Filtrar por</span>` : ""}
      ${defs
        .map((def) => {
          const active = activeFilters[def.key];
          const count = active ? active.size : 0;
          return `<button type="button" class="filterbar__btn${count ? " has-active" : ""}" data-filter-key="${def.key}">
            ${escapeHtml(def.label)}${count ? `<span class="filterbar__count">${count}</span>` : ""}
          </button>`;
        })
        .join("")}
      ${hasActive ? `<button type="button" class="filterbar__clear" id="fb-clear">✕ Limpiar filtros</button>` : ""}
    </div>
  `;

  if (showSearch) {
    const searchInput = container.querySelector("#fb-search");
    const debouncedChange = debounce(onSearchChange, 200);
    searchInput.addEventListener("input", () => debouncedChange(searchInput.value));
  }

  container.querySelectorAll("[data-filter-key]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const def = filterDefs.find((d) => d.key === btn.dataset.filterKey);
      openFilterPopover(btn, def, activeFilters[def.key] || new Set(), (newSet) => onChange(def.key, newSet));
    });
  });

  const clearBtn = container.querySelector("#fb-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      defs.forEach((def) => onChange(def.key, new Set()));
      if (showSearch) onSearchChange("");
    });
  }
}

function openFilterPopover(anchorBtn, def, currentSet, onApply) {
  document.querySelectorAll(".filter-popover").forEach((p) => p.remove());

  const rect = anchorBtn.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "filter-popover";
  pop.innerHTML = def.options.length
    ? def.options
        .map(
          (opt) => `
      <label class="filter-popover__item">
        <input type="checkbox" ${currentSet.has(opt.value) ? "checked" : ""} data-value="${escapeHtml(opt.value)}">
        ${opt.icon ? badgeHtml(opt.icon, opt.color, "project-badge--sm") : opt.color ? `<span class="filter-popover__dot" style="background:${opt.color}"></span>` : ""}
        <span>${escapeHtml(opt.label)}</span>
      </label>`
        )
        .join("")
    : `<p style="color:var(--color-text-faint);font-size:12px;padding:6px 8px;">Sin opciones todavía.</p>`;
  document.body.appendChild(pop);

  const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 260);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${rect.bottom + 6}px`;

  const set = new Set(currentSet);
  pop.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? set.add(input.dataset.value) : set.delete(input.dataset.value);
      onApply(new Set(set));
    });
  });

  function onOutside(e) {
    if (!pop.contains(e.target) && e.target !== anchorBtn) {
      pop.remove();
      document.removeEventListener("click", onOutside);
      document.removeEventListener("keydown", onKeydown);
    }
  }
  function onKeydown(e) {
    if (e.key === "Escape") { pop.remove(); document.removeEventListener("click", onOutside); document.removeEventListener("keydown", onKeydown); }
  }
  setTimeout(() => {
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}
