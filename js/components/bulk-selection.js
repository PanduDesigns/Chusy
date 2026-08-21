// ============================================================================
// Controlador de selección múltiple para tablas de tareas (de momento solo
// lo usa la vista de Lista). Vive FUERA del ciclo de renderizado —
// list-view.js reconstruye su HTML entero en cada render (cada cambio de
// filtro, cada actualización en tiempo real de Firestore...), así que si
// este estado viviera dentro de renderListView() se perdería la selección
// cada vez que llega un dato nuevo. Guardándolo a nivel de módulo
// sobrevive entre renders y solo se limpia cuando list-view.js decide que
// toca (cambio de proyecto, o el botón "✕" de la barra flotante).
// ============================================================================

export function createSelectionController() {
  let selectedIds = new Set();
  let anchorId = null; // última tarea pulsada: punto de partida para Shift+clic

  function selectOnly(id) {
    selectedIds = new Set([id]);
    anchorId = id;
  }

  function clear() {
    selectedIds = new Set();
    anchorId = null;
  }

  /** Ctrl/Cmd+clic: añade o quita esa tarea sin tocar el resto de la selección. */
  function toggle(id) {
    selectedIds = new Set(selectedIds);
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    anchorId = id;
  }

  /**
   * Shift+clic: selecciona el tramo entre el ancla (la última tarea
   * tocada) y `id`, dentro de `orderedIds` (el orden real en pantalla,
   * incluyendo todas las secciones). Si no hay ancla todavía, se
   * comporta como una selección simple.
   */
  function selectRange(orderedIds, id) {
    if (!anchorId || !orderedIds.includes(anchorId)) { selectOnly(id); return; }
    const from = orderedIds.indexOf(anchorId);
    const to = orderedIds.indexOf(id);
    if (to === -1) { selectOnly(id); return; }
    const [start, end] = from < to ? [from, to] : [to, from];
    selectedIds = new Set(orderedIds.slice(start, end + 1));
  }

  /** Descarta ids que ya no existen en la vista actual (filtro aplicado, tarea borrada por otra persona...). */
  function prune(currentIds) {
    const valid = new Set(currentIds);
    const next = new Set([...selectedIds].filter((id) => valid.has(id)));
    if (next.size !== selectedIds.size) selectedIds = next;
    if (anchorId && !valid.has(anchorId)) anchorId = null;
  }

  return {
    get size() { return selectedIds.size; },
    has: (id) => selectedIds.has(id),
    clear,
    selectOnly,
    toggle,
    selectRange,
    prune,
  };
}
