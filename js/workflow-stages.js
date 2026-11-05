// ============================================================================
// Flujo de trabajo MULTIETAPA industrial (v84) — LÓGICA PURA: sin DOM ni Firebase
// (solo usa work-calendar.js para contar días laborables), así se prueba suelta en Node.
//
// Una tarea de un proyecto normal puede pasar por hasta 3 etapas, siempre en este orden:
//    design      Diseño
//    purchase    Compra/Pedido            (plazo por defecto al activarse: 5 días laborables)
//    production  Recepción/Fabricación
// NO aplica a las tareas del proyecto especial «Ofertas» (siguen con su flujo comercial) ni a las
// personales (sin proyecto). Ver isWorkflowEligible().
//
// Lo que se guarda en la tarea (`task.workflow`), una entrada por etapa:
//    { enabled, completed, completedAt (ISO|null), completedBy (uid|null),
//      assigneeId (uid|null), startDate ('YYYY-MM-DD'|null), dueDate ('YYYY-MM-DD'|null), note }
// Retrocompatible: una tarea sin `workflow` (todas las anteriores a la v84) o con ninguna etapa
// habilitada se comporta como siempre — normalizeWorkflow() devuelve null y taskWorkflow() también.
//
// Reglas:
//  · ETAPA ACTIVA (currentStageKey) = la primera etapa con enabled:true y completed:false.
//  · Mientras haya una etapa activa, los campos principales de la tarea reflejan los de esa etapa
//    (activeFieldsFor / workflowTaskPatch): `assigneeIds` = [responsable de la etapa] (la tarea
//    ya tiene la lista `assigneeIds`, no un único `assigneeId`), `startDate` y `dueDate` = los de la
//    etapa (si la etapa no tiene fecha, se conserva la que ya tuviera la tarea). Así filtros,
//    avisos, calendario y vistas siguen funcionando sin saber nada de etapas.
//  · `upcomingAssigneeIds` = los responsables de las etapas que aún no han empezado: es lo único que
//    permite a Compras o Taller ver en «Mis tareas» lo que les llegará (la consulta de «Mis tareas»
//    solo conoce los campos de la tarea). Nunca incluye a quien ya es el responsable activo.
//  · COMPLETAR (completeCurrentStage): marca la etapa como hecha y activa la siguiente con el relevo
//    (responsable + fechas). Si era la última etapa habilitada, termina la tarea entera.
//  · DEVOLVER (reopenLastStage / reopenStage): reabre una etapa ya completada; las posteriores
//    vuelven a estar pendientes y la reabierta recupera a su responsable de antes (su `assigneeId`
//    no se borra nunca al completarla).
// ============================================================================
import { addWorkingDays, nextWorkingDay, dateKey, formatDayMonth } from "./work-calendar.js";

export const STAGE_KEYS = Object.freeze(["design", "purchase", "production"]);
export const STAGE_LABELS = Object.freeze({ design: "Diseño", purchase: "Compra/Pedido", production: "Recepción/Fabricación" });
/** Nombres cortos para insignias y barras. */
export const STAGE_SHORT = Object.freeze({ design: "Diseño", purchase: "Compra/Pedido", production: "Recepción/Fab." });
/** Días laborables que se dan por defecto a Compra/Pedido cuando se activa. */
export const PURCHASE_DEFAULT_DAYS = 5;
/**
 * v85 · Duración ESTIMADA que se dibuja en la Línea de Tiempo para Recepción/Fabricación cuando todavía no tiene
 * fechas (días laborables tras su inicio, igual que Compra/Pedido). Solo sirve para que la cadena
 * [Diseño] → [Compra] → [Recepción/Fab.] se vea entera; no se guarda en la tarea.
 */
export const PRODUCTION_PROJECTED_DAYS = 5;
/** Colores y etiquetas propios de cada etapa en la Línea de Tiempo (v85). */
export const STAGE_TIMELINE_COLORS = Object.freeze({ design: "#3b82f6", purchase: "#f59e0b", production: "#10b981" });
export const STAGE_TIMELINE_LABELS = Object.freeze({ design: "Diseño", purchase: "Compra", production: "Recepción/Fab." });
const PROJECTED_DAYS = Object.freeze({ design: null, purchase: PURCHASE_DEFAULT_DAYS, production: PRODUCTION_PROJECTED_DAYS });

const isKey = (k) => STAGE_KEYS.includes(k);
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const uidOrNull = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Una etapa vacía (sin responsable ni fechas). */
export function emptyStage(enabled = false) {
  return { enabled: !!enabled, completed: false, completedAt: null, completedBy: null, assigneeId: null, startDate: null, dueDate: null, note: "" };
}

function isoOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
  return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null;
}

function cleanStage(raw) {
  if (!raw || typeof raw !== "object") return emptyStage(false);
  const completed = raw.completed === true;
  return {
    enabled: raw.enabled === true,
    completed,
    completedAt: completed ? isoOrNull(raw.completedAt) : null,
    completedBy: completed ? uidOrNull(raw.completedBy) : null,
    assigneeId: uidOrNull(raw.assigneeId),
    startDate: dateKey(raw.startDate),
    dueDate: dateKey(raw.dueDate),
    note: text(raw.note, 500),
  };
}

/**
 * Lo que llega de Firestore (o de un borrador) → un `workflow` limpio con las 3 etapas, o `null` si no es
 * un objeto (tarea antigua, sin flujo). Un flujo con las 3 etapas apagadas SÍ se devuelve (el usuario lo
 * apagó a propósito): quien quiera saber si hay etapas en uso usa taskWorkflow() o enabledStageKeys().
 */
export function normalizeWorkflow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const k of STAGE_KEYS) out[k] = cleanStage(raw[k]);
  return out;
}

/** El flujo de una tarea NUEVA de proyecto: las 3 etapas marcadas, sin responsables ni fechas. */
export function defaultWorkflow() {
  return { design: emptyStage(true), purchase: emptyStage(true), production: emptyStage(true) };
}

/**
 * Un flujo con las etapas que se indiquen (`enabled`: array de claves o mapa {clave: bool}) y, si se
 * quiere, su responsable y sus fechas (`details[clave] = { assigneeId, startDate, dueDate, note }`).
 */
export function workflowFromEnabled(enabled, details = {}) {
  const on = Array.isArray(enabled) ? new Set(enabled) : new Set(Object.keys(enabled || {}).filter((k) => enabled[k]));
  const wf = {};
  for (const k of STAGE_KEYS) wf[k] = cleanStage({ ...(details[k] || {}), enabled: on.has(k) });
  return wf;
}

// ------------------------------------------------------------------ elegibilidad

/** ¿La tarea pertenece a Ofertas (de principal o de adicional)? */
export function isOfferTask(task, offersProjectId) {
  if (!task || !offersProjectId) return false;
  return task.projectId === offersProjectId || (Array.isArray(task.extraProjectIds) && task.extraProjectIds.includes(offersProjectId));
}

/** ¿Puede llevar etapas? Solo una tarea de algún proyecto que NO esté en Ofertas. */
export function isWorkflowEligible(task, offersProjectId) {
  if (!task) return false;
  const inProject = !!task.projectId || (Array.isArray(task.extraProjectIds) && task.extraProjectIds.length > 0);
  return inProject && !isOfferTask(task, offersProjectId);
}

/** Claves de las etapas habilitadas, en orden. */
export function enabledStageKeys(wf) {
  return wf ? STAGE_KEYS.filter((k) => wf[k] && wf[k].enabled) : [];
}

/**
 * El flujo EN USO de una tarea: normalizado y con al menos una etapa habilitada, o `null` (sin flujo,
 * antigua, de Ofertas o personal). Es lo que consultan las vistas.
 */
export function taskWorkflow(task, offersProjectId) {
  if (!task || !isWorkflowEligible(task, offersProjectId)) return null;
  const wf = normalizeWorkflow(task.workflow);
  return wf && enabledStageKeys(wf).length ? wf : null;
}

// ------------------------------------------------------------------ estado

/** La etapa activa: la primera habilitada y sin completar, o null (todas hechas / ninguna habilitada). */
export function currentStageKey(wf) {
  return wf ? STAGE_KEYS.find((k) => wf[k] && wf[k].enabled && !wf[k].completed) || null : null;
}

/** La etapa habilitada que viene justo después de la activa, o null. */
export function nextStageKey(wf) {
  const cur = currentStageKey(wf);
  if (!cur) return null;
  return STAGE_KEYS.slice(STAGE_KEYS.indexOf(cur) + 1).find((k) => wf[k].enabled) || null;
}

/** 'done' | 'current' | 'pending' | 'off' de una etapa. */
export function stageStatus(wf, key) {
  const s = wf && wf[key];
  if (!s || !s.enabled) return "off";
  if (s.completed) return "done";
  return currentStageKey(wf) === key ? "current" : "pending";
}

/**
 * El progreso para la insignia: { key, label, short, index, total, text } de la etapa activa
 * (index = su posición entre las habilitadas, 1…total), o null si no hay etapa activa.
 * `text`: «Diseño 1/3», «Compra/Pedido 2/3»… y solo «Diseño» si la tarea tiene una única etapa.
 */
