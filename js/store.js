// ============================================================================
// Store en memoria (v72): estado reactivo ligero (Pub/Sub) para lo que la app
// descarga de Firestore y para el estado de la interfaz.
//
// POR QUÉ. Hoy cada pantalla guarda su propia copia (`projects`, `myTasks`,
// `currentTasks`, `taskLoader.tasksByProject`…) y cada escucha (`onSnapshot`)
// reconstruye su lista ENTERA en cada cambio. Aquí hay UNA copia de cada
// colección, un registro de escuchas abiertas (`activeListeners`) para no abrir
// nunca dos veces la misma, y los cambios entran de uno en uno (`docChanges()`).
// Ojo con lo que NO hace: las lecturas que cobra Firestore dependen de lo que
// baja el servidor, no de cómo se guarde aquí; lo que las reduce es no abrir
// escuchas duplicadas y la caché persistente (js/firebase-init.js).
//
// Este archivo NO importa Firebase ni toca el DOM: recibe la función que
// suscribe (como task-loader.js), así que se puede probar suelto con
// instantáneas simuladas. NINGUNA vista lo usa todavía.
//
// ESTADO
//   tasks · projects · offers · users · departments · tags → Map<id, documento>
//   ui → { activeView, activeProjectId, filters }  (objeto; se puede ampliar)
//
//   · El id de cada documento va dentro, con el nombre que ya usa la app:
//     `id` (tasks, projects, offers, tags), `uid` (users) y `value`
//     (departments). Es la misma forma `{ id: d.id, ...d.data() }` de js/data/*.
//   · `offers` NO es una colección de Firestore: una oferta es una tarea del
//     proyecto exclusivo «Ofertas». Esta rebanada solo tiene lo que se le meta
//     con su propia escucha (p. ej. la consulta de las tareas de Ofertas), y esas
//     mismas tareas pueden estar también en `tasks`.
//   · `departments` tampoco: son constantes de js/departments.js. Se cargan con
//     `store.setState("departments", DEPARTMENTS)` al arrancar.
//   · Los Map son los VIVOS (no hay copia, para no gastar RAM, y siguen siendo el
//     mismo objeto aunque se sustituya la rebanada): quien los lea no debe
//     modificarlos. Para saber si una rebanada cambió, `getVersion(slice)` sube con
//     cada cambio. `ui` sí es inmutable: cada cambio crea un objeto nuevo.
//
// ESCUCHAS (activeListeners)
//   store.listen(clave, rebanada, (observer) => onSnapshot(consulta, observer))
//   · Si ya hay una escucha con esa clave en la sesión NO se vuelve a llamar a
//     onSnapshot: se devuelve un manejador con los datos que ya hay en memoria
//     (`handle.docs()`), al instante.
//   · Los cambios se aplican con `snapshot.docChanges()` (added / modified /
//     removed): solo se toca ese documento y se avisa UNA vez por instantánea
//     con las listas de lo añadido, modificado y quitado.
//   · TRAMPA que esto resuelve: dos consultas pueden devolver el mismo
//     documento (las tareas de un proyecto por `projectId` y por
//     `extraProjectIds`; «Mis tareas» por responsable y por dueño). Que una
//     consulta diga «removed» NO significa que se haya borrado: puede haber
//     dejado de cumplir ESA consulta (la tarea cambió de proyecto) y seguir
//     existiendo en otra. Por eso se apunta qué escuchas tienen cada documento
//     y solo se quita de memoria cuando ninguna lo tiene.
//   · También sirve con un documento suelto (`onSnapshot(doc(...))`).
//   · Una escucha con error (permisos, índice que falta) se da por cargada,
//     se cierra y suelta lo suyo: igual que task-loader.js, para que nadie
//     espere para siempre. El error queda en `getListenerStatus(clave)`.
//   · `isSynced(clave)` (el servidor ya confirmó) solo es fiable si la escucha
//     se abrió con `{ includeMetadataChanges: true }`: con caché persistente la
//     primera instantánea puede salir de la caché y, si luego no cambia nada, el
//     servidor no vuelve a llamar. `isLoaded(clave)` vale con cualquier origen.
// ============================================================================

/** Rebanadas que son colecciones, y el campo donde cada documento lleva su id. */
export const COLLECTION_SLICES = Object.freeze({
  tasks: "id",
  projects: "id",
  offers: "id",
  users: "uid",
  departments: "value",
  tags: "id",
});

const UI_SLICE = "ui";

