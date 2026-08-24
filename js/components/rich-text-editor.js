// ============================================================================
// Editor de texto enriquecido para el campo "Descripción" de una tarea.
// Barra de herramientas + área editable (contenteditable) + menú de "/"
// para insertar bloques, al estilo del editor de Asana.
//
// Por dentro usa document.execCommand para negrita/cursiva/listas/citas —
// sí, está marcado como obsoleto en MDN, pero sigue soportado en todos
// los navegadores actuales y evita tener que reimplementar a mano un
// motor de edición de texto completo para un campo de descripción.
//
// El HTML que produce SIEMPRE se sanea (ver sanitizeHtml en utils.js)
// antes de avisar por onChange — cualquiera del equipo puede editar la
// descripción de cualquier tarea de proyecto, así que no basta con
// confiar en que el propio editor solo genere marcado "bueno".
// ============================================================================
import { escapeHtml, toEditableHtml, sanitizeHtml } from "../utils.js";

const SLASH_ITEMS = [
  { key: "p", label: "Párrafo", icon: "A≡", run: (ed) => ed.exec("formatBlock", "<p>") },
  { key: "h1", label: "Título 1", icon: "H1", run: (ed) => ed.exec("formatBlock", "<h1>") },
  { key: "h2", label: "Título 2", icon: "H2", run: (ed) => ed.exec("formatBlock", "<h2>") },
  { key: "h3", label: "Título 3", icon: "H3", run: (ed) => ed.exec("formatBlock", "<h3>") },
  { key: "ul", label: "Lista con viñetas", icon: "•", run: (ed) => ed.exec("insertUnorderedList") },
  { key: "ol", label: "Lista numerada", icon: "1.", run: (ed) => ed.exec("insertOrderedList") },
  { key: "quote", label: "Cita", icon: "❝", run: (ed) => ed.exec("formatBlock", "<blockquote>") },
  { key: "code", label: "Bloque de código", icon: "{ }", run: (ed) => ed.exec("formatBlock", "<pre>") },
];

const TOOLBAR_BUTTONS = [
  { cmd: "undo", title: "Deshacer", label: "↶" },
  { cmd: "redo", title: "Rehacer", label: "↷" },
  { divider: true },
  { cmd: "bold", title: "Negrita (Ctrl+B)", label: "<b>B</b>", state: "bold" },
  { cmd: "italic", title: "Cursiva (Ctrl+I)", label: "<i>I</i>", state: "italic" },
  { cmd: "underline", title: "Subrayado (Ctrl+U)", label: "<u>U</u>", state: "underline" },
  { cmd: "strikeThrough", title: "Tachado", label: "<s>S</s>", state: "strikeThrough" },
  { cmd: "removeFormat", title: "Limpiar formato", label: "⊘" },
  { divider: true },
  { cmd: "insertUnorderedList", title: "Lista con viñetas", label: "•", state: "insertUnorderedList" },
  { cmd: "insertOrderedList", title: "Lista numerada", label: "1.", state: "insertOrderedList" },
  { cmd: "quote", title: "Cita", label: "❝" },
  { divider: true },
  { cmd: "link", title: "Enlace", label: "🔗" },
  { cmd: "inlineCode", title: "Código en línea", label: "&lt;&gt;", mono: true },
  { cmd: "codeBlock", title: "Bloque de código", label: "{ }", mono: true },
];

/**
 * Monta el editor dentro de `mountEl` (se le añade como hijo) y devuelve
 * un pequeño controlador. `initialValue` puede ser texto plano (de antes
 * de tener editor enriquecido, o importado de Asana) o HTML ya generado
 * por este mismo editor — toEditableHtml() distingue entre los dos.
 */
