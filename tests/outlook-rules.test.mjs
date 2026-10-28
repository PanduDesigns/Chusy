// Buzón de Outlook (v80) — las reglas de Firestore del buzón `offerInbox` frente a lo que manda la macro REAL.
// No hay emulador de Firestore en el sandbox: las dos funciones de reglas (validOutlookCreate, isOutlookRecipient)
// se EXTRAEN de firestore.rules, se traducen a JS (solo las construcciones que usan) y se ejecutan con
// peticiones de prueba. Si alguien escribe en esas funciones algo que la traducción no entiende, la prueba
// falla en vez de pasar en falso.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, eq, done } from "./support/assert.mjs";
import { normalizeEmail, outlookEmailFor, OUTLOOK_NAME_MAX } from "../js/outlook-offer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
// La macro está en ANSI (Windows-1252), como la espera el editor de VBA: se lee como latin1.
const bas = fs.readFileSync(path.join(root, "assets/outlook/CrearCarpetaProyecto.bas"), "latin1");

// ---------------------------------------------------------------- extraer y traducir
function extractFunction(name) {
  const start = rules.indexOf(`function ${name}() {`);
  if (start < 0) return null;
  const open = rules.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    else if (rules[i] === "}" && --depth === 0) break;
  }
  return rules.slice(open + 1, i).replace(/\/\/.*$/gm, "").trim();
}

// Los tipos de las reglas sobre valores de JS: size(), lower(), «is string», «is timestamp».
const T = Symbol("timestamp");
String.prototype.size = function () { return this.length; };
String.prototype.lower = function () { return this.toLowerCase(); };
const mapOf = (obj) => {
  const m = { ...obj };
  Object.defineProperty(m, "keys", { enumerable: false, value: () => ({
    hasAll: (list) => list.every((k) => k in obj),
    hasOnly: (list) => Object.keys(obj).every((k) => list.includes(k)),
  }) });
  Object.defineProperty(m, "get", { enumerable: false, value: (k, def) => (k in obj ? obj[k] : def) });
  return m;
};
const isTs = (v) => v && v[T] === true;

function compile(body, vars) {
  let js = body.replace(/^return\s+/, "").replace(/;\s*$/, "");
  js = js
    .replace(/get\(\/databases\/\$\(database\)\/documents\/meta\/outlookBridge\)\.data\.key/g, "BRIDGE_KEY")
    .replace(/request\.resource\.data/g, "D")
    .replace(/request\.auth\.token/g, "TOKEN")
    .replace(/resource\.data/g, "RES")
    .replace(/isActiveUser\(\)/g, "ACTIVE")
    .replace(/((?:D|RES)\.get\('\w+', ''\)|(?:D|RES)\.\w+) is string/g, "(typeof $1 === 'string')")
    .replace(/((?:D|RES)\.get\('\w+', ''\)|(?:D|RES)\.\w+) is timestamp/g, "isTs($1)")
    .replace(/D\.keys\(\)/g, "D.keys()");
  // Lo que quede sin traducir (p. ej. `request.time` o una función desconocida) debe hacer fallar la prueba.
  if (/request\.|resource\.|\bis\s+\w+/.test(js.replace(/RES|TOKEN/g, ""))) throw new Error("Construcción de las reglas sin traducir: " + js.slice(0, 200));
  return new Function(...Object.keys(vars), "isTs", `return (${js});`);
}

const createSrc = extractFunction("validOutlookCreate");
const recipientSrc = extractFunction("isOutlookRecipient");
check("firestore.rules tiene validOutlookCreate()", !!createSrc);
check("firestore.rules tiene isOutlookRecipient()", !!recipientSrc);
check("el buzón sigue llamándose offerInbox (las macros instaladas lo usan)", /match \/offerInbox\/\{requestId\}/.test(rules) && !/match \/outlookInbox/.test(rules));
check("create usa validOutlookCreate() y list/update usan isOutlookRecipient()",
  /allow create: if validOutlookCreate\(\);/.test(rules) && /allow list: if isOutlookRecipient\(\);/.test(rules) && /allow update: if isOutlookRecipient\(\)/.test(rules));
