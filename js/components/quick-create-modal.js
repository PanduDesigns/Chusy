// ============================================================================
// Modal "Nueva cabina": se abre desde el botón del topbar de un proyecto
// (ver topbar.js) — visible para todo el mundo, pero solo pulsable por
// administradores hasta que uno de ellos active "Nueva cabina" para todo el
// equipo desde el panel "Creación Rápida" (quick-create-admin-modal.js).
//
// Asistente de tres pasos (uno o varios productos de una sola pasada):
//  1. 'pick' — elegir uno o VARIOS productos (casillas, no una sola
//     elección). "Continuar" lleva al primero.
//  2. 'configure' — UN producto a la vez, "Producto X de Y" si hay más de
//     uno: nombre de esta instancia concreta (con el que se crea la
//     "tarea principal", ver más abajo), marcar sus opciones, fecha de
//     entrega y sección de destino (o crear una nueva con ese nombre).
//     "Siguiente producto" avanza al que toque; en el último, "Continuar"
//     lleva al paso 3. Cada producto guarda su propia configuración en
//     `state.configs[productId]`, así que ir hacia atrás con "← Atrás" no
//     pierde lo ya rellenado de otro producto.
//  3. 'assign' — asignación rápida (opcional), UNA sola vez para TODAS las
//     tareas de TODOS los productos elegidos a la vez, en vez de repetirla
//     producto por producto. Cada persona marcada tiene su lista de tareas,
//     agrupada por producto, y cada producto lleva un botón "Marcar todas /
//     Desmarcar todas" (v52): lo normal es que un producto entero lo haga una
//     sola persona, y así no hay que marcar las tareas una a una — luego se
//     desmarcan o marcan las que haga falta a mano. "Crear tareas" los crea
//     todos de golpe, y AVISA a cada persona asignada (v52 — antes esta vía
//     no notificaba a nadie): un único aviso por persona, con el total de
//     tareas que le tocaron, ver notifyBulkAssignment en notifications.js.
//
// La "tarea principal": por cada producto elegido (no una sola para todo
// el conjunto), además de las tareas de su plantilla (base + las de las
// opciones elegidas), SIEMPRE se crea una tarea adicional, la primera de
// las suyas, con el nombre que se le haya dado a esa instancia. Lleva de
// fecha de inicio la de hoy (cuando se inserta) y de fecha final la propia
// fecha de entrega DE ESE PRODUCTO. El resto de sus tareas también
// empiezan hoy, pero su fecha final sale de sus "días necesarios"
// (definidos en la plantilla, ver quick-create-admin-modal.js) contados
// desde hoy — sin pasarse nunca de la fecha de entrega de ese producto, y
// usando la fecha de entrega directamente si no tienen días marcados (ver
// computeTaskDueDate() más abajo). Como cada producto puede tener su
// propia sección de destino, cada tarea se crea llevando ya su propio
// `sectionId` resuelto — createTasksFromQuickCreateInsertion() (en
// quick-create.js) ya no recibe una sección compartida para todo el lote.
//
// Nada de esto persiste nada hasta pulsar "Crear tareas", en el último paso.
// ============================================================================
import { el, escapeHtml, badgeHtml, showToast, uid, toDate, toDateInputValue, addDays, colorFromString, initials, PRIORITY_LABELS } from "../utils.js";
import { getQuickCreateProducts, resolveQuickCreateTasks, createTasksFromQuickCreateInsertion } from "../data/quick-create.js";
import { setProjectSections } from "../data/projects.js";
import { notifyBulkAssignment } from "../data/notifications.js";
import { openQuickCreateAdminModal } from "./quick-create-admin-modal.js";

const NEW_SECTION_VALUE = "__new_section__"; // valor especial del desplegable de sección para "crear una nueva con este nombre"

