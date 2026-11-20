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
// v93 · Corregir y quitar sugerencias. Con `field` ("commercial" | "supplier") cada sugerencia lleva a la derecha dos botones:
//   ✏️ «Corregir en todo Chusy»: pide el valor correcto y lo cambia por lotes en todas las tareas, ofertas y proyectos donde esté
//       el antiguo (data/suggest-edit.js), y en el campo que se está rellenando si lo llevaba; el valor erróneo deja de sugerirse solo.
//   🗑️ «Quitar sugerencia»: la oculta para esta persona (suggest-hygiene.js: localStorage por persona, que se purga sola cuando ya
//       no queda ningún registro con ese valor) y, si aún lo llevan registros, pregunta si también se vacía en ellos.
// Las sugerencias no se guardan: se recalculan con lo que está escrito ahora, así que corregir el último registro con un valor mal
// escrito lo quita del desplegable sin más.
//
// El desplegable vive en <body> con posición fija (no dentro de la ventana
// modal), así que no lo recorta el scroll interno del modal; se cierra al
// hacer scroll o cambiar el tamaño de la ventana.
// ============================================================================
import { escapeHtml, showToast } from "../utils.js";
import { suggestionKey, cleanSuggestionText } from "../offers.js";
import { visibleSuggestions, hideSuggestion, unhideSuggestion } from "../suggest-hygiene.js";
import { previewSuggestedFieldReplacement, replaceSuggestedFieldValueEverywhere } from "../data/suggest-edit.js";

// ----------------------------------------------------------------------------
// v86 · Registro de fuentes de sugerencias. El campo Comercial recibe su lista por parámetro (task-modal.js la
// pide a app.js), pero «Proveedor» se escribe en TRES sitios (modal de tarea, diálogo de relevo de Compra/Pedido y
// la vista «Pedidos») y ninguno tiene acceso al estado de app.js: app.js registra aquí UNA función por nombre
// (`setSuggestProvider("supplier", fn)`) y cada campo la pide con `attachSupplierSuggest(input)`. Un nombre sin
// registrar (o una función que falla) da una lista vacía: el campo funciona igual, solo sin sugerencias.
// ----------------------------------------------------------------------------
const providers = new Map();

/** Registra (o, con `null`, quita) la función que devuelve las sugerencias de `name`: `() => string[]`. */
export function setSuggestProvider(name, fn) {
  if (typeof fn === "function") providers.set(name, fn);
  else providers.delete(name);
}

// v93 · Quién es la persona (lo que se quita de las sugerencias es por persona): app.js registra `() => uid`.
let userProvider = () => null;
export function setSuggestUserProvider(fn) { userProvider = typeof fn === "function" ? fn : () => null; }
const currentUid = () => { try { return userProvider() || ""; } catch (e) { return ""; } };

/** Las sugerencias de `name` ahora mismo (siempre un array; vacío si no hay fuente registrada o falla). */
export function getSuggestOptions(name) {
  const fn = providers.get(name);
  if (!fn) return [];
  try {
    const list = fn();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error("text-suggest:", e);
    return [];
  }
}

/** El campo «Proveedor» con memoria: engancha `attachTextSuggest` a la fuente `supplier` (ver app.js, getSupplierOptions). */
export function attachSupplierSuggest(input) {
  return attachTextSuggest(input, { getOptions: () => getSuggestOptions("supplier"), field: "supplier" });
}

/**
 * @param {HTMLInputElement} input
 * @param {{ getOptions: () => string[], field?: "commercial" | "supplier" }} opts  `getOptions` se llama cada vez que hace falta (así ve
 *        siempre lo más reciente). `field` (v93) activa los botones ✏️ corregir en todo Chusy y 🗑️ quitar sugerencia.
 * @returns {{ destroy: () => void }}
 */
