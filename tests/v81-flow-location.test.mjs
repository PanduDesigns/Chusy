// v81 — Métricas pasivas (embudo de ofertas + salud del flujo + sectionEnteredAt), acceso a Métricas para
// Responsables de Departamento, y puente local «Abrir Ubicación» (ruta raíz, carpeta sugerida, script de Windows).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

setupDom();
freezeNow("2026-11-02T12:00:00"); // lunes
const fb = (globalThis.__fb = globalThis.__fb || { collections: {}, sets: [] });
const updates = [];
fb.hooks = { async updateDoc(ref, fields) { updates.push({ id: ref.id, fields }); } };

const flow = await import("../js/flow-metrics.js");
const { withSectionEnteredAt, flowEnteredAt, workingDaysInSection, flowHealth, offerFunnel, STAGNANT_WORKING_DAYS } = flow;
const tasksData = await import("../js/data/tasks.js");
const { canViewMetrics, canViewWorkload } = await import("../js/departments.js");
const { OFFERS_KEY } = await import("../js/offers.js");
const { renderMetricsView } = await import("../js/views/metrics-view.js");
const loc = await import("../js/location.js");
const { createSuggestLocationControls } = await import("../js/components/open-location.js");

const d = (iso) => new Date(iso + "T10:00:00");
const NOW = new Date("2026-11-02T12:00:00");

// ------------------------------------------------------------ 1) withSectionEnteredAt (pura)
eq("sin sectionId ni projectId no añade nada", withSectionEnteredAt({ title: "x" }, null, "TS"), { title: "x" });
eq("con sectionId y sin `prev`: se sella", withSectionEnteredAt({ sectionId: "s2" }, null, "TS"), { sectionId: "s2", sectionEnteredAt: "TS" });
eq("misma sección que antes: NO se sella (guardar el modal sin moverla)", withSectionEnteredAt({ sectionId: "s1", projectId: "p1" }, { sectionId: "s1", projectId: "p1" }, "TS"), { sectionId: "s1", projectId: "p1" });
eq("sección distinta: se sella", withSectionEnteredAt({ sectionId: "s2" }, { sectionId: "s1", projectId: "p1" }, "TS"), { sectionId: "s2", sectionEnteredAt: "TS" });
eq("proyecto distinto: se sella", withSectionEnteredAt({ projectId: "p2", sectionId: "s1" }, { sectionId: "s1", projectId: "p1" }, "TS").sectionEnteredAt, "TS");
eq("null/\"\"/undefined cuentan como «sin sección»", withSectionEnteredAt({ sectionId: null }, { sectionId: "" }, "TS"), { sectionId: null });
eq("un proyecto adicional (extraSections.x) no cuenta", withSectionEnteredAt({ "extraSections.p9": "s3" }, { sectionId: "s1" }, "TS"), { "extraSections.p9": "s3" });

// ------------------------------------------------------------ 2) tasks.js escribe sectionEnteredAt
await tasksData.moveTask("t1", "s2", 5, "p1", false, { projectId: "p1", sectionId: "s1" });
check("moveTask a otra sección anota sectionEnteredAt", updates.at(-1).fields.sectionEnteredAt === "TS" && updates.at(-1).fields.sectionId === "s2", updates.at(-1));
await tasksData.moveTask("t1", "s1", 7, "p1", false, { projectId: "p1", sectionId: "s1" });
check("moveTask dentro de la misma columna NO lo anota (solo reordena)", !("sectionEnteredAt" in updates.at(-1).fields) && updates.at(-1).fields.order === 7, updates.at(-1));
await tasksData.moveTask("t1", "s3", 1, "p9", true, { projectId: "p1", sectionId: "s1" });
check("moveTask en un proyecto adicional no lo anota", !("sectionEnteredAt" in updates.at(-1).fields) && updates.at(-1).fields["extraSections.p9"] === "s3", updates.at(-1));
await tasksData.moveTask("t1", "s2", 1, "p1", false);
check("moveTask sin `prev` lo anota siempre", updates.at(-1).fields.sectionEnteredAt === "TS");
await tasksData.updateTask("t1", { sectionId: "s2", title: "hola" }, { projectId: "p1", sectionId: "s2" });
check("updateTask con la misma sección (modal) no lo anota", !("sectionEnteredAt" in updates.at(-1).fields) && updates.at(-1).fields.title === "hola");
await tasksData.updateTask("t1", { sectionId: "s4" }, { projectId: "p1", sectionId: "s2" });
check("updateTask con otra sección lo anota", updates.at(-1).fields.sectionEnteredAt === "TS" && updates.at(-1).fields.updatedAt === "TS");
await tasksData.updateTask("t1", { title: "solo título" });
check("updateTask sin tocar la sección no lo anota", !("sectionEnteredAt" in updates.at(-1).fields));
check("el modal de tarea pasa lo que había al abrir (loadedPrimary) a updateTask", /\}, loadedPrimary\);/.test(read("js/components/task-modal.js")) && /loadedPrimary = \{ projectId/.test(read("js/components/task-modal.js")));
check("el tablero pasa la tarea a moveTask", /isExtraProject|task\.projectId !== project\.id, task\)/.test(read("js/views/board-view.js")) && /project\.id, task\.projectId !== project\.id, task\)/.test(read("js/views/board-view.js")));

