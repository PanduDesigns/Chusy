// ============================================================================
// «Convertir en oferta» (v64): el flujo que comparten el clic derecho de una
// tarea (list-view.js, openTaskContextMenu — lo usan también Tablero, Mis
// tareas y la línea de tiempo) y el menú «···» de la selección múltiple
// (bulk-toolbar.js). Aquí vive lo que es común: quién ve la opción, la
// confirmación y el aviso final. Qué se escribe en cada tarea está en
// planTaskToOffer (offers.js) y la escritura en lote en bulkConvertToOffers
// (data/tasks.js).
//
// Solo se ofrece a quien tiene acceso a Ofertas (admin o un departamento
// con acceso, ver isProjectVisibleToUser): convertir una tarea en oferta la
// saca de su proyecto, y quien no ve Ofertas no podría volver a verla.
// El Sector sale del departamento de quien convierte, con la misma regla
// que al crear una oferta a mano o desde Outlook (defaultSectorOf).
// ============================================================================
import { showToast, plainTitleText, getTaskProjectIds } from "../utils.js";
import { getOffersProject, isProjectVisibleToUser } from "../data/projects.js";
import { bulkConvertToOffers } from "../data/tasks.js";
import { canBecomeOffer, defaultSectorValue, offerLocationFromDescription } from "../offers.js";
import { defaultSectorOf } from "../departments.js";

/**
 * De estas tareas, las que `currentUser` puede convertir en oferta: todas
 * las que aún no lo son — o ninguna si todavía no existe Ofertas o esa
 * persona no tiene acceso a ella. Con una lista vacía, no se ofrece la
 * acción.
 */
export function convertibleToOffers(tasks, currentUser) {
  const offersProject = getOffersProject();
  if (!offersProject || !isProjectVisibleToUser(offersProject, currentUser)) return [];
  return (tasks || []).filter((t) => canBecomeOffer(offersProject, t));
}

/**
 * El texto de la confirmación: qué va a pasar con estas tareas (`sector` = el
 * que se les pondrá, "" si ninguno; `locations` = las Ubicaciones que se
 * tomarán de las descripciones, una por cada tarea que tenga una ruta).
 */
function confirmText(todo, { sector, skipped, locations }) {
  const n = todo.length;
  const one = n === 1;
  const personal = todo.filter((t) => !getTaskProjectIds(t).length).length;
  const leaving = n - personal;
  const lines = [one ? `¿Convertir «${plainTitleText(todo[0].title)}» en una oferta?` : `¿Convertir ${n} tareas en ofertas?`, ""];
  lines.push(`• Destino: la sección «Nuevas» de Ofertas (las ya completadas, a «Entregadas»).`);
  if (sector) lines.push(`• Sector: ${sector}, el de tu departamento.`);
  if (locations.length) lines.push(one ? `• Ubicación: ${locations[0]} (la ruta escrita en su descripción).` : `• Ubicación: la ruta escrita en la descripción, en ${locations.length} de ${n}.`);
  if (leaving) lines.push(one ? "• Se quita de su proyecto actual." : `• ${leaving === 1 ? "Una se quita" : `${leaving} se quitan`} de ${leaving === 1 ? "su proyecto actual" : "sus proyectos actuales"}.`);
  if (personal) lines.push(one ? "• Deja de ser una tarea personal." : `• ${personal === 1 ? "Una deja" : `${personal} dejan`} de ser ${personal === 1 ? "personal" : "personales"}.`);
  if (skipped) lines.push("", `(${skipped === 1 ? "Una de las seleccionadas ya es una oferta y no se toca" : `${skipped} de las seleccionadas ya son ofertas y no se tocan`}.)`);
  return lines.join("\n");
}

/**
 * Convierte en ofertas las tareas que se puedan, tras pedir confirmación
 * (cambia dónde vive cada tarea, y no hay «deshacer»). Avisa del resultado
 * con un toast, que nombra el Sector puesto si lo hubo. Las vistas se
 * actualizan solas con el listener en tiempo real.
 */
export async function convertToOffers(tasks, currentUser) {
  const todo = convertibleToOffers(tasks, currentUser);
  if (!todo.length) { showToast("Esas tareas ya son ofertas."); return; }
  const skipped = (tasks || []).length - todo.length;
  const defaultSector = defaultSectorOf(currentUser && currentUser.department);
  const sectorValue = defaultSectorValue(getOffersProject(), defaultSector);
  const sector = sectorValue ? sectorValue.value : "";
  const locations = todo.map((t) => offerLocationFromDescription(getOffersProject(), t)).filter(Boolean);

  if (!confirm(confirmText(todo, { sector, skipped, locations }))) return;
  try {
    const { converted } = await bulkConvertToOffers(todo, { defaultSector });
    const what = converted === 1 ? "Convertida en oferta" : `${converted} tareas convertidas en ofertas`;
    const where = !locations.length ? "" : converted === 1 ? " · Ubicación tomada de la descripción" : ` · Ubicación tomada de la descripción en ${locations.length}`;
    showToast(`${what}${sector ? ` · Sector ${sector}` : ""}${where}.`);
  } catch (err) {
    console.error(err);
    showToast("No se pudo convertir en oferta. Inténtalo de nuevo.", "error");
  }
}
