// ============================================================================
// Caché de piezas 3D ya leídas (v94). Leer un STEP grande lleva mucho; la SEGUNDA vez que alguien abre la misma pieza en el mismo
// navegador no hace falta: se guarda la malla ya calculada (arrays tipados) en IndexedDB y se vuelve a cargar en un par de segundos.
//
//   cadCacheKey({ id, name, size, lastModified, tess })   la clave: identifica el archivo (id de Drive, o nombre+tamaño+fecha si es local)
//                                                          y el teselado con el que se leyó (cad-engine.js, CAD_TESSELLATION)
//   readCadCache(key, store) / writeCadCache(key, result, store) / clearCadCache(store)
//   createIdbStore()                                      el almacén real (IndexedDB); `null` si el navegador no lo tiene
//
// El almacén es un objeto con `getMeta, getData, put, touch, remove, listMeta, clear`: las pruebas usan uno en memoria. Todo fallo de la
// caché (sin espacio, modo privado, esquema viejo…) se ignora: nunca impide abrir la pieza. Se guardan como mucho CAD_CACHE_MAX_ENTRIES
// piezas (se borran las menos usadas) y ninguna de más de CAD_CACHE_MAX_BYTES_PER_ENTRY.
// ============================================================================
import { occtResultToWorkerMeshes, workerMeshesToOcctResult } from "./cad-parse.js";

export const CAD_CACHE_FORMAT = 1;
export const CAD_CACHE_MAX_ENTRIES = 6;
export const CAD_CACHE_MAX_BYTES_PER_ENTRY = 160 * 1024 * 1024;
const DB_NAME = "chusy-cad";
const META = "meta";
const DATA = "data";

/** La clave de la caché. `id` (p. ej. el de Drive) manda sobre `name`; `lastModified` solo importa en archivos locales. */
export function cadCacheKey({ id = "", name = "", size = 0, lastModified = 0, tess = "normal" } = {}) {
  return [CAD_CACHE_FORMAT, tess, id || name || "?", Number(size) || 0, id ? 0 : Number(lastModified) || 0].join("|");
}

/** Los bytes que ocupan las mallas (para el tope por pieza y para saber lo que se guarda). */
export function meshesByteSize(meshes) {
  return (meshes || []).reduce((n, m) => n + (m.position ? m.position.byteLength : 0) + (m.normal ? m.normal.byteLength : 0) + (m.index ? m.index.byteLength : 0), 0);
}

/** Devuelve el resultado de occt-import-js guardado para esa clave, o `null` (no está, formato viejo, o el almacén falla). */
export async function readCadCache(key, store) {
  if (!store) return null;
  try {
    const meta = await store.getMeta(key);
    if (!meta || meta.format !== CAD_CACHE_FORMAT) return null;
    const data = await store.getData(key);
    if (!data || !Array.isArray(data.meshes) || !data.meshes.length) return null;
    store.touch(key, Date.now()).catch(() => {});
    return workerMeshesToOcctResult(data.meshes);
  } catch (e) {
    return null;
  }
}

/** Guarda un resultado de occt-import-js. Devuelve `true` si se guardó. Borra las piezas menos usadas si hay demasiadas. */
export async function writeCadCache(key, result, store, { now = Date.now() } = {}) {
  if (!store) return false;
  try {
    const meshes = occtResultToWorkerMeshes(result);
    const bytes = meshesByteSize(meshes);
    if (!meshes.length || bytes > CAD_CACHE_MAX_BYTES_PER_ENTRY) return false;
    await store.put({ key, format: CAD_CACHE_FORMAT, createdAt: now, lastUsed: now, bytes }, { meshes });
    const all = (await store.listMeta()).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    for (const old of all.slice(CAD_CACHE_MAX_ENTRIES)) await store.remove(old.key);
    return true;
  } catch (e) {
    return false;
  }
}

export async function clearCadCache(store) {
  if (!store) return false;
  try { await store.clear(); return true; } catch (e) { return false; }
}

// --------------------------------------------------------------------------- IndexedDB

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** El almacén real en IndexedDB, o `null` si no hay (Node, navegadores sin ella o con ella bloqueada). */
export function createIdbStore(factory = typeof indexedDB !== "undefined" ? indexedDB : null) {
  if (!factory) return null;
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = factory.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
          if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("IndexedDB bloqueada"));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  };
  const tx = async (names, mode, fn) => {
    const db = await open();
    const t = db.transaction(names, mode);
    const done = new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
    const out = await fn(t);
    await done;
    return out;
  };
  return {
    getMeta: (key) => tx([META], "readonly", (t) => wrap(t.objectStore(META).get(key))),
    getData: (key) => tx([DATA], "readonly", (t) => wrap(t.objectStore(DATA).get(key))),
    put: (meta, data) => tx([META, DATA], "readwrite", (t) => { t.objectStore(DATA).put(data, meta.key); t.objectStore(META).put(meta); }),
    touch: (key, ts) => tx([META], "readwrite", async (t) => {
      const s = t.objectStore(META);
      const m = await wrap(s.get(key));
      if (m) { m.lastUsed = ts; s.put(m); }
    }),
    remove: (key) => tx([META, DATA], "readwrite", (t) => { t.objectStore(META).delete(key); t.objectStore(DATA).delete(key); }),
    listMeta: () => tx([META], "readonly", (t) => wrap(t.objectStore(META).getAll())),
    clear: () => tx([META, DATA], "readwrite", (t) => { t.objectStore(META).clear(); t.objectStore(DATA).clear(); }),
  };
}
