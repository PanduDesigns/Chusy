// ============================================================================
// Barra flotante de acciones masivas (selección múltiple al estilo Asana).
// La usan la vista de Lista y Mis tareas. Vive anclada dentro de .main-col
// — ver ".bulk-toolbar-anchor" en styles.css — así que sobrevive a que esas
// vistas reconstruyan el contenido de la tabla en cada render, y
// desaparece sola en cuanto la selección queda vacía.
//
// Quien llama (list-view.js o my-tasks-view.js) decide CUÁNDO mostrarla
// (según su propio `selection`, ver bulk-selection.js) y nos pasa ya
// resueltos los objetos de tarea seleccionados; este módulo solo pinta la
// barra y traduce cada botón en una llamada a data/tasks.js.
// ============================================================================
import { showToast, escapeHtml, initials, colorFromString, projectIcon } from "../utils.js";
import { openContextMenu } from "./context-menu.js";
import {
  bulkUpdateTasks,
  bulkMoveToSectionInProject,
  bulkSetComplete,
  bulkAddAssignees,
  bulkRemoveAssignees,
  bulkMoveToMyTasks,
  bulkDeleteTasks,
  mergeTasks,
} from "../data/tasks.js";
import { celebrateBulk } from "./celebration.js";

export function removeBulkToolbar() {
  document.querySelectorAll(".bulk-toolbar-anchor").forEach((a) => a.remove());
}

function ensureAnchor() {
  const mainCol = document.querySelector(".main-col");
  if (!mainCol) return null;
  let anchor = mainCol.querySelector(":scope > .bulk-toolbar-anchor");
  if (!anchor) {
    anchor = document.createElement("div");
    anchor.className = "bulk-toolbar-anchor";
    mainCol.appendChild(anchor);
  }
  return anchor;
}

/**
 * project: proyecto actual — solo cuando TODAS las tareas seleccionadas
 * pertenecen a uno solo, como en la vista de Lista. En "Mis tareas" la
 * selección puede mezclar tareas de varios proyectos distintos y
 * recordatorios personales a la vez, así que ahí se omite (undefined/null):
 * "Mover a otra sección" no tiene sentido sin un proyecto único de
 * referencia (las secciones son de un proyecto concreto) y se oculta del
 * todo, y "Cambiar de proyecto" deja de excluir "el proyecto actual" de la
 * lista (no hay uno) y ofrece todos.
 * projects: TODOS los proyectos del equipo (para "cambiar de proyecto").
 * currentUser: quien tiene la sesión abierta — para "Mover a mis tareas"
 * (se mueven a SUS tareas personales, no a las de quien estuviera
 * asignado antes).
 * onClearSelection: limpia el estado de selección en la vista que llama
 * (list-view.js o my-tasks-view.js) y vuelve a renderizar — las demás
 * acciones no lo necesitan porque, al escribir en Firestore, el listener
 * en tiempo real ya provoca un re-render que "poda" del propio estado las
 * tareas que dejan de encajar.
 */
