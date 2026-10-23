// ============================================================================
// Sidebar: lista de proyectos, botón de crear proyecto, pie con el usuario.
// Se puede minimizar a una barra de iconos con el botón de la esquina
// (redondo, en el borde derecho) — queda como preferencia de este
// navegador, no afecta a nadie más ni a otras sesiones.
//
// Secciones exclusivas (v55, ver EXCLUSIVE_PROJECT_SEEDS en
// data/projects.js): un proyecto con `exclusive: true` (Ofertas, de
// momento) NO entra en la lista "Proyectos" de abajo — sale como un botón
// fijo más, junto a "Mis tareas"/"Línea de tiempo"/"Archivo", reutilizando
// exactamente la misma plantilla y el mismo cableado de clic/clic derecho
// que ya tenía cualquier proyecto normal (mismo `data-project-id`, así que
// "Editar proyecto"/"Campos personalizados"/"Archivar"/"Eliminar" del menú
// contextual siguen funcionando igual). `projects` ya llega aquí filtrado
// por quién puede ver qué (ver bootstrap() en app.js) — este archivo solo
// decide DÓNDE se pinta cada uno, no quién lo ve. Desde la v56 su icono va
// suelto (el emoji, sin el cuadradito de color de un proyecto normal), como
// el de los otros botones fijos, y el pie de la barra añade al rol el
// departamento de quien mira ("Admin · Diseño").
//
// El menú que se abre al clicar el propio usuario (pie de la barra) aloja,
// además de "Mi cuenta", tres entradas más solo para admins ("Administrar
// equipo", "Accesos por departamento" —v55— e "Importar desde Asana" — y
// "Creación Rápida", este último panel, a propósito "escondido" aquí y en
// ningún otro sitio, para habilitar/configurar el botón "Nueva cabina" de
// los proyectos, ver quick-create-admin-modal.js) y una más, "Métricas"
// (antes un botón fijo aparte en esta misma barra), que desde la v54
// también ve el rol Revisor — mismo permiso que Miembro más esta entrada,
// ver el apartado 3 del README.
//
// Navegación plegable (v77): los botones fijos de arriba (Mis tareas, Línea de
// tiempo, Archivo, Papelera y las secciones exclusivas como Ofertas) van en un
// bloque `.sidebar__nav` con un botón sutil en su cabecera. Plegado, el mismo
// bloque pasa a una tira de una sola línea (~34 px) con solo los iconos —el
// `title` de cada botón hace de tooltip y el contador de «Mis tareas» queda
// como una insignia pequeña sobre su icono— y la lista de Proyectos sube hasta
// arriba. No hay un segundo juego de botones: son los mismos, con las mismas
// ids y el mismo cableado, y solo cambia la clase `is-folded` (CSS en
// 05-layout.css). Al pulsar, el DOM se cambia aquí mismo (sin repintar la
// aplicación ni perder el foco del botón) y `onToggleNav(plegado)` avisa a
// app.js, que guarda la preferencia en localStorage. Con la barra entera
// minimizada (68 px) no cabe una tira horizontal: plegado deja solo el botón
// de desplegar. (Métricas no está en este bloque: vive en el menú del nombre.)
//
// Propiedades (v57): el menú de clic derecho de un proyecto normal (no de
// las secciones exclusivas) incluye «Propiedades», que abre la ventana con
// sus metadatos (project-properties-modal.js). El menú solo avisa con
// `onOpenProjectProperties(project)`: la ventana y el guardado los monta
// app.js, igual que el resto de acciones que necesitan datos de fuera.
// ============================================================================
import { initials, colorFromString, escapeHtml, projectBadgeHtml, projectIcon, showToast } from "../utils.js";
import { findDepartment } from "../departments.js";
import { openContextMenu } from "./context-menu.js";
import { updateProject, archiveProject } from "../data/projects.js";
import { trashProject } from "../data/trash.js";
import { offerUndoForTrash, trashFailureMessage } from "./undo-toast.js";
import { openCustomFieldsModal } from "./custom-fields-modal.js";
import { openEditProjectModal } from "./edit-project-modal.js";
import { openLocation } from "./open-location.js";
import { hasLocation, projectLocation, OPEN_LOCATION_TEXT, OPEN_LOCATION_ICON } from "../location.js";

