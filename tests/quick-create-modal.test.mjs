// Creación Rápida (v79) de punta a punta con el modal REAL en jsdom: producto → configurar →
// asignar → crear. Comprueba las fechas de la vista previa, las del bloque «Fechas resultantes»
// (que cambian al marcar personas) y las que se escriben de verdad en las tareas.
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

setupDom();
// Hoy: jueves 5/11/2026 (mediodía, para que ninguna zona horaria cambie el día).
freezeNow("2026-11-05T12:00:00");

const { normalizeWorkCalendar } = await import("../js/work-calendar.js");
const { openQuickCreateModal } = await import("../js/components/quick-create-modal.js");

globalThis.__fb = {
  collections: {
    quickCreateProducts: [{
      id: "p1",
      data: {
        name: "Cabina X", icon: "🎨", color: "#FCD000",
        baseTasks: [
          { id: "t1", title: "Ingeniería", durationDays: 3, priority: "alta" },
          { id: "t2", title: "Pedido material", durationDays: 0 },
          { id: "t3", title: "Montaje", durationDays: 20 },
          { id: "t4", title: "Sin duración" },
        ],
        groups: [],
      },
    }],
  },
  sets: [],
};

const calendar = normalizeWorkCalendar({
  holidays: [{ id: "h1", date: "2026-11-09", name: "Fiesta local", scope: "local" }],
  absences: [{ id: "a1", userId: "ana", startDate: "2026-11-06", endDate: "2026-11-06", type: "vacaciones", note: "" }],
});
const members = [
  { uid: "ana", name: "Ana", role: "member" },
  { uid: "luis", name: "Luis", role: "member" },
  { uid: "boss", name: "Jefe", role: "admin" },
];
const project = { id: "proj1", name: "Proyecto", sections: [{ id: "s1", name: "Producción", order: 0 }] };
const currentUser = { uid: "boss", role: "admin", name: "Jefe" };

openQuickCreateModal({ project, currentUser, quickCreateEnabled: true, teamMembers: members, workCalendar: calendar });
await tick(5);
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el, props = {}) => { Object.assign(el, props); el.dispatchEvent(new window.Event("change", { bubbles: true })); };

// Paso 1: elegir el producto
check("el producto se carga", !!$('[data-toggle-product="p1"]'));
change($('[data-toggle-product="p1"]'), { checked: true });
click($("#qc-continue-pick"));
await tick();

// Paso 2: configurar. Entrega el sábado 14/11 (no laborable) → las tareas acaban el viernes 13.
check("estamos en configurar", !!$("#qc-delivery-date"));
change($("#qc-delivery-date"), { value: "2026-11-14" });
const previewText = () => $$("#qc-body li").map((li) => li.textContent.replace(/\s+/g, " ").trim());
// El paso muestra la vista previa tras repintar: forzamos repintado volviendo a entrar en el paso.
click($("#qc-next-step")); // → asignar
await tick();
check("hemos pasado al paso de asignación", !!$("#qc-dates"));
click($("#qc-back-step"));
await tick();
const rows = previewText();
const rowOf = (txt) => rows.find((r) => r.includes(txt) && /\d\d\/\d\d/.test(r)) || ""; // (las 4 primeras líneas son la lista de tareas de la plantilla, sin fechas)
check("vista previa: tarea principal con su fecha (entrega sáb 14 → vie 13)", /Cabina X.*tarea principal.*jue 05\/11 → vie 13\/11.*adelantada/.test(rowOf("tarea principal")), rowOf("tarea principal"));
check("vista previa: 3 días laborables desde el jueves con lunes festivo → miércoles 11 + indicador", /Ingeniería.*3 d\. lab\..*jue 05\/11 → mié 11\/11.*salta festivo/.test(rowOf("Ingeniería")), rowOf("Ingeniería"));
check("vista previa: 0 días = hoy", /Pedido material.*jue 05\/11/.test(rowOf("Pedido material")) && !/→/.test(rowOf("Pedido material")), rowOf("Pedido material"));
check("vista previa: 20 días se recortan a la entrega (viernes 13)", /Montaje.*→ vie 13\/11/.test(rowOf("Montaje")), rowOf("Montaje"));
check("vista previa: sin duración = la entrega, adelantada", /Sin duración.*→ vie 13\/11.*adelantada/.test(rowOf("Sin duración")), rowOf("Sin duración"));
check("el aviso explica que las vacaciones se aplican al asignar", document.body.textContent.includes("Las vacaciones de cada responsable se aplican al asignar"));

