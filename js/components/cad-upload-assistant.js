// ============================================================================
// Asistente de subida de .ipt/.iam (v90): al subir a una tarea un archivo de Inventor cuyo .STEP/.STP gemelo no viaja en
// el mismo lote ni está ya adjunto, se detiene ESE archivo y se ofrece:
//   1. ⚙️ Convertir a .STEP en mi PC — PowerShell + Inventor convierten ese archivo individual (assets/convertir-step/);
//   2. ➕ Incluir el .STEP generado y subir todo — abre el selector para añadir el .STEP al lote;
//   3. Subir solo el .ipt/.iam sin .STEP.
//
//   openCadUploadAssistant({ files, deps }) → { addFiles(files), close(), result }
//     (si ya hay un asistente abierto, los archivos se suman a ese y devuelve `{ merged: true, result: null }`)
//     files        los File .ipt/.iam que esperan decisión
//     result       promesa de `{ action: 'upload-with-step' | 'upload-native-only' | 'cancel', files: File[] }`, con los
//                  archivos que hay que subir ahora (los .ipt/.iam y, en el primer caso, los .STEP añadidos)
// ============================================================================
import { el, showToast } from "../utils.js";
import { formatBytes } from "../drive-files.js";
import { isDirect3dCadFile, getCadBaseReference } from "../cad-viewer.js";
import { launchConvertStep, copyConvertStepCommand } from "./convert-step-launcher.js";

let current = null;

export function openCadUploadAssistant({ files = [], deps = {} } = {}) {
  if (current) { current.addFiles(files); return { merged: true, result: null }; }
  const launchConvert = deps.launchConvert || launchConvertStep;
  const copyCommand = deps.copyCommand || copyConvertStepCommand;
  const natives = [];
  const converted = new Set();
  let settled = false;
  let resolveResult;
  const result = new Promise((r) => { resolveResult = r; });

  const root = el(`
    <div class="modal-overlay cad-assistant-overlay" role="dialog" aria-modal="true" aria-label="Falta el modelo 3D">
      <div class="modal cad-assistant">
        <div class="modal__header"><h3 style="font-size:16px;">🧩 Falta el modelo 3D (.STEP) de tu pieza</h3><button type="button" class="modal__close" data-act="cancel" aria-label="Cancelar">✕</button></div>
        <div class="modal__body">
          <p class="cad-assistant__lead">Para que el equipo pueda <strong>ver y medir la pieza en 3D</strong> dentro de Chusy hace falta el <strong>.STEP</strong> de cada archivo de Inventor. Se genera en tu PC convirtiendo <strong>solo ese archivo</strong> (nunca toda la carpeta).</p>
          <ul class="cad-assistant__list" data-cad="list"></ul>
          <p class="cad-assistant__hint">El ayudante localiza en tu PC el archivo que estás subiendo (por nombre, tamaño y fecha) y lo convierte <strong>donde está</strong>; si no lo encuentra, te pide que lo elijas. Al terminar se abre el Explorador con el .STP generado: pulsa <strong>➕ 2</strong> y elígelo.
            <button type="button" class="cad-viewer-link" data-act="copy">Copiar comando de PowerShell</button></p>
        </div>
        <div class="modal__footer cad-assistant__foot">
          <button type="button" class="btn btn--primary" data-act="convert">⚙️ 1. Convertir a .STEP en mi PC</button>
          <button type="button" class="btn btn--primary" data-act="include">➕ 2. Incluir el .STEP generado y subir todo</button>
          <button type="button" class="btn" data-act="native-only">Subir solo el .ipt/.iam sin .STEP</button>
          <button type="button" class="btn btn--ghost" data-act="cancel">Cancelar</button>
        </div>
      </div>
    </div>`);
  const q = (n) => root.querySelector(`[data-cad="${n}"]`);
  const list = q("list");
  const convertAll = root.querySelector('[data-act="convert"]');
  document.body.appendChild(root);

  /** Lo que se sabe del archivo que se sube: el navegador no da su carpeta, pero sí nombre, tamaño y fecha, y con eso el ayudante lo reconoce en el PC. */
  function convertInputFor(file) {
    return { fileName: file.name, size: file.size, lastModified: file.lastModified };
  }

  function render() {
    list.replaceChildren();
    natives.forEach((file, i) => {
      const row = el(`<li class="cad-assistant__row"><span class="cad-assistant__name"></span><span class="cad-assistant__size"></span><span class="cad-assistant__state"></span><button type="button" class="btn btn--sm">⚙️ Convertir</button></li>`);
      row.querySelector(".cad-assistant__name").textContent = file.name;
      row.querySelector(".cad-assistant__size").textContent = formatBytes(file.size);
      row.querySelector(".cad-assistant__state").textContent = converted.has(file) ? "Orden enviada ✓" : "";
      row.querySelector("button").addEventListener("click", async () => {
        await launchConvert(convertInputFor(file));
        converted.add(file);
        render();
      });
      list.appendChild(row);
    });
    // Con un solo archivo basta el botón principal; con varios, cada fila convierte el suyo (uno a uno, nunca en bloque).
    convertAll.hidden = natives.length !== 1;
    list.classList.toggle("cad-assistant__list--single", natives.length === 1);
  }

  function addFiles(more) {
    Array.from(more || []).forEach((f) => { if (f && !natives.includes(f)) natives.push(f); });
    render();
  }

  function settle(action, extra = []) {
    if (settled) return;
    settled = true;
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    current = null;
    resolveResult({ action, files: action === "cancel" ? [] : natives.concat(extra) });
  }

  function onKey(ev) {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    ev.preventDefault();
    settle("cancel");
  }

  convertAll.addEventListener("click", async () => {
    if (!natives[0]) return;
    await launchConvert(convertInputFor(natives[0]));
    converted.add(natives[0]);
    render();
  });
  root.querySelector('[data-act="copy"]').addEventListener("click", () => { if (natives[0]) copyCommand(convertInputFor(natives[0])); });
  root.querySelector('[data-act="include"]').addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".step,.stp";
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const picked = Array.from(input.files || []).filter((f) => isDirect3dCadFile(f.name));
      input.remove();
      if (!picked.length) { showToast("Elige el archivo .step o .stp generado.", "error"); return; }
      const wanted = new Set(natives.map((f) => getCadBaseReference(f.name)));
      if (!picked.some((f) => wanted.has(getCadBaseReference(f.name)))) showToast("Ojo: el .STEP/.STP elegido no se llama igual que el .ipt/.iam; se sube igualmente.", "error");
      settle("upload-with-step", picked);
    });
    document.body.appendChild(input);
    input.click();
  });
  root.querySelector('[data-act="native-only"]').addEventListener("click", () => settle("upload-native-only"));
  root.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener("click", () => settle("cancel")));
  document.addEventListener("keydown", onKey, true);

  addFiles(files);
  current = { addFiles, close: () => settle("cancel"), result, root };
  return current;
}
