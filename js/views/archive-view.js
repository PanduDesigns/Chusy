// ============================================================================
// Vista de Archivo: proyectos archivados (no aparecen en la lista principal
// pero no se han borrado). Se pueden abrir para consultarlos o
// desarchivar para que vuelvan a la lista de proyectos activos.
// ============================================================================
import { escapeHtml } from "../utils.js";

export function renderArchiveView(container, { archivedProjects, onOpenProject, onUnarchive }) {
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
        <div class="archive-row">
          <span class="sidebar__item-dot" style="background:${p.color || "#8B959C"}"></span>
          <span class="archive-row__name" data-open="${p.id}">${escapeHtml(p.name)}</span>
          <button class="btn btn--ghost btn--sm" data-unarchive="${p.id}">Desarchivar</button>
        </div>`
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", () => onOpenProject(elx.dataset.open));
  });
  container.querySelectorAll("[data-unarchive]").forEach((btn) => {
    btn.addEventListener("click", () => onUnarchive(btn.dataset.unarchive));
  });
}
