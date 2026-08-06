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
      options: projects.map((p) => ({ value: p.id, label: p.name, color: p.color })),
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
 * 'project' | `cf:<id>`. Las completadas siempre van al final, tengan o no
 * columna elegida; dentro de cada bloque (pendientes/completadas), si no
 * hay columna elegida se ordena por prioridad.
 */
export function sortTasks(tasks, sort, { teamMembers = [], projects = [] } = {}) {
  const dir = sort && sort.direction === "desc" ? -1 : 1;

  const valueOf = (t) => {
    switch (sort && sort.column) {
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
      default:
        if (sort && sort.column && sort.column.startsWith("cf:")) {
          const fieldId = sort.column.slice(3);
          const v = t.customFields ? t.customFields[fieldId] : null;
          if (v === undefined || v === null || v === "") return null;
          const n = Number(v);
          return Number.isNaN(n) ? String(v).toLowerCase() : n;
        }
        return PRIORITY_ORDER[t.priority]; // sin columna elegida: prioridad
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

  const pending = tasks.filter((t) => !t.isComplete).sort(compare);
  const done = tasks.filter((t) => t.isComplete).sort(compare);
  return [...pending, ...done];
}
