// npm run test:unit — ejecuta todas las pruebas de tests/*.test.mjs (Node + jsdom, sin navegador ni
// Firebase reales: ver tests/support/hooks.mjs). Sale con código 1 si alguna falla.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--import", path.join(dir, "support", "register.mjs"), path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n✗ ${failed} de ${files.length} archivos de pruebas fallan` : `\n✓ ${files.length} archivos de pruebas correctos`);
process.exit(failed ? 1 : 0);
