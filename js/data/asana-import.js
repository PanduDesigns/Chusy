// ============================================================================
// Importador de Asana.
//
// Lee un export hecho con el script "asana-api-export" (el mismo formato
// tanto para pruebas como para la migración definitiva) y lo convierte en
// proyectos/tareas/etiquetas/comentarios de Chusy.
//
// Todo esto corre en el navegador de quien lo ejecuta (siempre un admin),
// con su propia sesión — nunca se manda el JSON a ningún sitio.
//
// Piezas clave:
//  - parseAsanaExport(): solo lectura del JSON, no toca Firestore. Devuelve
//    una estructura ya resuelta (proyectos, tareas -incluidas las subtareas
//    como tareas independientes-, etiquetas sin duplicados...). No incluye
//    adjuntos: el export no trae archivos y no tiene sentido depender de
//    Asana para reconstruirlos.
//  - Las personas de Asana que todavía no se han mapeado a una cuenta real
//    de Chusy se guardan como usuarios "ficticios": un documento en
//    `users` con id `asana:<gid>` (nunca un UID de Auth real, porque no
//    hay forma de crear cuentas de verdad desde aquí) y `isImported: true`.
//  - meta/asanaUserMap: { [gidDeAsana]: uidRealDeChusy }. Si una persona no
//    aparece ahí, sigue siendo ficticia.
//  - meta/asanaImportIndex: { projects, tasks, comments, byFicticiousUser }
//    — de gid de Asana a id de documento en Chusy, más un índice inverso
//    (qué tareas/comentarios quedan bajo cada persona ficticia). Sirve para
//    que importar el mismo archivo dos veces no duplique nada, para poder
//    borrar de un tirón los datos de una prueba, y para que "Aplicar
//    equivalencia" pueda encontrar y reescribir sus tareas y comentarios
//    por id directo — sin depender de consultas amplias sobre `tasks` (los
//    permisos de Firestore para listados con condición "o eres tú o eres
//    admin" no son fiables cuando el documento no es tuyo, aunque sí lo son
//    para leer/escribir un documento concreto por id, que es lo que se usa
//    aquí).
// ============================================================================
import { db } from "../firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  arrayRemove,
  arrayUnion,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { slugifyTag, upsertTag } from "./tags.js";
import { PROJECT_COLORS, CURATED_ICONS } from "../components/project-appearance-picker.js";

const BATCH_LIMIT = 400; // por debajo del límite de 500 escrituras/lote de Firestore
const DEFAULT_PROJECT_ICON = CURATED_ICONS[0]; // el mismo que usa createProject() cuando no se elige ninguno

// ----------------------------------------------------------------------
// Colores con nombre de Asana -> paleta cerrada de Chusy. No hay una
// correspondencia exacta (Chusy tiene muchas menos opciones), así que se
// elige la más parecida a ojo; cambiar el color de un proyecto o etiqueta
// después es cosa de un clic si alguno no convence.
// ----------------------------------------------------------------------
const ASANA_TAG_COLOR = {
  "hot-pink": "#FF6B8B", pink: "#FF6B8B", magenta: "#FF6B8B", red: "#FF6B8B",
  purple: "#B892FF",
  indigo: "#7C86D9",
  blue: "#5B9BD5",
  "blue-green": "#4EC9C9",
  green: "#3DDC97", "yellow-green": "#3DDC97",
  orange: "#E8963C", "yellow-orange": "#E8963C",
  yellow: "#FCD000",
  "cool-gray": "#8B959C", none: "#8B959C",
};
const DEFAULT_TAG_COLOR = "#8B959C";

