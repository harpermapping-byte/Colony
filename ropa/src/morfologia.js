"use strict";

// Aplica la morfología de un personaje (altura/corpulencia/sexo) sobre las
// medidas base del rig ANTES de generar ropa. Las reglas (qué factor
// multiplica qué medida, rangos, factores por sexo) viven en
// client/src/render3d/morfologia.json — fuente única compartida con el rig
// del cliente. Este archivo solo es el aplicador genérico (leer ruta,
// multiplicar); su gemelo TS del cliente hace exactamente lo mismo — si
// cambias el CÓMO se aplica (no los números), toca los dos.

const fs = require("fs");
const path = require("path");

const REGLAS = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "..", "client", "src", "render3d", "morfologia.json"), "utf8"));

function acotar(valor, rango) {
  return Math.max(rango.min, Math.min(rango.max, valor));
}

/**
 * Devuelve una COPIA de proporciones con la morfología aplicada.
 * @param {object} proporciones - proporcionesRig.json ya cargado
 * @param {object} morfo - { altura?, corpulencia?, sexo? } — cualquier
 *   campo ausente usa el defecto (1.0 / factores neutros), así el rig y
 *   la ropa actuales siguen funcionando sin pasar morfología.
 */
function aplicarMorfologia(proporciones, morfo = {}) {
  const factores = {
    altura: acotar(morfo.altura ?? REGLAS.rangos.altura.defecto, REGLAS.rangos.altura),
    corpulencia: acotar(morfo.corpulencia ?? REGLAS.rangos.corpulencia.defecto, REGLAS.rangos.corpulencia),
    ...(REGLAS.sexo[morfo.sexo] || { hombros: 1, caderas: 1 }),
  };

  const copia = JSON.parse(JSON.stringify(proporciones));
  for (const [ruta, nombres] of Object.entries(REGLAS.escalas)) {
    const multiplicador = nombres.reduce((acc, n) => acc * factores[n], 1);
    const partes = ruta.split(".");
    let nodo = copia;
    for (let i = 0; i < partes.length - 1; i++) nodo = nodo[partes[i]];
    nodo[partes[partes.length - 1]] *= multiplicador;
  }
  return copia;
}

module.exports = { aplicarMorfologia, REGLAS };
