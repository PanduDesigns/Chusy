// ============================================================================
// «Relevo inteligente» del flujo multietapa (v84).
//
// Al pulsar el círculo de completar de una tarea CON etapas (Lista, Mis tareas, menú de clic derecho, selección…):
//  · completar Diseño con etapas posteriores → micro-ventana de relevo hacia la etapa siguiente (responsable,
//    fechas; Compra/Pedido llega con 5 días laborables ya calculados con el calendario laboral y las ausencias
//    del comprador), y la tarea NO se completa: pasa a esa etapa y se avisa a su nuevo responsable;
//  · completar Compra/Pedido → lo mismo hacia Recepción/Fabricación (fecha prevista de recepción / fin de fabricación);
//  · completar la última etapa habilitada → la tarea queda completada;
//  · pulsar el círculo de una tarea completada → «Devolver a etapa anterior» (reabre la última etapa y le devuelve la
//    asignación a su responsable de antes).
// Una tarea sin etapas se completa/reabre exactamente como siempre (toggleTaskComplete).
//
// v86: al completar Compra/Pedido (relevo hacia Recepción/Fabricación) la ventana incluye además los tres datos de la
// compra —«Proveedor» (con las sugerencias de los ya usados), «Nº de pedido» y «Código Proveedor», precargados si ya estaban
// escritos— para rellenarlos o confirmarlos justo cuando se indica la fecha prevista de recepción. Salen en
// `handoff.purchase` y los guarda completeCurrentStage (workflow-stages.js) en la etapa de Compra/Pedido.
//
// Toda la decisión (qué toca hacer, qué fechas, qué parche) es pura y vive en js/workflow-stages.js; aquí solo hay
// ventana, escritura (data/tasks.js) y aviso (data/notifications.js).
// El modal de tarea (task-modal.js) usa solo `openStageHandoffDialog`: trabaja sobre su borrador y guarda con «Aceptar».
// ============================================================================
import { el, escapeHtml, showToast, renderTitleHtml } from "../utils.js";
import { toggleTaskComplete, advanceTaskStage, returnTaskStage } from "../data/tasks.js";
import { notifyNewAssignees } from "../data/notifications.js";
import { getOffersProject } from "../data/projects.js";
import { getWorkCalendar } from "../data/work-calendar.js";
import { describeDay, formatDayMonth, dateKey } from "../work-calendar.js";
import { planTaskCheck, taskWorkflow, planStageHandoff, updateStage, purchaseTrace, STAGE_LABELS, STAGE_SHORT, PURCHASE_DEFAULT_DAYS, PURCHASE_TRACE_MAX } from "../workflow-stages.js";
import { attachSupplierSuggest } from "./text-suggest.js";

const activeMembers = (members, keepUid) =>
  [...(members || [])]
    .filter((m) => m && m.uid && ((!m.isImported && !m.deleted) || m.uid === keepUid))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

/**
 * Ventana de relevo hacia la etapa `to`. Resuelve con { assigneeId, startDate, dueDate, note } al confirmar, o null al cancelar.
 *   workflow: el flujo de la tarea ahora mismo (para precargar responsable y fechas de la etapa `to`)
 *   from/to: claves de etapa; taskTitle: para titular la ventana; teamMembers; cfg (calendario); today (Date|string).
 */
