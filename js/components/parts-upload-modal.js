// ============================================================================
// «Subir piezas» (v93): sube archivos CAD (.step, .stp, .ipt, .iam) directamente al «Visualizador de piezas», sin tarea de por
// medio, para enseñárselos a otras personas. Los archivos van a Drive (como cualquier adjunto) y quedan anotados en `cadParts`.
//
//   openPartsUploadModal({ storage, currentUser, projects, onSaved, deps })
//     storage       el servicio de Drive (uploadFile, trashFiles, isEnabled)
//     projects      proyectos activos entre los que (opcionalmente) elegir uno: la pieza sale con su código y sector
//     onSaved(id)   se llama al guardarse la subida
//     deps          solo para pruebas: { createEntry }
//   Devuelve { close, ready }.
// ============================================================================
import { el, escapeHtml, showToast, uid } from "../utils.js";
import { formatBytes, buildDriveAttachment } from "../drive-files.js";
import { isAbortError } from "../drive-storage.js";
import { partitionUploadBatch } from "../cad-viewer.js";
import { projectSectorKey } from "../project-properties.js";
import { LIBRARY_ACCEPT, validateLibraryFiles, libraryFolderPath, LIBRARY_TITLE_MAX } from "../parts-library.js";
import { createCadPart } from "../data/cad-parts.js";