// PROJECT_COLORS actuales: ["#FCD000" dorado, "#78848C" gris, "#4E9E9E" verde
// azulado, "#C4703E" óxido, "#6B9E78" verde, "#8B85C4" morado, "#D9776B"
// coral, "#6BA4D9" azul]
const ASANA_PROJECT_COLOR = {
  "hot-pink": PROJECT_COLORS[6], pink: PROJECT_COLORS[6], magenta: PROJECT_COLORS[6], red: PROJECT_COLORS[6],
  purple: PROJECT_COLORS[5], indigo: PROJECT_COLORS[5],
  blue: PROJECT_COLORS[7], "blue-green": PROJECT_COLORS[2],
  green: PROJECT_COLORS[4], "yellow-green": PROJECT_COLORS[4],
  orange: PROJECT_COLORS[3], "yellow-orange": PROJECT_COLORS[3],
  yellow: PROJECT_COLORS[0],
  "cool-gray": PROJECT_COLORS[1], none: PROJECT_COLORS[1],
};
const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[1];

const SECTION_PLACEHOLDER_RE = /^\((no section|ninguna secci[oó]n|sin secci[oó]n)\)$/i;
function normalizeSectionName(name) {
  const n = (name || "").trim();
  if (!n || SECTION_PLACEHOLDER_RE.test(n)) return "General";
  return n;
}

