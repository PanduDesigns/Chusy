// ============================================================================
// Modal: gestionar las secciones de un proyecto — son las agrupaciones de
// la vista Lista y, a la vez, las columnas del Tablero (mismo dato,
// project.sections). Permite añadir, renombrar y eliminar. Nada se
// guarda hasta pulsar "Guardar" — igual que el modal de campos
// personalizados en el que está inspirado este.
//
// Al eliminar una sección aquí, sus tareas NO se borran: el guardado
// (saveProjectSections, en data/projects.js) las deja "sin sección", y
// tanto Lista como Tablero muestran un grupo "Sin sección" aparte para
// que sigan siendo visibles y se puedan volver a mover.
// ============================================================================
import { el, uid, escapeHtml } from "../utils.js";

export function openSectionsModal({ project, onSave }) {
  const root = document.getElementById("modal-root");
  let sections = [...(project.sections || [])].sort((a, b) => a.order - b.order).map((s) => ({ ...s }));

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--sm">
        <div class="modal__header">
          <h3 style="font-size:16px;">Secciones de «${escapeHtml(project.name)}»</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Son las agrupaciones de la Lista y, a la vez, las columnas del Tablero. Si eliminas una, sus tareas no se borran: pasan a quedar sin sección.</p>
          <div id="sec-list" style="display:flex;flex-direction:column;gap:8px;"></div>
          <button class="btn btn--ghost btn--sm" id="sec-add" type="button" style="width:fit-content;margin-top:8px;">+ Añadir sección</button>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel">Cancelar</button>
          <button class="btn btn--primary" id="save" style="margin-left:auto;">Guardar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  function renderList() {
    const list = overlay.querySelector("#sec-list");
    if (!sections.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Sin secciones — las tareas del proyecto quedarán todas "sin sección".</p>`;
      return;
    }
    list.innerHTML = sections
      .map(
        (s) => `
      <div class="modal-row" data-section="${s.id}" style="gap:8px;">
        <input class="field__input sec-name" value="${escapeHtml(s.name)}" placeholder="Nombre de la sección" style="flex:1;">
        <button class="subtask-row__remove" data-remove="${s.id}" type="button" title="Eliminar sección">✕</button>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-section]").forEach((row) => {
      const id = row.dataset.section;
      row.querySelector(".sec-name").addEventListener("input", (e) => {
        const s = sections.find((s) => s.id === id);
        if (s) s.name = e.target.value;
      });
    });
    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sections = sections.filter((s) => s.id !== btn.dataset.remove);
        renderList();
      });
    });
  }
  renderList();

  overlay.querySelector("#sec-add").addEventListener("click", () => {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
    sections.push({ id: uid(), name: "", order: maxOrder + 1 });
    renderList();
    const inputs = overlay.querySelectorAll(".sec-name");
    inputs[inputs.length - 1]?.focus();
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
    const cleaned = sections
      .map((s, i) => ({ id: s.id, name: s.name.trim(), order: i }))
      .filter((s) => s.name);
    const saveBtn = overlay.querySelector("#save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";
    try {
      await onSave(cleaned);
      close();
    } catch (e) {
      console.error("openSectionsModal save:", e);
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
    }
  });
}
