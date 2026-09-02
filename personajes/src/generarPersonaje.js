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
const { elegirConjuntoPorProfesion } = require("../../ropa/src/elegirPrenda");

// --- Geometría de estilos (cajas normalizadas sobre la cabeza) ---
// Unidades: la cabeza es un cubo de lado 1 con x,z en [-0.5, 0.5] e
// y en [0, 1] (el pivote del cuello queda en y=0). Cada estilo es una
// lista de cajas que luego se voxelizan con celdas de 1/6 de cabeza —
// mismo aspecto de bloques que el resto del proyecto. Un estilo nuevo se
// da de alta aquí Y en rasgos.json (peloEstilos/barbaEstilos).

// --- Helpers de composición (pedido streamer 2026-09-01: ~30 pelos por
// sexo + ~15 barbas) — construyen cada caja a partir de números en vez de
// repetir literales, mismo criterio "parametrizar en vez de duplicar" que
// el resto del proyecto (ropa/materiales, taller-vox/TONOS). Los 6 estilos
// de pelo y las 4 barbas ORIGINALES se dejan intactos tal cual (npcs.json
// los referencia por id) — todo lo nuevo se AÑADE con sus propios ids.
function caja(x0, x1, y0, y1, z0, z1) {
  return { x: [x0, x1], y: [y0, y1], z: [z0, z1] };
}
// Dos cajas simétricas en X (x0/x1 positivos: derecha [x0,x1], espejo [-x1,-x0]).
function parLateral(x0, x1, y0, y1, z0, z1) {
  return [caja(x0, x1, y0, y1, z0, z1), caja(-x1, -x0, y0, y1, z0, z1)];
}

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

  // ---- Ampliación 2026-09-01 (24 estilos nuevos, 30 en total) ----
  corto_flequillo: [
    caja(-0.58, 0.58, 1.0, 1.16, -0.6, 0.42),
    caja(-0.58, 0.58, 0.4, 1.0, -0.64, -0.5),
    ...parLateral(0.5, 0.62, 0.55, 1.0, -0.5, 0.3),
    caja(-0.42, 0.42, 0.96, 1.12, 0.42, 0.58),
  ],
  corto_alborotado: [
    caja(-0.6, 0.6, 1.0, 1.22, -0.6, 0.45),
    caja(-0.3, 0.3, 1.18, 1.32, -0.3, 0.1),
    caja(-0.6, 0.6, 0.35, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.68, 0.5, 1.05, -0.55, 0.35),
  ],
  corto_ondulado: [
    caja(-0.62, 0.62, 1.0, 1.2, -0.62, 0.48),
    caja(-0.62, 0.62, 0.35, 1.0, -0.68, -0.5),
    ...parLateral(0.5, 0.7, 0.5, 1.0, -0.58, 0.4),
    caja(-0.4, 0.4, 1.0, 1.1, 0.48, 0.56),
  ],
  media_melena: [
    caja(-0.6, 0.6, 1.0, 1.16, -0.6, 0.48),
    caja(-0.62, 0.62, -0.05, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.66, 0.0, 1.0, -0.55, 0.32),
    caja(-0.42, 0.42, 1.0, 1.1, 0.48, 0.56),
  ],
  media_melena_ondulada: [
    caja(-0.62, 0.62, 1.0, 1.18, -0.62, 0.48),
    caja(-0.66, 0.66, -0.08, 1.0, -0.7, -0.5),
    ...parLateral(0.5, 0.72, -0.05, 1.0, -0.58, 0.35),
    caja(-0.42, 0.42, 1.0, 1.1, 0.48, 0.56),
  ],
  melena_larga: [
    caja(-0.6, 0.6, 1.0, 1.16, -0.6, 0.48),
    caja(-0.6, 0.6, -0.5, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.64, -0.4, 1.0, -0.55, 0.3),
    caja(-0.42, 0.42, 1.0, 1.1, 0.48, 0.56),
  ],
  melena_rizada: [
    caja(-0.66, 0.66, 1.0, 1.24, -0.66, 0.46),
    caja(-0.7, 0.7, -0.3, 1.0, -0.74, -0.5),
    ...parLateral(0.5, 0.78, -0.2, 1.0, -0.62, 0.4),
    caja(-0.36, 0.36, 1.02, 1.14, 0.46, 0.54),
  ],
  melena_ondulada: [
    caja(-0.62, 0.62, 1.0, 1.18, -0.62, 0.48),
    caja(-0.64, 0.64, -0.35, 1.0, -0.7, -0.5),
    ...parLateral(0.5, 0.7, -0.25, 1.0, -0.58, 0.35),
    caja(-0.4, 0.4, 1.0, 1.1, 0.48, 0.56),
  ],
  coleta_alta: [
    caja(-0.58, 0.58, 1.0, 1.14, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.62, -0.5),
    ...parLateral(0.5, 0.62, 0.55, 1.0, -0.5, 0.3),
    caja(-0.09, 0.09, 0.75, 1.28, -0.84, -0.62),
  ],
  coleta_baja: [
    caja(-0.58, 0.58, 1.0, 1.14, -0.58, 0.46),
    caja(-0.58, 0.58, 0.45, 1.0, -0.62, -0.5),
    ...parLateral(0.5, 0.62, 0.5, 1.0, -0.5, 0.3),
    caja(-0.1, 0.1, -0.35, 0.42, -0.8, -0.6),
  ],
  doble_coleta: [
    caja(-0.58, 0.58, 1.0, 1.14, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.6, -0.5),
    ...parLateral(0.24, 0.4, -0.15, 0.65, -0.68, -0.5),
  ],
  mono: [
    caja(-0.58, 0.58, 1.0, 1.12, -0.58, 0.46),
    caja(-0.58, 0.58, 0.55, 1.0, -0.6, -0.5),
    ...parLateral(0.5, 0.62, 0.6, 1.0, -0.48, 0.3),
    caja(-0.16, 0.16, 1.05, 1.32, -0.72, -0.46),
  ],
  mono_bajo: [
    caja(-0.58, 0.58, 1.0, 1.12, -0.58, 0.46),
    caja(-0.6, 0.6, 0.2, 1.0, -0.62, -0.5),
    ...parLateral(0.5, 0.64, 0.25, 1.0, -0.5, 0.3),
    caja(-0.15, 0.15, 0.02, 0.26, -0.74, -0.56),
  ],
  trenza_simple: [
    caja(-0.58, 0.58, 1.0, 1.13, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.6, -0.5),
    ...parLateral(0.5, 0.62, 0.55, 1.0, -0.48, 0.3),
    caja(-0.08, 0.08, 0.6, 0.85, -0.74, -0.6),
    caja(-0.07, 0.07, 0.3, 0.6, -0.72, -0.58),
    caja(-0.06, 0.06, -0.15, 0.3, -0.7, -0.58),
  ],
  trenza_doble: [
    caja(-0.58, 0.58, 1.0, 1.13, -0.58, 0.46),
    caja(-0.58, 0.58, 0.5, 1.0, -0.58, -0.5),
    ...parLateral(0.06, 0.16, -0.1, 0.55, -0.66, -0.5),
    ...parLateral(0.06, 0.16, -0.1, 0.55, -0.5, -0.36),
  ],
  trenza_corona: [
    caja(-0.6, 0.6, 0.82, 0.98, -0.6, 0.5),
    caja(-0.6, 0.6, 0.4, 0.82, -0.64, -0.5),
    ...parLateral(0.5, 0.64, 0.4, 0.85, -0.5, 0.3),
    caja(-0.08, 0.08, 0.6, 0.85, -0.72, -0.58),
  ],
  rizado_afro: [
    caja(-0.72, 0.72, 1.0, 1.42, -0.72, 0.36),
    caja(-0.78, 0.78, 0.3, 1.0, -0.78, -0.4),
    ...parLateral(0.5, 0.82, 0.3, 1.0, -0.6, 0.36),
  ],
  ondulado_suelto: [
    caja(-0.62, 0.62, 1.0, 1.18, -0.62, 0.46),
    caja(-0.64, 0.64, -0.1, 1.0, -0.7, -0.5),
    ...parLateral(0.44, 0.72, -0.05, 1.0, -0.58, 0.36),
    caja(-0.3, 0.5, 1.0, 1.12, 0.4, 0.56),
  ],
  flequillo_lateral: [
    caja(-0.6, 0.6, 1.0, 1.16, -0.6, 0.46),
    caja(-0.6, 0.6, 0.1, 1.0, -0.66, -0.5),
    ...parLateral(0.5, 0.64, 0.15, 1.0, -0.55, 0.32),
    caja(-0.45, 0.05, 0.9, 1.15, 0.4, 0.58),
  ],
  mohawk: [
    caja(-0.1, 0.1, 1.0, 1.42, -0.5, 0.46),
    caja(-0.56, 0.56, 1.0, 1.03, -0.56, 0.5),
  ],
  cresta_lateral: [
    caja(-0.05, 0.55, 1.0, 1.2, -0.55, 0.46),
    caja(-0.05, 0.6, 0.6, 1.0, -0.62, -0.5),
    caja(0.42, 0.56, 0.55, 1.0, -0.5, 0.32),
    caja(-0.56, -0.42, 1.0, 1.05, -0.5, 0.32),
  ],
  rapado_lateral: [
    caja(-0.2, 0.55, 1.0, 1.24, -0.55, 0.46),
    caja(-0.56, 0.56, 1.0, 1.05, -0.6, -0.5),
    caja(0.35, 0.5, 0.85, 1.03, -0.4, 0.25),
    caja(-0.5, -0.35, 0.85, 1.03, -0.4, 0.25),
  ],
  recogido_medio: [
    caja(-0.6, 0.6, 1.0, 1.14, -0.6, 0.46),
    caja(-0.62, 0.62, -0.3, 1.0, -0.68, -0.5),
    ...parLateral(0.5, 0.66, -0.2, 1.0, -0.55, 0.3),
    caja(-0.14, 0.14, 1.08, 1.3, -0.68, -0.46),
  ],
  despeinado: [
    caja(-0.64, 0.64, 1.0, 1.24, -0.64, 0.44),
    caja(-0.34, 0.1, 1.2, 1.38, -0.4, -0.05),
    caja(0.05, 0.4, 1.16, 1.34, -0.15, 0.2),
    caja(-0.66, 0.66, -0.25, 1.0, -0.72, -0.5),
    ...parLateral(0.5, 0.74, -0.15, 1.02, -0.6, 0.36),
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

  // ---- Ampliación 2026-09-01 (11 barbas nuevas, 15 en total) ----
  bigote_fino: [caja(-0.16, 0.16, 0.29, 0.35, 0.5, 0.58)],
  bigote_grueso: [
    caja(-0.3, 0.3, 0.24, 0.38, 0.5, 0.62),
    ...parLateral(0.26, 0.34, 0.22, 0.3, 0.48, 0.56),
  ],
  perilla_larga: [
    caja(-0.16, 0.16, -0.22, 0.26, 0.5, 0.64),
    caja(-0.24, 0.24, 0.26, 0.37, 0.5, 0.6),
  ],
  candado: [
    caja(-0.24, 0.24, 0.26, 0.37, 0.5, 0.6),
    caja(-0.4, 0.4, -0.1, 0.05, 0.5, 0.62),
    ...parLateral(0.34, 0.44, -0.05, 0.32, 0.4, 0.55),
  ],
  patillas: [...parLateral(0.5, 0.6, -0.05, 0.5, -0.02, 0.42)],
  patillas_bigote: [
    caja(-0.24, 0.24, 0.26, 0.37, 0.5, 0.6),
    ...parLateral(0.5, 0.6, -0.05, 0.5, -0.02, 0.42),
  ],
  barba_corta: [
    caja(-0.38, 0.38, -0.06, 0.28, 0.5, 0.6),
    ...parLateral(0.5, 0.58, 0.1, 0.48, 0.0, 0.44),
  ],
  barba_larga: [
    caja(-0.42, 0.42, -0.4, 0.3, 0.5, 0.64),
    ...parLateral(0.5, 0.62, -0.1, 0.5, -0.05, 0.5),
  ],
  barba_trenzada: [
    caja(-0.42, 0.42, -0.15, 0.3, 0.5, 0.64),
    ...parLateral(0.5, 0.62, 0.05, 0.5, -0.05, 0.5),
    caja(-0.08, 0.08, -0.55, -0.15, 0.5, 0.6),
  ],
  barba_partida: [
    caja(-0.42, 0.42, 0.05, 0.3, 0.5, 0.64),
    ...parLateral(0.5, 0.62, 0.1, 0.5, -0.05, 0.5),
    ...parLateral(0.06, 0.16, -0.4, 0.08, 0.48, 0.6),
  ],
  barba_hacha: [
    caja(-0.34, 0.34, 0.05, 0.3, 0.5, 0.62),
    ...parLateral(0.5, 0.58, 0.15, 0.5, -0.02, 0.44),
    caja(-0.1, 0.1, -0.3, 0.05, 0.5, 0.58),
  ],
};

