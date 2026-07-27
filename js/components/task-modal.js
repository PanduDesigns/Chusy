// ============================================================================
// Modal de tarea — se usa TANTO para crear como para editar (la misma
// ventana, con todos los campos visibles de golpe). Nada se guarda en
// Firestore hasta pulsar "Aceptar": mientras tanto todo vive en un objeto
// `draft` local. Esto también evita el problema anterior de que la
// ventana se reconstruyera sola mientras escribías (ya no hay ninguna
// suscripción en tiempo real mientras el modal está abierto).
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
  PRIORITY_LABELS,
} from "../utils.js";
import { upsertTag, TAG_COLOR_PALETTE } from "../data/tags.js";

const PRIORITIES = ["urgente", "alta", "media", "baja"];
let lastPickedTagColor = TAG_COLOR_PALETTE[0];

function emptyDraft({ defaultSectionId, presetDueDate }) {
  return {
    title: "",
    description: "",
    sectionId: defaultSectionId || null,
    assigneeIds: [],
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
  allProjectTasks,
  tagsRegistry,
  currentUserProfile,
  onSaved,
  onClosed,
}) {
  const root = document.getElementById("modal-root");
  const isNew = !taskId;
  let draft = emptyDraft({ defaultSectionId, presetDueDate });
  let dirty = false;
  let comments = [];
  let unsubComments = null;

  const overlay = el(`<div class="modal-overlay"><div class="modal"><div style="padding:40px;text-align:center;color:var(--color-text-lo);">Cargando…</div></div></div>`);
  root.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) attemptClose(); });
  document.addEventListener("keydown", onKeydown);

  if (isNew) {
    buildForm();
  } else {
    getTask(taskId).then((t) => {
      if (!t) { showToastLike("Esta tarea ya no existe."); close(true); return; }
      draft = {
        title: t.title, description: t.description, sectionId: t.sectionId,
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
    const excludeId = taskId;
    const depCandidates = isPersonal ? [] : (allProjectTasks || []).filter((t) => t.id !== excludeId);
    const sections = isPersonal ? [] : (project?.sections || []);

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <button class="task-row__check${draft.isComplete ? " is-checked" : ""}" id="t-complete" title="Marcar como completada" style="width:22px;height:22px;">${draft.isComplete ? "✓" : ""}</button>
          <input class="modal__title-input" id="t-title" value="${escapeHtml(draft.title)}" placeholder="Título de la tarea">
          <button class="modal__close" id="t-close">✕</button>
        </div>
        <div class="modal__body">

          ${!isPersonal ? `
          <div class="modal-row">
            <label class="field">
              <span class="field__label">Sección</span>
              <select class="field__select" id="t-section">
                ${sections.map((s) => `<option value="${s.id}" ${s.id === draft.sectionId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span class="field__label">Prioridad</span>
              <div class="chip-select" id="t-priority">${priorityChipsHtml()}</div>
            </label>
          </div>` : `
          <div class="field">
            <span class="field__label">Prioridad</span>
            <div class="chip-select" id="t-priority">${priorityChipsHtml()}</div>
          </div>`}

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

          ${!isPersonal ? `
          <div class="field">
            <span class="field__label">Responsables</span>
            <div class="chip-select" id="t-assignees">
              ${(teamMembers || []).map((m) => `
                <button type="button" class="chip${draft.assigneeIds.includes(m.uid) ? " is-selected" : ""}" data-uid="${m.uid}">
                  <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
                  ${escapeHtml(m.name)}
                </button>`).join("")}
            </div>
          </div>` : ""}

          <div class="field">
            <span class="field__label">Etiquetas</span>
            <div class="chip-select" id="t-tags"></div>
            <div class="tag-picker">
              <input class="field__input" id="t-new-tag" placeholder="Añadir etiqueta…" autocomplete="off">
              <div id="t-tag-suggest"></div>
            </div>
          </div>

          ${!isPersonal && depCandidates.length ? `
          <div class="field">
            <span class="field__label">Bloqueada por</span>
            <div class="chip-select" id="t-depends">
              ${depCandidates.map((t) => `<button type="button" class="chip${draft.dependsOn.includes(t.id) ? " is-selected" : ""}" data-dep="${t.id}">${t.isComplete ? "✓ " : ""}${escapeHtml(t.title)}</button>`).join("")}
            </div>
          </div>` : ""}

          ${!isPersonal && (project?.customFieldDefs || []).length ? (project.customFieldDefs.map((f) => `
          <label class="field">
            <span class="field__label">${escapeHtml(f.name)}</span>
            ${f.type === "numero"
              ? `<input class="field__input" type="number" data-custom-field="${f.id}" value="${draft.customFields[f.id] ?? ""}" placeholder="0">`
              : f.type === "texto"
              ? `<input class="field__input" type="text" data-custom-field="${f.id}" value="${escapeHtml(draft.customFields[f.id] ?? "")}" placeholder="Escribe…">`
              : `<select class="field__select" data-custom-field="${f.id}">
                  <option value="">— Sin definir —</option>
                  ${f.options.map((opt) => `<option value="${escapeHtml(opt)}" ${draft.customFields[f.id] === opt ? "selected" : ""}>${escapeHtml(opt)}</option>`).join("")}
                </select>`}
          </label>`).join("")) : ""}

          <label class="field">
            <span class="field__label">Descripción</span>
            <textarea class="field__textarea" id="t-description" placeholder="Añade detalles, contexto o enlaces…">${escapeHtml(draft.description)}</textarea>
          </label>

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
    renderTagChips();
    renderSubtasks();
    renderAttachments();
    if (!isNew) renderComments();
  }

  function priorityChipsHtml() {
    return PRIORITIES.map(
      (p) => `<button type="button" class="chip${p === draft.priority ? " is-selected" : ""}" data-priority="${p}"><span class="chip__dot priority-${p}"></span>${PRIORITY_LABELS[p]}</button>`
    ).join("");
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
    overlay.querySelector("#t-description").addEventListener("input", (e) => { draft.description = e.target.value; markDirty(); });

    const sectionSelect = overlay.querySelector("#t-section");
    if (sectionSelect) sectionSelect.addEventListener("change", (e) => { draft.sectionId = e.target.value; markDirty(); });

    overlay.querySelector("#t-start").addEventListener("change", (e) => { draft.startDate = e.target.value || null; markDirty(); });
    overlay.querySelector("#t-due").addEventListener("change", (e) => { draft.dueDate = e.target.value || null; markDirty(); });

    overlay.querySelectorAll("[data-custom-field]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        draft.customFields = { ...draft.customFields, [sel.dataset.customField]: e.target.value || null };
        markDirty();
      });
    });

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

    const dependsBox = overlay.querySelector("#t-depends");
    if (dependsBox) {
      dependsBox.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const d = chip.dataset.dep;
          const set = new Set(draft.dependsOn);
          set.has(d) ? set.delete(d) : set.add(d);
          draft.dependsOn = [...set];
          chip.classList.toggle("is-selected", set.has(d));
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

  async function handleAccept() {
    const titleInput = overlay.querySelector("#t-title");
    if (!draft.title.trim()) { titleInput.focus(); return; }
    const acceptBtn = overlay.querySelector("#t-accept");
    acceptBtn.disabled = true;
    acceptBtn.textContent = "Guardando…";
    try {
      if (isNew) {
        const newId = await createTask(isPersonal ? null : project.id, {
          ...draft,
          ownerId: isPersonal ? currentUserProfile.uid : null,
          assigneeIds: isPersonal ? [currentUserProfile.uid] : draft.assigneeIds,
          createdBy: currentUserProfile.uid,
          order: Date.now(),
        });
        onSaved(newId);
      } else {
        await updateTask(taskId, draft);
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
