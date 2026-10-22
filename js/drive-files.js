// ============================================================================
// Archivos en Google Drive (v68) — utilidades PURAS: sin DOM, sin Firebase y
// sin red. Todo lo que se puede probar en Node sin simular nada vive aquí; el
// motor (token, subidas, descargas, papelera) está en drive-storage.js, el
// enlace con la sesión de Firebase en drive-service.js y la interfaz en
// components/file-attachments.js, file-preview.js y drive-storage-modal.js.
// Cómo encaja todo: apartado 3.13 del README.
//
// Un archivo adjunto de Drive es una entrada más de `tasks.attachments[]`,
// igual que un enlace, pero con `kind: "drive"` (los enlaces de siempre no
// llevan `kind` y se reconocen por tener `url`):
//
//   { id, kind: "drive", name, driveId, thumbId?, mimeType, size,
//     uploadedBy?, uploadedByName?, uploadedAt? (ISO) }
//
// `driveId` es el id del archivo en Drive y `thumbId` el de su miniatura (un
// segundo archivo, JPEG pequeño, que genera el navegador al subir imágenes y
// vídeos — Drive no la sirve a quien no tiene cuenta de Google).
// ============================================================================

import { codedName } from "./project-codes.js"; // v75: el formato «XXXYY - Nombre» es UNO solo (ver codedName)

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export const DEFAULT_MAX_FILE_MB = 500;
export const MIN_MAX_FILE_MB = 1;
export const MAX_MAX_FILE_MB = 2048;

/** Hasta este tamaño se sube de una sola petición (multipart); por encima, subida reanudable por trozos. */
export const MULTIPART_LIMIT_BYTES = 5 * 1024 * 1024;
/** Si la subida reanudable no está disponible, se intenta de una vez solo hasta este tamaño. */
export const MULTIPART_FALLBACK_LIMIT_BYTES = 150 * 1024 * 1024;
/** Tamaño de cada trozo de una subida reanudable. Drive exige múltiplos de 256 KiB. */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** Por encima de este tamaño no se previsualiza dentro de Chusy (se ofrece descargar). */
export const PREVIEW_LIMIT_BYTES = 250 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Configuración (meta/driveStorage) y dirección del puente
// ---------------------------------------------------------------------------

const GATEWAY_RE = /^https:\/\/script\.google\.com\/(?:macros\/s\/[A-Za-z0-9_-]{10,}|a\/macros\/[^/\s]+\/s\/[A-Za-z0-9_-]{10,})\/exec$/;

/**
 * Deja la dirección del puente (la «URL de la aplicación web» de Apps Script)
 * limpia: sin espacios, sin `?…`/`#…` y sin barra final. Devuelve "" si no es
 * una dirección válida (debe acabar en /exec: la que acaba en /dev es la de
 * pruebas y solo funciona para su dueño).
 */
export function normalizeGatewayUrl(url) {
  let s = String(url ?? "").trim();
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return GATEWAY_RE.test(s) ? s : "";
}

export function isValidGatewayUrl(url) {
  return normalizeGatewayUrl(url) !== "";
}

/**
 * Lo que se guarda en `meta/driveStorage` tal cual lo usa la app: sin
 * dirección válida del puente el almacenamiento queda desactivado aunque
 * `enabled` diga lo contrario, y el tamaño máximo siempre cae en un rango sensato.
 */
export function normalizeDriveConfig(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const gatewayUrl = normalizeGatewayUrl(r.gatewayUrl);
  let maxFileMB = Number(r.maxFileMB);
  if (!Number.isFinite(maxFileMB) || maxFileMB <= 0) maxFileMB = DEFAULT_MAX_FILE_MB;
  maxFileMB = Math.min(MAX_MAX_FILE_MB, Math.max(MIN_MAX_FILE_MB, Math.round(maxFileMB)));
  return { enabled: !!r.enabled && gatewayUrl !== "", gatewayUrl, maxFileMB };
}

// ---------------------------------------------------------------------------
// Adjuntos de Drive
// ---------------------------------------------------------------------------

