"use strict";
// Familias de textura — una función generadora por "estilo visual", NO por
// id de catálogo: varios ids de terrenos.json/materiales.json comparten
// familia (ver mapeoCatalogo.js) y solo cambian de tono, derivado de su
// propio `colorDebug` ya existente. "Las listas crecen, el código no"
// (CLAUDE.md): añadir un terreno/material nuevo es una línea en
// mapeoCatalogo.js, nunca una familia nueva salvo que el material sea
// visualmente distinto de verdad de las 9 que ya hay.
//
// Cada familia recibe (N, colorBaseHex, semilla) y devuelve pintar(x,y),
// listo para volcar a un PNG de NxN — la MISMA base (macro+micro) para
// TODAS las variantes de un id (solo cambia el sello de detalle, con
// margen respecto al borde) es lo que garantiza que las variantes tesclen
// entre sí sin costura (ver ruidoTextura.js).
const { ruidoSemblante, hexRGB, tono, crearSello, colocarSellos } = require("./ruidoTextura");

const MARGEN_SELLO_FRACCION = 0.11; // ningún sello puede acercarse más al borde que esta fracción de N, o rompe el encaje entre variantes — proporcional, no un píxel fijo, para que funcione igual a cualquier resolución

function piedra(N, colorBase, semilla) {
  const macro = ruidoSemblante(N, `${semilla}:macro`, 40, 5);
  const micro = ruidoSemblante(N, `${semilla}:micro`, 10, 3);
  const grieta = ruidoSemblante(N, `${semilla}:grieta`, 55, 4);
  const claro = tono(colorBase, 1.2), oscuro = tono(colorBase, 0.6);
  const fondo = (x, y) => {
    const m = macro(x, y), g = micro(x, y);
    let c = mezclarLocal(oscuro, claro, m);
    c = mezclarLocal(c, tono(colorBase, 1), 1 - Math.abs(g - 0.5) * 0.6);
    const gr = grieta(x, y);
    if (gr > 0.47 && gr < 0.5) c = mezclarLocal(c, [0x28, 0x28, 0x28], 0.6);
    return c;
  };
  return conVariante(N, semilla, fondo, [
    { nombre: "musgo", crear: (s) => crearSello(`${s}:musgo`, 5), color: [0x4a, 0x6a, 0x3a], cantidad: 2, radio: [3, 6], t: 0.5 },
    { nombre: "esquirla", crear: (s) => crearSello(`${s}:esquirla`, 2), color: claro, cantidad: 5, radio: [1, 2.2], t: 0.6 },
  ]);
}

function madera(N, colorBase, semilla) {
  // estiramientoX < 1: la veta corre a lo largo del tablón (eje X) —
  // DENTRO de ruidoSemblante, nunca premultiplicando x antes de llamarla
  // (eso rompía el cierre del borde, ver nota en ruidoTextura.js).
  const veta = ruidoSemblante(N, `${semilla}:veta`, 26, 5, 0.3, 1);
  const poro = ruidoSemblante(N, `${semilla}:poro`, 6, 2);
  const claro = tono(colorBase, 1.25), oscuro = tono(colorBase, 0.55);
  const anchoTablon = N / 3;
  const fondo = (x, y) => {
    const v = veta(x, y);
    let c = mezclarLocal(tono(colorBase, 1), claro, Math.max(0, v - 0.5) * 1.6);
    c = mezclarLocal(c, oscuro, Math.max(0, 0.5 - v) * 1.3);
    if (poro(x, y) > 0.8) c = mezclarLocal(c, oscuro, 0.35);
    const juntaX = x % anchoTablon;
    if (juntaX < 1 || juntaX > anchoTablon - 1) c = mezclarLocal(c, oscuro, 0.6);
    return c;
  };
  return conVariante(N, semilla, fondo, [
    { nombre: "nudo", crear: (s) => crearSello(`${s}:nudo`, 3.2), color: oscuro, cantidad: 1, radio: [2, 3.5], t: 0.7 },
  ]);
}