export function stageProgress(wf) {
  const key = currentStageKey(wf);
  if (!key) return null;
  const enabled = enabledStageKeys(wf);
  const index = enabled.indexOf(key) + 1;
  const total = enabled.length;
  return { key, label: STAGE_LABELS[key], short: STAGE_SHORT[key], index, total, text: total > 1 ? `${STAGE_SHORT[key]} ${index}/${total}` : STAGE_SHORT[key] };
}

/** La insignia de una tarea (null si no tiene flujo, está completada o ya no queda etapa activa). */
export function taskStageBadge(task, offersProjectId) {
  if (!task || task.isComplete) return null;
  return stageProgress(taskWorkflow(task, offersProjectId));
}

// ------------------------------------------------------------------ edición del flujo

const clone = (wf) => ({ design: { ...wf.design }, purchase: { ...wf.purchase }, production: { ...wf.production } });

/** El mismo flujo con todas las etapas sin completar (al duplicar una tarea): conserva qué etapas lleva, sus responsables y sus fechas. */
export function resetWorkflow(wf) {
  if (!wf) return wf;
  const out = clone(wf);
  for (const k of STAGE_KEYS) out[k] = { ...out[k], completed: false, completedAt: null, completedBy: null };
  return out;
}

/** Habilita/deshabilita una etapa. Desmarcar no borra su responsable ni sus fechas (por si se vuelve a marcar). */
export function setStageEnabled(wf, key, enabled) {
  if (!wf || !isKey(key)) return wf;
  const out = clone(wf);
  out[key].enabled = !!enabled;
  return out;
}

/** Cambia responsable, fechas o nota de una etapa (solo los campos que vengan en `patch`). */
export function updateStage(wf, key, patch) {
  if (!wf || !isKey(key) || !patch) return wf;
  const out = clone(wf);
  const s = out[key];
  if ("assigneeId" in patch) s.assigneeId = uidOrNull(patch.assigneeId);
  if ("startDate" in patch) s.startDate = dateKey(patch.startDate);
  if ("dueDate" in patch) s.dueDate = dateKey(patch.dueDate);
  if ("note" in patch) s.note = text(patch.note, 500);
  return out;
}

// ------------------------------------------------------------------ campos principales de la tarea

/**
 * Lo que la etapa activa dice sobre los campos principales: `{ stage, assigneeIds, startDate, dueDate }`
 * o null si no hay etapa activa. Un campo que la etapa no tiene (sin responsable / sin fecha) viene como
 * `undefined`: quien aplique esto NO debe machacar con nada lo que ya tuviera la tarea.
 */
export function activeFieldsFor(wf) {
  const key = currentStageKey(wf);
  if (!key) return null;
  const s = wf[key];
  return {
    stage: key,
    assigneeIds: s.assigneeId ? [s.assigneeId] : undefined,
    startDate: s.startDate || undefined,
    dueDate: s.dueDate || undefined,
  };
}

