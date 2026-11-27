// v95 · Ojo para ver la contraseña, barra lateral desplegable en tablet vertical y fecha de inicio de las ofertas.
//  1) Ojo de la contraseña (login y registro): estructura, alternar, foco, reset, Edge, CSS.
//  2) Barra lateral en pantallas estrechas: el ☰ es fijo (sobrevive a repintar la barra de cada sección), telón, Escape, giro, CSS.
//  3) Fecha de inicio = día de creación en TODA vía de crear una oferta (createTask, duplicar, convertir, importar histórico, formulario).
//  4) Entrega: ?v=95, package.json, Novedades, README y estructura.
import fs from "node:fs";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, tick, freezeNow } from "./support/dom.mjs";

setupDom();
globalThis.MutationObserver = window.MutationObserver;
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
globalThis.__fb = globalThis.__fb || { collections: {}, sets: [], hooks: {}, updates: [], deletes: [] };

// El <body> REAL de index.html (sin los <script>) dentro de jsdom.
const indexHtml = read("index.html");
const bodyHtml = indexHtml.slice(indexHtml.indexOf("<body>") + 6, indexHtml.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
document.body.innerHTML = bodyHtml;

// ---------------------------------------------------------------- 1) ojo de la contraseña
const { addPasswordToggle, PASSWORD_SHOW_LABEL, PASSWORD_HIDE_LABEL } = await import("../js/components/password-toggle.js");
{
  const loginForm = $("#login-form");
  const signupForm = $("#signup-form");
  const pw = $('input[name="password"]', loginForm);
  check("index.html: el campo de contraseña del login existe y empieza oculto (type=password)", !!pw && pw.type === "password");
  const t = addPasswordToggle(pw);
  const wrap = pw.parentElement;
  check("el campo queda dentro de .password-field junto a su botón (dentro de su <label>)", wrap.classList.contains("password-field") && wrap.parentElement.tagName === "LABEL" && wrap.querySelector("button.password-field__toggle") === t.button);
  eq("el botón es type=button (no envía el formulario) y empieza como «Mostrar contraseña»", [t.button.type, t.button.getAttribute("aria-label"), t.button.getAttribute("aria-pressed"), t.button.title], ["button", PASSWORD_SHOW_LABEL, "false", PASSWORD_SHOW_LABEL]);
  check("el botón lleva un icono SVG (el ojo)", !!t.button.querySelector("svg"));
  const iconShow = t.button.innerHTML;

  pw.value = "Secreta-123";
  let submitted = 0;
  loginForm.addEventListener("submit", (e) => { e.preventDefault(); submitted++; });
  click(t.button);
  eq("un clic enseña la contraseña (type=text) y no pierde lo escrito", [pw.type, pw.value, t.isVisible()], ["text", "Secreta-123", true]);
  eq("… el botón pasa a «Ocultar contraseña» (aria-pressed=true) y cambia de icono (ojo tachado)", [t.button.getAttribute("aria-label"), t.button.getAttribute("aria-pressed"), t.button.innerHTML !== iconShow], [PASSWORD_HIDE_LABEL, "true", true]);
  click(t.button);
  eq("otro clic la vuelve a ocultar", [pw.type, pw.value, t.button.innerHTML === iconShow], ["password", "Secreta-123", true]);
  eq("pulsar el ojo no envía el formulario", submitted, 0);

  const md = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  t.button.dispatchEvent(md);
  check("mousedown con preventDefault: el campo no pierde el foco (no se cierra el teclado de la tablet)", md.defaultPrevented);
  const pd = new window.Event("pointerdown", { bubbles: true, cancelable: true });
  t.button.dispatchEvent(pd);
  check("… y lo mismo con pointerdown (táctil)", pd.defaultPrevented);
  click(t.button);
  eq("tras pulsar el ojo el foco vuelve al campo", document.activeElement === pw, true);
  eq("(la contraseña sigue visible)", pw.type, "text");

  loginForm.reset();
  eq("vaciar el formulario (reset) la vuelve a ocultar", [pw.type, t.button.getAttribute("aria-pressed")], ["password", "false"]);
  t.show(); t.hide();
  eq("show() / hide() de la API (los usa app.js al cambiar de pestaña y al entrar)", pw.type, "password");

  eq("engancharlo dos veces no pone dos ojos", [addPasswordToggle(pw), loginForm.querySelectorAll(".password-field__toggle").length], [null, 1]);
  eq("sin campo no hace nada (null)", addPasswordToggle(null), null);

  const sPw = $('input[name="password"]', signupForm);
  const st = addPasswordToggle(sPw);
  check("el registro («Crear cuenta») también lo lleva, con su propio ojo, y son independientes", !!st && signupForm.querySelectorAll(".password-field__toggle").length === 1 && (click(st.button), sPw.type === "text" && pw.type === "password"));
  check("el campo de contraseña no cambia de nombre ni de autocomplete (los gestores de contraseñas siguen funcionando)", pw.name === "password" && pw.getAttribute("autocomplete") === "current-password" && sPw.getAttribute("autocomplete") === "new-password");

  const app = read("js/app.js");
  check("app.js: engancha el ojo a los dos formularios de la pantalla de acceso", /addPasswordToggle\(f\.querySelector\('input\[name="password"\]'\)\)/.test(app) && /\[loginForm, signupForm\]\.map/.test(app));
  check("app.js: cambiar de pestaña y entrar en la app vuelven a ocultar la contraseña", /passwordToggles\.forEach\(\(t\) => t\.hide\(\)\); \/\/ al cambiar de pestaña/.test(app) && /function showApp\(\)[^\n]*passwordToggles\.forEach\(\(t\) => t\.hide\(\)\)/.test(app));
  const css3 = read("css/03-screens.css");
  check("CSS: .password-field (relativo), botón de 40×40 dentro del campo y espacio a la derecha del texto", /\.password-field \{[^}]*position: relative/.test(css3) && /\.password-field__toggle \{[^}]*width: 40px;[^}]*height: 40px/.test(css3) && /\.password-field \.field__input \{ padding-right: 4\d?px; \}/.test(css3));
  check("CSS: Edge no pinta su ojo propio (::-ms-reveal) para no ver dos", /\.password-field input::-ms-reveal/.test(css3));
  check("CSS: colores con variables de tema (sin colores fijos)", !/\.password-field__toggle[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(css3));
}

// ---------------------------------------------------------------- 2) barra lateral en pantallas estrechas
const { setupSidebarDrawer } = await import("../js/components/sidebar-drawer.js");
{
  const main = $(".main-col");
  const topbar = $("#topbar");
  const toggle = $("#btn-toggle-sidebar");
  const sidebar = $("#sidebar");
  const backdrop = $("#sidebar-backdrop");
  check("index.html: el ☰ existe una sola vez, es un <button> y es hijo de .main-col (hermano de #topbar), NO está dentro de la barra", !!toggle && toggle.tagName === "BUTTON" && toggle.parentElement === main && !topbar.contains(toggle) && document.querySelectorAll("#btn-toggle-sidebar").length === 1);
  check("index.html: el telón va justo detrás de la barra lateral (para el selector CSS `.sidebar.is-open + .sidebar-backdrop`)", sidebar.nextElementSibling === backdrop);
  check("el ☰ tiene nombre accesible", /menú/i.test(toggle.getAttribute("aria-label") || ""));

  // El problema de la v94: cada sección repinta la barra superior con innerHTML y el ☰ desaparecía. Ahora vive fuera de ella.
  const sections = ["Archivo", "Papelera", "Métricas", "Pedidos", "Visualizador de piezas", "Mis tareas", "Línea de tiempo"];
  let survives = true;
  for (const s of sections) { topbar.innerHTML = `<span class="topbar__title">${s}</span>`; if (!document.contains(toggle)) survives = false; }
  topbar.innerHTML = "";
  check("el ☰ sigue ahí tras repintar la barra superior como hacen Archivo, Papelera, Métricas, Pedidos, Visualizador, Mis tareas y Línea de tiempo", survives);

  const topbarSrc = read("js/components/topbar.js");
  check("topbar.js ya no pinta el ☰ (ni recibe onToggleSidebar)", !/id="btn-toggle-sidebar"/.test(topbarSrc) && !/onToggleSidebar/.test(topbarSrc) && !/innerWidth/.test(topbarSrc));
  check("app.js ya no pasa onToggleSidebar y usa setupSidebarDrawer", !/onToggleSidebar/.test(read("js/app.js")) && /setupSidebarDrawer\(\{ sidebarEl, toggleBtn: document\.getElementById\("btn-toggle-sidebar"\), backdropEl: document\.getElementById\("sidebar-backdrop"\) \}\)/.test(read("js/app.js")));

  // jsdom no trae matchMedia: uno de mentira que se puede «girar».
  let listener = null;
  window.matchMedia = () => ({ matches: true, addEventListener: (_t, fn) => { listener = fn; }, removeEventListener: () => { listener = null; } });
  const drawer = setupSidebarDrawer({ sidebarEl: sidebar, toggleBtn: toggle, backdropEl: backdrop });
  eq("al empezar la barra está cerrada (aria-expanded=false)", [sidebar.classList.contains("is-open"), toggle.getAttribute("aria-expanded")], [false, "false"]);
  click(toggle);
  eq("clic en ☰: se despliega (is-open) y aria-expanded=true", [sidebar.classList.contains("is-open"), toggle.getAttribute("aria-expanded")], [true, "true"]);
  click(toggle);
  eq("otro clic en ☰: se pliega", sidebar.classList.contains("is-open"), false);
  click(toggle); click(backdrop);
  eq("tocar el telón (fuera de la barra) la cierra", sidebar.classList.contains("is-open"), false);
  click(toggle);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  eq("Escape la cierra", sidebar.classList.contains("is-open"), false);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  eq("Escape con la barra cerrada no hace nada", sidebar.classList.contains("is-open"), false);
  click(toggle);
  sidebar.classList.remove("is-open"); // lo que hace cada onSelect… de app.js al elegir una sección o proyecto
  await tick(5);
  eq("al elegir algo (app.js quita la clase) aria-expanded se pone al día", toggle.getAttribute("aria-expanded"), "false");
  click(toggle);
  listener({ matches: false });
  eq("al girar la tablet a horizontal (>860 px) se cierra: no vuelve abierta al girar de nuevo", sidebar.classList.contains("is-open"), false);
  click(toggle);
  listener({ matches: true });
  eq("(pasar a ≤860 px no la cierra si el usuario la tenía abierta)", sidebar.classList.contains("is-open"), true);
  drawer.close();
  drawer.open();
  eq("API open() / close() / toggle()", [sidebar.classList.contains("is-open"), (drawer.toggle(), sidebar.classList.contains("is-open")), drawer.isOpen()], [true, false, false]);
  drawer.destroy();
  click(toggle); // sin los listeners del drawer el clic ya no hace nada: destroy limpia
  eq("destroy() quita los escuchadores", sidebar.classList.contains("is-open"), false);

  // CSS: oculto en escritorio, visible con la barra escondida (≤ 860 px), con telón
  const layout = read("css/05-layout.css");
  const resp = read("css/11-responsive.css").replace(/\s+/g, " ");
  check("CSS: .sidebar-toggle oculto por defecto (escritorio), de 44 px y posicionado sobre la barra superior", /\.sidebar-toggle \{[^}]*display: none;[^}]*position: absolute;[^}]*width: 44px/.test(layout.replace(/\s+/g, " ")));
  const block = (resp.match(/@media \(max-width: 860px\) \{(.*)\}\s*$/) || [])[1] || "";
  check("CSS (≤ 860 px): .sidebar-toggle se muestra", /\.sidebar-toggle \{ display: flex; \}/.test(block));
  check("CSS (≤ 860 px): la barra superior deja sitio al ☰ (padding-left) y gana a la regla de 05-layout (va después)", /\.topbar \{ padding-left: 6\d px; \}/.test(block) || /\.topbar \{ padding-left: 6\dpx; \}/.test(block));
  check("CSS (≤ 860 px): el telón solo aparece con la barra abierta, a pantalla completa y por debajo de la barra (z-index 49 < 50)", /\.sidebar\.is-open \+ \.sidebar-backdrop \{[^}]*display: block;[^}]*position: fixed;[^}]*inset: 0;[^}]*z-index: 49/.test(block) && /\.sidebar \{[^}]*z-index: 50/.test(block));
  check("CSS: fuera de ≤ 860 px el telón no se pinta", /\.sidebar-backdrop \{ display: none; \}/.test(layout));
  check("CSS: la barra en móvil/tablet sigue siendo el cajón (fixed + translateX(-100%)) que abre `is-open`", /\.sidebar \{ position: fixed;[^}]*transform: translateX\(-100%\)/.test(block) && /\.sidebar\.is-open \{ transform: translateX\(0\); \}/.test(block));
}

