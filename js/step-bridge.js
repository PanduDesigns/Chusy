// ============================================================================
// Conversión automática a STP (v92): el lado de Chusy (la página) del puente con el ayudante de Windows
// (assets/convertir-step/convertir-step.ps1).
//
// Al subir un .ipt/.iam sin su STEP, Chusy lanza el ayudante con `chusy-step://convert?...&port=P&token=T`. El ayudante abre un
// canal HTTP SOLO en 127.0.0.1:P (protegido por la clave T): `GET /T/status` dice en qué paso va (buscando el archivo,
// elegir a mano, convirtiendo, listo, error) y `GET /T/file` entrega el .stp en cuanto está creado. Esta función hace las
// preguntas, avisa del progreso y devuelve el `File` para que Chusy lo suba a la tarea sin que nadie haga nada.
//
//   startStepConversion({ fileName, size, lastModified, launch, onStatus, ... }) → { promise, cancel() }
//     promise → { ok: true, file } | { ok: false, reason: 'invalid' | 'unsupported' | 'no-helper' | 'error' | 'lost' | 'corrupt' | 'timeout' | 'cancelled', message }
//   launch(url) → true si se pudo lanzar el enlace, false si no se puede (otro sistema que Windows).
//   Todo lo demás (fetch, reloj, espera, azar, permiso del navegador) es inyectable para probarlo sin red.
//
// Chrome y Edge (desde la v142) piden, la primera vez, permiso para que una página pública hable con tu propio PC (red local /
// localhost): sin él, el `fetch` falla igual que si no hubiera ayudante. Por eso el fallo «no-helper» comprueba el permiso y,
// si está denegado, lo dice con las instrucciones para concederlo. (Comprobado con Chromium 153: con el permiso concedido el
// canal funciona de principio a fin; sin él, «Permission was denied for this request to access the `loopback` address space».)
// ============================================================================
import { buildConvertStepProtocolUrl } from "./cad-viewer.js";

export const STEP_PORT_MIN = 47600;
export const STEP_PORT_MAX = 47999;
const AUTO_KEY = "chusy_step_auto";

/** La preferencia de la conversión automática: 'on' | 'off' | 'ask' (aún no se ha decidido). Solo existe en Windows. */
export function getStepAutoMode(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const v = storage && storage.getItem(AUTO_KEY);
    return v === "on" || v === "off" ? v : "ask";
  } catch { return "ask"; }
}

export function setStepAutoMode(mode, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { if (storage) storage.setItem(AUTO_KEY, mode === "on" ? "on" : "off"); } catch { /* sin almacenamiento: se preguntará otra vez */ }
}

/** ¿Este ordenador puede usar el ayudante? Solo Windows (usa PowerShell e Inventor). */
export function isStepHelperPlatform(nav = typeof navigator !== "undefined" ? navigator : null) {
  return !!nav && /Windows/i.test(`${nav.userAgent || ""} ${nav.platform || ""}`);
}

/** Puerto y clave al azar para UN trabajo (la clave es lo que impide que otra página hable con el canal). */
export function createBridgeParams(cryptoImpl = globalThis.crypto, random = Math.random) {
  const rnd = (n) => {
    if (cryptoImpl && cryptoImpl.getRandomValues) { const a = new Uint32Array(1); cryptoImpl.getRandomValues(a); return a[0] % n; }
    return Math.floor(random() * n);
  };
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) token += alphabet[rnd(alphabet.length)];
  return { port: STEP_PORT_MIN + rnd(STEP_PORT_MAX - STEP_PORT_MIN + 1), token };
}

const fail = (reason, message) => ({ ok: false, reason, message });

const NO_HELPER = "No se detectó el ayudante. ¿Está instalado? (assets/convertir-step/Instalar-ConvertirStep.bat) Si ya lo está, comprueba que el navegador deja a Chusy acceder a tu PC (permiso «Acceso a la red local»).";
const DENIED = "El navegador ha bloqueado el acceso de Chusy a tu PC. Permítelo: candado de la barra de direcciones → Configuración del sitio → «Acceso a la red local» (o «Dispositivos de la red local») → Permitir, y reintenta.";

