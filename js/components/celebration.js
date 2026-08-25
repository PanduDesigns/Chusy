// ============================================================================
// Recompensa visual al completar tareas: un chispazo de confeti discreto
// desde el propio círculo al marcar una sola, y algo bastante más
// vistoso — confeti cayendo por toda la pantalla + un mensaje — en tres
// situaciones que comparten esa misma "recompensa gorda":
//   - "selection": completar varias de golpe (acción masiva, ver
//     bulk-toolbar.js) — como antes.
//   - "streak": completar varias SEGUIDAS y rápido, una a una (marcando el
//     círculo de Lista o Mis tareas), sin usar la selección múltiple.
//   - "daily": ir sumando completadas a lo largo del MISMO DÍA (aunque no
//     sean seguidas ni rápidas) y cruzar uno de los hitos del día.
// Solo CSS + DOM, sin canvas ni librerías, y respeta prefers-reduced-motion
// (para esa gente no se dispara nada, solo se guarda el estado como
// siempre — la tarea se completa igual).
// ============================================================================
import { TAG_COLOR_PALETTE } from "../data/tags.js";

const CONFETTI_COLORS = TAG_COLOR_PALETTE.filter((c) => c !== "#8B959C"); // fuera el gris: para confeti no aporta nada

// Mensaje de la recompensa grande, según qué la haya disparado. `label`
// recibe el número a mostrar (no siempre es el mismo que el hito cruzado,
// ver crossedMilestone más abajo) y devuelve el texto delante del guion.
const CELEBRATION_KINDS = {
  selection: {
    emoji: "🎉",
    phrases: ["¡Racha completada!", "Eso es productividad.", "Bandeja un poco más ligera.", "Así se hace.", "Imparable.", "De un plumazo."],
    label: (n) => `${n} ${n === 1 ? "tarea completada" : "tareas completadas"}`,
  },
  streak: {
    emoji: "⚡",
    phrases: ["¡Racha en marcha!", "Una detrás de otra.", "No hay quien te pare.", "Encadenando tareas.", "A este ritmo…"],
    label: (n) => `${n} seguidas`,
  },
  daily: {
    emoji: "🔥",
    phrases: ["¡Menudo día!", "Racha del día.", "Hoy se te da bien esto.", "Sigues sumando."],
    label: (n) => `${n} ${n === 1 ? "tarea hoy" : "tareas hoy"}`,
  },
};

// Completar 3 o más seguidas dentro de esta ventana cuenta como "racha
// rápida" y dispara la recompensa grande — se sigue disparando en cada
// una más mientras la racha no se enfríe, como un contador de combo.
const RAPID_WINDOW_MS = 9000;
const RAPID_THRESHOLD = 3;

// Hitos del día que disparan la recompensa grande por acumulado (no hace
// falta que sean seguidas ni rápidas: basta con ir completando a lo largo
// de la jornada). Se guarda en este navegador, no en la cuenta — es un
// marcador de ánimo para la sesión de hoy, no un dato que necesite viajar
// entre dispositivos ni sobrevivir para siempre.
const DAILY_MILESTONES = [5, 10, 15, 20, 30, 50, 75, 100];
const DAILY_STORAGE_KEY = "chusy:dailyCompletions";

let recentCompletions = []; // timestamps en memoria, para la racha rápida — se reinicia solo con recargar la página, y tiene sentido que así sea

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomColor() {
  return CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
}

function makePiece({ left, top, extraClass, vars }) {
  const piece = document.createElement("span");
  piece.className = `confetti-piece ${extraClass}`;
  const size = 4 + Math.random() * 5;
  const shape = Math.random() > 0.4 ? "50%" : "2px";
  let style = `left:${left}px; top:${top}px; width:${size}px; height:${size}px; background:${randomColor()}; border-radius:${shape};`;
  for (const [key, value] of Object.entries(vars)) style += `${key}:${value};`;
  piece.style.cssText = style;
  document.body.appendChild(piece);
  piece.addEventListener("animationend", () => piece.remove(), { once: true });
  // por si el navegador no llega a disparar animationend (pestaña en
  // segundo plano, etc.) — que no se queden nodos huérfanos en el DOM
  setTimeout(() => piece.remove(), 2500);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readDailyCount() {
  try {
    const stored = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY) || "null");
    return stored && stored.date === todayKey() ? stored.count : 0;
  } catch (e) {
    return 0; // localStorage no disponible: la racha diaria simplemente no se cuenta
  }
}

function writeDailyCount(count) {
  try { localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify({ date: todayKey(), count })); } catch (e) { /* idem */ }
}

