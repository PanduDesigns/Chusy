// v82 — IDs YYXXX (antes XXXYY) y su migración, limpieza de festivos obsoletos (Lunes de Pascua sin decreto),
// carpetas de Drive con la clave antigua, y el CSS/HTML de los dos retoques visuales + cache-busting por módulo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom } from "./support/dom.mjs";

setupDom();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const pc = await import("../js/project-codes.js");

// ------------------------------------------------------------ 1) formato
eq("formatProjectCode: YY primero, XXX con ceros", [pc.formatProjectCode(1, 2026), pc.formatProjectCode(0, 2026), pc.formatProjectCode(14, 26), pc.formatProjectCode(999, 2026)], ["26001", "26000", "26014", "26999"]);
eq("pasa de 999 sin truncar (gana una cifra)", pc.formatProjectCode(1000, 2026), "261000");
eq("un año nuevo reinicia el número de orden: 27000, 27001", [pc.formatProjectCode(0, 2027), pc.formatProjectCode(1, 2027)], ["27000", "27001"]);
check("ordenar alfabéticamente = cronológico (año y después orden)", ["27001", "26999", "26002", "26001"].sort().join() === "26001,26002,26999,27001");
eq("parseProjectCode: año 2000+YY y seq", [pc.parseProjectCode("26001"), pc.parseProjectCode("27014"), pc.parseProjectCode("261000")], [{ seq: 1, year: 2026 }, { seq: 14, year: 2027 }, { seq: 1000, year: 2026 }]);
eq("parseProjectCode rechaza lo que no es YYXXX (incluido un XXXYY antiguo)", [pc.parseProjectCode("00126"), pc.parseProjectCode("2601"), pc.parseProjectCode("abc12"), pc.parseProjectCode("")], [null, null, null, null]);
check("isProjectCode", pc.isProjectCode("26001") && !pc.isProjectCode("00126"));
let threw = false; try { pc.formatProjectCode(-1, 2026); } catch (e) { threw = e instanceof RangeError; }
check("formatProjectCode rechaza un número negativo", threw);

// ------------------------------------------------------------ 2) conversión del formato antiguo
eq("00126 → 26001 y 01426 → 26014 (ejemplos del pedido)", [pc.convertLegacyCodeToYYXXX("00126"), pc.convertLegacyCodeToYYXXX("01426")], ["26001", "26014"]);
eq("00026 → 26000 (el primero del año conserva su número 000)", pc.convertLegacyCodeToYYXXX("00026"), "26000");
eq("terminado en 25 también se reconoce", pc.convertLegacyCodeToYYXXX("00125"), "26001");
eq("un YYXXX ya nuevo (o cualquier otra cosa) no se toca", [pc.convertLegacyCodeToYYXXX("26001"), pc.convertLegacyCodeToYYXXX("26026"), pc.convertLegacyCodeToYYXXX("ABC"), pc.convertLegacyCodeToYYXXX("")], ["26001", "26026", "ABC", ""]);
eq("isLegacyCode: 26026 se trata como nuevo; 02626 como antiguo", [pc.isLegacyCode("26026"), pc.isLegacyCode("02626"), pc.isLegacyCode("10026")], [false, true, true]);
eq("en 2027 un YYXXX de 2027 que acaba en 26 NO se confunde con uno antiguo", [pc.isLegacyCode("27026", 27), pc.convertLegacyCodeToYYXXX("27026", 27)], [false, "27026"]);
eq("legacyCodeOf: el inverso", [pc.legacyCodeOf("26001"), pc.legacyCodeOf("26014"), pc.legacyCodeOf("26000"), pc.legacyCodeOf("261000"), pc.legacyCodeOf("00126")], ["00126", "01426", "00026", "", ""]);

