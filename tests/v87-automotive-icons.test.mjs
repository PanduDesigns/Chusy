// v87 · bloque «Flujo de Etapas» sin colapsar e iconos de Automoción.
//  1) CSS: el bloque de etapas del modal de tarea no se encoge (flex-shrink 0, min-height min-content) ni usa overflow hidden;
//     el cuerpo del modal es la columna con scroll.
//  2) Selector de apariencia: catálogo de coches/vehículos y su pintado.
//  3) Icono por defecto de Automoción: selector, «Nuevo proyecto», convertir una oferta y createProject.
//  4) Icono efectivo (fallback visual) en todos los sitios donde se pinta un proyecto.
//  5) Migración de proyectos de Automoción con carpeta → coche (idempotente, respeta otros iconos).
//  6) Entrega: ?v=87, package.json, Novedades y README.
import fs from "node:fs";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
globalThis.confirm = () => true; // cerrar un formulario «sucio» pregunta antes (jsdom no trae confirm)
freezeNow("2026-11-09T10:00:00"); // lunes

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el, value) => { el.value = value; el.dispatchEvent(new window.Event("change", { bubbles: true })); };
// jsdom no admite emojis dentro de selectores CSS: se busca el botón por su data-icon.
const iconBtn = (root, icon) => [...root.querySelectorAll("[data-icon]")].find((b) => b.dataset.icon === icon);
const selectedIcon = (root) => { const b = root.querySelector(".icon-grid__btn.is-selected"); return b ? b.dataset.icon : null; };

/** Cuerpo de la regla CSS cuyo selector es exactamente `selector` ('' si no existe). */
function cssRule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[1].replace(/\s+/g, " ") : "";
}
const has = (body, decl) => body.includes(decl);

const U = await import("../js/utils.js");
const PP = await import("../js/project-properties.js");
const picker = await import("../js/components/project-appearance-picker.js");
globalThis.__fb = { collections: {}, sets: [], hooks: {} };

// ---------------------------------------------------------------- 1) CSS del bloque «Flujo de Etapas»
{
  const css = read("css/07-modals.css");
  const section = cssRule(css, ".wf-section");
  check("CSS: .wf-section existe", !!section);
  check("CSS: .wf-section → flex-shrink: 0 (no se comprime dentro de la columna flex del modal)", has(section, "flex-shrink: 0"), section);
  check("CSS: .wf-section → min-height: min-content (jamás por debajo de su contenido)", has(section, "min-height: min-content"), section);
  check("CSS: .wf-section → sin overflow: hidden (era lo que lo aplastaba y recortaba las sugerencias de Proveedor)", !/overflow(-x|-y)?:\s*hidden/.test(section) && has(section, "overflow: visible"), section);
  check("CSS: .wf-section → altura automática y sin tope", has(section, "height: auto") && has(section, "max-height: none"), section);
  check("CSS: .wf-section conserva sus protecciones laterales (box-sizing, max-width, min-width)", has(section, "box-sizing: border-box") && has(section, "max-width: 100%") && has(section, "min-width: 0"), section);

  const row = cssRule(css, ".wf-row");
  check("CSS: .wf-row (cada etapa) → flex-shrink 0, min-height min-content y sin overflow hidden", has(row, "flex-shrink: 0") && has(row, "min-height: min-content") && !/overflow(-x|-y)?:\s*hidden/.test(row) && has(row, "min-width: 0"), row);
  const rows = cssRule(css, ".wf-rows");
  check("CSS: .wf-rows (la lista de etapas) → flex-shrink 0 y min-height min-content", has(rows, "flex-shrink: 0") && has(rows, "min-height: min-content"), rows);

  const body = cssRule(css, ".modal__body");
  check("CSS: .modal__body es la columna con scroll (overflow-y auto, flex 1 1 auto, min-height 0)", has(body, "overflow-y: auto") && has(body, "flex: 1 1 auto") && has(body, "min-height: 0") && has(body, "flex-direction: column"), body);
  check("CSS: ningún hijo directo de .modal__body se encoge (.modal__body > * { flex-shrink: 0 })", has(cssRule(css, ".modal__body > *"), "flex-shrink: 0"));

  // Los campos de dentro siguen sin desbordar por los lados (v85/v86)
  const controls = cssRule(css, ".wf-row__controls");
  check("CSS: la rejilla de controles y la de compra siguen con min-width 0 / width 100% / box-sizing", has(controls, "min-width: 0") && has(controls, "width: 100%") && has(controls, "box-sizing: border-box") && has(cssRule(css, ".wf-row__trace, .trace-grid"), "min-width: 0"));

  // Ninguna otra hoja vuelve a poner overflow hidden en el bloque
  const others = fs.readdirSync(new URL("../css/", import.meta.url)).filter((f) => f.endsWith(".css") && f !== "07-modals.css" && f !== "styles.css");
  const stray = others.filter((f) => /\.wf-(section|rows|row)\s*\{[^}]*overflow:\s*hidden/.test(read(`css/${f}`)));
  eq("CSS: ninguna otra hoja reimpone overflow hidden al bloque de etapas", stray, []);

  // El bloque en el modal de tarea sigue siendo hijo directo de .modal__body y se pinta a su altura natural
  const tm = read("js/components/task-modal.js");
  check("task-modal.js: #t-workflow lleva la clase wf-section (la que protege el CSS)", /class="field wf-section" id="t-workflow"/.test(tm));
  check("text-suggest: el desplegable de sugerencias vive fuera del modal (position: fixed en <body>), no lo recorta ningún overflow", has(cssRule(css, ".text-suggest"), "position: fixed"));
}

