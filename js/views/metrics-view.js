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
//
// v81 — Cuadro de mando pasivo (nadie imputa horas; ver flow-metrics.js):
//  · «Embudo de ofertas»: solo si la cuenta ve el proyecto Ofertas (admin o un
//    departamento con acceso, ya filtrado antes de llegar aquí). Son cifras de
//    la sección entera, no de personas, así que NO se acotan por departamento.
//  · «Salud del flujo»: cuánto llevan las tareas abiertas en su sección actual
//    (días hábiles, calendario laboral) y cuáles están estancadas (> 7 días
//    hábiles). Esta sí va por el alcance de departamento de arriba: solo las
//    tareas de las personas visibles. Un clic en una tarea la abre.
//  · Acceso a Métricas: admin, Revisor y, desde la v81, Responsables de
//    Departamento (canViewMetrics), siempre con su propio departamento.
// ============================================================================
import { escapeHtml, toDate, initials, colorFromString, textColorFor, projectIcon, isOverdue, renderTitleHtml } from "../utils.js";
import { offerFunnel, flowHealth } from "../flow-metrics.js";
import { isOffersProject } from "../offers.js";
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

const fmtDays = (n, unit = "días") => (n === null || n === undefined ? "—" : `${String(n).replace(".", ",")} ${unit}`);

/** HTML del panel «Embudo de ofertas» (`funnel`: ver offerFunnel); "" si no hay proyecto Ofertas. */
export function offerFunnelHtml(funnel) {
  if (!funnel) return "";
  if (!funnel.total) {
    return `<div class="metrics__section" id="metrics-offer-funnel">
        <h3 class="metrics__section-title">Embudo de ofertas</h3>
        <p class="metrics__empty">Todavía no hay ofertas.</p>
      </div>`;
  }
  const maxCount = Math.max(1, ...funnel.bySection.map((s) => s.count));
  return `
      <div class="metrics__section" id="metrics-offer-funnel">
        <h3 class="metrics__section-title">Embudo de ofertas <span class="metrics__section-count">${funnel.total}</span></h3>
        <p class="metrics__section-hint">Ofertas en curso, entregadas y convertidas en proyecto. La conversión es sobre las ya resueltas (entregadas + convertidas): una oferta en curso aún no ha tenido ocasión de convertirse.</p>
        <div class="metrics__cards">
          <div class="metric-card"><span class="metric-card__value">${funnel.active}</span><span class="metric-card__label">En curso</span></div>
          <div class="metric-card"><span class="metric-card__value">${funnel.delivered}</span><span class="metric-card__label">Entregadas, sin proyecto</span></div>
          <div class="metric-card"><span class="metric-card__value" style="color:var(--color-success);">${funnel.converted}</span><span class="metric-card__label">Convertidas en proyecto</span></div>
          <div class="metric-card"><span class="metric-card__value" data-funnel="pct">${funnel.conversionPct === null ? "—" : funnel.conversionPct + "%"}</span><span class="metric-card__label">Conversión (${funnel.converted} de ${funnel.resolved})</span></div>
          <div class="metric-card"><span class="metric-card__value" data-funnel="delivery">${fmtDays(funnel.avgDeliveryDays, "d")}</span><span class="metric-card__label">Tiempo medio hasta entregar</span></div>
          <div class="metric-card"><span class="metric-card__value" data-funnel="conversion">${fmtDays(funnel.avgConversionDays, "d")}</span><span class="metric-card__label">Tiempo medio hasta convertir</span></div>
        </div>
        <p class="metrics__section-hint" style="margin-top:16px;">Dónde está cada oferta ahora, por sección de Ofertas:</p>
        <div class="metrics__bars">${funnel.bySection
          .map(
            (s) => `
          <div class="metric-bar-row" data-funnel-section="${escapeHtml(s.id)}">
            <span class="metric-bar-row__name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
            <div class="metric-bar-row__track"><div class="metric-bar-row__fill" style="width:${s.count ? Math.max(4, Math.round((s.count / maxCount) * 100)) : 0}%;"></div></div>
            <span class="metric-bar-row__count">${s.count}</span>
          </div>`
          )
          .join("")}</div>
      </div>`;
}

const STAGNANT_LIST_LIMIT = 20;

