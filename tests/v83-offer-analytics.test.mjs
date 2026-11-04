// v83 — Analítica de ofertas: lectura de los campos REALES de Comercial y Revisiones (también desde las ofertas ya
// convertidas en proyecto), filtros Comercial/Año/Mes, efectividad por comercial, correlación revisiones ↔ cierre,
// importador de históricos (CSV/Excel → ofertas) y la vista de Métricas (jsdom, eventos reales).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, freezeNow, tick } from "./support/dom.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

setupDom();
freezeNow("2026-11-02T12:00:00");
const fb = (globalThis.__fb = globalThis.__fb || { collections: {}, sets: [] });

const flow = await import("../js/flow-metrics.js");
const offersLib = await import("../js/offers.js");
const props = await import("../js/project-properties.js");
const imp = await import("../js/offer-import.js");
const writer = await import("../js/data/offer-import.js");
const metrics = await import("../js/views/metrics-view.js");
const modal = await import("../js/components/offer-import-modal.js");
const { renderMetricsView, resetOfferFilters, getOfferFilters } = metrics;

const d = (iso) => new Date(iso + "T10:00:00");
const near = (a, b, tol = 0.2) => a !== null && Math.abs(a - b) <= tol;

// Proyecto Ofertas con los ids de fábrica (como EXCLUSIVE_PROJECT_SEEDS en data/projects.js).
const OFF = {
  id: "off", name: "Ofertas", exclusive: true, exclusiveKey: offersLib.OFFERS_KEY, color: "#8B85C4",
  sections: [{ id: "nuevas", name: "Nuevas" }, { id: "revisiones", name: "Revisiones" }, { id: "entregadas", name: "Entregadas" }, { id: "cerradas", name: "Cerradas" }],
  customFieldDefs: [
    { id: "comercial", name: "Comercial", type: "texto", options: [] },
    { id: "version", name: "Versión", type: "texto", options: [] },
    { id: "ubicacion", name: "Ubicación", type: "texto", options: [] },
    { id: "sector", name: "Sector", type: "lista", options: ["Automoción", "Industria"] },
  ],
};
const revs = (n) => [{ id: "r0", version: "A1", changes: "Versión original" }, ...Array.from({ length: n }, (_, i) => ({ id: "r" + (i + 1), version: "A" + (i + 2), changes: "cambio " + (i + 1) }))];
const O = (id, o = {}) => ({ id, title: id, projectId: "off", sectionId: "nuevas", isComplete: false, createdAt: d("2025-01-10"), customFields: {}, ...o });
const com = (name) => ({ comercial: name });

// ---------------------------------------------------------------- 1) lectura de los campos reales
eq("countOfferRevisions: A1 + A2 + A3 → 2", offersLib.countOfferRevisions(revs(2)), 2);
eq("countOfferRevisions: solo la original → 0", offersLib.countOfferRevisions(revs(0)), 0);
eq("countOfferRevisions: histórico de la v56 (empieza en A2, sin A1) → 1", offersLib.countOfferRevisions([{ version: "A2", changes: "x" }]), 1);
eq("countOfferRevisions: sin histórico / no-lista → 0", [offersLib.countOfferRevisions(undefined), offersLib.countOfferRevisions(null), offersLib.countOfferRevisions("x")], [0, 0, 0]);
eq("la fila original se reconoce también por su texto aunque cambie la versión", offersLib.countOfferRevisions([{ version: "1", changes: "  versión ORIGINAL " }, { version: "2", changes: "y" }]), 1);

const PJ1 = { id: "pj1", name: "Proyecto J1", code: "26001", properties: { sourceOfferId: "j1", comercial: "Juan Pérez", history: revs(0) } };
const PS = { id: "pS", name: "Proyecto S2", code: "26002", properties: { sourceOfferId: "s2", comercial: "Luis Gómez", history: revs(0) } };
const PO = { id: "pO", name: "Proyecto huérfano", code: "26020", properties: { sourceOfferId: "gone", comercial: "Ana Ruiz", offerCreatedAt: "2025-05-05T10:00:00.000Z", offerRevisionCount: 2, approvalDate: "2025-06-04", history: revs(5) } };
const OTHER = { id: "px", name: "Proyecto normal", code: "26030" };
const projects = [OFF, PJ1, PS, PO, OTHER];

const tasks = [
  O("j1", { customFields: com("Juan Pérez"), revisions: revs(0), isComplete: true, completedAt: d("2025-02-09"), convertedProjectId: "pj1", convertedAt: d("2025-02-09"), sectionId: "cerradas" }),
  O("j2", { customFields: com("juan perez"), createdAt: d("2025-02-10"), revisions: revs(1), isComplete: true, completedAt: d("2025-03-12"), convertedProjectId: "pjx", convertedAt: d("2025-03-12"), sectionId: "cerradas" }),
  O("j3", { customFields: com(" Juan  Pérez "), createdAt: d("2025-03-01"), revisions: revs(3), isComplete: true, completedAt: d("2025-03-21"), sectionId: "entregadas" }),
  O("j4", { customFields: com("Juan Pérez"), createdAt: d("2025-03-20"), revisions: revs(2), sectionId: "revisiones" }),
  O("a1", { customFields: com("Ana Ruiz"), createdAt: d("2025-01-15"), revisions: revs(0), isComplete: true, completedAt: d("2025-01-25"), importedOutcome: "descartada", sectionId: "entregadas" }),
  O("a2", { customFields: com("Ana Ruiz"), createdAt: d("2025-02-15"), revisions: revs(0), isComplete: true, completedAt: d("2025-02-25"), sectionId: "entregadas" }),
  O("a3", { customFields: com("Ana Ruiz"), createdAt: d("2025-06-15"), revisions: [{ version: "A2", changes: "x" }], isComplete: true, completedAt: d("2025-07-15"), convertedProjectId: "pa", convertedAt: d("2025-07-15"), sectionId: "cerradas" }),
  O("s1", { createdAt: d("2026-02-01"), customFields: {} }),
  O("s2", { createdAt: d("2026-02-10"), customFields: {}, isComplete: true, completedAt: d("2026-03-12"), convertedProjectId: "pS", convertedAt: d("2026-03-12"), sectionId: "cerradas" }), // Comercial solo en el proyecto
  O("c1", { createdAt: undefined, offerCode: "26014", customFields: com("Ana Ruiz"), revisions: revs(0) }),
  { id: "ajena", title: "no es oferta", projectId: "p1", sectionId: "a", isComplete: false, customFields: com("Nadie") },
];

