"use strict";
// Generador de NATURALEZA del taller de vóxeles — la ampliación del creador
// de muebles para todo lo SIN esqueleto (decisión del streamer): árboles,
// arbustos, hierbas, flores, setas, cactus, algas, corales, rocas, menas y
// cristales. Lee DIRECTAMENTE los catálogos reales del baker
// (baker/catalogo/vegetacion.json y rocas.json — ~115 + ~32 especies):
// mismo id, colorDebug como color base y su campo `variantes` como número
// de modelos a generar por especie. Cero catálogos nuevos.
//
// Mismo formato de salida que generar_modelos.js ({grid, paleta, cajas},
// U=10 subdivisiones por casilla) — exportar_glb.js los convierte a .glb
// por variante siguiendo la convención assets/<categoria>/<id>_<NN>.glb.
// Determinista puro: cada variante usa PRNG(id|NN) (mulberry32 compartido
// de interiores/src/azar.js) — regenerar da SIEMPRE los mismos modelos.
//
//   node generar_naturaleza.js           # subconjunto de prueba (1 especie por arquetipo)
//   node generar_naturaleza.js todo      # las ~147 especies (bake de producción: lo corre el usuario)

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../interiores/src/azar");

const vegetacion = require("../baker/catalogo/vegetacion.json");
const rocas = require("../baker/catalogo/rocas.json");

const U = 10; // subdivisiones de vóxel por casilla (mismo criterio que los muebles; exportar con unit=0.1)

const VERDE_FOLLAJE = "#3a6a2a"; // follaje de arbustos cuyo colorDebug es el FRUTO (bayas)
const MARRON_TRONCO = "#5a4028";
const TALLO_SETA = "#d8cfb8";
const ROCA_BASE = "#8a8a8a"; // roca huésped de las vetas de mineral

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

// --- arquetipos -----------------------------------------------------------
// Cada uno recibe (color base del catálogo, rnd de la variante) y devuelve
// {grid, paleta, cajas}. El rnd da la VARIACIÓN entre variantes de la misma
// especie: altura, desplome de copa, número de frutos... — nunca la forma
// base, que es del arquetipo.

function arbolCaduco(color, rnd, opciones = {}) {
  const b = Builder();
  const altoTronco = Math.round(U * (1.1 + rnd() * 0.5));
  const anchoCopa = Math.round(U * (1.3 + rnd() * 0.5));
  const g = anchoCopa + 4;
  const cx = Math.round(g / 2);
  const tr = Math.max(2, Math.round(U * 0.22));
  b.caja(cx - tr, 0, cx - tr, cx + tr - 1, altoTronco - 1, cx + tr - 1, MARRON_TRONCO);
  // copa: 3 masas apiladas con desplome aleatorio — silueta irregular real
  let y = altoTronco;
  for (let capa = 0; capa < 3; capa++) {
    const ancho = Math.round(anchoCopa * (capa === 1 ? 1 : 0.75) / 2);
    const alto = Math.round(U * (0.45 + rnd() * 0.2));
    const dx = Math.round((rnd() - 0.5) * U * 0.4);
    const dz = Math.round((rnd() - 0.5) * U * 0.4);
    b.caja(cx + dx - ancho, y, cx + dz - ancho, cx + dx + ancho - 1, y + alto - 1, cx + dz + ancho - 1, capa === 2 ? sombrear(color, 1.15) : color);
    y += alto - Math.round(U * 0.12);
  }
  // frutos: motas sobre la copa (solo árboles frutales)
  if (opciones.fruto) {
    const nFrutos = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < nFrutos; i++) {
      const fx = cx + Math.round((rnd() - 0.5) * anchoCopa * 0.8);
      const fy = altoTronco + Math.round(rnd() * (y - altoTronco - 2));
      const fz = cx + Math.round((rnd() - 0.5) * anchoCopa * 0.8);
      b.caja(fx, fy, fz, fx, fy, fz, opciones.fruto);
    }
  }
  return { grid: [g, y + 2, g], paleta: b.paleta, cajas: b.cajas };
}

