// Buzón de Outlook (v80) — el listener real (js/outlook-listener.js) con un Firestore controlado desde la prueba
// (ganchos de tests/support/hooks.mjs): el correo con el que escucha, y que NINGÚN fallo (asignar el ID YYXXX,
// escribir el resultado…) detenga la escucha ni deje una petición sin borrar.
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, tick } from "./support/dom.mjs";

setupDom();
let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });

// Los borrados «de seguro» tardan 60 s: se guardan para ejecutarlos a mano (y que el proceso no espere).
const realSetTimeout = globalThis.setTimeout;
const deferred = [];
globalThis.setTimeout = (fn, ms, ...a) => (ms >= 60000 ? (deferred.push(fn), 0) : realSetTimeout(fn, ms, ...a));

const fb = (globalThis.__fb = globalThis.__fb || { collections: {}, sets: [] });
const log = { updates: [], deletes: [], claims: [] };
const state = { failCounterFor: new Set(), failUpdateFor: new Set(), counterCalls: 0 };
const observers = {};
let inboxQuery = null;
let inboxSubscriptions = 0;

fb.hooks = {
  onSnapshot(q, ...rest) {
    const path = q && q.args && q.args[0] && q.args[0].path;
    if (path === "offerInbox") {
      inboxSubscriptions++;
      inboxQuery = q;
      observers.inbox = rest[0];
    } else if (path === "projects") observers.projects = rest[0];
    return () => {};
  },
  async runTransaction(_db, fn) {
    const tx = {
      async get(ref) {
        if (/projectCounter/.test(ref.path)) {
          state.counterCalls++;
          if (state.failCounterFor.has(currentId)) throw new Error("sin permiso en el contador");
          return { exists: () => true, data: () => ({ next: 7 }) };
        }
        return { exists: () => true, data: () => ({ status: "pending" }) };
      },
      set() {},
      update(ref, fields) { log.claims.push({ path: ref.path, fields }); },
    };
    return fn(tx);
  },
  async updateDoc(ref, fields) {
    if (state.failUpdateFor.has(ref.id)) throw new Error("sin conexión");
    log.updates.push({ id: ref.id, fields });
  },
  async deleteDoc(ref) { log.deletes.push(ref.id); },
};
let currentId = "";

const { startOutlookListener, stopOutlookListener } = await import("../js/outlook-listener.js");
const { subscribeToAllProjects } = await import("../js/data/projects.js");
const { OFFERS_KEY } = await import("../js/offers.js");

// El proyecto Ofertas entra por la escucha real de proyectos.
subscribeToAllProjects(() => {});
const send = (obs, snap) => (typeof obs === "function" ? obs(snap) : obs.next(snap));
const snapOf = (items) => ({
  metadata: { fromCache: false },
  docs: items.map((d) => ({ id: d.id, data: () => d.data })),
  docChanges: () => items.map((d) => ({ type: "added", doc: { id: d.id, data: () => d.data } })),
});
send(observers.projects, snapOf([{ id: "ofr", data: { name: "Ofertas", exclusive: true, exclusiveKey: OFFERS_KEY, archived: false, sections: [{ id: "s1", name: "Nuevas" }], customFieldDefs: [] } }]));

// ---------------------------------------------------------------- el correo con el que escucha
const user = { uid: "u1", email: "  Perfil@Martech.COM ", role: "admin", department: "diseno-industria" };
startOutlookListener({ user, getCommercialOptions: () => [], authEmail: " Ramon@Martech.com " });
const where = inboxQuery && inboxQuery.args[1];
eq("la consulta usa el correo de la sesión, en minúsculas y sin espacios", where && where.args, ["targetEmail", "==", "ramon@martech.com"]);
startOutlookListener({ user, getCommercialOptions: () => [], authEmail: "RAMON@martech.com" });
eq("misma cuenta (aunque cambie la capitalización): no se reabre la escucha", inboxSubscriptions, 1);
stopOutlookListener();
startOutlookListener({ user, getCommercialOptions: () => [] });
eq("sin correo de sesión, se usa el del perfil normalizado", inboxQuery.args[1].args[2], "perfil@martech.com");
eq("(y es una escucha nueva)", inboxSubscriptions, 2);
stopOutlookListener();
startOutlookListener({ user: { uid: "u2", email: "" }, getCommercialOptions: () => [] });
eq("sin ningún correo no se escucha", inboxSubscriptions, 2);