export function openPartsUploadModal({ storage, currentUser, projects = [], onSaved, deps = {} } = {}) {
  const root = document.getElementById("modal-root");
  const createEntry = deps.createEntry || createCadPart;
  const projectList = (projects || []).filter((p) => p && !p.exclusive && !p.archived).sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "es") || String(a.name || "").localeCompare(String(b.name || ""), "es"));
  /** items: { id, file, status: 'ready'|'uploading'|'error', loaded, error, controller } */
  let items = [];
  let busy = false;
  let closed = false;

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal parts-upload" role="dialog" aria-modal="true" aria-label="Subir piezas al visualizador">
        <div class="modal__header">
          <h3 style="font-size:16px;">⬆ Subir piezas al visualizador</h3>
          <button type="button" class="modal__close" id="pu-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Sube archivos CAD (.step, .stp, .ipt, .iam) para enseñárselos al resto del equipo sin crear una tarea. Para verlas y medirlas en 3D hace falta el .STEP/.STP de cada pieza.</p>
          <div class="parts-upload__drop" id="pu-drop" tabindex="0" role="button" aria-label="Elegir archivos CAD">
            <strong>Arrastra aquí tus archivos CAD</strong>
            <span>o <u>elígelos desde tu equipo</u></span>
          </div>
          <input type="file" id="pu-input" accept="${LIBRARY_ACCEPT}" multiple hidden>
          <ul class="parts-upload__files" id="pu-files"></ul>
          <div class="parts-upload__warn" id="pu-warn" hidden></div>
          <div class="parts-upload__fields">
            <label class="field">
              <span class="field__label">Nombre o nota (opcional)</span>
              <input class="field__input" id="pu-title" maxlength="${LIBRARY_TITLE_MAX}" placeholder="Ej. Soporte de pistola, revisión B" autocomplete="off">
            </label>
            <label class="field">
              <span class="field__label">Proyecto (opcional)</span>
              <select class="field__select" id="pu-project">
                <option value="">Sin proyecto</option>
                ${projectList.map((p) => `<option value="${escapeHtml(p.id)}">${p.code ? escapeHtml(p.code) + " · " : ""}${escapeHtml(p.name || "")}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span class="field__label">Sector (opcional)</span>
              <select class="field__select" id="pu-sector">
                <option value="">Sin indicar</option>
                <option value="industria">Industria</option>
                <option value="automocion">Automoción</option>
              </select>
            </label>
          </div>
        </div>
        <div class="modal__footer">
          <span class="parts-upload__status" id="pu-status" aria-live="polite"></span>
          <button type="button" class="btn btn--ghost" id="pu-cancel" style="margin-left:auto;">Cancelar</button>
          <button type="button" class="btn btn--primary" id="pu-save" disabled>Subir</button>
        </div>
      </div>
    </div>`);
  root.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);

  function renderFiles() {
    $("#pu-files").innerHTML = items.map((it) => {
      const pct = it.file.size ? Math.min(100, Math.round(((it.loaded || 0) / it.file.size) * 100)) : 0;
      const state = it.status === "uploading" ? `<span class="parts-upload__pct">${pct}%</span>` : it.status === "error" ? `<span class="parts-upload__err" title="${escapeHtml(it.error || "")}">⚠ ${escapeHtml(it.error || "Error")}</span>` : `<span class="parts-upload__size">${escapeHtml(formatBytes(it.file.size))}</span>`;
      return `<li class="parts-upload__file is-${it.status}" data-id="${it.id}">
        <span class="parts-upload__name">${escapeHtml(it.file.name)}</span>${state}
        ${busy ? "" : `<button type="button" class="parts-upload__rm" data-rm="${it.id}" aria-label="Quitar ${escapeHtml(it.file.name)}" title="Quitar">✕</button>`}
        ${it.status === "uploading" ? `<span class="parts-upload__bar"><span style="width:${pct}%"></span></span>` : ""}
      </li>`;
    }).join("");
    $("#pu-files").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { items = items.filter((x) => x.id !== b.dataset.rm); renderFiles(); }));
    const { needsStep } = partitionUploadBatch(items.map((i) => i.file), []);
    const warn = $("#pu-warn");
    warn.hidden = !needsStep.length;
    warn.textContent = needsStep.length ? `Sin su .STEP/.STP no se podrán ver en 3D: ${needsStep.map((f) => f.name).join(", ")}. Puedes subirlas igualmente y añadir el STEP más tarde.` : "";
    $("#pu-save").disabled = busy || !items.length;
    $("#pu-save").textContent = items.some((i) => i.status === "error") ? "Reintentar" : "Subir";
    $("#pu-status").textContent = items.length ? `${items.length} ${items.length === 1 ? "archivo" : "archivos"}` : "";
  }

  function addFiles(fileList) {
    const { accepted, rejected } = validateLibraryFiles(fileList);
    const have = new Set(items.map((i) => i.file.name.toLowerCase()));
    accepted.forEach((f) => { if (!have.has(f.name.toLowerCase())) items.push({ id: uid(), file: f, status: "ready", loaded: 0 }); });
    if (rejected.length) showToast(`${rejected.length === 1 ? "Un archivo no se añadió" : rejected.length + " archivos no se añadieron"}: ${rejected.map((r) => `${r.name} (${r.reason})`).join(" · ")}`, "error");
    renderFiles();
  }

  const drop = $("#pu-drop");
  const input = $("#pu-input");
  drop.addEventListener("click", () => { if (!busy) input.click(); });
  drop.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => { if (!busy && e.dataTransfer) addFiles(e.dataTransfer.files); });
  $("#pu-project").addEventListener("change", (e) => {
    const p = projectList.find((x) => x.id === e.target.value);
    if (p && !$("#pu-sector").value) $("#pu-sector").value = projectSectorKey(p) || "";
  });

  function close() {
    if (closed) return;
    closed = true;
    items.forEach((i) => { if (i.controller) i.controller.abort(); });
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  document.addEventListener("keydown", onKeydown);
  $("#pu-close").addEventListener("click", close);
  $("#pu-cancel").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && !busy) close(); });

  async function save() {
    if (busy || !items.length) return;
    if (!storage || !storage.isEnabled || !storage.isEnabled()) { showToast("El almacenamiento de archivos (Drive) no está activado: pídeselo a un administrador.", "error"); return; }
    busy = true;
    const project = projectList.find((p) => p.id === $("#pu-project").value) || null;
    const folderPath = libraryFolderPath({ project });
    const code = (project && project.code) || "";
    const uploaded = [];
    renderFiles();
    for (const it of items.slice()) {
      if (closed) return;
      it.status = "uploading"; it.loaded = 0; it.error = ""; it.controller = new AbortController();
      renderFiles();
      try {
        const out = await storage.uploadFile(it.file, {
          taskId: "", uid: currentUser && currentUser.uid, folderPath, code, signal: it.controller.signal,
          onProgress: ({ loaded }) => { it.loaded = loaded; renderFiles(); },
        });
        uploaded.push({ it, att: buildDriveAttachment({
          id: uid(), name: out.name, driveId: out.driveId, mimeType: out.mimeType, size: out.size,
          uploadedBy: currentUser && currentUser.uid, uploadedByName: currentUser && currentUser.name, uploadedAt: new Date().toISOString(),
        }) });
      } catch (e) {
        if (isAbortError(e) || closed) return;
        it.status = "error"; it.error = (e && e.message) || "No se pudo subir.";
      } finally { it.controller = null; }
    }
    if (closed) return;
    if (uploaded.length) {
      try {
        const id = await createEntry({
          attachments: uploaded.map((u) => u.att), title: $("#pu-title").value, projectId: project ? project.id : "", sector: $("#pu-sector").value, user: currentUser,
        });
        items = items.filter((i) => !uploaded.some((u) => u.it === i));
        showToast(`${uploaded.length} ${uploaded.length === 1 ? "archivo subido" : "archivos subidos"} al visualizador.`);
        if (onSaved) onSaved(id);
      } catch (e) {
        console.error("parts-upload:", e);
        // Sin el documento de `cadParts` los archivos subidos quedarían huérfanos en Drive: se mandan a la papelera y se vuelve a intentar.
        storage.trashFiles(uploaded.map((u) => u.att.driveId));
        uploaded.forEach((u) => { u.it.status = "error"; u.it.error = "No se pudo guardar la subida."; });
        showToast("No se pudo guardar la subida. Inténtalo de nuevo.", "error");
      }
    }
    busy = false;
    if (!items.length) { close(); return; }
    renderFiles();
  }
  $("#pu-save").addEventListener("click", save);
  renderFiles();
  return { close, ready: Promise.resolve() };
}
