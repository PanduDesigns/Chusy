// ============================================================================
// ID de oferta y de proyecto (v70): helpers PUROS (sin Firebase ni DOM).
//
// Cada oferta y cada proyecto tiene un ID único con la forma XXXYY (texto, no
// número: lleva ceros a la izquierda):
//   · XXX  el número de orden DENTRO DE SU AÑO: empieza en 000 cada año y sube
//          de uno en uno con cada oferta o proyecto nuevo de ese año (si algún
//          año pasa de 999 simplemente gana una cifra: 1000 → «100026»);
//   · YY   las dos últimas cifras del año en que se creó (26 en 2026).
// Ejemplos: «00026» (el primero de 2026), «00126» (el segundo), «04226»;
// y al empezar 2027, «00027», «00127»…; en 2028, «00028». El ID entero no se
// repite nunca porque el año va dentro; lo que se reinicia es solo el número.
//
// El ID NACE con la oferta (`tasks/{id}.offerCode`) y el proyecto en que se
// convierte lo HEREDA (`projects/{id}.code`, el mismo valor); un proyecto que
// se crea directamente recibe uno nuevo. Quien reparte los números es una
// transacción sobre el contador de su año (data/project-codes.js): el de 2026 es
// `meta/projectCounter` (el de la v70) y los siguientes, `meta/projectCounter-27`,
// `-28`…, que se crean solos la primera vez que se pide un ID de ese año. Aquí
// solo vive lo que no necesita Firebase.
// ============================================================================
import { toDate } from "./utils.js";

/**
 * Con lo que data/project-codes.js avisa de que no pudo repartir un ID. Los formularios que crean
 * ofertas y proyectos lo enseñan tal cual (isIdError) en vez del aviso genérico de «comprueba tu
 * conexión»: el motivo más probable —las reglas de la v70 sin publicar— no tiene que ver con la red.
 */
export const ID_ERROR_MESSAGE = "No se pudo asignar el ID. Comprueba la conexión (y que las reglas de Firestore de la v70 estén publicadas).";
export const isIdError = (e) => !!e && e.message === ID_ERROR_MESSAGE;

/** `seedVersion` del proyecto Ofertas a partir de la cual ya se numeraron las ofertas y proyectos anteriores a la v70. */
export const PROJECT_CODE_SEED = 4;

/**
 * El primer año con IDs: aquel en que se estrenaron (v70). Nada se numera con un año
 * anterior —lo que ya existía se numera como de este año—, y el contador de este año
 * es el `meta/projectCounter` que ya creó la v70, para que su numeración continúe.
 */
export const FIRST_ID_YEAR = 2026;

/** Un ID válido: un número de orden de 3 o más cifras seguido de las 2 del año. */
const CODE_RE = /^(\d{3,})(\d{2})$/;

