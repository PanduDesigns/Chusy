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
//
// v63 — «Diseño» se reparte en dos departamentos, «Diseño - Industria» y
// «Diseño - Automoción». Para el ACCESO siguen siendo uno solo: cada
// departamento declara a qué GRUPO de acceso pertenece (`access`) y los
// `allowedDepartments` de una sección exclusiva guardan grupos («diseno»,
// «tecnicos», «produccion»), no departamentos sueltos — por eso Ofertas, que
// ya tenía ["diseno"], no ha necesitado ningún cambio de datos y los dos
// Diseño entran igual que el Diseño de antes. (departmentHasAccess() también
// acepta el valor del departamento tal cual, por si algún día una sección
// debe abrirse solo a uno de los dos: bastaría con guardarlo en su
// `allowedDepartments` y ofrecerlo en «Accesos por departamento».)
//
// Lo único que de momento distingue a un Diseño del otro es el SECTOR por
// defecto de las ofertas que crea (`defaultSector`): Industria o Automoción,
// tanto con «+ Nueva oferta» como con la macro de Outlook. Quien lo crea
// puede cambiarlo después a mano.
//
// El valor antiguo «diseno» (el Diseño de antes de la v63, sin sector) sigue
// siendo válido para no dejar sin acceso a quien lo tenga ya asignado: se
// trata como Diseño a efectos de acceso, no lleva sector por defecto y solo
// se ofrece en «Administrar equipo» mientras alguien lo tenga. Un admin lo
// sustituye por uno de los dos nuevos cuando quiera, persona a persona.
// ============================================================================
/**
 * Los grupos de ACCESO: lo que se marca en «Accesos por departamento» y lo
 * que guardan los `allowedDepartments` de una sección exclusiva (v63).
 */
export const DEPARTMENT_GROUPS = [
  { value: "diseno", label: "Diseño" },
  { value: "tecnicos", label: "Técnicos" },
  { value: "produccion", label: "Producción" },
];

/**
 * Los departamentos que se pueden asignar a una persona. `access` = su grupo
 * de acceso (si falta, él mismo); `defaultSector` = el Sector con el que
 * nacen las ofertas que crea (uno de los de SECTOR_OPTIONS, offers.js).
 */
export const DEPARTMENTS = [
  { value: "diseno-industria", label: "Diseño - Industria", access: "diseno", defaultSector: "Industria" },
  { value: "diseno-automocion", label: "Diseño - Automoción", access: "diseno", defaultSector: "Automoción" },
  { value: "tecnicos", label: "Técnicos" },
  { value: "produccion", label: "Producción" },
];

/** El «Diseño» de antes de la v63 (sin sector): válido, pero ya no se ofrece para asignar. */
export const LEGACY_DEPARTMENT = { value: "diseno", label: "Diseño", access: "diseno" };

/** El departamento de un valor guardado (incluido el antiguo «diseno»), o undefined si no existe. */
export function findDepartment(value) {
  return DEPARTMENTS.find((d) => d.value === value) || (value === LEGACY_DEPARTMENT.value ? LEGACY_DEPARTMENT : undefined);
}

/** Etiqueta legible de un valor de departamento (o "Sin departamento" si es null/no reconocido). */
export function departmentLabel(value) {
  const found = findDepartment(value);
  return found ? found.label : "Sin departamento";
}

/** El grupo de acceso de un departamento («diseno-industria» → «diseno»). Un valor desconocido se devuelve tal cual. */
export function accessGroupOf(value) {
  const found = findDepartment(value);
  return found ? found.access || found.value : value;
}

/**
 * ¿Entra una persona con este departamento en una sección cuyos
 * `allowedDepartments` son estos? Sí si está su grupo («diseno») o, por si
 * una sección se abre algún día a uno solo, el departamento mismo.
 */
export function departmentHasAccess(departmentValue, allowedDepartments) {
  if (!departmentValue) return false;
  const allowed = allowedDepartments || [];
  return allowed.includes(departmentValue) || allowed.includes(accessGroupOf(departmentValue));
}

/** El Sector con el que nacen las ofertas de este departamento ("" si no tiene uno por defecto). */
export function defaultSectorOf(departmentValue) {
  const found = findDepartment(departmentValue);
  return (found && found.defaultSector) || "";
}

