// Gancho de carga de Node para las pruebas (sin navegador ni Firebase reales): los imports
// remotos del SDK de Firebase (https://www.gstatic.com/firebasejs/...) se sustituyen por un
// módulo falso en memoria con TODOS los nombres que js/ importa de él. El código de la app
// que se prueba es el real, sin tocar.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const names = new Set();
for (const f of walk(path.join(root, "js")).filter((x) => x.endsWith(".js"))) {
  const code = fs.readFileSync(f, "utf8");
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']https:\/\/www\.gstatic\.com[^"']+["']/g)) {
    m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => names.add(n));
  }
}
// Firestore falso con lo justo para que el código real de la app corra en Node:
//  · getDocs lee de globalThis.__fb.collections[nombre] = [{ id, data }]
//  · writeBatch().set(...) se anota en globalThis.__fb.sets = [{ ref, data }]
const OVERRIDES = `
const store = () => (globalThis.__fb = globalThis.__fb || { collections: {}, sets: [] });
let autoId = 0;
export const collection = (_db, path) => ({ __col: true, path });
export const doc = (a, ...rest) => (a && a.__col ? { id: "auto" + ++autoId, path: a.path } : { id: rest[rest.length - 1], path: rest.join("/") });
export const getDoc = async (...a) => { const h = hook("getDoc"); return h ? h(...a) : f(...a); };
export const getDocs = async (ref) => { const h = hook("getDocs"); if (h) return h(ref); const list = store().collections[ref.path] || []; return { docs: list, size: list.length, forEach: (cb) => list.forEach((d) => cb({ id: d.id, data: () => d.data })) }; };
export const writeBatch = () => ({ set: (ref, data) => store().sets.push({ ref, data }), update: (ref, fields) => (store().updates = store().updates || []).push({ ref, fields }), delete() {}, commit: async () => {} });
export const serverTimestamp = () => "TS";
// v82: también getDoc / getDocs / setDoc, y writeBatch().update se anota en globalThis.__fb.updates = [{ ref, fields }].
// Ganchos opcionales para pruebas que necesitan controlar Firestore (v80: buzón de Outlook): una prueba pone
// globalThis.__fb.hooks = { onSnapshot, runTransaction, updateDoc, deleteDoc }. Sin gancho, todo se comporta como siempre.
const hook = (name) => (store().hooks || {})[name];
export const onSnapshot = (...a) => { const h = hook("onSnapshot"); return h ? h(...a) : () => {}; };
export const runTransaction = (...a) => { const h = hook("runTransaction"); return h ? h(...a) : f(...a); };
export const updateDoc = (...a) => { const h = hook("updateDoc"); return h ? h(...a) : f(...a); };
export const deleteDoc = (...a) => { const h = hook("deleteDoc"); return h ? h(...a) : f(...a); };
export const addDoc = async () => ({ id: "auto" + ++autoId });
export const setDoc = async (...a) => { const h = hook("setDoc"); return h ? h(...a) : undefined; };
`;
const OVERRIDDEN = new Set(["collection", "doc", "getDocs", "writeBatch", "serverTimestamp", "onSnapshot", "addDoc", "setDoc", "getDoc", "runTransaction", "updateDoc", "deleteDoc"]);
const SRC = `const f = (...a) => ({ __stub: true, args: a });\n${OVERRIDES}\n` + [...names].filter((n) => !OVERRIDDEN.has(n)).map((n) => `export const ${n} = f;`).join("\n") + "\n";

export async function resolve(specifier, context, next) {
  if (/^https:\/\/www\.gstatic\.com\/firebasejs\//.test(specifier)) return { url: "stub:firebase", shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === "stub:firebase") return { format: "module", source: SRC, shortCircuit: true };
  return next(url, context);
}
