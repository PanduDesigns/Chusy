// ============================================================================
// Modal «Novedades de Chusy» (v67): lista, versión a versión, lo que ha traído
// cada una (js/whats-new.js). Se abre desde la notificación de la campana (con
// las versiones que esa persona aún no había visto) y desde el menú del nombre
// → «Novedades de Chusy» (con todas).
// ============================================================================
import { el, escapeHtml } from "../utils.js";

function dateText(isoDay) {
  const d = new Date(`${isoDay}T12:00:00`);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function releaseHtml(release) {
  return `
    <section class="news-release">
      <div class="news-release__head">
        <span class="news-release__version">Versión ${release.id}</span>
        <span class="news-release__date">${escapeHtml(dateText(release.date))}</span>
      </div>
      <h4 class="news-release__title">${escapeHtml(release.title)}</h4>
      <ul class="news-release__items">${release.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>`;
}

export function openWhatsNewModal({ releases }) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  root.querySelectorAll(".news-modal").forEach((m) => m.closest(".modal-overlay")?.remove());

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal news-modal">
        <div class="modal__header">
          <h3 style="font-size:16px;">🆕 Novedades de Chusy</h3>
          <button class="modal__close" id="close">✕</button>
        </div>
        <div class="modal__body">
          ${releases.length ? releases.map(releaseHtml).join("") : `<p class="field__hint" style="margin:0;">Todavía no hay novedades que contar.</p>`}
        </div>
        <div class="modal__footer">
          <button class="btn btn--primary" id="done" style="margin-left:auto;">Entendido</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#done").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#done").focus();
}
