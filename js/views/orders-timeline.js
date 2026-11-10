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
// ============================================================================
import { escapeHtml, formatDate, initials, renderTitleHtml, textColorFor, PRIORITY_LABELS } from "../utils.js";
import { stageBadgeHtml } from "../components/stage-badge.js";
import {
  loadTimelineColumns, saveTimelineColumns, toggleTimelineColumn, timelineCustomColumns, resolveTimelineColumns, customFieldValue,
  TIMELINE_COLUMN_DEFS, TIMELINE_ZOOMS, TIMELINE_SORTS, TIMELINE_NAV_WEEKS, normalizeTimelineZoom, normalizeTimelineSort,
  emptyTimelineState, timelineWindow, buildTimelineDays, groupTimelineWeeks, groupTimelineMonths, placeInWindow, sortTimelineRows,
  orderDateRange, describeOrderBar, todayKeyOf, isoWeekLabel,
} from "../orders.js";
import { formatDayMonth } from "../work-calendar.js";
import { SECTOR_FILTER_OPTIONS } from "../project-properties.js";

/** Ancho de un día en px (32–38 px: caben los Nº de pedido dentro de la barra) y alto de fila, también en css/08. */
export const TIMELINE_DAY_W = 34;
export const TIMELINE_ROW_H = 36;
const PROJECT_COL_W = 190;
const TITLE_COL_W = 240;
/** Tope de filas pintadas de golpe, como en la tabla. */
export const TIMELINE_RENDER_LIMIT = 200;

const STATUS_TEXT = { pending: "Compra/Pedido", placed: "Recepción/Fab.", done: "Recibido" };
const SECTOR_LABEL = Object.fromEntries(SECTOR_FILTER_OPTIONS.filter((o) => o.sector).map((o) => [o.key, o.sector]));

let colMenuOpen = false; // el menú «⚙️ Columnas» sigue abierto al marcar una casilla (el repintado lo reabre)
let lastScroll = { key: null, left: 0, top: 0 };
let docCleanup = null;

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
 *           teamMembers: object[], workCalendar?: object, offersProjectId?: string, today?: any, truncated?: string }} opts
 *   `rows`: los pedidos a pintar (ya filtrados y del bloque actual); `allRows`: todos (para ofrecer los campos personalizados).
 */
