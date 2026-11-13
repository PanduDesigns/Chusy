// v90 · Visor CAD 3D industrial, mediciones y «Visualizador de piezas».
//  1) Formatos CAD, referencias y emparejamiento .ipt/.iam ↔ .step/.stp.
//  2) Medidas puras: Punto a Punto y Cara a Cara (paralelas, inclinadas, perpendiculares, curvas), snap, caras coplanares.
//  3) El ayudante de Windows: enlace chusy-step://, comando de PowerShell y que convertir-step.ps1 convierte UN solo archivo.
//  4) Índice y buscador de piezas, y permisos por departamento.
//  5) Motor con STEP REALES (occt-import-js + Three.js de npm; se omite si no están instalados): caras B-Rep, espesor 3,00 mm.
//  6) Interfaz con jsdom: visor 3D (renderer falso), estado «falta el STEP», asistente de subida, 👁️ en adjuntos, barra lateral,
//     modal de accesos y vista «Visualizador de piezas».
//  7) Entrega: ?v=90, package.json, Novedades, reglas, CSS, README y node scripts/check-integrity.mjs.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { check, eq, done } from "./support/assert.mjs";
import { setupDom, tick } from "./support/dom.mjs";

setupDom();
// jsdom no trae requestAnimationFrame como global: el bucle del visor lo necesita (en un navegador existe)
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 5);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const readBin = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const typeInto = (el, value) => { el.value = value; fire(el, "input"); };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
globalThis.__fb = { collections: {}, sets: [], hooks: {} };

const cad = await import("../js/cad-viewer.js");
const pv = await import("../js/parts-viewer.js");
const dep = await import("../js/departments.js");

// ---------------------------------------------------------------- 1) formatos y emparejamiento
{
  eq("CAD_EXTENSIONS", cad.CAD_EXTENSIONS, ["step", "stp", "ipt", "iam"]);
  eq("getCadExtension: los cuatro formatos, sin distinguir mayúsculas", ["a.STEP", "b.Stp", "c.IPT", "d.iam", "e.pdf", "f", "", null, "g.step.bak"].map(cad.getCadExtension), ["step", "stp", "ipt", "iam", null, null, null, null, null]);
  eq("isCadFileName", ["x.ipt", "x.stp", "x.dwg", "x"].map(cad.isCadFileName), [true, true, false, false]);
  eq("isDirect3dCadFile: solo .step y .stp", ["x.step", "x.STP", "x.ipt", "x.iam"].map(cad.isDirect3dCadFile), [true, true, false, false]);
  eq("isInventorNativeFile: solo .ipt y .iam", ["x.step", "x.stp", "x.IPT", "x.iam"].map(cad.isInventorNativeFile), [false, false, true, true]);
  eq("getCadBaseReference: sin extensión, trim y sin distinguir mayúsculas", ["Soporte_26001.ipt", "  soporte_26001.STEP ", "SOPORTE_26001.stp", "C:\\x\\Soporte_26001.iam", "Soporte  26001.ipt"].map(cad.getCadBaseReference), ["soporte_26001", "soporte_26001", "soporte_26001", "soporte_26001", "soporte 26001"]);
  eq("getCadBaseReference: «Pieza.ipt.stp» (script de exportación sin renombrar) se empareja con «Pieza.ipt»", [cad.getCadBaseReference("Pieza.ipt.stp"), cad.getCadBaseReference("Pieza.ipt")], ["pieza", "pieza"]);
  eq("getCadBaseReference: nombre vacío o ajeno", [cad.getCadBaseReference(""), cad.getCadBaseReference(null), cad.getCadBaseReference("plano.pdf")], ["", "", "plano.pdf"]);
  eq("getCadDisplayName conserva las mayúsculas", cad.getCadDisplayName("Soporte_26001.IPT"), "Soporte_26001");

  const pool = [
    { id: "s-otra", name: "Soporte_26001.step", taskId: "T2", projectId: "P1", uploadedAt: "2026-11-01T10:00:00Z" },
    { id: "s-misma", name: "soporte_26001.STP", taskId: "T1", projectId: "P1", uploadedAt: "2026-10-01T10:00:00Z" },
    { id: "s-ajena", name: "Soporte_26001.step", taskId: "T9", projectId: "P9" },
    { id: "otro", name: "Eje_26001.step", taskId: "T1", projectId: "P1" },
    { id: "nativo", name: "Soporte_26001.ipt", taskId: "T1", projectId: "P1" },
  ];
  const ipt = { id: "n1", name: "Soporte_26001.ipt", taskId: "T1", projectId: "P1" };
  eq("findCompanionStepAttachment: primero el de la MISMA tarea (aunque el de otra sea más nuevo)", (cad.findCompanionStepAttachment(ipt, pool) || {}).id, "s-misma");
  eq("… luego el del mismo proyecto", (cad.findCompanionStepAttachment(ipt, pool.filter((a) => a.id !== "s-misma")) || {}).id, "s-otra");
  eq("… y nunca el de otro proyecto", cad.findCompanionStepAttachment(ipt, [pool[2]]), null);
  eq("… ni uno con otra referencia ni un .ipt como gemelo", cad.findCompanionStepAttachment(ipt, [pool[3], pool[4]]), null);
  eq("… sirve también un .iam", (cad.findCompanionStepAttachment({ name: "Conjunto.iam" }, [{ id: "c", name: "CONJUNTO.step" }]) || {}).id, "c");
  eq("… un .step o un archivo que no es CAD no tiene gemelo", [cad.findCompanionStepAttachment({ name: "a.step" }, [{ name: "a.stp" }]), cad.findCompanionStepAttachment({ name: "a.pdf" }, [{ name: "a.step" }]), cad.findCompanionStepAttachment(null, pool), cad.findCompanionStepAttachment(ipt, null)], [null, null, null, null]);
  eq("… sin datos de procedencia vale cualquiera del pool; entre .step y .stp, el .step", (cad.findCompanionStepAttachment({ name: "x.ipt" }, [{ id: "1", name: "x.stp" }, { id: "2", name: "x.step" }]) || {}).id, "2");
  eq("… el mismo adjunto no es su propio gemelo", cad.findCompanionStepAttachment({ id: "q", name: "x.ipt" }, [{ id: "q", name: "x.stp" }]), null);

  const f = (name) => ({ name });
  let r = cad.partitionUploadBatch([f("Eje.ipt"), f("Eje.step"), f("Brida.IAM"), f("plano.pdf")], []);
  eq("partitionUploadBatch: el .ipt con su .step en el lote sube ya; el .iam sin gemelo espera", [r.ready.map((x) => x.name), r.needsStep.map((x) => x.name)], [["Eje.ipt", "Eje.step", "plano.pdf"], ["Brida.IAM"]]);
  r = cad.partitionUploadBatch([f("Eje.ipt")], [{ name: "EJE.stp" }]);
  eq("… un .stp que la tarea ya tiene también cuenta", [r.ready.length, r.needsStep.length], [1, 0]);
  r = cad.partitionUploadBatch([f("a.ipt"), f("b.iam")], [{ name: "a.ipt" }]);
  eq("… un .ipt ya adjunto NO vale de gemelo de otro", r.needsStep.map((x) => x.name), ["a.ipt", "b.iam"]);
  eq("… lote vacío", cad.partitionUploadBatch(null, null), { ready: [], needsStep: [] });
}

