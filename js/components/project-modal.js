// ============================================================================
// Modal: crear proyecto nuevo.
// ============================================================================
import { el, uid, escapeHtml } from "../utils.js";
import { mountAppearancePicker } from "./project-appearance-picker.js";

export function openProjectModal({ onCreate }) {
  const root = document.getElementById("modal-root");

  let sections = [
    { id: "por-hacer", name: "Por hacer", order: 0 },
    { id: "en-progreso", name: "En progreso", order: 1 },
    { id: "hecho", name: "Hecho", order: 2 },
  ];
  let appearance = {};

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--sm">
        <div class="modal__header">
          <h3 style="font-size:16px;">Nuevo proyecto</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <label class="field">
            <span class="field__label">Nombre</span>
            <input class="field__input" id="p-name" type="text" placeholder="Ej. Instalación planta Rumanía" autofocus>
          </label>
          <label class="field">
            <span class="field__label">Descripción (opcional)</span>
            <textarea class="field__textarea" id="p-desc" placeholder="De qué trata este proyecto"></textarea>
          </label>
          <div class="field">
            <span class="field__label">Icono y color</span>
            <div id="p-appearance"></div>
          </div>
          <div class="field">
            <span class="field__label">Secciones del tablero</span>
            <div id="p-sections" class="subtask-list"></div>
            <div class="subtask-add">
              <input class="field__input" id="p-new-section" type="text" placeholder="Añadir sección…">
              <button class="btn btn--ghost btn--sm" id="p-add-section" type="button">Añadir</button>
            </div>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel">Cancelar</button>
          <button class="btn btn--primary" id="create" style="margin-left:auto;">Crear proyecto</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  mountAppearancePicker(overlay.querySelector("#p-appearance"), {
    onChange: (a) => { appearance = a; },
  });

  function renderSections() {
    const list = overlay.querySelector("#p-sections");
    list.innerHTML = sections
      .map(
        (s) => `
      <div class="subtask-row" data-id="${s.id}">
        <input class="subtask-row__text" value="${escapeHtml(s.name)}">
        <button class="subtask-row__remove" data-remove="${s.id}" type="button">✕</button>
      </div>`
      )
      .join("");
    list.querySelectorAll(".subtask-row__text").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.closest(".subtask-row").dataset.id;
        const s = sections.find((s) => s.id === id);
        if (s) s.name = input.value.trim() || s.name;
      });
    });
    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sections = sections.filter((s) => s.id !== btn.dataset.remove);
        renderSections();
      });
    });
  }
  renderSections();

  overlay.querySelector("#p-add-section").addEventListener("click", () => {
    const input = overlay.querySelector("#p-new-section");
    const name = input.value.trim();
    if (!name) return;
    sections.push({ id: uid(), name, order: sections.length });
    input.value = "";
    renderSections();
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

  overlay.querySelector("#create").addEventListener("click", async () => {
    const name = overlay.querySelector("#p-name").value.trim();
    if (!name) { overlay.querySelector("#p-name").focus(); return; }
    const description = overlay.querySelector("#p-desc").value.trim();
    const createBtn = overlay.querySelector("#create");
    createBtn.disabled = true;
    createBtn.textContent = "Creando…";
    try {
      await onCreate({ name, description, color: appearance.color, icon: appearance.icon, sections: sections.map((s, i) => ({ ...s, order: i })) });
      close();
    } catch (e) {
      createBtn.disabled = false;
      createBtn.textContent = "Crear proyecto";
    }
  });
}
