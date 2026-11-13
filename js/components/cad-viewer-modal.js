// ============================================================================
// Visor 3D industrial (v90): abre un .step/.stp (o el .ipt/.iam de Inventor, a través de su STEP gemelo) en una ventana
// con rotación orbital, vistas rápidas, aristas CAD, cotas envolventes y medición Punto a Punto y Cara a Cara.
//
//   openCadViewerModal({ attachment, attachmentsPool, storage, file, title, onUploadStep, deps })
//     attachment       adjunto de Drive `{ name, driveId, size, taskId?, projectId? }` (.step/.stp o .ipt/.iam)
//     attachmentsPool  adjuntos entre los que buscar el STEP gemelo de un .ipt/.iam (primero la misma tarea, luego el proyecto)
//     storage          el servicio de Drive (downloadBlob)
//     file             un File local .step/.stp (se mide al vuelo, sin subirlo a ningún sitio)
//     onUploadStep     (File) => void — si se pasa, un STEP cargado en local se puede subir a la tarea desde aquí
//     deps             solo para pruebas: { loadEngine, launchConvert, copyCommand }
//   Devuelve `{ close, ready }`; `ready` se resuelve cuando termina la carga inicial (con éxito o con un mensaje de error).
//
// Hay UN visor a la vez. Al cerrarlo se libera todo lo de WebGL: bucle de animación, listeners, controles, geometrías,
// materiales y el propio renderer (renderer.dispose() + forceContextLoss()).
// ============================================================================
import { el, escapeHtml, showToast } from "../utils.js";
import { formatBytes } from "../drive-files.js";
import { isAbortError } from "../drive-storage.js";
import { loadCadEngine, parseStepBuffer, CAD_MAX_FILE_BYTES } from "../cad-engine.js";
import {
  buildCadModel, describeModelFace, faceIdFromIntersection, snapIntersection, createFaceHighlight, disposeObject3D, worldUnitsPerPixel,
} from "../cad-model.js";
import {
  isDirect3dCadFile, isInventorNativeFile, getCadDisplayName, findCompanionStepAttachment, computePointToPointMeasurement,
  computeFaceToFaceMeasurement, cadViewDirection, cadUpVector, computeFitDistance, computeGridSpec, formatBoundingBoxMm, formatMm,
  describePointToPoint, describeFaceToFace, CAD_VIEW_LABELS,
} from "../cad-viewer.js";
import { launchConvertStep, copyConvertStepCommand } from "./convert-step-launcher.js";

const UP_AXIS_KEY = "chusy_cad_viewer_up_axis";
const CLICK_MAX_MOVE_PX = 5;
const CLICK_MAX_MS = 700;
const SNAP_PIXELS = 12;
const COLOR_FACE_A = 0xff9f1c;
const COLOR_FACE_B = 0x2ec4b6;
const COLOR_HOVER = 0x6ea8fe;
const COLOR_LINE = 0xffd23f;

let active = null;

function readUpAxis() {
  try { return localStorage.getItem(UP_AXIS_KEY) === "z" ? "z" : "y"; } catch { return "y"; }
}
function writeUpAxis(axis) {
  try { localStorage.setItem(UP_AXIS_KEY, axis); } catch { /* sin almacenamiento: no pasa nada */ }
}

function isLightTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "classic";
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
  const loadEngine = deps.loadEngine || ((o) => loadCadEngine(o));
  const launchConvert = deps.launchConvert || launchConvertStep;
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
            <button type="button" class="cad-viewer-btn" data-cad="clear">🗑️ Limpiar medidas</button>
          </div>
        </div>
        <div class="cad-viewer-body">
          <div class="cad-viewer-stage" data-cad="stage">
            <div class="cad-viewer-labels" data-cad="labels"></div>
            <div class="cad-viewer-message" data-cad="message"></div>
          </div>
          <aside class="cad-viewer-panel" data-cad="panel" hidden>
            <div class="cad-viewer-panel__title">Medidas</div>
            <ol class="cad-viewer-measures" data-cad="measures"></ol>
            <p class="cad-viewer-panel__empty" data-cad="measures-empty">Elige 📏 Punto a Punto o 📐 Cara a Cara y haz clic sobre la pieza.</p>
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
  let hover = { faceId: -1, mesh: null, at: 0 };
  let measureSeq = 0;
  const measurements = [];
  const overlays = [];
  const toggles = { edges: true, wireframe: false, grid: false };
  let downPoint = null;
  let localStepFile = null;
  let uploadBtn = null; // «Subir este .STEP a la tarea»: solo con un STEP cargado en local y dibujado
  const scratch = {};

  const setHint = (text) => { hintEl.textContent = text; };
  const setMessage = (node) => {
    messageBox.replaceChildren();
    if (node) { messageBox.appendChild(node); messageBox.hidden = false; } else messageBox.hidden = true;
  };
  const requestRender = () => { dirty = true; };

  // --- Carga ---------------------------------------------------------------
  function showStatus(text, progress = null) {
    const node = el(`<div class="cad-viewer-status"><div class="cad-viewer-spinner" aria-hidden="true"></div><div data-cad="status-text"></div><div class="cad-viewer-progress" hidden><span></span></div></div>`);
    node.querySelector('[data-cad="status-text"]').textContent = text;
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

  function showNeedStep(nativeAtt) {
    const nativeName = nativeAtt.name;
    const node = el(`
      <div class="cad-viewer-need">
        <div class="cad-viewer-need__icon">🧩</div>
        <h3 data-cad="need-title"></h3>
        <p>Para ver y medir un archivo de Inventor (.ipt / .iam) en 3D hace falta su gemelo <strong>.STEP</strong> o <strong>.STP</strong> con el mismo nombre, y todavía no está adjunto a esta tarea ni al proyecto.</p>
        <div class="cad-viewer-need__actions">
          <button type="button" class="btn btn--primary" data-act="convert">⚙️ Convertir este archivo a .STEP en mi PC (PowerShell)</button>
          <button type="button" class="btn" data-act="local">📂 Cargar archivo .STEP/.STP local</button>
        </div>
        <p class="cad-viewer-need__hint">El ayudante busca el archivo en tu PC (Inventor abierto o archivos recientes) y, si no lo encuentra, te pide que lo elijas. Al terminar se abre el Explorador con el .STP generado: cárgalo aquí para verlo al vuelo o súbelo a la tarea para que todos lo vean.
          <button type="button" class="cad-viewer-link" data-act="copy">Copiar comando de PowerShell</button></p>
      </div>`);
    node.querySelector('[data-cad="need-title"]').textContent = `Falta el modelo 3D (.STEP) de «${nativeName}»`;
    const convertInput = { fileName: nativeName, size: nativeAtt.size }; // el tamaño ayuda al ayudante a reconocer ESE archivo entre varios del mismo nombre
    node.querySelector('[data-act="convert"]').addEventListener("click", () => launchConvert(convertInput));
    node.querySelector('[data-act="local"]').addEventListener("click", pickLocalStep);
    node.querySelector('[data-act="copy"]').addEventListener("click", () => copyCommand(convertInput));
    setMessage(node);
    toolbar.hidden = true;
    bboxEl.textContent = "";
    setHint("");
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
      subtitleEl.textContent = `${sourceName} · STEP local: ${f.name}`;
      loadBuffer(() => f.arrayBuffer(), f.name, f.size);
    });
    document.body.appendChild(input);
    input.click();
  }

  async function loadBuffer(getBuffer, name, size) {
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
      const [buffer, eng] = await Promise.all([getBuffer(), enginePromise]);
      if (closed) return;
      engine = eng;
      showStatus("Procesando la geometría…");
      await new Promise((r) => setTimeout(r, 30)); // deja pintar el aviso antes de bloquear el hilo con el WebAssembly
      if (closed) return;
      const result = parseStepBuffer(eng.occt, buffer);
      buildScene(eng, result);
      setMessage(null);
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
    }, att.name, Number(att.size) || 0);
  }

  // --- Escena --------------------------------------------------------------
  function buildScene(eng, result) {
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
    scene.background = new THREE.Color(isLightTheme() ? 0xe9edf1 : 0x1a1d21);
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.7));
    const headlight = new THREE.DirectionalLight(0xffffff, 0.9); // luz pegada a la cámara: el sombreado sigue al girar
    headlight.position.set(0.4, 0.8, 1);
    camera.add(headlight);
    model = buildCadModel(THREE, result, { edgeColor: isLightTheme() ? 0x1e2a36 : 0x0c1118 });
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
    if (!raf) raf = requestAnimationFrame(frame);
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
    const light = isLightTheme();
    const grid = new THREE.GridHelper(spec.size, spec.divisions, light ? 0x6b7580 : 0x8a949e, light ? 0xb4bcc4 : 0x3b4249);
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
    else if (mode === "face-to-face") setHint(pending ? "Cara a Cara: haz clic en la segunda cara. Esc cancela." : "Cara a Cara: haz clic en la primera cara de la pieza.");
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
    hover = { faceId: -1, mesh: null, at: hover.at };
    requestRender();
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
    if (!hit) { setHint("Haz clic sobre la pieza."); return; }
    let customHint = false; // el clic dejó un aviso propio («elige otra cara…»): no se pisa con la ayuda genérica
    try {
      customHint = (mode === "point-to-point" ? clickPointToPoint(hit) : clickFaceToFace(hit)) === true;
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
      pending = { kind: "f2f", faceId, highlight };
      requestRender();
      return;
    }
    if (pending.faceId === faceId) { setHint("Elige una cara distinta de la primera."); return true; }
    const faceA = describeModelFace(model, pending.faceId);
    const faceB = describeModelFace(model, faceId);
    const m = computeFaceToFaceMeasurement(faceA, faceB);
    const group = lineGroup(m.lineStart, m.lineEnd);
    group.add(pending.highlight);
    const highlightB = createFaceHighlight(engine.THREE, model, faceId, COLOR_FACE_B);
    group.add(highlightB);
    scene.remove(pending.highlight);
    pending = null;
    clearHover();
    const text = describeFaceToFace(m);
    const mid = m.lineStart.map((v, i) => (v + m.lineEnd[i]) / 2);
    const label = addOverlay("cad-viewer-label--dim", [text.label, text.angle], mid);
    const lines = [
      `Distancia normal: ${formatMm(m.normalDistanceMm)}`,
      `Distancia mínima: ${formatMm(m.minDistanceMm)}${m.approximate ? " (aprox.)" : ""}`,
      `Ángulo entre caras: ${m.angleDeg.toFixed(1)}° (0°–90°) · ${m.isParallel ? "Paralelas" : "No paralelas"}`,
    ];
    if (!faceA.isPlanar || !faceB.isPlanar) lines.push("Alguna cara es curva: la distancia válida es la mínima.");
    addMeasurement({ title: text.label, lines, group, overlays: [label] });
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
    if (mode !== "face-to-face" || !model || ev.buttons) return;
    const now = Date.now();
    if (now - hover.at < 60) return;
    hover.at = now;
    const hit = pick(ev);
    const id = hit ? faceIdFromIntersection(model, hit) : -1;
    if (id === hover.faceId) return;
    const at = hover.at;
    clearHover();
    hover.at = at;
    if (id >= 0 && !(pending && pending.faceId === id)) {
      hover.faceId = id;
      hover.mesh = createFaceHighlight(engine.THREE, model, id, COLOR_HOVER);
      hover.mesh.material.opacity = 0.35;
      scene.add(hover.mesh);
      requestRender();
    }
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
    if (uploadBtn) uploadBtn.hidden = !(localStepFile && model);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (abort) abort.abort();
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
      return loadBuffer(() => file.arrayBuffer(), file.name, file.size);
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