function conifera(color, rnd, opciones = {}) {
  const b = Builder();
  const pisos = 3 + Math.floor(rnd() * 2);
  const anchoBase = Math.round(U * (1.1 + rnd() * 0.3));
  const g = anchoBase + 4;
  const cx = Math.round(g / 2);
  const tr = Math.max(2, Math.round(U * 0.18));
  const altoTronco = Math.round(U * 0.5);
  b.caja(cx - tr, 0, cx - tr, cx + tr - 1, altoTronco - 1, cx + tr - 1, MARRON_TRONCO);
  let y = altoTronco;
  for (let piso = 0; piso < pisos; piso++) {
    const ancho = Math.round((anchoBase / 2) * (1 - piso / pisos));
    const alto = Math.round(U * 0.4);
    // nieve: el piso de arriba lleva una capa blanca encima
    b.caja(cx - ancho, y, cx - ancho, cx + ancho - 1, y + alto - 1, cx + ancho - 1, color);
    if (opciones.nieve) b.caja(cx - ancho, y + alto - 1, cx - ancho, cx + ancho - 1, y + alto - 1, cx + ancho - 1, "#e8ecef");
    y += alto - Math.round(U * 0.08);
  }
  // punta
  b.caja(cx - 1, y, cx - 1, cx, y + Math.round(U * 0.25), cx, opciones.nieve ? "#e8ecef" : sombrear(color, 0.85));
  return { grid: [g, y + Math.round(U * 0.3), g], paleta: b.paleta, cajas: b.cajas };
}

function palmera(color, rnd) {
  const b = Builder();
  const alto = Math.round(U * (1.8 + rnd() * 0.6));
  const g = Math.round(U * 2.2);
  const cx = Math.round(g / 2);
  const tr = Math.max(2, Math.round(U * 0.16));
  // tronco con leve curva (segmentos desplazados)
  const inclinacion = (rnd() - 0.5) * 0.5;
  for (let y = 0; y < alto; y += 2) {
    const dx = Math.round((y / alto) * U * inclinacion);
    b.caja(cx + dx - tr, y, cx - tr, cx + dx + tr - 1, Math.min(y + 1, alto - 1), cx + tr - 1, MARRON_TRONCO);
  }
  const topX = cx + Math.round(U * inclinacion);
  // frondas: tiras FINAS radiando del cogollo (2-3 vóxeles de ancho), que
  // bajan un escalón hacia la punta — nunca una losa continua
  const anchoFronda = 2;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const largo = Math.round(U * (0.7 + rnd() * 0.3));
    const mitad = Math.round(largo / 2);
    const tono = rnd() < 0.5 ? color : sombrear(color, 0.9);
    // tramo interior (a la altura de la copa) y tramo exterior (un escalón
    // más abajo = la caída de la hoja), cada uno una tira estrecha
    for (const [desde, hasta, y] of [[2, mitad, alto], [mitad, largo, alto - 1]]) {
      const x0 = topX + Math.min(dx * desde, dx * hasta);
      const x1 = topX + Math.max(dx * desde, dx * hasta);
      const z0 = cx + Math.min(dz * desde, dz * hasta);
      const z1 = cx + Math.max(dz * desde, dz * hasta);
      b.caja(x0 - (dx === 0 ? anchoFronda / 2 : 0), y, z0 - (dz === 0 ? anchoFronda / 2 : 0),
        x1 + (dx === 0 ? anchoFronda / 2 - 1 : -1) + (dx !== 0 ? 0 : 0), y, z1 + (dz === 0 ? anchoFronda / 2 - 1 : 0) - (dz !== 0 ? 1 : 0), tono);
    }
    // punta caída
    b.caja(topX + dx * largo, alto - 2, cx + dz * largo, topX + dx * largo, alto - 2, cx + dz * largo, sombrear(color, 0.8));
  }
  b.caja(topX - tr, alto, cx - tr, topX + tr - 1, alto + 1, cx + tr - 1, sombrear(color, 0.7)); // cogollo
  return { grid: [g, alto + 4, g], paleta: b.paleta, cajas: b.cajas };
}