const rec = (id) => flow.collectOfferRecords({ tasks, projects, offersProject: OFF }).find((r) => r.id === id);
const records = flow.collectOfferRecords({ tasks: [...tasks, tasks[0]], projects, offersProject: OFF }); // j1 repetida: no duplica
eq("11 ofertas: 10 tareas de Ofertas + 1 leída desde un proyecto huérfano (sin duplicar la repetida ni las ya enlazadas)", records.length, 11);
eq("Comercial: se lee de customFields.comercial (el campo real) y se unifica la grafía", [rec("j1").commercial, rec("j2").commercial, rec("j3").commercial], ["Juan Pérez", "Juan Pérez", "Juan Pérez"]);
eq("Comercial vacío en una oferta convertida: se lee del proyecto en que se convirtió", rec("s2").commercial, "Luis Gómez");
eq("sin Comercial en ningún sitio → vacío", [rec("s1").commercial, rec("s1").commercialKey], ["", ""]);
eq("Revisiones se leen de task.revisions (sin contar la original)", ["j1", "j2", "j3", "j4", "a3", "s2"].map((id) => rec(id).revisions), [0, 1, 3, 2, 1, 0]);
eq("resultado: convertida (con proyecto) / entregada / descartada importada / en curso", ["j1", "j3", "a1", "j4"].map((id) => rec(id).outcome), ["converted", "delivered", "discarded", "active"]);
eq("año y mes salen de la fecha de creación", [rec("j3").year, rec("j3").month], [2025, 3]);
eq("sin fecha de creación: el año sale del prefijo YYXXX del ID y el mes se desconoce", [rec("c1").year, rec("c1").month], [2026, null]);
check("ciclo = días de creación a cierre (convertida: a convertedAt)", near(rec("j1").cycleDays, 30) && near(rec("a1").cycleDays, 10) && rec("j4").cycleDays === null, [rec("j1").cycleDays, rec("a1").cycleDays]);
check("una ganada importada (sin proyecto) también cuenta como convertida", flow.offerOutcome({ importedOutcome: "ganada", isComplete: true }) === "converted" && flow.offerOutcome({ isComplete: true }) === "delivered" && flow.offerOutcome({}) === "active");
// Comercial recreado a mano con otro id: se encuentra por su nombre
const OFF2 = { ...OFF, customFieldDefs: [{ id: "f_9", name: "Comercial", type: "texto" }] };
eq("campo Comercial recreado (otro id, mismo nombre) también se lee", flow.collectOfferRecords({ tasks: [O("z", { customFields: { f_9: "Eva" } })], projects: [OFF2], offersProject: OFF2 })[0].commercial, "Eva");
eq("sin proyecto Ofertas: ningún registro", flow.collectOfferRecords({ tasks, projects, offersProject: null }), []);

