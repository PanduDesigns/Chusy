// ============================================================================
// Avisos de la conversión automática a STP (v92): una pequeña bandeja abajo a la derecha, FUERA de los modales (la conversión
// sigue su curso aunque se cambie de pantalla), con un aviso por archivo: qué paso va, y al acabar «listo» o el motivo del
// fallo con sus botones (reintentar, subir el .STP a mano).
//
//   const n = createConversionNotice('Eje_26001.ipt');
//   n.update('Convirtiendo con Inventor…');   n.success('STP subido a la tarea');   n.fail('No se detectó el ayudante', [{ label, onClick }]);   n.close();
// ============================================================================
import { el } from "../utils.js";

function tray() {
  let t = document.querySelector(".step-tray");
  if (!t) {
    t = el(`<div class="step-tray" aria-live="polite"></div>`);
    document.body.appendChild(t);
  }
  return t;
}

export function createConversionNotice(title) {
  const node = el(`
    <div class="step-tray__item" role="status">
      <div class="step-tray__spinner" aria-hidden="true"></div>
      <div class="step-tray__body">
        <div class="step-tray__title"></div>
        <div class="step-tray__text"></div>
        <div class="step-tray__actions"></div>
      </div>
      <button type="button" class="step-tray__close" aria-label="Cerrar" title="Cerrar">✕</button>
    </div>`);
  node.querySelector(".step-tray__title").textContent = `⚙️ ${title} → .STP`;
  const text = node.querySelector(".step-tray__text");
  const actions = node.querySelector(".step-tray__actions");
  let timer = 0;
  const close = () => { clearTimeout(timer); node.remove(); const t = document.querySelector(".step-tray"); if (t && !t.children.length) t.remove(); };
  node.querySelector(".step-tray__close").addEventListener("click", close);
  tray().appendChild(node);
  const setState = (state) => { node.classList.remove("is-ok", "is-error"); if (state) node.classList.add(state); };
  return {
    update(t) { text.textContent = t; },
    success(t) {
      setState("is-ok");
      text.textContent = t;
      actions.replaceChildren();
      timer = setTimeout(close, 7000);
    },
    fail(t, buttons = []) {
      setState("is-error");
      text.textContent = t;
      actions.replaceChildren();
      buttons.forEach((b) => {
        const btn = el(`<button type="button" class="btn btn--sm"></button>`);
        btn.textContent = b.label;
        btn.addEventListener("click", () => { close(); b.onClick(); });
        actions.appendChild(btn);
      });
    },
    close,
    node,
  };
}