/** Id sintético de la "tarea principal" de un producto — uid() nunca genera esto, no puede chocar con una tarea real de ninguna plantilla. Una por producto (no una sola para todo el conjunto), de ahí la función en vez de una constante suelta. */
function mainTaskIdFor(productId) {
  return `__main__:${productId}`;
}

/**
 * Fecha límite de una tarea (no la principal) a partir de la fecha de
 * inserción, la de entrega (de SU producto) y sus "días necesarios" (o
 * null si no tiene). Sin duración marcada, directamente la fecha de
 * entrega. Con duración, inserción + esos días — pero nunca más allá de
 * la fecha de entrega.
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
    step: "pick", // 'pick' | 'configure' | 'assign'
    selectedProductIds: [], // en el orden en que se han ido marcando
    configIndex: 0, // qué producto de selectedProductIds se está configurando ahora mismo (paso 'configure')
    configs: {}, // { [productId]: { selections, instanceName, deliveryDate, sectionId } }
    lastUsedDeliveryDate: "", // comodidad: la última fecha de entrega usada se propone como punto de partida del siguiente producto
    assignPeople: [], // [uid, ...] — orden en que se han ido marcando
    assignments: {}, // { [uid]: Set(taskId) } — taskId incluye mainTaskIdFor(productId)
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
    if (state.step === "pick") return renderPickScreen();
    if (state.step === "configure") return renderConfigureScreen();
    return renderAssignScreen();
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
      <p class="field__hint">Elige uno o varios productos para montar en este proyecto — puedes marcar varios y configurarlos uno detrás de otro.</p>
      <div style="display:flex;flex-direction:column;gap:8px;">${state.products.map(productPickHtml).join("")}</div>`;
  }

  function productPickHtml(p) {
    const selected = state.selectedProductIds.includes(p.id);
    const { groupCount, taskCount } = productCounts(p);
    return `
      <label class="qc-product-pick${selected ? " is-selected" : ""}">
        <input type="checkbox" data-toggle-product="${p.id}" ${selected ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--color-signal);cursor:pointer;flex-shrink:0;">
        ${badgeHtml(p.icon, p.color, "project-badge--lg")}
        <span style="min-width:0;">
          <div style="font-size:14px;font-weight:600;color:var(--color-text-hi);">${escapeHtml(p.name)}</div>
          <div style="font-size:11.5px;color:var(--color-text-faint);margin-top:2px;">${groupCount ? `${groupCount} grupo${groupCount === 1 ? "" : "s"} de opciones · ` : ""}${taskCount} tarea${taskCount === 1 ? "" : "s"} en total</div>
        </span>
      </label>`;
  }

  function productCounts(p) {
    const groupCount = (p.groups || []).length;
    const taskCount =
      (p.baseTasks || []).length +
      (p.groups || []).reduce((sum, g) => sum + (g.options || []).reduce((s2, o) => s2 + (o.tasks || []).length, 0), 0);
    return { groupCount, taskCount };
  }

  /** Configuración en memoria de un producto elegido — se crea la primera vez que se llega a su paso 'configure' (nombre de instancia ya puesto al del producto, fecha de entrega heredada de la última usada si la hay) y se conserva tal cual al ir hacia atrás y hacia adelante entre productos. */
  function ensureConfig(productId) {
    if (state.configs[productId]) return state.configs[productId];
    const product = state.products.find((p) => p.id === productId);
    state.configs[productId] = {
      selections: {},
      instanceName: product ? product.name : "",
      deliveryDate: state.lastUsedDeliveryDate || "",
      sectionId: sortedSections[0]?.id || "",
    };
    return state.configs[productId];
  }

  function renderConfigureScreen() {
    const productId = state.selectedProductIds[state.configIndex];
    const product = state.products.find((p) => p.id === productId);
    if (!product) {
      // Caso límite, en la práctica casi imposible: el producto se borró
      // mientras este selector estaba abierto con él ya elegido. Se salta.
      state.selectedProductIds = state.selectedProductIds.filter((id) => id !== productId);
      if (state.configIndex >= state.selectedProductIds.length) state.configIndex = Math.max(0, state.selectedProductIds.length - 1);
      if (!state.selectedProductIds.length) { state.step = "pick"; return renderPickScreen(); }
      return renderConfigureScreen();
    }

    const config = ensureConfig(productId);
    const resolved = resolveQuickCreateTasks(product, config.selections);
    const multi = state.selectedProductIds.length > 1;
    const mainTaskLabel = config.instanceName.trim() || "Tarea principal";
    const previewTasks = [{ title: mainTaskLabel, isMain: true }, ...resolved];

    const stepLabel = multi
      ? `<p style="font-size:12px;color:var(--color-text-faint);font-weight:600;text-transform:uppercase;letter-spacing:0.03em;margin:0;">Producto ${state.configIndex + 1} de ${state.selectedProductIds.length}</p>`
      : "";

    const baseTasksBlock = (product.baseTasks || []).length
      ? `
      <div style="font-size:12.5px;color:var(--color-text-lo);">
        <strong style="color:var(--color-text-hi);">Siempre se crean:</strong>
        <ul style="margin:4px 0 0 18px;padding:0;">${product.baseTasks.map((t) => `<li>${escapeHtml(t.title)}</li>`).join("")}</ul>
      </div>`
      : "";

    const groupsBlock = (product.groups || []).map((g) => groupPickerHtml(g, config)).join("");

    const sectionOptions = `
      <option value="" ${config.sectionId === "" ? "selected" : ""}>— Sin sección —</option>
      ${sortedSections.map((s) => `<option value="${s.id}" ${config.sectionId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      <option value="${NEW_SECTION_VALUE}" ${config.sectionId === NEW_SECTION_VALUE ? "selected" : ""}>+ Crear una sección con este nombre</option>`;

    const previewBlock = `
      <div style="border-top:1px solid var(--color-line);padding-top:14px;">
        <span class="field__label" style="font-size:13px;">${multi ? "Este producto creará" : "Se crearán"} ${previewTasks.length} tarea${previewTasks.length === 1 ? "" : "s"}</span>
        <ul style="margin:6px 0 0 18px;padding:0;max-height:150px;overflow-y:auto;font-size:12.5px;color:var(--color-text-lo);">
          ${previewTasks.map((t) => `<li>${previewTaskLabel(t)}</li>`).join("")}
        </ul>
      </div>`;

    return `
      ${stepLabel}
      <div style="display:flex;align-items:center;gap:10px;">
        ${badgeHtml(product.icon, product.color, "project-badge--lg")}
        <span style="font-size:15px;font-weight:600;">${escapeHtml(product.name)}</span>
      </div>
      <label class="field">
        <span class="field__label">Nombre de esta cabina</span>
        <input class="field__input" id="qc-instance-name" value="${escapeHtml(config.instanceName)}" placeholder="Ej. ${escapeHtml(product.name)}">
        <p class="field__hint">Se crea como la primera tarea del conjunto (la "tarea principal"), con este nombre.</p>
      </label>
      ${baseTasksBlock}
      ${groupsBlock}
      ${previewBlock}
      <div style="border-top:1px solid var(--color-line);padding-top:14px;display:flex;flex-direction:column;gap:14px;">
        <label class="field">
          <span class="field__label">Fecha de entrega</span>
          <input class="field__input" type="date" id="qc-delivery-date" value="${config.deliveryDate}">
          <p class="field__hint">La tarea principal irá de hoy a esta fecha. El resto, de hoy a su propia duración si la tiene (sin pasarse nunca de esta fecha) — o directamente esta fecha si no la tiene.</p>
        </label>
        <label class="field">
          <span class="field__label">Sección de destino</span>
          <select class="field__select" id="qc-section">${sectionOptions}</select>
        </label>
      </div>`;
  }

  function previewTaskLabel(t) {
    if (t.isMain) return `<strong style="color:var(--color-text-hi);">${escapeHtml(t.title)}</strong> <span style="color:var(--color-text-faint);">— tarea principal</span>`;
    const dur = t.durationDays === null || t.durationDays === undefined ? "" : ` <span style="color:var(--color-text-faint);">(${t.durationDays}d)</span>`;
    const prio = t.priority && t.priority !== "media" ? ` <span style="color:var(--color-text-faint);">· ${PRIORITY_LABELS[t.priority] || t.priority}</span>` : "";
    return `${escapeHtml(t.title)}${dur}${prio}`;
  }

  function groupPickerHtml(g, config) {
    const chosen = config.selections[g.id] || new Set();
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

  /** Todas las tareas de TODOS los productos elegidos — para el paso 3 (asignación rápida) y para el recuento final. Cada una lleva `productId`/`productName` para poder agruparlas por producto en el paso 3 (y marcar/desmarcar un producto entero de una vez). */
  function buildAllAssignableTasks() {
    const result = [];
    state.selectedProductIds.forEach((productId) => {
      const product = state.products.find((p) => p.id === productId);
      const config = state.configs[productId];
      if (!product || !config) return;
      const mainLabel = config.instanceName.trim() || product.name;
      result.push({ id: mainTaskIdFor(productId), title: mainLabel, isMain: true, productId, productName: product.name });
      resolveQuickCreateTasks(product, config.selections).forEach((t) => {
        result.push({ id: t.id, title: t.title, productId, productName: product.name });
      });
    });
    return result;
  }

  function renderAssignScreen() {
    return renderAssignBlock(buildAllAssignableTasks());
  }

  function renderAssignBlock(assignableTasks) {
    const multi = state.selectedProductIds.length > 1;
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
      <div>
        <span class="field__label" style="font-size:13px;">Asignación rápida (opcional)</span>
        <p class="field__hint">${assignableTasks.length} tarea${assignableTasks.length === 1 ? "" : "s"} en total${multi ? ` de ${state.selectedProductIds.length} productos` : ""}. Marca a quién quieres asignarle algo — para cada persona puedes marcar un producto entero de una vez ("Marcar todas") y luego quitar o añadir tareas sueltas. Se les asignarán y se les avisará al crear las tareas.</p>
        ${assignableMembers.length ? `<div class="chip-select" style="margin-top:8px;">${peopleChips}</div>` : `<p class="field__hint">No hay nadie más en el equipo todavía.</p>`}
        ${blocks}
      </div>`;
  }

  /** Texto del botón de un producto en el bloque de una persona: "Desmarcar todas" si ya lo tiene TODO marcado, "Marcar todas" en cualquier otro caso. */
  function assignToggleLabel(personUid, productTaskIds) {
    const checked = state.assignments[personUid] || new Set();
    return productTaskIds.length > 0 && productTaskIds.every((id) => checked.has(id)) ? "Desmarcar todas" : "Marcar todas";
  }

  function assignBlockHtml(member, assignableTasks) {
    const checked = state.assignments[member.uid] || new Set();
    // Las tareas van agrupadas por producto (en el orden en que se eligieron),
    // cada grupo con su propio botón de marcar/desmarcar todas — con un solo
    // producto hay un único grupo, con el mismo botón.
    const groups = state.selectedProductIds
      .map((productId) => {
        const product = state.products.find((p) => p.id === productId);
        const tasks = assignableTasks.filter((t) => t.productId === productId);
        return product && tasks.length ? { product, tasks } : null;
      })
      .filter(Boolean);

    const groupsHtml = groups
      .map(({ product, tasks }) => {
        const rows = tasks
          .map(
            (t) => `
      <label class="qc-option-row" style="padding:5px 8px;">
        <input type="checkbox" data-assign-uid="${member.uid}" data-assign-task="${t.id}" data-assign-product="${product.id}" ${checked.has(t.id) ? "checked" : ""}>
        <span style="font-size:12.5px;color:var(--color-text-hi);">${escapeHtml(t.title)}${t.isMain ? ` <span style="color:var(--color-text-faint);">(tarea principal)</span>` : ""}</span>
      </label>`
          )
          .join("");
        return `
      <div class="qc-assign-group">
        <div class="qc-assign-group__head">
          <span class="qc-assign-group__name">${escapeHtml(product.name)} <span style="font-weight:400;color:var(--color-text-faint);">· ${tasks.length} tarea${tasks.length === 1 ? "" : "s"}</span></span>
          <button type="button" class="btn btn--ghost btn--sm" data-assign-all-uid="${member.uid}" data-assign-all-product="${product.id}">${assignToggleLabel(member.uid, tasks.map((t) => t.id))}</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:1px;max-height:150px;overflow-y:auto;">${rows}</div>
      </div>`;
      })
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
        ${groupsHtml}
      </div>`;
  }

  // -------------------------------------------------------------- footer ----
  function renderFooter() {
    if (state.loading || !state.products.length) {
      return `<button type="button" class="btn btn--ghost" id="qc-cancel" style="margin-left:auto;">Cerrar</button>`;
    }
    if (state.step === "pick") {
      const n = state.selectedProductIds.length;
      return `
        <button type="button" class="btn btn--ghost" id="qc-cancel">Cancelar</button>
        <button type="button" class="btn btn--primary" id="qc-continue-pick" style="margin-left:auto;" ${n ? "" : "disabled"}>Continuar${n ? ` (${n})` : ""}</button>`;
    }
    if (state.step === "configure") {
      const isLast = state.configIndex >= state.selectedProductIds.length - 1;
      return `
        <button type="button" class="btn btn--ghost" id="qc-back-step" ${state.busy ? "disabled" : ""}>← Atrás</button>
        <button type="button" class="btn btn--primary" id="qc-next-step" style="margin-left:auto;" ${state.busy ? "disabled" : ""}>${isLast ? "Continuar →" : "Siguiente producto →"}</button>`;
    }
    // 'assign'
    const total = buildAllAssignableTasks().length;
    return `
      <button type="button" class="btn btn--ghost" id="qc-back-step" ${state.busy ? "disabled" : ""}>← Atrás</button>
      <button type="button" class="btn btn--primary" id="qc-confirm-all" style="margin-left:auto;" ${state.busy ? "disabled" : ""}>${state.busy ? "Creando…" : `Crear tareas (${total})`}</button>`;
  }

  // ----------------------------------------------------------- listeners ----
  function attachListeners() {
    overlay.querySelector("#qc-cancel")?.addEventListener("click", close);
    overlay.querySelector("#qc-go-admin")?.addEventListener("click", () => {
      close();
      openQuickCreateAdminModal({ currentUser, quickCreateEnabled });
    });
    overlay.querySelector("#qc-back-step")?.addEventListener("click", goBack);

    if (state.step === "pick") wirePickScreen();
    else if (state.step === "configure") wireConfigureScreen();
    else wireAssignScreen();
  }

  function goBack() {
    if (state.busy) return;
    if (state.step === "assign") {
      state.step = "configure";
      state.configIndex = state.selectedProductIds.length - 1;
    } else if (state.step === "configure") {
      if (state.configIndex > 0) state.configIndex -= 1;
      else state.step = "pick";
    }
    render();
  }

  function wirePickScreen() {
    overlay.querySelectorAll("[data-toggle-product]").forEach((input) => {
      input.addEventListener("change", () => {
        const productId = input.dataset.toggleProduct;
        if (input.checked) {
          state.selectedProductIds = [...state.selectedProductIds, productId];
        } else {
          state.selectedProductIds = state.selectedProductIds.filter((id) => id !== productId);
          delete state.configs[productId]; // ya no aplica — se reconstruye desde cero si se vuelve a marcar
        }
        render();
      });
    });

    overlay.querySelector("#qc-continue-pick")?.addEventListener("click", () => {
      if (!state.selectedProductIds.length) return;
      state.step = "configure";
      state.configIndex = 0;
      render();
      overlay.querySelector("#qc-instance-name")?.focus();
    });
  }

  function wireConfigureScreen() {
    const productId = state.selectedProductIds[state.configIndex];
    const config = ensureConfig(productId);

    overlay.querySelector("#qc-instance-name")?.addEventListener("input", (e) => { config.instanceName = e.target.value; });
    overlay.querySelector("#qc-delivery-date")?.addEventListener("change", (e) => {
      config.deliveryDate = e.target.value;
      state.lastUsedDeliveryDate = e.target.value;
    });
    overlay.querySelector("#qc-section")?.addEventListener("change", (e) => { config.sectionId = e.target.value; });

    overlay.querySelectorAll("input[data-group][data-option]").forEach((input) => {
      input.addEventListener("change", () => {
        const groupId = input.dataset.group;
        const optionId = input.dataset.option;
        if (input.type === "radio") {
          config.selections = { ...config.selections, [groupId]: new Set([optionId]) };
        } else {
          const current = new Set(config.selections[groupId] || []);
          input.checked ? current.add(optionId) : current.delete(optionId);
          config.selections = { ...config.selections, [groupId]: current };
        }
        render();
      });
    });

    overlay.querySelector("#qc-next-step")?.addEventListener("click", () => {
      const name = config.instanceName.trim();
      if (!name) { overlay.querySelector("#qc-instance-name")?.focus(); return; }
      if (!config.deliveryDate) { overlay.querySelector("#qc-delivery-date")?.focus(); return; }
      if (state.configIndex < state.selectedProductIds.length - 1) {
        state.configIndex += 1;
      } else {
        state.step = "assign";
      }
      render();
    });
  }

  function wireAssignScreen() {
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
        // Sin render() (perdería la posición de scroll de todo el paso): el
        // propio checkbox ya refleja su estado, solo hay que poner al día el
        // texto del botón de "todas" de su producto — que pasa a decir
        // "Desmarcar todas" al marcar la última, y "Marcar todas" al quitar
        // cualquiera.
        syncAssignToggle(personUid, input.dataset.assignProduct);
      });
    });

    // "Marcar todas / Desmarcar todas" de un producto, para una persona.
    // Igual que arriba, se actualizan los checkboxes en su sitio en vez de
    // repintar el paso entero.
    overlay.querySelectorAll("[data-assign-all-uid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const personUid = btn.dataset.assignAllUid;
        const productId = btn.dataset.assignAllProduct;
        const productTaskIds = buildAllAssignableTasks().filter((t) => t.productId === productId).map((t) => t.id);
        const current = new Set(state.assignments[personUid] || []);
        const markAll = assignToggleLabel(personUid, productTaskIds) === "Marcar todas";
        productTaskIds.forEach((id) => (markAll ? current.add(id) : current.delete(id)));
        state.assignments = { ...state.assignments, [personUid]: current };
        overlay.querySelectorAll("input[data-assign-uid][data-assign-task]").forEach((cb) => {
          if (cb.dataset.assignUid === personUid && cb.dataset.assignProduct === productId) cb.checked = markAll;
        });
        syncAssignToggle(personUid, productId);
      });
    });

    overlay.querySelector("#qc-confirm-all")?.addEventListener("click", handleConfirmAll);
  }

  /** Pone al día el texto del botón de "todas" de UN producto en el bloque de UNA persona, sin repintar. */
  function syncAssignToggle(personUid, productId) {
    const productTaskIds = buildAllAssignableTasks().filter((t) => t.productId === productId).map((t) => t.id);
    overlay.querySelectorAll("[data-assign-all-uid]").forEach((btn) => {
      if (btn.dataset.assignAllUid === personUid && btn.dataset.assignAllProduct === productId) btn.textContent = assignToggleLabel(personUid, productTaskIds);
    });
  }

  function assignedUidsFor(taskId) {
    return state.assignPeople.filter((personUid) => (state.assignments[personUid] || new Set()).has(taskId));
  }

  async function handleConfirmAll() {
    if (!state.selectedProductIds.length) return;

    state.busy = true;
    render();
    try {
      const insertionDate = new Date();
      const insertionDateStr = toDateInputValue(insertionDate);

      // 1) Qué sección usa cada producto — resolviendo primero las que hay
      // que crear, TODAS de una vez (no un setProjectSections() por
      // producto), para que dos productos que ambos pidan "sección nueva"
      // en esta misma pasada no se pisen el `order` ni se sobrescriban el
      // uno al otro.
      let sections = [...(project.sections || [])];
      const sectionIdByProduct = {};
      state.selectedProductIds.forEach((productId) => {
        const config = state.configs[productId];
        if (config.sectionId === NEW_SECTION_VALUE) {
          const newSection = { id: uid(), name: config.instanceName.trim() || "Nueva sección", order: sections.length };
          sections = [...sections, newSection];
          sectionIdByProduct[productId] = newSection.id;
        } else {
          sectionIdByProduct[productId] = config.sectionId || null;
        }
      });
      if (sections.length !== (project.sections || []).length) {
        await setProjectSections(project.id, sections);
      }

      // 2) Lista completa de tareas de TODOS los productos, cada una ya
      // con su sección, fechas y responsables resueltos.
      const allTasks = [];
      state.selectedProductIds.forEach((productId) => {
        const product = state.products.find((p) => p.id === productId);
        const config = state.configs[productId];
        const deliveryDate = toDate(config.deliveryDate);
        const targetSectionId = sectionIdByProduct[productId];
        const mainTaskId = mainTaskIdFor(productId);
        const instanceName = config.instanceName.trim();

        allTasks.push({
          title: instanceName,
          description: "",
          startDate: insertionDateStr,
          dueDate: toDateInputValue(deliveryDate),
          assigneeIds: assignedUidsFor(mainTaskId),
          priority: "media",
          sectionId: targetSectionId,
        });

        resolveQuickCreateTasks(product, config.selections).forEach((t) => {
          allTasks.push({
            title: t.title,
            description: t.description || "",
            startDate: insertionDateStr,
            dueDate: toDateInputValue(computeTaskDueDate(insertionDate, deliveryDate, t.durationDays)),
            assigneeIds: assignedUidsFor(t.id),
            priority: t.priority || "media",
            sectionId: targetSectionId,
          });
        });
      });

      // 3) Crear todo de golpe.
      const createdTasks = await createTasksFromQuickCreateInsertion(allTasks, { projectId: project.id, createdBy: currentUser.uid });
      const productCount = state.selectedProductIds.length;
      showToast(`${createdTasks.length} tarea${createdTasks.length === 1 ? "" : "s"} creada${createdTasks.length === 1 ? "" : "s"}${productCount > 1 ? ` en ${productCount} productos` : ""}.`);

      // 4) Avisar a quien se acaba de asignar — DESPUÉS de crear las tareas
      // con éxito (nunca antes: si la creación falla, no debe salir ningún
      // aviso de algo que no ha pasado), y sin esperar a que termine para
      // cerrar el selector: si falla, las tareas ya están creadas, solo se
      // avisa de que a la gente no le llegó el aviso.
      notifyBulkAssignment({
        createdTasks,
        projectId: project.id,
        projectName: project.name,
        fromUser: currentUser,
        teamMembers,
      }).catch((err) => {
        console.error("notifyBulkAssignment:", err);
        showToast("Tareas creadas, pero no se pudo avisar a las personas asignadas.", "error");
      });

      state.busy = false;
      close();
    } catch (e) {
      console.error("handleConfirmAll quick-create:", e);
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
