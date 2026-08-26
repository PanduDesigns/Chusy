// ============================================================================
// Utilidades compartidas por toda la app.
// ============================================================================

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Convierte un Timestamp de Firestore, Date o string ISO a Date. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // "YYYY-MM-DD" (lo que da un <input type="date">) se trata como fecha
    // LOCAL a propósito. Si se dejara que new Date(string) lo interprete
    // como UTC, el cálculo de "vencida" se desplazaría según la zona
    // horaria de quien lo mire.
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Formato corto para tarjetas/listas: "8 jul". */
export function formatDate(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** Formato largo: "8 de julio de 2026". */
export function formatDateLong(value) {
  const d = toDate(value);
  if (!d) return "";
  const mesesLargos = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${d.getDate()} de ${mesesLargos[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Para inputs type="date": "2026-07-08". */
export function toDateInputValue(value) {
  const d = toDate(value);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isOverdue(value, isComplete) {
  if (!value || isComplete) return false;
  const d = toDate(value);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Días completos entre dos fechas (b - a), ignorando la hora. */
export function daysBetween(a, b) {
  const MS_DAY = 24 * 60 * 60 * 1000;
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / MS_DAY);
}

/** Número de semana ISO 8601 (semanas de lunes a domingo, semana 1 = la que contiene el primer jueves del año). */
export function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // lunes=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esta semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
}

/** Lunes de la semana que contiene `date`. */
export function mondayOf(date) {
  const day = (date.getDay() + 6) % 7;
  return addDays(date, -day);
}

/** Iniciales para avatares: "Ramón Panduro" -> "RP". */
export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = ["#FCD000", "#6BB0B0", "#D98F55", "#8FBF98", "#9FA6D9", "#D98BA0", "#7FAFC4", "#C9A876"];

/** Color determinista a partir de un string (uid o nombre), para avatares. */
export function colorFromString(str) {
  if (!str) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

/** Negro o blanco, el que mejor contraste dé sobre `bgHex` (para etiquetas de color). */
export function textColorFor(bgHex) {
  const hex = (bgHex || "").replace("#", "");
  if (hex.length !== 6) return "#0B0D0E";
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.42 ? "#0B0D0E" : "#F5F6F6";
}

/** Icono de un proyecto: si todavía no tiene uno elegido, uno neutro por defecto. */
export function projectIcon(project) {
  return (project && project.icon) || "📁";
}

/** "rgba(...)" a partir de un color hex, para sombrear el fondo de un icono según su color. */
export function hexToRgba(hex, alpha) {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return `rgba(139,149,156,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Insignia icono+color (fondo sombreado del color, icono encima). sizeClass: "", "project-badge--sm" o "project-badge--lg". */
export function badgeHtml(icon, color, sizeClass = "") {
  const bg = hexToRgba(color || "#8B959C", 0.2);
  const ring = hexToRgba(color || "#8B959C", 0.6);
  return `<span class="project-badge${sizeClass ? " " + sizeClass : ""}" style="background:${bg};box-shadow:inset 0 0 0 1px ${ring};">${escapeHtml(icon || "📁")}</span>`;
}

/** Insignia icono+color de un proyecto (sustituye al punto de color plano). */
export function projectBadgeHtml(project, sizeClass = "") {
  return badgeHtml(projectIcon(project), project && project.color, sizeClass);
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baja: 3 };
export function sortByPriority(a, b) {
  return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
}

export const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };

/** Toast de notificación en la esquina inferior derecha. */
export function showToast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " toast--error" : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

export function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

/**
 * Sustituye el contenido de `container` por `html` conservando la posición
 * de scroll de su `.list-table-scroll` (Lista y Mis tareas). Sin esto, cada
 * vez que se reconstruye la tabla —al completar una tarea, marcar/quitar de
 * la selección múltiple, o cualquier actualización en tiempo real de
 * Firestore, propia o de otra persona— ese div se crea de cero y el scroll
 * vuelve arriba del todo, aunque estuvieras trabajando más abajo: un nodo
 * nuevo no tiene el historial de scroll del que sustituye, aunque ocupe su
 * mismo sitio. `container` en sí (`.main-content`) nunca se recrea —solo
 * se le reasigna el innerHTML—, así que esto NO hace falta en las vistas
 * que scrollean sobre `.main-content` directamente (Tablero, Calendario,
 * Línea de tiempo, Archivo): ahí el scroll ya sobrevive solo.
 */
export function setListHtml(container, html) {
  const old = container.querySelector(".list-table-scroll");
  const scrollTop = old ? old.scrollTop : 0;
  const scrollLeft = old ? old.scrollLeft : 0;
  container.innerHTML = html;
  const fresh = container.querySelector(".list-table-scroll");
  if (fresh) { fresh.scrollTop = scrollTop; fresh.scrollLeft = scrollLeft; }
}

// ============================================================================
// HTML del editor de descripción enriquecido (rich-text-editor.js). Van
// aquí, junto a escapeHtml, porque son las mismas herramientas: convertir
// texto a HTML seguro y viceversa.
// ============================================================================

const RTE_ALLOWED_TAGS = new Set([
  "P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "A",
  "H1", "H2", "H3", "DIV", "SPAN",
]);
const RTE_ALLOWED_ATTRS = { A: ["href", "target", "rel"] };

/**
 * Limpia HTML de todo lo que no sea una etiqueta/atributo permitido
 * (nada de script, style, iframe, atributos on*, links javascript:…).
 * Se usa SIEMPRE antes de guardar una descripción en Firestore — el
 * campo lo puede editar cualquiera del equipo, así que no basta con
 * confiar en que el editor de turno solo genere HTML "bueno".
 */
export function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  (function walk(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!RTE_ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent));
          return;
        }
        const allowedAttrs = RTE_ALLOWED_ATTRS[child.tagName] || [];
        [...child.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          if (!allowedAttrs.includes(name) || /^\s*javascript:/i.test(attr.value)) {
            child.removeAttribute(attr.name);
          }
        });
        if (child.tagName === "A") {
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener");
        }
        walk(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove(); // comentarios y demás
      }
    });
  })(template.content);
  return template.innerHTML;
}

/**
 * Convierte texto plano (descripciones de antes de tener editor
 * enriquecido, o importadas de Asana) en HTML seguro, respetando líneas
 * en blanco como párrafos separados. Si el texto ya parece HTML del
 * editor (trae alguna etiqueta de bloque reconocible), se deja pasar tal
 * cual — ya saneado — para no escapar dos veces una descripción que ya
 * se guardó con el editor nuevo.
 */
export function toEditableHtml(text) {
  if (!text) return "";
  if (/<(p|ul|ol|li|blockquote|pre|h[1-3]|div|br)[\s/>]/i.test(text)) {
    return sanitizeHtml(text);
  }
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
