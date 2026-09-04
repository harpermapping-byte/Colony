"use strict";
// Generador de los HITOS DE PLAZA de ciudades/ (pozo/fuente/estatua que
// ciudades/src/generar.js ya coloca en el punto focal de cada asentamiento
// según su tier — ver el bloque "HITO de plaza" ~línea 760 de ese archivo,
// NO tocado por este generador). Mismo patrón que generar_naturaleza.js:
// lee DIRECTAMENTE ciudades/catalogo/decoracion.json (colorDebug como color
// base, dimensiones como referencia real de tamaño — nunca proporciones
// inventadas), un arquetipo propio por pieza (son props ESTRUCTURALES
// sueltos, ni mueble de interior ni vegetación/roca) y varias variantes por
// semilla (mulberry32, cero Math.random). Cero catálogo nuevo.
//
// Piezas: pozo_agua (brocal+torno+cubo colgante), fuente_piedra (plato +
// pilar + remate con agua), estatua_piedra (pedestal + figura estilizada,
// nunca una figura humana realista — icónico/heráldico, mismo criterio que
// estatua_lider_bronce/estatua_pequena de interiores/catalogo/elementos.json).
//
// Mismo formato de salida que el resto del taller ({grid, paleta, cajas},
// resolucion=U) — exportar_lote.js los convierte a .glb por variante a una
// carpeta de PREVISUALIZACIÓN, NUNCA a assets/ (flujo de aprobación
// pactado, ver CLAUDE.md):
//
//   node generar_hitos_plaza.js
//   node exportar_lote.js hitos_plaza_generados.json output/hitos_plaza_glb

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../interiores/src/azar");

const decoracion = require("../ciudades/catalogo/decoracion.json");

const U = 10; // subdivisiones de vóxel por casilla — mismo criterio que generar_naturaleza.js/generar_edificio.js
const NUM_VARIANTES = 3; // pedido: "cada pieza con al menos 2-3 variantes"

const MADERA_POSTE = "#5a4028"; // marrón madera — coherente con valla_madera/carreta del propio decoracion.json
const CUERDA = "#c9b892";
const CUBO_MADERA = "#7c6034"; // mismo tono que la entrada cubo_madera de decoracion.json (el cubo colgante ES ese mismo prop)
const AGUA = "#5a93b0";

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
  return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function Builder() {
  const paleta = [];
  const cajas = [];
  function color(hex) {
    let i = paleta.indexOf(hex);
    if (i === -1) { i = paleta.length; paleta.push(hex); }
    return i;
  }
  function caja(x0, y0, z0, x1, y1, z1, hex) {
    if (x1 < x0 || y1 < y0 || z1 < z0) return;
    cajas.push([Math.round(x0), Math.round(y0), Math.round(z0), Math.round(x1), Math.round(y1), Math.round(z1), color(hex)]);
  }
  return { caja, paleta, cajas };
}

// --- arquetipos -------------------------------------------------------------

