// ============================================================================
// Modal (solo administradores): lista de todas las cuentas registradas con
// selector de rol, y configuración de dominios de correo permitidos para
// el registro. Se abre desde el pie de la barra lateral.
// ============================================================================
import { el, escapeHtml, initials, colorFromString, showToast } from "../utils.js";
import { updateUserRole, getTeamConfig, updateTeamConfig } from "../data/users.js";

export function openTeamAdminModal({ teamMembers, currentUser }) {
  const root = document.getElementById("modal-root");

  const rowsHtml = teamMembers
    .map(
      (m) => `
    <div class="list-row" style="grid-template-columns:1fr 140px;align-items:center;">
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
    </div>`
    )
    .join("");

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Administrar equipo</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <div>
            <span class="field__label" style="font-size:13px;">Cuentas registradas (${teamMembers.length})</span>
            <div class="list-table__header" style="grid-template-columns:1fr 140px;margin-top:10px;">
              <span class="list-table__col" style="cursor:default;">Persona</span>
              <span class="list-table__col" style="cursor:default;">Rol</span>
            </div>
            <div id="admin-users-list" style="display:flex;flex-direction:column;gap:4px;">${rowsHtml}</div>
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

  // ---- roles ----
  overlay.querySelectorAll(".acc-role-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const uid = select.dataset.uid;
      const newRole = select.value;
      const member = teamMembers.find((m) => m.uid === uid);
      const adminCount = teamMembers.filter((m) => m.role === "admin").length;
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
