// ============================================================================
// Motor del visor 3D (v90): carga PEREZOSA de Three.js, OrbitControls y occt-import-js (OpenCascade compilado a
// WebAssembly). Nada de esto se descarga hasta que alguien abre el visor por primera vez: quien nunca mide una pieza no
// paga ni un byte (mismo criterio que SheetJS y jsPDF en la exportación del Gantt, ver gantt-export.js).
//
//   · Three.js y OrbitControls son módulos ES que se piden a un CDN con una versión FIJA. Los dos salen del MISMO
//     proveedor (OrbitControls importa `three` por nombre y el CDN lo resuelve a su propia copia: así comparten
//     instancia). Si el primero falla se prueba el segundo.
//   · occt-import-js (v0.0.23) es un script clásico que define `occtimportjs()`; el .wasm se pide junto a él (`locateFile`).
//
// Sin DOM salvo en `defaultLoadScript`, y todo inyectable para probarlo en Node sin red.
// ============================================================================

export const CAD_LIB_VERSIONS = Object.freeze({ three: "0.160.0", occt: "0.0.23" });

const T = CAD_LIB_VERSIONS.three;
const O = CAD_LIB_VERSIONS.occt;

/** Proveedores de Three.js + OrbitControls, en orden de preferencia (cada uno trae los DOS módulos). */
export const CAD_THREE_PROVIDERS = Object.freeze([
  Object.freeze({
    name: "jsDelivr",
    three: `https://cdn.jsdelivr.net/npm/three@${T}/+esm`,
    controls: `https://cdn.jsdelivr.net/npm/three@${T}/examples/jsm/controls/OrbitControls.js/+esm`,
  }),
  Object.freeze({
    name: "esm.sh",
    three: `https://esm.sh/three@${T}`,
    controls: `https://esm.sh/three@${T}/examples/jsm/controls/OrbitControls.js`,
  }),
]);

/** Proveedores de occt-import-js: `base` es la carpeta de `occt-import-js.js` y de `occt-import-js.wasm`. */
export const CAD_OCCT_PROVIDERS = Object.freeze([
  Object.freeze({ name: "jsDelivr", base: `https://cdn.jsdelivr.net/npm/occt-import-js@${O}/dist/` }),
  Object.freeze({ name: "unpkg", base: `https://unpkg.com/occt-import-js@${O}/dist/` }),
]);

/** Por encima de este tamaño el STEP no se abre en el navegador (la memoria de WebAssembly se agota). */
export const CAD_MAX_FILE_BYTES = 150 * 1024 * 1024;

const defaultImport = (url) => import(/* @vite-ignore */ url);

function defaultLoadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error(`No se pudo cargar ${url}`)); };
    document.head.appendChild(script);
  });
}

let enginePromise = null;

/** Olvida el motor cargado (las pruebas lo usan para empezar de cero). */
export function resetCadEngine() {
  enginePromise = null;
}

async function loadThree(importModule, errors) {
  for (const p of CAD_THREE_PROVIDERS) {
    try {
      const THREE = await importModule(p.three);
      const controls = await importModule(p.controls);
      if (!THREE || typeof THREE.Scene !== "function") throw new Error("el módulo de Three.js no es el esperado");
      if (!controls || typeof controls.OrbitControls !== "function") throw new Error("OrbitControls no está en el módulo");
      return { THREE, OrbitControls: controls.OrbitControls };
    } catch (e) {
      errors.push(`${p.name}: ${(e && e.message) || e}`);
    }
  }
  throw new Error(`No se pudo cargar Three.js (${errors.join(" · ")}). Comprueba la conexión a Internet.`);
}

async function loadOcct(loadScript, getFactory, errors) {
  for (const p of CAD_OCCT_PROVIDERS) {
    try {
      if (typeof getFactory() !== "function") await loadScript(`${p.base}occt-import-js.js`);
      const factory = getFactory();
      if (typeof factory !== "function") throw new Error("el script no define occtimportjs");
      return await factory({ locateFile: (file) => `${p.base}${file}` });
    } catch (e) {
      errors.push(`${p.name}: ${(e && e.message) || e}`);
    }
  }
  throw new Error(`No se pudo cargar el lector de STEP (${errors.join(" · ")}). Comprueba la conexión a Internet.`);
}

/**
 * Carga (una sola vez por sesión) el motor y devuelve `{ THREE, OrbitControls, occt }`. Si falla, el siguiente intento
 * vuelve a probar. `onStatus(texto)` avisa de en qué paso va. Los demás parámetros son para pruebas.
 */
export function loadCadEngine({ onStatus, importModule = defaultImport, loadScript = defaultLoadScript, getFactory = () => globalThis.occtimportjs } = {}) {
  if (enginePromise) return enginePromise;
  const promise = (async () => {
    const errors = [];
    if (onStatus) onStatus("Cargando el motor 3D…");
    const { THREE, OrbitControls } = await loadThree(importModule, errors);
    if (onStatus) onStatus("Cargando el lector de STEP…");
    const occt = await loadOcct(loadScript, getFactory, errors);
    return { THREE, OrbitControls, occt };
  })();
  enginePromise = promise;
  promise.catch(() => { if (enginePromise === promise) enginePromise = null; });
  return promise;
}

/**
 * Lee un STEP (ArrayBuffer o Uint8Array) con occt-import-js y devuelve su resultado (`{ success, meshes: [...] }`).
 * Lanza un error en castellano si el archivo no se puede leer o no trae geometría.
 */
export function parseStepBuffer(occt, buffer) {
  if (!occt || typeof occt.ReadStepFile !== "function") throw new Error("El lector de STEP no está listo.");
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.length) throw new Error("El archivo está vacío.");
  let result;
  try {
    result = occt.ReadStepFile(bytes, null);
  } catch (e) {
    throw new Error(`No se pudo leer el archivo STEP${e && e.message ? `: ${e.message}` : "."}`);
  }
  if (!result || !result.success || !Array.isArray(result.meshes) || !result.meshes.length) {
    throw new Error("El archivo STEP no contiene geometría 3D que se pueda dibujar.");
  }
  return result;
}
