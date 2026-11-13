// ============================================================================
// Visualizador CAD 3D industrial (v90) — LÓGICA PURA: sin DOM, sin Firebase, sin Three.js y sin red.
// Todo lo que se puede probar en Node sin simular nada vive aquí; el motor 3D (carga de Three.js y de
// occt-import-js, construcción de la malla) está en cad-engine.js y cad-model.js, y la interfaz en
// components/cad-viewer-modal.js, components/cad-upload-assistant.js y views/parts-viewer-view.js.
//
// Qué hay en este archivo:
//   1. Reconocer archivos CAD y emparejar el modelo nativo de Inventor (.ipt/.iam) con su STEP (.step/.stp).
//   2. Medidas: Punto a Punto y Cara a Cara (espesores, distancia normal entre caras paralelas, distancia mínima y
//      ángulo), más el «snap» a vértice/arista, la agrupación de triángulos coplanares (cuando el STEP no trae caras
//      B-Rep) y la descripción de una cara a partir de sus triángulos.
//   3. Vistas rápidas, distancia de encuadre y textos de las cotas.
//   4. El enlace `chusy-step://` y el comando de PowerShell del ayudante que convierte UN .ipt/.iam a .STEP
//      (assets/convertir-step/), y el reparto de un lote de subida (qué archivos esperan a su STEP).
//
// Unidades: milímetros (occt-import-js entrega las coordenadas del STEP en mm). Un punto es `[x, y, z]` o `{x, y, z}`.
// ============================================================================
import { normalizeLocation } from "./location.js";

// ---------------------------------------------------------------------------
// 1. Formatos CAD y emparejamiento .ipt/.iam ↔ .step/.stp
// ---------------------------------------------------------------------------

export const CAD_EXTENSIONS = Object.freeze(["step", "stp", "ipt", "iam"]);
const DIRECT_3D_EXTENSIONS = Object.freeze(["step", "stp"]);
const INVENTOR_EXTENSIONS = Object.freeze(["ipt", "iam"]);

/** `'step' | 'stp' | 'ipt' | 'iam'` (en minúsculas) según el final del nombre, o `null` si no es un formato CAD. */
export function getCadExtension(name) {
  const m = /\.([A-Za-z0-9]{1,10})\s*$/.exec(String(name ?? ""));
  const ext = m ? m[1].toLowerCase() : "";
  return CAD_EXTENSIONS.includes(ext) ? ext : null;
}

export function isCadFileName(name) {
  return getCadExtension(name) !== null;
}

/** `true` para `.step` y `.stp`: se pueden dibujar en 3D tal cual. */
export function isDirect3dCadFile(name) {
  return DIRECT_3D_EXTENSIONS.includes(getCadExtension(name));
}

/** `true` para `.ipt` (pieza) y `.iam` (conjunto) de Autodesk Inventor: hace falta su STEP para verlos en 3D. */
export function isInventorNativeFile(name) {
  return INVENTOR_EXTENSIONS.includes(getCadExtension(name));
}

/** El nombre sin ruta y sin la(s) extensión(es) CAD, con el texto original (mayúsculas incluidas): «Soporte_26001.ipt.stp» → «Soporte_26001». */
export function getCadDisplayName(name) {
  let s = String(name ?? "").replace(/[\u0000-\u001f]/g, "").trim().replace(/^.*[\\/]/, "");
  const ext = getCadExtension(s);
  if (ext) s = s.slice(0, -(ext.length + 1));
  // El script de exportación de la oficina técnica deja «Pieza.ipt.stp» si no se renombra: el «.ipt» interior tampoco es parte del nombre.
  const inner = getCadExtension(s);
  if (ext && inner && isInventorNativeFile(s)) s = s.slice(0, -(inner.length + 1));
  return s.trim();
}

