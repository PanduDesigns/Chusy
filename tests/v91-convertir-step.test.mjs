// v91 · El convertidor a .STP localiza el archivo que se sube (no la carpeta del proyecto) y trabaja como Exportar-IPT.ps1.
//  1) El enlace chusy-step:// y el comando de PowerShell llevan nombre, tamaño y fecha del archivo.
//  2) Chusy ya no manda la ubicación del proyecto (adjuntos, visor, vista y asistente).
//  3) convertir-step.ps1 (estático): patrón de Exportar-IPT.ps1, ventana visible, instalador con -STA, un solo archivo.
//  4) convertir-step.ps1 EJECUTADO con PowerShell (pwsh o powershell; se omite si no hay): búsqueda del archivo por nombre,
//     tamaño y fecha sobre ficheros reales y conversión con un Inventor simulado.
//  5) Entrega: ?v=91, package.json, Novedades, README y node scripts/check-integrity.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const cad = await import("../js/cad-viewer.js");

// ---------------------------------------------------------------- 1) enlace y comando
{
  const MS = 1794304800000;
  const u = cad.buildConvertStepProtocolUrl({ fileName: "Eje_26001.ipt", size: 48213, lastModified: MS });
  eq("enlace: nombre + tamaño + fecha, SIN carpeta del proyecto", u, `chusy-step://convert?file=Eje_26001.ipt&size=48213&modified=${MS}`);
  const q = new URL(u.replace("chusy-step://", "https://x/")).searchParams;
  eq("… se lee de vuelta", [q.get("file"), q.get("size"), q.get("modified"), q.get("searchRoot")], ["Eje_26001.ipt", "48213", String(MS), null]);
  eq("enlace: sin tamaño ni fecha, o con basura, no los pone", [cad.buildConvertStepProtocolUrl({ fileName: "a.ipt" }), cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", size: 0, lastModified: -5 }), cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", size: "x", lastModified: NaN })], ["chusy-step://convert?file=a.ipt", "chusy-step://convert?file=a.ipt", "chusy-step://convert?file=a.ipt"]);
  eq("enlace: el orden es file, size, modified y searchRoot (opcional)", cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", size: 5, lastModified: 7, projectLocation: "C:\\Proy" }), "chusy-step://convert?file=a.ipt&size=5&modified=7&searchRoot=C%3A%5CProy");
  eq("enlace: con la ruta completa no viajan tamaño ni fecha", cad.buildConvertStepProtocolUrl({ filePath: "C:\\P\\a.ipt", size: 5, lastModified: 7 }), "chusy-step://convert?file=C%3A%5CP%5Ca.ipt");
  eq("comando de PowerShell: -FileName -Size -Modified", cad.buildConvertStepPowerShellCommand({ fileName: "Eje_26001.ipt", size: 48213, lastModified: MS }), `& "$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1" -FileName 'Eje_26001.ipt' -Size 48213 -Modified ${MS}`);
  eq("comando: con -SearchRoot opcional al final", cad.buildConvertStepPowerShellCommand({ fileName: "a.ipt", size: 5, projectLocation: "C:\\Proy" }), `& "$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1" -FileName 'a.ipt' -Size 5 -SearchRoot 'C:\\Proy'`);
}

// ---------------------------------------------------------------- 2) Chusy ya no manda la ubicación del proyecto
{
  const fa = read("js/components/file-attachments.js"), tm = read("js/components/task-modal.js"), as = read("js/components/cad-upload-assistant.js");
  const vm = read("js/components/cad-viewer-modal.js"), pvv = read("js/views/parts-viewer-view.js");
  check("adjuntos, visor y vista de piezas ya no usan getLocation ni projectLocation", !/getLocation|projectLocation/.test(fa + vm + pvv + as) && !/currentFolderLocation/.test(tm));
  check("el asistente no pide ninguna carpeta y la conversión manda nombre, tamaño y fecha del File", !/data-cad="location"/.test(as) && /fileName: file\.name, size: file\.size, lastModified: file\.lastModified/.test(fa));
  check("el visor manda el tamaño del adjunto al convertir", /fileName: nativeName, size: nativeAtt\.size/.test(vm));
}

