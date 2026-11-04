// ============================================================================
// Insignia de etapa (v84) para filas y tarjetas: «Diseño 1/3», «Compra/Pedido 2/3», «Recepción/Fab. 3/3» o solo
// «Diseño» si la tarea tiene una única etapa. Un color por fase (css/06-list-board.css, `.wf-badge--<etapa>`).
// Sin flujo, completada o sin etapa activa → cadena vacía.
// ============================================================================
import { escapeHtml } from "../utils.js";
import { getOffersProject } from "../data/projects.js";
import { taskStageBadge, taskWorkflow, STAGE_LABELS, STAGE_KEYS, stageStatus } from "../workflow-stages.js";

/** HTML de la insignia de la etapa activa de `task` (o ""). */
export function stageBadgeHtml(task) {
  const offers = getOffersProject();
  const badge = taskStageBadge(task, offers && offers.id);
  if (!badge) return "";
  const wf = taskWorkflow(task, offers && offers.id);
  const chain = STAGE_KEYS.filter((k) => stageStatus(wf, k) !== "off")
    .map((k) => `${stageStatus(wf, k) === "done" ? "✓ " : stageStatus(wf, k) === "current" ? "▶ " : "· "}${STAGE_LABELS[k]}`)
    .join("\n");
  return `<span class="wf-badge wf-badge--${badge.key}" data-stage="${badge.key}" title="${escapeHtml(chain)}">${escapeHtml(badge.text)}</span>`;
}