// ---------------------------------------------------------------- 2) medidas puras
const square = (z, size = 10) => [0, 0, z, size, 0, z, size, size, z, 0, 0, z, size, size, z, 0, size, z]; // cuadrado en el plano z (2 triángulos)
{
  const p2p = cad.computePointToPointMeasurement([0, 0, 0], [3, 4, 12]);
  eq("Punto a Punto: distancia euclídea y deltas (mm)", p2p, { distanceMm: 13, deltaX: 3, deltaY: 4, deltaZ: 12 });
  eq("Punto a Punto: con objetos {x,y,z}, con signo y a 2 decimales", cad.computePointToPointMeasurement({ x: 1, y: 1, z: 1 }, { x: 0, y: 0.5, z: 1 + 1 / 3 }), { distanceMm: 1.17, deltaX: -1, deltaY: -0.5, deltaZ: 0.33 });
  eq("Punto a Punto: puntos iguales y sin «-0»", cad.computePointToPointMeasurement([1, 2, 3], [1, 2, 3]), { distanceMm: 0, deltaX: 0, deltaY: 0, deltaZ: 0 });
  let threw = 0;
  [[null, [0, 0, 0]], [[0, 0], [1, 1, 1]], [[NaN, 0, 0], [0, 0, 0]], ["a", "b"]].forEach(([a, b]) => { try { cad.computePointToPointMeasurement(a, b); } catch (e) { if (e instanceof TypeError) threw++; } });
  eq("Punto a Punto: entradas no válidas lanzan TypeError", threw, 4);
  eq("round2", [cad.round2(1.005), cad.round2(-1.005), cad.round2(2.5), cad.round2(-0.001), cad.round2("x")], [1.01, -1.01, 2.5, 0, 0]);

  // Dos caras paralelas separadas 3 mm (espesor de chapa), la segunda desplazada de lado
  const A = cad.buildFaceDescriptor(square(0), { faceId: 1 });
  const B = cad.buildFaceDescriptor(square(3), { faceId: 2 });
  check("buildFaceDescriptor: 4 vértices únicos, 2 triángulos, área 100, centroide, normal y plana", A.vertices.length === 4 && A.triangles.length === 2 && near(A.area, 100) && A.centroid.every((v, i) => near(v, [5, 5, 0][i])) && A.normal.every((v, i) => near(v, [0, 0, 1][i])) && A.isPlanar && A.faceId === 1, A);
  let m = cad.computeFaceToFaceMeasurement(A, B);
  check("Cara a Cara paralelas: espesor 3 mm, mínima 3, primaria 3, 0°", m.isParallel === true && m.normalDistanceMm === 3 && m.minDistanceMm === 3 && m.primaryDistanceMm === 3 && m.angleDeg === 0, m);
  check("… la línea de cota va en perpendicular de una cara a la otra", near(cad.computePointToPointMeasurement(m.lineStart, m.lineEnd).distanceMm, 3) && near(m.lineStart[2], 0) && near(m.lineEnd[2], 3), m);
  eq("… y el rango del ángulo es 0°–90°", m.angleRangeDeg, [0, 90]);
  const B2 = cad.buildFaceDescriptor(square(3).map((v, i) => (i % 3 === 0 ? v + 100 : v))); // desplazada 100 mm de lado
  m = cad.computeFaceToFaceMeasurement(A, B2);
  check("paralelas desplazadas de lado: la distancia normal sigue siendo 3 y la mínima real es la diagonal (no la de dos vértices cualesquiera)", m.normalDistanceMm === 3 && m.isParallel && near(m.minDistanceMm, Math.hypot(90, 3), 0.01) && m.primaryDistanceMm === 3, m);
  // una vista de punto en medio de la cara, no en los vértices: B es un cuadrado grande (distancia mínima punto-triángulo)
  const big = cad.buildFaceDescriptor(square(3, 100).map((v, i) => (i % 3 === 0 || i % 3 === 1 ? v - 45 : v)));
  m = cad.computeFaceToFaceMeasurement(A, big);
  check("… con una cara enorme encima, la mínima es 3 (el vértice cae DENTRO del triángulo de la otra cara, no en su vértice)", m.minDistanceMm === 3 && m.minPointA && m.minPointB, m);
  // perpendiculares sin tocarse: suelo z=0 (0..10) y pared x=20 (y 0..10, z 0..10)
  const wall = cad.buildFaceDescriptor([20, 0, 0, 20, 10, 0, 20, 10, 10, 20, 0, 0, 20, 10, 10, 20, 0, 10]);
  m = cad.computeFaceToFaceMeasurement(A, wall);
  check("perpendiculares: no paralelas, 90°, primaria = mínima = 10", m.isParallel === false && m.angleDeg === 90 && m.minDistanceMm === 10 && m.primaryDistanceMm === 10, m);
  check("… la línea de cota une los dos puntos más cercanos", near(cad.computePointToPointMeasurement(m.lineStart, m.lineEnd).distanceMm, 10) && near(m.lineEnd[0], 20), m);
  // inclinadas 30°: plano que sube desde la arista x=0 de la cara A
  const t = Math.PI / 6;
  const tilt = cad.buildFaceDescriptor([0, 0, 0, 0, 10, 0, 10 * Math.cos(t), 10, 10 * Math.sin(t), 0, 0, 0, 10 * Math.cos(t), 10, 10 * Math.sin(t), 10 * Math.cos(t), 0, 10 * Math.sin(t)]);
  m = cad.computeFaceToFaceMeasurement(A, tilt);
  check("inclinadas 30° que se tocan: no paralelas, ángulo 30, mínima 0", m.isParallel === false && m.angleDeg === 30 && m.minDistanceMm === 0 && m.primaryDistanceMm === 0, m);
  m = cad.computeFaceToFaceMeasurement(A, { ...B, normal: [0, 0, -1] });
  check("normales opuestas (0° y 180°) también son paralelas: el ángulo se da en 0°–90°", m.isParallel && m.angleDeg === 0 && m.normalDistanceMm === 3, m);
  const nearlyParallel = cad.computeFaceToFaceMeasurement({ vertices: [[0, 0, 0]], normal: [0, 0, 1], centroid: [0, 0, 0] }, { vertices: [[0, 0, 5]], normal: [Math.sin(0.09), 0, Math.cos(0.09)], centroid: [0, 0, 5] });
  check("|nA·nB| ≥ 0,995 (≈5,7°) cuenta como paralelas; con 5° de inclinación sí, con más no", nearlyParallel.isParallel === true && nearlyParallel.angleDeg > 5 && nearlyParallel.angleDeg < 5.3, nearlyParallel);
  m = cad.computeFaceToFaceMeasurement({ vertices: [[0, 0, 0]], normal: [0, 0, 1], centroid: [0, 0, 0] }, { vertices: [[0, 0, 5]], normal: [Math.sin(0.12), 0, Math.cos(0.12)], centroid: [0, 0, 5] });
  check("… 6,9° ya no lo son (y la primaria pasa a ser la mínima)", m.isParallel === false && m.primaryDistanceMm === m.minDistanceMm, m);
  m = cad.computeFaceToFaceMeasurement({ ...A, isPlanar: false }, B);
  check("una cara curva (isPlanar false) nunca se da por paralela", m.isParallel === false && m.primaryDistanceMm === m.minDistanceMm, m);
  const noTri = cad.computeFaceToFaceMeasurement({ vertices: [[0, 0, 0], [10, 0, 0]], normal: [0, 0, 1] }, { vertices: [[0, 0, 4], [10, 0, 4]], normal: [0, 0, 1] });
  check("sin triángulos ni centroide: se calcula con los vértices (centroide = media)", noTri.normalDistanceMm === 4 && noTri.minDistanceMm === 4 && noTri.isParallel, noTri);
  threw = 0;
  [[null, B], [A, { vertices: [], normal: [0, 0, 1] }], [{ vertices: [[0, 0, 0]], normal: [0, 0, 0] }, B]].forEach(([a, b]) => { try { cad.computeFaceToFaceMeasurement(a, b); } catch (e) { if (e instanceof TypeError) threw++; } });
  eq("Cara a Cara: caras no válidas lanzan TypeError", threw, 3);
  const cyl = cad.buildFaceDescriptor((() => { const out = []; const n = 16; for (let i = 0; i < n; i++) { const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI; const [x0, y0, x1, y1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)]; out.push(x0, y0, 0, x1, y1, 0, x1, y1, 5, x0, y0, 0, x1, y1, 5, x0, y0, 5); } return out; })());
  check("un cilindro cerrado: sin normal media útil → no plana, normal unitaria válida", cyl.isPlanar === false && near(Math.hypot(...cyl.normal), 1, 1e-9), cyl);
  eq("buildFaceDescriptor: lista vacía", [cad.buildFaceDescriptor([]).triangleCount, cad.buildFaceDescriptor(null).vertices.length], [0, 0]);

  // snap
  const tri = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  eq("snap: al vértice si está dentro del radio", cad.snapPointToTriangle([0.4, 0.3, 0], tri, 1), { point: [0, 0, 0], kind: "vertex" });
  eq("snap: a la arista si no hay vértice cerca pero sí arista", cad.snapPointToTriangle([5, 0.4, 0], tri, 1), { point: [5, 0, 0], kind: "edge" });
  eq("snap: el punto exacto si no hay nada dentro del radio", cad.snapPointToTriangle([3, 3, 0], tri, 1), { point: [3, 3, 0], kind: "surface" });
  eq("snap: sin radio no hay snap", cad.snapPointToTriangle([0.1, 0.1, 0], tri, 0).kind, "surface");
  eq("snap: la arista más corta de la hipotenusa también cuenta", cad.snapPointToTriangle([5.2, 5.2, 0], tri, 0.5).kind, "edge");
  check("closestPointOnTriangle: dentro, en arista, en vértice", cad.closestPointOnTriangle([2, 2, 5], ...tri).every((v, i) => near(v, [2, 2, 0][i])) && cad.closestPointOnTriangle([-3, -3, 0], ...tri).every((v) => near(v, 0)) && cad.closestPointOnTriangle([5, -2, 0], ...tri).every((v, i) => near(v, [5, 0, 0][i])));

  // caras coplanares cuando el STEP no trae B-Rep: un cubo de 12 triángulos = 6 caras
  const cube = { positions: [], indices: [] };
  [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].forEach((p) => cube.positions.push(...p.map((v) => v * 10)));
  [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].forEach((t) => cube.indices.push(...t));
  const faces = cad.groupCoplanarTriangles(cube.positions, cube.indices);
  check("groupCoplanarTriangles: un cubo de 12 triángulos son 6 caras de 2 triángulos", faces.length === 6 && faces.every((g) => g.length === 2) && faces.flat().length === 12, faces);
  const flat = cad.groupCoplanarTriangles([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0, 2, 1, 1], [0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2, 4, 6, 5]);
  check("… triángulos contiguos en el mismo plano se unen (4 en z=0) y el que cambia de plano queda aparte", flat.length === 2 && flat.map((g) => g.length).sort().join() === "1,4", flat);
  eq("… sin malla, sin caras", cad.groupCoplanarTriangles([], []), []);

  // vistas, encuadre, rejilla y textos
  eq("cadViewDirection (eje Y vertical, el de Inventor): frontal desde +Z, planta desde +Y, perfil desde +X", ["front", "top", "side"].map((v) => cad.cadViewDirection(v, "y")), [[0, 0, 1], [0, 1, 0], [1, 0, 0]]);
  eq("cadViewDirection (eje Z vertical): frontal desde −Y, planta desde +Z", ["front", "top", "side"].map((v) => cad.cadViewDirection(v, "z")), [[0, -1, 0], [0, 0, 1], [1, 0, 0]]);
  check("cadViewDirection: la isométrica es unitaria y una vista desconocida cae a ella", near(Math.hypot(...cad.cadViewDirection("iso", "y")), 1) && JSON.stringify(cad.cadViewDirection("zzz")) === JSON.stringify(cad.cadViewDirection("iso")));
  eq("cadUpVector", [cad.cadUpVector("y"), cad.cadUpVector("z"), cad.cadUpVector()], [[0, 1, 0], [0, 0, 1], [0, 1, 0]]);
  eq("CAD_VIEW_LABELS: los nombres de los botones", cad.CAD_VIEW_LABELS, { iso: "Isométrica", front: "Frontal", top: "Planta", side: "Perfil" });
  const d1 = cad.computeFitDistance(100, 40, 1), d2 = cad.computeFitDistance(100, 40, 0.5), d3 = cad.computeFitDistance(200, 40, 1);
  check("computeFitDistance: más lejos con una pantalla estrecha o una pieza mayor; la esfera cabe", d2 > d1 && near(d3, d1 * 2, 1e-6) && d1 > 100 && Number.isFinite(cad.computeFitDistance(NaN, NaN, NaN)));
  const g = cad.computeGridSpec(100);
  check("computeGridSpec: paso redondo (1·2·5 × 10ⁿ), unas 20 casillas y más ancha que la pieza", [1, 2, 5].includes(Number((g.step / Math.pow(10, Math.floor(Math.log10(g.step)))).toFixed(6))) && g.size >= 100 && g.divisions >= 10 && g.divisions <= 40 && near(g.size, g.step * g.divisions), g);
  check("computeGridSpec: valores raros no rompen", [0, -5, NaN, 1e6].every((v) => cad.computeGridSpec(v).divisions >= 2));
  eq("formatBoundingBoxMm: las cotas envolventes en mm", cad.formatBoundingBoxMm([120.5, 45, 3]), "X: 120.50 mm × Y: 45.00 mm × Z: 3.00 mm");
  eq("formatBoundingBoxMm: también con {x,y,z}", cad.formatBoundingBoxMm({ x: 1, y: 2, z: 3 }), "X: 1.00 mm × Y: 2.00 mm × Z: 3.00 mm");
  eq("describePointToPoint", cad.describePointToPoint({ distanceMm: 12.345 }), "Punto a Punto: 12.35 mm");
  eq("describeFaceToFace: paralelas", cad.describeFaceToFace({ primaryDistanceMm: 3, isParallel: true, angleDeg: 0 }), { label: "Cara a Cara: 3.00 mm", angle: "Paralelas · 0.0°" });
  eq("describeFaceToFace: inclinadas", cad.describeFaceToFace({ primaryDistanceMm: 7.5, isParallel: false, angleDeg: 35 }), { label: "Cara a Cara: 7.50 mm", angle: "Inclinadas · 35.0°" });
}