// ---------------------------------------------------------------- 2) la conversión conserva todo
const conv = props.propertiesFromOffer({ offer: { ...tasks[2], id: "j3", title: "**Cabina** J3", customFields: { comercial: "Juan Pérez", version: "A4" }, dueDate: d("2025-04-01") }, offersProject: OFF, today: "2026-11-02" });
eq("propertiesFromOffer: Comercial, versión aprobada, aprobación y vínculo a la oferta", [conv.properties.comercial, conv.properties.approvedVersion, conv.properties.approvalDate, conv.properties.sourceOfferId], ["Juan Pérez", "A4", "2026-11-02", "j3"]);
eq("propertiesFromOffer: el histórico de revisiones viaja entero (A1 + 3 revisiones)", conv.properties.history.map((r) => r.version), ["A1", "A2", "A3", "A4"]);
eq("propertiesFromOffer (v83): guarda cuántas revisiones llevaba y cuándo nació la oferta", [conv.properties.offerRevisionCount, typeof conv.properties.offerCreatedAt], [3, "string"]);
const saved = props.propertiesForSave(props.normalizeProperties(conv.properties));
eq("editar las propiedades NO pierde lo guardado al convertir (normalize → save)", [saved.offerRevisionCount, saved.offerCreatedAt, saved.sourceOfferId, saved.comercial], [3, conv.properties.offerCreatedAt, "j3", "Juan Pérez"]);
check("un proyecto que no nació de una oferta no gana esas claves", !("offerCreatedAt" in props.propertiesForSave(props.normalizeProperties({ comercial: "x" }))) && !("offerRevisionCount" in props.propertiesForSave(props.normalizeProperties({}))));
eq("offerRevisionCount 0 es un valor válido (se conserva)", props.propertiesForSave(props.normalizeProperties({ offerRevisionCount: 0, sourceOfferId: "q" })).offerRevisionCount, 0);
const fromProject = flow.readProjectOfferRecord(PO);
eq("oferta leída desde su proyecto: Comercial, revisiones (la cuenta guardada, no el histórico), año y resultado", [fromProject.commercial, fromProject.revisions, fromProject.year, fromProject.outcome, fromProject.projectId, fromProject.source], ["Ana Ruiz", 2, 2025, "converted", "pO", "project"]);
check("… y su ciclo sale de offerCreatedAt → fecha de aprobación (≈ 30 días)", near(fromProject.cycleDays, 30, 1.2), fromProject.cycleDays);
eq("un proyecto sin sourceOfferId no es una oferta", flow.readProjectOfferRecord(OTHER), null);
check("convertir sigue marcando la oferta (convertedProjectId + convertedAt) y enlazando el proyecto", /convertedProjectId: projectId,\s*convertedAt: serverTimestamp\(\)/.test(read("js/data/offer-conversion.js")) && /sourceOfferId: offer\.id/.test(read("js/project-properties.js")));
// Tras convertir y borrar la oferta (papelera), Métricas sigue contando el proyecto
const afterTrash = flow.collectOfferRecords({ tasks: tasks.filter((t) => t.id !== "j1"), projects, offersProject: OFF });
check("oferta convertida cuya tarea ya no existe: se lee del proyecto (Juan Pérez, convertida)", afterTrash.some((r) => r.id === "j1" && r.source === "project" && r.outcome === "converted" && r.commercial === "Juan Pérez"));

// ---------------------------------------------------------------- 3) filtros
const opts = flow.offerFilterOptions(records);
eq("comerciales dinámicos (sin duplicar grafías) + «Sin comercial»", opts.commercials.map((c) => c.label), ["Ana Ruiz", "Juan Pérez", "Luis Gómez", "Sin comercial"]);
eq("años: del más reciente al más antiguo", opts.years, [2026, 2025]);
const ids = (rs) => rs.map((r) => r.id).sort();
eq("Año 2025", ids(flow.applyOfferFilters(records, { year: 2025 })), ["a1", "a2", "a3", "gone", "j1", "j2", "j3", "j4"]);
eq("Año 2026 (incluye la que solo tiene año por su ID)", ids(flow.applyOfferFilters(records, { year: "2026" })), ["c1", "s1", "s2"]);
eq("Año 2025 + Mes marzo", ids(flow.applyOfferFilters(records, { year: 2025, month: 3 })), ["j3", "j4"]);
eq("Mes con año 2026: la que no tiene mes conocido no entra", ids(flow.applyOfferFilters(records, { year: 2026, month: 2 })), ["s1", "s2"]);
eq("Comercial concreto", ids(flow.applyOfferFilters(records, { commercial: "ana ruiz" })), ["a1", "a2", "a3", "c1", "gone"]);
eq("Comercial + Año", ids(flow.applyOfferFilters(records, { commercial: "ana ruiz", year: 2025 })), ["a1", "a2", "a3", "gone"]);
eq("Comercial + Año + Mes", ids(flow.applyOfferFilters(records, { commercial: "ana ruiz", year: 2025, month: 1 })), ["a1"]);
eq("«Sin comercial»", ids(flow.applyOfferFilters(records, { commercial: flow.NO_COMMERCIAL_VALUE })), ["s1"]);
eq("sin filtros: todas", flow.applyOfferFilters(records, {}).length, 11);
eq("cada filtro recalcula los indicadores: Ana 2025 vs todo", [flow.summarizeOffers(flow.applyOfferFilters(records, { commercial: "ana ruiz", year: 2025 })).total, flow.summarizeOffers(records).total], [4, 11]);

// ---------------------------------------------------------------- 4) efectividad por comercial
const rank = flow.commercialRanking(records);
eq("ranking: por % de éxito (sin resueltas, al final)", rank.map((r) => r.name), ["Luis Gómez", "Juan Pérez", "Ana Ruiz", "Sin comercial"]);
const juan = rank.find((r) => r.name === "Juan Pérez"), ana = rank.find((r) => r.name === "Ana Ruiz");
eq("Juan: ofertas / en curso / ganadas / sin convertir / %", [juan.total, juan.active, juan.converted, juan.notConverted, juan.conversionPct], [4, 1, 2, 1, 67]);
eq("Juan: revisiones pedidas 0+1+3+2 = 6 → 1,5 por oferta", [juan.revisionsTotal, juan.revisionsAvg], [6, 1.5]);
check("Juan: ciclo medio ≈ 26,7 días ((30 + 30 + 20) / 3)", near(juan.avgCycleDays, 26.7, 0.3), juan.avgCycleDays);
eq("Ana (incluye la oferta leída del proyecto): 5 ofertas, 2 ganadas, 2 sin convertir (descartada + entregada), 1 en curso → 50 %", [ana.total, ana.converted, ana.notConverted, ana.active, ana.conversionPct], [5, 2, 2, 1, 50]);
eq("Ana: 3 revisiones en 5 ofertas = 0,6", [ana.revisionsTotal, ana.revisionsAvg], [3, 0.6]);
eq("muestra pequeña marcada (< 5 resueltas)", [juan.lowSample, rank[0].lowSample], [true, true]);
const five = [0, 1, 2, 3, 2].map((n, i) => ({ id: "m" + i, source: "offer", commercial: "Marta", commercialKey: "marta", revisions: n, outcome: "converted", cycleDays: 10, year: 2025, month: 1 }));
eq("1,6 rev/oferta (ejemplo del pedido: 0+1+2+3+2 = 8 en 5 ofertas)", flow.commercialRanking(five)[0].revisionsAvg, 1.6);
eq("5 resueltas: ya no es muestra pequeña", flow.commercialRanking(five)[0].lowSample, false);
eq("el ranking respeta el filtro de año", flow.commercialRanking(flow.applyOfferFilters(records, { year: 2026 })).map((r) => [r.name, r.total]), [["Luis Gómez", 1], ["Ana Ruiz", 1], ["Sin comercial", 1]]);

