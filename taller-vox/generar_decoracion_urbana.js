"use strict";
// Generador de los 21 objetos de DECORACIÓN URBANA de `ciudades/` que
// todavía caían a caja de color placeholder — auditoría previa (agente de
// solo lectura, ver CLAUDE.md "21/32 sin .glb") confirmó que `ciudades/catalogo/decoracion.json`
// tiene 32 ids reales de decoración (bancos, farolas, puestos de mercado,
// carros, jaulas...) y que solo 11 ya tenían `.glb` aprobado en
// `assets/interiores/` (pozo/fuente/estatua/barril/silla/mesa/sacos/
// cestas/abrevadero/maceta, la mayoría heredados del mobiliario de
// interiores o de `generar_hitos_plaza.js`). Este archivo cierra los 21
// que faltaban.
//
// MISMO PATRÓN EXACTO que `generar_hitos_plaza.js`/`generar_puerta_asentamiento.js`
// (los dos precedentes reales para "pieza suelta de ciudades/, sin mueble
// de interiores/ que reusar"): Builder/sombrear/PRNG propios (nada de
// `require` sobre `generar_modelos.js`, que NO es una librería — ejecuta su
// generación completa como script en cuanto se importa), lee DIRECTAMENTE
// `ciudades/catalogo/decoracion.json` (colorDebug como color base,
// dimensiones como huella/altura reales — nunca proporciones inventadas),
// un arquetipo propio por FAMILIA de pieza (varias piezas comparten
// geometría con parámetros distintos, igual que pozo/fuente/estatua
// comparten `Builder`) y 3 variantes por semilla (mulberry32, cero
// `Math.random()`).
//
// La categoría de destino es "interiores" (no "edificios"): `ciudades/`
// exporta objetos de decoración urbana con `t:"m"` (mismo tipo que
// mobiliario) — `sectorVisual.ts` ya prueba genéricamente
// `assets/interiores/<id>_NN.glb` para ese tipo, cero cambio de cliente.
//
//   node generar_decoracion_urbana.js
//   node exportar_lote.js decoracion_urbana_generada.json ../assets/interiores --centrar-xz
//
// (--centrar-xz: mismo criterio que el mobiliario de interiores/carpintero
// — el cliente posiciona categoría "m" con esquina+ancho/2, un objeto
// anclado por la esquina en vez de centrado saldría desplazado medio hueco
// de su huella de colisión real, mismo bug ya cerrado el 2026-09-06.)
//
// Enganche rápido (pedido explícito, mismo criterio ya usado repetidas
// veces en este proyecto para lotes grandes de arte procedural — hitos de
// plaza, puerta de asentamiento, herramientas/armas, objetos de
// expositor): se sube DIRECTO a `assets/interiores/` sin revisión pieza a
// pieza. El streamer puede pedir rehacer cualquiera de las 21 tras verla.

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../interiores/src/azar");

const decoracion = require("../ciudades/catalogo/decoracion.json");

const U = 10; // subdivisiones de vóxel por casilla — mismo criterio que el resto del taller
const NUM_VARIANTES = 3; // mismo criterio que generar_hitos_plaza.js

const METAL = "#3a3733"; // hierro forjado — mismo tono que generar_modelos.js
const METAL_CLARO = "#6b665c";
const LLAMA_NUCLEO = "#fff4c2";
const LLAMA = "#ffb545";
const LLAMA_BORDE = "#e0672a";
const CRISTAL = "#bcd6dc";
const CUERDA = "#c9b892";

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

// Tonos discretos de material por variante (madera clara/media/oscura, o
// piedra clara/media/oscura según el color base) — da variedad real de
// aspecto entre las 3 variantes de una misma pieza sin duplicar geometría.
const TONO_VARIANTE = [1.12, 0.85, 1.0];
function tonoVariante(colorBase, n) {
  return sombrear(colorBase, TONO_VARIANTE[(n - 1) % TONO_VARIANTE.length]);
}

// grid en vóxeles a partir de `dimensiones` del catálogo ([x,y,z] en
// casillas de mundo) — mismo convenio que pozo/fuente/estatua (dimensiones
// como REFERENCIA de tamaño, escalado a U vóxeles por casilla).
function gridDeDims(dimensiones) {
  const [dx, dy, dz] = dimensiones;
  return [Math.max(2, Math.round(dx * U)), Math.max(1, Math.round(dy * U)), Math.max(2, Math.round(dz * U))];
}

// --- GRUPO A: adaptado de la geometría ya probada de generar_modelos.js ---

