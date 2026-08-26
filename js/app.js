// ============================================================================
// Orquestador principal: maneja el estado de sesión, la selección de
// proyecto/vista, y conecta los componentes con los datos de Firestore.
// ============================================================================
import { onAuthChange, signUp, logIn, logOut } from "./auth.js";
import { applyTheme, getCachedTheme } from "./theme.js";
import { createProject, subscribeToAllProjects, subscribeToArchivedProjects, subscribeToProject, subscribeToAllUsers, archiveProject, deleteProjectWithTasks } from "./data/projects.js";
import { subscribeToProjectTasks, subscribeToMyTasks } from "./data/tasks.js";
import { subscribeToAllTags } from "./data/tags.js";
import { renderSidebar } from "./components/sidebar.js";
import { renderTopbar } from "./components/topbar.js";
import { renderListView } from "./views/list-view.js";
import { renderBoardView } from "./views/board-view.js";
import { renderCalendarView } from "./views/calendar-view.js";
import { renderTimelineView } from "./views/timeline-view.js";
import { renderMyTasksView } from "./views/my-tasks-view.js";
import { renderArchiveView } from "./views/archive-view.js";
import { openProjectModal } from "./components/project-modal.js";
import { openTaskModal } from "./components/task-modal.js";
import { renderFilterBar } from "./components/filter-bar.js";
import { applyTaskFilters, buildFilterDefs, sortTasks } from "./task-filters.js";
import { openSearchModal } from "./components/search-modal.js";
import { openAccountModal } from "./components/account-modal.js";
import { openTeamAdminModal } from "./components/team-admin-modal.js";
import { openAsanaImportModal } from "./components/asana-import-modal.js";
import { openResetPasswordModal } from "./components/reset-password-modal.js";
import { removeBulkToolbar } from "./components/bulk-toolbar.js";
import { showToast } from "./utils.js";

const loadingScreen = document.getElementById("loading-screen");
const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const sidebarEl = document.getElementById("sidebar");
const topbarEl = document.getElementById("topbar");
const filterbarEl = document.getElementById("filterbar");
const mainContentEl = document.getElementById("main-content");

// ---- estado en memoria ----
let currentUser = null;
let projects = [];
let archivedProjects = [];
let teamMembers = [];
let myTasks = [];
let tagsRegistry = [];
let currentProjectId = null;
let currentProject = null;
let currentTasks = [];
let currentView = "list";
let mode = "project"; // 'project' | 'mytasks' | 'timeline' | 'archive'
let calendarViewDate = new Date();
let timelineZoom = "day"; // 'day' | 'week' | 'month'
let timelineShowHolidays = false;
let activeFilters = {}; // { [filterKey]: Set(valores) }
let sortState = { column: null, direction: "asc" };
let globalTasksByProject = {}; // { [projectId]: tasks[] } — línea de tiempo global y buscador
let unsubGlobalTasks = {}; // { [projectId]: unsubscribeFn }

// Minimizar la barra lateral es una preferencia de este navegador (no de la
// cuenta): cada dispositivo puede tenerla como prefiera.
let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem("chusy:sidebarCollapsed") === "1"; } catch (e) { /* localStorage no disponible */ }
function toggleSidebarCollapse() {
  sidebarCollapsed = !sidebarCollapsed;
  try { localStorage.setItem("chusy:sidebarCollapsed", sidebarCollapsed ? "1" : "0"); } catch (e) { /* localStorage no disponible */ }
  renderShell();
}

// Los filtros de "Mis tareas" se recuerdan por persona en este navegador
// (localStorage, no en la cuenta — mismo criterio que sidebarCollapsed, así
// que en un ordenador compartido cada cuenta guarda los suyos por
// separado). La primera vez que alguien entra no hay nada guardado
// todavía: por defecto se aplica "Pendiente", para no enterrar la vista
// bajo todo lo que ya está completado.
function loadMyTasksFilters() {
  if (!currentUser) return {};
  try {
    const raw = localStorage.getItem(`chusy:myTasksFilters:${currentUser.uid}`);
    if (raw === null) return { status: new Set(["pendiente"]) };
    const parsed = JSON.parse(raw);
    const restored = {};
    Object.entries(parsed).forEach(([key, values]) => { restored[key] = new Set(values); });
    return restored;
  } catch (e) {
    return { status: new Set(["pendiente"]) };
  }
}
function saveMyTasksFilters(filters) {
  if (!currentUser) return;
  try {
    const plain = {};
    Object.entries(filters).forEach(([key, set]) => { if (set && set.size) plain[key] = [...set]; });
    localStorage.setItem(`chusy:myTasksFilters:${currentUser.uid}`, JSON.stringify(plain));
  } catch (e) { /* localStorage no disponible */ }
}

