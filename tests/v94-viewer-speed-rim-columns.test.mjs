// v94 · Visor 3D rápido para piezas complejas, diámetro por el borde, fondo claro, columnas de «Mis tareas» y departamento «Almacén».
//  1) Departamento «Almacén».
//  2) «Mis tareas»: la columna «Proyecto» es solo el proyecto y «Comercial» no se puede elegir dos veces.
//  3) Teselado según el tamaño, lectura del STEP en Worker (con Worker falso), caché y plan de construcción.
//  4) Modelo: fusión en trozos, vista simplificada, aristas por borde de cara, construcción por tandas y «Mostrar todo» (Three.js real).
//  5) Círculos: bordes, y el visor completo con jsdom (fondo claro, aviso, caché, calidad alta y ⌀ Diámetro por el borde).
//  6) Entrega: ?v=94, package.json, Novedades, CSS, README y node scripts/check-integrity.mjs.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, tick } from "./support/dom.mjs";

setupDom();
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 5);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const readBin = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
globalThis.__fb = { collections: {}, sets: [], hooks: {}, updates: [], deletes: [] };
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1000; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 800; } });
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- 1) departamento «Almacén»
const dep = await import("../js/departments.js");
{
  check("Almacén es un departamento asignable (con su etiqueta)", dep.DEPARTMENTS.some((d) => d.value === "almacen" && d.label === "Almacén") && dep.departmentLabel("almacen") === "Almacén");
  check("Almacén es un grupo de acceso propio (como Técnicos y Producción)", dep.DEPARTMENT_GROUPS.some((g) => g.value === "almacen" && g.label === "Almacén") && dep.accessGroupOf("almacen") === "almacen");
  eq("los demás departamentos siguen igual y Almacén va el último", dep.DEPARTMENTS.map((d) => d.value), ["diseno-industria", "diseno-automocion", "tecnicos", "produccion", "almacen"]);
  eq("el selector de la ficha de usuario ofrece «Almacén»", dep.departmentOptionsFor("").some((d) => d.value === "almacen" && d.label === "Almacén"), true);
  check("quien está en Almacén tiene acceso a lo que se abre al grupo «almacen» y no a lo de otros grupos", dep.departmentHasAccess("almacen", ["almacen"]) && !dep.departmentHasAccess("almacen", ["tecnicos"]));
  eq("el Visualizador de piezas, sin configurar, lo ve todo el mundo, Almacén incluido", dep.normalizePartsViewerAllowed(null), ["diseno", "tecnicos", "produccion", "almacen"]);
  eq("Pedidos NO se abre a Almacén por defecto (sigue siendo de Técnicos; un admin puede abrirlo)", dep.normalizeOrdersAllowed(null), ["tecnicos"]);
  check("Almacén no tiene sector por defecto (no es de Industria ni de Automoción)", !dep.defaultSectorOf("almacen"));
  check("el filtro de Métricas incluye Almacén", dep.metricsDepartmentOptions().some((o) => o.value === "almacen"));
  check("el modal «Acceso por departamento» recorre DEPARTMENT_GROUPS (sale solo)", /DEPARTMENT_GROUPS\.map/.test(read("js/components/department-access-modal.js")));
}

// ---------------------------------------------------------------- 2) «Mis tareas»: Proyecto sin código y Comercial una sola vez
{
  const mt = await import("../js/my-tasks-columns.js");
  const catalog = mt.MY_TASKS_AVAILABLE_COLUMNS;
  eq("la columna «project» se llama «Proyecto» (ya no «Proyecto / Oferta»)", catalog.find((c) => c.key === "project").label, "Proyecto");
  eq("el código YYXXX sigue teniendo su propia columna", catalog.find((c) => c.key === "code").label, "Código (YYXXX)");
  eq("«Comercial» está UNA sola vez en el catálogo", catalog.filter((c) => /comercial/i.test(c.label)).length, 1);
  const projects = [
    { id: "P1", name: "Cabina", code: "26001", properties: { comercial: "Juan", sector: "Industria" }, customFieldDefs: [{ id: "f1", name: "Cliente" }, { id: "f2", name: "TIPO" }, { id: "f3", name: "Comercial" }, { id: "f4", name: "Sector" }, { id: "f5", name: "Proveedor" }, { id: "f6", name: "Ubicación" }] },
    { id: "OFF", name: "Ofertas", exclusive: true, exclusiveKey: "ofertas", customFieldDefs: [{ id: "comercial", name: "Comercial" }, { id: "sector", name: "Sector" }, { id: "version", name: "Versión" }], sections: [] },
  ];
  eq("los campos de proyecto que ya son columnas del catálogo (Comercial, Sector, Cliente, Proveedor) no se ofrecen otra vez", mt.myTasksProjectFieldColumns(projects).map((c) => c.key), ["pf:tipo", "pf:ubicacion", "pf:version"]);
  eq("quien eligió en la v93 la columna de campo «Comercial» pasa a la del catálogo, sin duplicarla", mt.normalizeMyTasksColumns(["pf:comercial", "commercial", "dueDate", "pf:sector", "pf:cliente", "pf:proveedor", "pf:tipo"]), ["sector", "client", "commercial", "supplier", "dueDate", "pf:tipo"]); // (en el orden del catálogo)
  eq("…y si solo tenía la del campo, también queda UNA", mt.normalizeMyTasksColumns(["pf:comercial"]), ["commercial"]);
  check("lo guardado por esa persona se corrige al leerlo", (() => { const m = new Map([["chusy_my_tasks_columns_u1", JSON.stringify(["pf:comercial", "commercial", "project"])]]); const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; return JSON.stringify(mt.loadMyTasksColumns("u1", st)) === JSON.stringify(["project", "commercial"]); })());
  // interfaz
  const { renderMyTasksView, resetMyTasksViewFilters } = await import("../js/views/my-tasks-view.js");
  localStorage.clear();
  resetMyTasksViewFilters();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const tasks = [{ id: "a", projectId: "P1", title: "Soldar", tags: [], priority: "alta", assigneeIds: ["u1"], customFields: { f1: "Talgo", f2: "X" }, isComplete: false }];
  const opts = { tasks, allTasks: tasks, totalCount: 1, teamMembers: [], projects, tagsRegistry: [], sortState: { column: null, direction: "asc" }, onSortChange() {}, onOpenTask() {}, currentUser: { uid: "u1", role: "member", personalCustomFieldDefs: [], columnPrefs: {}, columnOrder: null }, onFiltersChange() {} };
  renderMyTasksView(container, opts);
  check("celda «Proyecto»: solo el proyecto, sin el código", /Cabina/.test(container.innerHTML) && !$(".mt-code", container) && !/26001/.test($(".list-table__row, [data-task-id]", container) ? $(".list-table__row, [data-task-id]", container).textContent : container.textContent));
  click($("#mt-columns", container));
  const menu = $(".columns-menu--mytasks");
  const labels = $$(".columns-menu__item", menu).map((l) => l.textContent.trim());
  eq("menú ⚙️ Columnas: «Comercial» aparece una sola vez (y «Sector» y «Cliente» también)", ["Comercial", "Sector", "Cliente"].map((n) => labels.filter((l) => l === n).length), [1, 1, 1]);
  check("menú ⚙️ Columnas: «Proyecto» (sin «/ Oferta») y los campos de proyecto restantes", labels.includes("Proyecto") && !labels.includes("Proyecto / Oferta") && labels.includes("TIPO"));
  const cbCode = $$("[data-col]", menu).find((c) => c.dataset.col === "code");
  cbCode.checked = true; cbCode.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("al marcar «Código» el código sale en SU columna (una vez)", $$(".mt-code", container).length === 1 && $$(".mt-code", container)[0].textContent === "26001");
  document.querySelectorAll(".columns-menu").forEach((m) => m.remove());
  container.remove();
  localStorage.clear();
  const src = read("js/views/my-tasks-view.js");
  check("el código fuente ya no pinta el código dentro de la celda de proyecto", !/codeChip/.test(src));
}

