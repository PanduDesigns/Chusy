// ============================================================================
// Lectura del STEP (v94): en un Web Worker cuando se puede (js/workers/step-worker.js) y, si no, en el hilo principal como siempre.
//
//   parseStepAsync(buffer, { params, onStatus, signal, deps })  →  Promise<{ result, via: 'worker' | 'main' }>
//
// `result` tiene la forma de occt-import-js (`{ success, meshes: [{ name, color, attributes: { position: { array }, normal: { array } },
// index: { array }, brep_faces }] }`), así que buildCadModel (cad-model.js) no distingue de dónde viene.
//
// Si el Worker no existe (Node, jsdom, navegadores muy antiguos) o no puede cargar el lector, se cae al hilo principal (`deps.loadEngine`
// + parseStepBuffer): la apertura nunca depende de que el Worker funcione. Cancelar (`signal`) termina el Worker al instante, que es lo
// que hace que cerrar el visor durante una lectura larga libere la CPU de verdad.
// ============================================================================
import { CAD_OCCT_PROVIDERS, parseStepBuffer, loadCadEngine } from "./cad-engine.js";

/** El resultado del Worker (arrays tipados por malla) con la forma de occt-import-js. */
export function workerMeshesToOcctResult(meshes) {
  return {
    success: true,
    meshes: (meshes || []).map((m) => ({
      name: m.name || "",
      color: m.color || null,
      attributes: { position: { array: m.position }, ...(m.normal ? { normal: { array: m.normal } } : {}) },
      index: { array: m.index },
      brep_faces: Array.isArray(m.brep_faces) ? m.brep_faces : [],
    })),
  };
}

/** Las mallas de un resultado de occt-import-js como las guarda la caché (arrays tipados). Inversa de workerMeshesToOcctResult. */
export function occtResultToWorkerMeshes(result) {
  return ((result && result.meshes) || []).map((m) => ({
    name: m.name || "",
    color: m.color || null,
    position: m.attributes.position.array instanceof Float32Array ? m.attributes.position.array : new Float32Array(m.attributes.position.array),
    normal: m.attributes.normal && m.attributes.normal.array ? (m.attributes.normal.array instanceof Float32Array ? m.attributes.normal.array : new Float32Array(m.attributes.normal.array)) : null,
    index: m.index.array instanceof Uint32Array ? m.index.array : new Uint32Array(m.index.array),
    brep_faces: Array.isArray(m.brep_faces) ? m.brep_faces : [],
  }));
}

const defaultWorkerFactory = () => {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./workers/step-worker.js", import.meta.url));
};

function abortError() {
  const e = new Error("Cancelado");
  e.name = "AbortError";
  return e;
}

function runInWorker(worker, buffer, { params, onStatus, signal, providers }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      try { worker.terminate(); } catch (e) { /* ya terminado */ }
      fn(value);
    };
    const onAbort = () => finish(reject, abortError());
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort);
    }
    worker.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === "status") { if (onStatus) onStatus(msg.text); }
      else if (msg.type === "result") finish(resolve, workerMeshesToOcctResult(msg.meshes));
      else if (msg.type === "error") { const e = new Error(msg.message || "No se pudo leer el archivo STEP."); e.fatal = !!msg.fatal; finish(reject, e); }
    };
    worker.onerror = (ev) => { const e = new Error((ev && ev.message) || "El lector de STEP en segundo plano falló."); e.fatal = true; finish(reject, e); };
    try {
      // El buffer se TRANSFIERE (no se copia): al terminar, el llamante ya no puede usarlo. Se manda una copia de la vista para no vaciar el original.
      const copy = buffer instanceof ArrayBuffer ? buffer.slice(0) : new Uint8Array(buffer).slice().buffer;
      worker.postMessage({ type: "parse", buffer: copy, params: params || null, providers }, [copy]);
    } catch (e) { e.fatal = true; finish(reject, e); }
  });
}

/**
 * Lee un STEP. `deps` es para pruebas: `{ workerFactory, loadEngine, providers }`. Con `deps.workerFactory === null` se salta el Worker.
 */
export async function parseStepAsync(buffer, { params = null, onStatus, signal, deps = {} } = {}) {
  const providers = deps.providers || CAD_OCCT_PROVIDERS.map((p) => ({ name: p.name, base: p.base }));
  const makeWorker = "workerFactory" in deps ? deps.workerFactory : defaultWorkerFactory;
  let worker = null;
  if (makeWorker) {
    try { worker = makeWorker(); } catch (e) { worker = null; }
  }
  if (worker) {
    try {
      const result = await runInWorker(worker, buffer, { params, onStatus, signal, providers });
      return { result, via: "worker" };
    } catch (e) {
      if (!e || !e.fatal) throw e; // un fallo de lectura de verdad (STEP sin geometría, corrupto…) no se arregla probando de nuevo
      if (signal && signal.aborted) throw abortError();
      if (onStatus) onStatus("Leyendo la geometría…");
      // fallo del propio Worker (no pudo cargar el lector, CSP…): se sigue en el hilo principal
    }
  }
  const loadEngine = deps.loadEngine || ((o) => loadCadEngine(o));
  const eng = await loadEngine({ onStatus });
  if (signal && signal.aborted) throw abortError();
  // Deja pintar el aviso antes de bloquear el hilo con el WebAssembly.
  await new Promise((r) => setTimeout(r, 30));
  return { result: parseStepBuffer(eng.occt, buffer, params), via: "main" };
}
