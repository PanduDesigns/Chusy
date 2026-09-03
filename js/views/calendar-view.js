// ============================================================================
// Vista de Calendario: cuadrícula mensual. Una tarea con fecha de inicio Y
// fecha límite se dibuja como una barra que cubre toda su duración (puede
// cruzar de una semana a la siguiente, se corta y continúa en la fila de
// abajo). Si solo tiene una de las dos fechas, se dibuja como un bloque de
// un día. Los hitos siempre se marcan como un rombo en su fecha.
// ============================================================================
import { escapeHtml, toDate, toDateInputValue, daysBetween, renderTitleHtml, plainTitleText } from "../utils.js";

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MAX_LANES = 4;

const PRIORITY_COLORS = {
  urgente: "var(--color-danger)",
  alta: "var(--color-signal)",
  media: "#78848C",
  baja: "var(--color-text-faint)",
};

function effectiveRange(task) {
  const s = task.startDate ? toDate(task.startDate) : task.dueDate ? toDate(task.dueDate) : null;
  const e = task.dueDate ? toDate(task.dueDate) : task.startDate ? toDate(task.startDate) : null;
  if (!s || !e) return null;
  return e < s ? [e, s] : [s, e];
}

export function renderCalendarView(container, { tasks, viewDate, onOpenTask, onAddTaskOnDate, onMonthChange }) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayKey = toDateInputValue(new Date());

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=Lunes

  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const dayInfos = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1;
    if (dayNum < 1) {
      dayInfos.push({ date: new Date(year, month, dayNum), label: daysInPrevMonth + dayNum, otherMonth: true });
    } else if (dayNum > daysInMonth) {
      dayInfos.push({ date: new Date(year, month, dayNum), label: dayNum - daysInMonth, otherMonth: true });
    } else {
      dayInfos.push({ date: new Date(year, month, dayNum), label: dayNum, otherMonth: false });
    }
  }

  const withDates = tasks.filter((t) => effectiveRange(t));
  let weeksHtml = "";
  for (let w = 0; w < dayInfos.length; w += 7) {
    weeksHtml += buildWeek(dayInfos.slice(w, w + 7), withDates, todayKey);
  }

  container.innerHTML = `
    <div class="calendar">
      <div class="calendar-header">
        <button class="btn btn--ghost btn--sm" id="cal-prev">‹</button>
        <span class="calendar-header__label">${MESES_LARGOS[month]} ${year}</span>
        <button class="btn btn--ghost btn--sm" id="cal-next">›</button>
        <button class="btn btn--ghost btn--sm" id="cal-today" style="margin-left:auto;">Hoy</button>
      </div>
      <div class="calendar-weekdays">
        ${DIAS_SEMANA.map((d) => `<div class="calendar-weekday">${d}</div>`).join("")}
      </div>
      <div class="calendar-weeks">${weeksHtml}</div>
    </div>
  `;

  container.querySelector("#cal-prev").addEventListener("click", () => onMonthChange(new Date(year, month - 1, 1)));
  container.querySelector("#cal-next").addEventListener("click", () => onMonthChange(new Date(year, month + 1, 1)));
  container.querySelector("#cal-today").addEventListener("click", () => onMonthChange(new Date()));

  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => onOpenTask(elx.dataset.open));
  });
  container.querySelectorAll("[data-add-date]").forEach((btn) => {
    btn.addEventListener("click", () => onAddTaskOnDate(btn.dataset.addDate));
  });
}

function buildWeek(weekDays, tasks, todayKey) {
  const weekStart = weekDays[0].date;
  const weekEnd = weekDays[6].date;

  const items = [];
  tasks.forEach((t) => {
    const [s, e] = effectiveRange(t);
    if (e < weekStart || s > weekEnd) return;
    const segS = Math.max(0, daysBetween(weekStart, s));
    const segE = Math.min(6, daysBetween(weekStart, e));
    items.push({ task: t, segS, segE });
  });
  items.sort((a, b) => a.segS - b.segS || b.segE - b.segS - (a.segE - a.segS));

  const laneEnds = [];
  let overflowCount = 0;
  const firstOverflowTaskId = { id: null };
  items.forEach((item) => {
    let lane = laneEnds.findIndex((end) => end < item.segS);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= MAX_LANES) {
      item.hidden = true;
      overflowCount++;
      if (!firstOverflowTaskId.id) firstOverflowTaskId.id = item.task.id;
      return;
    }
    laneEnds[lane] = item.segE;
    item.lane = lane;
  });
  const laneCount = Math.min(MAX_LANES, laneEnds.length) || 1;

  let cells = "";
  weekDays.forEach((d, i) => {
    const key = toDateInputValue(d.date);
    const isToday = key === todayKey;
    cells += `<div class="cal-daybg${d.otherMonth ? " is-other-month" : ""}${isToday ? " is-today" : ""}" style="grid-column:${i + 1};grid-row:1 / -1;"></div>`;
    cells += `<div class="cal-daynum${isToday ? " is-today" : ""}" style="grid-column:${i + 1};grid-row:1;">
      <span>${d.label}</span>
      ${!d.otherMonth ? `<button class="calendar-day__add" data-add-date="${key}" title="Nueva tarea este día">+</button>` : ""}
    </div>`;
  });

  items.filter((i) => !i.hidden).forEach((item) => {
    const t = item.task;
    const gridRow = item.lane + 2;
    if (t.isMilestone) {
      cells += `<div class="cal-milestone" data-open="${t.id}" title="${plainTitleText(t.title)}" style="grid-column:${item.segE + 1};grid-row:${gridRow};">
        <span class="cal-milestone__diamond"></span><span class="cal-bar__label">${renderTitleHtml(t.title)}</span>
      </div>`;
    } else {
      const color = PRIORITY_COLORS[t.priority] || "var(--color-line-bright)";
      cells += `<div class="cal-bar${t.isComplete ? " is-complete" : ""}" data-open="${t.id}" title="${plainTitleText(t.title)}" style="grid-column:${item.segS + 1} / ${item.segE + 2};grid-row:${gridRow};background:${color};">
        <span class="cal-bar__label">${renderTitleHtml(t.title)}</span>
      </div>`;
    }
  });

  if (overflowCount > 0) {
    cells += `<div class="calendar-more" data-open="${firstOverflowTaskId.id}" style="grid-column:1 / 8;grid-row:${laneCount + 2};">+${overflowCount} más</div>`;
  }

  const rows = laneCount + (overflowCount > 0 ? 1 : 0);
  return `<div class="calendar-week" style="grid-template-rows:26px repeat(${rows}, 20px);">${cells}</div>`;
}
