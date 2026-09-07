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
//  - Plantilla Martech (assets/gantt-template-martech.xlsm): reproduce el
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
const MARTECH_TEMPLATE_URL = "assets/gantt-template-martech.xlsm";

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
// Filas de tarea que la plantilla YA trae listas (estilo + formato
// condicional): 13-23, 25 y 27-33 — se saltan la 24 ("OBSERVACIONES") y
// la 26 (hueco fijo). A partir de la tarea 20ª, buildMartechExcel clona
// filas nuevas — ver el bloque de comentarios de más abajo.
const MARTECH_EXCLUDED_ROWS = new Set([24, 26]);
const MARTECH_NATIVE_SLOTS = 19;
const MARTECH_LAST_NATIVE_ROW = 33; // última fila que YA existe como <row> en el XML de la plantilla
const MARTECH_CF_LAST_NATIVE_ROW = 34; // hasta aquí ya cubren el formato condicional/validación sin tocar sus rangos
const MARTECH_CLONE_SOURCE_ROW = 27; // fila que se clona para las tareas que no caben en las nativas
const MARTECH_MAX_TASKS = 50; // techo razonable — no es un límite físico de la plantilla, ver buildMartechExcel
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
// condicional que colorea las barras), se parte del .xlsm real de la
// empresa (bundled en assets/, el propio CRONOGRAMA.xlsm vaciado de sus
// datos de ejemplo) y se le inyectan los valores directamente en el XML
// de la hoja, celda a celda — dejando TODO lo demás intacto (estilos,
// formato condicional, validaciones, botones, macros, logo, fórmulas de
// fecha) para que sea Excel quien pinte las barras al abrir el archivo,
// con la MISMA lógica de siempre, no algo que haya que recalcular aquí.
//
// Cómo rellena la plantilla la empresa (así se explicó y así funciona
// CRONOGRAMA.xlsm, el ejemplo real que sirvió de referencia): D9 = año,
// D10 = semana de inicio del cronograma; y por cada tarea, a partir de
// la fila 13, columna B = nombre, C = duración en semanas, D = semana
// de inicio de ESA tarea, y E = un código de color exacto de una lista
// cerrada de 10 (tiene que decir "1-Verde", "2-AzulClaro"... LETRA POR
// LETRA, o esa fila no se colorea). El propio Excel, con su formato
// condicional, es quien lee C/D/E de cada fila y pinta las semanas
// correspondientes — este código NUNCA pinta una celda de semana
// directamente, solo rellena esas 4 columnas de entrada.
//
// LA PLANTILLA ANTERIOR (la que traía este mismo archivo hasta ahora)
// se generó con openpyxl SIN keep_vba=True para "ampliarla" a 50 filas
// de tarea — y openpyxl, sin ese parámetro, descarta las macros y los
// botones EN SILENCIO (sin ningún error), y además el CF de esa copia
// se quedó solo con las 2 reglas de bandeado, perdiendo por el camino
// las 10 reglas que pintan cada color. Resultado: ninguna tarea se
// coloreaba jamás, fuera cual fuera el color elegido, y el archivo
// tampoco traía ya los botones ni las macros de "Preparar para envío" /
// "Modo edición". Encima, esa plantilla tenía HORNEADAS de fábrica las
// 10 primeras filas con las tareas de ejemplo del cliente real de
// CRONOGRAMA.xlsm: si un proyecto exportado tenía menos de 10 tareas,
// las filas sobrantes se quedaban con el texto de ese cliente en vez de
// vaciarse.
//
// LA PLANTILLA NUEVA (gantt-template-martech.xlsm) se generó vaciando
// CRONOGRAMA.xlsm celda a celda por su XML directamente — SIN pasar por
// ninguna librería de Excel — así se garantiza que las 10 reglas de
// color, las 2 de bandeado, las validaciones, el logo y los botones (con
// sus macros intactas, verificado byte a byte contra el vbaProject.bin
// original) llegan exactamente iguales que en el archivo real. También
// se añadió fullCalcOnLoad="1" al libro (no lo traía) para que Excel
// recalcule la cabecera de fechas al abrir el archivo — si no, con
// calculo automático pero SIN ese flag, Excel confía en el valor de
// fórmula que quedó cacheado en el XML (el del último cálculo real en
// Excel) en vez de recalcularlo con el D9/D10 que acabamos de escribir.
//
// FILAS: la plantilla trae de fábrica sitio para 19 tareas ya
// formateadas y con su formato condicional listo (filas 13-23, 25 y
// 27-33 — MARTECH_NATIVE_SLOTS; se saltan la 24, que es la fila
// "OBSERVACIONES", y la 26, que es un hueco fijo de la plantilla). Si
// hacen falta más de 19 (hasta MARTECH_MAX_TASKS), este código clona la
// fila 27 tal cual para cada fila nueva y extiende el formato
// condicional, la validación de la columna E, el `dimension` y el área
// de impresión hasta la última fila que se use — así no hace falta
// tocar el Excel a mano cada vez que un cronograma tenga más tareas de
// las que trae la plantilla en blanco.
//
// COLUMNAS: el formato condicional de fecha en la cabecera SÍ sigue
// limitado a 40 semanas (columnas F..AS, de ahí MARTECH_MAX_WEEKS) —
// ampliarlo significaría reescribir a mano la cadena de fórmulas de
// fecha de la cabecera, algo que no se ha hecho (ver la limitación
// correspondiente en el apartado 7 del README).
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

