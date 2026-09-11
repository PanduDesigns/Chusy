// ============================================================================
// Modal "Nueva cabina": se abre desde el botón del topbar de un proyecto
// (ver topbar.js) — visible para todo el mundo, pero solo pulsable por
// administradores hasta que uno de ellos active "Nueva cabina" para todo el
// equipo desde el panel "Creación Rápida" (quick-create-admin-modal.js).
//
// Tres pantallas dentro del mismo modal:
//  1. Elegir un producto (si solo hay uno configurado, igualmente hay que
//     elegirlo — no se salta el paso, así siempre se ve de qué producto se
//     trata antes de tocar nada).
//  2. Configurarlo: marcar una opción (grupos "Una opción") o cualquier
//     número (grupos "Varias opciones") de cada grupo del producto, con
//     una vista previa en vivo de qué tareas va a crear, y elegir en qué
//     sección del proyecto caen.
//  3. Confirmar — crea las tareas y cierra.
//
// Nada de esto persiste nada hasta pulsar "Crear tareas": las casillas
// marcadas solo viven en `state.selections` hasta ese momento.
// ============================================================================
import { el, escapeHtml, badgeHtml, showToast } from "../utils.js";
import { getQuickCreateProducts, resolveQuickCreateTasks, createTasksFromResolvedList } from "../data/quick-create.js";
import { openQuickCreateAdminModal } from "./quick-create-admin-modal.js";