// ---------------------------------------------------------------- 2) catálogo de iconos de coches y vehículos
{
  const list = picker.AUTOMOTIVE_ICONS;
  eq("catálogo: 6 iconos, el coche primero", list.map((i) => i.icon), ["🚗", "🏎️", "🚙", "🚐", "🚛", "🔧"]);
  eq("catálogo: turismo, deportivo, SUV, furgoneta, camión y taller (etiquetas)", list.map((i) => i.label), [
    "Coche turismo / sedán", "Deportivo / coupé", "SUV / todoterreno / 4x4", "Furgoneta / vehículo comercial", "Camión / vehículo industrial", "Chasis / carrocería / taller",
  ]);
  check("el coche principal es CAR_ICON y la carpeta FOLDER_ICON", picker.AUTOMOTIVE_ICONS[0].icon === U.CAR_ICON && U.CAR_ICON === "🚗" && U.FOLDER_ICON === "📁" && picker.CURATED_ICONS[0] === "📁");
  const src = read("js/components/project-appearance-picker.js");
  const moreBlock = src.slice(src.indexOf("const MORE_ICONS"), src.indexOf("function badgeStyle"));
  const everyIcon = [...picker.CURATED_ICONS, ...list.map((i) => i.icon), ...[...moreBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1])];
  check("ningún icono se repite entre las rejillas (general, Automoción y «más iconos»)", new Set(everyIcon).size === everyIcon.length, everyIcon.filter((x, i) => everyIcon.indexOf(x) !== i));

  const box = document.createElement("div");
  document.body.appendChild(box);
  let last = null;
  picker.mountAppearancePicker(box, { icon: "📁", color: "#FCD000", onChange: (v) => { last = v; } });
  const group = $("#ap-automotive", box);
  check("el selector muestra el grupo «Automoción» con las 6 opciones", !!group && /Automoción/.test(group.textContent) && group.querySelectorAll("[data-icon]").length === 6);
  check("… cada botón con su nombre como tooltip", ["🚗", "🏎️", "🚙", "🚐", "🚛", "🔧"].every((ic, i) => iconBtn(group, ic).title === list[i].label));
  for (const { icon } of list) {
    click(iconBtn(box, icon));
    check(`elegir ${icon} lo guarda y lo marca como seleccionado`, last.icon === icon && selectedIcon(box) === icon);
    check(`… y la insignia grande del selector lo pinta (${icon})`, $(".project-badge--lg", box).textContent === icon);
    check(`… y la insignia de proyecto (sidebar, filtros, tarjetas) lo pinta (${icon})`, U.badgeHtml(icon, "#FCD000", "project-badge--sm").includes(`>${icon}</span>`) && U.projectBadgeHtml({ icon, color: "#FCD000" }).includes(`>${icon}</span>`) && U.projectIcon({ icon }) === icon);
  }
  box.remove();
}