// ------------------------------------------------------------ 3) flowEnteredAt y días hábiles
eq("flowEnteredAt: sectionEnteredAt manda", flowEnteredAt({ sectionEnteredAt: d("2026-10-26"), updatedAt: d("2026-10-30"), createdAt: d("2026-10-01") }).getDate(), 26);
eq("… sin él, updatedAt", flowEnteredAt({ updatedAt: d("2026-10-30"), createdAt: d("2026-10-01") }).getDate(), 30);
eq("… sin él, createdAt", flowEnteredAt({ createdAt: d("2026-10-01") }).getDate(), 1);
eq("… y sin nada, null (también con un sello pendiente = null)", [flowEnteredAt({}), flowEnteredAt({ sectionEnteredAt: null, updatedAt: null }), flowEnteredAt(null)], [null, null, null]);
eq("lunes → martes = 1 día hábil", workingDaysInSection(d("2026-10-26"), d("2026-10-27")), 1);
eq("el mismo día = 0", workingDaysInSection(d("2026-11-02"), NOW), 0);
eq("viernes → lunes siguiente = 1 (el fin de semana no cuenta)", workingDaysInSection(d("2026-10-30"), NOW), 1);
eq("miércoles 21 oct → lunes 2 nov = 8", workingDaysInSection(d("2026-10-21"), NOW), 8);
const cfg = { holidays: [{ id: "h", date: "2026-10-28", name: "Fiesta", scope: "local" }], absences: [] };
const holidayCfg = (await import("../js/work-calendar.js")).normalizeWorkCalendar(cfg);
eq("un festivo no cuenta como día hábil", workingDaysInSection(d("2026-10-26"), d("2026-10-29"), holidayCfg), workingDaysInSection(d("2026-10-26"), d("2026-10-29")) - 1);

