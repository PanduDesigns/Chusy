// ============================================================================
// Modal de tarea — se usa TANTO para crear como para editar (la misma
// ventana, con todos los campos visibles de golpe). Nada se guarda en
// Firestore hasta pulsar "Aceptar": mientras tanto todo vive en un objeto
// `draft` local. Esto también evita el problema anterior de que la
// ventana se reconstruyera sola mientras escribías (ya no hay ninguna
// suscripción en tiempo real mientras el modal está abierto).
//
// Varios proyectos a la vez: `draft.projectIds` guarda TODOS los proyectos
// de la tarea (el primero es el principal) y `draft.sectionByProject` su
// sección dentro de CADA uno — es una representación unificada, solo para
// dentro de este modal; al guardar se reparte entre `projectId`/
// `sectionId` (el principal) y `extraProjectIds`/`extraSections` (el
// resto), que es como vive de verdad en Firestore (ver el modelo de datos
// en el README). Los responsables (`assigneeIds`) ya no dependen de si la
// tarea es personal o no: se pueden asignar personas a un recordatorio sin
// proyecto igual que a una tarea de equipo.
//
// Comentarios: solo se muestran editando una tarea ya existente (una
// tarea nueva todavía no tiene id al que colgar comentarios), y esos sí
// se envían al momento — no forman parte del "draft".
//
// Ofertas (v56, ver offers.js): si la tarea pertenece al proyecto Ofertas
// (como principal o como adicional) el modal añade, justo debajo de los
// campos personalizados, el histórico de revisiones y el botón "Nueva
// versión". Ese botón, como todo lo demás aquí, solo toca el formulario
// (versión, sección, completada y una fila nueva en el histórico) — no
// se guarda nada hasta "Aceptar". Una oferta nueva nace en "Nuevas" con
// versión A1, salvo que se haya abierto desde el "+ Añadir oferta" de otra
// sección.
//
// v57: el histórico de una oferta arranca de serie con una fila A1
// «Versión original» (ver ensureOriginalRevision); el campo Comercial
// sugiere lo ya escrito (text-suggest.js); y en una oferta ya guardada el
// botón «Convertir en proyecto» cierra este modal —guardando antes si hay
// cambios— y abre la ventana de conversión a través de `onConvertOffer`
// (project-properties-modal.js): la conversión en sí no vive aquí.
//
// v58: completar una oferta con el círculo de la cabecera la lleva a la
// sección «Entregadas» del propio formulario (y reabrirla desde ahí la
// devuelve a «Nuevas» o «Revisiones») — ver syncOfferSectionWithCompletion.
// Igual que todo lo demás, solo se guarda al pulsar «Aceptar». El campo
// «Sector» de las ofertas no necesita código aquí: es un campo
// personalizado de tipo lista y renderCustomFields ya lo pinta.
// ============================================================================
import { createTask, updateTask, getTask, nextPersonalOwnerId } from "../data/tasks.js";
import { notifyNewAssignees } from "../data/notifications.js";
import { addComment, subscribeToComments } from "../data/comments.js";
import {
  el,
  uid,
  escapeHtml,
  initials,
  colorFromString,
  textColorFor,
  formatDateLong,
  toDate,
  toDateInputValue,
  projectBadgeHtml,
  renderTitleHtml,
  plainTitleText,
  showToast,
  PRIORITY_LABELS,
} from "../utils.js";
import {
  isOffersProject,
  findOffersSection,
  findOfferVersionField,
  findOfferCommercialField,
  findOfferLocationField,
  defaultSectorValue,
  nextOfferVersion,
  makeOriginalRevision,
  lacksOriginalRevision,
  isOfferRevised,
  offerSectionOnCompletionChange,
  OFFER_FIRST_VERSION,
} from "../offers.js";
import { attachTextSuggest } from "./text-suggest.js";
import { defaultSectorOf } from "../departments.js";
import { createOpenLocationButton } from "./open-location.js";
import { upsertTag, TAG_COLOR_PALETTE } from "../data/tags.js";
import { createRichTextEditor } from "./rich-text-editor.js";

const PRIORITIES = ["urgente", "alta", "media", "baja"];
let lastPickedTagColor = TAG_COLOR_PALETTE[0];

