// ============================================================================
// Ventana de PROPIEDADES de un proyecto (v57) — clic derecho en un proyecto
// de la barra lateral → «Propiedades» — y, con el mismo formulario, la
// ventana de CONVERTIR UNA OFERTA EN PROYECTO (botón del modal de la
// oferta, ver task-modal.js).
//
// Los campos son los metadatos de `projects/{id}.properties` (ver
// project-properties.js): Comercial (con sugerencias de lo ya escrito),
// Ubicación, Sector (desplegable Automoción / Industria, v58), Versión
// aprobada, Fecha de entrega, Fecha de envío, Fecha de aprobación (las tres
// fechas también se marcan en la línea de tiempo del proyecto, v58) y un
// histórico del proyecto con el mismo aspecto y el mismo formato de filas
// que el de una oferta.
//
// Como el modal de tarea: nada se guarda hasta pulsar el botón principal,
// y si se cierra con cambios sin guardar se pregunta antes de descartarlos.
// Este archivo no habla con Firestore — quien lo abre le pasa qué hacer al
// confirmar (`onSave` / `onConfirm`).
//
// v60: junto a la etiqueta de «Ubicación» hay un botón «Abrir Ubicación»
// (ver components/open-location.js).
// ============================================================================
import { el, escapeHtml, uid, showToast, toDateInputValue } from "../utils.js";
import { attachTextSuggest } from "./text-suggest.js";
import { createOpenLocationButton } from "./open-location.js";
import { SECTOR_OPTIONS } from "../offers.js";
import {
  PROPERTY_DATE_FIELDS,
  normalizeProperties,
  propertiesForSave,
  nextHistoryVersion,
  propertiesFromOffer,
} from "../project-properties.js";

/** Fecha corta (dd/mm/aa) de una fila del histórico; "" si no hay fecha. */
function formatRowDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

function dateFieldHtml(key, value) {
  const label = PROPERTY_DATE_FIELDS.find((f) => f.key === key).label;
  return `
    <label class="field">
      <span class="field__label">${label}</span>
      <input class="field__input" type="date" id="pp-${key}" value="${toDateInputValue(value)}">
    </label>`;
}

/**
 * El formulario compartido. `nameField` (solo al convertir una oferta):
 * `{ value }` — añade el campo «Nombre del proyecto», obligatorio.
 * `onSubmit({ name, properties })` hace el guardado de verdad; si lanza
 * un error el formulario se queda abierto y avisa.
 */
