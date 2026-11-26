// ============================================================================
// Ojo para ver la contraseña (v95): un botón dentro del propio campo que
// alterna entre «••••» y el texto, para comprobar lo que se está escribiendo.
// Se engancha a un <input type="password"> ya existente (no cambia index.html
// campo a campo) y lo envuelve en `.password-field`. Pura interfaz: sin Firebase.
//
// - El botón es type="button" (no envía el formulario) y no le quita el foco al
//   campo (mousedown/pointerdown con preventDefault), para no cerrar el teclado
//   de la tablet cada vez que se pulsa.
// - La contraseña vuelve a ocultarse sola cuando el formulario se vacía
//   (`reset`) y con `hide()`, que app.js llama al cambiar de pestaña.
// - Edge pinta su propio ojo en los campos de contraseña: se oculta por CSS
//   (`::-ms-reveal`, ver 03-screens.css) para no ver dos.
// ============================================================================

const SVG_ATTRS = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_SHOW = `<svg ${SVG_ATTRS}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_HIDE = `<svg ${SVG_ATTRS}><path d="M2 12s3.6-7 10-7c2.1 0 3.9.7 5.4 1.7M22 12s-3.6 7-10 7c-2.1 0-3.9-.7-5.4-1.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>`;

export const PASSWORD_SHOW_LABEL = "Mostrar contraseña";
export const PASSWORD_HIDE_LABEL = "Ocultar contraseña";

/**
 * Añade el ojo a un campo de contraseña. Devuelve `{ button, show, hide, isVisible }`
 * (o null si no hay campo, o si ya lo tenía: engancharlo dos veces no pone dos ojos).
 */
export function addPasswordToggle(input) {
  if (!input || input.dataset.passwordToggle === "1") return null;
  input.dataset.passwordToggle = "1";

  const wrap = document.createElement("span");
  wrap.className = "password-field";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "password-field__toggle";
  wrap.appendChild(button);

  function paint() {
    const visible = input.type !== "password";
    button.innerHTML = visible ? ICON_HIDE : ICON_SHOW;
    button.setAttribute("aria-pressed", visible ? "true" : "false");
    button.setAttribute("aria-label", visible ? PASSWORD_HIDE_LABEL : PASSWORD_SHOW_LABEL);
    button.title = visible ? PASSWORD_HIDE_LABEL : PASSWORD_SHOW_LABEL;
  }
  const api = {
    button,
    isVisible: () => input.type !== "password",
    show() { input.type = "text"; paint(); },
    hide() { input.type = "password"; paint(); },
  };

  // Que pulsar el ojo no robe el foco al campo (en la tablet cerraría el teclado).
  const keepFocus = (e) => e.preventDefault();
  button.addEventListener("mousedown", keepFocus);
  button.addEventListener("pointerdown", keepFocus);
  button.addEventListener("click", () => {
    const end = input.selectionEnd;
    api.isVisible() ? api.hide() : api.show();
    input.focus({ preventScroll: true });
    // Cambiar el type recoloca el cursor al principio en algunos navegadores: se deja donde estaba.
    try { if (end != null) input.setSelectionRange(end, end); } catch { /* algunos tipos no admiten selección */ }
  });
  if (input.form) input.form.addEventListener("reset", () => api.hide());

  paint();
  return api;
}
