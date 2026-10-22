// npm test — comprobaciones estáticas, sin navegador ni Firebase:
//  1) todo import relativo de js/ apunta a un archivo que existe;
//  2) todos los imports remotos son del SDK de Firebase y de UNA sola versión;
//  3) css/styles.css solo contiene @import, y cada módulo css/NN-*.css se importa una vez y existe;
//  4) toda ruta `assets/...` citada en js/ e index.html existe.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const errors = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const rel = (f) => path.relative(root, f).split(path.sep).join("/");

// --- 1 y 2: imports de JS
const jsFiles = walk(path.join(root, "js")).filter((f) => f.endsWith(".js"));
const importRe = /(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
const versions = new Set();
let relCount = 0, remoteCount = 0;
for (const f of jsFiles) {
  const code = fs.readFileSync(f, "utf8");
  for (const m of code.matchAll(importRe)) {
    const spec = m[1];
    if (spec.startsWith(".")) {
      relCount++;
      if (!fs.existsSync(path.resolve(path.dirname(f), spec))) errors.push(`${rel(f)}: import relativo roto → ${spec}`);
    } else if (/^https?:\/\//.test(spec)) {
      remoteCount++;
      const v = spec.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/([\d.]+)\/firebase-[a-z-]+\.js$/);
      if (!v) errors.push(`${rel(f)}: import remoto inesperado → ${spec}`); else versions.add(v[1]);
    } else errors.push(`${rel(f)}: import «${spec}» sin ruta relativa ni URL (Vite lo buscaría en node_modules)`);
  }
}
if (versions.size > 1) errors.push(`Firebase con varias versiones: ${[...versions].join(", ")}`);

// --- 3: CSS
const cssDir = path.join(root, "css");
const entry = fs.readFileSync(path.join(cssDir, "styles.css"), "utf8");
const noComments = entry.replace(/\/\*[\s\S]*?\*\//g, "");
const imports = [...noComments.matchAll(/@import\s+['"]\.\/([^'"]+)['"]\s*;/g)].map((m) => m[1]);
if (noComments.replace(/@import\s+['"][^'"]+['"]\s*;/g, "").trim()) errors.push("css/styles.css contiene algo más que @import (las reglas van en un módulo)");
for (const i of imports) if (!fs.existsSync(path.join(cssDir, i))) errors.push(`css/styles.css importa un módulo que no existe → ${i}`);
if (new Set(imports).size !== imports.length) errors.push("css/styles.css importa un módulo más de una vez");
for (const f of fs.readdirSync(cssDir)) if (f !== "styles.css" && f.endsWith(".css") && !imports.includes(f)) errors.push(`css/${f} existe pero no está en css/styles.css`);

// --- 4: rutas assets/
const refFiles = [...jsFiles, path.join(root, "index.html")];
let assetRefs = 0;
for (const f of refFiles) {
  const code = fs.readFileSync(f, "utf8");
  for (const m of code.matchAll(/["'`(=]\s*(assets\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/g)) {
    assetRefs++;
    if (!fs.existsSync(path.join(root, m[1]))) errors.push(`${rel(f)}: ruta inexistente → ${m[1]}`);
  }
}

console.log(`js: ${jsFiles.length} módulos, ${relCount} imports relativos, ${remoteCount} remotos (Firebase ${[...versions].join(", ") || "—"})`);
console.log(`css: ${imports.length} módulos importados por styles.css`);
console.log(`assets: ${assetRefs} referencias comprobadas`);
if (errors.length) { console.error("\nFALLOS:\n- " + errors.join("\n- ")); process.exit(1); }
console.log("OK: integridad correcta");
