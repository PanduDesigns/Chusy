// ============================================================================
// Visor 3D industrial (v90): abre un .step/.stp (o el .ipt/.iam de Inventor, a través de su STEP gemelo) en una ventana
// con rotación orbital, vistas rápidas, aristas CAD, cotas envolventes y medición Punto a Punto, Cara a Cara y (v93) Diámetro.
// v93: ⌀ Diámetro mide agujeros, ejes, redondeos y caras circulares; en Cara a Cara, un círculo (agujero, eje, disco) se puede
// elegir como una cara más y se mide DESDE SU CENTRO hasta la otra cara (o hasta el centro de otro círculo).
//
//   openCadViewerModal({ attachment, attachmentsPool, storage, file, title, onUploadStep, deps })
//     attachment       adjunto de Drive `{ name, driveId, size, taskId?, projectId? }` (.step/.stp o .ipt/.iam)
//     attachmentsPool  adjuntos entre los que buscar el STEP gemelo de un .ipt/.iam (primero la misma tarea, luego el proyecto)
//     storage          el servicio de Drive (downloadBlob)
//     file             un File local .step/.stp (se mide al vuelo, sin subirlo a ningún sitio)
//     onUploadStep     (File) => void — si se pasa, un STEP cargado en local se puede subir a la tarea desde aquí
//     deps             solo para pruebas: { loadEngine, startConversion, launch, copyCommand }
//   Devuelve `{ close, ready }`; `ready` se resuelve cuando termina la carga inicial (con éxito o con un mensaje de error).
//
// Hay UN visor a la vez. Al cerrarlo se libera todo lo de WebGL: bucle de animación, listeners, controles, geometrías,
// materiales y el propio renderer (renderer.dispose() + forceContextLoss()).
// ============================================================================
import { el, escapeHtml, showToast } from "../utils.js";
import { formatBytes } from "../drive-files.js";
import { isAbortError } from "../drive-storage.js";
import { loadCadEngine, loadCadThree, CAD_MAX_FILE_BYTES, tessellationFor, tessellationParams } from "../cad-engine.js";
import { parseStepAsync } from "../cad-parse.js";
import { createIdbStore, readCadCache, writeCadCache, cadCacheKey } from "../cad-cache.js";
import {
  describeModelFace, faceIdFromIntersection, snapIntersection, createFaceHighlight, disposeObject3D, worldUnitsPerPixel,
  summarizeMeshes, planCadBuild, planGroupsFor, buildCadModelAsync, extendCadModel,
} from "../cad-model.js";
import {
  isDirect3dCadFile, isInventorNativeFile, getCadDisplayName, findCompanionStepAttachment, computePointToPointMeasurement,
  computeFaceToFaceMeasurement, cadViewDirection, cadUpVector, computeFitDistance, computeGridSpec, formatBoundingBoxMm, formatMm,
  describePointToPoint, describeFaceToFace, CAD_VIEW_LABELS,
  fitCircularFace, rimLoopsFromCircle, diameterFromRim, couldBeCircularFace, computeDiameterMeasurement, computeCircleToFaceMeasurement, computeCircleToCircleMeasurement, describeDiameter, describeAxisToFace,
} from "../cad-viewer.js";
import { copyConvertStepCommand, launchStepUrl } from "./convert-step-launcher.js";
import { startStepConversion, describeStepStatus } from "../step-bridge.js";

const UP_AXIS_KEY = "chusy_cad_viewer_up_axis";
const CLICK_MAX_MOVE_PX = 5;
const CLICK_MAX_MS = 700;
const SNAP_PIXELS = 12;
const COLOR_FACE_A = 0xff9f1c;
const COLOR_FACE_B = 0x2ec4b6;
const CAD_NOTE_FROM_BYTES = 6 * 1024 * 1024; // a partir de aquí se avisa de que la lectura es pesada y se hace en segundo plano
const RIM_PICK_PX = 12; // v94: ⌀ Diámetro acepta un clic a esta distancia (en píxeles) del borde de un círculo
const COLOR_HOVER = 0x6ea8fe;
const COLOR_CIRCLE = 0xb388ff; // v93: las caras circulares (agujeros, ejes, discos) se iluminan en violeta: son las que se pueden medir desde su centro
const COLOR_LINE = 0xe8590c; // v94: naranja intenso (el amarillo de antes casi no se veía sobre el fondo claro)
// v94 · El fondo del visor es SIEMPRE claro, también con la aplicación en modo oscuro: una pieza gris se distingue mal sobre fondo oscuro.
const STAGE_BACKGROUND = 0xe9edf1;
const STAGE_EDGE_COLOR = 0x1e2a36;

let active = null;

