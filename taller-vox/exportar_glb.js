"use strict";
// Exporta un modelo de vóxeles (grid + paleta + cajas) a un .glb real,
// vóxel a vóxel con "face culling" (solo se generan las caras exteriores,
// igual que un mesher de voxels tipo Minecraft) — así el archivo 3D final
// se ve a cuadraditos, igual que en el visor, en vez de bloques lisos.
// Sin three.js ni ninguna librería: construye el JSON + binario glTF a mano.

const fs = require("fs");

function expandirVoxeles(model) {
  const paleta = model.paleta || [];
  const ocupado = new Map(); // "x,y,z" -> [r,g,b] (0..1)
  for (const c of model.cajas) {
    let [x0, y0, z0, x1, y1, z1, p] = c;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const hex = typeof p === "number" ? paleta[p] : p;
    const n = parseInt(String(hex).replace("#", ""), 16);
    const rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          ocupado.set(`${x},${y},${z}`, rgb);
  }
  return ocupado;
}

// 6 direcciones y sus 4 vértices de cara (en coordenadas relativas al cubo unidad 0..1)
// normal + vértices en orden CCW visto desde fuera
const CARAS = [
  { normal: [1, 0, 0], verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] }, // +x
  { normal: [-1, 0, 0], verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] }, // -x
  { normal: [0, 1, 0], verts: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] }, // +y
  { normal: [0, -1, 0], verts: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] }, // -y
  { normal: [0, 0, 1], verts: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] }, // +z
  { normal: [0, 0, -1], verts: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }, // -z
];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function mallarVoxeles(ocupado, unit) {
  const positions = [], normals = [], colors = [], indices = [];
  let vi = 0;
  for (const [key, rgb] of ocupado) {
    const [x, y, z] = key.split(",").map(Number);
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = DIRS[d];
      if (ocupado.has(`${x + dx},${y + dy},${z + dz}`)) continue; // cara interior tapada — no se genera
      const { normal, verts } = CARAS[d];
      for (const [vx, vy, vz] of verts) {
        positions.push((x + vx) * unit, (y + vy) * unit, (z + vz) * unit);
        normals.push(...normal);
        colors.push(...rgb, 1);
      }
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
  }
  return { positions, normals, colors, indices };
}

function construirGLB(mesh, nombre) {
  const { positions, normals, colors, indices } = mesh;
  const usaUint32 = positions.length / 3 > 65535;
  const indexArray = usaUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
  const posArray = new Float32Array(positions);
  const normArray = new Float32Array(normals);
  const colorArray = new Float32Array(colors);

  const buffers = [posArray, normArray, colorArray, indexArray];
  const bufferViews = [];
  const chunks = [];
  let offset = 0;
  for (const buf of buffers) {
    const bytes = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    bufferViews.push({ byteOffset: offset, byteLength: bytes.length });
    chunks.push(padded);
    offset += padded.length;
  }
  const binBuffer = Buffer.concat(chunks);

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }

  const gltf = {
    asset: { version: "2.0", generator: "colony-voxel-exporter" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nombre }],
    meshes: [{
      name: nombre,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: "vertexColor",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 },
    }],
    buffers: [{ byteLength: binBuffer.length }],
    bufferViews: [
      { buffer: 0, byteOffset: bufferViews[0].byteOffset, byteLength: bufferViews[0].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[1].byteOffset, byteLength: bufferViews[1].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[2].byteOffset, byteLength: bufferViews[2].byteLength, target: 34962 },
      { buffer: 0, byteOffset: bufferViews[3].byteOffset, byteLength: bufferViews[3].byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: colors.length / 4, type: "VEC4" },
      { bufferView: 3, componentType: usaUint32 ? 5125 : 5123, count: indices.length, type: "SCALAR" },
    ],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.concat([Buffer.from(jsonStr, "utf8"), Buffer.alloc((4 - (Buffer.byteLength(jsonStr) % 4)) % 4, 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuffer.length;
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuffer]);
}

function exportarModelo(model, id, outPath, unit = 0.1) {
  const ocupado = expandirVoxeles(model);
  const mesh = mallarVoxeles(ocupado, unit);
  const glb = construirGLB(mesh, id);
  fs.writeFileSync(outPath, glb);
  return { voxeles: ocupado.size, triangulos: mesh.indices.length / 3, bytes: glb.length };
}

module.exports = { exportarModelo };

if (require.main === module) {
  const [, , archivoModelos, id, outPath] = process.argv;
  const modelos = require(require("path").resolve(archivoModelos));
  const model = modelos[id];
  if (!model) { console.error("No existe el id:", id); process.exit(1); }
  const info = exportarModelo(model, id, outPath);
  console.log(`${id}: ${info.voxeles} vóxeles -> ${info.triangulos} triángulos, ${(info.bytes / 1024).toFixed(1)} KB -> ${outPath}`);
}
