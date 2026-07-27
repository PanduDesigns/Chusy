// ============================================================================
// Línea de tiempo / Gantt. Se le pasa `groups`: un array de secciones (vista
// por proyecto) o de proyectos (vista global) con sus tareas ya dentro, así
// la misma vista sirve para los dos casos sin duplicar lógica.
//
// Zoom con un clic entre días / semanas / meses (`zoom`, controlado desde
// fuera vía `onZoomChange` para que se recuerde al cambiar de vista). En
// semanas se indica el número de semana ISO del año.
//
// Cómo se calcula cada barra: si la tarea tiene fecha de inicio Y fecha
// límite, la barra cubre todo ese rango (recortado a las columnas visibles
// según el zoom). Si solo tiene una de las dos, se dibuja un marcador de
// una columna en esa fecha. Los hitos siempre se dibujan como un rombo,
// nunca como barra.
// ============================================================================
import { escapeHtml, toDate, addDays, daysBetween, isoWeekNumber, mondayOf } from "../utils.js";
import { openTaskContextMenu } from "./list-view.js";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const PRIORITY_COLORS = {
  urgente: "var(--color-danger)",
  alta: "var(--color-signal)",
  media: "#78848C",
  baja: "var(--color-text-faint)",
};

const ZOOM_CONFIG = {
  day: { width: 32, label: "Días" },
  week: { width: 64, label: "Semanas" },
  month: { width: 96, label: "Meses" },
};

/** Agosto completo, o del 22 de diciembre al 6 de enero (cierre de Navidad). */
function isHolidayColumn(col) {
  for (let d = new Date(col.start); d <= col.end; d = addDays(d, 1)) {
    const m = d.getMonth();
    const day = d.getDate();
    if (m === 7) return true; // agosto
    if (m === 11 && day >= 22) return true; // 22-31 dic
    if (m === 0 && day <= 6) return true; // 1-6 ene
  }
  return false;
}