function openPropertiesForm({ title, intro, nameField, confirmLabel, initial, getCommercialOptions, onSubmit }) {
  const root = document.getElementById("modal-root");
  const state = normalizeProperties(initial);
  let dirty = false;
  let suggestHandle = null;

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">${escapeHtml(title)}</h3>
          <button class="modal__close" id="pp-close" type="button" style="margin-left:auto;">✕</button>
        </div>
        <div class="modal__body">
          ${intro ? `<p class="field__hint" style="margin:0;">${escapeHtml(intro)}</p>` : ""}
          ${!nameField && state.sourceOfferId ? `<p class="field__hint" style="margin:0;">Procede de la oferta «${escapeHtml(state.sourceOfferTitle)}».</p>` : ""}
          ${nameField ? `
          <label class="field">
            <span class="field__label">Nombre del proyecto</span>
            <input class="field__input" id="pp-name" type="text" value="${escapeHtml(nameField.value)}" placeholder="Nombre del proyecto">
          </label>` : ""}
          <div class="props-row props-row--with-action">
            <label class="field">
              <span class="field__label">Comercial</span>
              <input class="field__input" id="pp-comercial" type="text" value="${escapeHtml(state.comercial)}" placeholder="Escribe…">
            </label>
            <div class="field">
              <span class="field__label-row">
                <label class="field__label" for="pp-ubicacion">Ubicación</label>
                <span class="field__label-action" id="pp-open-location-slot"></span>
              </span>
              <input class="field__input" id="pp-ubicacion" type="text" value="${escapeHtml(state.ubicacion)}" placeholder="Escribe…">
            </div>
          </div>
          <div class="props-row">
            <label class="field">
              <span class="field__label">Sector</span>
              <select class="field__select" id="pp-sector">
                <option value="">— Sin definir —</option>
                ${SECTOR_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${state.sector === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span class="field__label">Versión aprobada</span>
              <input class="field__input" id="pp-approvedVersion" type="text" value="${escapeHtml(state.approvedVersion)}" placeholder="A1">
            </label>
          </div>
          <div class="props-row">
            ${PROPERTY_DATE_FIELDS.map(({ key }) => dateFieldHtml(key, state[key])).join("")}
          </div>
          <div id="pp-history"></div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="pp-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="pp-confirm" type="button" style="margin-left:auto;">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  function markDirty() { dirty = true; }

  function close() {
    if (suggestHandle) suggestHandle.destroy();
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function attemptClose() {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
    close();
  }
  function onKeydown(e) { if (e.key === "Escape") attemptClose(); }
  document.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) attemptClose(); });
  overlay.querySelector("#pp-close").addEventListener("click", attemptClose);
  overlay.querySelector("#pp-cancel").addEventListener("click", attemptClose);

  // --- Campos sueltos --------------------------------------------------------
  const comercialInput = overlay.querySelector("#pp-comercial");
  // Sugerencias ANTES que los listeners propios de este input: así el
  // ajuste a la forma ya existente ("juan perez" → "Juan Pérez") ocurre
  // primero y `state.comercial` guarda el valor ya ajustado (ver la
  // cabecera de text-suggest.js).
  if (getCommercialOptions) suggestHandle = attachTextSuggest(comercialInput, { getOptions: getCommercialOptions });
  const syncComercial = (e) => { state.comercial = e.target.value; markDirty(); };
  comercialInput.addEventListener("input", syncComercial);
  comercialInput.addEventListener("change", syncComercial);

  // v60: «Abrir Ubicación» junto a la etiqueta — abre lo que haya escrito en
  // la casilla en este momento (aunque no se haya guardado) y se deshabilita
  // mientras esté vacía. Aquí la etiqueta SÍ es un <label for>: el botón va
  // fuera de ella, en su fila, así que clicar el texto sigue enfocando la casilla.
  const ubicacionInput = overlay.querySelector("#pp-ubicacion");
  const openLocationButton = createOpenLocationButton({ getValue: () => ubicacionInput.value, compact: true });
  overlay.querySelector("#pp-open-location-slot").appendChild(openLocationButton.el);
  ubicacionInput.addEventListener("input", (e) => { state.ubicacion = e.target.value; markDirty(); openLocationButton.refresh(); });
  overlay.querySelector("#pp-sector").addEventListener("change", (e) => { state.sector = e.target.value; markDirty(); });
  overlay.querySelector("#pp-approvedVersion").addEventListener("input", (e) => { state.approvedVersion = e.target.value; markDirty(); });
  PROPERTY_DATE_FIELDS.forEach(({ key }) => {
    overlay.querySelector(`#pp-${key}`).addEventListener("change", (e) => { state[key] = e.target.value || null; markDirty(); });
  });
  if (nameField) overlay.querySelector("#pp-name").addEventListener("input", markDirty);

  // --- Histórico del proyecto ---------------------------------------------------
  // Se vuelve a pintar al añadir/quitar una fila, pero NO al escribir en una
  // casilla (perdería el foco a mitad de frase) — igual que en task-modal.js.
  function renderHistory() {
    const mount = overlay.querySelector("#pp-history");
    mount.innerHTML = `
      <div class="field">
        <span class="field__label-row">
          <span class="field__label">Histórico del proyecto</span>
          <button type="button" class="btn btn--ghost btn--sm" id="pp-new-version" style="margin-left:auto;">+ Nueva versión</button>
        </span>
        ${state.history.length
          ? `<div class="revision-table">
              <div class="revision-row revision-row--head"><span>Versión</span><span>Cambios</span><span></span></div>
              ${state.history
                .map(
                  (r) => `
              <div class="revision-row" data-history-row="${r.id}">
                <div class="revision-row__version">
                  <input class="field__input" type="text" data-h-version="${r.id}" value="${escapeHtml(r.version)}" aria-label="Versión">
                  <span class="revision-row__date">${formatRowDate(r.createdAt)}</span>
                </div>
                <textarea class="field__textarea revision-row__changes" data-h-changes="${r.id}" rows="2" placeholder="¿Qué ha cambiado y por qué?">${escapeHtml(r.changes)}</textarea>
                <button type="button" class="attachment-row__remove" data-h-remove="${r.id}" title="Quitar esta fila del histórico">✕</button>
              </div>`
                )
                .join("")}
            </div>`
          : `<p class="field__hint" style="margin:0;">Sin versiones todavía. Al convertir una oferta en proyecto, su histórico de revisiones se traslada aquí.</p>`}
      </div>`;

    mount.querySelector("#pp-new-version").addEventListener("click", () => {
      const row = { id: uid(), version: nextHistoryVersion(state), changes: "", createdAt: new Date().toISOString() };
      state.history = [...state.history, row];
      markDirty();
      renderHistory();
      const box = overlay.querySelector(`[data-h-changes="${row.id}"]`);
      if (box) {
        box.focus();
        if (typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "nearest" });
      }
    });
    mount.querySelectorAll("[data-h-version]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const row = state.history.find((r) => r.id === input.dataset.hVersion);
        if (row) { row.version = e.target.value; markDirty(); }
      });
    });
    mount.querySelectorAll("[data-h-changes]").forEach((ta) => {
      ta.addEventListener("input", (e) => {
        const row = state.history.find((r) => r.id === ta.dataset.hChanges);
        if (row) { row.changes = e.target.value; markDirty(); }
      });
    });
    mount.querySelectorAll("[data-h-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.history = state.history.filter((r) => r.id !== btn.dataset.hRemove);
        markDirty();
        renderHistory();
      });
    });
  }
  renderHistory();

  // --- Confirmar ------------------------------------------------------------------
  const confirmBtn = overlay.querySelector("#pp-confirm");
  confirmBtn.addEventListener("click", async () => {
    let name = null;
    if (nameField) {
      const nameInput = overlay.querySelector("#pp-name");
      name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Guardando…";
    try {
      await onSubmit({ name, properties: propertiesForSave(state) });
      dirty = false;
      close();
    } catch (e) {
      console.error(e);
      confirmBtn.disabled = false;
      confirmBtn.textContent = confirmLabel;
      alert("No se pudo guardar. Comprueba tu conexión e inténtalo de nuevo.");
    }
  });

  const firstInput = overlay.querySelector(nameField ? "#pp-name" : "#pp-comercial");
  if (firstInput) firstInput.focus();
}