// ------------------------------------------------------------ 3) nombres con ID
eq("codedName pone el ID delante", pc.codedName("26001", "Cliente"), "26001 - Cliente");
eq("codedName reemplaza el prefijo ANTIGUO, nunca lo duplica", [pc.codedName("26001", "00126 - Cliente"), pc.codedName("26001", "[00126] Cliente"), pc.codedName("26001", "00126 - 00126 - Cliente"), pc.codedName("26001", "26001 - 00126 - Cliente")], Array(4).fill("26001 - Cliente"));
eq("codedName con el prefijo nuevo ya puesto no lo repite", [pc.codedName("26001", "26001 - Cliente"), pc.codedName("26001", "26001-Cliente"), pc.codedName("26001", "(26001): Cliente")], Array(3).fill("26001 - Cliente"));
eq("otro número pegado no cuenta como el ID", pc.codedName("26001", "260012 Cliente"), "26001 - 260012 Cliente");
eq("sin nombre queda el ID; sin ID, el nombre", [pc.codedName("26001", ""), pc.codedName("", "Cliente")], ["26001", "Cliente"]);
eq("hasCodePrefix es estricto con el ID actual; hasLegacyCodePrefix detecta el viejo", [pc.hasCodePrefix("26001 - X", "26001"), pc.hasCodePrefix("00126 - X", "26001"), pc.hasLegacyCodePrefix("00126 - X", "26001"), pc.hasLegacyCodePrefix("26001 - X", "26001")], [true, false, true, false]);
eq("migrateNameText: solo si había prefijo antiguo", [pc.migrateNameText("00126 - Cliente", "00126", "26001"), pc.migrateNameText("Cliente", "00126", "26001")], ["26001 - Cliente", "Cliente"]);
eq("migrateLocationText: última carpeta, con \\ o /, red y barra final", [
  pc.migrateLocationText("Z:\\Proyectos\\00126 - Cliente", "00126", "26001"),
  pc.migrateLocationText("\\\\srv\\Ofertas\\00126 - X\\", "00126", "26001"),
  pc.migrateLocationText("Z:/a/00126 Cabina", "00126", "26001"),
  pc.migrateLocationText("Z:\\Otro\\Cliente", "00126", "26001"),
  pc.migrateLocationText("https://x.com/00126 - y", "00126", "26001"),
], ["Z:\\Proyectos\\26001 - Cliente", "\\\\srv\\Ofertas\\26001 - X\\", "Z:/a/26001 - Cabina", "Z:\\Otro\\Cliente", "https://x.com/00126 - y"]);