// ---------------------------------------------------------------- 3a) selector: icono por defecto según el sector
{
  const mk = (opts) => { const box = document.createElement("div"); document.body.appendChild(box); let last = null; const api = picker.mountAppearancePicker(box, { color: "#FCD000", onChange: (v) => { last = v; }, ...opts }); return { box, api, get last() { return last; } }; };

  let t = mk({ sector: "Automoción" });
  check("selector con sector Automoción: arranca con el coche", t.last.icon === "🚗" && selectedIcon(t.box) === "🚗");
  t = mk({ sector: "Industria" });
  check("selector con sector Industria: arranca con la carpeta", t.last.icon === "📁");
  t = mk({});
  check("selector sin sector: arranca con la carpeta (como siempre)", t.last.icon === "📁");
  t = mk({ sector: "Automoción", icon: "🏭" });
  check("un icono pasado explícitamente manda sobre el sector", t.last.icon === "🏭");

  t = mk({ sector: "Industria" });
  t.api.applySector("Automoción");
  check("Industria → Automoción sin tocar el icono (seguía en carpeta): pasa al coche", t.last.icon === "🚗" && selectedIcon(t.box) === "🚗");
  t.api.applySector("Industria");
  check("… y si vuelve a Industria sin haberlo tocado, vuelve a la carpeta", t.last.icon === "📁");
  t.api.applySector("automocion");
  check("applySector admite el sector sin tildes ni mayúsculas", t.last.icon === "🚗");

  t = mk({ sector: "Industria" });
  click(iconBtn(t.box, "🏭"));
  t.api.applySector("Automoción");
  check("si ya había elegido otro icono a mano (🏭), cambiar a Automoción lo respeta", t.last.icon === "🏭" && selectedIcon(t.box) === "🏭");

  t = mk({ sector: "Industria" });
  click(iconBtn(t.box, "📁")); // lo elige a mano aunque sea el de por defecto
  t.api.applySector("Automoción");
  check("elegir a mano incluso la carpeta cuenta como elección: no se cambia", t.last.icon === "📁");

  t = mk({ sector: "Industria" });
  const custom = $("#ap-custom", t.box);
  custom.value = "🚘";
  custom.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  t.api.applySector("Automoción");
  check("pegar un emoji propio (🚘) también cuenta como elección manual", t.last.icon === "🚘");

  t = mk({ sector: "Automoción" });
  click(iconBtn(t.box, "🚛"));
  t.api.applySector("Industria");
  check("Automoción → Industria con un camión elegido a mano: sigue el camión", t.last.icon === "🚛");
}