/** El estado del permiso de red local del navegador ('granted' | 'denied' | 'prompt'), o '' si el navegador no lo sabe consultar. */
async function localNetworkPermission() {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions) return "";
    return (await navigator.permissions.query({ name: "local-network-access" })).state || "";
  } catch { return ""; }
}

/** El texto de cada paso para quien mira la pantalla. */
export function describeStepStatus(st) {
  switch (st && st.status) {
    case "launching": return "Abriendo el ayudante…";
    case "searching": return "Buscando el archivo en tu PC…";
    case "dialog": return "Elige el archivo original en la ventana de Windows.";
    case "converting": return "Convirtiendo con Inventor…";
    case "done": return "Listo: recogiendo el .STP…";
    case "error": return (st && st.message) || "Falló la conversión.";
    default: return "Esperando al ayudante…";
  }
}

export function startStepConversion({
  fileName, size, lastModified, launch, onStatus = () => {}, fetchImpl = (...a) => fetch(...a), permissionState = localNetworkPermission, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(), graceMs = 20000, lostMs = 20000, timeoutMs = 25 * 60 * 1000, pollMs = 600, bridge = createBridgeParams(),
} = {}) {
  let cancelled = false;
  const url = buildConvertStepProtocolUrl({ fileName, size, lastModified, port: bridge.port, token: bridge.token });
  if (!url) return { promise: Promise.resolve(fail("invalid", "Solo se pueden convertir archivos .ipt o .iam de Inventor.")), cancel() {} };
  const base = `http://127.0.0.1:${bridge.port}/${bridge.token}`;

  const run = async () => {
    onStatus({ status: "launching" });
    let launched;
    try { launched = await launch(url); } catch (e) { return fail("no-helper", (e && e.message) || "No se pudo abrir el ayudante."); }
    if (launched === false) return fail("unsupported", "La conversión automática solo funciona en Windows con Inventor.");
    const started = now();
    let lastOk = 0;
    let seen = false;
    while (!cancelled) {
      const t = now();
      if (t - started > timeoutMs) return fail("timeout", "La conversión ha tardado demasiado.");
      let st = null;
      try {
        const r = await fetchImpl(`${base}/status`, { cache: "no-store", targetAddressSpace: "loopback" });
        if (r && r.ok) st = await r.json();
      } catch { st = null; }
      if (st) {
        seen = true;
        lastOk = t;
        onStatus(st);
        if (st.status === "error") return fail("error", st.message || "Falló la conversión.");
        if (st.status === "done") return download(st);
      } else if (!seen && t - started > graceMs) {
        return fail("no-helper", (await permissionState()) === "denied" ? DENIED : NO_HELPER);
      } else if (seen && t - lastOk > lostMs) {
        return fail("lost", "Se perdió la conexión con el ayudante.");
      }
      await sleep(pollMs);
    }
    return fail("cancelled", "Cancelado.");
  };

  const download = async (st) => {
    let r;
    try { r = await fetchImpl(`${base}/file`, { cache: "no-store", targetAddressSpace: "loopback" }); } catch (e) { return fail("lost", "No se pudo recoger el .STP del ayudante."); }
    if (!r || !r.ok) return fail("lost", "El ayudante no entregó el .STP.");
    const blob = await r.blob();
    if (st.size && blob.size !== Number(st.size)) return fail("corrupt", "El .STP recibido está incompleto.");
    const name = st.name || `${String(fileName).replace(/\.[^.]+$/, "")}.stp`;
    return { ok: true, file: new File([blob], name, { type: "application/octet-stream", lastModified: now() }) };
  };

  return { promise: run(), cancel() { cancelled = true; } };
}