export function openStageHandoffDialog({ workflow, from, to, taskTitle, teamMembers, cfg, today, projectName }) {
  const root = document.getElementById("modal-root");
  const calendar = cfg || getWorkCalendar();
  const plan0 = planStageHandoff(workflow, to, { today, cfg: calendar });
  const state = { assigneeId: plan0.assigneeId, startDate: plan0.startDate, dueDate: plan0.dueDate, touched: false };
  const members = activeMembers(teamMembers, state.assigneeId);
  const needsDue = to === "production";
  const showTrace = from === "purchase"; // v86: datos de la compra que se cierra
  const trace = showTrace ? purchaseTrace(workflow) : null;
  const hint =
    to === "purchase"
      ? `Plazo por defecto: ${PURCHASE_DEFAULT_DAYS} días laborables desde el inicio, según el calendario laboral y las ausencias del responsable.`
      : "Indica cuándo se prevé la recepción o el fin de la fabricación.";

  const overlay = el(`
    <div class="modal-overlay" data-stage-handoff>
      <div class="modal modal--sm stage-handoff" role="dialog" aria-modal="true" aria-label="Relevo de etapa">
        <div class="modal__header"><h3 class="modal__title">Relevo · ${escapeHtml(STAGE_SHORT[from])} → ${escapeHtml(STAGE_SHORT[to])}</h3><button class="modal__close" id="sh-close" type="button">✕</button></div>
        <div class="modal__body">
          <p class="stage-handoff__task">«${renderTitleHtml(taskTitle || "Tarea")}»${projectName ? ` <span class="stage-handoff__project">· ${escapeHtml(projectName)}</span>` : ""}</p>
          <p class="field__hint" style="margin:0;">${escapeHtml(STAGE_SHORT[from])} queda completada y la tarea pasa a <b>${escapeHtml(STAGE_LABELS[to])}</b>.</p>
          <label class="field">
            <span class="field__label">Responsable de ${escapeHtml(STAGE_LABELS[to])}</span>
            <select class="field__select" id="sh-who">
              <option value="">— Elige responsable —</option>
              ${members.map((m) => `<option value="${escapeHtml(m.uid)}"${m.uid === state.assigneeId ? " selected" : ""}>${escapeHtml(m.name || "Sin nombre")}</option>`).join("")}
            </select>
          </label>
          <div class="modal-row">
            <label class="field"><span class="field__label">Inicio</span><input class="field__input" type="date" id="sh-start" value="${escapeHtml(state.startDate || "")}"></label>
            <label class="field"><span class="field__label">${needsDue ? "Fecha prevista de recepción / fin de fabricación" : "Fecha fin"}</span><input class="field__input" type="date" id="sh-due" value="${escapeHtml(state.dueDate || "")}"></label>
          </div>
          <div class="sched-warn" id="sh-warn" role="status" aria-live="polite" hidden></div>
          <p class="field__hint" style="margin:0;">${escapeHtml(hint)}</p>
          ${showTrace ? `
          <div class="field stage-handoff__trace" data-handoff-trace>
            <span class="field__label">Datos del pedido</span>
            <div class="trace-grid">
              <label class="trace-grid__cell"><span class="trace-grid__label">Proveedor</span><input class="field__input" type="text" id="sh-supplier" maxlength="${PURCHASE_TRACE_MAX.supplier}" autocomplete="off" placeholder="Proveedor" value="${escapeHtml(trace.supplier)}"></label>
              <label class="trace-grid__cell"><span class="trace-grid__label">Nº de pedido</span><input class="field__input" type="text" id="sh-order" maxlength="${PURCHASE_TRACE_MAX.orderNumber}" autocomplete="off" placeholder="Nuestro nº de pedido" value="${escapeHtml(trace.orderNumber)}"></label>
              <label class="trace-grid__cell"><span class="trace-grid__label">Código Proveedor</span><input class="field__input" type="text" id="sh-supcode" maxlength="${PURCHASE_TRACE_MAX.supplierCode}" autocomplete="off" placeholder="Ref. del proveedor" value="${escapeHtml(trace.supplierCode)}"></label>
            </div>
          </div>` : ""}
          <label class="field"><span class="field__label">Nota de relevo (opcional)</span><textarea class="field__textarea" id="sh-note" style="min-height:48px;" placeholder="Qué necesita saber quien lo recibe"></textarea></label>
          <p class="stage-handoff__error" id="sh-error" role="alert" hidden></p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="sh-cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" id="sh-ok" type="button" style="margin-left:auto;">Confirmar relevo</button>
        </div>
      </div>
    </div>`);
  root.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);

  return new Promise((resolve) => {
    let closed = false;
    // v86: «Proveedor» sugiere los ya usados (se engancha antes de cualquier otro listener del campo, ver text-suggest.js).
    const supplierSuggest = showTrace && $("#sh-supplier") ? attachSupplierSuggest($("#sh-supplier")) : null;
    function finish(value) {
      if (closed) return;
      closed = true;
      if (supplierSuggest) supplierSuggest.destroy();
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    }
    function onKey(e) { if (e.key === "Escape") finish(null); }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
    $("#sh-close").addEventListener("click", () => finish(null));
    $("#sh-cancel").addEventListener("click", () => finish(null));

    function showWarn() {
      const box = $("#sh-warn");
      const due = state.dueDate;
      const day = due ? describeDay(due, calendar, state.assigneeId ? [state.assigneeId] : []) : null;
      if (!day || day.ok) { box.hidden = true; box.textContent = ""; return; }
      const why = day.holiday ? `festivo (${day.holiday.name})` : day.weekend ? "fin de semana" : "ausencia del responsable";
      box.textContent = `⚠️ El ${formatDayMonth(due)} cae en ${why}.`;
      box.hidden = false;
    }
    showWarn();

    $("#sh-who").addEventListener("change", (e) => {
      state.assigneeId = e.target.value || null;
      // Si nadie ha tocado las fechas, se recalculan con el calendario de la persona elegida (sus ausencias cuentan).
      if (!state.touched) {
        const p = planStageHandoff(updateStage(workflow, to, { assigneeId: state.assigneeId, startDate: null, dueDate: null }), to, { today, cfg: calendar });
        state.startDate = p.startDate;
        state.dueDate = p.dueDate;
        $("#sh-start").value = state.startDate || "";
        $("#sh-due").value = state.dueDate || "";
      }
      showWarn();
    });
    $("#sh-start").addEventListener("change", (e) => { state.startDate = dateKey(e.target.value); state.touched = true; showWarn(); });
    $("#sh-due").addEventListener("change", (e) => { state.dueDate = dateKey(e.target.value); state.touched = true; showWarn(); });

    $("#sh-ok").addEventListener("click", () => {
      const err = $("#sh-error");
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      if (!state.assigneeId) return fail(`Elige quién se encarga de ${STAGE_LABELS[to]}.`);
      if (needsDue && !state.dueDate) return fail("Indica la fecha prevista de recepción o fin de fabricación.");
      if (state.startDate && state.dueDate && state.dueDate < state.startDate) return fail("La fecha fin no puede ser anterior al inicio.");
      const result = { assigneeId: state.assigneeId, startDate: state.startDate || null, dueDate: state.dueDate || null, note: $("#sh-note").value.trim() };
      if (showTrace) result.purchase = { supplier: $("#sh-supplier").value, orderNumber: $("#sh-order").value, supplierCode: $("#sh-supcode").value };
      finish(result);
    });
    // Con responsable ya preasignado y fechas listas, un clic en «Confirmar» basta; el foco empieza en el botón.
    setTimeout(() => ($("#sh-ok") || {}).focus?.(), 0);
  });
}