// ------------------------------------------------------------ 4) flowHealth
const proj = (id, name, sections) => ({ id, name, color: "#336699", sections: sections.map(([sid, sname]) => ({ id: sid, name: sname })) });
const P1 = proj("p1", "Proyecto Uno", [["a", "Por hacer"], ["b", "En curso"]]);
const P2 = proj("p2", "Proyecto Dos", [["c", "En curso"]]);
const T = (id, o) => ({ id, title: id, projectId: "p1", sectionId: "a", assigneeIds: ["ana"], isComplete: false, createdAt: d("2026-09-01"), ...o });
const tasks = [
  T("viejaB", { sectionId: "b", sectionEnteredAt: d("2026-10-14") }),            // 13 días hábiles en «En curso»
  T("limite", { sectionId: "b", sectionEnteredAt: d("2026-10-22") }),            // justo 7: NO estancada
  T("pasa", { sectionId: "b", sectionEnteredAt: d("2026-10-21") }),              // 8: estancada
  T("p2", { projectId: "p2", sectionId: "c", sectionEnteredAt: d("2026-10-30") }), // 1, misma sección por nombre que «En curso»
  T("sinMover", { updatedAt: d("2026-10-27") }),                                 // sin sectionEnteredAt: usa updatedAt (4)
  T("soloCreada", { createdAt: d("2026-10-29") }),                                // sin updatedAt: usa createdAt (2)
  T("hecha", { isComplete: true, sectionEnteredAt: d("2026-09-01") }),            // completada: fuera
  T("hito", { isMilestone: true, sectionEnteredAt: d("2026-09-01") }),            // hito: fuera
  T("personal", { projectId: null, sectionEnteredAt: d("2026-09-01") }),          // sin proyecto: fuera
];
const h = flowHealth({ tasks: [...tasks, tasks[0]], projects: [P1, P2], now: NOW }); // la repetida no cuenta dos veces
eq("cuenta solo tareas abiertas de proyecto (sin hitos ni completadas ni duplicadas)", h.count, 6);
eq("el umbral es 7 días hábiles", [h.threshold, STAGNANT_WORKING_DAYS], [7, 7]);
eq("estancadas: más de 7 días hábiles, de más a menos", h.stagnant.map((r) => [r.task.id, r.days]), [["viejaB", 13], ["pasa", 8]]);
eq("la del límite (7) no está estancada", h.stagnant.some((r) => r.task.id === "limite"), false);
const enCurso = h.bySection.find((s) => s.key === "en curso");
eq("las secciones con el mismo nombre de proyectos distintos se agrupan", [enCurso.count, enCurso.stagnant, enCurso.avgDays], [4, 2, 7.3]);
eq("tiempo medio global (hábiles)", h.avgDays, Math.round(((13 + 7 + 8 + 1 + 4 + 2) / 6) * 10) / 10);
eq("se muestra primero la sección con más tiempo medio", h.bySection[0].name, "En curso");
eq("sección y proyecto en cada estancada", [h.stagnant[0].sectionName, h.stagnant[0].project.id], ["En curso", "p1"]);
eq("sin tareas: todo a cero y sin media", (({ count, avgDays, stagnant, bySection }) => [count, avgDays, stagnant.length, bySection.length])(flowHealth({ tasks: [], projects: [P1], now: NOW })), [0, null, 0, 0]);
eq("sin sección → «Sin sección»", flowHealth({ tasks: [T("x", { sectionId: null })], projects: [P1], now: NOW }).bySection[0].name, "Sin sección");

// ------------------------------------------------------------ 5) offerFunnel
const OFF = { id: "off", name: "Ofertas", exclusiveKey: OFFERS_KEY, color: "#aa3300", sections: [{ id: "n", name: "Nuevas" }, { id: "r", name: "Revisiones" }, { id: "e", name: "Entregadas" }, { id: "k", name: "Cerradas" }] };
const O = (id, o) => ({ id, title: id, projectId: "off", sectionId: "n", isComplete: false, createdAt: d("2026-10-01"), ...o });
const offers = [
  O("o1"), O("o2", { sectionId: "r" }),
  O("o3", { sectionId: "e", isComplete: true, completedAt: d("2026-10-11") }),                                 // 10 días
  O("o4", { sectionId: "k", isComplete: true, completedAt: d("2026-10-06"), convertedProjectId: "px", convertedAt: d("2026-10-16") }), // 5 / 15
  O("o5", { sectionId: "k", isComplete: true, completedAt: d("2026-10-03"), convertedProjectId: "py", convertedAt: d("2026-10-07") }), // 2 / 6
  O("o6", { sectionId: null }),
  { id: "ajena", title: "no es oferta", projectId: "p1", sectionId: "a", isComplete: false },
  { id: "extra", title: "oferta como proyecto adicional", projectId: "p1", extraProjectIds: ["off"], extraSections: { off: "r" }, isComplete: false },
];
const f = offerFunnel({ tasks: [...offers, offers[0]], offersProject: OFF });
eq("total y estados", [f.total, f.active, f.delivered, f.converted, f.resolved], [7, 4, 1, 2, 3]);
eq("conversión = convertidas / resueltas", f.conversionPct, 67);
eq("tiempo medio hasta entregar (incluye convertidas): (10 + 5 + 2) / 3", f.avgDeliveryDays, 5.7);
eq("tiempo medio hasta convertir: (15 + 6) / 2", f.avgConversionDays, 10.5);
eq("reparto por sección de Ofertas (+ «Sin sección» primero)", f.bySection.map((s) => [s.name, s.count]), [["Sin sección", 1], ["Nuevas", 1], ["Revisiones", 2], ["Entregadas", 1], ["Cerradas", 2]]);
eq("sin proyecto Ofertas: null", offerFunnel({ tasks: offers, offersProject: null }), null);
const f0 = offerFunnel({ tasks: [O("solo")], offersProject: OFF });
eq("sin ofertas resueltas: sin ratio ni tiempos", [f0.conversionPct, f0.avgDeliveryDays, f0.avgConversionDays], [null, null, null]);
eq("un completedAt anterior a createdAt (reloj) se ignora", offerFunnel({ tasks: [O("raro", { isComplete: true, completedAt: d("2026-09-01") })], offersProject: OFF }).avgDeliveryDays, null);

