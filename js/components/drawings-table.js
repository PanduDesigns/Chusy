// ============================================================================
// Tabla de planos (v96) — la que se ve en la ventana de una OFERTA (task-modal.js, con «Generar
// plano») y en «Convertir oferta en proyecto» / «Propiedades» de un proyecto
// (project-properties-modal.js, con la verificación del plano).
//
//  · drawingsTableHtml / wireDrawingsTable: la tabla en sí (columnas: Código plano, Versión, Tipo de
//    plano, Comentarios, Fecha de creación, Verificado por, Fecha de verificación y, al final, los
//    botones de la fila: copiar el código y, según el sitio, quitar o verificar).
//  · mountDrawingsSection: la tabla + el panel de verificación (quién, cuándo y el documento del
//    plano verificado, que se SUBE a Drive). Solo un plano puede ser «el verificado».
//
// Nada de esto habla con Firestore: quien lo monta guarda el resultado (`getDrawings`/`setDrawings`).
// Los lógica pura (códigos, prefijos, qué es «verificado») está en js/drawings.js.
// ============================================================================
import { escapeHtml, showToast, uid } from "../utils.js";
import { copyText } from "./id-chip.js";
import { drawingTypeLabel, hasVerificationData, isDrawingVerified, withVerification, normalizeDrawings } from "../drawings.js";
import { isAbortError } from "../drive-storage.js";
import { buildDriveAttachment, driveFolderPath, formatBytes } from "../drive-files.js";
import { openFilePreview } from "./file-preview.js";

/** «2026-11-26» o un ISO → «26/11/26»; "" si no hay fecha. Sin pasar por Date para un día suelto (no se corre por la zona horaria). */
export function shortDate(value) {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m && String(value).length === 10) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

const HEAD = ["Código plano", "Versión", "Tipo de plano", "Comentarios", "Fecha de creación", "Verificado por", "Fecha de verificación"];

function verifyButtonHtml(d) {
  const state = isDrawingVerified(d) ? "ok" : hasVerificationData(d) ? "partial" : "none";
  const label = state === "ok" ? "✔ Verificado" : state === "partial" ? "⚠ Completar" : "Marcar verificado";
  const title = state === "none" ? "Este es el plano verificado" : "Ver o cambiar la verificación de este plano";
  return `<button type="button" class="btn btn--ghost btn--sm drawing-verify drawing-verify--${state}" data-dw-verify="${escapeHtml(d.id)}" title="${title}">${label}</button>`;
}

/**
 * `opts`: `removable` (✕ para quitar la fila), `verifiable` (botón de verificar), `selectedId` (la fila cuyo panel
 * está abierto), `emptyText` (qué se dice si no hay planos).
 */
export function drawingsTableHtml(drawings, { removable = false, verifiable = false, selectedId = null, emptyText = "Todavía no hay planos." } = {}) {
  const list = Array.isArray(drawings) ? drawings : [];
  if (!list.length) return `<p class="field__hint" style="margin:0;">${escapeHtml(emptyText)}</p>`;
  return `
    <div class="drawing-table-scroll">
      <div class="drawing-table" role="table" aria-label="Planos">
        <div class="drawing-row drawing-row--head" role="row">${HEAD.map((h) => `<span role="columnheader">${h}</span>`).join("")}<span></span></div>
        ${list
          .map(
            (d) => `
        <div class="drawing-row${d.id === selectedId ? " is-selected" : ""}" role="row" data-drawing-row="${escapeHtml(d.id)}">
          <span class="drawing-row__code" role="cell">${escapeHtml(d.code)}</span>
          <span role="cell">${escapeHtml(d.version)}</span>
          <span role="cell">${escapeHtml(drawingTypeLabel(d.prefix))}</span>
          <span role="cell"><input class="field__input drawing-row__comments" type="text" data-dw-comments="${escapeHtml(d.id)}" value="${escapeHtml(d.comments)}" placeholder="Comentarios…" aria-label="Comentarios de ${escapeHtml(d.code)}"></span>
          <span role="cell" class="drawing-row__date">${escapeHtml(shortDate(d.createdAt))}</span>
          <span role="cell">${escapeHtml(d.verifiedBy)}</span>
          <span role="cell" class="drawing-row__date">${escapeHtml(shortDate(d.verifiedAt))}${d.verifiedFile ? ` <button type="button" class="drawing-file" data-dw-file="${escapeHtml(d.id)}" title="Abrir el plano verificado: ${escapeHtml(d.verifiedFile.name)}">📎</button>` : ""}</span>
          <span class="drawing-row__actions" role="cell">
            <button type="button" class="attachment-btn drawing-copy" data-dw-copy="${escapeHtml(d.code)}" title="Copiar el código ${escapeHtml(d.code)}" aria-label="Copiar el código ${escapeHtml(d.code)}">📋</button>
            ${verifiable ? verifyButtonHtml(d) : ""}
            ${removable ? `<button type="button" class="attachment-row__remove" data-dw-remove="${escapeHtml(d.id)}" title="Quitar este plano de la tabla" aria-label="Quitar ${escapeHtml(d.code)}">✕</button>` : ""}
          </span>
        </div>`
          )
          .join("")}
      </div>
    </div>`;
}

