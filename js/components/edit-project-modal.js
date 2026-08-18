// ============================================================================
// Modal: editar un proyecto ya creado (nombre, icono y color). Las secciones
// del tablero y la descripción se quedan fuera de este modal a propósito,
// para mantenerlo rápido de usar; se pueden seguir tocando desde sus propios
// sitios (campos personalizados, tablero, etc.).
// ============================================================================
import { el, escapeHtml } from "../utils.js";
import { mountAppearancePicker } from "./project-appearance-picker.js";

export function openEditProjectModal({ project, onSave }) {
  const root = document.getElementById("modal-root");
  let appearance = { icon: project.icon, color: project.color };

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--sm">
        <div class="modal__header">
          <h3 style="font-size:16px;">Editar proyecto</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <label class="field">
            <span class="field__label">Nombre</span>
            <input class="field__input" id="p-name" type="text" value="${escapeHtml(project.name)}" autofocus>
          </label>
          <div class="field">
            <span class="field__label">Icono y color</span>
            <div id="p-appearance"></div>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel">Cancelar</button>
          <button class="btn btn--primary" id="save" style="margin-left:auto;">Guardar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  mountAppearancePicker(overlay.querySelector("#p-appearance"), {
    icon: project.icon,
    color: project.color,
    onChange: (a) => { appearance = a; },
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
    const name = overlay.querySelector("#p-name").value.trim();
    if (!name) { overlay.querySelector("#p-name").focus(); return; }
    const saveBtn = overlay.querySelector("#save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";
    try {
      await onSave({ name, icon: appearance.icon, color: appearance.color });
      close();
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
    }
  });
}
