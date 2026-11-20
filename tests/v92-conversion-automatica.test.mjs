// v92 · Conversión automática a STP: al subir un .ipt/.iam sin su STEP, Chusy lanza el ayudante SIN preguntar, el ayudante recuerda
// de dónde venía el archivo y entrega el .stp a Chusy por un canal local, y Chusy lo sube a la tarea en cuanto está creado.
//  1) El puente de Chusy (step-bridge.js): progreso, entrega, fallos y cancelación, con un fetch simulado.
//  2) Enlace y comando con puerto y clave.
//  3) La pregunta de la primera vez y el flujo al subir (jsdom): activar / subir solo el nativo / nunca; modo automático sin preguntar.
//  4) EXTREMO A EXTREMO: el script REAL de PowerShell (con un Inventor simulado) contra step-bridge.js por HTTP en 127.0.0.1.
//  5) El script (estático): memoria, carpetas del Explorador y del navegador, canal local, vigilancia.
//  6) Entrega: ?v=92, package.json, Novedades, README y node scripts/check-integrity.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, tick } from "./support/dom.mjs";

setupDom();
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 5); // (jsdom no lo trae como global; en un navegador existe)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
globalThis.__fb = { collections: {}, sets: [], hooks: {} };

const cad = await import("../js/cad-viewer.js");
const bridge = await import("../js/step-bridge.js");