// ---------------------------------------------------------------- 3) el ayudante de Windows
{
  const NAS = "\\\\NASMARTECH\\Spanesi\\OFICINA TECNICA\\26001 - Cabina Talgo";
  const u = cad.buildConvertStepProtocolUrl({ fileName: "Eje_26001.ipt", projectLocation: NAS });
  eq("buildConvertStepProtocolUrl: nombre + carpeta del proyecto", u, `chusy-step://convert?file=Eje_26001.ipt&searchRoot=${encodeURIComponent(NAS)}`);
  const url = new URL(u.replace("chusy-step://", "https://x/"));
  eq("… se decodifica al revés sin pérdida (espacios, barras invertidas)", [url.searchParams.get("file"), url.searchParams.get("searchRoot")], ["Eje_26001.ipt", NAS]);
  eq("… con la ruta completa solo va `file`", cad.buildConvertStepProtocolUrl({ filePath: "C:\\Proy\\Eje 1.iam", fileName: "otro.ipt", projectLocation: NAS }), `chusy-step://convert?file=${encodeURIComponent("C:\\Proy\\Eje 1.iam")}`);
  eq("… sin carpeta no hay searchRoot", cad.buildConvertStepProtocolUrl({ fileName: "a.ipt" }), "chusy-step://convert?file=a.ipt");
  eq("… la ubicación con comillas o `file:///` se limpia; una web no vale de carpeta", [cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", projectLocation: '"C:\\Proy\\Uno"' }), cad.buildConvertStepProtocolUrl({ fileName: "a.ipt", projectLocation: "https://x.com/a" })], ["chusy-step://convert?file=a.ipt&searchRoot=C%3A%5CProy%5CUno", "chusy-step://convert?file=a.ipt"]);
  eq("… un nombre con ruta se queda en el nombre", cad.buildConvertStepProtocolUrl({ fileName: "C:\\x\\y\\Eje.ipt" }), "chusy-step://convert?file=Eje.ipt");
  eq("… solo .ipt/.iam: un .step, un PDF, sin nada o con caracteres de control dan \"\"", [{ fileName: "a.step" }, { fileName: "a.pdf" }, {}, undefined, { filePath: "C:\\x\\a.stp" }, { fileName: "\n\t" }].map(cad.buildConvertStepProtocolUrl), ["", "", "", "", "", ""]);
  check("… caracteres como & # % en el nombre viajan codificados", /file=A%26B%20%2312%25\.ipt/.test(cad.buildConvertStepProtocolUrl({ fileName: "A&B #12%.ipt" })));

  const ps = cad.buildConvertStepPowerShellCommand({ fileName: "Eje_26001.ipt", projectLocation: NAS });
  eq("buildConvertStepPowerShellCommand: -FileName y -SearchRoot", ps, `& "$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1" -FileName 'Eje_26001.ipt' -SearchRoot '${NAS}'`);
  eq("… con ruta completa: -FilePath", cad.buildConvertStepPowerShellCommand({ filePath: "C:\\P\\Eje.iam" }), `& "$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1" -FilePath 'C:\\P\\Eje.iam'`);
  eq("… las comillas simples (también las tipográficas) se duplican", cad.buildConvertStepPowerShellCommand({ fileName: "O'Neil’s.ipt" }), `& "$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1" -FileName 'O''Neil’’s.ipt'`);
  check("… no se cuela ningún salto de línea ni `;` fuera de las comillas", !/\n/.test(cad.buildConvertStepPowerShellCommand({ fileName: "a.ipt\n; calc.exe", projectLocation: "C:\\x\n" })));
  eq("… sin .ipt/.iam válido da \"\"", [cad.buildConvertStepPowerShellCommand({ fileName: "a.step" }), cad.buildConvertStepPowerShellCommand()], ["", ""]);
  eq("CONVERT_STEP_PROTOCOL", cad.CONVERT_STEP_PROTOCOL, "chusy-step");

  // el script de PowerShell: convierte UN archivo
  const ps1 = read("assets/convertir-step/convertir-step.ps1");
  const code = ps1.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  check("convertir-step.ps1: acepta -FilePath, -FileName, -SearchRoot y la URL del protocolo", /param\(\[string\]\$Url, \[string\]\$FilePath, \[string\]\$FileName, \[string\]\$SearchRoot\)/.test(ps1) && /\^chusy-step:\/\{0,2\}/.test(ps1) && /'file'/.test(ps1) && /'searchroot'/.test(ps1));
  check("… valida la extensión .ipt/.iam y que el archivo exista", /Test-InventorFile/.test(code) && /'\.ipt'/.test(code) && /'\.iam'/.test(code) && /Test-Path -LiteralPath \$FilePath -PathType Leaf/.test(code));
  check("… con -FileName busca ÚNICAMENTE ese nombre exacto (filtro por nombre + comparación exacta, sin comodines)", /Get-ChildItem -LiteralPath \$root -Recurse -File -Filter \$name/.test(code) && /\$_\.Name -ieq \$name/.test(code) && !/Filter\s+['"]?\*/.test(code) && !/\*\.(ipt|iam)/i.test(ps1) && !/-Include/.test(code));
  eq("… hay UNA sola llamada a Get-ChildItem y UNA sola exportación (SaveCopyAs): nada de bucles sobre la carpeta", [(code.match(/Get-ChildItem/g) || []).length, (code.match(/'SaveCopyAs'/g) || []).length], [1, 1]);
  check("… ningún bucle recorre los resultados de Get-ChildItem (ni foreach, ni ForEach-Object, ni %)", !/foreach\s*\([^)]*Get-ChildItem/i.test(code) && !/Get-ChildItem[^\n]*\|\s*(ForEach-Object|%)/i.test(code) && !/\$found\s*\|\s*(ForEach-Object|%)/i.test(code) && !/foreach\s*\(\$\w+\s+in\s+\$found\)/i.test(code));
  check("… si hay 0 o varios archivos con ese nombre no convierte ninguno", /\$found\.Count -eq 0/.test(code) && /\$found\.Count -gt 1/.test(code) && /exit 1/.test(code));
  check("… no mira las copias OldVersions de Inventor", /OldVersions/.test(code));
  check("… usa Inventor activo (GetActiveObject) o crea el suyo (COM) y lo cierra si lo creó", /GetActiveObject\('Inventor\.Application'\)/.test(code) && /New-Object -ComObject 'Inventor\.Application'/.test(code) && /\$createdInventor/.test(code) && /\$inventor\.Quit\(\)/.test(code));
  check("… traductor STEP {90AF7F40-0C01-11D5-8E83-0010B541CD80}, protocolo AP214 (3) y SaveCopyAs", /\{90AF7F40-0C01-11D5-8E83-0010B541CD80\}/.test(code) && /\$apProtocolAP214 = 3/.test(code) && /ApplicationProtocolType/.test(code));
  check("… exporta <MismoNombre>.step en la MISMA carpeta del archivo", /Split-Path -Path \$source -Parent/.test(code) && /GetFileNameWithoutExtension\(\$source\) \+ '\.step'/.test(code));
  check("… si ya estaba abierto en Inventor lo deja abierto; si no, lo cierra SIN guardar", /\$openedByUs/.test(code) && /\$document\.Close\(\$true\)/.test(code) && /FullFileName -ieq \$source/.test(code));
  check("… abre el Explorador con el .step seleccionado", /explorer\.exe/.test(code) && /\/select,/.test(code));
  check("… el texto del script es ASCII (PowerShell 5 rompe las tildes sin BOM)", /^[\x00-\x7F]*$/.test(ps1));
  const bat = read("assets/convertir-step/Instalar-ConvertirStep.bat"), unbat = read("assets/convertir-step/Desinstalar-ConvertirStep.bat"), leeme = read("assets/convertir-step/LEEME.txt");
  check("Instalar-ConvertirStep.bat: registra HKCU\\Software\\Classes\\chusy-step (sin administrador) y copia el script", /HKCU\\Software\\Classes\\chusy-step/.test(bat) && /URL Protocol/.test(bat) && /convertir-step\.ps1/.test(bat) && /shell\\open\\command/.test(bat) && !/HKLM|HKEY_LOCAL_MACHINE/i.test(bat));
  check("Desinstalar-ConvertirStep.bat: limpia la clave y el script", /reg delete "HKCU\\Software\\Classes\\chusy-step"/.test(unbat) && /convertir-step\.ps1/.test(unbat));
  check("LEEME.txt en español: instalar, regla de un solo archivo, E_FAIL y desinstalar", /Instalar-ConvertirStep\.bat/.test(leeme) && /SOLO el archivo/.test(leeme) && /E_FAIL/.test(leeme) && /Desinstalar-ConvertirStep\.bat/.test(leeme) && /chusy-step/.test(leeme));
  check("los 4 archivos del ayudante terminan las líneas en CRLF, como los de abrir-ubicacion", ["convertir-step.ps1", "Instalar-ConvertirStep.bat", "Desinstalar-ConvertirStep.bat", "LEEME.txt"].every((f) => !/[^\r]\n/.test(read(`assets/convertir-step/${f}`))));
}

// ---------------------------------------------------------------- 4) índice, buscador y permisos
const projects = [
  { id: "P1", name: "Cabina Talgo", code: "26001", color: "#FCD000", properties: { comercial: "Juan Pérez", sector: "Industria" } },
  { id: "P2", name: "Línea Togg", code: "26002", color: "#3b82f6", properties: { comercial: "Marta Ruiz", sector: "Automoción" } },
  { id: "PX", name: "Archivado", code: "25009", archived: true },
  { id: "OFF", name: "Ofertas", exclusive: true },
];
const att = (id, name, extra = {}) => ({ id, kind: "drive", driveId: `d-${id}`, name, size: 2048, uploadedAt: "2026-11-01T10:00:00Z", ...extra });
const tasks = [
  { id: "T1", title: "Diseñar **soporte**", projectId: "P1", attachments: [att("a1", "Soporte_26001.ipt"), att("a2", "Soporte_26001.step"), att("a3", "Plano.pdf"), att("a4", "Eje_26001.IPT", { uploadedAt: "2026-11-05T10:00:00Z" })] },
  { id: "T2", title: "Fabricar eje", projectId: "P1", isComplete: true, attachments: [att("b1", "eje_26001.stp", { uploadedAt: "2026-11-06T10:00:00Z" }), att("b2", "Brida.iam", { uploadedAt: "2026-10-01T10:00:00Z" })] },
  { id: "T3", title: "Chasis", projectId: "P2", attachments: [att("c1", "Chasis_26002.STEP"), { id: "c2", name: "Enlace.step", url: "https://x" }, { id: "c3", kind: "drive", driveId: "", name: "Roto.ipt" }] },
  { id: "T4", title: "En archivado", projectId: "PX", attachments: [att("d1", "Viejo.step")] },
  { id: "T5", title: "Oferta", projectId: "OFF", attachments: [att("e1", "Oferta.step")] },
  { id: "T6", title: "Papelera", projectId: "P1", deleted: true, attachments: [att("f1", "Borrada.step")] },
  { id: "T7", title: "Otro proyecto extra", projectId: "PX", extraProjectIds: ["P2"], attachments: [att("g1", "Extra.ipt")] },
  { id: "T1", title: "Duplicada", projectId: "P1", attachments: [att("h1", "Dup.step")] },
];
{
  const parts = pv.indexUploadedCadParts(tasks, projects);
  const byRef = (r, t) => parts.find((p) => p.baseReference === r && (!t || p.taskId === t));
  eq("índice: solo adjuntos CAD de Drive de tareas de proyectos activos, sin repetir tareas, sin Ofertas, archivados ni papelera", parts.map((p) => p.key).sort(), ["T1:eje_26001", "T1:soporte_26001", "T2:brida", "T2:eje_26001", "T3:chasis_26002", "T7:extra"]);
  const sop = byRef("soporte_26001");
  check("tarjeta única por tarea + referencia con el .ipt y su .step gemelo", sop.hasNative && sop.has3d && sop.nativeFiles.length === 1 && sop.stepFiles.length === 1 && sop.availability === "step" && sop.stepSource === "task" && sop.displayName === "Soporte_26001", sop);
  check("… con la tarea, el proyecto (código, sector, comercial) y el título sin marcas de negrita", sop.projectCode === "26001" && sop.sector === "industria" && sop.comercial === "Juan Pérez" && sop.taskTitle === "Diseñar soporte" && sop.projectId === "P1" && sop.taskId === "T1", sop);
  check("… los adjuntos llevan tarea y proyecto", sop.primaryStep.taskId === "T1" && sop.primaryStep.projectId === "P1" && sop.primaryNative.driveId === "d-a1");
  const ejeT1 = byRef("eje_26001", "T1");
  check("un .ipt sin STEP en su tarea lo encuentra en otra tarea del MISMO proyecto (como el 👁️) y lo dice", ejeT1.has3d && ejeT1.stepSource === "project" && ejeT1.stepTaskId === "T2" && ejeT1.primaryStep.id === "b1" && ejeT1.availability === "step", ejeT1);
  const ejeT2 = byRef("eje_26001", "T2");
  check("… y el .stp suelto de T2 tiene su propia tarjeta, solo con 3D", ejeT2.has3d && !ejeT2.hasNative && ejeT2.stepSource === "task");
  const brida = byRef("brida");
  check("un .iam sin gemelo: «Solo .IPT/.IAM», marcada como completada", !brida.has3d && brida.hasNative && brida.availability === "native" && brida.primaryStep === null && brida.isComplete === true, brida);
  check("un .ipt de OTRO proyecto no coge el STEP de este", byRef("extra").has3d === false);
  check("el proyecto principal activo decide: una tarea de un proyecto archivado con otro activo cuenta en el activo", byRef("extra").projectId === "P2");
  eq("orden por defecto: lo subido más tarde primero", parts.map((p) => p.baseReference).slice(0, 3), ["eje_26001", "eje_26001", "chasis_26002"]);
  eq("índice vacío o con basura", [pv.indexUploadedCadParts(null, null), pv.indexUploadedCadParts([null, {}, { id: "x" }], projects)], [[], []]);

  const f = (o) => pv.filterCadPartsCatalog(parts, o).map((p) => p.key);
  eq("buscador: sin filtros devuelve todo", f({}).length, parts.length);
  eq("buscador: por referencia (parcial, sin distinguir mayúsculas); también mira el título de la tarea, así que sus hermanas de tarea salen igual", f({ search: "SOPORTE" }).sort(), ["T1:eje_26001", "T1:soporte_26001"]);
  eq("buscador: por referencia más específica", f({ search: "soporte_26001" }), ["T1:soporte_26001"]);
  eq("buscador: por código de proyecto «26001»", f({ search: "26001" }).sort(), ["T1:eje_26001", "T1:soporte_26001", "T2:brida", "T2:eje_26001"]);
  eq("buscador: por código sin guiones («26-001» = «26001»)", f({ search: "26-001" }).length, 4);
  eq("buscador: por nombre de archivo con extensión", f({ search: "brida.iam" }), ["T2:brida"]);
  eq("buscador: por tarea (con y sin tildes) y por comercial", [f({ search: "diseñar" }).sort(), f({ search: "disenar" }).sort(), f({ search: "marta" })], [["T1:eje_26001", "T1:soporte_26001"], ["T1:eje_26001", "T1:soporte_26001"], ["T3:chasis_26002", "T7:extra"]]);
  eq("buscador: por nombre de proyecto", f({ search: "togg" }), ["T3:chasis_26002", "T7:extra"]);
  eq("buscador: varias palabras, TODAS tienen que aparecer", [f({ search: "eje talgo" }).length, f({ search: "eje togg" }).length], [3, 0]);
  eq("buscador: sin coincidencias", f({ search: "zzz" }), []);
  eq("filtro de proyecto", f({ projectId: "P2" }), ["T3:chasis_26002", "T7:extra"]);
  eq("filtro de sector (Industria / Automoción / Todos)", [f({ sector: "industria" }).length, f({ sector: "automocion" }).length, f({ sector: "todos" }).length, f({ sector: "basura" }).length], [4, 2, 6, 6]);
  eq("filtro de disponibilidad: Con 3D STEP listo", f({ availability: "step" }).sort(), ["T1:eje_26001", "T1:soporte_26001", "T2:eje_26001", "T3:chasis_26002"]);
  eq("filtro de disponibilidad: Solo .IPT/.IAM", f({ availability: "native" }).sort(), ["T2:brida", "T7:extra"]);
  eq("filtros combinados (proyecto + sector + disponibilidad + texto)", f({ projectId: "P1", sector: "industria", availability: "step", search: "eje" }).sort(), ["T1:eje_26001", "T2:eje_26001"]);
  eq("orden por relevancia: la referencia exacta antes que las que solo la contienen", pv.filterCadPartsCatalog([{ ...parts[0], key: "x1", baseReference: "eje_26001b", nativeFiles: [], stepFiles: [], projectCode: "", projectName: "", comercial: "", taskTitle: "", displayName: "eje_26001b" }, { ...parts[0], key: "x2", baseReference: "eje_26001", nativeFiles: [], stepFiles: [], projectCode: "", projectName: "", comercial: "", taskTitle: "", displayName: "eje_26001" }], { search: "eje_26001" }).map((p) => p.key), ["x2", "x1"]);
  eq("collectPartsProjects: los proyectos del catálogo por código", pv.collectPartsProjects(parts).map((p) => p.id), ["P1", "P2"]);
  eq("hasPartsFilters / emptyPartsState / normalizePartsAvailability", [pv.hasPartsFilters(pv.emptyPartsState()), pv.hasPartsFilters({ search: " x " }), pv.hasPartsFilters({ availability: "step" }), pv.hasPartsFilters({ sector: "industria" }), pv.normalizePartsAvailability("loquesea"), pv.emptyPartsState()], [false, true, true, true, "todos", { search: "", projectId: "", sector: "todos", availability: "todos" }]);
  eq("opciones de disponibilidad: Todos | Con 3D STEP listo | Solo .IPT/.IAM", pv.PARTS_AVAILABILITY_OPTIONS.map((o) => o.label), ["Todos", "Con 3D STEP listo", "Solo .IPT/.IAM"]);

  // permisos
  eq("permisos: sin documento rigen los tres grupos (Diseño, Técnicos, Producción)", dep.normalizePartsViewerAllowed(null), ["diseno", "tecnicos", "produccion"]);
  eq("permisos: con documento vale lo que diga (también vacío), solo valores conocidos y sin repetir", [dep.normalizePartsViewerAllowed({ allowedDepartments: ["produccion", "produccion", "x", 5] }), dep.normalizePartsViewerAllowed({ allowedDepartments: [] })], [["produccion"], []]);
  const admin = { uid: "a", role: "admin" };
  check("permisos: un admin entra siempre; un Diseño - Industria con el grupo «diseno» también; sin departamento o sin grupo, no", dep.canViewPartsViewer(admin, []) && dep.canViewPartsViewer({ uid: "d", role: "member", department: "diseno-industria" }, ["diseno"]) && !dep.canViewPartsViewer({ uid: "d", role: "member", department: "diseno-industria" }, ["tecnicos"]) && !dep.canViewPartsViewer({ uid: "n", role: "member" }, ["diseno", "tecnicos", "produccion"]) && !dep.canViewPartsViewer(null, ["diseno"]) && dep.canViewPartsViewer({ uid: "p", role: "member", department: "produccion" }, undefined));
  const sets = [];
  globalThis.__fb.hooks.setDoc = async (ref, data) => { sets.push({ ref, data }); };
  const access = await import("../js/data/parts-viewer-access.js");
  await access.setPartsViewerAccess(["tecnicos", "nope"], "admin1");
  check("data/parts-viewer-access.js: guarda meta/partsViewerAccess normalizado y quién lo hizo", sets.length === 1 && sets[0].ref.path === "meta/partsViewerAccess" && JSON.stringify(sets[0].data.allowedDepartments) === '["tecnicos"]' && sets[0].data.updatedBy === "admin1", sets[0]);
  delete globalThis.__fb.hooks.setDoc;
  check("store.js: rebanada partsViewerAccess registrada", /partsViewerAccess: "id"/.test(read("js/store.js")));
}

// ---------------------------------------------------------------- 5) motor con STEP reales
let real = null;
try {
  const THREE = await import("three");
  const { createRequire } = await import("node:module");
  const occtimportjs = createRequire(import.meta.url)("occt-import-js");
  const occt = await occtimportjs();
  real = { THREE, occt };
} catch (e) {
  console.log("  (motor con STEP reales omitido: faltan `three` y `occt-import-js`; ejecuta npm install)");
}
const eng = await import("../js/cad-engine.js");
const mdl = await import("../js/cad-model.js");
if (real) {
  const { THREE, occt } = real;
  const load = (f) => mdl.buildCadModel(THREE, eng.parseStepBuffer(occt, new Uint8Array(readBin(`tests/fixtures/${f}.step`))));
  const rayOf = (model) => { const meshes = model.parts.map((p) => p.mesh); return (o, d) => new THREE.Raycaster(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize()).intersectObjects(meshes, false)[0]; };

  const plate = load("placa-100x50x3");
  check("placa 100×50×3 con 2 taladros: 8 caras B-Rep (2 tapas, 4 cantos y 2 taladros) y todos los triángulos asignados", plate.faces.length === 8 && plate.faces.every((x) => x.source === "brep") && plate.parts[0].triToFace.every((id) => id < 8), plate.faces.map((x) => x.source));
  eq("cotas envolventes de la placa: 100 × 50 × 3 mm", cad.formatBoundingBoxMm(plate.bounds.size), "X: 100.00 mm × Y: 50.00 mm × Z: 3.00 mm");
  check("el modelo trae aristas CAD y malla por pieza", plate.parts[0].edges.isLineSegments === true && plate.parts[0].edges.geometry.getAttribute("position").count > 0 && plate.group.children.length === 1);
  const ray = rayOf(plate);
  const top = ray([10, 10, 50], [0, 0, -1]), bottom = ray([10, 10, -50], [0, 0, 1]), side = ray([-80, 10, 0], [1, 0, 0]);
  const [fTop, fBottom, fSide] = [top, bottom, side].map((h) => mdl.faceIdFromIntersection(plate, h));
  check("clic en la tapa superior, la inferior y un canto: tres caras distintas", new Set([fTop, fBottom, fSide]).size === 3 && fTop >= 0, [fTop, fBottom, fSide]);
  const dTop = mdl.describeModelFace(plate, fTop), dBottom = mdl.describeModelFace(plate, fBottom), dSide = mdl.describeModelFace(plate, fSide);
  check("la cara de la tapa es plana, de normal Z y su centroide y vértices están en coordenadas de mundo", dTop.isPlanar && near(Math.abs(dTop.normal[2]), 1, 1e-6) && near(dTop.centroid[2], 1.5, 1e-6) && dTop.vertices.every((v) => near(v[2], 1.5, 1e-6)) && dTop.area > 4800 && dTop.area < 5000, dTop);
  let r = cad.computeFaceToFaceMeasurement(dTop, dBottom);
  check("ESPESOR de la chapa: Cara a Cara tapa↔tapa = 3.00 mm, paralelas, 0°", r.isParallel && r.normalDistanceMm === 3 && r.primaryDistanceMm === 3 && r.angleDeg === 0 && r.minDistanceMm === 3, r);
  eq("… etiqueta «Cara a Cara: 3.00 mm» y «Paralelas · 0.0°»", cad.describeFaceToFace(r), { label: "Cara a Cara: 3.00 mm", angle: "Paralelas · 0.0°" });
  r = cad.computeFaceToFaceMeasurement(dTop, dSide);
  check("tapa ↔ canto: perpendiculares (90°), se tocan (mínima 0)", !r.isParallel && r.angleDeg === 90 && r.minDistanceMm === 0, r);
  const holeHit = ray([25, -10, 0], [0, 1, 0]);
  const hole = mdl.describeModelFace(plate, mdl.faceIdFromIntersection(plate, holeHit));
  check("la pared de un taladro es curva: isPlanar false y no se da por paralela de nada", hole.isPlanar === false, hole);
  const holeM = cad.computeFaceToFaceMeasurement(dTop, hole);
  check("… tapa ↔ taladro: la distancia mínima es 0 (comparten el borde del taladro)", holeM.minDistanceMm === 0 && !holeM.isParallel, holeM);
  const corner = ray([49.6, 24.6, 50], [0, 0, -1]);
  const snap = mdl.snapIntersection(plate, corner, 1.5);
  check("snap Punto a Punto: cerca de una esquina salta al vértice exacto (50, 25, 1.5)", snap.kind === "vertex" && snap.point.every((v, i) => near(v, [50, 25, 1.5][i], 1e-4)), snap);
  const free = mdl.snapIntersection(plate, top, 0.5);
  check("… lejos de aristas y vértices da el punto exacto del impacto", free.kind === "surface" && near(free.point[0], 10) && near(free.point[1], 10), free);
  const hl = mdl.createFaceHighlight(THREE, plate, fTop, 0xff9f1c);
  check("resaltado de cara: una malla translúcida con los triángulos de esa cara", hl.geometry.getAttribute("position").count / 3 === plate.faces[fTop].triangles.length && hl.material.transparent === true, hl.geometry.getAttribute("position").count);
  eq("faceIdFromIntersection con basura da -1", [mdl.faceIdFromIntersection(plate, null), mdl.faceIdFromIntersection(plate, { object: plate.parts[0].mesh, faceIndex: 1e9 })], [-1, -1]);
  let gd = 0, md = 0;
  const og = THREE.BufferGeometry.prototype.dispose, om = THREE.Material.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function () { gd++; return og.call(this); };
  THREE.Material.prototype.dispose = function () { md++; return om.call(this); };
  plate.group.add(hl);
  mdl.disposeObject3D(plate.group);
  THREE.BufferGeometry.prototype.dispose = og; THREE.Material.prototype.dispose = om;
  check("disposeObject3D libera geometrías (malla, aristas y resaltado) y materiales, sin repetir los compartidos", gd === 3 && md === 3 && plate.group.parent === null, { gd, md });

  const bracket = load("escuadra-L");
  const rb = rayOf(bracket);
  const ids = [rb([30, 30, 100], [0, 0, -1]), rb([30, 30, -100], [0, 0, 1]), rb([30, -100, 20], [0, 1, 0]), rb([30, 100, 20], [0, -1, 0])].map((h) => mdl.faceIdFromIntersection(bracket, h));
  const [bt, bb, wo, wi] = ids.map((i) => mdl.describeModelFace(bracket, i));
  check("escuadra en L (base 4 mm + ala 4 mm): espesor de la base 4.00 y del ala 4.00 mm", cad.computeFaceToFaceMeasurement(bt, bb).primaryDistanceMm === 4 && cad.computeFaceToFaceMeasurement(wo, wi).primaryDistanceMm === 4, ids);
  check("… base ↔ ala interior: perpendiculares, 90°", cad.computeFaceToFaceMeasurement(bt, wi).angleDeg === 90 && cad.computeFaceToFaceMeasurement(bt, wi).isParallel === false);
  eq("… cotas envolventes 60 × 40 × 34", cad.formatBoundingBoxMm(bracket.bounds.size), "X: 60.00 mm × Y: 40.00 mm × Z: 34.00 mm");
  const cubeBox = load("caja-20x30x40");
  check("caja 20×30×40: 6 caras y 3 pares de caras paralelas a 20, 30 y 40 mm", cubeBox.faces.length === 6 && (() => { const rc = rayOf(cubeBox); const pair = (o, d, o2, d2) => cad.computeFaceToFaceMeasurement(mdl.describeModelFace(cubeBox, mdl.faceIdFromIntersection(cubeBox, rc(o, d))), mdl.describeModelFace(cubeBox, mdl.faceIdFromIntersection(cubeBox, rc(o2, d2)))).primaryDistanceMm; return [pair([100, 0, 0], [-1, 0, 0], [-100, 0, 0], [1, 0, 0]), pair([0, 100, 0], [0, -1, 0], [0, -100, 0], [0, 1, 0]), pair([0, 0, 100], [0, 0, -1], [0, 0, -100], [0, 0, 1])].join() === "20,30,40"; })());

  // sin caras B-Rep: se agrupan los triángulos coplanares
  const stripped = eng.parseStepBuffer(occt, new Uint8Array(readBin("tests/fixtures/caja-20x30x40.step")));
  stripped.meshes.forEach((m) => { delete m.brep_faces; });
  const fb = mdl.buildCadModel(THREE, stripped);
  check("STEP sin brep_faces: las caras salen de agrupar triángulos coplanares (la caja sigue siendo 6 caras)", fb.faces.length === 6 && fb.faces.every((x) => x.source === "coplanar"), fb.faces.map((x) => x.source));
  const partial = eng.parseStepBuffer(occt, new Uint8Array(readBin("tests/fixtures/caja-20x30x40.step")));
  partial.meshes[0].brep_faces = partial.meshes[0].brep_faces.slice(0, 3).concat([{ first: -5, last: 2 }, { first: 3, last: 1 }, null]);
  const pm = mdl.buildCadModel(THREE, partial);
  check("brep_faces incompletas o corruptas: lo que falta se agrupa por coplanaridad y ningún triángulo queda sin cara", pm.faces.length >= 6 && pm.parts[0].triToFace.every((id) => id !== 0xffffffff) && pm.faces.filter((x) => x.source === "brep").length === 3, pm.faces.map((x) => x.source));

  // errores del lector
  let msgs = [];
  [() => eng.parseStepBuffer(occt, new Uint8Array(0)), () => eng.parseStepBuffer(occt, new TextEncoder().encode("esto no es un STEP")), () => eng.parseStepBuffer(null, new Uint8Array(3)), () => mdl.buildCadModel(THREE, { meshes: [] })].forEach((fn) => { try { fn(); msgs.push("no lanzó"); } catch (e) { msgs.push(e.message); } });
  check("parseStepBuffer / buildCadModel: archivo vacío, basura, lector no listo o sin geometría → error en castellano", msgs.every((m) => /vacío|STEP|geometría|listo/.test(m)) && !msgs.includes("no lanzó"), msgs);

  // OrbitControls real con la cámara en Y o Z vertical: las vistas rápidas no dan NaN (ni siquiera la Planta, que mira a lo largo del eje vertical)
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
  for (const axis of ["y", "z"]) {
    const cam = new THREE.PerspectiveCamera(40, 1.5, 1, 1000);
    cam.up.set(...cad.cadUpVector(axis));
    const dom = document.createElement("canvas");
    const ctl = new OrbitControls(cam, dom);
    const okAll = ["iso", "front", "top", "side"].every((v) => {
      let dir = cad.cadViewDirection(v, axis);
      const up = cad.cadUpVector(axis);
      if (Math.abs(dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2]) > 0.9999) { const fr = cad.cadViewDirection("front", axis); dir = dir.map((c, i) => c + fr[i] * 1e-3); }
      ctl.target.set(0, 0, 0); cam.position.set(dir[0] * 300, dir[1] * 300, dir[2] * 300);
      ctl.update();
      return cam.position.toArray().every(Number.isFinite) && cam.quaternion.toArray().every(Number.isFinite) && near(cam.position.length(), 300, 0.5);
    });
    check(`OrbitControls real con el eje ${axis.toUpperCase()} vertical: las 4 vistas rápidas dejan la cámara válida (sin NaN, a la distancia pedida)`, okAll);
    ctl.dispose();
  }
}

// ---------------------------------------------------------------- 6) interfaz con jsdom
const launches = [], copies = [];
const launchConvert = async (input) => { launches.push(input); return "launched"; };
const copyCommand = async (input) => { copies.push(input); return true; };
const NAS = "\\\\NASMARTECH\\Spanesi\\26001 - Cabina Talgo";
const stepBytes = readBin("tests/fixtures/placa-100x50x3.step");
const stepFile = (name = "placa-100x50x3.step") => new File([stepBytes], name);
const clearBody = () => { $$(".cad-viewer-overlay, .cad-assistant-overlay, .modal-overlay").forEach((n) => n.remove()); };

// elementos con tamaño en jsdom (la maquetación no existe): 1000 × 800
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1000; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 800; } });

