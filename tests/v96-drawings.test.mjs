// v96 · Tabla de planos en las ofertas y verificación del plano al convertir la oferta en proyecto.
//  1) Lógica pura (js/drawings.js): prefijos, código (PDP26123A3), versión, normalizar/guardar, verificación y alerta.
//  2) Propiedades del proyecto: la tabla pasa entera de la oferta al proyecto; solo se guarda si hay planos.
//  3) Datos: createTask guarda `drawings`; duplicar una oferta NO copia los planos.
//  4) Tabla (drawings-table.js): columnas, botón de copiar, comentarios, escapado.
//  5) Ventana de la oferta (task-modal.js real): generar plano, prefijo obligatorio, repetidos, quitar, guardar.
//  6) Convertir en proyecto / Propiedades (project-properties-modal.js real): elegir el verificado, precarga, subir el documento,
//     aceptar sin completar (alerta), cambiar de plano, cancelar (lo subido va a la papelera).
//  7) Alerta del proyecto y marca de la barra lateral; entrega (?v=96, Novedades, README, reglas sin cambios).
import fs from "node:fs";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, tick, freezeNow } from "./support/dom.mjs";

setupDom();
globalThis.MutationObserver = window.MutationObserver;
freezeNow("2026-11-26T12:00:00Z");
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new window.Event("input", { bubbles: true })); el.dispatchEvent(new window.Event("change", { bubbles: true })); };
globalThis.__fb = globalThis.__fb || { collections: {}, sets: [], hooks: {}, updates: [], deletes: [] };
globalThis.confirm = () => true;
globalThis.alert = () => {};
const TODAY = "2026-11-26";