check("create NO compara nada con request.time (el reloj del PC de quien lanza la macro puede ir desfasado)", !/request\.time/.test(createSrc));

const KEY = "clave-compartida-32caracteres-xxxx";
const create = (data) => compile(createSrc, { D: 0, BRIDGE_KEY: 0 }).call(null, mapOf(data), KEY, isTs);
const recipient = (doc, email, active = true) => compile(recipientSrc, { RES: 0, TOKEN: 0, ACTIVE: 0 }).call(null, mapOf(doc), email === null ? {} : { email }, active, isTs);

// ---------------------------------------------------------------- lo que manda la macro REAL
const vbaFields = [...bas.matchAll(/CampoTexto\("(\w+)"/g)].map((m) => m[1]);
eq("la macro manda exactamente estos 7 campos", vbaFields.sort(), ["commercial", "description", "key", "location", "name", "status", "targetEmail"]);
check("el .bas del paquete va SIN la clave compartida (assets/ se publica con la web; la clave la pone cada admin)", /Private Const CHUSY_CLAVE As String = ""/.test(bas));
check("el nombre se recorta en la macro a 300 y la descripción a 30000, dentro de lo que admiten las reglas", /RecortarTexto\(proyecto, 300\)/.test(bas) && /CHUSY_MAX_DESCRIPCION As Long = 30000/.test(bas));
check("la macro hace POST a la colección offerInbox (no a otra)", /documents\/offerInbox"/.test(bas) && !/outlookInbox/.test(bas));
check("la macro baja el correo del destinatario a minúsculas (LCase$)", /CorreoDelUsuario = LCase\$\(Trim\$\(direccion\)\)/.test(bas));
check("la macro no manda createdAt ni otros campos: solo los 7 de siempre", !/createdAt|timestampValue/.test(bas));
const fromMacro = {
  key: KEY, targetEmail: "ramon@martech.com", name: "BAUSONN FOOD TRUCKS", location: "\\\\NASMARTECH\\PLANOS 2026\\BAUSONN",
  commercial: "Gabi", description: "Texto del correo", status: "pending",
};
check("la petición que monta la macro se acepta", create(fromMacro) === true);
check("… con los opcionales vacíos (\"\")", create({ ...fromMacro, location: "", commercial: "", description: "" }) === true);
check("… con una clave que no es la del puente → rechazada", create({ ...fromMacro, key: "otra" }) === false);
check("… sin nombre → rechazada (la oferta no tendría título)", create({ ...fromMacro, name: "" }) === false);
check("… con status distinto de pending → rechazada", create({ ...fromMacro, status: "created" }) === false);
check("… con el correo en mayúsculas → rechazada (la macro siempre manda LCase$)", create({ ...fromMacro, targetEmail: "Ramon@Martech.com" }) === false);
check("… con un campo desconocido → rechazada", create({ ...fromMacro, extra: "x" }) === false);
check("… sin la clave → rechazada", create((({ key, ...r }) => r)(fromMacro)) === false);

// ---------------------------------------------------------------- tolerancia (lo que pedía el parte de producción)
const withExtras = { ...fromMacro, createdAt: new (class { constructor() { this[T] = true; } })(), subject: "", localPath: "", entryId: "", senderName: "", senderEmail: "", receivedAt: "" };
check("createdAt como timestamp (con la hora del PC, sea cual sea) y opcionales vacíos → aceptada", create(withExtras) === true);
check("createdAt como texto → aceptada", create({ ...withExtras, createdAt: "2020-01-01T00:00:00Z" }) === true);
check("createdAt de otro tipo (número) → rechazada", create({ ...withExtras, createdAt: 5 }) === false);
check("subject de 1000 caracteres → aceptado; de 1001 → rechazado", create({ ...withExtras, subject: "a".repeat(1000) }) === true && create({ ...withExtras, subject: "a".repeat(1001) }) === false);
check("localPath de 2000 → aceptado; de 2001 → rechazado", create({ ...withExtras, localPath: "a".repeat(2000) }) === true && create({ ...withExtras, localPath: "a".repeat(2001) }) === false);
check("entryId de 1000 → aceptado; de 1001 → rechazado", create({ ...withExtras, entryId: "a".repeat(1000) }) === true && create({ ...withExtras, entryId: "a".repeat(1001) }) === false);
check("nombre hasta 1000 y ubicación hasta 2000 → aceptados", create({ ...fromMacro, name: "a".repeat(1000), location: "a".repeat(2000) }) === true);
check("nombre de 1001 → rechazado", create({ ...fromMacro, name: "a".repeat(1001) }) === false);
check("descripción de 100000 → aceptada; de 100001 → rechazada", create({ ...fromMacro, description: "a".repeat(100000) }) === true && create({ ...fromMacro, description: "a".repeat(100001) }) === false);
check("OUTLOOK_NAME_MAX (lo que Chusy recorta) cabe en lo que admiten las reglas", OUTLOOK_NAME_MAX <= 1000);

// ---------------------------------------------------------------- destinatario
check("el destinatario con el mismo correo → sí", recipient({ targetEmail: "ramon@martech.com" }, "ramon@martech.com") === true);
check("correo de la cuenta con MAYÚSCULAS → sí (se baja a minúsculas)", recipient({ targetEmail: "ramon@martech.com" }, "Ramon@Martech.COM") === true);
check("documento con mayúsculas y cuenta en minúsculas → sí (.lower() a los dos lados)", recipient({ targetEmail: "Ramon@Martech.com" }, "ramon@martech.com") === true);
check("otra persona → no", recipient({ targetEmail: "ana@martech.com" }, "ramon@martech.com") === false);
check("sin correo en la cuenta → no", recipient({ targetEmail: "ramon@martech.com" }, null) === false);
check("cuenta no activa → no", recipient({ targetEmail: "ramon@martech.com" }, "ramon@martech.com", false) === false);
check("las reglas bajan a minúsculas los DOS lados (.lower() en resource.data.targetEmail)", /resource\.data\.targetEmail\.lower\(\) == request\.auth\.token\.email\.lower\(\)/.test(recipientSrc));
check("y conservan la comparación de siempre (la que permite list con where('targetEmail','==',…))", /resource\.data\.targetEmail == request\.auth\.token\.email\.lower\(\)/.test(recipientSrc));

// ---------------------------------------------------------------- lo que NO se ha tocado
for (const marker of ["function isActiveUser()", "function isAdmin()", "match /projects/{projectId}", "match /tasks/{taskId}", "match /users/{userId}"]) {
  check(`firestore.rules conserva «${marker}»`, rules.includes(marker));
}
check("listar sigue sin abrirse y leer/borrar por id sigue como antes", /allow get: if true;/.test(rules) && /allow delete: if true;/.test(rules));

// ---------------------------------------------------------------- correo normalizado en JS
eq("normalizeEmail: espacios y mayúsculas", normalizeEmail("  Ramon@Martech.COM \n"), "ramon@martech.com");
eq("normalizeEmail: null/undefined", [normalizeEmail(null), normalizeEmail(undefined)], ["", ""]);
eq("outlookEmailFor: manda el de la sesión de Auth", outlookEmailFor({ email: "perfil@x.com" }, " Auth@X.com "), "auth@x.com");
eq("outlookEmailFor: sin sesión, el del perfil", outlookEmailFor({ email: " Perfil@X.com" }, ""), "perfil@x.com");
eq("outlookEmailFor: sin nada", outlookEmailFor(null, undefined), "");

done("Buzón de Outlook · reglas de Firestore y correo");
