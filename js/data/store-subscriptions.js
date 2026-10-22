// ============================================================================
// Suscripción a una LISTA de documentos a través de js/store.js (v74, Etapa 2).
//
// Lo comparten las suscripciones de proyectos, archivados, personas y etiquetas
// (data/projects.js y data/tags.js): cada una abre su consulta con una clave
// propia (`store.listen`), y quien se suscribe recibe la lista ordenada cada vez
// que cambia algo de ESA escucha. Qué da el store respecto al `onSnapshot`
// suelto de antes:
//   · una escucha con esa clave que ya esté abierta se reutiliza (no se abre
//     otro `onSnapshot`) y `callback` recibe al instante lo que ya hay;
//   · las instantáneas entran por `docChanges()`: solo se toca el documento que
//     cambió, y los que no cambian conservan su objeto (antes, cada instantánea
//     creaba objetos nuevos para todos);
//   · cada documento existe UNA vez en memoria aunque lo traigan dos escuchas
//     (un proyecto que está en la lista y en la suya propia, por ejemplo).
//
// Sin DOM ni Firebase: `attach` es quien sabe abrir la consulta. Va aparte de
// store.js para que el store siga sin saber de «listas ordenadas» ni de avisos.
// ============================================================================
import { store } from "../store.js";

/**
 * @param {object}   o
 * @param {string}   o.key      Clave de la escucha en el store (única por consulta).
 * @param {string}   o.slice    Colección del store donde se guardan los documentos.
 * @param {(observer: object) => (() => void)} o.attach  Abre la consulta: `(observer) => onSnapshot(q, observer)`.
 * @param {(a: object, b: object) => number} [o.sort]    Orden de la lista que se entrega.
 * @param {(list: object[]) => void} o.callback          Recibe la lista (un array nuevo cada vez; los documentos son los del store: no modificarlos).
 * @returns {() => void} Cancela: suelta la escucha, y el store la cierra (y olvida sus documentos) si nadie más la usa.
 */
export function subscribeToStoreList({ key, slice, attach, sort, callback }) {
  let released = false;
  let handle = null;
  let sentOnce = false;

  const emit = () => {
    if (released || !handle) return;
    const list = handle.docs(); // array nuevo en cada llamada: se puede ordenar
    if (sort) list.sort(sort);
    sentOnce = true;
    callback(list);
  };

  // Se suscribe al store ANTES de abrir la escucha, para no perder un aviso inmediato.
  const unsubStore = store.subscribe(slice, (_data, change) => {
    // «sync» (el servidor confirma lo que ya había) y «error» (se escribe en la
    // consola, como antes) no traen nada nuevo que enseñar.
    if (change.key !== key || change.type === "sync" || change.type === "error") return;
    emit();
  });

  handle = store.listen(key, slice, attach, { keepAlive: false });

  // Escucha que ya estaba abierta y cargada (o llegó antes de tener `handle`): no habrá
  // instantánea nueva, se enseña lo que hay. Una con error no se enseña (no hay nada).
  const status = store.getListenerStatus(key);
  if (!sentOnce && status && status.loaded && !status.error) emit();

  return () => {
    if (released) return;
    released = true;
    unsubStore();
    handle.release();
  };
}