// ============================================================================
// Lectura del export — no toca Firestore.
// ============================================================================
export function parseAsanaExport(jsonText) {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("El archivo no es un JSON válido.");
  }
  if (raw.format !== "asana-api-export") {
    throw new Error('Este archivo no tiene el formato esperado ("asana-api-export"). ¿Es el export correcto?');
  }

  const warnings = [];

  // ---- usuarios ----
  const asanaUsers = (raw.workspace_memberships || []).map((m) => ({
    gid: m.user.gid,
    name: (m.user.name || m.user.email || "Persona sin nombre").trim(),
    email: (m.user.email || "").trim().toLowerCase(),
    isGuest: !!m.is_guest,
  }));

  // ---- etiquetas: agrupadas por el mismo slug que usaría Chusy. Cuando
  // el mismo nombre existe en Asana con colores distintos, gana el que
  // más se usa en tareas reales y, en empate, el más reciente. ----
  const tagUsage = new Map();
  Object.values(raw.tasks || {}).forEach((entry) => {
    (entry.task.tags || []).forEach((ref) => {
      tagUsage.set(ref.gid, (tagUsage.get(ref.gid) || 0) + 1);
    });
  });
  const tagGroups = new Map(); // slug -> variantes
  (raw.tags || []).forEach((t) => {
    const slug = slugifyTag(t.name || "");
    if (!slug) return;
    if (!tagGroups.has(slug)) tagGroups.set(slug, []);
    tagGroups.get(slug).push(t);
  });
  const resolvedTagBySlug = new Map(); // slug -> { name, color }
  const tagNameByGid = new Map(); // gid de Asana -> nombre final resuelto
  tagGroups.forEach((variants, slug) => {
    const sorted = [...variants].sort(
      (a, b) => (tagUsage.get(b.gid) || 0) - (tagUsage.get(a.gid) || 0) ||
        new Date(b.created_at) - new Date(a.created_at)
    );
    const winner = sorted[0];
    const name = (winner.name || "").trim();
    const color = ASANA_TAG_COLOR[winner.color] || DEFAULT_TAG_COLOR;
    resolvedTagBySlug.set(slug, { name, color });
    variants.forEach((v) => tagNameByGid.set(v.gid, name));
  });

  // ---- proyectos ----
  const usedNames = new Map();
  const projects = (raw.projects || []).map((p) => {
    const proj = p.project;
    let name = (proj.name || "Proyecto sin nombre").trim();
    const key = name.toLowerCase();
    const seen = usedNames.get(key) || 0;
    usedNames.set(key, seen + 1);
    if (seen > 0) name = `${name} (${seen + 1})`;

    // El id de sección tiene que ser el MISMO cada vez que se vuelva a
    // parsear este archivo (o uno posterior): se deriva del gid de Asana en
    // vez de generarse al azar. Si no fuera así, un proyecto que ya
    // existiera de una importación anterior se quedaría con tareas nuevas
    // apuntando a un id de sección que nunca se guardó en su documento (el
    // proyecto en sí no se vuelve a crear, así que su `sections[]` no
    // cambiaría) y esas tareas dejarían de verse en cualquier vista
    // agrupada por sección, aunque sigan contando en el total.
    let sections = (p.sections || []).map((s) => ({
      asanaGid: s.gid,
      id: `asana-sec:${s.gid}`,
      name: normalizeSectionName(s.name),
    }));
    if (!sections.length) sections = [{ asanaGid: null, id: `asana-sec:${proj.gid}:default`, name: "General" }];

    return {
      asanaGid: proj.gid,
      name,
      color: ASANA_PROJECT_COLOR[proj.color] || DEFAULT_PROJECT_COLOR,
      archived: !!proj.archived,
      notes: (proj.notes || "").trim(),
      sections,
      sectionByAsanaGid: new Map(sections.map((s) => [s.asanaGid, s])),
      ownerAsanaGid: proj.owner ? proj.owner.gid : null,
    };
  });
  const projectByAsanaGid = new Map(projects.map((p) => [p.asanaGid, p]));

  // ---- tareas (las subtareas entran como tareas independientes, en el
  // mismo proyecto/sección que su tarea padre, con una referencia de
  // texto de vuelta a ella) ----
  const tasks = [];
  Object.entries(raw.tasks || {}).forEach(([gid, entry]) => {
    const t = entry.task;
    const isSubtask = !!t.parent;

    let projectAsanaGid = null;
    let sectionAsanaGid = null;
    let parentTitle = null;

    if (isSubtask) {
      const parentEntry = raw.tasks[t.parent.gid];
      if (!parentEntry) {
        warnings.push(`Subtarea "${t.name}" (${gid}): no se encontró su tarea padre en el export, se omite.`);
        return;
      }
      const parentMembership = (parentEntry.task.memberships || [])[0];
      if (parentMembership) {
        projectAsanaGid = parentMembership.project.gid;
        sectionAsanaGid = parentMembership.section.gid;
      }
      parentTitle = parentEntry.task.name;
    } else {
      const membership = (t.memberships || [])[0];
      if (membership) {
        projectAsanaGid = membership.project.gid;
        sectionAsanaGid = membership.section.gid;
      }
    }

    const project = projectAsanaGid ? projectByAsanaGid.get(projectAsanaGid) : null;
    const section = project && sectionAsanaGid ? project.sectionByAsanaGid.get(sectionAsanaGid) : null;

    let description = (t.notes || "").trim();
    if (isSubtask && parentTitle) {
      description = `↳ Subtarea de «${parentTitle}» (importado de Asana)${description ? `\n\n${description}` : ""}`;
    }

    tasks.push({
      asanaGid: gid,
      title: (t.name || "(sin título)").trim(),
      description,
      isMilestone: t.resource_subtype === "milestone",
      isComplete: !!t.completed,
      dueDate: t.due_on || null,
      startDate: t.start_on || null,
      tags: (t.tags || []).map((ref) => tagNameByGid.get(ref.gid)).filter(Boolean),
      assigneeAsanaGid: t.assignee ? t.assignee.gid : null,
      createdByAsanaGid: t.created_by ? t.created_by.gid : null,
      createdAt: t.created_at || null,
      completedAt: t.completed_at || null,
      project, // objeto de proyecto (o null => tarea personal, sin proyecto en Asana)
      projectAsanaGid,
      sectionId: section ? section.id : (project ? project.sections[0].id : null),
      isSubtask,
      comments: (entry.comments || [])
        .map((c) => ({
          asanaGid: c.gid,
          text: (c.text || "").trim(),
          authorAsanaGid: c.created_by ? c.created_by.gid : null,
          createdAt: c.created_at || null,
        }))
        .filter((c) => c.text),
    });
  });

  const summary = {
    projects: projects.length,
    projectsArchived: projects.filter((p) => p.archived).length,
    tasks: tasks.length,
    subtasks: tasks.filter((t) => t.isSubtask).length,
    personal: tasks.filter((t) => !t.project).length,
    milestones: tasks.filter((t) => t.isMilestone).length,
    completed: tasks.filter((t) => t.isComplete).length,
    comments: tasks.reduce((n, t) => n + t.comments.length, 0),
    tags: resolvedTagBySlug.size,
    users: asanaUsers.length,
  };

  return { asanaUsers, projects, tasks, resolvedTagBySlug, summary, warnings, exportedAt: raw.exported_at || null };
}