// pozo_agua (dimensiones catálogo [1.4, 1.5, 1.4]): brocal + 2 postes con
// viga y torno + cuerda con cubo colgando dentro del brocal. `redondo`
// (variante por semilla) chaflana las 4 esquinas del brocal para dar
// sensación de circular sin recurrir a booleanos sobre cajas AABB.
function pozo(color, rnd, opciones = {}) {
  const b = Builder();
  const lado = Math.round(U * (1.05 + rnd() * 0.15)); // ligado a dimensiones[0]/[2]=1.4
  const espesor = Math.max(2, Math.round(U * 0.16));
  const altoBrocal = Math.round(U * (0.4 + rnd() * 0.15)); // ligado a dimensiones[1]=1.5 (la parte baja)
  const g = lado + Math.round(U * 0.9); // margen para postes + cubo colgante
  const cx = Math.round(g / 2), cz = Math.round(g / 2);
  const half = Math.round(lado / 2);
  const chaflan = opciones.redondo ? Math.max(1, Math.round(espesor * 0.9)) : 0;
  const tonoBorde = sombrear(color, 1.1);
  const tonoEsquina = sombrear(color, 0.88);

  // 4 paredes del brocal (recortadas en las esquinas si es la variante "redonda")
  b.caja(cx - half + chaflan, 0, cz - half, cx + half - 1 - chaflan, altoBrocal - 1, cz - half + espesor - 1, color);
  b.caja(cx - half + chaflan, 0, cz + half - espesor, cx + half - 1 - chaflan, altoBrocal - 1, cz + half - 1, color);
  b.caja(cx - half, 0, cz - half + chaflan, cx - half + espesor - 1, altoBrocal - 1, cz + half - 1 - chaflan, color);
  b.caja(cx + half - espesor, 0, cz - half + chaflan, cx + half - 1, altoBrocal - 1, cz + half - 1 - chaflan, color);
  if (opciones.redondo) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ex0 = sx < 0 ? cx - half : cx + half - chaflan;
      const ez0 = sz < 0 ? cz - half : cz + half - chaflan;
      b.caja(ex0, 0, ez0, ex0 + chaflan - 1, Math.round(altoBrocal * 0.75) - 1, ez0 + chaflan - 1, tonoEsquina);
    }
  }
  // reborde superior, un poco más ancho que el brocal
  b.caja(cx - half - 1, altoBrocal, cz - half - 1, cx + half, altoBrocal, cz + half, tonoBorde);

  // 2 postes centrados en X, a los lados en Z, con viga y torno arriba
  const grosorPoste = Math.max(2, Math.round(espesor * 0.9));
  const altoPoste = altoBrocal + Math.round(U * 0.9);
  const zPoste0 = cz - half - grosorPoste;
  const zPoste1 = cz + half;
  b.caja(cx - grosorPoste / 2, altoBrocal, zPoste0, cx + grosorPoste / 2 - 1, altoPoste - 1, zPoste0 + grosorPoste - 1, MADERA_POSTE);
  b.caja(cx - grosorPoste / 2, altoBrocal, zPoste1, cx + grosorPoste / 2 - 1, altoPoste - 1, zPoste1 + grosorPoste - 1, MADERA_POSTE);
  // viga que une los dos postes por arriba
  b.caja(cx - grosorPoste / 2, altoPoste, zPoste0, cx + grosorPoste / 2 - 1, altoPoste + 1, zPoste1 + grosorPoste - 1, MADERA_POSTE);
  // torno: barra horizontal bajo la viga, entre postes (aprox. del cilindro real)
  b.caja(cx - grosorPoste / 2 + 1, altoPoste - 2, zPoste0 + grosorPoste, cx + grosorPoste / 2 - 2, altoPoste, zPoste1 - 1, sombrear(MADERA_POSTE, 1.2));

  // cuerda + cubo colgante en el centro del pozo (la altura del cubo varía por semilla: cuánta cuerda se ha soltado)
  const yCubo = altoBrocal + Math.round(U * 0.1) + Math.floor(rnd() * Math.round(U * 0.25));
  b.caja(cx, yCubo, cz, cx, altoPoste - 1, cz, CUERDA);
  b.caja(cx - 1, yCubo - Math.round(U * 0.18), cz - 1, cx, yCubo, cz, CUBO_MADERA);

  return { grid: [g, altoPoste + 2, g], paleta: b.paleta, cajas: b.cajas };
}

