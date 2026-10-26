// ============================================================================
// Calendario laboral y ausencias (v78): el documento de Firestore.
//
//   meta/workCalendar  {
//     holidays: [{ id, date: 'YYYY-MM-DD', name, scope }],        festivos de empresa/locales
//     absences: [{ id, userId, startDate, endDate, type, note }], vacaciones y ausencias del equipo
//     updatedBy, updatedAt
//   }
//
// UN solo documento (no uno por festivo ni por ausencia): una suscripción, una
// lectura al abrir sesión y los cambios en tiempo real cuestan lo mismo
// pesen lo que pesen las listas (un equipo de 6-15 personas: unas decenas de
// festivos y de ausencias al año, muy por debajo del megabyte de un
// documento). Va en `meta/`, con los demás ajustes del equipo.
//
// Lectura para cualquier cuenta activa (todas las vistas y el modal de tarea
// necesitan los festivos y las ausencias para avisar) y escritura solo para
// administradores — ver firestore.rules. La lógica (qué es laborable, cómo
// añadir o quitar) está en js/work-calendar.js, sin Firebase.
//
// Entra por js/store.js (rebanada `workCalendar`, clave `workCalendar:doc`) a
// través de data/store-subscriptions.js: una sola escucha para toda la sesión,
// aunque la pidan app.js y, después, la ventana de gestión.
// ============================================================================
import { db } from "../firebase-init.js";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { subscribeToStoreDoc } from "./store-subscriptions.js";
import { normalizeWorkCalendar, EMPTY_CALENDAR } from "../work-calendar.js";

const ref = () => doc(db, "meta", "workCalendar");

// Lo último que llegó, ya limpio, para quien lo necesita SIN suscribirse (el
// aviso del modal de tarea, las vistas…). Se rellena desde la suscripción.
let current = EMPTY_CALENDAR;
// El store conserva el MISMO objeto de documento mientras no cambia: se
// normaliza una vez por versión, para que todos compartan el mismo `cfg` (y el
// índice de work-calendar.js, que cuelga de él).
const normalizedByDoc = new WeakMap();
function fromDoc(d) {
  if (!d) return EMPTY_CALENDAR;
  let cfg = normalizedByDoc.get(d);
  if (!cfg) { cfg = normalizeWorkCalendar(d); normalizedByDoc.set(d, cfg); }
  return cfg;
}

/** El calendario tal como está ahora (vacío hasta que llega el primero). Tratar como inmutable. */
export function getWorkCalendar() {
  return current;
}

/** Cierra sesión: nada de la cuenta anterior se queda en memoria. */
export function resetWorkCalendar() {
  current = EMPTY_CALENDAR;
}

/**
 * Escucha el calendario en tiempo real: `callback(cfg)` con `cfg` ya normalizado
 * (sin documento todavía → vacío). Devuelve la función para cancelar.
 */
export function subscribeToWorkCalendar(callback) {
  return subscribeToStoreDoc({
    key: "workCalendar:doc",
    slice: "workCalendar",
    attach: (observer) => onSnapshot(ref(), observer),
    callback: (d) => {
      current = fromDoc(d);
      callback(current);
    },
  });
}

/**
 * Cambia el calendario DENTRO de una transacción: lee la versión actual, le
 * aplica `mutator(cfg)` (una de las funciones `add…`/`update…`/`remove…`/
 * `mergeHolidays` de work-calendar.js, que devuelven un cfg nuevo o
 * `{ cfg, … }`) y escribe el resultado. Así dos administradores que editan a
 * la vez no se pisan: cada cambio parte de lo último que hay en el servidor,
 * no de lo que tenía en pantalla. Solo administradores (lo exigen las reglas).
 * Devuelve lo que devolvió `mutator`; si éste lanza un Error (dato no válido),
 * no se escribe nada y el Error llega a quien llama.
 */
export function updateWorkCalendar(mutator, uid) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref());
    const base = normalizeWorkCalendar(snap.exists() ? snap.data() : null);
    const result = mutator(base);
    const next = result && result.cfg ? result.cfg : result;
    tx.set(ref(), {
      holidays: next.holidays.map((h) => ({ ...h })),
      absences: next.absences.map((a) => ({ ...a })),
      updatedBy: uid || null,
      updatedAt: serverTimestamp(),
    });
    return result;
  });
}