/** Responsables de las etapas habilitadas que aún no han empezado (ni son la activa), sin repetir y sin quien ya es el activo. */
export function upcomingAssigneeIds(wf) {
  const cur = currentStageKey(wf);
  if (!cur) return [];
  const active = wf[cur].assigneeId;
  const out = [];
  for (const k of STAGE_KEYS) {
    if (k === cur || !wf[k].enabled || wf[k].completed) continue;
    const id = wf[k].assigneeId;
    if (id && id !== active && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Todos los campos de la tarea que dependen del flujo, listos para escribir en una actualización:
 *   { workflow, upcomingAssigneeIds, [assigneeIds], [startDate], [dueDate] }
 * `assigneeIds`/`startDate`/`dueDate` solo aparecen si la etapa activa los tiene (ver activeFieldsFor).
 * Sin etapa activa (todas hechas, o ninguna habilitada) la tarea se queda como esté: solo se guarda el flujo.
 */
export function workflowTaskPatch(wf) {
  const patch = { workflow: wf, upcomingAssigneeIds: upcomingAssigneeIds(wf) };
  const active = activeFieldsFor(wf);
  if (active) {
    if (active.assigneeIds) patch.assigneeIds = active.assigneeIds;
    if (active.startDate) patch.startDate = active.startDate;
    if (active.dueDate) patch.dueDate = active.dueDate;
  }
  return patch;
}

/** Aplica workflowTaskPatch a una copia de la tarea (lo usa el borrador del modal y las pruebas). */
export function applyWorkflowToTask(task, wf) {
  return { ...task, ...workflowTaskPatch(wf) };
}

// ------------------------------------------------------------------ relevos

const today0 = (v) => dateKey(v) || dateKey(new Date());

/**
 * Propuesta de relevo hacia una etapa: responsable (el que ya tuviera la etapa), inicio = hoy o el
 * siguiente día laborable de ese responsable, y fin = fechas ya puestas en la etapa, o —solo para
 * Compra/Pedido— +5 días laborables (PURCHASE_DEFAULT_DAYS) desde el inicio. Recepción/Fabricación no
 * propone fin (lo escribe quien hace el relevo, ver el diálogo).
 *   → { stage, assigneeId, startDate, dueDate }   (cualquiera puede ser null)
 */
export function planStageHandoff(wf, key, { today, cfg, days } = {}) {
  const s = wf && wf[key];
  const assigneeId = s ? s.assigneeId : null;
  const startRef = nextWorkingDay(today0(today), cfg, assigneeId || undefined);
  const startDate = (s && s.startDate && s.startDate >= today0(today) ? s.startDate : null) || dateKey(startRef);
  let dueDate = s && s.dueDate && s.dueDate >= startDate ? s.dueDate : null;
  if (!dueDate && key === "purchase") {
    const n = Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : PURCHASE_DEFAULT_DAYS;
    dueDate = startDate ? dateKey(addWorkingDays(startDate, n, cfg, assigneeId || undefined)) : null;
  }
  return { stage: key, assigneeId, startDate: startDate || null, dueDate: dueDate || null };
}

/** Compra/Pedido recién activada: el comprador, inicio = hoy (o siguiente laborable suyo) y fin = +5 laborables. */
export function planPurchaseHandoff({ buyerId, today, cfg, days = PURCHASE_DEFAULT_DAYS }) {
  const start = nextWorkingDay(today0(today), cfg, buyerId || undefined);
  const startDate = dateKey(start);
  const dueDate = startDate ? dateKey(addWorkingDays(startDate, days, cfg, buyerId || undefined)) : null;
  return { stage: "purchase", assigneeId: buyerId || null, startDate, dueDate };
}

/**
 * Completa la etapa activa.
 *   handoff: { assigneeId, startDate, dueDate, note? } para la etapa siguiente (obligatorio si la hay).
 *   → { workflow, finished, completedKey, activatedKey }
 * Si no queda ninguna etapa habilitada después, `finished` es true (la tarea entera pasa a completada).
 * Sin etapa activa devuelve null.
 */
export function completeCurrentStage(wf, { userId, now, handoff } = {}) {
  const cur = currentStageKey(wf);
  if (!cur) return null;
  const out = clone(wf);
  out[cur] = { ...out[cur], completed: true, completedAt: isoOrNull(now) || new Date().toISOString(), completedBy: uidOrNull(userId) };
  const next = nextStageKey(wf);
  if (!next) return { workflow: out, finished: true, completedKey: cur, activatedKey: null };
  if (handoff) {
    out[next] = {
      ...out[next],
      assigneeId: "assigneeId" in handoff ? uidOrNull(handoff.assigneeId) : out[next].assigneeId,
      startDate: "startDate" in handoff ? dateKey(handoff.startDate) : out[next].startDate,
      dueDate: "dueDate" in handoff ? dateKey(handoff.dueDate) : out[next].dueDate,
      note: "note" in handoff ? text(handoff.note, 500) : out[next].note,
    };
  }
  return { workflow: out, finished: false, completedKey: cur, activatedKey: next };
}

/** Reabre una etapa YA completada y, con ella, todas las posteriores (el flujo es una cadena). Devuelve el flujo nuevo, o null si no estaba completada. */
export function reopenStage(wf, key) {
  if (!wf || !isKey(key) || !wf[key].enabled || !wf[key].completed) return null;
  const out = clone(wf);
  for (const k of STAGE_KEYS.slice(STAGE_KEYS.indexOf(key))) {
    if (!out[k].enabled) continue;
    out[k] = { ...out[k], completed: false, completedAt: null, completedBy: null };
  }
  return out;
}

/**
 * «Devolver a etapa anterior»: reabre la última etapa completada (con la tarea completada del todo, la última;
 * con una etapa en curso, la anterior a ella). → { workflow, reopenedKey } o null si no hay ninguna completada.
 */
export function reopenLastStage(wf) {
  if (!wf) return null;
  const done = STAGE_KEYS.filter((k) => wf[k].enabled && wf[k].completed);
  if (!done.length) return null;
  const key = done[done.length - 1];
  return { workflow: reopenStage(wf, key), reopenedKey: key };
}

/** ¿Se puede devolver a una etapa anterior? (hay alguna completada) */
export function canReturnToPreviousStage(wf) {
  return !!wf && STAGE_KEYS.some((k) => wf[k].enabled && wf[k].completed);
}

// ------------------------------------------------------------------ qué hace el check principal

/**
 * Qué pasa al pulsar el círculo de completar una tarea:
 *   { kind: 'legacy' }                           → sin flujo: se completa/reabre como siempre
 *   { kind: 'handoff', from, to }                → completar la etapa `from` y hacer relevo a `to` (diálogo)
 *   { kind: 'finish', from }                     → era la última etapa: tarea completada
 *   { kind: 'reopen', stage }                    → la tarea está completada: devolver a `stage` (la última etapa hecha)
 * Con la tarea completada y ninguna etapa completada (se completó antes de tener etapas), o sin etapa pendiente, es 'legacy'.
 */
export function planTaskCheck(task, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) return { kind: "legacy" };
  const cur = currentStageKey(wf);
  if (task.isComplete) {
    const r = reopenLastStage(wf);
    return r ? { kind: "reopen", stage: r.reopenedKey } : { kind: "legacy" };
  }
  if (!cur) return { kind: "legacy" }; // sin etapa pendiente (todas hechas o ninguna habilitada) y sin completar: se completa como siempre
  const next = nextStageKey(wf);
  return next ? { kind: "handoff", from: cur, to: next } : { kind: "finish", from: cur };
}

// ------------------------------------------------------------------ Gantt y carga

/**
 * Los tramos de una tarea para el Gantt: una entrada por etapa habilitada que tenga alguna fecha:
 *   [{ key, short, startDate, dueDate, status }]   (status: done | current | pending)
 * Una etapa SIN fechas propias no se dibuja salvo que sea la activa, que usa las fechas principales de la
 * tarea. Sin flujo → [].
 */
export function stageSegments(task, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) return [];
  const cur = currentStageKey(wf);
  const out = [];
  for (const k of enabledStageKeys(wf)) {
    const s = wf[k];
    let startDate = s.startDate, dueDate = s.dueDate;
    if (!startDate && !dueDate && k === cur) { startDate = dateKey(task.startDate); dueDate = dateKey(task.dueDate); }
    if (!startDate && !dueDate) continue;
    out.push({ key: k, short: STAGE_SHORT[k], startDate: startDate || dueDate, dueDate: dueDate || startDate, status: stageStatus(wf, k) });
  }
  return out;
}

/**
 * v85 · TODOS los tramos de la Línea de Tiempo de una tarea con flujo: una entrada por etapa HABILITADA, en orden,
 * con fechas reales cuando las tiene y una PROYECCIÓN encadenada cuando todavía no:
 *   [{ key, label (Diseño|Compra|Recepción/Fab.), full (nombre completo), status ('done'|'current'|'pending'),
 *      startDate, dueDate ('YYYY-MM-DD'), projected (bool), assigneeId, note }]
 * Reglas:
 *  · Etapa con startDate y/o dueDate propios → sus fechas exactas (si solo tiene una, el tramo dura ese día).
 *  · Etapa ACTIVA sin fechas propias → las fechas principales de la tarea (como stageSegments).
 *  · Etapa posterior sin fechas → tramo PROYECTADO consecutivo: empieza en el primer día laborable de su responsable
 *    a partir del día siguiente al fin de la etapa anterior y dura PURCHASE_DEFAULT_DAYS (Compra/Pedido) o
 *    PRODUCTION_PROJECTED_DAYS (Recepción/Fab.) días laborables tras ese inicio, mismo cómputo que planPurchaseHandoff.
 *    Sin una etapa anterior dibujada de la que colgar (p. ej. Diseño ya hecho y sin fechas) no se proyecta nada.
 *  · Tarea completada (`isComplete`) → todas sus etapas salen como 'done'.
 *  · El cursor de encadenado es el fin MÁS TARDÍO ya dibujado, así una proyección nunca se mete debajo de una etapa anterior.
 * Sin flujo (antigua, de Ofertas, personal o sin etapas habilitadas) → [].
 */
export function timelineStages(task, { offersProjectId, cfg } = {}) {
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) return [];
  const cur = currentStageKey(wf);
  const out = [];
  let cursor = null; // 'YYYY-MM-DD': el fin más tardío dibujado hasta ahora
  for (const k of enabledStageKeys(wf)) {
    const s = wf[k];
    const status = task.isComplete || s.completed ? "done" : cur === k ? "current" : "pending";
    let startDate = s.startDate, dueDate = s.dueDate, projected = false;
    if (!startDate && !dueDate && k === cur) { startDate = dateKey(task.startDate); dueDate = dateKey(task.dueDate); }
    if (startDate || dueDate) {
      startDate = startDate || dueDate;
      dueDate = dueDate || startDate;
    } else if (cursor && PROJECTED_DAYS[k] !== null) {
      const who = s.assigneeId || undefined;
      const start = nextWorkingDay(dayAfter(cursor), cfg, who);
      const startKey = start ? dateKey(start) : null;
      if (!startKey) continue;
      const end = addWorkingDays(startKey, PROJECTED_DAYS[k], cfg, who);
      startDate = startKey;
      dueDate = (end ? dateKey(end) : null) || startKey;
      projected = true;
    } else {
      continue; // sin fechas y sin nada de lo que colgarla: no se puede situar
    }
    const last = startDate > dueDate ? startDate : dueDate;
    if (!cursor || last > cursor) cursor = last;
    out.push({ key: k, label: STAGE_TIMELINE_LABELS[k], full: STAGE_LABELS[k], status, startDate, dueDate, projected, assigneeId: s.assigneeId || null, note: s.note || "" });
  }
  return out;
}