// fuente_piedra (dimensiones catálogo [2.2, 1.6, 2.2]): plato bajo con
// lámina de agua + pilar central + plato superior más pequeño + remate con
// gota de agua en la cúspide (opcional, opciones.agua).
function fuente(color, rnd, opciones = {}) {
  const b = Builder();
  const anchoBase = Math.round(U * (1.9 + rnd() * 0.25)); // ligado a dimensiones[0]/[2]=2.2
  const g = anchoBase + 2;
  const cx = Math.round(g / 2), cz = Math.round(g / 2);
  const halfBase = Math.round(anchoBase / 2);
  const altoPlato = Math.round(U * (0.28 + rnd() * 0.08));
  const espesorBorde = Math.max(2, Math.round(U * 0.14));
  const tonoOscuro = sombrear(color, 0.85);
  const tonoClaro = sombrear(color, 1.12);

  // base maciza bajo el plato
  b.caja(cx - halfBase, 0, cz - halfBase, cx + halfBase - 1, Math.round(altoPlato * 0.5) - 1, cz + halfBase - 1, tonoOscuro);
  // paredes del plato (anillo — deja el centro hueco para la lámina de agua)
  b.caja(cx - halfBase, 0, cz - halfBase, cx + halfBase - 1, altoPlato - 1, cz - halfBase + espesorBorde - 1, color);
  b.caja(cx - halfBase, 0, cz + halfBase - espesorBorde, cx + halfBase - 1, altoPlato - 1, cz + halfBase - 1, color);
  b.caja(cx - halfBase, 0, cz - halfBase + espesorBorde, cx - halfBase + espesorBorde - 1, altoPlato - 1, cz + halfBase - espesorBorde - 1, color);
  b.caja(cx + halfBase - espesorBorde, 0, cz - halfBase + espesorBorde, cx + halfBase - 1, altoPlato - 1, cz + halfBase - espesorBorde - 1, color);
  // lámina de agua dentro del plato inferior
  b.caja(cx - halfBase + espesorBorde, altoPlato - 2, cz - halfBase + espesorBorde, cx + halfBase - espesorBorde - 1, altoPlato - 1, cz + halfBase - espesorBorde - 1, AGUA);

  // pilar central
  const anchoPilar = Math.max(2, Math.round(U * 0.22));
  const altoTotal = Math.round(U * (1.35 + rnd() * 0.2)); // ligado a dimensiones[1]=1.6
  const yPlato2 = altoTotal - Math.round(U * 0.3);
  b.caja(cx - anchoPilar, altoPlato, cz - anchoPilar, cx + anchoPilar - 1, yPlato2 - 1, cz + anchoPilar - 1, color);

  // plato superior, más pequeño que la base
  const anchoPlato2 = Math.round(anchoBase * 0.45);
  const halfPlato2 = Math.round(anchoPlato2 / 2);
  const altoPlato2 = Math.round(U * 0.12);
  b.caja(cx - halfPlato2, yPlato2, cz - halfPlato2, cx + halfPlato2 - 1, yPlato2 + altoPlato2 - 1, cz + halfPlato2 - 1, tonoClaro);

  // remate con gota de agua en la cúspide (desactivable — el catálogo lo marca opcional)
  const yTapa = yPlato2 + altoPlato2;
  let yFinal = yTapa;
  if (opciones.agua !== false) {
    b.caja(cx - 1, yTapa, cz - 1, cx, yTapa + Math.round(U * 0.18) - 1, cz, color);
    b.caja(cx - 1, yTapa + Math.round(U * 0.18), cz - 1, cx, yTapa + Math.round(U * 0.18), cz, AGUA);
    yFinal = yTapa + Math.round(U * 0.18) + 1;
  }

  return { grid: [g, yFinal + 1, g], paleta: b.paleta, cajas: b.cajas };
}

