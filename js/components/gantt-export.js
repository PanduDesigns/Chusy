// ============================================================================
// Exportar la línea de tiempo (Gantt) a Excel o PDF — mismo botón en
// cualquier panel de línea de tiempo, sea de un proyecto (agrupada por
// sección) o global (agrupada por proyecto), porque los dos usan
// renderTimelineView() con la misma forma de `groups`. Exporta
// EXACTAMENTE lo que hay en pantalla en ese momento: los `groups` que
// recibe ya vienen filtrados/ordenados por quien llama (el mismo dato que
// se está pintando en el propio Gantt, no una consulta aparte a Firestore).
//
// Las dos librerías (SheetJS para el .xlsx, jsPDF para el .pdf) se cargan
// solas desde un CDN la primera vez que hace falta cada una — no en cada
// carga de la app, para no sumarle a quien nunca exporta nada los ~1,3 MB
// de las dos juntas.
// ============================================================================
import { toDate, addDays, daysBetween, initials } from "../utils.js";

const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

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

const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
const PRIORITY_RGB = {
  urgente: [255, 92, 108],
  alta: [255, 88, 74],
  media: [120, 132, 140],
  baja: [170, 178, 184],
};

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

// ============================================================================
// Excel — una fila por tarea, agrupadas por sección/proyecto (repetido en
// cada fila, no como filas separadoras: así se puede ordenar o filtrar la
// hoja en Excel sin romper la agrupación). La columna "Cronograma" es una
// barra de caracteres Unicode a escala del rango completo exportado — sin
// depender de ningún color de celda (poco fiable en la versión gratuita
// de SheetJS, la que se puede cargar desde un CDN sin licencia): funciona
// igual se abra donde se abra.
// ============================================================================
export async function exportTimelineToExcel({ groups, title, groupLabel, teamMembers }) {
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
        (t.isMilestone ? "🚩 " : "") + t.title,
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
      const label = `${t.isMilestone ? "◆ " : ""}${t.title}`;
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
