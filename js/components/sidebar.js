// ============================================================================
// Sidebar: lista de proyectos, botón de crear proyecto, pie con el usuario.
// Se puede minimizar a una barra de iconos con el botón de la esquina
// (redondo, en el borde derecho) — queda como preferencia de este
// navegador, no afecta a nadie más ni a otras sesiones.
//
// El menú que se abre al clicar el propio usuario (pie de la barra) aloja,
// además de "Mi cuenta" y las herramientas de administración de siempre,
// dos entradas más solo para admins: "Métricas" (antes un botón fijo aparte
// en esta misma barra) y "Creación Rápida" — el panel, a propósito
// "escondido" aquí y en ningún otro sitio, para habilitar/configurar el
// botón "Nueva cabina" de los proyectos (ver quick-create-admin-modal.js).
// ============================================================================
import { initials, colorFromString, escapeHtml, projectBadgeHtml } from "../utils.js";
import { openContextMenu } from "./context-menu.js";
import { updateProject, deleteProjectWithTasks, archiveProject } from "../data/projects.js";
import { openCustomFieldsModal } from "./custom-fields-modal.js";
import { openEditProjectModal } from "./edit-project-modal.js";

export function renderSidebar(container, { projects, currentProjectId, isMyTasksActive, isTimelineActive, isArchiveActive, myTasksCount, userProfile, isCollapsed, onToggleCollapse, onSelectProject, onSelectMyTasks, onSelectTimeline, onSelectArchive, onSelectMetrics, onCreateProject, onOpenSearch, onOpenAccount, onOpenTeamAdmin, onOpenAsanaImport, onOpenQuickCreateAdmin, onLogout }) {
  container.classList.toggle("is-collapsed", !!isCollapsed);

  const items = projects.map((p) => `
    <button class="sidebar__item${p.id === currentProjectId ? " is-active" : ""}" data-project-id="${p.id}" title="${escapeHtml(p.name)}">
      ${projectBadgeHtml(p)}
      <span class="sidebar__item-name sidebar__label">${escapeHtml(p.name)}</span>
    </button>
  `).join("");

  container.innerHTML = `
    <div class="sidebar__brand">
      <img src="assets/chusy-badge.png" alt="Chusy" class="sidebar__brand-logo sidebar__brand-logo--full">
      <img src="assets/favicon-32.png" alt="Chusy" class="sidebar__brand-logo sidebar__brand-logo--icon">
    </div>

    <button class="sidebar__collapse-toggle" id="btn-toggle-collapse" type="button" title="${isCollapsed ? "Expandir barra lateral" : "Minimizar barra lateral"}">
      <span class="sidebar__collapse-icon">${isCollapsed ? "›" : "‹"}</span>
    </button>

    <button class="sidebar__search" id="btn-search" title="Buscar (⌘K)">
      <span>🔍</span>
      <span class="sidebar__label">Buscar…</span>
      <span class="sidebar__label sidebar__search-kbd">⌘K</span>
    </button>

    <button class="sidebar__item sidebar__item--pinned${isMyTasksActive ? " is-active" : ""}" id="btn-my-tasks" title="Mis tareas">
      <span class="sidebar__item-icon">🗂️</span>
      <span class="sidebar__item-name sidebar__label">Mis tareas</span>
      ${myTasksCount ? `<span class="sidebar__item-count sidebar__label">${myTasksCount}</span>` : ""}
    </button>
    <button class="sidebar__item sidebar__item--pinned${isTimelineActive ? " is-active" : ""}" id="btn-timeline" title="Línea de tiempo">
      <span class="sidebar__item-icon">📅</span>
      <span class="sidebar__item-name sidebar__label">Línea de tiempo</span>
    </button>
    <button class="sidebar__item sidebar__item--pinned${isArchiveActive ? " is-active" : ""}" id="btn-archive" title="Archivo">
      <span class="sidebar__item-icon">🗄️</span>
      <span class="sidebar__item-name sidebar__label">Archivo</span>
    </button>

    <span class="sidebar__section-label sidebar__label">Proyectos</span>
    <div class="sidebar__list">
      ${items || `<p class="sidebar__label" style="color:var(--color-text-faint);font-size:12.5px;padding:8px;">Todavía no hay proyectos.</p>`}
    </div>
    <button class="sidebar__new-project" id="btn-new-project" title="Nuevo proyecto">
      <span class="sidebar__new-project-icon">+</span><span class="sidebar__label">Nuevo proyecto</span>
    </button>

    <div class="sidebar__footer">
      <button class="sidebar__user" id="btn-user-menu" type="button" title="${escapeHtml(userProfile.name || userProfile.email)}">
        <span class="avatar" style="background:${colorFromString(userProfile.uid)}">${initials(userProfile.name)}</span>
        <div class="sidebar__label" style="min-width:0;">
          <div class="sidebar__user-name">${escapeHtml(userProfile.name || userProfile.email)}</div>
          <div class="sidebar__user-role">${userProfile.role === "admin" ? "Admin" : "Miembro"}</div>
        </div>
      </button>
      <button class="sidebar__logout" title="Cerrar sesión" id="btn-logout">⏻</button>
    </div>
    <p class="sidebar__credit sidebar__label">Martech Corporation</p>
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
          { label: "Editar proyecto", icon: "✎", onClick: () => {
            openEditProjectModal({ project, onSave: (data) => updateProject(project.id, data) });
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
  container.querySelector("#btn-toggle-collapse").addEventListener("click", onToggleCollapse);

  container.querySelector("#btn-user-menu").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const items = [{ label: "Mi cuenta", icon: "👤", onClick: onOpenAccount }];
    if (userProfile.role === "admin") {
      items.push({ label: "Administrar equipo", icon: "🛠️", onClick: onOpenTeamAdmin });
      items.push({ label: "Importar desde Asana", icon: "📥", onClick: onOpenAsanaImport });
      items.push({ label: "Métricas", icon: "📊", onClick: onSelectMetrics });
      // "Secreta" en el sentido de que solo vive aquí: nadie que no sea
      // admin ve siquiera esta entrada, y no hay ningún botón fijo en el
      // resto de la interfaz que la señale (a diferencia de Métricas,
      // arriba, que hasta la v41 sí tenía uno) — ver quick-create-admin-modal.js.
      items.push({ label: "Creación Rápida", icon: "⚡", onClick: onOpenQuickCreateAdmin });
    }
    items.push({ divider: true });
    items.push({ label: "Cerrar sesión", icon: "⏻", danger: true, onClick: onLogout });
    openContextMenu({ x: rect.right + 6, y: rect.top, items });
  });
}