/** El ID a partir del número de orden y del año (con 4 cifras o con 2: 2026 y 26 dan lo mismo). */
export function formatProjectCode(seq, year) {
  const n = Math.floor(Number(seq));
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Número de orden no válido: ${seq}`);
  const yy = Math.floor(Number(year)) % 100;
  if (!Number.isFinite(yy) || yy < 0) throw new RangeError(`Año no válido: ${year}`);
  return `${String(n).padStart(3, "0")}${String(yy).padStart(2, "0")}`;
}

/** `{ seq, year }` (año de 2 cifras) de un ID, o null si no tiene la forma XXXYY. */
export function parseProjectCode(code) {
  const m = CODE_RE.exec(String(code ?? ""));
  return m ? { seq: Number(m[1]), year: Number(m[2]) } : null;
}

export function isProjectCode(code) {
  return CODE_RE.test(String(code ?? ""));
}

/** El año (4 cifras) de un Date, un Timestamp de Firestore, unos milisegundos o un ISO; `fallback` si no es una fecha. */
export function yearOf(value, fallback = new Date()) {
  const d = value == null ? null : toDate(value);
  const ok = d && !isNaN(d.getTime()) ? d : fallback;
  return ok.getFullYear();
}

/** El año (4 cifras) que lleva el ID de algo creado en `value`: el suyo, pero nunca antes de FIRST_ID_YEAR. */
export function idYear(value, fallback = new Date()) {
  return Math.max(yearOf(value, fallback), FIRST_ID_YEAR);
}

/** El documento de `meta` con el contador de un año: `projectCounter` (2026) o `projectCounter-27`, `-28`… */
export function counterDocId(year) {
  const y = Math.max(Math.floor(Number(year)) || FIRST_ID_YEAR, FIRST_ID_YEAR);
  return y === FIRST_ID_YEAR ? "projectCounter" : `projectCounter-${String(y % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Nombre «con ID» (v75): el formato ÚNICO con el que una oferta o un proyecto lleva su ID por delante
// en un nombre de carpeta —de Drive hoy, y de la carpeta local que se sugiere en la Ubicación—:
// `XXXYY - Nombre`. Un solo helper para que Drive, el renombrado y la Ubicación no se desvíen.
// ---------------------------------------------------------------------------

/** El separador entre el ID y el nombre en `XXXYY - Nombre`. */
export const CODE_NAME_SEPARATOR = " - ";

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * El nombre SIN el ID que lleve por delante, tal como lo habría puesto cualquiera a mano:
 * `00126 - Cabina`, `00126-Cabina`, `00126 Cabina`, `[00126] Cabina`, `(00126): Cabina`.
 * Solo quita el ID que se pide (no otro número) y solo si va al principio y NO pegado a más cifras
 * (`001260 Cabina` no lleva el ID `00126`: es otro número). Quita también cualquier número de
 * repeticiones seguidas (`00126 - 00126 - Cabina`), que es lo que sale de aplicar mal un prefijo dos veces.
 */
export function stripCodePrefix(name, code) {
  let text = String(name ?? "").trim();
  const c = String(code ?? "").trim();
  if (!c) return text;
  const re = new RegExp(`^[\\[(]?\\s*${escapeRegExp(c)}(?!\\d)\\s*[\\])]?\\s*(?:[-–—:_]\\s*)?`);
  for (let guard = 0; guard < 5; guard++) {
    const next = text.replace(re, "").trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/** ¿El nombre ya lleva ese ID por delante (en cualquiera de las formas de stripCodePrefix)? */
export function hasCodePrefix(name, code) {
  const c = String(code ?? "").trim();
  return !!c && stripCodePrefix(name, c) !== String(name ?? "").trim();
}

/**
 * `XXXYY - Nombre`: el nombre con el ID por delante, sin duplicarlo si el nombre ya lo traía
 * (`00126 - Cabina` sigue siendo `00126 - Cabina`; `[00126] Cabina`, también). Sin nombre (o solo
 * el ID), queda el ID solo; sin ID, el nombre tal cual. No limpia caracteres ni recorta la longitud:
 * eso depende de dónde se use (drive-files.js lo hace para Drive).
 */
export function codedName(code, name) {
  const c = String(code ?? "").trim();
  const rest = stripCodePrefix(name, c);
  if (!c) return rest;
  return rest ? `${c}${CODE_NAME_SEPARATOR}${rest}` : c;
}

const msOf = (value) => {
  const d = value == null ? null : toDate(value);
  const ms = d ? d.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Qué numerar y en qué orden: lo que de verdad existía antes de la v70 (o se
 * quedó sin ID por cualquier motivo, p. ej. una tarea restaurada de la Papelera).
 *
 * `projects`: todos los proyectos (también los archivados). `offers`: las tareas
 * de Ofertas. Un proyecto nacido de una oferta (`properties.sourceOfferId`) y su
 * oferta son UNA sola cosa y comparten el ID, así que forman una sola «entidad»;
 * lo demás va cada uno por su lado. Los proyectos exclusivos (el propio Ofertas)
 * no llevan ID.
 *
 * Las entidades salen por orden de creación —la más antigua recibe el primer
 * número de su año—, las que no tienen fecha al final. Cada una se numera con el
 * año de su creación (`idYear`: lo anterior a 2026 cuenta como 2026), y cada año
 * tiene su propia numeración desde 000. Si alguna parte de la entidad ya
 * tiene ID (un recorrido anterior que se quedó a medias), se reutiliza en vez
 * de gastar otro número.
 *
 * @returns {{ existingCode: string|null, createdMs: number|null, year: number|null, // year: 4 cifras, ≥ 2026
 *            targets: { kind: "offer"|"project", id: string, field: "offerCode"|"code" }[] }[]}
 */
export function planCodeBackfill({ projects = [], offers = [] }) {
  const offerIds = new Set(offers.map((o) => o.id));
  const projectsByOffer = new Map();
  const standalone = [];
  for (const p of projects) {
    if (p.exclusive) continue;
    const source = p.properties && p.properties.sourceOfferId;
    if (source && offerIds.has(source)) {
      if (!projectsByOffer.has(source)) projectsByOffer.set(source, []);
      projectsByOffer.get(source).push(p);
    } else {
      standalone.push(p);
    }
  }

  const entities = [
    ...offers.map((o) => [{ kind: "offer", doc: o }, ...(projectsByOffer.get(o.id) || []).map((p) => ({ kind: "project", doc: p }))]),
    ...standalone.map((p) => [{ kind: "project", doc: p }]),
  ];

  const codeOf = (item) => (item.kind === "offer" ? item.doc.offerCode : item.doc.code);
  const plan = [];
  for (const items of entities) {
    const missing = items.filter((i) => !codeOf(i));
    if (!missing.length) continue;
    const dates = items.map((i) => msOf(i.doc.createdAt)).filter((ms) => ms != null);
    const createdMs = dates.length ? Math.min(...dates) : null;
    plan.push({
      existingCode: items.map(codeOf).find(Boolean) || null,
      createdMs,
      year: createdMs == null ? null : idYear(createdMs),
      targets: missing.map((i) => ({ kind: i.kind, id: i.doc.id, field: i.kind === "offer" ? "offerCode" : "code" })),
    });
  }

  plan.sort((a, b) => {
    if (a.createdMs !== b.createdMs) {
      if (a.createdMs == null) return 1;
      if (b.createdMs == null) return -1;
      return a.createdMs - b.createdMs;
    }
    return String(a.targets[0].id).localeCompare(String(b.targets[0].id));
  });
  return plan;
}

/**
 * El ID de una oferta cuyo formulario sigue abierto, repartido cuando hace falta
 * y UNA sola vez: varias subidas de archivos a la vez comparten la misma petición
 * en vez de gastar un número cada una, y si falla se puede volver a pedir.
 *
 *   get()       el ID que ya tiene (o null)
 *   canAllocate()  ¿se le puede dar uno ahora? (false = no es el momento)
 *   allocate()  pide uno nuevo (Promise<string>)
 *   onAllocated(code)  se llama al recibirlo, para guardarlo y pintarlo
 *
 * Devuelve `() => Promise<string|null>`; null si no tiene y no se le puede dar
 * uno (o si la petición falló: el motivo se deja en la consola).
 */
export function createCodeResolver({ get, canAllocate, allocate, onAllocated }) {
  let pending = null;
  return function resolve() {
    const have = get();
    if (have) return Promise.resolve(have);
    if (!canAllocate()) return Promise.resolve(null);
    if (!pending) {
      pending = Promise.resolve()
        .then(allocate)
        .then((code) => {
          onAllocated(code);
          return code;
        })
        .catch((e) => {
          console.error("ID de la oferta:", e);
          pending = null;
          return null;
        });
    }
    return pending;
  };
}
