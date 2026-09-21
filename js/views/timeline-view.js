// ============================================================================
// Línea de tiempo / Gantt. Se le pasa `groups`: un array de secciones (vista
// por proyecto) o de proyectos (vista global) con sus tareas ya dentro, así
// la misma vista sirve para los dos casos sin duplicar lógica.
//
// Zoom con un clic entre días / semanas / meses (`zoom`, controlado desde
// fuera vía `onZoomChange` para que se recuerde al cambiar de vista). En
// semanas se indica el número de semana ISO del año. (v46 añadió también
// trimestre/año para horizontes largos; se quitaron en v48 a petición de
// Ramón — no tenía sentido esa escala para la duración real de sus
// proyectos. Ver el historial del README si hiciera falta recuperarlos:
// quedó documentado cómo se hicieron.)
//
// Vacaciones inhábiles (apartado más abajo): solo se pueden marcar en día,
// semana o mes — a partir de un zoom más amplio que eso, prácticamente
// cualquier columna rozaría agosto o la Navidad, así que resaltarlas
// dejaría de distinguir nada.
//
// Cómo se calcula cada barra: si la tarea tiene fecha de inicio Y fecha
// límite, la barra cubre todo ese rango (recortado a las columnas visibles
// según el zoom). Si solo tiene una de las dos, se dibuja un marcador de
// una columna en esa fecha. Los hitos siempre se dibujan como un rombo,
// nunca como barra.
//
// Modo Secciones vs Tareas (`viewMode`, controlado desde fuera vía
// `onViewModeChange`, igual que el zoom — ver v44 en el historial del
// README): "Tareas" es el comportamiento de siempre, una fila por tarea.
// "Secciones" colapsa cada sección en UNA sola fila-bloque: fecha de
// inicio/fin = la más temprana/tardía entre TODAS las fechas (inicio o
// límite) de sus tareas, color de la barra = el de la prioridad más
// urgente presente entre ellas (mismos colores que ya usa el modo Tareas,
// para no inventar un lenguaje de color nuevo), y el título de la fila
// lleva "· completadas/total". El PUNTO de la etiqueta sigue siendo el
// color de sección/proyecto de siempre; desde la v46 la propia barra
// agregada lleva ADEMÁS un filo de color a la izquierda (`accentColor`,
// SECTION_ACCENT_COLORS más abajo) distinto por sección, para
// diferenciarlas de un vistazo sin tocar el color de prioridad de la
// barra en sí — las dos cosas conviven sin pisarse: el filo dice DE QUÉ
// sección es, el resto de la barra sigue diciendo CÓMO de urgente está.
//
// En la vista de UN proyecto, cada "grupo" que llega ya es una sección —
// así que en modo Secciones esa fila-bloque sustituye entera a la cabecera
// + sus tareas (sin cabecera aparte, `flat: true`). En la global cada
// "grupo" es un proyecto que SÍ trae más de una sección dentro (`g.sections`,
// el array `sections` del proyecto, añadido por quien llama) — ahí la
// cabecera de proyecto se mantiene igual que en modo Tareas, y son las
// filas de dentro las que pasan de una por tarea a una por sección
// (buildSectionModeGroups decide cuál de los dos casos es, mirando si el
// grupo trae `.sections` o no).
//
// Expandir una sección (v46, `expandedSections`: un Set de claves,
// controlado desde fuera vía `onToggleSectionExpand`, mismo patrón que el
// resto del estado del Gantt): un clic en la fila-bloque de una sección la
// despliega SIN salir del modo Secciones — sus tareas de verdad aparecen
// justo debajo, sangradas, con barra y color de prioridad normales, y la
// fila-bloque de arriba se queda como resumen (con su flecha ahora hacia
// abajo). La clave de cada sección lleva el id del proyecto delante
// (`sectionKey`, ver buildSectionModeGroups) porque "Sin sección" usa el
// mismo id vacío en todos los proyectos, y si no se namespacearan así,
// expandir "Sin sección" en un proyecto la dejaría expandida también en
// otro sin haberlo pedido. Expandir es solo para mirar más de cerca sin
// perder el resto colapsado: la exportación (más abajo) sigue exportando
// siempre la vista colapsada de `displayGroups`, no lo que esté expandido
// en pantalla en ese momento — son dos cosas independientes a propósito
// (ver el porqué en el historial de la v46).
//
// Arrastrar una barra para cambiar sus fechas (v46, ver wireBarDragging):
// SOLO en tareas de verdad (modo Tareas, o una tarea de una sección
// expandida en modo Secciones) — nunca en la barra agregada de una
// sección colapsada ni en los rombos en miniatura de sus hitos: esa barra
// no tiene fecha propia, son las fechas mín/máx de sus tareas (ver
// aggregateBucket), así que "arrastrarla" no tendría una tarea real a la
// que escribirle la fecha. Solo con zoom de día o semana, porque a partir
// de mes cada píxel ya representa demasiados días para arrastrar con
// precisión.
// Tirar del borde izquierdo cambia la fecha de inicio, del derecho la
// fecha límite, y del cuerpo mueve las dos a la vez sin cambiar la
// duración; un hito (un solo rombo) siempre se mueve entero, sea cual sea
// el punto exacto donde se pulse. Reutiliza tal cual updateTask() de
// tasks.js, la misma función que ya usa el modal de tarea, así que no
// hay ningún permiso ni validación nuevos que mantener aparte.
//
// Exportar (gantt-export.js) recibe siempre `displayGroups`, la versión ya
// agregada cuando toca — así el archivo descargado es exactamente lo que
// hay en pantalla en ese momento (salvo qué sección esté expandida, ver
// arriba), y gantt-export.js no necesita saber nada de cómo se agregó
// (solo recibe `viewMode` para ajustar textos como "tareas" -> "secciones"
// en cabeceras y avisos).
// ============================================================================
import { escapeHtml, toDate, toDateInputValue, addDays, daysBetween, isoWeekNumber, mondayOf, badgeHtml, showToast, renderTitleHtml, plainTitleText, getTaskSectionForProject } from "../utils.js";
import { openTaskContextMenu } from "./list-view.js";
import { exportTimelineToExcel, exportTimelineToPdf } from "../components/gantt-export.js";
import { updateTask } from "../data/tasks.js";
import { saveProjectSections } from "../data/projects.js";
import { openSectionsModal } from "../components/sections-modal.js";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const PRIORITY_COLORS = {
  urgente: "var(--color-danger)",
  alta: "var(--color-signal)",
  media: "#78848C",
  baja: "var(--color-text-faint)",
};
// Orden de severidad para elegir el color de una fila agregada (modo
// Secciones): el de la tarea MÁS urgente que haya dentro, no una media ni
// "la última que se mire" — así una sola tarea urgente enterrada en una
// sección de 20 ya se nota en el Gantt colapsado.
const PRIORITY_RANK = { urgente: 0, alta: 1, media: 2, baja: 3 };