// ---------------------------------------------------------------- 5) evolución mensual
const evo = flow.evolutionSeries(records, { year: 2025 });
eq("evolución: 12 meses del año elegido", [evo.kind, evo.rows.length], ["month", 12]);
eq("enero 2025: 2 ofertas (1 convertida, 1 descartada) → 50 %", [evo.rows[0].total, evo.rows[0].converted, evo.rows[0].notConverted, evo.rows[0].conversionPct], [2, 1, 1, 50]);
eq("marzo 2025: 2 ofertas (1 entregada, 1 en curso) → 0 %", [evo.rows[2].total, evo.rows[2].notConverted, evo.rows[2].active, evo.rows[2].conversionPct], [2, 1, 1, 0]);
eq("mayo (la del proyecto huérfano) y mes sin ofertas", [evo.rows[4].total, evo.rows[3].total, evo.rows[3].conversionPct], [1, 0, null]);
eq("evolución con un comercial", flow.evolutionSeries(records, { year: 2025, commercial: "juan perez" }).rows.map((r) => r.total), [1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const evoAll = flow.evolutionSeries(records, {});
eq("sin año: un punto por año", [evoAll.kind, evoAll.rows.map((r) => [r.label, r.total])], ["year", [["2025", 8], ["2026", 3]]]);
eq("meses sin conocer (solo el año del ID)", flow.evolutionSeries(records, { year: 2026 }).undated, 1);
eq("el filtro de mes no recorta la evolución (se ve el año entero)", flow.evolutionSeries(records, { year: 2025 }).rows.filter((r) => r.total).length, 5);

// ---------------------------------------------------------------- 6) correlación revisiones ↔ cierre
const corr = flow.revisionCorrelation(records);
eq("4 tramos", corr.map((b) => b.key), ["0", "1", "2", "3+"]);
eq("0 revisiones: 6 ofertas, 2 ganadas, 50 %", [corr[0].total, corr[0].converted, corr[0].conversionPct], [6, 2, 50]);
eq("1 revisión: 2 ofertas, 2 ganadas, 100 %", [corr[1].total, corr[1].converted, corr[1].conversionPct], [2, 2, 100]);
eq("2 revisiones: 2 ofertas, 1 ganada (la otra sigue en curso) → 100 % de las resueltas", [corr[2].total, corr[2].converted, corr[2].active, corr[2].conversionPct], [2, 1, 1, 100]);
eq("3 o más: 1 oferta, 0 ganadas, 0 %", [corr[3].total, corr[3].converted, corr[3].conversionPct], [1, 0, 0]);
check("media de días del tramo «a la primera» ≈ 20 ((30+10+10+30)/4)", near(corr[0].avgDays, 20, 0.5), corr[0].avgDays);
eq("el tramo correcto para 0,1,2,3,7 revisiones", [0, 1, 2, 3, 7].map(flow.revisionBucketKey), ["0", "1", "2", "3+", "3+"]);
const ins = flow.revisionInsight(corr);
eq("interpretación: las revisadas se cierran más (75 % frente a 50 %)", [ins.direction, ins.diffPts, ins.reliable], ["revised", -25, false]);
check("el resumen lo dice con los porcentajes y avisa de la muestra pequeña", /con revisiones se cierran más/.test(ins.summary) && /75%/.test(ins.summary) && /50%/.test(ins.summary) && ins.details.some((x) => /Muestra pequeña/.test(x)), ins);
check("detalle de 3 o más revisiones frente a 1-2", ins.details.some((x) => /3 o más revisiones el éxito baja a 0%/.test(x)), ins.details);
const mk = (rev, outcome, n) => Array.from({ length: n }, (_, i) => ({ id: `${rev}${outcome}${i}`, source: "offer", commercial: "", commercialKey: "", revisions: rev, outcome, cycleDays: rev ? 20 : 10, year: 2025, month: 1 }));
const big1 = [...mk(0, "converted", 8), ...mk(0, "delivered", 2), ...mk(1, "converted", 3), ...mk(2, "delivered", 7)];
const i1 = flow.revisionInsight(flow.revisionCorrelation(big1));
eq("a la primera se cierra más (80 % frente a 30 %), muestra fiable", [i1.direction, i1.diffPts, i1.reliable], ["first", 50, true]);
check("… y el detalle compara los días (20 frente a 10)", i1.details.some((x) => /tardan de media 20 días/.test(x) && /10 más/.test(x) && /10 días/.test(x)), i1.details);
const i2 = flow.revisionInsight(flow.revisionCorrelation([...mk(0, "converted", 5), ...mk(0, "delivered", 5), ...mk(1, "converted", 5), ...mk(1, "delivered", 5)]));
eq("diferencia de menos de 5 puntos: sin diferencia apreciable", [i2.direction, /no cambia de forma apreciable/.test(i2.summary)], ["equal", true]);
eq("sin resueltas en un grupo: no se compara", flow.revisionInsight(flow.revisionCorrelation(mk(0, "converted", 3))).direction, "unknown");

// ---------------------------------------------------------------- 7) importador: CSV, fechas, columnas
eq("CSV con «;», comillas y BOM", imp.parseDelimited('\uFEFFOferta;Comercial\n"Cabina; grande";"Juan ""el Rojo"""\n\n'), [["Oferta", "Comercial"], ["Cabina; grande", 'Juan "el Rojo"']]);
eq("CSV con comas y saltos de línea Windows", imp.parseDelimited("a,b,c\r\n1,2,3\r\n"), [["a", "b", "c"], ["1", "2", "3"]]);
eq("CSV con tabuladores", imp.parseDelimited("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
const ymd = (x) => x && [x.getFullYear(), x.getMonth() + 1, x.getDate()];
eq("fecha dd/mm/aaaa, d/m/aa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd", ["15/03/2024", "15/3/24", "15-03-2024", "15.03.2024", "2024-03-15"].map((t) => ymd(imp.parseHistoricalDate(t))), Array(5).fill([2024, 3, 15]));
const serial = Math.round((Date.UTC(2024, 2, 15) - Date.UTC(1899, 11, 30)) / 86400000);
eq("fecha como número de serie de Excel (y como texto numérico)", [ymd(imp.parseHistoricalDate(serial)), ymd(imp.parseHistoricalDate(String(serial)))], [[2024, 3, 15], [2024, 3, 15]]);
eq("fecha Date (de una celda de fecha)", ymd(imp.parseHistoricalDate(new Date(2024, 2, 15, 0, 0, 0))), [2024, 3, 15]);
eq("fechas inválidas: 31/02, vacía, texto, número pequeño", ["31/02/2024", "", "ayer", 12].map((x) => imp.parseHistoricalDate(x)), [null, null, null, null]);
eq("resultado: sinónimos", ["Ganada", "ADJUDICADA", "Sí", "Perdida", "rechazada", "No", "Entregada", "pendiente", "En curso", "abierta", "¿?"].map(imp.parseOutcome), ["ganada", "ganada", "ganada", "descartada", "descartada", "descartada", "entregada", "entregada", "en_curso", "en_curso", null]);
eq("revisiones: número, texto, vacío y a la primera", [2, "3", "2 revisiones", "", "a la primera", "ninguna"].map((v) => imp.parseRevisionCount(v).value), [2, 3, 2, 0, 0, 0]);
check("revisiones inválidas: negativas, texto, exceso", ["-1", "muchas", 99].every((v) => !!imp.parseRevisionCount(v).error));
eq("encabezados por sinónimos (sin tildes ni signos)", imp.mapHeaders(["Nombre de la oferta", "COMERCIAL", "Fecha oferta", "Nº Revisiones", "Estado", "Fecha de cierre", "Sector", "Ubicación", "ID"]), { title: 0, commercial: 1, date: 2, revisions: 3, outcome: 4, closedAt: 5, sector: 6, location: 7, code: 8 });

const csv = [
  "Informe de ofertas 2024;;;;",                                        // fila de título antes de los encabezados
  "Oferta;Comercial;Fecha;Revisiones;Resultado;Fecha cierre;Sector",
  "Cabina A;Juan Pérez;15/03/2024;2;Ganada;02/05/2024;Industria",
  "Cabina B;Ana Ruiz;10/06/2024;0;Perdida;;Automoción",
  "Cabina C;;01/07/2024;;En curso;;",
  "Cabina D;Juan Pérez;31/02/2024;1;Ganada;;",                           // fecha imposible
  "Cabina E;Juan Pérez;01/08/2024;1;Quizá;;",                            // resultado desconocido
  ";Ana Ruiz;01/09/2024;1;Ganada;;",                                     // sin nombre
  "Cabina G;Ana Ruiz;01/09/2024;x;Ganada;;",                             // revisiones no válidas
  "Cabina H;Ana Ruiz;10/10/2024;1;Ganada;01/10/2024;",                   // cierre anterior a la oferta
  ";;;;;;",                                                              // fila vacía
].join("\n");
const parsed = imp.parseOfferHistoryRows(imp.parseDelimited(csv));
eq("la fila de encabezados se encuentra aunque no sea la primera", [parsed.headerRow, parsed.missing], [1, []]);
eq("filas leídas / válidas / con error", [parsed.rowCount, parsed.records.length, parsed.errors.length], [8, 4, 4]);
eq("errores con su número de fila", parsed.errors.map((e) => e.line), [6, 7, 8, 9]);
check("los mensajes de error dicen qué falla", /fecha no válida/.test(parsed.errors[0].message) && /resultado no reconocido/.test(parsed.errors[1].message) && /falta el nombre/.test(parsed.errors[2].message) && /Revisiones no válidas/.test(parsed.errors[3].message), parsed.errors);
check("avisos: sin comercial, revisiones vacías como 0, cierre anterior ignorado", parsed.warnings.some((w) => /sin comercial/.test(w.message)) && parsed.warnings.some((w) => /sin nº de revisiones/.test(w.message)) && parsed.warnings.some((w) => /anterior a la de la oferta/.test(w.message)), parsed.warnings);
const [rA, rB, rC, rH] = parsed.records;
eq("registro A", [rA.title, rA.commercial, ymd(rA.createdAt), rA.revisions, rA.outcome, ymd(rA.closedAt), rA.sector], ["Cabina A", "Juan Pérez", [2024, 3, 15], 2, "ganada", [2024, 5, 2], "Industria"]);
eq("registro C (en curso, sin comercial ni revisiones)", [rC.commercial, rC.revisions, rC.outcome, rC.closedAt], ["", 0, "en_curso", null]);
eq("cierre anterior a la fecha de oferta → sin fecha de cierre", rH.closedAt, null);
const noCols = imp.parseOfferHistoryRows([["Cliente", "Importe"], ["x", "1"]]);
check("sin columnas reconocibles: lo dice y no importa nada", noCols.headerRow === -1 && noCols.missing.includes("Comercial") && noCols.records.length === 0);
const missing = imp.parseOfferHistoryRows([["Oferta", "Fecha", "Resultado"], ["a", "01/01/2024", "ganada"]]);
eq("falta una obligatoria (Comercial)", [missing.missing, missing.records.length], [["Comercial"], 0]);
check("sin columna Revisiones: avisa y cuenta 0", imp.parseOfferHistoryRows([["Oferta", "Comercial", "Fecha", "Resultado"], ["a", "x", "01/01/2024", "ganada"]]).warnings.some((w) => /no hay columna «Revisiones»/.test(w.message)));
check("plantilla descargable: se lee sin errores", (() => { const p = imp.parseOfferHistoryRows(imp.parseDelimited(imp.OFFER_IMPORT_TEMPLATE_CSV)); return p.records.length === 2 && !p.errors.length; })());

// ---------------------------------------------------------------- 8) del archivo a ofertas (plan, duplicados, documento)
let n = 0;
const ctx = { offersProject: OFF, existing: [], makeId: () => "id" + ++n, batchId: "import-test" };
const plan = imp.planOfferHistoryImport(parsed.records, ctx);
eq("plan: 4 nuevas, 0 duplicadas", [plan.blocking, plan.toCreate.length, plan.duplicates.length], [null, 4, 0]);
const docA = plan.toCreate[0].doc;
eq("documento A: título, proyecto, sección (ganada → Cerradas), completada", [docA.title, docA.projectId, docA.sectionId, docA.isComplete], ["Cabina A", "off", "cerradas", true]);
eq("documento A: Comercial en el campo real, versión A3 y sector", [docA.customFields.comercial, docA.customFields.version, docA.customFields.sector], ["Juan Pérez", "A3", "Industria"]);
eq("documento A: histórico A1 original + 2 revisiones (cuenta 2 para Métricas)", [docA.revisions.map((r) => r.version), offersLib.countOfferRevisions(docA.revisions)], [["A1", "A2", "A3"], 2]);
eq("documento A: marcas del histórico (resultado ganada, fecha de conversión = cierre)", [docA.importedHistorical, docA.importedOutcome, docA.importBatchId, ymd(docA.convertedAt), ymd(docA.completedAt)], [true, "ganada", "import-test", [2024, 5, 2], [2024, 5, 2]]);
const docB = plan.toCreate[1].doc, docC = plan.toCreate[2].doc;
eq("perdida → «Entregadas», sin convertedAt; en curso → «Nuevas» y sin completar", [docB.sectionId, docB.convertedAt, docC.sectionId, docC.isComplete, docC.completedAt], ["entregadas", null, "nuevas", false, null]);
eq("en curso con revisiones → «Revisiones»", imp.buildHistoricalOfferDoc({ ...rC, revisions: 2 }, ctx).sectionId, "revisiones");
// Lo importado lo lee Métricas exactamente igual que el resto
const importedTasks = plan.toCreate.map((x, i) => ({ id: "imp" + i, ...x.doc, projectId: "off" }));
const impRecords = flow.collectOfferRecords({ tasks: importedTasks, projects: [OFF], offersProject: OFF });
eq("Métricas lee lo importado: Comercial, revisiones, año/mes y resultado", impRecords.map((r) => [r.commercial, r.revisions, r.year, r.month, r.outcome]), [["Juan Pérez", 2, 2024, 3, "converted"], ["Ana Ruiz", 0, 2024, 6, "discarded"], ["", 0, 2024, 7, "active"], ["Ana Ruiz", 1, 2024, 10, "converted"]]);
check("y el ciclo sale de las fechas del archivo (A: 48 días)", near(impRecords[0].cycleDays, 48, 1.2), impRecords[0].cycleDays);
// Duplicados
const again = imp.planOfferHistoryImport(parsed.records, { ...ctx, existing: importedTasks });
eq("volver a importar el mismo archivo: todo duplicado, nada nuevo", [again.toCreate.length, again.duplicates.length], [0, 4]);
const twice = imp.planOfferHistoryImport([...parsed.records, { ...parsed.records[0], line: 99, title: "**Cabina A**" }], ctx);
eq("duplicada dentro del archivo (aunque lleve negritas) y por ID de oferta existente", [twice.toCreate.length, twice.duplicates.length, imp.planOfferHistoryImport([{ ...rA, code: "26007" }], { ...ctx, existing: [{ id: "x", title: "otra", offerCode: "26007", createdAt: d("2020-01-01") }] }).duplicates.length], [4, 1, 1]);
check("sin proyecto Ofertas o sin campo Comercial: bloquea con motivo", /Ofertas/.test(imp.planOfferHistoryImport(parsed.records, { ...ctx, offersProject: null }).blocking) && /Comercial/.test(imp.planOfferHistoryImport(parsed.records, { ...ctx, offersProject: { ...OFF, customFieldDefs: [] } }).blocking));

// ---------------------------------------------------------------- 9) escritura en Firestore (lotes y fechas originales)
fb.sets.length = 0;
const progress = [];
const res = await writer.importHistoricalOffers({ docs: plan.toCreate.map((x) => x.doc), createdBy: "admin", onProgress: (a, b) => progress.push([a, b]) });
eq("se escriben las 4 ofertas", [res, fb.sets.length, progress.at(-1)], [{ created: 4, failed: 0 }, 4, [4, 4]]);
const w0 = fb.sets[0].data;
check("conserva las fechas ORIGINALES (no la de hoy) y sella la entrada en su sección con el cierre", w0.createdAt instanceof Date && ymd(w0.createdAt).join() === "2024,3,15" && ymd(w0.sectionEnteredAt).join() === "2024,5,2" && w0.updatedAt === "TS", w0);
check("no reparte ID ni inventa asignados; marca el histórico", !("offerCode" in w0) && w0.assigneeIds.length === 0 && w0.importedHistorical === true && w0.createdBy === "admin" && w0.ownerId === null);
check("misma forma que una tarea normal (campos que las vistas esperan)", ["subtasks", "attachments", "tags", "dependsOn", "extraProjectIds", "extraSections", "priority", "isMilestone", "order"].every((k) => k in w0));
fb.sets.length = 0;
const bulk = Array.from({ length: 850 }, (_, i) => ({ ...docA, title: "T" + i }));
const bres = await writer.importHistoricalOffers({ docs: bulk, createdBy: "admin" });
eq("850 ofertas: se escriben todas, por lotes", [bres, fb.sets.length, writer.IMPORT_BATCH_SIZE], [{ created: 850, failed: 0 }, 850, 400]);

// ---------------------------------------------------------------- 10) la vista de Métricas (jsdom, eventos reales)
const members = [{ uid: "admin", name: "Admin", role: "admin" }, { uid: "ana", name: "Ana", role: "member", department: "diseno-industria", isDepartmentHead: true }];
const mounted = [];
function renderM(user = members[0], projs = projects, ts = tasks) {
  while (mounted.length) mounted.pop().remove(); // un solo Métricas en el DOM (ids únicos)
  const c = document.createElement("div");
  mounted.push(c);
  document.body.appendChild(c);
  renderMetricsView(c, { tasks: ts, teamMembers: members, projects: projs, onOpenTask() {}, currentUser: user, departmentFilter: "", workCalendar: undefined });
  return c;
}
const q = (c, sel) => c.querySelector(sel);
const count = (c) => q(c, "#metrics-offer-funnel .metrics__section-count").textContent;
const setSelect = (c, sel, value) => { const s = q(c, sel); s.value = value; s.dispatchEvent(new window.Event("change", { bubbles: true })); };
resetOfferFilters();
let c = renderM();
check("la barra de filtros del embudo existe (Comercial, Año, Mes)", !!q(c, "#offer-filter-commercial") && !!q(c, "#offer-filter-year") && !!q(c, "#offer-filter-month"));
eq("opciones: «Todos los comerciales» + 4; «Todos los años» + 2; «Todo el año» + 12", [q(c, "#offer-filter-commercial").options.length, q(c, "#offer-filter-year").options.length, q(c, "#offer-filter-month").options.length], [5, 3, 13]);
eq("primera opción de cada filtro", ["#offer-filter-commercial", "#offer-filter-year", "#offer-filter-month"].map((s) => q(c, s).options[0].textContent), ["Todos los comerciales", "Todos los años", "Todo el año"]);
eq("sin filtros: 11 ofertas, conversión 5 de 8 (63 %)", [count(c), q(c, '[data-funnel="pct"]').textContent], ["11", "63%"]);
check("la tabla de efectividad y la matriz de revisiones se pintan", q(c, "#offer-ranking").querySelectorAll("[data-commercial]").length === 4 && q(c, "#offer-revisions").querySelectorAll("[data-bucket]").length === 4);
setSelect(c, "#offer-filter-commercial", "ana ruiz");
eq("al cambiar Comercial se recalcula todo al instante", [count(c), q(c, '[data-funnel="pct"]').textContent, q(c, "#offer-ranking").querySelectorAll("[data-commercial]").length, q(c, "#offer-ranking [data-cell='avg']").textContent], ["5", "50%", 1, "0,6"]);
setSelect(c, "#offer-filter-year", "2025");
eq("Año 2025 → 4 ofertas de Ana", count(c), "4");
check("con un año elegido sale la evolución mensual de ese año", /Evolución mensual de 2025/.test(q(c, "#metrics-offer-funnel").textContent) && q(c, "#offer-evolution").querySelectorAll("[data-month]").length === 12);
setSelect(c, "#offer-filter-month", "1");
eq("Mes enero → 1 oferta (a1)", count(c), "1");
check("los selects conservan lo elegido tras repintarse", q(c, "#offer-filter-commercial").value === "ana ruiz" && q(c, "#offer-filter-year").value === "2025" && q(c, "#offer-filter-month").value === "1");
eq("los filtros se recuerdan (y el resto de Métricas no se repinta)", [getOfferFilters(), !!q(c, "#metrics-flow-health")], [{ commercial: "ana ruiz", year: "2025", month: "1" }, true]);
c = renderM();
eq("al volver a Métricas siguen aplicados", [count(c), q(c, "#offer-filter-month").value], ["1", "1"]);
q(c, "#offer-filter-clear").click();
eq("«Limpiar filtros» vuelve a todas", [count(c), q(c, "#offer-filter-commercial").value, q(c, "#offer-filter-clear").disabled], ["11", "", true]);
setSelect(c, "#offer-filter-year", "2025");
q(c, '#offer-evolution [data-month="3"]').click();
eq("pulsar un mes de la evolución lo filtra (marzo 2025 → 2) y lo resalta", [count(c), q(c, "#offer-filter-month").value, !!q(c, '#offer-evolution [data-month="3"].is-selected')], ["2", "3", true]);
q(c, '#offer-evolution [data-month="3"]').click();
eq("pulsarlo otra vez quita el mes", [count(c), q(c, "#offer-filter-month").value], ["8", ""]);
setSelect(c, "#offer-filter-commercial", "luis gomez");
check("sin resultados: lo dice y los filtros siguen ahí para cambiarlos", count(c) === "0" && !!q(c, "#offer-no-results") && !!q(c, "#offer-filters"));
resetOfferFilters();
c = renderM();
check("la interpretación de revisiones se enseña con su dirección", !!q(c, "#offer-revision-insight.metrics-insight--revised") && /con revisiones se cierran más/.test(q(c, "#offer-revision-insight").textContent));
check("v84: el botón «Importar histórico» está oculto (ni admin ni resto lo ven) y la ventana sigue en el proyecto", !q(c, "#offer-import-btn") && !q(renderM(members[1]), "#offer-import-btn") && metrics.OFFER_IMPORT_BUTTON_VISIBLE === false && typeof modal.openOfferImportModal === "function");
check("sin proyecto Ofertas visible no hay embudo", !q(renderM(members[0], [OTHER]), "#metrics-offer-funnel"));

// ---------------------------------------------------------------- 11) la ventana de importar (jsdom)
modal.openOfferImportModal({ offersProject: OFF, existing: [], currentUser: members[0] }); // v84: sin botón visible, se abre directo
const mm = document.querySelector("#modal-root .offer-import");
check("la ventana de importación sigue funcionando (se abre por código)", !!mm);
const upload = async (name, text) => {
  const input = mm.querySelector("#oi-file");
  const buf = Buffer.from(text, "utf8");
  Object.defineProperty(input, "files", { value: [{ name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(30);
};
check("sin archivo no se puede importar", mm.querySelector("#oi-run").disabled === true);
await upload("historico.csv", csv);
check("vista previa: cuenta nuevas, existentes y errores", /4 nuevas/.test(mm.querySelector("#oi-summary").textContent) && /0 ya existentes/.test(mm.querySelector("#oi-summary").textContent) && /4 con errores/.test(mm.querySelector("#oi-summary").textContent), mm.querySelector("#oi-summary") && mm.querySelector("#oi-summary").textContent);
check("la vista previa lista los errores con su fila", mm.querySelectorAll("#oi-errors li").length === 4 && /Fila 6/.test(mm.querySelector("#oi-errors").textContent));
check("el botón se activa con el número de ofertas", !mm.querySelector("#oi-run").disabled && /Importar 4 ofertas/.test(mm.querySelector("#oi-run").textContent));
await upload("raro.csv", "Cliente;Importe\nx;1");
check("un archivo sin columnas válidas lo dice y bloquea el botón", mm.querySelector("#oi-run").disabled && /columnas obligatorias/.test(mm.querySelector("#oi-result").textContent));
await upload("foto.png", "x");
check("un formato no admitido se rechaza", /Formato no admitido/.test(mm.querySelector("#oi-result").textContent) && mm.querySelector("#oi-run").disabled);
await upload("historico.csv", csv);
fb.sets.length = 0;
mm.querySelector("#oi-run").click();
await tick(50);
eq("«Importar» escribe las 4 ofertas y cierra la ventana", [fb.sets.length, !!document.querySelector("#modal-root .offer-import")], [4, false]);
resetOfferFilters();

// ---------------------------------------------------------------- 12) entrega: versión, CSS, README y novedades
check("package.json y el ?v= de index.html van a la par (≥ 83, 14 enlaces CSS iguales)", (() => { const major = parseInt(JSON.parse(read("package.json")).version, 10); return major >= 83 && (read("index.html").match(new RegExp(`\\?v=${major}\\b`, "g")) || []).length === 14 && !/\?v=82/.test(read("index.html")); })());
check("CSS: estilos del embudo (metrics) y de la ventana de importar (modals)", /\.offer-evolution/.test(read("css/12-metrics-notifications.css")) && /\.metrics-insight/.test(read("css/12-metrics-notifications.css")) && /\.offer-import__table/.test(read("css/07-modals.css")));
const wn = await import("../js/whats-new.js");
check("Novedades: la v83 consta y habla de filtros, comerciales, revisiones e importar", (() => { const r = wn.RELEASES.find((x) => x.id === 83); return !!r && wn.RELEASES[0].id >= 83 && /filtr/i.test(JSON.stringify(r)) && /revisiones/i.test(JSON.stringify(r)) && /import/i.test(JSON.stringify(r)); })());
check("README documenta la v83", /v83/.test(read("README.md")) && /Chusy-83/.test(read("README.md")));
check("no se crearon campos nuevos de Comercial/Revisiones en el modal de tareas", !/offerFilters|importedOutcome|offerRevisionCount/.test(read("js/components/task-modal.js")));

done("v83 · analítica de ofertas, filtros, revisiones ↔ cierre e importador");
