// ============================================================================
// Calendario laboral y de ausencias (v78) — LÓGICA PURA.
//
// Sin DOM ni Firebase (solo importa departments.js, que tampoco los usa): se
// puede probar suelto en Node. Lo que guarda Firestore está en
// data/work-calendar.js; la ventana de gestión, en
// components/work-calendar-modal.js; y el aviso de plazos, en task-modal.js y
// las vistas de Calendario y Línea de tiempo.
//
// Para qué sirve: que un plazo sea REALISTA sin obligar a nadie a fichar
// tiempos. Chusy sabe qué días no se trabaja (fin de semana, festivos) y qué
// días no está una persona (vacaciones o ausencias que registra un admin), y
// con eso avisa «esta fecha cae en festivo» o «Ana está de vacaciones» y
// calcula plazos y duraciones en días LABORABLES.
//
// «Configuración del calendario» (`cfg`, lo que devuelve normalizeWorkCalendar):
//   holidays: [{ id, date: 'YYYY-MM-DD', name, scope }]   scope ∈ HOLIDAY_SCOPES
//   absences: [{ id, userId, startDate, endDate, type, note }]   type ∈ ABSENCE_TYPES
//   (los dos días de cada ausencia incluidos)
// Todas las funciones aceptan `cfg` nulo (= sin festivos ni ausencias: solo
// cuentan los fines de semana) y fechas como Date, 'YYYY-MM-DD' o Timestamp de
// Firestore (cualquier cosa con .toDate()).
//
// Reglas que conviene tener presentes:
//  · Un día es laborable si NO es sábado/domingo, NO es festivo y —si se pasa
//    `userId`— esa persona NO está ausente. `userId` también puede ser una
//    lista (la tarea con varios responsables): hace falta que no falte NINGUNA.
//  · `cfg` se trata como INMUTABLE: se indexa una vez (WeakMap) para que
//    preguntar por cada día de un Gantt no recorra las listas cada vez. Para
//    cambiar algo, las funciones `with…`/`add…`/`remove…` devuelven un `cfg`
//    nuevo.
//  · Los días se recorren con `new Date(y, m, d + n)` (fecha local), no sumando
//    milisegundos: el cambio de hora de marzo/octubre no mueve ningún día.
//  · Si no hay ningún día laborable en ~10 años (todo festivo o ausente), las
//    búsquedas devuelven `null` en vez de quedarse dando vueltas.
// ============================================================================
import { metricsScopeFor, memberMatchesDepartmentFilter } from "./departments.js";

export const ABSENCE_TYPES = Object.freeze({ vacaciones: "Vacaciones", ausencia: "Ausencia" });
/** Ámbito de un festivo (solo informativo: todos cuentan igual para el cálculo). */
export const HOLIDAY_SCOPES = Object.freeze({ nacional: "Nacional", autonomico: "Castilla-La Mancha", local: "Albacete", empresa: "Empresa" });
/** Topes (el documento de Firestore mide como mucho 1 MiB; ver también firestore.rules). */
export const MAX_HOLIDAYS = 400;
export const MAX_ABSENCES = 2000;
const MAX_NAME = 80;
const MAX_NOTE = 200;
const SEARCH_DAYS = 3660;

export const EMPTY_CALENDAR = Object.freeze({ holidays: Object.freeze([]), absences: Object.freeze([]) });

