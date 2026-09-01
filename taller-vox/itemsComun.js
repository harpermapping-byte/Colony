"use strict";
// Utilidades compartidas por los generadores de vóxeles de ÍTEMS de
// inventario (armas/herramientas/objetos/comida): mismo patrón que
// generar_modelos.js (mobiliario) y generar_edificio.js (edificios), pero
// factorizado aparte porque cuatro generadores de ítem lo comparten tal
// cual, a diferencia de mueble/edificio que son uno solo cada uno.
//
// Fuente de verdad de cada ítem: items/catalogo/items.json. El color
// principal SIEMPRE sale de `colorDebug` (regla 2 del CLAUDE.md — nunca
// tablas de color duplicadas) y las piezas metálicas/de mango se derivan
// de él con `sombrear`, igual que hace generar_modelos.js con los muebles.
// Cuando dos ids comparten silueta pero se distinguen por un campo YA
// ESTRUCTURADO del catálogo (familiaMaterial, huella) se usa ESE dato; el
// vocabulario de palabras clave del id solo entra para elegir SILUETA
// (qué arquetipo, p.ej. "hacha_" vs "pico_"), nunca para inventar material.

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// PRNG determinista mulberry32 sembrado por hash del id — regla 3 del
// CLAUDE.md (nada de Math.random en generación). Se usa para el poco
// detalle que conviene variar sin depender de más catálogo (p.ej. el
// número exacto de remaches de un cofre ya usa esto en generar_modelos.js).
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function crearRnd(semilla) {
  let a = hashStr(semilla) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Constructor de piezas — idéntico al de generar_modelos.js/generar_edificio.js.
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
  return { caja, color, paleta, cajas };
}

// Tonos fijos de "material de parte" que NO vienen de colorDebug (guarda/
// remaches metálicos de un arma cuyo colorDebug es la hoja, mango de cuero
// de una honda, etc.) — igual de acotado que METAL/METAL_CLARO en
// generar_modelos.js, no un vocabulario nuevo por-id.
const MADERA_MANGO = "#5a3d20";
const CUERO_MANGO = "#6b4a2e";
const METAL_OSCURO = "#3a3733";
const METAL_CLARO = "#8a8a90";

// Resolución: subdivisiones de vóxel por CASILLA de huella (igual convenio
// que generar_modelos.js). Los ítems son piezas pequeñas de mano — con
// U=12 una daga de huella [1,1] ya sale con mango/guarda/hoja distinguibles.
const U = 12;

module.exports = { sombrear, hashStr, crearRnd, Builder, U, MADERA_MANGO, CUERO_MANGO, METAL_OSCURO, METAL_CLARO };
