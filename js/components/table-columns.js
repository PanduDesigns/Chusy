// ============================================================================
// Columnas redimensionables y ocultables para las tablas de tareas (Lista
// de proyecto y Mis tareas). Las preferencias (ancho + ocultas) son de
// cada persona — se guardan en su perfil bajo un "ámbito" (el id del
// proyecto, o "mytasks") y no afectan a nadie más del equipo.
//
// La columna "Nombre" siempre está bloqueada (no se puede ocultar) para
// no dejar la tabla sin ninguna columna visible.
// ============================================================================
import { el, escapeHtml } from "../utils.js";
import { setColumnWidth, setColumnHidden } from "../data/users.js";

/** A partir de las columnas disponibles y las preferencias guardadas, decide qué se ve y con qué ancho. */
export function resolveColumns(allColumns, prefs) {
  const hidden = new Set((prefs && prefs.hidden) || []);
  const widths = (prefs && prefs.widths) || {};
  const visible = allColumns.filter((c) => c.locked || !hidden.has(c.key));
  const widthOf = (c) => Math.round(widths[c.key] || c.defaultWidth);
  const gridTemplate = visible.map((c) => `${widthOf(c)}px`).join(" ") + " 1fr";
  return { visible, gridTemplate, widthOf };
}

/** HTML de los botones de cabecera (ordenar) con su tirador de redimensionado. */
export function columnHeaderCellsHtml(visible, widthOf, sortState) {
  return visible
    .map((col, i) => {
      const isActive = sortState && sortState.column === col.key;
      const arrow = isActive ? (sortState.direction === "desc" ? "↓" : "↑") : "";
      const handle = i < visible.length - 1 ? `<span class="col-resize-handle" data-resize="${col.key}"></span>` : "";
      return `<button type="button" class="list-table__col${isActive ? " is-sorted" : ""}" data-sort="${col.key}"><span class="list-table__col-label">${escapeHtml(col.label)}</span> <span class="list-table__arrow">${arrow}</span>${handle}</button>`;
    })
    .join("");
}

/**
 * Conecta el arrastre de los tiradores de redimensionado dentro de
 * `container` (mueve en vivo la rejilla de la cabecera y de cada fila que
 * coincida con `rowSelector`, y solo guarda en Firestore al soltar).
 */
export function wireColumnResize(container, { visible, widthOf, scopeKey, currentUserUid, rowSelector = ".list-table__header, .list-row" }) {
  container.querySelectorAll("[data-resize]").forEach((handle) => {
    handle.addEventListener("mousedown", (downEvt) => {
      downEvt.preventDefault();
      downEvt.stopPropagation();
      const key = handle.dataset.resize;
      const col = visible.find((c) => c.key === key);
      if (!col) return;
      const startX = downEvt.clientX;
      const startWidth = widthOf(col);
      const minW = col.minWidth || 56;
      let finalWidth = startWidth;
      document.body.classList.add("is-col-resizing");

      function onMove(moveEvt) {
        finalWidth = Math.max(minW, Math.round(startWidth + (moveEvt.clientX - startX)));
        const template = visible.map((c) => `${c.key === key ? finalWidth : widthOf(c)}px`).join(" ") + " 1fr";
        container.querySelectorAll(rowSelector).forEach((rowEl) => { rowEl.style.gridTemplateColumns = template; });
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("is-col-resizing");
        if (finalWidth !== startWidth) setColumnWidth(currentUserUid, scopeKey, key, finalWidth);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

/** Popover con una casilla por columna para mostrarla u ocultarla. */
export function openColumnsMenu({ x, y, allColumns, hidden, scopeKey, currentUserUid }) {
  document.querySelectorAll(".columns-menu").forEach((m) => m.remove());
  const hiddenSet = new Set(hidden || []);

  const itemsHtml = allColumns
    .map((c) => {
      const checked = c.locked || !hiddenSet.has(c.key);
      return `
      <label class="columns-menu__item${c.locked ? " is-locked" : ""}">
        <input type="checkbox" data-col="${c.key}" ${checked ? "checked" : ""} ${c.locked ? "disabled" : ""}>
        ${escapeHtml(c.label)}
      </label>`;
    })
    .join("");

  const menu = el(`
    <div class="columns-menu">
      <div class="columns-menu__title">Columnas visibles</div>
      ${itemsHtml}
    </div>`);
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  menu.querySelectorAll("[data-col]").forEach((cb) => {
    cb.addEventListener("change", () => {
      setColumnHidden(currentUserUid, scopeKey, cb.dataset.col, !cb.checked);
    });
  });

  function close() {
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
    menu.remove();
  }
  function onOutside(e) { if (!menu.contains(e.target)) close(); }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  setTimeout(() => {
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}