// Filo de color por sección (v46, modo Secciones), independiente del color
// de prioridad de la barra. Tonos elegidos a propósito lejos del rojo/dorado
// de las prioridades (ver --color-danger/--color-signal) para que no se
// confundan con "urgente". Con más secciones que colores, se repiten en
// ciclo (mismo criterio que el de 10 colores de la plantilla Martech).
const SECTION_ACCENT_COLORS = ["#76CE64", "#64CE9D", "#64B5CE", "#646BCE", "#A764CE", "#CE64AB"];

const ZOOM_CONFIG = {
  day: { width: 32, label: "Días" },
  week: { width: 64, label: "Semanas" },
  month: { width: 96, label: "Meses" },
};
// Arrastrar para cambiar fechas (ver wireBarDragging) solo tiene precisión
// suficiente en estos dos: a partir de mes, cada píxel ya representa
// demasiados días.
const DRAGGABLE_ZOOMS = new Set(["day", "week"]);
// Vacaciones inhábiles: solo tienen sentido hasta zoom de mes — a partir
// de ahí (cuando existía trimestre/año, ver v46/v48) casi cualquier
// columna rozaba agosto o Navidad, y resaltarlas dejaba de distinguir nada.
const HOLIDAY_CAPABLE_ZOOMS = new Set(["day", "week", "month"]);

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

