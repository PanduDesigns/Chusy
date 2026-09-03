// ============================================================================
// Vista de Lista: tabla con columnas (Nombre, Fecha límite, Responsables,
// Prioridad, Etiquetas y los campos personalizados del proyecto), agrupada
// por sección. Cada columna se puede pulsar para ordenar (alfabético /
// fecha / prioridad / valor del campo), con flecha indicando la dirección.
// Las columnas se pueden redimensionar arrastrando su borde derecho,
// reordenar arrastrando su cabecera (salvo "Nombre", que es fija) y
// ocultar/mostrar desde "Columnas". Ancho y ocultas son de cada persona en
// esta tabla; el orden es único por persona y se comparte con Mis tareas y
// el resto de proyectos (ver components/table-columns.js).
// ============================================================================
import { escapeHtml, formatDate, isOverdue, initials, colorFromString, textColorFor, showToast, setListHtml, getTaskSectionForProject, renderTitleHtml, plainTitleText } from "../utils.js";
import { toggleTaskComplete, duplicateTask, updateTask, deleteTask } from "../data/tasks.js";
import { celebrateTask } from "../components/celebration.js";
import { updateProject, saveProjectSections } from "../data/projects.js";
import { openContextMenu } from "../components/context-menu.js";
import { openCustomFieldsModal } from "../components/custom-fields-modal.js";
import { openSectionsModal } from "../components/sections-modal.js";
import { resolveColumns, columnHeaderCellsHtml, wireColumnResize, wireColumnReorder, openColumnsMenu } from "../components/table-columns.js";
import { createSelectionController } from "../components/bulk-selection.js";
import { renderBulkToolbar, removeBulkToolbar } from "../components/bulk-toolbar.js";

function tagPill(name, tagsRegistry) {
  const found = (tagsRegistry || []).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const color = found ? found.color : "#8B959C";
  return `<span class="tag-pill" style="background:${color};color:${textColorFor(color)};">${escapeHtml(name)}</span>`;
}

const BASE_COLUMNS = [
  { key: "title", label: "Nombre", defaultWidth: 260, minWidth: 160, locked: true },
  { key: "dueDate", label: "Fecha límite", defaultWidth: 88, minWidth: 70 },
  { key: "assignee", label: "Responsables", defaultWidth: 96, minWidth: 60 },
  { key: "priority", label: "Prioridad", defaultWidth: 80, minWidth: 64 },
  { key: "tags", label: "Etiquetas", defaultWidth: 160, minWidth: 90 },
];

// Selección múltiple: vive fuera de renderListView() para sobrevivir a que
// esta función se vuelva a llamar (cada cambio de filtro/orden, cada
// actualización en tiempo real de Firestore...) — ver bulk-selection.js.
const selection = createSelectionController();
let lastProjectId = null;