function tierra(N, colorBase, semilla) {
  const mancha = ruidoSemblante(N, `${semilla}:mancha`, 30, 4);
  const grano = ruidoSemblante(N, `${semilla}:grano`, 8, 3);
  const claro = tono(colorBase, 1.3), oscuro = tono(colorBase, 0.6);
  const fondo = (x, y) => {
    let c = mezclarLocal(oscuro, claro, mancha(x, y));
    c = mezclarLocal(c, tono(colorBase, 1), 1 - Math.abs(grano(x, y) - 0.5) * 0.7);
    return c;
  };
  return conVariante(N, semilla, fondo, [
    { nombre: "guijarro", crear: (s) => crearSello(`${s}:guijarro`, 2), color: [0x8a, 0x8a, 0x84], cantidad: 4, radio: [1, 2], t: 0.6 },
  ]);
}

function cesped(N, colorBase, semilla) {
  const mata = ruidoSemblante(N, `${semilla}:mata`, 22, 5);
  const parche = ruidoSemblante(N, `${semilla}:parche`, 48, 3);
  const claro = tono(colorBase, 1.35), oscuro = tono(colorBase, 0.55), seco = tono(colorBase, 1.1);
  const fondo = (x, y) => {
    let c = mezclarLocal(oscuro, claro, mata(x, y));
    c = mezclarLocal(c, seco, Math.max(0, parche(x, y) - 0.6) * 1.5);
    return mezclarLocal(c, tono(colorBase, 1), 0.25);
  };
  return conVariante(N, semilla, fondo, [
    { nombre: "calva", crear: (s) => crearSello(`${s}:calva`, 6), color: [0x7a, 0x5a, 0x3a], cantidad: 1, radio: [4, 7], t: 0.7 },
  ]);
}

function arena(N, colorBase, semilla) {
  const mancha = ruidoSemblante(N, `${semilla}:mancha`, 30, 4);
  const grano = ruidoSemblante(N, `${semilla}:grano`, 5, 2);
  const claro = tono(colorBase, 1.2), oscuro = tono(colorBase, 0.75);
  const fondo = (x, y) => {
    let c = mezclarLocal(oscuro, claro, mancha(x, y));
    return mezclarLocal(c, tono(colorBase, 1), 1 - Math.abs(grano(x, y) - 0.5) * 0.7);
  };
  return conVariante(N, semilla, fondo, [
    { nombre: "charco", crear: (s) => crearSello(`${s}:charco`, 7), color: tono(colorBase, 0.65), cantidad: 1, radio: [4, 8], t: 0.5 },
  ]);
}

function nieve(N, colorBase, semilla) {
  // La nieve parte de un colorDebug casi blanco (#eef2f5): `tono()` aclara
  // proporcional al margen que queda hasta 255, así que sobre un blanco casi
  // puro apenas mueve nada (bug real, encontrado a ojo en el mosaico de
  // prueba — quedaba plana). En vez de aclarar/oscurecer el mismo tono, la
  // sombra usa un azul-gris fijo (la sombra de la nieve tira a frío, no es
  // "el mismo blanco más oscuro") — mismo criterio visual que cualquier
  // referencia de nieve, sin depender del margen hasta blanco puro.
  const mancha = ruidoSemblante(N, `${semilla}:mancha`, 35, 4);
  const grano = ruidoSemblante(N, `${semilla}:grano`, 8, 3);
  const claro = [0xff, 0xff, 0xfe];
  const sombra = mezclarLocal(hexRGB(colorBase), [0x9a, 0xb2, 0xc4], 0.55);
  const fondo = (x, y) => {
    // Bug real encontrado a ojo: un segundo mezclarLocal aquí "de vuelta
    // hacia colorBase" con peso alto (pensado para grano fino, como en
    // piedra) borraba casi toda la sombra del primer blend — colorBase de
    // la nieve es casi blanco, así que "volver hacia él" apenas se
    // distingue de no hacer nada. El grano fino se queda como una
    // modulación pequeña ENCIMA del resultado, nunca sustituyéndolo.
    const c = mezclarLocal(sombra, claro, mancha(x, y));
    return mezclarLocal(c, claro, Math.max(0, grano(x, y) - 0.5) * 0.3);
  };
  return conVariante(N, semilla, fondo, []);
}