// ------------------------------------------------------------ 6) Métricas: quién entra y qué ve (jsdom)
const members = [
  { uid: "admin", name: "Admin", role: "admin" },
  { uid: "ana", name: "Ana", role: "member", department: "tecnicos", isDepartmentHead: true },
  { uid: "luis", name: "Luis", role: "member", department: "produccion" },
  { uid: "rev", name: "Rev", role: "revisor", department: "tecnicos" },
];
check("canViewMetrics: admin, Revisor y Responsable sí; trabajador normal y sin sesión no", canViewMetrics(members[0]) && canViewMetrics(members[3]) && canViewMetrics(members[1]) && !canViewMetrics(members[2]) && !canViewMetrics(null));
const mTasks = [
  T("mia-vieja", { sectionId: "b", sectionEnteredAt: d("2026-10-14"), assigneeIds: ["ana"], title: "Tarea de Ana" }),
  T("ajena-vieja", { sectionId: "b", sectionEnteredAt: d("2026-10-14"), assigneeIds: ["luis"], title: "Tarea de Luis" }),
  ...offers,
];
function renderMetrics(user, projects, extra = {}) {
  const c = document.createElement("div");
  const opened = [];
  renderMetricsView(c, { tasks: mTasks, teamMembers: members, projects, onOpenTask: (id) => opened.push(id), currentUser: user, departmentFilter: "", workCalendar: undefined, ...extra });
  return { c, opened };
}
let r = renderMetrics(members[0], [P1, P2, OFF]);
check("admin: ve «Salud del flujo» y «Embudo de ofertas»", !!r.c.querySelector("#metrics-flow-health") && !!r.c.querySelector("#metrics-offer-funnel"));
eq("admin: embudo con conversión 67 % y 7 ofertas", [r.c.querySelector('[data-funnel="pct"]').textContent, r.c.querySelector("#metrics-offer-funnel .metrics__section-count").textContent], ["67%", "7"]);
check("admin: las tareas estancadas de todos, clicables", r.c.querySelectorAll("#metrics-stagnant-list [data-open]").length >= 2);
r.c.querySelector('#metrics-stagnant-list [data-open="mia-vieja"]').click();
eq("un clic en una estancada abre la tarea", r.opened, ["mia-vieja"]);
r = renderMetrics(members[1], [P1, P2]); // Responsable de Técnicos, sin acceso a Ofertas (no está entre sus proyectos visibles)
check("Responsable sin Ofertas visible: no ve el embudo, sí la salud del flujo", !r.c.querySelector("#metrics-offer-funnel") && !!r.c.querySelector("#metrics-flow-health"));
check("Responsable: solo las estancadas de su departamento (Ana sí, Luis no)", !!r.c.querySelector('[data-open="mia-vieja"]') && !r.c.querySelector('[data-open="ajena-vieja"]'));
r = renderMetrics(members[1], [P1, P2, OFF]);
check("Responsable con Ofertas visible: ve el embudo", !!r.c.querySelector("#metrics-offer-funnel"));
check("el panel de salud del flujo explica el umbral de 7 días hábiles", /más de 7 días hábiles/.test(renderMetrics(members[0], [P1]).c.textContent));
check("Métricas ya no exige solo admin/Revisor en app.js ni en la barra lateral", /canViewMetrics\(currentUser\)/.test(read("js/app.js")) && /canViewMetrics\(userProfile\)/.test(read("js/components/sidebar.js")));