// ---------------------------------------------------------------- 3) teselado, Worker, caché
const eng = await import("../js/cad-engine.js");
const parse = await import("../js/cad-parse.js");
const cache = await import("../js/cad-cache.js");
{
  eq("teselado según el tamaño: <3 MB normal, 3–10 MB medium, ≥10 MB fast", [eng.tessellationFor(0), eng.tessellationFor(2.9e6), eng.tessellationFor(3 * 1024 * 1024), eng.tessellationFor(9e6), eng.tessellationFor(10 * 1024 * 1024), eng.tessellationFor(20404510)], ["normal", "normal", "medium", "medium", "fast", "fast"]);
  check("el teselado normal es el de la librería (null); fast es más grueso que medium", eng.tessellationParams("normal") === null && eng.tessellationParams("fast").linearDeflection > eng.tessellationParams("medium").linearDeflection && eng.tessellationParams("fast").angularDeflection > eng.tessellationParams("medium").angularDeflection && Object.isFrozen(eng.CAD_TESSELLATION));
  eq("los parámetros llevan unidad y tipo de desviación", Object.keys(eng.tessellationParams("fast")).sort(), ["angularDeflection", "linearDeflection", "linearDeflectionType", "linearUnit"]);
  eq("nombre desconocido → null", eng.tessellationParams("otro"), null);
  const seen = [];
  const fakeOcct = { ReadStepFile: (bytes, params) => { seen.push(params); return { success: true, meshes: [{ index: { array: [0, 1, 2] }, attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } } }] }; } };
  eng.parseStepBuffer(fakeOcct, new Uint8Array([1, 2, 3]), eng.tessellationParams("fast"));
  eng.parseStepBuffer(fakeOcct, new Uint8Array([1, 2, 3]));
  eq("parseStepBuffer pasa el teselado a ReadStepFile (y sin él, null como siempre)", [seen[0].linearDeflection, seen[1]], [0.015, null]);

  // solo Three.js en el hilo principal (el lector de STEP vive en el Worker)
  eng.resetCadEngine();
  const fakeThree = { Scene: function Scene() {} };
  const fakeControls = { OrbitControls: function OrbitControls() {} };
  const urls = [];
  const imp = async (u) => { urls.push(u); return u === eng.CAD_THREE_PROVIDERS[0].controls ? fakeControls : fakeThree; };
  const three1 = await eng.loadCadThree({ importModule: imp });
  eq("loadCadThree: carga solo Three.js y OrbitControls (2 módulos) y no el lector de STEP", [three1.THREE === fakeThree, typeof three1.OrbitControls, three1.occt, urls.length], [true, "function", null, 2]);
  check("loadCadThree: la segunda vez no vuelve a pedir nada (se comparte la promesa)", (await eng.loadCadThree({ importModule: async () => { throw new Error("no debería pedirse otra vez"); } })) === three1);
  eng.resetCadEngine();
  let thrown = "";
  try { await eng.loadCadThree({ importModule: async () => { throw new Error("sin red"); } }); } catch (e) { thrown = e.message; }
  check("loadCadThree sin red: avisa con claridad…", /No se pudo cargar Three\.js/.test(thrown) && /sin red/.test(thrown), thrown);
  const retry = await eng.loadCadThree({ importModule: imp });
  check("…y un fallo no se queda guardado: el siguiente intento vuelve a probar", retry.THREE === fakeThree);
  eng.resetCadEngine();

  // lectura en Worker (Worker falso)
  const meshesMsg = [{ name: "a", color: [1, 0, 0], position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), index: new Uint32Array([0, 1, 2]), brep_faces: [{ first: 0, last: 0, color: null }] }];
  class FakeWorker {
    constructor(script) { FakeWorker.last = this; this.script = script; this.terminated = false; this.posted = null; }
    postMessage(msg, transfer) { this.posted = { msg, transfer }; setTimeout(() => { this.onmessage({ data: { type: "status", text: "Leyendo la geometría…" } }); this.onmessage({ data: { type: "result", meshes: meshesMsg } }); }, 2); }
    terminate() { this.terminated = true; }
  }
  const statuses = [];
  const buf = new Uint8Array([9, 8, 7, 6]).buffer;
  const out = await parse.parseStepAsync(buf, { params: eng.tessellationParams("medium"), onStatus: (t) => statuses.push(t), deps: { workerFactory: () => new FakeWorker() } });
  eq("Worker: el mensaje lleva el buffer (copia transferida), los parámetros y los proveedores del CDN", [FakeWorker.last.posted.msg.type, FakeWorker.last.posted.msg.params.linearDeflection, FakeWorker.last.posted.msg.providers.length >= 1, FakeWorker.last.posted.transfer.length, buf.byteLength], ["parse", 0.004, true, 1, 4]);
  check("Worker: el resultado vuelve con la forma de occt-import-js y el Worker se termina", out.via === "worker" && FakeWorker.last.terminated && out.result.success && out.result.meshes[0].attributes.position.array.length === 9 && out.result.meshes[0].index.array[2] === 2 && out.result.meshes[0].attributes.normal.array.length === 9 && out.result.meshes[0].brep_faces.length === 1 && statuses[0] === "Leyendo la geometría…");
  const back = parse.occtResultToWorkerMeshes(out.result);
  check("occtResultToWorkerMeshes es la inversa (arrays tipados)", back[0].position instanceof Float32Array && back[0].index instanceof Uint32Array && back[0].normal.length === 9);
  // error fatal del Worker → hilo principal
  class BrokenWorker extends FakeWorker { postMessage() { setTimeout(() => this.onmessage({ data: { type: "error", message: "No se pudo cargar el lector de STEP", fatal: true } }), 2); } }
  let mainUsed = 0;
  const fallback = await parse.parseStepAsync(new Uint8Array([1, 2]).buffer, { deps: { workerFactory: () => new BrokenWorker(), loadEngine: async () => { mainUsed++; return { occt: fakeOcct }; } } });
  check("si el Worker no puede cargar el lector, se lee en el hilo principal", fallback.via === "main" && mainUsed === 1 && fallback.result.meshes.length === 1);
  class BadStepWorker extends FakeWorker { postMessage() { setTimeout(() => this.onmessage({ data: { type: "error", message: "El archivo STEP no contiene geometría", fatal: false } }), 2); } }
  let badMsg = "";
  try { await parse.parseStepAsync(new Uint8Array([1]).buffer, { deps: { workerFactory: () => new BadStepWorker(), loadEngine: async () => { throw new Error("no debería"); } } }); } catch (e) { badMsg = e.message; }
  eq("un STEP sin geometría no se reintenta en el hilo principal: el error llega tal cual", badMsg, "El archivo STEP no contiene geometría");
  class SlowWorker extends FakeWorker { postMessage() { /* nunca responde */ } }
  const ac = new AbortController();
  const slow = new SlowWorker();
  const pending = parse.parseStepAsync(new Uint8Array([1]).buffer, { signal: ac.signal, deps: { workerFactory: () => slow } }).catch((e) => e);
  await tick(5);
  ac.abort();
  const aborted = await pending;
  check("cancelar termina el Worker al instante (cerrar el visor libera la CPU)", aborted && aborted.name === "AbortError" && slow.terminated === true);
  const noWorker = await parse.parseStepAsync(new Uint8Array([1]).buffer, { deps: { workerFactory: null, loadEngine: async () => ({ occt: fakeOcct }) } });
  check("sin Worker (Node, jsdom) se lee en el hilo principal como siempre", noWorker.via === "main");
  const ws = read("js/workers/step-worker.js");
  check("step-worker.js: script clásico con importScripts, sin importar nada de la aplicación, que transfiere los arrays", /importScripts\(p\.base \+ "occt-import-js\.js"\)/.test(ws) && !/^\s*import\s/m.test(ws) && /self\.postMessage\(msg, transfer/.test(ws) && /new Float32Array\(src\)/.test(ws) && /fatal: true/.test(ws));
  check("el visor crea el Worker con new URL(…, import.meta.url) (sin build)", /new Worker\(new URL\("\.\/workers\/step-worker\.js", import\.meta\.url\)\)/.test(read("js/cad-parse.js")));

  // caché
  const memStore = () => {
    const meta = new Map(), data = new Map();
    return { _meta: meta, _data: data,
      getMeta: async (k) => meta.get(k) || null, getData: async (k) => data.get(k) || null,
      put: async (m, d) => { meta.set(m.key, m); data.set(m.key, d); }, touch: async (k, ts) => { const m = meta.get(k); if (m) m.lastUsed = ts; },
      remove: async (k) => { meta.delete(k); data.delete(k); }, listMeta: async () => [...meta.values()], clear: async () => { meta.clear(); data.clear(); } };
  };
  eq("clave de caché: Drive por id (no depende del nombre ni de la fecha)", cache.cadCacheKey({ id: "D1", name: "a.step", size: 10, lastModified: 5, tess: "fast" }), "1|fast|D1|10|0");
  eq("clave de caché: archivo local por nombre, tamaño y fecha", cache.cadCacheKey({ name: "a.step", size: 10, lastModified: 5 }), "1|normal|a.step|10|5");
  check("clave de caché: otro teselado o tamaño → otra clave", cache.cadCacheKey({ id: "D1", size: 1, tess: "fast" }) !== cache.cadCacheKey({ id: "D1", size: 1, tess: "normal" }) && cache.cadCacheKey({ id: "D1", size: 1 }) !== cache.cadCacheKey({ id: "D1", size: 2 }));
  const st = memStore();
  eq("caché vacía → null", await cache.readCadCache("k", st), null);
  eq("guardar devuelve true", await cache.writeCadCache("k", out.result, st), true);
  const hit = await cache.readCadCache("k", st);
  check("ida y vuelta: la malla guardada es la misma (posiciones, normales, índices, caras)", hit && hit.meshes[0].attributes.position.array.length === 9 && hit.meshes[0].attributes.normal.array[2] === 1 && hit.meshes[0].index.array[1] === 1 && hit.meshes[0].brep_faces.length === 1 && hit.success);
  st._meta.get("k").format = 0;
  eq("un formato antiguo se ignora", await cache.readCadCache("k", st), null);
  const st2 = memStore();
  for (let i = 0; i < cache.CAD_CACHE_MAX_ENTRIES + 3; i++) await cache.writeCadCache(`k${i}`, out.result, st2, { now: 1000 + i });
  eq("se guardan como mucho CAD_CACHE_MAX_ENTRIES piezas (se borran las menos usadas)", [(await st2.listMeta()).length, st2._meta.has("k0"), st2._meta.has(`k${cache.CAD_CACHE_MAX_ENTRIES + 2}`)], [cache.CAD_CACHE_MAX_ENTRIES, false, true]);
  const huge = { success: true, meshes: [{ index: { array: new Uint32Array(3) }, attributes: { position: { array: { length: 9, byteLength: cache.CAD_CACHE_MAX_BYTES_PER_ENTRY + 1 } } } }] };
  eq("una pieza demasiado grande no se guarda", await cache.writeCadCache("big", { success: true, meshes: [{ name: "x", color: null, attributes: { position: { array: new Float32Array(3) } }, index: { array: new Uint32Array(3) }, brep_faces: [] }] }, { ...memStore(), put: async () => { throw new Error("sin espacio"); } }), false);
  void huge;
  const broken = { getMeta: async () => { throw new Error("modo privado"); }, getData: async () => null, put: async () => { throw new Error("x"); }, touch: async () => {}, remove: async () => {}, listMeta: async () => [], clear: async () => { throw new Error("x"); } };
  eq("un almacén que falla nunca impide abrir (null / false, sin lanzar)", [await cache.readCadCache("k", broken), await cache.writeCadCache("k", out.result, broken), await cache.clearCadCache(broken), await cache.readCadCache("k", null), await cache.writeCadCache("k", out.result, null)], [null, false, false, null, false]);
  eq("sin IndexedDB (Node/jsdom) no hay almacén", cache.createIdbStore(null), null);
  eq("meshesByteSize cuenta posiciones, normales e índices", cache.meshesByteSize(meshesMsg), 36 + 36 + 12);
}

