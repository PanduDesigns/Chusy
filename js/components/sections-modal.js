// ============================================================================
// Modal: gestionar las secciones de un proyecto — son las agrupaciones de
// la vista Lista y, a la vez, las columnas del Tablero (mismo dato,
// project.sections). Permite añadir, renombrar, eliminar y (desde la v47)
// elegir un color propio para cada una. Nada se guarda hasta pulsar
// "Guardar" — igual que el modal de campos personalizados en el que está
// inspirado este.
//
// Al eliminar una sección aquí, sus tareas NO se borran: el guardado
// (saveProjectSections, en data/projects.js) las deja "sin sección", y
// tanto Lista como Tablero muestran un grupo "Sin sección" aparte para
// que sigan siendo visibles y se puedan volver a mover.
//
// Color de sección (v47): opcional, `null`/ausente de entrada — mientras
// no se elija ninguno, la línea de tiempo en modo Secciones (v46) sigue
// asignando uno automático distinto por sección (ver SECTION_ACCENT_COLORS
// en timeline-view.js). Elegir uno aquí lo fija de verdad y deja de
// depender de en qué posición esté la sección o de cuáles otras tengan
// tareas ese día — mismos 8 tonos que ya se usan para el color de un
// proyecto (`PROJECT_COLORS`, project-appearance-picker.js), para no
// introducir una paleta nueva que aprender.
// ============================================================================
import { el, uid, escapeHtml } from "../utils.js";
import { PROJECT_COLORS } from "./project-appearance-picker.js";

export function openSectionsModal({ project, onSave }) {
  const root = document.getElementById("modal-root");
  let sections = [...(project.sections || [])].sort((a, b) => a.order - b.order).map((s) => ({ ...s }));
  // Qué sección tiene el selector de color desplegado ahora mismo (como
  // mucho una a la vez) — null cuando ninguna.
  let expandedColorFor = null;

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

  function colorSwatchesHtml(s) {
    const autoBtn = `<button type="button" class="chip${!s.color ? " is-selected" : ""}" data-section-color="${s.id}" data-color="" title="Automático — un color distinto por sección, sin elegirlo a mano">Auto</button>`;
    const swatches = PROJECT_COLORS.map(
      (c) => `<button type="button" class="chip color-swatch${c === s.color ? " is-selected" : ""}" data-section-color="${s.id}" data-color="${c}" style="border-color:${c}"><span class="chip__dot" style="background:${c}"></span></button>`
    ).join("");
    return `<div class="chip-select" style="margin:2px 0 4px 26px;">${autoBtn}${swatches}</div>`;
  }

  function renderList() {
    const list = overlay.querySelector("#sec-list");
    if (!sections.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Sin secciones — las tareas del proyecto quedarán todas "sin sección".</p>`;
      return;
    }
    list.innerHTML = sections
      .map(
        (s) => `
      <div>
        <div class="modal-row" data-section="${s.id}" style="gap:8px;">
          <button type="button" class="sec-color-dot" data-toggle-color="${s.id}" title="Color de esta sección en la línea de tiempo" style="background:${s.color || "var(--color-line-bright)"};"></button>
          <input class="field__input sec-name" value="${escapeHtml(s.name)}" placeholder="Nombre de la sección" style="flex:1;">
          <button class="subtask-row__remove" data-remove="${s.id}" type="button" title="Eliminar sección">✕</button>
        </div>
        ${expandedColorFor === s.id ? colorSwatchesHtml(s) : ""}
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
        if (expandedColorFor === btn.dataset.remove) expandedColorFor = null;
        renderList();
      });
    });
    list.querySelectorAll("[data-toggle-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.toggleColor;
        expandedColorFor = expandedColorFor === id ? null : id;
        renderList();
      });
    });
    list.querySelectorAll("[data-section-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = sections.find((s) => s.id === btn.dataset.sectionColor);
        if (s) s.color = btn.dataset.color || null;
        expandedColorFor = null;
        renderList();
      });
    });
  }
  renderList();

  overlay.querySelector("#sec-add").addEventListener("click", () => {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
    sections.push({ id: uid(), name: "", order: maxOrder + 1, color: null });
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
      .map((s, i) => ({ id: s.id, name: s.name.trim(), order: i, color: s.color || null }))
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
