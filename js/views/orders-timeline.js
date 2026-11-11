// ============================================================================
// Cronograma de «Pedidos» (v88) — la vista híbrida tabla + línea de tiempo, estilo hoja de control de compras:
// a la IZQUIERDA, columnas fijas (Proyecto con su color + Descripción) y las opcionales que cada persona elige en
// «⚙️ Columnas»; a la DERECHA, la rejilla de días agrupados por semanas ISO (S46, S47…) y meses, con los fines de semana
// y festivos del calendario laboral sombreados, el día de hoy marcado y una barra por pedido con su Nº de pedido dentro.
//
// Toda la lógica (rangos de fechas, semanas ISO, ventana, orden, columnas y su persistencia) es PURA y vive en js/orders.js.
// Aquí solo hay pantalla. El scroll vertical y el horizontal son los de UN ÚNICO contenedor: la cabecera es `sticky` arriba
// y el bloque izquierdo es `sticky` a la izquierda, así las filas de la tabla y las de la rejilla no se pueden desalinear.
// La rejilla NO pinta una celda por día y fila: los fines de semana/festivos/hoy son columnas superpuestas (una por día) y
// las barras van posicionadas, así que cientos de pedidos no cuestan miles de nodos.
//
// v89 · INTERACTIVO:
//  · Columnas: cada cabecera lleva un tirador `.orders-tl-col-resizer` en su borde derecho; arrastrarlo cambia el ancho EN VIVO
//    (variables CSS `--tl-w-N`, sin repintar) entre 60 y 520 px; al soltar se guarda; doble clic = ancho por defecto.
//    Los anchos y las columnas visibles se guardan por usuario y navegador (localStorage, claves `..._<uid>`, ver orders.js).
//  · Barras: se arrastra el cuerpo (mueve el pedido conservando su duración) o los tiradores `.orders-tl-bar-handle` de los
//    extremos (cambian inicio o fin). Mismo mecanismo que el Gantt de proyectos (mousedown/mousemove/mouseup con preventDefault y
//    stopPropagation, umbral de 3 px: un clic limpio sigue abriendo la tarea), con aviso flotante «09/11 → 13/11 · 5d» y «Deshacer».
//    Qué campos se escriben lo decide buildOrderTimelineDatePatch (etapas Compra/Recepción o fechas de la tarea).
//  · Filas «Sin fecha»: un clic en un día (o arrastrar varios) les asigna esa fecha o rango al instante.
//  · El scroll horizontal y vertical se conserva al repintar (llega un dato, se filtra, se cambia un ancho…): se recuerda el DÍA que
//    había en el borde izquierdo del calendario, así sigue en su sitio aunque la ventana cambie.
// ============================================================================
import { escapeHtml, formatDate, initials, renderTitleHtml, textColorFor, showToast, PRIORITY_LABELS } from "../utils.js";
import { stageBadgeHtml } from "../components/stage-badge.js";
import { showUndoToast } from "../components/undo-toast.js";
import { updateTask } from "../data/tasks.js";
import {
  loadOrdersTimelineColumns, saveOrdersTimelineColumns, toggleTimelineColumn, timelineCustomColumns, resolveTimelineColumns, customFieldValue,
  loadOrdersTimelineColumnWidths, saveOrdersTimelineColumnWidths, applyTimelineColumnWidths, setTimelineColumnWidth, resetTimelineColumnWidths,
  clampTimelineColumnWidth, TIMELINE_FIXED_COLUMN_WIDTHS, saveOrdersTimelinePrefs,
  TIMELINE_COLUMN_DEFS, TIMELINE_ZOOMS, TIMELINE_SORTS, TIMELINE_NAV_WEEKS, normalizeTimelineZoom, normalizeTimelineSort,
  emptyTimelineState, timelineWindow, buildTimelineDays, groupTimelineWeeks, groupTimelineMonths, placeInWindow, sortTimelineRows,
  orderDateRange, describeOrderBar, todayKeyOf, isoWeekLabel, dayDiff,
  computeOrderBarDrag, formatOrderDragRange, buildOrderTimelineDatePatch, buildOrderDatesUndoPatch, orderLastSegment,
} from "../orders.js";
import { formatDayMonth } from "../work-calendar.js";
import { SECTOR_FILTER_OPTIONS } from "../project-properties.js";

/** Ancho de un día en px (32–38 px: caben los Nº de pedido dentro de la barra) y alto de fila, también en css/08. */
export const TIMELINE_DAY_W = 34;
export const TIMELINE_ROW_H = 36;
/** Un movimiento de ratón menor que esto (px) es un clic, no un arrastre. */
const DRAG_THRESHOLD_PX = 3;
/** Tope de filas pintadas de golpe, como en la tabla. */
export const TIMELINE_RENDER_LIMIT = 200;

