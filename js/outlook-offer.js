// ============================================================================
// Oferta desde Outlook (v61): helpers PUROS (sin Firebase ni DOM) de lo que
// pasa cuando la macro de Outlook «Crear carpeta de proyecto» (assets/outlook/
// CrearCarpetaProyecto.bas) avisa a Chusy de que hay una oferta nueva.
//
// El recorrido completo está en el README (apartado «Oferta desde Outlook»);
// aquí solo vive la parte que no necesita red ni pantalla y que, por eso, se
// puede probar sola:
//
//   · convertir el texto del correo en la descripción de la oferta;
//   · decidir el nombre final (si ya hay una oferta con ese nombre, se le
//     añade la fecha para diferenciarlas);
//   · ajustar el Comercial a como ya lo escribe el equipo (mayúsculas,
//     tildes… — la misma regla de sugerencias de la v57);
//   · montar los datos de la tarea tal como los guardaría el formulario de
//     «+ Nueva oferta»: sección «Nuevas», versión A1, su fila «Versión
//     original» del histórico y, desde la v63, el Sector que le toca al
//     departamento de quien recibe la petición.
//
// Quien lee y escribe en Firestore es outlook-listener.js (con
// data/outlook-inbox.js); este archivo no genera ids ni lee el reloj: se los
// pasa quien lo llama.
// ============================================================================
import { escapeHtml } from "./utils.js";
import {
  isOffersProject,
  suggestionKey,
  cleanSuggestionText,
  findOffersSection,
  findOfferVersionField,
  findOfferCommercialField,
  findOfferLocationField,
  defaultSectorValue,
  makeOriginalRevision,
  OFFER_FIRST_VERSION,
} from "./offers.js";

/** Tope de caracteres del texto del correo (las reglas de Firestore exigen lo mismo — ver `offerInbox` en firestore.rules). */
export const OUTLOOK_DESCRIPTION_MAX = 100000;
/** Tope del nombre de la oferta (mismo límite en las reglas). */
export const OUTLOOK_NAME_MAX = 300;

/**
 * El texto plano de un correo convertido en HTML seguro para la descripción:
 * las líneas en blanco separan párrafos y un salto de línea suelto pasa a
 * `<br>`. Todo el texto se escapa SIEMPRE (a diferencia de toEditableHtml, de
 * utils.js, que deja pasar como HTML cualquier texto con pinta de etiqueta:
 * un correo que enseñe código con «<div>» no debe pintarse como marcado).
 */
