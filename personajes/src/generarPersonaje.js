"use strict";

// Generador procedural de personajes/NPCs — mismo patrón que interiores
// (mobiliario) y ropa: el catálogo (npcs.json + rasgos.json) es la fuente
// de verdad, el generador solo tira dados DETERMINISTAS (misma semilla =
// mismo individuo, siempre) dentro de lo que el catálogo permite.
//
// Salida por individuo:
// - `ficha`: los DATOS del personaje (sexo, morfología concreta, colores de
//   piel/pelo/ojos, estilos de pelo/barba, ropa que le toca). Es el
//   contrato con el cliente: rigHumanoide.ts dibuja el cuerpo con la ficha
//   (morfología + colores) y, cuando el catálogo de prendas esté completo,
//   la ropa listada se le genera y cuelga AUTO — misma morfología, acopla
//   sola (ver ropa/src/generarPrenda.js).
// - `voxelesCabeza`: pelo + barba en vóxeles colgando del pivote `cabeza`
//   del rig, mismo contrato {x,y,z,color,zona,pivote} que las prendas de
//   ropa/ — el cliente los fusiona en una geometría por personaje.

const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");
const { aplicarMorfologia } = require("../../ropa/src/morfologia");

// --- Geometría de estilos (cajas normalizadas sobre la cabeza) ---
// Unidades: la cabeza es un cubo de lado 1 con x,z en [-0.5, 0.5] e
// y en [0, 1] (el pivote del cuello queda en y=0). Cada estilo es una
// lista de cajas que luego se voxelizan con celdas de 1/6 de cabeza —
// mismo aspecto de bloques que el resto del proyecto. Un estilo nuevo se
// da de alta aquí Y en rasgos.json (peloEstilos/barbaEstilos).

const CAJAS_PELO = {
  calvo: [],
  rapado: [
    { x: [-0.56, 0.56], y: [1.0, 1.09], z: [-0.56, 0.5] },
    { x: [-0.56, 0.56], y: [0.5, 1.0], z: [-0.62, -0.5] },
  ],
  corto: [
    // El casquete superior NO sobrevuela la cara (z tope 0.5): la frente y
    // los ojos quedan siempre visibles; el flequillo es la tira fina aparte.
    { x: [-0.6, 0.6], y: [1.0, 1.18], z: [-0.6, 0.5] },
    { x: [-0.6, 0.6], y: [0.35, 1.0], z: [-0.66, -0.5] },
    { x: [-0.66, -0.5], y: [0.55, 1.0], z: [-0.55, 0.35] },
    { x: [0.5, 0.66], y: [0.55, 1.0], z: [-0.55, 0.35] },
    { x: [-0.45, 0.45], y: [1.0, 1.12], z: [0.5, 0.58] },
  ],
  melena: [
    { x: [-0.62, 0.62], y: [1.0, 1.18], z: [-0.62, 0.5] },
    { x: [-0.62, 0.62], y: [-0.18, 1.0], z: [-0.68, -0.5] },
    { x: [-0.68, -0.5], y: [0.1, 1.0], z: [-0.6, 0.3] },
    { x: [0.5, 0.68], y: [0.1, 1.0], z: [-0.6, 0.3] },
    { x: [-0.45, 0.45], y: [1.0, 1.12], z: [0.5, 0.58] },
  ],
  coleta: [
    { x: [-0.6, 0.6], y: [1.0, 1.16], z: [-0.6, 0.5] },
    { x: [-0.6, 0.6], y: [0.4, 1.0], z: [-0.64, -0.5] },
    { x: [-0.64, -0.5], y: [0.55, 1.0], z: [-0.5, 0.3] },
    { x: [0.5, 0.64], y: [0.55, 1.0], z: [-0.5, 0.3] },
    { x: [-0.1, 0.1], y: [-0.3, 0.55], z: [-0.78, -0.62] },
  ],
  monje: [
    { x: [-0.62, 0.62], y: [0.4, 0.75], z: [-0.66, -0.5] },
    { x: [-0.66, -0.5], y: [0.4, 0.75], z: [-0.55, 0.4] },
    { x: [0.5, 0.66], y: [0.4, 0.75], z: [-0.55, 0.4] },
  ],
};

const CAJAS_BARBA = {
  ninguna: [],
  bigote: [{ x: [-0.24, 0.24], y: [0.26, 0.37], z: [0.5, 0.6] }],
  perilla: [{ x: [-0.16, 0.16], y: [-0.06, 0.26], z: [0.5, 0.62] }],
  completa: [
    { x: [-0.42, 0.42], y: [-0.12, 0.3], z: [0.5, 0.64] },
    { x: [-0.62, -0.5], y: [0.05, 0.5], z: [-0.05, 0.5] },
    { x: [0.5, 0.62], y: [0.05, 0.5], z: [-0.05, 0.5] },
  ],
};

