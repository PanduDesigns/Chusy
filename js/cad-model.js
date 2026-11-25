// ============================================================================
// Modelo 3D del visor (v90): del resultado de occt-import-js a una malla de Three.js con sus CARAS LÓGICAS.
//
// Three.js NO se importa aquí (se carga bajo demanda desde un CDN, ver cad-engine.js): cada función recibe el espacio de
// nombres `THREE` como primer parámetro. Así este archivo se prueba en Node con el paquete `three` de npm y un STEP real.
//
// Caras. Cada `mesh.brep_faces` de occt-import-js dice, por cada cara B-Rep, desde qué triángulo hasta cuál (ambos
// incluidos) la forman; se conserva tal cual para poder seleccionar y resaltar una cara ENTERA al hacer clic. Si el STEP
// no las trae (o faltan triángulos por cubrir), se agrupan los triángulos coplanares contiguos (cad-viewer.js,
// groupCoplanarTriangles). Cada cara recibe un `faceId` único en todo el modelo.
//
// v94 · Piezas complejas (ensamblajes). occt-import-js devuelve UNA malla por cada instancia de pieza: un ensamblaje de 20 MB son 5.900 mallas
// y 1,2 millones de triángulos, o sea ~12.000 llamadas de dibujo (malla + aristas) por fotograma: la navegación va a saltos. Para eso:
//   · planCadBuild decide qué se construye: la VISTA SIMPLIFICADA muestra primero las piezas grandes hasta un presupuesto de triángulos
//     y deja fuera la tornillería y las piezas diminutas (siguen en memoria: extendCadModel las añade con «Mostrar todo»);
//   · las mallas pequeñas se FUSIONAN en trozos espaciales (orden de Morton, ~80.000 triángulos): unas decenas de llamadas en vez de miles,
//     y el rayo de los clics sigue descartando trozos enteros por su esfera envolvente;
//   · las aristas de un modelo grande salen de los BORDES de cada cara B-Rep (cuesta una pasada por los triángulos) en vez de
//     EdgesGeometry (que compara ángulos y construye cadenas de texto por vértice);
//   · buildCadModelAsync construye por tandas cediendo el hilo al navegador, para poder enseñar el avance y cancelar.
// Con pocos triángulos todo funciona exactamente como antes (una malla = una pieza, aristas por ángulo).
// ============================================================================
import { buildFaceDescriptor, groupCoplanarTriangles, snapPointToTriangle } from "./cad-viewer.js";

const NO_FACE = 0xffffffff;

/** Los triángulos de una malla repartidos en caras: `[{ triangles: number[] }]`. */
function splitIntoFaces(mesh, positions, indices, triCount) {
  const faces = [];
  const owner = new Uint32Array(triCount).fill(NO_FACE);
  (Array.isArray(mesh.brep_faces) ? mesh.brep_faces : []).forEach((range) => {
    const first = Number(range && range.first);
    const last = Number(range && range.last);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= triCount) return;
    const triangles = [];
    for (let t = first; t <= last; t++) if (owner[t] === NO_FACE) { owner[t] = faces.length; triangles.push(t); }
    if (triangles.length) faces.push({ triangles, source: "brep" });
  });
  // Lo que ninguna cara B-Rep cubre (o todo, si el STEP no las trae): triángulos coplanares contiguos.
  const rest = [];
  for (let t = 0; t < triCount; t++) if (owner[t] === NO_FACE) rest.push(t);
  if (rest.length) {
    const sub = new Uint32Array(rest.length * 3);
    rest.forEach((t, i) => { sub[3 * i] = indices[3 * t]; sub[3 * i + 1] = indices[3 * t + 1]; sub[3 * i + 2] = indices[3 * t + 2]; });
    groupCoplanarTriangles(positions, sub).forEach((group) => faces.push({ triangles: group.map((i) => rest[i]), source: "coplanar" }));
  }
  return faces;
}

// ---------------------------------------------------------------------------
// v94 · Planificar qué se construye y cómo se agrupa
// ---------------------------------------------------------------------------

const arr = (a) => (a && a.length !== undefined ? a : []);