/**
 * Agrega una lista de tareas reales en una única "tarea" sintética que
 * representa a todas ellas como un bloque (modo Secciones). Fecha de
 * inicio/fin = la más temprana/tardía entre CUALQUIER fecha (inicio o
 * límite) de las tareas que la componen — sin fechas, se queda a `null`
 * igual que le pasaría a una tarea suelta sin fecha (fila con etiqueta,
 * sin barra). Prioridad = la más urgente presente entre ellas, o "media"
 * si ninguna tiene una reconocible. Los hitos originales se conservan
 * aparte (`milestones`, con su id y fecha real intactos) para poder
 * dibujarlos encima del bloque sin perderlos. `sourceTasks` guarda las
 * tareas reales tal cual, para poder desplegarlas si se expande la
 * sección (v46); `sectionKey`/`accentColor` también son de la v46, ver el
 * comentario de cabecera del archivo.
 */
function aggregateBucket(label, tasks, sectionKey, accentColor) {
  const dates = tasks.flatMap((t) => [t.startDate, t.dueDate].filter(Boolean).map(toDate)).filter(Boolean);
  const completeCount = tasks.filter((t) => t.isComplete).length;
  let priority = null;
  tasks.forEach((t) => {
    const rank = PRIORITY_RANK[t.priority];
    if (rank !== undefined && (priority === null || rank < PRIORITY_RANK[priority])) priority = t.priority;
  });
  return {
    title: `${label} · ${completeCount}/${tasks.length}`,
    startDate: dates.length ? new Date(Math.min(...dates)) : null,
    dueDate: dates.length ? new Date(Math.max(...dates)) : null,
    priority: priority || "media",
    isComplete: tasks.length > 0 && completeCount === tasks.length,
    isMilestone: false,
    assigneeIds: [...new Set(tasks.flatMap((t) => t.assigneeIds || []))],
    isAggregate: true,
    milestones: tasks.filter((t) => t.isMilestone && (t.startDate || t.dueDate)),
    sourceTasks: tasks,
    sectionKey,
    accentColor,
  };
}

/**
 * Reparte `tasks` (todas de UN proyecto, `projectId`) en sus secciones,
 * mismo criterio que la vista de un solo proyecto (`getTaskSectionForProject`,
 * para que una tarea que tiene a este proyecto como ADICIONAL caiga en la
 * sección correcta igual que en su Lista/Tablero, no en la de su proyecto
 * principal). "Sin sección" va primero si hay alguna, mismo criterio que
 * el resto de la app desde la v34. Solo devuelve buckets con alguna tarea.
 * `id: ""` para "Sin sección" (igual que el resto de la app) — se usa para
 * construir la sectionKey namespaceada de expandir (ver buildSectionModeGroups).
 * `color`: el color propio de la sección si se eligió uno (v47,
 * sections-modal.js) — "Sin sección" nunca tiene, no es una sección real.
 */
function sectionBucketsForProject(tasks, projectId, sectionDefs) {
  const sorted = [...sectionDefs].sort((a, b) => a.order - b.order);
  const noSection = tasks.filter((t) => !getTaskSectionForProject(t, projectId));
  const bySection = sorted.map((s) => ({
    id: s.id,
    label: s.name,
    color: s.color || null,
    tasks: tasks.filter((t) => getTaskSectionForProject(t, projectId) === s.id),
  }));
  const buckets = noSection.length ? [{ id: "", label: "Sin sección", color: null, tasks: noSection }, ...bySection] : bySection;
  return buckets.filter((b) => b.tasks.length);
}

/**
 * Convierte los `groups` normales (tareas reales) en su versión agregada
 * para el modo Secciones — ver el comentario de cabecera del archivo para
 * el porqué de la diferencia entre los dos casos de abajo. `currentProjectId`
 * solo hace falta en el caso "por proyecto" (para namespacear su única
 * sectionKey); en el caso global cada grupo ya trae su propio id de
 * proyecto (`g.id`), así que se ignora.
 *
 * Color de sección (v47): si la sección tiene uno propio elegido a mano
 * (sections-modal.js), se usa tal cual. Si no, se le asigna uno automático
 * del ciclo — el índice del ciclo solo avanza para las secciones que SÍ
 * necesitan uno automático, así que colorear una a mano no le quita a las
 * demás la oportunidad de que les toquen los primeros tonos del ciclo.
 */
