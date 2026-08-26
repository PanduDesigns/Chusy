// ============================================================================
// Filtrado y ordenación de tareas — todo en el cliente, ya que las tareas
// de un proyecto o de "mis tareas" ya están cargadas enteras. Los campos
// personalizados usan la clave "cf:<id>" tanto en filtros como en orden.
// ============================================================================
export function applyTaskFilters(tasks, activeFilters) {
  if (!activeFilters) return tasks;
  const entries = Object.entries(activeFilters).filter(([, set]) => set && set.size > 0);
  if (!entries.length) return tasks;

  return tasks.filter((t) => {
    for (const [key, set] of entries) {
      if (key === "assignee") {
        if (!t.assigneeIds || !t.assigneeIds.some((id) => set.has(id))) return false;
      } else if (key === "priority") {
        if (!set.has(t.priority)) return false;
      } else if (key === "status") {
        const statusKey = t.isComplete ? "completada" : "pendiente";
        if (!set.has(statusKey)) return false;
      } else if (key === "tags") {
        const hasNoneSelected = set.has("__none__");
        const matchesTag = t.tags && t.tags.some((tag) => set.has(tag));
        const matchesNone = hasNoneSelected && (!t.tags || t.tags.length === 0);
        if (!matchesTag && !matchesNone) return false;
      } else if (key === "project") {
        if (!set.has(t.projectId || "")) return false;
      } else if (key.startsWith("cf:")) {
        const fieldId = key.slice(3);
        const val = t.customFields ? t.customFields[fieldId] : null;
        if (val === null || val === undefined || val === "" || !set.has(String(val))) return false;
      }
    }
    return true;
  });
}

/** Construye las columnas de filtro disponibles para el contexto actual. */
export function buildFilterDefs({ teamMembers, tagsRegistry, projects, project, customFieldDefs, tasks = [], includeStatus = true, includeProject = false }) {
  const defs = [
    {
      key: "assignee",
      label: "Responsable",
      options: (teamMembers || []).map((m) => ({ value: m.uid, label: m.name })),
    },
    {
      key: "priority",
      label: "Prioridad",
      options: [
        { value: "urgente", label: "Urgente" },
        { value: "alta", label: "Alta" },
        { value: "media", label: "Media" },
        { value: "baja", label: "Baja" },
      ],
    },
    {
      key: "tags",
      label: "Etiquetas",
      options: [
        { value: "__none__", label: "Sin etiqueta" },
        ...(tagsRegistry || []).map((t) => ({ value: t.name, label: t.name, color: t.color })),
      ],
    },
  ];
  if (includeStatus) {
    defs.push({
      key: "status",
      label: "Estado",
      options: [
        { value: "pendiente", label: "Pendiente" },
        { value: "completada", label: "Completada" },
      ],
    });
  }
  if (includeProject && projects) {
    defs.push({
      key: "project",
      label: "Proyecto",
      options: projects.map((p) => ({ value: p.id, label: p.name, color: p.color, icon: p.icon })),
    });
  }
  const cfDefs = customFieldDefs || (project && project.customFieldDefs) || [];
  cfDefs.forEach((f) => {
    const options =
      f.type === "lista"
        ? f.options.map((opt) => ({ value: opt, label: opt }))
        : distinctValues(tasks, f.id).map((v) => ({ value: v, label: v }));
    defs.push({ key: `cf:${f.id}`, label: f.name, options });
  });
  return defs;
}

function distinctValues(tasks, fieldId) {
  const set = new Set();
  tasks.forEach((t) => {
    const v = t.customFields ? t.customFields[fieldId] : null;
    if (v !== null && v !== undefined && v !== "") set.add(String(v));
  });
  return [...set].sort();
}

const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baja: 3 };

/**
 * Ordena por una columna: 'title' | 'dueDate' | 'priority' | 'assignee' |
 * 'project' | 'tags' | `cf:<id>`. Las completadas siempre van al final,
 * tengan o no columna elegida.
 *
 * SIN columna elegida (el estado inicial, al entrar o tras limpiar el
 * orden): fecha límite ascendente — las tareas sin fecha siempre al
 * final — y, dentro de la misma fecha (o entre las que no tienen),
 * por prioridad (urgente primero). Antes se ordenaba solo por prioridad
 * ignorando la fecha por completo, así que con varias tareas de la misma
 * prioridad el orden real dependía de cómo las hubiera devuelto
 * Firestore — no de nada visible para quien mira la lista.
 *
 * 'tags': una tarea puede llevar varias etiquetas, así que se ordena por
 * la que sea alfabéticamente primera entre las suyas (mismo criterio que
 * 'assignee', que ya usaba el primer responsable de la lista).
 */
export function sortTasks(tasks, sort, { teamMembers = [], projects = [] } = {}) {
  const dir = sort && sort.direction === "desc" ? -1 : 1;
  const hasColumn = !!(sort && sort.column);

  const valueOf = (t) => {
    switch (sort.column) {
      case "title":
        return (t.title || "").toLowerCase();
      case "dueDate":
        return t.dueDate || null;
      case "priority":
        return PRIORITY_ORDER[t.priority];
      case "assignee": {
        const m = teamMembers.find((m) => m.uid === (t.assigneeIds || [])[0]);
        return m ? m.name.toLowerCase() : null;
      }
      case "project": {
        const p = projects.find((p) => p.id === t.projectId);
        return p ? p.name.toLowerCase() : null;
      }
      case "tags":
        return t.tags && t.tags.length ? [...t.tags].map((s) => s.toLowerCase()).sort()[0] : null;
      default:
        if (sort.column.startsWith("cf:")) {
          const fieldId = sort.column.slice(3);
          const v = t.customFields ? t.customFields[fieldId] : null;
          if (v === undefined || v === null || v === "") return null;
          const n = Number(v);
          return Number.isNaN(n) ? String(v).toLowerCase() : n;
        }
        return null;
    }
  };

  const compare = (a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  };

  const defaultCompare = (a, b) => {
    const aEmpty = !a.dueDate, bEmpty = !b.dueDate;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (!aEmpty && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
  };

  const finalCompare = hasColumn ? compare : defaultCompare;
  const pending = tasks.filter((t) => !t.isComplete).sort(finalCompare);
  const done = tasks.filter((t) => t.isComplete).sort(finalCompare);
  return [...pending, ...done];
}
