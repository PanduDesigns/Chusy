// ============================================================================
// Modal (solo administradores): qué departamentos pueden acceder a cada
// "sección exclusiva" (Ofertas, y las que se vayan añadiendo — ver
// EXCLUSIVE_PROJECT_SEEDS en data/projects.js). Se abre desde el pie de la
// barra lateral, junto a "Administrar equipo".
//
// Cada casilla se guarda al momento (igual que el selector de rol de
// "Administrar equipo"), no hay un botón "Guardar" aparte — con solo un par
// de secciones exclusivas de partida no merece la pena acumular cambios sin
// guardar.
//
// v63: las casillas son GRUPOS de acceso (Diseño, Técnicos, Producción — ver
// DEPARTMENT_GROUPS en departments.js), no departamentos sueltos: «Diseño»
// abre la sección a Diseño - Industria y a Diseño - Automoción a la vez.
// ============================================================================
import { el, escapeHtml, showToast, projectBadgeHtml } from "../utils.js";
import { updateProject } from "../data/projects.js";
import { DEPARTMENT_GROUPS } from "../departments.js";

export function openDepartmentAccessModal({ exclusiveProjects }) {
  const root = document.getElementById("modal-root");
  // Copia local mutable, mismo criterio que team-admin-modal.js: reflejamos
  // aquí mismo el resultado de cada guardado sin esperar a que este panel
  // se vuelva a abrir.
  const projectsList = exclusiveProjects.map((p) => ({ ...p, allowedDepartments: [...(p.allowedDepartments || [])] }));

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Accesos por departamento</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Qué departamentos pueden ver y usar cada sección exclusiva. «Diseño» incluye a Diseño - Industria y a Diseño - Automoción. Quien sea admin accede siempre a todas, estén marcadas aquí o no.</p>
          <div id="da-list" style="display:flex;flex-direction:column;gap:14px;"></div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel" style="margin-left:auto;">Cerrar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  function renderList() {
    const list = overlay.querySelector("#da-list");
    if (!projectsList.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Todavía no hay ninguna sección exclusiva.</p>`;
      return;
    }
    list.innerHTML = projectsList
      .map(
        (p) => `
      <div style="border:1px solid var(--color-line);border-radius:var(--radius-sm);padding:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          ${projectBadgeHtml(p, "project-badge--sm")}
          <span style="font-size:13.5px;font-weight:600;color:var(--color-text-hi);">${escapeHtml(p.name)}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 18px;">
          ${DEPARTMENT_GROUPS.map(
            (d) => `
            <label class="acc-switch-row" style="display:inline-flex;">
              <input type="checkbox" data-project="${p.id}" data-dept="${d.value}" ${p.allowedDepartments.includes(d.value) ? "checked" : ""}>
              <span>${escapeHtml(d.label)}</span>
            </label>`
          ).join("")}
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("input[type=checkbox][data-project]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const project = projectsList.find((p) => p.id === cb.dataset.project);
        if (!project) return;
        const dept = cb.dataset.dept;
        const wasChecked = !cb.checked; // ya cambió antes de este handler
        const next = new Set(project.allowedDepartments);
        if (cb.checked) next.add(dept); else next.delete(dept);
        cb.disabled = true;
        try {
          await updateProject(project.id, { allowedDepartments: [...next] });
          project.allowedDepartments = [...next];
          showToast("Acceso actualizado.");
        } catch (e) {
          cb.checked = wasChecked; // revertir
          showToast("No se pudo actualizar el acceso.", "error");
        }
        cb.disabled = false;
      });
    });
  }
  renderList();

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