function buildSectionModeGroups(groups, currentProjectId) {
  const out = [];
  groups.forEach((g) => {
    if (!g.tasks.length) return;
    if (Array.isArray(g.sections)) {
      // Global: el grupo es un proyecto entero — la cabecera se conserva,
      // y sus tareas se agregan una vez por cada sección de ESE proyecto.
      const buckets = sectionBucketsForProject(g.tasks, g.id, g.sections);
      if (!buckets.length) return;
      let autoIdx = 0;
      out.push({
        id: g.id, label: g.label, color: g.color, icon: g.icon,
        tasks: buckets.map((b) => {
          const accentColor = b.color || SECTION_ACCENT_COLORS[autoIdx++ % SECTION_ACCENT_COLORS.length];
          return aggregateBucket(b.label, b.tasks, `${g.id}:${b.id || "none"}`, accentColor);
        }),
      });
    } else {
      // Por proyecto: el grupo YA es una sección — se agrega entera en un
      // único bloque, sin cabecera propia (esa fila hace las dos cosas).
      // `g.sectionColor` es el color propio de ESTA sección si lo tiene
      // (añadido por app.js); si no, el índice de color automático se
      // decide fuera, en el bucle de abajo, con el índice del propio
      // grupo dentro de `groups` (solo contando los que lo necesitan).
      out.push({ id: g.id, label: g.label, color: g.color, flat: true, _rawTasks: g.tasks, _sectionColor: g.sectionColor || null });
    }
  });
  // Color por índice DESPUÉS de filtrar los grupos vacíos, para que el
  // ciclo de colores no "salte" un hueco por una sección sin tareas.
  let flatIdx = 0;
  out.forEach((g) => {
    if (!g.flat) return;
    const accentColor = g._sectionColor || SECTION_ACCENT_COLORS[flatIdx % SECTION_ACCENT_COLORS.length];
    if (!g._sectionColor) flatIdx++;
    g.tasks = [aggregateBucket(g.label, g._rawTasks, `${currentProjectId}:${g.id || "none"}`, accentColor)];
    delete g._rawTasks;
    delete g._sectionColor;
  });
  return out;
}

