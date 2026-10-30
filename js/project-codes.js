// ============================================================================
// ID de oferta y de proyecto: helpers PUROS (sin Firebase ni DOM).
//
// v82: el formato pasa de XXXYY (v70) a YYXXX. Cada oferta y cada proyecto tiene un ID único
// de texto (lleva ceros) con la forma YYXXX:
//   · YY   las dos últimas cifras del año en que se creó (26 en 2026) — va PRIMERO para que al ordenar
//          alfabéticamente las carpetas (Explorador, Google Drive) salgan por año y, dentro del año,
//          por orden de creación;
//   · XXX  el número de orden DENTRO DE SU AÑO (3 cifras con ceros a la izquierda; si algún año pasa
//          de 999 simplemente gana una cifra —1000 → «261000»— sin truncar nada).
// Ejemplos: «26000», «26001», «26014»…; al empezar 2027, «27000», «27001»… El ID entero no se repite
// nunca porque el año va dentro; lo que se reinicia cada año es solo el número de orden.
//
// El formato ANTERIOR (v70–v81) era XXXYY: «00126» = el segundo (seq 1) de 2026. Esos IDs siguen
// reconociéndose (isLegacyCode, convertLegacyCodeToYYXXX, legacyCodeOf) porque hay datos en producción
// y carpetas de Drive que aún los llevan: migrateLegacyCodesToYYXXX (data/project-codes.js) los pasa a
// YYXXX una sola vez («00126» → «26001») y los nombres «00126 - Cliente» se reescriben a «26001 - Cliente»
// sin duplicar nunca el prefijo (stripCodePrefix quita el ID nuevo Y su equivalente antiguo).
//
// El ID NACE con la oferta (`tasks/{id}.offerCode`) y el proyecto en que se convierte lo HEREDA
// (`projects/{id}.code`, el mismo valor); un proyecto que se crea directamente recibe uno nuevo. Quien
// reparte los números es una transacción sobre el contador de su año (data/project-codes.js): el de 2026
// es `meta/projectCounter` (el de la v70, que además guarda `formatVersion: 'YYXXX'` cuando la
// migración termina) y los siguientes, `meta/projectCounter-27`, `-28`…, que se crean solos la primera
// vez que se pide un ID de ese año. Aquí solo vive lo que no necesita Firebase.
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

/** `meta/projectCounter.formatVersion` cuando la migración XXXYY → YYXXX ya se hizo (v82). */
export const CODE_FORMAT_VERSION = "YYXXX";

/** Los dos últimos dígitos del primer año con IDs (26): un YYXXX nunca empieza por un año anterior. */
const FIRST_YY = FIRST_ID_YEAR % 100;

/** Un ID válido (YYXXX): 2 cifras de año (≥ 26) seguidas de un número de orden de 3 o más cifras. */
const CODE_RE = /^(\d{2})(\d{3,})$/;

/** Un ID del formato ANTERIOR (XXXYY): 3 cifras de número de orden seguidas de las 2 del año. */
const LEGACY_RE = /^(\d{3})(\d{2})$/;

