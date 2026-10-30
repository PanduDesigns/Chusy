// ============================================================================
// Archivos en Google Drive (v68) — el MOTOR: pide el permiso al «puente» de
// Apps Script, sube/descarga/manda a la papelera/copia archivos con la API de
// Drive y se prueba a sí mismo. No toca el DOM ni Firebase: todo lo de fuera
// (la sesión, la configuración, fetch, XMLHttpRequest, la espera entre
// reintentos…) se le inyecta, igual que task-loader.js — así se prueba en
// Node con un Drive de mentira (ver el apartado 3.13 del README). El enlace
// con la sesión real de Firebase está en drive-service.js.
//
// Cómo llega Chusy a Drive, en una línea: el puente (assets/drive/ChusyDrive.gs,
// un script de Google Apps Script que corre con TU cuenta de Google) comprueba
// que quien pregunta tiene sesión activa en Chusy y le da un permiso de Drive
// de 1 hora; con ese permiso el navegador habla directamente con la API de
// Drive. El archivo nunca pasa por Apps Script (sus límites de tamaño y de
// velocidad no importan) y nadie necesita cuenta de Google.
//
//   petición al puente   POST (text/plain, para no disparar el preflight de CORS)
//                        { accion: "token", idToken } → { ok, token, carpetaId, expiraEnSegundos }
//   subida pequeña       ≤ 5 MB: una sola petición `uploadType=multipart`
//   subida grande        `uploadType=resumable`: se abre una sesión (cabecera
//                        `Location`) y se mandan trozos de 8 MiB con
//                        `Content-Range`; 308 = «sigue», 200/201 = «terminado».
//                        Tras un corte se pregunta hasta dónde llegó
//                        (`Content-Range: bytes */total`) y se continúa ahí.
//                        Es el protocolo del ejemplo oficial de Google
//                        (googledrive/cors-upload-sample).
//   papelera             PATCH { trashed: true } — recuperable 30 días desde Drive
//   carpetas (v69)       antes de subir se busca —o se crea— <Proyecto>/<AAAA-MM> dentro de
//                        la carpeta de Chusy, con la propia API de Drive desde el navegador
//                        (ensureFolderPath); no hace falta tocar el puente. Cada carpeta
//                        lleva en `appProperties.folder` una clave estable (v70: el ID de la
//                        oferta o del proyecto, no su nombre) y así se encuentra siempre.
//                        v75: las de ID viven en `Ofertas/` o `Proyectos/` y se llaman
//                        `YYXXX - Nombre`; se mueven (oferta → proyecto, moveCodeFolderToProjects)
//                        y se renombran (renameCodeFolder) con un PATCH de Drive — también desde el
//                        navegador, tampoco hace falta tocar el puente.
// ============================================================================
import {
  DRIVE_API,
  DRIVE_UPLOAD_API,
  DEFAULT_MAX_FILE_MB,
  MULTIPART_LIMIT_BYTES,
  MULTIPART_FALLBACK_LIMIT_BYTES,
  CHUNK_BYTES,
  isValidGatewayUrl,
  sanitizeFileName,
  safeUploadMime,
  formatBytes,
  gatewayErrorMessage,
  driveErrorMessage,
  parseRangeHeader,
  isDriveAttachment,
  buildDriveAttachment,
  driveQueryString,
  TEST_FOLDER_PATH,
  DRIVE_ROOTS,
  codedFolderName,
} from "./drive-files.js";
import { hasCodePrefix, legacyCodeOf } from "./project-codes.js";

const NETWORK_MESSAGE = "No se pudo conectar con Google Drive. Comprueba tu conexión e inténtalo de nuevo.";
const GATEWAY_UNREACHABLE_MESSAGE =
  "No se pudo contactar con el puente de Google Drive. Comprueba que el script está implementado como aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario) y que la dirección guardada en Chusy es la de /exec.";
const MAX_RETRIES = 6;
/** Cuánto se reutiliza el permiso del puente antes de pedir otro (Google lo da por ~1 hora). */
const TOKEN_REUSE_SECONDS = 15 * 60;
/** Cuánto se recuerda el id de la carpeta de un proyecto/mes antes de volver a preguntarle a Drive. */
const FOLDER_REUSE_SECONDS = 15 * 60;

export class DriveError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "DriveError";
    this.code = code;
    if (extra.status != null) this.status = extra.status;
    if (extra.detail) this.detail = extra.detail;
    if (extra.cause) this.cause = extra.cause;
  }
}

function abortError() {
  const e = new Error("Cancelado");
  e.name = "AbortError";
  return e;
}

export function isAbortError(e) {
  return !!e && (e.name === "AbortError" || e.code === "aborted");
}

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}

