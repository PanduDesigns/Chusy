// ============================================================================
// Campana de notificaciones — botón fijo (ver index.html/CSS, vive fuera
// de #topbar para no desaparecer en cada repintado de modo) que abre un
// panel con las últimas notificaciones y marca con un punto las que
// quedan por leer. Este archivo también tiene el aviso grande del centro
// de la pantalla que sale cuando llega una tarea nueva con la app abierta
// (showNewAssignmentsPopup).
//
// Cuándo se marca algo como leído (v52):
//  - Al CERRAR el panel, por cualquier vía (clic fuera, Escape, la propia
//    campana, o abrir una notificación), se marcan como leídas todas las
//    que el panel llegó a enseñar — ya no hay botón de "marcar todas".
//    Solo las que estaban en pantalla: una que llega con el panel abierto
//    no se ha visto, y sigue sin leer.
//  - Cerrar el aviso grande con "Entendido" NO marca nada: solo te avisa
//    de que hay algo, el puntito de la campana sigue encendido hasta que
//    abras y cierres el panel.
// ============================================================================
import { escapeHtml, renderTitleHtml } from "../utils.js";
import {
  markNotificationRead,
  markAllNotificationsRead,
  notificationTaskCount,
  NOTIF_VISIBLE_LIMIT,
  NOTIF_TYPE_ASSIGNED_BULK,
} from "../data/notifications.js";

function relativeTime(date) {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// Mismo dibujo que el de la campana fija de index.html (stroke=currentColor,
// así que se recolorea con el tema), más grande.
const BELL_SVG = `
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3a5 5 0 0 0-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 15.5c-.7.9 0 2.2 1.1 2.2h11.8c1.1 0 1.8-1.3 1.1-2.2l-1.4-2.6c-.4-.5-.6-1.1-.6-1.7V8a5 5 0 0 0-5-5Z"/>
    <path d="M9.5 20a2.5 2.5 0 0 0 5 0"/>
  </svg>`;

const isBulk = (n) => n.type === NOTIF_TYPE_ASSIGNED_BULK;

/** "· Nombre del proyecto" en gris tras el texto de un aviso, o nada si es una tarea personal (sin proyecto) — para el listado del aviso grande y para el panel. */
function projectBit(n) {
  return n.projectName ? ` <span class="notif-row__project">· ${escapeHtml(n.projectName)}</span>` : "";
}

// El aviso grande que hay ahora mismo en pantalla, o null. Solo puede haber
// uno: si llegan más tareas con él ya abierto, se añaden a este mismo
// (cuenta y lista actualizadas) en vez de apilar otro encima — pasa
// siempre que alguien asigna varias tareas por separado (cada una es su
// propio aviso, y pueden llegar en rachas).
let popup = null; // { el, items, handlers, onKeydown }

/**
 * Aviso grande, en el CENTRO de la pantalla, para cuando llega una tarea
 * nueva CON LA APP YA ABIERTA (v52 — antes era un toast pequeño en la
 * esquina que se iba solo a los 6 segundos, y se pasaba por alto si no
 * estabas mirando justo entonces). Tapa la pantalla con un fondo oscuro y
 * NO se va solo: hay que pulsar uno de sus dos botones (o Escape). No roba
 * el foco del teclado a propósito — si llega mientras se está escribiendo,
 * un Enter o un espacio no puede pulsar un botón por accidente.
 *
 * `handlers`: { onOpenTask(taskId), onOpenProject(projectId), onOpenPanel() }.
 * Se llama desde app.js con lo que devuelve el `onNewNotifications` de
 * subscribeToNotifications — nunca con las que ya hubiera al abrir la app,
 * ver su comentario. Devuelve la lista ACUMULADA de avisos que muestra
 * ahora mismo (para que app.js pueda mandar el aviso del sistema con el
 * total, no solo con lo último que llegó).
 */
export function showNewAssignmentsPopup(newNotifications, handlers) {
  if (!newNotifications || !newNotifications.length) return [];
  if (!popup) {
    const overlay = document.createElement("div");
    overlay.className = "notif-alert-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-live", "assertive");
    overlay.setAttribute("aria-labelledby", "notif-alert-title");
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-notif-alert]");
      if (!btn) return; // un clic en el fondo NO lo cierra: hay que elegir un botón
      if (btn.dataset.notifAlert === "open") runNewAssignmentsPrimaryAction();
      else closeNewAssignmentsPopup();
    });
    // En fase de captura y cortando la propagación: si hay un modal abierto
    // debajo (una tarea a medio editar, por ejemplo), Escape debe cerrar SOLO
    // este aviso, no también ese modal.
    const onKeydown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeNewAssignmentsPopup();
    };
    document.addEventListener("keydown", onKeydown, true);
    document.body.appendChild(overlay);
    popup = { el: overlay, items: [], handlers, onKeydown };
  }
  popup.handlers = handlers;
  newNotifications.forEach((n) => { if (!popup.items.some((x) => x.id === n.id)) popup.items.push(n); });
  renderNewAssignmentsPopup();
  return [...popup.items];
}