// La última sección visitada (un proyecto concreto —con la vista que
// tenía abierta, Lista/Tablero/Calendario/Línea de tiempo—, Mis tareas,
// Línea de tiempo global o Archivo) se recuerda con el mismo criterio que
// sidebarCollapsed y los filtros de Mis tareas: por persona, en este
// navegador — no en la cuenta, así que en un ordenador compartido cada
// quien vuelve a SU última sección, y en un dispositivo nuevo se empieza
// de cero. Sin nada guardado todavía, el destino por defecto es "Mis
// tareas" (ver restoreLastLocation, llamada una sola vez por sesión desde
// bootstrap()).
function loadLastLocation() {
  if (!currentUser) return null;
  try {
    const raw = localStorage.getItem(`chusy:lastLocation:${currentUser.uid}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveLastLocation(loc) {
  if (!currentUser) return;
  try { localStorage.setItem(`chusy:lastLocation:${currentUser.uid}`, JSON.stringify(loc)); } catch (e) { /* localStorage no disponible */ }
}
function restoreLastLocation() {
  const saved = loadLastLocation();
  if (saved && saved.mode === "project" && saved.projectId) {
    if (saved.view) currentView = saved.view;
    selectProject(saved.projectId);
  } else if (saved && saved.mode === "timeline") {
    selectTimeline();
  } else if (saved && saved.mode === "archive") {
    selectArchive();
  } else {
    selectMyTasks();
  }
}

let unsubProjects = null;
let unsubArchivedProjects = null;
let unsubUsers = null;
let unsubMyTasks = null;
let unsubTags = null;
let unsubCurrentProject = null;
let unsubCurrentTasks = null;
let hasRestoredLocation = false; // solo se restaura la sección al arrancar una vez por sesión — ver restoreLastLocation()

function showApp() { loadingScreen.classList.add("hidden"); authScreen.classList.add("hidden"); appShell.classList.remove("hidden"); }
function showAuth() { loadingScreen.classList.add("hidden"); appShell.classList.add("hidden"); authScreen.classList.remove("hidden"); }

// El script embebido al principio de index.html ya pinta el tema cacheado
// de este navegador antes del primer fotograma (para no dar un parpadeo);
// esto solo confirma lo mismo dentro del módulo. En cuanto se resuelva la
// sesión, más abajo, se reconcilia con lo que diga la cuenta de verdad.
applyTheme(getCachedTheme());

onAuthChange((profile) => {
  currentUser = profile;
  // La cuenta manda en cuanto se conoce (puede diferir de la caché de
  // este navegador si la persona cambió el tema desde otro dispositivo);
  // sin sesión, nos quedamos con lo último aplicado en este navegador.
  applyTheme(profile ? profile.theme : getCachedTheme());
  if (!profile) {
    cleanup();
    showAuth();
    return;
  }
  showApp();
  bootstrap();
});

function cleanup() {
  [unsubProjects, unsubArchivedProjects, unsubUsers, unsubMyTasks, unsubTags, unsubCurrentProject, unsubCurrentTasks].forEach((fn) => fn && fn());
  Object.values(unsubGlobalTasks).forEach((fn) => fn && fn());
  unsubProjects = unsubArchivedProjects = unsubUsers = unsubMyTasks = unsubTags = unsubCurrentProject = unsubCurrentTasks = null;
  unsubGlobalTasks = {}; globalTasksByProject = {};
  projects = []; archivedProjects = []; teamMembers = []; myTasks = []; tagsRegistry = [];
  currentProjectId = null; currentProject = null; currentTasks = []; mode = "project";
  activeFilters = {}; sortState = { column: null, direction: "asc" };
  hasRestoredLocation = false; // si otra persona inicia sesión en este navegador, que recupere SU última sección, no la de quien salió
  removeBulkToolbar();
}

function bootstrap() {
  if (unsubUsers) unsubUsers();
  unsubUsers = subscribeToAllUsers((users) => { teamMembers = users; renderShell(); });

  if (unsubTags) unsubTags();
  unsubTags = subscribeToAllTags((tags) => { tagsRegistry = tags; renderShell(); });

  if (unsubMyTasks) unsubMyTasks();
  unsubMyTasks = subscribeToMyTasks(currentUser.uid, (tasks) => { myTasks = tasks; renderShell(); });

  if (unsubArchivedProjects) unsubArchivedProjects();
  unsubArchivedProjects = subscribeToArchivedProjects((list) => { archivedProjects = list; if (mode === "archive") renderShell(); });

  if (unsubProjects) unsubProjects();
  unsubProjects = subscribeToAllProjects((allProjects) => {
    projects = allProjects;
    syncGlobalTimelineSubscriptions();
    if (mode === "project" && currentProjectId && !projects.find((p) => p.id === currentProjectId)) {
      // La sección recordada (o la que se acaba de seleccionar) ya no
      // existe — se borró o se archivó. Igual que si no hubiera nada
      // guardado, el destino por defecto es "Mis tareas".
      selectMyTasks();
      return;
    }
    renderShell();
  });

  // Solo una vez por sesión: aterriza en la última sección que esta
  // persona visitó en este navegador, en vez de forzar siempre el primer
  // proyecto de la lista (ver restoreLastLocation).
  if (!hasRestoredLocation) {
    hasRestoredLocation = true;
    restoreLastLocation();
  }
}

/**
 * La línea de tiempo global y el buscador necesitan las tareas de TODOS
 * los proyectos a la vez. En vez de una consulta sin filtro (que las
 * reglas de seguridad rechazarían, porque no pueden garantizar de
 * antemano que todo lo que devuelva sea legible), mantenemos un listener
 * por proyecto — a la escala de un departamento no supone ningún
 * problema, y así reutilizamos exactamente las mismas reglas que ya
 * funcionan para la vista de un solo proyecto.
 */
function syncGlobalTimelineSubscriptions() {
  const currentIds = new Set(projects.map((p) => p.id));
  Object.keys(unsubGlobalTasks).forEach((id) => {
    if (!currentIds.has(id)) {
      unsubGlobalTasks[id]();
      delete unsubGlobalTasks[id];
      delete globalTasksByProject[id];
    }
  });
  projects.forEach((p) => {
    if (!unsubGlobalTasks[p.id]) {
      unsubGlobalTasks[p.id] = subscribeToProjectTasks(p.id, (tasks) => {
        globalTasksByProject[p.id] = tasks;
        if (mode === "timeline") renderShell();
      });
    }
  });
}

function selectProject(projectId) {
  mode = "project";
  saveLastLocation({ mode: "project", projectId, view: currentView });
  if (projectId === currentProjectId) { renderShell(); return; }
  currentProjectId = projectId;
  activeFilters = {};
  sortState = { column: null, direction: "asc" };
  if (unsubCurrentProject) unsubCurrentProject();
  if (unsubCurrentTasks) unsubCurrentTasks();

  unsubCurrentProject = subscribeToProject(projectId, (project) => { currentProject = project; renderShell(); });
  unsubCurrentTasks = subscribeToProjectTasks(projectId, (tasks) => { currentTasks = tasks; renderShell(); });
  renderShell();
}

function selectMyTasks() {
  mode = "mytasks";
  saveLastLocation({ mode: "mytasks" });
  activeFilters = loadMyTasksFilters();
  sortState = { column: null, direction: "asc" };
  renderShell();
}

function selectTimeline() {
  mode = "timeline";
  saveLastLocation({ mode: "timeline" });
  activeFilters = {};
  renderShell();
}

function selectArchive() {
  mode = "archive";
  saveLastLocation({ mode: "archive" });
  renderShell();
}

function setTimelineZoom(zoom) {
  timelineZoom = zoom;
  if (mode === "timeline") renderShell();
  else renderMain();
}

function toggleTimelineHolidays() {
  timelineShowHolidays = !timelineShowHolidays;
  if (mode === "timeline") renderShell();
  else renderMain();
}

function handleFilterChange(key, newSet) {
  activeFilters = { ...activeFilters, [key]: newSet };
  if (mode === "mytasks") saveMyTasksFilters(activeFilters);
  if (mode === "project") renderMain();
  else renderShell();
}

function handleSortChange(column) {
  sortState = column === sortState.column
    ? { column, direction: sortState.direction === "asc" ? "desc" : "asc" }
    : { column, direction: "asc" };
  if (mode === "project") renderMain();
  else renderShell();
}

function renderShell() {
  if (!currentUser) return;

  // La vuelven a poblar la vista de Lista y Mis tareas (cada una al final
  // de su propio render); si el destino es otro modo/vista, queda limpia.
  // Es barato: si sí toca mostrarla, se reconstruye igualmente unas
  // líneas más abajo.
  removeBulkToolbar();

  renderSidebar(sidebarEl, {
    projects,
    currentProjectId: mode === "project" ? currentProjectId : null,
    isMyTasksActive: mode === "mytasks",
    isTimelineActive: mode === "timeline",
    isArchiveActive: mode === "archive",
    myTasksCount: myTasks.filter((t) => !t.isComplete).length,
    userProfile: currentUser,
    isCollapsed: sidebarCollapsed,
    onToggleCollapse: toggleSidebarCollapse,
    onSelectProject: (id) => { selectProject(id); sidebarEl.classList.remove("is-open"); },
    onSelectMyTasks: () => { selectMyTasks(); sidebarEl.classList.remove("is-open"); },
    onSelectTimeline: () => { selectTimeline(); sidebarEl.classList.remove("is-open"); },
    onSelectArchive: () => { selectArchive(); sidebarEl.classList.remove("is-open"); },
    onOpenSearch: () => openSearch(),
    onOpenAccount: () => openAccountModal({ userProfile: currentUser }),
    onOpenTeamAdmin: () => openTeamAdminModal({ teamMembers, currentUser }),
    onOpenAsanaImport: () => openAsanaImportModal({ teamMembers, currentUser }),
    onCreateProject: () =>
      openProjectModal({
        onCreate: async (data) => {
          const id = await createProject({ ...data, creatorUid: currentUser.uid });
          showToast("Proyecto creado.");
          selectProject(id);
        },
      }),
    onLogout: () => logOut(),
  });

  if (mode === "archive") {
    topbarEl.innerHTML = `<span class="topbar__title">Archivo</span><span class="topbar__count">${archivedProjects.length} ${archivedProjects.length === 1 ? "proyecto" : "proyectos"}</span>`;
    filterbarEl.innerHTML = "";
    renderArchiveView(mainContentEl, {
      archivedProjects,
      onOpenProject: (id) => selectProject(id),
      onUnarchive: (id) => archiveProject(id, false).then(() => showToast("Proyecto restaurado.")),
      onDelete: (id) => deleteProjectWithTasks(id).then(() => showToast("Proyecto eliminado.")),
    });
    return;
  }

  if (mode === "mytasks") {
    const filterDefs = buildFilterDefs({ teamMembers, tagsRegistry, projects, includeProject: true, customFieldDefs: currentUser.personalCustomFieldDefs, tasks: myTasks });
    const filteredMyTasks = sortTasks(applyTaskFilters(myTasks, activeFilters), sortState, { teamMembers, projects });
    const countLabel = filteredMyTasks.length === myTasks.length
      ? `${myTasks.length} ${myTasks.length === 1 ? "tarea" : "tareas"}`
      : `${filteredMyTasks.length} de ${myTasks.length} ${myTasks.length === 1 ? "tarea" : "tareas"}`;

    topbarEl.innerHTML = `
      <div>
        <span class="topbar__title">Mis tareas</span>
        <span class="topbar__count">${countLabel}</span>
      </div>
      <button class="btn btn--primary btn--sm" id="btn-new-personal-task" style="margin-left:auto;">+ Tarea personal</button>`;
    topbarEl.querySelector("#btn-new-personal-task").addEventListener("click", openNewPersonalTask);

    renderFilterBar(filterbarEl, { filterDefs, activeFilters, onChange: handleFilterChange });
    renderMyTasksView(mainContentEl, { tasks: filteredMyTasks, teamMembers, projects, tagsRegistry, sortState, onSortChange: handleSortChange, onOpenTask: openTask, currentUser });
    return;
  }

  if (mode === "timeline") {
    topbarEl.innerHTML = `
      <div>
        <span class="topbar__title">Línea de tiempo</span>
        <span class="topbar__count">todos los proyectos</span>
      </div>`;
    const filterDefs = buildFilterDefs({ teamMembers, tagsRegistry, includeStatus: false });
    renderFilterBar(filterbarEl, { filterDefs, activeFilters, onChange: handleFilterChange });
    const groups = projects.map((p) => ({
      id: p.id,
      label: p.name,
      color: p.color,
      icon: p.icon,
      tasks: applyTaskFilters((globalTasksByProject[p.id] || []).filter((t) => !t.isComplete), activeFilters),
    }));
    renderTimelineView(mainContentEl, {
      groups, zoom: timelineZoom, onZoomChange: setTimelineZoom,
      showHolidays: timelineShowHolidays, onToggleHolidays: toggleTimelineHolidays,
      onOpenTask: openTask,
    });
    return;
  }

  if (!currentProject) {
    topbarEl.innerHTML = "";
    filterbarEl.innerHTML = "";
    mainContentEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__eyebrow">— SIN PROYECTO —</span>
        <h2>${projects.length ? "Selecciona un proyecto" : "Crea tu primer proyecto"}</h2>
        <p>Los proyectos organizan las tareas de tu equipo en secciones. Puedes verlas en lista, tablero, calendario o línea de tiempo.</p>
      </div>`;
    return;
  }

  renderProjectTopbar();
  renderMain();
}

/** Repinta solo el topbar del modo proyecto (título, contador, pestañas de
 * vista, "+ Nueva tarea"). Aparte de renderShell(), también la llama el
 * propio cambio de vista (más abajo, dentro de onViewChange) — antes esa
 * pestaña activa (Lista/Tablero/Calendario/Línea de tiempo) se quedaba
 * pintada en la vista anterior al cambiar, porque solo se volvía a
 * renderMain() y este topbar nunca se tocaba hasta el siguiente render
 * completo. */
function renderProjectTopbar() {
  renderTopbar(topbarEl, {
    project: currentProject,
    taskCount: currentTasks.length,
    currentView,
    onViewChange: (v) => { currentView = v; saveLastLocation({ mode: "project", projectId: currentProjectId, view: v }); renderProjectTopbar(); renderMain(); },
    onNewTask: () => openNewProjectTask(currentProject.sections[0]?.id),
    onToggleSidebar: () => sidebarEl.classList.toggle("is-open"),
  });
}

function renderMain() {
  if (mode !== "project" || !currentProject) return;
  removeBulkToolbar(); // igual que en renderShell(): solo la vista de Lista la vuelve a mostrar

  const filterDefs = buildFilterDefs({ teamMembers, tagsRegistry, customFieldDefs: currentProject.customFieldDefs, tasks: currentTasks });
  renderFilterBar(filterbarEl, { filterDefs, activeFilters, onChange: handleFilterChange });
  const filteredTasks = applyTaskFilters(currentTasks, activeFilters);

  if (currentView === "board") {
    renderBoardView(mainContentEl, { project: currentProject, tasks: filteredTasks, teamMembers, tagsRegistry, onOpenTask: openTask, onAddTask: openNewProjectTask });
  } else if (currentView === "calendar") {
    renderCalendarView(mainContentEl, {
      tasks: filteredTasks,
      viewDate: calendarViewDate,
      onOpenTask: openTask,
      onAddTaskOnDate: (dateKey) => openNewProjectTask(currentProject.sections[0]?.id, dateKey),
      onMonthChange: (d) => { calendarViewDate = d; renderMain(); },
    });
  } else if (currentView === "timeline") {
    const sectionsSorted = [...currentProject.sections].sort((a, b) => a.order - b.order);
    const groups = sectionsSorted.map((s) => ({
      id: s.id,
      label: s.name,
      color: currentProject.color,
      tasks: filteredTasks.filter((t) => t.sectionId === s.id),
    }));
    renderTimelineView(mainContentEl, {
      groups, zoom: timelineZoom, onZoomChange: setTimelineZoom,
      showHolidays: timelineShowHolidays, onToggleHolidays: toggleTimelineHolidays,
      onOpenTask: openTask,
    });
  } else {
    const sortedTasks = sortTasks(filteredTasks, sortState, { teamMembers, projects });
    renderListView(mainContentEl, { project: currentProject, tasks: sortedTasks, teamMembers, tagsRegistry, sortState, onSortChange: handleSortChange, onOpenTask: openTask, onAddTask: openNewProjectTask, currentUser, projects });
  }
}

function openNewProjectTask(sectionId, presetDueDate) {
  if (!currentProject) return;
  openTaskModal({
    taskId: null,
    project: currentProject,
    isPersonal: false,
    defaultSectionId: sectionId,
    presetDueDate,
    teamMembers,
    allProjectTasks: currentTasks,
    tagsRegistry,
    currentUserProfile: currentUser,
    onSaved: () => showToast("Tarea creada."),
    onClosed: () => {},
  });
}

function openNewPersonalTask() {
  openTaskModal({
    taskId: null,
    isPersonal: true,
    teamMembers,
    allProjectTasks: [],
    tagsRegistry,
    currentUserProfile: currentUser,
    onSaved: () => showToast("Recordatorio creado."),
    onClosed: () => {},
  });
}

function openTask(taskId) {
  // La tarea puede venir de "Mis tareas", de la línea de tiempo global o
  // del buscador (de un proyecto distinto al seleccionado, o ser un
  // recordatorio personal sin proyecto), así que buscamos su contexto
  // real entre lo que ya tenemos cargado.
  const everything = [...Object.values(globalTasksByProject).flat(), ...myTasks, ...currentTasks];
  const task = everything.find((t) => t.id === taskId);
  const isPersonal = task ? !task.projectId : false;
  const taskProject = !isPersonal
    ? (task && projects.find((p) => p.id === task.projectId)) || currentProject
    : null;
  const relatedTasks = taskProject
    ? (globalTasksByProject[taskProject.id] || (taskProject.id === currentProjectId ? currentTasks : []))
    : [];

  openTaskModal({
    taskId,
    project: taskProject,
    isPersonal,
    teamMembers,
    allProjectTasks: relatedTasks,
    tagsRegistry,
    currentUserProfile: currentUser,
    onSaved: () => {},
    onClosed: () => {},
  });
}

function goToPersonFilter(uid) {
  selectTimeline();
  activeFilters = { assignee: new Set([uid]) };
  renderShell();
}

function openSearch() {
  const everyTask = [
    ...Object.values(globalTasksByProject).flat(),
    ...myTasks.filter((t) => !t.projectId),
  ];
  openSearchModal({
    tasks: everyTask,
    projects,
    teamMembers,
    currentUser,
    onOpenTask: openTask,
    onOpenProject: (id) => selectProject(id),
    onFilterByPerson: goToPersonFilter,
  });
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (currentUser) openSearch();
  }
});

// ============================================================================
// Pantalla de autenticación
// ============================================================================
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    loginForm.classList.toggle("hidden", tab.dataset.tab !== "login");
    signupForm.classList.toggle("hidden", tab.dataset.tab !== "signup");
  });
});

document.getElementById("btn-forgot-password").addEventListener("click", () => {
  const email = loginForm.querySelector('[name="email"]').value.trim();
  openResetPasswordModal({ prefillEmail: email });
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = loginForm.querySelector("[data-error]");
  errorEl.textContent = "";
  const fd = new FormData(loginForm);
  const btn = loginForm.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await logIn({ email: fd.get("email"), password: fd.get("password") });
  } catch (err) {
    errorEl.textContent = err.message;
  }
  btn.disabled = false;
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = signupForm.querySelector("[data-error]");
  errorEl.textContent = "";
  const fd = new FormData(signupForm);
  const btn = signupForm.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await signUp({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password") });
  } catch (err) {
    errorEl.textContent = err.message;
  }
  btn.disabled = false;
});