export function isDriveAttachment(a) {
  return !!a && a.kind === "drive" && typeof a.driveId === "string" && a.driveId.length > 0;
}

/** La entrada que se guarda en `tasks.attachments[]` (sin campos `undefined`: Firestore no los admite). */
export function buildDriveAttachment({ id, name, driveId, thumbId, mimeType, size, uploadedBy, uploadedByName, uploadedAt }) {
  const att = {
    id,
    kind: "drive",
    name: sanitizeFileName(name),
    driveId,
    mimeType: safeUploadMime(mimeType),
    size: Number(size) || 0,
  };
  if (thumbId) att.thumbId = thumbId;
  if (uploadedBy) att.uploadedBy = uploadedBy;
  if (uploadedByName) att.uploadedByName = String(uploadedByName).slice(0, 80);
  if (uploadedAt) att.uploadedAt = uploadedAt;
  return att;
}

/** Clave para no duplicar adjuntos al combinar tareas: el archivo de Drive, o la URL del enlace. */
export function attachmentKey(a) {
  if (isDriveAttachment(a)) return `drive:${a.driveId}`;
  return `url:${a && a.url}`;
}

/** Los ids de Drive (archivo + miniatura) de una lista de adjuntos, sin repetir — lo que hay que mandar a la papelera. */
export function driveFileIdsOf(attachments) {
  const ids = new Set();
  (attachments || []).forEach((a) => {
    if (!isDriveAttachment(a)) return;
    ids.add(a.driveId);
    if (a.thumbId) ids.add(a.thumbId);
  });
  return [...ids];
}

// ---------------------------------------------------------------------------
// Nombres, tipos y formatos
// ---------------------------------------------------------------------------