function renderNewAssignmentsPopup() {
  const { el, items } = popup;
  const total = items.reduce((sum, n) => sum + notificationTaskCount(n), 0);
  const single = items.length === 1 ? items[0] : null;

  let title;
  let bodyHtml;
  let primaryLabel;
  if (single && !isBulk(single)) {
    title = "Te han asignado una tarea";
    primaryLabel = "Abrir tarea";
    bodyHtml = `
      <p class="notif-alert__who"><b>${escapeHtml(single.fromName || "Alguien")}</b> te ha asignado:</p>
      <p class="notif-alert__task">«${renderTitleHtml(single.taskTitle || "una tarea")}»</p>
      ${single.projectName ? `<p class="notif-alert__project">${escapeHtml(single.projectName)}</p>` : ""}`;
  } else if (single) {
    title = `Te han asignado ${total} tareas`;
    primaryLabel = "Ir al proyecto";
    bodyHtml = `
      <p class="notif-alert__who"><b>${escapeHtml(single.fromName || "Alguien")}</b> te ha asignado ${total} tareas nuevas${single.projectName ? " en:" : "."}</p>
      ${single.projectName ? `<p class="notif-alert__task">${escapeHtml(single.projectName)}</p>` : ""}`;
  } else {
    title = `Tienes ${total} tareas nuevas`;
    primaryLabel = "Ver notificaciones";
    const MAX_LINES = 4;
    const lines = items.slice(0, MAX_LINES).map((n) =>
      isBulk(n)
        ? `<li><b>${escapeHtml(n.fromName || "Alguien")}</b> · ${notificationTaskCount(n)} tareas${projectBit(n)}</li>`
        : `<li><b>${escapeHtml(n.fromName || "Alguien")}</b> · «${renderTitleHtml(n.taskTitle || "una tarea")}»${projectBit(n)}</li>`
    );
    const rest = items.length - MAX_LINES;
    if (rest > 0) lines.push(`<li class="notif-alert__more">… y ${rest} aviso${rest === 1 ? "" : "s"} más</li>`);
    bodyHtml = `<ul class="notif-alert__list">${lines.join("")}</ul>`;
  }

  // Se sustituye todo el contenido de la tarjeta (no solo el texto): el
  // icono nuevo vuelve a arrancar su animación de campana, así que una
  // tarea que llega con el aviso ya abierto se nota también.
  el.innerHTML = `
    <div class="notif-alert">
      <div class="notif-alert__icon">${BELL_SVG}</div>
      <h2 class="notif-alert__title" id="notif-alert-title">${title}</h2>
      ${bodyHtml}
      <div class="notif-alert__actions">
        <button type="button" class="btn btn--ghost" data-notif-alert="dismiss">Entendido</button>
        <button type="button" class="btn btn--primary" data-notif-alert="open">${primaryLabel}</button>
      </div>
    </div>`;
}

/** Cierra el aviso grande sin hacer nada más (no marca nada como leído). */
export function closeNewAssignmentsPopup() {
  if (!popup) return;
  document.removeEventListener("keydown", popup.onKeydown, true);
  popup.el.remove();
  popup = null;
}

/**
 * La acción del botón principal del aviso grande, y también la de pulsar el
 * aviso del sistema (browser-notifications.js): con un único aviso, abre
 * su tarea (o el proyecto, si es el resumen de una cabina) y lo marca como
 * leído; con varios, abre el panel. Sin aviso grande en pantalla (ya se
 * cerró), no hace nada.
 */
export function runNewAssignmentsPrimaryAction() {
  if (!popup) return;
  const { items, handlers } = popup;
  closeNewAssignmentsPopup();
  if (items.length !== 1) { handlers.onOpenPanel(); return; }
  const n = items[0];
  markNotificationRead(n.id).catch(() => { /* ya borrada por la autolimpieza: nada que marcar */ });
  if (isBulk(n) && n.projectId) handlers.onOpenProject(n.projectId);
  else handlers.onOpenTask(n.taskId);
}

/** Enciende o apaga el puntito de la campana según haya o no algo sin leer. */
export function updateNotifBell(dotEl, notifications) {
  dotEl.hidden = !notifications.some((n) => !n.read);
}

// El panel abierto ahora mismo, o null: { close(markRead = true) }. Solo hay
// uno a la vez — abrir otro (p. ej. desde el aviso grande, con el panel ya
// abierto) cierra primero el anterior, y ese cierre es el que marca como
// leído lo que llegó a enseñar.
let activePanel = null;

/**
 * Lo que hace la propia campana al pulsarla: abre el panel, o lo cierra si
 * ya estaba abierto (antes volvía a abrirse de cero, sin cerrarse nunca
 * con un segundo clic — y ahora cerrarlo es también lo que marca las
 * notificaciones como leídas, así que necesita una vía clara de cierre).
 */