// ---------------------------------------------------------------- 1) el puente
const fakeHelper = (script) => {
  // script: lista de respuestas de /status en orden (la última se repite) y los bytes del /file
  let i = 0; const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (script.refuse) throw new TypeError("Failed to fetch");
    if (url.endsWith("/status")) {
      const r = script.statuses[Math.min(i++, script.statuses.length - 1)];
      if (r === "refuse") throw new TypeError("Failed to fetch");
      return { ok: true, json: async () => r };
    }
    if (url.endsWith("/file")) return { ok: script.fileOk !== false, blob: async () => new Blob([script.bytes || new Uint8Array(0)]) };
    return { ok: false };
  };
  return { fetchImpl, calls };
};
const fixed = { port: 47650, token: "tokentokentoken1234" };
let clock = 0;
const sleep = async (ms) => { clock += ms; };
const now = () => clock;
const base = (o) => ({ fileName: "Eje_26001.ipt", size: 5, lastModified: 7, launch: async () => true, sleep, now, bridge: fixed, pollMs: 100, ...o });
{
  clock = 0;
  const launched = [];
  const h = fakeHelper({ statuses: [{ status: "searching", message: "" }, { status: "converting", message: "" }, { status: "done", name: "Eje_26001.stp", size: 4 }], bytes: new Uint8Array([1, 2, 3, 4]) });
  const seen = [];
  const job = bridge.startStepConversion(base({ launch: async (u) => { launched.push(u); return true; }, fetchImpl: h.fetchImpl, onStatus: (s) => seen.push(s.status) }));
  const res = await job.promise;
  check("puente: lanza el enlace con nombre, tamaño, fecha, puerto y clave", launched.length === 1 && launched[0] === "chusy-step://convert?file=Eje_26001.ipt&size=5&modified=7&port=47650&token=tokentokentoken1234", launched);
  check("puente: avisa del progreso (launching → searching → converting → done)", seen.join() === "launching,searching,converting,done", seen);
  check("puente: devuelve el .stp como File con su nombre y sus bytes", res.ok === true && res.file.name === "Eje_26001.stp" && res.file.size === 4 && new Uint8Array(await res.file.arrayBuffer()).join() === "1,2,3,4", res);
  check("puente: pregunta SOLO a 127.0.0.1 en el puerto y con la clave", h.calls.every((u) => u.startsWith("http://127.0.0.1:47650/tokentokentoken1234/")) && h.calls.at(-1).endsWith("/file"), h.calls);

  clock = 0;
  const e = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ statuses: [{ status: "searching" }, { status: "error", message: "No he encontrado el archivo" }] }).fetchImpl })).promise;
  check("puente: un error del ayudante se devuelve tal cual (reason «error»)", e.ok === false && e.reason === "error" && /No he encontrado/.test(e.message), e);

  clock = 0;
  const nh = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ refuse: true, statuses: [] }).fetchImpl, graceMs: 3000 })).promise;
  check("puente: si el ayudante no responde nunca (no instalado), «no-helper» tras el tiempo de cortesía", nh.ok === false && nh.reason === "no-helper" && /Instalar-ConvertirStep/.test(nh.message) && clock >= 3000 && clock < 4000, { nh, clock });

  clock = 0;
  const denied = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ refuse: true, statuses: [] }).fetchImpl, graceMs: 1000, permissionState: async () => "denied" })).promise;
  check("puente: si el navegador tiene DENEGADO el acceso a la red local, lo dice con cómo concederlo (en vez de «no instalado»)", denied.ok === false && denied.reason === "no-helper" && /Acceso a la red local/.test(denied.message) && /bloqueado/.test(denied.message), denied.message);
  check("… y con el permiso en orden, el mensaje habla de instalar el ayudante y menciona el permiso por si acaso", /Instalar-ConvertirStep/.test(nh.message) && /Acceso a la red local/.test(nh.message));
  clock = 0;
  const opts = []; const sniff = async (url, o) => { opts.push(o); throw new TypeError("x"); };
  await bridge.startStepConversion(base({ fetchImpl: sniff, graceMs: 300 })).promise;
  check("puente: las peticiones piden explícitamente el espacio «loopback» (Chrome lo usa para el permiso de red local) y no usan caché", opts.length > 0 && opts.every((o) => o.targetAddressSpace === "loopback" && o.cache === "no-store"), opts[0]);
  clock = 0;
  const lost = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ statuses: [{ status: "converting" }, "refuse"] }).fetchImpl, lostMs: 2000 })).promise;
  check("puente: si el ayudante contestó y luego desaparece, «lost»", lost.ok === false && lost.reason === "lost", lost);

  clock = 0;
  const corrupt = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ statuses: [{ status: "done", name: "a.stp", size: 9 }], bytes: new Uint8Array([1, 2]) }).fetchImpl })).promise;
  check("puente: si llegan menos bytes de los anunciados, «corrupt» (no se sube un STP a medias)", corrupt.ok === false && corrupt.reason === "corrupt", corrupt);
  clock = 0;
  const noFile = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ statuses: [{ status: "done", name: "a.stp", size: 2 }], fileOk: false }).fetchImpl })).promise;
  check("puente: si /file no responde bien, «lost»", noFile.ok === false && noFile.reason === "lost");

  clock = 0;
  const slow = await bridge.startStepConversion(base({ fetchImpl: fakeHelper({ statuses: [{ status: "dialog", message: "Elige" }] }).fetchImpl, timeoutMs: 5000 })).promise;
  check("puente: con el usuario eligiendo a mano no se rinde antes de tiempo, pero sí a los 25 min (timeout)", slow.ok === false && slow.reason === "timeout");

  clock = 0;
  const hc = fakeHelper({ statuses: [{ status: "converting" }] });
  const cj = bridge.startStepConversion(base({ fetchImpl: hc.fetchImpl, sleep: async (ms) => { clock += ms; await Promise.resolve(); } }));
  cj.cancel();
  const cr = await cj.promise;
  check("puente: cancel() detiene las preguntas", cr.ok === false && cr.reason === "cancelled");

  const un = await bridge.startStepConversion(base({ launch: async () => false })).promise;
  check("puente: fuera de Windows (launch devuelve false): «unsupported»", un.ok === false && un.reason === "unsupported");
  const bad = await bridge.startStepConversion(base({ fileName: "plano.pdf" })).promise;
  check("puente: un archivo que no es .ipt/.iam: «invalid», sin lanzar nada", bad.ok === false && bad.reason === "invalid");
  const thrown = await bridge.startStepConversion(base({ launch: async () => { throw new Error("bloqueado"); }, fetchImpl: fakeHelper({ statuses: [] }).fetchImpl })).promise;
  check("puente: si lanzar el enlace falla, «no-helper» con el motivo", thrown.ok === false && thrown.reason === "no-helper" && /bloqueado/.test(thrown.message));

  const p1 = bridge.createBridgeParams(), p2 = bridge.createBridgeParams();
  check("createBridgeParams: puerto en 47600–47999 y clave de 32 caracteres, distinta cada vez", p1.port >= 47600 && p1.port <= 47999 && /^[a-z0-9]{32}$/.test(p1.token) && p1.token !== p2.token, p1);
  const store = (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; })();
  eq("preferencia: sin decidir → 'ask'", bridge.getStepAutoMode(store), "ask");
  bridge.setStepAutoMode("on", store);
  eq("… 'on' se recuerda", bridge.getStepAutoMode(store), "on");
  bridge.setStepAutoMode("off", store);
  eq("… 'off' se recuerda", bridge.getStepAutoMode(store), "off");
  bridge.setStepAutoMode("loquesea", store);
  eq("… cualquier otro valor se guarda como 'off' (no se convierte sin querer)", bridge.getStepAutoMode(store), "off");
  eq("preferencia: un almacenamiento roto no rompe nada", [bridge.getStepAutoMode({ getItem() { throw new Error("x"); } }), bridge.getStepAutoMode(null)], ["ask", "ask"]);
  eq("isStepHelperPlatform: solo Windows", [bridge.isStepHelperPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64) Chrome" }), bridge.isStepHelperPlatform({ userAgent: "Mozilla/5.0 (Macintosh)" }), bridge.isStepHelperPlatform({ userAgent: "X11; Linux", platform: "Linux" }), bridge.isStepHelperPlatform(null)], [true, false, false, false]);
  eq("describeStepStatus: un texto por paso", ["launching", "searching", "dialog", "converting", "done"].map((s) => bridge.describeStepStatus({ status: s })).every((t) => t.length > 5), true);
  eq("describeStepStatus: el error lleva su motivo", bridge.describeStepStatus({ status: "error", message: "E_FAIL" }), "E_FAIL");
}