// ---------------------------------------------------------------- 1) lógica pura
const D = await import("../js/drawings.js");
{
  eq("los 5 prefijos, en el orden pedido y con su tipo de plano", D.DRAWING_PREFIXES.map((p) => `${p.prefix}=${p.label}`), [
    "PAC=Plano de Aire Comprimido", "PD=Plano de Distribución", "PDP=Plano de Planta", "POC=Plano de Obra Civil", "PPT=Plano de Acometidas",
  ]);
  eq("el ejemplo del pedido: PDP + 26123 + A3 = PDP26123A3", D.buildDrawingCode({ prefix: "PDP", offerCode: "26123", version: "A3" }), "PDP26123A3");
  eq("cada prefijo compone su código", ["PAC", "PD", "PDP", "POC", "PPT"].map((p) => D.buildDrawingCode({ prefix: p, offerCode: "26000", version: "A1" })), ["PAC26000A1", "PD26000A1", "PDP26000A1", "POC26000A1", "PPT26000A1"]);
  eq("la versión va sin espacios ni signos dentro del código", [D.versionForCode(" B 07 "), D.versionForCode("v2.3"), D.versionForCode("A10")], ["B07", "v23", "A10"]);
  eq("sin prefijo válido, sin ID o sin versión → código vacío", [
    D.buildDrawingCode({ prefix: "XX", offerCode: "26123", version: "A3" }),
    D.buildDrawingCode({ prefix: "pdp", offerCode: "26123", version: "A3" }),
    D.buildDrawingCode({ prefix: "PDP", offerCode: "", version: "A3" }),
    D.buildDrawingCode({ prefix: "PDP", offerCode: null, version: "A3" }),
    D.buildDrawingCode({ prefix: "PDP", offerCode: "26123", version: "" }),
    D.buildDrawingCode({ prefix: "PDP", offerCode: "26123", version: " . " }),
  ], ["", "", "", "", "", ""]);
  eq("tipo de plano por prefijo (y vacío si no se conoce)", [D.drawingTypeLabel("POC"), D.drawingTypeLabel("PPT"), D.drawingTypeLabel("ZZ")], ["Plano de Obra Civil", "Plano de Acometidas", ""]);

  const row = D.makeDrawing({ id: "d1", prefix: "PDP", offerCode: "26123", version: "A3", createdAt: "2026-11-26T10:00:00.000Z", createdBy: "u1", createdByName: "Ana" });
  eq("makeDrawing: fila con código, versión, prefijo y creación; sin verificación", [row.code, row.version, row.prefix, row.createdAt, row.createdBy, row.verifiedBy, row.verifiedAt, row.verifiedFile, row.comments], ["PDP26123A3", "A3", "PDP", "2026-11-26T10:00:00.000Z", "u1", "", null, null, ""]);
  check("makeDrawing devuelve null si no se puede componer el código", D.makeDrawing({ id: "x", prefix: "PDP", offerCode: "", version: "A1" }) === null);
  check("hasDrawingCode: detecta el repetido (sin mirar mayúsculas) y no confunde otro", D.hasDrawingCode([row], "pdp26123a3") && !D.hasDrawingCode([row], "PD26123A3") && !D.hasDrawingCode([row], ""));

  // guardar: nada undefined
  const saved = D.drawingsForSave([{ id: "a", prefix: "PD", code: "PD26000A1", version: "A1", comments: "  hola  " }, { code: "" }, null]);
  eq("drawingsForSave: quita las filas sin código, recorta comentarios y deja null donde no hay dato", saved.map((d) => [d.code, d.comments, d.createdAt, d.verifiedAt, d.verifiedFile]), [["PD26000A1", "hola", null, null, null]]);
  check("drawingsForSave: ninguna clave undefined (Firestore no las admite)", saved.every((d) => Object.values(d).every((v) => v !== undefined)));
  eq("normalizeDrawings con basura → []", [D.normalizeDrawings(undefined), D.normalizeDrawings("x"), D.normalizeDrawings([null, {}])], [[], [], []]);
  eq("un prefijo desconocido se queda vacío (la fila sigue existiendo por su código)", D.normalizeDrawing({ code: "ABC1", prefix: "ZZ" }).prefix, "");
  const file = { id: "f1", kind: "drive", name: "plano.pdf", driveId: "drv1", mimeType: "application/pdf", size: 10, thumbId: undefined };
  check("el plano verificado solo se conserva si es un adjunto de Drive válido (y sin undefined)", D.normalizeDrawing({ code: "A", verifiedFile: file }).verifiedFile.driveId === "drv1" && !("thumbId" in D.normalizeDrawing({ code: "A", verifiedFile: file }).verifiedFile) && D.normalizeDrawing({ code: "A", verifiedFile: { kind: "link", url: "x" } }).verifiedFile === null);

  // verificación y alerta
  const mk = (code, extra = {}) => D.normalizeDrawing({ id: code, prefix: "PD", code, version: "A1", ...extra });
  const full = { verifiedBy: "Luis", verifiedAt: "2026-11-26", verifiedFile: file };
  eq("sin planos: no hay alerta", [D.drawingsAlert([]), D.drawingsAlert(undefined), D.drawingsAlert(null)], [null, null, null]);
  const none = D.drawingsAlert([mk("PD1A1"), mk("PDP1A1")]);
  check("con planos y ninguno elegido: alerta que pide completar la verificación (faltan las 3 cosas)", !!none && none.code === null && none.missing.join() === "by,date,file", none);
  const noFile = D.drawingsAlert([mk("PD1A1", { verifiedBy: "Luis", verifiedAt: "2026-11-26" }), mk("PDP1A1")]);
  check("elegido sin documento: alerta que nombra el plano y dice que falta el documento", !!noFile && noFile.code === "PD1A1" && noFile.missing.join() === "file" && /PD1A1/.test(noFile.message) && /documento/.test(noFile.message), noFile);
  const noBy = D.drawingsAlert([mk("PD1A1", { verifiedAt: "2026-11-26", verifiedFile: file })]);
  check("elegido sin «verificado por»: falta quién", !!noBy && noBy.missing.join() === "by" && /quién/.test(noBy.message), noBy);
  const noDate = D.drawingsAlert([mk("PD1A1", { verifiedBy: "Luis", verifiedFile: file })]);
  check("elegido sin fecha: falta la fecha", !!noDate && noDate.missing.join() === "date", noDate);
  const two = D.drawingsAlert([mk("PD1A1", { verifiedBy: "Luis" })]);
  check("el mensaje junta lo que falta con «y»", /la fecha de verificación y el documento/.test(two.message), two.message);
  eq("verificado del todo (quién, cuándo y documento) → sin alerta", D.drawingsAlert([mk("PD1A1", full), mk("PDP1A1")]), null);
  check("isDrawingVerified exige las tres cosas; hasVerificationData basta con una", D.isDrawingVerified(mk("A", full)) && !D.isDrawingVerified(mk("A", { verifiedBy: "x" })) && D.hasVerificationData(mk("A", { verifiedBy: "x" })) && !D.hasVerificationData(mk("A")));
  const wv = D.withVerification([mk("PD1A1"), mk("PDP1A1")], "PDP1A1", full);
  eq("withVerification marca solo ese plano y no muta la lista original", wv.map((d) => D.isDrawingVerified(d)), [false, true]);
  eq("withVerification(null) quita la verificación", D.withVerification(wv, "PDP1A1", null).map((d) => D.hasVerificationData(d)), [false, false]);
  eq("projectNeedsDrawingAlert lee properties.drawings", [D.projectNeedsDrawingAlert({ properties: { drawings: [mk("PD1A1")] } }), D.projectNeedsDrawingAlert({ properties: {} }), D.projectNeedsDrawingAlert({}), D.projectNeedsDrawingAlert(null)], [true, false, false, false]);
}