/** Nombre de archivo seguro y ordenado: sin separadores de ruta ni caracteres de control, máx. 180 letras (respetando la extensión). */
export function sanitizeFileName(name, fallback = "archivo") {
  let s = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /^\.+$/.test(s)) return fallback;
  if (s.length > 180) {
    const m = s.match(/(\.[A-Za-z0-9]{1,10})$/);
    const ext = m ? m[1] : "";
    s = s.slice(0, 180 - ext.length) + ext;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Carpetas (v69): cómo se ordenan los archivos dentro de «Chusy - archivos»
// ---------------------------------------------------------------------------

/** Carpeta de las tareas sin proyecto. */
export const PERSONAL_FOLDER_NAME = "Tareas personales";

/** Carpeta de «Probar conexión»: los archivos de prueba no ensucian las carpetas de proyectos. */
export const TEST_FOLDER_PATH = [{ key: "test", name: "Pruebas de conexión" }];

/** Nombre de carpeta seguro: sin separadores de ruta ni caracteres de control, máx. 100 letras. */
export function sanitizeFolderName(name, fallback = "Sin nombre") {
  const s = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return !s || /^\.+$/.test(s) ? fallback : s;
}

/** «AAAA-MM» de una fecha, con la hora local de quien sube el archivo. */
export function monthFolderName(date = new Date()) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * v75: las dos carpetas «raíz» que cuelgan de «Chusy - archivos»: las ofertas viven en `Ofertas` y los
 * proyectos en `Proyectos`. Al convertir una oferta en proyecto, su carpeta pasa de la una a la otra.
 * Se buscan por `appProperties.folder` (la clave), como el resto de carpetas: el nombre es solo una etiqueta.
 */
export const DRIVE_ROOTS = {
  ofertas: { key: "root:ofertas", name: "Ofertas" },
  proyectos: { key: "root:proyectos", name: "Proyectos" },
};

/** El nombre de la carpeta de un ID: `XXXYY - Nombre` (sin duplicar el ID si el nombre ya lo trae), seguro para Drive. */
export function codedFolderName(code, name) {
  const c = String(code ?? "").trim();
  return sanitizeFolderName(codedName(c, name), c || "Sin nombre");
}

/**
 * Dónde va un archivo dentro de la carpeta de Chusy, como una lista de tramos
 * `{ key, name }` (de fuera adentro):
 *
 *   Ofertas / <ID> - <Nombre> / <AAAA-MM>     una OFERTA con ID (v75)
 *   Proyectos / <ID> - <Nombre> / <AAAA-MM>   un PROYECTO con ID (v75)
 *   <Proyecto> / <AAAA-MM>                    un proyecto sin ID todavía (los de antes de la v70)
 *   Tareas personales / <AAAA-MM>             una tarea sin proyecto
 *
 * `owner` es `{ code, name, kind, folderId? }` (con ID; `kind`: "offer" | "project", y `folderId` la
 * carpeta que ya tiene anotada, `driveFolderId`), `{ id, name }` (sin ID) o null. El ID de una oferta pasa
 * íntegro al proyecto en que se convierte, así que la carpeta de la oferta y la del proyecto son LA MISMA:
 * al convertir, esa carpeta se mueve de `Ofertas` a `Proyectos` y se renombra (drive-storage.js,
 * moveCodeFolderToProjects). Por eso la carpeta se identifica por el ID (`key` = `c:<ID>`), no por su
 * nombre ni por dónde esté, y el tramo lleva `code` (para que el motor sepa que es una carpeta de ID),
 * `root` (en cuál de las dos raíces va si hay que crearla) y `hint` (el `driveFolderId`, para encontrarla
 * sin buscar). La carpeta se renombra al cambiar el nombre de la oferta o del proyecto (drive-service.js).
 */
export function driveFolderPath({ owner = null, date = new Date() } = {}) {
  const month = monthFolderName(date);
  const monthSeg = { key: `m:${month}`, name: month };
  if (owner && owner.code) {
    const code = String(owner.code);
    return [
      {
        key: `c:${code}`,
        name: codedFolderName(code, owner.name),
        code,
        root: owner.kind === "offer" ? "ofertas" : "proyectos",
        hint: owner.folderId ? String(owner.folderId) : null,
      },
      monthSeg,
    ];
  }
  if (owner && owner.id) return [{ key: `p:${owner.id}`, name: sanitizeFolderName(owner.name, "Proyecto") }, monthSeg];
  return [{ key: "personal", name: PERSONAL_FOLDER_NAME }, monthSeg];
}

/** Un texto entre comillas simples para el parámetro `q` de Drive (hay que escapar `\` y `'`). */
export function driveQueryString(value) {
  return `'${String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * El tipo MIME con el que se manda el archivo a Drive. Nunca uno de
 * `application/vnd.google-apps.*` (Drive intentaría convertirlo en un Doc/Hoja
 * de Google) ni nada que no tenga forma de tipo/subtipo.
 */
export function safeUploadMime(type) {
  const t = String(type ?? "").split(";")[0].trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(t)) return "application/octet-stream";
  if (t.startsWith("application/vnd.google-apps")) return "application/octet-stream";
  return t;
}

export function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name ?? ""));
  return m ? m[1].toLowerCase() : "";
}

const KIND_BY_EXT = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", avif: "image", svg: "image", heic: "image", heif: "image", tif: "image", tiff: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video", mkv: "video", avi: "video", wmv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", m4a: "audio", aac: "audio", flac: "audio", opus: "audio",
  pdf: "pdf",
};

/** "image" | "video" | "audio" | "pdf" | "other" — por el tipo MIME y, si es genérico, por la extensión. */
export function fileKind(mimeType, name) {
  const m = String(mimeType ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  return KIND_BY_EXT[extensionOf(name)] || "other";
}

// Solo estos tipos se muestran dentro de Chusy. Cualquier otro (HTML, etc.) se
// descarga sin más: nunca se abre un archivo ajeno como página de Chusy.
const PREVIEW_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/ogg",
  pdf: "application/pdf",
};
const PREVIEW_MIMES = new Set(Object.values(PREVIEW_BY_EXT));

/** El tipo MIME con el que se puede mostrar el archivo dentro de Chusy, o null si solo se puede descargar. */
export function previewMime(att) {
  if (!att) return null;
  const m = String(att.mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (PREVIEW_MIMES.has(m)) return m;
  return PREVIEW_BY_EXT[extensionOf(att.name)] || null;
}

export function canPreview(att) {
  return previewMime(att) !== null && (Number(att && att.size) || 0) <= PREVIEW_LIMIT_BYTES;
}

/** "1,5 MB", "230 KB", "12 B" — para mostrar tamaños. */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "";
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  const txt = x < 10 ? x.toFixed(1) : String(Math.round(x));
  return `${txt.replace(".", ",")} ${units[i]}`;
}

const ICON_BY_EXT = {
  xls: "📊", xlsx: "📊", xlsm: "📊", csv: "📊", ods: "📊",
  doc: "📝", docx: "📝", odt: "📝", txt: "📝", rtf: "📝", md: "📝",
  ppt: "📽️", pptx: "📽️", odp: "📽️",
  zip: "🗜️", rar: "🗜️", "7z": "🗜️", gz: "🗜️", tar: "🗜️",
  dwg: "📐", dxf: "📐", step: "📐", stp: "📐", igs: "📐", iges: "📐", sldprt: "📐", sldasm: "📐",
  psd: "🎨", ai: "🎨", indd: "🎨", svg: "🎨",
};

/** El icono (emoji) de un adjunto cuando no hay miniatura. */
export function fileIconFor(kind, name) {
  if (kind === "image") return "🖼️";
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  if (kind === "pdf") return "📄";
  return ICON_BY_EXT[extensionOf(name)] || "📎";
}

// ---------------------------------------------------------------------------
// Protocolo de Drive y mensajes de error
// ---------------------------------------------------------------------------

/**
 * Siguiente byte que falta por subir según la cabecera `Range` de una
 * respuesta 308 de Drive ("bytes=0-1234" → 1235). Sin cabecera, Drive no ha
 * guardado nada todavía → 0.
 */
export function parseRangeHeader(range) {
  const m = /bytes=\d+-(\d+)/i.exec(String(range ?? ""));
  return m ? Number(m[1]) + 1 : 0;
}

/** Mensaje en castellano para un error que devuelve el puente de Apps Script (`{ok:false, error, detalle}`). */
export function gatewayErrorMessage(code, detail) {
  const d = detail ? ` (${detail})` : "";
  switch (code) {
    case "token_invalido":
      return "Chusy no pudo identificarte ante el puente de Google Drive. Recarga la página e inténtalo de nuevo.";
    case "sin_acceso":
      return `Tu cuenta de Chusy no tiene acceso al almacenamiento de archivos${d}.`;
    case "dominio_no_permitido":
      return "Tu correo no está entre los dominios permitidos de Chusy.";
    case "peticion_demasiado_grande":
    case "peticion_invalida":
    case "accion_desconocida":
      return `El puente de Google Drive no entendió la petición (${code}). ¿Está el script actualizado a la última versión?`;
    case "error_interno":
      return `El puente de Google Drive falló${detail ? `: ${detail}` : "."}`;
    default:
      return `El puente de Google Drive respondió con un error (${code || "desconocido"})${d}.`;
  }
}

/** Mensaje en castellano para un error HTTP de la API de Google Drive. */
export function driveErrorMessage({ status, reason, message }) {
  const m = String(message ?? "");
  if (reason === "storageQuotaExceeded") return "Se ha llenado el almacenamiento de Google Drive.";
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || status === 429) {
    return "Google Drive pide esperar un poco (demasiadas peticiones). Inténtalo de nuevo en un momento.";
  }
  if (reason === "accessNotConfigured" || /has not been used in project|is disabled|accessNotConfigured/i.test(m)) {
    return `Falta activar la API de Google Drive en el script del puente (en el editor: Servicios → Drive API → Añadir). Detalle de Google: ${m}`;
  }
  if (status === 404) return "El archivo ya no está en Google Drive.";
  if (status === 401) return "Google Drive no aceptó el permiso del puente. Prueba a volver a implementar el script (apartado 3.13 del README).";
  if (status === 403) return `Google Drive no permite esta operación${m ? `: ${m}` : "."}`;
  return `Google Drive devolvió un error (${status})${m ? `: ${m}` : "."}`;
}
