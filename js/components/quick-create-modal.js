// ============================================================================
// Modal "Nueva cabina": se abre desde el botón del topbar de un proyecto
// (ver topbar.js) — visible para todo el mundo, pero solo pulsable por
// administradores hasta que uno de ellos active "Nueva cabina" para todo el
// equipo desde el panel "Creación Rápida" (quick-create-admin-modal.js).
//
// Pantallas dentro del mismo modal:
//  1. Elegir un producto (si solo hay uno configurado, igualmente hay que
//     elegirlo — no se salta el paso, así siempre se ve de qué producto se
//     trata antes de tocar nada).
//  2. Configurarlo: nombre de esta instancia concreta del producto (con la
//     que se crea la "tarea principal", ver más abajo), marcar una opción
//     (grupos "Una opción") o cualquier número (grupos "Varias opciones")
//     de cada grupo, fecha de entrega, sección de destino (o crear una
//     nueva con el nombre de esta instancia) y, opcionalmente, a quién se
//     le asignan cuáles de las tareas resultantes — todo con una vista
//     previa en vivo de qué se va a crear.
//  3. Confirmar — crea las tareas y cierra.
//
// La "tarea principal": además de las tareas de la plantilla (base + las de
// las opciones elegidas), SIEMPRE se crea una tarea adicional, la primera
// de todas, con el nombre que se le haya dado a esta instancia del
// producto — pensada como el "contenedor" de todo el conjunto. Lleva de
// fecha de inicio la de hoy (cuando se inserta) y de fecha final la propia
// fecha de entrega. El resto de tareas también empiezan hoy, pero su fecha
// final sale de sus "días necesarios" (definidos en la plantilla, ver
// quick-create-admin-modal.js) contados desde hoy — sin pasarse nunca de la
// fecha de entrega, y usando la fecha de entrega directamente si no tienen
// días marcados (ver computeTaskDueDate() más abajo).
//
// Nada de esto persiste nada hasta pulsar "Crear tareas".
// ============================================================================
import { el, escapeHtml, badgeHtml, showToast, uid, toDate, toDateInputValue, addDays, colorFromString, initials } from "../utils.js";
import { getQuickCreateProducts, resolveQuickCreateTasks, createTasksFromQuickCreateInsertion } from "../data/quick-create.js";
import { setProjectSections } from "../data/projects.js";
import { openQuickCreateAdminModal } from "./quick-create-admin-modal.js";

const MAIN_TASK_ID = "__main__"; // id sintético de la "tarea principal" — uid() nunca genera esto, no puede chocar con una tarea real de la plantilla
const NEW_SECTION_VALUE = "__new_section__"; // valor especial del desplegable de sección para "crear una nueva con este nombre"

/**
 * Fecha límite de una tarea (no la principal) a partir de la fecha de
 * inserción, la de entrega y sus "días necesarios" (o null si no tiene).
 * Sin duración marcada, directamente la fecha de entrega. Con duración,
 * inserción + esos días — pero nunca más allá de la fecha de entrega.
 */
function computeTaskDueDate(insertionDate, deliveryDate, durationDays) {
  if (durationDays === null || durationDays === undefined) return deliveryDate;
  const candidate = addDays(insertionDate, durationDays);
  return candidate.getTime() > deliveryDate.getTime() ? deliveryDate : candidate;
}