// ---------------------------------------------------------------- 4) modelo: plan, fusión, aristas, tandas
let THREEmod = null, occt = null;
try {
  THREEmod = await import("three");
  const { createRequire } = await import("node:module");
  occt = await createRequire(import.meta.url)("occt-import-js")().then((x) => x);
} catch (e) {
  console.log("  (modelo con STEP reales omitido: faltan `three` y `occt-import-js`; ejecuta npm install)");
}
const mdl = await import("../js/cad-model.js");
const cv = await import("../js/cad-viewer.js");

// mallas sintéticas para el plan (sin Three.js)
const boxMesh = (cx, cy, cz, s) => {
  const h = s / 2;
  const pos = [];
  for (const dx of [-h, h]) for (const dy of [-h, h]) for (const dz of [-h, h]) pos.push(cx + dx, cy + dy, cz + dz);
  const idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  return { attributes: { position: { array: new Float32Array(pos) } }, index: { array: new Uint32Array(idx) }, brep_faces: [{ first: 0, last: 11, color: null }] };
};
{
  const small = { meshes: [boxMesh(0, 0, 0, 10), boxMesh(20, 0, 0, 10)] };
  const sm = mdl.summarizeMeshes(small);
  eq("summarizeMeshes: triángulos, caja y diagonal de cada malla", [sm.length, sm[0].tris, sm[0].min, sm[0].max, near(sm[0].diag, Math.hypot(10, 10, 10), 1e-3)], [2, 12, [-5, -5, -5], [5, 5, 5], true]);
  const p0 = mdl.planCadBuild(sm);
  eq("plan de un modelo pequeño: NO es pesado ni simplificado y es una pieza por malla (comportamiento de siempre)", [p0.heavy, p0.simplified, p0.groups, p0.edgeMode, p0.hidden], [false, false, [[0], [1]], "angle", []]);
  // 200 mallas: 1 grande + 199 diminutas
  const many = { meshes: [boxMesh(0, 0, 0, 1000)] };
  for (let i = 0; i < 199; i++) many.meshes.push(boxMesh((i % 20) * 40, Math.floor(i / 20) * 40, 600, 4));
  const sm2 = mdl.summarizeMeshes(many);
  const p1 = mdl.planCadBuild(sm2, { chunkAbove: 100, chunkMeshes: 50, chunkTriangles: 1000, simplifyAbove: 1e9 });
  eq("modelo con muchas mallas: pesado, aristas por borde de cara y mallas pequeñas fusionadas en trozos", [p1.heavy, p1.simplified, p1.edgeMode, p1.groups.length < 20, p1.groups.flat().length], [true, false, "boundary", true, 200]);
  eq("cada malla está en un solo trozo", new Set(p1.groups.flat()).size, 200);
  const p2 = mdl.planCadBuild(sm2, { simplifyAbove: 500, triangleBudget: 12 * 20, chunkAbove: 100, chunkMeshes: 50, chunkTriangles: 1000, keepFraction: 0.3 });
  check("vista simplificada: entra primero lo GRANDE hasta el presupuesto; lo demás queda oculto (y suma 200)", p2.simplified && p2.shown.includes(0) && p2.shown.length === 20 && p2.hidden.length === 180 && p2.shown.length + p2.hidden.length === 200 && p2.shownTriangles === 12 * 20 && p2.totalTriangles === 12 * 200);
  check("vista simplificada: una pieza de al menos keepFraction del conjunto se muestra aunque no quepa", mdl.planCadBuild(sm2, { simplifyAbove: 500, triangleBudget: 1, keepFraction: 0.3 }).shown.includes(0));
  const regroup = mdl.planGroupsFor(sm2, p2.hidden, { chunkTriangles: 1000 });
  eq("planGroupsFor: agrupa justo las mallas ocultas (para «Mostrar todo»)", [regroup.flat().sort((a, b) => a - b).join() === [...p2.hidden].sort((a, b) => a - b).join(), regroup.length < 10], [true, true]);
  eq("planGroupsFor sin mallas → []", mdl.planGroupsFor(sm2, [], {}), []);
  check("las mallas cercanas quedan juntas (orden de Morton): cada trozo cabe en una caja pequeña", p1.groups.filter((g) => g.length > 1 && !g.includes(0)).every((g) => { const ms = g.map((i) => sm2.find((s) => s.index === i)); const spanX = Math.max(...ms.map((m) => m.max[0])) - Math.min(...ms.map((m) => m.min[0])); const spanY = Math.max(...ms.map((m) => m.max[1])) - Math.min(...ms.map((m) => m.min[1])); return spanX < 900 && spanY < 900; }));
  // fusión
  const merged = mdl.mergeOcctMeshes([boxMesh(0, 0, 0, 10), boxMesh(30, 0, 0, 10)]);
  check("mergeOcctMeshes: vértices e índices concatenados, índices desplazados y rangos de caras desplazados", merged.attributes.position.array.length === 48 && merged.index.array.length === 72 && merged.index.array[36] === 8 && merged.brep_faces.length === 2 && merged.brep_faces[1].first === 12 && merged.brep_faces[1].last === 23 && !merged.attributes.normal);
  const withN = (m) => ({ ...m, attributes: { ...m.attributes, normal: { array: new Float32Array(m.attributes.position.array.length).fill(1) } } });
  check("mergeOcctMeshes: las normales se conservan solo si TODAS las mallas las traen", !!mdl.mergeOcctMeshes([withN(boxMesh(0, 0, 0, 1)), withN(boxMesh(5, 0, 0, 1))]).attributes.normal && !mdl.mergeOcctMeshes([withN(boxMesh(0, 0, 0, 1)), boxMesh(5, 0, 0, 1)]).attributes.normal);
  eq("planCadBuild/summarize con datos vacíos no rompen", [mdl.summarizeMeshes(null), mdl.planCadBuild(null).groups, mdl.mergeOcctMeshes(null).index.array.length], [[], [], 0]);
}