export function renderBulkToolbar({ selectedTasks, teamMembers, project, projects, currentUser, onClearSelection }) {
  const anchor = ensureAnchor();
  if (!anchor) return;

  const ids = selectedTasks.map((t) => t.id);
  const n = ids.length;

  anchor.innerHTML = `
    <div class="bulk-toolbar" role="toolbar" aria-label="Acciones sobre la selección">
      <span class="bulk-toolbar__count">${n} ${n === 1 ? "tarea seleccionada" : "tareas seleccionadas"}</span>
      <span class="bulk-toolbar__divider"></span>
      ${project ? `<button type="button" class="bulk-toolbar__btn" data-action="move-section" title="Mover a otra sección">⇅</button>` : ""}
      <button type="button" class="bulk-toolbar__btn" data-action="change-project" title="Cambiar de proyecto">🗂</button>
      <button type="button" class="bulk-toolbar__btn" data-action="assign" title="Asignar a alguien">👤</button>
      <button type="button" class="bulk-toolbar__btn" data-action="dates" title="Establecer fechas">📅</button>
      <button type="button" class="bulk-toolbar__btn bulk-toolbar__btn--danger" data-action="delete" title="Eliminar">🗑</button>
      <button type="button" class="bulk-toolbar__btn" data-action="more" title="Más acciones">⋯</button>
      <span class="bulk-toolbar__divider"></span>
      <button type="button" class="bulk-toolbar__btn" data-action="clear" title="Deseleccionar todo">✕</button>
    </div>`;

  anchor.querySelector('[data-action="move-section"]')?.addEventListener("click", (e) => {
    const sections = [...(project.sections || [])].sort((a, b) => a.order - b.order);
    if (!sections.length) { showToast("Este proyecto no tiene secciones."); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: rect.left, y: rect.top,
      items: sections.map((s) => ({
        label: s.name,
        icon: "→",
        // Este proyecto puede ser el principal de unas tareas seleccionadas
        // y un adicional de otras (ver extraProjectIds) — bulkMoveToSectionInProject
        // ya distingue cuál toca por tarea, a diferencia de bulkUpdateTasks.
        onClick: () => runAction(bulkMoveToSectionInProject(selectedTasks, project.id, s.id), `Movidas a «${s.name}».`),
      })),
    });
  });

  anchor.querySelector('[data-action="change-project"]').addEventListener("click", (e) => {
    const others = project ? (projects || []).filter((p) => p.id !== project.id) : (projects || []);
    if (!others.length) { showToast("No hay proyectos a los que mover estas tareas."); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: rect.left, y: rect.top,
      items: others.map((p) => ({
        label: p.name,
        icon: projectIcon(p),
        onClick: () => {
          const firstSection = [...(p.sections || [])].sort((a, b) => a.order - b.order)[0];
          // "Cambiar de proyecto" es un traslado completo: deja a la tarea
          // en ESE proyecto y en ninguno más, quitando cualquier proyecto
          // adicional que tuviera (extraProjectIds/extraSections) — para
          // AÑADIR un proyecto sin perder los que ya tenía, se usa el
          // selector de proyectos del propio modal de la tarea.
          runAction(
            bulkUpdateTasks(ids, { projectId: p.id, sectionId: firstSection ? firstSection.id : null, extraProjectIds: [], extraSections: {} }),
            `Movidas a «${p.name}».`
          );
        },
      })),
    });
  });

  anchor.querySelector('[data-action="assign"]').addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: rect.left, y: rect.top,
      items: sortedMembers(teamMembers).map((m) => ({
        label: `${m.name}${m.isImported ? " · Asana" : ""}`,
        icon: "👤",
        onClick: () => runAction(bulkUpdateTasks(ids, { assigneeIds: [m.uid] }), `Asignadas a ${m.name}.`),
      })),
    });
  });

  anchor.querySelector('[data-action="dates"]').addEventListener("click", (e) => openDatesPopover(e.currentTarget, ids));
  anchor.querySelector('[data-action="delete"]').addEventListener("click", () => handleDelete(ids));
  anchor.querySelector('[data-action="more"]').addEventListener("click", (e) =>
    openMoreMenu(e.currentTarget, { ids, selectedTasks, teamMembers, currentUser })
  );
  anchor.querySelector('[data-action="clear"]').addEventListener("click", () => onClearSelection());
}

function sortedMembers(teamMembers) {
  // Igual que en el modal de tarea: a la hora de asignar, los usuarios
  // ficticios de Asana no se ofrecen como opción (si ya estaban
  // asignados a una tarea concreta se siguen viendo ahí, pero esto es
  // una acción masiva sobre varias tareas a la vez, así que no hay un
  // "ya asignado" único que pueda hacer de excepción).
  return (teamMembers || []).filter((m) => !m.isImported);
}

async function runAction(promise, successMsg) {
  try {
    await promise;
    if (successMsg) showToast(successMsg);
  } catch (err) {
    console.error(err);
    showToast("No se pudo aplicar el cambio. Inténtalo de nuevo.", "error");
  }
}

async function handleDelete(ids) {
  const n = ids.length;
  if (!confirm(`¿Eliminar ${n} ${n === 1 ? "tarea" : "tareas"}? No se puede deshacer.`)) return;
  try {
    const { succeededIds, failedIds } = await bulkDeleteTasks(ids);
    if (failedIds.length && succeededIds.length) {
      showToast(`Se eliminaron ${succeededIds.length} de ${n} tareas. El resto no se pudo borrar (sin permiso).`, "error");
    } else if (failedIds.length) {
      showToast("No se pudieron eliminar esas tareas (sin permiso).", "error");
    } else {
      showToast(`${succeededIds.length} ${succeededIds.length === 1 ? "tarea eliminada" : "tareas eliminadas"}.`);
    }
  } catch (err) {
    console.error(err);
    showToast("No se pudieron eliminar las tareas. Inténtalo de nuevo.", "error");
  }
}