// ---------------------------------------------------------------- 3b) «Nuevo proyecto»
{
  const { openProjectModal } = await import("../js/components/project-modal.js");
  const open = (opts) => { const received = { v: null }; openProjectModal({ onCreate: async (d) => { received.v = d; }, ...opts }); return received; };
  const create = async (rec, name = "Proyecto X") => { $("#p-name").value = name; click($("#create")); await tick(10); return rec.v; };

  let rec = open({ defaultSector: "Automoción" });
  check("Nuevo proyecto con el filtro «Automoción» activo: el Sector sale preseleccionado y el icono es el coche", $("#p-sector").value === "Automoción" && selectedIcon($("#p-appearance")) === "🚗");
  let data = await create(rec);
  check("… y crea el proyecto con icon 🚗 y properties.sector «Automoción»", data.icon === "🚗" && data.properties && data.properties.sector === "Automoción", data);

  rec = open({});
  check("Nuevo proyecto sin filtro: Sector «— Sin definir —» y carpeta", $("#p-sector").value === "" && selectedIcon($("#p-appearance")) === "📁");
  change($("#p-sector"), "Automoción");
  check("elegir Automoción en el modal (icono sin tocar, en carpeta) → pasa al coche", selectedIcon($("#p-appearance")) === "🚗");
  change($("#p-sector"), "Industria");
  check("… y de Automoción a Industria sin tocar el icono, vuelve a la carpeta", selectedIcon($("#p-appearance")) === "📁");
  change($("#p-sector"), "Automoción");
  data = await create(rec);
  check("crear desde el modal tras elegir Automoción: icon 🚗", data.icon === "🚗" && data.properties.sector === "Automoción", data);

  rec = open({});
  click(iconBtn($("#p-appearance"), "🏭"));
  change($("#p-sector"), "Automoción");
  data = await create(rec);
  check("si ya había elegido un icono a mano (🏭) y luego pone Automoción: se respeta 🏭", data.icon === "🏭" && data.properties.sector === "Automoción", data);

  rec = open({});
  data = await create(rec);
  check("sin sector elegido no se manda `properties` (como antes) y el icono es la carpeta", data.icon === "📁" && !("properties" in data), data);

  rec = open({ defaultSector: "Industria" });
  check("con el filtro «Industria» activo el Sector sale en Industria y el icono es la carpeta", $("#p-sector").value === "Industria" && selectedIcon($("#p-appearance")) === "📁");
  document.querySelector("#cancel").click();

  const app = read("js/app.js");
  check("app.js pasa a «Nuevo proyecto» el sector del filtro activo de la barra lateral", /openProjectModal\(\{\s*defaultSector:[^}]*SECTOR_FILTER_OPTIONS[^}]*sectorFilter/.test(app));
}

// ---------------------------------------------------------------- 3c) convertir una oferta en proyecto
{
  const { openOfferConversionModal } = await import("../js/components/project-properties-modal.js");
  const offersProject = { id: "off", name: "Ofertas", exclusive: true, exclusiveKey: "ofertas", sections: [], customFieldDefs: [{ id: "sector", name: "Sector", type: "lista", options: ["Automoción", "Industria"] }] };
  const mkOffer = (sector) => ({ id: "O1", title: "Línea Togg", projectId: "off", offerCode: "00126", dueDate: "2026-12-01", customFields: sector ? { sector } : {}, revisions: [] });
  const open = (offer) => { const out = { v: null }; openOfferConversionModal({ offer, offersProject, today: "2026-11-09", getCommercialOptions: () => [], onConfirm: async (r) => { out.v = r; } }); return out; };
  const confirm = async (out) => { click($("#pp-confirm")); await tick(10); return out.v; };

  let out = open(mkOffer("Automoción"));
  check("la oferta de origen es de Automoción: el selector de la conversión parte del coche", $("#pp-sector").value === "Automoción" && selectedIcon($("#pp-appearance")) === "🚗");
  let r = await confirm(out);
  check("… y al crear el proyecto se manda icon 🚗 con sector Automoción", r.icon === "🚗" && r.properties.sector === "Automoción", r);

  out = open(mkOffer("Industria"));
  check("oferta de Industria: parte de la carpeta", selectedIcon($("#pp-appearance")) === "📁");
  change($("#pp-sector"), "Automoción");
  check("cambiar el Sector a Automoción en la ventana (icono sin tocar) → coche", selectedIcon($("#pp-appearance")) === "🚗");
  r = await confirm(out);
  check("… y el proyecto sale con 🚗", r.icon === "🚗" && r.properties.sector === "Automoción", r);

  out = open(mkOffer("Industria"));
  click(iconBtn($("#pp-appearance"), "🏭"));
  change($("#pp-sector"), "Automoción");
  r = await confirm(out);
  check("con un icono elegido a mano (🏭) y el Sector cambiado a Automoción, se respeta 🏭", r.icon === "🏭", r);

  out = open(mkOffer(""));
  check("oferta sin sector: carpeta (como antes)", selectedIcon($("#pp-appearance")) === "📁");
  r = await confirm(out);
  check("… y se crea con 📁", r.icon === "📁", r);

  // La conversión de oferta NO cambia el icono al tocar el Sector en «Propiedades» de un proyecto ya creado (no hay selector)
  const { openProjectPropertiesModal } = await import("../js/components/project-properties-modal.js");
  openProjectPropertiesModal({ project: { id: "p1", name: "P", properties: { sector: "Industria" } }, onSave() {}, getCommercialOptions: () => [] });
  change($("#pp-sector"), "Automoción"); // no debe fallar sin selector
  check("«Propiedades» de un proyecto existente cambia de Sector sin selector de icono y sin errores", !$("#pp-appearance"));
  document.querySelector("#pp-cancel").click();
}