function readUpAxis() {
  try { return localStorage.getItem(UP_AXIS_KEY) === "z" ? "z" : "y"; } catch { return "y"; }
}
function writeUpAxis(axis) {
  try { localStorage.setItem(UP_AXIS_KEY, axis); } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Cierra el visor abierto (si lo hay). */
export function closeCadViewerModal() {
  if (active) active.close();
}

export function openCadViewerModal(options = {}) {
  closeCadViewerModal();
  const {
    attachment = null, attachmentsPool = [], storage = null, file = null, title = "", onUploadStep = null,
    deps = {},
  } = options;
  // v94: con el visor real solo se carga Three.js en el hilo principal (el STEP se lee en un Worker: cad-parse.js); las pruebas inyectan
  // `deps.loadEngine` (motor falso completo) y entonces se lee en el hilo principal con él.
  const loadEngine = deps.loadEngine || ((o) => loadCadThree(o));
  const parseDeps = deps.loadEngine ? { workerFactory: null, loadEngine: deps.loadEngine, ...(deps.parseDeps || {}) } : (deps.parseDeps || {});
  const cacheStore = "cacheStore" in deps ? deps.cacheStore : createIdbStore(); // null = sin caché
  const buildOptions = deps.buildOptions || {};
  const startConversion = deps.startConversion || startStepConversion;
  const launch = deps.launch || launchStepUrl;
  const copyCommand = deps.copyCommand || copyConvertStepCommand;

  const sourceName = (file && file.name) || (attachment && attachment.name) || title || "Pieza 3D";
  const root = el(`
    <div class="cad-viewer-overlay" role="dialog" aria-modal="true" aria-label="Visor 3D">
      <div class="cad-viewer-window">
        <header class="cad-viewer-head">
          <div class="cad-viewer-head__info">
            <div class="cad-viewer-title" data-cad="title"></div>
            <div class="cad-viewer-subtitle" data-cad="subtitle"></div>
          </div>
          <div class="cad-viewer-head__actions" data-cad="head-actions"></div>
          <button type="button" class="cad-viewer-close" data-cad="close" title="Cerrar (Esc)" aria-label="Cerrar">✕</button>
        </header>
        <div class="cad-viewer-toolbar" data-cad="toolbar" hidden>
          <div class="cad-viewer-group" role="group" aria-label="Vistas">
            ${["iso", "front", "top", "side"].map((v) => `<button type="button" class="cad-viewer-btn" data-view="${v}">${CAD_VIEW_LABELS[v]}</button>`).join("")}
            <button type="button" class="cad-viewer-btn" data-view="fit">Ajustar a pantalla</button>
          </div>
          <div class="cad-viewer-group" role="group" aria-label="Visualización">
            <button type="button" class="cad-viewer-btn is-active" data-toggle="edges" aria-pressed="true">Aristas CAD (Edges)</button>
            <button type="button" class="cad-viewer-btn" data-toggle="wireframe" aria-pressed="false">Alámbrico (Wireframe)</button>
            <button type="button" class="cad-viewer-btn" data-toggle="grid" aria-pressed="false">Rejilla/Ejes</button>
            <label class="cad-viewer-select" title="Qué eje de la pieza es el vertical (Inventor usa Y por defecto)">Eje vertical
              <select data-cad="up-axis"><option value="y">Y</option><option value="z">Z</option></select>
            </label>
          </div>
          <div class="cad-viewer-group" role="group" aria-label="Medir">
            <button type="button" class="cad-viewer-btn" data-mode="point-to-point" aria-pressed="false">📏 Punto a Punto</button>
            <button type="button" class="cad-viewer-btn" data-mode="face-to-face" aria-pressed="false">📐 Cara a Cara</button>
            <button type="button" class="cad-viewer-btn" data-mode="diameter" aria-pressed="false">⌀ Diámetro</button>
            <button type="button" class="cad-viewer-btn" data-cad="clear">🗑️ Limpiar medidas</button>
          </div>
        </div>
        <div class="cad-viewer-body">
          <div class="cad-viewer-stage" data-cad="stage">
            <div class="cad-viewer-notice" data-cad="notice" hidden></div>
            <div class="cad-viewer-labels" data-cad="labels"></div>
            <div class="cad-viewer-message" data-cad="message"></div>
          </div>
          <aside class="cad-viewer-panel" data-cad="panel" hidden>
            <div class="cad-viewer-panel__title">Medidas</div>
            <ol class="cad-viewer-measures" data-cad="measures"></ol>
            <p class="cad-viewer-panel__empty" data-cad="measures-empty">Elige 📏 Punto a Punto, 📐 Cara a Cara o ⌀ Diámetro y haz clic sobre la pieza.</p>
          </aside>
        </div>
        <footer class="cad-viewer-foot">
          <span class="cad-viewer-bbox" data-cad="bbox"></span>
          <span class="cad-viewer-hint" data-cad="hint"></span>
        </footer>
      </div>
    </div>`);
  const q = (name) => root.querySelector(`[data-cad="${name}"]`);
  const stage = q("stage");
  const labelsLayer = q("labels");
  const messageBox = q("message");
  const noticeBox = q("notice");
  const toolbar = q("toolbar");
  const panel = q("panel");
  const measuresList = q("measures");
  const measuresEmpty = q("measures-empty");
  const hintEl = q("hint");
  const bboxEl = q("bbox");
  const subtitleEl = q("subtitle");
  const headActions = q("head-actions");
  q("title").textContent = title || getCadDisplayName(sourceName) || sourceName;
  subtitleEl.textContent = sourceName;
  document.body.appendChild(root);

  // --- Estado --------------------------------------------------------------
  let closed = false;
  let abort = null;
  let engine = null;
  let renderer = null, scene = null, camera = null, controls = null, model = null, gridGroup = null, raycaster = null;
  let raf = 0, dirty = true, resizeObserver = null;
  let upAxis = readUpAxis();
  let mode = "none";
  let pending = null; // { kind: 'p2p', point, overlay } | { kind: 'f2f', faceId, highlight }
  let hover = { faceId: -1, mesh: null, overlay: null, ring: null, rimKey: "", at: 0, interval: 60 };
  let parseAbort = null; // v94: lectura del STEP en curso (se cancela al cerrar o al cargar otra pieza)
  let lastLoad = null; // v94: { buffer, name, size, meta } de la última carga (para «Calidad alta»)
  let buildInfo = null; // v94: { result, summaries, plan, tess, fromCache, hiddenShown } de la pieza dibujada
  const faceCache = new Map(); // v93: faceId → { face, circle } (la geometría no cambia: se describe y se ajusta una sola vez)
  let measureSeq = 0;
  const measurements = [];
  const overlays = [];
  const toggles = { edges: true, wireframe: false, grid: false };
  let downPoint = null;
  let localStepFile = null;
  let uploadBtn = null; // «Subir este .STEP a la tarea»: solo con un STEP cargado en local y dibujado (y no subido ya)
  let localStepUploaded = false;
  let conversionJob = null; // v92: conversión automática en curso (ayudante de Windows)
  const scratch = {};

  const setHint = (text) => { hintEl.textContent = text; };
  const setMessage = (node) => {
    messageBox.replaceChildren();
    if (node) { messageBox.appendChild(node); messageBox.hidden = false; } else messageBox.hidden = true;
  };
  const requestRender = () => { dirty = true; };

  // --- Carga ---------------------------------------------------------------
  function showStatus(text, progress = null, note = "") {
    const node = el(`<div class="cad-viewer-status"><div class="cad-viewer-spinner" aria-hidden="true"></div><div data-cad="status-text"></div><div class="cad-viewer-progress" hidden><span></span></div><div class="cad-viewer-status__note" hidden></div></div>`);
    node.querySelector('[data-cad="status-text"]').textContent = text;
    if (note) { const n = node.querySelector(".cad-viewer-status__note"); n.textContent = note; n.hidden = false; }
    if (progress !== null) {
      const bar = node.querySelector(".cad-viewer-progress");
      bar.hidden = false;
      bar.firstElementChild.style.width = `${Math.round(progress * 100)}%`;
    }
    setMessage(node);
  }

  function showError(text, { download = false } = {}) {
    const node = el(`<div class="cad-viewer-need cad-viewer-need--error"><div class="cad-viewer-need__icon">⚠️</div><p data-cad="error-text"></p><div class="cad-viewer-need__actions"></div></div>`);
    node.querySelector('[data-cad="error-text"]').textContent = text;
    const actions = node.querySelector(".cad-viewer-need__actions");
    if (download && attachment && storage) {
      const btn = el(`<button type="button" class="btn btn--primary">⬇ Descargar archivo</button>`);
      btn.addEventListener("click", async () => {
        const { downloadAttachment } = await import("./file-preview.js");
        downloadAttachment(attachment, storage);
      });
      actions.appendChild(btn);
    }
    const local = el(`<button type="button" class="btn">📂 Cargar archivo .STEP/.STP local</button>`);
    local.addEventListener("click", pickLocalStep);
    actions.appendChild(local);
    setMessage(node);
    toolbar.hidden = true;
    setHint("");
  }

  function showNeedStep(nativeAtt, errorText = "") {
    const nativeName = nativeAtt.name;
    const node = el(`
      <div class="cad-viewer-need">
        <div class="cad-viewer-need__icon">🧩</div>
        <h3 data-cad="need-title"></h3>
        <p>Para ver y medir un archivo de Inventor (.ipt / .iam) en 3D hace falta su gemelo <strong>.STEP</strong> o <strong>.STP</strong> con el mismo nombre, y todavía no está adjunto a esta tarea ni al proyecto.</p>
        <p class="cad-viewer-need__error" data-cad="need-error" hidden></p>
        <div class="cad-viewer-need__actions">
          <button type="button" class="btn btn--primary" data-act="convert">⚙️ Convertir este archivo a .STEP en mi PC (PowerShell)</button>
          <button type="button" class="btn" data-act="local">📂 Cargar archivo .STEP/.STP local</button>
        </div>
        <p class="cad-viewer-need__hint">El ayudante busca el archivo en tu PC, lo convierte con Inventor, <strong>sube el .STP a la tarea</strong> y lo abre aquí, sin que hagas nada más (la primera vez de una carpeta puede pedirte que elijas el archivo).
          <button type="button" class="cad-viewer-link" data-act="copy">Copiar comando de PowerShell</button></p>
      </div>`);
    node.querySelector('[data-cad="need-title"]').textContent = `Falta el modelo 3D (.STEP) de «${nativeName}»`;
    const convertInput = { fileName: nativeName, size: nativeAtt.size }; // el tamaño ayuda al ayudante a reconocer ESE archivo entre varios del mismo nombre
    node.querySelector('[data-act="convert"]').addEventListener("click", () => convertWithHelper(nativeAtt));
    if (errorText) { const e = node.querySelector('[data-cad="need-error"]'); e.textContent = errorText; e.hidden = false; }
    node.querySelector('[data-act="local"]').addEventListener("click", pickLocalStep);
    node.querySelector('[data-act="copy"]').addEventListener("click", () => copyCommand(convertInput));
    setMessage(node);
    toolbar.hidden = true;
    bboxEl.textContent = "";
    setHint("");
  }

  /** v92: crea el STP con el ayudante de Windows, lo sube a la tarea (si hay donde) y lo abre en este mismo visor. */
  function convertWithHelper(nativeAtt) {
    showStatus("Abriendo el ayudante…");
    const job = startConversion({
      fileName: nativeAtt.name, size: nativeAtt.size, launch,
      onStatus: (st) => { if (!closed && !model) showStatus(describeStepStatus(st)); },
    });
    conversionJob = job;
    job.promise.then((res) => {
      if (conversionJob === job) conversionJob = null;
      if (closed || res.reason === "cancelled") return;
      if (!res.ok) { showNeedStep(nativeAtt, res.message); return; }
      localStepFile = res.file;
      localStepUploaded = !!onUploadStep;
      if (onUploadStep) { onUploadStep(res.file); showToast(`«${res.file.name}» creado: se sube a la tarea.`); }
      subtitleEl.textContent = `${sourceName} · STP creado: ${res.file.name}`;
      loadBuffer(() => res.file.arrayBuffer(), res.file.name, res.file.size, { lastModified: res.file.lastModified });
    });
  }

  function pickLocalStep() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".step,.stp";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      if (!isDirect3dCadFile(f.name)) { showToast("Elige un archivo .step o .stp.", "error"); return; }
      localStepFile = f;
      localStepUploaded = false;
      subtitleEl.textContent = `${sourceName} · STEP local: ${f.name}`;
      loadBuffer(() => f.arrayBuffer(), f.name, f.size, { lastModified: f.lastModified });
    });
    document.body.appendChild(input);
    input.click();
  }

  const fmtElapsed = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const nf = (n) => Number(n).toLocaleString("es-ES");

  /** v94: lee el STEP (en un Worker si se puede) enseñando el tiempo transcurrido; cerrar el visor lo cancela. */
  async function readStep(buffer, tess, bytes) {
    parseAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    const started = Date.now();
    let phase = "Procesando la geometría…";
    const note = bytes >= CAD_NOTE_FROM_BYTES
      ? "Es una pieza pesada: se lee en segundo plano y tarda un poco; la próxima vez que la abras en este navegador será casi instantáneo. Puedes cerrar el visor para cancelar."
      : "";
    const paint = () => { if (!closed && !model) showStatus(`${phase} ${fmtElapsed(Date.now() - started)}`, null, note); };
    paint();
    const timer = setInterval(paint, 1000);
    try {
      const out = await parseStepAsync(buffer, { params: tessellationParams(tess), onStatus: (t) => { phase = t; paint(); }, signal: parseAbort ? parseAbort.signal : undefined, deps: parseDeps });
      return out.result;
    } finally {
      clearInterval(timer);
      parseAbort = null;
    }
  }

  async function loadBuffer(getBuffer, name, size, meta = {}, { forceTess = null } = {}) {
    if (closed) return;
    disposeScene();
    toolbar.hidden = true;
    if (size && size > CAD_MAX_FILE_BYTES) {
      showError(`«${name}» pesa ${formatBytes(size)}: es demasiado grande para abrirlo en el navegador (máximo ${formatBytes(CAD_MAX_FILE_BYTES)}).`, { download: !!attachment && !localStepFile });
      return;
    }
    try {
      showStatus("Preparando el visor 3D…");
      const enginePromise = loadEngine({ onStatus: (t) => { if (!closed && !model) showStatus(t); } });
      // v94: teselado según el tamaño y caché de la malla ya leída (IndexedDB). Con el tamaño conocido (adjuntos de Drive, archivos locales)
      // se mira la caché ANTES de bajar o leer el archivo: si está, no se descarga nada (la 2.ª vez que se abre la pieza es casi instantáneo).
      const keyFor = (t, bytes) => cadCacheKey({ id: meta.id || "", name, size: size || bytes, lastModified: meta.lastModified || 0, tess: t });
      let tess = forceTess || (size ? tessellationFor(size) : null);
      let key = tess && size ? keyFor(tess, size) : null;
      let result = key && cacheStore ? await readCadCache(key, cacheStore) : null;
      if (closed) return;
      let buffer = null;
      const bufferPromise = result ? null : Promise.resolve(getBuffer()).then((b) => { buffer = b; return b; }); // se baja mientras carga el motor 3D
      const eng = await enginePromise;
      if (bufferPromise) await bufferPromise;
      if (closed) return;
      engine = eng;
      // «Calidad alta» necesita el archivo: se guarda cómo conseguirlo (sin volver a bajarlo si ya se bajó)
      lastLoad = { getBuffer: () => (buffer ? Promise.resolve(buffer) : Promise.resolve(getBuffer()).then((b) => { buffer = b; return b; })), name, size, meta };
      if (!result) {
        const bytes = buffer.byteLength !== undefined ? buffer.byteLength : size;
        tess = tess || tessellationFor(bytes);
        key = keyFor(tess, bytes);
        if (!size && cacheStore) { result = await readCadCache(key, cacheStore); if (closed) return; } // tamaño desconocido: segunda oportunidad con el real
      }
      const fromCache = !!result;
      if (fromCache) showStatus("Abriendo la pieza guardada en este navegador…");
      else result = await readStep(buffer, tess, buffer.byteLength !== undefined ? buffer.byteLength : size);
      if (closed) return;
      await buildSceneAsync(eng, result, { tess, fromCache });
      if (closed) return;
      setMessage(null);
      if (!fromCache && cacheStore) writeCadCache(key, result, cacheStore); // sin esperar: no retrasa lo que ya se ve
    } catch (e) {
      if (closed || isAbortError(e)) return;
      console.error("cad-viewer:", e);
      showError(e && e.message ? e.message : "No se pudo abrir el archivo en 3D.", { download: !!attachment && !localStepFile });
    }
  }

  function downloadAndLoad(att, note) {
    abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (note) subtitleEl.textContent = note;
    return loadBuffer(async () => {
      let loaded = 0;
      const blob = await storage.downloadBlob(att, {
        type: "application/octet-stream",
        signal: abort ? abort.signal : undefined,
        onProgress: ({ loaded: l, total }) => {
          loaded = l;
          if (!closed && !model && total) showStatus(`Descargando «${att.name}»… ${formatBytes(l)} de ${formatBytes(total)}`, Math.min(1, l / total));
        },
      });
      return blob.arrayBuffer();
    }, att.name, Number(att.size) || 0, { id: att.driveId || att.id || "" });
  }

  // --- Escena --------------------------------------------------------------
  async function buildSceneAsync(eng, result, { tess, fromCache }) {
    const { THREE, OrbitControls } = eng;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      throw new Error("Este navegador no puede crear el contexto gráfico WebGL necesario para el visor 3D.");
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.insertBefore(renderer.domElement, stage.firstChild);
    renderer.domElement.className = "cad-viewer-canvas";
    scene = new THREE.Scene();
    scene.background = new THREE.Color(STAGE_BACKGROUND);
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.7));
    const headlight = new THREE.DirectionalLight(0xffffff, 0.9); // luz pegada a la cámara: el sombreado sigue al girar
    headlight.position.set(0.4, 0.8, 1);
    camera.add(headlight);
    // v94: las piezas pesadas se construyen por tandas (el navegador sigue respondiendo y se ve el avance) y con un plan: vista simplificada
    // (primero lo grande) y mallas pequeñas fusionadas en trozos. Una pieza pequeña sale exactamente como antes (una malla = una pieza).
    const summaries = summarizeMeshes(result);
    const plan = planCadBuild(summaries, buildOptions);
    showStatus("Construyendo el modelo 3D…");
    const built = await buildCadModelAsync(THREE, result, { edgeColor: STAGE_EDGE_COLOR, plan }, {
      onProgress: (done, total) => { if (!closed) showStatus(`Construyendo el modelo 3D… ${nf(done)} de ${nf(total)}`, total ? done / total : null); },
      isCancelled: () => closed,
    });
    if (closed) { disposeObject3D(built.group); const e = new Error("Cancelado"); e.name = "AbortError"; throw e; }
    model = built;
    buildInfo = { result, summaries, plan, tess, fromCache, allShown: !plan.simplified };
    scene.add(model.group);
    raycaster = new THREE.Raycaster();
    scratch.vec = new THREE.Vector3();
    applyToggles();
    buildGrid();
    createControls();
    resize();
    applyView("iso");
    bindStage();
    toolbar.hidden = false;
    panel.hidden = false;
    bboxEl.textContent = formatBoundingBoxMm(model.bounds.size);
    syncUploadButton();
    updateMeasureCursor();
    refreshHint();
    renderNotice();
    requestRender(); // v94: al construir una SEGUNDA escena en el mismo visor («Calidad alta», cargar otro archivo) `dirty` seguía en false y no se pintaba
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // --- v94: aviso de «vista simplificada» / «malla simplificada» ------------------------------------------------------------
  function renderNotice() {
    noticeBox.replaceChildren();
    if (!buildInfo || !model) { noticeBox.hidden = true; return; }
    const { plan, tess } = buildInfo;
    const rows = [];
    if (plan.simplified && !buildInfo.allShown) {
      rows.push({
        text: `Vista simplificada: ${nf(plan.shown.length)} de ${nf(plan.totalMeshes)} piezas (${nf(plan.shownTriangles)} de ${nf(plan.totalTriangles)} triángulos). La tornillería y las piezas más pequeñas están ocultas.`,
        label: "Mostrar todas las piezas", act: showAllParts,
      });
    }
    if (tess !== "normal") {
      rows.push({
        text: "Malla simplificada para abrir antes: las medidas son exactas, pero las curvas se ven más poligonales.",
        label: "Calidad alta", act: reloadHighQuality,
      });
    }
    if (!rows.length) { noticeBox.hidden = true; return; }
    rows.forEach((r) => {
      const row = el(`<div class="cad-viewer-notice__row"><span></span><button type="button" class="cad-viewer-notice__btn"></button></div>`);
      row.firstElementChild.textContent = r.text;
      const btn = row.querySelector("button");
      btn.textContent = r.label;
      btn.addEventListener("click", () => r.act(btn));
      noticeBox.appendChild(row);
    });
    noticeBox.hidden = false;
  }

  let extending = false;
  /** «Mostrar todas las piezas»: construye las que la vista simplificada dejó fuera (ya están leídas: no hay que volver a leer el STEP). */
  async function showAllParts(btn) {
    if (!buildInfo || !model || extending) return;
    extending = true;
    if (btn) { btn.disabled = true; btn.textContent = "Añadiendo… 0 %"; }
    try {
      const groups = planGroupsFor(buildInfo.summaries, buildInfo.plan.hidden, buildInfo.plan.options);
      await extendCadModel(engine.THREE, model, buildInfo.result, groups, {
        onProgress: (done, total) => { if (btn && !closed) btn.textContent = `Añadiendo… ${Math.round((100 * done) / Math.max(1, total))} %`; },
        isCancelled: () => closed,
      });
      if (closed) return;
      buildInfo.allShown = true;
      applyToggles();
      bboxEl.textContent = formatBoundingBoxMm(model.bounds.size);
      requestRender();
    } catch (e) {
      if (!closed && !isAbortError(e)) { console.error("cad-viewer:", e); showToast("No se pudieron añadir todas las piezas.", "error"); }
    } finally {
      extending = false;
      if (!closed) renderNotice();
    }
  }

  /** «Calidad alta»: vuelve a leer el STEP con el teselado fino (más lento; mejor aspecto de las curvas). */
  function reloadHighQuality() {
    if (!lastLoad) return;
    const heavy = (lastLoad.size || 0) >= CAD_NOTE_FROM_BYTES;
    if (heavy && !window.confirm("Leer la pieza en alta calidad puede tardar mucho más. ¿Continuar?")) return;
    const { getBuffer, name, size, meta } = lastLoad;
    loadBuffer(getBuffer, name, size, meta, { forceTess: "normal" });
  }

  function createControls() {
    const { THREE, OrbitControls } = engine;
    camera.up.set(...cadUpVector(upAxis));
    if (controls) controls.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 1.1;
    controls.screenSpacePanning = true;
    controls.addEventListener("change", requestRender);
    controls.target.set(...model.bounds.center);
  }

  function buildGrid() {
    const { THREE } = engine;
    if (gridGroup) disposeObject3D(gridGroup);
    gridGroup = new THREE.Group();
    const b = model.bounds;
    const zUp = upAxis === "z";
    const extent = zUp ? Math.max(b.size[0], b.size[1]) : Math.max(b.size[0], b.size[2]);
    const spec = computeGridSpec(extent);
    const grid = new THREE.GridHelper(spec.size, spec.divisions, 0x6b7580, 0xb4bcc4);
    if (zUp) { grid.rotation.x = Math.PI / 2; grid.position.set(b.center[0], b.center[1], b.min[2]); }
    else grid.position.set(b.center[0], b.min[1], b.center[2]);
    gridGroup.add(grid);
    const axes = new THREE.AxesHelper(Math.max(spec.step * 2, b.radius * 0.5));
    axes.position.set(b.min[0], b.min[1], b.min[2]);
    gridGroup.add(axes);
    gridGroup.visible = toggles.grid;
    scene.add(gridGroup);
  }

  function applyToggles() {
    model.parts.forEach((p) => { p.edges.visible = toggles.edges; p.mesh.material.wireframe = toggles.wireframe; });
    if (gridGroup) gridGroup.visible = toggles.grid;
    root.querySelectorAll("[data-toggle]").forEach((b) => {
      const on = !!toggles[b.dataset.toggle];
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    requestRender();
  }

  function applyView(name) {
    if (!model) return;
    const b = model.bounds;
    let dir;
    if (name === "fit") {
      const d = camera.position.clone().sub(controls.target);
      dir = d.lengthSq() > 1e-12 ? d.normalize().toArray() : cadViewDirection("iso", upAxis);
    } else {
      dir = cadViewDirection(name, upAxis);
      const up = cadUpVector(upAxis);
      if (Math.abs(dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2]) > 0.9999) { // mirando a lo largo del eje vertical: evita el cardán
        const front = cadViewDirection("front", upAxis);
        dir = [dir[0] + front[0] * 1e-3, dir[1] + front[1] * 1e-3, dir[2] + front[2] * 1e-3];
      }
    }
    const dist = computeFitDistance(b.radius, camera.fov, camera.aspect);
    camera.near = Math.max(dist / 200, 0.01);
    camera.far = dist * 40 + b.radius * 8;
    camera.updateProjectionMatrix();
    controls.target.set(...b.center);
    camera.position.set(b.center[0] + dir[0] * dist, b.center[1] + dir[1] * dist, b.center[2] + dir[2] * dist);
    controls.update();
    requestRender();
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }

  function frame() {
    if (closed) return;
    raf = requestAnimationFrame(frame);
    const moved = controls ? controls.update() : false;
    if (dirty || moved) {
      dirty = false;
      renderer.render(scene, camera);
      updateOverlays();
    }
  }

  // --- Etiquetas y marcadores HTML pegados a un punto 3D ------------------
  function addOverlay(className, text, point) {
    const node = el(`<div class="cad-viewer-label ${className}"></div>`);
    if (Array.isArray(text)) text.forEach((t, i) => { const line = document.createElement("div"); line.className = i ? "cad-viewer-label__sub" : ""; line.textContent = t; node.appendChild(line); });
    else node.textContent = text;
    labelsLayer.appendChild(node);
    const entry = { el: node, point };
    overlays.push(entry);
    requestRender();
    return entry;
  }
  function removeOverlay(entry) {
    const i = overlays.indexOf(entry);
    if (i >= 0) overlays.splice(i, 1);
    entry.el.remove();
  }
  function updateOverlays() {
    if (!camera || !overlays.length) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    overlays.forEach((o) => {
      scratch.vec.set(...o.point).project(camera);
      const visible = scratch.vec.z > -1 && scratch.vec.z < 1;
      o.el.style.display = visible ? "" : "none";
      if (visible) o.el.style.transform = `translate(${((scratch.vec.x + 1) / 2) * w}px, ${((1 - scratch.vec.y) / 2) * h}px) translate(-50%, -50%)`;
    });
  }

  // --- Medidas -------------------------------------------------------------
  function setMode(next) {
    mode = mode === next ? "none" : next;
    cancelPending();
    clearHover();
    root.querySelectorAll("[data-mode]").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    updateMeasureCursor();
    refreshHint();
  }

  function updateMeasureCursor() {
    if (renderer) renderer.domElement.style.cursor = mode === "none" ? "grab" : "crosshair";
  }

  function refreshHint() {
    if (mode === "point-to-point") setHint(pending ? "Punto a Punto: haz clic en el punto B (se ajusta a vértices y aristas). Esc cancela." : "Punto a Punto: haz clic en el punto A (se ajusta a vértices y aristas).");
    else if (mode === "face-to-face") {
      if (pending && pending.circle) setHint(`Cara a Cara: círculo ⌀ ${formatMm(round2(pending.circle.radius * 2))} elegido. Haz clic en una cara (o en otro círculo) para medir desde su centro. Esc cancela.`);
      else setHint(pending ? "Cara a Cara: haz clic en la segunda cara. Esc cancela." : "Cara a Cara: haz clic en la primera cara. Los círculos (violeta) se miden desde su centro.");
    } else if (mode === "diameter") setHint("Diámetro: haz clic en el borde de un agujero, un eje o un disco (vale cerca del borde), o en su pared. Se iluminan en violeta.");
    else setHint("Arrastra para girar · rueda para acercar · botón derecho para desplazar.");
  }

  function cancelPending() {
    if (!pending) return;
    if (pending.overlay) removeOverlay(pending.overlay);
    if (pending.highlight) disposeObject3D(pending.highlight);
    pending = null;
    requestRender();
  }

  function clearHover() {
    if (hover.mesh) disposeObject3D(hover.mesh);
    if (hover.ring) disposeObject3D(hover.ring);
    if (hover.overlay) removeOverlay(hover.overlay);
    hover = { faceId: -1, mesh: null, overlay: null, ring: null, rimKey: "", at: hover.at, interval: hover.interval };
    requestRender();
  }

  /** La cara descrita y, si es un agujero, un eje, un redondeo o un disco, su círculo (con caché: el modelo no cambia). */
  function faceInfo(faceId) {
    let info = faceCache.get(faceId);
    if (!info) {
      const face = describeModelFace(model, faceId);
      const circle = fitCircularFace(face);
      info = { face, circle, loops: rimLoopsFromCircle(circle) }; // v94: los bordes del círculo (para elegirlo haciendo clic cerca de ellos)
      faceCache.set(faceId, info);
    }
    return info;
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  const circleLabel = (c) => `⌀ ${formatMm(round2(c.radius * 2))}`;

  // --- v94: elegir un círculo por su BORDE ---------------------------------------------------------------------------------------
  // En ⌀ Diámetro no hace falta acertar en la pared interna de un agujero: vale un clic a ≤ RIM_PICK_PX píxeles del borde (el contorno
  // circular de un agujero, un eje o un disco), incluso dentro de un hueco por el que se ve el fondo. Se hace en pantalla: los bordes de
  // las caras circulares cercanas al puntero (se descartan antes las caras cuya caja envolvente queda lejos del rayo) se proyectan, y se
  // elige el más cercano que no esté tapado por otra pieza.
  const quickCache = new Map(); // faceId → ¿podría ser un círculo? (couldBeCircularFace: barato; evita describir y ajustar las demás)
  const couldBeCircle = (faceId) => {
    let ok = quickCache.get(faceId);
    if (ok === undefined) {
      const f = model.faces[faceId];
      const g = model.parts[f.partIndex].geometry;
      ok = couldBeCircularFace(g.attributes.position.array, g.index.array, f.triangles);
      quickCache.set(faceId, ok);
    }
    return ok;
  };
  let faceBoxes = null; // Float64Array(6 × caras): caja envolvente (mundo) de cada cara; se calcula una vez y crece si se añaden piezas
  let boxesDone = 0;

  function ensureFaceBoxes() {
    const n = model.faces.length;
    if (!faceBoxes || faceBoxes.length < n * 6) {
      const grown = new Float64Array(Math.max(n * 6, faceBoxes ? faceBoxes.length * 2 : 0));
      if (faceBoxes) grown.set(faceBoxes.subarray(0, boxesDone * 6));
      faceBoxes = grown;
    }
    for (let id = boxesDone; id < n; id++) {
      const f = model.faces[id];
      const part = model.parts[f.partIndex];
      const pos = part.geometry.attributes.position.array;
      const idx = part.geometry.index.array;
      const e = part.mesh.matrixWorld.elements;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      const tris = f.triangles;
      for (let i = 0; i < tris.length; i++) {
        for (let k = 0; k < 3; k++) {
          const v = idx[3 * tris[i] + k] * 3;
          const lx = pos[v], ly = pos[v + 1], lz = pos[v + 2];
          const x = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
          const y = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
          const z = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
      }
      faceBoxes.set([x0, y0, z0, x1, y1, z1], id * 6);
    }
    boxesDone = n;
    return faceBoxes;
  }

  /** Distancia (px) de un punto a un segmento 2D y el parámetro t (0..1) del punto más cercano. */
  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
  }

  /** ¿Se ve este punto 3D desde la cámara (no lo tapa otra pieza)? */
  function pointVisible(q, fovK) {
    const { THREE } = engine;
    const dir = new THREE.Vector3(q[0] - camera.position.x, q[1] - camera.position.y, q[2] - camera.position.z);
    const d = dir.length();
    if (d < 1e-9) return true;
    dir.normalize();
    raycaster.set(camera.position, dir);
    const hit = raycaster.intersectObjects(model.parts.map((p) => p.mesh), false)[0];
    return !hit || hit.distance >= d - (4 * fovK * d + 0.002 * d);
  }

  /**
   * El borde circular más cercano al puntero (a ≤ RIM_PICK_PX píxeles y visible): `{ faceId, loopIndex, loop, point, px }` o `null`.
   * `point` es el punto 3D del borde más cercano al puntero.
   */
  function findRim(ev, { budgetMs = 30 } = {}) {
    if (!model || !renderer || !camera) return null;
    const deadline = performance.now() + budgetMs; // al pasar el ratón se reparte el trabajo entre movimientos (lo ya calculado queda en caché); al hacer clic hay más margen
    const { THREE } = engine;
    const rect = renderer.domElement.getBoundingClientRect();
    const w = Math.max(rect.width, 1), h = Math.max(rect.height, 1);
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    raycaster.setFromCamera({ x: (px / w) * 2 - 1, y: -(py / h) * 2 + 1 }, camera);
    const o = raycaster.ray.origin.clone(), d = raycaster.ray.direction.clone();
    const boxes = ensureFaceBoxes();
    const fovK = (2 * Math.tan((camera.fov * Math.PI) / 360)) / h; // mm por píxel y por mm de distancia a la cámara
    const cand = [];
    for (let id = 0; id < model.faces.length; id++) {
      const b = id * 6;
      const t = ((boxes[b] + boxes[b + 3]) / 2 - o.x) * d.x + ((boxes[b + 1] + boxes[b + 4]) / 2 - o.y) * d.y + ((boxes[b + 2] + boxes[b + 5]) / 2 - o.z) * d.z;
      if (t <= 0) continue;
      const e = RIM_PICK_PX * fovK * t;
      let tmin = 0, tmax = Infinity, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        const ok_ = k === 0 ? o.x : k === 1 ? o.y : o.z;
        const dk = k === 0 ? d.x : k === 1 ? d.y : d.z;
        const lo = boxes[b + k] - e, hi = boxes[b + 3 + k] + e;
        if (Math.abs(dk) < 1e-12) { if (ok_ < lo || ok_ > hi) ok = false; }
        else {
          let t1 = (lo - ok_) / dk, t2 = (hi - ok_) / dk;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) ok = false;
        }
      }
      if (ok) cand.push({ id, t });
    }
    cand.sort((a, b) => a.t - b.t);
    const v = new THREE.Vector3();
    const found = [];
    for (const { id } of cand.slice(0, 400)) {
      if (!couldBeCircle(id)) continue; // casi todas las caras se descartan aquí, sin describirlas
      if (performance.now() > deadline && !faceCache.has(id)) continue; // sin tiempo para ajustar una cara nueva: se hará en un próximo movimiento
      const { loops } = faceInfo(id);
      loops.forEach((loop, loopIndex) => {
        const pts = loop.points;
        let prev = null;
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          v.set(pts[i][0], pts[i][1], pts[i][2]).project(camera);
          const cur = v.z > 1 || v.z < -1 ? null : { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
          if (prev && cur) {
            const r = segmentDistance(px, py, prev.x, prev.y, cur.x, cur.y);
            if (!best || r.d < best.d) best = { d: r.d, t: r.t, i };
          }
          prev = cur;
        }
        if (best && best.d <= RIM_PICK_PX) {
          const a = pts[best.i - 1], b = pts[best.i];
          found.push({ faceId: id, loopIndex, loop, px: best.d, point: [a[0] + best.t * (b[0] - a[0]), a[1] + best.t * (b[1] - a[1]), a[2] + best.t * (b[2] - a[2])] });
        }
      });
    }
    found.sort((a, b) => a.px - b.px);
    for (const f of found.slice(0, 4)) if (pointVisible(f.point, fovK)) return f;
    return null;
  }

  /** Un aro grueso sobre el borde elegido (los hilos de 1 px de WebGL casi no se ven). */
  function makeRing(loop, color, widthPx = 2.4) {
    const { THREE } = engine;
    let pts = loop.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const closed = !!loop.isFullCircle;
    if (closed && pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
    const curve = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
    const dist = camera.position.distanceTo(new THREE.Vector3(loop.center[0], loop.center[1], loop.center[2]));
    const tube = Math.max(1e-3, widthPx * worldUnitsPerPixel(camera.fov, dist, Math.max(1, stage.clientHeight)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(32, pts.length * 2), tube, 5, closed), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    mesh.renderOrder = 9;
    return mesh;
  }

  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = { x: ((ev.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, y: -((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1 };
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(model.parts.map((p) => p.mesh), false)[0] || null;
  }

  function onCanvasClick(ev) {
    if (mode === "none" || !model) return;
    const hit = pick(ev);
    if (!hit && mode !== "diameter") { setHint("Haz clic sobre la pieza."); return; } // (⌀ Diámetro también acepta un clic junto al borde de un hueco)
    let customHint = false; // el clic dejó un aviso propio («elige otra cara…»): no se pisa con la ayuda genérica
    try {
      customHint = (mode === "point-to-point" ? clickPointToPoint(hit) : mode === "diameter" ? clickDiameter(hit, ev) : clickFaceToFace(hit)) === true;
    } catch (e) {
      console.error("cad-viewer medida:", e);
      showToast("No se pudo calcular la medida.", "error");
      cancelPending();
    }
    if (!customHint) refreshHint();
  }

  function clickPointToPoint(hit) {
    const radius = worldUnitsPerPixel(camera.fov, hit.distance, renderer.domElement.clientHeight || stage.clientHeight) * SNAP_PIXELS;
    const snap = snapIntersection(model, hit, radius);
    if (!pending) {
      pending = { kind: "p2p", point: snap.point, overlay: addOverlay("cad-viewer-marker", "A", snap.point) };
      return;
    }
    const a = pending.point;
    const b = snap.point;
    const m = computePointToPointMeasurement(a, b);
    const markerA = pending.overlay;
    pending = null;
    const markerB = addOverlay("cad-viewer-marker", "B", b);
    const group = lineGroup(a, b);
    const label = addOverlay("cad-viewer-label--dim", describePointToPoint(m), a.map((v, i) => (v + b[i]) / 2));
    addMeasurement({
      title: describePointToPoint(m),
      lines: [`ΔX ${formatMm(m.deltaX)} · ΔY ${formatMm(m.deltaY)} · ΔZ ${formatMm(m.deltaZ)}`],
      group, overlays: [markerA, markerB, label],
    });
  }

  function clickFaceToFace(hit) {
    const faceId = faceIdFromIntersection(model, hit);
    if (faceId < 0) { setHint("Esa zona no pertenece a ninguna cara."); return true; }
    if (!pending) {
      const highlight = createFaceHighlight(engine.THREE, model, faceId, COLOR_FACE_A);
      scene.add(highlight);
      clearHover();
      // v93: si es un círculo (agujero, eje, disco) se marca su centro: es desde donde se medirá.
      const { circle } = faceInfo(faceId);
      const overlay = circle ? addOverlay("cad-viewer-marker cad-viewer-marker--center", circleLabel(circle), circle.center) : null;
      pending = { kind: "f2f", faceId, highlight, circle, overlay };
      requestRender();
      return;
    }
    if (pending.faceId === faceId) { setHint("Elige una cara distinta de la primera."); return true; }
    const infoA = faceInfo(pending.faceId);
    const infoB = faceInfo(faceId);
    const faceA = infoA.face;
    const faceB = infoB.face;
    const m = computeFaceToFaceMeasurement(faceA, faceB);
    const circleA = infoA.circle;
    const circleB = infoB.circle;
    const owned = [];
    if (pending.overlay) owned.push(pending.overlay); // el marcador del centro del primer círculo pasa a formar parte de la medida
    const normalLines = [
      `Distancia normal: ${formatMm(m.normalDistanceMm)}`,
      `Distancia mínima: ${formatMm(m.minDistanceMm)}${m.approximate ? " (aprox.)" : ""}`,
      `Ángulo entre caras: ${m.angleDeg.toFixed(1)}° (0°–90°) · ${m.isParallel ? "Paralelas" : "No paralelas"}`,
    ];
    if (!faceA.isPlanar || !faceB.isPlanar) normalLines.push("Alguna cara es curva: la distancia válida es la mínima.");

    // v93: con un círculo de por medio la medida principal es DESDE SU CENTRO (hasta la otra cara o hasta el centro del otro círculo).
    let title = describeFaceToFace(m).label;
    let sub = describeFaceToFace(m).angle;
    let lines = normalLines;
    let a = m.lineStart;
    let b = m.lineEnd;
    if (circleA || circleB) {
      if (circleA && circleB) {
        const cc = computeCircleToCircleMeasurement(circleA, circleB);
        title = `${cc.axesParallel ? "Entre ejes" : "Entre centros"}: ${formatMm(cc.distanceMm)}`;
        sub = `${circleLabel(circleA)} ↔ ${circleLabel(circleB)}`;
        lines = [
          `Distancia entre centros: ${formatMm(cc.centerDistanceMm)}`,
          ...(cc.axesParallel ? [`Distancia entre ejes (paralelos): ${formatMm(cc.axisDistanceMm)}`] : ["Los ejes no son paralelos."]),
          `Diámetros: ${circleLabel(circleA)} y ${circleLabel(circleB)}`,
        ];
        a = cc.lineStart; b = cc.lineEnd;
        owned.push(addOverlay("cad-viewer-marker cad-viewer-marker--center", circleLabel(circleB), circleB.center));
      } else {
        const circle = circleA || circleB;
        const otherFace = circleA ? faceB : faceA;
        const cf = computeCircleToFaceMeasurement(circle, otherFace);
        title = `Centro → Cara: ${formatMm(cf.distanceMm)}`;
        sub = `${circleLabel(circle)} · ${cf.isPlanarTarget ? "cara plana" : "cara curva (mínima)"}`;
        lines = [
          `Desde el centro del círculo (${circleLabel(circle)}) a la cara: ${formatMm(cf.distanceMm)}`,
          ...(cf.normalDistanceMm !== null && cf.minDistanceMm !== cf.normalDistanceMm ? [`Mínima del centro al borde de la cara: ${formatMm(cf.minDistanceMm)}`] : []),
          ...(describeAxisToFace(cf) ? [describeAxisToFace(cf)] : []),
        ];
        a = cf.lineStart; b = cf.lineEnd;
        if (!pending.overlay) owned.push(addOverlay("cad-viewer-marker cad-viewer-marker--center", circleLabel(circle), circle.center));
      }
    }
    const group = lineGroup(a, b);
    group.add(pending.highlight);
    const highlightB = createFaceHighlight(engine.THREE, model, faceId, COLOR_FACE_B);
    group.add(highlightB);
    scene.remove(pending.highlight);
    pending = null;
    clearHover();
    const mid = a.map((v, i) => (v + b[i]) / 2);
    owned.push(addOverlay("cad-viewer-label--dim", [title, sub], mid));
    addMeasurement({ title, lines, group, overlays: owned });
  }

  /** v94: ⌀ de un borde circular elegido (ver findRim): la cota pasa por su centro y se dibuja un aro sobre él. */
  function measureRim(rim) {
    const m = diameterFromRim(rim.loop, { toward: rim.point });
    const text = describeDiameter(m);
    const group = lineGroup(m.lineStart, m.lineEnd);
    group.add(createFaceHighlight(engine.THREE, model, rim.faceId, COLOR_FACE_A));
    group.add(makeRing(rim.loop, COLOR_LINE));
    clearHover();
    const label = addOverlay("cad-viewer-label--dim", text.label, m.center);
    addMeasurement({ title: text.title, lines: text.lines, group, overlays: [label] });
  }

  /** ⌀ Diámetro: un clic en el borde de un círculo (o cerca) o en la pared de un agujero, un eje, un redondeo o una cara circular. */
  function clickDiameter(hit, ev) {
    const rim = findRim(ev, { budgetMs: 4000 }); // un clic puede tardar un poco más que un movimiento del ratón: hay que acertar
    if (rim) { measureRim(rim); return; }
    if (!hit) { setHint("Haz clic en el borde de un agujero, un eje o un disco (vale cerca), o en su pared."); return true; }
    const faceId = faceIdFromIntersection(model, hit);
    if (faceId < 0) { setHint("Esa zona no pertenece a ninguna cara."); return true; }
    const { face } = faceInfo(faceId);
    const m = computeDiameterMeasurement(face, { toward: [hit.point.x, hit.point.y, hit.point.z] });
    if (!m) { setHint("Esa cara no es circular. Haz clic en un agujero, un eje, un redondeo o una cara circular (se iluminan en violeta)."); return true; }
    const text = describeDiameter(m);
    const group = lineGroup(m.lineStart, m.lineEnd);
    group.add(createFaceHighlight(engine.THREE, model, faceId, COLOR_FACE_A));
    clearHover();
    const label = addOverlay("cad-viewer-label--dim", text.label, m.center);
    addMeasurement({ title: text.title, lines: text.lines, group, overlays: [label] });
  }

  function lineGroup(a, b) {
    const { THREE } = engine;
    const group = new THREE.Group();
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COLOR_LINE, depthTest: false, transparent: true }));
    line.renderOrder = 999;
    group.add(line);
    scene.add(group);
    return group;
  }

  function addMeasurement({ title, lines, group, overlays: owned }) {
    const id = ++measureSeq;
    const item = el(`<li class="cad-viewer-measure" data-id="${id}"><div class="cad-viewer-measure__main"><strong></strong><div class="cad-viewer-measure__lines"></div></div><button type="button" class="cad-viewer-measure__del" title="Quitar esta medida" aria-label="Quitar esta medida">✕</button></li>`);
    item.querySelector("strong").textContent = title;
    item.querySelector(".cad-viewer-measure__lines").innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("");
    const entry = { id, group, overlays: owned, item };
    item.querySelector("button").addEventListener("click", () => removeMeasurement(entry));
    measuresList.appendChild(item);
    measurements.push(entry);
    measuresEmpty.hidden = true;
    requestRender();
  }

  function removeMeasurement(entry) {
    const i = measurements.indexOf(entry);
    if (i >= 0) measurements.splice(i, 1);
    disposeObject3D(entry.group);
    entry.overlays.forEach(removeOverlay);
    entry.item.remove();
    measuresEmpty.hidden = measurements.length > 0;
    requestRender();
  }

  function clearMeasurements() {
    cancelPending();
    clearHover();
    measurements.slice().forEach(removeMeasurement);
    refreshHint();
  }

  // --- Entrada de ratón ----------------------------------------------------
  function onPointerDown(ev) {
    downPoint = ev.button === 0 ? { x: ev.clientX, y: ev.clientY, t: Date.now() } : null;
  }
  function onPointerUp(ev) {
    const d = downPoint;
    downPoint = null;
    if (!d || ev.button !== 0) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) <= CLICK_MAX_MOVE_PX && Date.now() - d.t <= CLICK_MAX_MS) onCanvasClick(ev);
  }
  function onPointerMove(ev) {
    if ((mode !== "face-to-face" && mode !== "diameter") || !model || ev.buttons) return;
    const now = Date.now();
    if (now - hover.at < hover.interval) return;
    hover.at = now;
    const t0 = performance.now();
    if (mode === "diameter") hoverRim(ev); else hoverFace(ev);
    hover.interval = Math.max(60, Math.min(500, (performance.now() - t0) * 5)); // en piezas pesadas se espacia solo, para no ir a tirones
  }

  /** v94: en ⌀ Diámetro se ilumina el borde circular más cercano al puntero (con su aro y su centro); si no hay, la pared de un círculo. */
  function hoverRim(ev) {
    const rim = findRim(ev);
    const key = rim ? `${rim.faceId}:${rim.loopIndex}` : "";
    if (key) {
      if (key === hover.rimKey) return;
      clearHover();
      hover.rimKey = key;
      hover.faceId = rim.faceId;
      hover.mesh = createFaceHighlight(engine.THREE, model, rim.faceId, COLOR_CIRCLE);
      hover.mesh.material.opacity = 0.35;
      scene.add(hover.mesh);
      hover.ring = makeRing(rim.loop, COLOR_CIRCLE);
      scene.add(hover.ring);
      hover.overlay = addOverlay("cad-viewer-marker cad-viewer-marker--center", circleLabel(rim.loop), rim.loop.center);
      requestRender();
      return;
    }
    if (hover.rimKey) clearHover();
    hoverFace(ev);
  }

  function hoverFace(ev) {
    const hit = pick(ev);
    const id = hit ? faceIdFromIntersection(model, hit) : -1;
    if (id === hover.faceId && !hover.rimKey) return;
    clearHover();
    if (id < 0 || (pending && pending.faceId === id)) return;
    const { circle } = faceInfo(id);
    if (mode === "diameter" && !circle) return; // en Diámetro solo se iluminan las caras que se pueden medir
    hover.faceId = id;
    hover.mesh = createFaceHighlight(engine.THREE, model, id, circle ? COLOR_CIRCLE : COLOR_HOVER);
    hover.mesh.material.opacity = 0.35;
    scene.add(hover.mesh);
    if (circle) hover.overlay = addOverlay("cad-viewer-marker cad-viewer-marker--center", circleLabel(circle), circle.center);
    requestRender();
  }
  function onPointerLeave() {
    if (hover.mesh) clearHover();
  }

  function bindStage() {
    const c = renderer.domElement;
    c.addEventListener("pointerdown", onPointerDown);
    c.addEventListener("pointerup", onPointerUp);
    c.addEventListener("pointermove", onPointerMove);
    c.addEventListener("pointerleave", onPointerLeave);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(stage);
    }
  }

  // --- Cierre y liberación -------------------------------------------------
  function disposeScene() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (renderer) {
      const c = renderer.domElement;
      c.removeEventListener("pointerdown", onPointerDown);
      c.removeEventListener("pointerup", onPointerUp);
      c.removeEventListener("pointermove", onPointerMove);
      c.removeEventListener("pointerleave", onPointerLeave);
    }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    measurements.slice().forEach(removeMeasurement);
    if (pending) cancelPending();
    if (hover.mesh) clearHover();
    overlays.slice().forEach(removeOverlay);
    if (controls) { controls.removeEventListener("change", requestRender); controls.dispose(); controls = null; }
    if (model) { disposeObject3D(model.group); model = null; }
    buildInfo = null;
    faceCache.clear(); quickCache.clear(); // v94: las caras de otra pieza no valen (en la v93 no se vaciaba al cargar otro archivo en el mismo visor)
    faceBoxes = null; boxesDone = 0;
    if (parseAbort) { parseAbort.abort(); parseAbort = null; }
    noticeBox.hidden = true;
    if (gridGroup) { disposeObject3D(gridGroup); gridGroup = null; }
    if (scene) { scene.clear(); scene = null; }
    if (renderer) {
      renderer.dispose();
      if (typeof renderer.forceContextLoss === "function") renderer.forceContextLoss();
      renderer.domElement.remove();
      renderer = null;
    }
    camera = null;
    raycaster = null;
    mode = "none";
    root.querySelectorAll("[data-mode]").forEach((b) => { b.classList.remove("is-active"); b.setAttribute("aria-pressed", "false"); });
    measuresEmpty.hidden = false;
    panel.hidden = true;
    bboxEl.textContent = "";
    setHint("");
    syncUploadButton();
  }
  function syncUploadButton() {
    if (uploadBtn) uploadBtn.hidden = !(localStepFile && model && !localStepUploaded);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (abort) abort.abort();
    if (conversionJob) { conversionJob.cancel(); conversionJob = null; }
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", resize);
    disposeScene();
    root.remove();
    if (active && active.root === root) active = null;
  }

  function onKeyDown(ev) {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    ev.preventDefault();
    if (pending) { cancelPending(); refreshHint(); return; }
    close();
  }

  // --- Interfaz fija -------------------------------------------------------
  q("close").addEventListener("click", close);
  root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", resize);
  toolbar.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => applyView(b.dataset.view)));
  toolbar.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => { toggles[b.dataset.toggle] = !toggles[b.dataset.toggle]; applyToggles(); }));
  toolbar.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  q("clear").addEventListener("click", clearMeasurements);
  const upSelect = q("up-axis");
  upSelect.value = upAxis;
  upSelect.addEventListener("change", () => {
    upAxis = upSelect.value === "z" ? "z" : "y";
    writeUpAxis(upAxis);
    if (!model) return;
    buildGrid();
    createControls();
    applyView("iso");
  });

  if (onUploadStep) {
    const up = el(`<button type="button" class="btn btn--sm" data-cad="upload-step" hidden>⬆ Subir este .STEP a la tarea</button>`);
    uploadBtn = up;
    up.addEventListener("click", () => {
      if (!localStepFile) return;
      onUploadStep(localStepFile);
      showToast(`«${localStepFile.name}» se añade a la tarea.`);
      up.hidden = true;
    });
    headActions.appendChild(up);
  }
  if (attachment && storage && !file) {
    const dl = el(`<button type="button" class="btn btn--sm btn--ghost">⬇ Descargar</button>`);
    dl.addEventListener("click", async () => {
      const { downloadAttachment } = await import("./file-preview.js");
      downloadAttachment(attachment, storage);
    });
    headActions.appendChild(dl);
  }

  // --- Qué se abre ---------------------------------------------------------
  async function start() {
    if (file) {
      if (!isDirect3dCadFile(file.name)) { showError("Solo se pueden abrir archivos .step o .stp."); return; }
      localStepFile = null;
      return loadBuffer(() => file.arrayBuffer(), file.name, file.size, { lastModified: file.lastModified });
    }
    if (!attachment) { showError("No hay ningún archivo que abrir."); return; }
    if (isDirect3dCadFile(attachment.name)) return downloadAndLoad(attachment, null);
    if (isInventorNativeFile(attachment.name)) {
      const companion = findCompanionStepAttachment(attachment, attachmentsPool);
      if (companion) return downloadAndLoad(companion, `Vista 3D asociada a ${attachment.name} · STEP gemelo: ${companion.name}`);
      showNeedStep(attachment);
      return;
    }
    showError("Este tipo de archivo no se puede ver en 3D.");
  }

  const ready = Promise.resolve().then(start);
  active = { root, close };
  return { close, ready, root };
}