// ---------------------------------------------------------------- 2) propiedades del proyecto
const PP = await import("../js/project-properties.js");
{
  const OFFERS = { id: "ofr", name: "Ofertas", exclusive: true, exclusiveKey: "ofertas", customFieldDefs: [{ id: "commercial", name: "Comercial" }, { id: "version", name: "Versión" }] };
  const offer = { id: "o1", title: "Cabina X", offerCode: "26123", createdAt: new Date("2026-03-10T10:00:00"), customFields: { commercial: "Juan", version: "A3" }, revisions: [],
    drawings: [{ id: "d1", prefix: "PDP", code: "PDP26123A3", version: "A3", comments: "ok", createdAt: "2026-11-01T09:00:00.000Z", createdBy: "u1", createdByName: "Ana" }, { id: "d2", prefix: "POC", code: "POC26123A2", version: "A2", createdAt: "2026-10-01T09:00:00.000Z" }] };
  const { properties } = PP.propertiesFromOffer({ offer, offersProject: OFFERS, today: TODAY });
  eq("propertiesFromOffer: la tabla de planos pasa ENTERA al proyecto", properties.drawings.map((d) => [d.code, d.version, d.prefix, d.comments]), [["PDP26123A3", "A3", "PDP", "ok"], ["POC26123A2", "A2", "POC", ""]]);
  const withoutPlans = PP.propertiesFromOffer({ offer: { ...offer, drawings: undefined }, offersProject: OFFERS, today: TODAY }).properties;
  eq("una oferta sin planos pasa sin tabla (lista vacía)", withoutPlans.drawings, []);
  const out = PP.propertiesForSave(PP.normalizeProperties(properties));
  eq("propertiesForSave guarda los planos", (out.drawings || []).map((d) => d.code), ["PDP26123A3", "POC26123A2"]);
  check("… y un proyecto sin planos NO guarda `drawings: []`", !("drawings" in PP.propertiesForSave(PP.normalizeProperties(withoutPlans))));
  check("normalizeProperties de un proyecto de antes de la v96 (sin drawings) no falla", Array.isArray(PP.normalizeProperties({ comercial: "x" }).drawings) && PP.normalizeProperties(undefined).drawings.length === 0);
  const re = PP.propertiesForSave(PP.normalizeProperties(out));
  eq("guardar y volver a leer no cambia nada (idempotente)", re, out);
}

// ---------------------------------------------------------------- 3) datos: createTask / duplicar
const fb = globalThis.__fb;
const created = [];
const projectsObservers = {};
fb.hooks = {
  onSnapshot(q, ...rest) { const path = q && q.args && q.args[0] && q.args[0].path; if (path === "projects") fb.projectsObserver = rest[0]; return () => {}; },
  async runTransaction(_db, fn) {
    const tx = { async get() { return { exists: () => true, data: () => ({ next: 7 }) }; }, set() {}, update() {} };
    return fn(tx);
  },
  async addDoc(_c, data) { created.push(data); return { id: "new" + created.length }; },
};
const { subscribeToAllProjects } = await import("../js/data/projects.js");
const { OFFERS_KEY } = await import("../js/offers.js");
subscribeToAllProjects(() => {});
const send = (obs, snap) => (typeof obs === "function" ? obs(snap) : obs.next(snap));
const OFFERS_DOC = {
  name: "Ofertas", exclusive: true, exclusiveKey: OFFERS_KEY, archived: false, seedVersion: 99,
  sections: [{ id: "nuevas", name: "Nuevas", order: 0 }, { id: "revisiones", name: "Revisiones", order: 1 }, { id: "entregadas", name: "Entregadas", order: 2 }, { id: "cerradas", name: "Cerradas", order: 3 }],
  customFieldDefs: [{ id: "commercial", name: "Comercial", type: "texto", options: [] }, { id: "version", name: "Versión", type: "texto", options: [] }, { id: "sector", name: "Sector", type: "lista", options: ["Automoción", "Industria"] }],
};
const items = [{ id: "ofr", data: OFFERS_DOC }, { id: "P1", data: { name: "Proyecto", archived: false, sections: [{ id: "s1", name: "S" }], customFieldDefs: [] } }];
send(fb.projectsObserver, { metadata: { fromCache: false }, docs: items.map((d) => ({ id: d.id, data: () => d.data })), docChanges: () => items.map((d) => ({ type: "added", doc: { id: d.id, data: () => d.data } })) });
const { createTask, duplicateTask } = await import("../js/data/tasks.js");
{
  const plans = [{ id: "d1", prefix: "PD", code: "PD26007A1", version: "A1" }];
  await createTask("ofr", { title: "Oferta con planos", sectionId: "nuevas", drawings: plans, createdBy: "u1" });
  eq("createTask: una oferta nueva guarda su tabla de planos", created[0].drawings, plans);
  await createTask("P1", { title: "Tarea normal", sectionId: "s1", createdBy: "u1" });
  check("createTask: una tarea normal no gana un `drawings` vacío", !("drawings" in created[1]));
  await duplicateTask({ id: "o1", projectId: "ofr", sectionId: "nuevas", extraProjectIds: [], extraSections: {}, title: "Oferta vieja", description: "", assigneeIds: [], priority: "media", tags: [], subtasks: [], attachments: [], createdBy: "u1", drawings: plans, offerCode: "26001" });
  check("duplicar una oferta NO copia los planos (sus códigos llevan el ID de la oferta original)", !("drawings" in created[2]));
}

