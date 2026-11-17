// ============================================================================
// Pregunta de la primera vez (v92): al subir a una tarea un .ipt/.iam cuyo .STEP/.STP gemelo no viaja en el mismo lote ni está
// ya adjunto, Chusy puede crear ese STP SOLO (con Inventor, en tu PC) y subirlo a la tarea. Como necesita el ayudante de
// Windows (assets/convertir-step/), la PRIMERA vez se pregunta una sola vez y se recuerda la respuesta (step-bridge.js):
//   ⚙️ Activar la conversión automática  ·  Subir solo el .ipt/.iam esta vez  ·  No convertir nunca
//
//   openCadUploadAssistant({ files }) → { addFiles(files), close(), result }
//     result → promesa de `{ action: 'enable' | 'native-only' | 'disable' | 'cancel', files }` (en 'cancel' no hay archivos que subir)
//     si ya hay una pregunta abierta, los archivos se suman a ella y devuelve `{ merged: true, result: null }`
// ============================================================================
import { el } from "../utils.js";
import { formatBytes } from "../drive-files.js";

let current = null;

export function openCadUploadAssistant({ files = [] } = {}) {
  if (current) { current.addFiles(files); return { merged: true, result: null }; }
  const natives = [];
  let settled = false;
  let resolveResult;
  const result = new Promise((r) => { resolveResult = r; });

  const root = el(`
    <div class="modal-overlay cad-assistant-overlay" role="dialog" aria-modal="true" aria-label="Conversión automática a STP">
      <div class="modal cad-assistant">
        <div class="modal__header"><h3 style="font-size:16px;">🧩 ¿Crear el .STP automáticamente?</h3><button type="button" class="modal__close" data-act="cancel" aria-label="Cancelar">✕</button></div>
        <div class="modal__body">
          <p class="cad-assistant__lead">Para que el equipo pueda <strong>ver y medir la pieza en 3D</strong> en Chusy hace falta el <strong>.STP</strong> de cada archivo de Inventor. Chusy puede <strong>crearlo solo</strong> con tu Inventor al subir el .ipt/.iam —sin que hagas nada más— y subirlo a la tarea.</p>
          <ul class="cad-assistant__list" data-cad="list"></ul>
          <p class="cad-assistant__hint">Funciona en Windows con Inventor y el ayudante instalado una vez (<strong>assets/convertir-step/Instalar-ConvertirStep.bat</strong>). El ayudante busca el archivo en tu PC y recuerda las carpetas: la primera vez de cada carpeta puede pedirte que lo elijas. Esta pregunta no se repite; se puede cambiar borrando <em>chusy_step_auto</em> del almacenamiento del navegador.</p>
        </div>
        <div class="modal__footer cad-assistant__foot">
          <button type="button" class="btn btn--primary" data-act="enable">⚙️ Activar la conversión automática</button>
          <button type="button" class="btn" data-act="native-only">Subir solo el .ipt/.iam esta vez</button>
          <button type="button" class="btn btn--ghost" data-act="disable">No convertir nunca</button>
        </div>
      </div>
    </div>`);
  const list = root.querySelector('[data-cad="list"]');
  document.body.appendChild(root);

  function render() {
    list.replaceChildren();
    natives.forEach((file) => {
      const row = el(`<li class="cad-assistant__row"><span class="cad-assistant__name"></span><span class="cad-assistant__size"></span></li>`);
      row.querySelector(".cad-assistant__name").textContent = file.name;
      row.querySelector(".cad-assistant__size").textContent = formatBytes(file.size);
      list.appendChild(row);
    });
  }

  function addFiles(more) {
    Array.from(more || []).forEach((f) => { if (f && !natives.includes(f)) natives.push(f); });
    render();
  }

  function settle(action) {
    if (settled) return;
    settled = true;
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    current = null;
    resolveResult({ action, files: action === "cancel" ? [] : natives.slice() });
  }

  function onKey(ev) {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    ev.preventDefault();
    settle("cancel");
  }

  root.querySelector('[data-act="enable"]').addEventListener("click", () => settle("enable"));
  root.querySelector('[data-act="native-only"]').addEventListener("click", () => settle("native-only"));
  root.querySelector('[data-act="disable"]').addEventListener("click", () => settle("disable"));
  root.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener("click", () => settle("cancel")));
  document.addEventListener("keydown", onKey, true);

  addFiles(files);
  current = { addFiles, close: () => settle("cancel"), result, root };
  return current;
}
