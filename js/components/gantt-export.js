// ============================================================================
// Exportar la línea de tiempo (Gantt) a Excel o PDF — mismo botón en
// cualquier panel de línea de tiempo, sea de un proyecto (agrupada por
// sección) o global (agrupada por proyecto), porque los dos usan
// renderTimelineView() con la misma forma de `groups`. Exporta
// EXACTAMENTE lo que hay en pantalla en ese momento: los `groups` que
// recibe ya vienen filtrados/ordenados por quien llama (el mismo dato que
// se está pintando en el propio Gantt, no una consulta aparte a Firestore).
//
// El Excel tiene DOS caminos posibles:
//  - Plantilla Martech (assets/gantt-template-martech.xlsx): reproduce el
//    cronograma tal cual lo usa la empresa — colores de barra por
//    sección, cabecera CLIENTE/PROYECTO/FECHA, el mismo formato condicional
//    de siempre. Solo para la línea de tiempo de UN proyecto (la plantilla
//    da por hecho un único cronograma, no tiene sentido para la vista
//    global de "todos los proyectos"), y solo si los datos caben en lo
//    que la plantilla admite (ver checkMartechTemplateFit).
//  - Genérico (una fila por tarea, sin plantilla): se usa siempre para la
//    línea de tiempo global, y como respaldo automático si algo no cabe
//    en la plantilla — nunca deja a quien exporta sin archivo alguno.
//
// Las librerías (SheetJS para el genérico, JSZip para rellenar la
// plantilla, jsPDF para el PDF) se cargan solas desde un CDN la primera
// vez que hace falta cada una — no en cada carga de la app.
// ============================================================================
import { toDate, addDays, daysBetween, isoWeekNumber, initials, showToast, plainTitleText } from "../utils.js";

const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const MARTECH_TEMPLATE_URL = "assets/gantt-template-martech.xlsx";

function loadScriptOnce(src, isReady) {
  return new Promise((resolve, reject) => {
    if (isReady()) { resolve(); return; }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar la librería.")));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar la librería."));
    document.head.appendChild(s);
  });
}

const ensureXlsx = () => loadScriptOnce(XLSX_CDN, () => !!window.XLSX);
const ensureJsPdf = () => loadScriptOnce(JSPDF_CDN, () => !!(window.jspdf && window.jspdf.jsPDF));
const ensureJsZip = () => loadScriptOnce(JSZIP_CDN, () => !!window.JSZip);

const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
const PRIORITY_RGB = {
  urgente: [255, 92, 108],
  alta: [255, 88, 74],
  media: [120, 132, 140],
  baja: [170, 178, 184],
};

// Mismo orden y mismos códigos exactos que las 10 reglas de formato
// condicional de la plantilla (E13, E14... tienen que decir ESTO tal
// cual, letra por letra, o esa fila no se colorea al abrir el archivo).
const MARTECH_COLOR_CODES = [
  "1-Verde", "2-AzulClaro", "3-Naranja", "4-Rojo", "5-AzulOscuro",
  "6-Morado", "7-Amarillo", "8-GrisOscuro", "9-Rosa", "10-Marron",
];
const MARTECH_FIRST_TASK_ROW = 13;
const MARTECH_LAST_TASK_ROW = 62; // 50 filas de tarea en la plantilla ampliada
const MARTECH_MAX_TASKS = MARTECH_LAST_TASK_ROW - MARTECH_FIRST_TASK_ROW + 1;
const MARTECH_MAX_WEEKS = 40; // columnas F..AS de la plantilla

function fmtDate(value) {
  const d = value instanceof Date ? value : toDate(value);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function sanitizeFilename(str) {
  const clean = (str || "cronograma")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-")
    .toLowerCase();
  return clean || "cronograma";
}

function taskStatus(t) {
  if (t.isComplete) return "Completada";
  if (t.dueDate) {
    const due = toDate(t.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due && due < today) return "Vencida";
  }
  return "Pendiente";
}

function assigneeNames(t, teamMembers) {
  return (t.assigneeIds || []).map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean).map((m) => m.name);
}

