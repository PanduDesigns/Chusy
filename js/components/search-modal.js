// ============================================================================
// Buscador global (Ctrl/Cmd+K). Busca en tareas, proyectos y personas ya
// cargadas en memoria — a la escala de un departamento no hace falta ir a
// Firestore por cada tecleo. Incluye unas cuantas "búsquedas guardadas"
// (atajos habituales) cuando el campo está vacío.
// ============================================================================
import { el, escapeHtml, initials, colorFromString, formatDate, toDate } from "../utils.js";

const CATEGORIES = [
  { key: "tasks", label: "Tareas" },
  { key: "projects", label: "Proyectos" },
  { key: "people", label: "Personas" },
];

export function openSearchModal({ tasks, projects, teamMembers, currentUser, onOpenTask, onOpenProject, onFilterByPerson }) {
  const root = document.getElementById("modal-root");
  let activeCats = new Set(["tasks", "projects", "people"]);
  let query = "";

  const overlay = el(`
    <div class="modal-overlay search-overlay">
      <div class="modal search-modal">
        <div class="search-modal__input-row">
          <span class="search-modal__icon">🔍</span>
          <input type="text" id="search-input" placeholder="Buscar tareas, proyectos o personas…" autocomplete="off">
          <span class="search-modal__kbd">Esc</span>
        </div>
        <div class="search-modal__cats" id="search-cats">
          ${CATEGORIES.map((c) => `<button type="button" class="chip is-selected" data-cat="${c.key}">${c.label}</button>`).join("")}
        </div>
        <div class="search-modal__results" id="search-results"></div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  const input = overlay.querySelector("#search-input");
  const resultsBox = overlay.querySelector("#search-results");
  input.focus();

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      activeCats.has(cat) ? activeCats.delete(cat) : activeCats.add(cat);
      btn.classList.toggle("is-selected", activeCats.has(cat));
      renderResults();
    });
  });

  input.addEventListener("input", (e) => {
    query = e.target.value.trim();
    renderResults();
  });

  function taskRowHtml(t) {
    const project = projects.find((p) => p.id === t.projectId);
    const tag = !t.projectId ? "🔒 Personal" : project ? project.name : "";
    return `
      <button type="button" class="search-result" data-open-task="${t.id}">
        <span class="search-result__check${t.isComplete ? " is-checked" : ""}">${t.isComplete ? "✓" : ""}</span>
        <div class="search-result__body">
          <div class="search-result__title">${t.isMilestone ? "🚩 " : ""}${escapeHtml(t.title)}</div>
          ${tag ? `<div class="search-result__meta">${escapeHtml(tag)}</div>` : ""}
        </div>
        ${t.dueDate ? `<span class="search-result__date">${formatDate(t.dueDate)}</span>` : ""}
      </button>`;
  }

  function projectRowHtml(p) {
    return `
      <button type="button" class="search-result" data-open-project="${p.id}">
        <span class="search-result__project-dot" style="background:${p.color || "#8B959C"}"></span>
        <div class="search-result__body"><div class="search-result__title">${escapeHtml(p.name)}</div></div>
      </button>`;
  }

  function personRowHtml(m) {
    return `
      <button type="button" class="search-result" data-open-person="${m.uid}">
        <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
        <div class="search-result__body"><div class="search-result__title">${escapeHtml(m.name)}</div></div>
      </button>`;
  }

  function section(title, rowsHtml) {
    if (!rowsHtml) return "";
    return `<div class="search-modal__section"><div class="search-modal__section-label">${title}</div>${rowsHtml}</div>`;
  }

  function renderQuickFilterResults(label, list) {
    resultsBox.innerHTML = `
      <div class="search-modal__section">
        <div class="search-modal__section-label">${escapeHtml(label)}</div>
        ${list.length ? list.map(taskRowHtml).join("") : `<p style="color:var(--color-text-faint);font-size:12.5px;padding:8px 10px;">Nada por aquí.</p>`}
      </div>`;
    wireResultClicks();
  }

  function renderResults() {
    if (!query) {
      resultsBox.innerHTML = `
        <div class="search-modal__section">
          <div class="search-modal__section-label">Búsquedas guardadas</div>
          <div class="search-modal__saved">
            <button type="button" class="chip" id="qf-created">Tareas que he creado</button>
            <button type="button" class="chip" id="qf-assigned-others">Asignadas por mí a otros</button>
            <button type="button" class="chip" id="qf-done">Completadas recientemente</button>
          </div>
        </div>`;
      overlay.querySelector("#qf-created").addEventListener("click", () =>
        renderQuickFilterResults("Tareas que he creado", tasks.filter((t) => t.createdBy === currentUser.uid))
      );
      overlay.querySelector("#qf-assigned-others").addEventListener("click", () =>
        renderQuickFilterResults(
          "Asignadas por mí a otros",
          tasks.filter((t) => t.createdBy === currentUser.uid && t.assigneeIds?.length && !t.assigneeIds.includes(currentUser.uid))
        )
      );
      overlay.querySelector("#qf-done").addEventListener("click", () => {
        const done = tasks
          .filter((t) => t.isComplete)
          .sort((a, b) => (toDate(b.completedAt || b.updatedAt) || 0) - (toDate(a.completedAt || a.updatedAt) || 0))
          .slice(0, 15);
        renderQuickFilterResults("Completadas recientemente", done);
      });
      return;
    }

    const q = query.toLowerCase();
    let html = "";
    if (activeCats.has("tasks")) {
      const matches = tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 8);
      html += section("Tareas", matches.map(taskRowHtml).join(""));
    }
    if (activeCats.has("projects")) {
      const matches = projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
      html += section("Proyectos", matches.map(projectRowHtml).join(""));
    }
    if (activeCats.has("people")) {
      const matches = teamMembers.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
      html += section("Personas", matches.map(personRowHtml).join(""));
    }
    resultsBox.innerHTML = html || `<p style="color:var(--color-text-faint);font-size:13px;padding:16px;text-align:center;">Sin resultados para «${escapeHtml(query)}».</p>`;
    wireResultClicks();
  }

  function wireResultClicks() {
    resultsBox.querySelectorAll("[data-open-task]").forEach((btn) => {
      btn.addEventListener("click", () => { close(); onOpenTask(btn.dataset.openTask); });
    });
    resultsBox.querySelectorAll("[data-open-project]").forEach((btn) => {
      btn.addEventListener("click", () => { close(); onOpenProject(btn.dataset.openProject); });
    });
    resultsBox.querySelectorAll("[data-open-person]").forEach((btn) => {
      btn.addEventListener("click", () => { close(); onFilterByPerson(btn.dataset.openPerson); });
    });
  }

  renderResults();
}