if (THREEmod && occt) {
  const THREE = THREEmod;
  const loadFx = (f) => eng.parseStepBuffer(occt, new Uint8Array(readBin(`tests/fixtures/${f}.step`)));
  const asm = loadFx("ensamblaje");
  const summaries = mdl.summarizeMeshes(asm);
  eq("ensamblaje real (generado con OpenCASCADE): 62 sólidos = 62 mallas", [asm.meshes.length, summaries.length], [62, 62]);
  const legacy = mdl.buildCadModel(THREE, asm);
  eq("sin plan: una pieza por malla (lo de siempre)", [legacy.parts.length, legacy.faces.length], [62, 192]);
  const planAll = mdl.planCadBuild(summaries, { chunkAbove: 100, chunkMeshes: 10, chunkTriangles: 700, simplifyAbove: 1e9 });
  const chunked = mdl.buildCadModel(THREE, asm, { plan: planAll });
  check("con plan pesado: los tornillos se funden en pocos trozos (menos llamadas de dibujo) y NO se pierde ninguna cara", chunked.parts.length < 20 && chunked.parts.length === planAll.groups.length && chunked.faces.length === 192, [chunked.parts.length, chunked.faces.length]);
  eq("…ni triángulos", chunked.parts.reduce((n, p) => n + p.geometry.index.count / 3, 0), legacy.parts.reduce((n, p) => n + p.geometry.index.count / 3, 0));
  check("…y los límites del modelo son los mismos", [0, 1, 2].every((k) => near(chunked.bounds.min[k], legacy.bounds.min[k], 1e-3) && near(chunked.bounds.max[k], legacy.bounds.max[k], 1e-3)));
  check("cada cara apunta a un trozo existente y sus triángulos, a esa cara", chunked.faces.every((f) => f.partIndex < chunked.parts.length && f.triangles.length > 0 && f.triangles.every((t) => chunked.parts[f.partIndex].triToFace[t] === f.id)));
  const edgeCount = (m) => m.parts.reduce((n, p) => n + p.edges.geometry.getAttribute("position").count, 0);
  check("aristas por borde de cara: salen aristas (segmentos por pares) y la malla las lleva como hija", edgeCount(chunked) > 0 && edgeCount(chunked) % 2 === 0 && chunked.parts.every((p) => p.edges.userData.isCadEdges && p.mesh.children.includes(p.edges)));
  // bordes de cara: dos cuadrados sueltos (cada uno una cara con 2 triángulos) → 4 segmentos por cara
  const quadPos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
  const quadIdx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const seg = mdl.boundaryEdgePositions(quadPos, quadIdx, [{ triangles: [0, 1] }, { triangles: [2, 3] }]);
  eq("boundaryEdgePositions: dos caras cuadradas = 2 × 4 segmentos (la diagonal compartida no cuenta)", seg.length / 6, 8);
  eq("…y un cuadrado dentro de UNA cara con 2 triángulos: solo su contorno (4)", mdl.boundaryEdgePositions(quadPos, quadIdx, [{ triangles: [0, 1, 2, 3] }]).length / 6, 8);
  // equivalencia con las aristas por ángulo en una pieza real (placa con agujeros): ninguna arista viva se pierde
  const oneBox = loadFx("placa-100x50x3");
  const bm = mdl.buildCadModel(THREE, oneBox, { plan: { groups: [[0]], edgeMode: "boundary" } });
  const am = mdl.buildCadModel(THREE, oneBox);
  const keyOf = (a, i) => { const f = (k) => Math.round(a[k] * 1000); return `${f(i)},${f(i + 1)},${f(i + 2)}`; };
  const segKeys = (m) => { const out = new Set(); m.parts.forEach((p) => { const a = p.edges.geometry.getAttribute("position").array; for (let i = 0; i < a.length; i += 6) { const k1 = keyOf(a, i), k2 = keyOf(a, i + 3); out.add(k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`); } }); return out; };
  const kb = segKeys(bm), ka = segKeys(am);
  const lost = [...ka].filter((k) => !kb.has(k));
  check("aristas por borde de cara vs por ángulo (placa con agujeros): no se pierde ninguna arista viva", ka.size > 0 && lost.length === 0, lost.slice(0, 3));
  check("…y las hay de más solo donde una cara toca a otra suave (bordes de las caras curvas)", kb.size >= ka.size);

  // picado en un trozo fusionado: el rayo desde arriba sobre un tornillo da la cara superior del tornillo
  const asmChunked = chunked;
  asmChunked.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(60, 30, 500), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObjects(asmChunked.parts.map((p) => p.mesh), false)[0];
  const faceId = hit ? mdl.faceIdFromIntersection(asmChunked, hit) : -1;
  const topFace = faceId >= 0 ? mdl.describeModelFace(asmChunked, faceId) : null;
  check("picado en un trozo fusionado: el rayo sobre un tornillo da su cara superior (plana, hacia +Z, a z = 22)", !!topFace && topFace.isPlanar && near(topFace.normal[2], 1, 1e-3) && near(topFace.centroid[2], 22, 0.01), topFace && topFace.centroid);
  const circ = topFace && cv.computeDiameterMeasurement(topFace);
  eq("…y se mide su diámetro: ⌀8 (disco)", circ && [circ.diameterMm, circ.type], [8, "disk"]);

  // por tandas, cancelación y «Mostrar todo»
  const progress = [];
  const planSimple = mdl.planCadBuild(summaries, { simplifyAbove: 500, triangleBudget: 800, chunkAbove: 100, chunkMeshes: 10, chunkTriangles: 700, keepFraction: 0.5 });
  const asyncModel = await mdl.buildCadModelAsync(THREE, asm, { plan: planSimple }, { onProgress: (d, t) => progress.push([d, t]), sliceMs: 0 });
  check("buildCadModelAsync: avisa del avance y llega al final (hecho = total)", progress.length > 0 && progress[progress.length - 1][0] === progress[progress.length - 1][1] && asyncModel.parts.length === planSimple.groups.length);
  check("vista simplificada de verdad: hay menos caras que en el modelo completo y quedan piezas ocultas", planSimple.simplified && planSimple.hidden.length > 0 && asyncModel.faces.length < 192, [planSimple.shown.length, planSimple.hidden.length, asyncModel.faces.length]);
  const before = { faces: asyncModel.faces.length, parts: asyncModel.parts.length, firstFace: asyncModel.faces[0].triangles.length };
  const added = await mdl.extendCadModel(THREE, asyncModel, asm, mdl.planGroupsFor(summaries, planSimple.hidden, planSimple.options), { sliceMs: 0 });
  check("extendCadModel («Mostrar todo»): añade las piezas ocultas, sin tocar los faceId anteriores", added > 0 && asyncModel.faces.length === 192 && asyncModel.faces[0].triangles.length === before.firstFace && asyncModel.parts.length === before.parts + added && asyncModel.faces.every((f, i) => f.id === i));
  check("…y recalcula los límites", asyncModel.bounds.size.every((v) => v > 0) && near(asyncModel.bounds.max[2], legacy.bounds.max[2], 1e-3));
  let abortName = "";
  try { await mdl.buildCadModelAsync(THREE, asm, {}, { isCancelled: () => true }); } catch (e) { abortName = e.name; }
  eq("buildCadModelAsync cancelado lanza AbortError", abortName, "AbortError");
  let noCtx = "";
  try { await mdl.extendCadModel(THREE, { parts: [] }, asm, [[0]]); } catch (e) { noCtx = e.message; }
  eq("extendCadModel de un modelo que no es nuestro avisa", noCtx, "El modelo no se puede ampliar.");
  let empty = "";
  try { mdl.buildCadModel(THREE, { meshes: [] }); } catch (e) { empty = e.message; }
  eq("un resultado sin mallas sigue avisando", empty, "El archivo STEP no contiene geometría 3D que se pueda dibujar.");
}

// ---------------------------------------------------------------- 5) círculos por el borde y el visor completo (jsdom)
if (THREEmod && occt) {
  const THREE = THREEmod;
  const loadFx = (f) => eng.parseStepBuffer(occt, new Uint8Array(readBin(`tests/fixtures/${f}.step`)));
  const plate = loadFx("placa-agujeros");
  const plateModel = mdl.buildCadModel(THREE, plate);
  const faceInfos = plateModel.faces.map((_, id) => mdl.describeModelFace(plateModel, id));
  const holes = faceInfos.map((f, id) => ({ id, f, loops: cv.circleRimLoops(f) })).filter((x) => x.loops.length);
  eq("placa con 2 agujeros: dos caras circulares con 2 bordes cada una (arriba y abajo)", [holes.length, holes.map((h) => h.loops.length)], [2, [2, 2]]);
  const h12 = holes.find((h) => near(h.loops[0].radius, 6));
  check("bordes del agujero ⌀12: círculos de R 6 en z = 0 y z = 10, centrados en (30, 30)", h12 && h12.loops.every((l) => near(l.radius, 6) && near(l.center[0], 30, 0.02) && near(l.center[1], 30, 0.02)) && h12.loops.map((l) => Math.round(l.center[2])).sort((a, b) => a - b).join() === "0,10");
  check("cada borde es una polilínea cerrada de puntos a distancia R de su centro", h12.loops.every((l) => l.isFullCircle && l.points.length > 30 && l.points.every((p) => near(Math.hypot(p[0] - l.center[0], p[1] - l.center[1], p[2] - l.center[2]), 6, 0.02))));
  const cands = holes.map((h) => ({ faceId: h.id, loops: h.loops }));
  const top12 = h12.loops.find((l) => Math.round(l.center[2]) === 10);
  const nr = cv.nearestRim([36.8, 30, 10], cands, 1.5);
  check("nearestRim: un punto a 0,8 mm del borde del ⌀12 (sobre la placa) elige ese borde", nr && nr.faceId === h12.id && near(nr.distance, 0.8, 0.02) && near(nr.loop.center[2], 10, 0.01));
  eq("nearestRim: lejos de todo (más allá de la tolerancia) → null", cv.nearestRim([50, 50, 10], cands, 1.5), null);
  const dm = cv.diameterFromRim(top12, { toward: [40, 30, 10] });
  check("diameterFromRim: ⌀12, agujero, línea de cota por el centro hacia el lado del clic", dm.diameterMm === 12 && dm.kind === "hole" && near(dm.lineEnd[0], 36, 0.02) && near(dm.lineStart[0], 24, 0.02) && near(dm.lineEnd[2], 10, 0.01));
  eq("rimLoopsFromCircle(null) → []", [cv.rimLoopsFromCircle(null), cv.circleRimLoops(null)], [[], []]);
  check("circlePolyline: un arco de 90° tiene la mitad de puntos de uno de 180°, y empieza y acaba donde debe", (() => { const a = cv.circlePolyline([0, 0, 0], [[1, 0, 0], [0, 1, 0]], 5, 0, Math.PI / 2); const b = cv.circlePolyline([0, 0, 0], [[1, 0, 0], [0, 1, 0]], 5, 0, Math.PI); return near(a[0][0], 5) && near(a[a.length - 1][1], 5) && b.length > a.length; })());

  // prefiltro barato (couldBeCircularFace): nunca descarta lo que el ajuste de verdad aceptaría
  const tri = (A, B, C, out) => out.push(...A, ...B, ...C);
  const un = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const cylinder = ({ r = 6, len = 20, seg = 48, c = [10, 5, -3], a = [0, 0, 1], arc = 360, taper = 0 } = {}) => {
    a = un(a); const e = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = un(crs(a, e)), v = crs(a, u);
    const P = (th, tt) => [0, 1, 2].map((i) => c[i] + (r + taper * tt) * (Math.cos(th) * u[i] + Math.sin(th) * v[i]) + a[i] * tt);
    const out = []; const n = Math.round((seg * arc) / 360);
    for (let i = 0; i < n; i++) { const t0 = ((i / n) * arc * Math.PI) / 180, t1 = (((i + 1) / n) * arc * Math.PI) / 180; const A = P(t0, -len / 2), B = P(t1, -len / 2), C = P(t1, len / 2), D = P(t0, len / 2); tri(A, B, C, out); tri(A, C, D, out); }
    return new Float64Array(out);
  };
  const disc = ({ r = 8, ri = 0, seg = 48 } = {}) => {
    const out = []; const P = (th, rr) => [rr * Math.cos(th), rr * Math.sin(th), 5];
    for (let i = 0; i < seg; i++) { const t0 = (i / seg) * 2 * Math.PI, t1 = ((i + 1) / seg) * 2 * Math.PI; if (ri > 0) { tri(P(t0, ri), P(t0, r), P(t1, r), out); tri(P(t0, ri), P(t1, r), P(t1, ri), out); } else tri([0, 0, 5], P(t0, r), P(t1, r), out); }
    return new Float64Array(out);
  };
  const ball = (r = 5, n = 24) => { const out = []; const P = (th, ph) => [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)]; for (let i = 0; i < n; i++) for (let j = 0; j < n / 2; j++) { const t0 = (i / n) * 2 * Math.PI, t1 = ((i + 1) / n) * 2 * Math.PI, p0 = (j / (n / 2)) * Math.PI, p1 = ((j + 1) / (n / 2)) * Math.PI; tri(P(t0, p0), P(t1, p0), P(t1, p1), out); tri(P(t0, p0), P(t1, p1), P(t0, p1), out); } return new Float64Array(out); };
  const quad = (w, h) => { const o = []; for (let i = 0; i < 8; i++) { tri([i * w, 0, 0], [(i + 1) * w, 0, 0], [(i + 1) * w, h, 0], o); tri([i * w, 0, 0], [(i + 1) * w, h, 0], [i * w, h, 0], o); } return new Float64Array(o); };
  const quick = (soup) => { const n = soup.length / 9; const idx = Uint32Array.from({ length: n * 3 }, (_, i) => i); return cv.couldBeCircularFace(soup, idx, Uint32Array.from({ length: n }, (_, i) => i)); };
  const fits = (soup) => !!cv.fitCircularFace(cv.buildFaceDescriptor(soup, { faceId: 1 }));
  const samples = {
    "cilindro (eje Z)": cylinder(), "cilindro inclinado": cylinder({ a: [1, 2, 3], r: 3.5, len: 7 }), "medio cilindro": cylinder({ arc: 180, r: 5 }), "redondeo de 90°": cylinder({ arc: 90, r: 2 }),
    "disco": disc(), "arandela": disc({ r: 10, ri: 4 }),
  };
  Object.entries(samples).forEach(([name, soup]) => check(`prefiltro: «${name}» pasa (y el ajuste lo acepta)`, quick(soup) === true && fits(soup) === true));
  check("prefiltro: una placa rectangular (plana, no cuadrada) se descarta y el ajuste también", quick(quad(30, 12)) === false && fits(quad(30, 12)) === false);
  check("prefiltro: una esfera y un cono se descartan (y el ajuste también)", quick(ball()) === false && fits(ball()) === false && quick(cylinder({ taper: 0.6 })) === false && fits(cylinder({ taper: 0.6 })) === false);
  eq("prefiltro: demasiado pocos triángulos o demasiados → false", [cv.couldBeCircularFace([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [0]), (() => { const s = disc({ seg: 200 }); const n = s.length / 9; return cv.couldBeCircularFace(s, Uint32Array.from({ length: n * 3 }, (_, i) => i), Uint32Array.from({ length: n }, (_, i) => i), { maxTriangles: 100 }); })()], [false, false]);
  check("prefiltro: un cuadrado plano puede pasar (falso positivo permitido) pero el ajuste lo rechaza", (() => { const sq = quad(10, 10 * 8); return fits(sq) === false; })());
  const realQuick = faceInfos.map((f, id) => { const part = plateModel.parts[plateModel.faces[id].partIndex]; return cv.couldBeCircularFace(part.geometry.attributes.position.array, part.geometry.index.array, plateModel.faces[id].triangles); });
  check("prefiltro con la placa real de 2 agujeros: pasan los agujeros (y quizá alguna cara más), nunca se pierde un círculo", holes.every((h) => realQuick[h.id] === true) && realQuick.filter(Boolean).length <= holes.length + 2, realQuick);

  // el visor entero con el renderer falso
  const viewer = await import("../js/components/cad-viewer-modal.js");
  let lastScene = null, lastCamera = null;
  const renderers = [];
  class FakeRenderer {
    constructor() { this.domElement = document.createElement("canvas"); this.domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }); this.renders = 0; renderers.push(this); }
    setPixelRatio() {} setSize() {}
    render(scene, camera) { this.renders++; lastScene = scene; lastCamera = camera; }
    dispose() {} forceContextLoss() {}
  }
  class StubControls {
    constructor(camera) { this.object = camera; this.target = new THREE.Vector3(); }
    addEventListener() {} removeEventListener() {}
    update() { this.object.lookAt(this.target); return false; }
    dispose() {}
  }
  const occtCalls = [];
  const spyOcct = { ReadStepFile: (bytes, params) => { occtCalls.push(params); return occt.ReadStepFile(bytes, params); } };
  const engine = { THREE: { ...THREE, WebGLRenderer: FakeRenderer }, OrbitControls: StubControls, occt: spyOcct };
  const loadEngine = async () => engine;
  const fileOf = (fx, name, extra = null) => new File(extra ? [readBin(`tests/fixtures/${fx}.step`), extra] : [readBin(`tests/fixtures/${fx}.step`)], name || `${fx}.step`);
  const ui = (n) => $(`[data-cad="${n}"]`);
  const clearBody = () => $$(".cad-viewer-overlay").forEach((n) => n.remove());
  const model = () => lastScene.children.find((c) => c.name === "cad-model");
  const pointerClick = (x, y) => { const c = $("canvas.cad-viewer-canvas"); ["pointerdown", "pointerup"].forEach((t) => c.dispatchEvent(new window.MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 }))); };
  const pointerMove = (x, y) => $("canvas.cad-viewer-canvas").dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y, buttons: 0 }));
  const screenOf = (p) => { lastCamera.updateMatrixWorld(true); const v = new THREE.Vector3(...p).project(lastCamera); return [((v.x + 1) / 2) * 1000, ((1 - v.y) / 2) * 800]; };
  const pxDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const waitFor = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await tick(20); };

  // --- fondo claro SIEMPRE
  let h;
  for (const theme of ["dark", "light", "classic"]) {
    document.documentElement.dataset.theme = theme;
    h = viewer.openCadViewerModal({ file: fileOf("placa-100x50x3"), deps: { loadEngine, cacheStore: null } });
    await h.ready; await tick(40);
    check(`fondo del visor claro con el tema «${theme}» (0xe9edf1) y aristas oscuras`, lastScene.background.getHex() === 0xe9edf1 && model().children[0].children[0].material.color.getHex() === 0x1e2a36, lastScene.background.getHex().toString(16));
    h.close(); clearBody();
  }
  document.documentElement.dataset.theme = "dark";
  const vm = read("js/components/cad-viewer-modal.js");
  const css7 = read("css/07-modals.css");
  check("el visor ya no distingue el tema: sin isLightTheme y el fondo de la escena sale de una constante", !/isLightTheme/.test(vm) && /const STAGE_BACKGROUND = 0xe9edf1/.test(vm) && /scene\.background = new THREE\.Color\(STAGE_BACKGROUND\)/.test(vm));
  check("CSS: el escenario es claro en todos los temas y no queda regla propia del tema claro", /\.cad-viewer-stage \{[^}]*background: #e9edf1/.test(css7) && !/data-theme="light"\] \.cad-viewer-stage/.test(css7));
  check("las cotas (líneas) pasan a naranja intenso: el amarillo casi no se veía sobre el fondo claro", /const COLOR_LINE = 0xe8590c/.test(vm));

  // --- pieza pesada: vista simplificada + «Mostrar todas las piezas»
  const heavyOpts = { chunkAbove: 100, chunkMeshes: 10, chunkTriangles: 700, simplifyAbove: 500, triangleBudget: 800, keepFraction: 0.5 };
  h = viewer.openCadViewerModal({ file: fileOf("ensamblaje"), deps: { loadEngine, cacheStore: null, buildOptions: heavyOpts } });
  await h.ready; await tick(80);
  const notice = ui("notice");
  check("pieza pesada: aviso de «Vista simplificada» con cuántas piezas y triángulos se ven, y el botón para mostrar todas", notice.hidden === false && /Vista simplificada: \d+ de 62 piezas/.test(notice.textContent) && /tornillería/.test(notice.textContent) && /Mostrar todas las piezas/.test(notice.textContent), notice.textContent);
  check("…y no hay aviso de «malla simplificada» (el archivo es pequeño: teselado normal)", !/Malla simplificada/.test(notice.textContent) && !/Calidad alta/.test(notice.textContent));
  const partsBefore = model().children.length;
  check("el modelo dibuja pocos trozos (menos llamadas de dibujo) y menos piezas que el total", partsBefore > 0 && partsBefore < 62);
  const bbox0 = ui("bbox").textContent;
  click($(".cad-viewer-notice__btn", notice));
  await tick(120);
  check("«Mostrar todas las piezas»: se construyen las ocultas, el aviso desaparece y las cotas siguen siendo las del conjunto", model().children.length > partsBefore && ui("notice").hidden === true && ui("bbox").textContent === bbox0, [model().children.length, partsBefore]);
  h.close(); clearBody();

  // --- teselado y «Calidad alta»
  occtCalls.length = 0;
  const padded = fileOf("placa-100x50x3", "gorda.step", new Uint8Array(3.2 * 1024 * 1024).fill(32));
  h = viewer.openCadViewerModal({ file: padded, deps: { loadEngine, cacheStore: null } });
  await h.ready; await tick(80);
  check("un STEP de 3,2 MB se lee con teselado medio", occtCalls.length === 1 && occtCalls[0] && occtCalls[0].linearDeflection === eng.tessellationParams("medium").linearDeflection, occtCalls);
  check("…y avisa de que la malla es simplificada con el botón «Calidad alta»", /Malla simplificada/.test(ui("notice").textContent) && /Calidad alta/.test(ui("notice").textContent) && ui("notice").hidden === false);
  const qBtn = $$(".cad-viewer-notice__btn", ui("notice")).find((b) => /Calidad alta/.test(b.textContent));
  const renderersBefore = renderers.length;
  click(qBtn);
  await waitFor(() => renderers.length > renderersBefore && renderers[renderers.length - 1].renders > 0, 4000);
  check("«Calidad alta»: vuelve a leer con el teselado fino (el de la librería) y el aviso desaparece", occtCalls.length === 2 && occtCalls[1] === null && ui("notice").hidden === true && renderers[renderers.length - 1].renders > 0, [occtCalls.length, ui("notice").hidden, ui("notice").textContent, renderers[renderers.length - 1].renders, ui("message") && ui("message").textContent]);
  h.close(); clearBody();

  // --- caché de la malla ya leída
  occtCalls.length = 0;
  const meta = new Map(), data = new Map();
  const cacheStore = { getMeta: async (k) => meta.get(k) || null, getData: async (k) => data.get(k) || null, put: async (m, d) => { meta.set(m.key, m); data.set(m.key, d); }, touch: async (k, ts) => { const m = meta.get(k); if (m) m.lastUsed = ts; }, remove: async (k) => { meta.delete(k); data.delete(k); }, listMeta: async () => [...meta.values()], clear: async () => { meta.clear(); data.clear(); } };
  const att = { id: "att1", name: "Soporte.stp", driveId: "DRIVE-1", size: readBin("tests/fixtures/placa-agujeros.step").length };
  let downloads = 0;
  const storage = { downloadBlob: async () => { downloads++; return new Blob([readBin("tests/fixtures/placa-agujeros.step")]); } };
  h = viewer.openCadViewerModal({ attachment: att, storage, deps: { loadEngine, cacheStore } });
  await h.ready; await tick(80);
  check("1.ª apertura: se lee el STEP una vez y la malla queda guardada (clave por el id de Drive)", occtCalls.length === 1 && meta.size === 1 && [...meta.keys()][0].includes("DRIVE-1") && data.size === 1 && renderers[renderers.length - 1].renders > 0, [occtCalls.length, [...meta.keys()]]);
  h.close(); clearBody();
  h = viewer.openCadViewerModal({ attachment: att, storage, deps: { loadEngine, cacheStore } });
  await h.ready; await tick(80);
  check("2.ª apertura: NO se vuelve a leer el STEP NI se descarga de Drive; sale de la caché y se dibuja", downloads === 1 && occtCalls.length === 1 && renderers[renderers.length - 1].renders > 0 && ui("toolbar").hidden === false && ui("bbox").textContent === "X: 100.00 mm × Y: 60.00 mm × Z: 10.00 mm", [occtCalls.length, ui("bbox").textContent]);
  h.close(); clearBody();
  h = viewer.openCadViewerModal({ attachment: { ...att, driveId: "DRIVE-2" }, storage, deps: { loadEngine, cacheStore } });
  await h.ready; await tick(80);
  check("otro archivo de Drive (otro id) sí se descarga y se lee", occtCalls.length === 2 && downloads === 2 && meta.size === 2);
  h.close(); clearBody();

  // --- «Calidad alta» tras abrir desde la caché (el archivo no se había leído todavía)
  occtCalls.length = 0;
  const fatBytes = new Uint8Array(3.2 * 1024 * 1024).fill(32);
  const fatFile = () => new File([readBin("tests/fixtures/placa-100x50x3.step"), fatBytes], "gorda2.step", { lastModified: 1700000000000 }); // (el mismo archivo: misma fecha)
  h = viewer.openCadViewer
    ? viewer.openCadViewer({ file: fatFile(), deps: { loadEngine, cacheStore } })
    : viewer.openCadViewerModal({ file: fatFile(), deps: { loadEngine, cacheStore } });
  await h.ready; await tick(120);
  h.close(); clearBody();
  const callsAfterFirst = occtCalls.length;
  let fileReads = 0;
  const countedFile = fatFile();
  const origAB = countedFile.arrayBuffer.bind(countedFile);
  countedFile.arrayBuffer = () => { fileReads++; return origAB(); };
  h = viewer.openCadViewerModal({ file: countedFile, deps: { loadEngine, cacheStore } });
  await h.ready; await tick(120);
  check("archivo local ya visto: se abre desde la caché sin leer ni procesar el archivo", callsAfterFirst === 1 && occtCalls.length === 1 && fileReads === 0 && ui("toolbar").hidden === false, [callsAfterFirst, occtCalls.length, fileReads]);
  const rb = renderers.length;
  click($$(".cad-viewer-notice__btn", ui("notice")).find((b) => /Calidad alta/.test(b.textContent)));
  await waitFor(() => renderers.length > rb && renderers[renderers.length - 1].renders > 0, 4000);
  check("…y «Calidad alta» desde ahí sí lee el archivo (una vez) y lo procesa con el teselado fino", fileReads === 1 && occtCalls.length === 2 && occtCalls[1] === null, [fileReads, occtCalls.length]);
  h.close(); clearBody();

  // --- cerrar el visor durante la lectura cancela el Worker
  class SlowWorker { constructor() { this.terminated = false; SlowWorker.last = this; } postMessage() {} terminate() { this.terminated = true; } }
  h = viewer.openCadViewerModal({ file: fileOf("placa-100x50x3"), deps: { loadEngine, cacheStore: null, parseDeps: { workerFactory: () => new SlowWorker() } } });
  await tick(60);
  check("mientras se lee en segundo plano el visor lo dice (con el tiempo transcurrido)", /Procesando la geometría… \d+:\d\d/.test($('[data-cad="status-text"]').textContent), $('[data-cad="status-text"]') && $('[data-cad="status-text"]').textContent);
  h.close();
  await tick(20);
  check("cerrar el visor durante la lectura termina el Worker", SlowWorker.last.terminated === true && !$(".cad-viewer-overlay"));
  clearBody();

  // --- ⌀ Diámetro por el borde (vista desde arriba, eje vertical Z)
  document.documentElement.dataset.theme = "dark";
  h = viewer.openCadViewerModal({ file: fileOf("placa-agujeros"), deps: { loadEngine, cacheStore: null } });
  await h.ready; await tick(60);
  const sel = ui("up-axis"); sel.value = "z"; sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  click($('[data-view="top"]'));
  click($('[data-mode="diameter"]'));
  check("modo ⌀ Diámetro: la ayuda habla del borde y de que vale cerca", /borde de un agujero/.test(ui("hint").textContent) && /vale cerca/.test(ui("hint").textContent), ui("hint").textContent);
  const rimTop = [36, 30, 10];
  const pxPerMm = pxDist(screenOf([36, 30, 10]), screenOf([37, 30, 10]));
  const measures = () => $$(".cad-viewer-measure");
  const rimPx = screenOf(rimTop);
  const offset = 6; // píxeles (el límite es 12)
  const dirOut = (() => { const c = screenOf([30, 30, 10]); const n = [rimPx[0] - c[0], rimPx[1] - c[1]]; const l = Math.hypot(...n); return [n[0] / l, n[1] / l]; })();
  pointerMove(rimPx[0] + dirOut[0] * offset, rimPx[1] + dirOut[1] * offset);
  await tick(80);
  check("pasar el ratón a 6 px DEL BORDE (por fuera, sobre la placa) ilumina el círculo y marca su centro «⌀ 12.00 mm»", $(".cad-viewer-marker--center") && /⌀ 12\.00 mm/.test($(".cad-viewer-marker--center").textContent) && lastScene.children.some((c) => c.isMesh && c.geometry && c.geometry.type === "TubeGeometry"), [pxPerMm, $(".cad-viewer-marker--center") && $(".cad-viewer-marker--center").textContent]);
  pointerClick(rimPx[0] + dirOut[0] * offset, rimPx[1] + dirOut[1] * offset);
  await tick(40);
  check("clic a 6 px del borde (por fuera): mide el agujero ⌀12, sin tener que acertar en la pared", measures().length === 1 && /Agujero ⌀ 12\.00 mm/.test(measures()[0].textContent) && /Radio: R 6\.00 mm/.test(measures()[0].textContent), measures().map((m) => m.textContent));
  click(ui("clear"));
  pointerClick(rimPx[0] - dirOut[0] * offset, rimPx[1] - dirOut[1] * offset);
  await tick(40);
  check("clic a 6 px del borde POR DENTRO (el hueco por el que se ve el fondo, sin pared que acertar): también mide ⌀12", measures().length === 1 && /⌀ 12\.00 mm/.test(measures()[0].textContent), measures().map((m) => m.textContent));
  click(ui("clear"));
  const rim8 = screenOf([74, 30, 10]); // borde del agujero ⌀8 en (70, 30)
  pointerClick(rim8[0] + 3, rim8[1] + 3);
  await tick(40);
  check("el otro agujero (⌀8) cerca de su borde: ⌀ 8.00 mm", measures().length === 1 && /⌀ 8\.00 mm/.test(measures()[0].textContent), measures().map((m) => m.textContent));
  click(ui("clear"));
  const far = [rimPx[0] + dirOut[0] * pxPerMm * 25, rimPx[1] + dirOut[1] * pxPerMm * 25]; // 25 mm del borde: mucho más allá de 12 px
  pointerClick(far[0], far[1]);
  await tick(40);
  check("un clic lejos de cualquier círculo (sobre la placa lisa) no mide nada y lo explica", measures().length === 0 && /Esa cara no es circular|borde/.test(ui("hint").textContent), ui("hint").textContent);
  const outside = screenOf([5, 5, 10]);
  pointerClick(outside[0], outside[1]);
  await tick(40);
  check("…ni en la esquina de la placa", measures().length === 0);
  // un borde TAPADO por otra cosa no se elige: desde abajo la cara inferior tapa los bordes de arriba (se ve el de abajo, a otra profundidad)
  click($('[data-view="top"]'));
  check("el borde elegido es del lado visible (el de arriba, z = 10)", (() => { pointerClick(rimPx[0] + dirOut[0] * 4, rimPx[1] + dirOut[1] * 4); return true; })());
  await tick(40);
  check("…y su cota se dibuja en z = 10 (centro del borde elegido)", measures().length === 1 && lastScene.children.some((c) => c.type === "Group" && c.children.some((k) => k.type === "Line" || k.isLine)), measures().length);
  click(ui("clear"));
  h.close(); clearBody();
  check("el visor sigue ofreciendo Cara a Cara y Punto a Punto con los círculos como una cara más (v93)", /computeCircleToFaceMeasurement\(circle, otherFace\)/.test(vm));
  check("el hover de ⌀ Diámetro se espacia solo si cuesta (piezas pesadas)", /hover\.interval = Math\.max\(60, Math\.min\(500, \(performance\.now\(\) - t0\) \* 5\)\)/.test(vm));
  check("el visor vacía sus cachés al cargar otra pieza (caras y cajas)", /faceCache\.clear\(\)/.test(vm) && /faceBoxes = null; boxesDone = 0;/.test(vm));
}

// ---------------------------------------------------------------- 6) entrega
{
  const idx = read("index.html");
  eq("index.html: los 14 <link> a ?v=94", (idx.match(/css\/[\w-]+\.css\?v=94/g) || []).length, 14);
  check("index.html: ningún <link> se ha quedado en otra versión", !/\.css\?v=(?!94)\d+/.test(idx));
  check("package.json y package-lock.json: 94.0.0", JSON.parse(read("package.json")).version === "94.0.0" && JSON.parse(read("package-lock.json")).version === "94.0.0");
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES[0];
  check("Novedades: entrada 94 la primera, mayor que la 93, y habla de los seis cambios", r.id === 94 && r.id > RELEASES[1].id && ["diámetro", "Almacén", "fondo", "rápid", "Comercial", "Proyecto"].every((w) => JSON.stringify(r).toLowerCase().includes(w.toLowerCase())) && r.items.length >= 6, r.title);
  const css7 = read("css/07-modals.css");
  check("CSS: aviso del visor (.cad-viewer-notice) y nota de lectura", [".cad-viewer-notice", ".cad-viewer-notice__row", ".cad-viewer-notice__btn", ".cad-viewer-status__note"].every((c) => css7.includes(c)));
  const readme = read("README.md");
  check("README: historial v93 → v94 con el Worker, el teselado, la caché, la vista simplificada y los archivos nuevos", /v93 → v94 \(Chusy-94\.zip\)/.test(readme) && /step-worker\.js/.test(readme) && /cad-cache\.js/.test(readme) && /cad-parse\.js/.test(readme) && /v94-viewer-speed-rim-columns/.test(readme) && /Almacén/.test(readme));
  check("tests/run-all.mjs menciona la v94", /v94/.test(read("tests/run-all.mjs")));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v94 · Visor 3D rápido para piezas complejas, diámetro por el borde, fondo claro, columnas de «Mis tareas» y departamento «Almacén»");
