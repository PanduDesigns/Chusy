// ============================================================================
// «Visualizador de piezas» (v90): la sección transversal de la barra lateral. Un buscador instantáneo de referencias entre
// todos los archivos CAD (.step, .stp, .ipt, .iam) subidos a las tareas, para abrirlos y medirlos en 3D sin entrar en cada
// tarea. La lógica (indexado, emparejamiento .ipt/.iam ↔ STEP y filtros) es pura y vive en js/parts-viewer.js.
//
//   renderPartsViewerView(container, { parts, state, onStateChange, onOpenTask, storage, projects })
//     parts   las piezas ya indexadas (indexUploadedCadParts), sin filtrar; esta vista aplica los filtros del estado
//     state   { search, projectId, sector, availability } — de sesión; `onStateChange` lo recibe SIN repintar la pantalla
//             entera (al teclear no se pierde el foco: solo se repinta la lista de resultados)
// ============================================================================
import { escapeHtml, showToast } from "../utils.js";
import { formatBytes } from "../drive-files.js";
import { projectLocation } from "../location.js";
import { getCadExtension } from "../cad-viewer.js";
import { SECTOR_FILTER_OPTIONS, normalizeSectorFilter } from "../project-properties.js";
import {
  emptyPartsState, filterCadPartsCatalog, collectPartsProjects, hasPartsFilters, normalizePartsAvailability, PARTS_AVAILABILITY_OPTIONS,
} from "../parts-viewer.js";
import { openCadViewerModal } from "../components/cad-viewer-modal.js";
import { downloadAttachment } from "../components/file-preview.js";

/** Tope de tarjetas pintadas de golpe; el buscador y los filtros sirven para acotar. */
export const PARTS_RENDER_LIMIT = 120;

const SECTOR_LABEL = { industria: "Industria", automocion: "Automoción" };

function fileChipHtml(f, i, kind) {
  const ext = (getCadExtension(f.name) || "").toUpperCase();
  return `<button type="button" class="parts-viewer-file parts-viewer-file--${kind}" data-dl="${kind}:${i}" title="Descargar «${escapeHtml(f.name)}»${f.size ? ` (${escapeHtml(formatBytes(f.size))})` : ""}"><span class="parts-viewer-file__ext">${escapeHtml(ext)}</span><span class="parts-viewer-file__name">${escapeHtml(f.name)}</span></button>`;
}

function cardHtml(p) {
  const badge = p.has3d
    ? `<span class="parts-viewer-badge parts-viewer-badge--ok" title="Hay un .STEP/.STP: se puede ver y medir en 3D">3D STEP listo${p.stepSource === "project" ? " · en otra tarea" : ""}</span>`
    : `<span class="parts-viewer-badge parts-viewer-badge--warn" title="Solo está el archivo de Inventor: falta su .STEP para verlo en 3D">Solo .IPT/.IAM</span>`;
  const both = p.hasNative && p.has3d ? `<div class="parts-viewer-card__both">Inventor + modelo 3D STEP listo para medir</div>` : "";
  const sector = SECTOR_LABEL[p.sector] ? `<span class="parts-viewer-card__sector">${escapeHtml(SECTOR_LABEL[p.sector])}</span>` : "";
  const files = p.nativeFiles.map((f, i) => fileChipHtml(f, i, "native")).concat(p.stepFiles.map((f, i) => fileChipHtml(f, i, "step"))).join("");
  return `
    <article class="parts-viewer-card" data-key="${escapeHtml(p.key)}">
      <div class="parts-viewer-card__head">
        <span class="parts-viewer-card__ref" title="${escapeHtml(p.displayName)}">${escapeHtml(p.displayName)}</span>
        ${badge}
      </div>
      <div class="parts-viewer-card__project">
        ${p.projectCode ? `<span class="parts-viewer-card__code">${escapeHtml(p.projectCode)}</span>` : ""}
        <span class="parts-viewer-card__pname">${escapeHtml(p.projectName)}</span>${sector}
      </div>
      <div class="parts-viewer-card__task" title="Tarea">📋 ${escapeHtml(p.taskTitle || "(sin título)")}${p.isComplete ? ` <span class="parts-viewer-card__done">completada</span>` : ""}</div>
      ${both}
      <div class="parts-viewer-card__files">${files}</div>
      <div class="parts-viewer-card__actions">
        <button type="button" class="btn btn--primary btn--sm" data-act="view">👁️ Ver y medir 3D</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="task">Abrir tarea</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="download" title="Descargar ${p.has3d ? "el STEP" : "el archivo de Inventor"}">⬇ Descargar</button>
      </div>
    </article>`;
}

