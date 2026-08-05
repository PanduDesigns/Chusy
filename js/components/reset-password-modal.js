// ============================================================================
// Modal: "He olvidado mi contraseña" — pide el correo y envía el enlace de
// restablecimiento de Firebase Auth. Se abre desde la pantalla de login.
// ============================================================================
import { el } from "../utils.js";
import { sendPasswordReset } from "../auth.js";

export function openResetPasswordModal({ prefillEmail } = {}) {
  const root = document.getElementById("modal-root");

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--sm">
        <div class="modal__header">
          <h3 style="font-size:16px;">Restablecer contraseña</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint" style="margin:0;">Te enviaremos un enlace por correo para elegir una contraseña nueva.</p>
          <label class="field">
            <span class="field__label">Correo</span>
            <input class="field__input" id="rp-email" type="email" placeholder="tu@correo.com" autocomplete="email">
          </label>
          <p class="field__error" data-error></p>
          <p class="field__hint" data-success style="display:none;color:var(--color-success);"></p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel">Cerrar</button>
          <button class="btn btn--primary" id="send" style="margin-left:auto;">Enviar enlace</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  const emailInput = overlay.querySelector("#rp-email");
  if (prefillEmail) emailInput.value = prefillEmail;
  emailInput.focus();

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  async function send() {
    const errorEl = overlay.querySelector("[data-error]");
    const successEl = overlay.querySelector("[data-success]");
    errorEl.textContent = "";
    const email = emailInput.value.trim();
    if (!email) { emailInput.focus(); return; }
    const btn = overlay.querySelector("#send");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      await sendPasswordReset(email);
      successEl.textContent = "Si existe una cuenta con ese correo, te hemos enviado un enlace. Revisa también la carpeta de spam.";
      successEl.style.display = "block";
      emailInput.disabled = true;
      overlay.querySelector("#cancel").textContent = "Cerrar";
      btn.remove();
    } catch (e) {
      errorEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Enviar enlace";
    }
  }
  overlay.querySelector("#send").addEventListener("click", send);
  emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
}
