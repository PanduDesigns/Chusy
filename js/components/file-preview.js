// ============================================================================
// Archivos en Google Drive (v68): el visor de adjuntos. Imágenes, vídeo, audio
// y PDF se ven dentro de Chusy (se descargan de Drive con el permiso del
// puente y se enseñan desde una dirección blob:); lo demás —y lo que pesa más
// de PREVIEW_LIMIT_BYTES— solo ofrece «Descargar». Flechas ←/→ para pasar al
// archivo anterior/siguiente de la tarea, Esc para cerrar.
//
// El tipo con el que se enseña un archivo sale SIEMPRE de nuestra lista
// (previewMime en drive-files.js), nunca de lo que diga Drive: un archivo HTML
// subido con nombre «.pdf» no se abre como página de Chusy.
// ============================================================================
import { el, escapeHtml, showToast } from "../utils.js";
import { previewMime, fileKind, fileIconFor, formatBytes, PREVIEW_LIMIT_BYTES } from "../drive-files.js";
import { isAbortError } from "../drive-storage.js";

/** Guarda un Blob como archivo con ese nombre (lo que haría un enlace de descarga). */
export function saveBlobAs(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "archivo";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Descarga un adjunto de Drive y lo guarda en el equipo, avisando del resultado. */
export async function downloadAttachment(att, storage) {
  showToast(`Descargando «${att.name}»…`);
  try {
    const blob = await storage.downloadBlob(att, { type: "application/octet-stream" });
    saveBlobAs(blob, att.name);
  } catch (e) {
    if (isAbortError(e)) return;
    console.error("downloadAttachment:", e);
    showToast(e && e.message ? e.message : "No se pudo descargar el archivo.", "error");
  }
}

function formatWhen(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Solo puede haber un visor abierto: con un doble clic en una tarjeta se abrirían
// dos apilados (y cada uno con su escuchador de teclado).
let activePreview = null;

/**
 * Abre el visor. `items` son adjuntos de Drive (los de una tarea), `index` el
 * que se enseña primero y `storage` el motor (driveService).
 */
export function openFilePreview({ items, index = 0, storage }) {
  if (!items || !items.length) return;
  if (activePreview) activePreview.close();
  const root = document.getElementById("modal-root") || document.body;
  let current = Math.min(Math.max(index, 0), items.length - 1);
  let controller = null;
  let objectUrl = null;
  let loadId = 0;

  const overlay = el(`
    <div class="fp-overlay" role="dialog" aria-modal="true" aria-label="Vista previa del archivo">
      <div class="fp-top">
        <div class="fp-top__info">
          <div class="fp-top__name" id="fp-name"></div>
          <div class="fp-top__meta" id="fp-meta"></div>
        </div>
        <button type="button" class="btn btn--ghost btn--sm" id="fp-download">⬇ Descargar</button>
        <button type="button" class="fp-close" id="fp-close" title="Cerrar (Esc)">✕</button>
      </div>
      <button type="button" class="fp-nav fp-nav--prev" id="fp-prev" title="Anterior (←)">‹</button>
      <div class="fp-stage" id="fp-stage"></div>
      <button type="button" class="fp-nav fp-nav--next" id="fp-next" title="Siguiente (→)">›</button>
    </div>
  `);
  root.appendChild(overlay);
  const stage = overlay.querySelector("#fp-stage");

  function releaseCurrent() {
    if (controller) { controller.abort(); controller = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  function showMessage(att, html) {
    stage.innerHTML = `<div class="fp-message">${html}</div>`;
    const btn = stage.querySelector("[data-fp-download]");
    if (btn) btn.addEventListener("click", () => downloadAttachment(att, storage));
  }

  function updateChrome() {
    const att = items[current];
    overlay.querySelector("#fp-name").textContent = att.name;
    const bits = [formatBytes(att.size), att.uploadedByName ? `subido por ${att.uploadedByName}` : "", formatWhen(att.uploadedAt)].filter(Boolean);
    if (items.length > 1) bits.push(`${current + 1} de ${items.length}`);
    overlay.querySelector("#fp-meta").textContent = bits.join(" · ");
    overlay.querySelector("#fp-prev").hidden = current === 0;
    overlay.querySelector("#fp-next").hidden = current === items.length - 1;
  }

  async function show() {
    releaseCurrent();
    const att = items[current];
    const myLoad = ++loadId;
    updateChrome();
    const mime = previewMime(att);
    const kind = fileKind(att.mimeType, att.name);
    const downloadBtn = `<button type="button" class="btn btn--primary" data-fp-download>⬇ Descargar</button>`;
    if (!mime) {
      showMessage(att, `<div class="fp-message__icon">${fileIconFor(kind, att.name)}</div><p>No se puede ver aquí este tipo de archivo.</p>${downloadBtn}`);
      return;
    }
    if ((Number(att.size) || 0) > PREVIEW_LIMIT_BYTES) {
      showMessage(att, `<div class="fp-message__icon">${fileIconFor(kind, att.name)}</div><p>Pesa ${escapeHtml(formatBytes(att.size))}: es demasiado grande para verlo aquí.</p>${downloadBtn}`);
      return;
    }
    stage.innerHTML = `
      <div class="fp-message">
        <div class="fp-message__icon">${fileIconFor(kind, att.name)}</div>
        <p id="fp-loading-text">Cargando…</p>
        <div class="file-upload__bar" style="width:220px;"><div class="file-upload__fill" id="fp-loading-bar" style="width:0%"></div></div>
      </div>`;
    controller = new AbortController();
    const mine = controller;
    try {
      const blob = await storage.downloadBlob(att, {
        type: mime,
        signal: mine.signal,
        onProgress: ({ loaded, total }) => {
          if (myLoad !== loadId) return;
          const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          const bar = stage.querySelector("#fp-loading-bar");
          const txt = stage.querySelector("#fp-loading-text");
          if (bar) bar.style.width = `${pct}%`;
          if (txt) txt.textContent = total ? `Cargando… ${pct} %` : "Cargando…";
        },
      });
      if (myLoad !== loadId) return;
      objectUrl = URL.createObjectURL(blob);
      const safeName = escapeHtml(att.name);
      if (mime.startsWith("image/")) stage.innerHTML = `<img class="fp-media" src="${objectUrl}" alt="${safeName}">`;
      else if (mime.startsWith("video/")) stage.innerHTML = `<video class="fp-media" src="${objectUrl}" controls playsinline></video>`;
      else if (mime.startsWith("audio/")) stage.innerHTML = `<div class="fp-message"><div class="fp-message__icon">🎵</div><p>${safeName}</p><audio src="${objectUrl}" controls></audio></div>`;
      else stage.innerHTML = `<iframe class="fp-pdf" src="${objectUrl}" title="${safeName}"></iframe>`;
    } catch (e) {
      if (isAbortError(e) || myLoad !== loadId) return;
      console.error("openFilePreview:", e);
      showMessage(att, `<div class="fp-message__icon">⚠️</div><p>${escapeHtml(e && e.message ? e.message : "No se pudo cargar el archivo.")}</p>${downloadBtn}`);
    }
  }

  function go(delta) {
    const next = current + delta;
    if (next < 0 || next >= items.length) return;
    current = next;
    show();
  }

  function close() {
    releaseCurrent();
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    if (activePreview === api) activePreview = null;
  }

  // En fase de captura y parando la propagación: el modal de la tarea que hay
  // debajo cierra con Esc, y no debe cerrarse junto con el visor.
  function onKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    const tag = e.target && e.target.tagName;
    if (tag === "VIDEO" || tag === "AUDIO" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopImmediatePropagation(); go(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopImmediatePropagation(); go(1); }
  }
  document.addEventListener("keydown", onKeydown, true);

  overlay.querySelector("#fp-close").addEventListener("click", close);
  overlay.querySelector("#fp-prev").addEventListener("click", () => go(-1));
  overlay.querySelector("#fp-next").addEventListener("click", () => go(1));
  overlay.querySelector("#fp-download").addEventListener("click", () => downloadAttachment(items[current], storage));
  stage.addEventListener("click", (e) => { if (e.target === stage) close(); });

  const api = { close };
  activePreview = api;
  show();
  return api;
}