// ------------------------------------------------------------------ fechas

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' → Date local a medianoche; `null` si no es una fecha real (el 2026-02-30 no lo es). */
export function parseDateKey(key) {
  if (typeof key !== "string") return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** Date | 'YYYY-MM-DD' | Timestamp → Date local a medianoche, o `null`. */
function toDay(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && KEY_RE.test(value)) return parseDateKey(value);
  let d = value;
  if (typeof value.toDate === "function") d = value.toDate();
  else if (!(value instanceof Date)) d = new Date(value);
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Cualquier fecha → 'YYYY-MM-DD' (local), o `null`. */
export function dateKey(value) {
  const d = toDay(value);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
}

const stepDay = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** «DD/MM» de una fecha ('' si no es válida) — para los botones y avisos. */
export function formatDayMonth(value) {
  const d = toDay(value);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : "";
}

// ------------------------------------------------------------------ índice

const indexCache = new WeakMap();
const EMPTY_INDEX = { holidays: new Map(), absences: new Map() };

function indexOf(cfg) {
  if (!cfg || typeof cfg !== "object") return EMPTY_INDEX;
  let idx = indexCache.get(cfg);
  if (idx) return idx;
  idx = { holidays: new Map(), absences: new Map() };
  for (const h of cfg.holidays || []) {
    const key = h && dateKey(h.date);
    if (key && !idx.holidays.has(key)) idx.holidays.set(key, h);
  }
  for (const a of cfg.absences || []) {
    const s = a && dateKey(a.startDate);
    const e = a && dateKey(a.endDate);
    if (!s || !e || !a.userId) continue;
    const list = idx.absences.get(a.userId) || [];
    list.push({ s: s <= e ? s : e, e: s <= e ? e : s, absence: a }); // 'YYYY-MM-DD' ordena como las fechas
    idx.absences.set(a.userId, list);
  }
  indexCache.set(cfg, idx);
  return idx;
}

const toIdList = (userId) => (Array.isArray(userId) ? userId : userId ? [userId] : []).filter(Boolean);

// ------------------------------------------------------------------ evaluación de un día

export function isWeekend(date) {
  const d = toDay(date);
  if (!d) return false;
  const w = d.getDay();
  return w === 0 || w === 6;
}

/** El festivo de ese día ({ id, date, name, scope }) o `null`. */
export function getHoliday(date, cfg) {
  const key = dateKey(date);
  return key ? indexOf(cfg).holidays.get(key) || null : null;
}

export function isHoliday(date, cfg) {
  return !!getHoliday(date, cfg);
}

/** La ausencia de esa persona que cubre ese día, o `null`. */
export function getAbsence(userId, date, cfg) {
  const key = dateKey(date);
  if (!key || !userId) return null;
  const list = indexOf(cfg).absences.get(userId);
  if (!list) return null;
  const hit = list.find((r) => r.s <= key && key <= r.e);
  return hit ? hit.absence : null;
}

export function isUserAbsent(userId, date, cfg) {
  return !!getAbsence(userId, date, cfg);
}

/** Las ausencias (una por persona) que cubren ese día entre `userIds`. */
export function getAbsences(userIds, date, cfg) {
  return toIdList(userIds).map((id) => getAbsence(id, date, cfg)).filter(Boolean);
}

/**
 * ¿Es un día de trabajo? Ni fin de semana, ni festivo, ni ausente (`userId`:
 * una persona, una lista —no puede faltar ninguna— o nada = solo la empresa).
 * Una fecha no válida no es laborable.
 */
export function isWorkingDay(date, cfg, userId) {
  const d = toDay(date);
  if (!d) return false;
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  if (isHoliday(d, cfg)) return false;
  return !toIdList(userId).some((id) => isUserAbsent(id, d, cfg));
}

/**
 * Por qué una fecha NO es laborable: `{ weekend, holiday, absences, ok }`
 * (`ok` = laborable de verdad). Lo usa el aviso del modal de tarea.
 */
export function describeDay(date, cfg, userIds) {
  const weekend = isWeekend(date);
  const holiday = getHoliday(date, cfg);
  const absences = getAbsences(userIds, date, cfg);
  return { weekend, holiday, absences, ok: !!toDay(date) && !weekend && !holiday && !absences.length };
}

// ------------------------------------------------------------------ plazos

/**
 * El primer día laborable desde `date` EN ADELANTE, contando el propio
 * `date`: si ya lo es, devuelve esa misma fecha (a medianoche). `null` si no
 * hay ninguno en ~10 años o la fecha no vale.
 */
export function nextWorkingDay(date, cfg, userId) {
  let d = toDay(date);
  if (!d) return null;
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    if (isWorkingDay(d, cfg, userId)) return d;
    d = stepDay(d, 1);
  }
  return null;
}