const STATUS_TEXT = { pending: "Compra/Pedido", placed: "Recepción/Fab.", done: "Recibido" };
const SECTOR_LABEL = Object.fromEntries(SECTOR_FILTER_OPTIONS.filter((o) => o.sector).map((o) => [o.key, o.sector]));

let colMenuOpen = false; // el menú «⚙️ Columnas» sigue abierto al marcar una casilla (el repintado lo reabre)
// Dónde estaba el scroll: el DÍA del borde izquierdo del calendario (y la fracción de día), no los px, para que siga en su sitio aunque
// cambie la ventana («Todo el rango» depende de las fechas) o el ancho de las columnas. Vive FUERA del repintado: la vista entera se
// repinta cuando llega un dato de Firestore y el contenedor nuevo no recuerda nada.
let scrollMemo = null; // { zoom, offset, anchor, frac, rawLeft, top }
let docCleanup = null;
let dragTipEl = null;

function showDragTip(anchorEl, text) {
  if (!dragTipEl) { dragTipEl = document.createElement("div"); dragTipEl.className = "orders-tl-drag-tip"; document.body.appendChild(dragTipEl); }
  const rect = anchorEl.getBoundingClientRect();
  dragTipEl.textContent = text;
  dragTipEl.style.left = `${rect.left + rect.width / 2}px`;
  dragTipEl.style.top = `${rect.top - 10}px`;
}
function removeDragTip() { if (dragTipEl) { dragTipEl.remove(); dragTipEl = null; } }

/** Quita los listeners globales (se llama al salir del modo Cronograma y antes de cada repintado). */
export function disposeOrdersTimeline() {
  if (docCleanup) docCleanup();
  docCleanup = null;
}

const tintStyle = (color) => (/^#[0-9a-f]{6}$/i.test(color || "")
  ? `border-left:4px solid ${color};background:linear-gradient(${color}33,${color}33),var(--color-void);`
  : "");

function scrollXTo(el, x, smooth) {
  if (smooth && typeof el.scrollTo === "function") { try { el.scrollTo({ left: x, behavior: "smooth" }); return; } catch (e) { /* sin scroll suave */ } }
  el.scrollLeft = x;
}

/**
 * @param {HTMLElement} box   contenedor (se repinta entero)
 * @param {{ rows: object[], allRows: object[], timeline?: object, onTimelineChange?: (t: object) => void,
 *           onOpenTask: (id: string) => void, onContextMenu?: (x: number, y: number, row: object) => void,
 *           teamMembers: object[], workCalendar?: object, offersProjectId?: string, today?: any, truncated?: string,
 *           userId?: string, onDatesChange?: (taskId: string, patch: object, row: object) => Promise<any> }} opts
 *   `rows`: los pedidos a pintar (ya filtrados y del bloque actual); `allRows`: todos (para ofrecer los campos personalizados).
 *   `userId`: el uid de quien mira (columnas, anchos, escala y orden se guardan por usuario). `onDatesChange`: cómo se guarda un
 *   cambio de fechas al arrastrar una barra (por defecto `updateTask`; las pruebas lo sustituyen).
 */