// ============================================================================
// Estado persistido: mapa de equivalencias e índice de lo ya importado.
// ============================================================================
export async function getUserMap() {
  const snap = await getDoc(doc(db, "meta", "asanaUserMap"));
  return snap.exists() ? snap.data() : {};
}

export async function getImportIndex() {
  const snap = await getDoc(doc(db, "meta", "asanaImportIndex"));
  return snap.exists() ? snap.data() : { projects: {}, tasks: {}, comments: {}, byFicticiousUser: {} };
}

/** Comparación de solo lectura, para el resumen previo a confirmar: cuánto de
 * este archivo es nuevo frente a lo que ya se importó otra vez. */
export function diffAgainstIndex(parsed, index) {
  const knownProjects = new Set(Object.keys(index.projects || {}));
  const knownTasks = new Set(Object.keys(index.tasks || {}));
  const knownComments = new Set(Object.keys(index.comments || {}));
  const newProjects = parsed.projects.filter((p) => !knownProjects.has(p.asanaGid)).length;
  const newTasks = parsed.tasks.filter((t) => !knownTasks.has(t.asanaGid)).length;
  let newComments = 0;
  parsed.tasks.forEach((t) => t.comments.forEach((c) => { if (!knownComments.has(c.asanaGid)) newComments++; }));
  return {
    newProjects, existingProjects: parsed.projects.length - newProjects,
    newTasks, existingTasks: parsed.tasks.length - newTasks,
    newComments, existingComments: parsed.summary.comments - newComments,
  };
}

// ============================================================================
// Escritura en Firestore.
// ============================================================================

/** Crea (si no existen ya) los perfiles ficticios de toda persona de Asana
 * que todavía no tenga una cuenta real asignada en userMap. */