/**
 * El último día laborable desde `date` HACIA ATRÁS, contando el propio `date`:
 * si ya lo es, devuelve esa misma fecha. Es el espejo de `nextWorkingDay`: sirve
 * para ajustar una fecha de ENTREGA sin pasarse de ella (v79). `null` si no hay
 * ninguno en ~10 años o la fecha no vale.
 */
export function previousWorkingDay(date, cfg, userId) {
  let d = toDay(date);
  if (!d) return null;
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    if (isWorkingDay(d, cfg, userId)) return d;
    d = stepDay(d, -1);
  }
  return null;
}

/**
 * `start` + `days` días laborables (como WORKDAY de Excel): el día de partida
 * no cuenta —1 es el siguiente laborable—, 0 devuelve `start` tal cual
 * (aunque no sea laborable) y un número negativo cuenta hacia atrás.
 */
export function addWorkingDays(start, days, cfg, userId) {
  let d = toDay(start);
  if (!d || !Number.isFinite(days)) return null;
  const n = Math.trunc(days);
  if (n === 0) return d;
  const dir = n > 0 ? 1 : -1;
  const maxSteps = Math.max(SEARCH_DAYS, Math.abs(n) * 8);
  let remaining = Math.abs(n);
  for (let steps = 0; remaining > 0; steps++) {
    if (steps > maxSteps) return null;
    d = stepDay(d, dir);
    if (isWorkingDay(d, cfg, userId)) remaining--;
  }
  return d;
}

/** Días laborables entre `start` y `end`, los dos incluidos (0 si `end` es anterior o alguna fecha no vale). */
export function countWorkingDays(start, end, cfg, userId) {
  const s = toDay(start);
  const e = toDay(end);
  if (!s || !e || e < s) return 0;
  let n = 0;
  for (let d = s; d <= e; d = stepDay(d, 1)) if (isWorkingDay(d, cfg, userId)) n++;
  return n;
}

// ------------------------------------------------------------------ normalizar (lo que llega de Firestore)

