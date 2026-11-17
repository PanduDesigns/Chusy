// ============================================================================
// Lanzador del ayudante «Convertir a .STEP» (v90): pide a PowerShell + Inventor, en el PC de quien pulsa, que convierta UN
// archivo .ipt/.iam a STEP (.stp) en su misma carpeta (assets/convertir-step/). El navegador no puede decir dónde está el
// archivo que se sube: manda nombre, tamaño y fecha de modificación y el ayudante lo localiza en el PC (v91). Desde la v92 el
// enlace lo construye y lo sigue step-bridge.js (que recoge el .stp y lo sube); aquí queda lanzarlo y copiar el comando. Mismo mecanismo que «Abrir Ubicación»
// (components/open-location.js): protocolo de Windows `chusy-step:` y, si el navegador no detecta que algo se ha abierto,
// el comando de PowerShell queda copiado para pegarlo a mano.
// ============================================================================
import { showToast } from "../utils.js";
import { buildConvertStepPowerShellCommand } from "../cad-viewer.js";
import { isWindows, copyToClipboard, launchProtocol } from "./open-location.js";

/** Copia el comando de PowerShell equivalente. Devuelve true si se copió. */
export async function copyConvertStepCommand(input) {
  const command = buildConvertStepPowerShellCommand(input);
  if (!command) { showToast("Solo se pueden convertir archivos .ipt o .iam de Inventor.", "error"); return false; }
  const ok = await copyToClipboard(command);
  showToast(ok ? "Comando de PowerShell copiado." : "No se pudo copiar el comando.", ok ? "info" : "error");
  return ok;
}

/**
 * v92: lanza un enlace `chusy-step://` ya construido (la conversión automática, step-bridge.js). Devuelve `false` si este
 * ordenador no puede (no es Windows). No avisa de nada: del progreso y de los fallos se ocupa el puente.
 */
export async function launchStepUrl(url) {
  if (!isWindows()) return false;
  launchProtocol(url);
  return true;
}
