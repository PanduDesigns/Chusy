// Mini arnés de aserciones: cuenta aciertos y fallos, y sale con código 1 si hay alguno.
let pass = 0, fail = 0;
export function check(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
}
export const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
export function done(label) {
  console.log(`${fail ? "✗" : "✓"} ${label}: ${pass} comprobaciones correctas${fail ? `, ${fail} FALLAN` : ""}`);
  if (fail) process.exit(1);
}
