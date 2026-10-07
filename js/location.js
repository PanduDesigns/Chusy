// ============================================================================
// Abrir la ubicación (v60): helpers PUROS (sin DOM ni Firebase) para el botón
// «Abrir Ubicación» de la ficha de una oferta, de las Propiedades de un
// proyecto y de la barra superior de un proyecto.
//
// Un navegador no puede abrir una carpeta del ordenador por sí solo (una
// página web no tiene permiso para ordenarle nada al Explorador de
// archivos), así que el botón trabaja en dos pasos — ver
// components/open-location.js:
//   1. SIEMPRE copia la ruta al portapapeles (para pegarla en el Explorador).
//   2. En Windows intenta además abrirla con el «ayudante» opcional
//      (assets/abrir-ubicacion/), un programita que se instala una vez en
//      cada ordenador y que registra el protocolo `chusy-open:`.
//
// Aquí solo vive lo que no necesita navegador: reconocer qué hay escrito en
// el campo (vacío, una dirección web o una ruta de carpeta), limpiarlo y
// construir el enlace que entiende el ayudante.
// ============================================================================

/** Protocolo que registra el ayudante de Windows (assets/abrir-ubicacion/Instalar-AbrirUbicacion.bat). */
export const LOCATION_PROTOCOL = "chusy-open";

/** Icono y texto del botón — los mismos en todos los sitios donde aparece (la barra superior los pinta por separado para poder dejar solo el icono si falta sitio). */
export const OPEN_LOCATION_ICON = "📂";
export const OPEN_LOCATION_TEXT = "Abrir Ubicación";
export const OPEN_LOCATION_LABEL = `${OPEN_LOCATION_ICON} ${OPEN_LOCATION_TEXT}`;

/** Pares de comillas que se quitan si envuelven TODO el texto (el Explorador de Windows las pone al «Copiar como ruta de acceso»). */
const QUOTE_PAIRS = [['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"]];

function stripWrappingQuotes(text) {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) return text.slice(1, -1).trim();
  }
  return text;
}

function safeDecode(text) {
  try { return decodeURIComponent(text); } catch { return text; }
}

/**
 * Un enlace `file:` convertido a la ruta que se escribiría en el Explorador:
 *   file:///C:/Proyectos/Cliente%20A  →  C:\Proyectos\Cliente A
 *   file://servidor/recurso/carpeta   →  \\servidor\recurso\carpeta
 * Cualquier otra forma (file:///home/x) se deja como ruta con barras normales.
 */
function fileUrlToPath(text) {
  const m = text.match(/^file:(?:\/\/([^/]*))?(\/.*)?$/i);
  if (!m) return text;
  const host = m[1] || "";
  const rest = safeDecode(m[2] || "");
  if (host && host.toLowerCase() !== "localhost") return `\\\\${host}${rest.replace(/\//g, "\\")}`;
  if (/^\/[A-Za-z]:/.test(rest)) return rest.slice(1).replace(/\//g, "\\");
  return rest;
}

/**
 * Qué hay escrito en un campo Ubicación:
 *   { kind: "empty",  value: "" }                    — nada (o solo espacios)
 *   { kind: "web",    value: "https://…" }            — una dirección web (SharePoint, OneDrive…): se abre en una pestaña nueva
 *   { kind: "folder", value: "\\\\servidor\\carpeta" } — una ruta de carpeta: se copia y se intenta abrir con el ayudante
 * Quita espacios y las comillas que envuelven todo el texto, y convierte un
 * enlace `file:` en su ruta. No comprueba que la carpeta exista (una página
 * web no puede): eso lo hace el ayudante al abrirla.
 */
export function normalizeLocation(raw) {
  let text = stripWrappingQuotes(String(raw ?? "").trim());
  if (!text) return { kind: "empty", value: "" };

  if (/^https?:\/\//i.test(text)) {
    try { return { kind: "web", value: new URL(text).href }; } catch { /* no es una dirección válida: se trata como ruta */ }
  }
  if (/^file:/i.test(text)) text = fileUrlToPath(text);
  return { kind: "folder", value: text };
}

/** ¿Hay algo que abrir? (para habilitar/deshabilitar el botón) */
export function hasLocation(raw) {
  return normalizeLocation(raw).kind !== "empty";
}

/**
 * La Ubicación de un proyecto (la de sus Propiedades, v57) tal como se
 * escribió, o "" si no tiene (proyecto sin Propiedades, o con ese campo
 * vacío). Lo usan los menús de clic derecho (v61) para decidir si ofrecen
 * «Abrir Ubicación».
 */
export function projectLocation(project) {
  const value = project && project.properties ? project.properties.ubicacion : "";
  return typeof value === "string" ? value : "";
}

/**
 * El enlace que entiende el ayudante de Windows: `chusy-open:` + la ruta
 * codificada (sin `//`, para que ningún navegador le añada barras). El
 * ayudante lo decodifica y solo abre la ruta si es una CARPETA que existe.
 */
export function protocolUrl(path) {
  return `${LOCATION_PROTOCOL}:${encodeURIComponent(path)}`;
}

// ----------------------------------------------------------------------------
// v65: buscar la Ubicación en la descripción de una tarea
// ----------------------------------------------------------------------------
// Quien pasa una tarea a oferta suele haber escrito ya la carpeta en su
// descripción. Al convertirla (components/convert-to-offers.js) se aprovecha
// como Ubicación de la oferta: aquí vive solo la búsqueda, sin DOM.

const HTML_ENTITIES = { nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/**
 * El texto plano de una descripción (el HTML del editor, o texto plano en
 * las tareas antiguas), con un salto de línea por cada bloque y cada <br>.
 * Sin DOM a propósito: este archivo es puro. Las entidades se decodifican de
 * una sola pasada, así que `&amp;lt;` queda como `&lt;` y no como `<`.
 */
function descriptionToText(description) {
  let text = String(description ?? "");
  if (/<\/?[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]*>/g, "");
  }
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const known = HTML_ENTITIES[name.toLowerCase()];
    return known === undefined ? whole : known;
  });
}

