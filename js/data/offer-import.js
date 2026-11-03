// ============================================================================
// Importador de históricos de ofertas (v83): la parte que ESCRIBE en Firestore. La lectura del archivo y la
// planificación (qué se crea, qué se salta por duplicado) son puras y viven en js/offer-import.js; la ventana,
// en components/offer-import-modal.js.
//
// Cada oferta histórica es una tarea más de Ofertas (misma colección `tasks`, mismas reglas que cualquier
// oferta: no hace falta tocar firestore.rules), con las fechas ORIGINALES del archivo en `createdAt`,
// `completedAt` y `convertedAt` — por eso aquí NO se usa createTask (que sella la fecha de hoy).
//
// Va por lotes (writeBatch, máximo 400 escrituras cada uno, por debajo del tope de 500 de Firestore) y se
// puede volver a lanzar sin duplicar: planOfferHistoryImport salta lo que ya existe. Un lote que falle no
// deshace los anteriores (ya están guardados y la próxima importación los reconocerá como duplicados); se
// devuelve cuántas entraron y cuántas no, para que quien llama lo cuente.
//
// A las históricas NO se les reparte ID (`offerCode`): son anteriores a los IDs y no tienen carpeta de Drive;
// su año sale de la fecha de la oferta, no del prefijo del ID.
// ============================================================================
import { collection, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db } from "../firebase-init.js";

/** Escrituras por lote (Firestore admite 500). */
export const IMPORT_BATCH_SIZE = 400;

/** Una oferta histórica con todos los campos de una tarea (los que createTask escribe) más los propios del histórico. */
export function historicalOfferTaskData(offerDoc, { createdBy, order }) {
  const sealedAt = offerDoc.completedAt || offerDoc.createdAt;
  return {
    projectId: offerDoc.projectId,
    ownerId: null,
    sectionId: offerDoc.sectionId || null,
    extraProjectIds: [],
    extraSections: {},
    title: offerDoc.title,
    description: "",
    assigneeIds: [],
    dueDate: null,
    startDate: null,
    priority: "media",
    tags: [],
    dependsOn: [],
    subtasks: [],
    attachments: [],
    customFields: offerDoc.customFields || {},
    revisions: offerDoc.revisions || [],
    isComplete: !!offerDoc.isComplete,
    isMilestone: false,
    completedAt: offerDoc.completedAt || null,
    ...(offerDoc.convertedAt ? { convertedAt: offerDoc.convertedAt } : {}),
    importedHistorical: true,
    importedOutcome: offerDoc.importedOutcome,
    importBatchId: offerDoc.importBatchId,
    order,
    createdBy,
    createdAt: offerDoc.createdAt,
    updatedAt: serverTimestamp(),
    sectionEnteredAt: sealedAt, // v81: entró en su sección cuando se cerró (o se creó), no hoy
  };
}

/**
 * Guarda las ofertas históricas.
 * @param {{ docs: object[], createdBy: string, onProgress?: (done: number, total: number) => void }} args
 *   `docs`: los `doc` de planOfferHistoryImport(...).toCreate.
 * @returns {Promise<{ created: number, failed: number }>}
 */
export async function importHistoricalOffers({ docs, createdBy, onProgress }) {
  const total = docs.length;
  const base = Date.now();
  let created = 0, failed = 0;
  for (let start = 0; start < total; start += IMPORT_BATCH_SIZE) {
    const chunk = docs.slice(start, start + IMPORT_BATCH_SIZE);
    try {
      const batch = writeBatch(db);
      chunk.forEach((d, i) => batch.set(doc(collection(db, "tasks")), historicalOfferTaskData(d, { createdBy, order: base + start + i })));
      await batch.commit();
      created += chunk.length;
    } catch (e) {
      console.error("importHistoricalOffers: un lote falló:", e);
      failed += chunk.length;
    }
    if (onProgress) onProgress(created + failed, total);
  }
  return { created, failed };
}