// ---------------------------------------------------------------- peticiones
startOutlookListener({ user, getCommercialOptions: () => [], authEmail: "ramon@martech.com" });
const request = (id) => ({ id, data: { status: "pending", targetEmail: "ramon@martech.com", name: `OFERTA ${id}`, location: "\\\\NAS\\X", commercial: "", description: "texto" } });
const arrive = async (id) => { currentId = id; send(observers.inbox, snapOf([request(id)])); await tick(20); };

send(observers.inbox, snapOf([])); // primera instantánea: lo que ya hubiera (nada)
await tick(5);

// 1) Falla la asignación del ID YYXXX: la petición se marca «error» y la escucha sigue.
state.failCounterFor.add("r1");
await arrive("r1");
const r1 = log.updates.find((u) => u.id === "r1");
check("r1: el fallo del contador YYXXX deja la petición en «error» con un mensaje", r1 && r1.fields.status === "error" && /no se pudo crear/.test(r1.fields.message), r1);
check("r1: no se creó ninguna oferta (no hay «created»)", !log.updates.some((u) => u.id === "r1" && u.fields.status === "created"));

// 2) La siguiente petición se atiende con normalidad: el listener no se paró.
await arrive("r2");
const r2 = log.updates.find((u) => u.id === "r2");
check("r2: tras el fallo anterior, la oferta se crea (status «created» + taskId)", r2 && r2.fields.status === "created" && !!r2.fields.taskId, r2);
check("r2: el nombre final es el de la petición", r2 && r2.fields.finalName === "OFERTA r2", r2);

// 3) No se puede escribir el resultado (sin conexión): no revienta nada.
state.failUpdateFor.add("r3");
await arrive("r3");
check("r3: si no se puede anotar el resultado tampoco se cae (sin rechazos sin atender)", unhandled === 0, unhandled);

// 4) Y aun así sigue atendiendo.
await arrive("r4");
check("r4: sigue creando ofertas después de todo eso", log.updates.some((u) => u.id === "r4" && u.fields.status === "created"));

// 4b) Hasta el aviso en pantalla puede fallar (aquí lanza showToast): ni éxito ni error se quedan sin atender.
const realGetById = document.getElementById.bind(document);
document.getElementById = (id) => { if (id === "toast-root") throw new Error("DOM roto"); return realGetById(id); };
state.failCounterFor.add("r6");
await arrive("r6");
const r6 = log.updates.find((u) => u.id === "r6");
check("r6: si falla el aviso del error, la petición igualmente queda en «error»", r6 && r6.fields.status === "error", r6);
await arrive("r7");
check("r7: con el aviso roto, la oferta se crea y se anota igualmente", log.updates.some((u) => u.id === "r7" && u.fields.status === "created"));
check("sin rechazos de promesa sin atender tras fallar el aviso", unhandled === 0, unhandled);
document.getElementById = realGetById;

// 5) La petición en error también se borra más tarde (lleva el texto de un correo).
deferred.splice(0).forEach((fn) => fn());
await tick(5);
eq("se borran todas (también las que acabaron en error)", [...new Set(log.deletes)].sort(), ["r1", "r2", "r3", "r4", "r6", "r7"]);
eq("cada una se reclamó una sola vez (transacción pending → processing)", log.claims.filter((c) => /offerInbox/.test(c.path)).map((c) => c.path).sort(), ["offerInbox/r1", "offerInbox/r2", "offerInbox/r3", "offerInbox/r4", "offerInbox/r6", "offerInbox/r7"]);

// 6) Una petición que no está «pending» no se atiende.
const before = log.updates.length;
send(observers.inbox, snapOf([{ id: "r5", data: { ...request("r5").data, status: "processing" } }]));
await tick(10);
eq("una petición ya en «processing» no se atiende", log.updates.length, before);

stopOutlookListener();
globalThis.setTimeout = realSetTimeout;
done("Buzón de Outlook · listener resistente");