function sauce(color, rnd) {
  const b = Builder();
  const altoTronco = Math.round(U * (1.0 + rnd() * 0.3));
  const anchoCopa = Math.round(U * 1.8);
  const g = anchoCopa + 4;
  const cx = Math.round(g / 2);
  const tr = Math.max(2, Math.round(U * 0.2));
  b.caja(cx - tr, 0, cx - tr, cx + tr - 1, altoTronco - 1, cx + tr - 1, MARRON_TRONCO);
  // copa redondeada
  const rCopa = Math.round(anchoCopa / 2);
  b.caja(cx - rCopa, altoTronco, cx - rCopa, cx + rCopa - 1, altoTronco + Math.round(U * 0.7), cx + rCopa - 1, color);
  b.caja(cx - Math.round(rCopa * 0.7), altoTronco + Math.round(U * 0.7), cx - Math.round(rCopa * 0.7), cx + Math.round(rCopa * 0.7) - 1, altoTronco + Math.round(U * 1.0), cx + Math.round(rCopa * 0.7) - 1, sombrear(color, 1.1));
  // cortinas colgantes por el perímetro — LO que hace sauce a un sauce
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + rnd() * 0.3;
    const hx = cx + Math.round(Math.cos(ang) * rCopa * 0.95);
    const hz = cx + Math.round(Math.sin(ang) * rCopa * 0.95);
    const caida = Math.round(altoTronco * (0.5 + rnd() * 0.45));
    b.caja(hx, altoTronco - caida, hz, hx, altoTronco + Math.round(U * 0.3), hz, sombrear(color, 0.8));
  }
  return { grid: [g, altoTronco + Math.round(U * 1.2), g], paleta: b.paleta, cajas: b.cajas };
}

function arbolSeco(color, rnd) {
  const b = Builder();
  const alto = Math.round(U * (1.4 + rnd() * 0.5));
  const g = Math.round(U * 1.6);
  const cx = Math.round(g / 2);
  const tr = Math.max(2, Math.round(U * 0.2));
  b.caja(cx - tr, 0, cx - tr, cx + tr - 1, alto - 1, cx + tr - 1, color);
  // ramas desnudas: 3-4 brazos a alturas distintas
  const nRamas = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < nRamas; i++) {
    const y = Math.round(alto * (0.45 + 0.5 * (i / nRamas)));
    const dir = rnd() < 0.5 ? -1 : 1;
    const ejeX = rnd() < 0.5;
    const largo = Math.round(U * (0.4 + rnd() * 0.35));
    if (ejeX) b.caja(cx + (dir < 0 ? -largo : tr), y, cx - 1, cx + (dir < 0 ? -tr : largo) - 1, y + 1, cx, sombrear(color, 0.85));
    else b.caja(cx - 1, y, cx + (dir < 0 ? -largo : tr), cx, y + 1, cx + (dir < 0 ? -tr : largo) - 1, sombrear(color, 0.85));
    // muñón vertical al final de la rama
    const ex = ejeX ? cx + dir * largo : cx;
    const ez = ejeX ? cx : cx + dir * largo;
    b.caja(ex - 1, y, ez - 1, ex, y + Math.round(U * 0.25), ez, sombrear(color, 0.85));
  }
  return { grid: [g, alto + Math.round(U * 0.3), g], paleta: b.paleta, cajas: b.cajas };
}