export function attachTextSuggest(input, { getOptions, field = null }) {
  let list = null; // el desplegable, o null si está cerrado
  let matches = [];
  let active = -1;
  let picking = false; // true mientras se elige: evita que el `input` sintético reabra la lista

  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");

  function options() {
    try {
      const raw = (getOptions && getOptions()) || [];
      return field ? visibleSuggestions(field, raw, currentUid()) : raw; // v93: sin las que esta persona quitó (y purga las que ya no existen)
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
    const actions = field
      ? `<span class="text-suggest__actions"><button type="button" class="text-suggest__act" data-act="edit" tabindex="-1" title="Corregir en todo Chusy" aria-label="Corregir en todo Chusy">✏️</button><button type="button" class="text-suggest__act" data-act="del" tabindex="-1" title="Quitar sugerencia" aria-label="Quitar sugerencia">🗑️</button></span>`
      : "";
    list.innerHTML = matches
      .map((m, i) => `<div class="text-suggest__item${i === active ? " is-active" : ""}${field ? " has-actions" : ""}" role="option" data-i="${i}"><span class="text-suggest__text">${escapeHtml(m)}</span>${actions}</div>`)
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
    if (!item) return;
    const value = matches[Number(item.dataset.i)];
    const act = e.target.closest ? e.target.closest("[data-act]") : null;
    if (act && field) {
      close();
      if (act.dataset.act === "edit") editSuggestion(value); else removeSuggestion(value);
      return;
    }
    pick(value);
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /** ✏️ El valor correcto se pide y se cambia en todos los registros; el campo que se está rellenando lo sigue si llevaba el antiguo. */
  async function editSuggestion(value) {
    const raw = window.prompt(`Corregir «${value}» en todo Chusy.\n\nEscribe el valor correcto: se cambiará en todas las tareas, ofertas y proyectos donde aparezca.`, value);
    if (raw === null) return;
    const next = cleanSuggestionText(raw);
    if (!next || next === value) return;
    try {
      const preview = await previewSuggestedFieldReplacement(field, value, next);
      const merge = options().some((o) => o !== value && suggestionKey(o) === suggestionKey(next));
      const msg = preview.count
        ? `«${value}» se cambiará por «${next}» en ${plural(preview.count, "registro", "registros")}${merge ? " (ya existía «" + next + "»: se unifican)" : ""}. ¿Continuar?`
        : `«${value}» no está en ningún registro que se pueda cambiar desde aquí. ¿Dejar de sugerirlo y usar «${next}»?`;
      if (!window.confirm(msg)) return;
      const done = await replaceSuggestedFieldValueEverywhere(field, value, next);
      unhideSuggestion(field, next, currentUid());
      // Hasta que llegan los cambios de Firestore, el valor erróneo no debe seguir saliendo.
      if (suggestionKey(value) !== suggestionKey(next)) hideSuggestion(field, value, currentUid());
      if (input.isConnected && suggestionKey(input.value) === suggestionKey(value)) {
        picking = true;
        input.value = next;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        picking = false;
      }
      showToast(done.failedProjects ? `Corregido en ${plural(done.count, "registro", "registros")}; ${plural(done.failedProjects, "proyecto no se pudo cambiar", "proyectos no se pudieron cambiar")}.` : `«${value}» corregido en ${plural(done.count, "registro", "registros")}.`);
    } catch (e) {
      console.error("text-suggest:", e);
      showToast("No se pudo corregir el valor.", "error");
    }
  }

  /** 🗑️ Deja de sugerirlo; si aún hay registros con ese valor, se pregunta si también se vacía en ellos. */
  async function removeSuggestion(value) {
    try {
      if (!window.confirm(`¿Quitar «${value}» de las sugerencias?`)) return;
      hideSuggestion(field, value, currentUid());
      const preview = await previewSuggestedFieldReplacement(field, value, "");
      if (preview.count && window.confirm(`«${value}» sigue escrito en ${plural(preview.count, "registro", "registros")}. ¿Vaciarlo también en ellos?`)) {
        const done = await replaceSuggestedFieldValueEverywhere(field, value, "");
        showToast(`«${value}» quitado de las sugerencias y vaciado en ${plural(done.count, "registro", "registros")}.`);
      } else {
        showToast(`«${value}» ya no se sugiere.`);
      }
    } catch (e) {
      console.error("text-suggest:", e);
      showToast("No se pudo quitar la sugerencia.", "error");
    }
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
    // v93: si alguien escribe a propósito un valor que había quitado de las sugerencias, vuelve a ser una opción válida.
    if (field && !canonical) unhideSuggestion(field, typed, currentUid());
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
