// ============================================================================
// Biblioteca de piezas del «Visualizador de piezas» (v93) — LÓGICA PURA: sin DOM ni Firebase.
//
// Hasta la v92 una pieza solo aparecía si estaba adjunta a una tarea. Ahora se puede SUBIR DIRECTAMENTE desde el visualizador
// (.step, .stp, .ipt, .iam) para enseñársela a otras personas sin tener que crear una tarea. Cada subida es un documento de
// `cadParts/{id}`:
//   { attachments: [adjuntoDeDrive…], title, projectId, sector, createdBy, createdByName, createdAt }
// — los mismos adjuntos de Drive que usan las tareas (drive-files.js), así que el visor, las descargas y el emparejamiento
// .ipt/.iam ↔ .STEP funcionan igual. Las piezas de la biblioteca salen en el catálogo junto a las de las tareas (buildPartsCatalog).
// ============================================================================
import { isDriveAttachment, driveFolderPath, monthFolderName } from "./drive-files.js";
import { isCadFileName, isDirect3dCadFile, isInventorNativeFile, getCadBaseReference, getCadDisplayName, findCompanionStepAttachment } from "./cad-viewer.js";
import { projectSectorKey, normalizeSectorKey } from "./project-properties.js";
import { indexUploadedCadParts, PARTS_AVAILABILITY_STEP, PARTS_AVAILABILITY_NATIVE } from "./parts-viewer.js";
import { plainTitleText } from "./utils.js";

export const LIBRARY_ACCEPT = ".step,.stp,.ipt,.iam";
export const LIBRARY_TITLE_MAX = 120;
export const LIBRARY_MAX_FILES = 30;

const clean = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** De una lista de archivos elegidos: los que se pueden subir (CAD, sin repetir nombre) y los rechazados con su motivo. */
export function validateLibraryFiles(files) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  Array.from(files || []).forEach((f) => {
    const name = f && f.name ? String(f.name) : "";
    if (!name || !isCadFileName(name)) { rejected.push({ name: name || "(sin nombre)", reason: "No es un archivo CAD (.step, .stp, .ipt o .iam)." }); return; }
    if (!(Number(f.size) > 0)) { rejected.push({ name, reason: "El archivo está vacío." }); return; }
    const key = name.toLowerCase();
    if (seen.has(key)) { rejected.push({ name, reason: "Está repetido en la selección." }); return; }
    if (accepted.length >= LIBRARY_MAX_FILES) { rejected.push({ name, reason: `Máximo ${LIBRARY_MAX_FILES} archivos por subida.` }); return; }
    seen.add(key);
    accepted.push(f);
  });
  return { accepted, rejected };
}

/** El documento que se guarda en `cadParts` (limpio y acotado; sin campos `undefined`). `createdAt` lo pone el servidor. */
export function buildLibraryEntryData({ attachments = [], title = "", projectId = "", sector = "", user = null } = {}) {
  const sec = normalizeSectorKey(sector);
  return {
    attachments: attachments.filter((a) => isDriveAttachment(a) && isCadFileName(a.name)),
    title: clean(title).slice(0, LIBRARY_TITLE_MAX),
    projectId: clean(projectId),
    sector: sec === "industria" || sec === "automocion" ? sec : "",
    createdBy: user && user.uid ? String(user.uid) : "",
    createdByName: user && (user.displayName || user.name || user.email) ? clean(user.displayName || user.name || user.email).slice(0, 80) : "",
  };
}

/** ¿Puede esta persona borrar la subida? Quien la hizo, o un admin. */
export function canManageLibraryEntry(entry, user) {
  if (!entry || !user) return false;
  return (!!user.uid && entry.createdBy === user.uid) || user.role === "admin";
}

/** Une adjuntos nuevos a los que ya había, sin repetir el archivo de Drive. */
export function mergeLibraryAttachments(existing, added) {
  const out = [];
  const seen = new Set();
  [...(existing || []), ...(added || [])].forEach((a) => {
    if (!isDriveAttachment(a) || seen.has(a.driveId)) return;
    seen.add(a.driveId);
    out.push(a);
  });
  return out;
}

const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v && typeof v.seconds === "number" ? v.seconds * 1000 : typeof v === "number" ? v : Date.parse(v || "") || 0);

