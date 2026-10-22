// ============================================================================
// Archivos en Google Drive (v68) — el motor ya conectado a Chusy: usa la sesión
// de Firebase para identificarse ante el puente y la configuración vigente
// (`meta/driveStorage`, que app.js escucha y vuelca aquí con setDriveConfig).
// El resto de la app importa `driveService` de aquí; la lógica en sí vive en
// drive-storage.js (sin Firebase, para poder probarla en Node). Ver el
// apartado 3.13 del README.
// ============================================================================
import { auth } from "./firebase-init.js";
import { createDriveStorage } from "./drive-storage.js";
import { normalizeDriveConfig, driveFileIdsOf, isDriveAttachment } from "./drive-files.js";

let currentConfig = normalizeDriveConfig(null);
// ¿Ha llegado ya la configuración del equipo (meta/driveStorage)? Al arrancar, lo primero que
// puede necesitar Drive —la purga de la Papelera que lanza app.js al cargar los proyectos— suele
// adelantarse a esa primera lectura: sin esperarla, creería que el almacenamiento está apagado
// y los archivos de lo purgado se quedarían huérfanos en Drive.
let configReady = false;
const readyWaiters = [];

function idTokenOfCurrentUser() {
  const user = auth.currentUser;
  if (!user) return Promise.reject(new Error("Sin sesión"));
  return user.getIdToken();
}

export const driveService = createDriveStorage({
  getConfig: () => currentConfig,
  getIdToken: idTokenOfCurrentUser,
});

/** Lo llama app.js con cada cambio de `meta/driveStorage`. Si cambia la dirección del puente se descarta el permiso que hubiera. */
export function setDriveConfig(raw) {
  const next = normalizeDriveConfig(raw);
  const changed = next.gatewayUrl !== currentConfig.gatewayUrl;
  currentConfig = next;
  if (changed) driveService.resetToken();
  configReady = true;
  readyWaiters.splice(0).forEach((wake) => wake());
}

/** Espera (como mucho `ms`) a que haya llegado la configuración del equipo. Devuelve si llegó. */
export function whenDriveConfigReady(ms = 8000) {
  if (configReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    readyWaiters.push(() => { clearTimeout(timer); resolve(true); });
  });
}

export function getDriveConfig() {
  return currentConfig;
}

/** Al cerrar sesión: fuera la configuración, el permiso y las miniaturas en memoria. */
export function resetDriveService() {
  currentConfig = normalizeDriveConfig(null);
  configReady = false;
  driveService.reset();
}

/**
 * Un motor aparte con una configuración concreta (la que se está escribiendo en
 * el panel de administración, aún sin guardar) — para «Probar conexión».
 */
export function createDriveStorageFor(rawConfig) {
  const cfg = normalizeDriveConfig({ ...rawConfig, enabled: true });
  return createDriveStorage({ getConfig: () => cfg, getIdToken: idTokenOfCurrentUser });
}

/**
 * Manda a la papelera de Drive los archivos de estas tareas. Se llama al ELIMINAR
 * PARA SIEMPRE de la Papelera de Chusy (data/trash.js, purgeTrashItems): mientras una
 * tarea está en la Papelera sus archivos siguen intactos en Drive, para poder
 * restaurarla. Nunca lanza ni hace esperar a quien llama: si Drive no está
 * disponible, los archivos se quedan en la carpeta de Chusy (basta borrarlos a
 * mano en Drive).
 */
export async function trashFilesOfTasks(tasks) {
  const ids = driveFileIdsOf((tasks || []).flatMap((t) => (t && t.attachments) || []));
  if (!ids.length) return { ok: 0, failed: 0 };
  await whenDriveConfigReady();
  if (!driveService.isEnabled()) return { ok: 0, failed: ids.length };
  try {
    return await driveService.trashFiles(ids);
  } catch (e) {
    console.warn("trashFilesOfTasks:", e);
    return { ok: 0, failed: ids.length };
  }
}

/**
 * Para duplicar una tarea: los enlaces pasan tal cual y los archivos de Drive se
 * copian (ver copyAttachments en drive-storage.js). Si el almacenamiento está
 * apagado, los archivos no se pueden copiar y se cuentan en `skipped`.
 */
export async function copyAttachmentsForDuplicate(attachments, ctx = {}) {
  const list = attachments || [];
  const driveOnes = list.filter(isDriveAttachment);
  if (!driveOnes.length) return { attachments: list, skipped: 0 };
  await whenDriveConfigReady();
  if (!driveService.isEnabled()) return { attachments: list.filter((a) => !isDriveAttachment(a)), skipped: driveOnes.length };
  try {
    return await driveService.copyAttachments(list, ctx);
  } catch (e) {
    console.warn("copyAttachmentsForDuplicate:", e);
    return { attachments: list.filter((a) => !isDriveAttachment(a)), skipped: driveOnes.length };
  }
}

// ---------------------------------------------------------------------------
// v75 · Carpeta de Drive de una oferta o de un proyecto: renombrarla y pasarla de `Ofertas` a `Proyectos`.
// Los dos envoltorios NUNCA lanzan: ordenar Drive es un extra y jamás debe impedir guardar una oferta, un
// proyecto o convertir una oferta. Devuelven `{ status, folderId }`:
//   "renamed" | "moved" | "unchanged"   hecho (o ya estaba);
//   "none"       no hay carpeta (esa oferta o proyecto nunca tuvo archivos en Drive);
//   "disabled"   el almacenamiento está apagado;
//   "failed"     Drive no pudo (red, permisos, tiempo): queda para la próxima subida, que ordena sola.
// `folderId` es el id de la carpeta si se encontró, para anotarlo como `driveFolderId` si faltaba.
// ---------------------------------------------------------------------------

function withTimeout(promise, ms) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Drive tardó demasiado")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function folderOperation(label, run, { timeoutMs = 0 } = {}) {
  await whenDriveConfigReady(3000);
  if (!driveService.isEnabled()) return { status: "disabled", folderId: null };
  try {
    return await withTimeout(run(), timeoutMs);
  } catch (e) {
    console.warn(`${label}:`, e);
    return { status: "failed", folderId: null };
  }
}

/** Pone a la carpeta del ID `code` el nombre `code - name` (si ya la tiene, no toca nada). Sin carpeta: "none". */
export function renameDriveFolder({ code, name, folderId = null }, opts) {
  if (!code) return Promise.resolve({ status: "none", folderId: null });
  return folderOperation("renameDriveFolder", async () => {
    const r = await driveService.renameCodeFolder({ code, name, folderId });
    return { status: !r.folderId ? "none" : r.renamed ? "renamed" : "unchanged", folderId: r.folderId };
  }, opts);
}

/** Pasa la carpeta del ID `code` de `Ofertas` a `Proyectos` y la renombra a `code - name`. Sin carpeta: "none". */
export function moveDriveFolderToProjects({ code, name, folderId = null }, opts) {
  if (!code) return Promise.resolve({ status: "none", folderId: null });
  return folderOperation("moveDriveFolderToProjects", async () => {
    const r = await driveService.moveCodeFolderToProjects({ code, name, folderId });
    return { status: !r.folderId ? "none" : r.moved ? "moved" : r.renamed ? "renamed" : "unchanged", folderId: r.folderId };
  }, opts);
}
