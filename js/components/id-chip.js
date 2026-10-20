// ============================================================================
// El ID de una oferta o de un proyecto (v70, ver project-codes.js) como una
// «pastilla» que se copia con un clic — la usan la ventana de la oferta
// (task-modal.js) y las «Propiedades» del proyecto (project-properties-modal.js).
// ============================================================================
import { escapeHtml, showToast } from "../utils.js";

/** `what`: «oferta» o «proyecto» — solo cambia el texto de ayuda de la pastilla. */
export function idChipHtml(code, what = "proyecto") {
  const c = escapeHtml(code);
  const owner = what === "oferta" ? "de la oferta" : "del proyecto";
  return `<button type="button" class="id-chip" data-copy-code="${c}" title="ID ${owner}: ${c} — clic para copiar">ID ${c}</button>`;
}

/** Lo que se enseña mientras todavía no hay ID (una oferta sin guardar, por ejemplo). */
export function idPendingHtml(text) {
  return `<span class="id-chip id-chip--pending">${escapeHtml(text)}</span>`;
}

/** Copia un texto al portapapeles; false si el navegador no lo permite. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (e2) {
      return false;
    }
  }
}

/** Engancha el clic de copiar a todas las pastillas de `root`. */
export function wireIdChips(root) {
  root.querySelectorAll("[data-copy-code]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = btn.dataset.copyCode;
      const ok = await copyText(code);
      showToast(ok ? `ID ${code} copiado.` : "No se pudo copiar el ID.", ok ? "info" : "error");
    });
  });
}