function openMoreMenu(anchorBtn, { ids, selectedTasks, teamMembers, currentUser }) {
  const rect = anchorBtn.getBoundingClientRect();
  openContextMenu({
    x: rect.left, y: rect.top,
    items: [
      { label: "Marcar como completadas", icon: "✓", onClick: () => {
        runAction(bulkSetComplete(ids, true), "Marcadas como completadas.");
        celebrateBulk(ids.length); // la recompensa "grande" — varias de golpe
      } },
      { label: "Marcar como sin finalizar", icon: "↺", onClick: () => runAction(bulkSetComplete(ids, false), "Marcadas como sin finalizar.") },
      { label: "Agregar colaboradores…", icon: "+", onClick: () => openCollabPopover(rect, { ids, teamMembers }) },
      { label: "Combinar tareas duplicadas…", icon: "⧉", onClick: () => startMergeFlow(rect, { selectedTasks }) },
      { label: "Convertir en hitos", icon: "🚩", onClick: () => runAction(bulkUpdateTasks(ids, { isMilestone: true }), "Convertidas en hitos.") },
      { divider: true },
      { label: "Mover a mis tareas", icon: "🔒", onClick: () => handleMoveToMyTasks(ids, currentUser) },
    ],
  });
}

/**
 * Saca las tareas seleccionadas de este proyecto y las deja como tareas
 * personales de QUIEN EJECUTA la acción (no de quien tuvieran asignado
 * antes) — a partir de ahí solo esa persona las verá, en "Mis tareas". Se
 * avisa antes porque, a diferencia del resto de acciones masivas, esta
 * cambia quién puede ver la tarea, no solo un campo suyo.
 */
async function handleMoveToMyTasks(ids, currentUser) {
  const n = ids.length;
  const ok = confirm(
    `¿Mover ${n} ${n === 1 ? "tarea" : "tareas"} a tus tareas personales? ${n === 1 ? "Saldrá" : "Saldrán"} de este proyecto, dejará${n === 1 ? "" : "n"} de ser visible${n === 1 ? "" : "s"} para el resto del equipo, y quedará${n === 1 ? "" : "n"} asignada${n === 1 ? "" : "s"} solo a ti.`
  );
  if (!ok) return;
  runAction(
    bulkMoveToMyTasks(ids, currentUser.uid),
    `${n} ${n === 1 ? "tarea movida" : "tareas movidas"} a Mis tareas.`
  );
}

