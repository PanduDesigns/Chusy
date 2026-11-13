// ============================================================================
// Lanzador del ayudante «Convertir a .STEP» (v90): pide a PowerShell + Inventor, en el PC de quien pulsa, que convierta UN
// archivo .ipt/.iam a STEP (.stp) en su misma carpeta (assets/convertir-step/). El navegador no puede decir dónde está el
// archivo que se sube: manda nombre, tamaño y fecha de modificación y el ayudante lo localiza en el PC (v91). Mismo mecanismo que «Abrir Ubicación»
// (components/open-location.js): protocolo de Windows `chusy-step:` y, si el navegador no detecta que algo se ha abierto,
// el comando de PowerShell queda copiado para pegarlo a mano.
// ============================================================================
import { showToast } from "../utils.js";
import { buildConvertStepProtocolUrl, buildConvertStepPowerShellCommand } from "../cad-viewer.js";
import { isWindows, copyToClipboard, launchProtocol, waitForFocusLoss, LAUNCH_WAIT_MS } from "./open-location.js";

/**
 * Convierte `fileName` (o la ruta completa `filePath`) a STEP. `size` y `lastModified` (los del `File` que se sube) son lo que
 * permite al ayudante reconocer ESE archivo en el PC. `projectLocation` (una carpeta donde buscar ese nombre) es opcional y
 * Chusy ya no lo manda. Devuelve "invalid" | "unsupported" | "launched" | "copied" | "manual" (qué pasó, útil para las pruebas).
 */
export async function launchConvertStep({ filePath, fileName, size, lastModified, projectLocation } = {}) {
  const url = buildConvertStepProtocolUrl({ filePath, fileName, size, lastModified, projectLocation });
  const command = buildConvertStepPowerShellCommand({ filePath, fileName, size, lastModified, projectLocation });
  if (!url) {
    showToast("Solo se pueden convertir archivos .ipt o .iam de Inventor.", "error");
    return "invalid";
  }
  if (!isWindows()) {
    showToast("El convertidor a .STEP solo funciona en Windows con Inventor instalado.", "error");
    return "unsupported";
  }
  const focusLost = waitForFocusLoss(LAUNCH_WAIT_MS);
  launchProtocol(url);
  if (await focusLost) {
    showToast("Convirtiendo en tu PC… se abre una ventana de PowerShell; al terminar aparecerá el Explorador con el .STP generado.");
    return "launched";
  }
  const copied = await copyToClipboard(command);
  showToast(copied
    ? "No se detectó el ayudante. Comando de PowerShell copiado: pégalo en una ventana de PowerShell (o instala el ayudante)."
    : "No se detectó el ayudante instalado. Instálalo desde assets/convertir-step/.", "error");
  return copied ? "copied" : "manual";
}

/** Copia el comando de PowerShell equivalente. Devuelve true si se copió. */
export async function copyConvertStepCommand(input) {
  const command = buildConvertStepPowerShellCommand(input);
  if (!command) { showToast("Solo se pueden convertir archivos .ipt o .iam de Inventor.", "error"); return false; }
  const ok = await copyToClipboard(command);
  showToast(ok ? "Comando de PowerShell copiado." : "No se pudo copiar el comando.", ok ? "info" : "error");
  return ok;
}
