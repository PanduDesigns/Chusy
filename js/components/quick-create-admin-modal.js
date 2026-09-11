// ============================================================================
// Modal (solo administradores, escondido en el menú de usuario — ver
// sidebar.js): panel de "Creación Rápida". Dos cosas en un mismo sitio:
//  1. El interruptor que decide si el botón "Nueva cabina" (topbar de
//     cualquier proyecto) está abierto a todo el equipo o reservado a
//     administradores — se aplica al momento, igual que el tema en "Mi
//     cuenta" (account-modal.js).
//  2. El CRUD de los "productos" que ese botón deja elegir: tareas base
//     (siempre se crean) + grupos de opciones, cada una con sus propias
//     tareas — ver el apartado 3 del README para el ejemplo completo
//     ("Cabina de pintura" → "Tipo de flujo" → Vertical/Semivertical).
//
// Dos pantallas dentro del mismo modal (nunca se cierra entre una y otra):
//  - Lista: el interruptor + la lista de productos (editar/duplicar/
//    eliminar) + "Nuevo producto".
//  - Editor: el formulario completo de UN producto. Nada se guarda en
//    Firestore hasta "Guardar producto"; "Cancelar"/"← Volver" descartan
//    sin tocar nada — mismo patrón que sections-modal.js y
//    custom-fields-modal.js (todo en memoria hasta un único guardado), un
//    par de niveles más anidado (producto → grupo → opción → tarea).
//
// Disciplina de repintado (para no perder el foco a media escritura): cada
// `input` de texto SOLO muta `state.editingProduct` en memoria, nunca
// repinta. Solo las acciones estructurales (añadir/quitar tarea, opción o
// grupo, guardar, cancelar) llaman a render(), que reconstruye la pantalla
// entera — igual que ya hacen sections-modal.js/custom-fields-modal.js,
// aplicado a un árbol más profundo.
// ============================================================================
import { el, uid, escapeHtml, badgeHtml, showToast } from "../utils.js";
import { mountAppearancePicker } from "./project-appearance-picker.js";
import {
  getQuickCreateProducts,
  createQuickCreateProduct,
  updateQuickCreateProduct,
  deleteQuickCreateProduct,
  setQuickCreateEnabled,
} from "../data/quick-create.js";

function blankTask() {
  return { id: uid(), title: "", description: "" };
}
function blankOption() {
  return { id: uid(), name: "", tasks: [] };
}
function blankGroup() {
  return { id: uid(), name: "", selectionType: "single", options: [] };
}
function blankProduct() {
  return { id: null, name: "", icon: "📦", color: "#FCD000", baseTasks: [], groups: [] };
}

/** Copia en memoria de un producto ya existente, para editar sin tocar `state.products` hasta guardar. Mismos ids que el original (nada fuera de este documento los referencia, así que conservarlos no hace daño y evita churn innecesario). */
function deepCloneProduct(product) {
  return {
    id: product.id,
    name: product.name,
    icon: product.icon,
    color: product.color,
    baseTasks: (product.baseTasks || []).map((t) => ({ ...t })),
    groups: (product.groups || []).map((g) => ({
      ...g,
      options: (g.options || []).map((o) => ({ ...o, tasks: (o.tasks || []).map((t) => ({ ...t })) })),
    })),
  };
}

/** Para "Duplicar": copia profunda con TODOS los ids regenerados — es un producto nuevo de verdad, no una edición del original. */
function cloneProductWithFreshIds(product) {
  return {
    id: null,
    name: `${product.name} (copia)`,
    icon: product.icon,
    color: product.color,
    baseTasks: (product.baseTasks || []).map((t) => ({ ...t, id: uid() })),
    groups: (product.groups || []).map((g) => ({
      ...g,
      id: uid(),
      options: (g.options || []).map((o) => ({
        ...o,
        id: uid(),
        tasks: (o.tasks || []).map((t) => ({ ...t, id: uid() })),
      })),
    })),
  };
}