export function renderTimelineView(container, { groups, zoom, onZoomChange, showHolidays, onToggleHolidays, onOpenTask }) {
  const unit = zoom || "day";
  const allTasks = groups.flatMap((g) => g.tasks);
  const withDates = allTasks.filter((t) => t.startDate || t.dueDate);
  const withoutDates = allTasks.length - withDates.length;

  const dateList = withDates.flatMap((t) => [t.startDate && toDate(t.startDate), t.dueDate && toDate(t.dueDate)].filter(Boolean));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let rawMin = dateList.length ? new Date(Math.min(...dateList)) : addDays(today, -3);
  let rawMax = dateList.length ? new Date(Math.max(...dateList)) : addDays(today, 25);

  const columns = buildColumns(unit, rawMin, rawMax);
  const colWidth = ZOOM_CONFIG[unit].width;
  const todayIdx = columns.findIndex((c) => today >= c.start && today <= c.end);

  const rows = [];
  groups.forEach((g) => {
    if (!g.tasks.length) return;
    rows.push({ type: "group", label: g.label, color: g.color });
    g.tasks.forEach((t) => rows.push({ type: "task", task: t }));
  });

  const zoomButtons = Object.keys(ZOOM_CONFIG)
    .map((key) => `<button type="button" class="topbar__view-btn${key === unit ? " is-active" : ""}" data-zoom="${key}">${ZOOM_CONFIG[key].label}</button>`)
    .join("");
  const holidayBtnHtml = `<button type="button" class="btn btn--ghost btn--sm${showHolidays ? " is-toggled" : ""}" id="tl-holidays-btn">🏖️ Vacaciones inhábiles</button>`;

  if (!rows.length) {
    container.innerHTML = `
      <div class="timeline">
        <div class="timeline__toolbar">
          <div class="topbar__views" style="margin-left:0;">${zoomButtons}</div>
          ${holidayBtnHtml}
        </div>
        <div class="empty-state">
          <span class="empty-state__eyebrow">— LÍNEA DE TIEMPO —</span>
          <h2>Nada que mostrar todavía</h2>
          <p>Ponle fecha de inicio y/o fecha límite a alguna tarea para que aparezca aquí.</p>
        </div>
      </div>`;
    container.querySelectorAll("[data-zoom]").forEach((btn) => btn.addEventListener("click", () => onZoomChange(btn.dataset.zoom)));
    container.querySelector("#tl-holidays-btn").addEventListener("click", onToggleHolidays);
    return;
  }

  const totalRows = rows.length + 1;
  const LABEL_W = 224;
  const gridTemplateColumns = `${LABEL_W}px repeat(${columns.length}, ${colWidth}px)`;

  let cells = `<div class="tl-cell tl-corner" style="grid-column:1;grid-row:1;"></div>`;

  columns.forEach((c, i) => {
    const isWeekend = unit === "day" && (c.start.getDay() === 0 || c.start.getDay() === 6);
    cells += `<div class="tl-daycol${isWeekend ? " is-weekend" : ""}" style="grid-column:${i + 2};grid-row:1;">
      ${c.topLabel ? `<span class="tl-month">${c.topLabel}</span>` : ""}
      <span class="tl-daynum">${c.label}</span>
    </div>`;
  });

  rows.forEach((row, ri) => {
    const gridRow = ri + 2;
    if (row.type === "group") {
      cells += `<div class="tl-group-label" style="grid-column:1;grid-row:${gridRow};"><span class="tl-group-dot" style="background:${row.color}"></span>${escapeHtml(row.label)}</div>`;
      cells += `<div class="tl-group-band" style="grid-column:2 / ${columns.length + 2};grid-row:${gridRow};"></div>`;
      return;
    }
    const t = row.task;
    cells += `<div class="tl-task-label" data-open="${t.id}" data-task-id="${t.id}" title="${escapeHtml(t.title)}" style="grid-column:1;grid-row:${gridRow};${t.isComplete ? "color:var(--color-text-faint);text-decoration:line-through;" : ""}">${t.isMilestone ? "🚩 " : ""}${escapeHtml(t.title)}</div>`;
    cells += `<div class="tl-row-band" style="grid-column:2 / ${columns.length + 2};grid-row:${gridRow};"></div>`;

    const span = taskSpan(t, columns);
    if (!span) return;
    if (t.isMilestone) {
      cells += `<div class="tl-milestone" data-open="${t.id}" data-task-id="${t.id}" title="${escapeHtml(t.title)}" style="grid-column:${span.e + 2};grid-row:${gridRow};"><span class="tl-milestone__diamond"></span></div>`;
    } else {
      const color = PRIORITY_COLORS[t.priority] || "var(--color-line-bright)";
      cells += `<div class="tl-bar${t.isComplete ? " is-complete" : ""}" data-open="${t.id}" data-task-id="${t.id}" title="${escapeHtml(t.title)}" style="grid-column:${span.s + 2} / ${span.e + 3};grid-row:${gridRow};border-color:${color};background:${color};"></div>`;
    }
  });

  if (showHolidays) {
    columns.forEach((c, i) => {
      if (isHolidayColumn(c)) {
        cells += `<div class="tl-holiday-col" style="grid-column:${i + 2};grid-row:1 / ${totalRows + 1};"></div>`;
      }
    });
  }

  if (todayIdx >= 0) {
    cells += `<div class="tl-today-line" style="grid-column:${todayIdx + 2};grid-row:1 / ${totalRows + 1};"></div>`;
  }

  container.innerHTML = `
    <div class="timeline">
      <div class="timeline__toolbar">
        <div class="topbar__views" style="margin-left:0;">${zoomButtons}</div>
        <button class="btn btn--ghost btn--sm" id="tl-today-btn">Hoy</button>
        ${holidayBtnHtml}
        ${withoutDates > 0 ? `<span class="timeline__hint">${withoutDates} ${withoutDates === 1 ? "tarea sin fecha no se muestra" : "tareas sin fecha no se muestran"} aquí</span>` : ""}
      </div>
      <div class="timeline__scroll" id="tl-scroll">
        <div class="timeline__grid" style="grid-template-columns:${gridTemplateColumns};grid-template-rows:40px repeat(${rows.length}, 34px);">
          ${cells}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-zoom]").forEach((btn) => btn.addEventListener("click", () => onZoomChange(btn.dataset.zoom)));

  const scrollBox = container.querySelector("#tl-scroll");
  const scrollToToday = () => {
    const x = Math.max(0, LABEL_W + todayIdx * colWidth - scrollBox.clientWidth / 2);
    scrollBox.scrollTo({ left: x, behavior: "smooth" });
  };
  container.querySelector("#tl-today-btn").addEventListener("click", scrollToToday);
  container.querySelector("#tl-holidays-btn").addEventListener("click", onToggleHolidays);
  if (todayIdx >= 0) requestAnimationFrame(scrollToToday);

  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => onOpenTask(elx.dataset.open));
    elx.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = allTasks.find((t) => t.id === elx.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
    });
  });
}

// --------------------------------------------------------------------
// Columnas según el zoom: cada una es { start, end, label, topLabel }
// --------------------------------------------------------------------
function buildColumns(unit, rawMin, rawMax) {
  if (unit === "week") {
    let cursor = mondayOf(addDays(rawMin, -7));
    const end = addDays(rawMax, 7);
    const cols = [];
    while (cursor <= end) {
      const weekEnd = addDays(cursor, 6);
      cols.push({
        start: cursor,
        end: weekEnd,
        label: `S${isoWeekNumber(cursor)}`,
        topLabel: cursor.getDate() <= 7 ? `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}` : "",
      });
      cursor = addDays(cursor, 7);
    }
    return cols;
  }
  if (unit === "month") {
    let cursor = new Date(rawMin.getFullYear(), rawMin.getMonth() - 1, 1);
    const end = new Date(rawMax.getFullYear(), rawMax.getMonth() + 2, 0);
    const cols = [];
    while (cursor <= end) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      cols.push({
        start: new Date(cursor),
        end: monthEnd,
        label: MESES[cursor.getMonth()],
        topLabel: cursor.getMonth() === 0 ? String(cursor.getFullYear()) : "",
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return cols;
  }
  // día (por defecto)
  const start = addDays(rawMin, -3);
  const end = addDays(rawMax, 4);
  const count = Math.max(1, daysBetween(start, end) + 1);
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(start, i);
    return {
      start: d,
      end: d,
      label: String(d.getDate()),
      topLabel: d.getDate() === 1 || i === 0 ? MESES[d.getMonth()] : "",
    };
  });
}

function taskSpan(task, columns) {
  const start = task.startDate ? toDate(task.startDate) : task.dueDate ? toDate(task.dueDate) : null;
  const end = task.dueDate ? toDate(task.dueDate) : task.startDate ? toDate(task.startDate) : null;
  if (!start || !end) return null;
  const [s, e] = end < start ? [end, start] : [start, end];

  let sIdx = columns.findIndex((c) => s <= c.end);
  if (sIdx === -1) sIdx = columns.length - 1;
  let eIdx = -1;
  for (let i = columns.length - 1; i >= 0; i--) {
    if (columns[i].start <= e) { eIdx = i; break; }
  }
  if (eIdx === -1) eIdx = 0;
  if (eIdx < sIdx) eIdx = sIdx;
  return { s: sIdx, e: eIdx };
}
