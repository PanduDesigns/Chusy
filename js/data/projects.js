// ============================================================================
// Acceso a datos: proyectos.
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const DEFAULT_SECTIONS = [
  { id: "por-hacer", name: "Por hacer", order: 0 },
  { id: "en-progreso", name: "En progreso", order: 1 },
  { id: "hecho", name: "Hecho", order: 2 },
];

/** Crea un proyecto nuevo. El creador queda como miembro automáticamente. */
export async function createProject({ name, description, color, creatorUid, sections }) {
  const ref = await addDoc(collection(db, "projects"), {
    name,
    description: description || "",
    color: color || "#FCD000",
    sections: sections && sections.length ? sections : DEFAULT_SECTIONS,
    memberIds: [creatorUid],
    createdBy: creatorUid,
    createdAt: serverTimestamp(),
    archived: false,
  });
  return ref.id;
}

export function updateProject(projectId, data) {
  return updateDoc(doc(db, "projects", projectId), data);
}

export function archiveProject(projectId, archived = true) {
  return updateDoc(doc(db, "projects", projectId), { archived });
}

export function deleteProject(projectId) {
  return deleteDoc(doc(db, "projects", projectId));
}

/**
 * Borra el proyecto Y todas sus tareas (con sus comentarios). Se hace en
 * lotes de como mucho 450 operaciones para no chocar con el límite de 500
 * escrituras por batch de Firestore — de sobra para el tamaño de un
 * departamento, pero así no revienta si algún proyecto acumula muchas
 * tareas con muchos comentarios.
 */
export async function deleteProjectWithTasks(projectId) {
  const tasksSnap = await getDocs(query(collection(db, "tasks"), where("projectId", "==", projectId)));

  const deletions = [];
  for (const taskDoc of tasksSnap.docs) {
    const commentsSnap = await getDocs(collection(db, "tasks", taskDoc.id, "comments"));
    commentsSnap.forEach((c) => deletions.push(c.ref));
    deletions.push(taskDoc.ref);
  }
  deletions.push(doc(db, "projects", projectId));

  for (let i = 0; i < deletions.length; i += 450) {
    const batch = writeBatch(db);
    deletions.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export function addMemberToProject(projectId, uid) {
  return updateDoc(doc(db, "projects", projectId), { memberIds: arrayUnion(uid) });
}

export function removeMemberFromProject(projectId, uid) {
  return updateDoc(doc(db, "projects", projectId), { memberIds: arrayRemove(uid) });
}

/** Añade/edita/elimina secciones (columnas) de un proyecto. */
export function setProjectSections(projectId, sections) {
  return updateDoc(doc(db, "projects", projectId), { sections });
}

/**
 * Escucha en tiempo real TODOS los proyectos del equipo (no solo los tuyos):
 * en un departamento pequeño, todo el mundo debe poder ver cualquier
 * proyecto y las tareas que haya dentro, esté o no asignado a esa persona.
 */
export function subscribeToAllProjects(callback) {
  const q = query(collection(db, "projects"), where("archived", "==", false));
  return onSnapshot(q, (snap) => {
    const projects = [];
    snap.forEach((d) => projects.push({ id: d.id, ...d.data() }));
    projects.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(projects);
  }, (err) => console.error("subscribeToAllProjects:", err));
}

/** Proyectos archivados (el "Archivo") — se guardan, no se ven en la lista principal. */
export function subscribeToArchivedProjects(callback) {
  const q = query(collection(db, "projects"), where("archived", "==", true));
  return onSnapshot(q, (snap) => {
    const projects = [];
    snap.forEach((d) => projects.push({ id: d.id, ...d.data() }));
    projects.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(projects);
  }, (err) => console.error("subscribeToArchivedProjects:", err));
}

export function subscribeToProject(projectId, callback) {
  return onSnapshot(doc(db, "projects", projectId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/** Lista completa de personas del equipo (para selectores de responsable/miembros). */
export function subscribeToAllUsers(callback) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const users = [];
    snap.forEach((d) => users.push({ uid: d.id, ...d.data() }));
    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(users);
  });
}
