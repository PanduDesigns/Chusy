// ============================================================================
// Columnas redimensionables, ocultables y reordenables para las tablas de
// tareas (Lista de proyecto y Mis tareas).
//
// Ancho y "ocultas" son preferencias de cada persona POR ÁMBITO (el id de
// un proyecto, o "mytasks") — se guardan en su perfil bajo ese ámbito y no
// afectan a nadie más del equipo. El ORDEN en cambio es una preferencia
// única y GLOBAL de cada persona (`users/{uid}.columnOrder`, fuera de
// `columnPrefs`): reordenar columnas en Mis tareas o en cualquier proyecto
// aplica ese mismo orden en todos los sitios donde esas columnas existan.
//
// La columna "Nombre" siempre está bloqueada (`locked: true`): no se puede
// ocultar NI arrastrar — queda siempre primera, como ancla de la tabla.
// ============================================================================
import { el, escapeHtml } from "../utils.js";
import { setColumnWidth, setColumnHidden, setColumnOrder } from "../data/users.js";

/**
 * Reordena `columns` según `order` (el array de claves guardado por la
 * persona). Las bloqueadas (solo "Nombre") van siempre primero y en su
 * orden original; entre el resto, las claves presentes en `order`
 * respetan esa posición, y las que no aparecen ahí (una columna nueva que
 * todavía no se ha movido nunca, o una exclusiva de este contexto — p.ej.
 * un campo personalizado de un proyecto, o "Proyecto" en Mis tareas) se
 * quedan al final, en su orden de siempre.
 */
export function applyColumnOrder(columns, order) {
  const locked = columns.filter((c) => c.locked);
  const rest = columns.filter((c) => !c.locked);
  if (!order || !order.length) return [...locked, ...rest];
  const indexOf = new Map(order.map((key, i) => [key, i]));
  const sorted = [...rest].sort((a, b) => {
    const ai = indexOf.has(a.key) ? indexOf.get(a.key) : Infinity;
    const bi = indexOf.has(b.key) ? indexOf.get(b.key) : Infinity;
    return ai - bi;
  });
  return [...locked, ...sorted];
}

/** A partir de las columnas disponibles, el orden guardado y las preferencias de ancho/ocultas, decide qué se ve, en qué orden y con qué ancho. */
export function resolveColumns(allColumns, prefs, order) {
  const ordered = applyColumnOrder(allColumns, order);
  const hidden = new Set((prefs && prefs.hidden) || []);
  const widths = (prefs && prefs.widths) || {};
  const visible = ordered.filter((c) => c.locked || !hidden.has(c.key));
  const widthOf = (c) => Math.round(widths[c.key] || c.defaultWidth);
  const gridTemplate = visible.map((c) => `${widthOf(c)}px`).join(" ") + " 1fr";
  return { visible, gridTemplate, widthOf };
}

/** HTML de los botones de cabecera (ordenar + arrastrar para reordenar) con su tirador de redimensionado. */
export function columnHeaderCellsHtml(visible, widthOf, sortState) {
  return visible
    .map((col, i) => {
      const isActive = sortState && sortState.column === col.key;
      const arrow = isActive ? (sortState.direction === "desc" ? "↓" : "↑") : "";
      const handle = i < visible.length - 1 ? `<span class="col-resize-handle" data-resize="${col.key}"></span>` : "";
      const draggableAttr = col.locked ? "" : ` draggable="true"`;
      const lockedClass = col.locked ? " list-table__col--locked" : "";
      return `<button type="button" class="list-table__col${isActive ? " is-sorted" : ""}${lockedClass}" data-sort="${col.key}" data-colkey="${col.key}"${draggableAttr}><span class="list-table__col-label">${escapeHtml(col.label)}</span> <span class="list-table__arrow">${arrow}</span>${handle}</button>`;
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

/**
 * Calcula el nuevo array de claves (reordenables, visibles + ocultas) tras
 * mover `draggedKey` justo antes o después de `targetKey`. Función pura
 * (sin tocar el DOM ni Firestore) para que `wireColumnReorder` solo tenga
 * que guardar el resultado.
 */
export function moveColumnKey(allColumns, order, draggedKey, targetKey, before) {
  const currentKeys = applyColumnOrder(allColumns, order).filter((c) => !c.locked).map((c) => c.key);
  const withoutDragged = currentKeys.filter((k) => k !== draggedKey);
  const targetIdx = withoutDragged.indexOf(targetKey);
  if (targetIdx === -1) return currentKeys; // targetKey no es una columna reordenable conocida: no se toca nada
  const insertAt = before ? targetIdx : targetIdx + 1;
  withoutDragged.splice(insertAt, 0, draggedKey);
  return withoutDragged;
}

/**
 * Conecta el arrastre de las cabeceras para reordenar columnas (arrastrar
 * el título de una y soltarlo sobre otra la mueve a esa posición, antes o
 * después según de qué lado del centro se suelte). Mismo patrón de HTML5
 * drag & drop que ya usan las tarjetas del Tablero (board-view.js).
 *
 * "Nombre" no lleva `draggable` (ver columnHeaderCellsHtml), así que
 * nunca es el origen; tampoco puede ser destino porque siempre es la
 * primera columna y no se calcula ningún "antes de Nombre".
 *
 * `allColumns` debe ser el conjunto COMPLETO de columnas de este contexto
 * (visibles y ocultas), no solo `visible` — así una columna oculta en
 * este momento no pierde su posición relativa al recalcular el orden. El
 * resultado se guarda igual (con las ocultas incluidas) porque el orden
 * es compartido con otros contextos donde esas columnas sí podrían estar
 * visibles.
 */
export function wireColumnReorder(container, { allColumns, order, currentUserUid }) {
  let draggedKey = null;

  function clearDropMarkers() {
    container.querySelectorAll(".list-table__col").forEach((b) => b.classList.remove("is-drop-before", "is-drop-after"));
  }

  container.querySelectorAll(".list-table__col[draggable='true']").forEach((btn) => {
    btn.addEventListener("dragstart", (e) => {
      draggedKey = btn.dataset.colkey;
      btn.classList.add("is-dragging-col");
      e.dataTransfer.setData("text/plain", draggedKey);
      e.dataTransfer.effectAllowed = "move";
    });
    btn.addEventListener("dragend", () => {
      btn.classList.remove("is-dragging-col");
      clearDropMarkers();
      draggedKey = null;
    });
    btn.addEventListener("dragover", (e) => {
      if (!draggedKey || btn.dataset.colkey === draggedKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = btn.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      btn.classList.toggle("is-drop-before", before);
      btn.classList.toggle("is-drop-after", !before);
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("is-drop-before", "is-drop-after"));
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetKey = btn.dataset.colkey;
      clearDropMarkers();
      if (!draggedKey || draggedKey === targetKey) return;
      const rect = btn.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      setColumnOrder(currentUserUid, moveColumnKey(allColumns, order, draggedKey, targetKey, before));
    });
  });
}

/** Popover con una casilla por columna para mostrarla u ocultarla, en el mismo orden en que aparecen en la tabla. */
export function openColumnsMenu({ x, y, allColumns, order, hidden, scopeKey, currentUserUid }) {
  document.querySelectorAll(".columns-menu").forEach((m) => m.remove());
  const hiddenSet = new Set(hidden || []);
  const orderedColumns = applyColumnOrder(allColumns, order);

  const itemsHtml = orderedColumns
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