// estatua_piedra (dimensiones catálogo [1.2, 2.6, 1.2]): pedestal + plinto
// + columna/torso + hombros + cabeza estilizada, con un brazo/objeto alzado
// opcional (espada/estandarte) en algunas variantes — icónico y heráldico a
// propósito, JAMÁS una figura humana realista (mismo criterio que
// estatua_lider_bronce/estatua_pequena de interiores/catalogo/elementos.json).
function estatua(color, rnd, opciones = {}) {
  const b = Builder();
  const anchoPedestal = Math.round(U * (1.0 + rnd() * 0.15)); // ligado a dimensiones[0]/[2]=1.2
  const g = anchoPedestal + 4;
  const cx = Math.round(g / 2), cz = Math.round(g / 2);
  const halfPedestal = Math.round(anchoPedestal / 2);
  const altoPedestal = Math.round(U * (0.45 + rnd() * 0.1));
  const tonoOscuro = sombrear(color, 0.82);
  const tonoClaro = sombrear(color, 1.15);

  // pedestal (base ancha) + moldura superior
  b.caja(cx - halfPedestal, 0, cz - halfPedestal, cx + halfPedestal - 1, altoPedestal - 1, cz + halfPedestal - 1, tonoOscuro);
  b.caja(cx - halfPedestal - 1, altoPedestal - 1, cz - halfPedestal - 1, cx + halfPedestal, altoPedestal, cz + halfPedestal, tonoClaro);

  // plinto (más estrecho) encima del pedestal
  const anchoPlinto = Math.max(2, Math.round(anchoPedestal * 0.6));
  const halfPlinto = Math.round(anchoPlinto / 2);
  const altoPlinto = Math.round(U * 0.3);
  let y = altoPedestal;
  b.caja(cx - halfPlinto, y, cz - halfPlinto, cx + halfPlinto - 1, y + altoPlinto - 1, cz + halfPlinto - 1, color);
  y += altoPlinto;

  // columna/torso de la figura — el grueso de la altura total (dimensiones[1]=2.6)
  const anchoTorso = Math.max(2, Math.round(U * 0.26));
  const altoTorso = Math.round(U * (0.95 + rnd() * 0.2));
  b.caja(cx - anchoTorso, y, cz - anchoTorso, cx + anchoTorso - 1, y + altoTorso - 1, cz + anchoTorso - 1, color);
  // brazos: dos barras verticales pegadas al torso, colgando hacia abajo —
  // lo mínimo para que la silueta se lea como una figura, no una columna
  const anchoBrazo = Math.max(1, Math.round(anchoTorso * 0.5));
  b.caja(cx - anchoTorso - anchoBrazo, y, cz - anchoBrazo, cx - anchoTorso - 1, y + Math.round(altoTorso * 0.85) - 1, cz + anchoBrazo - 1, tonoOscuro);
  b.caja(cx + anchoTorso, y, cz - anchoBrazo, cx + anchoTorso + anchoBrazo - 1, y + Math.round(altoTorso * 0.85) - 1, cz + anchoBrazo - 1, tonoOscuro);
  y += altoTorso;

  // hombros: barra horizontal más ancha que el torso — silueta heráldica
  const anchoHombros = Math.round(anchoTorso * 1.8);
  const altoHombros = Math.max(2, Math.round(U * 0.16));
  b.caja(cx - anchoHombros, y, cz - anchoTorso, cx + anchoHombros - 1, y + altoHombros - 1, cz + anchoTorso - 1, tonoClaro);

  // brazo/objeto alzado opcional (espada o estandarte) — solo algunas variantes
  let topeObjeto = 0;
  if (opciones.objetoAlzado) {
    const lado = rnd() < 0.5 ? -1 : 1;
    const altoObjeto = Math.round(U * (0.5 + rnd() * 0.3));
    const bx = lado < 0 ? cx - anchoHombros - 1 : cx + anchoHombros;
    b.caja(bx, y, cz - 1, bx + 1, y + altoObjeto - 1, cz, tonoClaro);
    topeObjeto = y + altoObjeto;
  }
  y += altoHombros;

  // cabeza estilizada (cubo simple, sin rasgos — icónico, no realista)
  const anchoCabeza = Math.max(3, Math.round(U * 0.3));
  b.caja(cx - anchoCabeza / 2, y, cz - anchoCabeza / 2, cx + anchoCabeza / 2 - 1, y + anchoCabeza - 1, cz + anchoCabeza / 2 - 1, color);
  y += anchoCabeza;

  return { grid: [g, Math.max(y, topeObjeto) + 1, g], paleta: b.paleta, cajas: b.cajas };
}

const ARQUETIPO_FN = { POZO: pozo, FUENTE: fuente, ESTATUA: estatua };

// clasificación por id — solo 3 piezas reales, sin ambigüedad ninguna
const CLASIFICACION = {
  pozo_agua: { arquetipo: "POZO", variante: (n) => ({ redondo: n % 2 === 0 }) },
  fuente_piedra: { arquetipo: "FUENTE", variante: (n) => ({ agua: n !== 3 }) }, // la variante 03 sale sin remate de agua, más sobria
  estatua_piedra: { arquetipo: "ESTATUA", variante: (n) => ({ objetoAlzado: n !== 1 }) }, // la variante 01 sale "desnuda", 02/03 con objeto alzado
};

function generarTodo() {
  const resultado = {};
  const conteo = {};
  for (const [id, { arquetipo, variante }] of Object.entries(CLASIFICACION)) {
    const entrada = decoracion[id];
    if (!entrada) throw new Error(`${id} no existe en ciudades/catalogo/decoracion.json`);
    conteo[arquetipo] = (conteo[arquetipo] || 0) + 1;
    for (let n = 1; n <= NUM_VARIANTES; n++) {
      const rnd = crearPRNG(`${id}|${n}`);
      const modelo = ARQUETIPO_FN[arquetipo](entrada.colorDebug, rnd, variante(n));
      const nn = String(n).padStart(2, "0");
      resultado[`${id}_${nn}`] = { nombre: `${id.replace(/_/g, " ")} (var ${nn})`, arquetipo, resolucion: U, ...modelo };
    }
  }
  return { resultado, conteo };
}

if (require.main === module) {
  const { resultado, conteo } = generarTodo();
  fs.writeFileSync(path.join(__dirname, "hitos_plaza_generados.json"), JSON.stringify(resultado));
  console.log(`Generados: ${Object.keys(resultado).length} modelos (${NUM_VARIANTES} variantes x 3 hitos)`);
  console.log("Por arquetipo:", conteo);
}

module.exports = { generarTodo, ARQUETIPO_FN, CLASIFICACION, U, NUM_VARIANTES };