export function renderOrdersTimeline(box, opts) {
  disposeOrdersTimeline();
  const { rows, allRows, onOpenTask, onContextMenu, teamMembers, workCalendar, offersProjectId } = opts;
  const tl = { ...emptyTimelineState(), ...(opts.timeline || {}) };
  tl.zoom = normalizeTimelineZoom(tl.zoom);
  tl.sort = normalizeTimelineSort(tl.sort);
  tl.offset = Number(tl.offset) || 0;
  const todayKey = todayKeyOf(opts.today);
  const userId = opts.userId || null;

  const change = (patch) => {
    const next = { ...tl, ...patch };
    if ("zoom" in patch || "sort" in patch) saveOrdersTimelinePrefs({ zoom: next.zoom, sort: next.sort }, userId); // escala y orden: por usuario y navegador
    if (typeof opts.onTimelineChange === "function") opts.onTimelineChange({ sort: next.sort, zoom: next.zoom, offset: next.offset });
    renderOrdersTimeline(box, { ...opts, timeline: next });
  };
  const repaint = () => renderOrdersTimeline(box, { ...opts, timeline: tl });

  // ---- columnas (con los anchos que esta persona ajustó; los de por defecto si no tocó ninguno)
  const customCols = timelineCustomColumns(allRows || rows);
  const selected = loadOrdersTimelineColumns(userId);
  const widths = loadOrdersTimelineColumnWidths(userId);
  const optional = resolveTimelineColumns(selected, customCols);
  const leftCols = applyTimelineColumnWidths([
    { key: "project", label: "Proyecto", width: TIMELINE_FIXED_COLUMN_WIDTHS.project },
    { key: "title", label: "Descripción", width: TIMELINE_FIXED_COLUMN_WIDTHS.title },
    ...optional,
  ], widths);
  const leftW = leftCols.reduce((n, c) => n + c.width, 0);
  const wVars = leftCols.map((c, i) => `--tl-w-${i}:${c.width}px`).join(";");

  // ---- ventana, días y orden
  const shownAll = sortTimelineRows(rows, tl.sort, offersProjectId);
  const shown = shownAll.slice(0, TIMELINE_RENDER_LIMIT);
  const win = timelineWindow(shown, { zoom: tl.zoom, offset: tl.offset, today: todayKey, offersProjectId });
  const days = buildTimelineDays(win.start, win.end, workCalendar);
  const gridW = days.length * TIMELINE_DAY_W;
  const weeks = groupTimelineWeeks(days);
  const months = groupTimelineMonths(days);
  const todayIdx = days.findIndex((d) => d.key === todayKey);
  const memberName = new Map((teamMembers || []).map((m) => [m.uid, m.name || ""]));

  // ---- cabecera (3 filas: mes · semana ISO · día)
  const span = (n) => `style="width:${n * TIMELINE_DAY_W}px"`;
  const headMonths = months.map((m) => `<div class="orders-timeline__hcell orders-timeline__hcell--month" ${span(m.span)}>${m.span >= 3 ? escapeHtml(m.label) : ""}</div>`).join("");
  const headWeeks = weeks.map((w) => `<div class="orders-timeline__hcell orders-timeline__hcell--week${days.slice(w.start, w.start + w.span).some((d) => d.key === todayKey) ? " is-today" : ""}" ${span(w.span)} title="Semana ${w.week} de ${w.year}">${w.span >= 2 ? escapeHtml(w.label) : ""}</div>`).join("");
  const headDays = days.map((d) => `<div class="orders-timeline__hcell orders-timeline__hcell--day${d.nonWorking ? " is-nonworking" : ""}${d.key === todayKey ? " is-today" : ""}" style="width:${TIMELINE_DAY_W}px" title="${escapeHtml(d.holiday ? `${formatDayMonth(d.key)} · ${d.holiday}` : formatDayMonth(d.key))}"><span class="orders-timeline__dnum">${d.day}</span><span class="orders-timeline__dlet">${d.letter}</span></div>`).join("");
  const corner = leftCols.map((c, i) => `<div class="orders-timeline__hl" data-col-key="${escapeHtml(c.key)}" style="width:var(--tl-w-${i})" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}<span class="orders-tl-col-resizer" data-resize-col="${i}" role="separator" aria-orientation="vertical" aria-label="Cambiar el ancho de ${escapeHtml(c.label)}" title="Arrastra para cambiar el ancho · doble clic para restablecerlo"></span></div>`).join("");

  // ---- columnas superpuestas: fin de semana, festivo y hoy
  const overlay = days.map((d, i) => {
    const cls = [d.holiday ? "is-holiday" : d.weekend ? "is-weekend" : "", d.key === todayKey ? "is-today" : ""].filter(Boolean).join(" ");
    return cls ? `<div class="orders-timeline__col ${cls}" style="left:${i * TIMELINE_DAY_W}px;width:${TIMELINE_DAY_W}px"${d.holiday ? ` title="${escapeHtml(d.holiday)}"` : ""}></div>` : "";
  }).join("");

  // ---- celdas de la izquierda
  const cell = (col, r, range) => {
    const t = r.task;
    switch (col.key) {
      case "project":
        return `<span class="orders-timeline__proj" title="${escapeHtml(`${r.projectCode ? r.projectCode + " · " : ""}${r.projectName}`)}">${r.projectCode ? `<span class="orders-timeline__code">${escapeHtml(r.projectCode)}</span>` : ""}<span class="orders-timeline__pname">${escapeHtml(r.projectName)}</span></span>`;
      case "title":
        return `<span class="orders-timeline__title" data-open="${escapeHtml(r.id)}" title="${escapeHtml(r.title)}">${renderTitleHtml(t.title)}</span>`;
      case "supplier": return escapeHtml(r.supplier) || "—";
      case "orderNumber": return escapeHtml(r.orderNumber) || "—";
      case "supplierCode": return escapeHtml(r.supplierCode) || "—";
      case "stageStatus": return stageBadgeHtml(t) || `<span class="orders-timeline__status is-${r.status}">${STATUS_TEXT[r.status]}</span>`;
      case "priority": return t.priority && PRIORITY_LABELS[t.priority] ? `<span class="orders-timeline__prio is-${escapeHtml(t.priority)}">${escapeHtml(PRIORITY_LABELS[t.priority])}</span>` : "—";
      case "assignee": {
        const ids = Array.isArray(t.assigneeIds) && t.assigneeIds.length ? t.assigneeIds : r.buyerId ? [r.buyerId] : [];
        const names = ids.map((id) => memberName.get(id) || (id === r.buyerId ? r.buyerName : "")).filter(Boolean);
        return names.length ? `<span title="${escapeHtml(names.join(", "))}">${escapeHtml(names.map((n) => initials(n)).join(" · "))} <span class="orders-timeline__muted">${escapeHtml(names[0].split(" ")[0])}${names.length > 1 ? ` +${names.length - 1}` : ""}</span></span>` : "—";
      }
      case "commercial": return escapeHtml(r.commercial) || "—";
      case "sector": return escapeHtml(SECTOR_LABEL[r.sector] || "") || "—";
      case "dueDateText": { const d = (range && range.end) || r.deadline; return d ? escapeHtml(formatDate(d)) : "—"; }
      default: return col.custom ? escapeHtml(customFieldValue(r, col.key)) || "—" : "";
    }
  };

  // ---- una fila
  let prevProject = null;
  const rowHtml = (r) => {
    const range = orderDateRange(r, offersProjectId);
    const late = r.status !== "done" && range && range.end < todayKey;
    const groupStart = tl.sort === "project" && prevProject !== null && prevProject !== r.projectId;
    prevProject = r.projectId;
    const color = /^#[0-9a-f]{6}$/i.test(r.projectColor || "") ? r.projectColor : "";
    const tip = describeOrderBar(r, range);
    const label = r.orderNumber || r.supplier || r.title;
    let calendar = "";
    if (!range) {
      calendar = `<button type="button" class="orders-timeline__nodate" data-open="${escapeHtml(r.id)}" title="Haz clic en un día del calendario (o arrastra varios) para asignarle esa fecha; este botón abre el pedido">Sin fecha · asignar</button>`;
    } else {
      const firstKey = range.segments[0].key, lastKey = (orderLastSegment(range) || {}).key;
      const bars = [];
      let before = false, after = false;
      for (const seg of range.segments) {
        if (!seg.drawn) continue;
        const pl = placeInWindow(seg.drawStart, seg.drawEnd, win.start, win.end);
        if (pl.before) { before = true; continue; }
        if (pl.after) { after = true; continue; }
        const bg = color || seg.color;
        // Tiradores: el izquierdo solo en el primer tramo del pedido y el derecho solo en el último (y solo si ese extremo se ve entero).
        const hl = seg.key === firstKey && !pl.clipLeft ? `<span class="orders-tl-bar-handle handle-left" data-handle="left" aria-hidden="true"></span>` : "";
        const hr = seg.key === lastKey && !pl.clipRight ? `<span class="orders-tl-bar-handle handle-right" data-handle="right" aria-hidden="true"></span>` : "";
        bars.push(`<button type="button" class="orders-timeline__bar orders-tl-bar${r.status === "done" ? " is-done" : ""}${late ? " is-late" : ""}${pl.clipLeft ? " is-clip-left" : ""}${pl.clipRight ? " is-clip-right" : ""}" data-open="${escapeHtml(r.id)}" data-seg="${seg.key}" style="left:${pl.offset * TIMELINE_DAY_W + 2}px;width:${pl.span * TIMELINE_DAY_W - 4}px;background:${bg};color:${textColorFor(bg)};box-shadow:inset 0 -4px 0 ${seg.color}" title="${escapeHtml(`${tip}\n\nArrastra la barra para moverla; sus extremos, para cambiar el inicio o el fin.`)}">${hl}<span class="orders-timeline__barlabel">${escapeHtml(label)}</span>${hr}</button>`);
      }
      if (!bars.length) {
        const a = formatDayMonth(range.start), b = formatDayMonth(range.end);
        const text = `${a}${a !== b ? `–${b}` : ""}`;
        calendar = `<button type="button" class="orders-timeline__offrange${before && !after ? " is-before" : ""}" data-open="${escapeHtml(r.id)}" title="${escapeHtml(tip)}">${before ? `◀ Antes: ${text}` : `Después: ${text} ▶`}</button>`;
      } else calendar = bars.join("");
    }
    return `<div class="orders-timeline__row${r.status === "done" ? " is-complete" : ""}${groupStart ? " is-group-start" : ""}" data-task-id="${escapeHtml(r.id)}">
      <div class="orders-timeline__left">${leftCols.map((c, i) => `<div class="orders-timeline__cell orders-timeline__cell--${c.custom ? "custom" : c.key}" style="width:var(--tl-w-${i});${c.key === "project" ? tintStyle(color) : ""}">${cell(c, r, range)}</div>`).join("")}</div>
      <div class="orders-timeline__cal${range ? "" : " orders-tl-assign"}" style="width:${gridW}px">${calendar}</div>
    </div>`;
  };

  // ---- barra de controles
  const winLabel = days.length ? `${isoWeekLabel(win.start)}–${isoWeekLabel(win.end)} · ${formatDayMonth(win.start)} – ${formatDayMonth(win.end)}` : "";
  const colItem = (key, label, checked) => `<label class="orders-colmenu__item"><input type="checkbox" data-col="${escapeHtml(key)}"${checked ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`;
  const colMenu = `<div class="orders-colmenu" id="orders-col-menu" role="menu"${colMenuOpen ? "" : " hidden"}>
      <p class="orders-colmenu__hint">Siempre visibles: Proyecto y Descripción.</p>
      ${TIMELINE_COLUMN_DEFS.map((c) => colItem(c.key, c.label, selected.includes(c.key))).join("")}
      ${customCols.length ? `<p class="orders-colmenu__group">Campos personalizados</p>${customCols.map((c) => colItem(c.key, c.label, selected.includes(c.key))).join("")}` : ""}
      <p class="orders-colmenu__group">Anchos</p>
      <button type="button" class="orders-colmenu__reset" data-reset-widths title="Devuelve todas las columnas a su ancho por defecto">↔ Restablecer anchos</button>
      <p class="orders-colmenu__hint">Arrastra el borde derecho de una cabecera para cambiar su ancho; doble clic lo restablece.</p>
    </div>`;
  const toolbar = `<div class="orders-timeline__toolbar">
      <div class="orders-timeline__nav" role="group" aria-label="Navegar por el cronograma">
        <button type="button" class="btn btn--sm" data-tl-nav="prev" title="Retroceder ${TIMELINE_NAV_WEEKS} semanas">◀ Anterior</button>
        <button type="button" class="btn btn--sm" data-tl-nav="today" title="Ir a la semana actual">Hoy</button>
        <button type="button" class="btn btn--sm" data-tl-nav="next" title="Avanzar ${TIMELINE_NAV_WEEKS} semanas">Siguiente ▶</button>
      </div>
      <div class="orders-timeline__zoom" role="group" aria-label="Rango del cronograma">${TIMELINE_ZOOMS.map((z) => `<button type="button" class="orders-timeline__zoombtn${z.key === tl.zoom ? " is-active" : ""}" data-tl-zoom="${z.key}" aria-pressed="${z.key === tl.zoom}">${z.label}</button>`).join("")}</div>
      <label class="orders-timeline__sort"><span>Ordenar:</span><select class="field__select" id="orders-timeline-sort">${TIMELINE_SORTS.map((s) => `<option value="${s.key}"${s.key === tl.sort ? " selected" : ""}>${s.label}</option>`).join("")}</select></label>
      <div class="orders-colmenu-wrap"><button type="button" class="btn btn--sm" id="orders-col-btn" aria-haspopup="true" aria-expanded="${colMenuOpen}">⚙️ Columnas</button>${colMenu}</div>
      <span class="orders-timeline__range">${escapeHtml(winLabel)}</span>
    </div>`;

  // ---- ensamblado
  const rootStyle = `--tl-day-w:${TIMELINE_DAY_W}px;--tl-row-h:${TIMELINE_ROW_H}px;--tl-left-w:${leftW}px;--tl-sticky-w:${leftW}px;--tl-fixed-w:${leftCols[0].width}px;${wVars};`;
  box.innerHTML = `<div class="orders-timeline" style="${rootStyle}">
    ${toolbar}
    <div class="orders-timeline__scroll" id="orders-timeline-scroll" tabindex="0" aria-label="Cronograma de pedidos">
      <div class="orders-timeline__grid" style="width:calc(var(--tl-left-w) + ${gridW}px)">
        <div class="orders-timeline__head">
          <div class="orders-timeline__corner" style="width:var(--tl-left-w)">${corner}</div>
          <div class="orders-timeline__hdays" style="width:${gridW}px">
            <div class="orders-timeline__hrow">${headMonths}</div>
            <div class="orders-timeline__hrow">${headWeeks}</div>
            <div class="orders-timeline__hrow">${headDays}</div>
          </div>
        </div>
        <div class="orders-timeline__body">
          <div class="orders-timeline__cols" style="left:var(--tl-left-w);width:${gridW}px" aria-hidden="true">${overlay}</div>
          ${shown.map(rowHtml).join("")}
        </div>
      </div>
    </div>
    ${opts.truncated ? `<p class="orders-more">${escapeHtml(opts.truncated)}</p>` : ""}
    <p class="orders-timeline__legend"><span class="orders-timeline__lg orders-timeline__lg--purchase"></span>Compra/Pedido <span class="orders-timeline__lg orders-timeline__lg--production"></span>Recepción/Fab. · Sombreado: fines de semana y festivos · Línea dorada: hoy · Arrastra una barra para moverla (o sus extremos para cambiar inicio o fin); clic en un día de un pedido «Sin fecha» para asignarlo · Arrastra el fondo de la rejilla para moverte.<span class="orders-timeline__widehint"> · Hay muchas columnas: Proyecto y Descripción quedan fijas; desplázate a la derecha para ver las demás y el calendario.</span></p>
  </div>`;

  const $ = (sel) => box.querySelector(sel);
  const scroller = $("#orders-timeline-scroll");
  const rootEl = $(".orders-timeline");

  // ---- anchos de las columnas y modo ancho
  // Con muchas columnas elegidas el bloque izquierdo se comería la pantalla: si pasa del 55 % del ancho visible, solo Proyecto y
  // Descripción quedan fijas y las demás columnas se desplazan con la rejilla (clase `is-wide`; se decide al pintar).
  const curW = leftCols.map((c) => c.width); // anchos vigentes (cambian EN VIVO mientras se arrastra un tirador)
  const fixedW = curW[0] + curW[1];
  const wide = scroller.clientWidth > 0 && leftW > scroller.clientWidth * 0.55 && leftCols.length > 2;
  scroller.classList.toggle("is-wide", wide);
  const syncLeftWidths = () => {
    const total = curW.reduce((n, w) => n + w, 0);
    curW.forEach((w, i) => rootEl.style.setProperty(`--tl-w-${i}`, `${w}px`));
    rootEl.style.setProperty("--tl-left-w", `${total}px`);
    rootEl.style.setProperty("--tl-fixed-w", `${curW[0]}px`);
    rootEl.style.setProperty("--tl-sticky-w", `${wide ? curW[0] + curW[1] : total}px`);
  };
  syncLeftWidths();
  const stickyW = wide ? fixedW : leftW;
  const calOrigin = leftW - stickyW; // lo que se desplaza del bloque izquierdo antes de llegar al calendario (0 si todo es fijo)
  const wantToday = () => (todayIdx >= 0 ? Math.max(0, calOrigin + todayIdx * TIMELINE_DAY_W - Math.max(0, scroller.clientWidth - stickyW) / 3) : 0);

  // ---- posición del scroll: se conserva al repintar; una ventana nueva (otro zoom o desplazamiento) centra «hoy»
  const remember = () => {
    const calX = scroller.scrollLeft - calOrigin;
    const base = { zoom: win.zoom, offset: tl.offset, rawLeft: scroller.scrollLeft, top: scroller.scrollTop };
    if (calX <= 0 || !days.length) { scrollMemo = { ...base, anchor: null, frac: 0 }; return; }
    const idx = Math.min(days.length - 1, Math.floor(calX / TIMELINE_DAY_W));
    scrollMemo = { ...base, anchor: days[idx].key, frac: calX - idx * TIMELINE_DAY_W };
  };
  const memo = scrollMemo && scrollMemo.zoom === win.zoom && scrollMemo.offset === tl.offset ? scrollMemo : null;
  const anchorIdx = memo && memo.anchor ? days.findIndex((d) => d.key === memo.anchor) : -1;
  if (memo && (!memo.anchor || anchorIdx >= 0)) {
    scroller.scrollLeft = memo.anchor ? Math.max(0, calOrigin + anchorIdx * TIMELINE_DAY_W + memo.frac) : memo.rawLeft;
    scroller.scrollTop = memo.top;
  } else scroller.scrollLeft = wantToday();
  remember();
  scroller.addEventListener("scroll", remember);

  // ---- navegación
  box.querySelectorAll("[data-tl-nav]").forEach((b) => b.addEventListener("click", () => {
    const dir = b.dataset.tlNav;
    if (win.zoom === "all") {
      if (dir === "today") scrollXTo(scroller, wantToday(), true);
      else scrollXTo(scroller, Math.max(0, scroller.scrollLeft + (dir === "next" ? 1 : -1) * TIMELINE_NAV_WEEKS * 7 * TIMELINE_DAY_W), true);
    } else if (dir === "today") {
      if (tl.offset === 0) scrollXTo(scroller, wantToday(), true); // ya en la ventana actual: solo centra hoy
      else change({ offset: 0 });
    } else change({ offset: tl.offset + (dir === "next" ? TIMELINE_NAV_WEEKS : -TIMELINE_NAV_WEEKS) });
  }));
  box.querySelectorAll("[data-tl-zoom]").forEach((b) => b.addEventListener("click", () => change({ zoom: b.dataset.tlZoom, offset: 0 })));
  $("#orders-timeline-sort").addEventListener("change", (e) => change({ sort: e.target.value }));

  // ---- menú de columnas
  const menu = $("#orders-col-menu"), menuBtn = $("#orders-col-btn");
  const setMenu = (open) => { colMenuOpen = open; menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  menu.addEventListener("click", (e) => e.stopPropagation());
  menu.querySelectorAll("[data-col]").forEach((inp) => inp.addEventListener("change", () => {
    saveOrdersTimelineColumns(toggleTimelineColumn(loadOrdersTimelineColumns(userId), inp.dataset.col, inp.checked), userId);
    colMenuOpen = true;
    repaint();
  }));
  const resetBtn = menu.querySelector("[data-reset-widths]");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    saveOrdersTimelineColumnWidths({}, userId);
    colMenuOpen = true;
    repaint();
  });
  const onDocClick = () => { if (!document.body.contains(box)) { disposeOrdersTimeline(); return; } if (colMenuOpen) setMenu(false); };
  const onDocKey = (e) => { if (e.key === "Escape" && colMenuOpen) setMenu(false); };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);
  docCleanup = () => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onDocKey); };

  // ---- redimensionar columnas: arrastrar el tirador del borde derecho de su cabecera
  box.querySelectorAll(".orders-tl-col-resizer").forEach((handle) => {
    const idx = Number(handle.dataset.resizeCol);
    const col = leftCols[idx];
    if (!col) return;
    // un clic sobre el tirador nunca llega a la cabecera (ni a nada que ordene o abra)
    handle.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    handle.addEventListener("dblclick", (e) => {
      e.preventDefault(); e.stopPropagation();
      saveOrdersTimelineColumnWidths(resetTimelineColumnWidths(loadOrdersTimelineColumnWidths(userId), col.key), userId);
      repaint();
    });
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // sin selección de texto ni arrastre del navegador compitiendo con el gesto (lección de la v49)
      e.stopPropagation(); // y sin que arranque el arrastre de la rejilla
      const startX = e.clientX, startW = curW[idx];
      let moved = false;
      handle.classList.add("is-active");
      document.body.classList.add("is-col-resizing");
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 1) return;
        moved = true;
        curW[idx] = clampTimelineColumnWidth(startW + dx);
        syncLeftWidths(); // en vivo: cabecera y todas las celdas de la columna, vía variables CSS
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        handle.classList.remove("is-active");
        document.body.classList.remove("is-col-resizing");
        if (!moved) return;
        saveOrdersTimelineColumnWidths(setTimelineColumnWidth(loadOrdersTimelineColumnWidths(userId), col.key, curW[idx]), userId);
        repaint(); // recalcula el modo ancho y la zona fija; el scroll se conserva
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });

  // ---- abrir la tarea (fila, título, barra, «Sin fecha»); un arrastre (de la rejilla, de una barra o de un día) no cuenta como clic
  let dragged = false;
  const flagDragged = () => { dragged = true; setTimeout(() => { dragged = false; }, 0); };
  const rowById = new Map(shown.map((r) => [r.id, r]));
  const rangeById = new Map(shown.map((r) => [r.id, orderDateRange(r, offersProjectId)]));
  box.querySelectorAll(".orders-timeline__row").forEach((rowEl) => {
    rowEl.addEventListener("click", () => {
      if (dragged) { dragged = false; return; }
      onOpenTask(rowEl.dataset.taskId);
    });
    rowEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const r = rowById.get(rowEl.dataset.taskId);
      if (r && typeof onContextMenu === "function") onContextMenu(e.clientX, e.clientY, r);
    });
  });

  // ---- guardar un cambio de fechas (con «Deshacer»); si falla, se repinta para devolver las barras a su sitio
  const persistDates = (row, patch, message) => {
    const undoPatch = buildOrderDatesUndoPatch(row.task, patch);
    const save = typeof opts.onDatesChange === "function" ? opts.onDatesChange : (id, p) => updateTask(id, p, row.task);
    return Promise.resolve()
      .then(() => save(row.id, patch, row))
      .then(() => showUndoToast(message, async () => { await save(row.id, undoPatch, row); return "Fechas restauradas."; }))
      .catch((err) => {
        console.error(err);
        showToast("No se pudieron actualizar las fechas. Comprueba tu conexión o tus permisos e inténtalo de nuevo.", "error");
        repaint();
      });
  };

  // ---- mover y estirar barras: el cuerpo desplaza el pedido entero; los tiradores cambian inicio o fin
  box.querySelectorAll(".orders-tl-bar").forEach((bar) => {
    bar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const rowEl = bar.closest(".orders-timeline__row");
      const row = rowEl && rowById.get(rowEl.dataset.taskId);
      const range = row && rangeById.get(row.id);
      if (!row || !range) return;
      e.preventDefault(); // sin selección de texto compitiendo con el arrastre (lección de la v49)
      e.stopPropagation(); // y sin que arranque el arrastre-de-scroll de la rejilla
      const handle = e.target.closest ? e.target.closest(".orders-tl-bar-handle") : null;
      const mode = handle ? (handle.classList.contains("handle-left") ? "resize-left" : "resize-right") : "move";
      const bars = mode === "move" ? [...rowEl.querySelectorAll(".orders-tl-bar")] : [bar];
      const orig = bars.map((b) => ({ b, left: parseFloat(b.style.left) || 0, width: parseFloat(b.style.width) || 0 }));
      const startX = e.clientX;
      let dayDelta = 0, dragging = false, result = null;
      const restore = () => orig.forEach((o) => { o.b.style.left = `${o.left}px`; o.b.style.width = `${o.width}px`; });

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (!dragging && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;
        if (!dragging) {
          dragging = true;
          document.body.classList.add("tl-dragging-bar"); // sin selección de texto en TODA la página mientras dura
          document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
          bars.forEach((b) => b.classList.add("is-dragging"));
        }
        dayDelta = Math.round(dx / TIMELINE_DAY_W);
        result = computeOrderBarDrag(range, mode, dayDelta);
        const startShift = result ? dayDiff(range.start, result.start) * TIMELINE_DAY_W : 0;
        const endShift = result ? dayDiff(range.end, result.end) * TIMELINE_DAY_W : 0;
        orig.forEach((o) => {
          if (mode === "move") { o.b.style.left = `${o.left + startShift}px`; o.b.style.width = `${o.width}px`; }
          else if (mode === "resize-left") { o.b.style.left = `${o.left + startShift}px`; o.b.style.width = `${Math.max(8, o.width - startShift)}px`; }
          else { o.b.style.left = `${o.left}px`; o.b.style.width = `${Math.max(8, o.width + endShift)}px`; }
        });
        showDragTip(bar, result ? formatOrderDragRange(result.start, result.end) : formatOrderDragRange(range.start, range.end));
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        removeDragTip();
        document.body.classList.remove("tl-dragging-bar");
        document.body.style.cursor = "";
        bars.forEach((b) => b.classList.remove("is-dragging"));
        if (!dragging) return; // clic limpio: el click que sigue abre la tarea como siempre
        flagDragged(); // hubo desplazamiento real: el click de después NO abre la tarea
        const patch = result ? buildOrderTimelineDatePatch(row.task, result.start, result.end, offersProjectId) : null;
        if (!patch) { restore(); return; }
        persistDates(row, patch, `Fechas del pedido: ${formatOrderDragRange(result.start, result.end)}.`);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });

  // ---- «Sin fecha»: clic en un día (o arrastrar varios) para asignarle esa fecha o rango al instante
  box.querySelectorAll(".orders-tl-assign").forEach((calEl) => {
    calEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".orders-timeline__nodate")) return; // el botón sigue abriendo el pedido
      const rowEl = calEl.closest(".orders-timeline__row");
      const row = rowEl && rowById.get(rowEl.dataset.taskId);
      if (!row || !days.length) return;
      e.preventDefault();
      e.stopPropagation();
      const left = calEl.getBoundingClientRect().left;
      const idxAt = (x) => Math.max(0, Math.min(days.length - 1, Math.floor((x - left) / TIMELINE_DAY_W)));
      const from = idxAt(e.clientX);
      let to = from;
      const band = document.createElement("div");
      band.className = "orders-tl-assign-band";
      calEl.appendChild(band);
      const paint = () => {
        const a = Math.min(from, to), b = Math.max(from, to);
        band.style.left = `${a * TIMELINE_DAY_W + 2}px`;
        band.style.width = `${(b - a + 1) * TIMELINE_DAY_W - 4}px`;
        showDragTip(band, formatOrderDragRange(days[a].key, days[b].key));
      };
      paint();
      document.body.classList.add("tl-dragging-bar");
      const onMove = (ev) => { to = idxAt(ev.clientX); paint(); };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("tl-dragging-bar");
        removeDragTip();
        band.remove();
        flagDragged(); // el click que sigue no debe abrir la tarea
        const a = Math.min(from, to), b = Math.max(from, to);
        const patch = buildOrderTimelineDatePatch(row.task, days[a].key, days[b].key, offersProjectId);
        if (patch) persistDates(row, patch, a === b ? `Fecha asignada: ${formatOrderDragRange(days[a].key, days[b].key)}.` : `Fechas asignadas: ${formatOrderDragRange(days[a].key, days[b].key)}.`);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });

  // ---- arrastrar la rejilla para moverse (drag-to-scroll). Con preventDefault en el mousedown para que el navegador no
  // compita con su propia selección de texto (lección de la v49). Las barras y las filas «Sin fecha» paran este gesto antes.
  scroller.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !e.target.closest(".orders-timeline__cal, .orders-timeline__hdays")) return;
    e.preventDefault();
    const startX = e.clientX, startLeft = scroller.scrollLeft;
    let moved = false;
    scroller.classList.add("is-dragging");
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > 4) moved = true;
      if (moved) scroller.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      scroller.classList.remove("is-dragging");
      dragged = moved;
      if (moved) setTimeout(() => { dragged = false; }, 0);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}
