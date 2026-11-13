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

/**
 * Construye el modelo. Devuelve `{ group, parts, faces, bounds }`:
 *   group   THREE.Group con una malla (y sus aristas) por cada mesh del STEP;
 *   parts   `[{ mesh, edges, geometry, triToFace }]` — `triToFace[t]` es el faceId del triángulo t;
 *   faces   `[{ id, partIndex, triangles: Uint32Array, source }]`;
 *   bounds  `{ min, max, size, center, radius }` en mm (arrays `[x, y, z]`).
 */
export function buildCadModel(THREE, occtResult, { edgeAngle = 25, color = 0xb7c1cc, edgeColor = 0x1e2a36 } = {}) {
  const group = new THREE.Group();
  group.name = "cad-model";
  const parts = [];
  const faces = [];
  const material = new THREE.MeshStandardMaterial({
    color, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // empuja la malla hacia atrás: las aristas se ven limpias por delante
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: edgeColor });
  (occtResult && occtResult.meshes ? occtResult.meshes : []).forEach((m) => {
    const pos = m && m.attributes && m.attributes.position && m.attributes.position.array;
    const idx = m && m.index && m.index.array;
    if (!pos || !pos.length || !idx || idx.length < 3) return;
    const partIndex = parts.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const nrm = m.attributes.normal && m.attributes.normal.array;
    const hasNormals = !!nrm && nrm.length === pos.length;
    if (hasNormals) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    const index = Uint32Array.from(idx);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    if (!hasNormals) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const triCount = Math.floor(index.length / 3);
    const triToFace = new Uint32Array(triCount).fill(NO_FACE);
    splitIntoFaces(m, geometry.getAttribute("position").array, index, triCount).forEach((f) => {
      const id = faces.length;
      f.triangles.forEach((t) => { triToFace[t] = id; });
      faces.push({ id, partIndex, triangles: Uint32Array.from(f.triangles), source: f.source });
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.partIndex = partIndex;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle), edgeMaterial);
    edges.userData.isCadEdges = true;
    mesh.add(edges);
    group.add(mesh);
    parts.push({ mesh, edges, geometry, triToFace });
  });
  if (!parts.length) throw new Error("El archivo STEP no contiene geometría 3D que se pueda dibujar.");
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const min = [box.min.x, box.min.y, box.min.z];
  const max = [box.max.x, box.max.y, box.max.z];
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.sqrt(size[0] ** 2 + size[1] ** 2 + size[2] ** 2) / 2 || 1;
  return { group, parts, faces, bounds: { min, max, size, center, radius } };
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