// ---------------------------------------------------------------- 3d) createProject / convertOfferToProject
{
  const { createProject } = await import("../js/data/projects.js");
  const { convertOfferToProject } = await import("../js/data/offer-conversion.js");
  const created = [];
  globalThis.__fb = { collections: {}, sets: [], hooks: { addDoc: async (ref, data) => { created.push({ ref, data }); return { id: "NEW" + created.length }; }, updateDoc: async () => {} } };
  const last = () => created[created.length - 1].data;

  await createProject({ name: "A", creatorUid: "u1", properties: { sector: "Automoción" }, code: "00126" });
  check("createProject sin icono y sector Automoción → 🚗", last().icon === "🚗", last().icon);
  await createProject({ name: "B", creatorUid: "u1", properties: { sector: "Industria" }, code: "00226" });
  check("createProject sin icono y sector Industria → 📁", last().icon === "📁");
  await createProject({ name: "C", creatorUid: "u1", code: "00326" });
  check("createProject sin icono ni propiedades → 📁 (como siempre)", last().icon === "📁");
  await createProject({ name: "D", creatorUid: "u1", properties: { sector: "Automoción" }, icon: "🚛", code: "00426" });
  check("createProject con un icono explícito lo respeta aunque sea de Automoción (🚛)", last().icon === "🚛");
  await createProject({ name: "E", creatorUid: "u1", properties: { sector: "Automoción" }, icon: "", code: "00526" });
  check("createProject con icono vacío y sector Automoción → 🚗", last().icon === "🚗");

  const offersProject = { id: "off", name: "Ofertas", exclusive: true, customFieldDefs: [], sections: [] };
  const offer = { id: "O1", title: "Cabina", projectId: "off", offerCode: "00126", customFields: {}, revisions: [] };
  const moveFolder = async () => ({ status: "none", folderId: null });
  await convertOfferToProject({ offer, name: "Cabina", properties: { sector: "Automoción" }, creatorUid: "u1", offersProject, moveFolder });
  check("convertOfferToProject (sin icon, p. ej. una llamada antigua) de una oferta de Automoción → 🚗", created.filter((c) => c.ref.path === "projects").pop().data.icon === "🚗");
  await convertOfferToProject({ offer, name: "Cabina 2", properties: { sector: "Automoción" }, creatorUid: "u1", offersProject, icon: "🏎️", moveFolder });
  check("convertOfferToProject con el icono elegido en la ventana (🏎️) lo respeta", created.filter((c) => c.ref.path === "projects").pop().data.icon === "🏎️");
  globalThis.__fb = { collections: {}, sets: [], hooks: {} };
}