/**
 * «Propiedades» de un proyecto ya existente. `onSave(properties)` recibe el
 * objeto ya limpio, listo para escribir en `projects/{id}.properties`.
 */
export function openProjectPropertiesModal({ project, onSave, getCommercialOptions }) {
  openPropertiesForm({
    title: `Propiedades — ${project.name}`,
    initial: project.properties,
    confirmLabel: "Guardar",
    getCommercialOptions,
    onSubmit: async ({ properties }) => {
      await onSave(properties);
      showToast("Propiedades guardadas.");
    },
  });
}

/**
 * Convertir una oferta en proyecto: el mismo formulario, ya relleno con lo
 * que la oferta tenía (ver propertiesFromOffer) y con el nombre del futuro
 * proyecto. `offer` es la tarea tal como está en Firestore (con su `id`);
 * `today` es "YYYY-MM-DD" (la fecha de aprobación propuesta).
 * `onConfirm({ name, properties })` crea el proyecto de verdad.
 */
export function openOfferConversionModal({ offer, offersProject, today, onConfirm, getCommercialOptions }) {
  const { name, properties } = propertiesFromOffer({ offer, offersProject, today });
  openPropertiesForm({
    title: "Convertir oferta en proyecto",
    intro:
      "Se creará un proyecto nuevo con los datos de la oferta. Revisa las propiedades antes de crearlo — podrás cambiarlas más tarde con «Propiedades» (clic derecho sobre el proyecto). La oferta se marcará como completada y quedará enlazada al proyecto.",
    nameField: { value: name },
    initial: properties,
    confirmLabel: "Crear proyecto",
    getCommercialOptions,
    onSubmit: ({ name: finalName, properties: finalProperties }) => onConfirm({ name: finalName, properties: finalProperties }),
  });
}
