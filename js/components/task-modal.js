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
// ============================================================================
import { createTask, updateTask, getTask } from "../data/tasks.js";
import { addComment, subscribeToComments } from "../data/comments.js";
import {
  el,
  uid,
  escapeHtml,
  initials,
  colorFromString,
  textColorFor,
  formatDateLong,
  toDateInputValue,
  projectBadgeHtml,
  PRIORITY_LABELS,
} from "../utils.js";
import { upsertTag, TAG_COLOR_PALETTE } from "../data/tags.js";
import { createRichTextEditor } from "./rich-text-editor.js";

const PRIORITIES = ["urgente", "alta", "media", "baja"];
let lastPickedTagColor = TAG_COLOR_PALETTE[0];

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
  let dirty = false;
  let comments = [];
  let unsubComments = null;
  let descriptionEditor = null;

  const overlay = el(`<div class="modal-overlay"><div class="modal"><div style="padding:40px;text-align:center;color:var(--color-text-lo);">Cargando…</div></div></div>`);
  root.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) attemptClose(); });
  document.addEventListener("keydown", onKeydown);

  if (isNew) {
    buildForm();
  } else {
    getTask(taskId).then((t) => {
      if (!t) { showToastLike("Esta tarea ya no existe."); close(true); return; }
      const projectIds = [t.projectId, ...(t.extraProjectIds || [])].filter(Boolean);
      const sectionByProject = {};
      if (t.projectId) sectionByProject[t.projectId] = t.sectionId || null;
      Object.entries(t.extraSections || {}).forEach(([pid, sid]) => { sectionByProject[pid] = sid || null; });
      loadedOwnerId = t.ownerId || null;
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
          <input class="modal__title-input" id="t-title" value="${escapeHtml(draft.title)}" placeholder="Título de la tarea">
          <button class="modal__close" id="t-close">✕</button>
        </div>
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
                .filter((m) => !m.isImported || draft.assigneeIds.includes(m.uid))
                .sort((a, b) => (a.isImported ? 1 : 0) - (b.isImported ? 1 : 0))
                .map((m) => `
                <button type="button" class="chip${draft.assigneeIds.includes(m.uid) ? " is-selected" : ""}" data-uid="${m.uid}">
                  <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
                  ${escapeHtml(m.name)}${m.isImported ? ` <span style="color:var(--color-text-faint);">· Asana</span>` : ""}
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
    renderTagChips();
    renderSubtasks();
    renderAttachments();
    if (!isNew) renderComments();

    descriptionEditor = createRichTextEditor(overlay.querySelector("#t-description-mount"), {
      initialValue: draft.description,
      placeholder: "Escribe «/» para ver el menú",
      onChange: (html) => { draft.description = html; markDirty(); },
    });
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

    mount.innerHTML = allFieldDefs
      .map(
        (f) => `
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

    mount.querySelectorAll("[data-custom-field]").forEach((elm) => {
      elm.addEventListener("change", (e) => {
        draft.customFields = { ...draft.customFields, [elm.dataset.customField]: e.target.value || null };
        markDirty();
      });
    });
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
      markDirty();
    });

    overlay.querySelector("#t-title").addEventListener("input", (e) => { draft.title = e.target.value; markDirty(); });

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

    overlay.querySelector("#t-accept").addEventListener("click", handleAccept);

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
   * El ownerId de una tarea nunca se ELIGE a mano en ningún control — es un
   * dato histórico de si (y cuándo) se creó como personal, que además sirve
   * de respaldo de permisos (quien lo tenga puede seguir borrándola más
   * adelante aunque ya esté en un proyecto, ver firestore.rules). Solo hay
   * que tocarlo en dos casos:
   *  - Tarea NUEVA: si se crea desde "Mis tareas" (isPersonal), su ownerId
   *    es quien la crea, se le añadan o no proyectos en la misma sesión
   *    antes de guardar. Si se crea desde un proyecto, no lleva ownerId —
   *    salvo que ese mismo proyecto se quite antes de guardar (ver abajo).
   *  - Tarea ya EXISTENTE que se queda sin ningún proyecto (se han quitado
   *    todos desde el selector) Y nunca tuvo ownerId: sin este respaldo, se
   *    quedaría sin dueño/a, sin proyecto y visible solo para quien esté en
   *    assigneeIds (o nadie, si tampoco hay responsables) — invisible para
   *    el resto del equipo y para quien la estaba editando en cuanto
   *    cerrara el modal. Pasa a ser personal de quien la esté guardando en
   *    ese momento, igual que ya hace "Mover a mis tareas" en las acciones
   *    masivas.
   */
  function computeOwnerIdOnSave(primaryProjectId) {
    if (isNew) {
      return isPersonal ? currentUserProfile.uid : (primaryProjectId ? null : currentUserProfile.uid);
    }
    if (!primaryProjectId && !loadedOwnerId) return currentUserProfile.uid;
    return loadedOwnerId;
  }

  async function handleAccept() {
    const titleInput = overlay.querySelector("#t-title");
    if (!draft.title.trim()) { titleInput.focus(); return; }
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
          createdBy: currentUserProfile.uid,
          order: Date.now(),
        });
        onSaved(newId);
      } else {
        await updateTask(taskId, {
          ...restDraft,
          projectId: primaryId || null,
          sectionId: primaryId ? (draft.sectionByProject[primaryId] || null) : null,
          extraProjectIds: extraIds,
          extraSections,
          ownerId,
        });
        onSaved(taskId);
      }
      dirty = false;
      close();
    } catch (e) {
      console.error(e);
      acceptBtn.disabled = false;
      acceptBtn.textContent = "Aceptar";
      alert("No se pudo guardar la tarea. Comprueba tu conexión e inténtalo de nuevo.");
    }
  }
}