// ------------------------------------------------------------ 4) el plan de migración
const fixture = () => ({
  projects: [
    { id: "P1", code: "00126", name: "00126 - Cliente", driveFolderId: "F1", properties: { ubicacion: "Z:\\P\\00126 - Cliente" } },
    { id: "P2", code: "26005", name: "Ya nuevo" },
    { id: "P3", code: "00026", name: "Sin prefijo" },
    { id: "PX", exclusive: true },
  ],
  offers: [
    { id: "T1", offerCode: "00126", title: "00126 - Cliente", driveFolderId: "F1", customFields: { ubi: "Z:\\P\\00126 - Cliente" } },
    { id: "T2", offerCode: "01426", title: "Cabina", driveFolderId: "F2" },
    { id: "T3", offerCode: "26007", title: "Ya nueva" },
  ],
  trash: [
    { id: "R1", kind: "task", title: "00226 - Z", task: { offerCode: "00226", title: "00226 - Z", customFields: { ubi: "Y:\\00226 - Z" } } },
    { id: "R2", kind: "project", title: "P", project: { code: "00326", name: "00326 - P", properties: { ubicacion: "Q:\\00326 - P" } } },
    { id: "R3", kind: "task", title: "sin código", task: { title: "sin código" } },
  ],
  locationFieldId: "ubi",
});
const plan = pc.planLegacyCodeMigration(fixture());
eq("proyectos: code, name y ubicación; solo los antiguos", plan.projects, [
  { id: "P1", fields: { code: "26001", name: "26001 - Cliente", "properties.ubicacion": "Z:\\P\\26001 - Cliente" } },
  { id: "P3", fields: { code: "26000" } },
]);
eq("ofertas: offerCode, title y campo Ubicación (ruta con punto → campo anidado)", plan.offers, [
  { id: "T1", fields: { offerCode: "26001", title: "26001 - Cliente", "customFields.ubi": "Z:\\P\\26001 - Cliente" } },
  { id: "T2", fields: { offerCode: "26014" } },
]);
eq("papelera: la copia de la tarea / del proyecto y su título", plan.trash, [
  { id: "R1", fields: { "task.offerCode": "26002", "task.title": "26002 - Z", "task.customFields.ubi": "Y:\\26002 - Z", title: "26002 - Z" } },
  { id: "R2", fields: { "project.code": "26003", "project.name": "26003 - P", "project.properties.ubicacion": "Q:\\26003 - P" } },
]);
eq("Drive: una carpeta por ID, con el nombre del proyecto si lo hay (la oferta convertida comparte carpeta)", plan.folders.map((f) => [f.code, f.folderId, f.kind, f.name]).sort(), [["26001", "F1", "project", "26001 - Cliente"], ["26014", "F2", "offer", "Cabina"]]);
// idempotente: aplicar el plan y repetirlo no genera nada
const applied = fixture();
const apply = (docs, updates) => updates.forEach((u) => { const d = docs.find((x) => x.id === u.id); Object.entries(u.fields).forEach(([k, v]) => { const ks = k.split("."); let o = d; ks.slice(0, -1).forEach((x) => { o = o[x]; }); o[ks.at(-1)] = v; }); });
apply(applied.projects, plan.projects); apply(applied.offers, plan.offers); apply(applied.trash, plan.trash);
const again = pc.planLegacyCodeMigration(applied);
eq("repetir la migración sobre lo ya migrado no cambia nada", [again.projects.length, again.offers.length, again.trash.length, again.folders.length], [0, 0, 0, 0]);
// conflicto: el ID nuevo ya existe en otro documento
const clash = pc.planLegacyCodeMigration({ projects: [{ id: "A", code: "00126", name: "A" }, { id: "B", code: "26001", name: "B" }] });
eq("si el ID nuevo ya lo lleva otro, no se pisa (conflicto)", [clash.projects.length, clash.conflicts.map((c) => c.id)], [0, ["A"]]);
const twoLegacy = pc.planLegacyCodeMigration({ projects: [{ id: "A", code: "00126" }, { id: "B", code: "00125" }] });
eq("dos antiguos distintos que darían el mismo nuevo: el primero gana, el otro es conflicto", [twoLegacy.projects.map((p) => p.id), twoLegacy.conflicts.map((c) => c.id)], [["A"], ["B"]]);

// ------------------------------------------------------------ 5) el ejecutor contra Firestore (falso)
const dm = await import("../js/data/project-codes.js");
const fb = (globalThis.__fb = globalThis.__fb || { collections: {}, sets: [] });
const asDocs = (list) => ({ docs: list.map((d) => ({ id: d.id, data: () => { const { id, ...rest } = d; return rest; } })) });
function setup({ marked = false, counterExists = true, data = fixture() } = {}) {
  const log = { updates: [], setDocs: [], counterUpdates: [], counterReads: 0 };
  fb.updates = [];
  fb.hooks = {
    getDoc: async (ref) => { log.counterReads++; return { exists: () => counterExists, data: () => ({ next: 15, ...(marked ? { formatVersion: "YYXXX" } : {}) }) }; },
    getDocs: async (ref) => {
      const p = ref.path || (ref.args && ref.args[0] && ref.args[0].path);
      if (p === "projects") return asDocs(data.projects);
      if (p === "trash") return asDocs(data.trash);
      if (p === "tasks") return ref.args && ref.args[1] && ref.args[1].args && ref.args[1].args[0] === "projectId" ? asDocs(data.offers) : { docs: [] };
      return { docs: [] };
    },
    updateDoc: async (ref, fields) => { log.counterUpdates.push({ path: ref.path, fields }); },
    setDoc: async (ref, d) => { log.setDocs.push({ path: ref.path, d }); },
  };
  return log;
}
const offersProject = { id: "OF", exclusiveKey: "ofertas", customFieldDefs: [{ id: "ubi", name: "Ubicación" }] };
const loc = await import("../js/offers.js");
check("(el campo Ubicación de Ofertas se localiza por nombre)", !!loc.findOfferLocationField && (loc.findOfferLocationField(offersProject) || {}).id === "ubi", loc.findOfferLocationField(offersProject));