/** Por cada malla del resultado de occt-import-js: `{ index, tris, min, max, center, diag }` (caja envolvente en mm). Una pasada por los vértices. */
export function summarizeMeshes(occtResult) {
  const out = [];
  ((occtResult && occtResult.meshes) || []).forEach((m, index) => {
    const pos = m && m.attributes && m.attributes.position && m.attributes.position.array;
    const idx = m && m.index && m.index.array;
    if (!pos || !pos.length || !idx || idx.length < 3) return;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    out.push({
      index, tris: Math.floor(idx.length / 3), min: [x0, y0, z0], max: [x1, y1, z1],
      center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], diag: Math.hypot(x1 - x0, y1 - y0, z1 - z0),
    });
  });
  return out;
}

/** Código de Morton (orden espacial en Z) de un punto normalizado a 0..1023 por eje: las mallas cercanas en el espacio quedan seguidas. */
function morton3(x, y, z) {
  const spread = (v) => { v &= 0x3ff; v = (v | (v << 16)) & 0x030000ff; v = (v | (v << 8)) & 0x0300f00f; v = (v | (v << 4)) & 0x030c30c3; v = (v | (v << 2)) & 0x09249249; return v; };
  return (spread(x) | (spread(y) << 1) | (spread(z) << 2)) >>> 0;
}

export const CAD_BUILD_DEFAULTS = Object.freeze({
  chunkAbove: 250000,     // por encima de estos triángulos (o de CHUNK_MESHES mallas) se fusionan mallas pequeñas en trozos
  chunkMeshes: 400,
  chunkTriangles: 80000,  // tamaño objetivo de cada trozo
  simplifyAbove: 450000,  // por encima de esto, la vista simplificada deja fuera las piezas más pequeñas
  triangleBudget: 350000, // triángulos que enseña la vista simplificada
  keepFraction: 0.05,     // una pieza con la diagonal de al menos esta fracción de la del conjunto se muestra siempre
});

/** Agrupa mallas (en orden espacial) en trozos de ≈`chunkTriangles` triángulos; una malla más grande que eso va sola. */
function groupSummaries(list, bounds, chunkTriangles) {
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
  const norm = (v, k) => (size[k] > 0 ? Math.min(1023, Math.max(0, Math.floor(((v - bounds.min[k]) / size[k]) * 1023))) : 0);
  const sorted = list.slice().sort((a, b) => morton3(norm(a.center[0], 0), norm(a.center[1], 1), norm(a.center[2], 2)) - morton3(norm(b.center[0], 0), norm(b.center[1], 1), norm(b.center[2], 2)));
  const groups = [];
  let cur = [];
  let curTris = 0;
  const flush = () => { if (cur.length) groups.push(cur); cur = []; curTris = 0; };
  sorted.forEach((m) => {
    if (m.tris >= chunkTriangles) { flush(); groups.push([m.index]); return; }
    if (curTris + m.tris > chunkTriangles) flush();
    cur.push(m.index);
    curTris += m.tris;
  });
  flush();
  return groups;
}

/**
 * Decide cómo se construye un resultado de occt-import-js (ver la cabecera): `summaries` sale de summarizeMeshes. Devuelve
 *   { heavy, simplified, shown: [mallas], hidden: [mallas], groups: [[mallas…]], edgeMode: 'angle' | 'boundary',
 *     totalMeshes, totalTriangles, shownTriangles, bounds }
 * `heavy` = se fusiona en trozos y las aristas salen de los bordes de cara; `simplified` = hay piezas fuera (`hidden`).
 * Un modelo pequeño devuelve `heavy:false, simplified:false` y un grupo por malla (el comportamiento de siempre).
 */
