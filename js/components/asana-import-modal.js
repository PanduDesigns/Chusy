// ============================================================================
// Modal (solo administradores): importador de Asana. Vive dentro del menú
// de administración — nadie que no sea admin llega a verlo, que es lo que
// lo hace "secreto".
//
// Tres piezas en un mismo panel:
//  1. Cargar un archivo de export y ver un resumen de qué trae y cuánto de
//     eso es nuevo frente a lo que ya se importó antes.
//  2. La tabla de equivalencias: cada persona de Asana vista hasta ahora
//     (en este archivo o en uno anterior) con un selector para decir qué
//     cuenta real de Chusy es, o dejarla como ficticia.
//  3. Una zona de riesgo para borrar de un tirón una importación de prueba.
// ============================================================================
import { el, escapeHtml, initials, colorFromString, showToast } from "../utils.js";
import {
  parseAsanaExport,
  getUserMap,
  getImportIndex,
  diffAgainstIndex,
  runImport,
  applyUserMapping,
  wipeImportedData,
} from "../data/asana-import.js";

export function openAsanaImportModal({ teamMembers, currentUser }) {
  const root = document.getElementById("modal-root");

  const state = {
    loading: true,
    userMap: {},
    index: { projects: {}, tasks: {}, comments: {} },
    parsed: null,
    diff: null,
    lastResult: null,
    fileName: "",
    fileError: "",
    busy: false,
    statusMsg: "",
  };

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Importar desde Asana</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body" id="ai-body"></div>
        <div class="modal__footer" id="ai-footer"></div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  const bodyEl = overlay.querySelector("#ai-body");
  const footerEl = overlay.querySelector("#ai-footer");

  function close() {
    if (state.busy) return;
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  function knownAsanaPeople() {
    const byGid = new Map();
    teamMembers.filter((m) => m.isImported && m.asanaGid).forEach((m) => {
      byGid.set(m.asanaGid, { gid: m.asanaGid, name: m.name, email: m.email });
    });
    (state.parsed?.asanaUsers || []).forEach((u) => {
      if (!byGid.has(u.gid)) byGid.set(u.gid, u);
    });
    return [...byGid.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  function suggestedRealUid(person) {
    if (!person.email) return "";
    const match = teamMembers.find((m) => !m.isImported && (m.email || "").toLowerCase() === person.email.toLowerCase());
    return match ? match.uid : "";
  }

  function totalImportedCount() {
    return Object.keys(state.index.projects || {}).length + Object.keys(state.index.tasks || {}).length;
  }

  function render() {
    const scrollTop = bodyEl.scrollTop;
    bodyEl.innerHTML = renderBody();
    footerEl.innerHTML = renderFooter();
    attachListeners();
    bodyEl.scrollTop = scrollTop;
  }

  function renderBody() {
    if (state.loading) {
      return `<p style="font-size:13px;color:var(--color-text-faint);">Cargando estado de importaciones anteriores…</p>`;
    }

    const people = knownAsanaPeople();
    const realOptions = teamMembers.filter((m) => !m.isImported);

    const uploadBlock = `
      <div class="field">
        <span class="field__label">Archivo de export (.json)</span>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="file" accept=".json,application/json" id="ai-file-input" style="display:none;">
          <button type="button" class="btn btn--ghost btn--sm" id="ai-choose-file" ${state.busy ? "disabled" : ""}>Elegir archivo…</button>
          <span style="font-size:12.5px;color:var(--color-text-faint);">${escapeHtml(state.fileName || "Ningún archivo cargado")}</span>
        </div>
        ${state.fileError ? `<p class="field__error">${escapeHtml(state.fileError)}</p>` : ""}
      </div>`;

    const summaryBlock = state.parsed
      ? `
      <div style="background:var(--color-void-raised);border:1px solid var(--color-line);border-radius:var(--radius-sm);padding:12px 14px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">Resumen del archivo${state.parsed.exportedAt ? ` <span style="font-weight:400;color:var(--color-text-faint);">· exportado ${escapeHtml(new Date(state.parsed.exportedAt).toLocaleDateString("es-ES"))}</span>` : ""}</div>
        <div style="font-size:12.5px;color:var(--color-text-lo);line-height:1.8;">
          ${state.parsed.summary.projects} proyectos (${state.parsed.summary.projectsArchived} archivados) · <strong>${state.diff.newProjects} nuevos</strong>, ${state.diff.existingProjects} ya importados<br>
          ${state.parsed.summary.tasks} tareas (${state.parsed.summary.subtasks} eran subtareas, ${state.parsed.summary.milestones} hitos, ${state.parsed.summary.personal} sin proyecto) · <strong>${state.diff.newTasks} nuevas</strong>, ${state.diff.existingTasks} ya importadas<br>
          ${state.parsed.summary.comments} comentarios · <strong>${state.diff.newComments} nuevos</strong>, ${state.diff.existingComments} ya importados<br>
          ${state.parsed.summary.users} personas de Asana
        </div>
        ${state.parsed.warnings.length ? `<p class="field__hint" style="color:var(--color-warning);margin-top:6px;">⚠ ${escapeHtml(state.parsed.warnings[0])}${state.parsed.warnings.length > 1 ? ` (+${state.parsed.warnings.length - 1} aviso(s) más)` : ""}</p>` : ""}
      </div>`
      : "";

    const resultBlock = state.lastResult
      ? `
      <div style="background:var(--color-success-soft);border:1px solid var(--color-success);border-radius:var(--radius-sm);padding:10px 14px;font-size:12.5px;color:var(--color-text-hi);">
        Importado: ${state.lastResult.projectsCreated} proyectos, ${state.lastResult.tasksCreated} tareas y ${state.lastResult.commentsCreated} comentarios nuevos.
        ${state.lastResult.projectsSkipped + state.lastResult.tasksSkipped > 0 ? ` (el resto ya estaba importado de antes, no se ha duplicado)` : ""}
      </div>`
      : "";

    const mappingRows = people.length
      ? people
          .map((p) => {
            const mappedUid = state.userMap[p.gid];
            const mapped = mappedUid ? teamMembers.find((m) => m.uid === mappedUid) : null;
            const suggestion = !mappedUid ? suggestedRealUid(p) : "";
            return `
            <div class="list-row" style="grid-template-columns:1fr 1fr 84px;align-items:center;" data-gid="${p.gid}">
              <span class="list-row__title-cell">
                <span class="avatar avatar--sm" style="background:${colorFromString(p.gid)}">${initials(p.name)}</span>
                <span style="min-width:0;">
                  <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</div>
                  <div style="font-size:11px;color:var(--color-text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.email || "")}</div>
                </span>
              </span>
              ${
                mapped
                  ? `<span style="font-size:12.5px;color:var(--color-success);">→ ${escapeHtml(mapped.name || mapped.email)}</span>`
                  : `<select class="field__select ai-map-select" data-gid="${p.gid}" ${state.busy ? "disabled" : ""}>
                       <option value="">— Usuario ficticio —</option>
                       ${realOptions.map((m) => `<option value="${m.uid}" ${suggestion === m.uid ? "selected" : ""}>${escapeHtml(m.name || m.email)}</option>`).join("")}
                     </select>`
              }
              ${
                mapped
                  ? `<span></span>`
                  : `<button type="button" class="btn btn--ghost btn--sm ai-apply-btn" data-gid="${p.gid}" ${suggestion ? "" : "disabled"}>Aplicar</button>`
              }
            </div>`;
          })
          .join("")
      : `<p style="font-size:12.5px;color:var(--color-text-faint);">Carga un archivo para ver las personas de Asana.</p>`;

    const mappingBlock = `
      <div>
        <span class="field__label" style="font-size:13px;">Equivalencias de personas${people.length ? ` (${people.length})` : ""}</span>
        <p class="field__hint">Las que no tengan una cuenta real seleccionada quedan como "usuarios ficticios": sus tareas y comentarios se ven igual, pero no pueden entrar en Chusy ni se ofrecen al asignar tareas nuevas.</p>
        <div class="list-table__header" style="grid-template-columns:1fr 1fr 84px;margin-top:8px;">
          <span class="list-table__col" style="cursor:default;">Persona (Asana)</span>
          <span class="list-table__col" style="cursor:default;">Cuenta real en Chusy</span>
          <span class="list-table__col" style="cursor:default;"></span>
        </div>
        <div id="ai-mapping-list" style="display:flex;flex-direction:column;gap:4px;">${mappingRows}</div>
      </div>`;

    const dangerBlock = `
      <div>
        <span class="field__label" style="font-size:13px;color:var(--color-danger);">Zona de riesgo</span>
        <p class="field__hint">Borra todo lo importado hasta ahora (proyectos, tareas, comentarios y personas ficticias sin fusionar) para volver a empezar de cero antes de la importación definitiva. No toca nada que no esté marcado como importado de Asana.</p>
        <button type="button" class="btn btn--danger btn--sm" id="ai-wipe" ${totalImportedCount() === 0 || state.busy ? "disabled" : ""}>Borrar todo lo importado${totalImportedCount() ? ` (${totalImportedCount()})` : ""}</button>
      </div>`;

    return [
      uploadBlock,
      summaryBlock,
      resultBlock,
      state.statusMsg ? `<p style="font-size:12.5px;color:var(--color-text-faint);">${escapeHtml(state.statusMsg)}</p>` : "",
      `<div style="border-top:1px solid var(--color-line);"></div>`,
      mappingBlock,
      `<div style="border-top:1px solid var(--color-line);"></div>`,
      dangerBlock,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function renderFooter() {
    const newCount = state.diff ? state.diff.newProjects + state.diff.newTasks + state.diff.newComments : 0;
    const canConfirm = state.parsed && !state.busy && newCount > 0;
    return `
      <button type="button" class="btn btn--ghost" id="cancel" ${state.busy ? "disabled" : ""}>Cerrar</button>
      <button type="button" class="btn btn--primary" id="ai-confirm" style="margin-left:auto;" ${canConfirm ? "" : "disabled"}>
        ${state.busy ? "Importando…" : state.parsed ? `Confirmar importación${newCount ? ` (${newCount} nuevos)` : " (nada nuevo)"}` : "Confirmar importación"}
      </button>`;
  }

  function attachListeners() {
    overlay.querySelector("#cancel")?.addEventListener("click", close);

    overlay.querySelector("#ai-choose-file")?.addEventListener("click", () => {
      overlay.querySelector("#ai-file-input").click();
    });
    overlay.querySelector("#ai-file-input")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      state.fileError = "";
      state.fileName = file.name;
      try {
        const text = await file.text();
        state.parsed = parseAsanaExport(text);
        state.diff = diffAgainstIndex(state.parsed, state.index);
        state.lastResult = null;
      } catch (err) {
        state.fileError = err.message || "No se pudo leer el archivo.";
        state.parsed = null;
        state.diff = null;
      }
      render();
    });

    overlay.querySelectorAll(".ai-map-select").forEach((select) => {
      select.addEventListener("change", () => {
        const btn = overlay.querySelector(`.ai-apply-btn[data-gid="${select.dataset.gid}"]`);
        if (btn) btn.disabled = !select.value;
      });
    });

    overlay.querySelectorAll(".ai-apply-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const gid = btn.dataset.gid;
        const select = overlay.querySelector(`.ai-map-select[data-gid="${gid}"]`);
        const targetUid = select?.value;
        if (!targetUid) return;
        btn.disabled = true;
        btn.textContent = "Aplicando…";
        try {
          const result = await applyUserMapping({ asanaGid: gid, targetUid, teamMembers });
          state.userMap[gid] = targetUid;
          showToast(`Equivalencia aplicada: ${result.tasksUpdated} tareas y ${result.commentsUpdated} comentarios reasignados.`);
          render();
        } catch (err) {
          showToast(err.message || "No se pudo aplicar la equivalencia.", "error");
          btn.disabled = false;
          btn.textContent = "Aplicar";
        }
      });
    });

    overlay.querySelector("#ai-confirm")?.addEventListener("click", async () => {
      if (!state.parsed || state.busy) return;
      state.busy = true;
      state.statusMsg = "Empezando…";
      render();
      try {
        const result = await runImport(state.parsed, {
          currentUser,
          teamMembers,
          userMap: state.userMap,
          onProgress: (msg) => { state.statusMsg = msg; render(); },
        });
        state.lastResult = result;
        state.index = await getImportIndex();
        state.diff = diffAgainstIndex(state.parsed, state.index);
        showToast("Importación completada.");
      } catch (err) {
        showToast(err.message || "Ha fallado la importación. Revisa las reglas de Firestore.", "error");
      }
      state.busy = false;
      state.statusMsg = "";
      render();
    });

    overlay.querySelector("#ai-wipe")?.addEventListener("click", async () => {
      const count = totalImportedCount();
      const ok = confirm(
        `Esto va a borrar ${count} elementos importados (proyectos y tareas, con sus comentarios) y las personas ficticias sin fusionar todavía. No afecta a nada creado a mano en Chusy. ¿Seguro que quieres continuar?`
      );
      if (!ok) return;
      state.busy = true;
      state.statusMsg = "Borrando datos importados…";
      render();
      try {
        const ficticiousUserIds = teamMembers.filter((m) => m.isImported && !m.mergedInto).map((m) => m.uid);
        const result = await wipeImportedData({ ficticiousUserIds });
        state.index = { projects: {}, tasks: {}, comments: {} };
        state.userMap = {};
        if (state.parsed) state.diff = diffAgainstIndex(state.parsed, state.index);
        state.lastResult = null;
        showToast(`Borrado: ${result.projectsDeleted} proyectos, ${result.tasksDeleted} tareas, ${result.commentsDeleted} comentarios.`);
      } catch (err) {
        showToast(err.message || "No se pudo borrar todo. Revisa las reglas de Firestore.", "error");
      }
      state.busy = false;
      state.statusMsg = "";
      render();
    });
  }

  render();

  Promise.all([getUserMap(), getImportIndex()])
    .then(([userMap, index]) => {
      state.userMap = userMap;
      state.index = index;
      state.loading = false;
      render();
    })
    .catch(() => {
      state.loading = false;
      state.fileError = "No se pudo cargar el estado de importaciones anteriores.";
      render();
    });
}