const SEG_STATUS_TEXT = Object.freeze({ done: "Completada", current: "En curso", pending: "Pendiente" });

/**
 * v85 · El tooltip de un tramo de la Línea de Tiempo, varias líneas: etapa y estado, responsable y fechas.
 *   «Compra/Pedido · En curso» / «Responsable: Ana» / «Fechas: 03/11–10/11 (proyectadas)»
 * `nameOf(uid)` → nombre (o '' si no se conoce).
 */
export function describeTimelineSegment(seg, nameOf) {
  if (!seg) return "";
  const who = seg.assigneeId ? (typeof nameOf === "function" ? nameOf(seg.assigneeId) : "") || "Responsable sin nombre" : "Sin responsable";
  const a = formatDayMonth(seg.startDate), b = formatDayMonth(seg.dueDate);
  const range = a && b && a !== b ? `${a}–${b}` : a || b || "sin fechas";
  const lines = [`${seg.full} · ${SEG_STATUS_TEXT[seg.status] || seg.status}`, `Responsable: ${who}`, `Fechas: ${range}${seg.projected ? " (proyectadas: aún sin fechas propias)" : ""}`];
  if (seg.note) lines.push(`Nota: ${seg.note}`);
  return lines.join("\n");
}

/**
 * La carga de una tarea repartida por persona: [{ uid, stage, startDate, dueDate }].
 *  · Con flujo: una porción por etapa PENDIENTE (activa o futura) con responsable. Cada una usa las fechas
 *    de SU etapa; si no las tiene, solo la etapa activa vale (con las fechas principales de la tarea), y
 *    una etapa futura sin fechas no ocupa nada todavía. Las etapas ya hechas no cuentan.
 *  · Sin flujo: una porción por cada responsable con las fechas de la tarea (`stage` null).
 * (Una tarea completada no ocupa a nadie: eso lo decide quien llama, como siempre en workload.js.)
 */