function ladrillo(N, colorBase, semilla) {
  const mota = ruidoSemblante(N, `${semilla}:mota`, 10, 3);
  const claro = tono(colorBase, 1.2), oscuro = tono(colorBase, 0.65);
  const mortero = tono("#c9c0ac", 1);
  const filaAlto = N / 6, ladrilloAncho = N / 3;
  const fondo = (x, y) => {
    const fila = Math.floor(y / filaAlto);
    const offset = (fila % 2) * (ladrilloAncho / 2); // hiladas a matajunta
    const xj = (x + offset) % ladrilloAncho;
    const yj = y % filaAlto;
    const juntaAncho = 1.6;
    if (xj < juntaAncho || yj < juntaAncho) return mortero;
    let c = mezclarLocal(oscuro, claro, mota(x, y));
    return mezclarLocal(c, tono(colorBase, 1), 0.3);
  };
  return conVariante(N, semilla, fondo, []);
}

function liso(N, colorBase, semilla) {
  const veta = ruidoSemblante(N, `${semilla}:veta`, 60, 3);
  const claro = tono(colorBase, 1.1), oscuro = tono(colorBase, 0.9);
  const fondo = (x, y) => mezclarLocal(oscuro, claro, veta(x, y));
  return conVariante(N, semilla, fondo, []);
}

function tela(N, colorBase, semilla) {
  // Trama tejida: dos ondas periódicas perpendiculares (mismo generador
  // seamless, dos ejes) — sin necesitar una familia de ruido nueva.
  const hilo1 = ruidoSemblante(N, `${semilla}:hilo1`, 6, 2);
  const hilo2 = ruidoSemblante(N, `${semilla}:hilo2`, 6, 2);
  const claro = tono(colorBase, 1.2), oscuro = tono(colorBase, 0.7);
  const pasoHilo = 4;
  const fondo = (x, y) => {
    const trama = ((Math.floor(x / pasoHilo) + Math.floor(y / pasoHilo)) % 2 === 0) ? 0.65 : 0.35;
    const variacion = (hilo1(x, y) + hilo2(y, x)) / 2;
    return mezclarLocal(oscuro, claro, trama * 0.6 + variacion * 0.4);
  };
  return conVariante(N, semilla, fondo, []);
}

// --- utilidades locales (evitan el roundtrip mezclar/hexRGB del catálogo público para no reexportar de más) ---
function mezclarLocal(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, t))));
}

// Aplica sellos de detalle SOLO en variantes (nunca en la base compartida)
// — la base es idéntica entre variantes, así que cualquier borde entre dos
// variantes distintas de la misma familia casa exacto por construcción.
function conVariante(N, semillaFamilia, fondo, tiposSello) {
  return {
    fondo,
    variante(indice) {
      const semillaVariante = `${semillaFamilia}:v${indice}`;
      const margen = Math.max(2, N * MARGEN_SELLO_FRACCION);
      const capas = tiposSello.map((t) => ({
        pintar: t.crear(semillaVariante),
        color: t.color,
        t: t.t,
        sellos: colocarSellos(N, margen, `${semillaVariante}:${t.nombre}`, t.cantidad, t.radio[0], t.radio[1]),
      }));
      return (x, y) => {
        let color = fondo(x, y);
        for (const capa of capas) {
          for (const s of capa.sellos) color = capa.pintar(x, y, s.x, s.y, capa.color, color, capa.t);
        }
        return color;
      };
    },
  };
}

// familia -> generador(N, colorBaseHex, semillaFamilia) -> {fondo, variante(i)}
const FAMILIAS = { piedra, madera, tierra, cesped, arena, nieve, ladrillo, liso, tela };

module.exports = { FAMILIAS };
