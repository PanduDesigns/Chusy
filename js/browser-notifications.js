// ============================================================================
// Avisos del navegador (v52) — la notificación del propio sistema
// (esquina de la pantalla en Windows/macOS/Linux) cuando te asignan una
// tarea y NO estás mirando Chusy: otra pestaña, otra ventana encima o el
// navegador minimizado. Es un complemento del aviso grande de dentro de la
// app (notification-bell.js), no un sustituto: con Chusy delante y con foco
// no sale, porque ya tienes ese otro aviso a la vista.
//
// Límite que conviene tener claro: usa la API `Notification` del propio
// navegador, que solo funciona con Chusy CARGADO en alguna pestaña (aunque
// sea en segundo plano). Con el navegador cerrado, o con la pestaña
// descartada por el ahorro de memoria de Chrome/Edge, no llega nada — para
// eso haría falta un envío "push" desde un servidor (Firebase Cloud
// Functions), que exige el plan de pago (Blaze) y este proyecto se ha
// quedado a propósito en el plan gratuito (Spark).
//
// La preferencia (activar o no) se guarda en ESTE navegador
// (localStorage), no en la cuenta: el permiso de notificaciones lo concede
// cada navegador por su lado, así que una preferencia de cuenta que dijera
// "activado" en un ordenador donde nunca se ha concedido el permiso solo
// confundiría. Igual que la barra lateral minimizada o los filtros de Mis
// tareas. Además de la preferencia, hace falta que el permiso esté
// concedido (`Notification.permission === "granted"`) — si alguien lo
// revoca desde los ajustes del navegador, deja de funcionar sin más.
// ============================================================================
import { notificationTaskCount, NOTIF_TYPE_ASSIGNED_BULK } from "./data/notifications.js";
import { plainTitleText } from "./utils.js";

const PREF_KEY_PREFIX = "chusy:browserNotifs:";
const NOTIF_TAG = "chusy-assignments"; // mismo `tag` en todas: una nueva sustituye a la anterior en vez de apilarse 20 en pantalla
const ICON_URL = "assets/favicon-180.png";

/** ¿Este navegador tiene la API de notificaciones del sistema? (Safari en iPhone, por ejemplo, no.) */
export function browserNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

/** "granted" | "denied" | "default" (sin decidir todavía) | "unsupported". */
export function getBrowserNotificationPermission() {
  return browserNotificationsSupported() ? Notification.permission : "unsupported";
}

function readPref(uid) {
  try { return localStorage.getItem(PREF_KEY_PREFIX + uid) === "1"; } catch (e) { return false; }
}
function writePref(uid, on) {
  try { localStorage.setItem(PREF_KEY_PREFIX + uid, on ? "1" : "0"); } catch (e) { /* localStorage no disponible */ }
}

/** Activado de verdad: la persona lo pidió Y el navegador tiene el permiso concedido ahora mismo. */
export function isBrowserNotificationsEnabled(uid) {
  return browserNotificationsSupported() && Notification.permission === "granted" && readPref(uid);
}

export function disableBrowserNotifications(uid) {
  writePref(uid, false);
}

/** `Notification.requestPermission()` devuelve una promesa en los navegadores actuales y usa un callback en algunos antiguos — esto admite los dos. */
function requestPermission() {
  return new Promise((resolve) => {
    try {
      const maybePromise = Notification.requestPermission(resolve);
      if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, () => resolve("denied"));
    } catch (e) {
      resolve("denied");
    }
  });
}

/**
 * Pide el permiso al navegador (solo si aún no se ha decidido) y, si se
 * concede, enseña un aviso de prueba para que la persona vea cómo le va a
 * llegar y guarda la preferencia. Debe llamarse desde un clic (los
 * navegadores ignoran la petición de permiso si no viene de una acción de
 * la persona). Devuelve el permiso resultante: "granted" | "denied" |
 * "default" | "unsupported" — este último también cuando el navegador tiene
 * la API pero no deja crear avisos desde una página (Chrome en Android, que
 * exige un service worker): sin la prueba, la persona vería el casillero
 * marcado sin que nunca le llegara nada, y la preferencia no se guarda.
 */