// ------------------------------------------------------------ 7) helpers de ruta
eq("normalizeRoot: quita comillas y barra final", loc.normalizeRoot('"Z:\\Proyectos\\"'), "Z:\\Proyectos");
eq("normalizeRoot: una unidad conserva su barra", loc.normalizeRoot("Z:\\"), "Z:\\");
eq("normalizeRoot: una red", loc.normalizeRoot("\\\\Servidor\\Compartido\\Ofertas\\"), "\\\\Servidor\\Compartido\\Ofertas");
eq("normalizeRoot: web, relativa y vacía no valen", [loc.normalizeRoot("https://x.sharepoint.com/a"), loc.normalizeRoot("Proyectos"), loc.normalizeRoot("")], ["", "", ""]);
eq("parentFolderOf: unidad, red, raíz de unidad", [loc.parentFolderOf("Z:\\Proyectos\\26001 - Cabina"), loc.parentFolderOf("\\\\srv\\Ofertas\\26001 - X"), loc.parentFolderOf("Z:\\26001 - X")], ["Z:\\Proyectos", "\\\\srv\\Ofertas", "Z:\\"]);
eq("parentFolderOf: sin padre aprovechable / no carpeta", [loc.parentFolderOf("\\\\srv\\recurso"), loc.parentFolderOf("https://a.b/c"), loc.parentFolderOf("")], ["", "", ""]);
eq("joinPath respeta la barra de la raíz", [loc.joinPath("Z:\\Proyectos", "26001 - A"), loc.joinPath("Z:\\", "26001 - A"), loc.joinPath("\\\\s\\r\\", "x")], ["Z:\\Proyectos\\26001 - A", "Z:\\26001 - A", "\\\\s\\r\\x"]);
eq("suggestedLocation: RutaRaíz\\YYXXX - Nombre, sin caracteres que Windows no admite", loc.suggestedLocation("Z:\\Proyectos", "26001", "Cabina: fase 2?"), "Z:\\Proyectos\\26001 - Cabina_ fase 2_");
eq("… sin duplicar el ID si el nombre ya lo trae", loc.suggestedLocation("Z:\\P", "26001", "26001 - Cabina"), "Z:\\P\\26001 - Cabina");
eq("… sin raíz, sin ID o sin nombre: nada", [loc.suggestedLocation("", "26001", "A"), loc.suggestedLocation("Z:\\P", "", "A"), loc.suggestedLocation("Z:\\P", "26001", "  ")], ["", "", ""]);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
let st = mem();
eq("sin nada recordado: ''", loc.getRememberedRoot(st), "");
eq("rememberRootFromLocation deduce la carpeta padre", [loc.rememberRootFromLocation("Z:\\Ofertas\\26001 - A", st), loc.getRememberedRoot(st)], ["Z:\\Ofertas", "Z:\\Ofertas"]);
eq("la raíz escrita a mano manda sobre la deducida", [loc.setRememberedRoot("\\\\srv\\Comp\\Ofertas", st), loc.getRememberedRoot(st)], ["\\\\srv\\Comp\\Ofertas", "\\\\srv\\Comp\\Ofertas"]);
loc.setRememberedRoot("", st);
eq("borrarla vuelve a la deducida", loc.getRememberedRoot(st), "Z:\\Ofertas");
eq("una raíz inválida no se guarda", [loc.setRememberedRoot("texto", st), loc.getRememberedRoot(st)], ["", "Z:\\Ofertas"]);
eq("un almacenamiento que falla no rompe nada", [loc.getRememberedRoot({ getItem() { throw new Error("x"); } }), loc.setRememberedRoot("Z:\\A", { setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } })], ["", "Z:\\A"]);

