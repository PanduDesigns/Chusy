// ============================================================================
// Panel de métricas — apuntado en el apartado 6 del README como mejora a
// futuro ("completadas, vencidas, carga por persona"), ahora hecho
// realidad. Solo para administradores por ahora (la barra lateral no
// muestra el enlace a nadie más, ver sidebar.js — es una limitación de
// interfaz, no de las reglas de Firestore: los datos en sí ya eran
// legibles para todo el equipo, ver el aviso de más abajo).
//
// A propósito, solo cuenta tareas DE PROYECTO, nunca las personales de
// "Mis tareas" de cada quien: esas son privadas por diseño (solo las ve su
// dueño/a y quien conste como responsable, ver firestore.rules), así que
// ni siquiera un admin puede reunirlas todas de golpe sin romper ese
// límite — quien llama a renderMetricsView() (app.js) ya se encarga de
// pasar solo tareas de proyecto.
// ============================================================================
import { escapeHtml, toDate, initials, colorFromString, textColorFor, projectIcon, isOverdue, renderTitleHtml } from "../utils.js";

export function renderMetricsView(container, { tasks, teamMembers, projects, onOpenTask }) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.isComplete);
  const pending = total - completed.length;
  const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.isComplete));
  const completedPct = total ? Math.round((completed.length / total) * 100) : 0;

  // Carga por persona: tareas ACTIVAS (sin completar) que tiene asignadas
  // cada quien ahora mismo — no un histórico, una foto de "quién anda más
  // cargado/a hoy". Solo entran personas con al menos 1, de más a menos.
  const activeTasks = tasks.filter((t) => !t.isComplete);
  const loadByPerson = teamMembers
    .map((m) => ({ member: m, count: activeTasks.filter((t) => t.assigneeIds && t.assigneeIds.includes(m.uid)).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxLoad = loadByPerson.length ? loadByPerson[0].count : 1;

  const overdueSorted = [...overdue].sort((a, b) => toDate(a.dueDate) - toDate(b.dueDate)); // más antigua primero

  if (!total) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__eyebrow">— MÉTRICAS —</span>
        <h2>Todavía no hay tareas de proyecto</h2>
        <p>En cuanto haya tareas en algún proyecto, aquí aparecerá el resumen de completadas, vencidas y carga por persona.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="metrics">
      <div class="metrics__cards">
        <div class="metric-card">
          <span class="metric-card__value">${total}</span>
          <span class="metric-card__label">Tareas de proyecto</span>
        </div>
        <div class="metric-card">
          <span class="metric-card__value" style="color:var(--color-success);">${completed.length}</span>
          <span class="metric-card__label">Completadas · ${completedPct}%</span>
        </div>
        <div class="metric-card">
          <span class="metric-card__value">${pending}</span>
          <span class="metric-card__label">Pendientes</span>
        </div>
        <div class="metric-card">
          <span class="metric-card__value" style="color:${overdue.length ? "var(--color-danger)" : "inherit"};">${overdue.length}</span>
          <span class="metric-card__label">Vencidas</span>
        </div>
      </div>

      <div class="metrics__section">
        <h3 class="metrics__section-title">Carga por persona</h3>
        <p class="metrics__section-hint">Tareas de proyecto activas (sin completar) asignadas a cada quien ahora mismo.</p>
        ${loadByPerson.length
          ? `<div class="metrics__bars">${loadByPerson
              .map(
                ({ member, count }) => `
              <div class="metric-bar-row">
                <span class="avatar avatar--sm" style="background:${colorFromString(member.uid)}">${initials(member.name)}</span>
                <span class="metric-bar-row__name">${escapeHtml(member.name)}</span>
                <div class="metric-bar-row__track"><div class="metric-bar-row__fill" style="width:${Math.max(4, Math.round((count / maxLoad) * 100))}%;"></div></div>
                <span class="metric-bar-row__count">${count}</span>
              </div>`
              )
              .join("")}</div>`
          : `<p class="metrics__empty">Nadie tiene tareas de proyecto activas asignadas ahora mismo.</p>`}
      </div>

      <div class="metrics__section">
        <h3 class="metrics__section-title">Tareas vencidas${overdueSorted.length ? ` <span class="metrics__section-count">${overdueSorted.length}</span>` : ""}</h3>
        <div class="metrics__overdue-list" id="metrics-overdue-list">
          ${overdueSorted.length ? "" : `<p class="metrics__empty">No hay ninguna tarea vencida — todo al día. 🎉</p>`}
        </div>
      </div>
    </div>
  `;

  if (overdueSorted.length) {
    const listEl = container.querySelector("#metrics-overdue-list");
    listEl.innerHTML = overdueSorted
      .map((t) => {
        const project = projects.find((p) => p.id === t.projectId);
        const assignees = (t.assigneeIds || []).map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
        const daysLate = Math.max(1, Math.round((Date.now() - toDate(t.dueDate).getTime()) / 86400000));
        return `
        <button type="button" class="metrics-overdue-row" data-open="${t.id}">
          <span class="metrics-overdue-row__title">${t.isMilestone ? "🚩 " : ""}${renderTitleHtml(t.title)}</span>
          ${project ? `<span class="tag-pill" style="background:${project.color};color:${textColorFor(project.color)};">${escapeHtml(projectIcon(project))} ${escapeHtml(project.name)}</span>` : ""}
          <span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("") || ""}</span>
          <span class="metrics-overdue-row__days">${daysLate} ${daysLate === 1 ? "día" : "días"} de retraso</span>
        </button>`;
      })
      .join("");
    listEl.querySelectorAll("[data-open]").forEach((row) => {
      row.addEventListener("click", () => onOpenTask(row.dataset.open));
    });
  }
}
