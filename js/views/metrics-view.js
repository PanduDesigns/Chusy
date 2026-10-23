// ============================================================================
// Panel de métricas — apuntado en el apartado 6 del README como mejora a
// futuro ("completadas, vencidas, carga por persona"), ahora hecho
// realidad. Para administradores y, desde la v54, también para el rol
// Revisor (la barra lateral no muestra el enlace a nadie más, ver
// sidebar.js — es una limitación de interfaz, no de las reglas de
// Firestore: los datos en sí ya eran legibles para todo el equipo,
// Revisor incluido, ver el aviso de más abajo).
//
// A propósito, solo cuenta tareas DE PROYECTO, nunca las personales de
// "Mis tareas" de cada quien: esas son privadas por diseño (solo las ve su
// dueño/a y quien conste como responsable, ver firestore.rules), así que
// ni siquiera un admin o Revisor puede reunirlas todas de golpe sin romper
// ese límite — quien llama a renderMetricsView() (app.js) ya se encarga de
// pasar solo tareas de proyecto.
//
// Alcance por departamento (v77, ver «Alcance de Métricas» en
// departments.js): un admin ve a toda la empresa y puede acotar con el
// selector de la cabecera; un Revisor solo ve a las personas de su
// departamento (o, mejor dicho, de su grupo de acceso) y nada más — ni sus
// barras de carga, ni sus tareas, ni los avatares de la lista de vencidas.
// El filtro se calcula AQUÍ a partir de `currentUser` (metricsScopeFor), no se
// fía de lo que pida quien llama: un Revisor no puede ampliar su alcance.
// Como en el resto de Métricas (v54), es un límite de interfaz, no de datos.
// ============================================================================
import { escapeHtml, toDate, initials, colorFromString, textColorFor, projectIcon, isOverdue, renderTitleHtml } from "../utils.js";
import { metricsScopeFor, metricsDepartmentOptions, memberMatchesDepartmentFilter, metricsFilterLabel } from "../departments.js";

/**
 * Deja solo lo que cae dentro de un filtro de departamento (ver departments.js):
 * las personas que lo cumplen y las tareas que tienen al menos a una de ellas
 * como responsable. Una tarea sin responsable no pertenece a nadie, así que
 * no entra en una vista acotada; una compartida entre dos departamentos cuenta
 * en los dos. Con el filtro «todos» (`""`) devuelve todo tal cual.
 */
export function scopeMetricsData({ tasks, teamMembers }, filter) {
  if (filter === "") return { tasks, members: teamMembers };
  const members = teamMembers.filter((m) => memberMatchesDepartmentFilter(m, filter));
  const ids = new Set(members.map((m) => m.uid));
  return { tasks: tasks.filter((t) => (t.assigneeIds || []).some((id) => ids.has(id))), members };
}

export function renderMetricsView(container, options) {
  const { tasks: allTasks, teamMembers: allMembers, projects, onOpenTask, currentUser, departmentFilter, onChangeDepartmentFilter } = options;
  const isAdmin = !!currentUser && currentUser.role === "admin";
  const filter = metricsScopeFor(currentUser, departmentFilter); // null = sin departamento: nadie
  const scoped = scopeMetricsData({ tasks: allTasks, teamMembers: allMembers }, filter);
  const tasks = scoped.tasks;
  const teamMembers = scoped.members; // a partir de aquí, solo personas dentro del alcance

  if (filter === null) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__eyebrow">— MÉTRICAS —</span>
        <h2>Tu cuenta no tiene departamento</h2>
        <p>Las métricas muestran a las personas de tu departamento. Pídele a un administrador que te asigne uno desde «Administrar equipo».</p>
      </div>`;
    return;
  }

  // Cabecera de departamento: selector para el admin; para el resto, una
  // etiqueta fija con el departamento que están viendo.
  const scopeLabel = metricsFilterLabel(filter);
  const toolbarHtml = isAdmin
    ? `<div class="metrics__toolbar">
        <label class="metrics__toolbar-label" for="metrics-department">Departamento</label>
        <select class="metrics__select" id="metrics-department">
          ${metricsDepartmentOptions().map((o) => `<option value="${o.value}"${o.value === filter ? " selected" : ""}>${o.indent ? "\u00A0\u00A0" : ""}${escapeHtml(o.label)}</option>`).join("")}
        </select>
        ${scopeLabel ? `<span class="metrics__toolbar-hint">Tareas con alguien de ${escapeHtml(scopeLabel)} como responsable. Las que no tienen responsable no cuentan.</span>` : ""}
      </div>`
    : `<div class="metrics__toolbar">
        <span class="metrics__toolbar-label">Departamento</span>
        <span class="metrics__scope-chip">${escapeHtml(scopeLabel)}</span>
        <span class="metrics__toolbar-hint">Solo ves a las personas de tu departamento y las tareas que tienen asignadas.</span>
      </div>`;

  // Un admin que cambia el selector repinta solo esta vista (sin tocar la barra
  // lateral ni la superior) y avisa a app.js para que recuerde la elección.
  const wireToolbar = () => {
    const select = container.querySelector("#metrics-department");
    if (!select) return;
    select.addEventListener("change", () => {
      const value = select.value;
      if (onChangeDepartmentFilter) onChangeDepartmentFilter(value);
      renderMetricsView(container, { ...options, departmentFilter: value });
      const again = container.querySelector("#metrics-department");
      if (again) again.focus();
    });
  };

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
    const emptyHtml = scopeLabel
      ? `<div class="empty-state">
        <span class="empty-state__eyebrow">— MÉTRICAS —</span>
        <h2>Sin tareas para ${escapeHtml(scopeLabel)}</h2>
        <p>Ninguna tarea de proyecto tiene todavía como responsable a alguien de este departamento.</p>
      </div>`
      : `<div class="empty-state">
        <span class="empty-state__eyebrow">— MÉTRICAS —</span>
        <h2>Todavía no hay tareas de proyecto</h2>
        <p>En cuanto haya tareas en algún proyecto, aquí aparecerá el resumen de completadas, vencidas y carga por persona.</p>
      </div>`;
    container.innerHTML = scopeLabel ? `<div class="metrics">${toolbarHtml}${emptyHtml}</div>` : emptyHtml;
    wireToolbar();
    return;
  }

  container.innerHTML = `
    <div class="metrics">
      ${toolbarHtml}
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
  wireToolbar();
}