// ------------------------------------------------------------ 8) botón «Asignar carpeta sugerida» (jsdom, localStorage real de jsdom)
localStorage.clear();
const input = document.createElement("input");
document.body.append(input);
let code = "26001", name = "Cabina nueva";
const ctl = createSuggestLocationControls({ input, getCode: () => code, getName: () => name });
const assignBtn = ctl.el.querySelector(".suggest-location__assign"), rootBtn = ctl.el.querySelector(".suggest-location__root");
check("sin ruta raíz: solo «Definir ruta raíz…»", assignBtn.hidden && !rootBtn.hidden && /Definir ruta ra/.test(rootBtn.textContent));
const events = [];
input.addEventListener("input", () => events.push("input")); input.addEventListener("change", () => events.push("change"));
window.prompt = () => "Z:\\Proyectos";
rootBtn.click();
eq("tras definir la raíz aparece el botón con la carpeta completa", [assignBtn.hidden, assignBtn.textContent], [false, "Asignar carpeta sugerida: Z:\\Proyectos\\26001 - Cabina nueva"]);
name = "Cabina nueva v2"; ctl.refresh();
eq("sigue al nombre", assignBtn.textContent, "Asignar carpeta sugerida: Z:\\Proyectos\\26001 - Cabina nueva v2");
assignBtn.click();
eq("un clic rellena la casilla y avisa con input + change (para que se guarde como siempre)", [input.value, events], ["Z:\\Proyectos\\26001 - Cabina nueva v2", ["input", "change"]]);
check("con la casilla rellena el botón desaparece", ctl.el.hidden);
input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
check("vaciada otra vez, vuelve a ofrecerse", !assignBtn.hidden);
code = ""; ctl.refresh();
check("sin ID no se ofrece nada", ctl.el.hidden);
code = "26001"; localStorage.clear(); input.value = "\\\\srv\\Ofer\\26001 - X"; input.dispatchEvent(new Event("change", { bubbles: true }));
eq("al escribir una ubicación se recuerda su carpeta padre", loc.getRememberedRoot(), "\\\\srv\\Ofer");
const openSrc = read("js/components/open-location.js");
check("abrir una ubicación también recuerda la carpeta padre", /rememberRootFromLocation\(location\.value\)/.test(openSrc));
check("ambos formularios montan los controles (oferta y Propiedades de proyecto)", /createSuggestLocationControls\(\{ input: locationInput/.test(read("js/components/task-modal.js")) && /createSuggestLocationControls\(\{ input: ubicacionInput/.test(read("js/components/project-properties-modal.js")));

// ------------------------------------------------------------ 9) script de Windows (texto) y LEEME
const ps = read("assets/abrir-ubicacion/abrir-ubicacion.ps1");
const readme = read("assets/abrir-ubicacion/LEEME.txt");
check("el script sigue siendo ASCII (PowerShell 5 sin BOM)", [...ps].every((ch) => ch.charCodeAt(0) < 128) && [...readme].every((ch) => ch.charCodeAt(0) < 128));
check("pregunta con Si/No (YesNo) y por defecto «No» (Button2)", /MessageBoxButtons\]::YesNo/.test(ps) && /Button2/.test(ps));
check("crea con New-Item -ItemType Directory y luego abre con explorer.exe", /New-Item -ItemType Directory -Path \$path/.test(ps) && /Start-Process -FilePath 'explorer\.exe'/.test(ps));
check("solo ofrece crear si existe la carpeta padre y el nombre es «YYXXX - Nombre»", /Test-Path -LiteralPath \$parent -PathType Container/.test(ps) && /\$leaf -match '\^\\d\{5,\}\\s\*-\\s\*\\S'/.test(ps));
check("retrocompatible: sigue avisando si no se encuentra la carpeta, y el parámetro y el protocolo no cambian", /No se encuentra la carpeta/.test(ps) && /param\(\[string\]\$Url\)/.test(ps) && /chusy-open:/.test(ps));
check("el texto del aviso es el pedido (con ¿ y í por [char])", /0x00BF/.test(ps) && /no existe todav' \+ \[char\]0x00ED/.test(ps) && /Deseas crearla ahora y abrirla\?/.test(ps));
check("el LEEME explica la novedad y que lo antiguo sigue funcionando", /v81/.test(readme) && /Si ya lo tenias instalado/.test(readme));
check("el instalador no cambia (mismo protocolo y comando)", /reg add "%KEY%\\shell\\open\\command"/.test(read("assets/abrir-ubicacion/Instalar-AbrirUbicacion.bat")));

// ------------------------------------------------------------ 10) reglas de Firestore
const rules = read("firestore.rules");
check("reglas: isDepartmentHead no se puede cambiar al actualizar la propia cuenta ni crear con true", /request\.resource\.data\.get\('isDepartmentHead', false\) == resource\.data\.get\('isDepartmentHead', false\)/.test(rules) && /request\.resource\.data\.get\('isDepartmentHead', false\) == false/.test(rules));
check("canViewWorkload (comprobación cruzada)", canViewWorkload(members[1]) && !canViewWorkload(members[3]));
await tick();
done("v81 · flujo pasivo, embudo de ofertas, Responsables y puente local");
