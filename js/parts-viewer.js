// ============================================================================
// «Visualizador de piezas» (v90) — LÓGICA PURA: sin DOM ni Firebase, así se prueba suelta en Node.
//
// Es una vista TRANSVERSAL: recoge los archivos CAD (.step, .stp, .ipt, .iam) que hay subidos a Drive en las tareas de todos
// los proyectos activos y los ofrece con un buscador de referencias para abrirlos y medirlos en 3D.
//
//   indexUploadedCadParts(tasks, projects) → una «pieza» por tarea + referencia. Si la tarea trae tanto el .ipt/.iam como su
//     .step/.stp gemelo, es UNA sola tarjeta (no dos): con el archivo nativo de Inventor y el modelo 3D listo para medir.
//     Un .ipt/.iam sin STEP en su tarea busca el gemelo en otra tarea del MISMO proyecto (mismo criterio que el botón 👁️).
//   filterCadPartsCatalog(parts, filters)  → búsqueda instantánea (referencia, nombre de archivo, código y nombre de
//     proyecto, comercial y tarea) con los filtros de proyecto, sector y disponibilidad 3D.
// Solo cuentan los adjuntos subidos a Drive (los enlaces no se pueden descargar para dibujarlos) de tareas no eliminadas y
// de proyectos activos (ni archivados ni exclusivos como Ofertas, que no tienen piezas con referencia).
// ============================================================================
import { isDriveAttachment } from "./drive-files.js";
import {
  isCadFileName, isDirect3dCadFile, isInventorNativeFile, getCadExtension, getCadBaseReference, getCadDisplayName, findCompanionStepAttachment,
} from "./cad-viewer.js";
import { projectSectorKey, normalizeSectorFilter, SECTOR_FILTER_ALL } from "./project-properties.js";
import { normalizeForSearch, plainTitleText } from "./utils.js";

export const PARTS_AVAILABILITY_ALL = "todos";
export const PARTS_AVAILABILITY_STEP = "step";
export const PARTS_AVAILABILITY_NATIVE = "native";
export const PARTS_AVAILABILITY_OPTIONS = Object.freeze([
  Object.freeze({ key: PARTS_AVAILABILITY_ALL, label: "Todos" }),
  Object.freeze({ key: PARTS_AVAILABILITY_STEP, label: "Con 3D STEP listo" }),
  Object.freeze({ key: PARTS_AVAILABILITY_NATIVE, label: "Solo .IPT/.IAM" }),
]);

export function normalizePartsAvailability(value) {
  return PARTS_AVAILABILITY_OPTIONS.some((o) => o.key === value) ? value : PARTS_AVAILABILITY_ALL;
}

export function emptyPartsState() {
  return { search: "", projectId: "", sector: SECTOR_FILTER_ALL, availability: PARTS_AVAILABILITY_ALL };
}

const clean = (v) => String(v ?? "").trim();

/** Un adjunto CAD con los datos de dónde está (tarea y proyecto), listo para emparejar. */
function withOrigin(att, task, projectId) {
  return { ...att, taskId: task.id, projectId };
}

/**
 * La lista de piezas de `tasks` (sin repetir tareas) de los proyectos activos de `projects`.
 * Cada pieza: { key, taskId, taskTitle, isComplete, projectId, projectName, projectCode, projectColor, comercial, sector,
 *   baseReference, displayName, nativeFiles[], stepFiles[], primaryStep, primaryNative, stepSource ('task'|'project'|null),
 *   stepTaskId (la tarea donde está el STEP si no es esta), availability ('step'|'native'), has3d, hasNative, uploadedAt }
 * Los adjuntos de cada lista son `{ ...adjunto, taskId, projectId }`.
 */
export function indexUploadedCadParts(tasks, projects) {
  const activeProjects = new Map((projects || []).filter((p) => p && !p.exclusive && !p.archived).map((p) => [p.id, p]));
  const seen = new Set();
  const groups = []; // una por tarea + referencia
  const stepsByProject = new Map(); // projectId → Map(referencia → [adjuntos .step/.stp de TODAS sus tareas]) para el gemelo «de otra tarea»
  (tasks || []).forEach((task) => {
    if (!task || !task.id || seen.has(task.id) || task.deleted || task.trashed || task.deletedAt) return;
    seen.add(task.id);
    const candidates = [task.projectId, ...(Array.isArray(task.extraProjectIds) ? task.extraProjectIds : [])];
    const projectId = candidates.find((id) => id && activeProjects.has(id));
    if (!projectId) return;
    const project = activeProjects.get(projectId);
    const cad = (Array.isArray(task.attachments) ? task.attachments : []).filter((a) => isDriveAttachment(a) && isCadFileName(a.name));
    if (!cad.length) return;
    const byRef = new Map();
    cad.forEach((a) => {
      const ref = getCadBaseReference(a.name);
      if (!ref) return;
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push(withOrigin(a, task, projectId));
    });
    byRef.forEach((files, ref) => {
      const nativeFiles = files.filter((f) => isInventorNativeFile(f.name));
      const stepFiles = files.filter((f) => isDirect3dCadFile(f.name)).sort(stepOrder);
      groups.push({ ref, task, project, projectId, nativeFiles, stepFiles });
      if (stepFiles.length) {
        if (!stepsByProject.has(projectId)) stepsByProject.set(projectId, new Map());
        const refs = stepsByProject.get(projectId);
        refs.set(ref, (refs.get(ref) || []).concat(stepFiles));
      }
    });
  });

  const parts = groups.map((g) => {
    const { ref, task, project, projectId, nativeFiles } = g;
    let stepFiles = g.stepFiles;
    let stepSource = stepFiles.length ? "task" : null;
    let stepTaskId = null;
    if (!stepFiles.length && nativeFiles.length) {
      // El STEP puede estar en otra tarea del proyecto: el mismo criterio que el 👁️ de la tarea (findCompanionStepAttachment).
      const pool = (stepsByProject.get(projectId) || new Map()).get(ref) || [];
      const found = findCompanionStepAttachment(nativeFiles[0], pool);
      if (found) { stepFiles = [found]; stepSource = "project"; stepTaskId = found.taskId; }
    }
    const first = nativeFiles[0] || stepFiles[0];
    const times = nativeFiles.concat(stepFiles).map((f) => Date.parse(f.uploadedAt || "") || 0);
    return {
      key: `${task.id}:${ref}`,
      taskId: task.id,
      taskTitle: plainTitleText(task.title || ""),
      isComplete: !!task.isComplete,
      projectId,
      projectName: project.name || "",
      projectCode: project.code || "",
      projectColor: project.color || "",
      comercial: clean(project.properties && project.properties.comercial),
      sector: projectSectorKey(project),
      baseReference: ref,
      displayName: getCadDisplayName(first.name),
      nativeFiles,
      stepFiles,
      primaryNative: nativeFiles[0] || null,
      primaryStep: stepFiles[0] || null,
      stepSource,
      stepTaskId,
      has3d: stepFiles.length > 0,
      hasNative: nativeFiles.length > 0,
      availability: stepFiles.length ? PARTS_AVAILABILITY_STEP : PARTS_AVAILABILITY_NATIVE,
      uploadedAt: Math.max(0, ...times),
    };
  });
  return parts.sort(comparePartsDefault);
}

