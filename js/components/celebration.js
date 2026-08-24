// ============================================================================
// Pequeña recompensa visual al completar tareas: un chispazo de confeti
// discreto desde el propio círculo al marcar una sola, y algo bastante
// más vistoso — confeti cayendo por toda la pantalla + un mensaje — al
// completar varias de golpe (acción masiva). Solo CSS + DOM, sin canvas
// ni librerías, y respeta prefers-reduced-motion (para esa gente no se
// dispara nada, solo se guarda el estado como siempre).
// ============================================================================
import { TAG_COLOR_PALETTE } from "../data/tags.js";

const CONFETTI_COLORS = TAG_COLOR_PALETTE.filter((c) => c !== "#8B959C"); // fuera el gris: para confeti no aporta nada

const BULK_MESSAGES = [
  "¡Racha completada!",
  "Eso es productividad.",
  "Bandeja un poco más ligera.",
  "Así se hace.",
  "Imparable.",
  "De un plumazo.",
];

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
}

/**
 * Al completar VARIAS tareas de golpe (acción masiva): confeti cayendo
 * por todo el ancho + un mensaje breve — la "recompensa gorda". `count`
 * es cuántas se acaban de completar, para el mensaje.
 */
export function celebrateBulk(count) {
  if (prefersReducedMotion() || !count) return;

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

  const msg = document.createElement("div");
  msg.className = "celebrate-toast";
  msg.textContent = `🎉 ${count} ${count === 1 ? "tarea completada" : "tareas completadas"} — ${BULK_MESSAGES[Math.floor(Math.random() * BULK_MESSAGES.length)]}`;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 2600);
}
