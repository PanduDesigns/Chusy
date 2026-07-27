// ============================================================================
// Modal: definir los campos personalizados de un proyecto. Tres tipos:
// lista (opciones predefinidas), número y texto libre. Se editan en
// cualquier momento desde el menú contextual del proyecto — no hace falta
// decidirlos al crearlo.
// ============================================================================
import { el, uid, escapeHtml } from "../utils.js";
import { updateProject } from "../data/projects.js";

const TYPE_LABELS = { lista: "Lista de opciones", numero: "Número", texto: "Texto libre" };

export function openCustomFieldsModal({ project }) {
  const root = document.getElementById("modal-root");
  let fields = (project.customFieldDefs || []).map((f) => ({
    ...f,
    type: f.type || "lista",
    optionsText: (f.options || []).join(", "),
  }));

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--sm">
        <div class="modal__header">
          <h3 style="font-size:16px;">Campos personalizados</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Se podrán rellenar en cada tarea de este proyecto y usarse como columna y como filtro.</p>
          <div id="cf-list" style="display:flex;flex-direction:column;gap:14px;"></div>
          <button class="btn btn--ghost btn--sm" id="cf-add" type="button" style="width:fit-content;">+ Añadir campo</button>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel">Cancelar</button>
          <button class="btn btn--primary" id="save" style="margin-left:auto;">Guardar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  function renderFields() {
    const list = overlay.querySelector("#cf-list");
    if (!fields.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Sin campos todavía.</p>`;
      return;
    }
    list.innerHTML = fields
      .map(
        (f) => `
      <div data-field="${f.id}" style="border:1px solid var(--color-line);border-radius:var(--radius-sm);padding:10px;display:flex;flex-direction:column;gap:8px;">
        <div class="modal-row" style="gap:8px;">
          <label class="field" style="flex:1.3;">
            <span class="field__label">Nombre</span>
            <input class="field__input cf-name" value="${escapeHtml(f.name)}" placeholder="Ej. Cliente">
          </label>
          <label class="field" style="flex:1;">
            <span class="field__label">Tipo</span>
            <select class="field__select cf-type">
              ${Object.entries(TYPE_LABELS).map(([val, label]) => `<option value="${val}" ${f.type === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <button class="subtask-row__remove" data-remove="${f.id}" type="button" style="margin-bottom:10px;">✕</button>
        </div>
        <label class="field cf-options-wrap" style="${f.type === "lista" ? "" : "display:none;"}">
          <span class="field__label">Opciones (separadas por comas)</span>
          <input class="field__input cf-options" value="${escapeHtml(f.optionsText)}" placeholder="Ej. Talgo, Stelia, Togg">
        </label>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-field]").forEach((row) => {
      const id = row.dataset.field;
      row.querySelector(".cf-name").addEventListener("input", (e) => {
        const f = fields.find((f) => f.id === id);
        if (f) f.name = e.target.value;
      });
      row.querySelector(".cf-type").addEventListener("change", (e) => {
        const f = fields.find((f) => f.id === id);
        if (f) f.type = e.target.value;
        row.querySelector(".cf-options-wrap").style.display = e.target.value === "lista" ? "" : "none";
      });
      const optionsInput = row.querySelector(".cf-options");
      if (optionsInput) {
        optionsInput.addEventListener("input", (e) => {
          const f = fields.find((f) => f.id === id);
          if (f) f.optionsText = e.target.value;
        });
      }
    });
    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        fields = fields.filter((f) => f.id !== btn.dataset.remove);
        renderFields();
      });
    });
  }
  renderFields();

  overlay.querySelector("#cf-add").addEventListener("click", () => {
    fields.push({ id: uid(), name: "", type: "lista", optionsText: "" });
    renderFields();
  });

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector("#save").addEventListener("click", async () => {
    const cleaned = fields
      .map((f) => ({
        id: f.id,
        name: f.name.trim(),
        type: f.type || "lista",
        options: f.type === "lista" ? f.optionsText.split(",").map((o) => o.trim()).filter(Boolean) : [],
      }))
      .filter((f) => f.name && (f.type !== "lista" || f.options.length));
    const saveBtn = overlay.querySelector("#save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";
    try {
      await updateProject(project.id, { customFieldDefs: cleaned });
      close();
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
    }
  });
}