/** Rango de fechas de TODAS las tareas exportadas — para el eje del gráfico y el título. */
function computeRange(allTasks) {
  const dates = allTasks.flatMap((t) => [t.startDate, t.dueDate].filter(Boolean).map(toDate)).filter(Boolean);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!dates.length) return { min: addDays(today, -3), max: addDays(today, 25) };
  return { min: new Date(Math.min(...dates)), max: new Date(Math.max(...dates)) };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// Excel genérico — una fila por tarea (sin plantilla), agrupadas por
// sección/proyecto repetido en cada fila (no como filas separadoras, para
// poder ordenar/filtrar la propia hoja en Excel sin romper la
// agrupación). La columna "Cronograma" es una barra de caracteres
// Unicode a escala del rango completo, para dar un vistazo visual sin
// depender de colorear celdas (poco fiable en la versión gratuita de
// SheetJS, la única que se puede cargar desde un CDN sin licencia).
// ============================================================================
async function buildGenericExcel({ groups, title, groupLabel, teamMembers }) {
  await ensureXlsx();
  const allTasks = groups.flatMap((g) => g.tasks);
  const { min, max } = computeRange(allTasks);
  const totalDays = Math.max(1, daysBetween(min, max) + 1);
  const BAR_WIDTH = 40;

  function barText(t) {
    if (!t.startDate && !t.dueDate) return "(sin fecha)";
    const s = t.startDate ? toDate(t.startDate) : toDate(t.dueDate);
    const e = t.dueDate ? toDate(t.dueDate) : toDate(t.startDate);
    const sOff = Math.min(BAR_WIDTH - 1, Math.max(0, Math.round((daysBetween(min, s) / totalDays) * BAR_WIDTH)));
    const eOff = Math.min(BAR_WIDTH - 1, Math.max(sOff, Math.round((daysBetween(min, e) / totalDays) * BAR_WIDTH)));
    if (t.isMilestone) return " ".repeat(sOff) + "◆";
    return " ".repeat(sOff) + "█".repeat(Math.max(1, eOff - sOff + 1));
  }

  const header = [groupLabel, "Tarea", "Responsables", "Prioridad", "Inicio", "Fin", "Días", "Estado", `Cronograma (${fmtDate(min)} – ${fmtDate(max)})`];
  const rows = [];
  groups.forEach((g) => {
    g.tasks.forEach((t) => {
      const days = t.startDate && t.dueDate ? daysBetween(toDate(t.startDate), toDate(t.dueDate)) + 1 : "";
      rows.push([
        g.label,
        (t.isMilestone ? "🚩 " : "") + plainTitleText(t.title),
        assigneeNames(t, teamMembers).join(", "),
        PRIORITY_LABELS[t.priority] || t.priority || "",
        fmtDate(t.startDate),
        fmtDate(t.dueDate),
        days,
        taskStatus(t),
        barText(t),
      ]);
    });
  });

  const wb = window.XLSX.utils.book_new();
  const wsData = [
    [title],
    [`Generado el ${fmtDate(new Date())} · ${allTasks.length} ${allTasks.length === 1 ? "tarea" : "tareas"}`],
    [],
    header,
    ...rows,
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [{ wch: 22 }, { wch: 40 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 12 }, { wch: BAR_WIDTH + 4 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: header.length - 1 } },
  ];
  window.XLSX.utils.book_append_sheet(wb, ws, "Cronograma");
  window.XLSX.writeFile(wb, `${sanitizeFilename(title)}.xlsx`);
}

// ============================================================================
// Excel con la plantilla Martech — en vez de construir un libro desde
// cero (con el que solo se pueden reproducir formatos MUY básicos en la
// versión gratuita de SheetJS: nada de relleno de celda ni del formato
// condicional que colorea las barras), se parte del .xlsx real de la
// plantilla ampliada (bundled en assets/) y se le inyectan los valores
// directamente en el XML de la hoja, celda a celda, dejando TODO lo demás
// intacto (estilos, formato condicional, logo, fórmulas de fecha) — así
// es Excel quien colorea las barras al abrir el archivo, con la MISMA
// lógica de siempre, no algo que haya que recalcular aquí.
//
// La plantilla original (CRONOGRAMA.xlsm, la que se pasó de referencia)
// traía 10 filas de tarea ya formateadas (13-22) y un formato condicional
// pensado para 40 columnas de semana (F..AS) — de ahí MARTECH_MAX_TASKS y
// MARTECH_MAX_WEEKS. Se amplió una copia a 50 filas (13-62) con
// openpyxl, replicando el estilo y el formato condicional de la fila 22
// a las 40 nuevas — ver el apartado 3 del README para el porqué y el
// cómo. Ampliar también las 40 columnas de semana sería la manera de no
// tener ningún límite, pero esa cirugía (reescribir a mano la cadena de
// fórmulas de fecha de la cabecera para más columnas, y el formato
// condicional que depende de ellas) no se ha llegado a hacer todavía —
// ver la limitación correspondiente en el apartado 7.
// ============================================================================