export function loadSlices(task, offersProjectId) {
  if (!task) return [];
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) {
    return (Array.isArray(task.assigneeIds) ? task.assigneeIds : []).filter(Boolean).map((uid) => ({ uid, stage: null, startDate: task.startDate || null, dueDate: task.dueDate || null }));
  }
  const cur = currentStageKey(wf);
  const out = [];
  for (const k of enabledStageKeys(wf)) {
    const s = wf[k];
    if (s.completed || !s.assigneeId) continue;
    let startDate = s.startDate, dueDate = s.dueDate;
    if (!startDate && !dueDate) {
      if (k !== cur) continue;
      startDate = task.startDate || null;
      dueDate = task.dueDate || null;
    }
    out.push({ uid: s.assigneeId, stage: k, startDate: startDate || null, dueDate: dueDate || null });
  }
  return out;
}

// ------------------------------------------------------------------ textos

/** «Diseño → Compra/Pedido» etc. para botones y avisos. */
export function describeHandoff(from, to) {
  return `${STAGE_SHORT[from]} → ${STAGE_SHORT[to]}`;
}

/** Resumen de una etapa para un tooltip: «Compra/Pedido · 03/11–10/11». */
export function describeStageDates(short, startDate, dueDate) {
  const a = formatDayMonth(startDate), b = formatDayMonth(dueDate);
  const range = a && b && a !== b ? `${a}–${b}` : a || b;
  return range ? `${short} · ${range}` : short;
}

