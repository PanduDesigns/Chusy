// ============================================================================
// «Corregir en todo Chusy» (v93): escribe por lotes lo que planSuggestedValueReplacement (suggest-hygiene.js) calcula.
//
// Se corrige en las tareas que este navegador conoce (todas las de los proyectos activos + las personales propias) y en los
// proyectos activos. Las tareas de proyectos archivados y las personales de otras personas no se leen desde aquí (firestore.rules)
// y conservan el texto antiguo: se queda sin sugerirse (porque ya no lo lleva ningún registro visible) pero ahí sigue escrito.
// Las tareas se escriben en lotes de 450 y los proyectos aparte: si uno falla por permisos, no arrastra a los demás.
// ============================================================================
import { db } from "../firebase-init.js";
import { doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { store } from "../store.js";
import { loadAllKnownTasks } from "./tags.js";
import { planSuggestedValueReplacement } from "../suggest-hygiene.js";

const BATCH_CHUNK = 450;

async function commit(collectionName, updates) {
  for (let i = 0; i < updates.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    updates.slice(i, i + BATCH_CHUNK).forEach((u) => batch.update(doc(db, collectionName, u.id), { ...u.fields, updatedAt: serverTimestamp() }));
    await batch.commit();
  }
}

/** Qué cambiaría (sin escribir nada): para enseñar «se cambiará en N registros» antes de confirmar. */
export async function previewSuggestedFieldReplacement(field, oldValue, newValue, { tasks = null, projects = null } = {}) {
  const taskList = tasks !== null ? tasks : await loadAllKnownTasks();
  const projectList = projects !== null ? projects : store.getList("projects");
  return planSuggestedValueReplacement({ field, oldValue, newValue, tasks: taskList, projects: projectList });
}

/**
 * Cambia `oldValue` por `newValue` en todos los registros donde esté (newValue vacío = limpiar el valor). Devuelve
 * `{ tasks, projects, count, failedProjects }`. Las tareas van primero; si algo falla a medias, repetir termina el trabajo.
 */
export async function replaceSuggestedFieldValueEverywhere(field, oldValue, newValue, opts = {}) {
  const plan = await previewSuggestedFieldReplacement(field, oldValue, newValue, opts);
  await commit("tasks", plan.taskUpdates);
  let failedProjects = 0;
  if (plan.projectUpdates.length) {
    try { await commit("projects", plan.projectUpdates); } catch (e) { failedProjects = plan.projectUpdates.length; console.warn("suggest-edit: proyectos sin cambiar", e); }
  }
  return { tasks: plan.taskUpdates.length, projects: plan.projectUpdates.length - failedProjects, count: plan.count - failedProjects, failedProjects };
}