export function renderPartsViewerView(container, { parts = [], state, onStateChange, onOpenTask, storage, projects = [] } = {}) {
  const st = { ...emptyPartsState(), ...(state || {}) };
  st.sector = normalizeSectorFilter(st.sector);
  st.availability = normalizePartsAvailability(st.availability);
  const projectOptions = collectPartsProjects(parts);
  if (st.projectId && !projectOptions.some((p) => p.id === st.projectId)) st.projectId = "";
  const opt = (value, label, selected) => `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const select = (id, label, html) => `<label class="orders-select"><span class="orders-select__label">${label}</span><select class="field__select" id="${id}">${html}</select></label>`;
  const byKey = new Map(parts.map((p) => [p.key, p]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  container.innerHTML = `
    <div class="orders-view parts-viewer">
      <div class="parts-viewer-head">
        <p class="parts-viewer-head__lead">Busca una referencia entre todos los archivos CAD subidos a las tareas y ábrela para verla y medirla en 3D.</p>
        <button type="button" class="btn btn--ghost btn--sm" id="pv-local">📂 Abrir .STEP/.STP local</button>
      </div>
      <div class="orders-filters">
        <div class="orders-search">
          <span class="orders-search__icon" aria-hidden="true">🔍</span>
          <input type="search" class="orders-search__input" id="pv-search" placeholder="Referencia, archivo, código de proyecto (26001), cliente o tarea..." value="${escapeHtml(st.search)}" autocomplete="off" aria-label="Buscar piezas">
          <button type="button" class="orders-search__clear" id="pv-search-clear" aria-label="Limpiar búsqueda" title="Limpiar búsqueda"${st.search ? "" : " hidden"}>×</button>
        </div>
        <div class="orders-selects">
          ${select("pv-project", "Proyecto", opt("", "Todos", !st.projectId) + projectOptions.map((p) => opt(p.id, `${p.code ? p.code + " · " : ""}${p.name}`, p.id === st.projectId)).join(""))}
          ${select("pv-sector", "Sector", SECTOR_FILTER_OPTIONS.map((o) => opt(o.key, o.label, o.key === st.sector)).join(""))}
          ${select("pv-availability", "Disponibilidad 3D", PARTS_AVAILABILITY_OPTIONS.map((o) => opt(o.key, o.label, o.key === st.availability)).join(""))}
          <button type="button" class="filterbar__clear" id="pv-clear" hidden>✕ Limpiar filtros</button>
        </div>
      </div>
      <div class="parts-viewer-count" id="pv-count" aria-live="polite"></div>
      <div class="parts-viewer-grid" id="pv-results"></div>
    </div>`;

  const $ = (id) => container.querySelector(id);
  const results = $("#pv-results");
  const count = $("#pv-count");

  function renderResults() {
    const list = filterCadPartsCatalog(parts, st);
    const shown = list.slice(0, PARTS_RENDER_LIMIT);
    $("#pv-clear").hidden = !hasPartsFilters(st);
    $("#pv-search-clear").hidden = !st.search;
    if (!parts.length) {
      count.textContent = "";
      results.innerHTML = `<div class="parts-viewer-empty">Todavía no hay archivos CAD (.step, .stp, .ipt, .iam) subidos a las tareas. Súbelos desde cualquier tarea y aparecerán aquí.</div>`;
      return;
    }
    count.textContent = list.length === parts.length
      ? `${list.length} ${list.length === 1 ? "pieza" : "piezas"}`
      : `${list.length} de ${parts.length} piezas`;
    if (!list.length) { results.innerHTML = `<div class="parts-viewer-empty">Ninguna pieza coincide con la búsqueda y los filtros.</div>`; return; }
    results.innerHTML = shown.map(cardHtml).join("") + (list.length > shown.length ? `<div class="parts-viewer-empty">Mostrando ${shown.length} de ${list.length}: escribe más de la referencia o usa los filtros para acotar.</div>` : "");
  }

  function change(patch) {
    Object.assign(st, patch);
    if (onStateChange) onStateChange({ ...st });
    renderResults();
  }

  function openPart(p) {
    const attachment = p.primaryStep || p.primaryNative;
    const project = projectById.get(p.projectId);
    openCadViewerModal({
      attachment,
      attachmentsPool: p.nativeFiles.concat(p.stepFiles),
      storage,
      title: p.displayName,
      projectLocation: projectLocation(project),
    });
  }

  $("#pv-search").addEventListener("input", (e) => change({ search: e.target.value }));
  $("#pv-search-clear").addEventListener("click", () => { $("#pv-search").value = ""; change({ search: "" }); $("#pv-search").focus(); });
  $("#pv-project").addEventListener("change", (e) => change({ projectId: e.target.value }));
  $("#pv-sector").addEventListener("change", (e) => change({ sector: e.target.value }));
  $("#pv-availability").addEventListener("change", (e) => change({ availability: e.target.value }));
  $("#pv-clear").addEventListener("click", () => {
    const blank = emptyPartsState();
    $("#pv-search").value = blank.search;
    $("#pv-project").value = "";
    $("#pv-sector").value = blank.sector;
    $("#pv-availability").value = blank.availability;
    change(blank);
  });

  $("#pv-local").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".step,.stp";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) openCadViewerModal({ file });
    });
    document.body.appendChild(input);
    input.click();
  });

  results.addEventListener("click", (e) => {
    const card = e.target.closest(".parts-viewer-card");
    const p = card && byKey.get(card.dataset.key);
    if (!p) return;
    const chip = e.target.closest("[data-dl]");
    if (chip) {
      const [kind, i] = chip.dataset.dl.split(":");
      const att = (kind === "step" ? p.stepFiles : p.nativeFiles)[Number(i)];
      if (att) downloadAttachment(att, storage);
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "view") openPart(p);
    else if (act.dataset.act === "task") { if (onOpenTask) onOpenTask(p.taskId); }
    else if (act.dataset.act === "download") {
      const att = p.primaryStep || p.primaryNative;
      if (att) downloadAttachment(att, storage); else showToast("No hay ningún archivo que descargar.", "error");
    }
  });

  renderResults();
}
