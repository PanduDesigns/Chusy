// ============================================================================
// Archivos en Google Drive (v68): la sección «Archivos» del modal de tarea —
// zona para arrastrar/elegir/pegar archivos, cola de subidas con barra de
// progreso, tarjetas con miniatura, vista previa y descarga. Ver el apartado
// 3.13 del README.
//
// Encaja con la regla del modal («nada se guarda hasta pulsar Aceptar»; ver
// task-modal.js) así:
//   · Un archivo SE SUBE a Drive en cuanto se elige (hay que mandar los bytes
//     y se ve el progreso), pero su ficha solo entra en `draft.attachments`
//     —y por tanto en la tarea— al pulsar Aceptar.
//   · Si se cierra el modal sin guardar, los archivos que se subieron en esta
//     apertura se mandan a la papelera de Drive (discardUnsaved) y las subidas
//     en curso se cancelan.
//   · Quitar un archivo YA guardado en la tarea solo lo quita del formulario;
//     el archivo se manda a la papelera de Drive cuando se guarda
//     (finalizeSaved). Quitar uno subido en esta misma apertura (que nunca
//     llegó a guardarse) lo manda a la papelera al momento.
//
// El componente no sabe nada del modal: recibe callbacks para leer/añadir/quitar
// adjuntos del borrador. Hasta 2 subidas a la vez; el resto espera en cola.
// ============================================================================
import { escapeHtml, showToast, uid } from "../utils.js";
import {
  isDriveAttachment,
  buildDriveAttachment,
  formatBytes,
  fileKind,
  fileIconFor,
  extensionOf,
} from "../drive-files.js";
import { isAbortError } from "../drive-storage.js";
import { makeThumbnailBlob } from "../drive-thumbs.js";
import { openFilePreview, downloadAttachment } from "./file-preview.js";

const MAX_PARALLEL = 2;

function hasFiles(e) {
  const types = e && e.dataTransfer && e.dataTransfer.types;
  return !!types && Array.from(types).includes("Files");
}

