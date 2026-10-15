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
} from "./drive-files.js";

const NETWORK_MESSAGE = "No se pudo conectar con Google Drive. Comprueba tu conexión e inténtalo de nuevo.";
const GATEWAY_UNREACHABLE_MESSAGE =
  "No se pudo contactar con el puente de Google Drive. Comprueba que el script está implementado como aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario) y que la dirección guardada en Chusy es la de /exec.";
const MAX_RETRIES = 6;
/** Cuánto se reutiliza el permiso del puente antes de pedir otro (Google lo da por ~1 hora). */
const TOKEN_REUSE_SECONDS = 15 * 60;

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
   * Devuelve { driveId, name, mimeType, size }.
   */
  async function uploadFile(file, opts = {}) {
    const { taskId = "", uid = "", role = "file", name, onProgress, signal, chunkBytes = CHUNK_BYTES, forceResumable = false, allowFallback = true } = opts;
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
    const meta = {
      name: fileName,
      mimeType: mime,
      parents: [tok.folderId],
      description: "Subido desde Chusy",
      appProperties: { chusy: "1", role, ...(taskId ? { task: String(taskId) } : {}), ...(uid ? { by: String(uid) } : {}) },
    };
    let result;
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
    if (!result || !result.id) throw new DriveError("bad_upload_response", "Google Drive no devolvió el identificador del archivo.");
    report(size);
    return { driveId: result.id, name: result.name || fileName, mimeType: mime, size };
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

  /** Copia un archivo de Drive (dentro de Drive, sin descargarlo) y devuelve el id de la copia. */
  async function copyFile(driveId, { name, taskId = "", uid = "", role = "file" } = {}) {
    const tok = await getToken();
    const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(driveId)}/copy?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sanitizeFileName(name),
        parents: [tok.folderId],
        description: "Subido desde Chusy",
        appProperties: { chusy: "1", role, ...(taskId ? { task: String(taskId) } : {}), ...(uid ? { by: String(uid) } : {}) },
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
          if (r.failed) throw new Error(`${r.failed} archivo(s) de prueba no se pudieron borrar; bórralos a mano de la carpeta «Chusy - archivos».`);
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

    if (!(await run("small", "Subir un archivo pequeño", async () => {
      const blob = new Blob([testBytes(2048)], { type: "text/plain" });
      const r = await uploadFile(blob, { role: "test", name: "chusy-prueba-pequena.txt" });
      created.push(r.driveId);
      return "";
    }))) return finish();

    let bigId = null;
    if (!(await run("resumable", "Subir un archivo por trozos (reanudable)", async () => {
      const blob = new Blob([testBytes(600000)], { type: "application/octet-stream" });
      const r = await uploadFile(blob, { role: "test", name: "chusy-prueba-trozos.bin", forceResumable: true, chunkBytes: 262144, allowFallback: false });
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
    downloadBlob,
    getThumbUrl,
    trashFiles,
    copyFile,
    copyAttachments,
    selfTest,
  };
}