// ---------------------------------------------------------------- 4) icono efectivo en todos los sitios donde se pinta un proyecto
{
  const car = (extra = {}) => ({ properties: { sector: "Automoción" }, ...extra });
  eq("effectiveProjectIcon: Automoción sin icono → 🚗", U.effectiveProjectIcon(car()), "🚗");
  eq("effectiveProjectIcon: Automoción con carpeta → 🚗", U.effectiveProjectIcon(car({ icon: "📁" })), "🚗");
  eq("effectiveProjectIcon: Automoción con icono vacío o en blanco → 🚗", [U.effectiveProjectIcon(car({ icon: "" })), U.effectiveProjectIcon(car({ icon: "  " })), U.effectiveProjectIcon(car({ icon: null }))], ["🚗", "🚗", "🚗"]);
  eq("effectiveProjectIcon: Automoción con CUALQUIER otro icono → el suyo", ["🏭", "🚙", "🚗", "🔧", "💼"].map((icon) => U.effectiveProjectIcon(car({ icon }))), ["🏭", "🚙", "🚗", "🔧", "💼"]);
  eq("effectiveProjectIcon: «AUTOMOCIÓN», «automocion » y «Automocion» también cuentan", ["AUTOMOCIÓN", "automocion ", "Automocion"].map((sector) => U.effectiveProjectIcon({ icon: "📁", properties: { sector } })), ["🚗", "🚗", "🚗"]);
  eq("effectiveProjectIcon: Industria o sin sector con carpeta → se queda la carpeta", [{ icon: "📁", properties: { sector: "Industria" } }, { icon: "📁" }, { icon: "📁", properties: {} }].map(U.effectiveProjectIcon), ["📁", "📁", "📁"]);
  eq("effectiveProjectIcon: sin icono ni sector → '' ; projectIcon → 📁 ; null → ''", [U.effectiveProjectIcon({}), U.projectIcon({}), U.effectiveProjectIcon(null), U.projectIcon(null)], ["", "📁", "", "📁"]);
  eq("projectIcon: Automoción con carpeta → 🚗", U.projectIcon(car({ icon: "📁" })), "🚗");
  check("projectBadgeHtml (barra lateral, cabeceras, tarjetas) pinta el coche en un proyecto de Automoción con carpeta", U.projectBadgeHtml(car({ icon: "📁", color: "#FCD000" })).includes(">🚗</span>"));
  eq("PP re-exporta el resolver (project-properties.js)", [PP.effectiveProjectIcon(car({ icon: "📁" })), PP.CAR_ICON, PP.FOLDER_ICON, PP.defaultIconForSector("Automoción"), PP.defaultIconForSector("Industria"), PP.defaultIconForSector("")], ["🚗", "🚗", "📁", "🚗", "📁", "📁"]);

  // Filtro por proyecto (barra de filtros), «Pedidos» y línea de tiempo global
  const { buildFilterDefs } = await import("../js/task-filters.js");
  const defs = buildFilterDefs({ teamMembers: [], tagsRegistry: [], projects: [{ id: "A", name: "Togg", color: "#111111", icon: "📁", properties: { sector: "Automoción" } }, { id: "B", name: "Horno", color: "#222222", icon: "📁", properties: { sector: "Industria" } }, { id: "C", name: "Sin icono", color: "#333333" }], includeProject: true });
  eq("filtro «Proyecto»: Automoción con carpeta → 🚗; Industria → 📁; sin icono ni sector → ''", defs.find((d) => d.key === "project").options.map((o) => o.icon), ["🚗", "📁", ""]);

  const orders = await import("../js/orders.js");
  const ws = await import("../js/workflow-stages.js");
  const wf = ws.workflowFromEnabled(["purchase", "production"], { purchase: { assigneeId: "u1", dueDate: "2026-11-12" } });
  const row = orders.orderRow({ id: "T1", projectId: "A", title: "Pieza", workflow: wf, ...ws.purchaseTraceFields(wf) }, { offersProjectId: "off", projectsById: new Map([["A", { id: "A", name: "Togg", color: "#111111", icon: "📁", properties: { sector: "Automoción" } }]]), nameOf: () => "Ana" });
  check("«Pedidos»: la fila de un proyecto de Automoción con carpeta lleva el coche", !!row && row.projectIcon === "🚗", row && row.projectIcon);

  const app = read("js/app.js");
  check("app.js (línea de tiempo global) y task-filters.js/orders.js usan el icono efectivo, no p.icon", /icon:\s*effectiveProjectIcon\(p\)/.test(app) && /icon:\s*effectiveProjectIcon\(p\)/.test(read("js/task-filters.js")) && /projectIcon:\s*effectiveProjectIcon\(project\)/.test(read("js/orders.js")));
  check("el resto de pintores (barra lateral, cabecera, Métricas, Mis tareas, selección múltiple) ya usan projectIcon()/projectBadgeHtml()", ["js/components/sidebar.js", "js/components/topbar.js", "js/views/metrics-view.js", "js/views/my-tasks-view.js", "js/components/bulk-toolbar.js"].every((f) => /projectIcon|projectBadgeHtml/.test(read(f))));
  check("«Editar proyecto» parte del icono efectivo (si no, un proyecto de Automoción sin icono se editaría con la carpeta)", /effectiveProjectIcon\(project\)/.test(read("js/components/edit-project-modal.js")));
}

