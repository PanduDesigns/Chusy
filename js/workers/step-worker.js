/* ============================================================================
   Lector de STEP en segundo plano (v94). Script de Worker CLÁSICO (no módulo): usa importScripts para cargar occt-import-js
   (OpenCascade compilado a WebAssembly) desde el CDN, así que NO necesita build ni importa nada de la aplicación.

   Por qué un Worker: leer y mallar un STEP grande (un ensamblaje de 20 MB) lleva de decenas de segundos a minutos. En el hilo principal
   la pestaña se quedaba congelada todo ese tiempo, sin poder cerrar el visor ni ver el avance; aquí el hilo principal sigue libre.

   Protocolo (postMessage):
     → { type: "parse", buffer: ArrayBuffer, params: object|null, providers: [{ name, base }] }      (buffer se TRANSFIERE)
     ← { type: "status", text }                                                       avance («Leyendo la geometría…»)
     ← { type: "result", meshes: [{ name, color, position, normal, index, brep_faces }] }   (arrays tipados TRANSFERIDOS, sin copiar)
     ← { type: "error", message, fatal }       fatal=true: el lector no se pudo cargar (el llamante puede probar sin Worker)
   ============================================================================ */
"use strict";

let occtPromise = null;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function loadOcct(providers) {
  if (occtPromise) return occtPromise;
  occtPromise = (async () => {
    const errors = [];
    for (const p of providers || []) {
      try {
        if (typeof self.occtimportjs !== "function") importScripts(p.base + "occt-import-js.js");
        if (typeof self.occtimportjs !== "function") throw new Error("el script no define occtimportjs");
        return await self.occtimportjs({ locateFile: (file) => p.base + file });
      } catch (e) {
        errors.push((p.name || p.base) + ": " + ((e && e.message) || e));
      }
    }
    throw new Error("No se pudo cargar el lector de STEP (" + errors.join(" · ") + ").");
  })();
  occtPromise.catch(() => { occtPromise = null; });
  return occtPromise;
}

// Copia a un array tipado NUEVO (y transferible): el que devuelve la librería puede ser una vista sobre la memoria de WebAssembly.
const f32 = (src) => (src && src.length ? new Float32Array(src) : null);
const u32 = (src) => new Uint32Array(src || []);

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type !== "parse") return;
  let occt;
  try {
    post({ type: "status", text: "Cargando el lector de STEP…" });
    occt = await loadOcct(msg.providers);
  } catch (e) {
    post({ type: "error", message: (e && e.message) || String(e), fatal: true });
    return;
  }
  try {
    post({ type: "status", text: "Leyendo la geometría…" });
    const result = occt.ReadStepFile(new Uint8Array(msg.buffer), msg.params || null);
    if (!result || !result.success || !Array.isArray(result.meshes) || !result.meshes.length) {
      post({ type: "error", message: "El archivo STEP no contiene geometría 3D que se pueda dibujar.", fatal: false });
      return;
    }
    post({ type: "status", text: "Preparando la malla…" });
    const meshes = [];
    const transfer = [];
    for (const m of result.meshes) {
      const position = f32(m && m.attributes && m.attributes.position && m.attributes.position.array);
      const index = u32(m && m.index && m.index.array);
      if (!position || index.length < 3) continue;
      const normal = f32(m.attributes.normal && m.attributes.normal.array);
      meshes.push({
        name: m.name || "",
        color: m.color || null,
        position,
        normal: normal && normal.length === position.length ? normal : null,
        index,
        brep_faces: Array.isArray(m.brep_faces) ? m.brep_faces.map((f) => ({ first: f.first, last: f.last, color: f.color || null })) : [],
      });
      transfer.push(position.buffer, index.buffer);
      if (normal && normal.length === position.length) transfer.push(normal.buffer);
    }
    post({ type: "result", meshes }, transfer);
  } catch (e) {
    post({ type: "error", message: "No se pudo leer el archivo STEP" + (e && e.message ? ": " + e.message : "."), fatal: false });
  }
};