// ---------------------------------------------------------------- 2) enlace y comando con puerto y clave
{
  const u = cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", size: 5, lastModified: 7, port: 47650, token: "tokentoken12" });
  eq("enlace: size, modified, port y token en ese orden", u, "chusy-step://convert?file=a.ipt&size=5&modified=7&port=47650&token=tokentoken12");
  eq("enlace: un puerto fuera de 1024–65535 o una clave corta/rara se ignoran (no se abre canal)", [cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", port: 80, token: "tokentoken12" }), cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", port: 47650, token: "corta" }), cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", port: 47650, token: "tok en/12345" }), cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", port: 47650 })], ["chusy-step://convert?file=a.ipt", "chusy-step://convert?file=a.ipt", "chusy-step://convert?file=a.ipt", "chusy-step://convert?file=a.ipt"]);
  eq("comando de PowerShell: -Port y -Token", cad.buildConvertStepPowerShellCommand({ fileName: "a.ipt", size: 5, port: 47650, token: "tokentoken12" }), "& \"$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1\" -FileName 'a.ipt' -Size 5 -Port 47650 -Token 'tokentoken12'");
}

// ---------------------------------------------------------------- 3) la pregunta de la primera vez y el flujo al subir
const setUa = (ua) => [window.navigator, globalThis.navigator].filter(Boolean).forEach((n) => Object.defineProperty(n, "userAgent", { value: ua, configurable: true })); // (el código usa el `navigator` global)
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0"; // (Firefox: el enlace se lanza en un iframe, sin navegar)
{
  setUa(WIN_UA);
  const { openCadUploadAssistant } = await import("../js/components/cad-upload-assistant.js");
  const ipt = new File(["abc"], "Eje_26001.ipt"), iam = new File(["abcd"], "Conjunto.iam");
  let a = openCadUploadAssistant({ files: [ipt] });
  check("pregunta: ofrece activar la conversión automática, subir solo el nativo esta vez o no convertir nunca", /automáticamente/.test($(".cad-assistant h3").textContent) && $('[data-act="enable"]').textContent === "⚙️ Activar la conversión automática" && $('[data-act="native-only"]').textContent === "Subir solo el .ipt/.iam esta vez" && $('[data-act="disable"]').textContent === "No convertir nunca" && $$(".cad-assistant__row").length === 1);
  check("… sin botones de convertir por archivo ni campo de carpeta (ya no hace falta)", !$('[data-act="convert"]') && !$('[data-act="include"]') && !$("input[type=text]"));
  const m = openCadUploadAssistant({ files: [iam] });
  check("… si llega otro lote con la pregunta abierta, se suma a la misma", m.merged === true && $$(".cad-assistant__row").length === 2 && $$(".cad-assistant-overlay").length === 1);
  click($('[data-act="enable"]'));
  let res = await a.result;
  check("«Activar» devuelve la acción y todos los archivos", res.action === "enable" && res.files.map((f) => f.name).join() === "Eje_26001.ipt,Conjunto.iam" && !$(".cad-assistant-overlay"));
  a = openCadUploadAssistant({ files: [ipt] }); click($('[data-act="native-only"]')); res = await a.result;
  eq("«Subir solo…»", [res.action, res.files.length], ["native-only", 1]);
  a = openCadUploadAssistant({ files: [ipt] }); click($('[data-act="disable"]')); res = await a.result;
  eq("«No convertir nunca»", [res.action, res.files.length], ["disable", 1]);
  a = openCadUploadAssistant({ files: [ipt] }); click($('[data-act="cancel"]')); res = await a.result;
  eq("Cancelar no sube nada", [res.action, res.files.length], ["cancel", 0]);
  a = openCadUploadAssistant({ files: [ipt] }); document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); res = await a.result;
  check("Esc también cancela", res.action === "cancel" && !$(".cad-assistant-overlay"));

  // --- el flujo al subir, con un ayudante simulado detrás de fetch
  const { createFileAttachments } = await import("../js/components/file-attachments.js");
  const realFetch = globalThis.fetch;
  let helperScript = null; const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(url);
    if (!helperScript) throw new TypeError("Failed to fetch");
    if (url.endsWith("/status")) { const r = helperScript.statuses[Math.min(helperScript.i++, helperScript.statuses.length - 1)]; return { ok: true, json: async () => r }; }
    return { ok: true, blob: async () => new Blob([helperScript.bytes]) };
  };
  const uploads = [];
  const driveStorage = {
    isEnabled: () => true, maxBytes: () => 1e9,
    uploadFile: async (file) => { uploads.push(file.name); return { driveId: `d-${uploads.length}`, name: file.name, mimeType: "application/octet-stream", size: file.size }; },
    trashFiles() {}, getThumbUrl: async () => { throw new Error("sin miniatura"); }, downloadBlob: async () => new Blob(["x"]),
  };
  const mount = (atts0 = []) => {
    const box = document.createElement("div"), drop = document.createElement("div");
    document.body.append(box, drop);
    const atts = [...atts0];
    const ui = createFileAttachments({ container: box, dropTarget: drop, storage: driveStorage, getAttachments: () => atts, addAttachment: (x) => atts.push(x), removeAttachment() {}, currentUser: { uid: "u1", name: "Ramón" }, getTaskId: () => "T1", getProjectId: () => "P1", onDirty() {}, makeThumbnail: async () => null });
    const drops = (files) => { const input = $('input[type="file"]', box); Object.defineProperty(input, "files", { value: files, configurable: true }); fire(input, "change"); };
    return { box, drop, ui, atts, drops, done: () => { box.remove(); drop.remove(); } };
  };
  const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleepReal(25); } return false; };
  const att = (id, name) => ({ id, kind: "drive", driveId: `d-${id}`, name, size: 100 });

  // a) primera vez ('ask'): se pregunta; «Activar» sube el .ipt y arranca la conversión, y el STP llega y se sube SOLO
  localStorage.removeItem("chusy_step_auto");
  uploads.length = 0; fetched.length = 0;
  helperScript = { i: 0, statuses: [{ status: "converting" }, { status: "done", name: "Nuevo_26001.stp", size: 3 }], bytes: new Uint8Array([7, 8, 9]) };
  let t = mount();
  t.drops([new File(["xyz"], "Nuevo_26001.ipt"), new File(["1"], "Notas.txt")]);
  await sleepReal(60);
  check("primera vez: el .txt sube ya; el .ipt espera a la pregunta (no se sube todavía) y no se ha lanzado nada", uploads.join() === "Notas.txt" && !!$(".cad-assistant-overlay") && fetched.length === 0, uploads);
  click($('[data-act="enable"]'));
  check("… al activar se guarda la preferencia 'on'", await waitFor(() => localStorage.getItem("chusy_step_auto") === "on"));
  check("… el .ipt sube de inmediato, SIN esperar a la conversión", await waitFor(() => uploads.includes("Nuevo_26001.ipt")));
  check("… se muestra un aviso con el progreso y se pregunta al canal local", await waitFor(() => $(".step-tray__item") && fetched.some((u) => /^http:\/\/127\.0\.0\.1:\d+\/[a-z0-9]{32}\/status$/.test(u))));
  check("… cuando el ayudante entrega el .stp, SE SUBE SOLO a la tarea (sin botones ni elegir nada)", await waitFor(() => uploads.includes("Nuevo_26001.stp")) && t.atts.some((x) => x.name === "Nuevo_26001.stp"), uploads);
  check("… y el aviso pasa a «creado»", await waitFor(() => $(".step-tray__item.is-ok")));
  $$(".step-tray__close").forEach((b) => b.click());

  // b) modo 'on': ni pregunta ni nada; también con varios .ipt/.iam a la vez (uno a uno, cada uno con su canal y su clave)
  uploads.length = 0; fetched.length = 0;
  helperScript = { i: 0, statuses: [{ status: "done", name: "Dos.stp", size: 1 }], bytes: new Uint8Array([1]) };
  t.drops([new File(["a"], "Uno.ipt"), new File(["bb"], "Dos.iam")]);
  await waitFor(() => uploads.includes("Uno.ipt") && uploads.includes("Dos.iam"));
  check("modo automático: sin pregunta, los dos nativos suben ya y cada uno arranca SU conversión (dos canales distintos)", !$(".cad-assistant-overlay") && new Set(fetched.map((u) => u.split("/")[3] + u.split("/")[4])).size >= 2, fetched);
  await sleepReal(300);
  $$(".step-tray__close").forEach((b) => b.click());

  // c) un .ipt con su STEP en el mismo lote, o ya adjunto, no convierte nada
  uploads.length = 0; fetched.length = 0;
  t.drops([new File(["1"], "Par.ipt"), new File(["2"], "Par.step")]);
  await sleepReal(120);
  check("con su .step en el mismo lote: sube todo directo y no se lanza ninguna conversión", uploads.sort().join() === "Par.ipt,Par.step" && fetched.length === 0 && !$(".step-tray__item"), uploads);
  t.done();
  t = mount([att("k1", "Tapa.stp")]);
  uploads.length = 0; fetched.length = 0;
  t.drops([new File(["5"], "Tapa.ipt")]);
  await sleepReal(120);
  check("con su .stp ya adjunto a la tarea: sube directo y no convierte", uploads.join() === "Tapa.ipt" && fetched.length === 0);

  // d) el ayudante no responde: aviso con «Reintentar» y «Subir el .STP a mano»; el .ipt ya está subido
  uploads.length = 0; fetched.length = 0; helperScript = null;
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  t.drops([new File(["q"], "Sola.ipt")]);
  check("sin ayudante: el .ipt sube igualmente", await waitFor(() => uploads.includes("Sola.ipt")));
  skew = 30000; // el tiempo de cortesía (20 s) se agota sin esperar de verdad
  check("… el aviso dice que no se detectó el ayudante y ofrece reintentar y subir el .STP a mano", await waitFor(() => $(".step-tray__item.is-error") && /ayudante/.test($(".step-tray__text").textContent) && $$(".step-tray__actions button").map((b) => b.textContent).join() === "Reintentar,Subir el .STP a mano"), $(".step-tray__text") && $(".step-tray__text").textContent);
  let picker = null; const origClick = window.HTMLInputElement.prototype.click;
  window.HTMLInputElement.prototype.click = function () { picker = this; };
  const manual = $$(".step-tray__actions button").find((b) => b.textContent === "Subir el .STP a mano");
  click(manual);
  check("… «Subir el .STP a mano» abre un selector de .step/.stp (varios)", picker && picker.accept === ".step,.stp" && picker.multiple === true && !$(".step-tray__item"));
  window.HTMLInputElement.prototype.click = origClick;
  Date.now = realNow; skew = 0;

  // e) 'off': el .ipt sube sin preguntar ni convertir; y fuera de Windows igual
  localStorage.setItem("chusy_step_auto", "off");
  uploads.length = 0; fetched.length = 0;
  t.drops([new File(["z"], "Libre.ipt")]);
  await sleepReal(120);
  check("modo 'off' («No convertir nunca»): sube sin preguntar y sin convertir", uploads.join() === "Libre.ipt" && !$(".cad-assistant-overlay") && fetched.length === 0);
  localStorage.setItem("chusy_step_auto", "on"); setUa("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari");
  uploads.length = 0;
  t.drops([new File(["z"], "Mac.ipt")]);
  await sleepReal(120);
  check("fuera de Windows no se intenta convertir (aunque esté 'on')", uploads.join() === "Mac.ipt" && fetched.length === 0);
  setUa(WIN_UA); localStorage.setItem("chusy_step_auto", "on");

  // f) cerrar la tarea cancela las conversiones en curso
  fetched.length = 0; helperScript = { i: 0, statuses: [{ status: "converting" }], bytes: new Uint8Array([1]) };
  t.drops([new File(["z"], "Cierre.ipt")]);
  await waitFor(() => fetched.length > 0);
  t.ui.destroy();
  const afterDestroy = fetched.length;
  await sleepReal(900);
  check("destroy() de los adjuntos cancela la conversión: no se sigue preguntando al canal", fetched.length <= afterDestroy + 1, [afterDestroy, fetched.length]);
  $$(".step-tray__item").forEach((n) => n.remove());
  t.done();
  globalThis.fetch = realFetch;
  localStorage.removeItem("chusy_step_auto");

  // --- el visor: «Convertir» crea el STP, lo sube a la tarea y lo abre
  const viewer = await import("../js/components/cad-viewer-modal.js");
  let started = null; let resolveJob;
  const startConversion = (o) => { started = o; return { promise: new Promise((r) => { resolveJob = r; }), cancel() { started.cancelled = true; } }; };
  const upl = [];
  const h = viewer.openCadViewerModal({ attachment: { id: "n", name: "Eje.ipt", size: 99 }, attachmentsPool: [], storage: {}, onUploadStep: (f) => upl.push(f), deps: { startConversion, loadEngine: async () => { throw new Error("motor de pruebas: sin 3D"); } } });
  await h.ready;
  click($('[data-act="convert"]'));
  started.onStatus({ status: "searching" });
  check("visor: «Convertir» arranca la conversión y muestra el paso en el que va", /Buscando el archivo/.test($(".cad-viewer-message").textContent));
  const stp = new File([new Uint8Array([1, 2, 3])], "Eje.stp");
  resolveJob({ ok: true, file: stp });
  await sleepReal(60);
  check("visor: al llegar el STP lo sube a la tarea SOLO (onUploadStep) y lo abre en el visor (aquí sin motor 3D: error del motor, no del flujo)", upl.length === 1 && upl[0] === stp && /Eje\.stp/.test($('[data-cad="subtitle"]').textContent) && /motor de pruebas/.test($(".cad-viewer-message").textContent) && $('[data-cad="upload-step"]').hidden === true);
  h.close();
  const h2 = viewer.openCadViewerModal({ attachment: { id: "n", name: "Eje.ipt", size: 99 }, attachmentsPool: [], storage: {}, deps: { startConversion } });
  await h2.ready;
  click($('[data-act="convert"]'));
  resolveJob({ ok: false, reason: "no-helper", message: "No se detectó el ayudante." });
  await sleepReal(40);
  check("visor: si falla, vuelve a la pantalla de «falta el STEP» con el motivo y los botones", /No se detectó el ayudante/.test($(".cad-viewer-need__error").textContent) && !$(".cad-viewer-need__error").hidden && !!$('[data-act="convert"]') && !!$('[data-act="local"]'));
  click($('[data-act="convert"]'));
  h2.close();
  check("visor: cerrar el visor cancela la conversión en curso", started.cancelled === true);
  clearBodyAll();
}
function clearBodyAll() { $$(".cad-viewer-overlay, .cad-assistant-overlay, .modal-overlay, .step-tray").forEach((n) => n.remove()); }

