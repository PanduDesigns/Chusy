// ============================================================================
// Planos de una oferta (v96): helpers PUROS (sin Firebase ni DOM).
//
// Cada oferta lleva una tabla de planos (`tasks/{id}.drawings`). Un plano es:
//
//   id              identificador interno de la fila
//   prefix          PAC | PD | PDP | POC | PPT (ver DRAWING_PREFIXES): da el «Tipo de plano»
//   code            el código del plano, ya compuesto: prefijo + ID de la oferta + versión
//                   de la oferta EN EL MOMENTO de crearlo → PDP26123A3 = PDP + 26123 + A3
//   version         esa versión (A3): columna «Versión» (no cambia aunque la oferta suba de versión)
//   comments        texto libre
//   createdAt       ISO · createdBy / createdByName: quién lo generó
//   verifiedBy      quién lo verificó (texto) — se rellena al convertir la oferta en proyecto
//   verifiedAt      «YYYY-MM-DD» de la verificación — idem
//   verifiedFile    el plano verificado, un adjunto de Drive (buildDriveAttachment) — idem
//
// Al convertir la oferta en proyecto la tabla ENTERA pasa a `projects/{id}.properties.drawings`
// (project-properties.js). Un plano está «verificado de verdad» cuando tiene las tres cosas
// (quién, cuándo y el documento); mientras un proyecto con planos no tenga ninguno así, se
// enseña la alerta (drawingsAlert).
// ============================================================================

/** Los prefijos, en el orden en que se ofrecen. `label` es el «Tipo de plano». */
export const DRAWING_PREFIXES = Object.freeze([
  Object.freeze({ prefix: "PAC", label: "Plano de Aire Comprimido" }),
  Object.freeze({ prefix: "PD", label: "Plano de Distribución" }),
  Object.freeze({ prefix: "PDP", label: "Plano de Planta" }),
  Object.freeze({ prefix: "POC", label: "Plano de Obra Civil" }),
  Object.freeze({ prefix: "PPT", label: "Plano de Acometidas" }),
]);

/** ¿Es uno de los cinco prefijos? (exacto, en mayúsculas) */
export function isDrawingPrefix(prefix) {
  return DRAWING_PREFIXES.some((p) => p.prefix === prefix);
}

/** El «Tipo de plano» de un prefijo ("PDP" → "Plano de Planta"); "" si no se conoce. */
export function drawingTypeLabel(prefix) {
  const found = DRAWING_PREFIXES.find((p) => p.prefix === prefix);
  return found ? found.label : "";
}

/** La versión tal como va dentro del código: solo letras y cifras ("A3", "v2.3" → "v23", " B 07 " → "B07"). */
export function versionForCode(version) {
  return String(version ?? "").replace(/[^A-Za-z0-9]/g, "");
}

/**
 * El código de un plano: prefijo + ID de la oferta + versión de la oferta. Devuelve "" si falta algo
 * (prefijo que no es uno de los cinco, oferta sin ID o versión vacía) — quien llama avisa.
 */
export function buildDrawingCode({ prefix, offerCode, version }) {
  const id = String(offerCode ?? "").trim();
  const v = versionForCode(version);
  if (!isDrawingPrefix(prefix) || !id || !v) return "";
  return `${prefix}${id}${v}`;
}