export function openQuickCreateAdminModal({ currentUser, quickCreateEnabled }) {
  const root = document.getElementById("modal-root");

  const state = {
    loading: true,
    enabled: !!quickCreateEnabled,
    products: [],
    screen: "list", // 'list' | 'editor'
    editingProduct: null,
    isNewProduct: false,
    busy: false,
  };

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">⚡ Creación Rápida</h3>
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
    if (state.screen === "editor") mountAppearance();
  }

  // ---------------------------------------------------------------- body ----
  function renderBody() {
    if (state.loading) return `<p style="font-size:13px;color:var(--color-text-faint);">Cargando productos…</p>`;
    return state.screen === "editor" ? renderEditorScreen() : renderListScreen();
  }

  function renderListScreen() {
    const productRows = state.products.length
      ? state.products.map(productRowHtml).join("")
      : `<p style="color:var(--color-text-faint);font-size:12.5px;">Todavía no hay ningún producto. Crea el primero para que el equipo pueda usarlo desde "Nueva cabina".</p>`;

    return `
      <div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <input type="checkbox" id="qc-enabled-toggle" ${state.enabled ? "checked" : ""} style="width:17px;height:17px;accent-color:var(--color-signal);cursor:pointer;flex-shrink:0;">
          <span style="font-size:13.5px;color:var(--color-text-hi);font-weight:500;">Activar «Nueva cabina» para todo el equipo</span>
        </label>
        <p class="field__hint" style="margin-top:6px;">Mientras esté desactivado, el botón "Nueva cabina" se ve en cualquier proyecto pero solo tú (como admin) puedes pulsarlo — para dejarlo todo preparado antes de anunciarlo al equipo.</p>
      </div>
      <div style="border-top:1px solid var(--color-line);"></div>
      <div>
        <span class="field__label" style="font-size:13px;">Productos (${state.products.length})</span>
        <p class="field__hint">Cada producto puede llevar tareas base (siempre se crean) y grupos de opciones — p. ej. "Tipo de flujo" — donde cada opción añade sus propias tareas al elegirla. Así se configuran variantes de un mismo producto.</p>
        <div id="qc-product-list" style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">${productRows}</div>
        <button class="btn btn--ghost btn--sm" id="qc-new-product" type="button" style="width:fit-content;margin-top:10px;">+ Nuevo producto</button>
      </div>`;
  }

  function productRowHtml(p) {
    const groupCount = (p.groups || []).length;
    const taskCount =
      (p.baseTasks || []).length +
      (p.groups || []).reduce((sum, g) => sum + (g.options || []).reduce((s2, o) => s2 + (o.tasks || []).length, 0), 0);
    return `
      <div class="list-row" style="grid-template-columns:1fr auto auto auto;align-items:center;">
        <span class="list-row__title-cell">
          ${badgeHtml(p.icon, p.color)}
          <span style="min-width:0;">
            <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:var(--color-text-faint);">${groupCount} grupo${groupCount === 1 ? "" : "s"} · ${taskCount} tarea${taskCount === 1 ? "" : "s"}</div>
          </span>
        </span>
        <button type="button" class="btn btn--ghost btn--sm" data-edit-product="${p.id}">Editar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-duplicate-product="${p.id}" title="Duplicar producto">⧉</button>
        <button type="button" class="subtask-row__remove" data-delete-product="${p.id}" title="Eliminar producto">🗑</button>
      </div>`;
  }

  function renderEditorScreen() {
    const p = state.editingProduct;
    return `
      <button type="button" class="btn btn--ghost btn--sm" id="qc-back" ${state.busy ? "disabled" : ""} style="width:fit-content;">← Volver a productos</button>

      <label class="field">
        <span class="field__label">Nombre del producto</span>
        <input class="field__input" id="qc-p-name" value="${escapeHtml(p.name)}" placeholder="Ej. Cabina de pintura" autofocus>
      </label>

      <div class="field">
        <span class="field__label">Icono y color</span>
        <div id="qc-p-appearance"></div>
      </div>

      <div style="border-top:1px solid var(--color-line);"></div>

      <div>
        <span class="field__label" style="font-size:13px;">Tareas base</span>
        <p class="field__hint">Se crean siempre que se use este producto, sin depender de ninguna opción elegida.</p>
        <div id="qc-base-tasks" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          ${p.baseTasks.map((t) => taskRowHtml(t, { kind: "base" })).join("") || emptyTasksHint()}
        </div>
        <button class="btn btn--ghost btn--sm" id="qc-add-base-task" type="button" style="width:fit-content;margin-top:8px;">+ Tarea base</button>
      </div>

      <div style="border-top:1px solid var(--color-line);"></div>

      <div>
        <span class="field__label" style="font-size:13px;">Grupos de opciones</span>
        <p class="field__hint">Por ejemplo "Tipo de flujo": cada opción añade sus propias tareas al elegirla. "Una opción" se comporta como una lista de variantes (como mucho una a la vez); "Varias opciones" deja marcar cualquier número a la vez.</p>
        <div id="qc-groups" style="display:flex;flex-direction:column;gap:14px;margin-top:10px;">
          ${p.groups.map(groupBoxHtml).join("")}
        </div>
        <button class="btn btn--ghost btn--sm" id="qc-add-group" type="button" style="width:fit-content;margin-top:10px;">+ Grupo de opciones</button>
      </div>`;
  }

  function emptyTasksHint() {
    return `<p style="color:var(--color-text-faint);font-size:12px;">Ninguna todavía.</p>`;
  }

  function taskRowHtml(t, { kind, groupId, optionId }) {
    const dataAttrs = kind === "base" ? `data-base-task="${t.id}"` : `data-group="${groupId}" data-option="${optionId}" data-opt-task="${t.id}"`;
    return `
      <div class="qc-task-row" ${dataAttrs}>
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="field__input qc-task-title" value="${escapeHtml(t.title)}" placeholder="Título de la tarea" style="flex:1;">
          <button type="button" class="subtask-row__remove qc-remove-task" title="Eliminar tarea">✕</button>
        </div>
        <input class="field__input qc-task-desc" value="${escapeHtml(t.description || "")}" placeholder="Descripción (opcional)">
      </div>`;
  }

  function groupBoxHtml(g) {
    return `
      <div class="qc-group-box" data-group="${g.id}">
        <div class="modal-row" style="gap:8px;align-items:flex-end;">
          <label class="field" style="flex:1.4;">
            <span class="field__label">Nombre del grupo</span>
            <input class="field__input qc-group-name" value="${escapeHtml(g.name)}" placeholder="Ej. Tipo de flujo">
          </label>
          <label class="field" style="flex:1;">
            <span class="field__label">Selección</span>
            <select class="field__select qc-group-type">
              <option value="single" ${g.selectionType !== "multiple" ? "selected" : ""}>Una opción</option>
              <option value="multiple" ${g.selectionType === "multiple" ? "selected" : ""}>Varias opciones</option>
            </select>
          </label>
          <button type="button" class="subtask-row__remove qc-remove-group" title="Eliminar grupo" style="margin-bottom:10px;">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${(g.options || []).map((o) => optionBoxHtml(g.id, o)).join("") || `<p style="color:var(--color-text-faint);font-size:12px;">Sin opciones todavía.</p>`}
        </div>
        <button type="button" class="btn btn--ghost btn--sm qc-add-option" style="width:fit-content;">+ Opción</button>
      </div>`;
  }

  function optionBoxHtml(groupId, o) {
    return `
      <div class="qc-option-box" data-group="${groupId}" data-option="${o.id}">
        <div style="display:flex;gap:8px;">
          <input class="field__input qc-option-name" value="${escapeHtml(o.name)}" placeholder="Ej. Flujo vertical" style="flex:1;">
          <button type="button" class="subtask-row__remove qc-remove-option" title="Eliminar opción">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${(o.tasks || []).map((t) => taskRowHtml(t, { kind: "option", groupId, optionId: o.id })).join("") || emptyTasksHint()}
        </div>
        <button type="button" class="btn btn--ghost btn--sm qc-add-option-task" style="width:fit-content;">+ Tarea</button>
      </div>`;
  }

  function mountAppearance() {
    const container = overlay.querySelector("#qc-p-appearance");
    if (!container) return;
    mountAppearancePicker(container, {
      icon: state.editingProduct.icon,
      color: state.editingProduct.color,
      onChange: (a) => { state.editingProduct.icon = a.icon; state.editingProduct.color = a.color; },
    });
  }

  // -------------------------------------------------------------- footer ----
  function renderFooter() {
    if (state.loading) return "";
    if (state.screen === "editor") {
      return `
        <button type="button" class="btn btn--ghost" id="qc-cancel-edit" ${state.busy ? "disabled" : ""}>Cancelar</button>
        <button type="button" class="btn btn--primary" id="qc-save-product" style="margin-left:auto;" ${state.busy ? "disabled" : ""}>${state.busy ? "Guardando…" : "Guardar producto"}</button>`;
    }
    return `<button type="button" class="btn btn--ghost" id="qc-close-footer" style="margin-left:auto;">Cerrar</button>`;
  }

  // ----------------------------------------------------------- listeners ----
  function attachListeners() {
    overlay.querySelector("#qc-close-footer")?.addEventListener("click", close);
    overlay.querySelector("#qc-cancel-edit")?.addEventListener("click", () => { if (!state.busy) discardEdit(); });
    overlay.querySelector("#qc-save-product")?.addEventListener("click", handleSaveProduct);

    if (state.screen === "editor") wireEditorScreen();
    else wireListScreen();
  }

  function discardEdit() {
    state.editingProduct = null;
    state.isNewProduct = false;
    state.screen = "list";
    render();
  }

  function focusLastInput(container, selector) {
    if (!container) return;
    const inputs = container.querySelectorAll(selector);
    inputs[inputs.length - 1]?.focus();
  }

  function wireListScreen() {
    const toggle = overlay.querySelector("#qc-enabled-toggle");
    toggle?.addEventListener("change", async () => {
      const next = toggle.checked;
      toggle.disabled = true;
      try {
        await setQuickCreateEnabled(next);
        state.enabled = next;
        showToast(next ? "«Nueva cabina» activada para todo el equipo." : "«Nueva cabina» vuelve a estar reservada a administradores.");
      } catch (e) {
        toggle.checked = !next;
        showToast("No se pudo guardar el cambio.", "error");
      }
      toggle.disabled = false;
    });

    overlay.querySelector("#qc-new-product")?.addEventListener("click", () => {
      state.editingProduct = blankProduct();
      state.isNewProduct = true;
      state.screen = "editor";
      render();
      overlay.querySelector("#qc-p-name")?.focus();
    });

    overlay.querySelectorAll("[data-edit-product]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const product = state.products.find((p) => p.id === btn.dataset.editProduct);
        if (!product) return;
        state.editingProduct = deepCloneProduct(product);
        state.isNewProduct = false;
        state.screen = "editor";
        render();
      });
    });

    overlay.querySelectorAll("[data-duplicate-product]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const product = state.products.find((p) => p.id === btn.dataset.duplicateProduct);
        if (!product) return;
        state.editingProduct = cloneProductWithFreshIds(product);
        state.isNewProduct = true;
        state.screen = "editor";
        render();
        overlay.querySelector("#qc-p-name")?.focus();
      });
    });

    overlay.querySelectorAll("[data-delete-product]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const product = state.products.find((p) => p.id === btn.dataset.deleteProduct);
        if (!product) return;
        const ok = confirm(`¿Eliminar el producto "${product.name}"? No afecta a las tareas que ya se hayan creado a partir de él — solo deja de estar disponible en "Nueva cabina".`);
        if (!ok) return;
        btn.disabled = true;
        try {
          await deleteQuickCreateProduct(product.id);
          state.products = state.products.filter((p) => p.id !== product.id);
          render();
          showToast("Producto eliminado.");
        } catch (e) {
          showToast("No se pudo eliminar el producto.", "error");
          btn.disabled = false;
        }
      });
    });
  }

  function wireEditorScreen() {
    overlay.querySelector("#qc-back")?.addEventListener("click", () => { if (!state.busy) discardEdit(); });

    overlay.querySelector("#qc-p-name").addEventListener("input", (e) => { state.editingProduct.name = e.target.value; });

    wireBaseTasks();
    wireGroups();
  }

  function wireBaseTasks() {
    overlay.querySelector("#qc-add-base-task").addEventListener("click", () => {
      state.editingProduct.baseTasks.push(blankTask());
      render();
      focusLastInput(overlay.querySelector("#qc-base-tasks"), ".qc-task-title");
    });

    overlay.querySelectorAll("#qc-base-tasks [data-base-task]").forEach((row) => {
      const taskId = row.dataset.baseTask;
      const task = state.editingProduct.baseTasks.find((t) => t.id === taskId);
      if (!task) return;
      row.querySelector(".qc-task-title").addEventListener("input", (e) => { task.title = e.target.value; });
      row.querySelector(".qc-task-desc").addEventListener("input", (e) => { task.description = e.target.value; });
      row.querySelector(".qc-remove-task").addEventListener("click", () => {
        state.editingProduct.baseTasks = state.editingProduct.baseTasks.filter((t) => t.id !== taskId);
        render();
      });
    });
  }

  function wireGroups() {
    overlay.querySelector("#qc-add-group").addEventListener("click", () => {
      state.editingProduct.groups.push(blankGroup());
      render();
      focusLastInput(overlay.querySelector("#qc-groups"), ".qc-group-name");
    });

    overlay.querySelectorAll(".qc-group-box").forEach((box) => {
      const groupId = box.dataset.group;
      const group = state.editingProduct.groups.find((g) => g.id === groupId);
      if (!group) return;

      box.querySelector(".qc-group-name").addEventListener("input", (e) => { group.name = e.target.value; });
      box.querySelector(".qc-group-type").addEventListener("change", (e) => { group.selectionType = e.target.value; });
      box.querySelector(".qc-remove-group").addEventListener("click", () => {
        state.editingProduct.groups = state.editingProduct.groups.filter((g) => g.id !== groupId);
        render();
      });
      box.querySelector(".qc-add-option").addEventListener("click", () => {
        group.options.push(blankOption());
        render();
        focusLastInput(overlay.querySelector(`.qc-group-box[data-group="${groupId}"]`), ".qc-option-name");
      });

      box.querySelectorAll(".qc-option-box").forEach((optBox) => {
        const optionId = optBox.dataset.option;
        const option = group.options.find((o) => o.id === optionId);
        if (!option) return;

        optBox.querySelector(".qc-option-name").addEventListener("input", (e) => { option.name = e.target.value; });
        optBox.querySelector(".qc-remove-option").addEventListener("click", () => {
          group.options = group.options.filter((o) => o.id !== optionId);
          render();
        });
        optBox.querySelector(".qc-add-option-task").addEventListener("click", () => {
          option.tasks.push(blankTask());
          render();
          focusLastInput(overlay.querySelector(`.qc-option-box[data-option="${optionId}"]`), ".qc-task-title");
        });

        optBox.querySelectorAll("[data-opt-task]").forEach((row) => {
          const taskId = row.dataset.optTask;
          const task = option.tasks.find((t) => t.id === taskId);
          if (!task) return;
          row.querySelector(".qc-task-title").addEventListener("input", (e) => { task.title = e.target.value; });
          row.querySelector(".qc-task-desc").addEventListener("input", (e) => { task.description = e.target.value; });
          row.querySelector(".qc-remove-task").addEventListener("click", () => {
            option.tasks = option.tasks.filter((t) => t.id !== taskId);
            render();
          });
        });
      });
    });
  }

  async function handleSaveProduct() {
    const p = state.editingProduct;
    const name = p.name.trim();
    if (!name) { overlay.querySelector("#qc-p-name")?.focus(); return; }

    // Filas vacías (nombre/título en blanco) se descartan en silencio al
    // guardar, igual que ya hacen custom-fields-modal.js y
    // sections-modal.js — no hace falta un error, es más cómodo poder
    // dejar una fila a medias mientras se piensa el resto.
    const cleaned = {
      name,
      icon: p.icon,
      color: p.color,
      baseTasks: p.baseTasks
        .map((t) => ({ id: t.id, title: t.title.trim(), description: (t.description || "").trim() }))
        .filter((t) => t.title),
      groups: p.groups
        .map((g) => ({
          id: g.id,
          name: g.name.trim(),
          selectionType: g.selectionType === "multiple" ? "multiple" : "single",
          options: (g.options || [])
            .map((o) => ({
              id: o.id,
              name: o.name.trim(),
              tasks: (o.tasks || [])
                .map((t) => ({ id: t.id, title: t.title.trim(), description: (t.description || "").trim() }))
                .filter((t) => t.title),
            }))
            .filter((o) => o.name),
        }))
        .filter((g) => g.name && g.options.length),
    };

    state.busy = true;
    render();
    try {
      if (state.isNewProduct) {
        const id = await createQuickCreateProduct({ ...cleaned, createdBy: currentUser.uid });
        state.products = [...state.products, { id, ...cleaned }].sort((a, b) => a.name.localeCompare(b.name));
      } else {
        await updateQuickCreateProduct(p.id, cleaned);
        state.products = state.products
          .map((existing) => (existing.id === p.id ? { ...existing, ...cleaned } : existing))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      showToast("Producto guardado.");
      state.busy = false;
      discardEdit();
    } catch (e) {
      showToast("No se pudo guardar el producto.", "error");
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
      console.error("openQuickCreateAdminModal:", e);
      state.loading = false;
      render();
      showToast("No se pudieron cargar los productos.", "error");
    });
}