/** El primer hito (de menor a mayor) que queda cruzado al pasar de `prev` a `next` — o undefined si no se cruza ninguno. */
function crossedMilestone(prev, next) {
  return DAILY_MILESTONES.find((m) => m > prev && m <= next);
}

/**
 * Suma `n` completadas al contador de HOY y devuelve el total resultante
 * más si se acaba de cruzar un hito. La usan tanto celebrateTask (una a
 * una) como celebrateBulk cuando la recompensa es por selección múltiple
 * (para que lo hecho de golpe también cuente de cara al total del día).
 */
function bumpDailyCompletions(n) {
  const prev = readDailyCount();
  const count = prev + n;
  writeDailyCount(count);
  return { count, milestone: crossedMilestone(prev, count) };
}

/** Al marcar UNA tarea como completada: un chispazo desde el propio check. */
export function celebrateTask(checkEl) {
  if (prefersReducedMotion()) return;

  if (checkEl) {
    checkEl.classList.remove("is-celebrating");
    void checkEl.offsetWidth; // reinicia la animación si se completan varias seguidas
    checkEl.classList.add("is-celebrating");
  }

  const rect = checkEl ? checkEl.getBoundingClientRect() : null;
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 26 + Math.random() * 26;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 14; // sesgo hacia arriba, más satisfactorio que caer
    makePiece({
      left: x, top: y, extraClass: "confetti-piece--burst",
      vars: { "--dx": `${dx}px`, "--dy": `${dy}px`, "--rot": `${Math.random() * 480 - 240}deg` },
    });
  }

  // Además del chispazo de siempre, esta completada cuenta para dos
  // rachas — cuál de las dos (si alguna) se lleva la recompensa grande:
  //   1. Rápida: ¿van ya 3+ completadas seguidas en los últimos 9s?
  //   2. Del día: ¿se acaba de cruzar un hito de hoy (5, 10, 15…)?
  // Si coinciden las dos a la vez, gana la del día (es la noticia más
  // gorda) para no lanzar dos recompensas grandes de golpe.
  const now = Date.now();
  recentCompletions = recentCompletions.filter((t) => now - t < RAPID_WINDOW_MS);
  recentCompletions.push(now);
  const rapidCount = recentCompletions.length;

  const { count: dailyCount, milestone } = bumpDailyCompletions(1);

  if (milestone) celebrateBulk(dailyCount, "daily");
  else if (rapidCount >= RAPID_THRESHOLD) celebrateBulk(rapidCount, "streak");
}

/**
 * La recompensa "gorda": confeti cayendo por todo el ancho + un mensaje
 * breve. `count` es cuántas tareas se acaban de completar (para el
 * mensaje) y `kind` de dónde viene — "selection" (varias de golpe, ver
 * bulk-toolbar.js), "streak" (varias seguidas y rápido) o "daily"
 * (hito del día) — cada una con su propio emoji y frases (ver
 * CELEBRATION_KINDS). Por defecto "selection", para no romper a quien ya
 * la llamaba sin ese segundo argumento.
 */
export function celebrateBulk(count, kind = "selection") {
  if (prefersReducedMotion() || !count) return;

  // Una selección múltiple completada no pasa por celebrateTask (no hay
  // "un" check que pulsar), así que es aquí donde se suma al contador del
  // día — para "streak"/"daily" no hace falta: celebrateTask ya sumó esa
  // tarea antes de llamar aquí, sumarla otra vez la contaría dos veces.
  if (kind === "selection") bumpDailyCompletions(count);

  const pieces = Math.min(90, 30 + count * 4); // más tareas, más fiesta (con techo razonable)
  for (let i = 0; i < pieces; i++) {
    const left = Math.random() * window.innerWidth;
    const delay = Math.random() * 400;
    const duration = 1600 + Math.random() * 900;
    const fallDistance = window.innerHeight * (0.55 + Math.random() * 0.5);
    makePiece({
      left, top: -16, extraClass: "confetti-piece--fall",
      vars: {
        "--fall-y": `${fallDistance}px`,
        "--rot": `${Math.random() * 720 - 360}deg`,
        "animation-delay": `${delay}ms`,
        "animation-duration": `${duration}ms`,
      },
    });
  }

  const { emoji, phrases, label } = CELEBRATION_KINDS[kind] || CELEBRATION_KINDS.selection;
  const msg = document.createElement("div");
  msg.className = "celebrate-toast";
  msg.textContent = `${emoji} ${label(count)} — ${phrases[Math.floor(Math.random() * phrases.length)]}`;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 2600);
}