export function toggleNotifPanel(anchorBtn, options) {
  if (activePanel) activePanel.close();
  else openNotifPanel(anchorBtn, options);
}

/**
 * Cierra el aviso grande y el panel sin marcar nada como leído — para
 * cuando se cierra la sesión (cleanup() de app.js): el panel intentaría
 * escribir sin sesión, y quien entre después en este navegador no debe
 * heredar un aviso de otra persona.
 */
export function resetNotificationUi() {
  closeNewAssignmentsPopup();
  if (activePanel) activePanel.close(false);
}

/**
 * Panel de notificaciones. `onOpenTask(taskId)` y `onOpenProject(projectId)`
 * los pone app.js (abrir la tarea en su modal / ir al proyecto). Cerrarlo,
 * de la forma que sea, marca como leídas las que enseñaba — ver la
 * cabecera de este archivo.
 */
export function openNotifPanel(anchorBtn, { notifications, onOpenTask, onOpenProject }) {
  if (activePanel) activePanel.close();
  document.querySelectorAll(".notif-panel").forEach((p) => p.remove());
  const rect = anchorBtn.getBoundingClientRect();
  const panel = document.createElement("div");
  panel.className = "notif-panel";
  // Ver NOTIF_VISIBLE_LIMIT en notifications.js: el propio dato ya se
  // autolimpia para no acumularse por encima de este número, así que
  // cortar aquí en 20 no deja fuera nada que se pudiera leer de otra
  // manera.
  const recent = notifications.slice(0, NOTIF_VISIBLE_LIMIT);
  const hasUnread = recent.some((n) => !n.read);

  function rowHtml(n) {
    const when = n.createdAt && typeof n.createdAt.toDate === "function" ? n.createdAt.toDate() : null;
    // El título viaja tal cual se guardó en su momento (taskTitle, ver
    // notifications.js) — puede traer sus propias marcas `**negrita**`
    // (apartado 3 del README), así que se pinta con renderTitleHtml() en
    // vez de escapeHtml() a secas, igual que en cualquier otro sitio
    // donde se muestra el título de una tarea.
    const text = isBulk(n)
      ? `<b>${escapeHtml(n.fromName || "Alguien")}</b> te asignó ${notificationTaskCount(n)} tareas${projectBit(n)}`
      : `<b>${escapeHtml(n.fromName || "Alguien")}</b> te asignó «${renderTitleHtml(n.taskTitle || "una tarea")}»${projectBit(n)}`;
    return `
      <button type="button" class="notif-row ${n.read ? "notif-row--read" : "notif-row--unread"}" data-id="${n.id}">
        <span class="notif-row__unread-dot${n.read ? " notif-row__unread-dot--hidden" : ""}"></span>
        <span class="notif-row__body">
          <span class="notif-row__text">${text}</span>
          <span class="notif-row__time">${relativeTime(when)}</span>
        </span>
      </button>`;
  }

  panel.innerHTML = `
    <div class="notif-panel__header">
      <span>Notificaciones</span>
      ${hasUnread ? `<span class="notif-panel__hint">Se marcan como leídas al cerrar</span>` : ""}
    </div>
    <div class="notif-panel__list">
      ${recent.length ? recent.map(rowHtml).join("") : `<p class="notif-panel__empty">Sin notificaciones todavía.</p>`}
    </div>
  `;
  document.body.appendChild(panel);
  const left = Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12);
  panel.style.left = `${Math.max(8, left)}px`;
  panel.style.top = `${rect.bottom + 8}px`;

  panel.querySelectorAll(".notif-row").forEach((row) => {
    row.addEventListener("click", () => {
      const n = recent.find((x) => x.id === row.dataset.id);
      // Cerrar primero (marca las leídas) y abrir después: lo que se abre
      // puede ser un modal, y el panel no debe quedarse debajo.
      closePanel();
      if (!n) return;
      if (isBulk(n) && n.projectId) onOpenProject(n.projectId);
      else onOpenTask(n.taskId);
    });
  });

  function onOutside(e) { if (!panel.contains(e.target) && e.target !== anchorBtn) closePanel(); }
  function onKeydown(e) { if (e.key === "Escape") closePanel(); }
  let closed = false;
  function closePanel(markRead = true) {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
    if (activePanel && activePanel.panel === panel) activePanel = null;
    // `recent` es la lista tal cual estaba al abrir: solo se marcan las que
    // se llegaron a ver, no las que hayan podido llegar con el panel abierto.
    if (markRead) markAllNotificationsRead(recent).catch((err) => console.warn("markAllNotificationsRead:", err));
  }
  activePanel = { panel, close: closePanel };
  setTimeout(() => {
    if (closed) return; // se cerró (o se sustituyó por otro) antes de que corriera este timeout
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}