{
  const viewer = await import("../js/components/cad-viewer-modal.js");
  const assistant = await import("../js/components/cad-upload-assistant.js");

  // --- sin STEP gemelo: aviso y las dos salidas
  let h = viewer.openCadViewerModal({ attachment: { id: "n1", name: "Eje_26001.ipt", taskId: "T1", projectId: "P1" }, attachmentsPool: [{ id: "o", name: "Otro.step", taskId: "T1" }], storage: {}, projectLocation: NAS, deps: { launchConvert, copyCommand } });
  await h.ready;
  const need = $(".cad-viewer-need");
  check("👁️ de un .ipt sin gemelo: el modal explica que hace falta el .STEP/.STP", need && /Falta el modelo 3D \(\.STEP\) de «Eje_26001\.ipt»/.test(need.textContent) && /gemelo/.test(need.textContent));
  const bConv = $('[data-act="convert"]', need), bLocal = $('[data-act="local"]', need);
  eq("… con los dos botones directos", [bConv.textContent, bLocal.textContent], ["⚙️ Convertir este archivo a .STEP en mi PC (PowerShell)", "📂 Cargar archivo .STEP/.STP local"]);
  click(bConv);
  eq("… «Convertir» manda SOLO ese archivo y la carpeta del proyecto", launches, [{ fileName: "Eje_26001.ipt", projectLocation: NAS }]);
  click($('[data-act="copy"]', need));
  eq("… «Copiar comando de PowerShell» copia el mismo encargo", copies, [{ fileName: "Eje_26001.ipt", projectLocation: NAS }]);
  check("… la barra de herramientas 3D no se enseña aún", $('[data-cad="toolbar"]').hidden === true);
  h.close();
  check("cerrar quita el modal", !$(".cad-viewer-overlay"));

  // --- un solo visor a la vez
  const h1 = viewer.openCadViewerModal({ attachment: { name: "a.ipt" }, deps: {} });
  const h2 = viewer.openCadViewerModal({ attachment: { name: "b.ipt" }, deps: {} });
  eq("un solo visor a la vez: abrir otro cierra el anterior", $$(".cad-viewer-overlay").length, 1);
  h2.close(); h1.close();
  h = viewer.openCadViewerModal({ file: new File(["x"], "plano.pdf"), deps: {} });
  await h.ready;
  check("un archivo que no es .step/.stp da un aviso", /Solo se pueden abrir archivos \.step o \.stp/.test($(".cad-viewer-need").textContent));
  h.close();
  h = viewer.openCadViewerModal({ attachment: { name: "a.pdf" }, deps: {} });
  await h.ready;
  check("un adjunto que no es CAD da un aviso", /no se puede ver en 3D/.test($(".cad-viewer-need").textContent));
  h.close();
  h = viewer.openCadViewerModal({ attachment: { name: "Enorme.step", size: eng.CAD_MAX_FILE_BYTES + 1, driveId: "x" }, storage: { downloadBlob: async () => { throw new Error("no debería descargar"); } }, deps: { loadEngine: async () => { throw new Error("no debería cargar"); } } });
  await h.ready;
  check("un STEP gigante no se descarga: avisa del tamaño y ofrece descargarlo", /demasiado grande/.test($(".cad-viewer-need").textContent) && /Descargar archivo/.test($(".cad-viewer-need").textContent));
  h.close();
  h = viewer.openCadViewerModal({ file: stepFile(), deps: { loadEngine: async () => { throw new Error("Sin conexión al CDN"); } } });
  await h.ready;
  check("si el motor 3D no carga, el error se muestra con salida «Cargar archivo local»", /Sin conexión al CDN/.test($(".cad-viewer-need").textContent) && /Cargar archivo \.STEP\/\.STP local/.test($(".cad-viewer-need").textContent));
  h.close();

  // --- el visor entero, con el renderer falso y OrbitControls de pruebas
  if (real) {
    const { THREE, occt } = real;
    let lastCamera = null, lastScene = null;
    const renderers = [];
    class FakeRenderer {
      constructor() { this.domElement = document.createElement("canvas"); this.domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }); this.renders = 0; this.disposed = false; this.lost = false; renderers.push(this); }
      setPixelRatio() {} setSize() {}
      render(scene, camera) { this.renders++; lastScene = scene; lastCamera = camera; }
      dispose() { this.disposed = true; }
      forceContextLoss() { this.lost = true; }
    }
    const controlsMade = [];
    class StubControls {
      constructor(camera) { this.object = camera; this.target = new THREE.Vector3(); this.disposed = false; controlsMade.push(this); }
      addEventListener() {} removeEventListener() {}
      update() { this.object.lookAt(this.target); return false; }
      dispose() { this.disposed = true; }
    }
    const engine = { THREE: { ...THREE, WebGLRenderer: FakeRenderer }, OrbitControls: StubControls, occt };
    const loadEngine = async () => engine;
    let gd = 0, md = 0;
    const og = THREE.BufferGeometry.prototype.dispose, om = THREE.Material.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function () { gd++; return og.call(this); };
    THREE.Material.prototype.dispose = function () { md++; return om.call(this); };

    const uploaded = [];
    h = viewer.openCadViewerModal({ file: stepFile(), onUploadStep: (f) => uploaded.push(f), deps: { loadEngine, launchConvert, copyCommand } });
    await h.ready;
    await tick(5);
    const ui = (n) => $(`[data-cad="${n}"]`);
    check("abre un .step local: canvas en el visor, barra de herramientas y panel de medidas visibles", $("canvas.cad-viewer-canvas") && ui("toolbar").hidden === false && ui("panel").hidden === false && ui("message").hidden === true && renderers[0].renders >= 0);
    await tick(30);
    check("… y se dibuja", renderers[0].renders > 0);
    eq("cotas envolventes siempre visibles en la barra inferior", ui("bbox").textContent, "X: 100.00 mm × Y: 50.00 mm × Z: 3.00 mm");
    const labels = $$("[data-view]").map((b) => b.textContent);
    eq("botones de vista: Isométrica | Frontal | Planta | Perfil | Ajustar a pantalla", labels, ["Isométrica", "Frontal", "Planta", "Perfil", "Ajustar a pantalla"]);
    const toggles = $$("[data-toggle]").map((b) => b.textContent);
    eq("conmutadores: Aristas CAD (Edges) | Alámbrico (Wireframe) | Rejilla/Ejes", toggles, ["Aristas CAD (Edges)", "Alámbrico (Wireframe)", "Rejilla/Ejes"]);
    eq("modos de medida y limpiar", [...$$("[data-mode]").map((b) => b.textContent), ui("clear").textContent], ["📏 Punto a Punto", "📐 Cara a Cara", "🗑️ Limpiar medidas"]);
    check("Aristas CAD activas por defecto; alámbrico y rejilla apagados", $('[data-toggle="edges"]').classList.contains("is-active") && !$('[data-toggle="wireframe"]').classList.contains("is-active") && !$('[data-toggle="grid"]').classList.contains("is-active"));
    const model = () => lastScene.children.find((c) => c.name === "cad-model");
    const edgesOf = () => model().children[0].children[0];
    check("las aristas (EdgesGeometry) salen visibles y se apagan con el conmutador", edgesOf().visible === true && (click($('[data-toggle="edges"]')), edgesOf().visible === false) && (click($('[data-toggle="edges"]')), edgesOf().visible === true));
    click($('[data-toggle="wireframe"]'));
    check("Alámbrico: la malla pasa a wireframe y vuelve", model().children[0].material.wireframe === true && (click($('[data-toggle="wireframe"]')), model().children[0].material.wireframe === false));
    const gridGroup = () => lastScene.children.find((c) => c.children.some((k) => k.type === "GridHelper"));
    check("Rejilla/Ejes: hay rejilla y ejes, ocultos de partida y visibles al activar", gridGroup() && gridGroup().visible === false && gridGroup().children.some((k) => k.type === "AxesHelper") && (click($('[data-toggle="grid"]')), gridGroup().visible === true));

    // vistas rápidas (eje Y vertical por defecto)
    const dirOf = () => lastCamera.position.clone().sub(new THREE.Vector3(...[0, 0, 0])).normalize();
    const camDir = () => { const c = model(); const box = new THREE.Box3().setFromObject(c); const centre = box.getCenter(new THREE.Vector3()); return lastCamera.position.clone().sub(centre).normalize(); };
    click($('[data-view="front"]'));
    check("vista Frontal (eje Y vertical): la cámara mira desde +Z", camDir().z > 0.99, camDir());
    click($('[data-view="side"]'));
    check("vista Perfil: desde +X", camDir().x > 0.99, camDir());
    click($('[data-view="top"]'));
    check("vista Planta: desde +Y, sin NaN", camDir().y > 0.99 && lastCamera.position.toArray().every(Number.isFinite), camDir());
    click($('[data-view="iso"]'));
    check("vista Isométrica: las tres componentes positivas e iguales", Math.abs(camDir().x - camDir().y) < 1e-6 && Math.abs(camDir().y - camDir().z) < 1e-6 && camDir().x > 0.5);
    const distIso = lastCamera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    lastCamera.position.multiplyScalar(3);
    click($('[data-view="fit"]'));
    check("Ajustar a pantalla: recoloca la cámara a la distancia de encuadre sin cambiar la dirección", Math.abs(lastCamera.position.length() - distIso) < 1 && camDir().x > 0.5);
    const sel = ui("up-axis");
    sel.value = "z"; fire(sel, "change");
    check("eje vertical Z: la cámara sube por Z, se rehacen los controles y se recuerda", lastCamera.up.z === 1 && controlsMade.length === 2 && controlsMade[0].disposed === true && localStorage.getItem("chusy_cad_viewer_up_axis") === "z");
    click($('[data-view="front"]'));
    check("… y Frontal pasa a mirar desde −Y", camDir().y < -0.99, camDir());
    sel.value = "y"; fire(sel, "change");

    // medir
    const pointerClick = (x, y) => { const c = $("canvas.cad-viewer-canvas"); ["pointerdown", "pointerup"].forEach((t) => c.dispatchEvent(new window.MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 }))); };
    const screenOf = (p) => { const v = new THREE.Vector3(...p).project(lastCamera); return [((v.x + 1) / 2) * 1000, ((1 - v.y) / 2) * 800]; };
    const clickAt = (p) => { lastCamera.updateMatrixWorld(true); pointerClick(...screenOf(p)); };
    click($('[data-view="iso"]'));
    lastCamera.updateMatrixWorld(true);
    const measures = () => $$(".cad-viewer-measure");
    const labelsShown = () => $$(".cad-viewer-label--dim");
    click($('[data-mode="point-to-point"]'));
    check("modo Punto a Punto: botón activo, cursor de cruz y ayuda", $('[data-mode="point-to-point"]').classList.contains("is-active") && $("canvas.cad-viewer-canvas").style.cursor === "crosshair" && /punto A/.test(ui("hint").textContent));
    clickAt([49.7, 24.7, 1.5]);
    check("clic 1: marcador A y ahora pide el B", $$(".cad-viewer-marker").length === 1 && /punto B/.test(ui("hint").textContent));
    clickAt([-49.7, -24.7, 1.5]);
    await tick(20);
    check("clic 2: marcador B, línea de cota, etiqueta y medida en el panel (con snap a las esquinas: 111.80 mm)", $$(".cad-viewer-marker").length === 2 && measures().length === 1 && /Punto a Punto: 111\.80 mm/.test(measures()[0].textContent) && /ΔX -100\.00 mm · ΔY -50\.00 mm · ΔZ 0\.00 mm/.test(measures()[0].textContent) && labelsShown().length === 1 && /Punto a Punto: 111\.80 mm/.test(labelsShown()[0].textContent) && lastScene.children.some((c) => c.isGroup && c.children[0] && c.children[0].type === "Line"), measures().map((m) => m.textContent));
    check("… la etiqueta 3D se coloca con una transformación de pantalla", /translate\(/.test(labelsShown()[0].style.transform));
    // Cara a cara: tapa (+Z) y canto (+X)
    click($('[data-mode="face-to-face"]'));
    check("cambiar a Cara a Cara apaga el otro modo, y la ayuda lo dice", !$('[data-mode="point-to-point"]').classList.contains("is-active") && $('[data-mode="face-to-face"]').classList.contains("is-active") && /primera cara/.test(ui("hint").textContent));
    clickAt([10, 10, 1.5]);
    const highlights = () => lastScene.children.filter((c) => c.isMesh && c.userData.faceId !== undefined);
    check("clic en la primera cara: queda resaltada en 3D y pide la segunda", highlights().length === 1 && /segunda cara/.test(ui("hint").textContent));
    clickAt([10, 10, 1.5]);
    check("… la MISMA cara otra vez no cuenta: avisa y sigue esperando", measures().length === 1 && /distinta/.test(ui("hint").textContent));
    clickAt([50, 0, 0.2]);
    check("clic en la segunda cara: medida Cara a Cara (canto ⟂ tapa: 0.00 mm, Inclinadas · 90.0°) en la etiqueta y en el panel", measures().length === 2 && /Cara a Cara: 0\.00 mm/.test(measures()[1].textContent) && /Ángulo entre caras: 90\.0°/.test(measures()[1].textContent) && /No paralelas/.test(measures()[1].textContent) && /Distancia normal/.test(measures()[1].textContent) && /Distancia mínima: 0\.00 mm/.test(measures()[1].textContent) && labelsShown().some((l) => /Inclinadas · 90\.0°/.test(l.textContent)), measures().map((m) => m.textContent));
    check("… las dos caras quedan resaltadas dentro de la medida", lastScene.children.some((c) => c.isGroup && c.children.filter((k) => k.isMesh && k.userData.faceId !== undefined).length === 2));
    // Esc con selección pendiente cancela la selección, no cierra
    clickAt([10, 10, 1.5]);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Esc con una cara a medias: cancela la selección y el visor sigue abierto", !!$(".cad-viewer-overlay") && highlights().length === 0);
    // quitar una medida y limpiar
    click($(".cad-viewer-measure__del", measures()[0]));
    check("✕ de una medida: se quita con su etiqueta y marcadores", measures().length === 1 && $$(".cad-viewer-marker").length === 0);
    click(ui("clear"));
    check("🗑️ Limpiar medidas: panel, etiquetas, líneas y resaltados fuera", measures().length === 0 && labelsShown().length === 0 && !lastScene.children.some((c) => c.isGroup && c.children[0] && c.children[0].type === "Line") && highlights().length === 0 && /Elige/.test(ui("measures-empty").textContent) && ui("measures-empty").hidden === false, { m: measures().length, l: labelsShown().length, lines: lastScene.children.filter((c) => c.isGroup && c.children[0] && c.children[0].type === "Line").length, h: highlights().length, e: ui("measures-empty").textContent.slice(0, 20), hid: ui("measures-empty").hidden });
    // clic fuera de la pieza
    click($('[data-mode="point-to-point"]'));
    pointerClick(2, 2);
    check("clic fuera de la pieza: avisa sin romper", /sobre la pieza/.test(ui("hint").textContent) && $$(".cad-viewer-marker").length === 0);
    // un arrastre no es un clic
    const cv = $("canvas.cad-viewer-canvas");
    cv.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 500, clientY: 400, button: 0 }));
    cv.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, clientX: 540, clientY: 440, button: 0 }));
    check("arrastrar para girar no coloca puntos", $$(".cad-viewer-marker").length === 0);
    click($('[data-mode="point-to-point"]'));

    // la subida del STEP local a la tarea
    check("«Subir este .STEP a la tarea» no aparece con un .step abierto desde fuera (solo con uno cargado en local)", $('[data-cad="upload-step"]').hidden === true);

    // cierre: libera todo
    const r0 = renderers[0];
    const before = { gd, md };
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Esc cierra el visor", !$(".cad-viewer-overlay"));
    check("cierre: renderer.dispose() y forceContextLoss(), controles liberados, canvas fuera del DOM", r0.disposed && r0.lost && controlsMade.every((c) => c.disposed) && !r0.domElement.isConnected);
    check("cierre: geometrías y materiales liberados (malla, aristas, rejilla, ejes…)", gd - before.gd >= 4 && md - before.md >= 4, { gd: gd - before.gd, md: md - before.md });
    const rendersAfter = r0.renders;
    await tick(40);
    check("cierre: el bucle de animación se detiene", r0.renders === rendersAfter);
    check("cierre: no quedan listeners de Esc (otra pulsación no rompe nada)", (document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true));

    // --- .ipt CON su gemelo en el pool: carga el STEP gemelo y lo dice
    const blobStep = new Blob([stepBytes]);
    let downloaded = [];
    const storage = { downloadBlob: async (a, o) => { downloaded.push(a.id); if (o && o.onProgress) o.onProgress({ loaded: stepBytes.length, total: stepBytes.length }); return blobStep; } };
    h = viewer.openCadViewerModal({
      attachment: { id: "n1", name: "Placa.ipt", taskId: "T1", projectId: "P1", size: 100 },
      attachmentsPool: [{ id: "x1", name: "Otra.step", taskId: "T1", projectId: "P1" }, { id: "g1", name: "placa.STP", taskId: "T1", projectId: "P1", size: stepBytes.length }],
      storage, deps: { loadEngine, launchConvert, copyCommand },
    });
    await h.ready; await tick(40);
    eq("👁️ de un .ipt con gemelo: descarga el .STP gemelo (no el .ipt)", downloaded, ["g1"]);
    check("… y el subtítulo dice que es la vista 3D asociada al .ipt", /Vista 3D asociada a Placa\.ipt · STEP gemelo: placa\.STP/.test($('[data-cad="subtitle"]').textContent) && $('[data-cad="bbox"]').textContent.startsWith("X: 100.00 mm"));
    h.close();
    check("… al cerrar de nuevo se libera todo (segundo renderer)", renderers[1].disposed && renderers[1].lost);

    // --- .ipt sin gemelo: cargar un STEP local al vuelo y subirlo a la tarea
    h = viewer.openCadViewerModal({ attachment: { id: "n2", name: "Placa.ipt", taskId: "T1" }, attachmentsPool: [], storage, projectLocation: NAS, onUploadStep: (f) => uploaded.push(f), deps: { loadEngine, launchConvert, copyCommand } });
    await h.ready;
    let picker = null;
    const origClick = window.HTMLInputElement.prototype.click;
    window.HTMLInputElement.prototype.click = function () { picker = this; };
    click($('[data-act="local"]'));
    const chosen = stepFile("Placa.step");
    Object.defineProperty(picker, "files", { value: [chosen] });
    check("«Cargar archivo .STEP/.STP local» abre un selector que solo admite .step y .stp", picker.type === "file" && picker.accept === ".step,.stp");
    fire(picker, "change");
    await tick(60);
    check("… el STEP local se dibuja en el mismo visor y el subtítulo lo dice", $('[data-cad="toolbar"]').hidden === false && /STEP local: Placa\.step/.test($('[data-cad="subtitle"]').textContent) && $('[data-cad="bbox"]').textContent.startsWith("X: 100.00 mm"));
    const up = $('[data-cad="upload-step"]');
    check("… y aparece «⬆ Subir este .STEP a la tarea»", up.hidden === false);
    click(up);
    check("… que entrega ese File a la tarea para subirlo", uploaded.length === 1 && uploaded[0] === chosen && up.hidden === true);
    h.close();
    window.HTMLInputElement.prototype.click = origClick;

    THREE.BufferGeometry.prototype.dispose = og; THREE.Material.prototype.dispose = om;
  }
  clearBody();

  // --- asistente de subida
  const ipt = new File(["abc"], "Eje_26001.ipt"), iam = new File(["abcd"], "Conjunto.iam");
  let a = assistant.openCadUploadAssistant({ files: [ipt], getLocation: () => NAS, deps: { launchConvert, copyCommand } });
  launches.length = 0;
  const loc = $('[data-cad="location"]');
  check("asistente: título, lista del archivo y los tres botones del enunciado", /Falta el modelo 3D/.test($(".cad-assistant").textContent) && $$(".cad-assistant__row").length === 1 && $('[data-act="convert"]').textContent === "⚙️ 1. Convertir a .STEP en mi PC" && $('[data-act="include"]').textContent === "➕ 2. Incluir el .STEP generado y subir todo" && $('[data-act="native-only"]').textContent === "Subir solo el .ipt/.iam sin .STEP" && loc.value === NAS);
  click($('[data-act="convert"]'));
  await tick(2);
  eq("«1. Convertir» convierte SOLO ese archivo, buscándolo en la carpeta del proyecto", launches, [{ fileName: "Eje_26001.ipt", projectLocation: NAS }]);
  check("… y lo marca como enviado", /Orden enviada/.test($(".cad-assistant__state").textContent));
  typeInto(loc, "C:\\Proy\\Eje_26001.ipt");
  click($('[data-act="convert"]'));
  await tick(2);
  eq("… si se escribe la ruta completa del archivo, se usa esa (-FilePath)", launches[1], { filePath: "C:\\Proy\\Eje_26001.ipt", fileName: "Eje_26001.ipt" });
  click($('[data-act="copy"]'));
  eq("… «Copiar comando» pasa lo mismo", copies[copies.length - 1], { filePath: "C:\\Proy\\Eje_26001.ipt", fileName: "Eje_26001.ipt" });
  let picker2 = null;
  const origClick2 = window.HTMLInputElement.prototype.click;
  window.HTMLInputElement.prototype.click = function () { picker2 = this; };
  click($('[data-act="include"]'));
  check("«2. Incluir el .STEP» abre un selector múltiple de .step/.stp", picker2.type === "file" && picker2.multiple === true && picker2.accept === ".step,.stp");
  const gen = new File(["step"], "Eje_26001.step");
  Object.defineProperty(picker2, "files", { value: [gen] });
  fire(picker2, "change");
  let res = await a.result;
  check("… entrega el .ipt y el .STEP elegido para subirlos juntos", res.action === "upload-with-step" && res.files.map((f) => f.name).join() === "Eje_26001.ipt,Eje_26001.step", res.files.map((f) => f.name));
  check("… y cierra el asistente", !$(".cad-assistant-overlay"));
  // varios archivos: un botón por archivo, sin conversión en bloque
  a = assistant.openCadUploadAssistant({ files: [ipt, iam], getLocation: () => "", deps: { launchConvert, copyCommand } });
  launches.length = 0;
  check("varios archivos: una fila con su botón por cada uno y sin botón global de conversión", $$(".cad-assistant__row").length === 2 && $('[data-act="convert"]').hidden === true && $$(".cad-assistant__row button").length === 2);
  click($$(".cad-assistant__row button")[1]);
  await tick(2);
  eq("… cada botón convierte solo SU archivo", launches, [{ fileName: "Conjunto.iam", projectLocation: "" }]);
  const merged = assistant.openCadUploadAssistant({ files: [new File(["z"], "Tercero.ipt")], deps: {} });
  check("si llega otro lote con el asistente abierto, se suma a la misma ventana", merged.merged === true && $$(".cad-assistant__row").length === 3 && $$(".cad-assistant-overlay").length === 1);
  click($('[data-act="native-only"]'));
  res = await a.result;
  check("«Subir solo el .ipt/.iam sin .STEP» entrega solo los nativos (los 3)", res.action === "upload-native-only" && res.files.map((f) => f.name).join() === "Eje_26001.ipt,Conjunto.iam,Tercero.ipt");
  a = assistant.openCadUploadAssistant({ files: [ipt], deps: {} });
  click($('[data-act="cancel"]'));
  res = await a.result;
  eq("Cancelar no sube nada", [res.action, res.files.length], ["cancel", 0]);
  a = assistant.openCadUploadAssistant({ files: [ipt], deps: {} });
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  res = await a.result;
  check("Esc también cancela, y el asistente desaparece", res.action === "cancel" && !$(".cad-assistant-overlay"));
  window.HTMLInputElement.prototype.click = origClick2;
  clearBody();

  // --- el 👁️ y la interceptación en los adjuntos de una tarea
  const { createFileAttachments } = await import("../js/components/file-attachments.js");
  const uploads = [];
  const driveStorage = {
    isEnabled: () => true, maxBytes: () => 1e9,
    uploadFile: async (file) => { uploads.push(file.name); return { driveId: `d-${uploads.length}`, name: file.name, mimeType: "application/octet-stream", size: file.size }; },
    trashFiles() {}, getThumbUrl: async () => { throw new Error("sin miniatura"); }, downloadBlob: async () => new Blob(["x"]),
  };
  const box = document.createElement("div");
  const drop = document.createElement("div");
  document.body.append(box, drop);
  let atts = [att("k1", "Soporte.ipt"), att("k2", "Soporte.step"), att("k3", "Brida.iam"), att("k4", "Plano.pdf"), att("k5", "Tapa.stp")];
  const ui2 = createFileAttachments({
    container: box, dropTarget: drop, storage: driveStorage, getAttachments: () => atts, addAttachment: (x) => atts.push(x), removeAttachment() {},
    currentUser: { uid: "u1", name: "Ramón" }, getTaskId: () => "T1", getProjectId: () => "P1", getLocation: () => NAS,
    getAttachmentsPool: () => [{ ...att("z1", "Brida.step"), taskId: "T2", projectId: "P1" }], onDirty() {}, makeThumbnail: async () => null,
  });
  const cardOf = (id) => $(`[data-att-id="${id}"]`, box);
  const eyeOf = (id) => $(".preview-cad-btn", cardOf(id));
  check("👁️ (class «attachment-btn preview-cad-btn», title «Ver y medir en 3D») en .ipt, .iam, .step y .stp", ["k1", "k2", "k3", "k5"].every((id) => eyeOf(id) && eyeOf(id).classList.contains("attachment-btn") && eyeOf(id).title === "Ver y medir en 3D" && eyeOf(id).textContent === "👁️"));
  check("… y en ningún otro archivo (un PDF)", !eyeOf("k4"));
  click(eyeOf("k3"));
  await tick(2);
  check("👁️ de un .iam sin gemelo en la tarea pero con uno en OTRA tarea del proyecto: abre el visor (y no pide el STEP)", !!$(".cad-viewer-overlay") && !/Falta el modelo 3D/.test($(".cad-viewer-overlay").textContent) && /STEP gemelo: Brida\.step/.test($('[data-cad="subtitle"]').textContent), $('[data-cad="subtitle"]') && $('[data-cad="subtitle"]').textContent);
  $(".cad-viewer-close").click();
  atts = atts.filter((x) => x.id !== "k2");
  ui2.render();
  click(eyeOf("k1"));
  await tick(2);
  check("👁️ de un .ipt sin gemelo en ninguna parte: el modal pide el .STEP", /Falta el modelo 3D \(\.STEP\) de «Soporte\.ipt»/.test(($(".cad-viewer-need") || {}).textContent || ""));
  $(".cad-viewer-close").click();
  atts.push(att("k2", "Soporte.step"));
  ui2.render();
  // clic en la tarjeta de un CAD → la vista previa ofrece el 3D
  click(cardOf("k5"));
  await tick(2);
  const fpBtn = $("[data-fp-cad]");
  check("clic en la tarjeta de un archivo CAD: la vista previa ofrece «👁️ Ver y medir en 3D»", !!fpBtn && /Ver y medir en 3D/.test(fpBtn.textContent));
  click(fpBtn);
  await tick(2);
  check("… que cierra la vista previa y abre el visor", !$(".fp-overlay") && !!$(".cad-viewer-overlay"));
  $(".cad-viewer-close").click();

  // subida: el lote
  const dropFiles = (files) => { const fileInput = $('input[type="file"]', box); Object.defineProperty(fileInput, "files", { value: files, configurable: true }); fire(fileInput, "change"); }; // se vuelve a buscar: render() rehace el DOM
  uploads.length = 0;
  dropFiles([new File(["1"], "Nuevo.ipt"), new File(["2"], "Nuevo.step"), new File(["3"], "Notas.txt"), new File(["4"], "Cojinete.iam")]);
  await tick(20);
  check("subida: .ipt con su .step en el lote y un .txt suben directos; el .iam sin gemelo espera al asistente", uploads.sort().join() === "Notas.txt,Nuevo.ipt,Nuevo.step" && !!$(".cad-assistant-overlay") && $$(".cad-assistant__name").map((n) => n.textContent).join() === "Cojinete.iam", uploads);
  check("… el asistente arranca con la carpeta del proyecto", $('[data-cad="location"]').value === NAS);
  click($('[data-act="native-only"]'));
  await tick(30);
  check("… «Subir solo el .iam» lo sube", uploads.includes("Cojinete.iam") && !$(".cad-assistant-overlay"));
  uploads.length = 0;
  dropFiles([new File(["5"], "Tapa.ipt")]);
  await tick(20);
  check("subida de un .ipt cuyo .STEP/.STP gemelo YA está adjunto a la tarea: sube directo, sin asistente", uploads.join() === "Tapa.ipt" && !$(".cad-assistant-overlay"), uploads);
  uploads.length = 0;
  dropFiles([new File(["6"], "Cojinete.ipt")]);
  await tick(5);
  click($('[data-act="cancel"]'));
  await tick(20);
  check("cancelar el asistente no sube el .ipt", uploads.length === 0);
  dropFiles([new File(["7"], "Cojinete.ipt")]);
  await tick(5);
  window.HTMLInputElement.prototype.click = function () { this.__picked = true; };
  ui2.destroy();
  check("destroy() de los adjuntos cierra el asistente y el visor que hubiera abiertos", !$(".cad-assistant-overlay") && !$(".cad-viewer-overlay"));
  window.HTMLInputElement.prototype.click = origClick2;
  uploads.length = 0;
  await tick(20);
  check("… y lo que esperaba decisión no se sube", uploads.length === 0);
  box.remove(); drop.remove();
}

