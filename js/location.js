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

import { codedName, hasCodePrefix } from "./project-codes.js";

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

// ---------------------------------------------------------------------------
// v75 · El ID en la carpeta local. Chusy no construye rutas locales (no conoce la unidad ni el servidor de
// cada ordenador: la Ubicación es el texto que escribe la persona, o el que pone la macro de Outlook), pero sí
// puede decir CÓMO se llamaría la carpeta —con el mismo formato `YYXXX - Nombre` que la carpeta de Drive, y
// con el mismo helper (codedName en project-codes.js)— y avisar si la que se ha escrito no lleva el ID.
// ---------------------------------------------------------------------------

/** El nombre de la carpeta local de un ID: `YYXXX - Nombre`, sin los caracteres que Windows no admite en un nombre de carpeta ni puntos/espacios finales. */
export function localFolderName(code, name) {
  return codedName(code, name).replace(/[\\/:*?"<>|]/g, "_").replace(/[. ]+$/, "").trim();
}

/** El último tramo de una ruta de carpeta (`\\srv\Ofertas\26001 - Cabina` → `26001 - Cabina`); "" si no hay carpeta (vacío o dirección web). */
export function locationFolderName(raw) {
  const location = normalizeLocation(raw);
  if (location.kind !== "folder") return "";
  const parts = location.value.split(/[\\/]+/).filter((part) => part.trim());
  return parts.length ? parts[parts.length - 1].trim() : "";
}

/**
 * ¿La carpeta escrita en la Ubicación lleva el ID por delante? Verdadero también cuando no hay nada que
 * comprobar (sin ID todavía, campo vacío, o una dirección web: SharePoint y OneDrive no tienen por qué
 * llamar a la carpeta así). Falso solo si hay una carpeta local y su último tramo no empieza por el ID.
 */
export function locationHasCode(raw, code) {
  const folder = locationFolderName(raw);
  if (!folder || !String(code ?? "").trim()) return true;
  return hasCodePrefix(folder, code);
}

// ---------------------------------------------------------------------------
// v81 · Ruta raíz recordada y carpeta sugerida. Chusy sigue sin conocer la unidad ni el servidor de cada
// ordenador, pero lo recuerda EN ESTE NAVEGADOR: la «ruta raíz de proyectos/ofertas» (p. ej. `Z:\Proyectos` o
// `\\Servidor\Compartido\Ofertas`) que la persona escribe una vez, o la carpeta PADRE de la última ubicación
// que usó. Con ella, a un proyecto u oferta con ID y nombre pero sin Ubicación se le ofrece la carpeta
// `RutaRaíz\YYXXX - Nombre` con un clic, sin teclear ni copiar nada desde el Explorador.
// Todo lo de aquí es puro salvo leer/escribir `storage` (localStorage por defecto, siempre con try/catch).
// ---------------------------------------------------------------------------

/** Ruta raíz escrita a mano (manda sobre la deducida). */
export const LOCATION_ROOT_KEY = "chusy_location_root";
/** Ruta raíz deducida de la última carpeta padre usada. */
export const LOCATION_ROOT_AUTO_KEY = "chusy_location_root_auto";

/** Quita las barras finales de una ruta, salvo la raíz de una unidad (`Z:\` se queda). */
function trimTrailingSeparators(path) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

/** ¿Tiene forma de ruta absoluta de Windows? (`Z:\algo`, `Z:/algo`, `Z:\`, `\\servidor\recurso`) */
function isAbsolutePath(path) {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/])/.test(path);
}

/**
 * Una ruta raíz limpia (sin comillas ni barras finales), o "" si lo escrito no es una ruta de carpeta
 * absoluta (una dirección web, una ruta relativa o texto cualquiera no sirven de raíz).
 */
export function normalizeRoot(raw) {
  const { kind, value } = normalizeLocation(raw);
  if (kind !== "folder" || !isAbsolutePath(value)) return "";
  return trimTrailingSeparators(value);
}

/**
 * La carpeta que contiene a la de una Ubicación (`Z:\Proyectos\26001 - Cabina` → `Z:\Proyectos`;
 * `\\srv\Ofertas\26001 - X` → `\\srv\Ofertas`; `Z:\26001 - X` → `Z:\`), o "" si la ubicación no es una
 * carpeta local/de red con al menos un nivel por encima (`\\srv\recurso` no tiene padre aprovechable).
 */
export function parentFolderOf(raw) {
  const { kind, value } = normalizeLocation(raw);
  if (kind !== "folder" || !isAbsolutePath(value)) return "";
  const path = trimTrailingSeparators(value);
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut < 0) return "";
  const parent = path.slice(0, cut);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return isAbsolutePath(parent) ? parent : "";
}

/** Une una carpeta y un nombre con la barra que ya use la ruta (`\` salvo que solo lleve `/`). */
export function joinPath(root, name) {
  const base = normalizeRoot(root);
  const leaf = String(name ?? "").trim();
  if (!base || !leaf) return "";
  const sep = base.includes("\\") || !base.includes("/") ? "\\" : "/";
  return base.endsWith("\\") || base.endsWith("/") ? `${base}${leaf}` : `${base}${sep}${leaf}`;
}

/**
 * La carpeta que se sugiere para un proyecto u oferta: `RutaRaíz\YYXXX - Nombre`. "" si falta la raíz, el ID
 * o el nombre (sin ID no hay forma de llamarla `YYXXX - Nombre`; sin nombre sería solo el ID).
 */
export function suggestedLocation(root, code, name) {
  const c = String(code ?? "").trim();
  if (!c || !String(name ?? "").trim() || !normalizeRoot(root)) return "";
  return joinPath(root, localFolderName(c, name));
}

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const readKey = (storage, key) => { try { return (storage && storage.getItem(key)) || ""; } catch { return ""; } };
const writeKey = (storage, key, value) => { try { if (storage) { if (value) storage.setItem(key, value); else storage.removeItem(key); return true; } } catch { /* sin almacenamiento */ } return false; };

/** La ruta raíz que se usa: la escrita a mano o, si no hay, la deducida de la última carpeta padre. "" si ninguna. */
export function getRememberedRoot(storage = defaultStorage()) {
  return normalizeRoot(readKey(storage, LOCATION_ROOT_KEY)) || normalizeRoot(readKey(storage, LOCATION_ROOT_AUTO_KEY));
}

/** Guarda (o, con "", borra) la ruta raíz escrita a mano. Devuelve la ruta guardada ("" si no era válida o se borró). */
export function setRememberedRoot(raw, storage = defaultStorage()) {
  const root = normalizeRoot(raw);
  writeKey(storage, LOCATION_ROOT_KEY, root);
  return root;
}

/** Anota la carpeta PADRE de una ubicación usada como raíz deducida. Devuelve la raíz deducida ("" si no había). */
export function rememberRootFromLocation(raw, storage = defaultStorage()) {
  const parent = parentFolderOf(raw);
  if (parent) writeKey(storage, LOCATION_ROOT_AUTO_KEY, parent);
  return parent;
}
