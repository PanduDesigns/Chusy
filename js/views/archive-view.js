// ============================================================================
// Vista de Archivo: proyectos archivados (no aparecen en la lista principal
// pero no se han borrado). Clic para abrirlos y consultarlos; clic derecho
// para desarchivarlos (vuelven a la lista de proyectos activos) o
// eliminarlos definitivamente — mismo patrón que el menú contextual de
// los proyectos activos en la barra lateral.
// ============================================================================
import { escapeHtml, projectBadgeHtml } from "../utils.js";
import { openContextMenu } from "../components/context-menu.js";

export function renderArchiveView(container, { archivedProjects, onOpenProject, onUnarchive, onDelete }) {
  if (!archivedProjects.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__eyebrow">— ARCHIVO —</span>
        <h2>No hay proyectos archivados</h2>
        <p>Cuando un proyecto termine, archívalo desde el menú (clic derecho) en la barra lateral. Se queda guardado aquí, fuera de la lista principal.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="archive-list">
      ${archivedProjects
        .map(
          (p) => `
        <div class="archive-row" data-project-id="${p.id}">
          ${projectBadgeHtml(p)}
          <span class="archive-row__name" data-open="${p.id}">${escapeHtml(p.name)}</span>
        </div>`
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => onOpenProject(elx.dataset.open));
  });

  container.querySelectorAll(".archive-row").forEach((row) => {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const project = archivedProjects.find((p) => p.id === row.dataset.projectId);
      if (!project) return;
      openContextMenu({
        x: e.clientX, y: e.clientY,
        items: [
          { label: "Desarchivar proyecto", icon: "🗄️", onClick: () => onUnarchive(project.id) },
          { divider: true },
          { label: "Eliminar proyecto", icon: "🗑", danger: true, onClick: () => {
            if (confirm(`¿Eliminar "${project.name}" y TODAS sus tareas? No se puede deshacer.`)) {
              onDelete(project.id);
            }
          } },
        ],
      });
    });
  });
}