function arbusto(color, rnd, opciones = {}) {
  const b = Builder();
  // el colorDebug de una baya es el FRUTO: el follaje va en verde y las
  // motas del fruto encima; un arbusto sin fruto usa su colorDebug de hoja
  const follaje = opciones.fruto ? VERDE_FOLLAJE : color;
  const g = Math.round(U * (0.9 + rnd() * 0.3));
  const alto = Math.round(U * (0.5 + rnd() * 0.25));
  b.caja(1, 0, 1, g - 2, alto - 1, g - 2, follaje);
  b.caja(Math.round(g * 0.2), alto, Math.round(g * 0.2), Math.round(g * 0.8) - 1, alto + Math.round(U * 0.15) - 1, Math.round(g * 0.8) - 1, sombrear(follaje, 1.15));
  if (opciones.fruto) {
    const n = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const fx = 1 + Math.floor(rnd() * (g - 2));
      const fy = Math.floor(rnd() * alto);
      const fz = 1 + Math.floor(rnd() * (g - 2));
      b.caja(fx, fy, fz, fx, fy, fz, opciones.fruto);
    }
  }
  return { grid: [g, alto + Math.round(U * 0.2), g], paleta: b.paleta, cajas: b.cajas };
}

function hierba(color, rnd) {
  const b = Builder();
  const g = Math.round(U * 0.9);
  const nTallos = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < nTallos; i++) {
    const x = 1 + Math.floor(rnd() * (g - 2));
    const z = 1 + Math.floor(rnd() * (g - 2));
    const alto = Math.round(U * (0.25 + rnd() * 0.35));
    b.caja(x, 0, z, x, alto - 1, z, i % 3 === 0 ? sombrear(color, 1.2) : color);
  }
  return { grid: [g, Math.round(U * 0.65), g], paleta: b.paleta, cajas: b.cajas };
}

function flor(color, rnd) {
  const b = Builder();
  const g = Math.round(U * 0.8);
  const nFlores = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nFlores; i++) {
    const x = 1 + Math.floor(rnd() * (g - 3));
    const z = 1 + Math.floor(rnd() * (g - 3));
    const alto = Math.round(U * (0.3 + rnd() * 0.2));
    b.caja(x, 0, z, x, alto - 1, z, "#3a6a2a"); // tallo
    // cabeza: cruz de pétalos del colorDebug con centro claro
    b.caja(x - 1, alto, z, x + 1, alto + 1, z, color);
    b.caja(x, alto, z - 1, x, alto + 1, z + 1, color);
    b.caja(x, alto + 1, z, x, alto + 1, z, sombrear(color, 1.35));
  }
  return { grid: [g, Math.round(U * 0.7), g], paleta: b.paleta, cajas: b.cajas };
}

function seta(color, rnd, opciones = {}) {
  const b = Builder();
  const g = Math.round(U * 0.8);
  const nSetas = opciones.corro ? 4 : 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < nSetas; i++) {
    const x = 2 + Math.floor(rnd() * (g - 4));
    const z = 2 + Math.floor(rnd() * (g - 4));
    const altoTallo = Math.round(U * (0.15 + rnd() * 0.15));
    const rSombrero = 1 + Math.floor(rnd() * 2);
    b.caja(x, 0, z, x, altoTallo - 1, z, TALLO_SETA);
    b.caja(x - rSombrero, altoTallo, z - rSombrero, x + rSombrero, altoTallo + 1, z + rSombrero, color);
    b.caja(x - Math.max(0, rSombrero - 1), altoTallo + 2, z - Math.max(0, rSombrero - 1), x + Math.max(0, rSombrero - 1), altoTallo + 2, z + Math.max(0, rSombrero - 1), sombrear(color, 0.9));
    if (opciones.motas) b.caja(x - rSombrero + 1, altoTallo + 2, z, x - rSombrero + 1, altoTallo + 2, z, "#f0ece0");
  }
  return { grid: [g, Math.round(U * 0.55), g], paleta: b.paleta, cajas: b.cajas };
}

