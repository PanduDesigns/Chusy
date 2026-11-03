// ============================================================================
// Ventana «Importar histórico de ofertas» (v83): se abre desde el panel «Embudo de ofertas» de Métricas
// (solo admin). Se elige un Excel (.xlsx/.xls) o un CSV con una fila por oferta; se ve una VISTA PREVIA
// (cuántas se crean, cuántas ya existían y qué filas tienen errores) y solo al pulsar «Importar» se escribe
// nada. La lectura y planificación son puras (js/offer-import.js); la escritura, data/offer-import.js.
//
// Excel se lee con SheetJS, cargado bajo demanda desde cdnjs como en la exportación del Gantt (no pesa para
// quien no importa); el CSV se lee sin librerías (UTF-8, y Windows-1252 si el archivo salió de un Excel
// antiguo con tildes rotas).
// ============================================================================
import { el, escapeHtml, showToast, uid } from "../utils.js";
import { parseDelimited, parseOfferHistoryRows, planOfferHistoryImport, OFFER_IMPORT_TEMPLATE_CSV, OUTCOME_LABELS } from "../offer-import.js";
import { importHistoricalOffers } from "../data/offer-import.js";
import { ensureXlsx } from "./gantt-export.js";

const PREVIEW_ROWS = 8;
const LIST_LIMIT = 8;
const fmtDate = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** Lee el archivo elegido → matriz de filas (texto/números). Lanza con un mensaje legible si no se puede. */
export async function readTableFromFile(file) {
  const name = String(file.name || "").toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(name)) {
    await ensureXlsx();
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    // La primera hoja que tenga una fila de encabezados reconocible.
    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      if (parseOfferHistoryRows(rows).headerRow >= 0) return rows;
    }
    return window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: "" });
  }
  if (/\.(csv|txt|tsv)$/.test(name)) {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buffer);
    return parseDelimited(text);
  }
  throw new Error("Formato no admitido: usa un archivo .xlsx, .xls o .csv.");
}