export function planCadBuild(summaries, options = {}) {
  const o = { ...CAD_BUILD_DEFAULTS, ...options };
  const list = Array.isArray(summaries) ? summaries : [];
  const totalTriangles = list.reduce((n, m) => n + m.tris, 0);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  list.forEach((m) => { for (let k = 0; k < 3; k++) { if (m.min[k] < min[k]) min[k] = m.min[k]; if (m.max[k] > max[k]) max[k] = m.max[k]; } });
  const bounds = { min, max };
  const totalDiag = list.length ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
  const heavy = totalTriangles > o.chunkAbove || list.length > o.chunkMeshes;
  const simplified = totalTriangles > o.simplifyAbove;
  let shownList = list;
  if (simplified) {
    // Las más grandes primero hasta el presupuesto de triángulos; las que miden ≥ keepFraction del conjunto entran siempre.
    const bySize = list.slice().sort((a, b) => b.diag - a.diag);
    let used = 0;
    const keep = new Set();
    bySize.forEach((m) => {
      if (used + m.tris <= o.triangleBudget || m.diag >= o.keepFraction * totalDiag || !keep.size) { keep.add(m.index); used += m.tris; }
    });
    shownList = list.filter((m) => keep.has(m.index));
  }
  const shownSet = new Set(shownList.map((m) => m.index));
  const hidden = list.filter((m) => !shownSet.has(m.index)).map((m) => m.index);
  const groups = heavy ? groupSummaries(shownList, bounds, o.chunkTriangles) : shownList.map((m) => [m.index]);
  return {
    heavy, simplified: simplified && hidden.length > 0, shown: shownList.map((m) => m.index), hidden, groups,
    edgeMode: heavy ? "boundary" : "angle", totalMeshes: list.length, totalTriangles,
    shownTriangles: shownList.reduce((n, m) => n + m.tris, 0), bounds, options: o,
  };
}

