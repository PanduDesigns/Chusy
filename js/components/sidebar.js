// ============================================================================
// Sidebar: lista de proyectos, botón de crear proyecto, pie con el usuario.
// ============================================================================
import { initials, colorFromString, escapeHtml } from "../utils.js";
import { openContextMenu } from "./context-menu.js";
import { updateProject, deleteProjectWithTasks, archiveProject } from "../data/projects.js";
import { openCustomFieldsModal } from "./custom-fields-modal.js";

export function renderSidebar(container, { projects, currentProjectId, isMyTasksActive, isTimelineActive, isArchiveActive, myTasksCount, userProfile, onSelectProject, onSelectMyTasks, onSelectTimeline, onSelectArchive, onCreateProject, onOpenSearch, onOpenAccount, onOpenTeamAdmin, onLogout }) {
  const items = projects.map((p) => `
    <button class="sidebar__item${p.id === currentProjectId ? " is-active" : ""}" data-project-id="${p.id}">
      <span class="sidebar__item-dot" style="background:${p.color || "#FCD000"}"></span>
      <span class="sidebar__item-name">${escapeHtml(p.name)}</span>
    </button>
  `).join("");

  container.innerHTML = `
    <div class="sidebar__brand">
      <img src="assets/chusy-badge.png" alt="Chusy" class="sidebar__brand-logo">
    </div>

    <button class="sidebar__search" id="btn-search">
      <span>🔍</span> Buscar…
      <span class="sidebar__search-kbd">⌘K</span>
    </button>

    <button class="sidebar__item sidebar__item--pinned${isMyTasksActive ? " is-active" : ""}" id="btn-my-tasks">
      <span class="sidebar__item-icon">🗂️</span>
      <span class="sidebar__item-name">Mis tareas</span>
      ${myTasksCount ? `<span class="sidebar__item-count">${myTasksCount}</span>` : ""}
    </button>
    <button class="sidebar__item sidebar__item--pinned${isTimelineActive ? " is-active" : ""}" id="btn-timeline">
      <span class="sidebar__item-icon">📅</span>
      <span class="sidebar__item-name">Línea de tiempo</span>
    </button>
    <button class="sidebar__item sidebar__item--pinned${isArchiveActive ? " is-active" : ""}" id="btn-archive">
      <span class="sidebar__item-icon">🗄️</span>
      <span class="sidebar__item-name">Archivo</span>
    </button>

    <span class="sidebar__section-label">Proyectos</span>
    <div class="sidebar__list">
      ${items || `<p style="color:var(--color-text-faint);font-size:12.5px;padding:8px;">Todavía no hay proyectos.</p>`}
    </div>
    <button class="sidebar__new-project" id="btn-new-project">+ Nuevo proyecto</button>

    <div class="sidebar__footer">
      <button class="sidebar__user" id="btn-user-menu" type="button">
        <span class="avatar" style="background:${colorFromString(userProfile.uid)}">${initials(userProfile.name)}</span>
        <div style="min-width:0;">
          <div class="sidebar__user-name">${escapeHtml(userProfile.name || userProfile.email)}</div>
          <div class="sidebar__user-role">${userProfile.role === "admin" ? "Admin" : "Miembro"}</div>
        </div>
      </button>
      <button class="sidebar__logout" title="Cerrar sesión" id="btn-logout">⏻</button>
    </div>
    <p class="sidebar__credit">Martech Corporation</p>
  `;

  container.querySelectorAll(".sidebar__item[data-project-id]").forEach((btn) => {
    btn.addEventListener("click", () => onSelectProject(btn.dataset.projectId));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const project = projects.find((p) => p.id === btn.dataset.projectId);
      if (!project) return;
      openContextMenu({
        x: e.clientX, y: e.clientY,
        items: [
          { label: "Renombrar proyecto", icon: "✎", onClick: () => {
            const name = prompt("Nuevo nombre del proyecto:", project.name);
            if (name && name.trim()) updateProject(project.id, { name: name.trim() });
          } },
          {
            label: "Campos personalizados",
            icon: "☰",
            onClick: () =>
              openCustomFieldsModal({
                title: "Campos personalizados",
                hint: "Se podrán rellenar en cada tarea de este proyecto y usarse como columna y como filtro.",
                fields: project.customFieldDefs,
                onSave: (defs) => updateProject(project.id, { customFieldDefs: defs }),
              }),
          },
          { label: "Archivar proyecto", icon: "🗄️", onClick: () => archiveProject(project.id, true) },
          { divider: true },
          { label: "Eliminar proyecto", icon: "🗑", danger: true, onClick: async () => {
            if (confirm(`¿Eliminar "${project.name}" y TODAS sus tareas? No se puede deshacer.`)) {
              await deleteProjectWithTasks(project.id);
            }
          } },
        ],
      });
    });
  });
  container.querySelector("#btn-search").addEventListener("click", onOpenSearch);
  container.querySelector("#btn-my-tasks").addEventListener("click", onSelectMyTasks);
  container.querySelector("#btn-timeline").addEventListener("click", onSelectTimeline);
  container.querySelector("#btn-archive").addEventListener("click", onSelectArchive);
  container.querySelector("#btn-new-project").addEventListener("click", onCreateProject);
  container.querySelector("#btn-logout").addEventListener("click", onLogout);

  container.querySelector("#btn-user-menu").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const items = [{ label: "Mi cuenta", icon: "👤", onClick: onOpenAccount }];
    if (userProfile.role === "admin") {
      items.push({ label: "Administrar equipo", icon: "🛠️", onClick: onOpenTeamAdmin });
    }
    items.push({ divider: true });
    items.push({ label: "Cerrar sesión", icon: "⏻", danger: true, onClick: onLogout });
    openContextMenu({ x: rect.left, y: rect.top, items });
  });
}