function cactus(color, rnd, opciones = {}) {
  const b = Builder();
  const g = Math.round(U * 1.4);
  const cx = Math.round(g / 2);
  if (opciones.pala) {
    // chumbera: palas planas apiladas en abanico
    const nPalas = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < nPalas; i++) {
      const w = Math.round(U * 0.5);
      const alto = Math.round(U * 0.45);
      const x = cx + Math.round((rnd() - 0.5) * U * 0.7);
      const y = Math.round(i * alto * 0.6);
      b.caja(x - w / 2, y, cx - 1, x + w / 2, y + alto, cx, color);
    }
    return { grid: [g, Math.round(U * 1.2), g], paleta: b.paleta, cajas: b.cajas };
  }
  // saguaro: columna central + 2 brazos en L
  const alto = Math.round(U * (1.6 + rnd() * 0.5));
  const tr = Math.max(2, Math.round(U * 0.2));
  b.caja(cx - tr, 0, cx - tr, cx + tr - 1, alto - 1, cx + tr - 1, color);
  for (const dir of [-1, 1]) {
    if (rnd() < 0.2) continue; // algún saguaro sin un brazo
    const yBrazo = Math.round(alto * (0.35 + rnd() * 0.2));
    const largo = Math.round(U * 0.4);
    b.caja(cx + (dir < 0 ? -tr - largo : tr), yBrazo, cx - tr + 1, cx + (dir < 0 ? -tr : tr + largo) - 1, yBrazo + tr, cx + tr - 2, sombrear(color, 0.92));
    const bx = dir < 0 ? cx - tr - largo : cx + tr + largo - tr;
    b.caja(bx, yBrazo, cx - tr + 1, bx + tr - 1, yBrazo + Math.round(U * 0.6), cx + tr - 2, sombrear(color, 0.92));
  }
  return { grid: [g, alto + 2, g], paleta: b.paleta, cajas: b.cajas };
}

function alga(color, rnd) {
  const b = Builder();
  const g = Math.round(U * 0.9);
  const nFrondas = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < nFrondas; i++) {
    const x = 1 + Math.floor(rnd() * (g - 2));
    const z = 1 + Math.floor(rnd() * (g - 2));
    const alto = Math.round(U * (0.5 + rnd() * 0.5));
    // fronda ondulada: segmentos desplazados alternando
    for (let y = 0; y < alto; y += 2) {
      const dx = (Math.floor(y / 2) % 2 === 0 ? 0 : 1) * (i % 2 === 0 ? 1 : -1);
      b.caja(x + dx, y, z, x + dx, Math.min(y + 1, alto - 1), z, y > alto * 0.6 ? sombrear(color, 1.2) : color);
    }
  }
  return { grid: [g, Math.round(U * 1.1), g], paleta: b.paleta, cajas: b.cajas };
}

function coral(color, rnd) {
  const b = Builder();
  const g = Math.round(U * 1.0);
  const cx = Math.round(g / 2);
  // tronco corto del que salen ramas en Y (cuerno de ciervo)
  b.caja(cx - 1, 0, cx - 1, cx, Math.round(U * 0.3), cx, sombrear(color, 0.85));
  const nRamas = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < nRamas; i++) {
    const dx = Math.round((rnd() - 0.5) * U * 0.6);
    const dz = Math.round((rnd() - 0.5) * U * 0.6);
    const alto = Math.round(U * (0.35 + rnd() * 0.35));
    const y0 = Math.round(U * 0.25);
    b.caja(cx + dx - 1, y0, cx + dz - 1, cx + dx, y0 + alto, cx + dz, color);
    b.caja(cx + dx - 1, y0 + alto, cx + dz - 1, cx + dx, y0 + alto + 1, cx + dz, sombrear(color, 1.25)); // punta clara
  }
  return { grid: [g, Math.round(U * 1.0), g], paleta: b.paleta, cajas: b.cajas };
}

