// ============================================================================
// «Abrir Ubicación» (v60): lo que pasa al pulsar el botón y el propio botón,
// reutilizable (ficha de oferta, Propiedades de un proyecto) — la barra
// superior del proyecto pinta el suyo a mano y llama a `openLocation()`.
//
// Qué hace `openLocation(texto)` según lo que haya escrito (ver
// normalizeLocation en ../location.js):
//   · una dirección web (https://…)  → la abre en una pestaña nueva.
//   · una ruta de carpeta            → la COPIA al portapapeles y, en
//     Windows, intenta abrirla con el ayudante opcional (protocolo
//     `chusy-open:`, ver assets/abrir-ubicacion/). Si pasado un instante no
//     hay señal de que se haya abierto algo (la ventana del navegador no ha
//     perdido el foco), avisa de que la ruta está copiada para pegarla en
//     el Explorador. Con el ayudante instalado, la carpeta se abre y no
//     sale ningún aviso.
// ============================================================================
import { showToast } from "../utils.js";
import { normalizeLocation, hasLocation, protocolUrl, OPEN_LOCATION_LABEL } from "../location.js";

/** Cuánto se espera a ver si el navegador pierde el foco (señal de que el ayudante abrió el Explorador). */
const LAUNCH_WAIT_MS = 1200;

/** Los botones que ahora mismo están abriendo algo (para ignorar clics repetidos). */
const busyButtons = new WeakSet();

function isWindows() {
  return /Windows/i.test(navigator.userAgent || "");
}

/** Copia con el portapapeles moderno y, si el navegador no lo permite, con el método antiguo. Devuelve una promesa de true/false. */
function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
  } catch { /* cae al método antiguo */ }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Lanza `chusy-open:…`. Firefox enseña un aviso a pantalla completa si se
 * navega a un protocolo que no conoce: dentro de un iframe oculto falla sin
 * molestar. Chrome y Edge, en cambio, no hacen nada visible si no hay
 * ayudante instalado, y necesitan el clic en el propio documento.
 */
function launchProtocol(url) {
  if (/Firefox/i.test(navigator.userAgent || "")) {
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.src = url;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 5000);
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Promesa de `true` si el navegador pierde el foco (o se oculta) antes de `ms`, `false` si no. Hay que llamarla ANTES de lanzar el protocolo. */
function waitForFocusLoss(ms) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    function finish(lost) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      resolve(lost);
    }
    function onBlur() { finish(true); }
    function onVisibility() { if (document.hidden) finish(true); }
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    timer = setTimeout(() => finish(false), ms);
  });
}

/**
 * Marca un botón como «ocupado» mientras espera. Pone «Abriendo…» en su
 * texto, salvo que lleve `data-keep-label` (el de la barra superior, que a
 * veces es solo un icono y no debe cambiar de ancho): ahí solo se atenúa.
 */
function setBusy(button, busy) {
  if (!button) return;
  const keepLabel = button.hasAttribute("data-keep-label");
  if (busy) {
    busyButtons.add(button);
    if (!keepLabel) {
      button.dataset.label = button.textContent;
      button.textContent = "Abriendo…";
    }
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
  } else {
    busyButtons.delete(button);
    if (!keepLabel && button.dataset.label) button.textContent = button.dataset.label;
    delete button.dataset.label;
    button.classList.remove("is-busy");
    button.removeAttribute("aria-busy");
  }
}

/**
 * Abre la ubicación escrita en `raw`. `button` es opcional: si se pasa, se
 * pone en «Abriendo…» mientras espera y se ignoran sus clics repetidos.
 * Devuelve "empty" | "busy" | "web" | "launched" | "copied" | "manual" (qué
 * pasó, útil para las pruebas): "busy" = ese botón ya estaba abriendo algo,
 * "launched" = el navegador perdió el foco tras lanzar el ayudante,
 * "copied" = ruta copiada para pegarla a mano, "manual" = ni eso: se le
 * enseña la ruta para que la copie ella.
 */
export async function openLocation(raw, button = null) {
  const location = normalizeLocation(raw);
  if (location.kind === "empty") {
    showToast("Escribe primero la ubicación.", "error");
    return "empty";
  }
  if (button && busyButtons.has(button)) return "busy";

  if (location.kind === "web") {
    window.open(location.value, "_blank", "noopener");
    return "web";
  }

  // Carpeta. Todo lo que necesita el gesto del usuario (copiar, lanzar el
  // protocolo) se hace aquí, ANTES del primer `await`.
  setBusy(button, true);
  try {
    const copied = copyToClipboard(location.value);
    const windows = isWindows();
    const lostFocus = windows ? waitForFocusLoss(LAUNCH_WAIT_MS) : Promise.resolve(false);
    if (windows) launchProtocol(protocolUrl(location.value));

    const [copiedOk, opened] = await Promise.all([copied, lostFocus]);
    if (opened) return "launched";
    if (copiedOk) {
      showToast("Ruta copiada: pégala en la barra del Explorador de archivos para abrir la carpeta.");
      return "copied";
    }
    window.prompt("No se ha podido copiar sola. Copia la ruta (Ctrl+C) y pégala en el Explorador:", location.value);
    return "manual";
  } finally {
    setBusy(button, false);
  }
}

/**
 * El botón «📂 Abrir Ubicación». `getValue()` devuelve el texto de la
 * ubicación EN ESTE MOMENTO (lo que haya escrito en la casilla, aunque no se
 * haya guardado todavía). El botón está deshabilitado mientras no haya nada
 * escrito: quien lo monta llama a `refresh()` cada vez que cambia la casilla.
 * `compact`: versión más pequeña, para ir en la línea de una etiqueta.
 */
export function createOpenLocationButton({ getValue, compact = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn--ghost btn--sm open-location-btn${compact ? " open-location-btn--compact" : ""}`;
  button.textContent = OPEN_LOCATION_LABEL;

  function refresh() {
    const value = getValue();
    const has = hasLocation(value);
    button.disabled = !has;
    button.title = has ? `Abrir: ${normalizeLocation(value).value}` : "Rellena primero el campo Ubicación";
  }

  button.addEventListener("click", () => { openLocation(getValue(), button); });
  refresh();
  return { el: button, refresh };
}