/** `.step` antes que `.stp` y, a igualdad, el subido más tarde. */
function stepOrder(a, b) {
  const rank = (f) => (getCadExtension(f.name) === "step" ? 0 : 1);
  return rank(a) - rank(b) || (Date.parse(b.uploadedAt || "") || 0) - (Date.parse(a.uploadedAt || "") || 0);
}

function comparePartsDefault(a, b) {
  return (b.uploadedAt - a.uploadedAt) || a.baseReference.localeCompare(b.baseReference, "es") || a.key.localeCompare(b.key);
}

/** Código del proyecto o de una referencia sin guiones, espacios, puntos ni barras: «26-001» y «26001» se encuentran entre sí. */
const code = (v) => normalizeForSearch(v).replace(/[\s\-_./\\]+/g, "");

/** Lo que mira la búsqueda de una pieza: referencia, nombres de archivo, proyecto (nombre y código), comercial y tarea. */
function haystack(part) {
  const files = part.nativeFiles.concat(part.stepFiles).map((f) => f.name);
  return {
    text: normalizeForSearch([part.baseReference, part.displayName, ...files, part.projectName, part.projectCode, part.comercial, part.taskTitle].join(" ")),
    compact: code([part.baseReference, part.displayName, ...files, part.projectCode].join(" ")),
  };
}

/**
 * La búsqueda instantánea. `filters`: { search, projectId, sector ('todos' | 'industria' | 'automocion'), availability
 * ('todos' | 'step' | 'native') }; todos combinables. El texto se separa en palabras y TODAS tienen que aparecer (sin
 * distinguir mayúsculas ni tildes; una palabra también vale si coincide con un fragmento de la referencia o del código sin
 * guiones). Orden: la referencia exacta primero, luego las que empiezan por la búsqueda, y después las demás por fecha.
 */
export function filterCadPartsCatalog(parts, filters = {}) {
  const f = { ...emptyPartsState(), ...filters };
  const sector = normalizeSectorFilter(f.sector);
  const availability = normalizePartsAvailability(f.availability);
  const words = normalizeForSearch(clean(f.search)).split(/\s+/).filter(Boolean);
  const phrase = code(f.search);
  const matched = (parts || []).filter((p) => {
    if (f.projectId && p.projectId !== f.projectId) return false;
    if (sector !== SECTOR_FILTER_ALL && p.sector !== sector) return false;
    if (availability === PARTS_AVAILABILITY_STEP && !p.has3d) return false;
    if (availability === PARTS_AVAILABILITY_NATIVE && p.has3d) return false;
    if (!words.length) return true;
    const h = haystack(p);
    return words.every((w) => h.text.includes(w) || (code(w) && h.compact.includes(code(w))));
  });
  if (!phrase) return matched;
  const score = (p) => (p.baseReference === normalizeForSearch(clean(f.search)).trim() || code(p.baseReference) === phrase ? 0 : code(p.baseReference).startsWith(phrase) ? 1 : 2);
  return matched.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.p);
}

/** Los proyectos que aparecen en el catálogo, para el desplegable del filtro: `[{ id, name, code }]` por código y nombre. */
export function collectPartsProjects(parts) {
  const map = new Map();
  (parts || []).forEach((p) => { if (!map.has(p.projectId)) map.set(p.projectId, { id: p.projectId, name: p.projectName, code: p.projectCode }); });
  return [...map.values()].sort((a, b) => clean(a.code).localeCompare(clean(b.code), "es") || clean(a.name).localeCompare(clean(b.name), "es"));
}

/** Se ha tocado algún filtro (para el botón «Limpiar»). */
export function hasPartsFilters(state) {
  const s = { ...emptyPartsState(), ...(state || {}) };
  return !!(clean(s.search) || s.projectId || normalizeSectorFilter(s.sector) !== SECTOR_FILTER_ALL || normalizePartsAvailability(s.availability) !== PARTS_AVAILABILITY_ALL);
}
