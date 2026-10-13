// ============================================================================
// «Deshacer» (v67) — la parte pura (sin Firebase ni DOM): sacar una foto de las
// tareas antes de una acción para poder devolverlas a como estaban. Quien la
// enseña (el aviso con el botón «Deshacer») es components/undo-toast.js, y quien
// la aplica, restoreTaskSnapshot en data/tasks.js.
//
// La foto guarda los MISMOS campos para cualquier acción, en vez de saber qué
// campos toca cada una: así una acción nueva se puede deshacer sin tocar nada
// aquí. Son todos los que las acciones de la barra de selección múltiple, el
// clic derecho y «Convertir en oferta» pueden cambiar. Lo que no cambian
// (título, descripción, etiquetas, subtareas, comentarios…) no se toca al deshacer.
//
// Deshacer vuelve a escribir esos campos tal como estaban, así que pisa
// cualquier cambio que otra persona les hiciera en los segundos de margen.
// Lo que NO se puede deshacer, porque ya salió de este navegador: los avisos
// que se mandaron al asignar (la otra persona los sigue teniendo).
// ============================================================================

export const UNDO_FIELDS = [
  "projectId",
  "sectionId",
  "extraProjectIds",
  "extraSections",
  "assigneeIds",
  "ownerId",
  "startDate",
  "dueDate",
  "isComplete",
  "completedAt",
  "isMilestone",
  "customFields",
  "revisions",
];

/** Copia profunda de listas y objetos planos; lo demás (un Timestamp de Firestore, que es inmutable) se deja tal cual. */
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = copy(v);
    return out;
  }
  return value;
}

/**
 * La foto de estas tareas: por cada una, el valor de cada campo de UNDO_FIELDS
 * (`values`) y la lista de los que no existían (`absent`), que al deshacer se
 * quitan en vez de ponerse a null — no es lo mismo «sin fecha» que «campo sin
 * crear».
 */
export function takeTaskSnapshot(tasks) {
  return (tasks || []).map((task) => {
    const values = {};
    const absent = [];
    UNDO_FIELDS.forEach((field) => {
      if (task[field] === undefined) absent.push(field);
      else values[field] = copy(task[field]);
    });
    return { id: task.id, values, absent };
  });
}