/**
 * Las piezas de las subidas directas, con la misma forma que las de las tareas (indexUploadedCadParts) más:
 *   source: 'library', libraryId, uploadedByName, createdBy, taskId: null.
 * Dentro de una subida el .ipt/.iam y el .STEP con la misma referencia forman UNA pieza. El proyecto es opcional: sin él (o si ya no
 * está activo) la pieza sale como «Sin proyecto». El sector es el elegido al subir o, si no, el del proyecto.
 */
export function indexLibraryCadParts(entries, projects) {
  const active = new Map((projects || []).filter((p) => p && !p.exclusive && !p.archived).map((p) => [p.id, p]));
  const parts = [];
  (entries || []).forEach((entry) => {
    if (!entry || !entry.id) return;
    const project = entry.projectId ? active.get(entry.projectId) || null : null;
    const cad = (Array.isArray(entry.attachments) ? entry.attachments : []).filter((a) => isDriveAttachment(a) && isCadFileName(a.name));
    const byRef = new Map();
    cad.forEach((a) => {
      const ref = getCadBaseReference(a.name);
      if (!ref) return;
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push({ ...a, taskId: null, projectId: project ? project.id : "", libraryId: entry.id });
    });
    byRef.forEach((files, ref) => {
      const nativeFiles = files.filter((f) => isInventorNativeFile(f.name));
      let stepFiles = files.filter((f) => isDirect3dCadFile(f.name));
      let stepSource = stepFiles.length ? "task" : null;
      if (!stepFiles.length && nativeFiles.length) {
        const found = findCompanionStepAttachment(nativeFiles[0], cad.filter((f) => isDirect3dCadFile(f.name)));
        if (found) { stepFiles = [{ ...found, taskId: null, libraryId: entry.id }]; stepSource = "task"; }
      }
      const first = nativeFiles[0] || stepFiles[0];
      const times = nativeFiles.concat(stepFiles).map((f) => Date.parse(f.uploadedAt || "") || 0).concat(toMillis(entry.createdAt));
      parts.push({
        key: `lib:${entry.id}:${ref}`,
        source: "library",
        libraryId: entry.id,
        createdBy: entry.createdBy || "",
        uploadedByName: entry.createdByName || "",
        taskId: null,
        taskTitle: plainTitleText(entry.title || ""),
        isComplete: false,
        projectId: project ? project.id : "",
        projectName: project ? project.name || "" : "Sin proyecto",
        projectCode: project ? project.code || "" : "",
        projectColor: project ? project.color || "" : "",
        comercial: project ? clean(project.properties && project.properties.comercial) : "",
        sector: normalizeSectorKey(entry.sector) || (project ? projectSectorKey(project) : ""),
        baseReference: ref,
        displayName: getCadDisplayName(first.name),
        nativeFiles,
        stepFiles,
        primaryNative: nativeFiles[0] || null,
        primaryStep: stepFiles[0] || null,
        stepSource,
        stepTaskId: null,
        has3d: stepFiles.length > 0,
        hasNative: nativeFiles.length > 0,
        availability: stepFiles.length ? PARTS_AVAILABILITY_STEP : PARTS_AVAILABILITY_NATIVE,
        uploadedAt: Math.max(0, ...times),
      });
    });
  });
  return parts;
}

/** El catálogo completo: piezas de las tareas + subidas directas, de lo más reciente a lo más antiguo. */
export function buildPartsCatalog(tasks, projects, libraryEntries) {
  const all = indexUploadedCadParts(tasks, projects).concat(indexLibraryCadParts(libraryEntries, projects));
  return all.sort((a, b) => (b.uploadedAt - a.uploadedAt) || a.baseReference.localeCompare(b.baseReference, "es") || a.key.localeCompare(b.key));
}

export const LIBRARY_FOLDER_NAME = "Visualizador de piezas";

/**
 * La carpeta de Drive donde se suben: la del proyecto (por su código YYXXX, como las tareas del proyecto) si se eligió uno que
 * lo tiene; si no, «Visualizador de piezas / AAAA-MM» dentro de la carpeta de Chusy.
 */
export function libraryFolderPath({ project = null, date = new Date() } = {}) {
  if (project && project.code) {
    return driveFolderPath({ owner: { kind: "project", code: project.code, name: project.name, id: project.id, folderId: project.driveFolderId || null }, date });
  }
  const month = monthFolderName(date);
  return [{ key: "parts-library", name: LIBRARY_FOLDER_NAME }, { key: `m:${month}`, name: month }];
}
