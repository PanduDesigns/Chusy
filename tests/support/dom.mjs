// jsdom global mínimo para probar componentes reales (modal-root y toast-root como en index.html).
import { JSDOM } from "jsdom";
export function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="modal-root"></div><div id="toast-root"></div></body></html>`, { url: "https://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  define("window", w);
  define("document", w.document);
  for (const k of ["HTMLElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent", "localStorage", "sessionStorage", "getComputedStyle"]) if (w[k] !== undefined) define(k, w[k]);
  define("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  return dom;
}
/** Fija «ahora» (new Date() sin argumentos); Date.now() también. */
export function freezeNow(iso) {
  const Real = globalThis.__RealDate || Date;
  globalThis.__RealDate = Real;
  const t = new Real(iso).getTime();
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length === 0) super(t); else super(...a); }
    static now() { return t; }
  };
}
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