/**
 * Engancha los botones y las casillas de una tabla ya pintada en `root`. Todos los manejadores son opcionales.
 * Escribir en «Comentarios» NO repinta (perdería el foco a mitad de frase).
 */
export function wireDrawingsTable(root, { onComment, onRemove, onVerify, onOpenFile } = {}) {
  root.querySelectorAll("[data-dw-copy]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = btn.dataset.dwCopy;
      const ok = await copyText(code);
      showToast(ok ? `Código ${code} copiado.` : "No se pudo copiar el código.", ok ? "info" : "error");
    });
  });
  root.querySelectorAll("[data-dw-comments]").forEach((input) => {
    input.addEventListener("input", () => { if (onComment) onComment(input.dataset.dwComments, input.value); });
  });
  root.querySelectorAll("[data-dw-remove]").forEach((btn) => {
    btn.addEventListener("click", () => { if (onRemove) onRemove(btn.dataset.dwRemove); });
  });
  root.querySelectorAll("[data-dw-verify]").forEach((btn) => {
    btn.addEventListener("click", () => { if (onVerify) onVerify(btn.dataset.dwVerify); });
  });
  root.querySelectorAll("[data-dw-file]").forEach((btn) => {
    btn.addEventListener("click", () => { if (onOpenFile) onOpenFile(btn.dataset.dwFile); });
  });
}

/**
 * La tabla con el panel de verificación (conversión de una oferta y «Propiedades» de un proyecto).
 *
 * @param {HTMLElement} container
 * @param {object} cfg
 *   getDrawings() / setDrawings(list)  la lista (normalizada) del formulario
 *   getDefaults()                      → { verifiedBy, verifiedAt } con lo que se precarga al elegir el plano
 *   intro                              texto de ayuda sobre la tabla
 *   storage                            el servicio de Drive (isEnabled, maxBytes, uploadFile, trashFiles)
 *   getOwner()                         → { code, name, kind, folderId } | { id, name } | null (de quién es el archivo)
 *   currentUser, taskId                para anotar la subida
 *   onDirty()                          el formulario ha cambiado
 * @returns {{ render, isBusy, finalizeSaved, discardUnsaved, destroy }}
 */