// ---------------------------------------------------------------- 3) fecha de inicio de las ofertas
freezeNow("2026-11-26T12:00:00Z");
const TODAY = "2026-11-26";
const fb = globalThis.__fb;
const created = [];
fb.hooks = {
  onSnapshot(q, ...rest) { const path = q && q.args && q.args[0] && q.args[0].path; if (path === "projects") fb.projectsObserver = rest[0]; return () => {}; },
  async runTransaction(_db, fn) {
    const tx = { async get() { return { exists: () => true, data: () => ({ next: 7 }) }; }, set() {}, update() {} };
    return fn(tx);
  },
  async addDoc(_c, data) { created.push(data); return { id: "new" + created.length }; },
};
const { subscribeToAllProjects } = await import("../js/data/projects.js");
const { OFFERS_KEY, planTaskToOffer } = await import("../js/offers.js");
subscribeToAllProjects(() => {});
const send = (obs, snap) => (typeof obs === "function" ? obs(snap) : obs.next(snap));
const OFFERS = { name: "Ofertas", exclusive: true, exclusiveKey: OFFERS_KEY, archived: false, sections: [{ id: "nuevas", name: "Nuevas" }, { id: "entregadas", name: "Entregadas" }], customFieldDefs: [{ id: "version", name: "Versión", type: "texto", options: [] }, { id: "sector", name: "Sector", type: "texto", options: [] }] };
const items = [{ id: "ofr", data: OFFERS }, { id: "P1", data: { name: "Proyecto", archived: false, sections: [{ id: "s1", name: "S" }], customFieldDefs: [] } }];
send(fb.projectsObserver, {
  metadata: { fromCache: false },
  docs: items.map((d) => ({ id: d.id, data: () => d.data })),
  docChanges: () => items.map((d) => ({ type: "added", doc: { id: d.id, data: () => d.data } })),
});
const { createTask, duplicateTask } = await import("../js/data/tasks.js");
{
  await createTask("ofr", { title: "Oferta A", sectionId: "nuevas", createdBy: "u1" });
  eq("createTask: una oferta nueva sin fecha de inicio nace con la de HOY (el día de creación)", created[0].startDate, TODAY);
  await createTask("ofr", { title: "Oferta B", sectionId: "nuevas", startDate: "2026-11-01", createdBy: "u1" });
  eq("createTask: si quien la crea ya puso una fecha de inicio, se respeta", created[1].startDate, "2026-11-01");
  await createTask("P1", { title: "Tarea", sectionId: "s1", extraProjectIds: ["ofr"], createdBy: "u1" });
  eq("createTask: una tarea con Ofertas como proyecto ADICIONAL también es una oferta: fecha de inicio de hoy", created[2].startDate, TODAY);
  await createTask("P1", { title: "Tarea normal", sectionId: "s1", createdBy: "u1" });
  eq("createTask: una tarea que NO es oferta sigue sin fecha de inicio", created[3].startDate, null);
  await createTask(null, { title: "Personal", createdBy: "u1" });
  eq("createTask: una tarea personal tampoco", created[4].startDate, null);
  await createTask("ofr", { title: "Oferta C", sectionId: "nuevas", startDate: "", createdBy: "u1" });
  eq("createTask: una fecha vacía (\"\") cuenta como sin fecha: hoy", created[5].startDate, TODAY);

  // duplicar: la copia de una oferta es una oferta nueva
  created.length = 0;
  const offerTask = { id: "o1", projectId: "ofr", sectionId: "nuevas", extraProjectIds: [], extraSections: {}, title: "Oferta vieja", description: "", assigneeIds: [], startDate: "2026-01-05", dueDate: "2026-02-01", priority: "media", tags: [], subtasks: [], attachments: [], createdBy: "u1" };
  await duplicateTask(offerTask);
  eq("duplicar una oferta: la copia empieza HOY, no hereda la fecha de inicio del original", [created[0].startDate, created[0].dueDate], [TODAY, "2026-02-01"]);
  await duplicateTask({ ...offerTask, id: "t1", projectId: "P1", sectionId: "s1", title: "Tarea vieja" });
  eq("duplicar una tarea normal: conserva su fecha de inicio como siempre", created[1].startDate, "2026-01-05");
  await duplicateTask({ ...offerTask, id: "t2", projectId: "P1", sectionId: "s1", extraProjectIds: ["ofr"], title: "Tarea con Ofertas adicional" });
  eq("duplicar una tarea con Ofertas como proyecto adicional: es una oferta, empieza hoy", created[2].startDate, TODAY);
}
{
  // convertir una tarea en oferta
  const offersProject = { id: "ofr", ...OFFERS, exclusive: true };
  const ctx = { defaultSector: "", makeId: () => "rev1", now: new Date("2026-11-26T12:00:00Z") };
  const t = { id: "t9", projectId: "P1", createdAt: new Date("2026-03-10T10:00:00"), customFields: {}, revisions: [] };
  const plan = planTaskToOffer(offersProject, t, ctx);
  eq("convertir una tarea en oferta: la fecha de inicio es el día en que se creó la tarea (el mismo que lleva su fila «A1 · Versión original»)", [plan.startDate, plan.revisions[0].createdAt.slice(0, 10)], ["2026-03-10", "2026-03-10"]);
  const plan2 = planTaskToOffer(offersProject, { ...t, startDate: "2026-04-01" }, ctx);
  check("… si la tarea ya tenía fecha de inicio, se respeta (no se toca)", !("startDate" in plan2));
  const plan3 = planTaskToOffer(offersProject, { ...t, createdAt: null }, ctx);
  eq("… sin fecha de creación conocida, se usa hoy", plan3.startDate, TODAY);
  const plan4 = planTaskToOffer(offersProject, { ...t, revisions: [{ id: "r", version: "A1", changes: "x", createdAt: "2026-03-10T10:00:00.000Z" }] }, ctx);
  eq("… aunque la tarea ya tuviera histórico, la fecha de inicio se completa igual", plan4.startDate, "2026-03-10");
  eq("«Deshacer» de la conversión devuelve startDate (ya estaba en UNDO_FIELDS)", /"startDate"/.test(read("js/undo.js")), true);
}
{
  // importador de históricos
  const { historicalOfferTaskData } = await import("../js/data/offer-import.js");
  const d = historicalOfferTaskData({ projectId: "ofr", sectionId: "cerradas", title: "OF-1", createdAt: new Date("2025-06-15T09:00:00"), customFields: {}, revisions: [], isComplete: true, completedAt: new Date("2025-07-01T09:00:00") }, { createdBy: "u1", order: 1 });
  eq("importar ofertas históricas: la fecha de inicio es la de la oferta (su createdAt original), no la de hoy", [d.startDate, d.dueDate], ["2025-06-15", null]);
  const d2 = historicalOfferTaskData({ projectId: "ofr", title: "OF-2", createdAt: null }, { createdBy: "u1", order: 2 });
  eq("… sin fecha válida no se inventa ninguna (null)", d2.startDate, null);
}
{
  // formulario de oferta nueva (task-modal.js real): la fecha de inicio sale puesta con el día de hoy
  globalThis.confirm = () => true;
  const { openTaskModal } = await import("../js/components/task-modal.js");
  const offersProject = { id: "ofr", ...OFFERS, sections: [{ id: "nuevas", name: "Nuevas", order: 0 }, { id: "entregadas", name: "Entregadas", order: 1 }] };
  const members = [{ uid: "u1", name: "Ana", role: "member" }];
  openTaskModal({ project: offersProject, teamMembers: members, allProjects: [offersProject], tagsRegistry: [], currentUserProfile: { uid: "u1", name: "Ana", role: "member", department: "diseno-industria" }, onSaved() {}, onClosed() {} });
  await tick(20);
  const start = $("#t-start");
  eq("modal de una OFERTA nueva: «Inicio» sale con la fecha de hoy", start && start.value, TODAY);
  document.querySelector("#t-cancel").click();
  await tick(5);

  const normal = { id: "P1", name: "Proyecto", sections: [{ id: "s1", name: "S", order: 0 }] };
  openTaskModal({ project: normal, teamMembers: members, allProjects: [normal, offersProject], tagsRegistry: [], currentUserProfile: { uid: "u1", name: "Ana", role: "member" }, onSaved() {}, onClosed() {} });
  await tick(20);
  eq("modal de una tarea normal nueva: «Inicio» sigue vacío", $("#t-start").value, "");
  document.querySelector("#t-cancel").click();
}

