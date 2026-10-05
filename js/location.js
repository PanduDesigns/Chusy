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