export function renderTimelineView(container, {
  groups, zoom, onZoomChange, viewMode, onViewModeChange,
  expandedSections, onToggleSectionExpand,
  showHolidays, onToggleHolidays, onOpenTask, exportTitle, groupLabel, teamMembers, project,
}) {
  const unit = zoom || "day";
  const vm = viewMode || "tasks";
  const expanded = expandedSections || new Set();
  const allTasks = groups.flatMap((g) => g.tasks);
  const allTasksById = new Map(allTasks.map((t) => [t.id, t]));
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
  const canShowHolidays = HOLIDAY_CAPABLE_ZOOMS.has(unit);
  const canDrag = DRAGGABLE_ZOOMS.has(unit);

  // Agregada una sola vez aquí — la misma `displayGroups` alimenta tanto
  // las filas de abajo (con lo expandido añadido después) como el botón
  // de exportar, para que lo descargado sea siempre justo la vista
  // colapsada (ver cabecera del archivo sobre por qué expandir no entra
  // en la exportación).
  const displayGroups = vm === "sections" ? buildSectionModeGroups(groups, project && project.id) : groups;

  const rows = [];
  displayGroups.forEach((g) => {
    if (!g.tasks.length) return;
    if (!(vm === "sections" && g.flat)) {
      rows.push({ type: "group", label: g.label, color: g.color, icon: g.icon });
    }
    g.tasks.forEach((t) => {
      if (vm !== "sections") { rows.push({ type: "task", task: t }); return; }
      const isExpanded = expanded.has(t.sectionKey);
      rows.push({ type: "agg", task: t, dotColor: g.color, expanded: isExpanded });
      if (isExpanded) {
        t.sourceTasks.forEach((real) => rows.push({ type: "task", task: real, indent: true, accentColor: t.accentColor }));
      }
    });
  });

  const zoomButtons = Object.keys(ZOOM_CONFIG)
    .map((key) => `<button type="button" class="topbar__view-btn${key === unit ? " is-active" : ""}" data-zoom="${key}">${ZOOM_CONFIG[key].label}</button>`)
    .join("");
  const viewModeButtons = `
    <button type="button" class="topbar__view-btn${vm === "sections" ? " is-active" : ""}" data-viewmode="sections">Secciones</button>
    <button type="button" class="topbar__view-btn${vm === "tasks" ? " is-active" : ""}" data-viewmode="tasks">Tareas</button>
  `;
  const holidayBtnHtml = canShowHolidays ? `<button type="button" class="btn btn--ghost btn--sm${showHolidays ? " is-toggled" : ""}" id="tl-holidays-btn">🏖️ Vacaciones inhábiles</button>` : "";
  // Solo en la línea de tiempo de UN proyecto (`project` viene informado) —
  // en la global no hay un único conjunto de secciones al que abrir este
  // modal, sería el de qué proyecto. Mismo modal que ya usa la Lista
  // (sections-modal.js) — pedido para poder cambiar el color de una
  // sección sin tener que salir a la Lista a buscar el botón de allí.
  const sectionsBtnHtml = project ? `<button type="button" class="btn btn--ghost btn--sm" id="tl-sections-btn">🗂 Secciones</button>` : "";

  if (!rows.length) {
    container.innerHTML = `
      <div class="timeline">
        <div class="timeline__toolbar">
          <div class="topbar__views" style="margin-left:0;">${viewModeButtons}</div>
          <div class="topbar__views" style="margin-left:0;">${zoomButtons}</div>
          ${holidayBtnHtml}
          ${sectionsBtnHtml}
        </div>
        <div class="empty-state">
          <span class="empty-state__eyebrow">— LÍNEA DE TIEMPO —</span>
          <h2>Nada que mostrar todavía</h2>
          <p>Ponle fecha de inicio y/o fecha límite a alguna tarea para que aparezca aquí.</p>
        </div>
      </div>`;
    container.querySelectorAll("[data-zoom]").forEach((btn) => btn.addEventListener("click", () => onZoomChange(btn.dataset.zoom)));
    container.querySelectorAll("[data-viewmode]").forEach((btn) => btn.addEventListener("click", () => onViewModeChange(btn.dataset.viewmode)));
    if (canShowHolidays) container.querySelector("#tl-holidays-btn").addEventListener("click", onToggleHolidays);
    if (project) container.querySelector("#tl-sections-btn").addEventListener("click", () => openSectionsModal({ project, onSave: (sections) => saveProjectSections(project, sections) }));
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
      const marker = row.icon ? badgeHtml(row.icon, row.color, "project-badge--sm") : `<span class="tl-group-dot" style="background:${row.color}"></span>`;
      cells += `<div class="tl-group-label" style="grid-column:1;grid-row:${gridRow};">${marker}${escapeHtml(row.label)}</div>`;
      cells += `<div class="tl-group-band" style="grid-column:2 / ${columns.length + 2};grid-row:${gridRow};"></div>`;
      return;
    }
    if (row.type === "agg") {
      // Fila-bloque de una sección entera (modo Secciones) — mismo hueco
      // que una fila de tarea, pero con look de cabecera (negrita, punto
      // de color de sección/proyecto) y SIN abrir nada al pulsarla: no
      // lleva `data-open`, porque no es una tarea real (ver aggregateBucket).
      // Toda la etiqueta es el interruptor de expandir/contraer (v46).
      const t = row.task;
      const marker = `<span class="tl-group-dot" style="background:${row.dotColor || "var(--color-line-bright)"}"></span>`;
      const chevron = `<span class="tl-agg-chevron">${row.expanded ? "▾" : "▸"}</span>`;
      cells += `<div class="tl-group-label tl-group-label--toggle" data-toggle-section="${t.sectionKey}" title="${escapeHtml(t.title)}" style="grid-column:1;grid-row:${gridRow};${t.isComplete ? "color:var(--color-text-faint);text-decoration:line-through;" : ""}">${chevron}${marker}${escapeHtml(t.title)}</div>`;
      cells += `<div class="tl-row-band" style="grid-column:2 / ${columns.length + 2};grid-row:${gridRow};"></div>`;

      const span = taskSpan(t, columns);
      if (span) {
        const color = PRIORITY_COLORS[t.priority] || "var(--color-line-bright)";
        cells += `<div class="tl-bar tl-bar--agg${t.isComplete ? " is-complete" : ""}" title="${escapeHtml(t.title)}" style="grid-column:${span.s + 2} / ${span.e + 3};grid-row:${gridRow};border-color:${color};background:${color};box-shadow:inset 6px 0 0 ${t.accentColor};"></div>`;
      }
      // Los hitos que quedaron dentro del bloque no se pierden: un rombo
      // pequeño encima, en su fecha real — y ESE sí abre la tarea real
      // (pero no se puede arrastrar: es un adorno del bloque, no una fila
      // de tarea de verdad — ver cabecera del archivo).
      (t.milestones || []).forEach((m) => {
        const mSpan = taskSpan(m, columns);
        if (!mSpan) return;
        cells += `<div class="tl-milestone tl-milestone--mini" data-open="${m.id}" data-task-id="${m.id}" title="${plainTitleText(m.title)}" style="grid-column:${mSpan.e + 2};grid-row:${gridRow};"><span class="tl-milestone__diamond"></span></div>`;
      });
      return;
    }
    const t = row.task;
    const indentPad = row.indent ? "padding-left:26px;" : "";
    cells += `<div class="tl-task-label" data-open="${t.id}" data-task-id="${t.id}" title="${plainTitleText(t.title)}" style="grid-column:1;grid-row:${gridRow};${indentPad}${t.isComplete ? "color:var(--color-text-faint);text-decoration:line-through;" : ""}">${t.isMilestone ? "🚩 " : ""}${renderTitleHtml(t.title)}</div>`;
    cells += `<div class="tl-row-band" style="grid-column:2 / ${columns.length + 2};grid-row:${gridRow};"></div>`;

    const span = taskSpan(t, columns);
    if (!span) return;
    const dragAttr = canDrag ? ` data-drag-task="${t.id}"` : "";
    if (t.isMilestone) {
      cells += `<div class="tl-milestone" data-open="${t.id}" data-task-id="${t.id}"${dragAttr} title="${plainTitleText(t.title)}" style="grid-column:${span.e + 2};grid-row:${gridRow};"><span class="tl-milestone__diamond"></span></div>`;
    } else {
      const color = PRIORITY_COLORS[t.priority] || "var(--color-line-bright)";
      const accentShadow = row.indent && row.accentColor ? `box-shadow:inset 6px 0 0 ${row.accentColor};` : "";
      // Asas de redimensionar (v47): solo se ven — y solo tiene sentido
      // ofrecerlas — cuando la tarea tiene las dos fechas Y es arrastrable
      // en este zoom; con una sola fecha no hay "borde" que estirar
      // aparte del propio punto (ver canResize en wireBarDragging).
      const resizable = canDrag && t.startDate && t.dueDate ? " tl-bar--resizable" : "";
      cells += `<div class="tl-bar${t.isComplete ? " is-complete" : ""}${resizable}" data-open="${t.id}" data-task-id="${t.id}"${dragAttr} title="${plainTitleText(t.title)}" style="grid-column:${span.s + 2} / ${span.e + 3};grid-row:${gridRow};border-color:${color};background:${color};${accentShadow}"></div>`;
    }
  });

  if (showHolidays && canShowHolidays) {
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
        <div class="topbar__views" style="margin-left:0;">${viewModeButtons}</div>
        <div class="topbar__views" style="margin-left:0;">${zoomButtons}</div>
        <button class="btn btn--ghost btn--sm" id="tl-today-btn">Hoy</button>
        ${holidayBtnHtml}
        ${sectionsBtnHtml}
        ${withoutDates > 0 ? `<span class="timeline__hint">${withoutDates} ${withoutDates === 1 ? "tarea sin fecha no se muestra" : "tareas sin fecha no se muestran"} aquí</span>` : ""}
        <button class="btn btn--ghost btn--sm" id="tl-export-btn" style="margin-left:auto;">⬇ Exportar</button>
      </div>
      <div class="timeline__scroll" id="tl-scroll">
        <div class="timeline__grid" style="grid-template-columns:${gridTemplateColumns};grid-template-rows:40px repeat(${rows.length}, 34px);">
          ${cells}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-zoom]").forEach((btn) => btn.addEventListener("click", () => onZoomChange(btn.dataset.zoom)));
  container.querySelectorAll("[data-viewmode]").forEach((btn) => btn.addEventListener("click", () => onViewModeChange(btn.dataset.viewmode)));
  container.querySelectorAll("[data-toggle-section]").forEach((el) => el.addEventListener("click", () => onToggleSectionExpand(el.dataset.toggleSection)));

  const scrollBox = container.querySelector("#tl-scroll");
  const scrollToToday = () => {
    const x = Math.max(0, LABEL_W + todayIdx * colWidth - scrollBox.clientWidth / 2);
    scrollBox.scrollTo({ left: x, behavior: "smooth" });
  };
  container.querySelector("#tl-today-btn").addEventListener("click", scrollToToday);
  if (canShowHolidays) container.querySelector("#tl-holidays-btn").addEventListener("click", onToggleHolidays);
  if (project) container.querySelector("#tl-sections-btn").addEventListener("click", () => openSectionsModal({ project, onSave: (sections) => saveProjectSections(project, sections) }));
  // Título con sufijo cuando se exporta en modo Secciones, para que el
  // propio archivo descargado (nombre de fichero incluido, vía
  // sanitizeFilename en gantt-export.js) se autodocumente en qué modo se
  // generó — útil si se retoma más adelante sin recordar cuál era.
  const modeExportTitle = vm === "sections" ? `${exportTitle} — por secciones` : exportTitle;
  container.querySelector("#tl-export-btn").addEventListener("click", (e) => openExportPopover(e.currentTarget, { groups: displayGroups, exportTitle: modeExportTitle, groupLabel, teamMembers, project, viewMode: vm }));
  if (todayIdx >= 0) requestAnimationFrame(scrollToToday);

  // `dragState.suppressClickFor`: cuando un arrastre de verdad termina en
  // una tarea, se marca aquí su id para que el "click" nativo que el
  // navegador dispara justo después del mouseup (siempre lo hace, haya
  // habido arrastre o no, mientras mousedown y mouseup caigan en el mismo
  // elemento) no vuelva a abrir esa tarea de inmediato. Un clic normal
  // (sin arrastre real) nunca toca esto y sigue abriendo la tarea igual
  // que siempre.
  const dragState = { suppressClickFor: null };
  if (canDrag) wireBarDragging(container, { unit, colWidth, allTasksById, dragState });

  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => {
      if (dragState.suppressClickFor === elx.dataset.taskId) {
        dragState.suppressClickFor = null;
        return;
      }
      onOpenTask(elx.dataset.open);
    });
    elx.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = allTasksById.get(elx.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
    });
  });
}