async function ensureFicticiousUsers(asanaUsers, userMap) {
  let batch = writeBatch(db);
  let ops = 0;
  for (const au of asanaUsers) {
    if (userMap[au.gid]) continue;
    batch.set(
      doc(db, "users", `asana:${au.gid}`),
      {
        name: au.name,
        email: au.email,
        role: "miembro",
        isImported: true,
        asanaGid: au.gid,
        mergedInto: null,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    ops++;
    if (ops >= BATCH_LIMIT) { await batch.commit(); batch = writeBatch(db); ops = 0; }
  }
  if (ops) await batch.commit();
}

/**
 * Importa lo nuevo de `parsed` (lo que ya está en el índice se salta, no se
 * duplica ni se pisa). Devuelve un resumen de cuántas cosas se crearon.
 */
export async function runImport(parsed, { currentUser, teamMembers, userMap, onProgress }) {
  const report = (msg) => { if (onProgress) onProgress(msg); };

  report("Creando usuarios ficticios pendientes…");
  await ensureFicticiousUsers(parsed.asanaUsers, userMap);

  const asanaNameByGid = new Map(parsed.asanaUsers.map((u) => [u.gid, u.name]));
  function resolveUserId(asanaGid) {
    if (!asanaGid) return null;
    return userMap[asanaGid] || `asana:${asanaGid}`;
  }
  function resolveUserName(asanaGid) {
    if (!asanaGid) return "Alguien";
    const mappedUid = userMap[asanaGid];
    if (mappedUid) {
      const real = teamMembers.find((m) => m.uid === mappedUid);
      if (real) return real.name || real.email;
    }
    return asanaNameByGid.get(asanaGid) || "Persona de Asana";
  }

  const index = await getImportIndex();
  const projectGidsAlreadyImported = new Set(Object.keys(index.projects || {}));
  const projectIdByAsanaGid = new Map(Object.entries(index.projects || {}));
  const taskIdByAsanaGid = new Map(Object.entries(index.tasks || {}));
  const commentIndex = { ...(index.comments || {}) };

  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; }
  };
  const stage = (ref, data) => {
    batch.set(ref, data);
    ops++;
    return ops >= BATCH_LIMIT ? flush() : null;
  };
  const stageUpdate = (ref, data) => {
    batch.update(ref, data);
    ops++;
    return ops >= BATCH_LIMIT ? flush() : null;
  };

  // ---- proyectos ----
  report("Importando proyectos…");
  const newProjects = parsed.projects.filter((p) => !projectIdByAsanaGid.has(p.asanaGid));
  for (const p of newProjects) {
    const ref = doc(collection(db, "projects"));
    projectIdByAsanaGid.set(p.asanaGid, ref.id);
    await stage(ref, {
      name: p.name,
      description: p.notes,
      color: p.color,
      icon: DEFAULT_PROJECT_ICON,
      sections: p.sections.map(({ id, name }, i) => ({ id, name, order: i })),
      memberIds: [currentUser.uid],
      createdBy: resolveUserId(p.ownerAsanaGid) || currentUser.uid,
      createdAt: serverTimestamp(),
      archived: p.archived,
      asanaGid: p.asanaGid,
    });
  }
  await flush();

  // ---- proyectos que YA existían: sincronizar secciones nuevas ----
  // El proyecto no se vuelve a crear entero, pero si este archivo trae una
  // sección que su documento todavía no tiene (por id, ya determinista —
  // ver parseAsanaExport), se añade. Si no se hiciera esto, cualquier tarea
  // nueva de esa sección se quedaría sin dónde agruparse visualmente,
  // aunque sí contaría en el total de tareas del proyecto.
  report("Comprobando secciones de proyectos existentes…");
  const projectsWithNewSections = new Set();
  for (const p of parsed.projects) {
    if (!projectGidsAlreadyImported.has(p.asanaGid)) continue; // es nuevo, ya se ha creado arriba al día
    const projectId = projectIdByAsanaGid.get(p.asanaGid);
    if (!projectId) continue;
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) continue;
    const currentSections = snap.data().sections || [];
    const currentIds = new Set(currentSections.map((s) => s.id));
    const missing = p.sections.filter((s) => !currentIds.has(s.id));
    if (missing.length) {
      const merged = [
        ...currentSections,
        ...missing.map((s, i) => ({ id: s.id, name: s.name, order: currentSections.length + i })),
      ];
      await updateDoc(doc(db, "projects", projectId), { sections: merged });
      projectsWithNewSections.add(p.asanaGid);
    }
  }

  // ---- tareas (de proyecto o personales) ----
  report("Importando tareas…");
  const newTasks = parsed.tasks.filter((t) => !taskIdByAsanaGid.has(t.asanaGid));
  for (const t of newTasks) {
    const isPersonal = !t.project;
    const projectId = isPersonal ? null : projectIdByAsanaGid.get(t.projectAsanaGid);
    if (!isPersonal && !projectId) continue; // proyecto no resuelto, no debería pasar

    const ref = doc(collection(db, "tasks"));
    taskIdByAsanaGid.set(t.asanaGid, ref.id);
    const assigneeId = resolveUserId(t.assigneeAsanaGid);
    const createdById = resolveUserId(t.createdByAsanaGid) || currentUser.uid;

    await stage(ref, {
      projectId,
      ownerId: isPersonal ? (assigneeId || createdById) : null,
      sectionId: isPersonal ? null : t.sectionId,
      title: t.title,
      description: t.description,
      assigneeIds: assigneeId ? [assigneeId] : [],
      dueDate: t.dueDate,
      startDate: t.startDate,
      priority: "media",
      tags: t.tags,
      dependsOn: [],
      subtasks: [],
      attachments: [], // no se importan: el export no trae archivos y reconstruir enlaces a partir de Asana no tiene sentido para una migración fuera de Asana
      customFields: {},
      isComplete: t.isComplete,
      isMilestone: t.isMilestone,
      completedAt: t.completedAt ? Timestamp.fromDate(new Date(t.completedAt)) : null,
      order: t.createdAt ? new Date(t.createdAt).getTime() : Date.now(),
      createdBy: createdById,
      createdAt: t.createdAt ? Timestamp.fromDate(new Date(t.createdAt)) : serverTimestamp(),
      updatedAt: serverTimestamp(),
      asanaGid: t.asanaGid,
    });
  }
  await flush();

  // ---- tareas ya importadas en proyectos que acaban de recibir secciones
  // nuevas: si alguna se quedó con un id de sección que ya no existe (el
  // fallo que se acaba de arreglar más arriba producía justo esto), se
  // corrige aquí solo ese campo — si la moviste tú a mano a otra sección
  // que sigue siendo válida, eso no se toca.
  let tasksRepaired = 0;
  if (projectsWithNewSections.size) {
    report("Reparando tareas ya importadas con sección huérfana…");
    const validSectionIdsByProjectGid = new Map(
      parsed.projects.map((p) => [p.asanaGid, new Set(p.sections.map((s) => s.id))])
    );
    const toRecheck = parsed.tasks.filter(
      (t) => t.project && projectsWithNewSections.has(t.projectAsanaGid) && !newTasks.includes(t)
    );
    const CONCURRENCY = 25;
    for (let i = 0; i < toRecheck.length; i += CONCURRENCY) {
      const slice = toRecheck.slice(i, i + CONCURRENCY);
      const snaps = await Promise.all(slice.map((t) => getDoc(doc(db, "tasks", taskIdByAsanaGid.get(t.asanaGid)))));
      for (let j = 0; j < slice.length; j++) {
        const t = slice[j];
        const snap = snaps[j];
        if (!snap.exists()) continue;
        const validIds = validSectionIdsByProjectGid.get(t.projectAsanaGid);
        const storedSectionId = snap.data().sectionId;
        if (validIds && !validIds.has(storedSectionId)) {
          await stageUpdate(doc(db, "tasks", taskIdByAsanaGid.get(t.asanaGid)), { sectionId: t.sectionId });
          tasksRepaired++;
        }
      }
    }
    await flush();
  }

  // ---- etiquetas: upsertTag es idempotente por diseño (mismo nombre =
  // mismo slug = mismo documento), así que no hace falta comprobar el
  // índice para esto ----
  report("Sincronizando etiquetas…");
  for (const { name, color } of parsed.resolvedTagBySlug.values()) {
    if (name) await upsertTag({ name, color });
  }

  // ---- comentarios ----
  report("Importando comentarios…");
  let newCommentsCount = 0;
  for (const t of parsed.tasks) {
    if (!t.comments.length) continue;
    const taskId = taskIdByAsanaGid.get(t.asanaGid);
    if (!taskId) continue;
    for (const c of t.comments) {
      if (commentIndex[c.asanaGid]) continue;
      const ref = doc(collection(db, "tasks", taskId, "comments"));
      await stage(ref, {
        authorId: resolveUserId(c.authorAsanaGid) || currentUser.uid,
        authorName: resolveUserName(c.authorAsanaGid),
        text: c.text,
        createdAt: c.createdAt ? Timestamp.fromDate(new Date(c.createdAt)) : serverTimestamp(),
        asanaGid: c.asanaGid,
      });
      commentIndex[c.asanaGid] = { taskId, commentId: ref.id };
      newCommentsCount++;
    }
  }
  await flush();

  // ---- índice inverso: qué tareas/comentarios quedan bajo cada persona
  // ficticia. Se recorren TODAS las tareas del archivo (no solo las nuevas)
  // para que, si esto se ejecuta sobre un archivo ya importado antes de que
  // este índice existiera, una simple re-importación lo deje al día sin
  // duplicar nada. Se parte de lo que ya hubiera en el índice por si esta
  // carga no cubre tareas de una importación anterior con otro archivo.
  report("Indexando personas ficticias…");
  const byFicticiousUser = {};
  for (const [gid, bucket] of Object.entries(index.byFicticiousUser || {})) {
    byFicticiousUser[gid] = {
      assigneeTaskIds: [...(bucket.assigneeTaskIds || [])],
      creatorTaskIds: [...(bucket.creatorTaskIds || [])],
      ownerTaskIds: [...(bucket.ownerTaskIds || [])],
      comments: [...(bucket.comments || [])],
    };
  }
  const bucketFor = (gid) => {
    if (!byFicticiousUser[gid]) byFicticiousUser[gid] = { assigneeTaskIds: [], creatorTaskIds: [], ownerTaskIds: [], comments: [] };
    return byFicticiousUser[gid];
  };
  for (const t of parsed.tasks) {
    const taskId = taskIdByAsanaGid.get(t.asanaGid);
    if (!taskId) continue;
    if (t.assigneeAsanaGid && !userMap[t.assigneeAsanaGid]) {
      const b = bucketFor(t.assigneeAsanaGid);
      if (!b.assigneeTaskIds.includes(taskId)) b.assigneeTaskIds.push(taskId);
    }
    if (t.createdByAsanaGid && !userMap[t.createdByAsanaGid]) {
      const b = bucketFor(t.createdByAsanaGid);
      if (!b.creatorTaskIds.includes(taskId)) b.creatorTaskIds.push(taskId);
    }
    if (!t.project) {
      // tarea personal: el dueño es el mismo resuelto que se usó al
      // crearla (responsable y, si no había, quien la creó)
      const ownerGid = t.assigneeAsanaGid || t.createdByAsanaGid;
      if (ownerGid && !userMap[ownerGid]) {
        const b = bucketFor(ownerGid);
        if (!b.ownerTaskIds.includes(taskId)) b.ownerTaskIds.push(taskId);
      }
    }
    for (const c of t.comments) {
      const ref = commentIndex[c.asanaGid];
      if (!ref || !c.authorAsanaGid || userMap[c.authorAsanaGid]) continue;
      const b = bucketFor(c.authorAsanaGid);
      if (!b.comments.some((x) => x.taskId === ref.taskId && x.commentId === ref.commentId)) {
        b.comments.push({ taskId: ref.taskId, commentId: ref.commentId });
      }
    }
  }

  report("Guardando el índice de importación…");
  await setDoc(
    doc(db, "meta", "asanaImportIndex"),
    {
      projects: Object.fromEntries(projectIdByAsanaGid),
      tasks: Object.fromEntries(taskIdByAsanaGid),
      comments: commentIndex,
      byFicticiousUser,
      lastImportAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    projectsCreated: newProjects.length,
    projectsSkipped: parsed.projects.length - newProjects.length,
    projectsSectionsSynced: projectsWithNewSections.size,
    tasksCreated: newTasks.length,
    tasksSkipped: parsed.tasks.length - newTasks.length,
    tasksRepaired,
    commentsCreated: newCommentsCount,
    commentsSkipped: parsed.summary.comments - newCommentsCount,
  };
}