/**
 * La referencia con la que se emparejan los archivos de una misma pieza: el nombre sin ruta ni extensión, sin
 * distinguir mayúsculas ni espacios de más. `Soporte_26001.ipt`, `soporte_26001.STEP` y `Soporte_26001.ipt.stp` dan
 * la misma referencia (`soporte_26001`). Un nombre vacío da "".
 */
export function getCadBaseReference(name) {
  return getCadDisplayName(name).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * El STEP gemelo de un adjunto nativo de Inventor.
 *
 * @param targetAttachment  `{ id?, name, taskId?, projectId? }` — solo tiene gemelo un `.ipt` o `.iam`; con cualquier
 *                          otra cosa devuelve `null`.
 * @param attachmentsPool   adjuntos entre los que buscar (cada uno con `name` y, si se conocen, `taskId` y `projectId`).
 * @returns el adjunto `.step`/`.stp` con la misma referencia, o `null`. Se prefiere el de la MISMA TAREA, luego el del
 *          mismo proyecto (los que no son de ninguno de los dos se descartan cuando se sabe de dónde es cada uno);
 *          a igualdad, el subido más tarde y, si empatan, `.step` antes que `.stp`.
 */
export function findCompanionStepAttachment(targetAttachment, attachmentsPool) {
  const target = targetAttachment || {};
  if (!isInventorNativeFile(target.name)) return null;
  const wanted = getCadBaseReference(target.name);
  if (!wanted) return null;
  const candidates = [];
  (Array.isArray(attachmentsPool) ? attachmentsPool : []).forEach((a, order) => {
    if (!a || a === target || (target.id && a.id === target.id)) return;
    if (!isDirect3dCadFile(a.name) || getCadBaseReference(a.name) !== wanted) return;
    let rank;
    if (target.taskId && a.taskId) {
      if (target.taskId === a.taskId) rank = 0;
      else if (target.projectId && a.projectId && target.projectId === a.projectId) rank = 1;
      else return;
    } else if (target.projectId && a.projectId) {
      if (target.projectId === a.projectId) rank = 1; else return;
    } else {
      rank = 0; // sin datos de procedencia: todo lo que hay en el pool es «de aquí»
    }
    candidates.push({ a, rank, order, uploaded: Date.parse(a.uploadedAt || "") || 0, step: getCadExtension(a.name) === "step" ? 0 : 1 });
  });
  candidates.sort((x, y) => x.rank - y.rank || y.uploaded - x.uploaded || x.step - y.step || x.order - y.order);
  return candidates.length ? candidates[0].a : null;
}

/**
 * Reparte un lote de archivos que se van a subir: los `.ipt`/`.iam` cuyo STEP gemelo no viaja en el mismo lote ni está ya
 * adjunto a la tarea esperan a que se resuelva (`needsStep`); todo lo demás se sube ya (`ready`). Trabaja con objetos que
 * tengan `name` (un `File`, un adjunto…); `existingAttachments` son los adjuntos que la tarea ya tiene.
 */
export function partitionUploadBatch(files, existingAttachments) {
  const list = Array.from(files || []).filter(Boolean);
  const have = new Set();
  list.concat(Array.isArray(existingAttachments) ? existingAttachments : []).forEach((f) => {
    if (f && isDirect3dCadFile(f.name)) have.add(getCadBaseReference(f.name));
  });
  const ready = [];
  const needsStep = [];
  list.forEach((f) => (isInventorNativeFile(f.name) && !have.has(getCadBaseReference(f.name)) ? needsStep : ready).push(f));
  return { ready, needsStep };
}

// ---------------------------------------------------------------------------
// 2. Medidas
// ---------------------------------------------------------------------------

/** Redondeo a 2 decimales, simétrico para los negativos y sin «-0». */
export function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const v = Math.sign(x) * (Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100);
  return v === 0 ? 0 : v;
}

