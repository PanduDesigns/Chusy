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
//      (una oferta aprobada ya está terminada). No se borra — sigue en
//      Ofertas como registro de qué se aprobó y cuándo; desde la v58 pasa
//      además a la sección «Cerradas» (la de las ofertas ya convertidas),
//      en esa misma escritura.
//
// v70 — el ID: el proyecto HEREDA el ID de la oferta (`offerCode` → `code`, el
// mismo valor), que es lo que une los archivos de Drive de la oferta con los del
// proyecto. Una oferta que por lo que sea no tuviera ID (anterior a la v70 y aún
// sin numerar) recibe uno ahora, y el proyecto el mismo.
//
// v75 — la carpeta de Drive: la carpeta de la oferta (la que se crea al subir su primer archivo, con el
// ID por clave y nombre `YYXXX - Oferta`) ES la del proyecto. Al convertir: el proyecto CONSERVA el
// `driveFolderId` de la oferta, y la carpeta se mueve en Drive de `Ofertas` a `Proyectos` y se renombra a
// `YYXXX - Nombre del proyecto` en una sola operación (moveDriveFolderToProjects): el id de la carpeta no
// cambia y los adjuntos de la oferta —que son ids de archivos de Drive— se van dentro, intactos. Si la oferta
// aún no tenía anotado su `driveFolderId` pero la carpeta existe (v70), se encuentra por el ID y se anota
// en el proyecto y en la oferta. Es de MEJOR ESFUERZO, con tope de tiempo: sin Drive, o si Drive falla o
// tarda, la conversión sigue (el proyecto ya está creado) y se devuelve `folder.status: "failed"`; la
// carpeta se quedará en `Ofertas` hasta que alguien suba un archivo al proyecto, que la pasa a `Proyectos`.
//
// No son una única operación atómica (son dos documentos y el proyecto tiene
// que existir antes de poder enlazarlo). Si la segunda falla —sin conexión
// justo en ese momento, por ejemplo— el proyecto queda creado igualmente y
// se devuelve `linked: false` para que quien llama lo cuente; NO se deshace
// el proyecto ni se reintenta a solas, porque repetir la conversión daría
// un proyecto duplicado.
// ============================================================================
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { createProject, rememberProjectDriveFolder } from "./projects.js";
import { allocateProjectCode } from "./project-codes.js";
import { updateTask } from "./tasks.js";
import { findOffersSection, offerSectionFields, OFFER_SECTION_CLOSED } from "../offers.js";
import { moveDriveFolderToProjects } from "../drive-service.js";

/** Lo que se espera, como mucho, a que Drive mueva la carpeta antes de seguir con la conversión. */
export const FOLDER_MOVE_TIMEOUT_MS = 10000;

/**
 * @param {{ offer: object, name: string, properties: object, creatorUid: string, offersProject?: object, moveFolder?: Function }} args
 *   `offer` es la tarea de Ofertas tal como está en Firestore (con su `id`);
 *   `properties` ya viene limpio (propertiesForSave); `offersProject` (v58,
 *   el proyecto Ofertas) sirve para llevar la oferta a «Cerradas» — sin él,
 *   o si Ofertas ya no tiene esa sección, la oferta se queda donde estaba.
 *   `moveFolder` (v75) es quien mueve la carpeta de Drive; por defecto, la de verdad
 *   (moveDriveFolderToProjects), y solo se cambia en las pruebas.
 * @returns {Promise<{ projectId: string, linked: boolean, folder: { status: string, folderId: string|null } }>}
 *   `folder.status`: "moved" | "renamed" | "unchanged" | "none" | "disabled" | "failed" (ver drive-service.js).
 */
export async function convertOfferToProject({ offer, name, properties, creatorUid, offersProject, moveFolder = moveDriveFolderToProjects }) {
  const code = offer.offerCode || (await allocateProjectCode());
  const knownFolderId = offer.driveFolderId || null;
  const projectId = await createProject({ name, creatorUid, properties, code, driveFolderId: knownFolderId });

  // v75: la carpeta de Drive de la oferta pasa a Proyectos con el nombre del proyecto. Nunca lanza.
  let folder = { status: "none", folderId: null };
  try {
    folder = await moveFolder({ code, name, folderId: knownFolderId }, { timeoutMs: FOLDER_MOVE_TIMEOUT_MS });
  } catch (e) {
    console.warn("convertOfferToProject: la carpeta de Drive no se pudo mover:", e);
    folder = { status: "failed", folderId: null };
  }
  // Si la oferta no tenía anotada su carpeta (es de antes de la v75) y se ha encontrado, se anota en el proyecto
  // (y abajo, en la oferta). Es un extra: si falla, la carpeta se sigue encontrando por el ID.
  const discoveredFolderId = !knownFolderId && folder && folder.folderId ? folder.folderId : null;
  if (discoveredFolderId) {
    try { await rememberProjectDriveFolder(projectId, discoveredFolderId); } catch (e) { console.warn("convertOfferToProject: driveFolderId del proyecto:", e); }
  }

  const closed = offersProject ? findOffersSection(offersProject, OFFER_SECTION_CLOSED) : null;
  try {
    await updateTask(offer.id, {
      convertedProjectId: projectId,
      convertedAt: serverTimestamp(),
      ...(offer.offerCode ? {} : { offerCode: code }),
      ...(discoveredFolderId ? { driveFolderId: discoveredFolderId } : {}),
      isComplete: true,
      ...(offer.isComplete ? {} : { completedAt: serverTimestamp() }),
      ...(closed ? offerSectionFields(offersProject, offer, closed.id) : {}),
    }, offer); // v81: `offer` = cómo estaba, para anotar sectionEnteredAt al pasar a «Cerradas»
    return { projectId, linked: true, folder };
  } catch (e) {
    console.error("convertOfferToProject: el proyecto se creó pero no se pudo enlazar la oferta:", e);
    return { projectId, linked: false, folder };
  }
}

/** El aviso que se enseña al terminar la conversión (el resultado de convertOfferToProject). */
export function conversionMessage({ linked, folder }) {
  const status = folder && folder.status;
  const driveNote =
    status === "moved" || status === "renamed" ? " Su carpeta de Drive pasó a «Proyectos»." :
    status === "failed" ? " No se pudo mover su carpeta de Drive: pasará a «Proyectos» en cuanto alguien suba un archivo al proyecto." :
    "";
  if (!linked) return { text: "Proyecto creado, pero no se pudo marcar la oferta como convertida." + driveNote, kind: "error" };
  return { text: "Proyecto creado a partir de la oferta." + driveNote, kind: status === "failed" ? "error" : "info" };
}