export function openQuickCreateModal({ project, currentUser, quickCreateEnabled, teamMembers }) {
  const root = document.getElementById("modal-root");
  const sortedSections = [...(project.sections || [])].sort((a, b) => a.order - b.order);
  const assignableMembers = [...(teamMembers || [])]
    .filter((m) => !m.isImported && !m.deleted)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const state = {
    loading: true,
    products: [],
    selectedProductId: null,
    selections: {}, // { [groupId]: Set(optionId) }
    instanceName: "",
    deliveryDate: "",
    sectionId: sortedSections[0]?.id || "",
    assignPeople: [], // [uid, ...] — orden en que se han ido marcando
    assignments: {}, // { [uid]: Set(taskId) } — taskId incluye MAIN_TASK_ID
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

  // Cierre: SOLO por la X, "Cancelar" o al confirmar — nunca al clicar
  // fuera ni con Escape (perder una configuración a medio marcar por un
  // clic sin querer fue justo el bug que motivó este cambio), y `close()`
  // tampoco depende de `state.busy`: si algo se queda colgado a media
  // operación, la X siempre tiene que poder sacar de aquí sin recargar la
  // página — la escritura en Firestore, si estaba en marcha, sigue su
  // curso en segundo plano de todos modos.
  function close() {
    overlay.remove();
  }
  overlay.querySelector("#close").addEventListener("click", close);

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
    const mainTaskLabel = state.instanceName.trim() || "Tarea principal";
    const assignableTasks = [{ id: MAIN_TASK_ID, title: mainTaskLabel, isMain: true }, ...resolved];

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
      ${sortedSections.map((s) => `<option value="${s.id}" ${state.sectionId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      <option value="${NEW_SECTION_VALUE}" ${state.sectionId === NEW_SECTION_VALUE ? "selected" : ""}>+ Crear una sección con este nombre</option>`;

    const previewBlock = `
      <div style="border-top:1px solid var(--color-line);padding-top:14px;">
        <span class="field__label" style="font-size:13px;">Se crearán ${assignableTasks.length} tarea${assignableTasks.length === 1 ? "" : "s"}</span>
        <ul style="margin:6px 0 0 18px;padding:0;max-height:150px;overflow-y:auto;font-size:12.5px;color:var(--color-text-lo);">
          ${assignableTasks.map((t) => `<li>${previewTaskLabel(t)}</li>`).join("")}
        </ul>
      </div>`;

    const finalizeBlock = `
      <div style="border-top:1px solid var(--color-line);padding-top:14px;display:flex;flex-direction:column;gap:14px;">
        <label class="field">
          <span class="field__label">Fecha de entrega</span>
          <input class="field__input" type="date" id="qc-delivery-date" value="${state.deliveryDate}">
          <p class="field__hint">La tarea principal irá de hoy a esta fecha. El resto, de hoy a su propia duración si la tiene (sin pasarse nunca de esta fecha) — o directamente esta fecha si no la tiene.</p>
        </label>
        <label class="field">
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
      <label class="field">
        <span class="field__label">Nombre de esta cabina</span>
        <input class="field__input" id="qc-instance-name" value="${escapeHtml(state.instanceName)}" placeholder="Ej. ${escapeHtml(product.name)}">
        <p class="field__hint">Se crea como la primera tarea del conjunto (la "tarea principal"), con este nombre.</p>
      </label>
      ${baseTasksBlock}
      ${groupsBlock}
      ${previewBlock}
      ${finalizeBlock}
      ${renderAssignBlock(assignableTasks)}`;
  }

  function previewTaskLabel(t) {
    if (t.isMain) return `<strong style="color:var(--color-text-hi);">${escapeHtml(t.title)}</strong> <span style="color:var(--color-text-faint);">— tarea principal</span>`;
    const dur = t.durationDays === null || t.durationDays === undefined ? "" : ` <span style="color:var(--color-text-faint);">(${t.durationDays}d)</span>`;
    return `${escapeHtml(t.title)}${dur}`;
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

  function renderAssignBlock(assignableTasks) {
    const peopleChips = assignableMembers
      .map(
        (m) => `
      <button type="button" class="chip${state.assignPeople.includes(m.uid) ? " is-selected" : ""}" data-assign-person="${m.uid}">
        <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
        ${escapeHtml(m.name)}
      </button>`
      )
      .join("");

    const blocks = state.assignPeople
      .map((personUid) => assignableMembers.find((m) => m.uid === personUid))
      .filter(Boolean)
      .map((m) => assignBlockHtml(m, assignableTasks))
      .join("");

    return `
      <div style="border-top:1px solid var(--color-line);padding-top:14px;">
        <span class="field__label" style="font-size:13px;">Asignación rápida (opcional)</span>
        <p class="field__hint">Marca a quién quieres asignarle tareas de este conjunto — para cada persona podrás elegir cuáles, y se les asignarán al crear las tareas.</p>
        ${assignableMembers.length ? `<div class="chip-select" style="margin-top:8px;">${peopleChips}</div>` : `<p class="field__hint">No hay nadie más en el equipo todavía.</p>`}
        ${blocks}
      </div>`;
  }

  function assignBlockHtml(member, assignableTasks) {
    const checked = state.assignments[member.uid] || new Set();
    const rows = assignableTasks
      .map(
        (t) => `
      <label class="qc-option-row" style="padding:5px 8px;">
        <input type="checkbox" data-assign-uid="${member.uid}" data-assign-task="${t.id}" ${checked.has(t.id) ? "checked" : ""}>
        <span style="font-size:12.5px;color:var(--color-text-hi);">${escapeHtml(t.title)}${t.isMain ? ` <span style="color:var(--color-text-faint);">(tarea principal)</span>` : ""}</span>
      </label>`
      )
      .join("");
    return `
      <div style="margin-top:10px;border:1px solid var(--color-line);border-radius:var(--radius-sm);padding:8px 10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--color-text-hi);">
            <span class="avatar avatar--sm" style="background:${colorFromString(member.uid)}">${initials(member.name)}</span>
            ${escapeHtml(member.name)}
          </span>
          <button type="button" class="subtask-row__remove" data-assign-remove="${member.uid}" title="Quitar">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:1px;max-height:150px;overflow-y:auto;">${rows}</div>
      </div>`;
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
    const totalCount = product ? resolveQuickCreateTasks(product, state.selections).length + 1 : 1;
    return `
      <button type="button" class="btn btn--ghost" id="qc-cancel" ${state.busy ? "disabled" : ""}>Cancelar</button>
      <button type="button" class="btn btn--primary" id="qc-confirm" style="margin-left:auto;" ${state.busy ? "disabled" : ""}>${state.busy ? "Creando…" : `Crear tareas (${totalCount})`}</button>`;
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
        const product = state.products.find((p) => p.id === btn.dataset.pickProduct);
        state.selectedProductId = btn.dataset.pickProduct;
        state.selections = {};
        state.instanceName = product ? product.name : "";
        state.deliveryDate = "";
        state.assignPeople = [];
        state.assignments = {};
        render();
      });
    });

    overlay.querySelector("#qc-back-to-pick")?.addEventListener("click", () => {
      state.selectedProductId = null;
      state.selections = {};
      state.instanceName = "";
      state.deliveryDate = "";
      state.assignPeople = [];
      state.assignments = {};
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

    overlay.querySelector("#qc-instance-name")?.addEventListener("input", (e) => { state.instanceName = e.target.value; });
    overlay.querySelector("#qc-delivery-date")?.addEventListener("change", (e) => { state.deliveryDate = e.target.value; });
    overlay.querySelector("#qc-section")?.addEventListener("change", (e) => { state.sectionId = e.target.value; });

    overlay.querySelectorAll("[data-assign-person]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const personUid = btn.dataset.assignPerson;
        if (state.assignPeople.includes(personUid)) {
          state.assignPeople = state.assignPeople.filter((u) => u !== personUid);
          const next = { ...state.assignments };
          delete next[personUid];
          state.assignments = next;
        } else {
          state.assignPeople = [...state.assignPeople, personUid];
          state.assignments = { ...state.assignments, [personUid]: new Set() };
        }
        render();
      });
    });

    overlay.querySelectorAll("[data-assign-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const personUid = btn.dataset.assignRemove;
        state.assignPeople = state.assignPeople.filter((u) => u !== personUid);
        const next = { ...state.assignments };
        delete next[personUid];
        state.assignments = next;
        render();
      });
    });

    overlay.querySelectorAll("input[data-assign-uid][data-assign-task]").forEach((input) => {
      input.addEventListener("change", () => {
        const personUid = input.dataset.assignUid;
        const taskId = input.dataset.assignTask;
        const current = new Set(state.assignments[personUid] || []);
        input.checked ? current.add(taskId) : current.delete(taskId);
        state.assignments = { ...state.assignments, [personUid]: current };
        // Sin render(): el propio checkbox ya refleja su estado marcado, y
        // nada más en pantalla depende de esto hasta el momento de confirmar.
      });
    });

    overlay.querySelector("#qc-confirm")?.addEventListener("click", handleConfirm);
  }

  function assignedUidsFor(taskId) {
    return state.assignPeople.filter((personUid) => (state.assignments[personUid] || new Set()).has(taskId));
  }

  async function handleConfirm() {
    const product = state.products.find((p) => p.id === state.selectedProductId);
    if (!product) return;
    const instanceName = state.instanceName.trim();
    if (!instanceName) { overlay.querySelector("#qc-instance-name")?.focus(); return; }
    if (!state.deliveryDate) { overlay.querySelector("#qc-delivery-date")?.focus(); return; }

    const resolved = resolveQuickCreateTasks(product, state.selections);
    const insertionDate = new Date();
    const deliveryDate = toDate(state.deliveryDate);
    const insertionDateStr = toDateInputValue(insertionDate);

    const mainTask = {
      title: instanceName,
      description: "",
      startDate: insertionDateStr,
      dueDate: toDateInputValue(deliveryDate),
      assigneeIds: assignedUidsFor(MAIN_TASK_ID),
    };
    const restTasks = resolved.map((t) => ({
      title: t.title,
      description: t.description || "",
      startDate: insertionDateStr,
      dueDate: toDateInputValue(computeTaskDueDate(insertionDate, deliveryDate, t.durationDays)),
      assigneeIds: assignedUidsFor(t.id),
    }));
    const allTasks = [mainTask, ...restTasks];

    state.busy = true;
    render();
    try {
      let targetSectionId = state.sectionId || null;
      if (state.sectionId === NEW_SECTION_VALUE) {
        const newSection = { id: uid(), name: instanceName, order: (project.sections || []).length };
        await setProjectSections(project.id, [...(project.sections || []), newSection]);
        targetSectionId = newSection.id;
      }
      await createTasksFromQuickCreateInsertion(allTasks, { projectId: project.id, sectionId: targetSectionId, createdBy: currentUser.uid });
      showToast(`${allTasks.length} tarea${allTasks.length === 1 ? "" : "s"} creada${allTasks.length === 1 ? "" : "s"}.`);
      state.busy = false;
      close();
    } catch (e) {
      console.error("handleConfirm quick-create:", e);
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