function toVec(p, what = "punto") {
  const v = Array.isArray(p) || ArrayBuffer.isView(p) ? [Number(p[0]), Number(p[1]), Number(p[2])] : p && typeof p === "object" ? [Number(p.x), Number(p.y), Number(p.z)] : [NaN, NaN, NaN];
  if (!v.every(Number.isFinite)) throw new TypeError(`Medida: ${what} no válido (se esperaba [x, y, z] o {x, y, z} con números).`);
  return v;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const dist = (a, b) => len(sub(a, b));
function unit(a) {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : null;
}

/**
 * Medida Punto a Punto. Devuelve `{ distanceMm, deltaX, deltaY, deltaZ }`: la distancia euclídea √(ΔX²+ΔY²+ΔZ²) y las
 * diferencias B − A en cada eje (con signo), todo en mm y a 2 decimales.
 */
export function computePointToPointMeasurement(pointA, pointB) {
  const a = toVec(pointA, "el punto A");
  const b = toVec(pointB, "el punto B");
  const d = sub(b, a);
  return { distanceMm: round2(len(d)), deltaX: round2(d[0]), deltaY: round2(d[1]), deltaZ: round2(d[2]) };
}

const PARALLEL_DOT = 0.995;
const PLANAR_DOT = 0.99996; // ≈ 0,5°: por encima de esto todas las normales de la cara son «la misma»

/** Una cara B-Rep descrita por lo justo para medirla (ver buildFaceDescriptor). */
function readFace(face, name) {
  if (!face || typeof face !== "object") throw new TypeError(`Medida: ${name} no válida.`);
  const rawVerts = Array.isArray(face.vertices) ? face.vertices : [];
  const vertices = rawVerts.map((v) => toVec(v, `un vértice de ${name}`));
  const centroid = face.centroid ? toVec(face.centroid, `el centroide de ${name}`) : vertices.length ? scale(vertices.reduce(add, [0, 0, 0]), 1 / vertices.length) : null;
  if (!centroid) throw new TypeError(`Medida: ${name} no tiene vértices ni centroide.`);
  const normal = unit(face.normal ? toVec(face.normal, `la normal de ${name}`) : [0, 0, 0]);
  if (!normal) throw new TypeError(`Medida: ${name} no tiene una normal válida.`);
  const triangles = Array.isArray(face.triangles) ? face.triangles : null;
  return { vertices, centroid, normal, triangles, isPlanar: face.isPlanar !== false };
}

/** El punto de un triángulo más cercano a `p` (Ericson, «Real-Time Collision Detection», 5.1.5). */
export function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

/** Trabajo máximo (pares punto-triángulo) por sentido antes de muestrear: caras de decenas de miles de triángulos siguen siendo instantáneas. */
const MAX_PAIR_WORK = 4_000_000;

/**
 * La distancia mínima entre dos caras: cada vértice de una contra los TRIÁNGULOS de la otra (si la cara los trae) y
 * viceversa — así dos caras paralelas desplazadas dan la distancia real y no la de dos vértices lejanos. Sin triángulos,
 * solo vértice contra vértice. Con caras enormes se muestrean los vértices (`approximate: true`).
 */
function closestPointsBetweenFaces(fa, fb) {
  let best = { d: Infinity, a: null, b: null };
  let approximate = false;
  const against = (from, to, flip) => {
    const targets = to.triangles && to.triangles.length ? to.triangles : null;
    const work = from.vertices.length * (targets ? targets.length : to.vertices.length);
    const stride = Math.max(1, Math.ceil(work / MAX_PAIR_WORK));
    if (stride > 1) approximate = true;
    for (let i = 0; i < from.vertices.length; i += stride) {
      const p = from.vertices[i];
      if (targets) {
        for (const t of targets) {
          const q = closestPointOnTriangle(p, to.vertices[t[0]], to.vertices[t[1]], to.vertices[t[2]]);
          const d = dist(p, q);
          if (d < best.d) best = flip ? { d, a: q, b: p } : { d, a: p, b: q };
        }
      } else {
        for (const q of to.vertices) {
          const d = dist(p, q);
          if (d < best.d) best = flip ? { d, a: q, b: p } : { d, a: p, b: q };
        }
      }
    }
  };
  against(fa, fb, false);
  against(fb, fa, true);
  return { ...best, approximate };
}

/**
 * Medida Cara a Cara. Cada cara es `{ vertices, normal, centroid, triangles?, isPlanar? }` en coordenadas de mundo
 * (ver buildFaceDescriptor). Devuelve, en mm y a 2 decimales (el ángulo en grados):
 *   isParallel         |nA·nB| ≥ 0,995 (y las dos caras son planas)
 *   normalDistanceMm   distancia perpendicular de plano a plano |(C_B − C_A)·n_A| — el espesor de una chapa, la luz entre bridas…
 *   minDistanceMm      distancia mínima real entre los puntos de las dos caras
 *   primaryDistanceMm  la normal si son paralelas; si no, la mínima
 *   angleDeg           ángulo agudo entre los dos planos, en 0°–90° (0° paralelas u opuestas, 90° perpendiculares)
 *   lineStart/lineEnd  los extremos de la línea de cota que se dibuja
 *   minPointA/minPointB los dos puntos más cercanos entre sí
 */
export function computeFaceToFaceMeasurement(faceA, faceB) {
  const a = readFace(faceA, "la cara 1");
  const b = readFace(faceB, "la cara 2");
  const nDot = dot(a.normal, b.normal);
  const isParallel = Math.abs(nDot) >= PARALLEL_DOT && a.isPlanar && b.isPlanar;
  const between = sub(b.centroid, a.centroid);
  const signedNormal = dot(between, a.normal);
  const normalDistance = Math.abs(signedNormal);
  const closest = closestPointsBetweenFaces(a, b);
  const minDistance = Number.isFinite(closest.d) ? closest.d : dist(a.centroid, b.centroid);
  const minPointA = closest.a || a.centroid;
  const minPointB = closest.b || b.centroid;
  const angle = (Math.acos(Math.min(1, Math.abs(nDot))) * 180) / Math.PI;
  const lineStart = isParallel ? a.centroid : minPointA;
  const lineEnd = isParallel ? add(a.centroid, scale(a.normal, signedNormal)) : minPointB;
  return {
    isParallel,
    normalDistanceMm: round2(normalDistance),
    minDistanceMm: round2(minDistance),
    primaryDistanceMm: round2(isParallel ? normalDistance : minDistance),
    angleDeg: round2(angle),
    angleRangeDeg: [0, 90],
    lineStart,
    lineEnd,
    minPointA,
    minPointB,
    approximate: closest.approximate,
  };
}

/**
 * Una cara a partir de sus triángulos: `positions` es una lista plana de coordenadas de mundo, 9 números por triángulo
 * (A, B, C). Junta los vértices repetidos y calcula la normal media (ponderada por superficie), el centroide de la
 * superficie, el área y si es plana. Una cara curva cerrada (un cilindro entero) no tiene una normal media útil: se queda
 * con la de su primer triángulo y `isPlanar` vale `false`, para no dar por paralelas dos caras que no lo son.
 */
export function buildFaceDescriptor(positions, { faceId = null, tolerance = 1e-4 } = {}) {
  const n = Math.floor((positions ? positions.length : 0) / 9);
  const index = new Map();
  const vertices = [];
  const triangles = [];
  const key = (x, y, z) => `${Math.round(x / tolerance)}|${Math.round(y / tolerance)}|${Math.round(z / tolerance)}`;
  const vertexId = (x, y, z) => {
    const k = key(x, y, z);
    let id = index.get(k);
    if (id === undefined) { id = vertices.length; index.set(k, id); vertices.push([x, y, z]); }
    return id;
  };
  let normalSum = [0, 0, 0];
  let area = 0;
  let centroidSum = [0, 0, 0];
  const triNormals = [];
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const A = [positions[o], positions[o + 1], positions[o + 2]];
    const B = [positions[o + 3], positions[o + 4], positions[o + 5]];
    const C = [positions[o + 6], positions[o + 7], positions[o + 8]];
    if (![...A, ...B, ...C].every(Number.isFinite)) continue;
    triangles.push([vertexId(...A), vertexId(...B), vertexId(...C)]);
    const cr = cross(sub(B, A), sub(C, A)); // |cr| = 2 · área
    const tArea = len(cr) / 2;
    normalSum = add(normalSum, cr);
    area += tArea;
    centroidSum = add(centroidSum, scale(add(add(A, B), C), tArea / 3));
    if (tArea > 1e-12) triNormals.push({ n: scale(cr, 1 / (2 * tArea)), a: tArea });
  }
  let normal = unit(normalSum);
  let isPlanar = !!normal && triNormals.every((t) => Math.abs(dot(t.n, normal)) >= PLANAR_DOT);
  if (!normal) { normal = triNormals.length ? triNormals[0].n : [0, 0, 1]; isPlanar = false; }
  const centroid = area > 1e-12 ? scale(centroidSum, 1 / area) : vertices.length ? scale(vertices.reduce(add, [0, 0, 0]), 1 / vertices.length) : [0, 0, 0];
  return { faceId, vertices, triangles, normal, centroid, area, isPlanar, triangleCount: triangles.length };
}