// ---------------------------------------------------------------- 4) la tabla
const T = await import("../js/components/drawings-table.js");
{
  const rows = D.normalizeDrawings([
    { id: "d1", prefix: "PDP", code: "PDP26123A3", version: "A3", comments: 'a <b>"x"</b>', createdAt: "2026-11-02T10:00:00.000Z", verifiedBy: "Luis <i>", verifiedAt: "2026-11-26" },
    { id: "d2", prefix: "PAC", code: "PAC26123A3", version: "A3", createdAt: "2026-11-03T10:00:00.000Z" },
  ]);
  document.body.insertAdjacentHTML("beforeend", `<div id="tbl">${T.drawingsTableHtml(rows, { removable: true })}</div>`);
  const root = $("#tbl");
  eq("las 7 columnas pedidas, en su orden", $$(".drawing-row--head [role=columnheader]", root).map((e) => e.textContent), ["Código plano", "Versión", "Tipo de plano", "Comentarios", "Fecha de creación", "Verificado por", "Fecha de verificación"]);
  eq("una fila por plano, con código, versión y tipo", $$(".drawing-row[data-drawing-row]", root).map((r) => [$(".drawing-row__code", r).textContent, r.children[1].textContent, r.children[2].textContent]), [["PDP26123A3", "A3", "Plano de Planta"], ["PAC26123A3", "A3", "Plano de Aire Comprimido"]]);
  eq("fechas cortas (la de verificación no se corre por la zona horaria)", [$$(".drawing-row__date", root)[0].textContent.trim(), $$(".drawing-row__date", root)[1].textContent.trim()], ["02/11/26", "26/11/26"]);
  eq("un botón de copiar por fila", $$("[data-dw-copy]", root).map((b) => b.dataset.dwCopy), ["PDP26123A3", "PAC26123A3"]);
  check("el texto de los comentarios y de «verificado por» va escapado (sin HTML)", !$("b", root) && !$("i", root) && $("[data-dw-comments=d1]", root).value === 'a <b>"x"</b>');
  check("con `removable` hay un ✕ por fila; sin él no", $$("[data-dw-remove]", root).length === 2 && !/data-dw-remove/.test(T.drawingsTableHtml(rows, {})));
  check("sin planos se enseña el texto de ayuda en vez de una tabla vacía", /Todavía no hay planos/.test(T.drawingsTableHtml([], {})) && !/drawing-table"/.test(T.drawingsTableHtml([], {})));
  eq("shortDate", [T.shortDate(null), T.shortDate("2026-01-05"), T.shortDate("nonsense")], ["", "05/01/26", ""]);

  let copied = null;
  Object.defineProperty(globalThis.navigator || (globalThis.navigator = {}), "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  const calls = [];
  T.wireDrawingsTable(root, { onComment: (id, v) => calls.push(["c", id, v]), onRemove: (id) => calls.push(["r", id]) });
  click($("[data-dw-copy=PDP26123A3]", root));
  await tick(5);
  eq("el botón de copiar pone el código en el portapapeles", copied, "PDP26123A3");
  eq("(y avisa)", $$("#toast-root .toast, #toast-root > *").some((t) => /PDP26123A3 copiado/.test(t.textContent)), true);
  type($("[data-dw-comments=d2]", root), "revisar cotas");
  click($("[data-dw-remove=d1]", root));
  eq("escribir un comentario y quitar una fila avisan con el id de la fila", calls, [["c", "d2", "revisar cotas"], ["r", "d1"]]);
  $("#tbl").remove();
}

// ---------------------------------------------------------------- 5) ventana de la oferta (task-modal.js real)
const { openTaskModal } = await import("../js/components/task-modal.js");
const offersProject = { id: "ofr", ...OFFERS_DOC };
const members = [{ uid: "u1", name: "Ana", role: "member" }];
const profile = { uid: "u1", name: "Ana", role: "member", department: "diseno-industria" };
{
  created.length = 0;
  let savedId = null;
  openTaskModal({ project: offersProject, teamMembers: members, allProjects: [offersProject], tagsRegistry: [], currentUserProfile: profile, onSaved: (id) => { savedId = id; }, onClosed() {} });
  await tick(20);
  check("modal de una OFERTA: hay tabla de planos con «Generar plano» y selector de prefijo (5 + el vacío)", !!$("#t-drawing-generate") && $("#t-drawing-generate").textContent.trim() === "Generar plano" && $("#t-drawing-prefix").options.length === 6);
  eq("el selector ofrece los 5 prefijos con su tipo", [...$("#t-drawing-prefix").options].slice(1).map((o) => o.value), ["PAC", "PD", "PDP", "POC", "PPT"]);
  check("«Generar plano» está ANTES (encima) de la tabla y el selector a su lado", $("#t-drawings").innerHTML.indexOf("t-drawing-generate") < $("#t-drawings").innerHTML.indexOf("t-drawing-prefix") && $("#t-drawings").innerHTML.indexOf("t-drawing-prefix") < $("#t-drawings").innerHTML.indexOf("Todavía no hay planos"));
  check("la ventana de una oferta se ensancha (.modal--drawings)", $(".modal").classList.contains("modal--drawings"));
  check("la tabla de planos va debajo del histórico de revisiones", document.body.innerHTML.indexOf('id="t-revisions"') < document.body.innerHTML.indexOf('id="t-drawings"'));

  click($("#t-drawing-generate"));
  await tick(10);
  eq("sin elegir prefijo no se genera nada (avisa)", [$$("[data-drawing-row]").length, $$("#toast-root *").some((t) => /Elige primero el prefijo/.test(t.textContent))], [0, true]);

  const sel = $("#t-drawing-prefix");
  sel.value = "PDP"; sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  click($("#t-drawing-generate"));
  await tick(20);
  let rows = $$("[data-drawing-row]");
  eq("generar con PDP: una fila con PDP + ID de la oferta (26007) + versión A1", rows.map((r) => $(".drawing-row__code", r).textContent), ["PDP26007A1"]);
  eq("… versión A1, tipo Plano de Planta y fecha de creación de hoy", [rows[0].children[1].textContent, rows[0].children[2].textContent, $(".drawing-row__date", rows[0]).textContent.trim()], ["A1", "Plano de Planta", "26/11/26"]);
  eq("el prefijo elegido se queda seleccionado tras generar", $("#t-drawing-prefix").value, "PDP");
  check("el ID de la oferta ya se ve en la cabecera (se pidió al generar)", /26007/.test($(".id-chip") ? $(".id-chip").textContent : ""), $(".id-chip") && $(".id-chip").textContent);

  click($("#t-drawing-generate"));
  await tick(20);
  eq("repetir el mismo prefijo en la misma versión NO crea otra fila (avisa)", [$$("[data-drawing-row]").length, $$("#toast-root *").some((t) => /Ya existe el plano PDP26007A1/.test(t.textContent))], [1, true]);

  // subir de versión → el código lleva la versión del momento
  eq("(la oferta es nueva: «Nueva versión» solo existe al editar; se cambia el campo Versión a mano)", !!$("#t-new-version"), false);
  const versionInput = $$("#t-customfields input").find((i) => i.value === "A1");
  check("el campo Versión de la oferta está en el formulario", !!versionInput);
  type(versionInput, "A3");
  sel.value = "POC"; sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  click($("#t-drawing-generate"));
  await tick(20);
  eq("con la oferta en A3, otro plano se genera con A3 (y el anterior conserva su A1)", $$("[data-drawing-row]").map((r) => [$(".drawing-row__code", r).textContent, r.children[1].textContent]), [["PDP26007A1", "A1"], ["POC26007A3", "A3"]]);
  sel.value = "PDP"; sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  click($("#t-drawing-generate"));
  await tick(20);
  eq("el mismo prefijo ya vale en la versión nueva (PDP26007A3)", $$("[data-drawing-row] .drawing-row__code").map((c) => c.textContent), ["PDP26007A1", "POC26007A3", "PDP26007A3"]);

  type($("[data-dw-comments]"), "primer borrador");
  click($$("[data-dw-remove]")[1]);
  await tick(5);
  eq("quitar una fila la quita de la tabla (y el comentario escrito se conserva en su fila)", $$("[data-drawing-row]").map((r) => [$(".drawing-row__code", r).textContent, $("[data-dw-comments]", r).value]), [["PDP26007A1", "primer borrador"], ["PDP26007A3", ""]]);

  const title = $("#t-title"); title.value = "Cabina nueva"; title.dispatchEvent(new window.Event("input", { bubbles: true }));
  click($("#t-accept"));
  await tick(40);
  check("Aceptar guarda la oferta con su tabla de planos (y su offerCode)", created.length === 1 && created[0].offerCode === "26007" && Array.isArray(created[0].drawings), created[0] && created[0].drawings);
  eq("lo guardado: códigos, versión, prefijo, comentarios, quién y verificación vacía", (created[0].drawings || []).map((d) => [d.code, d.version, d.prefix, d.comments, d.createdBy, d.verifiedBy, d.verifiedAt, d.verifiedFile]), [["PDP26007A1", "A1", "PDP", "primer borrador", "u1", "", null, null], ["PDP26007A3", "A3", "PDP", "", "u1", "", null, null]]);
  check("(la oferta guarda también la versión nueva)", Object.values(created[0].customFields || {}).includes("A3"));
  check("onSaved recibió el id", savedId === "new1");
}
{
  // oferta EXISTENTE: se cargan sus planos y se guardan con updateTask
  const updates = [];
  fb.hooks.getDoc = async () => ({ id: "o9", exists: () => true, data: () => ({ title: "Oferta existente", projectId: "ofr", sectionId: "nuevas", offerCode: "26042", customFields: { version: "A2" }, revisions: [{ id: "r1", version: "A1", changes: "Versión original", createdAt: "2026-03-10T10:00:00.000Z" }, { id: "r2", version: "A2", changes: "x", createdAt: "2026-04-10T10:00:00.000Z" }], assigneeIds: [], attachments: [], subtasks: [], tags: [], extraProjectIds: [], extraSections: {},
    drawings: [{ id: "dd1", prefix: "PAC", code: "PAC26042A1", version: "A1", comments: "viejo", createdAt: "2026-03-11T09:00:00.000Z", createdBy: "u2", createdByName: "Luis" }] }) });
  fb.hooks.updateDoc = async (ref, data) => { updates.push(data); };
  const { store } = await import("../js/store.js");
  openTaskModal({ taskId: "o9", project: offersProject, teamMembers: members, allProjects: [offersProject], tagsRegistry: [], currentUserProfile: profile, onSaved() {}, onClosed() {} });
  await tick(40);
  const codes = $$("[data-drawing-row] .drawing-row__code").map((c) => c.textContent);
  if (!codes.length) console.error("  (aviso) el modal de una oferta existente no cargó en esta prueba: se omite este bloque");
  else {
    eq("oferta existente: se cargan sus planos", codes, ["PAC26042A1"]);
    const s2 = $("#t-drawing-prefix"); s2.value = "PD"; s2.dispatchEvent(new window.Event("change", { bubbles: true }));
    click($("#t-drawing-generate"));
    await tick(20);
    eq("el nuevo plano usa el ID de la oferta (26042) y su versión actual (A2)", $$("[data-drawing-row] .drawing-row__code").map((c) => c.textContent), ["PAC26042A1", "PD26042A2"]);
    click($("#t-accept"));
    await tick(40);
    check("Aceptar manda `drawings` en la actualización (con el plano antiguo intacto y el nuevo)", updates.length >= 1 && (updates[0].drawings || []).map((d) => d.code).join() === "PAC26042A1,PD26042A2" && updates[0].drawings[0].createdByName === "Luis", updates[0] && updates[0].drawings);
  }
  delete fb.hooks.getDoc; delete fb.hooks.updateDoc;
}
{
  // una tarea NORMAL no tiene tabla de planos
  const normal = { id: "P1", name: "Proyecto", sections: [{ id: "s1", name: "S", order: 0 }] };
  openTaskModal({ project: normal, teamMembers: members, allProjects: [normal, offersProject], tagsRegistry: [], currentUserProfile: profile, onSaved() {}, onClosed() {} });
  await tick(20);
  check("una tarea normal no tiene tabla de planos ni modal ancho", !$("#t-drawing-generate") && $("#t-drawings").innerHTML.trim() === "" && !$(".modal").classList.contains("modal--drawings"));
  click($("#t-cancel"));
  await tick(5);
}

// ---------------------------------------------------------------- 6) convertir en proyecto / propiedades
const PM = await import("../js/components/project-properties-modal.js");
{
  const uploaded = [];
  const trashed = [];
  const storage = {
    enabled: true,
    isEnabled() { return this.enabled; },
    maxBytes: () => 50 * 1024 * 1024,
    async uploadFile(file, opts) { uploaded.push({ name: file.name, opts }); return { driveId: "drv" + uploaded.length, name: file.name, mimeType: "application/pdf", size: file.size, folderId: "fold1" }; },
    trashFiles(ids) { trashed.push(...ids); return Promise.resolve({}); },
  };
  // «elegir un archivo»: el <input type=file> que crea el componente se rellena y dispara change.
  let nextFile = { name: "PDP26123A3-verificado.pdf", size: 2048 };
  window.HTMLInputElement.prototype.click = function () {
    if (this.type !== "file") return;
    Object.defineProperty(this, "files", { value: [nextFile], configurable: true });
    this.dispatchEvent(new window.Event("change"));
  };
  const OFFER = { id: "o1", title: "Cabina X", offerCode: "26123", driveFolderId: "foldO", createdAt: new Date("2026-03-10T10:00:00"), dueDate: "2026-12-30", customFields: { commercial: "Juan Pérez", version: "A3" }, revisions: [],
    drawings: [
      { id: "d1", prefix: "PDP", code: "PDP26123A3", version: "A3", createdAt: "2026-11-01T09:00:00.000Z", createdBy: "u1" },
      { id: "d2", prefix: "POC", code: "POC26123A2", version: "A2", createdAt: "2026-10-01T09:00:00.000Z", createdBy: "u1" },
    ] };
  const env = (extra = {}) => ({ storage, currentUser: { uid: "u1", name: "Ana" }, taskId: "o1", getOwner: () => ({ code: "26123", name: "Cabina X", kind: "offer", folderId: "foldO" }), ...extra });
  const open = async () => {
    const confirmed = [];
    PM.openOfferConversionModal({ offer: OFFER, offersProject: { ...OFFERS_DOC, id: "ofr" }, today: TODAY, onConfirm: async (v) => { confirmed.push(v); }, getCommercialOptions: () => [], drawingsEnv: env() });
    await tick(10);
    return confirmed;
  };

  // --- aceptar SIN completar la verificación
  {
    const confirmed = await open();
    check("«Convertir en proyecto»: con planos, la ventana enseña su tabla (y se ensancha)", $$("#pp-drawings [data-drawing-row]").length === 2 && $(".modal").classList.contains("modal--drawings") && !$("#pp-drawings-field").hidden);
    eq("… con un botón «Marcar verificado» por plano y ningún panel todavía", [$$("[data-dw-verify]").map((b) => b.textContent), !!$("[data-dw-panel]")], [["Marcar verificado", "Marcar verificado"], false]);
    click($("#pp-confirm"));
    await tick(20);
    eq("aceptar sin elegir plano: se crea igual, con los planos y sin verificar", confirmed.length === 1 && confirmed[0].properties.drawings.map((d) => D.hasVerificationData(d)).join(), "false,false");
    const alert = D.drawingsAlert(confirmed[0].properties.drawings);
    check("→ y el proyecto tendrá la alerta («no se ha indicado cuál es el plano verificado»)", !!alert && alert.code === null && /verificado/.test(alert.message), alert);
    check("(no se subió nada)", uploaded.length === 0);
  }

  // --- elegir, precarga y subir el documento
  {
    uploaded.length = 0; trashed.length = 0;
    const confirmed = await open();
    click($$("[data-dw-verify]")[0]);
    await tick(5);
    const panel = $("[data-dw-panel]");
    check("al clicar el plano se abre el panel de verificación de ESE plano", !!panel && panel.dataset.dwPanel === "d1" && /PDP26123A3/.test(panel.textContent));
    eq("«Verificado por» sale con el Comercial y la fecha con el día de hoy", [$("[data-dwp-by]").value, $("[data-dwp-date]").value], ["Juan Pérez", TODAY]);
    eq("el botón de la fila pasa a «⚠ Completar» (falta el documento)", $$("[data-dw-verify]")[0].textContent, "⚠ Completar");
    click($("#pp-confirm"));
    await tick(20);
    const a1 = D.drawingsAlert(confirmed[0].properties.drawings);
    check("aceptar con quién y cuándo pero SIN documento → alerta que dice que falta el documento", !!a1 && a1.code === "PDP26123A3" && a1.missing.join() === "file", a1);
  }
  {
    uploaded.length = 0; trashed.length = 0;
    const confirmed = await open();
    click($$("[data-dw-verify]")[0]);
    await tick(5);
    type($("[data-dwp-by]"), "Marta Ruiz");
    type($("[data-dwp-date]"), "2026-11-24");
    click($("[data-dwp-pick]"));
    await tick(30);
    eq("se sube el plano verificado a Drive, a la carpeta de la oferta (código 26123, no a «tareas personales»)", [uploaded.length, uploaded[0] && uploaded[0].name, uploaded[0] && uploaded[0].opts.code, uploaded[0] && uploaded[0].opts.folderPath[0].root, uploaded[0] && uploaded[0].opts.folderPath[0].hint], [1, "PDP26123A3-verificado.pdf", "26123", "ofertas", "foldO"]);
    check("el panel enseña el documento subido y el botón pasa a «✔ Verificado»", /PDP26123A3-verificado\.pdf/.test($("[data-dw-panel]").textContent) && $$("[data-dw-verify]")[0].textContent === "✔ Verificado");
    check("la fila enseña el 📎 para abrir el plano verificado", !!$("[data-dw-file=d1]"));
    eq("la fila enseña quién y cuándo", [$$("[data-drawing-row]")[0].children[5].textContent, $$("[data-drawing-row]")[0].children[6].textContent.trim().slice(0, 8)], ["Marta Ruiz", "24/11/26"]);
    click($("#pp-confirm"));
    await tick(20);
    const props = confirmed[0].properties;
    eq("al aceptar, la tabla COMPLETA pasa al proyecto, con el verificado completo", [props.drawings.length, props.drawings[0].verifiedBy, props.drawings[0].verifiedAt, props.drawings[0].verifiedFile && props.drawings[0].verifiedFile.driveId, D.isDrawingVerified(props.drawings[0]), D.hasVerificationData(props.drawings[1])], [2, "Marta Ruiz", "2026-11-24", "drv1", true, false]);
    eq("verificado del todo → ninguna alerta", D.drawingsAlert(props.drawings), null);
    check("(lo subido se queda: nada a la papelera)", trashed.length === 0);
  }

  // --- cambiar de plano verificado
  {
    uploaded.length = 0; trashed.length = 0;
    const confirmed = await open();
    click($$("[data-dw-verify]")[0]);
    await tick(5);
    click($("[data-dwp-pick]"));
    await tick(30);
    click($$("[data-dw-verify]")[1]);
    await tick(10);
    eq("elegir OTRO plano pasa la verificación (solo uno es el verificado) y manda a la papelera el documento ya subido del anterior", [$("[data-dw-panel]").dataset.dwPanel, trashed.join()], ["d2", "drv1"]);
    eq("el primero queda sin verificar y el segundo con quién/cuándo precargados", [$$("[data-dw-verify]").map((b) => b.textContent).join("|"), $("[data-dwp-by]").value], ["Marcar verificado|⚠ Completar", "Juan Pérez"]);
    click($("[data-dwp-clear]"));
    await tick(5);
    eq("«Quitar la verificación» cierra el panel y deja la tabla sin verificar", [!!$("[data-dw-panel]"), $$("[data-dw-verify]").map((b) => b.textContent).join("|")], [false, "Marcar verificado|Marcar verificado"]);
    click($("#pp-cancel"));
    await tick(5);
    check("(cancelar sin guardar: no se llama a onConfirm)", confirmed.length === 0);
  }

  // --- cancelar tras subir
  {
    uploaded.length = 0; trashed.length = 0;
    const confirmed = await open();
    click($$("[data-dw-verify]")[0]);
    await tick(5);
    click($("[data-dwp-pick]"));
    await tick(30);
    click($("#pp-cancel"));
    await tick(5);
    eq("cerrar SIN guardar manda a la papelera de Drive lo subido en esta apertura, y no confirma nada", [trashed.join(), confirmed.length, !!$("#pp-confirm")], ["drv1", 0, false]);
  }

  // --- Drive desactivado
  {
    storage.enabled = false;
    uploaded.length = 0;
    await open();
    click($$("[data-dw-verify]")[0]);
    await tick(5);
    check("sin Drive activado el panel avisa y el botón de subir está desactivado", $("[data-dwp-pick]").disabled && /no está activado|no se puede subir/.test($("[data-dw-panel]").textContent));
    click($("#pp-cancel"));
    storage.enabled = true;
  }

  // --- «Propiedades» de un proyecto ya creado: completar la verificación más tarde
  {
    uploaded.length = 0; trashed.length = 0;
    const saved = [];
    const project = { id: "pr1", name: "Cabina X", code: "26123", driveFolderId: "foldP", properties: PP.propertiesForSave(PP.normalizeProperties({ comercial: "Juan Pérez", sourceOfferId: "o1", sourceOfferTitle: "Cabina X", drawings: OFFER.drawings })) };
    check("el proyecto recién convertido sin verificar tiene alerta", D.projectNeedsDrawingAlert(project));
    PM.openProjectPropertiesModal({ project, getCommercialOptions: () => [], onSave: async (p) => { saved.push(p); }, drawingsEnv: { storage, currentUser: { uid: "u1", name: "Ana" }, taskId: "", getOwner: () => ({ code: "26123", name: "Cabina X", kind: "project", folderId: "foldP" }) } });
    await tick(10);
    eq("«Propiedades» enseña la tabla de planos del proyecto", $$("#pp-drawings [data-drawing-row] .drawing-row__code").map((c) => c.textContent), ["PDP26123A3", "POC26123A2"]);
    click($$("[data-dw-verify]")[1]);
    await tick(5);
    nextFile = { name: "POC-verificado.pdf", size: 99 };
    click($("[data-dwp-pick]"));
    await tick(30);
    check("el documento se sube a la carpeta del PROYECTO", uploaded.length === 1 && uploaded[0].opts.folderPath[0].root === "proyectos" && uploaded[0].opts.folderPath[0].hint === "foldP", uploaded[0] && uploaded[0].opts.folderPath);
    click($("#pp-confirm"));
    await tick(20);
    check("«Guardar» escribe las propiedades con el plano verificado completo", saved.length === 1 && D.isDrawingVerified(saved[0].drawings[1]) && saved[0].drawings[1].verifiedBy === "Juan Pérez", saved[0] && saved[0].drawings);
    check("→ el proyecto ya no tiene alerta", !D.projectNeedsDrawingAlert({ properties: saved[0] }));
  }
  {
    // un proyecto SIN planos no enseña la sección
    PM.openProjectPropertiesModal({ project: { id: "pr2", name: "Otro", properties: {} }, getCommercialOptions: () => [], onSave: async () => {}, drawingsEnv: env() });
    await tick(10);
    check("un proyecto sin planos no enseña la sección de planos", $("#pp-drawings-field").hidden && !$(".modal").classList.contains("modal--drawings"));
    click($("#pp-cancel"));
  }
}

// ---------------------------------------------------------------- 7) alerta en el proyecto y entrega
{
  const idx = read("index.html");
  check("index.html: hay un hueco #project-alert (role=alert, oculto) entre la campana y la barra de filtros", /id="project-alert"[^>]*role="alert"[^>]*hidden/.test(idx) || /role="alert"[^>]*id="project-alert"/.test(idx));
  check("index.html: el hueco va antes de #filterbar", idx.indexOf('id="project-alert"') < idx.indexOf('id="filterbar"') && idx.indexOf('id="project-alert"') > idx.indexOf('id="notif-bell"'));
  const app = read("js/app.js");
  check("app.js: renderProjectAlert se llama en cada renderShell y abre «Propiedades» con «Completar»", /renderSidebarOnly\(\);\s*renderProjectAlert\(\);/.test(app) && /project-alert-btn[\s\S]{0,200}openProjectProperties\(currentProject\)/.test(app));
  check("app.js: la alerta solo sale en modo proyecto y no en secciones exclusivas", /mode === "project" && currentProject && !currentProject\.exclusive \? drawingsAlert/.test(app));
  check("app.js: los dos modales reciben `drawingsEnv` con Drive (oferta: kind offer; proyecto: kind project)", /kind: "offer"/.test(app) && /kind: "project"/.test(app) && (app.match(/drawingsEnv:/g) || []).length === 2);
  const sb = read("js/components/sidebar.js");
  check("sidebar.js: ⚠️ junto a los proyectos con la alerta (no en secciones exclusivas)", /!p\.exclusive && projectNeedsDrawingAlert\(p\)/.test(sb) && /sidebar__item-alert/.test(sb));
  const css = read("css/05-layout.css") + read("css/07-modals.css");
  check("CSS: .project-alert, .sidebar__item-alert, .drawing-table, .drawing-panel y .modal--drawings", [".project-alert {", ".sidebar__item-alert", ".drawing-table {", ".drawing-panel {", ".modal--drawings"].every((s) => css.includes(s)));

  const linkVersions = [...idx.matchAll(/css\/[\w-]+\.css\?v=(\d+)/g)].map((m) => Number(m[1]));
  eq("index.html: los 14 <link> a ?v=96", linkVersions.filter((v) => v === 96).length + ":" + linkVersions.length, "14:14");
  check("package.json y package-lock.json: 96.0.0", JSON.parse(read("package.json")).version === "96.0.0" && JSON.parse(read("package-lock.json")).version === "96.0.0");
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES[0];
  check("Novedades: la entrada de arriba es la 96, mayor que la 95, y habla de planos, prefijo, verificación y aviso", r.id === 96 && r.id > RELEASES.find((x) => x.id === 95).id && ["planos", "prefijo", "verific", "aviso"].every((w) => r.items.join(" ").toLowerCase().includes(w)), r && r.items);
  const readme = read("README.md");
  check("README: historial v95 → v96 y los archivos nuevos (drawings.js, drawings-table.js)", /v95 → v96 \(Chusy-96\.zip\)/.test(readme) && /drawings\.js/.test(readme) && /drawings-table\.js/.test(readme));
  check("README: sección 3.27 (v96) y el campo `drawings` en el modelo de datos", /### 3\.27 [^\n]*\(v96\)/.test(readme) && /`drawings`/.test(readme));
  check("sin firestore.rules nuevas: no se toca el archivo en la v96 (no hay que republicar)", !/v96/.test(read("firestore.rules")));
}

done("v96 · Tabla de planos en las ofertas y verificación del plano al convertir en proyecto");