export function plainTextToHtml(text) {
  let t = String(text ?? "").replace(/\r\n?/g, "\n");
  if (t.length > OUTLOOK_DESCRIPTION_MAX) t = `${t.slice(0, OUTLOOK_DESCRIPTION_MAX).trimEnd()}…`;
  t = t.replace(/[^\S\n]+(?=\n|$)/g, "").trim(); // espacios (también los duros) al final de cada línea
  if (!t) return "";
  return t
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Clave para saber si dos títulos son «el mismo nombre»: sin marcas de negrita (**), tildes, mayúsculas ni espacios de más. */
export function offerTitleKey(title) {
  return suggestionKey(String(title ?? "").replace(/\*\*/g, ""));
}

const pad2 = (n) => String(n).padStart(2, "0");

/** dd/mm/aaaa — la fecha que se añade al nombre repetido. */
export function formatNameDate(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** dd/mm/aaaa hh:mm — solo si ya hay una oferta con el nombre y la fecha de hoy. */
export function formatNameDateTime(date) {
  return `${formatNameDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * El nombre con el que se crea la oferta. Si ya existe otra con ese nombre
 * (sin mirar mayúsculas, tildes, espacios ni negritas) se le añade a
 * continuación la fecha de hoy: «PROYECTO X (02/10/2026)». En el caso
 * rarísimo de que también exista esa, se añade la hora y, si aun así
 * estuviera cogido, un número. Devuelve `{ name, renamed }`.
 */
export function uniqueOfferName(name, existingTitles, now) {
  const taken = new Set((existingTitles || []).map(offerTitleKey));
  const base = cleanSuggestionText(name);
  if (!taken.has(offerTitleKey(base))) return { name: base, renamed: false };

  const withDate = `${base} (${formatNameDate(now)})`;
  if (!taken.has(offerTitleKey(withDate))) return { name: withDate, renamed: true };

  const withTime = `${base} (${formatNameDateTime(now)})`;
  if (!taken.has(offerTitleKey(withTime))) return { name: withTime, renamed: true };

  for (let i = 2; i < 1000; i++) {
    const candidate = `${withTime} (${i})`;
    if (!taken.has(offerTitleKey(candidate))) return { name: candidate, renamed: true };
  }
  return { name: `${withTime} (${now.getTime()})`, renamed: true }; // inalcanzable en la práctica
}

/**
 * El Comercial escrito como ya lo escribe el equipo: si coincide con una
 * opción existente salvo por mayúsculas, tildes o espacios («GABI» ↔ «Gabi»)
 * se usa la forma de la lista (misma regla de ajuste que text-suggest.js, v57);
 * si no se parece a ninguna, se deja como llega, solo con los espacios en orden.
 */
export function snapToOption(value, options) {
  const typed = cleanSuggestionText(value);
  if (!typed) return "";
  const key = suggestionKey(typed);
  return (options || []).find((o) => suggestionKey(o) === key) || typed;
}

/**
 * Los datos de la oferta que se crea a partir de la petición de Outlook
 * (`request`: name, location, commercial, description — ver la colección
 * `offerInbox`), listos para `createTask`. Devuelve
 *   { ok: true, data, finalName, renamed }   o   { ok: false, message }.
 *
 * Sale igual que una oferta creada a mano con «+ Nueva oferta»: sección
 * «Nuevas», versión A1, el histórico con su primera fila «Versión
 * original» y el Sector por defecto del departamento de quien la recibe
 * (`defaultSector`: «Industria», «Automoción» o vacío — v63; ver
 * departments.js). Un campo que alguien haya borrado del proyecto Ofertas
 * (Versión, Comercial, Ubicación, Sector) simplemente no se rellena.
 *
 * @param {object} p
 * @param {object} p.request          la petición tal como llegó
 * @param {object} p.offersProject    el proyecto Ofertas (con sections y customFieldDefs)
 * @param {string[]} p.existingTitles títulos de las ofertas que ya hay
 * @param {string[]} p.commercialOptions valores de Comercial que ya usa el equipo
 * @param {Date} p.now
 * @param {string} p.userId           quien recibe la petición (será `createdBy`)
 * @param {string} [p.defaultSector]  el Sector por defecto de su departamento ("" si no tiene)
 * @param {() => string} p.makeId     genera el id de la fila del histórico
 */
export function planOfferFromRequest({ request, offersProject, existingTitles, commercialOptions, now, userId, makeId, defaultSector }) {
  if (!isOffersProject(offersProject)) {
    return { ok: false, message: "La sección Ofertas todavía no existe en Chusy (entra una vez como administrador)." };
  }
  const requested = cleanSuggestionText(request && request.name).slice(0, OUTLOOK_NAME_MAX);
  if (!requested) return { ok: false, message: "La petición de Outlook no traía el nombre de la oferta." };

  const { name, renamed } = uniqueOfferName(requested, existingTitles, now);

  const customFields = {};
  const versionField = findOfferVersionField(offersProject);
  if (versionField) customFields[versionField.id] = OFFER_FIRST_VERSION;

  const commercialField = findOfferCommercialField(offersProject);
  const commercial = snapToOption(request.commercial, commercialOptions);
  if (commercialField && commercial) customFields[commercialField.id] = commercial;

  const locationField = findOfferLocationField(offersProject);
  const location = String(request.location ?? "").trim();
  if (locationField && location) customFields[locationField.id] = location;

  const sector = defaultSectorValue(offersProject, defaultSector);
  if (sector) customFields[sector.fieldId] = sector.value;

  const nuevas = findOffersSection(offersProject, "nuevas");

  return {
    ok: true,
    finalName: name,
    renamed,
    data: {
      title: name,
      description: plainTextToHtml(request.description),
      sectionId: nuevas ? nuevas.id : null,
      customFields,
      revisions: [makeOriginalRevision({ id: makeId(), createdAt: now.toISOString() })],
      ownerId: null,
      createdBy: userId,
      order: now.getTime(),
    },
  };
}

// ----------------------------------------------------------------------------
// Clave compartida con la macro
// ----------------------------------------------------------------------------

const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Una clave aleatoria de 32 caracteres (letras y números, sin símbolos que
 * den problemas al pegarla dentro de la macro). `getRandomValues` es el de
 * `crypto` — se pasa de fuera para poder probarla. Rechaza los bytes que
 * darían más probabilidad a unos caracteres que a otros.
 */
export function generateOutlookKey(getRandomValues) {
  const limit = 256 - (256 % KEY_ALPHABET.length); // 248
  let key = "";
  while (key.length < 32) {
    const bytes = getRandomValues(new Uint8Array(48));
    for (const b of bytes) {
      if (b < limit && key.length < 32) key += KEY_ALPHABET[b % KEY_ALPHABET.length];
    }
  }
  return key;
}

/**
 * Las tres líneas que se pegan al principio de la macro, ya escritas (las
 * muestra «Conexión con Outlook»). `apiKey` es la de firebase-config.js — no
 * es secreta, la macro solo la usa si Google rechaza la petición sin ella.
 */
export function macroConstantsBlock({ projectId, apiKey, key }) {
  return [
    `Private Const CHUSY_PROJECT_ID As String = "${projectId}"`,
    `Private Const CHUSY_API_KEY As String = "${apiKey}"`,
    `Private Const CHUSY_CLAVE As String = "${key}"`,
  ].join("\n");
}