/** Los grupos de unas mallas concretas (para «Mostrar todo»: las que estaban fuera), con los mismos criterios que el plan original. */
export function planGroupsFor(summaries, indices, options = {}) {
  const o = { ...CAD_BUILD_DEFAULTS, ...options };
  const set = new Set(indices);
  const subset = (summaries || []).filter((m) => set.has(m.index));
  if (!subset.length) return [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  subset.forEach((m) => { for (let k = 0; k < 3; k++) { if (m.min[k] < bounds.min[k]) bounds.min[k] = m.min[k]; if (m.max[k] > bounds.max[k]) bounds.max[k] = m.max[k]; } });
  return groupSummaries(subset, bounds, o.chunkTriangles);
}

/** Une varias mallas de occt-import-js en UNA (vértices e índices concatenados; los rangos `brep_faces` desplazados). */
export function mergeOcctMeshes(meshes) {
  const list = (meshes || []).filter((m) => m && m.attributes && m.attributes.position && m.attributes.position.array && m.index && m.index.array);
  let vCount = 0, iCount = 0, allNormals = true;
  list.forEach((m) => {
    vCount += m.attributes.position.array.length;
    iCount += m.index.array.length;
    const n = m.attributes.normal && m.attributes.normal.array;
    if (!n || n.length !== m.attributes.position.array.length) allNormals = false;
  });
  const position = new Float32Array(vCount);
  const normal = allNormals ? new Float32Array(vCount) : null;
  const index = new Uint32Array(iCount);
  const brepFaces = [];
  let vOff = 0, iOff = 0;
  list.forEach((m) => {
    const p = m.attributes.position.array;
    const ix = m.index.array;
    position.set(p, vOff);
    if (normal) normal.set(m.attributes.normal.array, vOff);
    const vBase = vOff / 3;
    const tBase = iOff / 3;
    for (let k = 0; k < ix.length; k++) index[iOff + k] = ix[k] + vBase;
    arr(m.brep_faces).forEach((f) => brepFaces.push({ first: f.first + tBase, last: f.last + tBase, color: f.color || null }));
    vOff += p.length;
    iOff += ix.length;
  });
  return { name: "merged", attributes: { position: { array: position }, ...(normal ? { normal: { array: normal } } : {}) }, index: { array: index }, brep_faces: brepFaces };
}

/** Segmentos (pares de puntos) de los BORDES de las caras B-Rep: las aristas que solo recorre un triángulo de su cara. Float32Array de 6 por segmento. */
export function boundaryEdgePositions(positions, index, faces) {
  const verts = positions.length / 3;
  const count = new Map();
  const ends = [];
  faces.forEach((f) => {
    const tris = f.triangles;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
      for (let e = 0; e < 3; e++) {
        const u = e === 0 ? a : e === 1 ? b : c;
        const w = e === 0 ? b : e === 1 ? c : a;
        const key = u < w ? u * verts + w : w * verts + u;
        const prev = count.get(key);
        if (prev === undefined) count.set(key, 1); else count.set(key, prev + 1);
        if (prev === undefined) ends.push(u, w);
      }
    }
  });
  const out = [];
  for (let k = 0; k < ends.length; k += 2) {
    const u = ends[k], w = ends[k + 1];
    if (count.get(u < w ? u * verts + w : w * verts + u) !== 1) continue;
    out.push(positions[3 * u], positions[3 * u + 1], positions[3 * u + 2], positions[3 * w], positions[3 * w + 1], positions[3 * w + 2]);
  }
  return new Float32Array(out);
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

/** Estado compartido de una construcción (la síncrona y la asíncrona usan exactamente las mismas funciones). */
function createBuildContext(THREE, { edgeAngle, color, edgeColor, edgeMode }) {
  const group = new THREE.Group();
  group.name = "cad-model";
  return {
    THREE, edgeAngle, edgeMode, group, parts: [], faces: [],
    material: new THREE.MeshStandardMaterial({
      color, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // empuja la malla hacia atrás: las aristas se ven limpias por delante
    }),
    edgeMaterial: new THREE.LineBasicMaterial({ color: edgeColor }),
  };
}

/** Añade una malla de occt-import-js (o una fusión de varias) como una pieza del modelo. Devuelve cuántos triángulos tiene (0 si no se añadió). */
function addPart(ctx, m) {
  const { THREE } = ctx;
  const pos = m && m.attributes && m.attributes.position && m.attributes.position.array;
  const idx = m && m.index && m.index.array;
  if (!pos || !pos.length || !idx || idx.length < 3) return 0;
  const partIndex = ctx.parts.length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const nrm = m.attributes.normal && m.attributes.normal.array;
  const hasNormals = !!nrm && nrm.length === pos.length;
  if (hasNormals) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  const index = idx instanceof Uint32Array ? idx : Uint32Array.from(idx);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  if (!hasNormals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const triCount = Math.floor(index.length / 3);
  const triToFace = new Uint32Array(triCount).fill(NO_FACE);
  const partFaces = [];
  splitIntoFaces(m, geometry.getAttribute("position").array, index, triCount).forEach((f) => {
    const id = ctx.faces.length;
    f.triangles.forEach((t) => { triToFace[t] = id; });
    const face = { id, partIndex, triangles: Uint32Array.from(f.triangles), source: f.source };
    ctx.faces.push(face);
    partFaces.push(face);
  });
  const mesh = new THREE.Mesh(geometry, ctx.material);
  mesh.userData.partIndex = partIndex;
  const allBrep = partFaces.length > 0 && partFaces.every((f) => f.source === "brep");
  let edgeGeometry;
  if (ctx.edgeMode === "boundary" && allBrep) {
    edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(boundaryEdgePositions(geometry.getAttribute("position").array, index, partFaces), 3));
  } else {
    edgeGeometry = new THREE.EdgesGeometry(geometry, ctx.edgeAngle);
  }
  const edges = new THREE.LineSegments(edgeGeometry, ctx.edgeMaterial);
  edges.userData.isCadEdges = true;
  mesh.add(edges);
  ctx.group.add(mesh);
  ctx.parts.push({ mesh, edges, geometry, triToFace });
  return triCount;
}

function finishModel(ctx) {
  const { THREE, group, parts, faces } = ctx;
  if (!parts.length) throw new Error("El archivo STEP no contiene geometría 3D que se pueda dibujar.");
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const min = [box.min.x, box.min.y, box.min.z];
  const max = [box.max.x, box.max.y, box.max.z];
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.sqrt(size[0] ** 2 + size[1] ** 2 + size[2] ** 2) / 2 || 1;
  return { group, parts, faces, bounds: { min, max, size, center, radius }, _ctx: ctx };
}

/** Las mallas de un plan convertidas en lo que se construye: cada grupo es una malla (o la fusión de varias). */
function* plannedMeshes(occtResult, groups) {
  const meshes = (occtResult && occtResult.meshes) || [];
  for (const g of groups) yield g.length === 1 ? meshes[g[0]] : mergeOcctMeshes(g.map((i) => meshes[i]));
}

/**
 * Construye el modelo. Devuelve `{ group, parts, faces, bounds }`:
 *   group   THREE.Group con una malla (y sus aristas) por cada pieza;
 *   parts   `[{ mesh, edges, geometry, triToFace }]` — `triToFace[t]` es el faceId del triángulo t;
 *   faces   `[{ id, partIndex, triangles: Uint32Array, source }]`;
 *   bounds  `{ min, max, size, center, radius }` en mm (arrays `[x, y, z]`).
 * Sin `plan` es una pieza por cada malla del STEP (lo de siempre). Con `plan` (planCadBuild) se construyen sus grupos.
 */
export function buildCadModel(THREE, occtResult, { edgeAngle = 25, color = 0xb7c1cc, edgeColor = 0x1e2a36, plan = null } = {}) {
  const ctx = createBuildContext(THREE, { edgeAngle, color, edgeColor, edgeMode: plan ? plan.edgeMode : "angle" });
  const source = plan ? plannedMeshes(occtResult, plan.groups) : ((occtResult && occtResult.meshes) || []);
  for (const m of source) addPart(ctx, m);
  return finishModel(ctx);
}

/**
 * Igual que buildCadModel pero por tandas, cediendo el hilo al navegador entre piezas para poder enseñar el avance y cancelar.
 *   progress(hecho, total)   se llama tras cada pieza;   isCancelled()   si devuelve true se corta (se lanza un AbortError).
 */
export async function buildCadModelAsync(THREE, occtResult, { edgeAngle = 25, color = 0xb7c1cc, edgeColor = 0x1e2a36, plan = null } = {}, { onProgress, isCancelled, sliceMs = 40 } = {}) {
  const ctx = createBuildContext(THREE, { edgeAngle, color, edgeColor, edgeMode: plan ? plan.edgeMode : "angle" });
  const meshes = (occtResult && occtResult.meshes) || [];
  const total = plan ? plan.groups.length : meshes.length;
  const source = plan ? plannedMeshes(occtResult, plan.groups) : meshes;
  let done = 0;
  let sliceStart = Date.now();
  for (const m of source) {
    if (isCancelled && isCancelled()) { const e = new Error("Cancelado"); e.name = "AbortError"; throw e; }
    addPart(ctx, m);
    done++;
    if (Date.now() - sliceStart >= sliceMs) {
      if (onProgress) onProgress(done, total);
      await nextTick();
      sliceStart = Date.now();
    }
  }
  if (onProgress) onProgress(total, total);
  return finishModel(ctx);
}

/**
 * Añade al modelo ya construido las mallas `groups` (p. ej. las que la vista simplificada dejó fuera) y recalcula los límites.
 * Los `faceId` de lo ya construido no cambian. Devuelve cuántas piezas se añadieron.
 */
export async function extendCadModel(THREE, model, occtResult, groups, { onProgress, isCancelled, sliceMs = 40 } = {}) {
  const ctx = model._ctx;
  if (!ctx) throw new Error("El modelo no se puede ampliar.");
  const before = ctx.parts.length;
  let done = 0;
  let sliceStart = Date.now();
  for (const m of plannedMeshes(occtResult, groups)) {
    if (isCancelled && isCancelled()) { const e = new Error("Cancelado"); e.name = "AbortError"; throw e; }
    addPart(ctx, m);
    done++;
    if (Date.now() - sliceStart >= sliceMs) {
      if (onProgress) onProgress(done, groups.length);
      await nextTick();
      sliceStart = Date.now();
    }
  }
  if (onProgress) onProgress(groups.length, groups.length);
  ctx.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(ctx.group);
  model.bounds = {
    min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z],
    size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
    center: [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2],
    radius: Math.sqrt((box.max.x - box.min.x) ** 2 + (box.max.y - box.min.y) ** 2 + (box.max.z - box.min.z) ** 2) / 2 || 1,
  };
  return ctx.parts.length - before;
}

