// ============================================================================
// Modal (solo administradores): «Archivos en Google Drive» (v68). Aquí se
// activa el almacenamiento de archivos de las tareas, se guarda la dirección
// del «puente» de Apps Script, se copia el código del puente (y sus permisos)
// para pegarlo en script.google.com y se PRUEBA toda la cadena —puente,
// permiso de Drive, subida pequeña, subida por trozos, descarga y papelera—
// antes de que nadie del equipo lo use. Se abre desde el menú del usuario
// (pie de la barra lateral). Ver el apartado 3.13 del README.
//
// El ajuste vive en `meta/driveStorage` (ver data/drive-config.js): lectura
// para cualquier cuenta activa, escritura solo admin (firestore.rules).
// ============================================================================
import { el, escapeHtml, showToast } from "../utils.js";
import { saveDriveConfig } from "../data/drive-config.js";
import { getDriveConfig, createDriveStorageFor } from "../drive-service.js";
import { normalizeGatewayUrl, DEFAULT_MAX_FILE_MB, MIN_MAX_FILE_MB, MAX_MAX_FILE_MB } from "../drive-files.js";
import { firebaseConfig } from "../firebase-config.js";

// Relativas a la PÁGINA (como el resto de rutas `assets/...` de la app), no al
// módulo: con `import.meta.url` Vite, al compilar, convertiría estos archivos
// en copias con hash dentro de dist/bundle/ y la ruta dejaría de ser `assets/`.
const SCRIPT_URL = new URL("assets/drive/ChusyDrive.gs", document.baseURI).href;
const MANIFEST_URL = new URL("assets/drive/appsscript.json", document.baseURI).href;

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** El código del puente con el proyecto de Firebase de ESTA instalación de Chusy ya puesto. */
export function scriptWithProject(text, projectId) {
  return text.replace(/(const\s+FIREBASE_PROJECT_ID\s*=\s*)'[^']*'/, (_all, head) => `${head}'${String(projectId).replace(/'/g, "")}'`);
}

export function openDriveStorageModal({ currentUser }) {
  const root = document.getElementById("modal-root");
  const current = getDriveConfig();

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">Archivos en Google Drive</h3>
          <button class="modal__close" id="ds-close">✕</button>
        </div>
        <div class="modal__body">
          <p class="field__hint" style="margin-top:0;">Con esto las tareas aceptan archivos (imágenes, vídeos, PDF, planos…) que se guardan en tu Google Drive. Hace falta instalar UNA vez un «puente»: un pequeño script de Google Apps Script que corre con la cuenta de Google donde está el espacio y da a Chusy un permiso temporal de Drive solo a quien tenga sesión activa en Chusy. Nadie necesita cuenta de Google.</p>

          <details class="ds-steps">
            <summary>Cómo instalar el puente (unos 10 minutos)</summary>
            <ol>
              <li>Entra en <b>script.google.com</b> con la cuenta de Google que tiene el espacio (mejor una cuenta propia de la empresa) → <b>Nuevo proyecto</b>.</li>
              <li>Pulsa <b>Copiar el script</b> (abajo) y pégalo en <code>Código.gs</code>, sustituyendo lo que haya. Guarda.</li>
              <li>Configuración del proyecto (⚙) → marca «Mostrar el archivo de manifiesto appsscript.json». Ábrelo, sustituye su contenido por el que da <b>Copiar los permisos</b> y guarda.</li>
              <li>En <b>Servicios</b> (+) añade <b>Drive API</b> (v3) si no aparece ya.</li>
              <li>Elige la función <b>autorizar</b> y pulsa <b>Ejecutar</b>: acepta los permisos («Configuración avanzada» → «Ir a Chusy Drive»). Debe decir «Todo listo» y crear la carpeta «Chusy - archivos» en tu Drive.</li>
              <li><b>Implementar → Nueva implementación → Aplicación web</b>: Ejecutar como <b>Yo</b>, Quién tiene acceso <b>Cualquier usuario</b>. Copia la URL (acaba en <code>/exec</code>) y pégala aquí.</li>
              <li>Marca la casilla, <b>Guardar</b> y <b>Probar conexión</b>.</li>
            </ol>
            <p class="field__hint">Si más adelante cambias el código del script: Implementar → Administrar implementaciones → ✏️ → Versión «Nueva versión». La URL no cambia.</p>
          </details>

          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="btn btn--ghost btn--sm" id="ds-copy-script">Copiar el script</button>
            <button class="btn btn--ghost btn--sm" id="ds-copy-manifest">Copiar los permisos (appsscript.json)</button>
          </div>
          <textarea class="field__textarea" id="ds-copy-fallback" readonly rows="6" hidden style="font-family:var(--font-mono);font-size:11.5px;white-space:pre;overflow:auto;"></textarea>

          <div class="field">
            <span class="field__label">Dirección del puente (URL de la aplicación web)</span>
            <input class="field__input" id="ds-url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false" value="${escapeHtml(current.gatewayUrl)}">
          </div>
          <div class="field">
            <span class="field__label">Tamaño máximo por archivo (MB)</span>
            <input class="field__input" id="ds-max" type="number" min="${MIN_MAX_FILE_MB}" max="${MAX_MAX_FILE_MB}" step="1" style="max-width:140px;" value="${current.maxFileMB}">
            <span class="field__hint">Entre ${MIN_MAX_FILE_MB} y ${MAX_MAX_FILE_MB} MB. Por defecto ${DEFAULT_MAX_FILE_MB} MB. Los vídeos y PDF de más de 250 MB no se pueden ver dentro de Chusy, solo descargar.</span>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">
            <input type="checkbox" id="ds-enabled" ${current.enabled ? "checked" : ""} style="accent-color:var(--color-signal);width:16px;height:16px;">
            Permitir subir archivos a las tareas
          </label>

          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="btn btn--primary" id="ds-save">Guardar</button>
            <button class="btn btn--ghost" id="ds-test">Probar conexión</button>
          </div>
          <div id="ds-result" class="ds-result" aria-live="polite"></div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="ds-cancel" style="margin-left:auto;">Cerrar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  const urlInput = overlay.querySelector("#ds-url");
  const maxInput = overlay.querySelector("#ds-max");
  const enabledBox = overlay.querySelector("#ds-enabled");
  const resultBox = overlay.querySelector("#ds-result");
  const fallbackArea = overlay.querySelector("#ds-copy-fallback");

  function formValues() {
    const gatewayUrl = normalizeGatewayUrl(urlInput.value);
    return { rawUrl: urlInput.value.trim(), gatewayUrl, maxFileMB: Number(maxInput.value) || DEFAULT_MAX_FILE_MB, enabled: enabledBox.checked };
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      fallbackArea.hidden = true;
      showToast(okMessage);
    } catch (e) {
      fallbackArea.hidden = false;
      fallbackArea.value = text;
      fallbackArea.focus();
      fallbackArea.select();
      showToast("Selecciónalo y cópialo con Ctrl+C.");
    }
  }

  overlay.querySelector("#ds-copy-script").addEventListener("click", async () => {
    try {
      const text = scriptWithProject(await fetchText(SCRIPT_URL), firebaseConfig.projectId);
      await copyText(text, "Script copiado. Pégalo en Código.gs del editor de Apps Script.");
    } catch (e) {
      console.error("copiar script:", e);
      showToast("No se pudo leer el script. Está en assets/drive/ChusyDrive.gs del proyecto.", "error");
    }
  });

  overlay.querySelector("#ds-copy-manifest").addEventListener("click", async () => {
    try {
      await copyText(await fetchText(MANIFEST_URL), "Permisos copiados. Pégalos en appsscript.json del editor.");
    } catch (e) {
      console.error("copiar manifiesto:", e);
      showToast("No se pudo leer el manifiesto. Está en assets/drive/appsscript.json del proyecto.", "error");
    }
  });

  overlay.querySelector("#ds-save").addEventListener("click", async () => {
    const v = formValues();
    if (v.rawUrl && !v.gatewayUrl) {
      showToast("Esa dirección no parece la de un puente (debe empezar por https://script.google.com/ y acabar en /exec).", "error");
      urlInput.focus();
      return;
    }
    if (v.enabled && !v.gatewayUrl) {
      showToast("Pega la URL de la aplicación web del puente (acaba en /exec).", "error");
      urlInput.focus();
      return;
    }
    try {
      await saveDriveConfig({ enabled: v.enabled, gatewayUrl: v.gatewayUrl, maxFileMB: v.maxFileMB }, currentUser && currentUser.uid);
      urlInput.value = v.gatewayUrl;
      showToast(v.enabled ? "Guardado: ya se pueden subir archivos a las tareas." : "Guardado: la subida de archivos está desactivada.");
    } catch (e) {
      console.error("saveDriveConfig:", e);
      showToast("No se pudo guardar. ¿Están publicadas las reglas nuevas de Firestore?", "error");
    }
  });

  const testBtn = overlay.querySelector("#ds-test");
  testBtn.addEventListener("click", async () => {
    const v = formValues();
    if (!v.gatewayUrl) {
      showToast("Primero pega la URL de la aplicación web del puente (acaba en /exec).", "error");
      urlInput.focus();
      return;
    }
    testBtn.disabled = true;
    resultBox.innerHTML = "";
    const rows = new Map();
    const paint = (step) => {
      let row = rows.get(step.id);
      if (!row) {
        row = el(`<div class="ds-step"></div>`);
        rows.set(step.id, row);
        resultBox.appendChild(row);
      }
      const mark = step.status === "running" ? "…" : step.status === "ok" ? "✓" : "✗";
      row.className = `ds-step ds-step--${step.status}`;
      row.innerHTML = `<span class="ds-step__mark">${mark}</span><span class="ds-step__text"><b>${escapeHtml(step.label)}</b>${step.detail ? `<br><span class="ds-step__detail">${escapeHtml(step.detail)}</span>` : ""}</span>`;
    };
    try {
      const storage = createDriveStorageFor({ gatewayUrl: v.gatewayUrl, maxFileMB: v.maxFileMB });
      const out = await storage.selfTest(paint);
      const summary = el(`<div class="ds-summary ${out.ok ? "ds-summary--ok" : "ds-summary--error"}">${out.ok ? "Todo funciona. Si aún no lo has hecho, marca la casilla y pulsa Guardar." : "Hay algo que corregir (arriba, en rojo). Si has cambiado el script, recuerda implementarlo como «Nueva versión»."}</div>`);
      resultBox.appendChild(summary);
    } catch (e) {
      console.error("selfTest:", e);
      resultBox.appendChild(el(`<div class="ds-summary ds-summary--error">${escapeHtml((e && e.message) || "La prueba falló.")}</div>`));
    } finally {
      testBtn.disabled = false;
    }
  });

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#ds-close").addEventListener("click", close);
  overlay.querySelector("#ds-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