/** HTML del panel «Salud del flujo y cuellos de botella» (`health`: ver flowHealth). `teamMembers`: para los avatares. */
export function flowHealthHtml(health, teamMembers) {
  if (!health.count) {
    return `<div class="metrics__section" id="metrics-flow-health">
        <h3 class="metrics__section-title">Salud del flujo y cuellos de botella</h3>
        <p class="metrics__empty">No hay tareas abiertas que medir.</p>
      </div>`;
  }
  const shown = health.stagnant.slice(0, STAGNANT_LIST_LIMIT);
  const more = health.stagnant.length - shown.length;
  return `
      <div class="metrics__section" id="metrics-flow-health">
        <h3 class="metrics__section-title">Salud del flujo y cuellos de botella</h3>
        <p class="metrics__section-hint">Cuánto llevan las tareas abiertas en su sección actual, en días hábiles (sin fines de semana ni festivos). Se mide desde que la tarea entró en la sección; las anteriores a esta medición usan su última modificación.</p>
        <div class="metrics__cards">
          <div class="metric-card"><span class="metric-card__value">${health.count}</span><span class="metric-card__label">Tareas abiertas</span></div>
          <div class="metric-card"><span class="metric-card__value" data-flow="avg">${fmtDays(health.avgDays, "d")}</span><span class="metric-card__label">Tiempo medio en su sección (hábiles)</span></div>
          <div class="metric-card"><span class="metric-card__value" data-flow="stagnant" style="color:${health.stagnant.length ? "var(--color-danger)" : "inherit"};">${health.stagnant.length}</span><span class="metric-card__label">Estancadas (más de ${health.threshold} días hábiles)</span></div>
        </div>
        <div class="metrics-flow-table" role="table" aria-label="Tiempo en cada sección">
          <div class="metrics-flow-table__row metrics-flow-table__row--head" role="row"><span role="columnheader">Sección</span><span role="columnheader">Abiertas</span><span role="columnheader">Media (d. hábiles)</span><span role="columnheader">Estancadas</span></div>
          ${health.bySection
            .map(
              (s) => `
          <div class="metrics-flow-table__row" role="row" data-flow-section="${escapeHtml(s.key)}">
            <span role="cell" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span><span role="cell">${s.count}</span><span role="cell">${fmtDays(s.avgDays, "")}</span><span role="cell" class="${s.stagnant ? "is-danger" : ""}">${s.stagnant}</span>
          </div>`
            )
            .join("")}
        </div>
        <h4 class="metrics__subtitle">Tareas estancadas${health.stagnant.length ? ` <span class="metrics__section-count">${health.stagnant.length}</span>` : ""}</h4>
        <div class="metrics__overdue-list" id="metrics-stagnant-list">
          ${shown.length
            ? shown
                .map(({ task: t, project, sectionName, days }) => {
                  const assignees = (t.assigneeIds || []).map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
                  return `
          <button type="button" class="metrics-overdue-row" data-open="${escapeHtml(t.id)}">
            <span class="metrics-overdue-row__title">${renderTitleHtml(t.title)}</span>
            ${project ? `<span class="tag-pill" style="background:${project.color};color:${textColorFor(project.color)};">${escapeHtml(projectIcon(project))} ${escapeHtml(project.name)}</span>` : ""}
            <span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("")}</span>
            <span class="metrics-overdue-row__days">${days} ${days === 1 ? "día hábil" : "días hábiles"} en «${escapeHtml(sectionName)}»</span>
          </button>`;
                })
                .join("") + (more > 0 ? `<p class="metrics__empty">…y ${more} más.</p>` : "")
            : `<p class="metrics__empty">Ninguna tarea lleva más de ${health.threshold} días hábiles en la misma sección. 👌</p>`}
        </div>
      </div>`;
}

export function renderMetricsView(container, options) {
  const { tasks: allTasks, teamMembers: allMembers, projects, onOpenTask, currentUser, departmentFilter, onChangeDepartmentFilter, workCalendar } = options;
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

  // v81: embudo de ofertas (sin acotar por departamento: es de la sección entera, y solo si se ve Ofertas) y salud del flujo (acotada).
  const offersProject = (projects || []).find((p) => isOffersProject(p)) || null;
  const funnel = offersProject ? offerFunnel({ tasks: allTasks, offersProject }) : null;
  const health = flowHealth({ tasks, projects: projects || [], cfg: workCalendar, now: new Date() });

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
      ${flowHealthHtml(health, teamMembers)}
      ${offerFunnelHtml(funnel)}
    </div>
  `;
  container.querySelectorAll("#metrics-stagnant-list [data-open]").forEach((row) => {
    row.addEventListener("click", () => onOpenTask(row.dataset.open));
  });

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