export function openQuickCreateModal({ project, currentUser, quickCreateEnabled }) {
  const root = document.getElementById("modal-root");
  const sortedSections = [...(project.sections || [])].sort((a, b) => a.order - b.order);

  const state = {
    loading: true,
    products: [],
    selectedProductId: null,
    selections: {}, // { [groupId]: Set(optionId) }
    sectionId: sortedSections[0]?.id || "",
    busy: false,
  };

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">⚡ Nueva cabina</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body" id="qc-body"></div>
        <div class="modal__footer" id="qc-footer"></div>
      </div>
    </div>
  `);
  root.appendChild(overlay);
  const bodyEl = overlay.querySelector("#qc-body");
  const footerEl = overlay.querySelector("#qc-footer");

  function close() {
    if (state.busy) return;
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  function render() {
    bodyEl.innerHTML = renderBody();
    footerEl.innerHTML = renderFooter();
    attachListeners();
  }

  // ---------------------------------------------------------------- body ----
  function renderBody() {
    if (state.loading) return `<p style="font-size:13px;color:var(--color-text-faint);">Cargando productos…</p>`;
    if (!state.products.length) return renderEmptyState();
    return state.selectedProductId ? renderConfigureScreen() : renderPickScreen();
  }

  function renderEmptyState() {
    const adminHint =
      currentUser.role === "admin"
        ? `<button type="button" class="btn btn--ghost btn--sm" id="qc-go-admin" style="width:fit-content;margin:10px auto 0;">+ Crear el primer producto</button>`
        : `<p class="field__hint">Pídele a un administrador que configure alguno desde "Creación Rápida".</p>`;
    return `
      <div style="text-align:center;padding:20px 10px;display:flex;flex-direction:column;align-items:center;">
        <p style="color:var(--color-text-lo);font-size:13.5px;">Todavía no hay ningún producto configurado.</p>
        ${adminHint}
      </div>`;
  }

  function renderPickScreen() {
    return `
      <p class="field__hint">Elige qué producto quieres montar en este proyecto.</p>
      <div style="display:flex;flex-direction:column;gap:8px;">${state.products.map(productPickHtml).join("")}</div>`;
  }

  function productPickHtml(p) {
    const { groupCount, taskCount } = productCounts(p);
    return `
      <button type="button" class="qc-product-pick" data-pick-product="${p.id}">
        ${badgeHtml(p.icon, p.color, "project-badge--lg")}
        <span style="min-width:0;">
          <div style="font-size:14px;font-weight:600;color:var(--color-text-hi);">${escapeHtml(p.name)}</div>
          <div style="font-size:11.5px;color:var(--color-text-faint);margin-top:2px;">${groupCount ? `${groupCount} grupo${groupCount === 1 ? "" : "s"} de opciones · ` : ""}${taskCount} tarea${taskCount === 1 ? "" : "s"} en total</div>
        </span>
      </button>`;
  }

  function productCounts(p) {
    const groupCount = (p.groups || []).length;
    const taskCount =
      (p.baseTasks || []).length +
      (p.groups || []).reduce((sum, g) => sum + (g.options || []).reduce((s2, o) => s2 + (o.tasks || []).length, 0), 0);
    return { groupCount, taskCount };
  }

  function renderConfigureScreen() {
    const product = state.products.find((p) => p.id === state.selectedProductId);
    if (!product) {
      // Caso límite, en la práctica casi imposible: el producto se borró
      // mientras este selector estaba abierto con él ya elegido.
      state.selectedProductId = null;
      return renderPickScreen();
    }

    const resolved = resolveQuickCreateTasks(product, state.selections);

    const baseTasksBlock = (product.baseTasks || []).length
      ? `
      <div style="font-size:12.5px;color:var(--color-text-lo);">
        <strong style="color:var(--color-text-hi);">Siempre se crean:</strong>
        <ul style="margin:4px 0 0 18px;padding:0;">${product.baseTasks.map((t) => `<li>${escapeHtml(t.title)}</li>`).join("")}</ul>
      </div>`
      : "";

    const groupsBlock = (product.groups || []).map((g) => groupPickerHtml(g)).join("");

    const sectionOptions = `
      <option value="" ${state.sectionId === "" ? "selected" : ""}>— Sin sección —</option>
      ${sortedSections.map((s) => `<option value="${s.id}" ${state.sectionId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}`;

    const previewBlock = `
      <div style="border-top:1px solid var(--color-line);padding-top:14px;">
        <span class="field__label" style="font-size:13px;">Se crearán ${resolved.length} tarea${resolved.length === 1 ? "" : "s"}</span>
        ${
          resolved.length
            ? `<ul style="margin:6px 0 0 18px;padding:0;max-height:150px;overflow-y:auto;font-size:12.5px;color:var(--color-text-lo);">${resolved.map((t) => `<li>${escapeHtml(t.title)}</li>`).join("")}</ul>`
            : `<p class="field__hint">Elige al menos una opción — o añade tareas base a este producto desde "Creación Rápida".</p>`
        }
        <label class="field" style="margin-top:12px;">
          <span class="field__label">Sección de destino</span>
          <select class="field__select" id="qc-section">${sectionOptions}</select>
        </label>
      </div>`;

    return `
      <button type="button" class="btn btn--ghost btn--sm" id="qc-back-to-pick" style="width:fit-content;">← Elegir otro producto</button>
      <div style="display:flex;align-items:center;gap:10px;">
        ${badgeHtml(product.icon, product.color, "project-badge--lg")}
        <span style="font-size:15px;font-weight:600;">${escapeHtml(product.name)}</span>
      </div>
      ${baseTasksBlock}
      ${groupsBlock}
      ${previewBlock}`;
  }

  function groupPickerHtml(g) {
    const chosen = state.selections[g.id] || new Set();
    const inputType = g.selectionType === "multiple" ? "checkbox" : "radio";
    const rows = (g.options || [])
      .map(
        (o) => `
      <label class="qc-option-row">
        <input type="${inputType}" name="qc-group-${g.id}" data-group="${g.id}" data-option="${o.id}" ${chosen.has(o.id) ? "checked" : ""}>
        <span>
          <div style="font-size:13px;color:var(--color-text-hi);">${escapeHtml(o.name)}</div>
          ${(o.tasks || []).length ? `<div style="font-size:11.5px;color:var(--color-text-faint);">${o.tasks.length} tarea${o.tasks.length === 1 ? "" : "s"}</div>` : ""}
        </span>
      </label>`
      )
      .join("");
    return `
      <fieldset style="border:1px solid var(--color-line);border-radius:var(--radius-sm);padding:6px 12px 10px;">
        <legend style="font-size:12.5px;font-weight:600;color:var(--color-text-lo);padding:0 4px;">${escapeHtml(g.name)}</legend>
        <div style="display:flex;flex-direction:column;gap:2px;">${rows}</div>
      </fieldset>`;
  }

  // -------------------------------------------------------------- footer ----
  function renderFooter() {
    if (state.loading || !state.products.length) {
      return `<button type="button" class="btn btn--ghost" id="qc-cancel" style="margin-left:auto;">Cerrar</button>`;
    }
    if (!state.selectedProductId) {
      return `<button type="button" class="btn btn--ghost" id="qc-cancel" style="margin-left:auto;">Cancelar</button>`;
    }
    const product = state.products.find((p) => p.id === state.selectedProductId);
    const resolvedCount = product ? resolveQuickCreateTasks(product, state.selections).length : 0;
    return `
      <button type="button" class="btn btn--ghost" id="qc-cancel" ${state.busy ? "disabled" : ""}>Cancelar</button>
      <button type="button" class="btn btn--primary" id="qc-confirm" style="margin-left:auto;" ${state.busy || !resolvedCount ? "disabled" : ""}>${state.busy ? "Creando…" : `Crear tareas (${resolvedCount})`}</button>`;
  }

  // ----------------------------------------------------------- listeners ----
  function attachListeners() {
    overlay.querySelector("#qc-cancel")?.addEventListener("click", close);

    overlay.querySelector("#qc-go-admin")?.addEventListener("click", () => {
      close();
      openQuickCreateAdminModal({ currentUser, quickCreateEnabled });
    });

    overlay.querySelectorAll("[data-pick-product]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedProductId = btn.dataset.pickProduct;
        state.selections = {};
        render();
      });
    });

    overlay.querySelector("#qc-back-to-pick")?.addEventListener("click", () => {
      state.selectedProductId = null;
      state.selections = {};
      render();
    });

    overlay.querySelectorAll("input[data-group][data-option]").forEach((input) => {
      input.addEventListener("change", () => {
        const groupId = input.dataset.group;
        const optionId = input.dataset.option;
        if (input.type === "radio") {
          state.selections = { ...state.selections, [groupId]: new Set([optionId]) };
        } else {
          const current = new Set(state.selections[groupId] || []);
          input.checked ? current.add(optionId) : current.delete(optionId);
          state.selections = { ...state.selections, [groupId]: current };
        }
        render();
      });
    });

    overlay.querySelector("#qc-section")?.addEventListener("change", (e) => { state.sectionId = e.target.value; });
    overlay.querySelector("#qc-confirm")?.addEventListener("click", handleConfirm);
  }

  async function handleConfirm() {
    const product = state.products.find((p) => p.id === state.selectedProductId);
    if (!product) return;
    const resolved = resolveQuickCreateTasks(product, state.selections);
    if (!resolved.length) return;
    state.busy = true;
    render();
    try {
      await createTasksFromResolvedList(resolved, { projectId: project.id, sectionId: state.sectionId || null, createdBy: currentUser.uid });
      showToast(`${resolved.length} tarea${resolved.length === 1 ? "" : "s"} creada${resolved.length === 1 ? "" : "s"}.`);
      close();
    } catch (e) {
      showToast("No se pudieron crear las tareas.", "error");
      state.busy = false;
      render();
    }
  }

  render();

  getQuickCreateProducts()
    .then((products) => {
      state.products = products;
      state.loading = false;
      render();
    })
    .catch((e) => {
      console.error("openQuickCreateModal:", e);
      state.loading = false;
      render();
      showToast("No se pudieron cargar los productos.", "error");
    });
}