let log = setup();
const renamed = [];
const res = await dm.migrateLegacyCodesToYYXXX({ offersProject, now: new Date("2026-10-29"), rename: async (a) => { renamed.push(a); return { status: "renamed" }; } });
eq("migra proyectos, ofertas y papelera", [res.skipped, res.projects, res.offers, res.trash, res.conflicts, res.marked], [false, 2, 2, 2, 0, true]);
const paths = fb.updates.map((u) => u.ref.path);
eq("escribe en projects/, tasks/ y trash/ por su id", paths, ["projects/P1", "projects/P3", "tasks/T1", "tasks/T2", "trash/R1", "trash/R2"]);
eq("marca meta/projectCounter con formatVersion sin mover el contador", log.counterUpdates, [{ path: "meta/projectCounter", fields: { next: 15, formatVersion: "YYXXX" } }]);
await res.drive;
eq("renombra las carpetas de Drive en segundo plano con el ID y nombre nuevos", renamed.map((r) => [r.code, r.name, r.folderId]).sort(), [["26001", "26001 - Cliente", "F1"], ["26014", "Cabina", "F2"]]);

log = setup({ marked: true });
const res2 = await dm.migrateLegacyCodesToYYXXX({ offersProject, now: new Date("2026-10-29") });
eq("con la marca puesta no hace nada (solo lee el contador)", [res2.skipped, fb.updates.length, log.counterReads, log.counterUpdates.length], [true, 0, 1, 0]);

log = setup({ counterExists: false, data: { projects: [], offers: [], trash: [] } });
const res3 = await dm.migrateLegacyCodesToYYXXX({ offersProject, now: new Date("2026-10-29") });
eq("sin contador ni nada que migrar: lo crea ya marcado con next 0", [res3.marked, log.setDocs], [true, [{ path: "meta/projectCounter", d: { next: 0, formatVersion: "YYXXX" } }]]);

const conflictData = fixture(); conflictData.projects.push({ id: "P9", code: "26001", name: "choca" });
log = setup({ data: conflictData });
const res4 = await dm.migrateLegacyCodesToYYXXX({ offersProject, now: new Date("2026-10-29") });
check("con un conflicto no se marca (se reintentará) y se migra el resto", res4.conflicts >= 1 && !res4.marked && log.counterUpdates.length === 0, res4);

fb.hooks = undefined;