// Paso 3: asignar. Añadimos a Ana (vacaciones el viernes 6/11) y le marcamos «Pedido material» (0 días) e «Ingeniería».
click($("#qc-next-step"));
await tick();
const datesRows = () => $$("#qc-dates .qc-dates__row").map((r) => r.textContent.replace(/\s+/g, " ").trim());
check("«Fechas resultantes» lista las 4 tareas + la principal", datesRows().length === 5, datesRows());
check("sin responsables, todo sale sin asignar", datesRows().every((t) => t.includes("sin asignar")));
click($('[data-assign-person="ana"]'));
await tick();
const cb = (task) => $(`input[data-assign-uid="ana"][data-assign-task="${task}"]`);
check("Ana tiene casillas para las tareas", !!cb("t1") && !!cb("t2"));
change(cb("t2"), { checked: true });
change(cb("t1"), { checked: true });
const rowsAna = datesRows();
const ing = rowsAna.find((r) => r.includes("Ingeniería"));
check("Ingeniería asignada a Ana: el viernes 6 no cuenta (vacaciones) → 3 días acaban el jueves 12", /Ana.*jue 05\/11 → jue 12\/11/.test(ing), ing);
check("… con indicador de festivo/ausencia", /salta festivo\/ausencia/.test(ing), ing);
check("… y el tooltip nombra las vacaciones de Ana", $$("#qc-dates .qc-flag").some((f) => /vacaciones de Ana \(06\/11\)/.test(f.title)), $$("#qc-dates .qc-flag").map((f) => f.title));
const ped = rowsAna.find((r) => r.includes("Pedido material"));
check("Pedido material (0 días) a Ana: hoy es laborable para ella → el mismo día", /Ana.*jue 05\/11/.test(ped) && !/→/.test(ped), ped);
const mont = rowsAna.find((r) => r.includes("Montaje"));
check("las tareas sin Ana no cambian", /sin asignar.*→ vie 13\/11/.test(mont), mont);
// Al desmarcar vuelve a la cuenta de la empresa
change(cb("t1"), { checked: false });
check("desmarcar a Ana devuelve la fecha de la empresa (miércoles 11)", /Ingeniería.*mié 11\/11/.test(datesRows().find((r) => r.includes("Ingeniería"))));
change(cb("t1"), { checked: true });

// Crear: lo guardado coincide con lo que se enseñó
click($("#qc-confirm-all"));
await tick(20);
const saved = globalThis.__fb.sets.filter((s) => s.ref.path === "tasks").map((s) => s.data); // (también se escribe el aviso a Ana, en otra colección)
check("se crean las 5 tareas", saved.length === 5, saved.length);
const by = (title) => saved.find((t) => t.title === title) || {};
eq("Cabina X (principal): inicio hoy, límite vie 13/11", [by("Cabina X").startDate, by("Cabina X").dueDate], ["2026-11-05", "2026-11-13"]);
eq("Ingeniería (Ana): 5/11 → 12/11", [by("Ingeniería").startDate, by("Ingeniería").dueDate], ["2026-11-05", "2026-11-12"]);
eq("Ingeniería lleva a Ana", by("Ingeniería").assigneeIds, ["ana"]);
eq("Pedido material (Ana): 5/11 → 5/11", [by("Pedido material").startDate, by("Pedido material").dueDate], ["2026-11-05", "2026-11-05"]);
eq("Montaje: 20 días recortados a 13/11", by("Montaje").dueDate, "2026-11-13");
eq("Sin duración: 13/11", by("Sin duración").dueDate, "2026-11-13");
check("ninguna tarea cae en fin de semana, festivo ni (las de Ana) en su vacaciones", saved.every((t) => { const d = new Date(t.dueDate + "T12:00:00"); return d.getDay() % 6 !== 0 && t.dueDate !== "2026-11-09"; }));
check("el toast avisa de las fechas ajustadas", /fechas ajustadas por festivos o ausencias/.test(document.querySelector("#toast-root").textContent), document.querySelector("#toast-root").textContent);

done("Creación Rápida · modal (jsdom)");
process.exit(0);