// ------------------------------------------------------------------ plantillas de Creación Rápida

/**
 * Las etapas de UNA tarea de plantilla → la forma que guarda la plantilla (`stages`):
 *   { design: {enabled, assigneeId, days}, purchase: {...}, production: {...} }
 * Por defecto las 3 activas; Compra/Pedido con 5 días hábiles. `days` es null si no se indicó duración.
 */
export function normalizeTemplateStages(raw) {
  const out = {};
  for (const k of STAGE_KEYS) {
    const r = raw && typeof raw === "object" && raw[k] && typeof raw[k] === "object" ? raw[k] : null;
    const enabled = r ? r.enabled !== false : true;
    const n = r && r.days !== null && r.days !== undefined && r.days !== "" ? Number(r.days) : NaN;
    out[k] = {
      enabled,
      assigneeId: r ? uidOrNull(r.assigneeId) : null,
      days: Number.isFinite(n) && n >= 0 ? Math.min(365, Math.trunc(n)) : k === "purchase" ? PURCHASE_DEFAULT_DAYS : null,
    };
  }
  return out;
}

// ------------------------------------------------------------------ parches completos de la tarea

/**
 * El parche de la tarea al COMPLETAR su etapa activa (con `handoff` si hay etapa siguiente):
 *   → { patch, finished, completedKey, activatedKey } o null (sin flujo / sin etapa activa).
 * `patch.isComplete` es true solo si era la última etapa; quien escribe en Firestore añade `completedAt`.
 */
export function advanceTaskPatch(task, { userId, now, handoff, offersProjectId } = {}) {
  const wf = taskWorkflow(task, offersProjectId);
  const res = wf ? completeCurrentStage(wf, { userId, now, handoff }) : null;
  if (!res) return null;
  return {
    patch: { ...workflowTaskPatch(res.workflow), isComplete: res.finished },
    finished: res.finished,
    completedKey: res.completedKey,
    activatedKey: res.activatedKey,
  };
}

/** El parche de «Devolver a etapa anterior»: la tarea vuelve a estar sin completar y recupera a su responsable de antes. null si no hay nada que devolver. */
export function returnTaskPatch(task, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  const res = wf ? reopenLastStage(wf) : null;
  if (!res) return null;
  return { patch: { ...workflowTaskPatch(res.workflow), isComplete: false }, reopenedKey: res.reopenedKey };
}

/** Desmarca una etapa concreta ya completada (y las posteriores), desde el modal. null si no estaba completada. */
export function reopenStagePatch(task, key, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  const next = wf ? reopenStage(wf, key) : null;
  return next ? { patch: { ...workflowTaskPatch(next), isComplete: false }, reopenedKey: key } : null;
}

/**
 * Completar o reabrir VARIAS tareas de golpe (barra de selección múltiple), sin relevos: una tarea con
 * flujo se completa con TODAS sus etapas pendientes hechas, y al reabrir vuelve a su última etapa.
 * Devuelve los campos del flujo que hay que añadir al `isComplete` normal ({} si la tarea no tiene flujo).
 */
export function bulkCompleteExtras(task, isComplete, { userId, now, offersProjectId } = {}) {
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) return {};
  if (isComplete) {
    const out = clone(wf);
    for (const k of enabledStageKeys(wf)) {
      if (out[k].completed) continue;
      out[k] = { ...out[k], completed: true, completedAt: isoOrNull(now) || new Date().toISOString(), completedBy: uidOrNull(userId) };
    }
    return { workflow: out, upcomingAssigneeIds: [] };
  }
  const res = reopenLastStage(wf);
  return res ? workflowTaskPatch(res.workflow) : {};
}

// ------------------------------------------------------------------ «Mis tareas»

/**
 * ¿Es una tarea que a `uid` aún NO le toca? Con flujo, sin completar, `uid` es responsable de una etapa pendiente
 * posterior a la activa y NO es el responsable de la activa (ni consta en `assigneeIds`). Esas tareas no van mezcladas
 * con el trabajo de hoy: Mis tareas las enseña aparte, en «Próximas etapas asignadas a mí».
 */
export function isUpcomingForUser(task, uid, offersProjectId) {
  if (!task || !uid || task.isComplete) return false;
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) return false;
  const cur = currentStageKey(wf);
  if (!cur || wf[cur].assigneeId === uid) return false;
  if (Array.isArray(task.assigneeIds) && task.assigneeIds.includes(uid)) return false;
  if (task.ownerId === uid) return false;
  return STAGE_KEYS.some((k) => k !== cur && wf[k].enabled && !wf[k].completed && wf[k].assigneeId === uid);
}