/**
 * El «snap» de Punto a Punto: de un punto de impacto sobre un triángulo `[A, B, C]`, el vértice más cercano si está a
 * `radius` o menos; si no, el punto más cercano de una arista dentro de ese radio; si no, el propio punto del impacto.
 * Devuelve `{ point, kind: 'vertex' | 'edge' | 'surface' }`.
 */
export function snapPointToTriangle(hit, triangle, radius) {
  const p = toVec(hit, "el punto de impacto");
  const tri = (triangle || []).map((v) => toVec(v, "un vértice del triángulo"));
  const r = Number.isFinite(radius) && radius > 0 ? radius : 0;
  if (tri.length !== 3 || !r) return { point: p, kind: "surface" };
  let bestV = null;
  tri.forEach((v) => { const d = dist(p, v); if (d <= r && (!bestV || d < bestV.d)) bestV = { d, v }; });
  if (bestV) return { point: bestV.v, kind: "vertex" };
  let bestE = null;
  for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i + 1) % 3];
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 > 1e-18 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
    const q = add(a, scale(ab, t));
    const d = dist(p, q);
    if (d <= r && (!bestE || d < bestE.d)) bestE = { d, q };
  }
  return bestE ? { point: bestE.q, kind: "edge" } : { point: p, kind: "surface" };
}

