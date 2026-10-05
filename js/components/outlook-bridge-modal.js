// ============================================================================
// Modal (solo administradores): «Conexión con Outlook» (v61). Genera la clave
// que comparten Chusy y la macro «Crear carpeta de proyecto» de Outlook y
// enseña las tres líneas que hay que pegar al principio de la macro. Se abre
// desde el menú del usuario (pie de la barra lateral).
//
// La clave vive en `meta/outlookBridge` (solo un administrador puede leerla o
// cambiarla — ver firestore.rules). Sin ella, las reglas rechazan cualquier
// petición de la macro: borrarla apaga el puente.
// ============================================================================
import { el, showToast } from "../utils.js";
import { getOutlookKey, setOutlookKey, removeOutlookKey } from "../data/outlook-inbox.js";
import { generateOutlookKey, macroConstantsBlock } from "../outlook-offer.js";
import { firebaseConfig } from "../firebase-config.js";

export function openOutlookBridgeModal({ currentUser }) {
  const root = document.getElementById("modal-root");
  let key = "";

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Conexión con Outlook</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint">Con la macro «Crear carpeta de proyecto» de Outlook, al terminar crea sola la oferta en Chusy — siempre que Chusy esté abierto con la sesión iniciada de quien lanza la macro. La macro y Chusy se reconocen por una clave compartida.</p>
          <div id="ob-body" style="display:flex;flex-direction:column;gap:12px;margin-top:6px;"></div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="cancel" style="margin-left:auto;">Cerrar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);
  const body = overlay.querySelector("#ob-body");

  function render() {
    if (!key) {
      body.innerHTML = `
        <p style="font-size:13px;color:var(--color-text-lo);">Todavía no hay ninguna clave: la conexión está apagada.</p>
        <div><button class="btn btn--primary" id="ob-generate">Generar clave y activar</button></div>`;
      body.querySelector("#ob-generate").addEventListener("click", () => saveKey("Conexión activada."));
      return;
    }
    const block = macroConstantsBlock({
      projectId: firebaseConfig.projectId,
      apiKey: firebaseConfig.apiKey,
      key,
    });
    body.innerHTML = `
      <p style="font-size:13px;color:var(--color-text-lo);">Conexión <b>activa</b>. Pega estas tres líneas al principio de la macro (sustituyen a las tres que ya trae, <code>CHUSY_PROJECT_ID</code>, <code>CHUSY_API_KEY</code> y <code>CHUSY_CLAVE</code>):</p>
      <textarea class="field__textarea" id="ob-block" readonly rows="3" style="font-family:var(--font-mono);font-size:12px;white-space:pre;overflow-x:auto;"></textarea>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        <button class="btn btn--primary btn--sm" id="ob-copy">Copiar las tres líneas</button>
        <button class="btn btn--ghost btn--sm" id="ob-regenerate">Cambiar la clave</button>
        <button class="btn btn--danger btn--sm" id="ob-disable">Apagar la conexión</button>
      </div>
      <p class="field__hint">Cambiar la clave o apagar la conexión deja sin efecto las macros que lleven la clave anterior: la macro seguirá creando sus carpetas, pero avisará de que no ha podido crear la oferta en Chusy.</p>`;
    body.querySelector("#ob-block").value = block;
    body.querySelector("#ob-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block);
        showToast("Copiado.");
      } catch (e) {
        const area = body.querySelector("#ob-block");
        area.focus();
        area.select();
        showToast("Selecciónalo y cópialo con Ctrl+C.");
      }
    });
    body.querySelector("#ob-regenerate").addEventListener("click", () => {
      if (!confirm("Las macros que ya tengan la clave actual dejarán de poder crear ofertas hasta que les pegues la nueva. ¿Cambiar la clave?")) return;
      saveKey("Clave cambiada.");
    });
    body.querySelector("#ob-disable").addEventListener("click", async () => {
      if (!confirm("Las macros dejarán de poder crear ofertas en Chusy. ¿Apagar la conexión?")) return;
      try {
        await removeOutlookKey();
        key = "";
        render();
        showToast("Conexión apagada.");
      } catch (e) {
        showToast("No se pudo apagar la conexión.", "error");
      }
    });
  }

  async function saveKey(okMessage) {
    const next = generateOutlookKey((bytes) => crypto.getRandomValues(bytes));
    try {
      await setOutlookKey(next, currentUser.uid);
      key = next;
      render();
      showToast(okMessage);
    } catch (e) {
      console.error("setOutlookKey:", e);
      showToast("No se pudo guardar la clave. ¿Están publicadas las reglas nuevas de Firestore?", "error");
    }
  }

  body.innerHTML = `<p style="font-size:13px;color:var(--color-text-faint);">Cargando…</p>`;
  getOutlookKey()
    .then((current) => { key = current; render(); })
    .catch((e) => {
      console.error("getOutlookKey:", e);
      body.innerHTML = `<p style="font-size:13px;color:var(--color-danger);">No se pudo leer la configuración. ¿Están publicadas las reglas nuevas de Firestore?</p>`;
    });

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