export function renderOrdersTimeline(box, opts) {
  disposeOrdersTimeline();
  const { rows, allRows, onOpenTask, onContextMenu, teamMembers, workCalendar, offersProjectId } = opts;
  const tl = { ...emptyTimelineState(), ...(opts.timeline || {}) };
  tl.zoom = normalizeTimelineZoom(tl.zoom);
  tl.sort = normalizeTimelineSort(tl.sort);
  tl.offset = Number(tl.offset) || 0;
  const todayKey = todayKeyOf(opts.today);

  const change = (patch) => {
    const next = { ...tl, ...patch };
    if (typeof opts.onTimelineChange === "function") opts.onTimelineChange({ sort: next.sort, zoom: next.zoom, offset: next.offset });
    renderOrdersTimeline(box, { ...opts, timeline: next });
  };

  // ---- columnas
  const customCols = timelineCustomColumns(allRows || rows);
  const selected = loadTimelineColumns();
  const optional = resolveTimelineColumns(selected, customCols);
  const leftCols = [{ key: "project", label: "Proyecto", width: PROJECT_COL_W }, { key: "title", label: "Descripción", width: TITLE_COL_W }, ...optional];
  const leftW = leftCols.reduce((n, c) => n + c.width, 0);

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
  const corner = leftCols.map((c) => `<div class="orders-timeline__hl" style="width:${c.width}px" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</div>`).join("");

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
      calendar = `<button type="button" class="orders-timeline__nodate" data-open="${escapeHtml(r.id)}" title="Este pedido aún no tiene fechas: ábrelo para asignarlas">Sin fecha · asignar</button>`;
    } else {
      const bars = [];
      let before = false, after = false;
      for (const seg of range.segments) {
        if (!seg.drawn) continue;
        const pl = placeInWindow(seg.drawStart, seg.drawEnd, win.start, win.end);
        if (pl.before) { before = true; continue; }
        if (pl.after) { after = true; continue; }
        const bg = color || seg.color;
        bars.push(`<button type="button" class="orders-timeline__bar${r.status === "done" ? " is-done" : ""}${late ? " is-late" : ""}${pl.clipLeft ? " is-clip-left" : ""}${pl.clipRight ? " is-clip-right" : ""}" data-open="${escapeHtml(r.id)}" data-seg="${seg.key}" style="left:${pl.offset * TIMELINE_DAY_W + 2}px;width:${pl.span * TIMELINE_DAY_W - 4}px;background:${bg};color:${textColorFor(bg)};box-shadow:inset 0 -4px 0 ${seg.color}" title="${escapeHtml(tip)}"><span class="orders-timeline__barlabel">${escapeHtml(label)}</span></button>`);
      }
      if (!bars.length) {
        const a = formatDayMonth(range.start), b = formatDayMonth(range.end);
        const text = `${a}${a !== b ? `–${b}` : ""}`;
        calendar = `<button type="button" class="orders-timeline__offrange${before && !after ? " is-before" : ""}" data-open="${escapeHtml(r.id)}" title="${escapeHtml(tip)}">${before ? `◀ Antes: ${text}` : `Después: ${text} ▶`}</button>`;
      } else calendar = bars.join("");
    }
    return `<div class="orders-timeline__row${r.status === "done" ? " is-complete" : ""}${groupStart ? " is-group-start" : ""}" data-task-id="${escapeHtml(r.id)}">
      <div class="orders-timeline__left">${leftCols.map((c) => `<div class="orders-timeline__cell orders-timeline__cell--${c.custom ? "custom" : c.key}" style="width:${c.width}px;${c.key === "project" ? tintStyle(color) : ""}">${cell(c, r, range)}</div>`).join("")}</div>
      <div class="orders-timeline__cal" style="width:${gridW}px">${calendar}</div>
    </div>`;
  };

  // ---- barra de controles
  const winLabel = days.length ? `${isoWeekLabel(win.start)}–${isoWeekLabel(win.end)} · ${formatDayMonth(win.start)} – ${formatDayMonth(win.end)}` : "";
  const colItem = (key, label, checked) => `<label class="orders-colmenu__item"><input type="checkbox" data-col="${escapeHtml(key)}"${checked ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`;
  const colMenu = `<div class="orders-colmenu" id="orders-col-menu" role="menu"${colMenuOpen ? "" : " hidden"}>
      <p class="orders-colmenu__hint">Siempre visibles: Proyecto y Descripción.</p>
      ${TIMELINE_COLUMN_DEFS.map((c) => colItem(c.key, c.label, selected.includes(c.key))).join("")}
      ${customCols.length ? `<p class="orders-colmenu__group">Campos personalizados</p>${customCols.map((c) => colItem(c.key, c.label, selected.includes(c.key))).join("")}` : ""}
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
  const prevScroll = box.querySelector(".orders-timeline__scroll");
  const scrollKey = `${win.zoom}|${win.start}|${win.end}`;
  const carried = prevScroll && lastScroll.key === scrollKey ? { left: prevScroll.scrollLeft, top: prevScroll.scrollTop } : null;

  box.innerHTML = `<div class="orders-timeline" style="--tl-day-w:${TIMELINE_DAY_W}px;--tl-row-h:${TIMELINE_ROW_H}px;--tl-left-w:${leftW}px;--tl-sticky-w:${leftW}px;--tl-fixed-w:${PROJECT_COL_W}px;">
    ${toolbar}
    <div class="orders-timeline__scroll" id="orders-timeline-scroll" tabindex="0" aria-label="Cronograma de pedidos">
      <div class="orders-timeline__grid" style="width:${leftW + gridW}px">
        <div class="orders-timeline__head">
          <div class="orders-timeline__corner" style="width:${leftW}px">${corner}</div>
          <div class="orders-timeline__hdays" style="width:${gridW}px">
            <div class="orders-timeline__hrow">${headMonths}</div>
            <div class="orders-timeline__hrow">${headWeeks}</div>
            <div class="orders-timeline__hrow">${headDays}</div>
          </div>
        </div>
        <div class="orders-timeline__body">
          <div class="orders-timeline__cols" style="left:${leftW}px;width:${gridW}px" aria-hidden="true">${overlay}</div>
          ${shown.map(rowHtml).join("")}
        </div>
      </div>
    </div>
    ${opts.truncated ? `<p class="orders-more">${escapeHtml(opts.truncated)}</p>` : ""}
    <p class="orders-timeline__legend"><span class="orders-timeline__lg orders-timeline__lg--purchase"></span>Compra/Pedido <span class="orders-timeline__lg orders-timeline__lg--production"></span>Recepción/Fab. · Sombreado: fines de semana y festivos · Línea dorada: hoy · Arrastra la rejilla para moverte.<span class="orders-timeline__widehint"> · Hay muchas columnas: Proyecto y Descripción quedan fijas; desplázate a la derecha para ver las demás y el calendario.</span></p>
  </div>`;

  const $ = (sel) => box.querySelector(sel);
  const scroller = $("#orders-timeline-scroll");

  // ---- posición del scroll: la misma ventana conserva el scroll; una nueva centra «hoy» si hace falta
  lastScroll = { key: scrollKey, left: 0, top: 0 };
  // Con muchas columnas elegidas el bloque izquierdo se comería la pantalla: si pasa del 55 % del ancho visible, solo Proyecto y
  // Descripción quedan fijas y las demás columnas se desplazan con la rejilla (clase `is-wide`; se decide al pintar).
  const fixedW = PROJECT_COL_W + TITLE_COL_W;
  const wide = scroller.clientWidth > 0 && leftW > scroller.clientWidth * 0.55 && leftCols.length > 2;
  scroller.classList.toggle("is-wide", wide);
  const stickyW = wide ? fixedW : leftW;
  $(".orders-timeline").style.setProperty("--tl-sticky-w", `${stickyW}px`);
  const wantToday = () => (todayIdx >= 0 ? Math.max(0, leftW - stickyW + todayIdx * TIMELINE_DAY_W - Math.max(0, scroller.clientWidth - stickyW) / 3) : 0);
  if (carried) { scroller.scrollLeft = carried.left; scroller.scrollTop = carried.top; lastScroll = { key: scrollKey, ...carried }; }
  else scroller.scrollLeft = wantToday();
  scroller.addEventListener("scroll", () => { lastScroll = { key: scrollKey, left: scroller.scrollLeft, top: scroller.scrollTop }; });

  // ---- navegación
  box.querySelectorAll("[data-tl-nav]").forEach((b) => b.addEventListener("click", () => {
    const dir = b.dataset.tlNav;
    if (win.zoom === "all") {
      if (dir === "today") scrollXTo(scroller, wantToday(), true);
      else scrollXTo(scroller, Math.max(0, scroller.scrollLeft + (dir === "next" ? 1 : -1) * TIMELINE_NAV_WEEKS * 7 * TIMELINE_DAY_W), true);
    } else if (dir === "today") change({ offset: 0 });
    else change({ offset: tl.offset + (dir === "next" ? TIMELINE_NAV_WEEKS : -TIMELINE_NAV_WEEKS) });
  }));
  box.querySelectorAll("[data-tl-zoom]").forEach((b) => b.addEventListener("click", () => change({ zoom: b.dataset.tlZoom, offset: 0 })));
  $("#orders-timeline-sort").addEventListener("change", (e) => change({ sort: e.target.value }));

  // ---- menú de columnas
  const menu = $("#orders-col-menu"), menuBtn = $("#orders-col-btn");
  const setMenu = (open) => { colMenuOpen = open; menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  menu.addEventListener("click", (e) => e.stopPropagation());
  menu.querySelectorAll("[data-col]").forEach((inp) => inp.addEventListener("change", () => {
    saveTimelineColumns(toggleTimelineColumn(loadTimelineColumns(), inp.dataset.col, inp.checked));
    colMenuOpen = true;
    renderOrdersTimeline(box, { ...opts, timeline: tl });
  }));
  const onDocClick = () => { if (!document.body.contains(box)) { disposeOrdersTimeline(); return; } if (colMenuOpen) setMenu(false); };
  const onDocKey = (e) => { if (e.key === "Escape" && colMenuOpen) setMenu(false); };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);
  docCleanup = () => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onDocKey); };

  // ---- abrir la tarea (fila, título, barra, «Sin fecha»); un arrastre de la rejilla no cuenta como clic
  let dragged = false;
  const rowById = new Map(shown.map((r) => [r.id, r]));
  box.querySelectorAll(".orders-timeline__row").forEach((rowEl) => {
    rowEl.addEventListener("click", (e) => {
      if (dragged) { dragged = false; return; }
      onOpenTask(rowEl.dataset.taskId);
    });
    rowEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const r = rowById.get(rowEl.dataset.taskId);
      if (r && typeof onContextMenu === "function") onContextMenu(e.clientX, e.clientY, r);
    });
  });

  // ---- arrastrar la rejilla para moverse (drag-to-scroll). Con preventDefault en el mousedown para que el navegador no
  // compita con su propia selección de texto (lección de la v49).
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