/** Número de columna (1 = A) -> letra de columna ("F", "AS", "BH"...). */
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Recalcula a mano el valor de las fórmulas de la cabecera (filas 6/7/11/12,
 * columnas F..AS) para un año/semana concretos — replicando EXACTAMENTE las
 * fórmulas de la plantilla, no algo aproximado. Hace falta porque, aunque la
 * plantilla lleva fullCalcOnLoad="1", no todos los programas que puedan
 * abrir el archivo recalculan solos al abrirlo (comprobado con la
 * conversión en línea de comandos de LibreOffice: sin esto, se ve la
 * cabecera con el año/semana de ejemplo con la que se generó la plantilla,
 * no con el que se acaba de escribir en D9/D10).
 */
function computeMartechHeaderValues(year, startWeek) {
  const weeks = [];
  for (let i = 0; i < MARTECH_MAX_WEEKS; i++) {
    weeks.push(i === 0 ? startWeek : (weeks[i - 1] >= 53 ? 1 : weeks[i - 1] + 1));
  }
  // DATE($D$9,1,4) - WEEKDAY(DATE($D$9,1,4),2) + 4 = jueves de la semana ISO 1.
  const jan4 = new Date(year, 0, 4);
  const weekday2 = ((jan4.getDay() + 6) % 7) + 1; // 1=lunes .. 7=domingo, como WEEKDAY(...,2)
  const months = [];
  for (let i = 0; i < MARTECH_MAX_WEEKS; i++) {
    const d = new Date(year, 0, 4 - weekday2 + 4 + (startWeek - 1) * 7 + i * 7);
    months.push(d.getMonth() + 1);
  }
  const NOMBRES_MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const monthLabels = months.map((m, i) => (i === 0 || m !== months[i - 1] ? NOMBRES_MES[m - 1] : ""));
  return { weeks, months, monthLabels };
}

