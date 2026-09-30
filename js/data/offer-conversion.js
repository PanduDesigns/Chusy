// ============================================================================
// De oferta a proyecto (v57): la parte que ESCRIBE en Firestore de «Convertir
// en proyecto» (el formulario que se rellena antes está en
// components/project-properties-modal.js, y qué valor de la oferta va a qué
// propiedad, en project-properties.js).
//
// Dos escrituras, en este orden:
//   1. Se crea el proyecto, con sus propiedades ya puestas (incluido el
//      histórico de revisiones de la oferta y `sourceOfferId`, el enlace de
//      vuelta a ella).
//   2. La oferta queda enlazada al proyecto y marcada como completada:
//      `convertedProjectId` + `convertedAt`, más `isComplete`/`completedAt`
//      (una oferta aprobada ya está terminada). No se mueve ni se borra —
//      sigue en Ofertas como registro de qué se aprobó y cuándo.
//
// No son una única operación atómica (son dos documentos y el proyecto tiene
// que existir antes de poder enlazarlo). Si la segunda falla —sin conexión
// justo en ese momento, por ejemplo— el proyecto queda creado igualmente y
// se devuelve `linked: false` para que quien llama lo cuente; NO se deshace
// el proyecto ni se reintenta a solas, porque repetir la conversión daría
// un proyecto duplicado.
// ============================================================================
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { createProject } from "./projects.js";
import { updateTask } from "./tasks.js";

/**
 * @param {{ offer: object, name: string, properties: object, creatorUid: string }} args
 *   `offer` es la tarea de Ofertas tal como está en Firestore (con su `id`);
 *   `properties` ya viene limpio (propertiesForSave).
 * @returns {Promise<{ projectId: string, linked: boolean }>}
 */
export async function convertOfferToProject({ offer, name, properties, creatorUid }) {
  const projectId = await createProject({ name, creatorUid, properties });
  try {
    await updateTask(offer.id, {
      convertedProjectId: projectId,
      convertedAt: serverTimestamp(),
      isComplete: true,
      ...(offer.isComplete ? {} : { completedAt: serverTimestamp() }),
    });
    return { projectId, linked: true };
  } catch (e) {
    console.error("convertOfferToProject: el proyecto se creó pero no se pudo enlazar la oferta:", e);
    return { projectId, linked: false };
  }
}