export function createRichTextEditor(mountEl, { initialValue, placeholder, onChange }) {
  const root = document.createElement("div");
  root.className = "rte";
  root.innerHTML = `
    <div class="rte__toolbar">
      ${TOOLBAR_BUTTONS.map((b) =>
        b.divider
          ? `<span class="rte__divider"></span>`
          : `<button type="button" class="rte__btn${b.mono ? " rte__btn--mono" : ""}" data-cmd="${b.cmd}" title="${b.title}">${b.label}</button>`
      ).join("")}
    </div>
    <div class="rte__editor" contenteditable="true" data-placeholder="${escapeHtml(placeholder || "")}"></div>
  `;
  mountEl.appendChild(root);

  const editorEl = root.querySelector(".rte__editor");
  editorEl.innerHTML = toEditableHtml(initialValue);

  let slashMenuEl = null;
  let slashRange = null; // dónde borrar la "/" que abrió el menú, si se elige un bloque

  function exec(command, value = null) {
    editorEl.focus();
    document.execCommand(command, false, value);
    handleChange();
  }
  const editor = { exec }; // así SLASH_ITEMS puede llamar a ed.exec(...) sin cerrar más cosas sobre sí mismo

  function handleChange() {
    if (editorEl.innerHTML === "<br>") editorEl.innerHTML = ""; // para que vuelva a verse el placeholder
    updateToolbarState();
    if (onChange) onChange(sanitizeHtml(editorEl.innerHTML));
  }

  function updateToolbarState() {
    root.querySelectorAll(".rte__btn[data-cmd]").forEach((btn) => {
      const def = TOOLBAR_BUTTONS.find((b) => b.cmd === btn.dataset.cmd);
      if (!def || !def.state) return;
      let active = false;
      try { active = document.queryCommandState(def.state); } catch { active = false; }
      btn.classList.toggle("is-active", active);
    });
  }

  function toggleInlineCode() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const existing = startEl && startEl.closest && startEl.closest("code");
    if (existing && editorEl.contains(existing)) {
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
    } else {
      const code = document.createElement("code");
      try {
        range.surroundContents(code);
      } catch {
        code.textContent = range.toString();
        range.deleteContents();
        range.insertNode(code);
      }
    }
    handleChange();
  }

  function handleLink() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { alert("Selecciona antes el texto al que quieres ponerle un enlace."); return; }
    let url = prompt("URL del enlace:", "https://");
    if (!url) return;
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    exec("createLink", url);
  }

  // --------------------------------------------------------------------
  // Menú "/": aparece al escribir "/" como único carácter de la línea, o
  // al pulsar el botón "+". Reutiliza los mismos bloques del menú "Insertar" de Asana.
  // --------------------------------------------------------------------
  function openSlashMenu(anchorRect, range) {
    closeSlashMenu();
    slashRange = range;
    slashMenuEl = document.createElement("div");
    slashMenuEl.className = "rte__slash-menu";
    slashMenuEl.innerHTML = `
      <div class="rte__slash-menu__title">Insertar</div>
      ${SLASH_ITEMS.map((it) => `<button type="button" class="rte__slash-menu__item" data-key="${it.key}"><span class="rte__slash-menu__icon">${it.icon}</span>${it.label}</button>`).join("")}
    `;
    document.body.appendChild(slashMenuEl);
    const left = Math.min(anchorRect.left, window.innerWidth - slashMenuEl.offsetWidth - 12);
    const top = Math.min(anchorRect.bottom + 4, window.innerHeight - slashMenuEl.offsetHeight - 12);
    slashMenuEl.style.left = `${Math.max(8, left)}px`;
    slashMenuEl.style.top = `${Math.max(8, top)}px`;

    slashMenuEl.querySelectorAll("[data-key]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const item = SLASH_ITEMS.find((it) => it.key === btn.dataset.key);
        if (slashRange) {
          // borra la "/" que disparó el menú antes de aplicar el bloque
          const delRange = document.createRange();
          delRange.setStart(slashRange.startContainer, Math.max(0, slashRange.startOffset - 1));
          delRange.setEnd(slashRange.startContainer, slashRange.startOffset);
          delRange.deleteContents();
        }
        closeSlashMenu();
        item.run(editor);
      });
    });

    setTimeout(() => {
      document.addEventListener("mousedown", onOutsideSlash);
      document.addEventListener("keydown", onSlashKeydown, true);
    }, 0);
  }

  function closeSlashMenu() {
    if (!slashMenuEl) return;
    slashMenuEl.remove();
    slashMenuEl = null;
    slashRange = null;
    document.removeEventListener("mousedown", onOutsideSlash);
    document.removeEventListener("keydown", onSlashKeydown, true);
  }

  function onOutsideSlash(e) { if (slashMenuEl && !slashMenuEl.contains(e.target)) closeSlashMenu(); }
  function onSlashKeydown(e) { if (e.key === "Escape") { e.stopPropagation(); closeSlashMenu(); } }

  function checkSlashTrigger() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) { closeSlashMenu(); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || node.textContent.slice(0, range.startOffset) !== "/") {
      closeSlashMenu();
      return;
    }
    openSlashMenu(range.getBoundingClientRect(), range.cloneRange());
  }

  // --------------------------------------------------------------------
  editorEl.addEventListener("input", () => { handleChange(); checkSlashTrigger(); });
  editorEl.addEventListener("keyup", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") updateToolbarState(); });
  editorEl.addEventListener("mouseup", updateToolbarState);
  editorEl.addEventListener("focus", updateToolbarState);

  root.querySelectorAll(".rte__btn[data-cmd]").forEach((btn) => {
    // Sin este preventDefault, el navegador quita el foco (y la
    // selección de texto) del área editable en cuanto se pulsa el botón,
    // ANTES de que llegue el evento "click" — así que negrita/cursiva
    // se aplicarían sobre nada. Evitando el comportamiento por defecto
    // del mousedown, el editor conserva el foco y su selección.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd;
      if (cmd === "link") return handleLink();
      if (cmd === "inlineCode") { editorEl.focus(); return toggleInlineCode(); }
      if (cmd === "codeBlock") return exec("formatBlock", "<pre>");
      if (cmd === "quote") return exec("formatBlock", "<blockquote>");
      return exec(cmd);
    });
  });

  // Botón "+" al principio de la barra, para quien no sepa de la "/": abre el mismo menú de bloques.
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "rte__btn";
  insertBtn.title = "Insertar bloque";
  insertBtn.textContent = "+";
  root.querySelector(".rte__toolbar").prepend(insertBtn);
  insertBtn.addEventListener("mousedown", (e) => e.preventDefault());
  insertBtn.addEventListener("click", () => {
    editorEl.focus();
    const sel = window.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : insertBtn.getBoundingClientRect();
    const usableRect = rect.width || rect.height ? rect : insertBtn.getBoundingClientRect();
    openSlashMenu(usableRect, null); // null: este botón no ha escrito ninguna "/" que borrar
  });

  return {
    getHtml: () => sanitizeHtml(editorEl.innerHTML),
    focus: () => editorEl.focus(),
    destroy: () => { closeSlashMenu(); root.remove(); },
  };
}