function openExportPopover(anchorBtn, { groups, exportTitle, groupLabel, teamMembers, project, viewMode }) {
  document.querySelectorAll(".export-popover").forEach((p) => p.remove());
  const rect = anchorBtn.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "export-popover filter-popover";
  const modeNote = viewMode === "sections" ? " (secciones)" : "";
  pop.innerHTML = `
    <button type="button" class="tag-suggest__item" data-export="excel">📊 Descargar Excel${modeNote}</button>
    <button type="button" class="tag-suggest__item" data-export="pdf">📄 Descargar PDF${modeNote}</button>
  `;
  document.body.appendChild(pop);
  const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 20);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${rect.bottom + 6}px`;

  async function runExport(fn, btn, label) {
    btn.disabled = true;
    btn.textContent = `${label}…`;
    try {
      await fn({ groups, title: exportTitle, groupLabel, teamMembers, project, viewMode });
    } catch (err) {
      console.error(err);
      showToast("No se pudo generar el archivo. Comprueba tu conexión e inténtalo de nuevo.");
    }
    closePopover();
  }

  pop.querySelector('[data-export="excel"]').addEventListener("click", (e) => runExport(exportTimelineToExcel, e.currentTarget, "Generando Excel"));
  pop.querySelector('[data-export="pdf"]').addEventListener("click", (e) => runExport(exportTimelineToPdf, e.currentTarget, "Generando PDF"));

  function onOutside(e) { if (!pop.contains(e.target) && e.target !== anchorBtn) closePopover(); }
  function onKeydown(e) { if (e.key === "Escape") closePopover(); }
  function closePopover() {
    pop.remove();
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
  }
  setTimeout(() => {
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}

// --------------------------------------------------------------------
// Arrastrar una barra o un hito para cambiar sus fechas (v46). Ver el
// comentario de cabecera del archivo para el alcance (solo tareas reales,
// solo zoom de día/semana). `allTasksById` para leer las fechas ACTUALES
// de la tarea al empezar a arrastrar (data-drag-task solo lleva el id).
// --------------------------------------------------------------------
const DRAG_MOVE_THRESHOLD_PX = 4;
const DRAG_EDGE_ZONE_PX = 9;

function computeDragPatch(task, mode, dayDelta) {
  if (!dayDelta) return null;
  const start = task.startDate ? toDate(task.startDate) : null;
  const due = task.dueDate ? toDate(task.dueDate) : null;
  if (mode === "resize-start") {
    if (!start) return null;
    let ns = addDays(start, dayDelta);
    if (due && ns > due) ns = due;
    return { startDate: toDateInputValue(ns) };
  }
  if (mode === "resize-due") {
    if (!due) return null;
    let nd = addDays(due, dayDelta);
    if (start && nd < start) nd = start;
    return { dueDate: toDateInputValue(nd) };
  }
  const patch = {};
  if (start) patch.startDate = toDateInputValue(addDays(start, dayDelta));
  if (due) patch.dueDate = toDateInputValue(addDays(due, dayDelta));
  return Object.keys(patch).length ? patch : null;
}

function fmtEsShort(isoDateStr) {
  const [y, m, d] = isoDateStr.split("-");
  return `${d}/${m}`;
}

let dragTooltipEl = null;
function showDragTooltip(el, text) {
  if (!dragTooltipEl) {
    dragTooltipEl = document.createElement("div");
    dragTooltipEl.className = "tl-drag-tooltip";
    document.body.appendChild(dragTooltipEl);
  }
  const rect = el.getBoundingClientRect();
  dragTooltipEl.textContent = text;
  dragTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
  dragTooltipEl.style.top = `${rect.top - 10}px`;
}
function removeDragTooltip() {
  if (dragTooltipEl) { dragTooltipEl.remove(); dragTooltipEl = null; }
}

function wireBarDragging(container, { unit, colWidth, allTasksById, dragState }) {
  const pxPerDay = unit === "week" ? colWidth / 7 : colWidth;

  container.querySelectorAll("[data-drag-task]").forEach((el) => {
    const taskId = el.dataset.dragTask;
    const task = allTasksById.get(taskId);
    if (!task) return;
    const isMilestoneEl = el.classList.contains("tl-milestone");
    const canResize = !isMilestoneEl && !!task.startDate && !!task.dueDate;

    if (canResize) {
      el.addEventListener("mousemove", (e) => {
        if (el.classList.contains("tl-bar--dragging")) return;
        const rect = el.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        if (localX < DRAG_EDGE_ZONE_PX) el.style.cursor = "w-resize";
        else if (localX > rect.width - DRAG_EDGE_ZONE_PX) el.style.cursor = "e-resize";
        else el.style.cursor = "grab";
      });
    }

    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // solo botón izquierdo del ratón
      const rect = el.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      let mode = "move";
      if (canResize && localX < DRAG_EDGE_ZONE_PX) mode = "resize-start";
      else if (canResize && localX > rect.width - DRAG_EDGE_ZONE_PX) mode = "resize-due";

      const startX = e.clientX;
      let dayDelta = 0;
      let dragging = false;

      function onMove(ev) {
        const deltaPx = ev.clientX - startX;
        if (!dragging && Math.abs(deltaPx) < DRAG_MOVE_THRESHOLD_PX) return;
        if (!dragging) {
          dragging = true;
          document.body.style.cursor = mode === "resize-start" ? "w-resize" : mode === "resize-due" ? "e-resize" : "grabbing";
        }
        el.classList.add("tl-bar--dragging");
        const nextDelta = Math.round(deltaPx / pxPerDay);
        if (nextDelta === dayDelta && el.style.transform) return;
        dayDelta = nextDelta;
        el.style.transform = `translateX(${dayDelta * pxPerDay}px)`;
        const patch = computeDragPatch(task, mode, dayDelta) || {};
        const parts = [];
        if (patch.startDate) parts.push(`Inicio ${fmtEsShort(patch.startDate)}`);
        if (patch.dueDate) parts.push(`Fin ${fmtEsShort(patch.dueDate)}`);
        showDragTooltip(el, parts.join(" · ") || "Sin cambios");
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        removeDragTooltip();
        el.classList.remove("tl-bar--dragging");
        el.style.transform = "";
        el.style.cursor = "";
        document.body.style.cursor = "";
        if (!dragging) return; // clic normal, sin arrastre real: que abra la tarea como siempre

        dragState.suppressClickFor = taskId;
        const patch = computeDragPatch(task, mode, dayDelta);
        if (!patch) return;
        updateTask(taskId, patch)
          .then(() => showToast("Fecha actualizada."))
          .catch((err) => {
            console.error(err);
            showToast("No se pudo actualizar la fecha. Comprueba tu conexión e inténtalo de nuevo.");
          });
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
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