/** ¿Ya hay en la tabla un plano con ese código? (sin mirar mayúsculas) */
export function hasDrawingCode(drawings, code) {
  const key = String(code ?? "").toLowerCase();
  return !!key && (Array.isArray(drawings) ? drawings : []).some((d) => String(d && d.code).toLowerCase() === key);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isoOrNull(value) {
  if (!value) return null;
  const d = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

/** «YYYY-MM-DD» o null (acepta ya ese formato o una fecha/ISO). */
function dayOrNull(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (!d || isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** El adjunto del plano verificado (un adjunto de Drive), o null. Solo conserva campos sin `undefined`. */
function normalizeFile(raw) {
  if (!raw || typeof raw !== "object" || raw.kind !== "drive" || typeof raw.driveId !== "string" || !raw.driveId) return null;
  const out = { id: String(raw.id || ""), kind: "drive", name: String(raw.name || "plano"), driveId: raw.driveId, mimeType: String(raw.mimeType || "application/octet-stream"), size: Number(raw.size) || 0 };
  if (raw.thumbId) out.thumbId = String(raw.thumbId);
  if (raw.uploadedBy) out.uploadedBy = String(raw.uploadedBy);
  if (raw.uploadedByName) out.uploadedByName = String(raw.uploadedByName);
  if (raw.uploadedAt) out.uploadedAt = String(raw.uploadedAt);
  return out;
}

/** Una fila tal como la usa el formulario: siempre con todos los campos (nunca `undefined`). */
export function normalizeDrawing(raw) {
  const r = raw || {};
  const prefix = isDrawingPrefix(r.prefix) ? r.prefix : "";
  return {
    id: String(r.id || ""),
    prefix,
    code: text(r.code),
    version: text(r.version),
    comments: typeof r.comments === "string" ? r.comments : "",
    createdAt: isoOrNull(r.createdAt),
    createdBy: text(r.createdBy),
    createdByName: text(r.createdByName),
    verifiedBy: text(r.verifiedBy),
    verifiedAt: dayOrNull(r.verifiedAt),
    verifiedFile: normalizeFile(r.verifiedFile),
  };
}

/** Lo leído de Firestore (puede no existir) → lista de filas, sin las que no tienen código. */
export function normalizeDrawings(list) {
  return (Array.isArray(list) ? list : []).map(normalizeDrawing).filter((d) => d.code);
}

/**
 * La lista tal como se guarda en Firestore: textos recortados, `null` donde no hay dato y ninguna clave
 * `undefined` (Firestore no las admite). El plano verificado solo aparece si hay.
 */
export function drawingsForSave(list) {
  return normalizeDrawings(list).map((d) => ({
    id: d.id,
    prefix: d.prefix,
    code: d.code,
    version: d.version,
    comments: d.comments.trim(),
    createdAt: d.createdAt,
    createdBy: d.createdBy,
    createdByName: d.createdByName,
    verifiedBy: d.verifiedBy,
    verifiedAt: d.verifiedAt,
    verifiedFile: d.verifiedFile,
  }));
}

/**
 * Una fila nueva. `id` y `createdAt` (ISO) los pone quien llama (este archivo no genera ids ni lee el
 * reloj). Devuelve `null` si no se puede componer el código (ver buildDrawingCode).
 */
export function makeDrawing({ id, prefix, offerCode, version, createdAt, createdBy, createdByName }) {
  const code = buildDrawingCode({ prefix, offerCode, version });
  if (!code) return null;
  return normalizeDrawing({ id, prefix, code, version: text(version), createdAt, createdBy, createdByName });
}

// ----------------------------------------------------------------------------
// Verificación
// ----------------------------------------------------------------------------

/** ¿Tiene este plano ALGO de verificación puesto (quién, cuándo o documento)? */
export function hasVerificationData(d) {
  return !!d && (!!text(d.verifiedBy) || !!d.verifiedAt || !!d.verifiedFile);
}

/** ¿Está verificado de verdad? Quién, cuándo Y el documento subido. */
export function isDrawingVerified(d) {
  return !!d && !!text(d.verifiedBy) && !!d.verifiedAt && !!d.verifiedFile;
}

/** Qué le falta a un plano con verificación a medias: lista de "by" | "date" | "file". */
export function verificationMissing(d) {
  const out = [];
  if (!d || !text(d.verifiedBy)) out.push("by");
  if (!d || !d.verifiedAt) out.push("date");
  if (!d || !d.verifiedFile) out.push("file");
  return out;
}

const MISSING_TEXT = { by: "quién lo verificó", date: "la fecha de verificación", file: "el documento del plano verificado" };

/**
 * La alerta del proyecto: `null` si no hace falta (sin planos, o alguno ya verificado del todo); si no,
 * `{ code, missing, message }`:
 *  · `code` — el plano que se había elegido como verificado (el que tiene algo de verificación puesto),
 *    o `null` si ninguno se eligió;
 *  · `missing` — lo que le falta (`["by","date","file"]` si no se eligió ninguno);
 *  · `message` — el texto para enseñar.
 */
export function drawingsAlert(drawings) {
  const list = normalizeDrawings(drawings);
  if (!list.length || list.some(isDrawingVerified)) return null;
  const chosen = list.find(hasVerificationData) || null;
  if (!chosen) {
    return {
      code: null,
      missing: ["by", "date", "file"],
      message: "Este proyecto tiene planos, pero no se ha indicado cuál es el plano verificado: súbelo y rellena quién lo verificó y cuándo.",
    };
  }
  const missing = verificationMissing(chosen);
  const parts = missing.map((m) => MISSING_TEXT[m]);
  const list2 = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}` : parts[0];
  return { code: chosen.code, missing, message: `Falta completar la verificación del plano ${chosen.code}: ${list2}.` };
}

/** Atajo para pintar un aviso (barra lateral, cabecera): ¿este proyecto tiene la alerta de planos? */
export function projectNeedsDrawingAlert(project) {
  const props = project && project.properties;
  return !!drawingsAlert(props && props.drawings);
}

/**
 * Pone o quita la verificación de UN plano de la lista (no toca los demás) y devuelve una lista nueva.
 * `verification` = `{ verifiedBy, verifiedAt, verifiedFile }` o `null` para quitarla.
 */
export function withVerification(drawings, drawingId, verification) {
  return normalizeDrawings(drawings).map((d) => {
    if (d.id !== drawingId) return d;
    if (!verification) return { ...d, verifiedBy: "", verifiedAt: null, verifiedFile: null };
    return normalizeDrawing({ ...d, verifiedBy: verification.verifiedBy, verifiedAt: verification.verifiedAt, verifiedFile: verification.verifiedFile });
  });
}