export function renderSidebar(container, { projects, currentProjectId, isMyTasksActive, isTimelineActive, isArchiveActive, isTrashActive, myTasksCount, userProfile, isCollapsed, onToggleCollapse, isNavCollapsed, onToggleNav, onSelectProject, onSelectMyTasks, onSelectTimeline, onSelectArchive, onSelectTrash, onSelectMetrics, onCreateProject, onOpenSearch, onOpenAccount, onOpenWhatsNew, onOpenTeamAdmin, onOpenDepartmentAccess, onOpenOutlookBridge, onOpenDriveStorage, onOpenAsanaImport, onOpenQuickCreateAdmin, onOpenProjectProperties, onLogout }) {
  container.classList.toggle("is-collapsed", !!isCollapsed);

  const regularProjects = projects.filter((p) => !p.exclusive);
  const exclusiveProjects = projects.filter((p) => p.exclusive);

  // `plainIcon` (v56): el emoji suelto, igual que el de "Mis tareas"/
  // "Línea de tiempo"/"Archivo", en vez del cuadradito de color de un
  // proyecto normal — es lo que se usa para las secciones exclusivas, que
  // se pintan como uno de esos botones fijos y no como un proyecto más.
  function projectItemHtml(p, extraClass = "", plainIcon = false) {
    const icon = plainIcon
      ? `<span class="sidebar__item-icon">${escapeHtml(projectIcon(p))}</span>`
      : projectBadgeHtml(p);
    return `
    <button class="sidebar__item${extraClass}${p.id === currentProjectId ? " is-active" : ""}" data-project-id="${p.id}" title="${escapeHtml(p.name)}">
      ${icon}
      <span class="sidebar__item-name sidebar__label">${escapeHtml(p.name)}</span>
    </button>
  `;
  }

  const items = regularProjects.map((p) => projectItemHtml(p)).join("");
  const exclusiveItems = exclusiveProjects.map((p) => projectItemHtml(p, " sidebar__item--pinned", true)).join("");

  // Pie de la barra (v56): rol y, si tiene uno asignado, su departamento —
  // "Admin · Diseño - Industria". Un valor que ya no esté en el registro de
  // departamentos (uno quitado) se ignora en vez de pintar algo raro; el
  // «Diseño» antiguo (v63) sí se reconoce.
  const roleLabel = userProfile.role === "admin" ? "Admin" : userProfile.role === "revisor" ? "Revisor" : "Miembro";
  const department = findDepartment(userProfile.department);
  const roleLine = department ? `${roleLabel} · ${department.label}` : roleLabel;

  container.innerHTML = `
    <div class="sidebar__brand">
      <img src="assets/chusy-badge.png" alt="Chusy" class="sidebar__brand-logo sidebar__brand-logo--full">
      <img src="assets/favicon-32.png" alt="Chusy" class="sidebar__brand-logo sidebar__brand-logo--icon">
    </div>

    <button class="sidebar__collapse-toggle" id="btn-toggle-collapse" type="button" title="${isCollapsed ? "Expandir barra lateral" : "Minimizar barra lateral"}">
      <span class="sidebar__collapse-icon">${isCollapsed ? "›" : "‹"}</span>
    </button>

    <button class="sidebar__search" id="btn-search" title="Buscar (⌘K)">
      <span>🔍</span>
      <span class="sidebar__label">Buscar…</span>
      <span class="sidebar__label sidebar__search-kbd">⌘K</span>
    </button>

    <div class="sidebar__nav${isNavCollapsed ? " is-folded" : ""}" id="sidebar-nav">
    <div class="sidebar__nav-head">
      <span class="sidebar__nav-title sidebar__label">Navegación</span>
      <button class="sidebar__nav-toggle" id="btn-toggle-nav" type="button" aria-controls="sidebar-nav-items" aria-expanded="${isNavCollapsed ? "false" : "true"}" aria-label="${isNavCollapsed ? "Mostrar el menú de navegación" : "Ocultar el menú de navegación"}" title="${isNavCollapsed ? "Mostrar el menú de navegación" : "Ocultar el menú de navegación"}">
        <svg class="sidebar__nav-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false"><path d="M2 4.5 6 8l4-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div class="sidebar__nav-items" id="sidebar-nav-items">
    <button class="sidebar__item sidebar__item--pinned${isMyTasksActive ? " is-active" : ""}" id="btn-my-tasks" title="${myTasksCount ? `Mis tareas · ${myTasksCount} pendientes` : "Mis tareas"}">
      <span class="sidebar__item-icon">🗂️</span>
      <span class="sidebar__item-name sidebar__label">Mis tareas</span>
      ${myTasksCount ? `<span class="sidebar__item-count sidebar__label">${myTasksCount}</span>` : ""}
    </button>
    <button class="sidebar__item sidebar__item--pinned${isTimelineActive ? " is-active" : ""}" id="btn-timeline" title="Línea de tiempo">
      <span class="sidebar__item-icon">📅</span>
      <span class="sidebar__item-name sidebar__label">Línea de tiempo</span>
    </button>
    <button class="sidebar__item sidebar__item--pinned${isArchiveActive ? " is-active" : ""}" id="btn-archive" title="Archivo">
      <span class="sidebar__item-icon">🗄️</span>
      <span class="sidebar__item-name sidebar__label">Archivo</span>
    </button>
    <button class="sidebar__item sidebar__item--pinned${isTrashActive ? " is-active" : ""}" id="btn-trash" title="Papelera">
      <span class="sidebar__item-icon">🗑️</span>
      <span class="sidebar__item-name sidebar__label">Papelera</span>
    </button>
    ${exclusiveItems}
    </div>
    </div>

    <span class="sidebar__section-label sidebar__label">Proyectos</span>
    <div class="sidebar__list">
      ${items || `<p class="sidebar__label" style="color:var(--color-text-faint);font-size:12.5px;padding:8px;">Todavía no hay proyectos.</p>`}
    </div>
    <button class="sidebar__new-project" id="btn-new-project" title="Nuevo proyecto">
      <span class="sidebar__new-project-icon">+</span><span class="sidebar__label">Nuevo proyecto</span>
    </button>

    <div class="sidebar__footer">
      <button class="sidebar__user" id="btn-user-menu" type="button" title="${escapeHtml(userProfile.name || userProfile.email)}">
        <span class="avatar" style="background:${colorFromString(userProfile.uid)}">${initials(userProfile.name)}</span>
        <div class="sidebar__label" style="min-width:0;">
          <div class="sidebar__user-name">${escapeHtml(userProfile.name || userProfile.email)}</div>
          <div class="sidebar__user-role" title="${escapeHtml(roleLine)}">${escapeHtml(roleLine)}</div>
        </div>
      </button>
      <button class="sidebar__logout" title="Cerrar sesión" id="btn-logout">⏻</button>
    </div>
    <p class="sidebar__credit sidebar__label">Martech Corporation</p>
  `;

  container.querySelectorAll(".sidebar__item[data-project-id]").forEach((btn) => {
    btn.addEventListener("click", () => onSelectProject(btn.dataset.projectId));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const project = projects.find((p) => p.id === btn.dataset.projectId);
      if (!project) return;
      openContextMenu({
        x: e.clientX, y: e.clientY,
        items: [
          { label: "Editar proyecto", icon: "✎", onClick: () => {
            openEditProjectModal({ project, onSave: (data) => updateProject(project.id, data) });
          } },
          // v57: metadatos del proyecto (Comercial, Ubicación, versión aprobada,
          // fechas e histórico). Solo para proyectos normales: una sección
          // exclusiva como Ofertas no es un proyecto real y no tiene de esto.
          ...(project.exclusive ? [] : [{ label: "Propiedades", icon: "ⓘ", onClick: () => onOpenProjectProperties(project) }]),
          // v61: «Abrir Ubicación» también desde el clic derecho, solo si el
          // proyecto tiene la Ubicación rellena en sus Propiedades (igual
          // que el botón de la barra superior, que no se pinta sin ella).
          ...(hasLocation(projectLocation(project)) ? [{ label: OPEN_LOCATION_TEXT, icon: OPEN_LOCATION_ICON, onClick: () => openLocation(projectLocation(project)) }] : []),
          {
            label: "Campos personalizados",
            icon: "☰",
            onClick: () =>
              openCustomFieldsModal({
                title: "Campos personalizados",
                hint: "Se podrán rellenar en cada tarea de este proyecto y usarse como columna y como filtro.",
                fields: project.customFieldDefs,
                onSave: (defs) => updateProject(project.id, { customFieldDefs: defs }),
              }),
          },
          { label: "Archivar proyecto", icon: "🗄️", onClick: () => archiveProject(project.id, true) },
          { divider: true },
          { label: "Eliminar proyecto", icon: "🗑", danger: true, onClick: async () => {
            if (!confirm(`¿Eliminar "${project.name}" y TODAS sus tareas? Se guardará 30 días en la Papelera.`)) return;
            try {
              const { trashId } = await trashProject(project, { user: userProfile });
              offerUndoForTrash("Proyecto eliminado · 30 días en la Papelera.", [trashId], userProfile);
            } catch (err) {
              console.error(err);
              showToast(trashFailureMessage(err && err.code, 1, "project"), "error");
            }
          } },
        ],
      });
    });
  });
  container.querySelector("#btn-search").addEventListener("click", onOpenSearch);
  container.querySelector("#btn-my-tasks").addEventListener("click", onSelectMyTasks);
  container.querySelector("#btn-timeline").addEventListener("click", onSelectTimeline);
  container.querySelector("#btn-archive").addEventListener("click", onSelectArchive);
  container.querySelector("#btn-trash").addEventListener("click", onSelectTrash);
  container.querySelector("#btn-new-project").addEventListener("click", onCreateProject);
  container.querySelector("#btn-logout").addEventListener("click", onLogout);
  container.querySelector("#btn-toggle-collapse").addEventListener("click", onToggleCollapse);

  // v77: plegar/desplegar el bloque de navegación. Cambia el DOM aquí (la
  // clase, aria y el texto del botón) y solo avisa de la nueva preferencia.
  const navEl = container.querySelector("#sidebar-nav");
  const navToggle = container.querySelector("#btn-toggle-nav");
  navToggle.addEventListener("click", () => {
    const folded = !navEl.classList.contains("is-folded");
    navEl.classList.toggle("is-folded", folded);
    const text = folded ? "Mostrar el menú de navegación" : "Ocultar el menú de navegación";
    navToggle.setAttribute("aria-expanded", folded ? "false" : "true");
    navToggle.setAttribute("aria-label", text);
    navToggle.title = text;
    if (onToggleNav) onToggleNav(folded);
  });

  container.querySelector("#btn-user-menu").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const items = [
      { label: "Mi cuenta", icon: "👤", onClick: onOpenAccount },
      { label: "Novedades de Chusy", icon: "🆕", onClick: onOpenWhatsNew },
    ];
    if (userProfile.role === "admin") {
      items.push({ label: "Administrar equipo", icon: "🛠️", onClick: onOpenTeamAdmin });
      items.push({ label: "Accesos por departamento", icon: "🔐", onClick: onOpenDepartmentAccess });
      items.push({ label: "Importar desde Asana", icon: "📥", onClick: onOpenAsanaImport });
      items.push({ label: "Conexión con Outlook", icon: "📧", onClick: onOpenOutlookBridge });
      items.push({ label: "Archivos en Google Drive", icon: "☁️", onClick: onOpenDriveStorage }); // v68
    }
    // Métricas (v54): admin Y Revisor — el único permiso que distingue a
    // Revisor de Miembro, así que va en su propia comprobación en vez de
    // colgar del bloque de arriba (estrictamente admin) o del de abajo
    // (estrictamente admin también).
    if (userProfile.role === "admin" || userProfile.role === "revisor") {
      items.push({ label: "Métricas", icon: "📊", onClick: onSelectMetrics });
    }
    if (userProfile.role === "admin") {
      // "Secreta" en el sentido de que solo vive aquí: nadie que no sea
      // admin ve siquiera esta entrada (ni Revisor), y no hay ningún botón
      // fijo en el resto de la interfaz que la señale (a diferencia de
      // Métricas, arriba, que hasta la v41 sí tenía uno) — ver
      // quick-create-admin-modal.js.
      items.push({ label: "Creación Rápida", icon: "⚡", onClick: onOpenQuickCreateAdmin });
    }
    items.push({ divider: true });
    items.push({ label: "Cerrar sesión", icon: "⏻", danger: true, onClick: onLogout });
    openContextMenu({ x: rect.right + 6, y: rect.top, items });
  });
}