const worldPoint = (e, x, y, z) => [
  e[0] * x + e[4] * y + e[8] * z + e[12],
  e[1] * x + e[5] * y + e[9] * z + e[13],
  e[2] * x + e[6] * y + e[10] * z + e[14],
];

function triangleVertexIndices(part, t) {
  const index = part.geometry.getIndex().array;
  return [index[3 * t], index[3 * t + 1], index[3 * t + 2]];
}

/** Los tres vértices de un triángulo de una pieza en coordenadas de mundo. */
function worldTriangle(part, t) {
  const pos = part.geometry.getAttribute("position").array;
  part.mesh.updateWorldMatrix(true, false);
  const e = part.mesh.matrixWorld.elements;
  return triangleVertexIndices(part, t).map((i) => worldPoint(e, pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
}

/** Las coordenadas de mundo (9 números por triángulo) de una cara. */
export function faceWorldPositions(model, faceId) {
  const face = model.faces[faceId];
  if (!face) throw new RangeError(`Cara ${faceId} inexistente.`);
  const part = model.parts[face.partIndex];
  const out = new Float64Array(face.triangles.length * 9);
  face.triangles.forEach((t, i) => {
    worldTriangle(part, t).forEach((v, k) => { out[i * 9 + k * 3] = v[0]; out[i * 9 + k * 3 + 1] = v[1]; out[i * 9 + k * 3 + 2] = v[2]; });
  });
  return out;
}

/** La cara descrita para medirla (vértices únicos, normal media, centroide…), ver buildFaceDescriptor. */
export function describeModelFace(model, faceId) {
  return buildFaceDescriptor(faceWorldPositions(model, faceId), { faceId });
}

/** El faceId de lo que ha tocado un rayo (`intersection` de THREE.Raycaster sobre una de las mallas del modelo), o -1. */
export function faceIdFromIntersection(model, intersection) {
  const part = intersection && intersection.object && model.parts[intersection.object.userData.partIndex];
  if (!part || !Number.isInteger(intersection.faceIndex)) return -1;
  const id = part.triToFace[intersection.faceIndex];
  return id === NO_FACE || id === undefined ? -1 : id;
}

/**
 * El punto de medida de un impacto con «snap»: el vértice o el punto de arista más cercano del triángulo impactado si
 * está a `radius` mm o menos (ver snapPointToTriangle); si no, el punto exacto del impacto. `{ point: [x, y, z], kind }`.
 */
export function snapIntersection(model, intersection, radius) {
  const part = model.parts[intersection.object.userData.partIndex];
  const hit = [intersection.point.x, intersection.point.y, intersection.point.z];
  if (!part || !Number.isInteger(intersection.faceIndex)) return { point: hit, kind: "surface" };
  return snapPointToTriangle(hit, worldTriangle(part, intersection.faceIndex), radius);
}

/** Una malla translúcida con los triángulos de una cara, para resaltarla encima de la pieza. */
export function createFaceHighlight(THREE, model, faceId, color) {
  const positions = faceWorldPositions(model, faceId);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(Float32Array.from(positions), 3));
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5;
  mesh.userData.faceId = faceId;
  return mesh;
}

/** Libera la geometría y los materiales de todo lo que cuelga de `root` (WebGL no los suelta solo). Tolera repeticiones. */
export function disposeObject3D(root) {
  if (!root) return;
  const seen = new Set();
  const free = (res) => {
    if (res && typeof res.dispose === "function" && !seen.has(res)) { seen.add(res); res.dispose(); }
  };
  const visit = (obj) => {
    free(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(free);
    (obj.children || []).slice().forEach(visit);
  };
  visit(root);
  if (root.parent && typeof root.parent.remove === "function") root.parent.remove(root);
}

/** Cuántos mm representa un píxel de pantalla a esa distancia de la cámara (para que el snap tenga un radio «de ratón»). */
export function worldUnitsPerPixel(fovDeg, distance, viewportHeightPx) {
  const h = Math.max(1, viewportHeightPx || 1);
  return (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(distance, 1e-6)) / h;
}
