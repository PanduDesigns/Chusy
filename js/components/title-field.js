// ============================================================================
// Campo de título multilínea (v80) — lo usa el modal de tarea/oferta
// (task-modal.js). Antes era un <input type="text">: con un título largo el
// texto quedaba oculto por el lado y, para poner el cursor a la mitad, había
// que pinchar y arrastrar hasta el borde. Ahora es un <textarea rows="1"> que
// CRECE con el contenido (el título se ve entero, en 2 o más líneas) y en el
// que se puede pinchar directamente en cualquier palabra.
//
// Sigue siendo un título de UNA línea lógica: nunca guarda saltos de línea.
//   · Enter (sin Shift) confirma y sale del campo (blur) en vez de partir la
//     línea; Shift+Enter tampoco inserta nada (un título no lleva saltos);
//   · al pegar, los saltos de línea pasan a espacios;
//   · si se cuela algún otro (arrastrar texto, un teclado raro), se limpian
//     al momento sin mover el cursor.
// Ctrl/Cmd+B (negrita) lo conecta quien lo usa con `onBold`.
// ============================================================================

/** El texto como título: cada grupo de saltos de línea (con los espacios que lo rodean) pasa a UN espacio. */
export function normalizeTitleText(value) {
  return String(value ?? "").replace(/[ \t]*[\r\n\u2028\u2029]+[ \t]*/g, " ");
}

/** Ajusta el alto de un textarea a su contenido (sin barra de desplazamiento mientras quepa). */
export function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  const h = el.scrollHeight;
  if (h) el.style.height = `${h}px`; // en un entorno sin maquetar (pruebas) scrollHeight es 0: se deja el alto automático
}

/**
 * Conecta el textarea del título. `onInput(value)` recibe el valor ya limpio
 * cada vez que cambia; `onBold()` se llama con Ctrl/Cmd+B. Devuelve
 * `{ resize, destroy }`: `resize()` se llama cuando cambia el valor por
 * código (p. ej. al poner negrita) o cuando el modal ya está en pantalla.
 */
export function wireTitleField(el, { onInput, onBold } = {}) {
  const resize = () => autoResizeTextarea(el);

  /** Cambia el valor sin perder el cursor y avisa. */
  const setClean = (next) => {
    if (el.value === next) return false;
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos);
    el.value = next;
    const caret = normalizeTitleText(before).length;
    try { el.setSelectionRange(caret, caret); } catch { /* sin foco/selección */ }
    return true;
  };

  const handleInput = () => {
    setClean(normalizeTitleText(el.value));
    resize();
    if (onInput) onInput(el.value);
  };

  const handleKeydown = (e) => {
    if (e.isComposing) return; // Enter que confirma una composición (IME) no es «salir del campo»
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "b") {
      e.preventDefault();
      if (onBold) onBold();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault(); // nunca inserta un salto de línea
      if (!e.shiftKey) el.blur();
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData("text") : null;
    if (text == null) return; // sin acceso al portapapeles: lo limpia handleInput después
    e.preventDefault();
    const clean = normalizeTitleText(text);
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + clean + el.value.slice(end);
    const caret = start + clean.length;
    try { el.setSelectionRange(caret, caret); } catch { /* sin selección */ }
    handleInput();
  };

  el.addEventListener("input", handleInput);
  el.addEventListener("keydown", handleKeydown);
  el.addEventListener("paste", handlePaste);
  // El ancho cambia al girar el móvil o redimensionar la ventana: el alto se recalcula.
  window.addEventListener("resize", resize);
  resize();

  return {
    resize,
    destroy() {
      el.removeEventListener("input", handleInput);
      el.removeEventListener("keydown", handleKeydown);
      el.removeEventListener("paste", handlePaste);
      window.removeEventListener("resize", resize);
    },
  };
}
