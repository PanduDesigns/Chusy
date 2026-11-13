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
// v86: además de las secciones exclusivas (que son proyectos), la ventana lleva una tarjeta «Pedidos» con las MISMAS
// casillas y el mismo guardado al momento: «Pedidos» no es un proyecto sino una vista transversal, así que su permiso
// no cuelga de un `allowedDepartments` de proyecto sino de `meta/ordersAccess` (data/orders-access.js, lógica en
// departments.js). Sin configurar, solo los Técnicos (y los admins, que entran siempre).
//
// v90: igual con la tarjeta «Visualizador de piezas» (meta/partsViewerAccess, data/parts-viewer-access.js): mismas casillas, guardado al momento.
//
// v63: las casillas son GRUPOS de acceso (Diseño, Técnicos, Producción — ver
// DEPARTMENT_GROUPS en departments.js), no departamentos sueltos: «Diseño»
// abre la sección a Diseño - Industria y a Diseño - Automoción a la vez.
// ============================================================================
import { el, escapeHtml, showToast, projectBadgeHtml } from "../utils.js";
import { updateProject } from "../data/projects.js";
import { setOrdersAccess } from "../data/orders-access.js";
import { setPartsViewerAccess } from "../data/parts-viewer-access.js";
import { DEPARTMENT_GROUPS, normalizeOrdersAllowed, normalizePartsViewerAllowed } from "../departments.js";

/**
 * `exclusiveProjects`: las secciones exclusivas (Ofertas…). `ordersAccess` (v86): los grupos que ven «Pedidos» ahora
 * mismo (lista ya normalizada, ver normalizeOrdersAllowed); sin ella, la ventana no pinta la tarjeta de «Pedidos».
 * `partsViewerAccess` (v90): lo mismo para «Visualizador de piezas» (ver normalizePartsViewerAllowed).
 * `currentUser`: para anotar quién cambió el permiso (opcional).
 */
export function openDepartmentAccessModal({ exclusiveProjects, ordersAccess, partsViewerAccess, currentUser }) {
  const root = document.getElementById("modal-root");
  // Copia local mutable, mismo criterio que team-admin-modal.js: reflejamos
  // aquí mismo el resultado de cada guardado sin esperar a que este panel
  // se vuelva a abrir.
  const projectsList = exclusiveProjects.map((p) => ({ ...p, allowedDepartments: [...(p.allowedDepartments || [])] }));
  // v86: «Pedidos» como una tarjeta más, con la misma forma que una sección exclusiva (id, nombre y grupos permitidos).
  const ORDERS_CARD_ID = "__orders";
  const ordersCard = Array.isArray(ordersAccess) ? { id: ORDERS_CARD_ID, name: "Pedidos", icon: "📦", allowedDepartments: [...normalizeOrdersAllowed({ allowedDepartments: ordersAccess })] } : null;

  const PARTS_CARD_ID = "__parts";
  const partsCard = Array.isArray(partsViewerAccess) ? { id: PARTS_CARD_ID, name: "Visualizador de piezas", icon: "🧊", allowedDepartments: [...normalizePartsViewerAllowed({ allowedDepartments: partsViewerAccess })] } : null;
  const specialCards = [ordersCard, partsCard].filter(Boolean);

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Accesos por departamento</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Qué departamentos pueden ver y usar cada sección exclusiva (Ofertas) y las secciones «Pedidos» y «Visualizador de piezas». «Diseño» incluye a Diseño - Industria y a Diseño - Automoción. Quien sea admin accede siempre a todas, estén marcadas aquí o no.</p>
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
    const cards = [...projectsList, ...specialCards];
    if (!cards.length) {
      list.innerHTML = `<p style="color:var(--color-text-faint);font-size:12.5px;">Todavía no hay ninguna sección exclusiva.</p>`;
      return;
    }
    list.innerHTML = cards
      .map(
        (p) => `
      <div style="border:1px solid var(--color-line);border-radius:var(--radius-sm);padding:12px;"${p.id === ORDERS_CARD_ID ? ` data-da-card="orders"` : p.id === PARTS_CARD_ID ? ` data-da-card="parts-viewer"` : ""}>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          ${p.id === ORDERS_CARD_ID || p.id === PARTS_CARD_ID ? `<span class="sidebar__item-icon" aria-hidden="true">${p.id === ORDERS_CARD_ID ? "📦" : "🧊"}</span>` : projectBadgeHtml(p, "project-badge--sm")}
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
        const project = specialCards.find((c) => c.id === cb.dataset.project) || projectsList.find((p) => p.id === cb.dataset.project);
        if (!project) return;
        const dept = cb.dataset.dept;
        const wasChecked = !cb.checked; // ya cambió antes de este handler
        const next = new Set(project.allowedDepartments);
        if (cb.checked) next.add(dept); else next.delete(dept);
        cb.disabled = true;
        try {
          if (project === ordersCard) await setOrdersAccess([...next], currentUser && currentUser.uid);
          else if (project === partsCard) await setPartsViewerAccess([...next], currentUser && currentUser.uid);
          else await updateProject(project.id, { allowedDepartments: [...next] });
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