function isEditableTarget(t) {
  if (!t || !t.closest) return false;
  return !!t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function createFileAttachments({
  container,
  dropTarget,
  pasteTarget,
  storage,
  getAttachments,
  addAttachment,
  removeAttachment,
  currentUser,
  getTaskId,
  onDirty,
  makeThumbnail = makeThumbnailBlob,
}) {
  const uploads = []; // subidas en curso o con error (las terminadas pasan a ser tarjetas)
  const sessionUploaded = new Map(); // id del adjunto → adjunto, subidos en esta apertura y aún sin guardar
  const pendingTrash = []; // adjuntos ya guardados que se quitaron: a la papelera cuando se guarde
  const thumbUrls = new Map(); // thumbId → dirección blob: ya descargada
  let active = 0;
  let destroyed = false;

  const driveItems = () => (getAttachments() || []).filter(isDriveAttachment);

  // -------------------------------------------------------------------------
  // Pintado
  // -------------------------------------------------------------------------

  function thumbHtml(att) {
    const kind = fileKind(att.mimeType, att.name);
    const url = att.thumbId ? thumbUrls.get(att.thumbId) : null;
    if (url) return `<img src="${escapeHtml(url)}" alt="" draggable="false">`;
    return `<span class="file-card__icon">${fileIconFor(kind, att.name)}</span>`;
  }

  function cardHtml(att, enabled) {
    const meta = [formatBytes(att.size), att.uploadedByName || ""].filter(Boolean).join(" · ");
    const ext = extensionOf(att.name);
    return `
      <div class="file-card${enabled ? "" : " is-disabled"}" data-att-id="${escapeHtml(att.id)}" ${enabled ? 'tabindex="0" title="Ver «' + escapeHtml(att.name) + '»"' : ""}>
        <div class="file-card__thumb" data-thumb-for="${escapeHtml(att.id)}">${thumbHtml(att)}${ext ? `<span class="file-card__ext">${escapeHtml(ext)}</span>` : ""}</div>
        <div class="file-card__body">
          <div class="file-card__name">${escapeHtml(att.name)}</div>
          <div class="file-card__meta">${escapeHtml(meta)}</div>
        </div>
        <div class="file-card__actions">
          ${enabled ? `<button type="button" class="file-card__btn" data-act="download" title="Descargar">⬇</button>` : ""}
          <button type="button" class="file-card__btn file-card__btn--remove" data-act="remove" title="Quitar">✕</button>
        </div>
      </div>`;
  }

  function uploadHtml(u) {
    if (u.status === "error") {
      return `
        <div class="file-upload file-upload--error" data-up-id="${u.id}">
          <div class="file-upload__top">
            <span class="file-upload__name">${escapeHtml(u.name)}</span>
            <button type="button" class="btn btn--ghost btn--sm" data-up-retry>Reintentar</button>
            <button type="button" class="file-card__btn" data-up-dismiss title="Descartar">✕</button>
          </div>
          <div class="file-upload__error">${escapeHtml(u.error)}</div>
        </div>`;
    }
    const pct = u.size ? Math.min(100, Math.round((u.loaded / u.size) * 100)) : 0;
    const label = u.status === "queued" ? "en cola" : u.status === "finishing" ? "terminando…" : `${pct} %`;
    return `
      <div class="file-upload" data-up-id="${u.id}">
        <div class="file-upload__top">
          <span class="file-upload__name">${escapeHtml(u.name)}</span>
          <span class="file-upload__pct">${label}</span>
          <button type="button" class="file-card__btn" data-up-cancel title="Cancelar">✕</button>
        </div>
        <div class="file-upload__bar"><div class="file-upload__fill" style="width:${u.status === "queued" ? 0 : pct}%"></div></div>
      </div>`;
  }

  function render() {
    if (destroyed || !container) return;
    const enabled = storage.isEnabled();
    const items = driveItems();
    if (!enabled && !items.length) { container.innerHTML = ""; return; }
    container.innerHTML = `
      <div class="file-attach">
        ${enabled ? `
        <div class="file-drop" tabindex="0" role="button" aria-label="Añadir archivos">
          <span class="file-drop__icon">⬆</span>
          <span class="file-drop__text"><b>Arrastra archivos aquí</b>, pulsa para elegirlos o pega una captura (Ctrl+V)<br><small>Máximo ${escapeHtml(formatBytes(storage.maxBytes()))} por archivo</small></span>
          <input type="file" multiple hidden>
        </div>` : `<p class="field__hint" style="margin-top:0;">El almacenamiento de archivos está desactivado: los archivos de esta tarea no se pueden ver ni descargar hasta que un administrador lo vuelva a activar.</p>`}
        <div class="file-uploads">${uploads.map(uploadHtml).join("")}</div>
        ${items.length ? `<div class="file-grid">${items.map((a) => cardHtml(a, enabled)).join("")}</div>` : ""}
      </div>`;
    if (enabled) loadThumbs(items);
  }

  function loadThumbs(items) {
    items.forEach((att) => {
      if (!att.thumbId || thumbUrls.has(att.thumbId)) return;
      storage.getThumbUrl(att.thumbId).then(
        (url) => {
          if (destroyed) return;
          thumbUrls.set(att.thumbId, url);
          const box = Array.from(container.querySelectorAll("[data-thumb-for]")).find((n) => n.dataset.thumbFor === att.id);
          if (box) {
            const ext = extensionOf(att.name);
            box.innerHTML = `${thumbHtml(att)}${ext ? `<span class="file-card__ext">${escapeHtml(ext)}</span>` : ""}`;
          }
        },
        () => { /* sin miniatura: se queda el icono */ }
      );
    });
  }

  function updateProgress(u) {
    if (destroyed || !container) return;
    const row = container.querySelector(`[data-up-id="${u.id}"]`);
    if (!row) return;
    const pct = u.size ? Math.min(100, Math.round((u.loaded / u.size) * 100)) : 0;
    const fill = row.querySelector(".file-upload__fill");
    const label = row.querySelector(".file-upload__pct");
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = u.status === "finishing" ? "terminando…" : `${pct} %`;
  }

  // -------------------------------------------------------------------------
  // Subidas
  // -------------------------------------------------------------------------

  function removeUpload(u) {
    const i = uploads.indexOf(u);
    if (i >= 0) uploads.splice(i, 1);
  }

  function enqueue(file) {
    const name = file.name || "archivo";
    if (!file.size) { showToast(`«${name}» está vacío y no se puede subir.`, "error"); return; }
    if (file.size > storage.maxBytes()) {
      showToast(`«${name}» pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(storage.maxBytes())}.`, "error");
      return;
    }
    uploads.push({ id: uid(), file, name, size: file.size, status: "queued", loaded: 0, error: "", canceled: false, controller: new AbortController() });
    if (onDirty) onDirty();
    render();
    pump();
  }

  function addFiles(files) {
    if (!storage.isEnabled()) return;
    Array.from(files || []).forEach((f) => { if (f) enqueue(f); });
  }

  function pump() {
    while (!destroyed && active < MAX_PARALLEL) {
      const next = uploads.find((u) => u.status === "queued");
      if (!next) break;
      run(next);
    }
  }

  async function run(u) {
    active++;
    u.status = "uploading";
    updateProgress(u);
    const taskId = (getTaskId && getTaskId()) || "";
    const uidOfUser = (currentUser && currentUser.uid) || "";
    let driveId = null;
    let thumbId = null;
    try {
      const out = await storage.uploadFile(u.file, {
        taskId,
        uid: uidOfUser,
        signal: u.controller.signal,
        onProgress: ({ loaded }) => { u.loaded = loaded; updateProgress(u); },
      });
      driveId = out.driveId;
      u.status = "finishing";
      updateProgress(u);
      try {
        const blob = await makeThumbnail(u.file);
        if (blob && !u.canceled) {
          const t = await storage.uploadFile(blob, {
            role: "thumb",
            name: `${u.name}.miniatura.jpg`,
            taskId,
            uid: uidOfUser,
            signal: u.controller.signal,
          });
          thumbId = t.driveId;
        }
      } catch (e) {
        /* sin miniatura: no es motivo para fallar */
      }
      if (u.canceled || destroyed) {
        storage.trashFiles([driveId, thumbId].filter(Boolean));
        removeUpload(u);
        return;
      }
      const att = buildDriveAttachment({
        id: uid(),
        name: out.name,
        driveId,
        thumbId,
        mimeType: out.mimeType,
        size: out.size,
        uploadedBy: uidOfUser,
        uploadedByName: currentUser && currentUser.name,
        uploadedAt: new Date().toISOString(),
      });
      sessionUploaded.set(att.id, att);
      addAttachment(att);
      removeUpload(u);
    } catch (e) {
      if (isAbortError(e) || u.canceled) {
        if (driveId) storage.trashFiles([driveId, thumbId].filter(Boolean));
        removeUpload(u);
      } else {
        console.error("Subida de archivo:", e);
        u.status = "error";
        u.error = (e && e.message) || "No se pudo subir el archivo.";
      }
    } finally {
      active--;
      render();
      pump();
    }
  }

  function cancelUpload(u) {
    u.canceled = true;
    if (u.status === "queued" || u.status === "error") { removeUpload(u); render(); return; }
    u.controller.abort();
  }

  function retryUpload(u) {
    u.status = "queued";
    u.error = "";
    u.loaded = 0;
    u.canceled = false;
    u.controller = new AbortController();
    render();
    pump();
  }

  // -------------------------------------------------------------------------
  // Quitar, ver, descargar
  // -------------------------------------------------------------------------

  function removeFile(att) {
    removeAttachment(att.id);
    if (sessionUploaded.has(att.id)) {
      sessionUploaded.delete(att.id);
      storage.trashFiles([att.driveId, att.thumbId].filter(Boolean)); // nunca llegó a guardarse: fuera ya
    } else {
      pendingTrash.push(att); // ya estaba guardado: se manda a la papelera al guardar
    }
    render();
  }

  function openPreview(att) {
    const items = driveItems();
    const index = Math.max(0, items.findIndex((a) => a.id === att.id));
    openFilePreview({ items, index, storage });
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  function attOf(target) {
    const card = target.closest("[data-att-id]");
    if (!card) return null;
    return driveItems().find((a) => a.id === card.dataset.attId) || null;
  }

  function uploadOf(target) {
    const row = target.closest("[data-up-id]");
    return row ? uploads.find((u) => u.id === row.dataset.upId) || null : null;
  }

  function onContainerClick(e) {
    const t = e.target;
    if (t.matches && t.matches('input[type="file"]')) return; // el clic que abre el selector no debe volver a abrirlo
    const upCancel = t.closest("[data-up-cancel]");
    if (upCancel) { const u = uploadOf(t); if (u) cancelUpload(u); return; }
    if (t.closest("[data-up-retry]")) { const u = uploadOf(t); if (u) retryUpload(u); return; }
    if (t.closest("[data-up-dismiss]")) { const u = uploadOf(t); if (u) { removeUpload(u); render(); } return; }
    const act = t.closest("[data-act]");
    if (act) {
      const att = attOf(t);
      if (!att) return;
      if (act.dataset.act === "remove") removeFile(att);
      else if (act.dataset.act === "download") downloadAttachment(att, storage);
      return;
    }
    const drop = t.closest(".file-drop");
    if (drop) { const input = container.querySelector('input[type="file"]'); if (input) input.click(); return; }
    const card = t.closest(".file-card");
    if (card && !card.classList.contains("is-disabled")) { const att = attOf(t); if (att) openPreview(att); }
  }

  function onContainerKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (t.classList && t.classList.contains("file-drop")) {
      e.preventDefault();
      const input = container.querySelector('input[type="file"]');
      if (input) input.click();
    } else if (t.classList && t.classList.contains("file-card")) {
      e.preventDefault();
      const att = attOf(t);
      if (att) openPreview(att);
    }
  }

  function onContainerChange(e) {
    const input = e.target;
    if (input && input.matches && input.matches('input[type="file"]')) {
      addFiles(input.files);
      input.value = "";
    }
  }

  function setOver(on) {
    const z = container && container.querySelector(".file-drop");
    if (z) z.classList.toggle("is-over", on);
  }

  function onDragOver(e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); // sin esto, soltar un archivo FUERA de la zona lo abriría en la pestaña y se perdería el modal
    if (e.dataTransfer) e.dataTransfer.dropEffect = storage.isEnabled() ? "copy" : "none";
    if (storage.isEnabled()) setOver(true);
  }

  function onDragLeave(e) {
    if (dropTarget && e.relatedTarget && dropTarget.contains(e.relatedTarget)) return;
    setOver(false);
  }

  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setOver(false);
    if (!storage.isEnabled()) return;
    const files = [];
    let folders = 0;
    const items = e.dataTransfer.items;
    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      for (const it of Array.from(items)) {
        if (it.kind !== "file") continue;
        const entry = it.webkitGetAsEntry();
        if (entry && entry.isDirectory) { folders++; continue; }
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    } else {
      files.push(...Array.from(e.dataTransfer.files || []));
    }
    if (folders) showToast("Las carpetas no se pueden subir directamente: comprímela en un .zip primero.", "error");
    addFiles(files);
  }

  function onPaste(e) {
    if (!storage.isEnabled()) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length || isEditableTarget(e.target)) return;
    e.preventDefault();
    addFiles(files.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `captura-${stamp()}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
  }

  container.addEventListener("click", onContainerClick);
  container.addEventListener("keydown", onContainerKeydown);
  container.addEventListener("change", onContainerChange);
  if (dropTarget) {
    dropTarget.addEventListener("dragover", onDragOver);
    dropTarget.addEventListener("dragleave", onDragLeave);
    dropTarget.addEventListener("drop", onDrop);
  }
  if (pasteTarget) pasteTarget.addEventListener("paste", onPaste);

  render();

  // -------------------------------------------------------------------------
  // Lo que usa el modal
  // -------------------------------------------------------------------------

  return {
    render,
    /** ¿Hay subidas en cola o en marcha? (el modal no deja guardar mientras tanto) */
    isBusy: () => uploads.some((u) => u.status === "queued" || u.status === "uploading" || u.status === "finishing"),
    /** La tarea se guardó: los archivos quitados van a la papelera de Drive y lo subido ya es definitivo. */
    finalizeSaved() {
      const ids = pendingTrash.flatMap((a) => [a.driveId, a.thumbId]).filter(Boolean);
      pendingTrash.length = 0;
      sessionUploaded.clear();
      if (ids.length) storage.trashFiles(ids);
    },
    /** El modal se cierra SIN guardar: se cancelan las subidas y lo ya subido en esta apertura se manda a la papelera. */
    discardUnsaved() {
      uploads.forEach((u) => { u.canceled = true; if (u.status === "uploading" || u.status === "finishing") u.controller.abort(); });
      uploads.length = 0;
      const ids = [...sessionUploaded.values()].flatMap((a) => [a.driveId, a.thumbId]).filter(Boolean);
      sessionUploaded.clear();
      pendingTrash.length = 0;
      if (ids.length) storage.trashFiles(ids);
    },
    destroy() {
      destroyed = true;
      container.removeEventListener("click", onContainerClick);
      container.removeEventListener("keydown", onContainerKeydown);
      container.removeEventListener("change", onContainerChange);
      if (dropTarget) {
        dropTarget.removeEventListener("dragover", onDragOver);
        dropTarget.removeEventListener("dragleave", onDragLeave);
        dropTarget.removeEventListener("drop", onDrop);
      }
      if (pasteTarget) pasteTarget.removeEventListener("paste", onPaste);
    },
  };
}