function roca(color, rnd, opciones = {}) {
  const b = Builder();
  const g = Math.round(U * (0.9 + rnd() * 0.4));
  // 2-3 bloques solapados con esquinas desiguales — canto irregular
  const nBloques = 2 + Math.floor(rnd() * 2);
  let altoMax = 0;
  for (let i = 0; i < nBloques; i++) {
    const w = Math.round(g * (0.45 + rnd() * 0.3));
    const alto = Math.round(U * (0.3 + rnd() * 0.35));
    const x = Math.floor(rnd() * (g - w));
    const z = Math.floor(rnd() * (g - w));
    b.caja(x, 0, z, x + w - 1, alto - 1, z + w - 1, i === 0 ? color : sombrear(color, 0.85 + rnd() * 0.3));
    altoMax = Math.max(altoMax, alto);
  }
  // motas de mineral: la roca es gris y la MENA es el colorDebug (veta_*)
  if (opciones.mena) {
    const n = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rnd() * g);
      const y = Math.floor(rnd() * altoMax);
      const z = Math.floor(rnd() * g);
      b.caja(x, y, z, x, y, z, opciones.mena);
    }
  }
  return { grid: [g, altoMax + 1, g], paleta: b.paleta, cajas: b.cajas };
}

function cristal(color, rnd) {
  const b = Builder();
  const g = Math.round(U * 0.9);
  // base de roca + racimo de columnas del cristal con punta clara
  b.caja(1, 0, 1, g - 2, Math.round(U * 0.15), g - 2, ROCA_BASE);
  const nCristales = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < nCristales; i++) {
    const x = 2 + Math.floor(rnd() * (g - 4));
    const z = 2 + Math.floor(rnd() * (g - 4));
    const alto = Math.round(U * (0.3 + rnd() * 0.4));
    b.caja(x - 1, Math.round(U * 0.15), z - 1, x, Math.round(U * 0.15) + alto, z, color);
    b.caja(x - 1, Math.round(U * 0.15) + alto, z - 1, x, Math.round(U * 0.15) + alto + 1, z, sombrear(color, 1.45)); // punta brillante
  }
  return { grid: [g, Math.round(U * 0.8), g], paleta: b.paleta, cajas: b.cajas };
}

// --- clasificación: catálogo -> arquetipo ---------------------------------
// Por categoriaRecurso primero y por id cuando la categoría no distingue
// (un pino y un roble son ambos madera_*). El fallback es HIERBA para
// vegetación y ROCA para rocas — nunca se deja una especie sin modelo.

const CONIFERAS = ["pino", "abeto", "tejo", "pino_nevado", "abeto_blanco_subalpino"];
const NEVADOS = ["pino_nevado", "abeto_blanco_subalpino"];
const CACTUS_PALA = ["chumbera"];
const CACTUS_IDS = ["saguaro", "chumbera"];
const FRUTO_COLOR = { manzano_silvestre: "#c0392b", peral_silvestre: "#c9c05a", cerezo_silvestre: "#a02030", ciruelo_silvestre: "#5a3a6a", madrono: "#c04a2a", granado: "#a03030", higuera: "#5a4a6a", olivo: "#6a7a3a", limonero: "#e0d040", naranjo: "#e08a20", algarrobo: "#6a4a2a" };

function clasificarVegetacion(id, v) {
  const cat = v.categoriaRecurso || "";
  if (CACTUS_IDS.includes(id)) return { arquetipo: "CACTUS", opciones: { pala: CACTUS_PALA.includes(id) } };
  if (cat.startsWith("madera_")) {
    if (id.includes("carbonizado") || id === "arbol_viejo") return { arquetipo: "ARBOL_SECO" };
    if (cat === "madera_sauce" || id.includes("sauce")) return { arquetipo: "SAUCE" };
    if (cat === "madera_palmera") return { arquetipo: "PALMERA" };
    if (CONIFERAS.includes(id)) return { arquetipo: "CONIFERA", opciones: { nieve: NEVADOS.includes(id) } };
    return { arquetipo: "ARBOL_CADUCO" };
  }
  if (cat === "fruta" || cat === "fruto_seco") return { arquetipo: "ARBOL_CADUCO", opciones: { fruto: FRUTO_COLOR[id] || "#c0392b" } };
  if (cat === "baya") return { arquetipo: "ARBUSTO", opciones: { fruto: v.colorDebug } };
  if (cat.startsWith("hongo_")) return { arquetipo: "SETA", opciones: { motas: id === "amanita", corro: id === "corro_de_setas" } };
  if (cat === "flor_medicinal") return { arquetipo: "FLOR" };
  if (cat === "alga") return { arquetipo: "ALGA" };
  if (cat === "coral") return { arquetipo: "CORAL" };
  if (["arbusto_comun", "seto_silvestre", "acebo"].includes(id)) return { arquetipo: "ARBUSTO", opciones: {} };
  if (["lavanda_silvestre", "amapola", "margarita", "diente_de_leon", "manzanilla", "cardo"].includes(id)) return { arquetipo: "FLOR" };
  return { arquetipo: "HIERBA" }; // fibra/cereal/raíz/hierbas varias
}