// ---------------------------------------------------------------- 3) el script (estático) y el instalador
const ps = read("assets/convertir-step/convertir-step.ps1");
{
  const code = ps.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  check("convertir-step.ps1: ASCII, CRLF y sin errores evidentes", /^[\x00-\x7F]*$/.test(ps) && !/[^\r]\n/.test(ps));
  check("… parámetros: -Url, -FilePath, -FileName, -SearchRoot, -Size, -Modified, -ResolveOnly", /\[string\]\$Url,/.test(ps) && /\[string\]\$FilePath,/.test(ps) && /\[string\]\$FileName,/.test(ps) && /\[string\]\$SearchRoot,/.test(ps) && /\[long\]\$Size = 0,/.test(ps) && /\[long\]\$Modified = 0,/.test(ps) && /\[switch\]\$ResolveOnly/.test(ps));
  check("… como Exportar-IPT.ps1: relanza en Windows PowerShell 5.1 con -STA", /'-STA'/.test(code) && /PSEdition -eq 'Desktop'/.test(code) && /ApartmentState -eq 'STA'/.test(code) && /WindowsPowerShell\\v1\.0\\powershell\.exe/.test(code));
  check("… abre con OpenWithOptions + SkipAllUnresolvedFiles (sin diálogos de referencias) y SIN ventana", /OpenWithOptions\(\$SourcePath, \$openOptions, \$false\)/.test(code) && /Add\('SkipAllUnresolvedFiles', \$true\)/.test(code) && !/Documents\.Open\(/.test(code));
  check("… SilentOperation y ScreenUpdating apagados y restaurados", /SilentOperation = \$true/.test(code) && /ScreenUpdating = \$false/.test(code) && /SilentOperation = \$previousSilent/.test(code) && /ScreenUpdating = \$previousScreen/.test(code));
  check("… llamadas COM directas (sin reflexión), traductor STEP, AP214 y contexto 13059", !/InvokeMember/.test(code) && /\$translator\.SaveCopyAs\(\$document, \$context, \$options, \$medium\)/.test(code) && /\$translator\.HasSaveCopyAsOptions/.test(code) && /ApplicationProtocolType'\) = 3/.test(code) && /\{90AF7F40-0C01-11D5-8E83-0010B541CD80\}/.test(code) && /Type = 13059/.test(code));
  check("… salida .stp (como Exportar-IPT.ps1) en la carpeta del original", /\$script:Extension = '\.stp'/.test(code) && /ChangeExtension\(\$SourcePath, \$script:Extension\)/.test(code));
  eq("… UN solo SaveCopyAs, UNA sola llamada a Convert-ToStep y NINGÚN bucle que convierta varios archivos", [(code.match(/\.SaveCopyAs\(/g) || []).length, (code.match(/= Convert-ToStep /g) || []).length, /foreach\s*\([^)]*\)\s*\{[^}]*Convert-ToStep/i.test(code) || /Get-ChildItem[^\n]*\|\s*(ForEach-Object|%)\s*\{[^}]*(SaveCopyAs|Convert-ToStep)/i.test(code) || /Get-ChildItem[^\n]*\*\.(ipt|iam)/i.test(code)], [1, 1, false]);
  check("… el archivo ya abierto por el diseñador no se cierra; el abierto por el script, sí y SIN guardar; Quit solo si lo abrió el script", /\$openedByUs = \$true/.test(code) && /if \(\$openedByUs -and \$null -ne \$document\)/.test(code) && /\$document\.Close\(\$true\)/.test(code) && /if \(\$startedInventor -and -not \$KeepInventorOpen/.test(code) && /ItemByName\(\$SourcePath\)/.test(code));
  check("… busca por nombre + tamaño + fecha, con archivos recientes de Windows e Inventor abierto, y ofrece elegir el archivo si no aparece", /function Test-SameFile/.test(code) && /Microsoft\\Windows\\Recent/.test(code) && /Get-InventorOpenPaths/.test(code) && /OpenFileDialog/.test(code) && /ModifiedToleranceMs = 3000/.test(code));
  check("… ningún paso puede dejar el script esperando: cada fuente corre en un hilo aparte con límite de tiempo (Invoke-Guarded), los recientes antes que Inventor", /function Invoke-Guarded/.test(code) && /RunspaceFactory/.test(code) && /WaitOne\(\$Seconds \* 1000\)/.test(code) && code.indexOf("Key = 'recent'") < code.indexOf("Key = 'inventor'") && code.indexOf("Key = 'memory'") < code.indexOf("Key = 'recent'") && /Sin respuesta tras \$Seconds s/.test(code));
  check("… escribe un paso de progreso por fuente, los permisos (normal/administrador) y 'Conectando con Inventor'", /Buscando en los archivos recientes/.test(code) && /Buscando entre los documentos abiertos en Inventor/.test(code) && /Permisos: \{0\}/.test(code) && /Conectando con Inventor/.test(code));
  check("… registra en %LOCALAPPDATA%\\Chusy\\convertir-step.log y se queda abierto con el motivo si falla", /convertir-step\.log/.test(code) && /Read-Host 'Pulsa Intro para cerrar'/.test(code));
  const bat = read("assets/convertir-step/Instalar-ConvertirStep.bat");
  check("Instalar-ConvertirStep.bat: comando con -STA y SIN ventana oculta", /powershell\.exe -NoProfile -STA -ExecutionPolicy Bypass -File/.test(bat) && !/WindowStyle Hidden/.test(bat) && /HKCU\\Software\\Classes\\chusy-step/.test(bat));
  const leeme = read("assets/convertir-step/LEEME.txt");
  check("LEEME.txt: explica que se localiza el archivo (no el proyecto), el .stp, la ventana, el registro y volver a instalar", /NOMBRE, su TAMANO y su FECHA/.test(leeme) && /\.stp/.test(leeme) && /convertir-step\.log/.test(leeme) && /ejecuta de nuevo Instalar-ConvertirStep\.bat/.test(leeme) && /SU MISMA carpeta/.test(leeme));
}

// ---------------------------------------------------------------- 4) el script EJECUTADO con PowerShell
{
  const candidates = ["pwsh", "/opt/pwsh/pwsh", "powershell"];
  let runner = null;
  for (const c of candidates) {
    const r = spawnSync(c, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (!r.error && r.status === 0) { runner = c; break; }
  }
  if (!runner) {
    console.log("  (pruebas con PowerShell omitidas: no hay `pwsh` ni `powershell`)");
  } else {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "chusy-step-"));
    const args = ["-NoProfile", ...(process.platform === "win32" ? ["-ExecutionPolicy", "Bypass"] : []), "-File", new URL("./fixtures/convertir-step.tests.ps1", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "-Script", new URL("../assets/convertir-step/convertir-step.ps1", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "-Work", work];
    const r = spawnSync(runner, args, { encoding: "utf8", timeout: 120000 });
    const lines = (r.stdout || "").split(/\r?\n/).filter((l) => /^(OK|FALLA)\|/.test(l));
    check(`PowerShell (${runner}) ejecuta las pruebas del script y devuelve resultados`, lines.length >= 25, (r.stdout || "") + (r.stderr || ""));
    lines.forEach((l) => { const [state, ...name] = l.split("|"); check(`PowerShell: ${name.join("|")}`, state === "OK"); });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 5) entrega
{
  const idx = read("index.html");
  eq("index.html: los 14 <link> con el mismo ?v=N (≥ 91; la entrega actual la fija v92-conversion-automatica.test.mjs)", new Set([...idx.matchAll(/css\/[\w-]+\.css\?v=(\d+)/g)].map((m) => m[1])).size + ":" + (idx.match(/css\/[\w-]+\.css\?v=\d+/g) || []).length, "1:14");
  check("index.html: ningún <link> se ha quedado en una versión anterior a la 91", [...idx.matchAll(/\.css\?v=(\d+)/g)].every((m) => Number(m[1]) >= 91));
  check("package.json y package-lock.json: versión ≥ 91", parseInt(JSON.parse(read("package.json")).version, 10) >= 91 && parseInt(JSON.parse(read("package-lock.json")).version, 10) >= 91);
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES.find((x) => x.id === 91);
  check("Novedades: entrada 91, mayor que la 90, sobre el ayudante .stp y el archivo que se sube", !!r && r.id > RELEASES.find((x) => x.id === 90).id && /\.stp|\.STP/i.test(r.title) && /Instalar-ConvertirStep\.bat/.test(JSON.stringify(r)) && /convertir-step\.log/.test(JSON.stringify(r)) && r.items.length >= 3, r.title);
  const readme = read("README.md");
  check("README: historial v90 → v91, el ayudante localiza el archivo y se vuelve a ejecutar el instalador", /v90 → v91 \(Chusy-91\.zip\)/.test(readme) && /Find-SourceFile/.test(readme) && /Instalar-ConvertirStep\.bat/.test(readme) && /v91-convertir-step/.test(readme));
  check("tests/run-all.mjs menciona la v91", /v91/.test(read("tests/run-all.mjs")));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v91 · Convertidor a .STP: localiza el archivo que se sube y trabaja como Exportar-IPT.ps1");