function ajustarColor(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const aj = (c) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => aj(c).toString(16).padStart(2, "0")).join("");
}

// "Ruleta" de color de pelo (pedido streamer 2026-09-01: "poder ponerse de
// color cualquiera... entre toda la gama cromática" para NPCs aleatorios) —
// hue aleatorio 0-360 sobre TODA la rueda cromática, saturación/luz acotadas
// a una franja de "tinte vivo" (ni apagado como una tonalidad natural ni
// quemado a blanco/negro puro). Convertido a hex sin dependencias.
function hslAHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const aByte = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + aByte(r) + aByte(g) + aByte(b);
}
function colorPeloFantasia(rnd) {
  const h = Math.floor(rnd() * 360);
  const s = 55 + rnd() * 35; // 55-90%: vivo, nunca gris apagado
  const l = 38 + rnd() * 24; // 38-62%: nunca negro ni blanco quemado
  return { id: `fantasia_${h}`, hex: hslAHex(h, s, l) };
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
  const { catalogos, semilla, sexoForzado, factorEscala } = opciones;
  const npc = catalogos.npcs[npcId];
  if (!npc) throw new Error(`NPC desconocido: ${npcId}`);
  const rasgosBase = catalogos.rasgos;
  const rnd = crearPRNG(`${semilla}|${npcId}`);

  // Pesos del NPC pisan a los globales SOLO en las listas que declare.
  const pesos = (nombre) => (npc.rasgos && npc.rasgos[nombre]) || npc[nombre] || rasgosBase[nombre];

  // sexoForzado/factorEscala: para poblacion/ (cónyuge de sexo opuesto al
  // cabeza de familia, hijos a escala reducida) — sin ellos el
  // comportamiento es exactamente el de antes.
  const sexo = sexoForzado || elegir(pesos("sexoPesos"), rnd);
  const escala = factorEscala ?? 1;
  const morfologia = {
    sexo,
    altura: Number((enRango(npc.morfologia.altura, rnd) * escala).toFixed(3)),
    corpulencia: Number((enRango(npc.morfologia.corpulencia, rnd) * escala).toFixed(3)),
  };

  // Pelo (ampliación 2026-09-01, pedido streamer: ~30 estilos POR SEXO,
  // cruzados — una mujer puede salir con "rapado" y un hombre con
  // "melena_larga", solo cambia la PROBABILIDAD, nunca una lista cerrada
  // por sexo). `pesos("peloEstilos")` sigue resolviendo primero cualquier
  // override EXPLÍCITO de este NPC concreto (mismo mecanismo de siempre,
  // los pocos NPCs curados a mano con su propia lista no se tocan); solo si
  // el NPC no trae override cae a la lista global del sexo que le tocó.
  const listaPeloPropia = (npc.rasgos && npc.rasgos.peloEstilos) || npc.peloEstilos;
  const peloEstilo = elegir(listaPeloPropia || pesos(sexo === "hombre" ? "peloEstilosHombre" : "peloEstilosMujer"), rnd);
  // Barba (pedido 2026-08-30): antes SIEMPRE "solo hombres", cableado en
  // código — ahora `npc.permiteBarba` (bool) puede pisar esa regla por
  // entrada del catálogo (p.ej. una NPC concreta con barba, un personaje
  // excéntrico). Sin el campo, comportamiento EXACTO de siempre.
  const permiteBarba = npc.permiteBarba !== undefined ? npc.permiteBarba : sexo === "hombre";
  const barbaEstilo = permiteBarba ? elegir(pesos("barbaEstilos"), rnd) : "ninguna";
  // Color de pelo: casi siempre de la paleta NATURAL ponderada de siempre,
  // pero con `probabilidadColorFantasia` (rasgos.json, ampliación 2026-09-01)
  // sale un color de "ruleta" — cualquier tono de TODA la gama cromática
  // (hslAHex arriba), no solo los 7 tonos naturales del catálogo.
  const probFantasia = (npc.rasgos && npc.rasgos.probabilidadColorFantasia) ?? npc.probabilidadColorFantasia ?? rasgosBase.probabilidadColorFantasia ?? 0;
  const peloColorFantasia = rnd() < probFantasia ? colorPeloFantasia(rnd) : null;
  const peloColorId = peloColorFantasia ? peloColorFantasia.id : elegir(pesos("coloresPelo"), rnd);
  const pielColorId = elegir(pesos("coloresPiel"), rnd);
  const ojosColorId = elegir(pesos("coloresOjos"), rnd);

  // Ropa (pedido 2026-08-30, docs/GDD_Ropa_Procedural.md): antes `ropa` era
  // SIEMPRE una lista fija a mano por NPC. Si un NPC no trae `ropa` en el
  // catálogo, se resuelve automáticamente cruzando su `profesion` con
  // `ropa/catalogo/profesiones.json` (mismo mecanismo que ya usaba ropa/ en
  // solitario) — determinista por npcId, no por semilla del individuo (toda
  // la aldea del mismo oficio viste igual, como pide "uniforme" en guardia/
  // sacerdote). Los 39 NPCs con `ropa` ya curada a mano NO se tocan.
  let ropa = npc.ropa;
  if (!ropa) {
    const profesionRopa = catalogos.ropaProfesiones?.[npc.profesion];
    if (profesionRopa) {
      const prendasLimpias = Object.fromEntries(Object.entries(catalogos.ropaPrendas).filter(([k]) => !k.startsWith("_")));
      ropa = Object.values(elegirConjuntoPorProfesion(prendasLimpias, profesionRopa, npc.profesion));
    } else {
      ropa = [];
    }
  }

  const ficha = {
    npcId,
    semilla,
    profesion: npc.profesion,
    sexo,
    morfologia,
    rasgos: {
      peloEstilo,
      barbaEstilo,
      peloColor: peloColorFantasia || { id: peloColorId, hex: colorDe(rasgosBase.coloresPelo, peloColorId) },
      pielColor: { id: pielColorId, hex: colorDe(rasgosBase.coloresPiel, pielColorId) },
      ojosColor: { id: ojosColorId, hex: colorDe(rasgosBase.coloresOjos, ojosColorId) },
    },
    ropa,
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