function checkMartechTemplateFit(groups) {
  const flat = groups.flatMap((g) => g.tasks.map((t) => ({ task: t, sectionLabel: g.label })));
  const dated = flat.filter((x) => x.task.startDate || x.task.dueDate);
  if (!dated.length) {
    return { fits: false, reason: "Ninguna tarea tiene fecha de inicio o de entrega." };
  }
  if (dated.length > MARTECH_MAX_TASKS) {
    return { fits: false, reason: `Hay ${dated.length} tareas con fecha y la plantilla de la empresa solo tiene sitio para ${MARTECH_MAX_TASKS}.` };
  }
  const starts = dated.map((x) => toDate(x.task.startDate || x.task.dueDate));
  const ends = dated.map((x) => toDate(x.task.dueDate || x.task.startDate));
  const minDate = new Date(Math.min(...starts));
  const maxDate = new Date(Math.max(...ends));
  if (minDate.getFullYear() !== maxDate.getFullYear()) {
    return { fits: false, reason: "Las tareas abarcan más de un año natural y la plantilla de la empresa solo representa uno." };
  }
  const startWeek = isoWeekNumber(minDate);
  const endWeek = isoWeekNumber(maxDate);
  const spanWeeks = endWeek - startWeek + 1;
  if (spanWeeks < 1 || spanWeeks > MARTECH_MAX_WEEKS) {
    return { fits: false, reason: `Las tareas abarcan ${Math.max(spanWeeks, 1)} semanas y la plantilla de la empresa solo tiene sitio para ${MARTECH_MAX_WEEKS}.` };
  }
  return { fits: true, dated, year: minDate.getFullYear(), startWeek };
}

