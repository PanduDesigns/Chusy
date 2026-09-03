// ============================================================================
// Modal (solo administradores): lista de todas las cuentas registradas con
// selector de rol, y configuración de dominios de correo permitidos para
// el registro. Se abre desde el pie de la barra lateral.
// ============================================================================
import { el, escapeHtml, initials, colorFromString, showToast } from "../utils.js";
import { updateUserRole, setUserDeleted, getTeamConfig, updateTeamConfig } from "../data/users.js";

/**
 * Cuentas ficticias (isImported, del importador de Asana — nunca un UID de
 * Auth real) fuera de este panel: no se registraron nunca, así que no
 * tienen sitio ni entre las "registradas" ni entre las "eliminadas" — su
 * propia gestión (mapearlas a una cuenta real) vive en el panel de
 * importación de Asana, no aquí.
 */
export function openTeamAdminModal({ teamMembers, currentUser }) {
  const root = document.getElementById("modal-root");
  // Copia local mutable: igual que ya hacía el cambio de rol (`member.role
  // = newRole` tras guardar bien), reflejamos aquí mismo el resultado de
  // eliminar/reactivar sin esperar a que este panel se vuelva a abrir — la
  // suscripción de teamMembers vive en app.js y no repinta un modal ya
  // abierto.
  const members = [...teamMembers];

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Administrar equipo</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <div>
            <span class="field__label" style="font-size:13px;" id="admin-active-count">Cuentas registradas</span>
            <div class="list-table__header" style="grid-template-columns:1fr 140px 32px;margin-top:10px;">
              <span class="list-table__col" style="cursor:default;">Persona</span>
              <span class="list-table__col" style="cursor:default;">Rol</span>
              <span></span>
            </div>
            <div id="admin-users-list" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

          <div id="admin-deleted-section" class="hidden">
            <span class="field__label" style="font-size:13px;">Cuentas eliminadas</span>
            <p class="field__hint">Perdieron el acceso a Chusy, pero sus tareas y comentarios se conservan — reasígnalas desde cada tarea o con "Asignar a una persona" en la selección múltiple.</p>
            <div id="admin-deleted-list" style="display:flex;flex-direction:column;gap:4px;margin-top:8px;"></div>
          </div>

          <div style="border-top:1px solid var(--color-line);"></div>

          <div>
            <span class="field__label" style="font-size:13px;">Restringir el registro a estos dominios de correo</span>
            <p class="field__hint">Déjalo vacío para permitir cualquier correo. Sepáralos por comas, ej. martechcorp.com, otraempresa.com</p>
            <input class="field__input" id="admin-domains" placeholder="Cargando…" disabled>
            <p class="field__error" data-domains-error></p>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel">Cerrar</button>
          <button class="btn btn--primary" id="admin-save-domains" style="margin-left:auto;">Guardar dominios</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // ---- listas de cuentas (registradas / eliminadas) ----
  function renderUserLists() {
    const real = members.filter((m) => !m.isImported);
    const active = real.filter((m) => !m.deleted);
    const deleted = real.filter((m) => m.deleted);

    overlay.querySelector("#admin-active-count").textContent = `Cuentas registradas (${active.length})`;
    overlay.querySelector("#admin-users-list").innerHTML = active
      .map(
        (m) => `
      <div class="list-row" style="grid-template-columns:1fr 140px 32px;align-items:center;">
        <span class="list-row__title-cell">
          <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
          <span style="min-width:0;">
            <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.name || m.email)}</div>
            <div style="font-size:11px;color:var(--color-text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.email || "")}</div>
          </span>
        </span>
        <select class="field__select acc-role-select" data-uid="${m.uid}">
          <option value="miembro" ${m.role !== "admin" ? "selected" : ""}>Miembro</option>
          <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
        ${m.uid === currentUser.uid
          ? `<span></span>`
          : `<button type="button" class="acc-delete-btn" data-delete-uid="${m.uid}" title="Eliminar cuenta">🗑</button>`}
      </div>`
      )
      .join("");

    const deletedSection = overlay.querySelector("#admin-deleted-section");
    deletedSection.classList.toggle("hidden", deleted.length === 0);
    overlay.querySelector("#admin-deleted-list").innerHTML = deleted
      .map(
        (m) => `
      <div class="list-row" style="grid-template-columns:1fr 140px 32px;align-items:center;opacity:0.7;">
        <span class="list-row__title-cell">
          <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
          <span style="min-width:0;">
            <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.name || m.email)}</div>
            <div style="font-size:11px;color:var(--color-text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.email || "")}</div>
          </span>
        </span>
        <span class="tag-pill" style="background:var(--color-panel-raised);color:var(--color-text-lo);width:fit-content;">Eliminada</span>
        <button type="button" class="acc-reactivate-btn" data-reactivate-uid="${m.uid}" title="Reactivar cuenta">↩</button>
      </div>`
      )
      .join("");

    wireRoleSelects();
    wireDeleteButtons();
    wireReactivateButtons();
  }

  // ---- roles ----
  function wireRoleSelects() {
    overlay.querySelectorAll(".acc-role-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const uid = select.dataset.uid;
        const newRole = select.value;
        const member = members.find((m) => m.uid === uid);
        const adminCount = members.filter((m) => !m.deleted && m.role === "admin").length;
        const isSelfDemotion = uid === currentUser.uid && newRole !== "admin";

        if (isSelfDemotion && adminCount <= 1) {
          alert("No puedes quitarte el rol de admin: eres la única persona administradora del equipo.");
          select.value = "admin";
          return;
        }
        try {
          await updateUserRole(uid, newRole);
          if (member) member.role = newRole;
          showToast("Rol actualizado.");
        } catch (e) {
          showToast("No se pudo cambiar el rol.", "error");
          select.value = member ? member.role : "miembro";
        }
      });
    });
  }

  // ---- eliminar / reactivar ----
  function wireDeleteButtons() {
    overlay.querySelectorAll("[data-delete-uid]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.deleteUid;
        const member = members.find((m) => m.uid === uid);
        if (!member) return;
        const ok = confirm(
          `¿Eliminar a ${member.name || member.email}? Perderá el acceso a Chusy, pero sus tareas y comentarios se conservan — podrás reasignarlas a otra persona, y reactivar esta cuenta más adelante si ha sido un error.`
        );
        if (!ok) return;
        btn.disabled = true;
        try {
          await setUserDeleted(uid, true);
          member.deleted = true;
          renderUserLists();
          showToast(`${member.name || member.email} ya no tiene acceso a Chusy.`);
        } catch (e) {
          showToast("No se pudo eliminar la cuenta.", "error");
          btn.disabled = false;
        }
      });
    });
  }

  function wireReactivateButtons() {
    overlay.querySelectorAll("[data-reactivate-uid]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.reactivateUid;
        const member = members.find((m) => m.uid === uid);
        if (!member) return;
        btn.disabled = true;
        try {
          await setUserDeleted(uid, false);
          member.deleted = false;
          renderUserLists();
          showToast(`${member.name || member.email} vuelve a tener acceso a Chusy.`);
        } catch (e) {
          showToast("No se pudo reactivar la cuenta.", "error");
          btn.disabled = false;
        }
      });
    });
  }

  renderUserLists();

  // ---- dominios de correo permitidos ----
  const domainsInput = overlay.querySelector("#admin-domains");
  getTeamConfig()
    .then((config) => {
      domainsInput.value = (config.allowedEmailDomains || []).join(", ");
      domainsInput.placeholder = "Ej. martechcorp.com, otraempresa.com";
      domainsInput.disabled = false;
    })
    .catch(() => {
      domainsInput.placeholder = "No se pudo cargar";
    });

  overlay.querySelector("#admin-save-domains").addEventListener("click", async () => {
    const errorEl = overlay.querySelector("[data-domains-error]");
    errorEl.textContent = "";
    const domains = domainsInput.value.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    const btn = overlay.querySelector("#admin-save-domains");
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      await updateTeamConfig({ allowedEmailDomains: domains });
      showToast("Configuración del equipo guardada.");
    } catch (e) {
      errorEl.textContent = "No se pudo guardar. Comprueba tu conexión.";
    }
    btn.disabled = false;
    btn.textContent = "Guardar dominios";
  });
}