// ---------------------------------------------------------------- 5) migración carpeta → coche
{
  const mk = (id, extra = {}) => ({ id, name: id, ...extra });
  const AUTO = { sector: "Automoción" };
  const projects = [
    mk("a-folder", { icon: "📁", properties: AUTO }),            // migra
    mk("a-empty", { icon: "", properties: AUTO }),                // migra
    mk("a-undefined", { properties: AUTO }),                      // migra (sin campo icon)
    mk("a-null", { icon: null, properties: AUTO }),               // migra
    mk("a-blank", { icon: "  ", properties: AUTO }),              // migra
    mk("a-caps", { icon: "📁", properties: { sector: "AUTOMOCIÓN" } }), // migra
    mk("a-truck", { icon: "🚛", properties: AUTO }),              // se respeta
    mk("a-car", { icon: "🚗", properties: AUTO }),                // ya está
    mk("a-factory", { icon: "🏭", properties: AUTO }),            // se respeta
    mk("i-folder", { icon: "📁", properties: { sector: "Industria" } }), // no es de Automoción
    mk("n-folder", { icon: "📁" }),                               // sin sector
    mk("x-offers", { icon: "📁", exclusive: true, properties: AUTO }), // sección exclusiva: nunca
  ];
  eq("plan: solo los de Automoción con carpeta o sin icono", PP.planAutomotiveIconMigration(projects), ["a-folder", "a-empty", "a-undefined", "a-null", "a-blank", "a-caps"]);
  eq("plan: entradas raras (null, no array, sin id) no rompen", [PP.planAutomotiveIconMigration(null), PP.planAutomotiveIconMigration(undefined), PP.planAutomotiveIconMigration([null, {}, { properties: AUTO }])], [[], [], []]);

  const { migrateAutomotiveProjectIcons } = await import("../js/data/projects.js");
  globalThis.__fb = { collections: {}, sets: [], hooks: {} };
  const n1 = await migrateAutomotiveProjectIcons(projects);
  const updates = globalThis.__fb.updates || [];
  check("migración: devuelve cuántos actualizó (6)", n1 === 6, n1);
  eq("migración: escribe en Firestore SOLO icon = 🚗, en los 6 proyectos", updates.map((u) => [u.ref.path, u.fields]), ["a-folder", "a-empty", "a-undefined", "a-null", "a-blank", "a-caps"].map((id) => [`projects/${id}`, { icon: "🚗" }]));
  check("migración: los que ya tenían otro icono (🚛, 🏭, 🚗), Industria, sin sector y Ofertas NO se tocan", !updates.some((u) => /a-truck|a-car|a-factory|i-folder|n-folder|x-offers/.test(u.ref.path)));

  // Idempotente: aplicando el resultado y volviendo a pasar la migración, ya no hay nada que escribir
  const migrated = projects.map((p) => (updates.some((u) => u.ref.path === `projects/${p.id}`) ? { ...p, icon: "🚗" } : p));
  globalThis.__fb.updates = [];
  const n2 = await migrateAutomotiveProjectIcons(migrated);
  check("migración idempotente: la segunda pasada no escribe nada", n2 === 0 && globalThis.__fb.updates.length === 0, { n2, writes: globalThis.__fb.updates.length });
  eq("… y tras migrar, ningún proyecto de Automoción conserva la carpeta como icono guardado", migrated.filter((p) => !p.exclusive && PP.isAutomotiveProject(p) && (!p.icon || !p.icon.trim() || p.icon === "📁")).map((p) => p.id), []);

  // Muchos proyectos: lotes de ≤ 450 (límite de Firestore: 500 por lote)
  const many = Array.from({ length: 1000 }, (_, i) => mk(`m${i}`, { icon: "📁", properties: AUTO }));
  let commits = 0;
  globalThis.__fb = { collections: {}, sets: [], hooks: {} };
  const nMany = await migrateAutomotiveProjectIcons(many);
  check("migración con 1000 proyectos: los actualiza todos", nMany === 1000 && globalThis.__fb.updates.length === 1000, nMany);
  void commits;

  // Cableado en app.js: solo admin, una vez por sesión, después del sembrado y de la migración de IDs, sin bloquear si falla
  const app = read("js/app.js");
  const fn = app.slice(app.indexOf("async function runAutomotiveIconMigration"), app.indexOf("function showApp()"));
  check("app.js: la migración solo corre para un admin y como mucho una vez por sesión", /hasMigratedAutomotiveIcons \|\|/.test(fn) && /currentUser\.role !== "admin"/.test(fn) && /hasMigratedAutomotiveIcons = true/.test(fn));
  check("app.js: un fallo de la migración se registra y no rompe el arranque (try/catch)", /try \{[\s\S]*migrateAutomotiveProjectIcons\(allProjects\)[\s\S]*\} catch \(e\) \{\s*console\.error/.test(fn));
  check("app.js: se lanza al iniciar sesión, encadenada tras el sembrado y la migración de IDs", /\.then\(\(\) => runCodeMigration\(allProjects\)\)\s*\.then\(\(\) => runAutomotiveIconMigration\(allProjects\)\)/.test(app));
  check("app.js importa migrateAutomotiveProjectIcons de data/projects.js", /migrateAutomotiveProjectIcons \} from "\.\/data\/projects\.js"/.test(app));
  check("firestore.rules: sin cambios necesarios (cualquier cuenta activa puede editar proyectos)", /match \/projects\/\{projectId\}/.test(read("firestore.rules")));
}

// ---------------------------------------------------------------- 6) entrega
{
  const idx = read("index.html");
  eq("index.html: los 14 <link> a ?v=87", (idx.match(/css\/[\w-]+\.css\?v=87/g) || []).length, 14);
  check("index.html: ningún <link> se ha quedado en una versión anterior", !/\.css\?v=(?!87)\d+/.test(idx));
  check("package.json y package-lock.json: 87.0.0", JSON.parse(read("package.json")).version === "87.0.0" && JSON.parse(read("package-lock.json")).version === "87.0.0");
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES[0];
  check("Novedades: entrada 87 la primera, mayor que la 86, y habla de etapas e iconos de coche", r.id === 87 && r.id > RELEASES[1].id && /etapas/i.test(JSON.stringify(r)) && /coche/i.test(JSON.stringify(r)) && r.items.length >= 3, r && r.id);
  const readme = read("README.md");
  check("README: historial v86 → v87 y la migración de iconos documentada", /v86 → v87 \(Chusy-87\.zip\)/.test(readme) && /migrateAutomotiveProjectIcons/.test(readme) && /AUTOMOTIVE_ICONS/.test(readme));
}

delete globalThis.__fb;
done("v87 · Flujo de Etapas sin colapsar e iconos de Automoción");