function escapeXmlText(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Sustituye la celda `ref` entera (self-closing o con contenido, tanto da) por una de tipo texto, sin tocar su estilo `s`. */
function setInlineStringCell(xml, ref, style, text) {
  const pattern = new RegExp(`<c r="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
  if (!pattern.test(xml)) throw new Error(`La plantilla no tiene la celda ${ref} esperada.`);
  return xml.replace(pattern, `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`);
}

/** Igual que setInlineStringCell pero para un valor numérico. */
function setNumberCell(xml, ref, style, num) {
  const pattern = new RegExp(`<c r="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
  if (!pattern.test(xml)) throw new Error(`La plantilla no tiene la celda ${ref} esperada.`);
  return xml.replace(pattern, `<c r="${ref}" s="${style}"><v>${num}</v></c>`);
}

async function buildMartechExcel({ project, groups, fit }) {
  await ensureJsZip();
  const resp = await fetch(MARTECH_TEMPLATE_URL);
  if (!resp.ok) throw new Error("No se pudo cargar la plantilla de Excel de la empresa.");
  const buf = await resp.arrayBuffer();
  const zip = await window.JSZip.loadAsync(buf);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error("La plantilla de Excel no tiene la hoja esperada.");
  let xml = await sheetFile.async("string");

  xml = setInlineStringCell(xml, "F2", 46, `CLIENTE: ${project.name || ""}`);
  xml = setInlineStringCell(xml, "F3", 46, `PROYECTO: ${project.description || project.name || ""}`);
  xml = setInlineStringCell(xml, "F4", 46, "PEDIDO CLIENTE Nº: —");
  xml = setInlineStringCell(xml, "F5", 46, `FECHA: ${fmtDate(new Date())}`);
  xml = setNumberCell(xml, "D9", 30, fit.year);
  xml = setNumberCell(xml, "D10", 30, fit.startWeek);

  // Un color del ciclo de 10 por sección, por orden de primera aparición
  // entre las tareas ya ordenadas cronológicamente — así todas las
  // tareas de una misma sección comparten color, igual que en el
  // ejemplo de la propia empresa (una fase = un color).
  const sectionColor = new Map();
  function colorFor(label) {
    if (!sectionColor.has(label)) sectionColor.set(label, MARTECH_COLOR_CODES[sectionColor.size % MARTECH_COLOR_CODES.length]);
    return sectionColor.get(label);
  }

  const sorted = [...fit.dated].sort((a, b) => toDate(a.task.startDate || a.task.dueDate) - toDate(b.task.startDate || b.task.dueDate));
  sorted.forEach(({ task: t, sectionLabel }, i) => {
    const row = MARTECH_FIRST_TASK_ROW + i;
    const start = toDate(t.startDate || t.dueDate);
    const end = toDate(t.dueDate || t.startDate);
    const weeks = Math.max(1, Math.round(daysBetween(start, end) / 7) + 1);
    xml = setInlineStringCell(xml, `B${row}`, 18, (t.isMilestone ? "🚩 " : "") + plainTitleText(t.title));
    xml = setNumberCell(xml, `C${row}`, 7, weeks);
    xml = setNumberCell(xml, `D${row}`, 3, isoWeekNumber(start));
    xml = setInlineStringCell(xml, `E${row}`, 3, colorFor(sectionLabel));
  });

  zip.file(sheetPath, xml);
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `${sanitizeFilename(project.name)}-cronograma.xlsx`);
}

/**
 * Punto de entrada único para "Descargar Excel". `project` (opcional) es
 * quien decide si se intenta la plantilla Martech: solo tiene sentido
 * para la línea de tiempo de UN proyecto (groupLabel === "Sección"), la
 * global no trae un único CLIENTE/PROYECTO que poner en la cabecera. Si
 * procede intentarla pero los datos no caben (más de 50 tareas con
 * fecha, más de 40 semanas de rango, o más de un año natural — ver
 * checkMartechTemplateFit), cae sola al genérico avisando por qué, en
 * vez de dejar sin archivo a quien exporta.
 */
export async function exportTimelineToExcel({ groups, title, groupLabel, teamMembers, project }) {
  if (project) {
    const fit = checkMartechTemplateFit(groups);
    if (fit.fits) {
      try {
        await buildMartechExcel({ project, groups, fit });
        return;
      } catch (err) {
        console.error("Plantilla Martech:", err);
        showToast("No se pudo usar la plantilla de la empresa; se genera un Excel genérico en su lugar.");
      }
    } else {
      showToast(`${fit.reason} Se genera un Excel genérico en su lugar.`);
    }
  }
  await buildGenericExcel({ groups, title, groupLabel, teamMembers });
}

// ============================================================================
// PDF — un Gantt visual de verdad (barras de color, no texto), apaisado,
// a escala fija según el rango completo de fechas exportado (no según el
// zoom en pantalla, que solo afecta al ancho de columna del Gantt
// interactivo, algo que no tiene sentido replicar en una página fija).
// Se pagina verticalmente si hay más tareas de las que caben en una
// página, repitiendo el eje de fechas arriba de cada una nueva.
// ============================================================================
export async function exportTimelineToPdf({ groups, title, teamMembers }) {
  await ensureJsPdf();
  const { jsPDF } = window.jspdf;
  const allTasks = groups.flatMap((g) => g.tasks);
  const { min, max } = computeRange(allTasks);
  const totalDays = Math.max(1, daysBetween(min, max) + 1);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 12;
  const LABEL_W = 60;
  const CHART_X = MARGIN + LABEL_W;
  const CHART_W = PAGE_W - MARGIN - CHART_X;
  const AXIS_Y = 28;
  const ROW_H = 6.2;
  let y = AXIS_Y + 6;

  const xForDate = (d) => CHART_X + (daysBetween(min, d) / totalDays) * CHART_W;

  function buildTicks() {
    const ticks = [];
    if (totalDays <= 60) {
      let cursor = new Date(min);
      cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // lunes de esa semana
      while (cursor <= max) {
        ticks.push({ date: new Date(cursor), label: fmtDate(cursor).slice(0, 5) });
        cursor = addDays(cursor, 7);
      }
    } else {
      let cursor = new Date(min.getFullYear(), min.getMonth(), 1);
      const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      while (cursor <= max) {
        ticks.push({ date: new Date(cursor), label: `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}` });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    }
    return ticks;
  }
  const ticks = buildTicks();

  function drawAxis() {
    doc.setDrawColor(210, 213, 216);
    doc.setFontSize(7.5);
    doc.setTextColor(120, 128, 134);
    doc.line(CHART_X, AXIS_Y, PAGE_W - MARGIN, AXIS_Y);
    ticks.forEach((tk) => {
      const x = xForDate(tk.date);
      if (x < CHART_X || x > PAGE_W - MARGIN) return;
      doc.setDrawColor(235, 237, 239);
      doc.line(x, AXIS_Y, x, PAGE_H - MARGIN);
      doc.text(tk.label, x, AXIS_Y - 2);
    });
    const todayX = xForDate(new Date());
    if (todayX >= CHART_X && todayX <= PAGE_W - MARGIN) {
      doc.setDrawColor(255, 88, 74);
      doc.setLineWidth(0.4);
      doc.line(todayX, AXIS_Y, todayX, PAGE_H - MARGIN);
      doc.setLineWidth(0.2);
    }
  }

  function drawPageHeader(isFirstPage) {
    if (isFirstPage) {
      doc.setFontSize(15);
      doc.setTextColor(20, 22, 26);
      doc.setFont("helvetica", "bold");
      doc.text(title, MARGIN, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120, 128, 134);
      doc.text(`${fmtDate(min)} – ${fmtDate(max)} · ${allTasks.length} ${allTasks.length === 1 ? "tarea" : "tareas"} · generado el ${fmtDate(new Date())}`, MARGIN, 20);
    }
    drawAxis();
  }

  function ensureSpace() {
    if (y > PAGE_H - MARGIN - ROW_H) {
      doc.addPage();
      y = AXIS_Y + 6;
      drawPageHeader(false);
    }
  }

  drawPageHeader(true);

  groups.forEach((g) => {
    if (!g.tasks.length) return;
    ensureSpace();
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 64, 68);
    doc.text(g.label, MARGIN, y);
    doc.setFont("helvetica", "normal");
    y += ROW_H;

    g.tasks.forEach((t) => {
      ensureSpace();
      doc.setFontSize(8);
      doc.setTextColor(t.isComplete ? 170 : 30, t.isComplete ? 170 : 32, t.isComplete ? 170 : 36);
      const names = assigneeNames(t, teamMembers).map((n) => initials(n)).join(" ");
      const label = `${t.isMilestone ? "◆ " : ""}${plainTitleText(t.title)}`;
      doc.text(doc.splitTextToSize(label, LABEL_W - (names ? 14 : 2))[0] || "", MARGIN, y + 3.2);
      if (names) {
        doc.setFontSize(6.5);
        doc.setTextColor(150, 156, 160);
        doc.text(names, MARGIN + LABEL_W - 12, y + 3.2);
      }

      if (t.startDate || t.dueDate) {
        const s = t.startDate ? toDate(t.startDate) : toDate(t.dueDate);
        const e = t.dueDate ? toDate(t.dueDate) : toDate(t.startDate);
        const rgb = PRIORITY_RGB[t.priority] || PRIORITY_RGB.media;
        doc.setFillColor(...rgb);
        if (t.isMilestone) {
          const cx = xForDate(e);
          doc.triangle(cx - 1.6, y + 3.2, cx + 1.6, y + 3.2, cx, y + 0.6, "F");
          doc.triangle(cx - 1.6, y + 3.2, cx + 1.6, y + 3.2, cx, y + 5.8, "F");
        } else {
          const x1 = Math.max(CHART_X, xForDate(s));
          const x2 = Math.min(PAGE_W - MARGIN, xForDate(e));
          doc.roundedRect(x1, y + 0.8, Math.max(1.5, x2 - x1), 3, 0.6, 0.6, "F");
        }
      }
      y += ROW_H;
    });
  });

  doc.save(`${sanitizeFilename(title)}.pdf`);
}