export async function enableBrowserNotifications(uid) {
  if (!browserNotificationsSupported()) return "unsupported";
  let permission = Notification.permission;
  if (permission === "default") permission = await requestPermission();
  if (permission === "granted") {
    const worked = showSystemNotification({ title: "Chusy", body: "Avisos del navegador activados: te avisaremos aquí cuando te asignen una tarea.", tag: "chusy-test" });
    if (!worked) return "unsupported";
    writePref(uid, true);
  }
  return permission;
}

let lastNotification = null;

function closeLastNotification() {
  if (!lastNotification) return;
  try { lastNotification.close(); } catch (e) { /* ya cerrada */ }
  lastNotification = null;
}

// Al volver a Chusy (la pestaña vuelve a estar delante, o la ventana coge
// foco) el aviso del sistema ya no pinta nada: el grande de dentro de la
// app está a la vista. Como se pide que se quede en pantalla hasta que se
// pulse (requireInteraction), sin esto seguiría ahí, tapando cosas, aun
// habiéndolo ya visto por dentro.
if (typeof window !== "undefined") {
  window.addEventListener("focus", closeLastNotification);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") closeLastNotification(); });
}

/** Crea el aviso del sistema. Devuelve `true` si el navegador lo aceptó, `false` si no (ver enableBrowserNotifications). */
function showSystemNotification({ title, body, tag, onClick }) {
  try {
    const options = { body, icon: ICON_URL, tag, requireInteraction: tag === NOTIF_TAG };
    if (tag) options.renotify = true; // con un tag repetido, vuelve a avisar (sonido/vibración) en vez de sustituir en silencio
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
      if (lastNotification === n) lastNotification = null;
      if (onClick) onClick();
    };
    if (tag === NOTIF_TAG) lastNotification = n;
    return true;
  } catch (e) {
    // p. ej. Chrome en Android, donde `new Notification()` lanza "Illegal constructor" (allí solo se puede desde un service worker) — sin este aviso del sistema la app sigue funcionando igual, con el aviso de dentro.
    console.warn("showSystemNotification:", e);
    return false;
  }
}

/**
 * Aviso del sistema por las notificaciones nuevas de `items` (la lista
 * acumulada que devuelve showNewAssignmentsPopup — si llegan varias
 * seguidas, se sustituye por una con el total en vez de apilar una por
 * cada una). No hace nada si la persona no lo tiene activado, o si Chusy
 * está delante y con foco (ya ve el aviso de dentro). `onClick` se ejecuta
 * al pulsar el aviso, tras traer la ventana al frente.
 */
export function showAssignmentSystemNotification(uid, items, { onClick } = {}) {
  if (!items || !items.length) return;
  if (!isBrowserNotificationsEnabled(uid)) return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;

  const total = items.reduce((sum, n) => sum + notificationTaskCount(n), 0);
  let title;
  let body;
  if (items.length === 1) {
    const n = items[0];
    const from = n.fromName || "Alguien";
    const where = n.projectName ? ` · ${n.projectName}` : "";
    if (n.type === NOTIF_TYPE_ASSIGNED_BULK) {
      title = `Te han asignado ${total} tareas`;
      body = `${from} te ha asignado ${total} tareas nuevas${where}`;
    } else {
      title = "Te han asignado una tarea";
      body = `${from} te ha asignado «${plainTitleText(n.taskTitle || "una tarea")}»${where}`;
    }
  } else {
    title = `Tienes ${total} tareas nuevas`;
    body = "Ábrelas en Chusy para verlas.";
  }
  showSystemNotification({ title, body, tag: NOTIF_TAG, onClick });
}
