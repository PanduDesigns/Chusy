// ============================================================================
// Carga de tareas bajo demanda (v66).
//
// Hasta la v65, al iniciar sesión cada navegador se suscribía a las tareas de
// TODOS los proyectos (para la línea de tiempo global, el buscador y Métricas)
// aunque la persona solo abriera «Mis tareas». Firestore cobra una lectura por
// cada documento que baja (y otra por cada cambio que le llega a cada
// navegador conectado), así que cada apertura costaba «todas las tareas de la
// empresa» y el gasto crecía con el número de personas Y de tareas.
//
// Ahora cada proyecto se escucha SOLO cuando hace falta:
//
//   · al abrirlo (ensureProject) — y se queda escuchado hasta cerrar la
//     sesión, así que volver a él después es gratis (no vuelve a bajarlo);
//   · todos a la vez (ensureAll) únicamente al entrar en la línea de tiempo
//     global, en Métricas o al abrir el buscador — una vez por sesión;
//   · los que `isAlways` marque (Ofertas, para quien la ve): sus sugerencias
//     de Comercial y la macro de Outlook las necesitan desde el principio.
//
// Este archivo no sabe nada de Firestore ni del DOM: recibe la función que
// suscribe (subscribeToProjectTasks) y avisa por `onChange`. Así se puede
// probar suelto, con una suscripción simulada.
// ============================================================================

/**
 * @param {object}   deps
 * @param {(projectId: string, callback: (tasks: object[]) => void) => (() => void)} deps.subscribe
 *        Suscribe a las tareas de un proyecto y devuelve la función que la cancela.
 * @param {(projectId: string) => void} [deps.onChange]
 *        Se llama cada vez que llegan tareas (nuevas o cambiadas) de un proyecto.
 */
export function createTaskLoader({ subscribe, onChange = () => {} }) {
  /**
   * { [projectId]: tasks[] } — OBJETO VIVO: nunca se reasigna, solo se le
   * añaden y quitan claves, para que quien guarde la referencia (app.js) vea
   * siempre lo último. Un proyecto que todavía no se ha pedido NO tiene clave.
   */
  const tasksByProject = {};
  /** { [projectId]: { unsub, active } } — escuchas abiertas ahora mismo. */
  const entries = {};
  /** Ids de los proyectos visibles ahora (los de la última lista que se dio a syncProjects). */
  let knownIds = [];
  /** true tras ensureAll(): los proyectos que aparezcan después también se escuchan. */
  let wantAll = false;
  /** Quien espera a que lleguen todas las tareas (ver whenAllLoaded). */
  let waiters = [];

  function start(projectId) {
    if (entries[projectId]) return;
    // La entrada se registra ANTES de suscribirse: si la suscripción llamara
    // al callback de inmediato (una simulada puede), ya existe `entry`.
    const entry = { unsub: null, active: true };
    entries[projectId] = entry;
    entry.unsub = subscribe(projectId, (tasks) => {
      if (!entry.active) return; // llegó tarde: el proyecto ya se dejó de escuchar
      tasksByProject[projectId] = tasks;
      onChange(projectId);
      flushWaiters();
    });
  }

  function stop(projectId) {
    const entry = entries[projectId];
    if (!entry) return;
    entry.active = false;
    if (typeof entry.unsub === "function") entry.unsub();
    delete entries[projectId];
    delete tasksByProject[projectId];
  }

  function isAllLoaded() {
    return knownIds.every((id) => tasksByProject[id] !== undefined);
  }

  function finishWaiter(waiter, ok) {
    if (waiter.done) return;
    waiter.done = true;
    clearTimeout(waiter.timer);
    waiters = waiters.filter((w) => w !== waiter);
    waiter.callback(ok);
  }

  function flushWaiters() {
    if (!waiters.length || !isAllLoaded()) return;
    [...waiters].forEach((w) => finishWaiter(w, true));
  }

  return {
    tasksByProject,

    /**
     * Dice qué proyectos existen (y son visibles) ahora. Deja de escuchar los
     * que ya no están y empieza por los que corresponda: todos si ya se pidió
     * ensureAll(), y siempre los que `isAlways(proyecto)` marque.
     */
    syncProjects(projects, isAlways = () => false) {
      knownIds = projects.map((p) => p.id);
      const keep = new Set(knownIds);
      Object.keys(entries).forEach((id) => { if (!keep.has(id)) stop(id); });
      projects.forEach((p) => { if (wantAll || isAlways(p)) start(p.id); });
      flushWaiters(); // la lista pudo encogerse y dejar «todo cargado»
    },

    /** Escucha las tareas de un proyecto (no hace nada si ya se escuchan). */
    ensureProject(projectId) { start(projectId); },

    /** Escucha las de todos los proyectos visibles, y las de los que se creen después. */
    ensureAll() {
      wantAll = true;
      knownIds.forEach(start);
      flushWaiters();
    },

    /** ¿Ha llegado ya la primera tanda de TODOS los proyectos visibles? */
    isAllLoaded,

    /**
     * Llama a `callback(true)` en cuanto estén todas cargadas (de inmediato si
     * ya lo están) o a `callback(false)` si pasan `timeoutMs` sin conseguirlo
     * — para no dejar a nadie esperando para siempre si una consulta falla.
     * Hay que haber llamado antes a ensureAll(). Una sola vez por llamada.
     */
    whenAllLoaded(callback, timeoutMs = 8000) {
      if (isAllLoaded()) { callback(true); return; }
      const waiter = { callback, done: false, timer: null };
      waiter.timer = setTimeout(() => finishWaiter(waiter, false), timeoutMs);
      waiters.push(waiter);
    },

    /** Cierra sesión: deja de escuchar todo y olvida lo cargado (sin avisar a quien esperaba). */
    stopAll() {
      Object.keys(entries).forEach(stop);
      Object.keys(tasksByProject).forEach((id) => delete tasksByProject[id]);
      knownIds = [];
      wantAll = false;
      waiters.forEach((w) => { w.done = true; clearTimeout(w.timer); });
      waiters = [];
    },
  };
}