/** ISO de un Timestamp/Date/string de Firestore, o null si no hay una fecha válida (v57). */
function toIso(value) {
  const d = toDate(value);
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

/** Fecha corta (dd/mm/aa) de una fila del histórico de revisiones; "" si no hay fecha. */
function formatRevisionDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

function emptyDraft({ project, isPersonal, defaultSectionId, presetDueDate, currentUserId }) {
  return {
    title: "",
    description: "",
    projectIds: project ? [project.id] : [],
    sectionByProject: project ? { [project.id]: defaultSectionId || null } : {},
    assigneeIds: isPersonal && currentUserId ? [currentUserId] : [],
    startDate: null,
    dueDate: presetDueDate || null,
    priority: "media",
    tags: [],
    dependsOn: [],
    subtasks: [],
    attachments: [],
    customFields: {},
    isMilestone: false,
    isComplete: false,
  };
}

export function openTaskModal({
  taskId,
  project,
  isPersonal,
  defaultSectionId,
  presetDueDate,
  teamMembers,
  allProjects,
  tagsRegistry,
  currentUserProfile,
  // v57 (todos opcionales): `getCommercialOptions()` da los valores de
  // Comercial ya usados para sugerirlos; `onConvertOffer(taskId)` abre la
  // conversión de oferta en proyecto; `onOpenProject(projectId)` va al
  // proyecto en el que ya se convirtió. Sin ellos, el modal se comporta
  // como antes (sin sugerencias ni botón de convertir).
  getCommercialOptions,
  onConvertOffer,
  onOpenProject,
  onSaved,
  onClosed,
}) {
  const root = document.getElementById("modal-root");
  const isNew = !taskId;
  const projects = allProjects || [];
  let draft = emptyDraft({ project, isPersonal, defaultSectionId, presetDueDate, currentUserId: currentUserProfile?.uid });
  // ownerId de la tarea tal como está en Firestore ahora mismo (null si
  // nunca lo tuvo) — no es parte del draft porque no se elige a mano en
  // ningún control del formulario, ver computeOwnerIdOnSave().
  let loadedOwnerId = null;
  // Responsables que tenía la tarea al abrirla — para, al guardar, avisar
  // SOLO a quien se haya añadido de nuevo (ver notifyNewAssignees en
  // handleAccept), no a quien ya estaba antes de este cambio.
  let loadedAssigneeIds = [];
  let dirty = false;
  let comments = [];
  let unsubComments = null;
  let descriptionEditor = null;
  // Histórico de revisiones (v56, solo tareas de Ofertas). Igual que el
  // resto del formulario, vive aquí hasta pulsar "Aceptar"; no forma parte
  // de `draft` porque solo se guarda cuando la tarea ES una oferta (ver
  // handleAccept) y `draft` se vuelca entero en Firestore.
  let revisions = [];
  // Filas añadidas con "Nueva versión" en ESTA apertura del modal: solo
  // por esas se avisa al guardar si siguen sin explicar qué cambió, no por
  // una fila antigua que alguien dejó en blanco hace semanas.
  const newRevisionIds = new Set();
  // v57. A qué proyecto se convirtió ya esta oferta (y cuándo, en ISO), si
  // se convirtió; y cuándo se creó la tarea, para fechar la fila A1 de
  // partida de una oferta que llega sin histórico.
  let convertedProjectId = null;
  let convertedAtIso = null;
  let taskCreatedIso = null;
  // Solo se comprueba UNA vez por apertura si falta la fila A1 de partida
  // (ver ensureOriginalRevision): sin esto, quitar esa fila la volvería a
  // crear al instante.
  let originalRevisionChecked = false;
  // Desplegables de sugerencias enganchados a campos de este formulario.
  let suggestHandles = [];

  const overlay = el(`<div class="modal-overlay"><div class="modal"><div style="padding:40px;text-align:center;color:var(--color-text-lo);">Cargando…</div></div></div>`);
  root.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) attemptClose(); });
  document.addEventListener("keydown", onKeydown);

  if (isNew) {
    applyOfferDefaults();
    buildForm();
  } else {
    getTask(taskId).then((t) => {
      if (!t) { showToastLike("Esta tarea ya no existe."); close(true); return; }
      const projectIds = [t.projectId, ...(t.extraProjectIds || [])].filter(Boolean);
      const sectionByProject = {};
      if (t.projectId) sectionByProject[t.projectId] = t.sectionId || null;
      Object.entries(t.extraSections || {}).forEach(([pid, sid]) => { sectionByProject[pid] = sid || null; });
      loadedOwnerId = t.ownerId || null;
      loadedAssigneeIds = t.assigneeIds || [];
      convertedProjectId = t.convertedProjectId || null;
      convertedAtIso = toIso(t.convertedAt);
      taskCreatedIso = toIso(t.createdAt);
      revisions = (t.revisions || []).map((r) => ({
        id: r.id || uid(),
        version: String(r.version ?? ""),
        changes: String(r.changes ?? ""),
        createdAt: r.createdAt || null,
      }));
      draft = {
        title: t.title, description: t.description,
        projectIds, sectionByProject,
        assigneeIds: t.assigneeIds || [], startDate: t.startDate, dueDate: t.dueDate,
        priority: t.priority, tags: t.tags || [], dependsOn: t.dependsOn || [],
        subtasks: t.subtasks || [], attachments: t.attachments || [],
        customFields: t.customFields || {},
        isMilestone: !!t.isMilestone, isComplete: !!t.isComplete,
      };
      buildForm();
      unsubComments = subscribeToComments(taskId, (c) => { comments = c; renderComments(); });
    });
  }

  function onKeydown(e) { if (e.key === "Escape") attemptClose(); }

  function attemptClose() {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
    close();
  }

  function close(skipCallback) {
    if (unsubComments) unsubComments();
    if (descriptionEditor) descriptionEditor.destroy();
    suggestHandles.forEach((h) => h.destroy());
    suggestHandles = [];
    document.querySelectorAll(".project-add-popover").forEach((p) => p.remove());
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
    if (!skipCallback) onClosed();
  }

  function showToastLike(msg) {
    // fallback mínimo si algo va mal antes de tener el formulario montado
    console.warn(msg);
  }

  function markDirty() { dirty = true; }

  // --------------------------------------------------------------------
  function buildForm() {
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <button class="task-row__check${draft.isComplete ? " is-checked" : ""}" id="t-complete" title="Marcar como completada" style="width:22px;height:22px;">${draft.isComplete ? "✓" : ""}</button>
          <input class="modal__title-input" id="t-title" value="${escapeHtml(draft.title)}" placeholder="Título de la ${offersProject() ? "oferta" : "tarea"}">
          <button type="button" class="modal__title-bold-btn" id="t-title-bold" title="Negrita: selecciona texto del título y pulsa (o Ctrl/Cmd+B)">B</button>
          <button class="modal__close" id="t-close">✕</button>
        </div>
        <div class="modal__title-preview" id="t-title-preview"></div>
        <div class="modal__body">

          <div class="field">
            <span class="field__label-row"><span class="field__label">Proyectos</span></span>
            <div class="project-assign-list" id="t-projects"></div>
            <button type="button" class="btn btn--ghost btn--sm" id="t-add-project" style="width:fit-content;">+ Añadir a un proyecto</button>
          </div>

          <div class="field">
            <span class="field__label">Prioridad</span>
            <div class="chip-select" id="t-priority">${priorityChipsHtml()}</div>
          </div>

          <div class="modal-row">
            <label class="field">
              <span class="field__label">Inicio</span>
              <input class="field__input" type="date" id="t-start" value="${toDateInputValue(draft.startDate)}">
            </label>
            <label class="field">
              <span class="field__label">Fecha límite</span>
              <input class="field__input" type="date" id="t-due" value="${toDateInputValue(draft.dueDate)}">
            </label>
          </div>

          <button type="button" class="chip${draft.isMilestone ? " is-selected" : ""}" id="t-milestone" style="width:fit-content;">
            🚩 ${draft.isMilestone ? "Marcada como hito" : "Marcar como hito"}
          </button>

          <div class="field">
            <span class="field__label">Responsables</span>
            <div class="chip-select" id="t-assignees">
              ${[...(teamMembers || [])]
                .filter((m) => (!m.isImported && !m.deleted) || draft.assigneeIds.includes(m.uid))
                .sort((a, b) => ((a.isImported || a.deleted) ? 1 : 0) - ((b.isImported || b.deleted) ? 1 : 0))
                .map((m) => `
                <button type="button" class="chip${draft.assigneeIds.includes(m.uid) ? " is-selected" : ""}" data-uid="${m.uid}">
                  <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
                  ${escapeHtml(m.name)}${m.isImported ? ` <span style="color:var(--color-text-faint);">· Asana</span>` : m.deleted ? ` <span style="color:var(--color-text-faint);">· Eliminado</span>` : ""}
                </button>`).join("")}
            </div>
          </div>

          <div class="field">
            <span class="field__label">Etiquetas</span>
            <div class="chip-select" id="t-tags"></div>
            <div class="tag-picker">
              <input class="field__input" id="t-new-tag" placeholder="Añadir etiqueta…" autocomplete="off">
              <div id="t-tag-suggest"></div>
            </div>
          </div>

          <div id="t-customfields"></div>

          <div id="t-revisions"></div>

          <div class="field">
            <span class="field__label">Descripción</span>
            <div id="t-description-mount"></div>
          </div>

          <div class="field">
            <span class="field__label">Subtareas</span>
            <div class="subtask-list" id="t-subtasks"></div>
            <div class="subtask-add">
              <input class="field__input" id="t-new-subtask" placeholder="Añadir subtarea y pulsar Enter">
            </div>
          </div>

          <div class="field">
            <span class="field__label">Enlaces adjuntos</span>
            <div id="t-attachments" style="display:flex;flex-direction:column;gap:6px;"></div>
            <div class="modal-row" style="gap:8px;">
              <input class="field__input" id="t-link-name" placeholder="Nombre (ej. Plano instalación)" style="flex:1;">
              <input class="field__input" id="t-link-url" placeholder="https://…" style="flex:1.4;">
              <button class="btn btn--ghost btn--sm" id="t-add-link" type="button">Añadir</button>
            </div>
          </div>

          ${!isNew ? `
          <div class="section-divider"><span class="section-divider__label">Comentarios</span></div>
          <div id="t-comments"></div>
          <div class="comment-add">
            <textarea class="field__textarea" id="t-new-comment" placeholder="Escribe un comentario…" style="min-height:44px;"></textarea>
            <button class="btn btn--primary btn--sm" id="t-send-comment">Enviar</button>
          </div>` : `
          <p class="field__hint">Podrás comentar después de guardar la tarea.</p>`}
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="t-cancel">Cancelar</button>
          <button class="btn btn--primary" id="t-accept" style="margin-left:auto;">Aceptar</button>
        </div>
      </div>
    `;

    wireStaticListeners();
    renderProjectRows();
    renderCustomFields();
    renderRevisions();
    renderTagChips();
    renderSubtasks();
    renderAttachments();
    if (!isNew) renderComments();

    descriptionEditor = createRichTextEditor(overlay.querySelector("#t-description-mount"), {
      initialValue: draft.description,
      placeholder: "Escribe «/» para ver el menú",
      onChange: (html) => { draft.description = html; markDirty(); },
    });
    renderTitlePreview();
  }

  /**
   * Vista previa de la negrita del título, justo debajo de la cabecera —
   * el campo en sí es un `<input>` normal (no un editor de texto
   * enriquecido: no hace falta para solo negrita, y así se comporta como
   * cualquier campo de texto — Enter, pegar, móvil...) y no puede mostrar
   * parte de su propio valor en negrita, así que esta línea es la única
   * forma de ver el resultado mientras se escribe. Solo aparece si el
   * título tiene alguna marca `**` — en el caso normal, sin negrita, no
   * ocupa sitio.
   */
  function renderTitlePreview() {
    const box = overlay.querySelector("#t-title-preview");
    if (!box) return;
    if (!draft.title.includes("**")) {
      box.innerHTML = "";
      box.classList.remove("is-visible");
      return;
    }
    box.innerHTML = `Vista previa: ${renderTitleHtml(draft.title)}`;
    box.classList.add("is-visible");
  }

  /**
   * Envuelve (o desenvuelve, si ya lo estaba) la selección actual del
   * campo de título entre `**dobles asteriscos**` — ver renderTitleHtml()
   * en utils.js para cómo se interpretan al mostrarse. Sin nada
   * seleccionado, inserta el par vacío con el cursor listo en medio para
   * escribir directamente.
   */
  function toggleTitleBold() {
    const input = overlay.querySelector("#t-title");
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    if (start === end) {
      input.value = `${value.slice(0, start)}****${value.slice(end)}`;
      input.setSelectionRange(start + 2, start + 2);
    } else {
      const selected = value.slice(start, end);
      const alreadyBold = selected.length >= 4 && selected.startsWith("**") && selected.endsWith("**");
      const replacement = alreadyBold ? selected.slice(2, -2) : `**${selected}**`;
      input.value = value.slice(0, start) + replacement + value.slice(end);
      input.setSelectionRange(start, start + replacement.length);
    }
    input.focus();
    draft.title = input.value;
    markDirty();
    renderTitlePreview();
  }

  function priorityChipsHtml() {
    return PRIORITIES.map(
      (p) => `<button type="button" class="chip${p === draft.priority ? " is-selected" : ""}" data-priority="${p}"><span class="chip__dot priority-${p}"></span>${PRIORITY_LABELS[p]}</button>`
    ).join("");
  }

  // --------------------------------------------------------------------
  // Selector de proyectos: una fila por cada proyecto de la tarea (el
  // primero de draft.projectIds es el principal, aunque aquí no se
  // distinguen visualmente — Chusy los trata igual salvo por dentro, al
  // guardar) con su propio desplegable de sección DENTRO de ese proyecto.
  // --------------------------------------------------------------------
  function renderProjectRows() {
    const box = overlay.querySelector("#t-projects");
    const validIds = draft.projectIds.filter((pid) => projects.some((p) => p.id === pid));
    if (validIds.length !== draft.projectIds.length) draft.projectIds = validIds; // proyecto borrado entre tanto

    if (!draft.projectIds.length) {
      box.innerHTML = `<p class="field__hint" style="margin:0;">Sin proyecto — de momento solo la ven quien la creó y sus responsables, en Mis tareas.</p>`;
      return;
    }

    box.innerHTML = draft.projectIds
      .map((pid) => {
        const proj = projects.find((p) => p.id === pid);
        const sections = [...(proj.sections || [])].sort((a, b) => a.order - b.order);
        const currentSection = draft.sectionByProject[pid] || "";
        return `
        <div class="project-assign-row" data-project="${pid}">
          ${projectBadgeHtml(proj, "project-badge--sm")}
          <span class="project-assign-row__name">${escapeHtml(proj.name)}</span>
          <select class="field__select project-assign-row__section" data-section-for="${pid}">
            <option value="">— Sin sección —</option>
            ${sections.map((s) => `<option value="${s.id}" ${s.id === currentSection ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
          <button type="button" class="attachment-row__remove" data-remove-project="${pid}" title="Quitar de este proyecto">✕</button>
        </div>`;
      })
      .join("");

    box.querySelectorAll("[data-section-for]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        draft.sectionByProject = { ...draft.sectionByProject, [sel.dataset.sectionFor]: e.target.value || null };
        markDirty();
      });
    });
    box.querySelectorAll("[data-remove-project]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.removeProject;
        draft.projectIds = draft.projectIds.filter((id) => id !== pid);
        const rest = { ...draft.sectionByProject };
        delete rest[pid];
        draft.sectionByProject = rest;
        markDirty();
        renderProjectRows();
        renderCustomFields();
        renderRevisions();
      });
    });
  }

  function openAddProjectPopover(anchorBtn) {
    document.querySelectorAll(".project-add-popover").forEach((p) => p.remove());
    const available = projects.filter((p) => !draft.projectIds.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));

    const rect = anchorBtn.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = "project-add-popover filter-popover";
    // Los botones van SUELTOS dentro de .filter-popover (que ya los coloca
    // en flujo normal, con su propio padding/overflow), sin envolverlos en
    // un <div class="tag-suggest"> — esa clase lleva position:absolute,
    // pensada para colgar de .tag-picker (su padre relative de siempre);
    // fuera de ese contexto posicionaba la lista entera fuera de la caja
    // visible de este popover, recortada por su overflow-y — se veía como
    // si no hubiera ningún proyecto. .tag-suggest__item en sí (cada fila)
    // no tiene ese problema, solo el contenedor que ya no se usa aquí.
    pop.innerHTML = available.length
      ? available
          .map((p) => `<button type="button" class="tag-suggest__item" data-add-project="${p.id}">${projectBadgeHtml(p, "project-badge--sm")}${escapeHtml(p.name)}</button>`)
          .join("")
      : `<p style="color:var(--color-text-faint);font-size:12px;padding:6px 8px;margin:0;">No hay más proyectos disponibles.</p>`;
    document.body.appendChild(pop);

    const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 20);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${rect.bottom + 6}px`;

    pop.querySelectorAll("[data-add-project]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.addProject;
        const proj = projects.find((p) => p.id === pid);
        draft.projectIds = [...draft.projectIds, pid];
        // Sin sección de entrada a propósito (igual que una tarea nueva sin
        // botón "+ Añadir tarea" de una sección concreta): no hay ninguna
        // sección de ESTE proyecto que sea más "la correcta" que otra solo
        // por añadirse desde aquí.
        draft.sectionByProject = { ...draft.sectionByProject, [pid]: null };
        markDirty();
        renderProjectRows();
        renderCustomFields();
        renderRevisions();
        closePopover();
      });
    });

    function onOutside(e) {
      if (!pop.contains(e.target) && e.target !== anchorBtn) closePopover();
    }
    function onKeydown(e) { if (e.key === "Escape") closePopover(); }
    function closePopover() {
      pop.remove();
      document.removeEventListener("click", onOutside);
      document.removeEventListener("keydown", onKeydown);
    }
    setTimeout(() => {
      document.addEventListener("click", onOutside);
      document.addEventListener("keydown", onKeydown);
    }, 0);
  }

  // Campos personalizados: unión de los de CADA proyecto al que pertenece
  // ahora mismo la tarea (draft.projectIds) más los personales de quien
  // edita — se vuelve a pintar cada vez que la lista de proyectos cambia,
  // para que añadir/quitar un proyecto muestre/oculte sus campos al
  // momento sin tener que cerrar y reabrir la tarea.
  function renderCustomFields() {
    const mount = overlay.querySelector("#t-customfields");
    const projectFieldDefs = draft.projectIds
      .map((pid) => projects.find((p) => p.id === pid))
      .filter(Boolean)
      .flatMap((p) => p.customFieldDefs || []);
    const personalFieldDefs = (currentUserProfile?.personalCustomFieldDefs || []).map((f) => ({ ...f, isPersonalField: true }));
    const allFieldDefs = [...projectFieldDefs, ...personalFieldDefs];

    // v60: el campo Ubicación de una oferta lleva el botón «Abrir
    // Ubicación» junto a su etiqueta (ver components/open-location.js). Se
    // pinta como un `<div class="field">` y no como el `<label>` de los
    // demás: un botón dentro de un `<label>` pasaría a ser SU control
    // (clic en el texto = pulsar el botón) y no la casilla.
    const offersForFields = offersProject();
    const locationDef = offersForFields ? findOfferLocationField(offersForFields) : null;
    const isLocationField = (f) => !!locationDef && !f.isPersonalField && f.id === locationDef.id && f.type === "texto";

    mount.innerHTML = allFieldDefs
      .map(
        (f) => isLocationField(f) ? `
      <div class="field">
        <span class="field__label-row">
          <span class="field__label">${escapeHtml(f.name)}</span>
          <span class="field__label-action" data-open-location-slot></span>
        </span>
        <input class="field__input" type="text" data-custom-field="${f.id}" value="${escapeHtml(draft.customFields[f.id] ?? "")}" placeholder="Escribe…">
      </div>` : `
      <label class="field">
        <span class="field__label">${escapeHtml(f.name)}${f.isPersonalField ? ` <span style="color:var(--color-text-faint);font-weight:400;">· personal</span>` : ""}</span>
        ${f.type === "numero"
          ? `<input class="field__input" type="number" data-custom-field="${f.id}" value="${draft.customFields[f.id] ?? ""}" placeholder="0">`
          : f.type === "texto"
          ? `<input class="field__input" type="text" data-custom-field="${f.id}" value="${escapeHtml(draft.customFields[f.id] ?? "")}" placeholder="Escribe…">`
          : `<select class="field__select" data-custom-field="${f.id}">
              <option value="">— Sin definir —</option>
              ${f.options.map((opt) => `<option value="${escapeHtml(opt)}" ${draft.customFields[f.id] === opt ? "selected" : ""}>${escapeHtml(opt)}</option>`).join("")}
            </select>`}
      </label>`
      )
      .join("");

    // v57: el campo Comercial de Ofertas sugiere lo ya escrito. Se guarda
    // cada desplegable para poder soltarlo al volver a pintar los campos.
    suggestHandles.forEach((h) => h.destroy());
    suggestHandles = [];
    const commercialDef = getCommercialOptions && offersForFields ? findOfferCommercialField(offersForFields) : null;

    mount.querySelectorAll("[data-custom-field]").forEach((elm) => {
      // Enganchado ANTES del listener de `change` de aquí abajo a propósito
      // (ver la cabecera de text-suggest.js): así ese listener ya lee el
      // valor ajustado a la forma existente ("juan perez" → "Juan Pérez").
      if (commercialDef && elm.tagName === "INPUT" && elm.type === "text" && elm.dataset.customField === commercialDef.id) {
        suggestHandles.push(attachTextSuggest(elm, { getOptions: getCommercialOptions }));
      }
      elm.addEventListener("change", (e) => {
        draft.customFields = { ...draft.customFields, [elm.dataset.customField]: e.target.value || null };
        markDirty();
      });
    });

    // v60: el botón actúa sobre lo que haya escrito en la casilla EN ESE
    // MOMENTO (aunque la oferta no se haya guardado todavía) y se deshabilita
    // mientras esté vacía.
    const locationSlot = mount.querySelector("[data-open-location-slot]");
    if (locationSlot) {
      const locationInput = locationSlot.closest(".field").querySelector("input");
      const openButton = createOpenLocationButton({ getValue: () => locationInput.value, compact: true });
      locationSlot.appendChild(openButton.el);
      locationInput.addEventListener("input", openButton.refresh);
      locationInput.addEventListener("change", openButton.refresh);
    }
  }

  // --------------------------------------------------------------------
  // Ofertas (v56, ver offers.js)
  // --------------------------------------------------------------------

  /** El proyecto Ofertas de esta tarea AHORA MISMO (principal o adicional), o null si no pertenece a él. */
  function offersProject() {
    for (const pid of draft.projectIds) {
      const p = projects.find((x) => x.id === pid);
      if (isOffersProject(p)) return p;
    }
    return null;
  }

  /**
   * Valores de partida de una oferta NUEVA: sección "Nuevas" (salvo que se
   * haya abierto desde el "+ Añadir oferta" de una sección concreta, que
   * manda), versión A1 y, desde la v63, el Sector que le toca al
   * departamento de quien la crea. Solo si el proyecto sigue teniendo esa
   * sección o ese campo — si alguien los borró, se deja el formulario como
   * estaba.
   */
  function applyOfferDefaults() {
    const offers = offersProject();
    if (!offers) return;
    if (!defaultSectionId) {
      const nuevas = findOffersSection(offers, "nuevas");
      if (nuevas) draft.sectionByProject = { ...draft.sectionByProject, [offers.id]: nuevas.id };
    }
    const versionField = findOfferVersionField(offers);
    if (versionField && !draft.customFields[versionField.id]) {
      draft.customFields = { ...draft.customFields, [versionField.id]: OFFER_FIRST_VERSION };
    }
    // v63: el Sector de una oferta nueva sale ya puesto según el departamento
    // de quien la crea (Diseño - Industria → Industria; Diseño - Automoción →
    // Automoción; el resto de departamentos, ninguno). Es solo el valor de
    // partida del desplegable: se puede cambiar antes de pulsar Aceptar y
    // después, como cualquier otro campo.
    const sector = defaultSectorValue(offers, defaultSectorOf(currentUserProfile?.department));
    if (sector && !draft.customFields[sector.fieldId]) {
      draft.customFields = { ...draft.customFields, [sector.fieldId]: sector.value };
    }
  }

  /**
   * Histórico de revisiones + botón "Nueva versión" — solo si la tarea es
   * una oferta (si no, el hueco #t-revisions se queda vacío). Se vuelve a
   * pintar al añadir/quitar un proyecto y al añadir/quitar una fila, pero
   * NO al escribir en una de sus casillas (perdería el foco a mitad de
   * frase): ahí solo se actualiza la fila correspondiente de `revisions`.
   */
  function renderRevisions() {
    const mount = overlay.querySelector("#t-revisions");
    if (!mount) return;
    if (!offersProject()) { mount.innerHTML = ""; return; }
    ensureOriginalRevision();

    mount.innerHTML = `
      <div class="field">
        <span class="field__label-row">
          <span class="field__label">Histórico de revisiones</span>
          ${isNew ? "" : `<span style="margin-left:auto;display:flex;gap:6px;">
            <button type="button" class="btn btn--ghost btn--sm" id="t-new-version">+ Nueva versión</button>
            ${convertButtonHtml()}
          </span>`}
        </span>
        ${revisions.length
          ? `<div class="revision-table">
              <div class="revision-row revision-row--head"><span>Versión</span><span>Cambios</span><span></span></div>
              ${revisions
                .map(
                  (r) => `
              <div class="revision-row" data-revision="${r.id}">
                <div class="revision-row__version">
                  <input class="field__input" type="text" data-rev-version="${r.id}" value="${escapeHtml(r.version)}" aria-label="Versión">
                  <span class="revision-row__date">${formatRevisionDate(r.createdAt)}</span>
                </div>
                <textarea class="field__textarea revision-row__changes" data-rev-changes="${r.id}" rows="2" placeholder="¿Qué ha cambiado y por qué?">${escapeHtml(r.changes)}</textarea>
                <button type="button" class="attachment-row__remove" data-rev-remove="${r.id}" title="Quitar esta fila del histórico">✕</button>
              </div>`
                )
                .join("")}
            </div>`
          : `<p class="field__hint" style="margin:0;">${isNew ? "Podrás crear nuevas versiones después de guardar la oferta." : "Sin revisiones todavía. Cuando el comercial pida un cambio, pulsa «Nueva versión»."}</p>`}
        ${isNew ? `<p class="field__hint" style="margin:6px 0 0;">Podrás crear nuevas versiones y convertir la oferta en proyecto después de guardarla.</p>` : ""}
        ${convertedNoteHtml()}
      </div>`;

    const newVersionBtn = mount.querySelector("#t-new-version");
    if (newVersionBtn) newVersionBtn.addEventListener("click", startNewVersion);
    const convertBtn = mount.querySelector("#t-convert");
    if (convertBtn) convertBtn.addEventListener("click", startConversion);
    const openProjectBtn = mount.querySelector("#t-open-project");
    if (openProjectBtn) openProjectBtn.addEventListener("click", openConvertedProject);
    mount.querySelectorAll("[data-rev-version]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const row = revisions.find((r) => r.id === input.dataset.revVersion);
        if (row) { row.version = e.target.value; markDirty(); }
      });
    });
    mount.querySelectorAll("[data-rev-changes]").forEach((ta) => {
      ta.addEventListener("input", (e) => {
        const row = revisions.find((r) => r.id === ta.dataset.revChanges);
        if (row) { row.changes = e.target.value; markDirty(); }
      });
    });
    mount.querySelectorAll("[data-rev-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        revisions = revisions.filter((r) => r.id !== btn.dataset.revRemove);
        newRevisionIds.delete(btn.dataset.revRemove);
        markDirty();
        renderRevisions();
      });
    });
  }

  /**
   * v57: toda oferta arranca su histórico con la fila A1 «Versión original»
   * (makeOriginalRevision, offers.js). Se pone delante cuando falta
   * (lacksOriginalRevision): en una oferta nueva, en una ya guardada sin
   * ninguna fila (anterior a la v57) y en una con el histórico ya empezado
   * en la v56 (A2, A3… — la A1 no se apuntaba). Solo se comprueba la primera
   * vez en esta apertura del modal (ver `originalRevisionChecked`): quien
   * quite esa fila a propósito no la ve reaparecer al instante. NO marca el
   * formulario como modificado — abrir una oferta y cerrarla sin tocar
   * nada no pregunta por cambios ni escribe nada; la fila se guarda con la
   * siguiente vez que se pulse "Aceptar".
   */
  function ensureOriginalRevision() {
    if (originalRevisionChecked) return;
    originalRevisionChecked = true;
    if (!lacksOriginalRevision(revisions)) return;
    revisions = [makeOriginalRevision({ id: uid(), createdAt: taskCreatedIso || new Date().toISOString() }), ...revisions];
  }

  /** El proyecto al que ya se convirtió esta oferta, si sigue entre los proyectos activos. */
  function convertedProject() {
    return convertedProjectId ? projects.find((p) => p.id === convertedProjectId) || null : null;
  }

  /** El botón de convertir (o de ir al proyecto ya creado) de la cabecera del histórico; "" si el modal no recibió `onConvertOffer`. */
  function convertButtonHtml() {
    if (!onConvertOffer) return "";
    if (convertedProject()) {
      return onOpenProject ? `<button type="button" class="btn btn--ghost btn--sm" id="t-open-project">📁 Abrir proyecto</button>` : "";
    }
    return `<button type="button" class="btn btn--primary btn--sm" id="t-convert" title="Crear un proyecto con los datos de esta oferta">${convertedProjectId ? "Convertir de nuevo" : "✅ Convertir en proyecto"}</button>`;
  }

  /** La línea de debajo del histórico que dice a qué proyecto se convirtió, y cuándo. */
  function convertedNoteHtml() {
    if (!convertedProjectId) return "";
    const project = convertedProject();
    const when = formatRevisionDate(convertedAtIso);
    const what = project
      ? `Convertida en el proyecto «${escapeHtml(project.name)}»`
      : "Se convirtió en un proyecto que ahora no está activo (archivado o eliminado)";
    return `<p class="field__hint" style="margin:8px 0 0;">${what}${when ? ` el ${when}` : ""}.</p>`;
  }

  /**
   * «Convertir en proyecto»: cierra este modal y abre la ventana de
   * conversión (la abre `onConvertOffer`, que la carga de Firestore ya
   * guardada — por eso, si hay cambios sin guardar, se guardan ANTES: la
   * conversión leería una oferta desactualizada, y al volver aquí el modal
   * antiguo pisaría con su copia lo que la conversión cambia en la oferta).
   */
  async function startConversion() {
    if (dirty) {
      if (!confirm("Se guardarán los cambios de la oferta antes de convertirla en proyecto. ¿Continuar?")) return;
      await handleAccept(() => onConvertOffer(taskId));
      return;
    }
    close();
    onConvertOffer(taskId);
  }

  function openConvertedProject() {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return;
    const id = convertedProjectId;
    close();
    onOpenProject(id);
  }

  /**
   * v58: al completar una oferta con el círculo de la cabecera, su sección
   * pasa a «Entregadas»; al reabrirla estando en «Entregadas», vuelve a
   * «Nuevas» —o a «Revisiones» si ya tuvo alguna revisión—. La regla
   * (también para una oferta ya convertida en proyecto, que se queda en
   * «Cerradas») es offerSectionOnCompletionChange, offers.js; aquí solo se
   * aplica al formulario y se repinta el desplegable de sección, para que
   * se vea el cambio antes de guardar. Si el usuario cambia después la
   * sección a mano, manda lo que elija.
   */
  function syncOfferSectionWithCompletion() {
    const offers = offersProject();
    if (!offers) return;
    const current = draft.sectionByProject[offers.id] || null;
    const target = offerSectionOnCompletionChange(offers, {
      isComplete: draft.isComplete,
      isConverted: !!convertedProjectId,
      currentSectionId: current,
      revised: isOfferRevised(revisions),
    });
    if (!target || target === current) return;
    draft.sectionByProject = { ...draft.sectionByProject, [offers.id]: target };
    renderProjectRows();
  }

  /**
   * "Nueva versión": la oferta vuelve a quedar sin completar, pasa a la
   * sección Revisiones, sube de versión (A1 → A2) y se apunta una fila
   * nueva en el histórico para escribir qué cambia y por qué. Todo sobre el
   * formulario — se guarda al pulsar "Aceptar", como cualquier otro cambio.
   */
  function startNewVersion() {
    const offers = offersProject();
    if (!offers) return;
    const versionField = findOfferVersionField(offers);
    const lastRevisionVersion = revisions.length ? revisions[revisions.length - 1].version : "";
    const current = (versionField && draft.customFields[versionField.id]) || lastRevisionVersion;
    const next = nextOfferVersion(current);

    draft.isComplete = false;
    const completeBtn = overlay.querySelector("#t-complete");
    completeBtn.classList.remove("is-checked");
    completeBtn.textContent = "";

    const revisionsSection = findOffersSection(offers, "revisiones");
    if (revisionsSection) {
      draft.sectionByProject = { ...draft.sectionByProject, [offers.id]: revisionsSection.id };
    } else {
      showToast('Ofertas no tiene ninguna sección "Revisiones": la oferta se queda donde estaba.', "error");
    }
    if (versionField) draft.customFields = { ...draft.customFields, [versionField.id]: next };

    const row = { id: uid(), version: next, changes: "", createdAt: new Date().toISOString() };
    revisions = [...revisions, row];
    newRevisionIds.add(row.id);
    markDirty();

    renderProjectRows();
    renderCustomFields();
    renderRevisions();
    const changesBox = overlay.querySelector(`[data-rev-changes="${row.id}"]`);
    if (changesBox) {
      changesBox.focus();
      if (typeof changesBox.scrollIntoView === "function") changesBox.scrollIntoView({ block: "nearest" });
    }
  }

  // --------------------------------------------------------------------
  function wireStaticListeners() {
    overlay.querySelector("#t-close").addEventListener("click", attemptClose);
    overlay.querySelector("#t-cancel").addEventListener("click", attemptClose);

    const completeBtn = overlay.querySelector("#t-complete");
    completeBtn.addEventListener("click", () => {
      draft.isComplete = !draft.isComplete;
      completeBtn.classList.toggle("is-checked", draft.isComplete);
      completeBtn.textContent = draft.isComplete ? "✓" : "";
      syncOfferSectionWithCompletion();
      markDirty();
    });

    const titleInput = overlay.querySelector("#t-title");
    titleInput.addEventListener("input", (e) => { draft.title = e.target.value; markDirty(); renderTitlePreview(); });
    titleInput.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleTitleBold(); }
    });
    const titleBoldBtn = overlay.querySelector("#t-title-bold");
    // mousedown (no click) + preventDefault: así el foco nunca sale del
    // campo de título al pulsar este botón, y la selección de texto que
    // tuviera hecha sigue intacta cuando toggleTitleBold() la lee.
    titleBoldBtn.addEventListener("mousedown", (e) => e.preventDefault());
    titleBoldBtn.addEventListener("click", () => toggleTitleBold());

    overlay.querySelector("#t-add-project").addEventListener("click", (e) => openAddProjectPopover(e.currentTarget));

    overlay.querySelector("#t-start").addEventListener("change", (e) => { draft.startDate = e.target.value || null; markDirty(); });
    overlay.querySelector("#t-due").addEventListener("change", (e) => { draft.dueDate = e.target.value || null; markDirty(); });

    const milestoneBtn = overlay.querySelector("#t-milestone");
    milestoneBtn.addEventListener("click", () => {
      draft.isMilestone = !draft.isMilestone;
      milestoneBtn.classList.toggle("is-selected", draft.isMilestone);
      milestoneBtn.textContent = `🚩 ${draft.isMilestone ? "Marcada como hito" : "Marcar como hito"}`;
      markDirty();
    });

    overlay.querySelectorAll("#t-priority .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        draft.priority = chip.dataset.priority;
        overlay.querySelectorAll("#t-priority .chip").forEach((c) => c.classList.toggle("is-selected", c === chip));
        markDirty();
      });
    });

    const assigneesBox = overlay.querySelector("#t-assignees");
    if (assigneesBox) {
      assigneesBox.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const u = chip.dataset.uid;
          const set = new Set(draft.assigneeIds);
          set.has(u) ? set.delete(u) : set.add(u);
          draft.assigneeIds = [...set];
          chip.classList.toggle("is-selected", set.has(u));
          markDirty();
        });
      });
    }

    const tagInput = overlay.querySelector("#t-new-tag");
    tagInput.addEventListener("input", () => renderTagSuggestions(tagInput.value));
    tagInput.addEventListener("focus", () => renderTagSuggestions(tagInput.value));
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = tagInput.value.trim();
        if (!val) return;
        const exact = (tagsRegistry || []).find((t) => t.name.toLowerCase() === val.toLowerCase());
        commitTag(exact ? exact.name : val, exact ? exact.color : lastPickedTagColor);
      } else if (e.key === "Escape") {
        overlay.querySelector("#t-tag-suggest").innerHTML = "";
      }
    });

    overlay.querySelector("#t-new-subtask").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) { draft.subtasks.push({ id: uid(), title: val, done: false }); renderSubtasks(); markDirty(); e.target.value = ""; }
      }
    });

    overlay.querySelector("#t-add-link").addEventListener("click", handleAddLink);
    overlay.querySelector("#t-link-url").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); handleAddLink(); }
    });

    overlay.querySelector("#t-accept").addEventListener("click", () => handleAccept());

    overlay.querySelector(".modal__body").addEventListener("click", (e) => {
      if (!e.target.closest(".tag-picker")) {
        const box = overlay.querySelector("#t-tag-suggest");
        if (box) box.innerHTML = "";
      }
    });

    const sendBtn = overlay.querySelector("#t-send-comment");
    if (sendBtn) {
      sendBtn.addEventListener("click", sendComment);
      overlay.querySelector("#t-new-comment").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendComment();
      });
    }
  }

  function tagColor(name) {
    const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
    return found ? found.color : lastPickedTagColor;
  }

  function renderTagChips() {
    const box = overlay.querySelector("#t-tags");
    box.innerHTML = draft.tags
      .map((tag) => {
        const color = tagColor(tag);
        return `<span class="tag-pill" data-tag="${escapeHtml(tag)}" style="background:${color};color:${textColorFor(color)};">${escapeHtml(tag)} <span data-remove-tag="${escapeHtml(tag)}" style="cursor:pointer;">✕</span></span>`;
      })
      .join("");
    box.querySelectorAll("[data-remove-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.tags = draft.tags.filter((t) => t !== btn.dataset.removeTag);
        renderTagChips();
        markDirty();
      });
    });
  }

  function renderTagSuggestions(text) {
    const box = overlay.querySelector("#t-tag-suggest");
    const query = text.trim().toLowerCase();
    if (!query) { box.innerHTML = ""; return; }

    const matches = (tagsRegistry || []).filter(
      (t) => t.name.toLowerCase().includes(query) && !draft.tags.some((d) => d.toLowerCase() === t.name.toLowerCase())
    ).slice(0, 6);
    const exact = (tagsRegistry || []).some((t) => t.name.toLowerCase() === query);

    let html = matches
      .map((t) => `<button type="button" class="tag-suggest__item" data-pick="${escapeHtml(t.name)}"><span class="tag-suggest__dot" style="background:${t.color}"></span>${escapeHtml(t.name)}</button>`)
      .join("");

    if (!exact) {
      html += `
        <div style="padding:8px;">
          <button type="button" class="tag-suggest__item" id="tag-create-new" style="font-weight:600;"><span class="tag-suggest__dot" style="background:${lastPickedTagColor}"></span>Crear «${escapeHtml(text.trim())}»</button>
          <div class="tag-color-row" id="tag-color-row">
            ${TAG_COLOR_PALETTE.map((c) => `<span class="tag-color-swatch${c === lastPickedTagColor ? " is-selected" : ""}" data-color="${c}" style="background:${c};"></span>`).join("")}
          </div>
        </div>`;
    }

    box.innerHTML = html ? `<div class="tag-suggest">${html}</div>` : "";

    box.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const match = matches.find((t) => t.name === btn.dataset.pick);
        commitTag(match.name, match.color);
      });
    });
    const createBtn = box.querySelector("#tag-create-new");
    if (createBtn) {
      createBtn.addEventListener("click", () => commitTag(text.trim(), lastPickedTagColor));
    }
    box.querySelectorAll(".tag-color-swatch").forEach((sw) => {
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        lastPickedTagColor = sw.dataset.color;
        box.querySelectorAll(".tag-color-swatch").forEach((s) => s.classList.toggle("is-selected", s === sw));
        const icon = box.querySelector("#tag-create-new .tag-suggest__dot");
        if (icon) icon.style.background = lastPickedTagColor;
      });
    });
  }

  function commitTag(name, color) {
    if (!draft.tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      draft.tags.push(name);
      markDirty();
    }
    lastPickedTagColor = color;
    upsertTag({ name, color });
    renderTagChips();
    const input = overlay.querySelector("#t-new-tag");
    input.value = "";
    overlay.querySelector("#t-tag-suggest").innerHTML = "";
    input.focus();
  }

  function renderSubtasks() {
    const list = overlay.querySelector("#t-subtasks");
    if (!draft.subtasks.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Sin subtareas todavía.</p>`;
      return;
    }
    list.innerHTML = draft.subtasks
      .map((s) => `
      <div class="subtask-row">
        <button class="subtask-row__check${s.done ? " is-checked" : ""}" data-sub="${s.id}">${s.done ? "✓" : ""}</button>
        <span class="subtask-row__text${s.done ? " is-checked" : ""}" style="cursor:default;">${escapeHtml(s.title)}</span>
        <button class="subtask-row__remove" data-remove-sub="${s.id}">✕</button>
      </div>`)
      .join("");
    list.querySelectorAll("[data-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.subtasks = draft.subtasks.map((s) => (s.id === btn.dataset.sub ? { ...s, done: !s.done } : s));
        renderSubtasks();
        markDirty();
      });
    });
    list.querySelectorAll("[data-remove-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.subtasks = draft.subtasks.filter((s) => s.id !== btn.dataset.removeSub);
        renderSubtasks();
        markDirty();
      });
    });
  }

  function renderAttachments() {
    const list = overlay.querySelector("#t-attachments");
    if (!draft.attachments.length) { list.innerHTML = ""; return; }
    list.innerHTML = draft.attachments
      .map((a) => `
      <div class="attachment-row">
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="attachment-row__name">🔗 ${escapeHtml(a.name)}</a>
        <button class="attachment-row__remove" data-remove-attach="${a.id}">✕</button>
      </div>`)
      .join("");
    list.querySelectorAll("[data-remove-attach]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.attachments = draft.attachments.filter((a) => a.id !== btn.dataset.removeAttach);
        renderAttachments();
        markDirty();
      });
    });
  }

  function handleAddLink() {
    const nameInput = overlay.querySelector("#t-link-name");
    const urlInput = overlay.querySelector("#t-link-url");
    let url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const name = nameInput.value.trim() || url.replace(/^https?:\/\//i, "").split("/")[0];
    draft.attachments.push({ id: uid(), name, url });
    renderAttachments();
    markDirty();
    nameInput.value = "";
    urlInput.value = "";
  }

  function renderComments() {
    const list = overlay.querySelector("#t-comments");
    if (!list) return;
    if (!comments.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Sin comentarios todavía.</p>`;
      return;
    }
    list.innerHTML = comments
      .map((c) => `
      <div class="comment">
        <span class="avatar avatar--sm" style="background:${colorFromString(c.authorId)}">${initials(c.authorName)}</span>
        <div class="comment__body">
          <div class="comment__meta">
            <span class="comment__author">${escapeHtml(c.authorName)}</span>
            <span class="comment__time">${c.createdAt ? formatDateLong(c.createdAt) : "enviando…"}</span>
          </div>
          <p class="comment__text">${escapeHtml(c.text)}</p>
        </div>
      </div>`)
      .join("");
  }

  async function sendComment() {
    const textarea = overlay.querySelector("#t-new-comment");
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    await addComment(taskId, { authorId: currentUserProfile.uid, authorName: currentUserProfile.name, text });
  }

  /**
   * El ownerId de una tarea nunca se ELIGE a mano en ningún control —
   * sirve de respaldo de permisos (además de a quién ve "Mis tareas"
   * cuando ya no está entre los responsables, ver subscribeToMyTasks).
   * Desde la v41, para una tarea PERSONAL (sin proyecto) sigue a quien
   * la lleve en cada momento, no es un dato fijo de quién la creó — ver
   * nextPersonalOwnerId() y el historial de esa versión para el porqué:
   * si se la asignas a otra persona, pasa a ser SU tarea personal
   * (puede editarla, completarla y también borrarla, no solo lo
   * primero). Casos:
   *  - Tarea NUEVA: si se crea desde "Mis tareas" (isPersonal), empieza
   *    siendo de quien la crea — salvo que, antes de guardar, ya se
   *    haya reasignado a otra persona en el propio formulario (mismo
   *    cálculo que para una ya existente). Si se crea desde un
   *    proyecto, no lleva ownerId — salvo que ese mismo proyecto se
   *    quite antes de guardar (ver el "if" de más abajo).
   *  - Tarea ya EXISTENTE: si sigue teniendo proyecto, no se toca (el
   *    acceso ya lo da el proyecto). Si no, se recalcula con
   *    nextPersonalOwnerId() a partir de quién la tuviera antes
   *    (`loadedOwnerId`, o quien la esté guardando si nunca tuvo) y de
   *    quién se le vaya a dejar asignada ahora.
   */
  function computeOwnerIdOnSave(primaryProjectId) {
    if (isNew) {
      return isPersonal ? nextPersonalOwnerId(currentUserProfile.uid, draft.assigneeIds) : (primaryProjectId ? null : currentUserProfile.uid);
    }
    if (primaryProjectId) return loadedOwnerId;
    return nextPersonalOwnerId(loadedOwnerId || currentUserProfile.uid, draft.assigneeIds);
  }

  /** Las filas del histórico tal como se guardan en Firestore (v56; desde la v57 también al CREAR una oferta). */
  function revisionsForSave() {
    return revisions.map((r) => ({ id: r.id, version: r.version.trim(), changes: r.changes.trim(), createdAt: r.createdAt }));
  }

  /** `afterSave` (v57, opcional): se ejecuta cuando ya se guardó y el modal se cerró — lo usa «Convertir en proyecto». */
  async function handleAccept(afterSave) {
    const titleInputEl = overlay.querySelector("#t-title");
    // Con el texto plano (marcas de negrita fuera), no con draft.title tal
    // cual: un título que solo tuviera "****" sin nada escrito dentro
    // pasaría la comprobación de "no está vacío" si se mirara la cadena
    // en crudo, aunque en pantalla no se vería ningún texto.
    if (!plainTitleText(draft.title).trim()) { titleInputEl.focus(); return; }
    // Ofertas (v56): una versión recién creada sin explicar qué cambió no
    // bloquea el guardado, pero se avisa una vez — de eso va el histórico.
    const offers = offersProject();
    if (offers) {
      const unexplained = revisions.filter((r) => newRevisionIds.has(r.id) && !r.changes.trim());
      if (unexplained.length && !confirm("Has creado una versión nueva sin explicar qué ha cambiado. ¿Guardar igualmente?")) {
        const box = overlay.querySelector(`[data-rev-changes="${unexplained[0].id}"]`);
        if (box) box.focus();
        return;
      }
    }
    const acceptBtn = overlay.querySelector("#t-accept");
    acceptBtn.disabled = true;
    acceptBtn.textContent = "Guardando…";
    try {
      const [primaryId, ...extraIds] = draft.projectIds;
      const extraSections = {};
      extraIds.forEach((pid) => { extraSections[pid] = draft.sectionByProject[pid] || null; });
      // projectIds/sectionByProject son solo la representación interna de
      // este modal (ver cabecera del archivo) — nunca se guardan tal
      // cual en Firestore, así que se excluyen explícitamente del resto
      // de campos del draft en vez de mandarlos con un "...draft" suelto.
      const { projectIds, sectionByProject, ...restDraft } = draft;
      const ownerId = computeOwnerIdOnSave(primaryId || null);

      if (isNew) {
        const newId = await createTask(primaryId || null, {
          ...restDraft,
          sectionId: primaryId ? (draft.sectionByProject[primaryId] || null) : null,
          extraProjectIds: extraIds,
          extraSections,
          ownerId,
          // v57: una oferta nueva nace con su fila A1 «Versión original»
          // (antes el histórico solo se guardaba al EDITAR una oferta).
          ...(offers ? { revisions: revisionsForSave() } : {}),
          createdBy: currentUserProfile.uid,
          order: Date.now(),
        });
        onSaved(newId);
        // Tarea nueva: cualquier responsable puesto ya de entrada es
        // "nuevo" (no había nada antes que comparar).
        notifyNewAssignees({
          newAssigneeUids: draft.assigneeIds,
          taskId: newId,
          taskTitle: draft.title,
          projectId: primaryId || null,
          projectName: primaryId ? (projects.find((p) => p.id === primaryId)?.name || null) : null,
          fromUser: currentUserProfile,
          teamMembers,
        }).catch((err) => console.error("notifyNewAssignees:", err));
      } else {
        await updateTask(taskId, {
          ...restDraft,
          projectId: primaryId || null,
          sectionId: primaryId ? (draft.sectionByProject[primaryId] || null) : null,
          extraProjectIds: extraIds,
          extraSections,
          ownerId,
          // Solo si la tarea ES una oferta: una tarea normal no debe ganar
          // un `revisions: []` vacío cada vez que se guarda. Quitar una
          // tarea de Ofertas en este modal tampoco borra su histórico (no
          // se manda, así que Firestore lo deja como estaba).
          ...(offers ? { revisions: revisionsForSave() } : {}),
        });
        onSaved(taskId);
        // Tarea existente: solo avisa a quien esté en la lista nueva pero
        // NO estuviera ya antes de abrir el modal (loadedAssigneeIds) —
        // quien ya era responsable no recibe un aviso de "asignación" por
        // simplemente guardar la tarea de nuevo sin haber cambiado nada.
        const newlyAdded = draft.assigneeIds.filter((uid) => !loadedAssigneeIds.includes(uid));
        notifyNewAssignees({
          newAssigneeUids: newlyAdded,
          taskId,
          taskTitle: draft.title,
          projectId: primaryId || null,
          projectName: primaryId ? (projects.find((p) => p.id === primaryId)?.name || null) : null,
          fromUser: currentUserProfile,
          teamMembers,
        }).catch((err) => console.error("notifyNewAssignees:", err));
      }
      dirty = false;
      close();
      if (typeof afterSave === "function") afterSave();
    } catch (e) {
      console.error(e);
      acceptBtn.disabled = false;
      acceptBtn.textContent = "Aceptar";
      alert("No se pudo guardar la tarea. Comprueba tu conexión e inténtalo de nuevo.");
    }
  }
}