/** Comillas de apertura y su pareja de cierre (el Explorador de Windows pone comillas rectas al «Copiar como ruta de acceso»). */
const OPENING_QUOTES = { '"': '"', "'": "'", "“": "”", "‘": "’", "«": "»" };

/** Una ruta con forma de ruta: `Z:\algo`, `Z:/algo` o `\\servidor\recurso`. */
const LOOKS_LIKE_PATH = /^(?:[A-Za-z]:[\\/][^\\/]|\\\\[^\\/\s]+[\\/][^\\/])/;

function countOf(text, char) { return text.split(char).length - 1; }

/** Quita el final que no es de la ruta: espacios y puntuación (una carpeta de Windows no acaba en punto), y un paréntesis o corchete de cierre sin su pareja. */
function trimPathEnd(path) {
  let p = path.replace(/[\s.,;:]+$/, "");
  for (;;) {
    const last = p[p.length - 1];
    const open = last === ")" ? "(" : last === "]" ? "[" : null;
    if (!open || countOf(p, last) <= countOf(p, open)) return p;
    p = p.slice(0, -1).replace(/[\s.,;:]+$/, "");
  }
}

/**
 * La ruta que empieza en `start` dentro de `line` (`prev` es el carácter
 * justo antes), o "" si lo que hay no es una ruta de carpeta. Entre comillas
 * llega hasta la de cierre; si no, hasta el final de la línea (una ruta puede
 * llevar espacios, así que no se puede cortar en el primero) o hasta un
 * carácter que una ruta de Windows no admite.
 */
function pathFromLine(line, start, prev) {
  let rest = line.slice(start);
  const closing = OPENING_QUOTES[prev];
  if (closing) {
    const end = rest.indexOf(closing);
    if (end !== -1) rest = rest.slice(0, end);
  } else if (/^file:/i.test(rest)) {
    rest = rest.split(/\s/)[0]; // un enlace file: no lleva espacios (van como %20)
  }
  rest = trimPathEnd(rest.split(/["|?*<>“”«»]/)[0].trim());
  const { kind, value } = normalizeLocation(rest);
  return kind === "folder" && LOOKS_LIKE_PATH.test(value) ? value : "";
}

/**
 * La primera ruta de carpeta escrita en una descripción, o "" si no hay.
 * Reconoce una ruta con letra de unidad (`Z:\Ofertas\Cliente X`), de red
 * (`\\servidor\recurso\carpeta`) o un enlace `file:///…`, con o sin un
 * rótulo delante («Ubicación: …»), con o sin comillas, y sin puntuación
 * final. La devuelve ya limpia, como la guardaría normalizeLocation. NO
 * reconoce direcciones web (https://…): una descripción puede llevar
 * cualquier enlace y no todos son la carpeta de la oferta.
 *
 * Una ruta solo cuenta si empieza al principio de la línea o tras un espacio,
 * comilla o paréntesis, para no confundir con un fragmento de otra cosa
 * (`https://…` contiene `s:/`).
 */
export function findLocationInDescription(description) {
  const text = descriptionToText(description);
  for (const line of text.split(/\r\n|\n|\r/)) {
    const starts = /[A-Za-z]:[\\/]|\\\\|file:\/\//gi;
    let m;
    while ((m = starts.exec(line))) {
      const prev = m.index > 0 ? line[m.index - 1] : "";
      if (prev && !/[\s"'“‘«(\[]/.test(prev)) continue;
      const found = pathFromLine(line, m.index, prev);
      if (found) return found;
    }
  }
  return "";
}