// ------------------------------------------------------------ 6) Lunes de Pascua
const wc = await import("../js/work-calendar.js");
const cal = wc.normalizeWorkCalendar({ holidays: [
  { id: "a", date: "2026-04-06", name: "Lunes de Pascua", scope: "autonomico" },
  { id: "b", date: "2027-03-29", name: "Lunes de Pascua (estimado)", scope: "autonomico" },
  { id: "clm-easter-monday-2028", date: "2028-04-17", name: "Pascua", scope: "autonomico" },
  { id: "d", date: "2027-03-29", name: "Lunes de Pascua", scope: "local" },
  { id: "e", date: "2026-01-01", name: "Año Nuevo", scope: "nacional" },
] });
const cleaned = wc.removeObsoleteHolidays(cal);
eq("quita los Lunes de Pascua de CLM sin decreto (también por id clm-easter-monday-*)", [cleaned.removed, cleaned.cfg.holidays.map((h) => h.id).sort()], [2, ["a", "d", "e"]]);
check("conserva el 06/04/2026 (Decreto 44/2025) y uno que sea de empresa/local", cleaned.cfg.holidays.some((h) => h.id === "a") && cleaned.cfg.holidays.some((h) => h.id === "d"));
check("es idempotente y devuelve el mismo objeto si no hay nada que quitar", wc.removeObsoleteHolidays(cleaned.cfg).removed === 0 && wc.removeObsoleteHolidays(cleaned.cfg).cfg === cleaned.cfg);
const merged = wc.mergeHolidays(cleaned.cfg, wc.officialHolidaysForSeed());
check("cargar festivos oficiales tras limpiar no reintroduce el Lunes de Pascua de 2027", !merged.cfg?.holidays?.some?.((h) => h.date === "2027-03-29" && /Pascua/.test(h.name) && h.scope === "autonomico") && !(merged.holidays || []).some((h) => h.date === "2027-03-29" && /Pascua/.test(h.name) && h.scope === "autonomico"));
const modalSrc = read("js/components/work-calendar-modal.js");
check("el modal limpia al abrir (solo admin) y antes de «Cargar festivos oficiales»", /removeObsoleteHolidays\(cfg\)/.test(modalSrc) && /cleaned = removeObsoleteHolidays\(base\)/.test(modalSrc) && /isAdmin/.test(modalSrc));

// ------------------------------------------------------------ 7) Drive: carpeta con la clave antigua
const { createDriveStorage } = await import("../js/drive-storage.js");
const GATEWAY = "https://script.google.com/macros/s/AKfycbTEST/exec";
const folders = { OLD: { id: "OLD", name: "00126 - Cliente", parents: ["ROOT"], mimeType: "application/vnd.google-apps.folder", appProperties: { folder: "c:00126" } } };
const patches = [];
const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
const fakeFetch = async (url, init = {}) => {
  if (url === GATEWAY) return json({ ok: true, token: "tok", carpetaId: "ROOT", expiraEnSegundos: 3000 });
  const u = new URL(url);
  if (init.method === "PATCH") { const id = decodeURIComponent(u.pathname.split("/").pop()); const body = JSON.parse(init.body); patches.push({ id, body }); Object.assign(folders[id], body.name ? { name: body.name } : {}, body.appProperties ? { appProperties: { ...folders[id].appProperties, ...body.appProperties } } : {}); return json(folders[id]); }
  if (u.pathname.includes("/files/")) { const f = folders[decodeURIComponent(u.pathname.split("/").pop())]; return f ? json(f) : { ok: false, status: 404, text: async () => "" }; }
  const q = decodeURIComponent(u.searchParams.get("q") || "");
  const key = (q.match(/value='([^']+)'/) || [])[1];
  return json({ files: Object.values(folders).filter((f) => f.appProperties.folder === key) });
};
const drive = createDriveStorage({ getConfig: () => ({ enabled: true, gatewayUrl: GATEWAY }), getIdToken: async () => "id", fetchFn: fakeFetch, sleep: async () => {} });
const r1 = await drive.renameCodeFolder({ code: "26001", name: "Cliente", folderId: "OLD" });
eq("una carpeta con la clave antigua se reconoce por la pista y se renombra", [r1.folderId, r1.renamed, folders.OLD.name], ["OLD", true, "26001 - Cliente"]);
eq("…y se le pone la clave nueva en el mismo PATCH (nada de carpetas duplicadas)", [patches.length, patches[0].body, folders.OLD.appProperties.folder], [1, { name: "26001 - Cliente", appProperties: { folder: "c:26001" } }, "c:26001"]);
const r2 = await drive.renameCodeFolder({ code: "26001", name: "Cliente", folderId: "OLD" });
eq("ya al día: no vuelve a tocar nada", [r2.renamed, patches.length], [false, 1]);
folders.OLD2 = { id: "OLD2", name: "01426 - Cabina", parents: ["ROOT"], mimeType: "application/vnd.google-apps.folder", appProperties: { folder: "c:01426" } };
const r3 = await drive.renameCodeFolder({ code: "26014", name: "Cabina" }); // sin pista: se busca por la clave antigua
eq("sin pista, la encuentra buscando la clave antigua", [r3.folderId, folders.OLD2.name, folders.OLD2.appProperties.folder], ["OLD2", "26014 - Cabina", "c:26014"]);

