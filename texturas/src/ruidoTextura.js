"use strict";
// Primitivas de generación de texturas tileables (docs/GDD_Bakeador_Texturas.md)
// — canvas puro sobre el ruido de gradiente ya existente (`baker/src/ruido.js`,
// el mismo que usa el terreno), sin dependencias nuevas. Validado antes en un
// prototipo suelto: ruido periódico "sumas de senos" se veía demasiado
// regular (a rayas), así que aquí se usa SIEMPRE ruido de gradiente real
// (fbm multi-octava) con la técnica clásica de "seamless noise" — mezclar 4
// copias desplazadas ±N con peso bilineal para que el borde cierre exacto
// sin perder el aspecto orgánico de un ruido complejo de verdad.
const { CapaRuido, semillaDesdeTexto, crearPRNG } = require("../../baker/src/ruido");

/**
 * Ruido de gradiente fbm que tesela sin costura en un lienzo de NxN —
 * técnica de "seamless noise" clásica: mezcla 4 copias desplazadas ±N con
 * peso bilineal (u,v = posición 0..1 dentro del tile). La mezcla usa
 * SIEMPRE la posición real (x,y) del tile para calcular u/v — el borde x=0
 * cae exacto sobre x=N por álgebra pura, sin importar qué transformación
 * interna se le aplique a la muestra de ruido en sí (ver estiramientoX/Y).
 * @param {number} N - tamaño del patrón en píxeles
 * @param {string} semillaTexto
 * @param {number} escala - escala del ruido en PÍXELES (no se reescala con N:
 *   así "más resolución" no cambia el tamaño de las formas, solo su nitidez —
 *   error real que se cometió afinando el prototipo, documentado aquí para
 *   no repetirlo).
 * @param {number} octavas
 * @param {number} [estiramientoX=1] - alarga/comprime el patrón de ruido en
 *   X (ej. veta de madera corriendo a lo largo). IMPORTANTE: nunca
 *   pre-multiplicar x por un factor ANTES de llamar a la función que
 *   devuelve esto — eso rompe el cierre del borde (bug real, encontrado por
 *   el test de teselado: la madera no cerraba porque `veta(x*0.3, y)`
 *   desalineaba la condición u→1 del borde real x=N). El estiramiento va
 *   SIEMPRE dentro, aplicado solo a la muestra de ruido, nunca al cálculo
 *   de u/v.
 * @param {number} [estiramientoY=1]
 */
function ruidoSemblante(N, semillaTexto, escala, octavas, estiramientoX = 1, estiramientoY = 1) {
  const capa = new CapaRuido(semillaTexto, escala);
  const muestra = (x, y) => capa.fbm(x * estiramientoX, y * estiramientoY, octavas);
  return (x, y) => {
    const u = x / N, v = y / N;
    const a = muestra(x, y);
    const b = muestra(x - N, y);
    const c = muestra(x, y - N);
    const d = muestra(x - N, y - N);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mezclar(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, t))));
}

// Aclara/oscurece un color un factor dado (>1 aclara, <1 oscurece) — para
// derivar los 3 tonos (claro/base/oscuro) de cada familia a partir del
// ÚNICO colorDebug que ya trae el catálogo (terrenos.json/materiales.json),
// sin tener que declarar 3 colores a mano por cada entrada nueva.
function tono(hex, factor) {
  const [r, g, b] = hexRGB(hex);
  const ajustar = (c) => Math.max(0, Math.min(255, Math.round(factor >= 1 ? c + (255 - c) * (factor - 1) : c * factor)));
  return [ajustar(r), ajustar(g), ajustar(b)];
}

// Sello circular con borde irregular (para decoración excepcional dentro de
// una familia, ej. una veta más marcada) — con margen obligatorio respecto
// al borde para no romper el teselado entre variantes (ver nota en
// familias.js: la decoración suelta de verdad, tipo flor/piedrecita, NO va
// aquí — va al decorador de props normal, baker/src/decoracion.js, para no
// repetir el error de "rejilla de decoración" del prototipo).
function crearSello(semilla, radio) {
  const borde = new CapaRuido(`${semilla}:borde`, Math.max(1, radio * 0.6));
  return (px, py, cx, cy, color, fondo, t) => {
    const dx = px - cx, dy = py - cy;
    const dist = Math.hypot(dx, dy);
    const irregular = radio * (0.75 + borde.ruido2D(px, py) * 0.5);
    if (dist > irregular) return fondo;
    const suaviza = 1 - Math.min(1, dist / irregular);
    return mezclar(fondo, color, t * (0.5 + suaviza * 0.5));
  };
}

function colocarSellos(N, margen, semilla, cantidad, minRadio, maxRadio) {
  const rnd = crearPRNG(semillaDesdeTexto(semilla));
  const sellos = [];
  for (let i = 0; i < cantidad; i++) {
    sellos.push({
      x: margen + rnd() * (N - 2 * margen),
      y: margen + rnd() * (N - 2 * margen),
      r: minRadio + rnd() * (maxRadio - minRadio),
    });
  }
  return sellos;
}

module.exports = { ruidoSemblante, hexRGB, mezclar, tono, crearSello, colocarSellos };
