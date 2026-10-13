// ============================================================================
// El aviso con botón «Deshacer» (v67) que sale tras una acción de varias
// tareas (selección múltiple, clic derecho, «Convertir en oferta») o tras
// eliminar algo. Dura UNDO_SECONDS segundos; solo hay uno a la vez, así que se
// puede deshacer la ÚLTIMA acción — hacer otra acción deshacible cierra el
// aviso anterior (y con él la posibilidad de deshacer aquella).
//
// Dos formas de deshacer, según lo que hizo la acción:
//  - offerUndoForTasks: la acción CAMBIÓ campos de unas tareas (moverlas,
//    asignarlas, fechas, completarlas, convertirlas…). Se saca antes una foto
//    (takeTaskSnapshot, js/undo.js) y deshacer la vuelve a escribir.
//  - offerUndoForTrash: la acción ELIMINÓ (mandó a la papelera). Deshacer
//    restaura esos elementos de la papelera por su id.
// ============================================================================
import { showToast } from "../utils.js";
import { restoreTaskSnapshot } from "../data/tasks.js";
import { restoreTrashByIds } from "../data/trash.js";

export const UNDO_SECONDS = 10;

// El aviso que hay ahora en pantalla, o null: { el, timer }.
let active = null;

export function dismissUndoToast() {
  if (!active) return;
  clearTimeout(active.timer);
  active.el.remove();
  active = null;
}

/**
 * Enseña `message` con un botón «Deshacer». `onUndo` es asíncrona y devuelve el
 * texto que se enseña al terminar (o lanza un error: «No se pudo deshacer»).
 * El botón solo vale una vez.
 */
export function showUndoToast(message, onUndo, { seconds = UNDO_SECONDS } = {}) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  dismissUndoToast();
  const el = document.createElement("div");
  el.className = "toast toast--undo";
  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toast__action";
  button.textContent = "Deshacer";
  el.append(text, button);
  root.appendChild(el);

  button.addEventListener("click", async () => {
    if (!active || active.el !== el) return;
    dismissUndoToast();
    try {
      showToast(await onUndo());
    } catch (err) {
      console.error("Deshacer:", err);
      showToast("No se pudo deshacer. Inténtalo de nuevo.", "error");
    }
  });
  active = { el, timer: setTimeout(dismissUndoToast, seconds * 1000) };
}

/** Tras cambiar campos de unas tareas: `snapshot` es la foto de ANTES (takeTaskSnapshot). */
export function offerUndoForTasks(message, snapshot, options) {
  if (!snapshot || !snapshot.length) { showToast(message); return; }
  showUndoToast(
    message,
    async () => {
      const { restored, failed } = await restoreTaskSnapshot(snapshot);
      if (!restored) throw new Error("No se restauró ninguna tarea");
      return failed ? `Deshecho en ${restored} de ${restored + failed} tareas (el resto ya no existe o no se puede editar).` : "Deshecho.";
    },
    options
  );
}

/** El texto con el que se cuenta una restauración de la papelera (lo usa también la vista de la Papelera). */
export function trashRestoreMessage({ tasks = 0, projects = 0, projectTasks = 0, notes = [], failed = 0 }) {
  const parts = [];
  if (projects) parts.push(`${projects === 1 ? "Proyecto restaurado" : `${projects} proyectos restaurados`}${projectTasks ? ` con ${projectTasks} ${projectTasks === 1 ? "tarea" : "tareas"}` : ""}`);
  if (tasks) parts.push(tasks === 1 ? "Tarea restaurada" : `${tasks} tareas restauradas`);
  let text = parts.join(" · ") || "Nada que restaurar";
  const personal = notes.filter((n) => n === "personal").length;
  const section = notes.filter((n) => n === "section").length;
  if (personal) text += ` — ${personal === 1 ? "su proyecto ya no existe: queda como tarea personal" : `${personal} han quedado como tareas personales porque su proyecto ya no existe`}`;
  if (section) text += ` — ${section === 1 ? "su sección ya no existe: queda sin sección" : `${section} han quedado sin sección`}`;
  if (failed) text += ` (${failed} no se pudo${failed === 1 ? "" : "ieron"} restaurar)`;
  return `${text}.`;
}

/**
 * El aviso cuando no se pudo eliminar NADA. Casi siempre es falta de permiso
 * (solo puede quien creó la tarea/proyecto, su dueña o un admin); pero tras
 * actualizar Chusy también puede ser que aún no se hayan publicado las reglas
 * nuevas (la papelera necesita las de la v67) — el aviso lo apunta.
 * `kind`: "task" (por defecto) o "project".
 */
export function trashFailureMessage(errorCode, count = 1, kind = "task") {
  const what = kind === "project" ? "ese proyecto" : count === 1 ? "esa tarea" : "esas tareas";
  const verb = kind === "project" || count === 1 ? "pudo" : "pudieron";
  if (errorCode === "permission-denied") {
    return `No se ${verb} eliminar ${what} (sin permiso). Si acabas de actualizar Chusy, un admin debe publicar las reglas nuevas (README, apartado 1).`;
  }
  return `No se ${verb} eliminar ${what}. Inténtalo de nuevo.`;
}

/** Tras eliminar (mandar a la papelera): `trashIds` son los ids que devolvieron trashTasks/trashProject; `user`, quien deshace. */
export function offerUndoForTrash(message, trashIds, user, options) {
  if (!trashIds || !trashIds.length) { showToast(message); return; }
  showUndoToast(
    message,
    async () => {
      const summary = await restoreTrashByIds(trashIds, { user });
      if (!summary.tasks && !summary.projects) throw new Error("No se restauró nada");
      return trashRestoreMessage(summary);
    },
    options
  );
}
