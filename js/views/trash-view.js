// ============================================================================
// Vista de la Papelera (v67): lo que se ha eliminado y aún se puede recuperar
// (TRASH_DAYS días, ver data/trash.js). Cada persona ve lo que eliminó ella; un
// admin, lo de todo el equipo. Cada fila se puede restaurar o eliminar para
// siempre, y arriba hay un «Vaciar papelera».
//
// Aquí solo se pinta y se pregunta (confirm, como en la vista de Archivo); lo
// que se hace con cada elemento lo decide quien llama (app.js): restaurar,
// borrar para siempre o vaciar.
// ============================================================================
import { escapeHtml, renderTitleHtml, projectBadgeHtml } from "../utils.js";
import { TRASH_DAYS, topLevelTrashItems, trashDaysLeft, trashDeletedAt } from "../data/trash.js";

/** «hoy», «ayer» o «hace N días» (una eliminación recién hecha, sin hora del servidor todavía, es «hoy»). */
function agoText(item, now) {
  const when = trashDeletedAt(item);
  if (!when) return "hoy";
  const days = Math.floor((now.getTime() - when.getTime()) / 86400000);
  if (days <= 0) return "hoy";
  return days === 1 ? "ayer" : `hace ${days} días`;
}

function leftText(item, now) {
  const left = trashDaysLeft(item, now);
  if (left <= 0) return "se borra hoy";
  return `se borra en ${left} ${left === 1 ? "día" : "días"}`;
}

function rowHtml(item, { isAdmin, now }) {
  const isProject = item.kind === "project";
  const icon = isProject ? projectBadgeHtml(item.project || {}) : `<span class="trash-row__icon" aria-hidden="true">📝</span>`;
  const title = isProject ? escapeHtml(item.title || "") : renderTitleHtml(item.title || "");
  const where = isProject
    ? `Proyecto · ${item.taskCount || 0} ${item.taskCount === 1 ? "tarea" : "tareas"}`
    : `Tarea${item.projectName ? ` · ${escapeHtml(item.projectName)}` : " · personal"}`;
  const who = isAdmin && item.deletedByName ? ` por ${escapeHtml(item.deletedByName)}` : "";
  return `
    <div class="trash-row" data-trash-id="${escapeHtml(item.id)}">
      ${icon}
      <div class="trash-row__main">
        <div class="trash-row__title">${title}</div>
        <div class="trash-row__meta">${where} · eliminado ${agoText(item, now)}${who} · ${leftText(item, now)}</div>
      </div>
      <div class="trash-row__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-restore>Restaurar</button>
        <button type="button" class="btn btn--danger btn--sm" data-purge>Eliminar para siempre</button>
      </div>
    </div>`;
}

/** Lo que se ve en la Papelera (sin lo caducado ni las tareas que se fueron dentro de un proyecto): para que el título de la barra superior cuente lo mismo que la vista. */
export function visibleTrashItems(items) {
  return topLevelTrashItems(items, new Date());
}

export function renderTrashView(container, { items, currentUser, onRestore, onPurge, onEmpty, now = new Date() }) {
  // `items` es null mientras la suscripción aún no ha contestado: mejor «Cargando» que un «vacía» que luego se rellena.
  if (!Array.isArray(items)) {
    container.innerHTML = `<div class="empty-state"><p>Cargando la papelera…</p></div>`;
    return;
  }
  const isAdmin = !!currentUser && currentUser.role === "admin";
  const rows = topLevelTrashItems(items, now);
  const scope = isAdmin ? "Como admin, ves lo que ha eliminado todo el equipo." : "Solo ves lo que has eliminado tú.";

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__eyebrow">— PAPELERA —</span>
        <h2>La papelera está vacía</h2>
        <p>Las tareas y los proyectos que elimines se guardan aquí ${TRASH_DAYS} días, por si te arrepientes. ${scope}</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="trash-view">
      <div class="trash-view__head">
        <p class="trash-view__intro">Lo que eliminas se guarda ${TRASH_DAYS} días; pasado ese tiempo se borra para siempre. ${scope}</p>
        <button type="button" class="btn btn--danger btn--sm" id="trash-empty">Vaciar papelera</button>
      </div>
      <div class="trash-list">${rows.map((item) => rowHtml(item, { isAdmin, now })).join("")}</div>
    </div>`;

  const itemOf = (el) => rows.find((i) => i.id === el.closest(".trash-row").dataset.trashId);

  container.querySelectorAll("[data-restore]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const item = itemOf(btn);
      if (!item) return;
      container.querySelectorAll(`[data-trash-id="${item.id}"] button`).forEach((b) => { b.disabled = true; });
      onRestore(item);
    })
  );

  container.querySelectorAll("[data-purge]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const item = itemOf(btn);
      if (!item) return;
      const name = item.kind === "project" ? item.title : String(item.title || "").replaceAll("**", "");
      const extra = item.kind === "project" ? " y sus tareas" : "";
      if (!confirm(`¿Eliminar «${name}»${extra} para siempre? No se podrá recuperar.`)) return;
      container.querySelectorAll(`[data-trash-id="${item.id}"] button`).forEach((b) => { b.disabled = true; });
      onPurge(item);
    })
  );

  container.querySelector("#trash-empty").addEventListener("click", () => {
    const n = rows.length;
    const whose = isAdmin ? "de todo el equipo" : "tuyos";
    if (!confirm(`¿Vaciar la papelera? Se borrarán para siempre ${n} ${n === 1 ? "elemento" : "elementos"} ${whose}. No se podrá recuperar.`)) return;
    onEmpty(rows);
  });
}