function clasificarRoca(id, v) {
  const cat = v.categoriaRecurso || "";
  if (cat === "gema" || ["cuarzo", "amatista", "obsidiana"].includes(id)) return { arquetipo: "CRISTAL" };
  if (id.startsWith("veta_") || ["carbon", "estano", "plomo", "azufre", "sal_gema"].includes(id)) {
    return { arquetipo: "ROCA", opciones: { mena: v.colorDebug }, colorBase: ROCA_BASE };
  }
  return { arquetipo: "ROCA" };
}

const ARQUETIPO_FN = {
  ARBOL_CADUCO: arbolCaduco,
  CONIFERA: conifera,
  PALMERA: palmera,
  SAUCE: sauce,
  ARBOL_SECO: arbolSeco,
  ARBUSTO: arbusto,
  HIERBA: hierba,
  FLOR: flor,
  SETA: seta,
  CACTUS: cactus,
  ALGA: alga,
  CORAL: coral,
  ROCA: roca,
  CRISTAL: cristal,
};

// Subconjunto de PRUEBA: 1-2 especies por arquetipo para validar la forma
// antes de la pasada completa (que corre el usuario con `todo`).
const ESPECIES_PRUEBA = [
  "roble", "pino", "pino_nevado", "palmera_datilera", "sauce_lloron", "arbol_carbonizado",
  "manzano_silvestre", "mora", "arbusto_comun", "hierba_alta", "amapola", "amanita",
  "saguaro", "chumbera", "alga_parda", "coral_cuerno_de_ciervo",
  "granito", "veta_hierro", "amatista",
];

function generarTodo(soloPrueba) {
  const resultado = {};
  const conteo = {};
  const fuentes = [
    [vegetacion, clasificarVegetacion],
    [rocas, clasificarRoca],
  ];
  for (const [catalogo, clasificar] of fuentes) {
    for (const [id, v] of Object.entries(catalogo)) {
      if (id.startsWith("_")) continue;
      if (soloPrueba && !ESPECIES_PRUEBA.includes(id)) continue;
      const { arquetipo, opciones = {}, colorBase } = clasificar(id, v);
      conteo[arquetipo] = (conteo[arquetipo] || 0) + 1;
      const nVariantes = v.variantes || 1;
      for (let n = 1; n <= nVariantes; n++) {
        const rnd = crearPRNG(`${id}|${n}`);
        const modelo = ARQUETIPO_FN[arquetipo](colorBase || v.colorDebug, rnd, opciones);
        const nn = String(n).padStart(2, "0");
        resultado[`${id}_${nn}`] = { nombre: `${id.replace(/_/g, " ")} (var ${nn})`, arquetipo, resolucion: U, ...modelo };
      }
    }
  }
  return { resultado, conteo };
}

if (require.main === module) {
  const todo = process.argv.includes("todo");
  const { resultado, conteo } = generarTodo(!todo);
  fs.writeFileSync(path.join(__dirname, "naturaleza_generada.json"), JSON.stringify(resultado));
  console.log(`Generados: ${Object.keys(resultado).length} modelos (${todo ? "catálogo completo" : "subconjunto de prueba"})`);
  console.log("Por arquetipo (especies):", conteo);
}

module.exports = { generarTodo, ARQUETIPO_FN, clasificarVegetacion, clasificarRoca, ESPECIES_PRUEBA, U };
