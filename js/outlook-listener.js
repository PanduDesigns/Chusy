// ============================================================================
// Oferta desde Outlook (v61): la parte de Chusy que atiende a la macro.
//
// Mientras Chusy está abierto con la sesión iniciada, este archivo escucha en
// Firestore las peticiones que la macro de Outlook deja para el correo de la
// cuenta (colección `offerInbox`, ver data/outlook-inbox.js). Cuando llega una:
//
//   1. se la queda (transacción: con Chusy abierto en dos pestañas, solo una);
//   2. mira qué ofertas hay ya y monta la nueva (outlook-offer.js);
//   3. la crea con el mismo createTask que usa «+ Nueva oferta»;
//   4. apunta el resultado en la petición — es lo que la macro está leyendo
//      para decirle a quien la lanzó si salió bien — y avisa con un toast.
//
// Las peticiones que ya estaban ahí al abrir la sesión NO se atienden (se
// borran al cabo de un minuto): la oferta solo se crea si Chusy estaba abierto
// cuando se lanzó la macro. La macro, por su parte, borra la petición si nadie
// la atiende.
// ============================================================================
import {
  subscribeToOutlookRequests,
  claimOutlookRequest,
  finishOutlookRequest,
  deleteOutlookRequest,
  fetchOfferTitles,
} from "./data/outlook-inbox.js";
import { getOffersProject, isProjectVisibleToUser } from "./data/projects.js";
import { createTask } from "./data/tasks.js";
import { planOfferFromRequest } from "./outlook-offer.js";
import { showToast, uid } from "./utils.js";

/** Identifica esta pestaña (para saber quién se quedó cada petición). */
const SESSION_ID = uid();
/**
 * Cuánto se espera antes de borrar una petición que la macro no recogió: la
 * que acaba de atenderse aquí y las que ya estaban al abrir la sesión. El
 * retraso (la macro espera 10 s como mucho) evita borrar una petición que otra
 * pestaña o la propia macro todavía están usando.
 */
const CLEANUP_DELAY_MS = 60000;

let stopListening = null;
let listeningFor = "";

/**
 * Empieza a escuchar para esta cuenta. Se puede llamar en cada `bootstrap()`
 * (que se repite cada vez que cambia el perfil): si ya se está escuchando para
 * la misma cuenta no hace nada — reiniciar la escucha trataría como «restos»
 * una petición que acabara de llegar.
 */
export function startOutlookListener({ user, getCommercialOptions }) {
  const email = String((user && user.email) || "").trim().toLowerCase();
  if (!email) return;
  const identity = `${user.uid}|${email}`;
  if (stopListening && listeningFor === identity) return;
  stopOutlookListener();
  listeningFor = identity;
  stopListening = subscribeToOutlookRequests(email, ({ isFirst, all, added }) => {
    if (isFirst) {
      // Restos de macros anteriores (o una petición que otra pestaña está
      // atendiendo ahora mismo): no se atienden, y se borran más tarde.
      all.forEach((request) => setTimeout(() => deleteOutlookRequest(request.id), CLEANUP_DELAY_MS));
      return;
    }
    added
      .filter((request) => request.status === "pending")
      .forEach((request) => handleOutlookRequest(request, { user, getCommercialOptions }));
  });
}

export function stopOutlookListener() {
  if (stopListening) stopListening();
  stopListening = null;
  listeningFor = "";
}

/** Atiende una petición. No lanza nunca: cualquier fallo se apunta en la petición y sale en un toast. */
export async function handleOutlookRequest(request, { user, getCommercialOptions }) {
  if (!(await claimOutlookRequest(request.id, SESSION_ID))) return; // otra pestaña se la quedó

  const fail = async (message) => {
    await finishOutlookRequest(request.id, { status: "error", message });
    showToast(`Outlook: ${message}`, "error");
  };

  try {
    const offers = getOffersProject();
    if (!offers) return await fail("la sección Ofertas todavía no existe en Chusy.");
    if (!isProjectVisibleToUser(offers, user)) return await fail("tu cuenta no tiene acceso a la sección Ofertas.");

    const plan = planOfferFromRequest({
      request,
      offersProject: offers,
      existingTitles: await fetchOfferTitles(offers.id),
      commercialOptions: getCommercialOptions(),
      now: new Date(),
      userId: user.uid,
      makeId: uid,
    });
    if (!plan.ok) return await fail(plan.message);

    const taskId = await createTask(offers.id, plan.data);
    await finishOutlookRequest(request.id, {
      status: "created",
      taskId,
      finalName: plan.finalName,
      message: plan.renamed ? "Ya existía una oferta con ese nombre: se le ha añadido la fecha." : "",
    });
    showToast(
      plan.renamed
        ? `Oferta «${plan.finalName}» creada desde Outlook (ya existía una con ese nombre: se ha añadido la fecha).`
        : `Oferta «${plan.finalName}» creada desde Outlook.`
    );
  } catch (err) {
    console.error("handleOutlookRequest:", err);
    await fail("no se pudo crear la oferta. Créala a mano o inténtalo de nuevo.");
  } finally {
    // La macro suele borrarla nada más leer el resultado; esto es el seguro
    // por si se cerró Outlook antes (la petición lleva el texto del correo).
    setTimeout(() => deleteOutlookRequest(request.id), CLEANUP_DELAY_MS);
  }
}