function ajustarColor(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const aj = (c) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => aj(c).toString(16).padStart(2, "0")).join("");
}

// Voxeliza una lista de cajas normalizadas (lado de cabeza = 1) a vóxeles
// de mundo, con celda de 1/6 de cabeza y variación sutil de color.
function voxelizarCajas(cajas, ladoCabeza, color, zona, rnd) {
  const celda = ladoCabeza / 6;
  const voxeles = [];
  for (const caja of cajas) {
    const [x0, x1] = caja.x.map((v) => v * ladoCabeza);
    const [y0, y1] = caja.y.map((v) => v * ladoCabeza);
    const [z0, z1] = caja.z.map((v) => v * ladoCabeza);
    for (let x = x0 + celda / 2; x < x1; x += celda) {
      for (let y = y0 + celda / 2; y < y1; y += celda) {
        for (let z = z0 + celda / 2; z < z1; z += celda) {
          // (x,y,z) es el CENTRO de la celda y tam su tamaño — el cliente
          // construye la caja directamente, sin adivinar la resolución
          voxeles.push({ x, y, z, tam: [celda, celda, celda], color: ajustarColor(color, (rnd() - 0.5) * 0.06), zona, pivote: "cabeza" });
        }
      }
    }
  }
  return voxeles;
}

// Pesos con formato [id, peso] o [id, peso, extra]; devuelve el id.
function elegir(lista, rnd) {
  return elegirPonderado(lista.map(([id, peso]) => [id, peso]), rnd);
}

function colorDe(lista, id) {
  const entrada = lista.find(([nombre]) => nombre === id);
  return entrada ? entrada[2] : "#ff00ff"; // magenta = descuadre de catálogo, que cante
}

function enRango([min, max], rnd) {
  return min + (max - min) * rnd();
}

/**
 * Genera un individuo concreto de un NPC del catálogo.
 * @param {string} npcId - clave en personajes/catalogo/npcs.json
 * @param {object} opciones - { semilla, catalogos } (catálogos de personajes/src/catalogo.js)
 */
function generarPersonaje(npcId, opciones) {
  const { catalogos, semilla } = opciones;
  const npc = catalogos.npcs[npcId];
  if (!npc) throw new Error(`NPC desconocido: ${npcId}`);
  const rasgosBase = catalogos.rasgos;
  const rnd = crearPRNG(`${semilla}|${npcId}`);

  // Pesos del NPC pisan a los globales SOLO en las listas que declare.
  const pesos = (nombre) => (npc.rasgos && npc.rasgos[nombre]) || npc[nombre] || rasgosBase[nombre];

  const sexo = elegir(pesos("sexoPesos"), rnd);
  const morfologia = {
    sexo,
    altura: Number(enRango(npc.morfologia.altura, rnd).toFixed(3)),
    corpulencia: Number(enRango(npc.morfologia.corpulencia, rnd).toFixed(3)),
  };

  const peloEstilo = elegir(pesos("peloEstilos"), rnd);
  // Barba solo en hombres — decisión simple de v1; si algún NPC concreto
  // necesita otra cosa, se pacta y se parametriza en su entrada.
  const barbaEstilo = sexo === "hombre" ? elegir(pesos("barbaEstilos"), rnd) : "ninguna";
  const peloColorId = elegir(pesos("coloresPelo"), rnd);
  const pielColorId = elegir(pesos("coloresPiel"), rnd);
  const ojosColorId = elegir(pesos("coloresOjos"), rnd);

  const ficha = {
    npcId,
    semilla,
    profesion: npc.profesion,
    sexo,
    morfologia,
    rasgos: {
      peloEstilo,
      barbaEstilo,
      peloColor: { id: peloColorId, hex: colorDe(rasgosBase.coloresPelo, peloColorId) },
      pielColor: { id: pielColorId, hex: colorDe(rasgosBase.coloresPiel, pielColorId) },
      ojosColor: { id: ojosColorId, hex: colorDe(rasgosBase.coloresOjos, ojosColorId) },
    },
    ropa: npc.ropa || [],
  };

  // Vóxeles de pelo/barba sobre la cabeza YA morfada de este individuo
  // (la cabeza no escala con la morfología — ver morfologia.json — pero se
  // lee del cuerpo morfado igualmente por coherencia de contrato).
  const cuerpo = aplicarMorfologia(catalogos.proporcionesRig, morfologia);
  const voxelesCabeza = [
    ...voxelizarCajas(CAJAS_PELO[peloEstilo] || [], cuerpo.ladoCabeza, ficha.rasgos.peloColor.hex, "pelo", rnd),
    ...voxelizarCajas(CAJAS_BARBA[barbaEstilo] || [], cuerpo.ladoCabeza, ficha.rasgos.peloColor.hex, "barba", rnd),
  ];

  return { ficha, voxelesCabeza, cuerpo };
}

module.exports = { generarPersonaje, ajustarColor };