/**
 * Aplica la equivalencia "esta persona de Asana es en realidad Fulanito":
 * reescribe todas las tareas y comentarios que hasta ahora llevaban el id
 * ficticio (localizados por id directo a través del índice construido
 * durante la importación, no mediante una consulta amplia sobre `tasks` —
 * eso es lo que fallaba con "privilegios insuficientes": la regla de
 * lectura de `tasks` que dice "o es tuya o eres admin" no la puede
 * verificar Firestore para una CONSULTA sobre documentos ajenos, aunque sí
 * para leer o escribir un documento concreto por id, que es lo que se hace
 * aquí) y marca el perfil ficticio como fusionado (no se borra, por si
 * queda algo suelto que se nos haya escapado).
 */
export async function applyUserMapping({ asanaGid, targetUid, teamMembers }) {
  const ficticioId = `asana:${asanaGid}`;
  const target = teamMembers.find((m) => m.uid === targetUid);
  if (!target) throw new Error("No se encontró esa cuenta.");

  const ficticioSnap = await getDoc(doc(db, "users", ficticioId));
  if (!ficticioSnap.exists()) {
    throw new Error(
      "Esta persona ya no existe como usuario ficticio (puede que se haya borrado con \"Borrar todo lo importado\"). Vuelve a cargar el archivo de importación para regenerarla."
    );
  }

  const index = await getImportIndex();
  const bucket = (index.byFicticiousUser || {})[asanaGid] || { assigneeTaskIds: [], creatorTaskIds: [], ownerTaskIds: [], comments: [] };

  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
  const stage = async (ref, data) => {
    batch.update(ref, data);
    ops++;
    if (ops >= BATCH_LIMIT) await flush();
  };

  try {
    // assigneeIds es un array: quitar el id ficticio y añadir el real son
    // dos pasadas independientes (arrayRemove/arrayUnion), porque un mismo
    // campo no admite dos transformaciones distintas en una sola escritura.
    for (const taskId of bucket.assigneeTaskIds) {
      await stage(doc(db, "tasks", taskId), { assigneeIds: arrayRemove(ficticioId) });
    }
    await flush();
    for (const taskId of bucket.assigneeTaskIds) {
      await stage(doc(db, "tasks", taskId), { assigneeIds: arrayUnion(targetUid) });
    }
    await flush();
    for (const taskId of bucket.creatorTaskIds) {
      await stage(doc(db, "tasks", taskId), { createdBy: targetUid });
    }
    await flush();
    // tareas personales (sin proyecto): el dueño también hay que
    // reescribirlo, o la persona real nunca podría ver su propia tarea al
    // registrarse.
    for (const taskId of bucket.ownerTaskIds || []) {
      await stage(doc(db, "tasks", taskId), { ownerId: targetUid });
    }
    await flush();
    for (const { taskId, commentId } of bucket.comments) {
      await stage(doc(db, "tasks", taskId, "comments", commentId), {
        authorId: targetUid,
        authorName: target.name || target.email,
      });
    }
    await flush();
  } catch (err) {
    throw new Error(
      `Alguna tarea o comentario del índice ya no existe en Firestore (¿se borró a mano después de importar?). Vuelve a cargar el archivo de importación para regenerar el índice antes de reintentar. Detalle: ${err.message}`
    );
  }

  await updateDoc(doc(db, "users", ficticioId), { mergedInto: targetUid });
  await setDoc(doc(db, "meta", "asanaUserMap"), { [asanaGid]: targetUid }, { merge: true });

  return {
    tasksUpdated: new Set([...bucket.assigneeTaskIds, ...bucket.creatorTaskIds, ...(bucket.ownerTaskIds || [])]).size,
    commentsUpdated: bucket.comments.length,
  };
}