{
  // barra lateral y modal de accesos
  const { renderSidebar } = await import("../js/components/sidebar.js");
  const side = document.createElement("div");
  document.body.appendChild(side);
  const user = { uid: "u1", name: "Ana", role: "member", department: "diseno-industria" };
  const sbBase = (over = {}) => ({
    projects: [projects[0]], currentProjectId: null, isMyTasksActive: false, isTimelineActive: false, isArchiveActive: false, isTrashActive: false, myTasksCount: 0,
    userProfile: user, isCollapsed: false, onToggleCollapse() {}, isNavCollapsed: false, onToggleNav() {}, sectorFilter: "todos", onSectorFilterChange() {},
    onSelectProject() {}, onSelectMyTasks() {}, onSelectTimeline() {}, onSelectArchive() {}, onSelectTrash() {}, onSelectMetrics() {}, onCreateProject() {}, onOpenSearch() {},
    onOpenAccount() {}, onOpenWhatsNew() {}, onOpenTeamAdmin() {}, onOpenDepartmentAccess() {}, onOpenWorkCalendar() {}, onOpenOutlookBridge() {}, onOpenDriveStorage() {},
    onOpenAsanaImport() {}, onOpenQuickCreateAdmin() {}, onOpenProjectProperties() {}, onLogout() {}, ...over,
  });
  renderSidebar(side, sbBase({ showPartsViewer: false }));
  check("barra lateral: sin permiso no hay botón «Visualizador de piezas»", !$("#btn-parts-viewer", side) && !$('[data-view="parts-viewer"]', side));
  let went = 0;
  renderSidebar(side, sbBase({ showPartsViewer: true, onSelectPartsViewer: () => went++ }));
  const btn = $("#btn-parts-viewer", side);
  check("barra lateral: con permiso sale «Visualizador de piezas» con icono de cubo y data-view=\"parts-viewer\"", btn && /Visualizador de piezas/.test(btn.textContent) && btn.dataset.view === "parts-viewer" && !!$("svg", btn) && !!btn.closest(".sidebar__nav"));
  click(btn);
  eq("… y al hacer clic va a la sección", went, 1);
  renderSidebar(side, sbBase({ showPartsViewer: true, isPartsViewerActive: true }));
  check("… marcada como activa en su sección", $("#btn-parts-viewer", side).classList.contains("is-active"));
  side.remove();

  const { openDepartmentAccessModal } = await import("../js/components/department-access-modal.js");
  const sets = [];
  globalThis.__fb.hooks.setDoc = async (ref, data) => { sets.push({ ref, data }); };
  openDepartmentAccessModal({ exclusiveProjects: [], ordersAccess: ["tecnicos"], partsViewerAccess: ["diseno", "tecnicos", "produccion"], currentUser: { uid: "admin1" } });
  await tick(5);
  const checkedOf = (c) => $$("input[type=checkbox]", c).filter((i) => i.checked).map((i) => i.dataset.dept);
  const ordersCard = $('[data-da-card="orders"]'), partsCard = $('[data-da-card="parts-viewer"]');
  check("modal de accesos: tarjetas «Pedidos» y «Visualizador de piezas», cada una con las 3 casillas de grupo", ordersCard && partsCard && /Visualizador de piezas/.test(partsCard.textContent) && $$("input[type=checkbox]", partsCard).length === dep.DEPARTMENT_GROUPS.length && $$("input[type=checkbox]", ordersCard).length === dep.DEPARTMENT_GROUPS.length);
  eq("… Pedidos solo Técnicos; Visualizador los tres", [checkedOf(ordersCard), checkedOf(partsCard)], [["tecnicos"], ["diseno", "tecnicos", "produccion"]]);
  const prodBox = $$("input[type=checkbox]", partsCard).find((i) => i.dataset.dept === "produccion");
  prodBox.checked = false; fire(prodBox, "change");
  await tick(10);
  check("… quitar Producción del Visualizador guarda meta/partsViewerAccess (y no toca el de Pedidos)", sets.length === 1 && sets[0].ref.path === "meta/partsViewerAccess" && JSON.stringify(sets[0].data.allowedDepartments) === '["diseno","tecnicos"]' && sets[0].data.updatedBy === "admin1", sets);
  const ordBox = $$("input[type=checkbox]", ordersCard).find((i) => i.dataset.dept === "diseno");
  ordBox.checked = true; fire(ordBox, "change");
  await tick(10);
  check("… marcar Diseño en Pedidos sigue guardando meta/ordersAccess", sets.length === 2 && sets[1].ref.path === "meta/ordersAccess" && JSON.stringify(sets[1].data.allowedDepartments.sort()) === '["diseno","tecnicos"]', sets[1]);
  globalThis.__fb.hooks.setDoc = async () => { throw new Error("denegado"); };
  prodBox.checked = true; fire(prodBox, "change");
  await tick(10);
  check("… si Firestore rechaza el cambio, la casilla vuelve atrás", prodBox.checked === false);
  $("#close")?.click();
  delete globalThis.__fb.hooks.setDoc;
  openDepartmentAccessModal({ exclusiveProjects: [], ordersAccess: ["tecnicos"], currentUser: { uid: "a" } });
  await tick(2);
  check("sin `partsViewerAccess` la ventana no pinta su tarjeta (compatible con quien la llame como antes)", !!$('[data-da-card="orders"]') && !$('[data-da-card="parts-viewer"]'));
  $("#close")?.click();
}