export function mountDrawingsSection(container, { getDrawings, setDrawings, getDefaults, intro = "", storage, getOwner, currentUser, taskId = "", onDirty = () => {} }) {
  let selectedId = (getDrawings().find(hasVerificationData) || {}).id || null;
  let upload = null; // { name, loaded, size, controller, error }
  let destroyed = false;
  const sessionUploaded = new Map(); // driveId → adjunto subido en esta apertura y aún sin guardar
  const pendingTrash = new Set(); // driveIds de planos YA guardados que se han sustituido o quitado: a la papelera al guardar

  const find = (id) => getDrawings().find((d) => d.id === id) || null;
  const update = (id, patch) => setDrawings(getDrawings().map((d) => (d.id === id ? { ...d, ...patch } : d)));

  /** Quita un archivo del plano: si se subió en esta apertura va a la papelera ya; si ya estaba guardado, al guardar. */
  function releaseFile(att) {
    if (!att) return;
    if (sessionUploaded.has(att.driveId)) {
      sessionUploaded.delete(att.driveId);
      storage.trashFiles([att.driveId]);
    } else {
      pendingTrash.add(att.driveId);
    }
  }

  function clearVerification(id) {
    const d = find(id);
    if (!d) return;
    if (upload && upload.planId === id) upload.controller.abort();
    releaseFile(d.verifiedFile);
    setDrawings(withVerification(getDrawings(), id, null));
  }

  function chooseVerified(id) {
    const other = getDrawings().find((d) => d.id !== id && hasVerificationData(d));
    if (other) {
      if (!confirm(`El plano verificado es uno solo. ¿Cambiar de ${other.code} a ${find(id).code}? Se quitará la verificación de ${other.code} (también su documento).`)) return false;
      clearVerification(other.id);
    }
    const d = find(id);
    if (!hasVerificationData(d)) {
      const def = (getDefaults && getDefaults()) || {};
      setDrawings(withVerification(getDrawings(), id, { verifiedBy: def.verifiedBy || "", verifiedAt: def.verifiedAt || null, verifiedFile: null }));
    }
    return true;
  }

  function panelHtml(d) {
    const enabled = !!(storage && storage.isEnabled && storage.isEnabled());
    const file = d.verifiedFile;
    const up = upload && upload.planId === d.id ? upload : null;
    const fileBlock = up
      ? `<span class="drawing-panel__status">${up.error ? `⚠ ${escapeHtml(up.error)}` : `Subiendo «${escapeHtml(up.name)}»… ${up.size ? Math.min(100, Math.round((up.loaded / up.size) * 100)) : 0} %`}</span>${up.error ? "" : `<button type="button" class="btn btn--ghost btn--sm" data-dwp-cancel>Cancelar</button>`}`
      : file
        ? `<span class="drawing-panel__file">📎 <button type="button" class="link-btn" data-dwp-open title="Abrir el plano verificado">${escapeHtml(file.name)}</button> <small>${escapeHtml(formatBytes(file.size))}</small></span>
           <button type="button" class="btn btn--ghost btn--sm" data-dwp-pick ${enabled ? "" : "disabled"}>Cambiar</button>
           <button type="button" class="attachment-row__remove" data-dwp-remove-file title="Quitar el documento">✕</button>`
        : `<button type="button" class="btn btn--ghost btn--sm" data-dwp-pick ${enabled ? "" : "disabled"}>⬆ Subir plano verificado</button>
           <span class="drawing-panel__status">${enabled ? "Aún sin documento." : "El almacenamiento de archivos (Drive) no está activado: no se puede subir."}</span>`;
    return `
      <div class="drawing-panel" data-dw-panel="${escapeHtml(d.id)}">
        <div class="drawing-panel__title">Plano verificado: <b>${escapeHtml(d.code)}</b></div>
        <div class="props-row">
          <label class="field"><span class="field__label">Verificado por</span><input class="field__input" type="text" data-dwp-by value="${escapeHtml(d.verifiedBy)}" placeholder="Nombre de quien lo verificó"></label>
          <label class="field"><span class="field__label">Fecha de verificación</span><input class="field__input" type="date" data-dwp-date value="${escapeHtml(d.verifiedAt || "")}"></label>
        </div>
        <div class="field"><span class="field__label">Documento del plano verificado</span><div class="drawing-panel__file-row">${fileBlock}</div></div>
        <button type="button" class="link-btn" data-dwp-clear>Quitar la verificación de este plano</button>
      </div>`;
  }

  function render() {
    if (destroyed) return;
    const list = getDrawings();
    const sel = selectedId && find(selectedId) ? find(selectedId) : null;
    container.innerHTML = `
      ${intro ? `<p class="field__hint" style="margin:0 0 8px;">${escapeHtml(intro)}</p>` : ""}
      ${drawingsTableHtml(list, { verifiable: true, selectedId: sel ? sel.id : null })}
      ${sel ? panelHtml(sel) : ""}`;
    wireDrawingsTable(container, {
      onComment: (id, value) => { update(id, { comments: value }); onDirty(); },
      onVerify: (id) => {
        if (!chooseVerified(id)) return;
        selectedId = id;
        onDirty();
        render();
        const first = container.querySelector("[data-dwp-by]");
        if (first && !find(id).verifiedBy) first.focus();
      },
      onOpenFile: (id) => { const d = find(id); if (d && d.verifiedFile) openFilePreview({ items: [d.verifiedFile], index: 0, storage }); },
    });
    if (!sel) return;
    const by = container.querySelector("[data-dwp-by]");
    const date = container.querySelector("[data-dwp-date]");
    by.addEventListener("input", () => { update(sel.id, { verifiedBy: by.value }); onDirty(); });
    date.addEventListener("change", () => { update(sel.id, { verifiedAt: date.value || null }); onDirty(); render(); });
    const on = (selector, fn) => { const b = container.querySelector(selector); if (b) b.addEventListener("click", fn); };
    on("[data-dwp-clear]", () => { clearVerification(sel.id); selectedId = null; onDirty(); render(); });
    on("[data-dwp-open]", () => { const d = find(sel.id); if (d && d.verifiedFile) openFilePreview({ items: [d.verifiedFile], index: 0, storage }); });
    on("[data-dwp-remove-file]", () => { const d = find(sel.id); releaseFile(d.verifiedFile); update(sel.id, { verifiedFile: null }); onDirty(); render(); });
    on("[data-dwp-cancel]", () => { if (upload) upload.controller.abort(); });
    on("[data-dwp-pick]", () => pickFile(sel.id));
  }

  function pickFile(planId) {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    input.addEventListener("change", () => { const f = (input.files || [])[0]; input.remove(); if (f && !destroyed) startUpload(planId, f); });
    document.body.appendChild(input);
    input.click();
  }

  async function startUpload(planId, file) {
    if (upload) { showToast("Espera a que termine la subida en curso.", "error"); return; }
    if (storage.maxBytes && file.size > storage.maxBytes()) {
      showToast(`«${file.name}» pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(storage.maxBytes())}.`, "error");
      return;
    }
    const u = { planId, name: file.name, loaded: 0, size: file.size, controller: new AbortController(), error: "" };
    upload = u;
    render();
    let driveId = null;
    try {
      const owner = (getOwner ? await getOwner() : null) || null;
      const out = await storage.uploadFile(file, {
        taskId,
        uid: (currentUser && currentUser.uid) || "",
        folderPath: driveFolderPath({ owner }),
        code: (owner && owner.code) || "",
        signal: u.controller.signal,
        onProgress: ({ loaded }) => { u.loaded = loaded; if (!destroyed) render(); },
      });
      driveId = out.driveId;
      if (destroyed || u.controller.signal.aborted) { storage.trashFiles([driveId]); upload = null; return; }
      const att = buildDriveAttachment({
        id: uid(), name: out.name, driveId, mimeType: out.mimeType, size: out.size,
        uploadedBy: currentUser && currentUser.uid, uploadedByName: currentUser && currentUser.name, uploadedAt: new Date().toISOString(),
      });
      const d = find(planId);
      if (d) releaseFile(d.verifiedFile); // el que hubiera antes se sustituye
      sessionUploaded.set(att.driveId, att);
      update(planId, { verifiedFile: att });
      upload = null;
      onDirty();
    } catch (e) {
      if (driveId) storage.trashFiles([driveId]);
      if (isAbortError(e) || u.controller.signal.aborted) upload = null;
      else { console.error("Subida del plano verificado:", e); u.error = (e && e.message) || "No se pudo subir el archivo."; setTimeout(() => { if (upload === u) { upload = null; render(); } }, 6000); }
    }
    render();
  }

  render();

  return {
    render,
    /** ¿Hay una subida en curso? (el formulario no debe guardar entonces) */
    isBusy: () => !!upload && !upload.error,
    /** El formulario se guardó: lo sustituido o quitado ya guardado va a la papelera de Drive. */
    finalizeSaved() {
      sessionUploaded.clear();
      const ids = [...pendingTrash];
      pendingTrash.clear();
      if (ids.length && storage.isEnabled()) storage.trashFiles(ids);
    },
    /** Se cerró SIN guardar: lo subido en esta apertura va a la papelera de Drive. */
    discardUnsaved() {
      if (upload) upload.controller.abort();
      const ids = [...sessionUploaded.keys()];
      sessionUploaded.clear();
      pendingTrash.clear();
      if (ids.length) storage.trashFiles(ids);
    },
    destroy() { destroyed = true; if (upload) upload.controller.abort(); },
  };
}

// Re-exportado para quien monta la sección y solo necesita normalizar lo leído.
export { normalizeDrawings };