/**
 * Las opciones del desplegable de departamento de una persona: los
 * departamentos de siempre y, solo si ella aún tiene el «Diseño» antiguo, ese
 * mismo — para que el desplegable muestre su valor real en vez de aparentar
 * «Sin departamento» y no se lo cambie nadie sin querer.
 */
export function departmentOptionsFor(currentValue) {
  return currentValue === LEGACY_DEPARTMENT.value ? [{ ...LEGACY_DEPARTMENT, label: `${LEGACY_DEPARTMENT.label} (sin sector)` }, ...DEPARTMENTS] : DEPARTMENTS;
}

// ============================================================================
// Alcance de Métricas por departamento (v77)
//
// Quién pertenece a qué departamento ya estaba claro desde la v55: cada
// persona tiene UN solo `users/{uid}.department` (lo asigna un admin desde
// «Administrar equipo»; no hay lista de departamentos por persona). Métricas
// lo usa así:
//  · Admin: ve a todo el mundo y puede acotar con un selector por
//    departamento (`metricsDepartmentOptions()`).
//  · Revisor (el único rol no-admin con Métricas): solo ve a las personas de
//    su propio GRUPO DE ACCESO (`accessGroupOf`), así que un «Diseño -
//    Industria» ve también a «Diseño - Automoción» — para el acceso son un
//    solo departamento (v63). Para ceñirlo al departamento exacto bastaría
//    con cambiar `accessGroupOf(user.department)` por el `value` de
//    `findDepartment(user.department)` en `metricsScopeFor()`.
//  · Un Revisor sin departamento asignado (o con un valor que ya no existe)
//    no ve a nadie: sin departamento no hay a quién enseñar.
//
// «Filtro» es un string: "" = todos; "none" = personas sin departamento
// (solo lo elige un admin); un grupo («diseno») o un departamento
// («diseno-industria») = solo esas personas; null = nadie.
// ============================================================================
/** Valor del filtro «Sin departamento» (solo en el selector del admin). */
export const METRICS_NO_DEPARTMENT = "none";

/**
 * Las opciones del selector de Métricas del admin: todos, cada grupo y, bajo
 * el grupo que los contiene, sus departamentos concretos (hoy, los dos
 * Diseño), y al final «Sin departamento».
 */
export function metricsDepartmentOptions() {
  const options = [{ value: "", label: "Todos los departamentos" }];
  for (const group of DEPARTMENT_GROUPS) {
    options.push({ value: group.value, label: group.label });
    for (const d of DEPARTMENTS) {
      if (d.access === group.value && d.value !== group.value) options.push({ value: d.value, label: d.label, indent: true });
    }
  }
  options.push({ value: METRICS_NO_DEPARTMENT, label: "Sin departamento" });
  return options;
}

/**
 * El filtro de Métricas que de verdad se aplica a `user`: el elegido por un
 * admin (si es una opción válida; si no, «todos»), o el de su propio grupo
 * para cualquier otro rol — ignora lo que pida, así que un Revisor no puede
 * ampliar su alcance ni a la fuerza. `null` = nadie (sin departamento
 * reconocido). Sin usuario, también nadie.
 */
export function metricsScopeFor(user, requested) {
  if (!user) return null;
  if (user.role === "admin") {
    const valid = metricsDepartmentOptions().some((o) => o.value === (requested || ""));
    return valid ? requested || "" : "";
  }
  return findDepartment(user.department) ? accessGroupOf(user.department) : null;
}

/** ¿Entra esta persona en el filtro? (`filter`: ver arriba; `null` no deja entrar a nadie). */
export function memberMatchesDepartmentFilter(member, filter) {
  if (filter === null || filter === undefined) return false;
  if (filter === "") return true;
  const dept = member ? findDepartment(member.department) : undefined;
  if (filter === METRICS_NO_DEPARTMENT) return !dept;
  return !!dept && (dept.value === filter || (dept.access || dept.value) === filter);
}

/** Texto del filtro para mostrar («Diseño», «Diseño - Industria», «Sin departamento»); "" para «todos». */
export function metricsFilterLabel(filter) {
  if (!filter) return "";
  if (filter === METRICS_NO_DEPARTMENT) return "Sin departamento";
  const found = DEPARTMENT_GROUPS.find((g) => g.value === filter) || findDepartment(filter);
  return found ? found.label : "";
}