function randomToken() {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** Error de la API de Drive a partir del estado HTTP y el cuerpo (texto) de la respuesta. */
function driveErrorFrom(status, bodyText) {
  const data = parseJson(bodyText);
  const e = data && data.error;
  const message = (e && typeof e === "object" && e.message) || (typeof e === "string" ? e : "") || "";
  const reason = (e && typeof e === "object" && ((e.errors && e.errors[0] && e.errors[0].reason) || e.status)) || "";
  return new DriveError(`drive_${reason || status}`, driveErrorMessage({ status, reason, message }), { status, detail: message });
}

async function mapPool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

export function createDriveStorage({
  getConfig,
  getIdToken,
  fetchFn = (...args) => fetch(...args),
  xhrFactory = () => new XMLHttpRequest(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  makeId = randomToken,
}) {
  let tokenInfo = null;
  let tokenPromise = null;
  const folderCache = new Map(); // «<carpeta madre>/<clave>» → { promise: Promise<{ id, created }>, expiresAt }
  const thumbCache = new Map(); // thumbId → Promise<url de blob>
  const thumbUrls = new Map(); // thumbId → url de blob ya resuelta (para revocarlas)
  let thumbActive = 0;
  const thumbWaiting = [];

  const cfg = () => (typeof getConfig === "function" ? getConfig() : null) || {};

  /** ¿Está activado el almacenamiento (y bien configurado)? Sin esto la interfaz ni lo ofrece. */
  function isEnabled() {
    const c = cfg();
    return !!c.enabled && isValidGatewayUrl(c.gatewayUrl);
  }

  function maxBytes() {
    return (Number(cfg().maxFileMB) || DEFAULT_MAX_FILE_MB) * 1024 * 1024;
  }

  // -------------------------------------------------------------------------
  // El puente (Apps Script)
  // -------------------------------------------------------------------------

  async function callGateway(payload) {
    const c = cfg();
    if (!isValidGatewayUrl(c.gatewayUrl)) throw new DriveError("not_configured", "Falta la dirección del puente de Google Drive (Administración → Archivos en Google Drive).");
    let res;
    try {
      // text/plain: es una petición «simple» y el navegador no manda el preflight
      // que Apps Script no sabe contestar. `redirect: follow` es lo normal, pero
      // se explicita: la respuesta SIEMPRE llega tras una redirección a
      // script.googleusercontent.com.
      res = await fetchFn(c.gatewayUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });
    } catch (e) {
      throw new DriveError("gateway_unreachable", GATEWAY_UNREACHABLE_MESSAGE, { cause: e });
    }
    let text = "";
    try { text = await res.text(); } catch (e) { /* sin cuerpo */ }
    const data = parseJson(text);
    if (!data) {
      throw new DriveError("gateway_bad_response", "El puente de Google Drive no devolvió una respuesta válida. Si acabas de cambiar el script, vuelve a implementarlo como «Nueva versión».", { status: res.status });
    }
    if (!data.ok) throw new DriveError(`gateway_${data.error || "error"}`, gatewayErrorMessage(data.error, data.detalle), { detail: data.detalle });
    return data;
  }

  /** El permiso de Drive vigente (más la carpeta de Chusy). Se reutiliza hasta ~15 min; `force` pide uno nuevo. */
  async function getToken({ force = false } = {}) {
    if (!force && tokenInfo && now() < tokenInfo.expiresAt) return tokenInfo;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      let idToken;
      try {
        idToken = await getIdToken();
      } catch (e) {
        throw new DriveError("no_session", "Inicia sesión en Chusy para usar los archivos.", { cause: e });
      }
      const reply = await callGateway({ accion: "token", idToken });
      if (typeof reply.token !== "string" || !reply.token || typeof reply.carpetaId !== "string" || !reply.carpetaId) {
        throw new DriveError("gateway_bad_response", "El puente de Google Drive no entregó el permiso ni la carpeta. ¿Está el script actualizado?");
      }
      const seconds = Math.min(Number(reply.expiraEnSegundos) || TOKEN_REUSE_SECONDS, TOKEN_REUSE_SECONDS);
      tokenInfo = { token: reply.token, folderId: reply.carpetaId, expiresAt: now() + seconds * 1000 };
      return tokenInfo;
    })().finally(() => {
      tokenPromise = null;
    });
    return tokenPromise;
  }

  function resetToken() {
    tokenInfo = null;
  }

  /** Olvida el permiso y las miniaturas en memoria (al cerrar sesión o cambiar de puente). */
  function reset() {
    tokenInfo = null;
    thumbUrls.forEach((url) => { try { revokeObjectURL(url); } catch (e) { /* ya revocada */ } });
    thumbUrls.clear();
    thumbCache.clear();
    folderCache.clear();
  }

  // -------------------------------------------------------------------------
  // Peticiones a Drive
  // -------------------------------------------------------------------------

  /** fetch a la API de Drive con el permiso puesto; si Google contesta 401 (permiso caducado) pide otro y repite UNA vez. */
  async function driveFetch(url, init = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await getToken({ force: attempt === 1 });
      let res;
      try {
        res = await fetchFn(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok.token}` } });
      } catch (e) {
        if (isAbortError(e)) throw e;
        throw new DriveError("network", NETWORK_MESSAGE, { cause: e });
      }
      if (res.status === 401 && attempt === 0) continue;
      return res;
    }
    throw new DriveError("unauthorized", driveErrorMessage({ status: 401 }), { status: 401 });
  }

  async function driveHttpError(res) {
    let text = "";
    try { text = await res.text(); } catch (e) { /* sin cuerpo */ }
    return driveErrorFrom(res.status, text);
  }

  /** XMLHttpRequest como promesa (fetch no da el progreso de SUBIDA, y la barra de progreso lo necesita). */
  function xhrRequest({ method, url, headers = {}, body = null, signal, onUploadProgress, timeoutMs = 10 * 60 * 1000 }) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError()); return; }
      const xhr = xhrFactory();
      let settled = false;
      function onAbort() {
        try { xhr.abort(); } catch (e) { /* ya terminada */ }
        finish(reject, abortError());
      }
      function finish(fn, value) {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        fn(value);
      }
      xhr.open(method, url, true);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.timeout = timeoutMs;
      if (xhr.upload && onUploadProgress) xhr.upload.onprogress = (e) => { if (e) onUploadProgress(e.loaded); };
      xhr.onload = () => finish(resolve, { status: xhr.status, range: xhr.getResponseHeader("Range"), text: xhr.responseText || "" });
      xhr.onerror = () => finish(reject, new DriveError("network", NETWORK_MESSAGE));
      xhr.ontimeout = () => finish(reject, new DriveError("network", NETWORK_MESSAGE));
      xhr.onabort = () => finish(reject, abortError());
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      xhr.send(body);
    });
  }

  const backoff = (n) => Math.min(30000, 1000 * 2 ** (n - 1)) + Math.floor(Math.random() * 250);

  // -------------------------------------------------------------------------
  // Carpetas (v69): <Proyecto>/<AAAA-MM> dentro de «Chusy - archivos»
  // -------------------------------------------------------------------------

  /**
   * La carpeta con esa clave (la más antigua si, por una carrera entre dos personas, hubiera dos), o null.
   * Con `parentId`, solo dentro de esa carpeta; con `null` (v75), DONDE esté: una carpeta de ID se mueve
   * de `Ofertas` a `Proyectos` al convertir la oferta, y las de la v70 cuelgan directamente de «Chusy - archivos».
   * Con el permiso `drive.file` Drive solo enseña lo que ha creado Chusy, así que buscar sin madre no ve nada ajeno.
   */
  async function findFolder(parentId, key) {
    const q = [
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      ...(parentId ? [`${driveQueryString(parentId)} in parents`] : []),
      `appProperties has { key='folder' and value=${driveQueryString(key)} }`,
    ].join(" and ");
    const res = await driveFetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,parents,appProperties)")}&orderBy=createdTime&pageSize=10`);
    if (!res.ok) throw await driveHttpError(res);
    const data = parseJson(await res.text());
    const files = data && Array.isArray(data.files) ? data.files : [];
    return files.length ? files[0] : null;
  }

  async function createFolder(parentId, seg) {
    const res = await driveFetch(`${DRIVE_API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: seg.name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        description: "Carpeta creada por Chusy para ordenar los archivos adjuntos.",
        appProperties: { chusy: "1", role: "folder", folder: seg.key },
      }),
    });
    if (!res.ok) throw await driveHttpError(res);
    const data = parseJson(await res.text());
    if (!data || !data.id) throw new DriveError("bad_folder_response", "Google Drive no devolvió el identificador de la carpeta.");
    return data.id;
  }

  /**
   * Busca —y si no está, crea— la carpeta `seg` ({ key, name }) dentro de `parentId`.
   * Se guarda la PROMESA, no solo el resultado: dos subidas a la vez al mismo
   * proyecto (Chusy sube de 2 en 2) esperan la misma búsqueda en vez de crear
   * cada una su carpeta. A propósito NO recibe la señal de cancelación de quien
   * la pide: es una promesa compartida, y cancelar una subida no debe hacer
   * fallar la otra.
   */
  function ensureFolder(parentId, seg) {
    const cacheKey = `${parentId}/${seg.key}`;
    const hit = folderCache.get(cacheKey);
    if (hit && now() < hit.expiresAt) return hit.promise;
    const promise = (async () => {
      const found = await findFolder(parentId, seg.key);
      if (found) return { id: found.id, created: false };
      return { id: await createFolder(parentId, seg), created: true };
    })();
    folderCache.set(cacheKey, { promise, expiresAt: now() + FOLDER_REUSE_SECONDS * 1000 });
    promise.catch(() => { // un fallo no se queda guardado
      const cur = folderCache.get(cacheKey);
      if (cur && cur.promise === promise) folderCache.delete(cacheKey);
    });
    return promise;
  }

  /** La carpeta (no en la papelera) con ese id, con lo que hace falta para decidir qué retocarle; `null` si ya no existe o no es una carpeta. */
  async function getFolder(id) {
    if (!id) return null;
    const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent("id,name,parents,trashed,mimeType,appProperties")}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await driveHttpError(res);
    const data = parseJson(await res.text());
    if (!data || data.trashed || data.mimeType !== "application/vnd.google-apps.folder") return null;
    return data;
  }

  /**
   * v75: la carpeta de un ID donde esté. Primero por la pista (`driveFolderId`, el id que la oferta o el
   * proyecto tiene anotado: se acepta solo si de verdad es la carpeta de ESE ID, `appProperties.folder`), y
   * si no, buscándola por su clave `c:<ID>`. Un error de Drive (red, permisos) se propaga: dar por
   * «no existe» una carpeta que no se pudo mirar crearía otra repetida.
   */
  async function locateCodeFolder(code, hintId) {
    const key = `c:${code}`;
    // v82: una carpeta creada con el ID del formato antiguo (`c:00126`, nombre `00126 - Cliente`) sigue siendo LA
    // carpeta de ese ID cuando se pide con el nuevo (`26001`): la migración XXXYY → YYXXX no toca Drive de golpe.
    // Se acepta —por la pista o buscándola— y quien la encuentra le pone la clave y el nombre nuevos (retocarCarpeta).
    const legacy = legacyCodeOf(code);
    const legacyKey = legacy ? `c:${legacy}` : null;
    if (hintId) {
      const hinted = await getFolder(hintId);
      const have = hinted && hinted.appProperties ? hinted.appProperties.folder : null;
      if (hinted && have && (have === key || have === legacyKey)) return hinted;
    }
    const found = await findFolder(null, key);
    if (found || !legacyKey) return found;
    return findFolder(null, legacyKey);
  }

  /** Lo que hay que ponerle a una carpeta de ID para que quede «al día»: su clave `c:<ID>` si aún lleva la del formato antiguo (`{}` si ya está bien). */
  function keyPatchFor(folder, code) {
    const have = folder && folder.appProperties ? folder.appProperties.folder : null;
    return have && have !== `c:${code}` ? { appProperties: { folder: `c:${code}` } } : {};
  }

  /** PATCH de una carpeta: nuevo nombre, moverla (`move` = { add, remove[] }) y/o actualizar sus `appProperties` (v82: la clave `c:<ID>`). Un solo viaje a Drive. */
  async function patchFolder(id, { name = null, move = null, appProperties = null } = {}) {
    const qs = new URLSearchParams({ fields: "id,name,parents" });
    if (move && move.add) qs.set("addParents", move.add);
    if (move && move.remove && move.remove.length) qs.set("removeParents", move.remove.join(","));
    const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?${qs.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(name ? { name } : {}), ...(appProperties ? { appProperties } : {}) }),
    });
    if (!res.ok) throw await driveHttpError(res);
  }

  /** Olvida lo recordado de la carpeta de un ID (después de renombrarla o moverla). */
  function forgetCodeFolder(code) {
    const prefixes = [`code/c:${code}/`];
    const legacy = legacyCodeOf(code);
    if (legacy) prefixes.push(`code/c:${legacy}/`);
    for (const k of [...folderCache.keys()]) if (prefixes.some((prefix) => k.startsWith(prefix))) folderCache.delete(k);
  }

  /** La carpeta madre `Ofertas` o `Proyectos` (se crea la primera vez), dentro de «Chusy - archivos». */
  function ensureRoot(rootName, tok) {
    return ensureFolder(tok.folderId, DRIVE_ROOTS[rootName] || DRIVE_ROOTS.proyectos);
  }

  /**
   * v75: encuentra —o crea— la carpeta de un ID (`seg`, ver driveFolderPath) y la deja «en regla»:
   *   · se busca DONDE esté, no solo dentro de una madre (por la pista `seg.hint` y por su clave);
   *   · si existe pero su nombre no lleva el ID por delante (alguien la renombró a mano) se le pone
   *     `YYXXX - …` (se conserva lo que escribió esa persona; el nombre de la oferta o del proyecto lo
   *     sincroniza renameCodeFolder cuando se edita, no una subida);
   *   · si es de un PROYECTO y no está en `Proyectos` (se quedó en `Ofertas` porque falló el traspaso al
   *     convertir, o es de la v70, suelta en «Chusy - archivos») se mueve a `Proyectos`; si es de una OFERTA,
   *     solo se recoge la que quedó suelta en «Chusy - archivos» (una que ya está en `Proyectos` es la de una
   *     oferta ya convertida: se deja donde está);
   *   · si no existe, se crea con su nombre dentro de `Ofertas` o `Proyectos`.
   * Ordenar es un extra: si retocarla falla (permisos, red) la carpeta se usa igualmente tal como está
   * (queda un aviso en la consola); lo que SÍ se propaga es no poder buscarla o crearla.
   * Se guarda la PROMESA (dos subidas a la vez comparten la misma comprobación y no crean dos carpetas).
   */
  function ensureCodeFolder(seg, tok) {
    const cacheKey = `code/${seg.key}/${seg.root}`;
    const hit = folderCache.get(cacheKey);
    if (hit && now() < hit.expiresAt) return hit.promise;
    const promise = (async () => {
      const root = await ensureRoot(seg.root, tok);
      const found = await locateCodeFolder(seg.code, seg.hint);
      if (!found) return { id: await createFolder(root.id, seg), created: true, renamed: false, moved: false };
      const parents = Array.isArray(found.parents) ? found.parents : [];
      // v82: un nombre con el ID del formato antiguo (`00126 - Cliente`) pasa a `26001 - Cliente` (codedName no lo duplica).
      const rename = !hasCodePrefix(found.name, seg.code) ? codedFolderName(seg.code, found.name) : null;
      const keyPatch = keyPatchFor(found, seg.code);
      const shouldMove = seg.root === "proyectos" ? !parents.includes(root.id) : parents.includes(tok.folderId);
      if (rename || shouldMove || keyPatch.appProperties) {
        try {
          await patchFolder(found.id, { name: rename, move: shouldMove ? { add: root.id, remove: parents.filter((p) => p !== root.id) } : null, ...keyPatch });
        } catch (e) {
          console.warn("Drive: no se pudo ordenar la carpeta de", seg.code, "(se usa tal como está)", e);
          return { id: found.id, created: false, renamed: false, moved: false };
        }
      }
      return { id: found.id, created: false, renamed: !!rename, moved: shouldMove };
    })();
    folderCache.set(cacheKey, { promise, expiresAt: now() + FOLDER_REUSE_SECONDS * 1000 });
    promise.catch(() => { // un fallo no se queda guardado
      const cur = folderCache.get(cacheKey);
      if (cur && cur.promise === promise) folderCache.delete(cacheKey);
    });
    return promise;
  }

  /**
   * Prepara la cadena de carpetas `path` (lo que da driveFolderPath, de fuera
   * adentro) dentro de «Chusy - archivos» y devuelve { folderId, created, codeFolderId }: el
   * id de la última, si hubo que crear alguna y (v75) el id de la carpeta del ID de la
   * oferta o del proyecto si el camino lleva una (lo que se anota como `driveFolderId`).
   * Lanza si Drive no deja.
   */
  async function ensureFolderPath(path) {
    const tok = await getToken();
    let parentId = tok.folderId;
    let created = false;
    let codeFolderId = null;
    for (const seg of path || []) {
      let r;
      if (seg.code) {
        r = await ensureCodeFolder(seg, tok);
        codeFolderId = r.id;
      } else {
        r = await ensureFolder(parentId, seg);
      }
      parentId = r.id;
      created = created || r.created;
    }
    return { folderId: parentId, created, codeFolderId };
  }

  /**
   * Dónde va un archivo nuevo: la carpeta de `folderPath` o, si no se pide
   * ninguna o Drive no deja prepararla, la carpeta principal. Ordenar es un
   * extra: nunca debe impedir una subida (el motivo queda en la consola, y
   * «Probar conexión» lo enseña). Devuelve `{ parentId, codeFolderId }`.
   */
  async function parentFor(tok, folderPath) {
    if (!folderPath || !folderPath.length) return { parentId: tok.folderId, codeFolderId: null };
    try {
      const r = await ensureFolderPath(folderPath);
      return { parentId: r.folderId, codeFolderId: r.codeFolderId };
    } catch (e) {
      console.warn("Drive: no se pudieron preparar las carpetas; el archivo va a la carpeta principal", e);
      return { parentId: tok.folderId, codeFolderId: null };
    }
  }

  /**
   * v75: pone a la carpeta de un ID el nombre `YYXXX - Nombre` de ahora (la oferta o el proyecto cambió de
   * nombre). NO crea nada: si esa oferta o proyecto aún no tiene carpeta (nunca se subió un archivo),
   * devuelve `{ folderId: null }`. Sin nombre no se renombra (no se sabe a qué).
   * Devuelve `{ folderId, renamed }`; `folderId` es el que hay que anotar si la ficha aún no lo tenía.
   */
  async function renameCodeFolder({ code, name, folderId = null }) {
    if (!code) return { folderId: null, renamed: false };
    const found = await locateCodeFolder(String(code), folderId);
    if (!found) return { folderId: null, renamed: false };
    forgetCodeFolder(code);
    if (!String(name ?? "").trim()) return { folderId: found.id, renamed: false };
    const want = codedFolderName(code, name);
    const keyPatch = keyPatchFor(found, code); // v82: y la clave `c:<ID>` si aún es la del formato antiguo
    if (found.name === want) {
      if (keyPatch.appProperties) await patchFolder(found.id, keyPatch);
      return { folderId: found.id, renamed: false };
    }
    await patchFolder(found.id, { name: want, ...keyPatch });
    return { folderId: found.id, renamed: true };
  }

  /**
   * v75: al convertir una oferta en proyecto, su carpeta pasa de `Ofertas` a `Proyectos` y se renombra a
   * `YYXXX - Nombre del proyecto`, en UNA sola operación de Drive (el id de la carpeta no cambia, y todo lo
   * de dentro —los adjuntos de la oferta, con sus ids— se va con ella). No crea nada: sin carpeta (la oferta
   * nunca tuvo archivos) devuelve `{ folderId: null }`. Si ya está en `Proyectos`, solo la renombra.
   * Devuelve `{ folderId, moved, renamed }`.
   */
  async function moveCodeFolderToProjects({ code, name, folderId = null }) {
    if (!code) return { folderId: null, moved: false, renamed: false };
    const tok = await getToken();
    const found = await locateCodeFolder(String(code), folderId);
    if (!found) return { folderId: null, moved: false, renamed: false };
    const root = await ensureRoot("proyectos", tok);
    forgetCodeFolder(code);
    const parents = Array.isArray(found.parents) ? found.parents : [];
    const moved = !parents.includes(root.id);
    const want = String(name ?? "").trim() ? codedFolderName(code, name) : null;
    const renamed = !!want && found.name !== want;
    const keyPatch = keyPatchFor(found, code); // v82: la clave del formato antiguo se actualiza de paso
    if (moved || renamed || keyPatch.appProperties) {
      await patchFolder(found.id, {
        name: renamed ? want : null,
        move: moved ? { add: root.id, remove: parents.filter((p) => p !== root.id) } : null,
        ...keyPatch,
      });
    }
    return { folderId: found.id, moved, renamed };
  }

  /** La carpeta de un archivo de Drive y su ID (`appProperties.code`, v70): `{ parentId, code }`, con null/"" para lo que no se pueda saber. */
  async function infoOf(driveId) {
    const none = { parentId: null, code: "" };
    try {
      const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(driveId)}?fields=parents,appProperties`);
      if (!res.ok) return none;
      const data = parseJson(await res.text());
      if (!data) return none;
      return {
        parentId: Array.isArray(data.parents) && data.parents[0] ? data.parents[0] : null,
        code: data.appProperties && data.appProperties.code ? String(data.appProperties.code) : "",
      };
    } catch (e) {
      return none;
    }
  }

  // -------------------------------------------------------------------------
  // Subida
  // -------------------------------------------------------------------------

  /** Una sola petición: para archivos pequeños (y como plan B si la sesión reanudable no está disponible). */
  async function uploadMultipart(file, meta, mime, report, signal) {
    const boundary = `chusy${makeId()}`;
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
    const body = new Blob([head, file, `\r\n--${boundary}--`]);
    const url = `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType`;
    let refreshed = false;
    let failures = 0;
    for (;;) {
      const tok = await getToken(); // tras un 401 el permiso se descarta (resetToken) y aquí llega uno nuevo
      let r;
      try {
        r = await xhrRequest({
          method: "POST",
          url,
          headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
          signal,
          onUploadProgress: (loaded) => report(Math.max(0, loaded - head.length)),
        });
      } catch (e) {
        if (isAbortError(e)) throw e;
        failures++;
        if (failures > 3) throw e;
        await sleep(backoff(failures));
        continue;
      }
      if (r.status >= 200 && r.status < 300) {
        const data = parseJson(r.text);
        if (!data || !data.id) throw new DriveError("bad_upload_response", "Google Drive no devolvió el identificador del archivo.");
        return data;
      }
      if (r.status === 401 && !refreshed) { refreshed = true; resetToken(); continue; }
      if ((r.status >= 500 || r.status === 429) && failures < 3) {
        failures++;
        await sleep(backoff(failures));
        continue;
      }
      throw driveErrorFrom(r.status, r.text);
    }
  }

  /** Subida reanudable por trozos. Devuelve null si Google no da la dirección de la sesión (el llamador prueba entonces multipart). */
  async function uploadResumable(file, meta, mime, size, report, signal, chunkBytes) {
    const initRes = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(meta),
      signal,
    });
    if (!initRes.ok) throw await driveHttpError(initRes);
    const session = initRes.headers.get("Location");
    if (!session) return null;

    async function queryStatus(offset) {
      try {
        const r = await xhrRequest({ method: "PUT", url: session, headers: { "Content-Range": `bytes */${size}` }, signal });
        if (r.status === 200 || r.status === 201) return { done: true, result: parseJson(r.text), offset: size };
        if (r.status === 308) return { done: false, offset: parseRangeHeader(r.range) };
      } catch (e) {
        if (isAbortError(e)) throw e;
      }
      return { done: false, offset }; // sin novedades: se reintenta el mismo trozo
    }

    let offset = 0;
    let failures = 0;
    let finished = null;
    while (offset < size) {
      if (signal && signal.aborted) throw abortError();
      const end = Math.min(offset + chunkBytes, size);
      const startOfChunk = offset;
      let r = null;
      try {
        r = await xhrRequest({
          method: "PUT",
          url: session,
          headers: { "Content-Type": mime, "Content-Range": `bytes ${startOfChunk}-${end - 1}/${size}` },
          body: file.slice(startOfChunk, end),
          signal,
          onUploadProgress: (loaded) => report(startOfChunk + loaded),
        });
      } catch (e) {
        if (isAbortError(e)) throw e;
        r = null; // corte de red: se pregunta hasta dónde llegó
      }
      if (r && (r.status === 200 || r.status === 201)) {
        finished = parseJson(r.text);
        break;
      }
      if (r && r.status === 308) {
        const next = parseRangeHeader(r.range);
        failures = next > startOfChunk ? 0 : failures + 1;
        if (failures > MAX_RETRIES) throw new DriveError("stalled", "La subida se ha quedado atascada. Inténtalo de nuevo.");
        offset = next;
        if (failures > 0) await sleep(backoff(failures));
        continue;
      }
      if (!r || r.status >= 500 || r.status === 429) {
        failures++;
        if (failures > MAX_RETRIES) throw new DriveError("network", "Se cortó la conexión con Google Drive mientras se subía el archivo.");
        await sleep(backoff(failures));
        const st = await queryStatus(startOfChunk);
        if (st.done) { finished = st.result; break; }
        offset = st.offset;
        continue;
      }
      if (r.status === 404 || r.status === 410) throw new DriveError("session_expired", "La subida caducó. Vuelve a intentarlo.", { status: r.status });
      throw driveErrorFrom(r.status, r.text);
    }
    if (!finished) {
      // Se enviaron todos los bytes pero Drive aún no ha dado el «terminado».
      const st = await queryStatus(size);
      if (!st.done) throw new DriveError("incomplete", "Google Drive no confirmó el final de la subida. Inténtalo de nuevo.");
      finished = st.result;
    }
    return finished;
  }

  /**
   * Sube un archivo (File/Blob) a la carpeta de Chusy en Drive.
   *   role      "file" (adjunto, se limita por tamaño) | "thumb" (miniatura) | "test"
   *   onProgress({loaded,total})  progreso 0..total
   *   signal    AbortSignal para cancelar
   *   chunkBytes / forceResumable  solo para probar el protocolo con archivos pequeños
   *   allowFallback  false = si la subida reanudable no está disponible, fallar en vez de
   *                  caer en la subida de una vez (lo usa «Probar conexión», que debe
   *                  avisar de ese problema aunque los archivos pequeños sigan funcionando)
   *   folderPath  (v69) las carpetas donde va, de fuera adentro — ver driveFolderPath en
   *               drive-files.js. Sin ella, a la carpeta principal de Chusy.
   *   code        (v70) el ID de la oferta o del proyecto al que pertenece el archivo: se anota
   *               en el archivo (`appProperties.code` y la descripción) para poder localizarlo
   *               por él aunque alguien lo mueva de carpeta.
   * Devuelve { driveId, name, mimeType, size, folderId }: `folderId` (v75) es el id de la carpeta del ID
   * de la oferta o del proyecto donde quedó (null si no iba a una carpeta de ID): es lo que se anota
   * como `driveFolderId`.
   */
  async function uploadFile(file, opts = {}) {
    const { taskId = "", uid = "", role = "file", name, onProgress, signal, chunkBytes = CHUNK_BYTES, forceResumable = false, allowFallback = true, folderPath = null, code = "" } = opts;
    if (!isEnabled()) throw new DriveError("disabled", "El almacenamiento de archivos no está activado.");
    const size = Number(file && file.size) || 0;
    if (size <= 0) throw new DriveError("empty", "El archivo está vacío.");
    if (role === "file" && size > maxBytes()) {
      throw new DriveError("too_big", `«${sanitizeFileName(name || file.name)}» pesa ${formatBytes(size)} y el máximo es ${formatBytes(maxBytes())}.`);
    }
    if (signal && signal.aborted) throw abortError();
    const mime = safeUploadMime(file.type);
    const fileName = sanitizeFileName(name || file.name, role === "thumb" ? "miniatura.jpg" : "archivo");
    const report = (loaded) => { if (onProgress) onProgress({ loaded: Math.min(loaded, size), total: size }); };
    const tok = await getToken();
    const { parentId, codeFolderId } = await parentFor(tok, folderPath);
    if (signal && signal.aborted) throw abortError(); // se canceló mientras se preparaban las carpetas
    const meta = {
      name: fileName,
      mimeType: mime,
      parents: [parentId],
      description: code ? `Subido desde Chusy · ID ${code}` : "Subido desde Chusy",
      appProperties: { chusy: "1", role, ...(taskId ? { task: String(taskId) } : {}), ...(uid ? { by: String(uid) } : {}), ...(code ? { code: String(code) } : {}) },
    };
    let result;
    try {
      if (!forceResumable && size <= MULTIPART_LIMIT_BYTES) {
        result = await uploadMultipart(file, meta, mime, report, signal);
      } else {
        result = await uploadResumable(file, meta, mime, size, report, signal, chunkBytes);
        if (result === null) {
          if (!allowFallback || size > MULTIPART_FALLBACK_LIMIT_BYTES) {
            throw new DriveError("no_session_uri", "Google Drive no devolvió la dirección de la subida reanudable (la cabecera «Location» no llegó al navegador). Los archivos pequeños se subirían igualmente, pero los grandes no.");
          }
          result = await uploadMultipart(file, meta, mime, report, signal);
        }
      }
    } catch (e) {
      // 404 al subir = la carpeta de destino ya no existe (alguien la borró en Drive mientras estaba en la
      // caché): se olvida, y el «Reintentar» de la subida la vuelve a buscar o crear en vez de repetir el error.
      if (folderPath && e && e.code === "drive_notFound") folderCache.clear();
      throw e;
    }
    if (!result || !result.id) throw new DriveError("bad_upload_response", "Google Drive no devolvió el identificador del archivo.");
    report(size);
    return { driveId: result.id, name: result.name || fileName, mimeType: mime, size, folderId: codeFolderId || null };
  }

  // -------------------------------------------------------------------------
  // Descarga y miniaturas
  // -------------------------------------------------------------------------

  /** Descarga el archivo completo como Blob (con `type` ya decidido por quien llama — nunca el que diga Drive). */
  async function downloadBlob(att, { type = "application/octet-stream", onProgress, signal } = {}) {
    const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(att.driveId)}?alt=media`, { signal });
    if (!res.ok) throw await driveHttpError(res);
    const total = Number(att.size) || Number(res.headers.get("Content-Length")) || 0;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const parts = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.length;
        if (onProgress) onProgress({ loaded, total });
      }
      return new Blob(parts, { type });
    }
    const blob = await res.blob();
    if (onProgress) onProgress({ loaded: blob.size, total: blob.size });
    return new Blob([blob], { type });
  }

  function withThumbSlot(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        thumbActive++;
        fn().then(resolve, reject).finally(() => {
          thumbActive--;
          const next = thumbWaiting.shift();
          if (next) next();
        });
      };
      if (thumbActive < 3) run(); else thumbWaiting.push(run);
    });
  }

  /** Dirección (blob:) de la miniatura de un adjunto; se descarga una vez por sesión y se guarda en memoria. */
  function getThumbUrl(thumbId) {
    if (!thumbCache.has(thumbId)) {
      const p = withThumbSlot(async () => {
        const blob = await downloadBlob({ driveId: thumbId }, { type: "image/jpeg" });
        const url = createObjectURL(blob);
        thumbUrls.set(thumbId, url);
        return url;
      });
      p.catch(() => { if (thumbCache.get(thumbId) === p) thumbCache.delete(thumbId); }); // un fallo no se queda guardado
      thumbCache.set(thumbId, p);
    }
    return thumbCache.get(thumbId);
  }

  // -------------------------------------------------------------------------
  // Papelera y copias
  // -------------------------------------------------------------------------

  /**
   * Manda archivos de Drive a la papelera (la de Drive: recuperable durante 30
   * días desde la cuenta propietaria). Nunca lanza: devuelve cuántos salieron
   * bien y cuántos no — borrar un adjunto no debe fallar por culpa de Drive.
   */
  async function trashFiles(ids) {
    const list = [...new Set((ids || []).filter(Boolean))];
    const out = { ok: 0, failed: 0 };
    if (!list.length) return out;
    if (!isEnabled()) { out.failed = list.length; out.skipped = true; return out; }
    await mapPool(list, 3, async (id) => {
      try {
        const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        });
        if (res.ok || res.status === 404) out.ok++; // 404: ya no existía
        else out.failed++;
      } catch (e) {
        console.warn("Drive: no se pudo mandar a la papelera", id, e);
        out.failed++;
      }
      const cached = thumbUrls.get(id);
      if (cached) { try { revokeObjectURL(cached); } catch (e) { /* ya revocada */ } thumbUrls.delete(id); thumbCache.delete(id); }
    });
    return out;
  }

  /**
   * Copia un archivo de Drive (dentro de Drive, sin descargarlo) y devuelve el id de la copia.
   * v69: la copia va a la MISMA carpeta que el original (la del proyecto y mes en que se
   * subió; la principal si es de antes de las carpetas, o si no se puede saber). v70: y
   * lleva el mismo ID anotado.
   */
  async function copyFile(driveId, { name, taskId = "", uid = "", role = "file" } = {}) {
    const tok = await getToken();
    const { parentId: sourceParent, code } = await infoOf(driveId);
    const parentId = sourceParent || tok.folderId;
    const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(driveId)}/copy?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sanitizeFileName(name),
        parents: [parentId],
        description: code ? `Subido desde Chusy · ID ${code}` : "Subido desde Chusy",
        appProperties: { chusy: "1", role, ...(taskId ? { task: String(taskId) } : {}), ...(uid ? { by: String(uid) } : {}), ...(code ? { code } : {}) },
      }),
    });
    if (!res.ok) throw await driveHttpError(res);
    const data = parseJson(await res.text());
    if (!data || !data.id) throw new DriveError("bad_copy_response", "Google Drive no devolvió el identificador de la copia.");
    return data.id;
  }

  /**
   * Para duplicar una tarea: cada adjunto de Drive se COPIA (la tarea nueva y la
   * original no deben compartir archivo, o quitar el adjunto de una rompería el
   * de la otra); los enlaces pasan tal cual. Devuelve { attachments, skipped }:
   * `skipped` cuenta los archivos que no se pudieron copiar y se quedan fuera.
   */
  async function copyAttachments(attachments, { uid = "", taskId = "" } = {}) {
    const out = [];
    let skipped = 0;
    for (const a of attachments || []) {
      if (!isDriveAttachment(a)) { out.push(a); continue; }
      try {
        const driveId = await copyFile(a.driveId, { name: a.name, uid: a.uploadedBy || uid, taskId, role: "file" });
        let thumbId;
        if (a.thumbId) {
          try { thumbId = await copyFile(a.thumbId, { name: `${a.name}.miniatura.jpg`, uid: a.uploadedBy || uid, taskId, role: "thumb" }); } catch (e) { /* sin miniatura */ }
        }
        out.push(buildDriveAttachment({ ...a, id: makeId(), driveId, thumbId }));
      } catch (e) {
        console.warn("Drive: no se pudo copiar", a.name, e);
        skipped++;
      }
    }
    return { attachments: out, skipped };
  }

  // -------------------------------------------------------------------------
  // «Probar conexión» (panel de administración)
  // -------------------------------------------------------------------------

  function testBytes(n) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 255;
    return bytes;
  }

  /**
   * Recorre todo el camino con archivos de prueba que se borran al terminar:
   * puente → permiso → subida pequeña → subida por trozos (3 trozos) →
   * descarga y comprobación del contenido → papelera. `onStep` recibe cada
   * paso al empezar y al terminar. Devuelve { ok, steps }.
   */
  async function selfTest(onStep = () => {}) {
    const steps = [];
    const created = [];
    const run = async (id, label, fn) => {
      onStep({ id, label, status: "running" });
      try {
        const detail = (await fn()) || "";
        const step = { id, label, ok: true, detail };
        steps.push(step);
        onStep({ ...step, status: "ok" });
        return true;
      } catch (e) {
        const step = { id, label, ok: false, detail: (e && e.message) || String(e) };
        steps.push(step);
        onStep({ ...step, status: "error" });
        return false;
      }
    };
    const finish = async () => {
      if (created.length) {
        await run("trash", "Mandar los archivos de prueba a la papelera", async () => {
          const r = await trashFiles(created);
          if (r.failed) throw new Error(`${r.failed} archivo(s) de prueba no se pudieron borrar; bórralos a mano de la carpeta «Pruebas de conexión» (dentro de «Chusy - archivos»).`);
          return "";
        });
      }
      return { ok: steps.every((s) => s.ok), steps };
    };

    if (!(await run("ping", "El puente responde", async () => {
      const r = await callGateway({ accion: "ping" });
      return `versión ${r.version ?? "?"}`;
    }))) return finish();

    if (!(await run("token", "El puente da permiso para usar Drive", async () => {
      const t = await getToken({ force: true });
      return t.folderId ? "carpeta de Chusy lista" : "";
    }))) return finish();

    let testFolderId = null;
    if (!(await run("folders", "Preparar la carpeta de pruebas (como las de proyecto y mes)", async () => {
      const r = await ensureFolderPath(TEST_FOLDER_PATH);
      testFolderId = r.folderId;
      return r.created ? "carpeta «Pruebas de conexión» creada" : "carpeta «Pruebas de conexión» ya existente";
    }))) return finish();

    // v75: lo que hace falta al convertir una oferta en proyecto (y al renombrar): crear una carpeta de ID
    // en `Ofertas`, pasarla a `Proyectos` renombrada y comprobar que Drive lo ha hecho con el permiso
    // `drive.file`. Es la prueba de que esos dos PATCH funcionan en el Google real.
    if (!(await run("move", "Crear una carpeta de oferta, renombrarla y pasarla a «Proyectos»", async () => {
      const code = "PRUEBA";
      const seg = { key: `c:${code}`, name: codedFolderName(code, "carpeta de prueba"), code, root: "ofertas", hint: null };
      const first = await ensureFolderPath([seg]);
      created.push(first.codeFolderId);
      const before = await getFolder(first.codeFolderId);
      if (!before) throw new Error("La carpeta de prueba se creó pero no se puede leer.");
      const r = await moveCodeFolderToProjects({ code, name: "carpeta renombrada", folderId: first.codeFolderId });
      if (r.folderId !== first.codeFolderId) throw new Error("Drive no encontró la carpeta de prueba que acababa de crear.");
      const after = await getFolder(first.codeFolderId);
      if (!after) throw new Error("La carpeta de prueba desapareció al moverla.");
      if (after.name !== codedFolderName(code, "carpeta renombrada")) throw new Error(`La carpeta no se renombró (se llama «${after.name}»). Convertir una oferta no podría renombrar su carpeta.`);
      if (!after.parents || !after.parents[0] || after.parents[0] === (before.parents || [])[0]) throw new Error("La carpeta no cambió de madre. Convertir una oferta no podría pasar su carpeta a «Proyectos».");
      return "oferta → proyecto, renombrada";
    }))) return finish();

    if (!(await run("small", "Subir un archivo pequeño a esa carpeta", async () => {
      const blob = new Blob([testBytes(2048)], { type: "text/plain" });
      const r = await uploadFile(blob, { role: "test", name: "chusy-prueba-pequena.txt", folderPath: TEST_FOLDER_PATH });
      created.push(r.driveId);
      const { parentId: parent } = await infoOf(r.driveId);
      if (!parent) throw new Error("El archivo se subió, pero no se pudo comprobar en qué carpeta quedó.");
      if (parent !== testFolderId) throw new Error("El archivo se subió, pero no quedó dentro de la carpeta de pruebas: las carpetas por proyecto y mes no funcionarían (los archivos irían a la carpeta principal).");
      return "";
    }))) return finish();

    let bigId = null;
    if (!(await run("resumable", "Subir un archivo por trozos (reanudable)", async () => {
      const blob = new Blob([testBytes(600000)], { type: "application/octet-stream" });
      const r = await uploadFile(blob, { role: "test", name: "chusy-prueba-trozos.bin", forceResumable: true, chunkBytes: 262144, allowFallback: false, folderPath: TEST_FOLDER_PATH });
      created.push(r.driveId);
      bigId = r.driveId;
      return "3 trozos";
    }))) return finish();

    if (!(await run("download", "Descargarlo y comprobar que es idéntico", async () => {
      const blob = await downloadBlob({ driveId: bigId, size: 600000 }, { type: "application/octet-stream" });
      const got = new Uint8Array(await blob.arrayBuffer());
      const want = testBytes(600000);
      if (got.length !== want.length) throw new Error(`Se descargaron ${got.length} bytes y se esperaban ${want.length}.`);
      for (let i = 0; i < want.length; i += 997) if (got[i] !== want[i]) throw new Error("El contenido descargado no coincide con el subido.");
      return "";
    }))) return finish();

    return finish();
  }

  return {
    isEnabled,
    maxBytes,
    config: cfg,
    callGateway,
    getToken,
    resetToken,
    reset,
    uploadFile,
    ensureFolderPath,
    renameCodeFolder,
    moveCodeFolderToProjects,
    downloadBlob,
    getThumbUrl,
    trashFiles,
    copyFile,
    copyAttachments,
    selfTest,
  };
}
