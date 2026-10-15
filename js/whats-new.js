// ============================================================================
// Novedades de Chusy (v67): lo que cada versión trae, escrito para quien USA la
// app (no para quien la programa), y la lógica de quién debe enterarse de qué.
//
// CÓMO SE AÑADE UNA NOVEDAD: una entrada nueva ARRIBA de RELEASES con el número
// de versión (`id`, el de Chusy-N.zip: tiene que ser MAYOR que todos los
// anteriores), su fecha, un título corto y una o varias frases (`items`).
// Al publicar esa versión, cada persona recibe UNA notificación en la campana
// («Novedades de Chusy») la próxima vez que entra, y la lee con un clic; también
// se puede releer desde el menú del nombre → «Novedades de Chusy». Una versión
// sin nada que contar a nadie (un arreglo interno) no necesita entrada.
//
// Quién ve qué: cada cuenta guarda en su perfil `newsSeen` (el id de la última
// versión de la que ya se le avisó) y solo se le avisa de las posteriores. Una
// cuenta creada DESPUÉS de la fecha de una versión no se entera de ella — para
// una persona nueva no es una novedad. (Las cuentas que ya existían cuando se
// estrenó esta función no tienen `newsSeen`, y por eso se avisa a todas las
// anteriores a la fecha de cada entrada.)
//
// Este archivo es puro (sin Firebase ni DOM); quien escribe la notificación es
// announceNews en data/notifications.js, y quien la enseña, el modal
// components/whats-new-modal.js.
// ============================================================================
import { toDate } from "./utils.js";

export const RELEASES = [
  {
    id: 68,
    date: "2026-10-14",
    title: "Archivos en las tareas",
    items: [
      "Las tareas y las ofertas pueden llevar archivos —imágenes, vídeos, PDF, planos…—: arrastra los archivos a la sección «Archivos» de la tarea, elígelos o pega una captura con Ctrl+V. Pulsa un archivo para verlo (imagen, vídeo, audio y PDF) o descargarlo.",
      "La sección aparece en cuanto un administrador activa el almacenamiento: los archivos se guardan en el Google Drive de la empresa. Mientras una tarea está en la Papelera sus archivos se conservan; al eliminarla para siempre, también se van.",
    ],
  },
  {
    id: 67,
    date: "2026-10-09",
    title: "Deshacer, Papelera y Novedades",
    items: [
      "Deshacer: tras mover, asignar, cambiar fechas, completar o convertir tareas (y tras eliminar) sale un aviso con el botón «Deshacer» durante 10 segundos.",
      "Papelera (en la barra lateral): lo que elimines —tareas y proyectos— se guarda 30 días. Puedes restaurarlo o eliminarlo para siempre. Cada persona ve lo que ha eliminado ella; los admins, lo de todo el equipo.",
      "Novedades: este aviso. Cada versión nueva te lo contará aquí, y puedes volver a leerlo desde el menú de tu nombre → «Novedades de Chusy».",
    ],
  },
  {
    id: 66,
    date: "2026-10-07",
    title: "Chusy descarga menos datos al entrar",
    items: [
      "Para no agotar el cupo diario de lecturas del plan gratuito, Chusy ya no baja las tareas de todos los proyectos al entrar: las pide cuando abres un proyecto, la línea de tiempo global, Métricas o el buscador.",
      "Por eso, la primera vez de cada sesión que abras la línea de tiempo global, Métricas, el buscador (Ctrl+K) o Archivo, verás «Cargando…» unos segundos. Después van al instante.",
    ],
  },
  {
    id: 65,
    date: "2026-10-07",
    title: "La Ubicación se toma de la descripción",
    items: [
      "Al convertir una tarea en oferta, si en su descripción hay escrita una ruta de carpeta (Z:\\…, \\\\servidor\\…), esa ruta pasa a ser la Ubicación de la oferta.",
    ],
  },
  {
    id: 64,
    date: "2026-10-06",
    title: "Convertir tareas en ofertas",
    items: [
      "Clic derecho en una tarea → «Convertir en oferta», o «···» → «Convertir en ofertas» con varias seleccionadas. Solo lo ve quien tiene acceso a Ofertas.",
      "La tarea pasa a Ofertas, a «Nuevas» (o a «Entregadas» si ya estaba completada), con versión A1 y el Sector de tu departamento.",
    ],
  },
];

/** El día (AAAA-MM-DD) en que se creó una cuenta, o null si no se sabe. */
function accountDay(createdAt) {
  const d = toDate(createdAt);
  return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/**
 * Las entradas de `releases` de las que a esta persona aún no se le ha avisado:
 * las posteriores a su `newsSeen` y no anteriores a la creación de su cuenta.
 * `profile` es su perfil (`newsSeen`, `createdAt`). Más reciente primero.
 */
export function unseenReleases(releases, profile) {
  const seen = Number(profile && profile.newsSeen) || 0;
  const day = accountDay(profile && profile.createdAt);
  return releases.filter((r) => r.id > seen && (!day || r.date >= day)).sort((a, b) => b.id - a.id);
}

/** Las entradas con id entre `fromId` y `toId`, ambos incluidos, más reciente primero (lo que cuenta una notificación que abarca varias versiones). */
export function releasesBetween(releases, fromId, toId) {
  return releases.filter((r) => r.id >= fromId && r.id <= toId).sort((a, b) => b.id - a.id);
}

/**
 * Id del documento de la notificación de novedades: fijo por versión y persona,
 * así que avisar dos veces (dos pestañas a la vez) escribe el mismo documento en
 * vez de crear un duplicado.
 */
export function newsNotificationId(uid, latestId) {
  return `news-${latestId}-${uid}`;
}