/** El ID a partir del número de orden y del año (con 4 cifras o con 2: 2026 y 26 dan lo mismo): primero YY, después XXX. */
export function formatProjectCode(seq, year) {
  const n = Math.floor(Number(seq));
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Número de orden no válido: ${seq}`);
  const yy = Math.floor(Number(year)) % 100;
  if (!Number.isFinite(yy) || yy < 0) throw new RangeError(`Año no válido: ${year}`);
  return `${String(yy).padStart(2, "0")}${String(n).padStart(3, "0")}`;
}

/** `{ seq, year }` (año de 4 cifras: 2000 + YY) de un ID YYXXX, o null si no tiene esa forma (o su año es anterior a 2026). */
export function parseProjectCode(code) {
  const m = CODE_RE.exec(String(code ?? ""));
  if (!m || Number(m[1]) < FIRST_YY) return null;
  return { seq: Number(m[2]), year: 2000 + Number(m[1]) };
}

/** ¿Es un ID con el formato nuevo (YYXXX)? Un «00126» del formato antiguo NO lo es (su «año» sería 00). */
export function isProjectCode(code) {
  return parseProjectCode(code) !== null;
}

/**
 * ¿Es un ID del formato ANTERIOR (XXXYY)? Cinco cifras cuyas dos últimas son un año con IDs
 * (25 o 26, o `expectedYear` si es mayor) y cuyas tres primeras NO empiezan ya por un año válido
 * (las tres primeras de un XXXYY real de hoy son «0xx»: aún no hay cien ofertas y proyectos por año).
 * El caso ambiguo —«26026» podría ser seq 260 del 26 (antiguo) o seq 026 del 26 (nuevo)— se
 * resuelve como NUEVO, porque el antiguo con 260 ofertas en un año no existe en producción.
 */
export function isLegacyCode(code, expectedYear = 26) {
  const m = LEGACY_RE.exec(String(code ?? ""));
  if (!m) return false;
  const yearEnd = Number(m[2]);
  const maxYY = Math.max(FIRST_YY, Number(expectedYear) % 100 || FIRST_YY);
  if (yearEnd < 25 || yearEnd > maxYY) return false;
  const leadingYY = Number(String(code).slice(0, 2));
  return !(leadingYY >= FIRST_YY && leadingYY <= maxYY);
}

/**
 * Convierte un ID antiguo XXXYY a YYXXX (`00126` → `26001`, `01426` → `26014`). Un ID que ya es YYXXX
 * (o cualquier otra cosa) se devuelve tal cual. El año del resultado es el que llevaba el ID antiguo; un
 * antiguo que acabara en 25 —no existe en producción: los IDs nacieron en 2026— se numera como de 2026,
 * igual que ya hacía la v70 con lo anterior a 2026 (idYear). `expectedYear` (26 por defecto; el de hoy en
 * la migración) solo acota qué se considera un ID antiguo (isLegacyCode).
 */
export function convertLegacyCodeToYYXXX(code, expectedYear = 26) {
  const text = String(code ?? "").trim();
  if (!isLegacyCode(text, expectedYear)) return text;
  const m = LEGACY_RE.exec(text);
  return formatProjectCode(Number(m[1]), Math.max(FIRST_YY, Number(m[2])));
}

/**
 * El inverso de convertLegacyCodeToYYXXX: el ID que tenía en el formato antiguo un YYXXX (`26001` →
 * `00126`), o "" si no se puede (número de orden de más de 3 cifras, año distinto de 25/26…). Sirve
 * para reconocer lo que aún lleve el ID viejo —el nombre de una carpeta de Drive o de la Ubicación,
 * su clave `c:00126`— cuando se pide con el nuevo.
 */
export function legacyCodeOf(code) {
  const parsed = parseProjectCode(code);
  if (!parsed || parsed.seq > 999) return "";
  const legacy = `${String(parsed.seq).padStart(3, "0")}${String(parsed.year % 100).padStart(2, "0")}`;
  return isLegacyCode(legacy, parsed.year % 100) ? legacy : "";
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
// `YYXXX - Nombre` (v82; antes `XXXYY - Nombre`). Un solo helper para que Drive, el renombrado y la
// Ubicación no se desvíen.
// ---------------------------------------------------------------------------

/** El separador entre el ID y el nombre en `YYXXX - Nombre`. */
export const CODE_NAME_SEPARATOR = " - ";

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Una pasada: quita del principio de `text` UNO de los IDs de `codes` (con sus adornos: corchetes, guion…); null si ninguno va delante. */
function stripOnePrefix(text, codes) {
  for (const c of codes) {
    const re = new RegExp(`^[\\[(]?\\s*${escapeRegExp(c)}(?!\\d)\\s*[\\])]?\\s*(?:[-–—:_]\\s*)?`);
    const next = text.replace(re, "").trim();
    if (next !== text) return next;
  }
  return null;
}

/** Quita —hasta 5 veces seguidas— cualquiera de los IDs de `codes` del principio del nombre. */
function stripPrefixes(name, codes) {
  let text = String(name ?? "").trim();
  if (!codes.length) return text;
  for (let guard = 0; guard < 5; guard++) {
    const next = stripOnePrefix(text, codes);
    if (next === null || next === text) break;
    text = next;
  }
  return text;
}

/**
 * El nombre SIN el ID que lleve por delante, tal como lo habría puesto cualquiera a mano:
 * `26001 - Cabina`, `26001-Cabina`, `26001 Cabina`, `[26001] Cabina`, `(26001): Cabina`.
 * v82: quita el ID que se pide Y su equivalente del formato antiguo (para 26001, también `00126`):
 * un nombre `00126 - Cabina` que aún lleve el ID viejo se reemplaza por `26001 - Cabina`, nunca se
 * duplica (`26001 - 00126 - Cabina`). Solo quita ESE ID (no otro número) y solo si va al principio y NO
 * pegado a más cifras (`260012 Cabina` no lleva el ID `26001`: es otro número). Quita también cualquier
 * número de repeticiones seguidas (`26001 - 26001 - Cabina`), que es lo que sale de aplicar mal un prefijo dos veces.
 */
export function stripCodePrefix(name, code) {
  const c = String(code ?? "").trim();
  if (!c) return String(name ?? "").trim();
  const legacy = legacyCodeOf(c);
  return stripPrefixes(name, legacy ? [c, legacy] : [c]);
}

/** ¿El nombre ya lleva ESE ID por delante (en cualquiera de las formas de stripCodePrefix)? El equivalente antiguo (`00126` para `26001`) NO cuenta: ese nombre hay que reescribirlo, ver hasLegacyCodePrefix. */
export function hasCodePrefix(name, code) {
  const c = String(code ?? "").trim();
  return !!c && stripPrefixes(name, [c]) !== String(name ?? "").trim();
}

/** ¿El nombre empieza por el ID del formato antiguo que correspondía a `code` (`00126 - Cabina` para `26001`)? */
export function hasLegacyCodePrefix(name, code) {
  const legacy = legacyCodeOf(String(code ?? "").trim());
  return !!legacy && stripPrefixes(name, [legacy]) !== String(name ?? "").trim();
}

/**
 * `YYXXX - Nombre`: el nombre con el ID por delante, sin duplicarlo si el nombre ya lo traía
 * (`26001 - Cabina` sigue siendo `26001 - Cabina`; `[26001] Cabina`, también; y `00126 - Cabina`, con el
 * ID del formato antiguo, pasa a `26001 - Cabina`). Sin nombre (o solo el ID), queda el ID solo; sin ID,
 * el nombre tal cual. No limpia caracteres ni recorta la longitud: eso depende de dónde se use
 * (drive-files.js lo hace para Drive).
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

// ---------------------------------------------------------------------------
// Migración XXXYY → YYXXX (v82): el PLAN, puro. data/project-codes.js lo ejecuta contra Firestore.
// ---------------------------------------------------------------------------

/** Un campo de Firestore dentro de un mapa (`customFields.<id>`); null si el id lleva un punto (no se puede direccionar). */
const dotted = (base, key) => (String(key).includes(".") ? null : `${base}.${key}`);

/**
 * El nombre o título de una oferta o proyecto con su ID ANTIGUO reemplazado por el nuevo:
 * `00126 - Cliente` → `26001 - Cliente`. Solo toca un nombre que de verdad empiece por el ID antiguo
 * (a un nombre sin ID no se le añade ninguno), y nunca lo duplica.
 */
export function migrateNameText(name, oldCode, newCode) {
  const text = String(name ?? "");
  if (!oldCode || !newCode || !hasCodePrefix(text, oldCode)) return text;
  const rest = stripPrefixes(text, [oldCode, newCode]);
  return rest ? `${newCode}${CODE_NAME_SEPARATOR}${rest}` : newCode;
}

/**
 * Una Ubicación (ruta de carpeta) con el ID antiguo de su ÚLTIMA carpeta reemplazado por el nuevo:
 * `Z:\Proyectos\00126 - Cliente` → `Z:\Proyectos\26001 - Cliente`; sirve también para `\\srv\Ofertas\…`, rutas con
 * `/` y una barra final. Una dirección web (`https://…`) o una ruta cuya última carpeta no lleve el ID antiguo
 * se dejan tal cual.
 */
export function migrateLocationText(location, oldCode, newCode) {
  const text = String(location ?? "");
  if (!oldCode || !newCode || !text.trim() || /^[a-z][a-z0-9+.-]*:\/\/./i.test(text.trim())) return text;
  const m = /^(.*?)([^\\/]+)([\\/]*)$/s.exec(text);
  if (!m) return text;
  const [, head, leaf, tail] = m;
  const next = migrateNameText(leaf, oldCode, newCode);
  return next === leaf ? text : `${head}${next}${tail}`;
}

/**
 * Qué cambiar para pasar de XXXYY a YYXXX todo lo que lo lleve: los proyectos (`code`, `name`,
 * `properties.ubicacion`), las ofertas (`offerCode`, `title`, el campo Ubicación) y sus copias en la
 * Papelera (`trash/{id}.task` / `.project`, y su `title`).
 *
 * @param {{ projects?: object[], offers?: object[], trash?: object[], locationFieldId?: string|null, expectedYear?: number }} args
 *   `locationFieldId`: el id del campo «Ubicación» de Ofertas (findOfferLocationField), para reescribirlo en las ofertas.
 * @returns {{
 *   projects: {id: string, fields: object}[], offers: {id: string, fields: object}[], trash: {id: string, fields: object}[],
 *   folders: { id: string, kind: "project"|"offer", code: string, name: string, folderId: string }[],  // carpetas de Drive por renombrar
 *   conflicts: { id: string, kind: string, code: string, newCode: string }[],                           // no se tocan: el ID nuevo ya existe
 *   mapping: Record<string,string>                                                                      // XXXYY → YYXXX de todo lo convertido
 * }}
 * Idempotente: un documento que ya está en YYXXX no genera nada. Un cambio por documento, todos sus campos
 * juntos, para que se escriban a la vez. Dos documentos con el mismo ID antiguo (una oferta y el proyecto
 * en que se convirtió) reciben el mismo nuevo; si el nuevo ya lo lleva OTRO ID, esos documentos se
 * dejan sin tocar y salen en `conflicts` (nunca se pisa un ID).
 */
export function planLegacyCodeMigration({ projects = [], offers = [], trash = [], locationFieldId = null, expectedYear = 26 } = {}) {
  const year = Math.max(FIRST_YY, Number(expectedYear) % 100 || FIRST_YY);
  const legacy = (code) => isLegacyCode(code, year);

  // Los IDs YYXXX que ya existen (de cualquiera), para no repetir uno ni «convertir» encima de él.
  const taken = new Set();
  const note = (code) => { if (code && isProjectCode(code)) taken.add(String(code)); };
  projects.forEach((p) => note(p.code));
  offers.forEach((o) => note(o.offerCode));
  const mapping = {};
  const owner = new Map(); // nuevo → antiguo
  const claim = (oldCode) => {
    const newCode = convertLegacyCodeToYYXXX(oldCode, year);
    if (newCode === oldCode) return null;
    if (mapping[oldCode]) return mapping[oldCode];
    if (taken.has(newCode) || (owner.has(newCode) && owner.get(newCode) !== oldCode)) return false;
    owner.set(newCode, oldCode);
    mapping[oldCode] = newCode;
    return newCode;
  };

  const out = { projects: [], offers: [], trash: [], folders: [], conflicts: [], mapping };

  /** Los campos que cambian en una oferta (`offer`) o proyecto (`project`), con `prefix` ("" o "task." / "project." en la Papelera). */
  const fieldsFor = (kind, doc, prefix, newCode) => {
    const codeField = kind === "offer" ? "offerCode" : "code";
    const oldCode = String(doc[codeField]);
    const fields = { [`${prefix}${codeField}`]: newCode };
    const nameField = kind === "offer" ? "title" : "name";
    if (typeof doc[nameField] === "string") {
      const next = migrateNameText(doc[nameField], oldCode, newCode);
      if (next !== doc[nameField]) fields[`${prefix}${nameField}`] = next;
    }
    if (kind === "project") {
      const loc = doc.properties && doc.properties.ubicacion;
      if (typeof loc === "string") {
        const next = migrateLocationText(loc, oldCode, newCode);
        if (next !== loc) fields[`${prefix}properties.ubicacion`] = next;
      }
    } else if (locationFieldId && doc.customFields && typeof doc.customFields[locationFieldId] === "string") {
      const loc = doc.customFields[locationFieldId];
      const next = migrateLocationText(loc, oldCode, newCode);
      const path = dotted(`${prefix}customFields`, locationFieldId);
      if (next !== loc && path) fields[path] = next;
    }
    return fields;
  };

  const folderOf = (kind, doc, newCode, fields) => {
    const nameField = kind === "offer" ? "title" : "name";
    const name = plainTitleTextOf(fields[nameField] !== undefined ? fields[nameField] : doc[nameField]);
    return { kind, id: doc.id, code: newCode, name, folderId: String(doc.driveFolderId) };
  };

  for (const p of projects) {
    if (p.exclusive || !legacy(p.code)) continue;
    const newCode = claim(String(p.code));
    if (newCode === false) { out.conflicts.push({ id: p.id, kind: "project", code: String(p.code), newCode: convertLegacyCodeToYYXXX(p.code, year) }); continue; }
    const fields = fieldsFor("project", p, "", newCode);
    out.projects.push({ id: p.id, fields });
    if (p.driveFolderId) out.folders.push(folderOf("project", p, newCode, fields));
  }
  for (const o of offers) {
    if (!legacy(o.offerCode)) continue;
    const newCode = claim(String(o.offerCode));
    if (newCode === false) { out.conflicts.push({ id: o.id, kind: "offer", code: String(o.offerCode), newCode: convertLegacyCodeToYYXXX(o.offerCode, year) }); continue; }
    const fields = fieldsFor("offer", o, "", newCode);
    out.offers.push({ id: o.id, fields });
    if (o.driveFolderId) out.folders.push(folderOf("offer", o, newCode, fields));
  }
  for (const t of trash) {
    const kind = t.kind === "project" ? "project" : "offer";
    const body = t.kind === "project" ? t.project : t.task;
    const codeField = kind === "project" ? "code" : "offerCode";
    if (!body || !legacy(body[codeField])) continue;
    const newCode = claim(String(body[codeField]));
    if (newCode === false) { out.conflicts.push({ id: t.id, kind: "trash", code: String(body[codeField]), newCode: convertLegacyCodeToYYXXX(body[codeField], year) }); continue; }
    const fields = fieldsFor(kind, body, t.kind === "project" ? "project." : "task.", newCode);
    const titleNext = typeof t.title === "string" ? migrateNameText(t.title, String(body[codeField]), newCode) : t.title;
    if (titleNext !== t.title) fields.title = titleNext;
    out.trash.push({ id: t.id, fields });
  }

  // Una oferta convertida y su proyecto comparten carpeta de Drive (y ID): una sola operación por ID, con el nombre del proyecto.
  const byCode = new Map();
  for (const f of out.folders) {
    const have = byCode.get(f.code);
    if (!have || (have.kind === "offer" && f.kind === "project")) byCode.set(f.code, f);
  }
  out.folders = [...byCode.values()];
  return out;
}

/** plainTitleText sin importar utils una segunda vez en este módulo (solo quita las marcas de negrita). */
function plainTitleTextOf(title) {
  return String(title ?? "").replace(/\*\*/g, "");
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
