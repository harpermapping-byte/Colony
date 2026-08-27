"use strict";
// Exporta un esqueleto (generar_personaje.js) a .glb con SKIN real: jerarquía
// de huesos (nodes + children), inverseBindMatrices, y cada vértice del
// mesh con JOINTS_0/WEIGHTS_0 apuntando 100% a su hueso — "rigid skinning"
// (cada vóxel se mueve entero con su hueso, sin mezcla), el mismo estilo
// que usan los personajes voxel tipo Minecraft. Solo pose de reposo: no
// hay animation clips todavía (se pueden añadir después sin tocar esto).

const fs = require("fs");
const { generarEsqueletoHumanoide } = require("./generar_personaje");

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CARAS = [
  { normal: [1, 0, 0], verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { normal: [0, 1, 0], verts: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], verts: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { normal: [0, 0, 1], verts: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { normal: [0, 0, -1], verts: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

function hexA(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Expande las cajas LOCALES de cada hueso a un mapa global en espacio de
// MUNDO (bind pose), preservando qué hueso es dueño de cada vóxel.
function expandirEsqueleto(esqueleto) {
  const worldOffset = {};
  const indexByName = {};
  esqueleto.bones.forEach((b, i) => (indexByName[b.name] = i));
  esqueleto.bones.forEach((b, i) => {
    const parentOff = b.parent ? worldOffset[b.parent] : [0, 0, 0];
    worldOffset[b.name] = [parentOff[0] + b.offset[0], parentOff[1] + b.offset[1], parentOff[2] + b.offset[2]];
  });

  const ocupado = new Map(); // "x,y,z" (mundo, bind pose) -> {rgb, boneIndex}
  esqueleto.bones.forEach((b, boneIndex) => {
    const [ox, oy, oz] = worldOffset[b.name];
    for (const c of b.cajas) {
      let [x0, y0, z0, x1, y1, z1, hex] = c;
      if (x1 < x0) [x0, x1] = [x1, x0];
      if (y1 < y0) [y0, y1] = [y1, y0];
      if (z1 < z0) [z0, z1] = [z1, z0];
      const rgb = hexA(hex);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++)
            ocupado.set(`${x + ox},${y + oy},${z + oz}`, { rgb, boneIndex });
    }
  });
  return { ocupado, worldOffset, indexByName };
}

function mallarConSkin(ocupado, unit) {
  const positions = [], normals = [], colors = [], joints = [], weights = [], indices = [];
  let vi = 0;
  for (const [key, { rgb, boneIndex }] of ocupado) {
    const [x, y, z] = key.split(",").map(Number);
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = DIRS[d];
      if (ocupado.has(`${x + dx},${y + dy},${z + dz}`)) continue;
      const { normal, verts } = CARAS[d];
      for (const [vx, vy, vz] of verts) {
        positions.push((x + vx) * unit, (y + vy) * unit, (z + vz) * unit);
        normals.push(...normal);
        colors.push(...rgb, 1);
        joints.push(boneIndex, 0, 0, 0);
        weights.push(1, 0, 0, 0);
      }
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
  }
  return { positions, normals, colors, joints, weights, indices };
}

function matrizTraslacion(v, invertir) {
  const s = invertir ? -1 : 1;
  // columna-mayor, 4x4, identidad + traslación en la última columna
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0] * s, v[1] * s, v[2] * s, 1];
}

function construirGLBConSkin(esqueleto, unit = 0.05) {
  const { ocupado, worldOffset, indexByName } = expandirEsqueleto(esqueleto);
  const mesh = mallarConSkin(ocupado, unit);
  const { positions, normals, colors, joints, weights, indices } = mesh;

  const usaUint32 = positions.length / 3 > 65535;
  const posArray = new Float32Array(positions);
  const normArray = new Float32Array(normals);
  const colorArray = new Float32Array(colors);
  const jointArray = new Uint8Array(joints);
  const weightArray = new Float32Array(weights);
  const indexArray = usaUint32 ? new Uint32Array(indices) : new Uint16Array(indices);

  // nodos: 0 = nodo de la malla (con skin); 1..N = huesos, en el mismo orden que esqueleto.bones
  // Las traslaciones de hueso van en las MISMAS unidades que la malla (vóxel*unit),
  // si no los pivotes de rotación quedan fuera de sitio al animar.
  const nodes = [{ mesh: 0, skin: 0, name: "malla" }];
  const nodeIndexByBone = {};
  esqueleto.bones.forEach((b, i) => {
    nodeIndexByBone[b.name] = nodes.length;
    nodes.push({ name: b.name, translation: b.offset.map((v) => v * unit) });
  });
  esqueleto.bones.forEach((b) => {
    if (b.parent == null) return;
    const parentNode = nodes[nodeIndexByBone[b.parent]];
    parentNode.children = parentNode.children || [];
    parentNode.children.push(nodeIndexByBone[b.name]);
  });
  const rootBoneNodes = esqueleto.bones.filter((b) => b.parent == null).map((b) => nodeIndexByBone[b.name]);

  const jointNodeIndices = esqueleto.bones.map((b) => nodeIndexByBone[b.name]);
  const ibmFloats = [];
  esqueleto.bones.forEach((b) => {
    ibmFloats.push(...matrizTraslacion(worldOffset[b.name].map((v) => v * unit), true));
  });
  const ibmArray = new Float32Array(ibmFloats);

  const buffers = [posArray, normArray, colorArray, jointArray, weightArray, indexArray, ibmArray];
  const bufferViews = [];
  const chunks = [];
  let offset = 0;
  for (const buf of buffers) {
    const bytes = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    const padded = Buffer.concat([bytes, Buffer.alloc(pad)]);
    bufferViews.push({ byteOffset: offset, byteLength: bytes.length });
    chunks.push(padded);
    offset += padded.length;
  }
  const binBuffer = Buffer.concat(chunks);

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }

  const gltf = {
    asset: { version: "2.0", generator: "colony-personaje-exporter" },
    scene: 0,
    scenes: [{ nodes: [0, ...rootBoneNodes] }],
    nodes,
    meshes: [{
      name: "personaje",
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
        indices: 5,
        material: 0,
      }],
    }],
    skins: [{ joints: jointNodeIndices, inverseBindMatrices: 6 }],
    materials: [{ name: "vertexColor", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: binBuffer.length }],
    bufferViews: [
      { buffer: 0, byteOffset: bufferViews[0].byteOffset, byteLength: bufferViews[0].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[1].byteOffset, byteLength: bufferViews[1].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[2].byteOffset, byteLength: bufferViews[2].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[3].byteOffset, byteLength: bufferViews[3].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[4].byteOffset, byteLength: bufferViews[4].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[5].byteOffset, byteLength: bufferViews[5].byteLength, target: 34963 },
      { buffer: 0, byteOffset: bufferViews[6].byteOffset, byteLength: bufferViews[6].byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: colors.length / 4, type: "VEC4" },
      { bufferView: 3, componentType: 5121, count: joints.length / 4, type: "VEC4" },
      { bufferView: 4, componentType: 5126, count: weights.length / 4, type: "VEC4" },
      { bufferView: 5, componentType: usaUint32 ? 5125 : 5123, count: indices.length, type: "SCALAR" },
      { bufferView: 6, componentType: 5126, count: esqueleto.bones.length, type: "MAT4" },
    ],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.concat([Buffer.from(jsonStr, "utf8"), Buffer.alloc((4 - (Buffer.byteLength(jsonStr) % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuffer.length, 8);
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuffer]);
}

module.exports = { construirGLBConSkin };

if (require.main === module) {
  const alturaVoxeles = Number(process.argv[2]) || 34;
  const outPath = process.argv[3] || "personaje.glb";
  const esqueleto = generarEsqueletoHumanoide(alturaVoxeles);
  const glb = construirGLBConSkin(esqueleto);
  fs.writeFileSync(outPath, glb);
  console.log(`${esqueleto.bones.length} huesos, ${glb.length} bytes -> ${outPath}`);
}