export function openOfferImportModal({ offersProject, existing = [], currentUser, onDone }) {
  const root = document.getElementById("modal-root");
  let plan = null;
  let busy = false;

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--wide offer-import">
        <div class="modal__header">
          <h3 style="font-size:16px;">Importar histórico de ofertas</h3>
          <button class="modal__close" id="oi-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Un Excel o CSV con una fila por oferta y estas columnas: <strong>Oferta</strong>, <strong>Comercial</strong>, <strong>Fecha</strong> y <strong>Resultado</strong> (ganada / perdida / entregada / en curso); y, opcionales, <strong>Revisiones</strong>, <strong>Fecha cierre</strong>, <strong>Sector</strong> y <strong>Ubicación</strong>. Lo que ya exista (mismo nombre, día y comercial) se salta, así que puedes repetir la importación sin duplicar.</p>
          <div class="offer-import__pick">
            <input type="file" id="oi-file" accept=".xlsx,.xls,.xlsm,.csv,.txt,.tsv">
            <button type="button" class="btn btn--ghost" id="oi-template">Descargar plantilla (CSV)</button>
          </div>
          <div id="oi-result" class="offer-import__result" aria-live="polite"></div>
        </div>
        <div class="modal__footer">
          <span class="offer-import__progress" id="oi-progress"></span>
          <button class="btn btn--ghost" id="oi-cancel" style="margin-left:auto;">Cerrar</button>
          <button class="btn btn--primary" id="oi-run" disabled>Importar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);

  function close() { document.removeEventListener("keydown", onKeydown); overlay.remove(); }
  function onKeydown(e) { if (e.key === "Escape" && !busy) close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", (e) => { if (e.target === overlay && !busy) close(); });
  $("#oi-close").addEventListener("click", () => { if (!busy) close(); });
  $("#oi-cancel").addEventListener("click", () => { if (!busy) close(); });

  $("#oi-template").addEventListener("click", () => {
    const blob = new Blob(["\uFEFF" + OFFER_IMPORT_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla-historico-ofertas.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function renderPreview(parsed, planned) {
    const result = $("#oi-result");
    if (parsed.missing.length) {
      result.innerHTML = `<p class="offer-import__error">No se encuentran las columnas obligatorias: <strong>${escapeHtml(parsed.missing.join(", "))}</strong>. Revisa la fila de encabezados (o descarga la plantilla).</p>`;
      return;
    }
    if (planned.blocking) { result.innerHTML = `<p class="offer-import__error">${escapeHtml(planned.blocking)}</p>`; return; }
    const list = (items, fmt) => items.slice(0, LIST_LIMIT).map(fmt).join("") + (items.length > LIST_LIMIT ? `<li>…y ${items.length - LIST_LIMIT} más</li>` : "");
    result.innerHTML = `
      <p class="offer-import__summary" id="oi-summary"><strong>${parsed.rowCount}</strong> filas leídas: <strong>${planned.toCreate.length}</strong> nuevas, <strong>${planned.duplicates.length}</strong> ya existentes (se saltan) y <strong>${parsed.errors.length}</strong> con errores (no se importan).</p>
      ${planned.toCreate.length ? `<div class="offer-import__table" role="table" aria-label="Vista previa">
        <div class="offer-import__row offer-import__row--head" role="row"><span>Oferta</span><span>Comercial</span><span>Fecha</span><span>Rev.</span><span>Resultado</span></div>
        ${planned.toCreate.slice(0, PREVIEW_ROWS).map(({ record: r }) => `<div class="offer-import__row" role="row"><span title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</span><span>${escapeHtml(r.commercial || "—")}</span><span>${fmtDate(r.createdAt)}</span><span>${r.revisions}</span><span>${escapeHtml(OUTCOME_LABELS[r.outcome])}</span></div>`).join("")}
        ${planned.toCreate.length > PREVIEW_ROWS ? `<p class="offer-import__more">…y ${planned.toCreate.length - PREVIEW_ROWS} más</p>` : ""}
      </div>` : ""}
      ${parsed.errors.length ? `<div class="offer-import__block offer-import__block--error"><strong>Filas con errores</strong><ul id="oi-errors">${list(parsed.errors, (e) => `<li>Fila ${e.line}: ${escapeHtml(e.message)}</li>`)}</ul></div>` : ""}
      ${parsed.warnings.length ? `<div class="offer-import__block"><strong>Avisos</strong><ul id="oi-warnings">${list(parsed.warnings, (w) => `<li>Fila ${w.line}: ${escapeHtml(w.message)}</li>`)}</ul></div>` : ""}`;
  }

  $("#oi-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    plan = null;
    $("#oi-run").disabled = true;
    $("#oi-run").textContent = "Importar";
    if (!file) { $("#oi-result").innerHTML = ""; return; }
    $("#oi-result").innerHTML = `<p class="field__hint">Leyendo «${escapeHtml(file.name)}»…</p>`;
    try {
      const rows = await readTableFromFile(file);
      const parsed = parseOfferHistoryRows(rows);
      const planned = planOfferHistoryImport(parsed.records, { offersProject, existing, makeId: uid, batchId: `import-${Date.now().toString(36)}` });
      renderPreview(parsed, planned);
      if (!parsed.missing.length && !planned.blocking && planned.toCreate.length) {
        plan = planned;
        $("#oi-run").disabled = false;
        $("#oi-run").textContent = `Importar ${planned.toCreate.length} oferta${planned.toCreate.length === 1 ? "" : "s"}`;
      }
    } catch (err) {
      $("#oi-result").innerHTML = `<p class="offer-import__error">${escapeHtml(err && err.message ? err.message : "No se pudo leer el archivo.")}</p>`;
    }
  });

  $("#oi-run").addEventListener("click", async () => {
    if (!plan || busy) return;
    busy = true;
    const run = $("#oi-run");
    run.disabled = true;
    $("#oi-file").disabled = true;
    try {
      const { created, failed } = await importHistoricalOffers({
        docs: plan.toCreate.map((x) => x.doc),
        createdBy: currentUser.uid,
        onProgress: (done, total) => { $("#oi-progress").textContent = `Importando… ${done} de ${total}`; },
      });
      showToast(failed ? `Se importaron ${created} ofertas; ${failed} no se pudieron guardar (repite la importación: las ya guardadas se saltarán).` : `Histórico importado: ${created} ofertas.`, failed ? "error" : "info");
      busy = false;
      close();
      if (onDone) onDone({ created, failed });
    } catch (err) {
      busy = false;
      run.disabled = false;
      $("#oi-file").disabled = false;
      showToast("No se pudo importar el histórico. Comprueba la conexión.", "error");
    }
  });
}