// ------------------------------------------------------------ 8) CSS / HTML
const css = read("css/07-modals.css");
const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`)); return m ? m[1] : ""; };
const preview = rule(".modal__title-preview");
check("`.modal__title-preview`: sin margen negativo y con margin: 0", !/margin[^;]*-\d/.test(preview) && /margin:\s*0\s*;/.test(preview), preview);
check("ningún margin negativo en las reglas del título del modal", !/\.modal__title-preview[^{]*\{[^}]*margin[^;}]*-\d/.test(css));
const ta = rule("textarea.modal__title-input");
check("el título no se redimensiona a mano ni muestra scroll: resize none + overflow hidden, sin max-height", /resize:\s*none/.test(ta) && /overflow:\s*hidden/.test(ta) && !/max-height/.test(ta), ta);
check("la cabecera multilínea alinea arriba (flex-start) con check y B ajustados a la primera línea", /\.modal__header--multiline\s*\{\s*align-items:\s*flex-start/.test(css) && /task-row__check\s*\{\s*margin-top:\s*7px/.test(css) && /modal__title-bold-btn\s*\{\s*margin-top:\s*2\.5px/.test(css));
check("la línea divisoria es una sola (la lleva .modal__head; la cabecera interior no)", /\.modal__head\s*\{\s*border-bottom:/.test(css) && /\.modal__head > \.modal__header\s*\{\s*border-bottom:\s*none/.test(css));
check("`.wc-list` está definida UNA sola vez", (css.match(/(?:^|\n)\.wc-list\s*\{/g) || []).length === 1);
const wl = rule(".wc-list");
check("`.wc-list`: max-height 260px, overflow-y scroll, overflow-x hidden, overscroll contain, gutter estable, scrollbar fina", /max-height:\s*260px/.test(wl) && /overflow-y:\s*scroll/.test(wl) && /overflow-x:\s*hidden/.test(wl) && /overscroll-behavior:\s*contain/.test(wl) && /scrollbar-gutter:\s*stable/.test(wl) && /scrollbar-width:\s*thin/.test(wl), wl);
check("`.wc-list` pinta su barra en WebKit (ancho 8px, pista, pulgar redondeado visible)", /\.wc-list::-webkit-scrollbar\s*\{\s*width:\s*8px/.test(css) && /\.wc-list::-webkit-scrollbar-track/.test(css) && /\.wc-list::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*4px/.test(css));
const html = read("index.html");
const mods = fs.readdirSync(path.join(root, "css")).filter((f) => /^\d\d-.*\.css$/.test(f)).sort();
const links = [...html.matchAll(/<link rel="stylesheet" href="css\/([^"?]+)\?v=(\d+)"/g)];
eq("index.html: un <link> por módulo CSS, en orden", links.map((m) => m[1]), mods);
check("…todos con el mismo ?v= y coincide con la versión del paquete", new Set(links.map((m) => m[2])).size === 1 && links[0][2] === String(JSON.parse(read("package.json")).version).split(".")[0], links.map((m) => m[2]));
check("index.html ya no enlaza css/styles.css con un <link>", !/<link[^>]+css\/styles\.css/.test(html));
const rules = read("firestore.rules");
check("firestore.rules: la marca formatVersion en projectCounter solo la pone un admin sin mover el contador", /formatVersion == 'YYXXX'/.test(rules) && /isAdmin\(\) &&\s*request\.resource\.data\.next == resource\.data\.next/.test(rules));
check("firestore.rules: la Papelera solo se edita por un admin y solo task/project/title", /affectedKeys\(\)\.hasOnly\(\['task', 'project', 'title'\]\)/.test(rules));

done("v82 · IDs YYXXX, migración, Lunes de Pascua, Drive y CSS");