/**
 * Agrupa los triángulos de una malla en caras lógicas cuando el STEP no trae caras B-Rep: dos triángulos que comparten una
 * arista y son COPLANARES (normales a menos de ~0,5° y el mismo plano a `planeTolerance` mm) pertenecen a la misma cara.
 * `positions` y `indices` son los de la malla (xyz por vértice, 3 índices por triángulo). Devuelve una lista de caras,
 * cada una con los índices de sus triángulos, en el orden del primer triángulo de cada una.
 */
export function groupCoplanarTriangles(positions, indices, { tolerance = 1e-4, planeTolerance = 0.02 } = {}) {
  const triCount = Math.floor((indices ? indices.length : 0) / 3);
  const merged = new Map();
  const vid = new Int32Array(Math.floor((positions ? positions.length : 0) / 3));
  for (let i = 0; i < vid.length; i++) {
    const k = `${Math.round(positions[3 * i] / tolerance)}|${Math.round(positions[3 * i + 1] / tolerance)}|${Math.round(positions[3 * i + 2] / tolerance)}`;
    let id = merged.get(k);
    if (id === undefined) { id = merged.size; merged.set(k, id); }
    vid[i] = id;
  }
  const normals = new Array(triCount);
  const offsets = new Float64Array(triCount);
  const parent = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    parent[t] = t;
    const i0 = indices[3 * t], i1 = indices[3 * t + 1], i2 = indices[3 * t + 2];
    const A = [positions[3 * i0], positions[3 * i0 + 1], positions[3 * i0 + 2]];
    const B = [positions[3 * i1], positions[3 * i1 + 1], positions[3 * i1 + 2]];
    const C = [positions[3 * i2], positions[3 * i2 + 1], positions[3 * i2 + 2]];
    const nrm = unit(cross(sub(B, A), sub(C, A)));
    normals[t] = nrm;
    offsets[t] = nrm ? dot(nrm, A) : 0;
  }
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const edgeOwner = new Map();
  for (let t = 0; t < triCount; t++) {
    if (!normals[t]) continue;
    for (let e = 0; e < 3; e++) {
      const a = vid[indices[3 * t + e]], b = vid[indices[3 * t + ((e + 1) % 3)]];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = edgeOwner.get(k);
      if (other === undefined) { edgeOwner.set(k, t); continue; }
      if (Math.abs(dot(normals[t], normals[other])) >= PLANAR_DOT && Math.abs(offsets[t] - Math.sign(dot(normals[t], normals[other])) * offsets[other]) <= planeTolerance) {
        parent[find(t)] = find(other);
      }
    }
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const root = find(t);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// 3. Vistas, encuadre y textos
// ---------------------------------------------------------------------------

export const CAD_VIEW_NAMES = Object.freeze(["iso", "front", "top", "side"]);
export const CAD_VIEW_LABELS = Object.freeze({ iso: "Isométrica", front: "Frontal", top: "Planta", side: "Perfil" });
export const CAD_UP_AXES = Object.freeze(["y", "z"]);

/**
 * La dirección (vector unitario, del modelo a la cámara) de cada vista rápida. Con el eje vertical Y (el de Inventor por
 * defecto): Frontal mira por Z, Planta desde +Y y Perfil desde +X. Con Z vertical (SolidWorks, Creo…): Frontal mira por
 * −Y, Planta desde +Z y Perfil desde +X.
 */
export function cadViewDirection(view, upAxis = "y") {
  const zUp = upAxis === "z";
  const dirs = zUp
    ? { iso: [1, -1, 1], front: [0, -1, 0], top: [0, 0, 1], side: [1, 0, 0] }
    : { iso: [1, 1, 1], front: [0, 0, 1], top: [0, 1, 0], side: [1, 0, 0] };
  const d = dirs[view] || dirs.iso;
  return unit(d);
}

/** El vector «arriba» del mundo para un eje vertical (`'y'` por defecto, o `'z'`). */
export function cadUpVector(upAxis = "y") {
  return upAxis === "z" ? [0, 0, 1] : [0, 1, 0];
}

/** A qué distancia poner la cámara para que una esfera de `radius` mm quepa entera en pantalla (FOV vertical en grados). */
export function computeFitDistance(radius, fovDeg = 45, aspect = 1, margin = 1.15) {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const fov = Number.isFinite(fovDeg) ? fovDeg : 45;
  const halfV = (Math.max(1, Math.min(170, fov)) * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1));
  return (r * margin) / Math.sin(Math.min(halfV, halfH));
}