const initialUi = () => ({ activeView: "list", activeProjectId: null, filters: {} });

/** Compara dos documentos por su contenido (lo bastante bueno para detectar «es el mismo, solo que lo trae otra consulta»). */
function sameDoc(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
}

export function createStore() {
  const collections = {}; // { [rebanada]: Map<id, doc> }
  const owners = {};      // { [rebanada]: Map<id, Set<claveDeEscucha>> } — qué escuchas tienen cada documento
  const versions = {};    // { [rebanada]: número } — sube con cada cambio
  const listCache = {};   // { [rebanada]: { version, list } } — el array de getList()
  const subscribers = {}; // { [rebanada]: Set<función> }
  Object.keys(COLLECTION_SLICES).forEach((slice) => {
    collections[slice] = new Map();
    owners[slice] = new Map();
    versions[slice] = 0;
    subscribers[slice] = new Set();
  });
  subscribers[UI_SLICE] = new Set();
  versions[UI_SLICE] = 0;
  let ui = Object.freeze(initialUi());

  /** { [clave]: { key, slice, refs, keepAlive, ids:Set, loaded, synced, fromCache, unsub, stopped, snapshotOptions } } — escuchas abiertas ahora mismo. */
  const activeListeners = {};
  /** { [clave]: error } — la última vez que una escucha terminó con error (se borra al volver a abrirla). */
  const listenerErrors = {};
  /** Quien espera a que unas escuchas estén cargadas (ver whenLoaded). */
  let waiters = [];

  // ------------------------------------------------------------------ utilidades

  function assertSlice(slice) {
    if (slice !== UI_SLICE && !(slice in COLLECTION_SLICES)) {
      throw new Error(`store: rebanada desconocida «${slice}» (valen: ${[...Object.keys(COLLECTION_SLICES), UI_SLICE].join(", ")})`);
    }
  }

  function assertCollection(slice) {
    if (!(slice in COLLECTION_SLICES)) throw new Error(`store: «${slice}» no es una colección`);
  }

  function emptyChange(type, extra) {
    return { type, key: null, added: [], modified: [], removed: [], ...extra };
  }

  function notify(slice, change) {
    const data = slice === UI_SLICE ? ui : collections[slice];
    [...subscribers[slice]].forEach((fn) => {
      // Un suscriptor que falla no debe impedir que se avise a los demás.
      try { fn(data, change); } catch (e) { console.error(`[store] suscriptor de «${slice}»:`, e); }
    });
  }

  function bump(slice) { versions[slice] += 1; }

  // ------------------------------------------------------------------ lectura

  /** Foto del estado: los Map vivos (no modificar) y `ui`. */
  function getState() {
    return { ...collections, ui };
  }

  /** El Map vivo de una colección (o el objeto `ui`). */
  function getSlice(slice) {
    assertSlice(slice);
    return slice === UI_SLICE ? ui : collections[slice];
  }

  /** Un documento por su id, o `undefined`. */
  function getById(slice, id) {
    assertCollection(slice);
    return collections[slice].get(id);
  }

  /** Los documentos de una colección como array (el mismo array mientras la rebanada no cambie). */
  function getList(slice) {
    assertCollection(slice);
    const cached = listCache[slice];
    if (cached && cached.version === versions[slice]) return cached.list;
    const list = [...collections[slice].values()];
    listCache[slice] = { version: versions[slice], list };
    return list;
  }

  /** Número que sube cada vez que cambia la rebanada (para memorizar resultados derivados). */
  function getVersion(slice) {
    assertSlice(slice);
    return versions[slice];
  }

  // ------------------------------------------------------------------ escritura

  /**
   * `ui`: mezcla el objeto con el estado actual (o recibe una función
   * `(uiActual) => parcial`). Solo avisa si algo cambió de verdad (`Object.is`).
   * Una clave que sea un objeto —`filters`— se SUSTITUYE entera, no se fusiona.
   *
   * Colecciones: SUSTITUYE la rebanada entera con un array, un Map o un objeto
   * `{ id: doc }`. Pensado para lo que no viene de Firestore (`departments`) y
   * para pruebas; los datos de una escucha entran por `listen()`.
   */
  function setState(slice, data) {
    assertSlice(slice);
    if (slice === UI_SLICE) {
      const patch = typeof data === "function" ? data(ui) : data;
      if (!patch || typeof patch !== "object") return;
      const changed = Object.keys(patch).filter((k) => !Object.is(ui[k], patch[k]));
      if (!changed.length) return;
      ui = Object.freeze({ ...ui, ...patch });
      bump(UI_SLICE);
      notify(UI_SLICE, emptyChange("set", { changed }));
      return;
    }

    const idField = COLLECTION_SLICES[slice];
    const docs = data instanceof Map ? [...data.values()]
      : Array.isArray(data) ? data
      : data && typeof data === "object" ? Object.entries(data).map(([id, d]) => ({ [idField]: id, ...d }))
      : [];
    // Se vacía y se rellena EL MISMO Map: quien guardó la referencia (getSlice) sigue viendo lo último.
    const coll = collections[slice];
    coll.clear();
    docs.forEach((doc) => {
      const id = doc && doc[idField];
      if (id === undefined || id === null) { console.warn(`[store] «${slice}»: documento sin «${idField}», se ignora`, doc); return; }
      coll.set(id, doc);
    });
    owners[slice].clear(); // lo cargado a mano no pertenece a ninguna escucha
    Object.values(activeListeners).forEach((entry) => { if (entry.slice === slice) entry.ids.clear(); });
    bump(slice);
    notify(slice, emptyChange("reset"));
  }

  /**
   * Avisa cuando cambia una rebanada. `callback(datos, cambio)`:
   *   · colecciones: `datos` = el Map vivo; `cambio` = `{ type, key, added[], modified[], removed[] }`
   *     con `type` = «patch» (entraron cambios de una escucha), «load» (primera
   *     instantánea de una escucha, aunque venga vacía), «sync» (el servidor confirmó
   *     una escucha que ya estaba cargada), «error», o «reset» (setState / stopAll);
   *   · `ui`: `datos` = el objeto nuevo; `cambio` = `{ type: "set", changed: [claves] }`.
   * Una sola llamada por instantánea, nunca una por documento.
   * `{ immediate: true }` llama una vez ya, con `cambio.type === "init"`.
   * Devuelve la función que cancela la suscripción (se puede llamar varias veces).
   */
  function subscribe(slice, callback, { immediate = false } = {}) {
    assertSlice(slice);
    if (typeof callback !== "function") throw new Error("store.subscribe: hace falta una función");
    subscribers[slice].add(callback);
    if (immediate) {
      try { callback(getSlice(slice), emptyChange("init")); } catch (e) { console.error(`[store] suscriptor de «${slice}»:`, e); }
    }
    return () => { subscribers[slice].delete(callback); };
  }

  // ------------------------------------------------------------------ escuchas

  /**
   * Abre —o reutiliza— una escucha de Firestore y vuelca lo que llegue en `slice`.
   *
   * @param {string} key    Identifica la escucha en la sesión: `"tasks:project:abc"`, `"projects"`…
   * @param {string} slice  Colección del store donde entran los documentos.
   * @param {(observer: {next: Function, error: Function}) => (() => void)} attach
   *        Abre la escucha de verdad y devuelve su función de cancelar, p. ej.
   *        `(observer) => onSnapshot(consulta, observer)`. Solo se llama si NO hay ya
   *        una escucha con esa clave.
   * @param {object}  [options]
   * @param {boolean} [options.keepAlive=true] Mantenerla abierta aunque nadie la use ya
   *        (lo de task-loader.js: se queda escuchada hasta cerrar la sesión). Con
   *        `false` se cierra al soltar el último que la pidió.
   * @param {object}  [options.snapshotOptions] Se pasa a `doc.data()` (p. ej. `{ serverTimestamps: "estimate" }`).
   * @returns {{ key: string, reused: boolean, docs: () => object[], release: () => void }}
   *          `docs()` = lo que esta escucha tiene ahora en memoria (inmediato, también si es reutilizada).
   */
  function listen(key, slice, attach, { keepAlive = true, snapshotOptions } = {}) {
    assertCollection(slice);
    if (typeof attach !== "function") throw new Error("store.listen: hace falta la función que abre la escucha");

    const existing = activeListeners[key];
    if (existing) {
      if (existing.slice !== slice) throw new Error(`store.listen: la escucha «${key}» ya existe para «${existing.slice}», no para «${slice}»`);
      existing.refs += 1;
      if (keepAlive) existing.keepAlive = true;
      return makeHandle(existing, true);
    }

    delete listenerErrors[key];
    // Se registra ANTES de suscribirse: si `attach` llama al callback de inmediato
    // (una simulada puede), la escucha ya existe.
    const entry = {
      key, slice, refs: 1, keepAlive, snapshotOptions,
      ids: new Set(), loaded: false, synced: false, fromCache: null,
      unsub: null, stopped: false,
    };
    activeListeners[key] = entry;
    try {
      const unsub = attach({
        next: (snap) => applySnapshot(entry, snap),
        error: (err) => failListener(entry, err),
      });
      if (entry.stopped) { if (typeof unsub === "function") unsub(); } // se cerró mientras se abría
      else entry.unsub = unsub;
    } catch (e) {
      if (activeListeners[key] === entry) delete activeListeners[key];
      entry.stopped = true;
      throw e;
    }
    return makeHandle(entry, false);
  }

  function makeHandle(entry, reused) {
    let released = false;
    return {
      key: entry.key,
      reused,
      docs: () => {
        const coll = collections[entry.slice];
        return [...entry.ids].map((id) => coll.get(id)).filter(Boolean);
      },
      release: () => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        if (entry.refs <= 0 && !entry.keepAlive) stop(entry.key);
      },
    };
  }

  /** Suelta lo que tenía una escucha. Devuelve los documentos que ya no tiene NINGUNA escucha (esos salen de memoria). */
  function dropEntry(entry) {
    const own = owners[entry.slice];
    const coll = collections[entry.slice];
    const removed = [];
    entry.ids.forEach((id) => {
      const set = own.get(id);
      if (set) set.delete(entry.key);
      if (!set || set.size === 0) {
        own.delete(id);
        const doc = coll.get(id);
        if (doc) { coll.delete(id); removed.push(doc); }
      }
    });
    entry.ids.clear();
    return removed;
  }

  function closeEntry(entry) {
    entry.stopped = true;
    if (activeListeners[entry.key] === entry) delete activeListeners[entry.key];
    if (typeof entry.unsub === "function") {
      try { entry.unsub(); } catch (e) { console.error(`[store] cancelar «${entry.key}»:`, e); }
    }
    entry.unsub = null;
  }

  /** Cierra una escucha y saca de memoria lo que solo ella tenía. Devuelve `false` si no existía. */
  function stop(key) {
    const entry = activeListeners[key];
    if (!entry) return false;
    closeEntry(entry);
    const removed = dropEntry(entry);
    if (removed.length) {
      bump(entry.slice);
      notify(entry.slice, emptyChange("patch", { key, removed }));
    }
    flushWaiters();
    return true;
  }

  /** Cierra sesión: cierra todas las escuchas, vacía todo y deja `ui` como al principio. Los suscriptores se conservan. */
  function stopAll() {
    Object.values(activeListeners).forEach(closeEntry);
    Object.keys(listenerErrors).forEach((k) => delete listenerErrors[k]);
    // Sin avisar a quien esperaba (igual que task-loader.stopAll): se anulan también sus temporizadores.
    waiters.forEach((w) => { w.done = true; clearTimeout(w.timer); });
    waiters = [];
    Object.keys(COLLECTION_SLICES).forEach((slice) => {
      collections[slice].clear();
      owners[slice].clear();
      bump(slice);
    });
    ui = Object.freeze(initialUi());
    bump(UI_SLICE);
    Object.keys(COLLECTION_SLICES).forEach((slice) => notify(slice, emptyChange("reset")));
    notify(UI_SLICE, emptyChange("set", { changed: Object.keys(ui) }));
  }

  /** Aplica una instantánea de Firestore (de consulta o de documento suelto) a la rebanada de su escucha. */
  function applySnapshot(entry, snap) {
    // Llegó tarde: la escucha ya se cerró (o se abrió otra con la misma clave).
    if (entry.stopped || activeListeners[entry.key] !== entry) return;

    const { slice, key } = entry;
    const idField = COLLECTION_SLICES[slice];
    const coll = collections[slice];
    const own = owners[slice];
    const added = [];
    const modified = [];
    const removed = [];

    const apply = (type, docSnap) => {
      const id = docSnap.id;
      if (type === "removed") {
        entry.ids.delete(id);
        const set = own.get(id);
        if (set) set.delete(key);
        // Solo sale de memoria si NINGUNA otra escucha lo tiene (ver «TRAMPA» arriba).
        if (!set || set.size === 0) {
          own.delete(id);
          const prev = coll.get(id);
          if (prev) { coll.delete(id); removed.push(prev); }
        }
        return;
      }
      const doc = { [idField]: id, ...docSnap.data(entry.snapshotOptions) };
      entry.ids.add(id);
      let set = own.get(id);
      if (!set) { set = new Set(); own.set(id, set); }
      set.add(key);
      const prev = coll.get(id);
      // «added» aquí pero ya lo tenía otra escucha tal cual (consultas solapadas): no es un cambio.
      if (prev && type !== "modified" && sameDoc(prev, doc)) return;
      coll.set(id, doc);
      (prev ? modified : added).push(doc);
    };

    if (typeof snap.docChanges === "function") {
      snap.docChanges().forEach((c) => apply(c.type, c.doc));
    } else {
      // Documento suelto (onSnapshot(doc(...))): existe → se guarda (si cambió de verdad); no existe → se quita.
      apply(snap.exists() ? "added" : "removed", snap);
    }

    const firstLoad = !entry.loaded;
    const wasSynced = entry.synced;
    entry.fromCache = !!(snap.metadata && snap.metadata.fromCache);
    entry.loaded = true;
    if (!entry.fromCache) entry.synced = true;

    const changed = added.length || modified.length || removed.length;
    if (changed) bump(slice);
    if (changed || firstLoad || (!wasSynced && entry.synced)) {
      const type = changed ? "patch" : firstLoad ? "load" : "sync";
      notify(slice, { type, key, added, modified, removed, fromCache: entry.fromCache });
    }
    flushWaiters();
  }

  /** Error de la escucha (permisos, índice que falta…): Firestore ya la ha cancelado. */
  function failListener(entry, err) {
    if (entry.stopped || activeListeners[entry.key] !== entry) return;
    console.error(`[store] escucha «${entry.key}»:`, err);
    listenerErrors[entry.key] = err;
    closeEntry(entry); // (getListenerStatus() da por cargada una escucha con error: nadie espera para siempre a una consulta que no va a llegar)
    const removed = dropEntry(entry);
    if (removed.length) bump(entry.slice);
    notify(entry.slice, emptyChange("error", { key: entry.key, removed, error: err }));
    flushWaiters();
  }

  // ------------------------------------------------------------------ estado de las escuchas

  /** `null` si nunca se abrió; si no, `{ active, refs, loaded, synced, fromCache, docCount, error }`. */
  function getListenerStatus(key) {
    const entry = activeListeners[key];
    if (entry) {
      return { active: true, refs: entry.refs, loaded: entry.loaded, synced: entry.synced, fromCache: entry.fromCache, docCount: entry.ids.size, error: null };
    }
    if (key in listenerErrors) {
      return { active: false, refs: 0, loaded: true, synced: false, fromCache: null, docCount: 0, error: listenerErrors[key] };
    }
    return null;
  }

  /** ¿Ha llegado ya la primera instantánea (de la caché o del servidor) — o el error — de esa escucha? */
  function isLoaded(key) {
    const s = getListenerStatus(key);
    return !!s && s.loaded;
  }

  /** ¿La ha confirmado ya el servidor? Ver el aviso sobre `includeMetadataChanges` arriba. */
  function isSynced(key) {
    const s = getListenerStatus(key);
    return !!s && s.synced;
  }

  function flushWaiters() {
    if (!waiters.length) return;
    [...waiters].forEach((w) => { if (w.keys.every(isLoaded)) finishWaiter(w, true); });
  }

  function finishWaiter(waiter, ok) {
    if (waiter.done) return;
    waiter.done = true;
    clearTimeout(waiter.timer);
    waiters = waiters.filter((w) => w !== waiter);
    waiter.callback(ok);
  }

  /**
   * `callback(true)` en cuanto todas esas escuchas estén cargadas (de inmediato si
   * ya lo están) o `callback(false)` si pasan `timeoutMs` sin conseguirlo.
   * Hay que haberlas abierto antes con `listen()`.
   */
  function whenLoaded(keys, callback, timeoutMs = 8000) {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.every(isLoaded)) { callback(true); return; }
    const waiter = { keys: list, callback, done: false, timer: null };
    waiter.timer = setTimeout(() => finishWaiter(waiter, false), timeoutMs);
    waiters.push(waiter);
  }

  return {
    getState, getSlice, getById, getList, getVersion,
    setState, subscribe,
    listen, stop, stopAll,
    getListenerStatus, isLoaded, isSynced, whenLoaded,
    activeListeners, // el registro, vivo: para mirar (no modificar)
  };
}

/** La instancia única que usará la app. `createStore()` sirve para pruebas. */
export const store = createStore();