// ---------------------------------------------------------------- 4) extremo a extremo: el script REAL de PowerShell contra el puente
{
  const candidates = ["pwsh", "/opt/pwsh/pwsh", "powershell"];
  let runner = null;
  for (const c of candidates) { const r = spawnSync(c, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" }); if (!r.error && r.status === 0) { runner = c; break; } }
  if (!runner) {
    console.log("  (extremo a extremo omitido: no hay `pwsh` ni `powershell`)");
  } else {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "chusy-e2e-"));
    const fix = (p) => p.replace(/^\/([A-Za-z]:)/, "$1");
    const script = fix(new URL("../assets/convertir-step/convertir-step.ps1", import.meta.url).pathname);
    const e2e = fix(new URL("./fixtures/convertir-step.e2e.ps1", import.meta.url).pathname);
    const dir = path.join(work, "Proyecto", "Piezas"); fs.mkdirSync(dir, { recursive: true });
    const ipt = path.join(dir, "Eje_26001.ipt"); fs.writeFileSync(ipt, "ABCD");
    const when = new Date("2026-11-10T10:00:00Z"); fs.utimesSync(ipt, when, when);
    const env = { ...process.env, LOCALAPPDATA: path.join(work, "appdata"), APPDATA: path.join(work, "roaming"), TEMP: work };
    fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
    const run = (extra) => {
      const args = ["-NoProfile", ...(process.platform === "win32" ? ["-ExecutionPolicy", "Bypass"] : []), "-File", e2e, "-Script", script, ...extra];
      const child = spawn(runner, args, { env });
      let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
      return { exit: new Promise((r) => child.on("close", (code) => r({ code, out: () => out }))), out: () => out };
    };
    const convert = (params, extra = {}) => bridge.startStepConversion({ fileName: "Eje_26001.ipt", size: 4, lastModified: when.getTime(), launch: async () => true, bridge: params, graceMs: 40000, pollMs: 150, ...extra });

    // (1) por ruta completa: el ayudante crea el .stp, Chusy lo recoge por el canal y NO se abre el Explorador
    let params = bridge.createBridgeParams();
    let child = run(["-IptPath", ipt, "-Port", String(params.port), "-Token", params.token]);
    const seen = [];
    let res = await convert(params, { onStatus: (s) => seen.push(s.status) }).promise;
    let ended = await child.exit;
    check("extremo a extremo: Chusy recoge el .stp que crea el script (mismos bytes) por el canal local", res.ok === true && res.file.name === "Eje_26001.stp" && res.file.size === 400 && new Uint8Array(await res.file.arrayBuffer())[0] === 1, res.ok ? res.file.size : res);
    check("… viendo el progreso en directo (searching/converting/done)", seen.includes("converting") && seen.at(-1) === "done", seen);
    check("… el .stp queda junto al .ipt, con su mismo nombre", fs.existsSync(path.join(dir, "Eje_26001.stp")));
    check("… como Chusy lo recogió, NO se abre el Explorador (se sube a la tarea)", ended.code === 0 && !/EXPLORER:/.test(ended.out()) && /Entregado a Chusy/.test(ended.out()), ended.out());
    const memoryFile = path.join(env.LOCALAPPDATA, "Chusy", "convertir-step-memoria.json");
    const memory = fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile, "utf8")) : null;
    check("… y recuerda la carpeta del .ipt para la próxima vez", !!memory && memory.folders[0] === dir && memory.files.some((f) => f.name === "eje_26001.ipt" && f.path === ipt), memory);

    // (2) SOLO por nombre, tamaño y fecha (como llega de verdad desde Chusy): la memoria lo localiza SIN preguntar
    fs.rmSync(path.join(dir, "Eje_26001.stp"));
    params = bridge.createBridgeParams();
    child = run(["-IptName", "Eje_26001.ipt", "-Size", "4", "-Modified", String(when.getTime()), "-Port", String(params.port), "-Token", params.token]);
    res = await convert(params).promise;
    ended = await child.exit;
    check("extremo a extremo: con solo nombre, tamaño y fecha, el script ENCUENTRA el archivo por la memoria (sin ventana de elección) y lo convierte", res.ok === true && /Encontrado \(memoria\)/.test(ended.out()) && ended.code === 0, ended.out());

    // (3) un archivo nuevo de la misma carpeta (nunca visto): también por la carpeta recordada
    const ipt2 = path.join(dir, "Brida_26001.ipt"); fs.writeFileSync(ipt2, "XY"); fs.utimesSync(ipt2, when, when);
    params = bridge.createBridgeParams();
    child = run(["-IptName", "Brida_26001.ipt", "-Size", "2", "-Modified", String(when.getTime()), "-Port", String(params.port), "-Token", params.token]);
    res = await bridge.startStepConversion({ fileName: "Brida_26001.ipt", size: 2, lastModified: when.getTime(), launch: async () => true, bridge: params, graceMs: 40000, pollMs: 150 }).promise;
    ended = await child.exit;
    check("extremo a extremo: un .ipt NUEVO de una carpeta ya recordada también se encuentra solo", res.ok === true && res.file.name === "Brida_26001.stp" && /Encontrado \(memoria\)/.test(ended.out()), ended.out());

    // (4) fallo de Inventor: el motivo llega a Chusy
    params = bridge.createBridgeParams();
    child = run(["-IptPath", ipt, "-Mode", "fail", "-Port", String(params.port), "-Token", params.token]);
    res = await convert(params).promise;
    ended = await child.exit;
    check("extremo a extremo: si Inventor falla, Chusy recibe el motivo (reason «error», con E_FAIL)", res.ok === false && res.reason === "error" && /E_FAIL/.test(res.message) && ended.code === 1, res);

    // (5) sin que Chusy recoja nada (página cerrada): el script abre el Explorador con el .stp, como antes
    fs.rmSync(path.join(dir, "Eje_26001.stp"), { force: true });
    params = bridge.createBridgeParams();
    child = run(["-IptPath", ipt, "-Port", "1", "-Token", "x"]); // puerto y clave NO válidos: no se abre ningún canal
    ended = await child.exit;
    check("sin canal con Chusy (puerto no válido): crea el .stp y abre el Explorador con él seleccionado", ended.code === 0 && /EXPLORER: \/select,"[^"]*Eje_26001\.stp"/.test(ended.out()) && fs.existsSync(path.join(dir, "Eje_26001.stp")), ended.out());
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 5) el script (estático)
{
  const ps = read("assets/convertir-step/convertir-step.ps1");
  const code = ps.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  check("convertir-step.ps1: ASCII y CRLF", /^[\x00-\x7F]*$/.test(ps) && !/[^\r]\n/.test(ps));
  check("… parámetros -Port y -Token (el canal con Chusy) y la lectura de port/token de la URL", /\[int\]\$Port = 0/.test(code) && /\[string\]\$Token = ''/.test(code) && /ContainsKey\('port'\)/.test(code) && /ContainsKey\('token'\)/.test(code));
  check("… la memoria: archivo en %LOCALAPPDATA%\\Chusy\\convertir-step-memoria.json, se lee antes de buscar y se guarda tras encontrar", /convertir-step-memoria\.json/.test(code) && /function Read-Memory/.test(code) && /function Save-Memory/.test(code) && /Save-Memory \$source/.test(code) && /Key = 'memory'/.test(code));
  check("… las carpetas del Explorador abierto y la última del navegador (Preferences → selectfile.last_directory)", /Shell\.Application/.test(code) && /\.Windows\(\)/.test(code) && /selectfile\.last_directory/.test(code) && /Google\\Chrome\\User Data/.test(code) && /Microsoft\\Edge\\User Data/.test(code));
  check("… el canal: solo 127.0.0.1, clave obligatoria, /status y /file, CORS y permiso de red privada, y entrega antes de abrir el Explorador", /\[System\.Net\.IPAddress\]::Loopback/.test(code) && /-cne \$Token/.test(code) && /'status'/.test(code) && /'file'/.test(code) && /Access-Control-Allow-Origin/.test(code) && /Access-Control-Allow-Private-Network/.test(code) && /Wait-StepServed 25/.test(code) && !/0\.0\.0\.0|IPAddress\]::Any/.test(code));
  check("… el estado que ve Chusy: searching, dialog, converting, done y error", ["'searching'", "'dialog'", "'converting'", "'done'", "'error'"].every((s) => code.includes(`Set-StepState ${s}`)));
  check("… el puerto y la clave se validan antes de abrir el canal", /\$script:Port -ge 1024 -and \$script:Port -le 65535 -and \$script:Token -match '\^\[A-Za-z0-9_-\]\{8,64\}\$'/.test(code));
  check("… lo elegido a mano en la ventana también se recuerda (Save-Memory tras Find-SourceFile)", code.indexOf("Find-SourceFile -ExplicitPath") < code.indexOf("Save-Memory $source"));
  const leeme = read("assets/convertir-step/LEEME.txt");
  check("LEEME.txt: explica la entrega automática, la memoria y volver a instalar", /sube el \.stp a la tarea/i.test(leeme) && /recuerda/i.test(leeme) && /Instalar-ConvertirStep\.bat/.test(leeme));
}