export function formatMm(value) {
  return `${round2(value).toFixed(2)} mm`;
}

/** «X: 120.00 mm × Y: 45.50 mm × Z: 3.00 mm» — las cotas envolventes de la pieza. */
export function formatBoundingBoxMm(size) {
  const s = Array.isArray(size) ? size : [size && size.x, size && size.y, size && size.z];
  return `X: ${formatMm(s[0])} × Y: ${formatMm(s[1])} × Z: ${formatMm(s[2])}`;
}

/** El texto de una medida Punto a Punto. */
export function describePointToPoint(m) {
  return `Punto a Punto: ${formatMm(m.distanceMm)}`;
}

/** El texto de la etiqueta de una medida Cara a Cara: «Cara a Cara: 3.00 mm» y, aparte, «Paralelas · 0.0°» o «Inclinadas · 35.0°». */
export function describeFaceToFace(m) {
  return {
    label: `Cara a Cara: ${formatMm(m.primaryDistanceMm)}`,
    angle: `${m.isParallel ? "Paralelas" : "Inclinadas"} · ${m.angleDeg.toFixed(1)}°`,
  };
}

// ---------------------------------------------------------------------------
// 4. El ayudante de Windows «chusy-step:» (assets/convertir-step/)
// ---------------------------------------------------------------------------