// ---------------------------------------------------------------- 4) entrega
{
  const idx = read("index.html");
  // (la entrega actual la fija v96-drawings.test.mjs: aquí basta con que sea ≥ 95 y esté bien puesta en los 14)
  const linkVersions = [...idx.matchAll(/css\/[\w-]+\.css\?v=(\d+)/g)].map((m) => Number(m[1]));
  eq("index.html: los 14 <link> con el mismo ?v=N (≥ 95)", new Set(linkVersions).size + ":" + linkVersions.length + ":" + (linkVersions[0] >= 95), "1:14:true");
  const pkgMajor = (f) => Number(String(JSON.parse(read(f)).version).split(".")[0]);
  check("package.json y package-lock.json: versión ≥ 95 y la misma", pkgMajor("package.json") >= 95 && pkgMajor("package.json") === pkgMajor("package-lock.json"));
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES.find((x) => x.id === 95);
  check("Novedades: la entrada 95, mayor que la 94, y habla de contraseña, tablet y fecha de inicio", !!r && r.id > RELEASES.find((x) => x.id === 94).id && ["contraseña", "tablet", "fecha de inicio"].every((w) => r.items.join(" ").toLowerCase().includes(w)), r && r.items);
  const readme = read("README.md");
  check("README: historial v94 → v95 y los archivos nuevos (password-toggle.js, sidebar-drawer.js)", /v94 → v95 \(Chusy-95\.zip\)/.test(readme) && /password-toggle\.js/.test(readme) && /sidebar-drawer\.js/.test(readme));
  check("README: sección 3.26 (v95)", /### 3\.26 [^\n]*\(v95\)/.test(readme));
  check("sin firestore.rules nuevas: no se toca el archivo en la v95 (no hay que republicar)", !/v95/.test(read("firestore.rules")));
}

done("v95 · Ojo para ver la contraseña, barra lateral desplegable en tablet vertical y fecha de inicio de las ofertas");
