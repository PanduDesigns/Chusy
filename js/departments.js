// ============================================================================
// Departamentos (v55): una capa de acceso ADICIONAL al rol (admin/revisor/
// miembro), pensada de cara a que Chusy crezca a más departamentos y a más
// secciones propias de cada uno. Por ahora tres, fijos — añadir un cuarto
// más adelante es solo añadir una entrada aquí, no hace falta tocar nada
// más de este archivo.
//
// Por sí solo, el departamento de una persona NO cambia nada de lo que ya
// existía antes de la v55: todo proyecto normal sigue abierto a todo el
// equipo, tenga quien sea el departamento que tenga (o ninguno). Solo
// importa para una "sección exclusiva" como Ofertas (ver
// EXCLUSIVE_PROJECT_SEEDS en data/projects.js) — qué departamentos pueden
// acceder a cada una se configura aparte, desde la ventana de
// administración "Accesos por departamento" (department-access-modal.js).
//
// Se asigna por persona desde "Administrar equipo" (team-admin-modal.js,
// solo admin — lo exige también firestore.rules) y vive en
// users/{uid}.department: uno de los `value` de abajo, o null/ausente si
// todavía no se le ha asignado ninguno.
// ============================================================================
export const DEPARTMENTS = [
  { value: "diseno", label: "Diseño" },
  { value: "tecnicos", label: "Técnicos" },
  { value: "produccion", label: "Producción" },
];

/** Etiqueta legible de un valor de departamento (o "Sin departamento" si es null/no reconocido). */
export function departmentLabel(value) {
  const found = DEPARTMENTS.find((d) => d.value === value);
  return found ? found.label : "Sin departamento";
}