/** La etapa pendiente (no activa) de `uid` en la tarea, para decir en la fila «Compra/Pedido…», o null. */
export function upcomingStageOf(task, uid, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  if (!wf) return null;
  const cur = currentStageKey(wf);
  return STAGE_KEYS.find((k) => k !== cur && wf[k].enabled && !wf[k].completed && wf[k].assigneeId === uid) || null;
}

/**
 * Al mover o estirar la barra de una tarea con etapas en el Gantt (cambia `startDate`/`dueDate`), las fechas de la etapa
 * ACTIVA cambian con ella para que los campos principales y la etapa no se contradigan. `datePatch`: lo que se va a
 * escribir ({startDate?, dueDate?}). → { workflow } a añadir al parche, o {} si la tarea no tiene etapa activa.
 */
export function syncActiveStageDates(task, datePatch, offersProjectId) {
  const wf = taskWorkflow(task, offersProjectId);
  const cur = currentStageKey(wf);
  if (!cur || !datePatch) return {};
  const p = {};
  if ("startDate" in datePatch) p.startDate = datePatch.startDate;
  if ("dueDate" in datePatch) p.dueDate = datePatch.dueDate;
  return Object.keys(p).length ? { workflow: updateStage(wf, cur, p) } : {};
}

// ------------------------------------------------------------------ Creación Rápida: etapas encadenadas

const dayAfter = (key) => { const d = parseKey(key); d.setDate(d.getDate() + 1); return dateKey(d); };
function parseKey(k) { const [y, m, dd] = k.split("-").map(Number); return new Date(y, m - 1, dd); }

/**
 * El flujo de UNA tarea creada desde una plantilla de Creación Rápida, con las etapas encadenadas en días laborables.
 *   stages          las etapas de la plantilla (normalizeTemplateStages las completa: por defecto las 3, Compra/Pedido 5 días)
 *   durationDays    los «días necesarios» de la tarea de plantilla: si la PRIMERA etapa no tiene duración propia, la usa
 *   assigneeIds     quienes se asignaron en la creación: el primero se encarga de la primera etapa si la plantilla no le puso responsable
 *   insertionDate   hoy
 *   cfg             calendario laboral (festivos + ausencias de cada responsable)
 *   firstPlan       { startKey, dueKey }: las fechas de la tarea según planTaskDates (incluye el tope de la fecha de entrega)
 * Cada etapa con duración `n` empieza en el primer día laborable de su responsable, a partir del día siguiente a la etapa anterior
 * (la primera, hoy), y acaba `n` días laborables después del inicio (como en planTaskDates). Una etapa sin duración no recibe fechas
 * (se pondrán en el relevo). → { workflow, patch } (patch = workflowTaskPatch: responsable y fechas de la etapa activa, etapas futuras),
 * o null si ninguna etapa está habilitada.
 */
export function planTemplateWorkflow({ stages, durationDays, assigneeIds, insertionDate, cfg, firstPlan } = {}) {
  const st = normalizeTemplateStages(stages);
  const keys = STAGE_KEYS.filter((k) => st[k].enabled);
  if (!keys.length) return null;
  const firstAssignee = (Array.isArray(assigneeIds) ? assigneeIds : []).filter(Boolean)[0] || null;
  const hasDuration = durationDays !== null && durationDays !== undefined && Number.isFinite(Number(durationDays));
  const details = {};
  let cursor = today0(insertionDate);
  keys.forEach((k, i) => {
    const assigneeId = st[k].assigneeId || (i === 0 ? firstAssignee : null);
    let startDate = null, dueDate = null;
    if (st[k].days !== null) {
      // duración propia de la etapa: desde el primer día laborable de su responsable, N días laborables después
      const start = nextWorkingDay(cursor, cfg, assigneeId || undefined);
      startDate = dateKey(start);
      if (startDate) dueDate = dateKey(st[k].days === 0 ? start : addWorkingDays(startDate, st[k].days, cfg, assigneeId || undefined));
    } else if (i === 0 && hasDuration && firstPlan && firstPlan.startKey && firstPlan.dueKey) {
      // la primera etapa sin duración propia hereda los «días necesarios» de la tarea ya calculados (con el tope de la entrega)
      startDate = firstPlan.startKey;
      dueDate = firstPlan.dueKey;
    }
    if (dueDate) cursor = dayAfter(dueDate);
    details[k] = { assigneeId, startDate, dueDate };
  });
  const workflow = workflowFromEnabled(keys, details);
  return { workflow, patch: workflowTaskPatch(workflow) };
}
