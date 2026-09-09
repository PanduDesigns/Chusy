// ============================================================================
// Campana de notificaciones — botón fijo (ver index.html/CSS, vive fuera
// de #topbar para no desaparecer en cada repintado de modo) que abre un
// panel con las últimas notificaciones y marca con un punto las que
// quedan por leer.
// ============================================================================
import { escapeHtml, renderTitleHtml } from "../utils.js";
import { markNotificationRead, markAllNotificationsRead, NOTIF_VISIBLE_LIMIT } from "../data/notifications.js";

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

/**
 * Aviso emergente para cuando llega una tarea nueva CON LA APP YA
 * ABIERTA — más llamativo que el toast normal de confirmaciones
 * (icono, dos líneas, más tiempo en pantalla) y clicable: lleva
 * directamente a la tarea (o al panel si han llegado varias de golpe,
 * por ejemplo una asignación masiva). Se llama desde app.js con lo que
 * vaya devolviendo el `onNewNotifications` de subscribeToNotifications
 * — nunca con las que ya hubiera al abrir la app, ver su comentario.
 */
export function showAssignedTaskToast(newNotifications, { onOpenTask, onOpenPanel }) {
  const root = document.getElementById("toast-root");
  if (!root || !newNotifications.length) return;

  const el = document.createElement("button");
  el.type = "button";
  el.className = "toast toast--notify";

  if (newNotifications.length === 1) {
    const n = newNotifications[0];
    const projectBit = n.projectName ? ` · ${escapeHtml(n.projectName)}` : "";
    el.innerHTML = `
      <span class="toast--notify__icon">🔔</span>
      <span class="toast--notify__body">
        <span class="toast--notify__title"><b>${escapeHtml(n.fromName || "Alguien")}</b> te ha asignado una tarea</span>
        <span class="toast--notify__task">«${renderTitleHtml(n.taskTitle || "una tarea")}»${projectBit}</span>
      </span>`;
    el.addEventListener("click", () => {
      markNotificationRead(n.id);
      onOpenTask(n.taskId);
      dismiss();
    });
  } else {
    el.innerHTML = `
      <span class="toast--notify__icon">🔔</span>
      <span class="toast--notify__body">
        <span class="toast--notify__title">Tienes ${newNotifications.length} tareas nuevas asignadas</span>
        <span class="toast--notify__task">Toca para verlas</span>
      </span>`;
    el.addEventListener("click", () => { onOpenPanel(); dismiss(); });
  }

  root.appendChild(el);
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }
  setTimeout(dismiss, 6000);
}

/** Enciende o apaga el puntito de la campana según haya o no algo sin leer. */
export function updateNotifBell(dotEl, notifications) {
  dotEl.hidden = !notifications.some((n) => !n.read);
}

export function openNotifPanel(anchorBtn, { notifications, onOpenTask }) {
  document.querySelectorAll(".notif-panel").forEach((p) => p.remove());
  const rect = anchorBtn.getBoundingClientRect();
  const panel = document.createElement("div");
  panel.className = "notif-panel";
  const hasUnread = notifications.some((n) => !n.read);
  // Ver NOTIF_VISIBLE_LIMIT en notifications.js: el propio dato ya se
  // autolimpia para no acumularse por encima de este número, así que
  // cortar aquí en 20 no deja fuera nada que se pudiera leer de otra
  // manera.
  const recent = notifications.slice(0, NOTIF_VISIBLE_LIMIT);

  function rowHtml(n) {
    const when = n.createdAt && typeof n.createdAt.toDate === "function" ? n.createdAt.toDate() : null;
    // El título viaja tal cual se guardó en su momento (taskTitle, ver
    // notifications.js) — puede traer sus propias marcas `**negrita**`
    // (apartado 3 del README), así que se pinta con renderTitleHtml() en
    // vez de escapeHtml() a secas, igual que en cualquier otro sitio
    // donde se muestra el título de una tarea.
    const projectBit = n.projectName ? ` <span class="notif-row__project">· ${escapeHtml(n.projectName)}</span>` : "";
    return `
      <button type="button" class="notif-row ${n.read ? "notif-row--read" : "notif-row--unread"}" data-id="${n.id}" data-task="${n.taskId}">
        <span class="notif-row__unread-dot${n.read ? " notif-row__unread-dot--hidden" : ""}"></span>
        <span class="notif-row__body">
          <span class="notif-row__text"><b>${escapeHtml(n.fromName || "Alguien")}</b> te asignó «${renderTitleHtml(n.taskTitle || "una tarea")}»${projectBit}</span>
          <span class="notif-row__time">${relativeTime(when)}</span>
        </span>
      </button>`;
  }

  panel.innerHTML = `
    <div class="notif-panel__header">
      <span>Notificaciones</span>
      ${hasUnread ? `<button type="button" class="notif-panel__mark-read" id="notif-mark-all">Marcar todas como leídas</button>` : ""}
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
      const n = notifications.find((x) => x.id === row.dataset.id);
      if (n && !n.read) markNotificationRead(n.id);
      onOpenTask(row.dataset.task);
      closePanel();
    });
  });
  const markAllBtn = panel.querySelector("#notif-mark-all");
  if (markAllBtn) {
    markAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      markAllNotificationsRead(notifications);
    });
  }

  function onOutside(e) { if (!panel.contains(e.target) && e.target !== anchorBtn) closePanel(); }
  function onKeydown(e) { if (e.key === "Escape") closePanel(); }
  function closePanel() {
    panel.remove();
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
  }
  setTimeout(() => {
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}