export function renderListView(container, opts) {
  const { project, tasks, teamMembers, tagsRegistry, sortState, onSortChange, onOpenTask, onAddTask, currentUser, projects } = opts;

  // Cambiar de proyecto invalida cualquier selección anterior (era de
  // tareas de OTRO proyecto, ya no tiene sentido arrastrarla).
  if (lastProjectId !== null && lastProjectId !== project.id) selection.clear();
  lastProjectId = project.id;
  selection.prune(tasks.map((t) => t.id));

  /** Vuelve a pintar esta misma vista con los mismos datos — para cuando
   * solo cambia la selección (Ctrl/Shift+clic, "✕"), sin esperar a que
   * llegue un dato nuevo de Firestore. */
  function rerenderSelf() { renderListView(container, opts); }

  const customCols = (project.customFieldDefs || []).map((f) => ({ key: `cf:${f.id}`, label: f.name, fieldId: f.id, defaultWidth: 120, minWidth: 70 }));
  const allColumns = [...BASE_COLUMNS, ...customCols];
  const scopeKey = `project:${project.id}`;
  const prefs = (currentUser.columnPrefs || {})[scopeKey];
  const { visible, gridTemplate, widthOf } = resolveColumns(allColumns, prefs, currentUser.columnOrder);

  const bySection = new Map(project.sections.map((s) => [s.id, []]));
  const noSectionTasks = [];
  tasks.forEach((t) => {
    // La sección de la tarea DENTRO de este proyecto en concreto: si este
    // proyecto es su principal, es t.sectionId de siempre; si lo tiene
    // como adicional (ver extraProjectIds), sale de t.extraSections — ver
    // getTaskSectionForProject en utils.js.
    const sid = getTaskSectionForProject(t, project.id);
    if (bySection.has(sid)) bySection.get(sid).push(t);
    else noSectionTasks.push(t); // sin sección, o de una sección ya eliminada
  });
  const sectionsSorted = [...project.sections].sort((a, b) => a.order - b.order);
  const orderedTaskIds = []; // orden real en pantalla, para Shift+clic (puede cruzar secciones)

  const headerHtml = `
    <div class="list-table__header" style="grid-template-columns:${gridTemplate};">
      ${columnHeaderCellsHtml(visible, widthOf, sortState)}
      <span></span>
    </div>`;

  /** Un bloque de sección real (con id) o el grupo especial "Sin sección"
   * (sectionId null) — misma pinta, pero éste no se puede eliminar ni
   * renombrar desde aquí (no es una sección de verdad, es solo dónde
   * "aparcan" las tareas que se quedan sin una al borrarla). */
  function sectionBlockHtml(sectionId, sectionName, sectionTasks) {
    const rows = sectionTasks
      .map((task) => {
        orderedTaskIds.push(task.id);
        const overdue = isOverdue(task.dueDate, task.isComplete);
        const assignees = task.assigneeIds.map((id) => teamMembers.find((m) => m.uid === id)).filter(Boolean);
        const cellsHtml = visible
          .map((col) => {
            if (col.key === "title") {
              return `
              <span class="list-row__title-cell">
                <span class="task-row__priority priority-${task.priority}${task.priority === "urgente" && !task.isComplete ? " is-pulse" : ""}"></span>
                <button class="task-row__check${task.isComplete ? " is-checked" : ""}" data-check="${task.id}">${task.isComplete ? "✓" : ""}</button>
                <span class="task-row__title" data-open="${task.id}">${task.isMilestone ? "🚩 " : ""}${renderTitleHtml(task.title)}</span>
              </span>`;
            }
            if (col.key === "dueDate") {
              return `<span class="list-table__cell-text${overdue ? " is-overdue" : ""}">${task.dueDate ? formatDate(task.dueDate) : "—"}</span>`;
            }
            if (col.key === "assignee") {
              return `<span class="avatar-stack">${assignees.map((m) => `<span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}" title="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join("") || `<span class="list-table__cell-text">—</span>`}</span>`;
            }
            if (col.key === "priority") {
              return `<span class="tag-pill" style="background:${priorityColor(task.priority)};color:${textColorFor(priorityColor(task.priority))};">${priorityLabel(task.priority)}</span>`;
            }
            if (col.key === "tags") {
              return task.tags && task.tags.length
                ? `<span class="list-table__tags-cell">${task.tags.map((t) => tagPill(t, tagsRegistry)).join("")}</span>`
                : `<span class="list-table__cell-text">—</span>`;
            }
            return `<span class="list-table__cell-text">${escapeHtml(task.customFields?.[col.fieldId] ?? "—")}</span>`;
          })
          .join("");
        return `
      <div class="list-row${task.isComplete ? " is-complete" : ""}${selection.has(task.id) ? " is-selected" : ""}" data-task-id="${task.id}" style="grid-template-columns:${gridTemplate};">
        ${cellsHtml}
        <span></span>
      </div>`;
      })
      .join("");

    return `
    <div class="section-block">
      <div class="section-header">
        <span class="section-header__name">${escapeHtml(sectionName)}</span>
        <span class="section-header__count">${sectionTasks.length}</span>
        <button class="section-header__add" data-add-section="${sectionId || ""}">+ Añadir tarea</button>
      </div>
      ${rows || `<p style="color:var(--color-text-faint);font-size:12.5px;padding:8px 10px;">Sin tareas en esta sección.</p>`}
    </div>`;
  }

  // "Sin sección" va PRIMERO, no al final: una tarea sin sección al fondo
  // de la lista es fácil de perder de vista y olvidar; arriba del todo, se
  // nota nada más entrar y anima a clasificarla en su sitio.
  const sectionsHtml =
    (noSectionTasks.length ? sectionBlockHtml(null, "Sin sección", noSectionTasks) : "") +
    sectionsSorted.map((section) => sectionBlockHtml(section.id, section.name, bySection.get(section.id) || [])).join("");

  setListHtml(container, `
    <div class="table-toolbar">
      <button type="button" class="btn btn--ghost btn--sm" id="btn-sections">🗂 Secciones</button>
      <button type="button" class="btn btn--ghost btn--sm" id="btn-columns">☰ Columnas</button>
      <button type="button" class="btn btn--ghost btn--sm" id="list-add-field">+ Campo personalizado</button>
    </div>
    <div class="list-table-scroll"><div class="list-table">${headerHtml}${sectionsHtml}</div></div>`);

  container.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSortChange(btn.dataset.sort));
  });
  container.querySelector("#list-add-field").addEventListener("click", () =>
    openCustomFieldsModal({
      title: "Campos personalizados",
      hint: "Se podrán rellenar en cada tarea de este proyecto y usarse como columna y como filtro.",
      fields: project.customFieldDefs,
      onSave: (defs) => updateProject(project.id, { customFieldDefs: defs }),
    })
  );
  container.querySelector("#btn-sections").addEventListener("click", () =>
    openSectionsModal({
      project,
      onSave: (sections) => saveProjectSections(project, sections),
    })
  );
  container.querySelector("#btn-columns").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openColumnsMenu({ x: rect.left, y: rect.bottom + 4, allColumns, order: currentUser.columnOrder, hidden: prefs?.hidden, scopeKey, currentUserUid: currentUser.uid });
  });
  wireColumnResize(container, { visible, widthOf, scopeKey, currentUserUid: currentUser.uid });
  wireColumnReorder(container, { allColumns, order: currentUser.columnOrder, currentUserUid: currentUser.uid });

  container.querySelectorAll("[data-check]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const task = tasks.find((t) => t.id === btn.dataset.check);
      const willComplete = !task.isComplete;
      toggleTaskComplete(task.id, willComplete);
      if (willComplete) celebrateTask(btn); // pequeña recompensa — solo al completar, no al desmarcar
    });
  });
  container.querySelectorAll("[data-open]").forEach((elx) => {
    elx.addEventListener("click", (e) => {
      // Con Ctrl/Cmd o Shift pulsados, el clic es para seleccionar (más
      // abajo, a nivel de fila) — no para abrir el detalle de la tarea.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      onOpenTask(elx.dataset.open);
    });
  });
  container.querySelectorAll("[data-add-section]").forEach((btn) => {
    btn.addEventListener("click", () => onAddTask(btn.dataset.addSection));
  });
  container.querySelectorAll(".list-row").forEach((row) => {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const task = tasks.find((t) => t.id === row.dataset.taskId);
      if (task) openTaskContextMenu(e.clientX, e.clientY, task, onOpenTask);
    });
    // Selección múltiple al estilo Asana: Ctrl/Cmd+clic añade o quita esa
    // tarea sola; Shift+clic selecciona todo el tramo desde la última
    // tocada. Un clic normal no toca la selección (solo abre la tarea, ver
    // el listener de [data-open] de arriba).
    row.addEventListener("click", (e) => {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
      if (e.target.closest("[data-check]")) return;
      e.preventDefault();
      const taskId = row.dataset.taskId;
      if (e.shiftKey) selection.selectRange(orderedTaskIds, taskId);
      else selection.toggle(taskId);
      rerenderSelf();
    });
  });

  syncBulkToolbar();

  function syncBulkToolbar() {
    const selectedTasks = tasks.filter((t) => selection.has(t.id));
    if (!selectedTasks.length) { removeBulkToolbar(); return; }
    renderBulkToolbar({
      selectedTasks,
      teamMembers,
      project,
      projects: projects || [],
      currentUser,
      onClearSelection: () => { selection.clear(); rerenderSelf(); },
    });
  }
}

const PRIORITY_COLORS = { urgente: "var(--color-danger)", alta: "var(--color-signal)", media: "#78848C", baja: "var(--color-text-faint)" };
const PRIORITY_LABELS = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
function priorityColor(p) { return PRIORITY_COLORS[p] || "var(--color-line-bright)"; }
function priorityLabel(p) { return PRIORITY_LABELS[p] || p; }

export function openTaskContextMenu(x, y, task, onOpenTask) {
  openContextMenu({
    x, y,
    items: [
      { label: task.isComplete ? "Marcar como pendiente" : "Marcar como completada", icon: "✓", onClick: () => toggleTaskComplete(task.id, !task.isComplete) },
      { label: "Duplicar tarea", icon: "⧉", onClick: async () => { await duplicateTask(task); showToast("Tarea duplicada."); } },
      { label: task.isMilestone ? "Quitar de hitos" : "Convertir en hito", icon: "🚩", onClick: () => updateTask(task.id, { isMilestone: !task.isMilestone }) },
      { label: "Abrir detalles", icon: "↗", onClick: () => onOpenTask(task.id) },
      { divider: true },
      { label: "Eliminar tarea", icon: "🗑", danger: true, onClick: () => {
        if (confirm(`¿Eliminar "${plainTitleText(task.title)}"? No se puede deshacer.`)) { deleteTask(task.id); showToast("Tarea eliminada."); }
      } },
    ],
  });
}
