"use strict";
const fs = require("fs");

function validar(path) {
  const buf = fs.readFileSync(path);
  const magic = buf.readUInt32LE(0);
  const totalLength = buf.readUInt32LE(8);
  if (magic !== 0x46546c67) throw new Error("magic invalido");
  if (totalLength !== buf.length) throw new Error("longitud total no coincide");
  let offset = 12;
  const jsonLen = buf.readUInt32LE(offset), jsonType = buf.readUInt32LE(offset + 4);
  if (jsonType !== 0x4e4f534a) throw new Error("primer chunk no es JSON");
  const json = JSON.parse(buf.slice(offset + 8, offset + 8 + jsonLen).toString("utf8"));
  offset += 8 + jsonLen;
  const binLen = buf.readUInt32LE(offset), binType = buf.readUInt32LE(offset + 4);
  if (binType !== 0x004e4942) throw new Error("segundo chunk no es BIN");
  for (const acc of json.accessors) {
    const bv = json.bufferViews[acc.bufferView];
    const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
    const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
    if (!compSize || !nComp) throw new Error(`accessor con tipo desconocido: ${acc.componentType}/${acc.type}`);
    const expected = acc.count * nComp * compSize;
    if (bv.byteLength < expected) throw new Error("bufferView demasiado pequeno para su accessor");
    if (bv.byteOffset + bv.byteLength > binLen) throw new Error("bufferView se sale del BIN");
  }
  const prim = json.meshes[0].primitives[0];
  const posAcc = json.accessors[prim.attributes.POSITION];
  const idxAcc = json.accessors[prim.indices];
  if (idxAcc.count % 3 !== 0) throw new Error("numero de indices no divisible por 3");
  const resumen = { totalLength, vertices: posAcc.count, triangles: idxAcc.count / 3, min: posAcc.min, max: posAcc.max };
  if (json.skins) {
    const skin = json.skins[0];
    const ibm = json.accessors[skin.inverseBindMatrices];
    if (ibm.count !== skin.joints.length) throw new Error("inverseBindMatrices no cuadra con joints");
    if (prim.attributes.JOINTS_0 == null || prim.attributes.WEIGHTS_0 == null)
      throw new Error("skin sin JOINTS_0/WEIGHTS_0 en la malla");
    resumen.huesos = skin.joints.length;
  }
  return resumen;
}

for (const nombre of process.argv.slice(2)) {
  try {
    console.log(nombre, JSON.stringify(validar(nombre)));
  } catch (e) {
    console.log(nombre, "INVALIDO:", e.message);
  }
}