// banco_madera / banco_piedra: como generarAsiento pero SIN respaldo (el
// catálogo lo pide explícito) — madera: 4 patas + tablón + travesaño real;
// piedra: dos soportes macizos + losa que vuela un poco, sin patas finas
// (un banco de piedra tallada no lleva patas de madera).
function banco(entrada, id, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const color = tonoVariante(entrada.colorDebug, n);
  const dark = sombrear(color, 0.65);
  if (id === "banco_piedra") {
    const soporteW = Math.max(2, Math.round(gx * 0.16));
    const cuerpoY1 = Math.round(gy * 0.75);
    b.caja(0, 0, 0, soporteW - 1, cuerpoY1, gz - 1, dark);
    b.caja(gx - soporteW, 0, 0, gx - 1, cuerpoY1, gz - 1, dark);
    // travesaño central bajo (refuerzo real, no solo dos bloques sueltos)
    b.caja(soporteW, Math.round(cuerpoY1 * 0.3), Math.round(gz * 0.35), gx - soporteW - 1, Math.round(cuerpoY1 * 0.3) + Math.max(1, Math.round(U * 0.06)), Math.round(gz * 0.65), dark);
    b.caja(0, cuerpoY1, 0, gx - 1, gy - 1, gz - 1, color); // losa superior lisa
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  // banco de madera: 4 patas, travesaños, tablón de asiento con faldón
  const legW = Math.max(1, Math.round(U * 0.12));
  const legH = Math.round(gy * 0.7);
  const seatY0 = legH, seatY1 = gy - 1;
  b.caja(0, 0, 0, legW - 1, legH - 1, legW - 1, dark);
  b.caja(gx - legW, 0, 0, gx - 1, legH - 1, legW - 1, dark);
  b.caja(0, 0, gz - legW, legW - 1, legH - 1, gz - 1, dark);
  b.caja(gx - legW, 0, gz - legW, gx - 1, legH - 1, gz - 1, dark);
  const travY = Math.round(legH * 0.4);
  b.caja(legW, travY, Math.round(legW / 2), gx - legW - 1, travY + Math.max(1, Math.round(U * 0.05)), Math.round(legW / 2) + Math.max(1, Math.round(U * 0.05)), color);
  b.caja(legW, travY, gz - Math.round(legW / 2) - Math.max(1, Math.round(U * 0.05)), gx - legW - 1, travY + Math.max(1, Math.round(U * 0.05)), gz - Math.round(legW / 2), color);
  if (n === 2) {
    // variante con pata central de refuerzo (banco largo)
    b.caja(Math.round(gx / 2) - Math.round(legW / 2), 0, 0, Math.round(gx / 2) + Math.round(legW / 2) - 1, legH - 1, legW - 1, dark);
    b.caja(Math.round(gx / 2) - Math.round(legW / 2), 0, gz - legW, Math.round(gx / 2) + Math.round(legW / 2) - 1, legH - 1, gz - 1, dark);
  }
  b.caja(0, seatY0, 0, gx - 1, seatY0 + Math.max(1, Math.round(U * 0.06)) - 1, gz - 1, dark); // faldón
  b.caja(0, seatY0 + Math.max(1, Math.round(U * 0.06)), 0, gx - 1, seatY1, gz - 1, color); // tablón
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// tinaja_barro: mismo truco de "abombado" (capas cuadradas con inset
// senoidal) que barril/tinaja de generar_modelos.js, pero con bandas de
// arcilla más oscura en vez de aros de METAL (un cántaro de barro no lleva
// herrajes) y boca ancha en la variante 2.
function tinaja(entrada, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const color = tonoVariante(entrada.colorDebug, n);
  const dark = sombrear(color, 0.78), light = sombrear(color, 1.18);
  const nCapas = 8;
  for (let i = 0; i < nCapas; i++) {
    const t = i / (nCapas - 1);
    const bulge = Math.sin(t * Math.PI);
    const inset = Math.round((1 - bulge) * gx * 0.24);
    const y0 = Math.round((gy / nCapas) * i), y1 = Math.round((gy / nCapas) * (i + 1)) - 1;
    const esBanda = i === 1 || i === nCapas - 2;
    b.caja(inset, y0, inset, gx - 1 - inset, y1, gz - 1 - inset, esBanda ? dark : color);
  }
  const bocaAncha = n === 2;
  const bocaInset = Math.round(gx * (bocaAncha ? 0.28 : 0.35));
  b.caja(bocaInset, gy, bocaInset, gx - 1 - bocaInset, gy + Math.max(1, Math.round(U * 0.05)), gz - 1 - bocaInset, light);
  return { grid: [gx, gy + Math.max(1, Math.round(U * 0.05)) + 1, gz], paleta: b.paleta, cajas: b.cajas };
}

// cartel_tienda: panel colgado de un brazo de hierro que sale de la
// fachada (mismo `generarPanelPared` en espíritu — recuadro rehundido con
// un icono central — pero MONTADO sobre un brazo, no plano contra la
// pared) — 3 iconos distintos por variante (rombo/círculo aprox/cruz) para
// que se lea "cartel de tienda genérico", no siempre el mismo símbolo.
function cartelTienda(entrada, rnd, n) {
  const [dx, dy, dz] = entrada.dimensiones;
  const gx = Math.max(6, Math.round(dx * U));
  const gyPanel = Math.max(6, Math.round(dy * U));
  const gzFachada = Math.max(2, Math.round(dz * U));
  const brazoLen = Math.round(U * 0.4);
  const panelT = Math.max(2, Math.round(U * 0.12));
  const b = Builder();
  const color = tonoVariante(entrada.colorDebug, n);
  const marco = sombrear(color, 0.55);
  // brazo de hierro que sale de la fachada
  b.caja(Math.round(gx / 2) - 1, gyPanel - 2, 0, Math.round(gx / 2), gyPanel - 1, gzFachada - 1 + brazoLen, METAL);
  // panel colgado del extremo del brazo (marco + fondo del icono)
  const zPanel0 = gzFachada - 1 + brazoLen;
  b.caja(0, 0, zPanel0, gx - 1, gyPanel - 3, zPanel0 + panelT - 1, marco);
  const inset = Math.max(1, Math.round(U * 0.08));
  b.caja(inset, inset, zPanel0 + panelT, gx - 1 - inset, gyPanel - 3 - inset, zPanel0 + panelT, sombrear(color, 1.3));
  // 2 cadenas de sujeción entre el brazo y las esquinas superiores del panel
  b.caja(1, gyPanel - 3, zPanel0, 1, gyPanel - 2, zPanel0, METAL);
  b.caja(gx - 2, gyPanel - 3, zPanel0, gx - 2, gyPanel - 2, zPanel0, METAL);
  // icono central, distinto por variante — legible como "símbolo de oficio genérico"
  const cx = Math.round(gx / 2), cy = Math.round((gyPanel - 3) / 2);
  const zIcono = zPanel0 + panelT + 1;
  const iconoColor = dark_de(color);
  if (n === 1) { // rombo
    b.caja(cx - 2, cy, zIcono, cx + 1, cy, zIcono, iconoColor);
    b.caja(cx - 1, cy - 1, zIcono, cx, cy + 1, zIcono, iconoColor);
  } else if (n === 2) { // disco (aprox círculo con 2 anchos)
    b.caja(cx - 1, cy - 2, zIcono, cx, cy + 1, zIcono, iconoColor);
    b.caja(cx - 2, cy - 1, zIcono, cx + 1, cy, zIcono, iconoColor);
  } else { // cruz de herramienta
    b.caja(cx - 2, cy - 1, zIcono, cx + 1, cy, zIcono, iconoColor);
    b.caja(cx - 1, cy - 2, zIcono, cx, cy + 1, zIcono, iconoColor);
  }
  return { grid: [gx, gyPanel, zIcono + 1], paleta: b.paleta, cajas: b.cajas };
}
function dark_de(hex) { return sombrear(hex, 0.55); }

// antorcha_poste: trípode + mástil + llama, mismo esquema real que el
// arquetipo `antorcha_pie` de generar_modelos.js (base corta + mástil +
// cabeza envuelta + llama con núcleo/borde), reescrito aquí como pieza
// suelta de exterior en vez de mueble colgado de pared.
function antorchaPoste(entrada, rnd, n) {
  const [dx, dy, dz] = entrada.dimensiones;
  const G = Math.max(6, Math.round(Math.max(dx, dz) * U * 1.8)); // base algo más ancha que el mástil para los 3 pies
  const H = Math.round(dy * U);
  const b = Builder();
  const madera = tonoVariante(entrada.colorDebug, n);
  const cx = Math.round(G / 2);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const fx = Math.round(cx + Math.cos(ang) * G * 0.3), fz = Math.round(cx + Math.sin(ang) * G * 0.3);
    b.caja(fx - 1, 0, fz - 1, fx, Math.round(H * 0.15), fz, sombrear(madera, 0.65));
  }
  b.caja(cx - 1, 0, cx - 1, cx, Math.round(H * 0.72), cx, madera);
  const llamaAlta = n === 3;
  b.caja(cx - 2, Math.round(H * 0.68), cx - 2, cx + 1, Math.round(H * 0.78), cx + 1, sombrear(madera, 0.45)); // cabeza envuelta
  const flameY0 = Math.round(H * (llamaAlta ? 0.8 : 0.78)), flameH = Math.round(H * (llamaAlta ? 0.28 : 0.22));
  b.caja(cx - 2, flameY0, cx - 2, cx + 1, flameY0 + flameH, cx + 1, LLAMA_BORDE);
  b.caja(cx - 1, flameY0 + 1, cx - 1, cx, flameY0 + flameH, cx, LLAMA);
  b.caja(cx - 1, flameY0 + Math.round(flameH * 0.4), cx - 1, cx, flameY0 + flameH - 1, cx, LLAMA_NUCLEO);
  return { grid: [G, flameY0 + flameH + 1, G], paleta: b.paleta, cajas: b.cajas };
}

// charco_agua: losa fina LISA (pedido explícito: nada de rayas/damero) —
// silueta ligeramente ovalada (mordiscos en 2 esquinas opuestas, como el
// chaflán de `generar_hitos_plaza.js::pozo`) + un único reflejo suave, sin
// ningún patrón repetido.
function charco(entrada, rnd, n) {
  const [gx, gyRaw, gz] = gridDeDims(entrada.dimensiones);
  const gy = Math.max(1, gyRaw);
  const b = Builder();
  const color = entrada.colorDebug;
  const light = sombrear(color, 1.35);
  const bite = Math.max(1, Math.round(Math.min(gx, gz) * 0.22));
  b.caja(bite, 0, 0, gx - 1 - bite, gy - 1, gz - 1, color);
  b.caja(0, 0, bite, gx - 1, gy - 1, gz - 1 - bite, color);
  const desplazado = n === 2;
  const rx0 = Math.round(gx * (desplazado ? 0.15 : 0.3)), rx1 = Math.round(gx * (desplazado ? 0.45 : 0.6));
  const rz0 = Math.round(gz * 0.35), rz1 = Math.round(gz * 0.55);
  b.caja(rx0, gy - 1, rz0, rx1, gy - 1, rz1, light);
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// cubo_madera: 2-3 capas troncocónicas (mismo detalle de un objeto pequeño
// de cocina) + aro metálico + asa en arco.
function cuboMadera(entrada, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const color = tonoVariante(entrada.colorDebug, n);
  const capas = 3;
  for (let i = 0; i < capas; i++) {
    const t = i / (capas - 1);
    const inset = Math.round((1 - t) * gx * 0.18);
    const y0 = Math.round((gy / capas) * i), y1 = Math.round((gy / capas) * (i + 1)) - 1;
    b.caja(inset, y0, inset, gx - 1 - inset, y1, gz - 1 - inset, color);
  }
  b.caja(0, gy - Math.max(1, Math.round(U * 0.04)), 0, gx - 1, gy - 1, gz - 1, METAL); // aro superior
  const asaH = Math.max(2, Math.round(U * 0.18));
  const conAsaCaida = n === 3; // variante con el asa caída a un lado (cubo apoyado)
  const zAsa = Math.round(gz / 2);
  if (conAsaCaida) {
    b.caja(1, gy - 1, 0, 2, gy - 1, 1, METAL);
    b.caja(gx - 3, gy - 1, 0, gx - 2, gy - 1, 1, METAL);
    b.caja(1, gy - 1, -1, gx - 2, gy - 1, 0, METAL);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  b.caja(1, gy, zAsa - 1, 2, gy + asaH, zAsa, METAL);
  b.caja(gx - 3, gy, zAsa - 1, gx - 2, gy + asaH, zAsa, METAL);
  b.caja(1, gy + asaH, zAsa - 1, gx - 2, gy + asaH + 1, zAsa, METAL);
  return { grid: [gx, gy + asaH + 2, gz], paleta: b.paleta, cajas: b.cajas };
}

// lena_apilada: 2 cajas apiladas de tono de madera distinto (proporciones
// de tronco, pedido explícito), con vetas horizontales oscuras espaciadas.
function lenaApilada(entrada, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const c1 = tonoVariante(entrada.colorDebug, n);
  const c2 = sombrear(c1, 1.3);
  const dark = sombrear(c1, 0.68);
  const capaH = Math.round(gy / 2);
  b.caja(0, 0, 0, gx - 1, capaH - 1, gz - 1, c1);
  const inset = Math.max(1, Math.round(gx * 0.06));
  b.caja(inset, capaH, inset, gx - 1 - inset, gy - 1, gz - 1 - inset, c2);
  const paso = n === 2 ? 2 : 3; // variante 2: vetas más densas
  for (let z = 1; z < gz - 1; z += paso) { b.caja(0, 0, z, gx - 1, 0, z, dark); b.caja(inset, capaH, z, gx - 1 - inset, capaH, z, dark); }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// --- GRUPO B: arquetipos nuevos ---------------------------------------

// valla_madera + amarradero: familia "poste + travesaño horizontal" — la
// valla lleva 2 travesaños finos espaciados (cerca de estacas), el
// amarradero una única barra gruesa a la altura de la cruz + una anilla de
// atado metálica (nunca al revés, son usos distintos).
function posteYTravesano(entrada, id, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const color = tonoVariante(entrada.colorDebug, n);
  const dark = sombrear(color, 0.7);
  const esAmarradero = id === "amarradero";
  const posteW = Math.max(1, Math.round(U * (esAmarradero ? 0.18 : 0.12)));
  b.caja(0, 0, 0, posteW - 1, gy - 1, posteW - 1, dark);
  b.caja(gx - posteW, 0, 0, gx - 1, gy - 1, posteW - 1, dark);
  if (esAmarradero) {
    const barY0 = Math.round(gy * 0.68), barY1 = barY0 + Math.max(1, Math.round(U * 0.12));
    b.caja(posteW, barY0, 0, gx - posteW - 1, barY1, posteW - 1, color);
    const cx = Math.round(gx / 2);
    b.caja(cx - 1, Math.round(barY0 * 0.6), 0, cx, barY0, posteW - 1, METAL); // anilla de atado
  } else {
    const travesanoDoble = n !== 2;
    const fracciones = travesanoDoble ? [0.3, 0.72] : [0.5];
    for (const frac of fracciones) {
      const barY0 = Math.round(gy * frac), barY1 = barY0 + Math.max(1, Math.round(U * 0.08));
      b.caja(0, barY0, Math.round(posteW / 2) - 1, gx - 1, barY1, Math.round(posteW / 2), color);
    }
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// puesto_mercado + tenderete_comida: familia "mostrador + toldo" — mesa
// frontal + 4 postes de esquina + techo de tela inclinado (más alto por
// detrás) a franjas de dos tonos, distinto género de mercancía visible
// bajo el mostrador según el id (cajas de mercancía vs. brochetas/pan).
function mostradorConToldo(entrada, id, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const madera = tonoVariante(entrada.colorDebug, n);
  const esComida = id === "tenderete_comida";
  const telaBase = esComida ? "#a63a2e" : "#c94a3a";
  const tela = n === 3 ? sombrear(telaBase, 1.15) : telaBase;
  const telaAlt = sombrear(tela, 1.3);
  const postW = Math.max(2, Math.round(U * 0.14));
  const mostradorY1 = Math.round(gy * 0.32);
  b.caja(0, 0, gz - Math.round(gz * 0.4), gx - 1, mostradorY1, gz - 1, madera);
  // postH deja ~40-45% de la altura total para el toldo (con 0.9 el toldo
  // colapsaba a una loncha de 1-2 vóxeles — bug real encontrado verificando
  // la captura: el mercado salía como dos postes con una barra fina encima,
  // sin ningún plano de tela inclinado reconocible).
  const postH = Math.round(gy * 0.58);
  for (const px of [0, gx - postW]) for (const pz of [0, gz - postW]) b.caja(px, 0, pz, px + postW - 1, postH, pz + postW - 1, sombrear(madera, 0.6));
  // Toldo: capas horizontales rayadas que cubren SIEMPRE la profundidad
  // ENTERA (0..gz-1) — bug real encontrado verificando la captura: la
  // primera versión reducía la Z cubierta en las capas BAJAS (solo la
  // franja trasera) y la ampliaba en las capas ALTAS, así que los postes
  // delanteros (en z=0) quedaban sin ningún toldo tocándolos por abajo —
  // se veían como un poste suelto totalmente separado de la caseta. Ahora
  // cada capa cubre todo el ancho/profundo (se apoya en los 4 postes desde
  // la primera capa) y solo se desplaza un pelín hacia dentro en X según
  // sube, dando un tejadillo escalonado real sin dejar nada flotando.
  const toldoY0 = postH, toldoY1 = gy - 1;
  const escalones = 4;
  const rayado = n !== 2;
  for (let i = 0; i < escalones; i++) {
    const t = i / escalones;
    const y0 = toldoY0 + Math.round((toldoY1 - toldoY0) * t), y1 = toldoY0 + Math.round((toldoY1 - toldoY0) * (t + 1 / escalones)) - 1;
    const insetX = Math.round(gx * 0.06 * i);
    b.caja(insetX, y0, 0, gx - 1 - insetX, y1, gz - 1, rayado && i % 2 === 0 ? tela : rayado ? telaAlt : tela);
  }
  if (esComida) {
    for (let i = 0; i < 3; i++) {
      const x = 2 + i * Math.round((gx - 4) / 3);
      b.caja(x, mostradorY1, gz - Math.round(gz * 0.25), x + 1, mostradorY1 + Math.max(1, Math.round(U * 0.08)), gz - Math.round(gz * 0.15), sombrear(telaBase, 0.75));
    }
  } else {
    b.caja(1, 0, 0, Math.round(gx * 0.4), Math.round(gy * 0.22), Math.round(gz * 0.35), sombrear(madera, 0.75));
    b.caja(Math.round(gx * 0.55), 0, 0, gx - 2, Math.round(gy * 0.16), Math.round(gz * 0.3), sombrear(madera, 0.9));
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// jaula_vacia + gallinero_jaula: familia "caja de listones" — marco de 4
// postes + barrotes espaciados en las 4 caras (nunca caras sólidas, para
// que se lea vacía por dentro), gallinero más bajo/ancho con tejadillo a
// dos aguas, jaula más alta y estrecha con tapa plana.
function cajaDeListones(entrada, id, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const color = tonoVariante(entrada.colorDebug, n);
  const dark = sombrear(color, 0.7);
  const esGallinero = id === "gallinero_jaula";
  const postW = Math.max(1, Math.round(U * 0.08));
  for (const px of [0, gx - postW]) for (const pz of [0, gz - postW]) b.caja(px, 0, pz, px + postW - 1, gy - 1, pz + postW - 1, dark);
  const nBarrotes = esGallinero ? 3 : 4;
  for (let i = 1; i < nBarrotes; i++) {
    const x = Math.round((gx / nBarrotes) * i);
    b.caja(x, 0, 0, x, gy - 1, 0, color);
    b.caja(x, 0, gz - 1, x, gy - 1, gz - 1, color);
  }
  for (let i = 1; i < nBarrotes; i++) {
    const z = Math.round((gz / nBarrotes) * i);
    b.caja(0, 0, z, 0, gy - 1, z, color);
    b.caja(gx - 1, 0, z, gx - 1, gy - 1, z, color);
  }
  // travesaño superior perimetral (marco real, no solo postes sueltos)
  b.caja(0, gy - 2, 0, gx - 1, gy - 2, 0, dark);
  b.caja(0, gy - 2, gz - 1, gx - 1, gy - 2, gz - 1, dark);
  b.caja(0, gy - 2, 0, 0, gy - 2, gz - 1, dark);
  b.caja(gx - 1, gy - 2, 0, gx - 1, gy - 2, gz - 1, dark);
  const techoInclinadoVariante = n === 1;
  let alturaTotal = gy;
  if (esGallinero) {
    if (techoInclinadoVariante) {
      // tejadillo a dos aguas (dos planos que se encuentran en la cumbrera)
      const cumbreraY = gy + Math.max(2, Math.round(U * 0.15));
      b.caja(-1, gy, -1, Math.round(gx / 2), cumbreraY - 1, gz, sombrear(color, 0.85));
      b.caja(Math.round(gx / 2), gy, -1, gx, cumbreraY - 1, gz, sombrear(color, 0.85));
      alturaTotal = cumbreraY;
    } else {
      b.caja(-1, gy, -1, gx, gy + Math.round(U * 0.1), gz, sombrear(color, 0.85)); // tejadillo plano
      alturaTotal = gy + Math.round(U * 0.1) + 1;
    }
  } else {
    b.caja(0, gy - 1, 0, gx - 1, gy - 1, gz - 1, dark); // tapa plana de listones
    alturaTotal = gy;
  }
  return { grid: [gx, alturaTotal, gz], paleta: b.paleta, cajas: b.cajas };
}

// farola_calle: mástil de forja + cabeza de farol (caja de metal + cristal
// + luz cálida interior + remate) en la punta — el campo `luz` del propio
// catálogo ya la enciende en el juego, esto solo construye el aspecto.
function farolaCalle(entrada, rnd, n) {
  const [dx, dy, dz] = entrada.dimensiones;
  const G = Math.max(8, Math.round(Math.max(dx, dz) * U * 2.6));
  const H = Math.round(dy * U);
  const b = Builder();
  const metal = tonoVariante(entrada.colorDebug, n);
  const cx = Math.round(G / 2);
  const mastilW = Math.max(1, Math.round(U * 0.14));
  b.caja(cx - Math.round(G * 0.22), 0, cx - Math.round(G * 0.22), cx + Math.round(G * 0.22), Math.round(H * 0.03), cx + Math.round(G * 0.22), sombrear(metal, 0.8));
  const cabezaY0 = Math.round(H * 0.8);
  b.caja(cx - Math.round(mastilW / 2), 0, cx - Math.round(mastilW / 2), cx + Math.round(mastilW / 2), cabezaY0, cx + Math.round(mastilW / 2), metal);
  // Cabeza del farol: MISMO patrón que el arquetipo "farol" de
  // generar_modelos.js — suelo + 4 montantes de ESQUINA (solo esos 4
  // vóxeles, no un marco continuo) + un cristal que rellena el hueco
  // entre ellos. Bug real encontrado verificando la captura: la primera
  // versión metía el cristal Y una "luz interior" en el MISMO rango de
  // vóxeles uno encima del otro — la luz tapaba al cristal por completo, y
  // el resto del cristal quedaba enterrado entre el suelo y el tejadillo
  // sin ninguna cara expuesta — invisible del todo, la farola se veía como
  // un simple poste. Ahora el cristal ES el color de la luz real del
  // catálogo (se lee "encendido" sin depender de una segunda caja
  // interior que nunca podía verse) y sus caras laterales SÍ quedan
  // expuestas porque los montantes solo ocupan la columna exacta de cada
  // esquina, nunca un marco completo.
  const r = Math.max(2, Math.round(G * 0.26));
  const headH = Math.max(2, H - cabezaY0 - Math.max(2, Math.round(U * 0.12)));
  b.caja(cx - r, cabezaY0, cx - r, cx + r, cabezaY0, cx + r, sombrear(metal, 0.85)); // suelo del farol
  const colorLuz = (entrada.luz && entrada.luz.color) || "#ffb75a";
  for (const [dxp, dzp] of [[-r, -r], [r, -r], [-r, r], [r, r]]) b.caja(cx + dxp, cabezaY0, cx + dzp, cx + dxp, cabezaY0 + headH, cx + dzp, metal); // montantes de esquina
  b.caja(cx - r + 1, cabezaY0 + 1, cx - r + 1, cx + r - 1, cabezaY0 + headH - 1, cx + r - 1, colorLuz); // cristal "encendido"
  const tejaY0 = cabezaY0 + headH;
  b.caja(cx - r - 1, tejaY0, cx - r - 1, cx + r + 1, tejaY0 + Math.max(1, Math.round(U * 0.1)), cx + r + 1, metal); // tejadillo, vuela sobre el cristal
  b.caja(cx - 1, tejaY0 + Math.max(1, Math.round(U * 0.1)), cx - 1, cx, H - 1, cx, sombrear(metal, 0.7)); // remate/pincho
  return { grid: [G, H, G], paleta: b.paleta, cajas: b.cajas };
}

// cartel_poste: poste corto + 1-2 tablillas indicadoras en la punta —
// mismo panel que cartel_tienda pero montado horizontal sobre poste en vez
// de colgado de fachada.
function cartelPoste(entrada, rnd, n) {
  const [dx, dy, dz] = entrada.dimensiones;
  const G = Math.max(6, Math.round(Math.max(dx, dz) * U * 2.2));
  const H = Math.round(dy * U);
  const b = Builder();
  const madera = tonoVariante(entrada.colorDebug, n);
  const cx = Math.round(G / 2);
  const posteW = Math.max(1, Math.round(U * 0.14));
  b.caja(cx - Math.round(posteW / 2), 0, cx - Math.round(posteW / 2), cx + Math.round(posteW / 2), Math.round(H * 0.75), cx + Math.round(posteW / 2), sombrear(madera, 0.75));
  const dosTablillas = n !== 1;
  const nTablillas = dosTablillas ? 2 : 1;
  for (let i = 0; i < nTablillas; i++) {
    const y0 = Math.round(H * (0.5 + i * 0.14)), y1 = y0 + Math.max(1, Math.round(U * 0.1));
    if (i % 2 === 0) b.caja(cx, y0, cx - Math.round(posteW / 2), cx + Math.round(G * 0.42), y1, cx + Math.round(posteW / 2), madera);
    else b.caja(cx - Math.round(G * 0.42), y0, cx - Math.round(posteW / 2), cx, y1, cx + Math.round(posteW / 2), sombrear(madera, 1.15));
  }
  return { grid: [G, H, G], paleta: b.paleta, cajas: b.cajas };
}

// ruedaPlana: disco visto de canto (mismo truco de "abombado" que un
// barril, pero con el eje de apilamiento en Z — el grosor de la rueda — y
// el plano circular en X/Y, para que la rueda quede DE PIE, vertical, como
// una rueda de carro real) + eje/cubo central + un cruce de radios oscuro.
function ruedaPlana(b, cx, cyCentro, z0, grosor, radio, colorAro, colorRueda) {
  // Bug real encontrado verificando la primera captura: la versión previa
  // reusaba el "abombado" senoidal del barril (pensado para el PERFIL
  // lateral de un tonel, apenas se insertaba 1 vóxel en los extremos) —
  // para una rueda VISTA DE CANTO (su cara circular casi de frente a la
  // cámara) eso se lee como un cubo con las esquinas apenas biseladas, no
  // como una rueda. Rasterizado real de un círculo (fila a fila, semiancho
  // = sqrt(radio²-dy²)) para que la silueta sea de verdad redonda desde
  // cualquier ángulo, con un aro de 1 vóxel más oscuro en el borde exacto.
  const z1 = z0 + Math.max(0, grosor - 1);
  for (let dy = -radio; dy <= radio; dy++) {
    const maxDx = Math.floor(Math.sqrt(Math.max(0, radio * radio - dy * dy)));
    if (maxDx < 0) continue;
    b.caja(cx - maxDx, cyCentro + dy, z0, cx + maxDx, cyCentro + dy, z1, colorRueda);
  }
  for (let dy = -radio; dy <= radio; dy++) {
    const maxDx = Math.floor(Math.sqrt(Math.max(0, radio * radio - dy * dy)));
    if (maxDx < 1) continue;
    b.caja(cx - maxDx, cyCentro + dy, z0, cx - maxDx, cyCentro + dy, z1, colorAro); // borde izq
    b.caja(cx + maxDx, cyCentro + dy, z0, cx + maxDx, cyCentro + dy, z1, colorAro); // borde der
  }
  // radios en cruz + cubo central, solo en la cara frontal (z0) — se leen
  // como los rayos de una rueda de carro real sin tapar el aro exterior.
  const spokeW = Math.max(1, Math.round(radio * 0.16));
  b.caja(cx - spokeW, cyCentro - radio + 1, z0, cx + spokeW - 1, cyCentro + radio - 1, z0, colorAro);
  b.caja(cx - radio + 1, cyCentro - spokeW, z0, cx + radio - 1, cyCentro + spokeW - 1, z0, colorAro);
  b.caja(cx - spokeW - 1, cyCentro - spokeW - 1, z0, cx + spokeW, cyCentro + spokeW, z1, sombrear(colorAro, 0.7));
}

// carreta / carro_mano / carromato: familia "carro con ruedas" — caja de
// carga + eje(s) con ruedas reales, sin margen negativo (todo el offset
// del varal/mango se reserva en el propio grid, nunca coordenadas < 0,
// para que --centrar-xz centre el modelo sobre su huella real completa).
// El carro de mano lleva una única rueda delantera + mangos hacia atrás;
// la carreta 2 ejes; el carromato 2 ejes + una lona curva sobre la caja
// (mismo truco de arco que un toldo, aplicado en vertical).
function carro(entrada, id, rnd, n) {
  const [dxCaja, dy, dzCaja] = entrada.dimensiones;
  const esMano = id === "carro_mano";
  const esCarromato = id === "carromato";
  // margenX: hueco reservado para el varal (carreta/carromato) o los
  // mangos (mano). margenZ: cuánto sobresalen las ruedas del ANCHO de la
  // caja de carga — bug real encontrado verificando la primera captura:
  // sin este margen, las ruedas quedaban EXACTAMENTE en el mismo plano Z
  // que las paredes laterales (mismo grosor, mismo z) y la rueda, al
  // dibujarse DESPUÉS, simplemente recoloreaba un círculo plano DENTRO de
  // la pared — 0 protuberancia real, el carro se veía como una caja sin
  // ruedas reconocibles. Ahora cada rueda vive en su PROPIO rango de Z,
  // centrado sobre la pared pero sobresaliendo margenZ hacia fuera del
  // contorno de la caja, visible desde cualquier ángulo isométrico.
  const margenX = Math.round(U * 0.55);
  const margenZ = Math.max(2, Math.round(U * 0.16));
  const gxCaja = Math.round(dxCaja * U);
  const gzCaja = Math.round(dzCaja * U);
  const gz = gzCaja + 2 * margenZ;
  const gy = Math.round(dy * U);
  const b = Builder();
  const madera = tonoVariante(entrada.colorDebug, n);
  const dark = sombrear(madera, 0.6);
  const paredH = Math.round(gy * (esMano ? 0.55 : 0.42));
  const ejeY = Math.round(gy * (esMano ? 0.28 : 0.32));
  // el carro de mano lleva su ÚNICA rueda pegada al borde delantero,
  // sobresaliendo hacia fuera (mismo bug que las de eje: sin hueco propio,
  // la rueda quedaba enterrada bajo la caja, invisible) — reserva ese
  // espacio en el propio ancho total del grid.
  const radioRuedaMano = esMano ? Math.round(ejeY * 1.35) : 0;
  const gx = gxCaja + margenX + radioRuedaMano;
  const cajaX0 = margenX; // toda la caja de carga vive desplazada +margenX en X
  const cajaZ0 = margenZ; // ...y +margenZ en Z, dejando hueco a cada lado para las ruedas
  const cajaY0 = ejeY, cajaY1 = ejeY + paredH;
  const parW = Math.max(1, Math.round(U * 0.08));
  b.caja(cajaX0, cajaY0, cajaZ0, cajaX0 + gxCaja - 1, cajaY0, cajaZ0 + gzCaja - 1, dark); // suelo de la caja
  b.caja(cajaX0, cajaY0, cajaZ0, cajaX0 + gxCaja - 1, cajaY1, cajaZ0 + parW - 1, madera);
  b.caja(cajaX0, cajaY0, cajaZ0 + gzCaja - parW, cajaX0 + gxCaja - 1, cajaY1, cajaZ0 + gzCaja - 1, madera);
  if (!esMano) {
    b.caja(cajaX0, cajaY0, cajaZ0, cajaX0 + parW - 1, cajaY1, cajaZ0 + gzCaja - 1, madera);
    b.caja(cajaX0 + gxCaja - parW, cajaY0, cajaZ0, cajaX0 + gxCaja - 1, cajaY1, cajaZ0 + gzCaja - 1, madera);
  } else {
    // carro de mano: el lado que da al mango (x=cajaX0) queda ABIERTO para cargar; el opuesto sí lleva pared
    b.caja(cajaX0 + gxCaja - parW, cajaY0, cajaZ0, cajaX0 + gxCaja - 1, cajaY1, cajaZ0 + gzCaja - 1, madera);
    const mangoY = cajaY0 + Math.round(paredH * 0.35);
    b.caja(0, mangoY, cajaZ0 + Math.round(gzCaja * 0.18), cajaX0, mangoY + Math.max(1, Math.round(U * 0.06)), cajaZ0 + Math.round(gzCaja * 0.18) + Math.max(1, Math.round(U * 0.06)), dark);
    b.caja(0, mangoY, cajaZ0 + Math.round(gzCaja * 0.82) - Math.max(1, Math.round(U * 0.06)), cajaX0, mangoY + Math.max(1, Math.round(U * 0.06)), cajaZ0 + Math.round(gzCaja * 0.82), dark);
  }
  const ruedaGrande = n === 3;
  if (esMano) {
    // rueda única y ANCHA (todo el ancho de la carretilla, mismo criterio
    // que una carretilla real de una sola rueda centrada), pegada al
    // borde DELANTERO (extremo opuesto al mango) y sobresaliendo hacia
    // fuera — no enterrada bajo el suelo de la caja.
    const radioReal = ruedaGrande ? Math.round(radioRuedaMano * 1.15) : radioRuedaMano;
    const grosorManoWheel = Math.round(gzCaja * 0.55);
    ruedaPlana(b, cajaX0 + gxCaja - 1, radioReal, Math.round(gz / 2) - Math.round(grosorManoWheel / 2), grosorManoWheel, radioReal, dark, madera);
  } else {
    const radio = ejeY;
    const radioReal = ruedaGrande ? Math.round(radio * 1.15) : radio;
    const grosorRueda = margenZ * 2; // centrada sobre la pared: la mitad sobresale hacia fuera, la mitad se solapa con la pared (rueda "montada", no flotando)
    const numEjes = dxCaja >= 1.8 ? 2 : 1;
    const ejesX = numEjes === 2 ? [cajaX0 + Math.round(gxCaja * 0.22), cajaX0 + Math.round(gxCaja * 0.78)] : [cajaX0 + Math.round(gxCaja * 0.5)];
    for (const ex of ejesX) {
      ruedaPlana(b, ex, radioReal, 0, grosorRueda, radioReal, dark, madera); // sobresale del lado z=0
      ruedaPlana(b, ex, radioReal, gz - grosorRueda, grosorRueda, radioReal, dark, madera); // sobresale del lado z=gz-1
    }
    // varal/lanza hacia el frente, dentro del margen reservado
    const lanzaY = cajaY0 + Math.round(paredH * 0.25);
    b.caja(0, lanzaY, Math.round(gz / 2) - 1, cajaX0, lanzaY + Math.max(1, Math.round(U * 0.06)), Math.round(gz / 2), dark);
  }
  let alturaTotal = cajaY1;
  if (esCarromato) {
    const tela = "#c9b892", telaOsc = sombrear(tela, 0.82);
    const techoY0 = cajaY1 + 1, techoY1 = gy - 1;
    const halfAncho = Math.round(gxCaja / 2);
    const capasArco = Math.max(4, Math.round(U * 0.4));
    for (let i = 0; i < capasArco; i++) {
      const t = i / capasArco;
      const ang = t * (Math.PI / 2);
      const inset = Math.round(halfAncho * (1 - Math.cos(ang)));
      const y0 = techoY0 + Math.round(((techoY1 - techoY0) * i) / capasArco), y1 = techoY0 + Math.round(((techoY1 - techoY0) * (i + 1)) / capasArco) - 1;
      b.caja(cajaX0 + inset, y0, cajaZ0, cajaX0 + gxCaja - 1 - inset, y1, cajaZ0 + gzCaja - 1, i % 2 === 0 ? tela : telaOsc);
    }
    alturaTotal = techoY1 + 1;
  }
  return { grid: [gx, Math.max(alturaTotal, cajaY1 + 1), gz], paleta: b.paleta, cajas: b.cajas };
}

// escalera_mano: dos largueros + peldaños espaciados, con una ligera
// inclinación (los largueros derivan hacia z=0 según suben — "apoyada
// contra algo") — variante 2 se deja recta (apoyada de plano, sin apoyar
// contra una pared).
function escaleraMano(entrada, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const madera = tonoVariante(entrada.colorDebug, n);
  const railW = Math.max(1, Math.round(U * 0.12));
  const inclinada = n !== 2;
  const zTope = Math.max(0, gz - railW);
  for (let y = 0; y < gy; y++) {
    const t = y / (gy - 1);
    const z = inclinada ? Math.round((1 - t) * zTope) : 0;
    b.caja(0, y, z, railW - 1, y, z + railW - 1, madera);
    b.caja(gx - railW, y, z, gx - 1, y, z + railW - 1, madera);
  }
  const nPeldanos = 8;
  for (let i = 0; i < nPeldanos; i++) {
    const t = (i + 0.5) / nPeldanos;
    const y = Math.round(gy * t);
    const z = inclinada ? Math.round((1 - t) * zTope) : 0;
    b.caja(0, y, z, gx - 1, y + Math.max(1, Math.round(U * 0.05)), z + railW - 1, sombrear(madera, 0.85));
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// tendedero: 2 postes + cuerda horizontal + paños de tela colgando entre
// medias, con una ligera diferencia de longitud entre paños (pandeo real).
function tendedero(entrada, rnd, n) {
  const [gx, gy, gz] = gridDeDims(entrada.dimensiones);
  const b = Builder();
  const madera = "#6a4a26";
  const posteW = Math.max(1, Math.round(U * 0.1));
  const posteH = Math.round(gy * 0.9);
  const czPoste = Math.round(gz / 2);
  b.caja(0, 0, czPoste - Math.round(posteW / 2), posteW - 1, posteH, czPoste + Math.round(posteW / 2), madera);
  b.caja(gx - posteW, 0, czPoste - Math.round(posteW / 2), gx - 1, posteH, czPoste + Math.round(posteW / 2), madera);
  b.caja(0, posteH, czPoste - 1, gx - 1, posteH, czPoste, CUERDA);
  const dosPanos = n === 2;
  const nPanos = dosPanos ? 2 : 3;
  const tonos = [entrada.colorDebug, sombrear(entrada.colorDebug, 1.2), sombrear(entrada.colorDebug, 0.82)];
  for (let i = 0; i < nPanos; i++) {
    const x0 = Math.round((gx / nPanos) * i) + 1, x1 = Math.round((gx / nPanos) * (i + 1)) - 2;
    const yTop = posteH - Math.max(1, Math.round(U * 0.04));
    const pandeo = i % 2 === 0 ? 0 : Math.max(1, Math.round(U * 0.05)); // paños alternos cuelgan un poco menos (pandeo real de la cuerda)
    const yBot = Math.round(posteH * 0.32) + pandeo;
    b.caja(x0, yBot, czPoste - 1, x1, yTop, czPoste, tonos[i % tonos.length]);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// --- tabla de clasificación ------------------------------------------

const GENERADOR_POR_ID = {
  banco_madera: banco,
  banco_piedra: banco,
  tinaja_barro: tinaja,
  cartel_tienda: cartelTienda,
  antorcha_poste: antorchaPoste,
  charco_agua: charco,
  cubo_madera: cuboMadera,
  lena_apilada: lenaApilada,
  valla_madera: posteYTravesano,
  amarradero: posteYTravesano,
  puesto_mercado: mostradorConToldo,
  tenderete_comida: mostradorConToldo,
  jaula_vacia: cajaDeListones,
  gallinero_jaula: cajaDeListones,
  farola_calle: farolaCalle,
  cartel_poste: cartelPoste,
  carreta: carro,
  carro_mano: carro,
  carromato: carro,
  escalera_mano: escaleraMano,
  tendedero: tendedero,
};

// Funciones que reciben (entrada, id, rnd, n) — el resto (una geometría
// exclusiva por id) recibe (entrada, rnd, n) directamente.
const RECIBE_ID = new Set(["banco_madera", "banco_piedra", "valla_madera", "amarradero", "puesto_mercado", "tenderete_comida", "jaula_vacia", "gallinero_jaula", "carreta", "carro_mano", "carromato"]);

function generarTodo() {
  const resultado = {};
  for (const [id, fn] of Object.entries(GENERADOR_POR_ID)) {
    const entrada = decoracion[id];
    if (!entrada) throw new Error(`${id} no existe en ciudades/catalogo/decoracion.json`);
    for (let n = 1; n <= NUM_VARIANTES; n++) {
      const rnd = crearPRNG(`${id}|${n}`);
      const modelo = RECIBE_ID.has(id) ? fn(entrada, id, rnd, n) : fn(entrada, rnd, n);
      const nn = String(n).padStart(2, "0");
      resultado[`${id}_${nn}`] = { nombre: `${id.replace(/_/g, " ")} (var ${nn})`, resolucion: U, ...modelo };
    }
  }
  return resultado;
}

if (require.main === module) {
  const resultado = generarTodo();
  fs.writeFileSync(path.join(__dirname, "decoracion_urbana_generada.json"), JSON.stringify(resultado));
  console.log(`Generados ${Object.keys(resultado).length} modelos (${NUM_VARIANTES} variantes x ${Object.keys(GENERADOR_POR_ID).length} ids).`);
}

module.exports = { generarTodo, GENERADOR_POR_ID, U, NUM_VARIANTES };
