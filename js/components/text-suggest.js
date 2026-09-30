// ============================================================================
// Sugerencias al escribir (v57): engancha un desplegable a un <input
// type="text"> que propone, mientras se escribe, valores ya usados — para
// que el equipo tienda a escribir lo mismo siempre igual (el campo
// Comercial de las ofertas y de las propiedades de un proyecto) en vez de
// "Juan Pérez", "juan perez" y "J. Pérez" según quién lo rellene.
//
// Es un desplegable propio y no un <datalist> del navegador porque este
// último no respeta los temas claro/oscuro/clásico (sale con los colores
// del sistema) y cada navegador filtra a su manera. Aquí se filtra sin
// distinguir mayúsculas ni tildes, y los que EMPIEZAN por lo escrito van
// antes que los que solo lo contienen.
//
// Cómo se maneja: ↑/↓ recorren, Enter elige el marcado, Esc cierra solo el
// desplegable (sin cerrar de paso la ventana en la que esté el campo —
// por eso se corta la propagación), un clic elige, y ↓ en un campo vacío
// lo abre entero. NO se abre al entrar en el campo, solo al escribir.
//
// Ajuste automático: si al terminar de escribir el texto coincide con una
// opción ya existente salvo por mayúsculas, tildes o espacios ("juan
// perez"), se cambia por la forma de la lista ("Juan Pérez") — es el
// evento `change` del propio input (ver el orden de listeners abajo). Un
// texto que no se parece a ninguna opción se deja como esté, solo sin
// espacios sobrantes.
//
// Importante para quien lo use: engancharlo ANTES de añadir su propio
// listener de `change` al mismo input. Los listeners se ejecutan en el
// orden en que se registraron, y este necesita ajustar el valor primero
// para que el suyo ya lea el valor ajustado.
//
// El desplegable vive en <body> con posición fija (no dentro de la ventana
// modal), así que no lo recorta el scroll interno del modal; se cierra al
// hacer scroll o cambiar el tamaño de la ventana.
// ============================================================================
import { escapeHtml } from "../utils.js";
import { suggestionKey, cleanSuggestionText } from "../offers.js";

/**
 * @param {HTMLInputElement} input
 * @param {{ getOptions: () => string[] }} opts  `getOptions` se llama cada vez que hace falta (así ve siempre lo más reciente).
 * @returns {{ destroy: () => void }}
 */
export function attachTextSuggest(input, { getOptions }) {
  let list = null; // el desplegable, o null si está cerrado
  let matches = [];
  let active = -1;
  let picking = false; // true mientras se elige: evita que el `input` sintético reabra la lista

  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");

  function options() {
    try {
      return (getOptions && getOptions()) || [];
    } catch (e) {
      console.error("text-suggest:", e);
      return [];
    }
  }

  /** Opciones que encajan con lo escrito: primero las que empiezan por ello, luego las que lo contienen. */
  function findMatches() {
    const typed = cleanSuggestionText(input.value);
    const q = suggestionKey(typed);
    const starts = [];
    const contains = [];
    for (const option of options()) {
      if (option === typed) continue; // ya está escrito tal cual: no hace falta proponerlo
      const key = suggestionKey(option);
      if (!q || key.startsWith(q)) starts.push(option);
      else if (key.includes(q)) contains.push(option);
    }
    return [...starts, ...contains];
  }

  function open() {
    matches = findMatches();
    if (!matches.length || !input.isConnected) { close(); return; }
    render();
  }

  function render() {
    if (!list) {
      list = document.createElement("div");
      list.className = "text-suggest";
      list.setAttribute("role", "listbox");
      // mousedown y no click: así el input no llega a perder el foco (y con
      // él, este mismo desplegable) antes de que se registre la elección.
      list.addEventListener("mousedown", onListMouseDown);
      document.body.appendChild(list);
    }
    list.innerHTML = matches
      .map((m, i) => `<div class="text-suggest__item${i === active ? " is-active" : ""}" role="option" data-i="${i}">${escapeHtml(m)}</div>`)
      .join("");
    position();
    const activeEl = list.querySelector(".is-active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") activeEl.scrollIntoView({ block: "nearest" });
  }

  /** Debajo del campo; encima si abajo no cabe y arriba hay más sitio. */
  function position() {
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const height = Math.min(list.scrollHeight, 220);
    list.style.left = `${rect.left}px`;
    list.style.width = `${rect.width}px`;
    if (spaceBelow < height + 12 && rect.top > spaceBelow) {
      list.style.top = "";
      list.style.bottom = `${window.innerHeight - rect.top + 2}px`;
    } else {
      list.style.bottom = "";
      list.style.top = `${rect.bottom + 2}px`;
    }
  }

  function close() {
    if (list) {
      list.remove();
      list = null;
    }
    matches = [];
    active = -1;
  }

  function pick(value) {
    picking = true;
    input.value = value;
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    picking = false;
  }

  function onListMouseDown(e) {
    e.preventDefault(); // conserva el foco del input
    const item = e.target.closest ? e.target.closest(".text-suggest__item") : null;
    if (item) pick(matches[Number(item.dataset.i)]);
  }

  function onInput() {
    if (picking) return;
    active = -1;
    open();
  }

  function onKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!list) { active = -1; open(); }
      if (list) { active = (active + 1) % matches.length; render(); }
    } else if (e.key === "ArrowUp" && list) {
      e.preventDefault();
      active = active <= 0 ? matches.length - 1 : active - 1;
      render();
    } else if (e.key === "Enter" && list && active >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pick(matches[active]);
    } else if (e.key === "Escape" && list) {
      // Solo cierra el desplegable: sin esto la ventana que contiene el
      // campo también se cerraría con el mismo Esc.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  /** Al terminar de escribir: la forma de la lista si es "el mismo valor", o al menos sin espacios sobrantes. */
  function onChange() {
    const typed = cleanSuggestionText(input.value);
    if (!typed) return;
    const key = suggestionKey(typed);
    const canonical = options().find((o) => suggestionKey(o) === key);
    const finalValue = canonical || typed;
    if (finalValue !== input.value) input.value = finalValue;
  }

  function onBlur() { close(); }

  function onWindowChange(e) {
    if (list && !(e.target instanceof Node && list.contains(e.target))) close();
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("change", onChange);
  input.addEventListener("blur", onBlur);
  window.addEventListener("scroll", onWindowChange, true);
  window.addEventListener("resize", onWindowChange);

  return {
    destroy() {
      close();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      input.removeEventListener("change", onChange);
      input.removeEventListener("blur", onBlur);
      window.removeEventListener("scroll", onWindowChange, true);
      window.removeEventListener("resize", onWindowChange);
    },
  };
}