// ---------------------------------------------------------------- 6) entrega
{
  const idx = read("index.html");
  // (la entrega actual la fija v93-tags-suggest-and-mytasks-columns.test.mjs: aquí basta con que sea ≥ 92 y esté bien puesta en los 14)
  const linkVersions = [...idx.matchAll(/css\/[\w-]+\.css\?v=(\d+)/g)].map((m) => Number(m[1]));
  eq("index.html: los 14 <link> con el mismo ?v=N (≥ 92)", new Set(linkVersions).size + ":" + linkVersions.length + ":" + (linkVersions[0] >= 92), "1:14:true");
  const pkgVersion = (f) => Number(String(JSON.parse(read(f)).version).split(".")[0]);
  check("package.json y package-lock.json: versión ≥ 92 y la misma", pkgVersion("package.json") >= 92 && pkgVersion("package.json") === pkgVersion("package-lock.json"));
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES.find((x) => x.id === 92);
  check("Novedades: entrada 92, mayor que la 91, sobre la conversión automática y la subida del STP", !!r && r.id > RELEASES.find((x) => x.id === 91).id && /automátic/i.test(r.title) && /STP/.test(JSON.stringify(r)) && /Instalar-ConvertirStep\.bat/.test(JSON.stringify(r)) && r.items.length >= 3, r.title);
  const css = read("css/07-modals.css");
  check("CSS: la bandeja de avisos (.step-tray) con variables de tema", [".step-tray", ".step-tray__item", ".step-tray__spinner", ".step-tray__actions", ".cad-viewer-need__error"].every((c) => css.includes(c)) && /\.step-tray__item \{[^}]*var\(--color-panel\)/.test(css));
  const readme = read("README.md");
  check("README: historial v91 → v92, el puente (step-bridge.js), la memoria y volver a instalar", /v91 → v92 \(Chusy-92\.zip\)/.test(readme) && /step-bridge\.js/.test(readme) && /convertir-step-memoria\.json/.test(readme) && /Instalar-ConvertirStep\.bat/.test(readme) && /v92-conversion-automatica/.test(readme));
  check("tests/run-all.mjs menciona la v92", /v92/.test(read("tests/run-all.mjs")));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v92 · Conversión automática a STP: sin preguntar, con memoria de carpetas y entrega del .stp a la tarea");
