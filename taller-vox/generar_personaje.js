"use strict";
// Generador de esqueleto humanoide en vóxeles — base para PJ/NPC/enemigos
// bípedos. A diferencia de los muebles (una malla rígida), aquí cada parte
// del cuerpo cuelga de un HUESO real con su pivote, para poder animar más
// adelante sin rehacer la malla ni el esqueleto (solo añadir curvas de
// animación encima de lo que ya existe).
//
// Convención: cada hueso define su geometría en espacio LOCAL, con el
// origen del hueso (su pivote/joint) en (0,0,0). "offset" es la traslación
// desde el hueso padre (todo el árbol es solo traslación — sin rotaciones
// — porque la pose de reposo es de pie con brazos colgando y piernas
// rectas, así que no hace falta álgebra de cuaterniones para el bind pose).

function generarEsqueletoHumanoide(alturaVoxeles = 34, paleta = {}) {
  const H = alturaVoxeles;
  const piel = paleta.piel || "#d9a066";
  const pelo = paleta.pelo || "#3a2a1a";
  const torsoColor = paleta.torso || "#4a5a7a";
  const piernaColor = paleta.piernas || "#3a3a4a";
  const zapatoColor = paleta.zapatos || "#2a2a2a";

  const r = (f) => Math.max(1, Math.round(f * H));
  const footH = r(0.07), lowerLegLen = r(0.24), upperLegLen = r(0.24);
  const hipY = footH + lowerLegLen + upperLegLen;
  const torsoLen = r(0.32), headLen = r(0.15);
  const shoulderY = torsoLen - r(0.03);
  const upperArmLen = r(0.20), lowerArmLen = r(0.17), handLen = r(0.09);
  const torsoHalfW = r(0.10), torsoHalfD = r(0.06);
  const headHalf = r(0.065);
  const legHalfW = r(0.045), legHalfD = r(0.045);
  const armHalfW = r(0.035);
  const legOffX = r(0.07), armOffX = torsoHalfW + armHalfW;
  const footLen = r(0.12);

  // caja(x0,y0,z0,x1,y1,z1,hex) en espacio LOCAL del hueso
  const bones = [];
  function hueso(name, parent, offset, cajas) {
    bones.push({ name, parent, offset, cajas });
    return bones.length - 1;
  }

  const iHips = hueso("hips", null, [0, hipY, 0], []); // solo pivote — la pelvis vive en la caja del torso
  const iSpine = hueso("spine", "hips", [0, 0, 0], [
    [-torsoHalfW, 0, -torsoHalfD, torsoHalfW - 1, torsoLen - 1, torsoHalfD - 1, torsoColor],
  ]);
  hueso("head", "spine", [0, torsoLen, 0], [
    [-headHalf, 0, -headHalf, headHalf - 1, headLen - 1, headHalf - 1, piel],
    [-headHalf, headLen - Math.max(1, Math.round(headLen * 0.3)), -headHalf, headHalf - 1, headLen - 1, headHalf - 1, pelo], // "pelo" — franja superior
  ]);

  function brazo(lado, signo) {
    const x0 = signo * armOffX;
    hueso("upperarm." + lado, "spine", [x0, shoulderY, 0], [
      [-armHalfW, -upperArmLen, -armHalfW, armHalfW - 1, -1, armHalfW - 1, torsoColor], // manga
    ]);
    hueso("lowerarm." + lado, "upperarm." + lado, [0, -upperArmLen, 0], [
      [-armHalfW, -lowerArmLen, -armHalfW, armHalfW - 1, -1, armHalfW - 1, piel],
    ]);
    hueso("hand." + lado, "lowerarm." + lado, [0, -lowerArmLen, 0], [
      [-armHalfW, -handLen, -armHalfW, armHalfW - 1, -1, armHalfW - 1, piel],
    ]);
  }
  brazo("L", 1);
  brazo("R", -1);

  function pierna(lado, signo) {
    const x0 = signo * legOffX;
    const iUpper = hueso("upperleg." + lado, "hips", [x0, 0, 0], [
      [-legHalfW, -upperLegLen, -legHalfD, legHalfW - 1, -1, legHalfD - 1, piernaColor],
    ]);
    const iLower = hueso("lowerleg." + lado, "upperleg." + lado, [0, -upperLegLen, 0], [
      [-legHalfW, -lowerLegLen, -legHalfD, legHalfW - 1, -1, legHalfD - 1, piernaColor],
    ]);
    hueso("foot." + lado, "lowerleg." + lado, [0, -lowerLegLen, 0], [
      [-legHalfW, -footH, -legHalfD, legHalfW - 1, -1, footLen - legHalfD - 1, zapatoColor],
    ]);
  }
  pierna("L", 1);
  pierna("R", -1);

  return { bones, alturaVoxeles: H };
}

module.exports = { generarEsqueletoHumanoide };

if (require.main === module) {
  const esqueleto = generarEsqueletoHumanoide(34);
  console.log("Huesos:", esqueleto.bones.map((b) => b.name).join(", "));
  console.log("Total huesos:", esqueleto.bones.length);
}