function newId(prefix) {
  const c = globalThis.crypto;
  return `${prefix}_${c && c.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanHoliday(raw) {
  if (!raw || typeof raw !== "object") return null;
  const date = dateKey(typeof raw.date === "string" && !KEY_RE.test(raw.date) ? null : raw.date);
  if (!date) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("h"),
    date,
    name: text(raw.name, MAX_NAME) || "Festivo",
    scope: raw.scope in HOLIDAY_SCOPES ? raw.scope : "empresa",
  };
}

function cleanAbsence(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.userId !== "string" || !raw.userId) return null;
  const a = typeof raw.startDate === "string" && !KEY_RE.test(raw.startDate) ? null : dateKey(raw.startDate);
  const b = typeof raw.endDate === "string" && !KEY_RE.test(raw.endDate) ? null : dateKey(raw.endDate);
  if (!a || !b) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("a"),
    userId: raw.userId,
    startDate: a <= b ? a : b,
    endDate: a <= b ? b : a,
    type: raw.type in ABSENCE_TYPES ? raw.type : "ausencia",
    note: text(raw.note, MAX_NOTE),
  };
}

const uniqueById = (list) => {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
};
const freezeCfg = (holidays, absences) => Object.freeze({ holidays: Object.freeze(holidays), absences: Object.freeze(absences) });

/**
 * Lo que haya en el documento (o `null`/algo roto) → `cfg` limpio, ordenado y
 * congelado: descarta entradas sin fecha real o sin persona, repara el orden
 * de las fechas de una ausencia y recorta textos. Nunca lanza.
 */
export function normalizeWorkCalendar(raw) {
  if (!raw || typeof raw !== "object") return EMPTY_CALENDAR;
  const holidays = uniqueById((Array.isArray(raw.holidays) ? raw.holidays : []).map(cleanHoliday).filter(Boolean))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  const absences = uniqueById((Array.isArray(raw.absences) ? raw.absences : []).map(cleanAbsence).filter(Boolean))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.userId.localeCompare(b.userId)));
  return freezeCfg(holidays, absences);
}

// ------------------------------------------------------------------ cambios (devuelven un cfg nuevo; lanzan Error con un mensaje para mostrar)

function checkHoliday(input) {
  const date = typeof input.date === "string" && !KEY_RE.test(input.date) ? null : dateKey(input.date);
  if (!date) throw new Error("La fecha del festivo no es válida.");
  const name = text(input.name, MAX_NAME);
  if (!name) throw new Error("Pon un nombre al festivo.");
  return { date, name, scope: input.scope in HOLIDAY_SCOPES ? input.scope : "empresa" };
}

function checkAbsence(input) {
  if (!input.userId || typeof input.userId !== "string") throw new Error("Elige a la persona.");
  const a = typeof input.startDate === "string" && !KEY_RE.test(input.startDate) ? null : dateKey(input.startDate);
  const b = typeof input.endDate === "string" && !KEY_RE.test(input.endDate) ? null : dateKey(input.endDate);
  if (!a || !b) throw new Error("Indica las fechas «Desde» y «Hasta».");
  if (b < a) throw new Error("«Hasta» no puede ser anterior a «Desde».");
  return {
    userId: input.userId, startDate: a, endDate: b,
    type: input.type in ABSENCE_TYPES ? input.type : "vacaciones",
    note: text(input.note, MAX_NOTE),
  };
}

export function addHoliday(cfg, input) {
  const base = cfg || EMPTY_CALENDAR;
  if (base.holidays.length >= MAX_HOLIDAYS) throw new Error(`Hay demasiados festivos (máximo ${MAX_HOLIDAYS}).`);
  const holiday = { id: newId("h"), ...checkHoliday(input) };
  return { cfg: normalizeWorkCalendar({ holidays: [...base.holidays, holiday], absences: base.absences }), holiday };
}

export function updateHoliday(cfg, id, patch) {
  const base = cfg || EMPTY_CALENDAR;
  const cur = base.holidays.find((h) => h.id === id);
  if (!cur) throw new Error("Ese festivo ya no existe.");
  const next = { id, ...checkHoliday({ ...cur, ...patch }) };
  return { cfg: normalizeWorkCalendar({ holidays: base.holidays.map((h) => (h.id === id ? next : h)), absences: base.absences }), holiday: next };
}

export function removeHoliday(cfg, id) {
  const base = cfg || EMPTY_CALENDAR;
  return normalizeWorkCalendar({ holidays: base.holidays.filter((h) => h.id !== id), absences: base.absences });
}

/**
 * Añade festivos de golpe (la semilla oficial) SIN duplicar: un festivo que
 * caiga en una fecha donde ya hay otro (se llame como se llame) se salta.
 * Devuelve `{ cfg, added, skipped }`.
 */
export function mergeHolidays(cfg, list) {
  const base = cfg || EMPTY_CALENDAR;
  const taken = new Set(base.holidays.map((h) => h.date));
  const fresh = [];
  let skipped = 0;
  for (const item of list) {
    const h = checkHoliday(item);
    if (taken.has(h.date)) { skipped++; continue; }
    taken.add(h.date);
    fresh.push({ id: newId("h"), ...h });
  }
  if (base.holidays.length + fresh.length > MAX_HOLIDAYS) throw new Error(`Hay demasiados festivos (máximo ${MAX_HOLIDAYS}).`);
  return { cfg: normalizeWorkCalendar({ holidays: [...base.holidays, ...fresh], absences: base.absences }), added: fresh.length, skipped };
}

export function addAbsence(cfg, input) {
  const base = cfg || EMPTY_CALENDAR;
  if (base.absences.length >= MAX_ABSENCES) throw new Error(`Hay demasiadas ausencias (máximo ${MAX_ABSENCES}).`);
  const absence = { id: newId("a"), ...checkAbsence(input) };
  return { cfg: normalizeWorkCalendar({ holidays: base.holidays, absences: [...base.absences, absence] }), absence };
}

export function updateAbsence(cfg, id, patch) {
  const base = cfg || EMPTY_CALENDAR;
  const cur = base.absences.find((a) => a.id === id);
  if (!cur) throw new Error("Esa ausencia ya no existe.");
  const next = { id, ...checkAbsence({ ...cur, ...patch }) };
  return { cfg: normalizeWorkCalendar({ holidays: base.holidays, absences: base.absences.map((a) => (a.id === id ? next : a)) }), absence: next };
}

export function removeAbsence(cfg, id) {
  const base = cfg || EMPTY_CALENDAR;
  return normalizeWorkCalendar({ holidays: base.holidays, absences: base.absences.filter((a) => a.id !== id) });
}

// ------------------------------------------------------------------ quién ve qué

/**
 * Las ausencias que `viewer` puede VER en la ventana del calendario: un admin,
 * todas; cualquier otra persona, las suyas y las de las personas de su
 * departamento (su grupo de acceso: el mismo criterio que Métricas, ver
 * `metricsScopeFor` en departments.js — los dos Diseño van juntos). Sin
 * departamento reconocido, solo las propias. Es un límite de INTERFAZ, como el
 * resto (el documento lo puede leer cualquier cuenta activa: ver firestore.rules).
 */
export function visibleAbsences(cfg, viewer, members) {
  const base = cfg || EMPTY_CALENDAR;
  if (!viewer) return [];
  if (viewer.role === "admin") return [...base.absences];
  const scope = metricsScopeFor(viewer);
  const byId = new Map((members || []).map((m) => [m.uid, m]));
  return base.absences.filter((a) => a.userId === viewer.uid || (scope !== null && byId.has(a.userId) && memberMatchesDepartmentFilter(byId.get(a.userId), scope)));
}

/** La nota de una ausencia solo la ven un admin y la propia persona (puede ser algo personal). */
export function canSeeAbsenceNote(absence, viewer) {
  return !!viewer && !!absence && (viewer.role === "admin" || viewer.uid === absence.userId);
}

// ------------------------------------------------------------------ avisos de una tarea

/**
 * Problemas de calendario de una tarea (vacío si no hay o si está completada):
 *  · { kind:'holiday', date, name }                  inicio o fin en un festivo
 *  · { kind:'absence', date, userId, type }          inicio o fin en un día que un responsable no está
 *  · { kind:'absence-range', userId, type, days }    ese responsable falta `days` días laborables DENTRO del rango
 * Los festivos y fines de semana dentro de un rango NO se avisan (una tarea de
 * varios días los cruza siempre); sí las ausencias, porque restan trabajo real.
 */
export function taskCalendarIssues(task, cfg, assigneeIds) {
  if (!task || task.isComplete) return [];
  const start = dateKey(task.startDate);
  const due = dateKey(task.dueDate);
  if (!start && !due) return [];
  const ids = toIdList(assigneeIds !== undefined ? assigneeIds : task.assigneeIds);
  const issues = [];
  const flagged = new Set();
  for (const key of new Set([start, due].filter(Boolean))) {
    const holiday = getHoliday(key, cfg);
    if (holiday) issues.push({ kind: "holiday", date: key, name: holiday.name });
    for (const id of ids) {
      const absence = getAbsence(id, key, cfg);
      if (absence) { issues.push({ kind: "absence", date: key, userId: id, type: absence.type }); flagged.add(id); }
    }
  }
  if (start && due && start < due) {
    for (const id of ids) {
      if (flagged.has(id)) continue;
      let days = 0, type = null;
      for (let d = parseDateKey(start), end = parseDateKey(due); d <= end; d = stepDay(d, 1)) {
        if (isWeekend(d) || isHoliday(d, cfg)) continue;
        const absence = getAbsence(id, d, cfg);
        if (absence) { days++; type = type || absence.type; }
      }
      if (days) issues.push({ kind: "absence-range", userId: id, type, days });
    }
  }
  return issues;
}

/** Una línea legible por problema; `nameOf(userId)` pone el nombre de la persona. */
export function describeIssue(issue, nameOf) {
  const who = nameOf ? nameOf(issue.userId) || "un responsable" : "un responsable";
  const kindWord = issue.type === "vacaciones" ? "de vacaciones" : "ausente";
  if (issue.kind === "holiday") return `${formatDayMonth(issue.date)}: festivo (${issue.name})`;
  if (issue.kind === "absence") return `${formatDayMonth(issue.date)}: ${who} está ${kindWord}`;
  return `${who} está ${kindWord} ${issue.days} ${issue.days === 1 ? "día laborable" : "días laborables"} dentro del plazo`;
}

// ------------------------------------------------------------------ festivos oficiales (semilla)

/**
 * Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano):
 * de él salen Jueves Santo (−3), Viernes Santo (−2), Lunes de Pascua (+1) y
 * Corpus Christi (+60, siempre jueves).
 */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Corpus Christi: el jueves 60 días después del Domingo de Resurrección (4 de junio en 2026). */
export function corpusChristi(year) {
  return stepDay(easterSunday(year), 60);
}

/**
 * Festivos OFICIALES tal como los publican los decretos —no se calculan—:
 * calendario laboral de Castilla-La Mancha de 2026 (Decreto 44/2025, DOCM de
 * 26/06/2025) y de 2027 (Decreto 34/2026, DOCM de 13/07/2026), con los
 * festivos locales de Albacete capital (24 de junio, San Juan, y 8 de
 * septiembre, Virgen de Los Llanos). Los locales de 2027 todavía no estaban
 * publicados en boletín cuando se escribió esto: son las fechas de siempre y
 * llevan «(por confirmar)». «scope»: n = nacional, a = autonómico, l = local.
 *
 * v80 — el Lunes de Pascua de 2026 (06/04) SE QUEDA: el Decreto 44/2025 lo
 * declara festivo en Castilla-La Mancha (sustituye al 19 de marzo, San José),
 * igual que el Corpus Christi del 4 de junio (sustituye al 6 de diciembre, que
 * cae en domingo) y el 2 de noviembre (sustituye al 1). Por la misma razón en
 * 2026 NO hay 31/05 (Día de Castilla-La Mancha, domingo) ni 07/12. Quien lo
 * necesite distinto (convenio propio) lo borra desde el modal.
 */
const OFFICIAL = {
  2026: [
    ["01-01", "Año Nuevo", "n"], ["01-06", "Epifanía del Señor", "n"], ["04-02", "Jueves Santo", "a"],
    ["04-03", "Viernes Santo", "n"], ["04-06", "Lunes de Pascua", "a"], ["05-01", "Fiesta del Trabajo", "n"],
    ["06-04", "Corpus Christi", "a"], ["06-24", "San Juan Bautista", "l"], ["08-15", "Asunción de la Virgen", "n"],
    ["09-08", "Virgen de Los Llanos", "l"], ["10-12", "Fiesta Nacional de España", "n"],
    ["11-02", "Todos los Santos (trasladado)", "a"], ["12-08", "Inmaculada Concepción", "n"], ["12-25", "Navidad", "n"],
  ],
  2027: [
    ["01-01", "Año Nuevo", "n"], ["01-06", "Epifanía del Señor", "n"], ["03-25", "Jueves Santo", "a"],
    ["03-26", "Viernes Santo", "n"], ["05-01", "Fiesta del Trabajo", "n"], ["05-27", "Corpus Christi", "a"],
    ["05-31", "Día de Castilla-La Mancha", "a"], ["06-24", "San Juan Bautista (por confirmar)", "l"],
    ["09-08", "Virgen de Los Llanos (por confirmar)", "l"], ["10-12", "Fiesta Nacional de España", "n"],
    ["11-01", "Todos los Santos", "n"], ["12-06", "Día de la Constitución", "n"], ["12-08", "Inmaculada Concepción", "n"],
    ["12-25", "Navidad", "n"],
  ],
};
const SCOPE_OF = { n: "nacional", a: "autonomico", l: "local" };

/** ¿Tenemos el decreto oficial de ese año (true) o solo la estimación (false)? */
export function hasOfficialHolidays(year) {
  return !!OFFICIAL[year];
}

/** Los años para los que se carga la semilla: el actual y el siguiente. */
export function seedYears(now = new Date()) {
  const y = now.getFullYear();
  return [y, y + 1];
}

/**
 * ESTIMACIÓN para un año sin decreto cargado (v80: dinámica por año), marcada
 * «(estimado)». Nacionales: Año Nuevo, Epifanía, Viernes Santo (Pascua −2),
 * Fiesta del Trabajo, Asunción, Fiesta Nacional, Todos los Santos (01/11, o
 * 02/11 si cae en domingo), Constitución (06/12, o 07/12 si cae en domingo),
 * Inmaculada y Navidad. Castilla-La Mancha: Jueves Santo (Pascua −3), Corpus
 * Christi (Pascua +60) y Día de Castilla-La Mancha (31/05). Albacete: San Juan
 * Bautista (24/06) y Virgen de Los Llanos (08/09). NO lleva Lunes de Pascua:
 * solo es festivo en los años en que el decreto de Castilla-La Mancha lo
 * elige (como en 2026, que va en la tabla oficial).
 */
export function estimatedHolidays(year) {
  const isSunday = (m, d) => new Date(year, m - 1, d).getDay() === 0;
  const mk = (mmdd, name, scope) => ({ date: `${year}-${mmdd}`, name: `${name} (estimado)`, scope });
  const fromEaster = (n, name, scope) => ({ date: dateKey(stepDay(easterSunday(year), n)), name: `${name} (estimado)`, scope });
  // Algún año (2029) el Corpus Christi cae el propio 31/05: un solo festivo con los dos nombres.
  const corpusIs31May = dateKey(corpusChristi(year)) === `${year}-05-31`;
  return [
    mk("01-01", "Año Nuevo", "nacional"),
    mk("01-06", "Epifanía del Señor", "nacional"),
    fromEaster(-3, "Jueves Santo", "autonomico"),
    fromEaster(-2, "Viernes Santo", "nacional"),
    mk("05-01", "Fiesta del Trabajo", "nacional"),
    fromEaster(60, corpusIs31May ? "Corpus Christi y Día de Castilla-La Mancha" : "Corpus Christi", "autonomico"),
    ...(corpusIs31May ? [] : [mk("05-31", "Día de Castilla-La Mancha", "autonomico")]),
    mk("06-24", "San Juan Bautista", "local"),
    mk("08-15", "Asunción de la Virgen", "nacional"),
    mk("09-08", "Virgen de Los Llanos", "local"),
    mk("10-12", "Fiesta Nacional de España", "nacional"),
    isSunday(11, 1) ? mk("11-02", "Todos los Santos (trasladado)", "autonomico") : mk("11-01", "Todos los Santos", "nacional"),
    isSunday(12, 6) ? mk("12-07", "Día de la Constitución (trasladado)", "autonomico") : mk("12-06", "Día de la Constitución", "nacional"),
    mk("12-08", "Inmaculada Concepción", "nacional"),
    mk("12-25", "Navidad", "nacional"),
  ];
}

/**
 * Festivos oficiales de un año: los del decreto si lo tenemos (2026 y 2027) y,
 * para cualquier otro, la estimación de `estimatedHolidays` (cada año
 * Castilla-La Mancha publica su decreto con traslados y festivos propios —ahí
 * hay que revisar a mano—).
 */
export function officialHolidays(year) {
  if (OFFICIAL[year]) return OFFICIAL[year].map(([mmdd, name, s]) => ({ date: `${year}-${mmdd}`, name, scope: SCOPE_OF[s] }));
  return estimatedHolidays(year);
}

/** Semilla para el año en curso y el siguiente (lista para `mergeHolidays`). */
export function officialHolidaysForSeed(now = new Date()) {
  return seedYears(now).flatMap((y) => officialHolidays(y));
}