{
  // la vista «Visualizador de piezas»
  const { renderPartsViewerView } = await import("../js/views/parts-viewer-view.js");
  const parts = pv.indexUploadedCadParts(tasks, projects);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const states = [], opened = [];
  const downloads = [];
  const storage = { downloadBlob: async (a) => { downloads.push(a.id); return new Blob(["x"]); } };
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = () => "blob:x";
  const render = (state) => renderPartsViewerView(host, { parts, state, onStateChange: (s) => states.push(s), onOpenTask: (id) => opened.push(id), storage, projects });
  render(undefined);
  const cards = () => $$(".parts-viewer-card", host);
  eq("la vista pinta una tarjeta por pieza y el contador", [cards().length, $("#pv-count", host).textContent], [6, "6 piezas"]);
  const sop = cards().find((c) => /Soporte_26001/.test(c.textContent));
  check("tarjeta con .ipt + .step: una sola, con la insignia «3D STEP listo», el aviso de que tiene ambos y los dos archivos", /3D STEP listo/.test(sop.textContent) && /Inventor \+ modelo 3D STEP listo para medir/.test(sop.textContent) && $$(".parts-viewer-file", sop).length === 2 && /26001/.test(sop.textContent) && /Cabina Talgo/.test(sop.textContent) && /Industria/.test(sop.textContent));
  const brida = cards().find((c) => /Brida/.test(c.textContent));
  check("tarjeta de un .iam sin STEP: «Solo .IPT/.IAM»", /Solo \.IPT\/\.IAM/.test(brida.textContent) && !/3D STEP listo/.test(brida.textContent));
  const eje = cards().find((c) => /eje_26001|Eje_26001/i.test(c.textContent) && /Diseñar/.test(c.textContent));
  check("tarjeta cuyo STEP está en otra tarea del proyecto: lo indica", /en otra tarea/.test(eje.textContent));
  eq("cada tarjeta tiene sus tres acciones", $$("[data-act]", sop).map((b) => b.textContent), ["👁️ Ver y medir 3D", "Abrir tarea", "⬇ Descargar"]);
  check("cabecera: botón «📂 Abrir .STEP/.STP local»", $("#pv-local", host).textContent === "📂 Abrir .STEP/.STP local");
  typeInto($("#pv-search", host), "brida");
  check("buscador instantáneo: filtra al teclear, sin repintar la pantalla (el input sigue siendo el mismo)", cards().length === 1 && $("#pv-count", host).textContent === "1 de 6 piezas" && states[states.length - 1].search === "brida" && $("#pv-clear", host).hidden === false);
  typeInto($("#pv-search", host), "26002");
  eq("… por código de proyecto", cards().length, 2);
  typeInto($("#pv-search", host), "zzz");
  check("… sin resultados: mensaje", /Ninguna pieza coincide/.test($(".parts-viewer-empty", host).textContent));
  click($("#pv-clear", host));
  eq("«Limpiar filtros» lo deja todo", [cards().length, $("#pv-search", host).value], [6, ""]);
  const sel = (id, v) => { $(id, host).value = v; fire($(id, host), "change"); };
  sel("#pv-project", "P2");
  eq("filtro de proyecto", cards().length, 2);
  sel("#pv-project", ""); sel("#pv-sector", "industria");
  eq("filtro de sector Industria", cards().length, 4);
  sel("#pv-sector", "todos"); sel("#pv-availability", "native");
  eq("filtro Disponibilidad «Solo .IPT/.IAM»", cards().length, 2);
  sel("#pv-availability", "step");
  eq("filtro Disponibilidad «Con 3D STEP listo»", cards().length, 4);
  eq("los selectores ofrecen Todos | Industria | Automoción y Todos | Con 3D STEP listo | Solo .IPT/.IAM", [$$("#pv-sector option", host).map((o) => o.textContent), $$("#pv-availability option", host).map((o) => o.textContent)], [["Todos", "Industria", "Automoción"], ["Todos", "Con 3D STEP listo", "Solo .IPT/.IAM"]]);
  render({ search: "eje", projectId: "P1", sector: "industria", availability: "step" });
  check("la vista arranca con el estado guardado de la sesión", $("#pv-search", host).value === "eje" && $("#pv-project", host).value === "P1" && cards().length === 2);
  render(undefined);
  const sop2 = cards().find((c) => /Soporte_26001/.test(c.textContent)), brida2 = cards().find((c) => /Brida/.test(c.textContent)); // render() rehace el DOM: las tarjetas de antes ya no están
  click($('[data-act="task"]', cards().find((c) => /Chasis/.test(c.textContent))));
  eq("«Abrir tarea» va a la tarea", opened, ["T3"]);
  click($('[data-act="download"]', sop2));
  await tick(5);
  eq("«Descargar» baja el STEP si lo hay (si no, el archivo de Inventor)", downloads, ["a2"]);
  click($('[data-dl="native:0"]', sop2));
  await tick(5);
  eq("… y cada archivo de la tarjeta se descarga con un clic", downloads, ["a2", "a1"]);
  // ver y medir: abre el visor
  click($('[data-act="view"]', sop2));
  await tick(5);
  check("«👁️ Ver y medir 3D» abre el visor con el STEP de la pieza", !!$(".cad-viewer-overlay") && /Soporte_26001/.test($(".cad-viewer-title").textContent));
  $(".cad-viewer-close").click();
  click($('[data-act="view"]', brida2));
  await tick(5);
  check("… en una pieza sin STEP, el visor pide el .STEP", /Falta el modelo 3D \(\.STEP\) de «Brida\.iam»/.test(($(".cad-viewer-need") || {}).textContent || ""));
  $(".cad-viewer-close").click();
  let local = null;
  const origClick = window.HTMLInputElement.prototype.click;
  window.HTMLInputElement.prototype.click = function () { local = this; };
  click($("#pv-local", host));
  check("«📂 Abrir .STEP/.STP local» abre un selector de .step/.stp", local && local.accept === ".step,.stp");
  Object.defineProperty(local, "files", { value: [new File(["x"], "Suelta.step")] });
  fire(local, "change");
  await tick(5);
  check("… y abre ese archivo suelto en el visor, sin subirlo a ningún sitio", /Suelta\.step/.test($(".cad-viewer-subtitle").textContent));
  $(".cad-viewer-close").click();
  window.HTMLInputElement.prototype.click = origClick;
  URL.createObjectURL = origCreate;
  renderPartsViewerView(host, { parts: [], state: undefined, onStateChange() {}, onOpenTask() {}, storage, projects });
  check("sin archivos CAD: mensaje explicativo", /Todavía no hay archivos CAD/.test($(".parts-viewer-empty", host).textContent));
  host.remove();
}

