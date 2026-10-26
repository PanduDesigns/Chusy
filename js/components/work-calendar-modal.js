// ============================================================================
// Ventana «Calendario laboral» (v78). Se abre desde el menú del nombre (pie de
// la barra lateral) y la ven todas las cuentas; solo un administrador puede
// cambiar algo (el resto la tiene en modo lectura). Dos pestañas:
//
//  · Festivos: los de un año (con flechas para cambiar de año), con añadir,
//    editar y borrar libremente, y «Cargar festivos oficiales (Albacete /
//    CLM / Nacionales)» para el año en curso y el siguiente, que NO duplica:
//    un festivo en una fecha donde ya hay otro se salta (ver mergeHolidays en
//    work-calendar.js).
//  · Vacaciones y ausencias: los tramos del equipo con su tipo y nota. Un
//    admin ve y gestiona todos; el resto, los suyos y los de su departamento
//    (visibleAbsences). La nota solo la ven un admin y la propia persona
//    (canSeeAbsenceNote): puede ser algo personal.
//
// De dónde sale lo que se enseña: se suscribe con `subscribeToWorkCalendar`,
// que REUTILIZA la escucha de toda la sesión que abrió app.js (no abre otra
// consulta) y repinta al instante cuando otro administrador cambia algo. Cada
// cambio es una transacción (updateWorkCalendar: parte de lo último que hay en
// el servidor, así dos admins editando a la vez no se pisan) y lo que se está
// escribiendo en los formularios de «añadir» vive en `state`, para no perderlo
// si llega un cambio de otra persona mientras se teclea.
//
// Esto es la interfaz; quien manda de verdad son las reglas de Firestore
// (firestore.rules: solo un admin escribe `meta/workCalendar`).
// ============================================================================
import { el, escapeHtml, showToast, initials, colorFromString, toDateInputValue } from "../utils.js";
import { subscribeToWorkCalendar, updateWorkCalendar } from "../data/work-calendar.js";
import {
  ABSENCE_TYPES, HOLIDAY_SCOPES, EMPTY_CALENDAR,
  addHoliday, updateHoliday, removeHoliday, mergeHolidays, addAbsence, updateAbsence, removeAbsence,
  officialHolidaysForSeed, seedYears, hasOfficialHolidays,
  visibleAbsences, canSeeAbsenceNote, countWorkingDays, parseDateKey, dateKey,
} from "../work-calendar.js";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fmtDate = (key) => { const d = parseDateKey(key); return d ? `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : key; };
const fmtFull = (key) => { const d = parseDateKey(key); return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : key; };

export function openWorkCalendarModal({ currentUser, teamMembers }) {
  const root = document.getElementById("modal-root");
  const isAdmin = !!currentUser && currentUser.role === "admin";
  const members = teamMembers || [];
  const assignable = members.filter((m) => !m.isImported && !m.deleted).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const nameOf = (uid) => {
    const m = members.find((x) => x.uid === uid);
    return m ? m.name || "Sin nombre" : "Persona eliminada";
  };
  const todayKey = dateKey(new Date());

  let cfg = EMPTY_CALENDAR;
  const state = {
    tab: "holidays",
    year: new Date().getFullYear(),
    editingHoliday: null, // id del festivo que se está editando
    editingAbsence: null, // id de la ausencia que se está editando
    showPast: false,
    personFilter: "",
    busy: false,
    // Formularios de «añadir» (y de editar): se conservan entre repintados.
    holidayForm: { date: "", name: "", scope: "empresa" },
    holidayEdit: { date: "", name: "", scope: "empresa" },
    absenceForm: { userId: assignable[0] ? assignable[0].uid : "", type: "vacaciones", startDate: "", endDate: "", note: "" },
    absenceEdit: { userId: "", type: "vacaciones", startDate: "", endDate: "", note: "" },
  };

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="wc-title">
        <div class="modal__header">
          <h3 id="wc-title" style="font-size:16px;">Calendario laboral</h3>
          <button class="modal__close" id="wc-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="wc-tabs" role="tablist">
          <button class="wc-tab" role="tab" id="wc-tab-holidays" data-tab="holidays" aria-controls="wc-panel">Festivos</button>
          <button class="wc-tab" role="tab" id="wc-tab-absences" data-tab="absences" aria-controls="wc-panel">Vacaciones y ausencias</button>
        </div>
        <div class="modal__body wc-body" id="wc-panel" role="tabpanel"></div>
        <div class="modal__footer">
          <span class="field__hint" style="margin:0;" id="wc-footnote"></span>
          <button class="btn btn--ghost" id="wc-done" style="margin-left:auto;">Cerrar</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(overlay);

  // ------------------------------------------------------------------ cambios en Firestore
  async function run(mutator, okMessage) {
    if (state.busy) return false;
    state.busy = true;
    render();
    try {
      const result = await updateWorkCalendar(mutator, currentUser.uid);
      if (okMessage) showToast(typeof okMessage === "function" ? okMessage(result) : okMessage);
      return true;
    } catch (e) {
      const denied = e && (e.code === "permission-denied" || /permission/i.test(e.message || ""));
      showToast(denied ? "No tienes permiso para cambiar el calendario laboral." : (e && e.message) || "No se pudo guardar el cambio.", "error");
      return false;
    } finally {
      state.busy = false;
      render();
    }
  }

  // ------------------------------------------------------------------ festivos
  function holidaysHtml() {
    const list = cfg.holidays.filter((h) => h.date.startsWith(`${state.year}-`));
    const rows = list.map((h) => {
      const weekendNote = (() => { const d = parseDateKey(h.date); return d && (d.getDay() === 0 || d.getDay() === 6) ? `<span class="wc-note">cae en fin de semana</span>` : ""; })();
      if (isAdmin && state.editingHoliday === h.id) {
        const f = state.holidayEdit;
        return `<li class="wc-row wc-row--edit" data-hid="${h.id}">
          <input class="field__input wc-in wc-in--date" type="date" data-edit="date" value="${escapeHtml(f.date)}" aria-label="Fecha">
          <input class="field__input wc-in wc-in--grow" type="text" maxlength="80" data-edit="name" value="${escapeHtml(f.name)}" aria-label="Nombre">
          <select class="field__select wc-in" data-edit="scope" aria-label="Ámbito">${scopeOptions(f.scope)}</select>
          <button class="btn btn--primary btn--sm" data-save-holiday="${h.id}"${state.busy ? " disabled" : ""}>Guardar</button>
          <button class="btn btn--ghost btn--sm" data-cancel-edit>Cancelar</button>
        </li>`;
      }
      return `<li class="wc-row" data-hid="${h.id}">
        <span class="wc-date">${fmtDate(h.date)}</span>
        <span class="wc-name">${escapeHtml(h.name)}${weekendNote}</span>
        <span class="wc-scope wc-scope--${h.scope}">${escapeHtml(HOLIDAY_SCOPES[h.scope])}</span>
        ${isAdmin ? `<span class="wc-actions">
          <button class="wc-icon-btn" data-edit-holiday="${h.id}" title="Editar" aria-label="Editar ${escapeHtml(h.name)}"${state.busy ? " disabled" : ""}>✏️</button>
          <button class="wc-icon-btn" data-del-holiday="${h.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(h.name)}"${state.busy ? " disabled" : ""}>🗑️</button>
        </span>` : ""}
      </li>`;
    }).join("");

    const form = state.holidayForm;
    return `
      <div class="wc-toolbar">
        <div class="wc-year">
          <button class="btn btn--ghost btn--sm" data-year="-1" aria-label="Año anterior">‹</button>
          <strong aria-live="polite">${state.year}</strong>
          <button class="btn btn--ghost btn--sm" data-year="1" aria-label="Año siguiente">›</button>
        </div>
        ${isAdmin ? `<button class="btn btn--ghost btn--sm" id="wc-seed"${state.busy ? " disabled" : ""}>Cargar festivos oficiales (Albacete / CLM / Nacionales)</button>` : ""}
      </div>
      ${list.length
        ? `<ul class="wc-list">${rows}</ul>`
        : `<p class="wc-empty">No hay festivos en ${state.year}.${isAdmin ? " Puedes añadirlos a mano o cargar los oficiales." : ""}</p>`}
      ${isAdmin ? `
        <div class="wc-add" aria-label="Añadir festivo">
          <input class="field__input wc-in wc-in--date" type="date" id="wc-h-date" value="${escapeHtml(form.date)}" aria-label="Fecha del festivo">
          <input class="field__input wc-in wc-in--grow" type="text" id="wc-h-name" maxlength="80" placeholder="Nombre (p. ej. Feria)" value="${escapeHtml(form.name)}" aria-label="Nombre del festivo">
          <select class="field__select wc-in" id="wc-h-scope" aria-label="Ámbito">${scopeOptions(form.scope)}</select>
          <button class="btn btn--primary btn--sm" id="wc-h-add"${state.busy ? " disabled" : ""}>Añadir festivo</button>
        </div>` : ""}`;
  }

  function scopeOptions(selected) {
    return Object.entries(HOLIDAY_SCOPES).map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  // ------------------------------------------------------------------ ausencias
  function absencesHtml() {
    const visible = visibleAbsences(cfg, currentUser, members);
    const people = [...new Set(visible.map((a) => a.userId))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (state.personFilter && !people.includes(state.personFilter)) state.personFilter = "";
    const shown = visible
      .filter((a) => (state.showPast || a.endDate >= todayKey) && (!state.personFilter || a.userId === state.personFilter))
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : nameOf(a.userId).localeCompare(nameOf(b.userId))));
    const hiddenPast = visible.filter((a) => a.endDate < todayKey).length;

    const rows = shown.map((a) => {
      if (isAdmin && state.editingAbsence === a.id) {
        const f = state.absenceEdit;
        return `<li class="wc-row wc-row--edit wc-row--wrap" data-aid="${a.id}">
          <select class="field__select wc-in wc-in--grow" data-aedit="userId" aria-label="Persona">${personOptions(f.userId, true)}</select>
          <select class="field__select wc-in" data-aedit="type" aria-label="Tipo">${typeOptions(f.type)}</select>
          <input class="field__input wc-in wc-in--date" type="date" data-aedit="startDate" value="${escapeHtml(f.startDate)}" aria-label="Desde">
          <input class="field__input wc-in wc-in--date" type="date" data-aedit="endDate" value="${escapeHtml(f.endDate)}" aria-label="Hasta">
          <input class="field__input wc-in wc-in--grow" type="text" maxlength="200" data-aedit="note" placeholder="Nota (opcional)" value="${escapeHtml(f.note)}" aria-label="Nota">
          <button class="btn btn--primary btn--sm" data-save-absence="${a.id}"${state.busy ? " disabled" : ""}>Guardar</button>
          <button class="btn btn--ghost btn--sm" data-cancel-edit>Cancelar</button>
        </li>`;
      }
      const days = countWorkingDays(a.startDate, a.endDate, cfg);
      const note = canSeeAbsenceNote(a, currentUser) && a.note ? `<span class="wc-note">${escapeHtml(a.note)}</span>` : "";
      const m = members.find((x) => x.uid === a.userId);
      const past = a.endDate < todayKey;
      return `<li class="wc-row${past ? " is-past" : ""}" data-aid="${a.id}">
        <span class="avatar avatar--sm" style="background:${colorFromString(a.userId)}">${escapeHtml(initials(m ? m.name : "?"))}</span>
        <span class="wc-name">${escapeHtml(nameOf(a.userId))}${note}</span>
        <span class="wc-range">${fmtFull(a.startDate)}${a.endDate !== a.startDate ? ` – ${fmtFull(a.endDate)}` : ""}<span class="wc-note">${days} ${days === 1 ? "día laborable" : "días laborables"}</span></span>
        <span class="wc-type wc-type--${a.type}">${escapeHtml(ABSENCE_TYPES[a.type])}</span>
        ${isAdmin ? `<span class="wc-actions">
          <button class="wc-icon-btn" data-edit-absence="${a.id}" title="Editar" aria-label="Editar ausencia de ${escapeHtml(nameOf(a.userId))}"${state.busy ? " disabled" : ""}>✏️</button>
          <button class="wc-icon-btn" data-del-absence="${a.id}" title="Eliminar" aria-label="Eliminar ausencia de ${escapeHtml(nameOf(a.userId))}"${state.busy ? " disabled" : ""}>🗑️</button>
        </span>` : ""}
      </li>`;
    }).join("");

    const f = state.absenceForm;
    return `
      <p class="field__hint wc-hint">${isAdmin
        ? "Las vacaciones y ausencias del equipo. Chusy avisa al poner una fecha límite en un día en que el responsable no está."
        : "Ves tus ausencias y las de tu departamento. La nota solo la ven un administrador y la propia persona."}</p>
      <div class="wc-toolbar">
        <select class="field__select wc-in" id="wc-a-filter" aria-label="Filtrar por persona"${people.length < 2 ? " disabled" : ""}>
          <option value="">Todas las personas</option>
          ${people.map((id) => `<option value="${id}"${id === state.personFilter ? " selected" : ""}>${escapeHtml(nameOf(id))}</option>`).join("")}
        </select>
        <label class="acc-switch-row wc-check"><input type="checkbox" id="wc-a-past"${state.showPast ? " checked" : ""}><span>Mostrar pasadas${hiddenPast && !state.showPast ? ` (${hiddenPast})` : ""}</span></label>
      </div>
      ${shown.length
        ? `<ul class="wc-list">${rows}</ul>`
        : `<p class="wc-empty">${visible.length ? "No hay ausencias próximas con ese filtro." : "No hay vacaciones ni ausencias registradas."}</p>`}
      ${isAdmin ? `
        <div class="wc-add wc-add--wrap" aria-label="Añadir vacaciones o ausencia">
          <select class="field__select wc-in wc-in--grow" id="wc-a-user" aria-label="Persona">${personOptions(f.userId, false)}</select>
          <select class="field__select wc-in" id="wc-a-type" aria-label="Tipo">${typeOptions(f.type)}</select>
          <input class="field__input wc-in wc-in--date" type="date" id="wc-a-start" value="${escapeHtml(f.startDate)}" aria-label="Desde">
          <input class="field__input wc-in wc-in--date" type="date" id="wc-a-end" value="${escapeHtml(f.endDate)}" aria-label="Hasta">
          <input class="field__input wc-in wc-in--grow" type="text" id="wc-a-note" maxlength="200" placeholder="Nota (opcional)" value="${escapeHtml(f.note)}" aria-label="Nota">
          <button class="btn btn--primary btn--sm" id="wc-a-add"${state.busy || !assignable.length ? " disabled" : ""}>Añadir</button>
        </div>` : ""}`;
  }

  function personOptions(selected, includeSelectedMissing) {
    const list = [...assignable];
    if (includeSelectedMissing && selected && !list.some((m) => m.uid === selected)) list.push({ uid: selected, name: nameOf(selected) });
    return list.map((m) => `<option value="${m.uid}"${m.uid === selected ? " selected" : ""}>${escapeHtml(m.name || "Sin nombre")}</option>`).join("");
  }
  function typeOptions(selected) {
    return Object.entries(ABSENCE_TYPES).map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  // ------------------------------------------------------------------ pintar y cablear
  function render() {
    overlay.querySelectorAll(".wc-tab").forEach((t) => {
      const active = t.dataset.tab === state.tab;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
      t.tabIndex = active ? 0 : -1;
    });
    overlay.querySelector("#wc-panel").setAttribute("aria-labelledby", `wc-tab-${state.tab}`);
    overlay.querySelector("#wc-footnote").textContent = isAdmin ? "" : "Solo un administrador puede cambiar el calendario.";
    const panel = overlay.querySelector("#wc-panel");
    panel.innerHTML = state.tab === "holidays" ? holidaysHtml() : absencesHtml();
    wire(panel);
  }

  const on = (panel, selector, event, handler) => panel.querySelectorAll(selector).forEach((n) => n.addEventListener(event, handler));

  function wire(panel) {
    // ----- festivos
    on(panel, "[data-year]", "click", (e) => { state.year = Math.min(2100, Math.max(2000, state.year + Number(e.currentTarget.dataset.year))); state.editingHoliday = null; render(); });
    const seed = panel.querySelector("#wc-seed");
    if (seed) seed.addEventListener("click", async () => {
      const years = seedYears();
      const ok = await run((base) => mergeHolidays(base, officialHolidaysForSeed()), (r) => {
        const estimated = years.filter((y) => !hasOfficialHolidays(y));
        const base = r.added ? `Se añadieron ${r.added} festivos oficiales de ${years.join(" y ")}${r.skipped ? ` (${r.skipped} ya estaban)` : ""}.` : "Todos los festivos oficiales ya estaban cargados.";
        return estimated.length ? `${base} Los de ${estimated.join(" y ")} son una estimación: revísalos cuando se publique el decreto.` : base;
      });
      if (ok) state.year = Math.min(Math.max(state.year, years[0]), years[1]);
    });
    const hDate = panel.querySelector("#wc-h-date");
    if (hDate) {
      hDate.addEventListener("input", () => { state.holidayForm.date = hDate.value; });
      panel.querySelector("#wc-h-name").addEventListener("input", (e) => { state.holidayForm.name = e.target.value; });
      panel.querySelector("#wc-h-scope").addEventListener("change", (e) => { state.holidayForm.scope = e.target.value; });
      const add = async () => {
        const f = { ...state.holidayForm };
        const ok = await run((base) => addHoliday(base, f), "Festivo añadido.");
        if (ok) {
          if (f.date) state.year = Number(f.date.slice(0, 4)) || state.year;
          state.holidayForm = { date: "", name: "", scope: f.scope };
          render();
          const again = overlay.querySelector("#wc-h-date");
          if (again) again.focus();
        }
      };
      panel.querySelector("#wc-h-add").addEventListener("click", add);
      panel.querySelector("#wc-h-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    }
    on(panel, "[data-edit-holiday]", "click", (e) => {
      const h = cfg.holidays.find((x) => x.id === e.currentTarget.dataset.editHoliday);
      if (!h) return;
      state.editingHoliday = h.id;
      state.holidayEdit = { date: h.date, name: h.name, scope: h.scope };
      render();
    });
    on(panel, "[data-edit]", "input", (e) => { state.holidayEdit[e.target.dataset.edit] = e.target.value; });
    on(panel, "[data-save-holiday]", "click", async (e) => {
      const id = e.currentTarget.dataset.saveHoliday;
      const patch = { ...state.holidayEdit };
      if (await run((base) => updateHoliday(base, id, patch), "Festivo actualizado.")) state.editingHoliday = null;
      render();
    });
    on(panel, "[data-del-holiday]", "click", (e) => {
      const id = e.currentTarget.dataset.delHoliday;
      run((base) => removeHoliday(base, id), "Festivo eliminado.");
    });

    // ----- ausencias
    const filter = panel.querySelector("#wc-a-filter");
    if (filter) filter.addEventListener("change", () => { state.personFilter = filter.value; render(); });
    const past = panel.querySelector("#wc-a-past");
    if (past) past.addEventListener("change", () => { state.showPast = past.checked; render(); });
    const aUser = panel.querySelector("#wc-a-user");
    if (aUser) {
      aUser.addEventListener("change", (e) => { state.absenceForm.userId = e.target.value; });
      panel.querySelector("#wc-a-type").addEventListener("change", (e) => { state.absenceForm.type = e.target.value; });
      panel.querySelector("#wc-a-start").addEventListener("input", (e) => {
        state.absenceForm.startDate = e.target.value;
        const end = panel.querySelector("#wc-a-end");
        // Un solo día es lo más corriente: si «Hasta» está vacío o quedaría antes, se iguala a «Desde».
        if (e.target.value && (!end.value || end.value < e.target.value)) { end.value = e.target.value; state.absenceForm.endDate = e.target.value; }
      });
      panel.querySelector("#wc-a-end").addEventListener("input", (e) => { state.absenceForm.endDate = e.target.value; });
      panel.querySelector("#wc-a-note").addEventListener("input", (e) => { state.absenceForm.note = e.target.value; });
      panel.querySelector("#wc-a-add").addEventListener("click", async () => {
        const f = { ...state.absenceForm };
        const ok = await run((base) => addAbsence(base, f), "Ausencia registrada.");
        if (ok) {
          state.absenceForm = { ...state.absenceForm, startDate: "", endDate: "", note: "" };
          state.showPast = state.showPast || (!!f.endDate && f.endDate < todayKey);
          render();
        }
      });
    }
    on(panel, "[data-edit-absence]", "click", (e) => {
      const a = cfg.absences.find((x) => x.id === e.currentTarget.dataset.editAbsence);
      if (!a) return;
      state.editingAbsence = a.id;
      state.absenceEdit = { userId: a.userId, type: a.type, startDate: a.startDate, endDate: a.endDate, note: a.note };
      render();
    });
    on(panel, "[data-aedit]", "input", (e) => { state.absenceEdit[e.target.dataset.aedit] = e.target.value; });
    on(panel, "[data-aedit]", "change", (e) => { state.absenceEdit[e.target.dataset.aedit] = e.target.value; });
    on(panel, "[data-save-absence]", "click", async (e) => {
      const id = e.currentTarget.dataset.saveAbsence;
      const patch = { ...state.absenceEdit };
      if (await run((base) => updateAbsence(base, id, patch), "Ausencia actualizada.")) state.editingAbsence = null;
      render();
    });
    on(panel, "[data-del-absence]", "click", (e) => {
      const id = e.currentTarget.dataset.delAbsence;
      run((base) => removeAbsence(base, id), "Ausencia eliminada.");
    });
    on(panel, "[data-cancel-edit]", "click", () => { state.editingHoliday = null; state.editingAbsence = null; render(); });
  }

  // ------------------------------------------------------------------ pestañas, cierre, suscripción
  overlay.querySelectorAll(".wc-tab").forEach((t) => {
    t.addEventListener("click", () => { state.tab = t.dataset.tab; state.editingHoliday = null; state.editingAbsence = null; render(); });
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      state.tab = state.tab === "holidays" ? "absences" : "holidays";
      render();
      overlay.querySelector(`#wc-tab-${state.tab}`).focus();
    });
  });

  let unsub = null;
  function close() {
    document.removeEventListener("keydown", onKeydown);
    if (unsub) unsub();
    overlay.remove();
  }
  function onKeydown(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("#wc-close").addEventListener("click", close);
  overlay.querySelector("#wc-done").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  render();
  unsub = subscribeToWorkCalendar((next) => {
    cfg = next;
    // Si lo que se estaba editando ya no existe (lo borró otra persona), se sale de la edición.
    if (state.editingHoliday && !cfg.holidays.some((h) => h.id === state.editingHoliday)) state.editingHoliday = null;
    if (state.editingAbsence && !cfg.absences.some((a) => a.id === state.editingAbsence)) state.editingAbsence = null;
    if (overlay.isConnected) render();
  });
  const firstTab = overlay.querySelector(".wc-tab.is-active");
  if (firstTab) firstTab.focus();
}