/** Protocolo que registra el ayudante (assets/convertir-step/Instalar-ConvertirStep.bat). */
export const CONVERT_STEP_PROTOCOL = "chusy-step";

const cleanText = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();

/** Una ruta o nombre de la entrada del usuario: sin comillas envolventes, sin espacios ni control. */
function cleanPathInput(raw) {
  const n = normalizeLocation(cleanText(raw));
  return n.kind === "folder" ? n.value : "";
}

/** `{ filePath, fileName, searchRoot }` ya validados para el ayudante, o `null` si no hay un `.ipt`/`.iam` al que apuntar. */
function resolveConvertTarget({ filePath, fileName, projectLocation } = {}) {
  const full = cleanPathInput(filePath);
  if (full && isInventorNativeFile(full)) return { filePath: full, fileName: "", searchRoot: "" };
  const name = cleanText(fileName).replace(/^.*[\\/]/, "");
  if (!name || !isInventorNativeFile(name)) return null;
  return { filePath: "", fileName: name, searchRoot: cleanPathInput(projectLocation) };
}

/**
 * El enlace que entiende el ayudante: `chusy-step://convert?file=<ruta completa o nombre>&searchRoot=<carpeta>`.
 * Con la ruta completa del `.ipt`/`.iam` solo va `file`; con solo el nombre, `searchRoot` (la ubicación del proyecto)
 * es la carpeta donde el ayudante buscará ESE nombre exacto. Devuelve "" si no hay un `.ipt`/`.iam` válido.
 */
export function buildConvertStepProtocolUrl(input) {
  const t = resolveConvertTarget(input);
  if (!t) return "";
  const file = t.filePath || t.fileName;
  return `${CONVERT_STEP_PROTOCOL}://convert?file=${encodeURIComponent(file)}${t.searchRoot ? `&searchRoot=${encodeURIComponent(t.searchRoot)}` : ""}`;
}

/** Un texto entre comillas simples para PowerShell (las comillas simples, también las «tipográficas», se duplican). */
function psQuote(text) {
  return `'${String(text).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c)}'`;
}

/**
 * El mismo trabajo como comando para pegar en una ventana de PowerShell (por si el navegador no puede lanzar el enlace).
 * "" si no hay un `.ipt`/`.iam` válido.
 */
export function buildConvertStepPowerShellCommand(input) {
  const t = resolveConvertTarget(input);
  if (!t) return "";
  const script = '& "$env:LOCALAPPDATA\\Chusy\\convertir-step.ps1"';
  return t.filePath
    ? `${script} -FilePath ${psQuote(t.filePath)}`
    : `${script} -FileName ${psQuote(t.fileName)}${t.searchRoot ? ` -SearchRoot ${psQuote(t.searchRoot)}` : ""}`;
}

// ---------------------------------------------------------------------------
// 5. Rejilla
// ---------------------------------------------------------------------------

/** La rejilla del visor para una pieza de `extentMm` de lado mayor: paso «redondo» (1, 2 o 5 × 10ⁿ mm), unas 20 casillas y algo más ancha que la pieza. */
export function computeGridSpec(extentMm) {
  const e = Math.max(1, Number(extentMm) || 1) * 1.6;
  const raw = e / 20;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
  const divisions = Math.max(2, Math.ceil(e / step));
  return { step, divisions, size: step * divisions };
}