// ----------------------------------------------------------------------
// Popover de fechas: dos campos independientes, cada uno con su propia
// casilla — así se puede tocar solo el inicio, solo el límite, o ambos, y
// dejar el campo vacío significa "borrar esa fecha" en vez de "ignorarla".
// ----------------------------------------------------------------------
function openDatesPopover(anchorBtn, ids) {
  document.querySelectorAll(".bulk-date-popover").forEach((p) => p.remove());
  const rect = anchorBtn.getBoundingClientRect();

  const pop = document.createElement("div");
  pop.className = "bulk-date-popover";
  pop.innerHTML = `
    <label class="bulk-date-popover__row">
      <input type="checkbox" data-enable="startDate">
      <span class="bulk-date-popover__label">Inicio</span>
      <input type="date" class="field__input" data-field="startDate" disabled>
    </label>
    <label class="bulk-date-popover__row">
      <input type="checkbox" data-enable="dueDate">
      <span class="bulk-date-popover__label">Fecha límite</span>
      <input type="date" class="field__input" data-field="dueDate" disabled>
    </label>
    <p class="field__hint" style="margin:0;">Deja una fecha en blanco para borrarla.</p>
    <button type="button" class="btn btn--primary btn--sm" id="bulk-date-apply" style="align-self:flex-end;">Aplicar</button>`;
  document.body.appendChild(pop);

  const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12);
  const top = Math.max(8, rect.top - pop.offsetHeight - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${top}px`;

  pop.querySelectorAll("[data-enable]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const input = pop.querySelector(`[data-field="${cb.dataset.enable}"]`);
      input.disabled = !cb.checked;
      if (cb.checked) input.focus();
    });
  });

  pop.querySelector("#bulk-date-apply").addEventListener("click", () => {
    const data = {};
    pop.querySelectorAll("[data-enable]").forEach((cb) => {
      if (!cb.checked) return;
      const input = pop.querySelector(`[data-field="${cb.dataset.enable}"]`);
      data[cb.dataset.enable] = input.value || null;
    });
    close();
    if (Object.keys(data).length) runAction(bulkUpdateTasks(ids, data), "Fechas actualizadas.");
  });

  function close() {
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
    pop.remove();
  }
  function onOutside(e) { if (!pop.contains(e.target) && e.target !== anchorBtn) close(); }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  setTimeout(() => {
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}

// ----------------------------------------------------------------------
// Popover de colaboradores: casillas que se aplican al momento (igual que
// el popover de filtros), así que se puede marcar a varias personas
// seguidas sin cerrar y reabrir. Desmarcar quita a esa persona otra vez.
// ----------------------------------------------------------------------
function openCollabPopover(anchorRect, { ids, teamMembers }) {
  document.querySelectorAll(".bulk-collab-popover").forEach((p) => p.remove());

  const pop = document.createElement("div");
  pop.className = "bulk-collab-popover filter-popover";
  pop.innerHTML = `
    <div class="columns-menu__title">Añadir colaboradores</div>
    ${sortedMembers(teamMembers)
      .map(
        (m) => `
      <label class="filter-popover__item">
        <input type="checkbox" data-uid="${m.uid}">
        <span class="avatar avatar--sm" style="background:${colorFromString(m.uid)}">${initials(m.name)}</span>
        <span>${escapeHtml(m.name)}${m.isImported ? ` <span style="color:var(--color-text-faint);">· Asana</span>` : ""}</span>
      </label>`
      )
      .join("")}`;
  document.body.appendChild(pop);

  const left = Math.min(anchorRect.left, window.innerWidth - pop.offsetWidth - 12);
  const top = Math.max(8, anchorRect.top - pop.offsetHeight - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${top}px`;

  pop.querySelectorAll("[data-uid]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const uid = cb.dataset.uid;
      runAction(cb.checked ? bulkAddAssignees(ids, [uid]) : bulkRemoveAssignees(ids, [uid]));
    });
  });

  function close() {
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKeydown);
    pop.remove();
  }
  function onOutside(e) { if (!pop.contains(e.target)) close(); }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  setTimeout(() => {
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKeydown);
  }, 0);
}

// ----------------------------------------------------------------------
// Combinar duplicadas: primero se elige cuál de las seleccionadas
// sobrevive (las demás se fusionan dentro de ella), y se pide
// confirmación explícita antes de borrar nada.
// ----------------------------------------------------------------------
function startMergeFlow(anchorRect, { selectedTasks }) {
  if (selectedTasks.length < 2) {
    showToast("Selecciona al menos 2 tareas para combinarlas.");
    return;
  }
  openContextMenu({
    x: anchorRect.left, y: anchorRect.top,
    items: selectedTasks.map((t) => ({
      label: `Combinar en «${t.title}»`,
      icon: "⭐",
      onClick: () => confirmMerge(t, selectedTasks.filter((o) => o.id !== t.id)),
    })),
  });
}

async function confirmMerge(survivor, duplicates) {
  const total = duplicates.length + 1;
  const ok = confirm(
    `¿Combinar estas ${total} tareas en «${survivor.title}»? Se juntarán responsables, etiquetas, subtareas, adjuntos y comentarios en esa tarea, y las otras ${duplicates.length} se eliminarán. No se puede deshacer.`
  );
  if (!ok) return;
  try {
    const result = await mergeTasks(survivor.id, duplicates.map((d) => d.id));
    const skippedNote = result.skippedComments
      ? ` (${result.skippedComments} ${result.skippedComments === 1 ? "comentario no se pudo trasladar" : "comentarios no se pudieron trasladar"} por permisos.)`
      : "";
    showToast(`${result.mergedCount} ${result.mergedCount === 1 ? "tarea combinada" : "tareas combinadas"} en «${survivor.title}».${skippedNote}`);
  } catch (err) {
    console.error(err);
    showToast("No se pudieron combinar las tareas. Inténtalo de nuevo.", "error");
  }
}
