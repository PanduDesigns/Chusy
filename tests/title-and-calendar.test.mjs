// v80 — puntos 2 a 5: scroll del Calendario laboral (CSS), festivos oficiales de CLM/Albacete (lógica pura),
// «Vista previa» sin solaparse con la línea de la cabecera (CSS + DOM) y título multilínea (comportamiento real
// del campo en jsdom + comprobaciones sobre el modal de tarea/oferta).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom } from "./support/dom.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const css = read("css/07-modals.css");
const taskModal = read("js/components/task-modal.js");
const rule = (selector) => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};

// ------------------------------------------------------------ 2) scroll de las listas del Calendario laboral
const list = rule(".wc-list");
check("`.wc-list` hace scroll vertical (overflow-y: auto)", /overflow-y:\s*auto/.test(list), list);
check("`.wc-list` ya no recorta con overflow: hidden", !/overflow:\s*hidden/.test(list), list);
check("`.wc-list` tiene min-height: 0 y un max-height", /min-height:\s*0/.test(list) && /max-height:/.test(list), list);
const body = rule(".wc-body");
check("el cuerpo del modal no se desplaza (overflow: hidden): año y formulario siempre a la vista", /overflow:\s*hidden/.test(body), body);
check("los hijos fijos del cuerpo no se encogen (flex-shrink: 0)", /\.wc-body > \*\s*\{\s*flex-shrink:\s*0/.test(css));
check("la lista sí se puede encoger dentro del cuerpo", /\.wc-body > \.wc-list\s*\{\s*flex-shrink:\s*1/.test(css));
const wcModal = read("js/components/work-calendar-modal.js");
check("la lista de festivos y la de ausencias usan la misma clase `.wc-list`", (wcModal.match(/<ul class=\\?"wc-list\\?">/g) || []).length === 2);

// ------------------------------------------------------------ 3) festivos oficiales
const wc = await import("../js/work-calendar.js");
const keyOf = (list, mmdd) => list.find((h) => h.date.endsWith(mmdd));
const y26 = wc.officialHolidays(2026);
eq("2026: Jueves Santo 02/04 (autonómico)", [keyOf(y26, "-04-02").name, keyOf(y26, "-04-02").scope], ["Jueves Santo", "autonomico"]);
eq("2026: Viernes Santo 03/04 (nacional)", [keyOf(y26, "-04-03").name, keyOf(y26, "-04-03").scope], ["Viernes Santo", "nacional"]);
eq("2026: Corpus Christi 04/06", keyOf(y26, "-06-04").name, "Corpus Christi");
eq("2026: San Juan Bautista 24/06 (local)", [keyOf(y26, "-06-24").name, keyOf(y26, "-06-24").scope], ["San Juan Bautista", "local"]);
eq("2026: Virgen de Los Llanos 08/09 (local)", [keyOf(y26, "-09-08").name, keyOf(y26, "-09-08").scope], ["Virgen de Los Llanos", "local"]);
eq("2026: Todos los Santos pasa al 02/11 (el 01/11 es domingo)", keyOf(y26, "-11-02").name, "Todos los Santos (trasladado)");
for (const d of ["-01-01", "-01-06", "-05-01", "-08-15", "-10-12", "-12-08", "-12-25"]) check(`2026 lleva ${d}`, !!keyOf(y26, d));
// Decreto 44/2025 (DOCM 26/06/2025): el 06/04/2026 SÍ es festivo en Castilla-La Mancha (sustituye al 19/03). Se conserva.
check("2026 conserva el Lunes de Pascua 06/04 porque el Decreto 44/2025 lo declara festivo en Castilla-La Mancha", !!keyOf(y26, "-04-06"));
check("2026 no tiene 31/05 (domingo, no se traslada) ni 07/12 (lo sustituye el Corpus)", !keyOf(y26, "-05-31") && !keyOf(y26, "-12-07"));
eq("2026: 14 días con los dos locales", y26.length, 14);

// Corpus Christi = jueves, 60 días después del Domingo de Resurrección
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
eq("Corpus 2026 = 04/06", ymd(wc.corpusChristi(2026)), "2026-06-04");
eq("Corpus 2027 = 27/05", ymd(wc.corpusChristi(2027)), "2027-05-27");
eq("Corpus 2028 = 15/06", ymd(wc.corpusChristi(2028)), "2028-06-15");
check("Corpus siempre cae en jueves (2024-2040)", Array.from({ length: 17 }, (_, i) => wc.corpusChristi(2024 + i).getDay()).every((d) => d === 4));
eq("Domingo de Pascua 2026 = 05/04", ymd(wc.easterSunday(2026)), "2026-04-05");

// Año sin decreto cargado → estimación dinámica
const y28 = wc.officialHolidays(2028);
const names28 = y28.map((h) => h.name.replace(" (estimado)", ""));
for (const n of ["Año Nuevo", "Epifanía del Señor", "Jueves Santo", "Viernes Santo", "Fiesta del Trabajo", "Corpus Christi", "Día de Castilla-La Mancha", "San Juan Bautista", "Asunción de la Virgen", "Virgen de Los Llanos", "Fiesta Nacional de España", "Todos los Santos", "Día de la Constitución", "Inmaculada Concepción", "Navidad"]) {
  check(`2028 (estimado) incluye «${n}»`, names28.includes(n), names28);
}
check("2028 (estimado) NO incluye el Lunes de Pascua", !names28.some((n) => /Lunes de Pascua/.test(n)));
check("todo lo estimado va marcado «(estimado)»", y28.every((h) => /\(estimado\)$/.test(h.name)));
eq("2028: Jueves Santo 13/04 y Viernes Santo 14/04", [keyOf(y28, "-04-13").name.slice(0, 12), keyOf(y28, "-04-14").name.slice(0, 13)], ["Jueves Santo", "Viernes Santo"]);
eq("2028: Corpus 15/06 y Día de CLM 31/05", [!!keyOf(y28, "-06-15"), !!keyOf(y28, "-05-31")], [true, true]);
// Reglas de domingo (la estimación del año 2026 forzada: el 01/11 y el 06/12 son domingo)
const e26 = wc.estimatedHolidays(2026);
check("estimado: Todos los Santos 02/11 cuando el 01/11 cae en domingo", !!keyOf(e26, "-11-02") && !keyOf(e26, "-11-01"));
check("estimado: Constitución 07/12 cuando el 06/12 cae en domingo", !!keyOf(e26, "-12-07") && !keyOf(e26, "-12-06"));
const e28 = wc.estimatedHolidays(2028);
check("estimado: Todos los Santos 01/11 y Constitución 06/12 cuando no son domingo", !!keyOf(e28, "-11-01") && !!keyOf(e28, "-12-06"));
check("la semilla del año en curso y el siguiente no repite fechas dentro de un año", [2026, 2027, 2028, 2029].every((y) => { const l = wc.officialHolidays(y); return new Set(l.map((h) => h.date)).size === l.length; }));
eq("2029: el Corpus cae el 31/05 → un solo festivo con los dos nombres", wc.officialHolidays(2029).filter((h) => h.date === "2029-05-31").map((h) => h.name), ["Corpus Christi y Día de Castilla-La Mancha (estimado)"]);
check("mergeHolidays no duplica al volver a cargar (por fecha)", (() => { const a = wc.mergeHolidays(null, wc.officialHolidays(2028)); const b = wc.mergeHolidays(a.cfg, wc.officialHolidays(2028)); return b.added === 0 && b.skipped === a.added; })());

// ------------------------------------------------------------ 4) «Vista previa» y la línea de la cabecera
const head = rule(".modal__head");
check("la línea divisoria la lleva la envoltura `.modal__head`", /border-bottom:\s*1px solid/.test(head), head);
check("la cabecera de dentro ya no pinta la suya", /\.modal__head > \.modal__header\s*\{\s*border-bottom:\s*none/.test(css));
const preview = rule(".modal__title-preview");
check("la vista previa no lleva borde propio ni sube por debajo de la línea (margen superior negativo pequeño)", !/border-bottom/.test(preview) && /margin:\s*-4px 0 0/.test(preview), preview);
check("la vista previa deja aire antes de la línea (padding inferior ≥ 14px)", Number((preview.match(/padding:\s*0 24px (\d+)px/) || [])[1]) >= 14, preview);
check("task-modal.js pone cabecera y vista previa dentro de `.modal__head`", /<div class="modal__head">[\s\S]*<div class="modal__header[^"]*">[\s\S]*id="t-title-preview"><\/div>\s*<\/div>\s*<div class="modal__body">/.test(taskModal));

// ------------------------------------------------------------ 5) título multilínea
check("task-modal.js: el título es un <textarea rows=\"1\"> (ya no un <input>)", /<textarea class="modal__title-input" id="t-title" rows="1"/.test(taskModal) && !/<input class="modal__title-input"/.test(taskModal));
check("task-modal.js conecta wireTitleField y lo destruye al cerrar", /wireTitleField\(titleInput/.test(taskModal) && /titleField\.destroy\(\)/.test(taskModal));
const ta = rule("textarea.modal__title-input");
check("CSS del título: overflow-wrap: break-word y sin resize manual", /overflow-wrap:\s*break-word/.test(ta) && /resize:\s*none/.test(ta), ta);
check("oferta y tarea comparten este modal (no hay otro campo de título en offers.js)", !/modal__title-input|type="text"[^>]*title/i.test(read("js/offers.js")));

const dom = setupDom();
const { normalizeTitleText, autoResizeTextarea, wireTitleField } = await import("../js/components/title-field.js");
eq("normalizeTitleText: saltos de línea → un espacio", normalizeTitleText("Línea 1\r\n\r\n  Línea 2\nLínea 3"), "Línea 1 Línea 2 Línea 3");
eq("normalizeTitleText: sin saltos no toca nada (ni los espacios dobles)", normalizeTitleText("a  b"), "a  b");

const mount = (value) => {
  const ta = document.createElement("textarea");
  ta.rows = 1; ta.id = "t-title"; ta.value = value;
  document.body.appendChild(ta);
  const calls = { input: [], bold: 0, blur: 0 };
  ta.addEventListener("blur", () => calls.blur++);
  const handle = wireTitleField(ta, { onInput: (v) => calls.input.push(v), onBold: () => calls.bold++ });
  return { ta, calls, handle };
};
const key = (ta, init) => { const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }); ta.dispatchEvent(e); return e; };

{ // Enter sin Shift → blur, sin salto de línea
  const { ta, calls } = mount("Título largo de prueba"); ta.focus();
  const e = key(ta, { key: "Enter" });
  check("Enter (sin Shift) no inserta salto de línea (preventDefault)", e.defaultPrevented);
  eq("Enter (sin Shift) sale del campo (blur)", calls.blur, 1);
  check("y el foco ya no está en el título", document.activeElement !== ta);
}
{ // Shift+Enter → tampoco inserta, no sale
  const { ta, calls } = mount("x"); ta.focus();
  const e = key(ta, { key: "Enter", shiftKey: true });
  check("Shift+Enter tampoco inserta un salto de línea", e.defaultPrevented);
  eq("Shift+Enter no sale del campo", calls.blur, 0);
}
{ // Enter de una composición (IME) no cuenta
  const { ta, calls } = mount("x"); ta.focus();
  const e = key(ta, { key: "Enter", isComposing: true });
  check("Enter durante una composición (IME) se deja pasar", !e.defaultPrevented && calls.blur === 0);
}
{ // Ctrl/Cmd+B → negrita
  const { ta, calls } = mount("x");
  const e1 = key(ta, { key: "b", ctrlKey: true });
  const e2 = key(ta, { key: "B", metaKey: true });
  check("Ctrl+B y Cmd+B llaman a onBold sin escribir una «b»", calls.bold === 2 && e1.defaultPrevented && e2.defaultPrevented);
}
{ // pegar con saltos de línea
  const { ta, calls } = mount("Inicio  Final");
  ta.focus(); ta.setSelectionRange(7, 7);
  const ev = new window.Event("paste", { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: () => "uno\r\ndos\n\ntres" };
  ta.dispatchEvent(ev);
  eq("al pegar, los saltos de línea pasan a espacios", ta.value, "Inicio uno dos tres Final");
  check("el pegado no se hace dos veces (preventDefault) y avisa con el valor limpio", ev.defaultPrevented && calls.input.at(-1) === "Inicio uno dos tres Final", calls.input);
  eq("el cursor queda tras lo pegado", ta.selectionStart, "Inicio uno dos tres".length);
}
{ // un salto que se cuela por otra vía (arrastrar, teclado raro) se limpia sin mover el cursor
  const { ta, calls } = mount("");
  ta.value = "hola\nmundo"; ta.setSelectionRange(10, 10);
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  eq("un salto de línea que llegue por input se limpia", ta.value, "hola mundo");
  eq("y se avisa con el valor limpio", calls.input.at(-1), "hola mundo");
  eq("sin mover el cursor del final", ta.selectionStart, 10);
}
{ // auto-ajuste de altura
  const { ta, handle } = mount("a".repeat(300));
  Object.defineProperty(ta, "scrollHeight", { configurable: true, get: () => 96 });
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  eq("al escribir, el alto se ajusta al contenido (scrollHeight)", ta.style.height, "96px");
  Object.defineProperty(ta, "scrollHeight", { configurable: true, get: () => 24 });
  handle.resize();
  eq("y vuelve a encoger si el texto es corto", ta.style.height, "24px");
  autoResizeTextarea(null); // no revienta sin elemento
  handle.destroy();
  Object.defineProperty(ta, "scrollHeight", { configurable: true, get: () => 200 });
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  check("tras destroy() ya no reacciona", ta.style.height !== "200px");
}
done("v80 · calendario, festivos, vista previa y título multilínea");