// ---------------------------------------------------------------- 7) entrega
{
  const idx = read("index.html");
  eq("index.html: los 14 <link> a ?v=90", (idx.match(/css\/[\w-]+\.css\?v=90/g) || []).length, 14);
  check("index.html: ningún <link> se ha quedado en otra versión", !/\.css\?v=(?!90)\d+/.test(idx));
  check("package.json y package-lock.json: 90.0.0", JSON.parse(read("package.json")).version === "90.0.0" && JSON.parse(read("package-lock.json")).version === "90.0.0");
  const pkg = JSON.parse(read("package.json"));
  check("package.json: three y occt-import-js solo como devDependencies (para las pruebas; la app los carga del CDN)", !pkg.dependencies && pkg.devDependencies.three && pkg.devDependencies["occt-import-js"]);
  const { RELEASES } = await import("../js/whats-new.js");
  const r = RELEASES[0];
  check("Novedades: entrada 90 la primera, mayor que la 89, sobre visor 3D, medir, STEP y Visualizador de piezas", r.id === 90 && r.id > RELEASES[1].id && /3D/.test(r.title) && /Punto a Punto/.test(JSON.stringify(r)) && /Cara a Cara/.test(JSON.stringify(r)) && /Visualizador de piezas/.test(JSON.stringify(r)) && /\.STEP/.test(JSON.stringify(r)) && r.items.length >= 5, r.title);
  const rules = read("firestore.rules");
  check("firestore.rules: bloque meta/partsViewerAccess (lectura cuenta activa, escritura admin, forma exacta) y sin tocar el de Pedidos", /match \/meta\/partsViewerAccess \{[^}]*allow read: if isActiveUser\(\);[^}]*allow create, update: if isAdmin\(\)[^}]*hasOnly\(\['allowedDepartments', 'updatedBy', 'updatedAt'\]\)/s.test(rules) && /match \/meta\/ordersAccess \{/.test(rules));
  const css = [read("css/07-modals.css"), read("css/06-list-board.css")].join("\n");
  check("CSS: .cad-viewer-* y .parts-viewer-* (con variables de tema, sin colores de tema fijos en el cromo)", [".cad-viewer-overlay", ".cad-viewer-toolbar", ".cad-viewer-stage", ".cad-viewer-panel", ".cad-viewer-label", ".cad-viewer-marker", ".cad-assistant", ".parts-viewer-grid", ".parts-viewer-card", ".parts-viewer-badge--ok", ".parts-viewer-badge--warn"].every((c) => css.includes(c)) && /\.cad-viewer-window \{[^}]*var\(--color-panel\)/.test(css) && /data-theme="light"\] \.cad-viewer-stage/.test(css));
  const app = read("js/app.js");
  check("app.js: enruta «parts-viewer» (permiso, selección, restauración, vista, suscripción y limpieza al salir)", /canViewPartsViewer/.test(app) && /function selectPartsViewer/.test(app) && /saved\.mode === "parts-viewer"/.test(app) && /renderPartsViewerView/.test(app) && /subscribeToPartsViewerAccess/.test(app) && /unsubPartsViewerAccess = null/.test(app) && /partsViewerAccess: partsViewerAllowed/.test(app) && /indexUploadedCadParts/.test(app));
  check("task-modal.js: pasa la ubicación, el proyecto y el pool de adjuntos CAD a los adjuntos", /getLocation: currentFolderLocation/.test(read("js/components/task-modal.js")) && /getAttachmentsPool/.test(read("js/components/task-modal.js")) && /getProjectAttachments: getProjectCadAttachments/.test(app));
  const html = [read("js/cad-viewer.js"), read("js/cad-engine.js"), read("js/cad-model.js"), read("js/components/cad-viewer-modal.js"), read("js/components/cad-upload-assistant.js"), read("js/views/parts-viewer-view.js"), read("js/parts-viewer.js")].join("\n");
  check("sin TODO ni placeholders en los módulos nuevos", !/\bTODO\b|FIXME|XXX:|placeholder\(/.test(html.replace(/placeholder="[^"]*"/g, "")));
  check("los imports de los módulos nuevos son relativos y con extensión .js", [...html.matchAll(/from "(\.[^"]+)"/g)].every((m) => m[1].endsWith(".js")));
  check("el motor se carga SOLO bajo demanda: ningún import estático de Three.js ni de occt-import-js en js/", !/from "(three|https?:[^"]*three[^"]*)"/.test(html) && !/^\s*import\s+[^\n]*occt/m.test(html) && /import\(\/\* @vite-ignore \*\/ url\)/.test(html) && /three@\$\{T\}/.test(html) && /occt-import-js@\$\{O\}/.test(html));
  check("versiones fijas en el CDN: three 0.160.0 y occt-import-js 0.0.23", eng.CAD_LIB_VERSIONS.three === "0.160.0" && eng.CAD_LIB_VERSIONS.occt === "0.0.23" && eng.CAD_THREE_PROVIDERS.every((p) => /0\.160\.0/.test(p.three) && /0\.160\.0/.test(p.controls)) && eng.CAD_OCCT_PROVIDERS.every((p) => /0\.0\.23/.test(p.base)));
  const readme = read("README.md");
  check("README: apartado 3.23 del visor CAD, historial v89 → v90 y los archivos nuevos", /### 3\.23 Visor CAD 3D/.test(readme) && /v89 → v90 \(Chusy-90\.zip\)/.test(readme) && /cad-viewer\.js/.test(readme) && /convertir-step/.test(readme) && /meta\/partsViewerAccess/.test(readme) && /parts-viewer-view\.js/.test(readme));
  const runAll = read("tests/run-all.mjs");
  check("tests/run-all.mjs recoge los *.test.mjs y menciona la v90", /\.test\.mjs/.test(runAll) && /v90/.test(runAll));
  const integ = spawnSync(process.execPath, [new URL("../scripts/check-integrity.mjs", import.meta.url).pathname], { encoding: "utf8" });
  check("node scripts/check-integrity.mjs: integridad correcta", integ.status === 0 && /OK: integridad correcta/.test(integ.stdout), integ.stdout + integ.stderr);
}

done("v90 · Visor CAD 3D, mediciones Punto a Punto y Cara a Cara, ayudante .STEP y «Visualizador de piezas»");