const projectNameOf = (task, projects) => {
  const p = (projects || []).find((x) => x.id === task.projectId);
  return p ? p.name : null;
};

/**
 * Lo que hace el círculo de completar de una tarea (ver la cabecera del archivo).
 *   opts: { currentUser, teamMembers, projects, onFinish }
 * `onFinish()` se llama al COMPLETAR la tarea entera (para la animación de celebración): al pasar de una etapa a la
 * siguiente no se celebra. Devuelve { completed: boolean, cancelled?: true } y nunca lanza (avisa con un toast).
 */
export async function toggleTaskWithWorkflow(task, { currentUser, teamMembers, projects, onFinish } = {}) {
  const offers = getOffersProject();
  const plan = planTaskCheck(task, offers && offers.id);
  const fromUser = currentUser || { uid: null, name: "" };
  try {
    if (plan.kind === "legacy") {
      const willComplete = !task.isComplete;
      if (willComplete && onFinish) onFinish();
      await toggleTaskComplete(task, willComplete);
      return { completed: willComplete };
    }
    if (plan.kind === "finish") {
      if (onFinish) onFinish();
      await advanceTaskStage(task, { userId: fromUser.uid });
      return { completed: true };
    }
    if (plan.kind === "reopen") {
      const res = await returnTaskStage(task);
      if (res) {
        const stage = res.patch.workflow[res.reopenedKey];
        showToast(`Devuelta a ${STAGE_SHORT[res.reopenedKey]}.`);
        if (stage.assigneeId) {
          notifyNewAssignees({
            newAssigneeUids: [stage.assigneeId], taskId: task.id, taskTitle: task.title, projectId: task.projectId || null,
            projectName: projectNameOf(task, projects), fromUser, teamMembers, stageLabel: STAGE_LABELS[res.reopenedKey],
          }).catch((err) => console.error("notifyNewAssignees:", err));
        }
      }
      return { completed: false };
    }
    // handoff
    const wf = taskWorkflow(task, offers && offers.id);
    const handoff = await openStageHandoffDialog({
      workflow: wf, from: plan.from, to: plan.to, taskTitle: task.title, teamMembers, projectName: projectNameOf(task, projects),
    });
    if (!handoff) return { completed: false, cancelled: true };
    await advanceTaskStage(task, { userId: fromUser.uid, handoff });
    const who = (teamMembers || []).find((m) => m.uid === handoff.assigneeId);
    showToast(`${STAGE_SHORT[plan.from]} completada · ahora en ${STAGE_SHORT[plan.to]}${who ? ` (${who.name})` : ""}.`);
    notifyNewAssignees({
      newAssigneeUids: [handoff.assigneeId], taskId: task.id, taskTitle: task.title, projectId: task.projectId || null,
      projectName: projectNameOf(task, projects), fromUser, teamMembers, stageLabel: STAGE_LABELS[plan.to],
    }).catch((err) => console.error("notifyNewAssignees:", err));
    return { completed: false };
  } catch (err) {
    console.error("toggleTaskWithWorkflow:", err);
    showToast("No se pudo actualizar la tarea. Inténtalo de nuevo.", "error");
    return { completed: false, error: true };
  }
}
