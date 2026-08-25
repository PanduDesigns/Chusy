// ============================================================================
// Modal: "Mi cuenta" — datos del propio perfil y cambio de contraseña.
// Se abre desde el pie de la barra lateral (clic en el propio nombre).
// ============================================================================
import { el, escapeHtml, initials, colorFromString, formatDateLong, showToast } from "../utils.js";
import { updateDisplayName, changePassword } from "../auth.js";
import { updateUserProfile } from "../data/users.js";
import { applyTheme } from "../theme.js";

export function openAccountModal({ userProfile }) {
  const root = document.getElementById("modal-root");

  // --color-ink/--color-text-hi en vez de hexadecimales sueltos: la
  // insignia de admin va sobre --color-signal (dorado) y la de miembro
  // sobre --color-panel-raised — las dos cambian de valor entre modo claro
  // y oscuro, así que el texto tiene que ser la variable pensada para
  // seguir contrastando en los dos casos, no un color fijo copiado del
  // aspecto que tenía en un solo tema.
  const roleBg = userProfile.role === "admin" ? "var(--color-signal)" : "var(--color-panel-raised)";
  const roleFg = userProfile.role === "admin" ? "var(--color-ink)" : "var(--color-text-hi)";
  const memberSince = userProfile.createdAt ? formatDateLong(userProfile.createdAt) : "";
  const currentTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--sm">
        <div class="modal__header">
          <h3 style="font-size:16px;">Mi cuenta</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">

          <div style="display:flex;align-items:center;gap:12px;">
            <span class="avatar" style="width:44px;height:44px;font-size:15px;background:${colorFromString(userProfile.uid)}">${initials(userProfile.name)}</span>
            <div style="min-width:0;">
              <div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(userProfile.email || "")}</div>
              <span class="tag-pill" style="margin-top:4px;display:inline-block;background:${roleBg};color:${roleFg};">${userProfile.role === "admin" ? "Admin" : "Miembro"}</span>
              ${memberSince ? `<div style="font-size:11px;color:var(--color-text-faint);margin-top:4px;">Miembro desde ${memberSince}</div>` : ""}
            </div>
          </div>

          <label class="field">
            <span class="field__label">Nombre</span>
            <input class="field__input" id="acc-name" type="text" value="${escapeHtml(userProfile.name || "")}">
          </label>
          <p class="field__error" data-name-error></p>
          <button class="btn btn--ghost btn--sm" id="acc-save-name" type="button" style="width:fit-content;">Guardar nombre</button>

          <div style="border-top:1px solid var(--color-line);"></div>

          <span class="field__label" style="font-size:13px;">Apariencia</span>
          <div class="chip-select" id="acc-theme-toggle">
            <button type="button" class="chip${currentTheme === "dark" ? " is-selected" : ""}" data-theme-choice="dark">🌙 Oscuro</button>
            <button type="button" class="chip${currentTheme === "light" ? " is-selected" : ""}" data-theme-choice="light">☀️ Claro</button>
          </div>
          <p class="field__hint">Se aplica al momento y se recuerda en tu cuenta, también si entras desde otro dispositivo.</p>

          <div style="border-top:1px solid var(--color-line);"></div>

          <span class="field__label" style="font-size:13px;">Cambiar contraseña</span>
          <label class="field">
            <span class="field__label">Contraseña actual</span>
            <input class="field__input" id="acc-current-pw" type="password" autocomplete="current-password">
          </label>
          <label class="field">
            <span class="field__label">Contraseña nueva</span>
            <input class="field__input" id="acc-new-pw" type="password" minlength="6" autocomplete="new-password">
          </label>
          <label class="field">
            <span class="field__label">Repetir contraseña nueva</span>
            <input class="field__input" id="acc-new-pw2" type="password" minlength="6" autocomplete="new-password">
          </label>
          <p class="field__error" data-pw-error></p>
          <button class="btn btn--ghost btn--sm" id="acc-save-pw" type="button" style="width:fit-content;">Actualizar contraseña</button>

        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel" style="margin-left:auto;">Cerrar</button>
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

  // Se aplica al momento (sin esperar a Firestore, para que se note
  // inmediato) y se guarda en la cuenta después — si ese guardado falla
  // (sin conexión, etc.) el tema se queda igualmente aplicado en este
  // navegador, solo avisamos de que no viajará a otro dispositivo.
  overlay.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.themeChoice;
      applyTheme(theme);
      overlay.querySelectorAll("[data-theme-choice]").forEach((b) => b.classList.toggle("is-selected", b === btn));
      try {
        await updateUserProfile(userProfile.uid, { theme });
      } catch (e) {
        showToast("No se pudo guardar el tema en tu cuenta (sí se aplicó en este navegador).", "error");
      }
    });
  });

  overlay.querySelector("#acc-save-name").addEventListener("click", async () => {
    const errorEl = overlay.querySelector("[data-name-error]");
    errorEl.textContent = "";
    const name = overlay.querySelector("#acc-name").value.trim();
    if (!name) { errorEl.textContent = "El nombre no puede quedar vacío."; return; }
    const btn = overlay.querySelector("#acc-save-name");
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      await updateDisplayName(name);
      await updateUserProfile(userProfile.uid, { name });
      showToast("Nombre actualizado.");
      btn.textContent = "Guardado ✓";
      setTimeout(() => { btn.textContent = "Guardar nombre"; btn.disabled = false; }, 1400);
    } catch (e) {
      errorEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Guardar nombre";
    }
  });

  overlay.querySelector("#acc-save-pw").addEventListener("click", async () => {
    const errorEl = overlay.querySelector("[data-pw-error]");
    errorEl.textContent = "";
    const current = overlay.querySelector("#acc-current-pw").value;
    const next = overlay.querySelector("#acc-new-pw").value;
    const next2 = overlay.querySelector("#acc-new-pw2").value;
    if (!current || !next) { errorEl.textContent = "Rellena la contraseña actual y la nueva."; return; }
    if (next.length < 6) { errorEl.textContent = "La contraseña nueva necesita al menos 6 caracteres."; return; }
    if (next !== next2) { errorEl.textContent = "Las dos contraseñas nuevas no coinciden."; return; }
    const btn = overlay.querySelector("#acc-save-pw");
    btn.disabled = true;
    btn.textContent = "Actualizando…";
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      showToast("Contraseña actualizada.");
      overlay.querySelector("#acc-current-pw").value = "";
      overlay.querySelector("#acc-new-pw").value = "";
      overlay.querySelector("#acc-new-pw2").value = "";
      btn.textContent = "Actualizada ✓";
      setTimeout(() => { btn.textContent = "Actualizar contraseña"; btn.disabled = false; }, 1400);
    } catch (e) {
      errorEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Actualizar contraseña";
    }
  });
}