/** Dentro de la celda `ref` (que ya tiene una fórmula `<f>`), sustituye SOLO su valor cacheado `<v>`, sin tocar la fórmula ni el estilo. */
function setFormulaCachedValue(xml, ref, value) {
  const cellPattern = new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>`);
  const m = xml.match(cellPattern);
  if (!m) throw new Error(`La plantilla no tiene la fórmula ${ref} esperada.`);
  const fMatch = m[2].match(/<f[^>]*(?:\/>|>[\s\S]*?<\/f>)/);
  if (!fMatch) throw new Error(`La celda ${ref} no tiene fórmula.`);
  const valueXml = `<v>${typeof value === "number" ? value : escapeXmlText(value)}</v>`;
  // OJO: el reemplazo va en una función, NUNCA en un string — las fórmulas
  // originales de esta plantilla contienen "$D$9"/"$D$10" tal cual, y con
  // un string de reemplazo, String.replace() interpreta "$1", "$9"... como
  // referencias a grupos capturados (aquí, el propio estilo de la celda),
  // dejando la fórmula corrompida en vez de intacta.
  return xml.replace(cellPattern, () => `<c r="${ref}"${m[1]}>${fMatch[0]}${valueXml}</c>`);
}

/** Índice de tarea (0-based) -> número de fila real en la hoja, saltando las filas reservadas (ver MARTECH_EXCLUDED_ROWS). */
function martechRowForIndex(i) {
  let row = MARTECH_FIRST_TASK_ROW - 1;
  let count = -1;
  while (count < i) {
    row += 1;
    if (!MARTECH_EXCLUDED_ROWS.has(row)) count += 1;
  }
  return row;
}

function escapeXmlText(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sustituye el VALOR de la celda `ref` por texto, conservando tal cual el
 * estilo `s` que ya tenga en la plantilla. El reemplazo va en una función
 * (no un string) por si el propio texto trajera un "$" — un título de
 * tarea como "Revisión $2.400" corrompería la celda igual que le pasaba a
 * setFormulaCachedValue si se pasara como string (ver su comentario).
 */
function setInlineStringCell(xml, ref, text) {
  const pattern = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(pattern);
  if (!m) throw new Error(`La plantilla no tiene la celda ${ref} esperada.`);
  const styleMatch = m[1].match(/\bs="(\d+)"/);
  const style = styleMatch ? ` s="${styleMatch[1]}"` : "";
  return xml.replace(pattern, () => `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`);
}

/** Igual que setInlineStringCell pero con un valor numérico. */
function setNumberCell(xml, ref, num) {
  const pattern = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(pattern);
  if (!m) throw new Error(`La plantilla no tiene la celda ${ref} esperada.`);
  const styleMatch = m[1].match(/\bs="(\d+)"/);
  const style = styleMatch ? ` s="${styleMatch[1]}"` : "";
  return xml.replace(pattern, () => `<c r="${ref}"${style}><v>${num}</v></c>`);
}

/** Deja la celda `ref` vacía, conservando su estilo — para las filas de tarea que no se usan en este export. */
function clearCell(xml, ref) {
  const pattern = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(pattern);
  if (!m) throw new Error(`La plantilla no tiene la celda ${ref} esperada.`);
  const styleMatch = m[1].match(/\bs="(\d+)"/);
  const style = styleMatch ? ` s="${styleMatch[1]}"` : "";
  return xml.replace(pattern, () => `<c r="${ref}"${style}/>`);
}

/** Añade la fila `rowNum` (clonando blankRowTemplate) si todavía no existe en la hoja. */
function ensureMartechRow(xml, rowNum, blankRowTemplate) {
  if (xml.includes(`<row r="${rowNum}" `)) return xml; // ya está (de la plantilla o de una vuelta anterior de este mismo bucle)
  const clone = blankRowTemplate.replace(/27/g, String(rowNum));
  return xml.replace("</sheetData>", () => `${clone}</sheetData>`);
}

/** Extiende el formato condicional, la validación de E y el `dimension` de la hoja hasta `finalRow`, si hace falta. */
function extendMartechSheetRanges(xml, finalRow) {
  if (finalRow <= MARTECH_CF_LAST_NATIVE_ROW) return xml;
  xml = xml.replace('sqref="F13:AS23 F25:AS25 F27:AS34"', () => `sqref="F13:AS23 F25:AS25 F27:AS${finalRow}"`);
  xml = xml.replace('sqref="E27:E34 E13:E25"', () => `sqref="E27:E${finalRow} E13:E25"`);
  xml = xml.replace(/<dimension ref="B1:BH\d+"\/>/, () => `<dimension ref="B1:BH${finalRow}"/>`);
  return xml;
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

  // Fila "en blanco" de referencia para clonar si hicieran falta más de
  // MARTECH_NATIVE_SLOTS tareas — se captura ANTES de escribir ningún
  // dato, para no arrastrar nunca texto de una tarea real en el clon.
  const cloneMatch = xml.match(new RegExp(`<row r="${MARTECH_CLONE_SOURCE_ROW}"[^>]*>[\\s\\S]*?</row>`));
  if (!cloneMatch) throw new Error("La plantilla no tiene la fila de referencia esperada.");
  const blankRowTemplate = cloneMatch[0];

  xml = setInlineStringCell(xml, "F2", `CLIENTE: ${project.name || ""}`);
  xml = setInlineStringCell(xml, "F3", `PROYECTO: ${project.description || project.name || ""}`);
  xml = setInlineStringCell(xml, "F4", "PEDIDO CLIENTE Nº: —");
  xml = setInlineStringCell(xml, "F5", `FECHA: ${fmtDate(new Date())}`);
  xml = setNumberCell(xml, "D9", fit.year);
  xml = setNumberCell(xml, "D10", fit.startWeek);
  xml = setInlineStringCell(xml, "F10", `AÑO ${fit.year}`); // la plantilla lo trae como texto fijo (no como fórmula), hay que sincronizarlo a mano con D9

  // Ver el comentario de computeMartechHeaderValues: se deja recalculada a
  // mano la cabecera (semanas/meses) para no depender de que el programa
  // que abra el archivo recalcule solo las fórmulas.
  const header = computeMartechHeaderValues(fit.year, fit.startWeek);
  for (let i = 0; i < MARTECH_MAX_WEEKS; i++) {
    const col = colLetter(6 + i);
    xml = setFormulaCachedValue(xml, `${col}6`, header.weeks[i]);
    xml = setFormulaCachedValue(xml, `${col}7`, header.months[i]);
    xml = setFormulaCachedValue(xml, `${col}11`, header.monthLabels[i]);
    xml = setFormulaCachedValue(xml, `${col}12`, header.weeks[i]);
  }

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

  // Si hacen falta más de las MARTECH_NATIVE_SLOTS filas nativas, se
  // crean las que falten y se extienden los rangos de una sola vez,
  // ANTES de escribir ninguna tarea.
  const lastRowNeeded = martechRowForIndex(sorted.length - 1);
  if (lastRowNeeded > MARTECH_LAST_NATIVE_ROW) {
    for (let r = MARTECH_LAST_NATIVE_ROW + 1; r <= lastRowNeeded; r++) {
      xml = ensureMartechRow(xml, r, blankRowTemplate);
    }
    xml = extendMartechSheetRanges(xml, lastRowNeeded);
  }

  // Se recorren TODAS las filas nativas (no solo las que hagan falta): la
  // que no se usa para ninguna tarea de este export se deja en blanco a
  // propósito, para que no se cuele nunca ningún resto de un export
  // anterior ni del ejemplo original de la plantilla.
  const totalSlotsToWrite = Math.max(MARTECH_NATIVE_SLOTS, sorted.length);
  for (let i = 0; i < totalSlotsToWrite; i++) {
    const row = martechRowForIndex(i);
    if (i < sorted.length) {
      const { task: t, sectionLabel } = sorted[i];
      const start = toDate(t.startDate || t.dueDate);
      const end = toDate(t.dueDate || t.startDate);
      const weeks = Math.max(1, Math.round(daysBetween(start, end) / 7) + 1);
      xml = setInlineStringCell(xml, `B${row}`, (t.isMilestone ? "🚩 " : "") + plainTitleText(t.title));
      xml = setNumberCell(xml, `C${row}`, weeks);
      xml = setNumberCell(xml, `D${row}`, isoWeekNumber(start));
      xml = setInlineStringCell(xml, `E${row}`, colorFor(sectionLabel));
    } else {
      xml = clearCell(xml, `B${row}`);
      xml = clearCell(xml, `C${row}`);
      xml = clearCell(xml, `D${row}`);
      xml = clearCell(xml, `E${row}`);
    }
  }

  zip.file(sheetPath, xml);

  // El área de impresión de la plantilla original solo llega a la fila
  // 29 (la propia empresa la recorta ahí) — si se ha escrito más abajo,
  // se extiende para que no se quede ninguna tarea fuera al imprimir.
  if (lastRowNeeded > 29) {
    const workbookPath = "xl/workbook.xml";
    let workbookXml = await zip.file(workbookPath).async("string");
    workbookXml = workbookXml.replace("Cronograma_Martech!$B$1:$AS$29", () => `Cronograma_Martech!$B$1:$AS$${lastRowNeeded}`);
    zip.file(workbookPath, workbookXml);
  }

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12" });
  triggerDownload(blob, `${sanitizeFilename(project.name)}-cronograma.xlsm`);
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