/**
 * Borra TODO lo que se haya importado hasta ahora (según el índice) y a
 * las personas ficticias que sigan sin fusionar. Pensado para limpiar una
 * importación de prueba antes de la definitiva — no toca nada que no esté
 * marcado como importado.
 */
export async function wipeImportedData({ ficticiousUserIds }) {
  const index = await getImportIndex();
  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
  const del = async (ref) => {
    batch.delete(ref);
    ops++;
    if (ops >= BATCH_LIMIT) await flush();
  };

  for (const { taskId, commentId } of Object.values(index.comments || {})) {
    await del(doc(db, "tasks", taskId, "comments", commentId));
  }
  await flush();
  for (const taskId of Object.values(index.tasks || {})) {
    await del(doc(db, "tasks", taskId));
  }
  await flush();
  for (const projectId of Object.values(index.projects || {})) {
    await del(doc(db, "projects", projectId));
  }
  await flush();
  for (const userId of ficticiousUserIds) {
    await del(doc(db, "users", userId));
  }
  await flush();

  await setDoc(doc(db, "meta", "asanaImportIndex"), { projects: {}, tasks: {}, comments: {}, byFicticiousUser: {} });
  await setDoc(doc(db, "meta", "asanaUserMap"), {});

  return {
    projectsDeleted: Object.keys(index.projects || {}).length,
    tasksDeleted: Object.keys(index.tasks || {}).length,
    commentsDeleted: Object.keys(index.comments || {}).length,
    usersDeleted: ficticiousUserIds.length,
  };
}
