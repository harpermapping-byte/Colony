"use strict";
// Genera un modelo de vóxeles (grid + paleta + cajas) por arquetipo para
// cada pieza de interiores/catalogo/elementos.json. Nada de esto llama a un
// LLM: es geometría procedural determinista con detalle real (bisagras,
// pomos, listones, remaches, llama de antorcha...), por eso escala a 123
// piezas sin coste ni pérdida de calidad por repetición.
//
// V2: resolución x2.5 respecto a la primera pasada (U 4->10, ~15x más
// vóxeles por pieza) y construcción por partes reales en vez de una caja
// única por mueble.

const fs = require("fs");
const catalogo = require("./catalogo_extraido.json");

const UBASE = 10; // subdivisiones de vóxel por casilla de huella en la resolución "normal"
let U = UBASE; // mutada antes de cada pieza según resolverU() — más subdivisiones donde el detalle se nota (bisagras, llamas, listones), menos donde no aporta (manchas, escombros)
const METAL = "#3a3733"; // hierro forjado — bisagras, pomos, aros, clavos
const METAL_CLARO = "#6b665c";
const LLAMA_NUCLEO = "#fff4c2";
const LLAMA = "#ffb545";
const LLAMA_BORDE = "#e0672a";
const CRISTAL = "#bcd6dc";

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// --- variantes nombradas (pedido 2026-08-30) --------------------------------
// `interiores/catalogo/elementos.json` ya define 4 `variantesNombradas` por
// mueble típicamente (p.ej. "cama_individual_pino"/"_haya"/"_desgastada"/
// "_roble_tallado") pero hasta ahora el generador de vóxeles las ignoraba —
// todas salían con el MISMO colorDebug y la MISMA geometría que el id base.
// Esto lee el sufijo del id de la variante como vocabulario libre (no un
// campo de catálogo estructurado — así no hace falta tocar las 560 entradas
// a mano) y deriva un tono real + un estilo (tallado/desgaste) de él.
const TONOS = {
  // maderas
  roble: "#5a3d20", nogal: "#3d2814", pino: "#d9be82", tejo: "#8a6a3a",
  sauce: "#c9b57a", avellano: "#a67c4a", castano: "#7a5230", arce: "#c9a86a",
  chopo: "#d9c090", abedul: "#e8d9b0", encina: "#4a3016", haya: "#c9a878",
  tilo: "#dcc79a", abeto: "#c9b088", caoba: "#5a2a1a", olmo: "#a58358",
  fresno: "#c9b48a",
  // metales
  hierro: METAL, oxidado: "#8a4a2a", oxidada: "#8a4a2a", bronce: "#8a6a3a",
  cobre: "#b5651d", acero: "#8a8a90", oro: "#d4af37", plata: "#c0c0c0",
  laton: "#b5a642", obsidiana: "#1a1a1a", pedernal: "#6a6a6a", marfil: "#f0e6d3",
  // piedra
  granito: "#7a7a7a", arenisca: "#c9a86a", roca_caliza: "#d9d4c4",
  // tela/fibra
  lana: "#8a7a5a", lino: "#e8dfc0", seda: "#c9a8d8",
};
const TALLA_KEYWORDS = ["tallado", "tallada"];
const DESGASTE_KEYWORDS = ["desgastada", "desgastado", "agrietada", "agrietado", "raida", "raido", "rota", "roto", "deslustrado", "oxidado", "oxidada", "vieja", "viejo"];

/** Deriva {color, tallado, desgaste} del sufijo del id de una variante nombrada — vocabulario libre, sin match = queda el colorDebug original y sin estilo (comportamiento de siempre). */
function resolverVariante(idVariante, idBase, colorBase) {
  const sufijo = idVariante.startsWith(idBase + "_") ? idVariante.slice(idBase.length + 1) : idVariante;
  let color = colorBase;
  for (const [clave, hex] of Object.entries(TONOS)) {
    if (sufijo.includes(clave)) { color = hex; break; }
  }
  return {
    color,
    tallado: TALLA_KEYWORDS.some((k) => sufijo.includes(k)),
    desgaste: DESGASTE_KEYWORDS.some((k) => sufijo.includes(k)),
  };
}

// PRNG determinista (mulberry32) sembrado por hash del id de variante — misma
// variante = mismo desgaste siempre, regla 3 del CLAUDE.md (nada de Math.random).
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

/** Tallado (pedido 2026-08-30): ranuras verticales oscuras cada 2 vóxeles en
 * la cara frontal de la caja más alta/ancha del modelo — genérico por diseño
 * (funciona sobre cualquier arquetipo, no requiere tocar cada generador). */
function aplicarTallado(modelo) {
  let candidata = null;
  for (const c of modelo.cajas) {
    const ancho = c[3] - c[0], alto = c[4] - c[1];
    if (ancho >= 3 && (!candidata || alto > candidata[4] - candidata[1])) candidata = c;
  }
  if (!candidata) return modelo;
  const [x0, y0, z0, x1, y1, , pIdx] = candidata;
  const paleta = modelo.paleta.slice();
  const oscuro = sombrear(paleta[pIdx], 0.55);
  let iOscuro = paleta.indexOf(oscuro);
  if (iOscuro === -1) { iOscuro = paleta.length; paleta.push(oscuro); }
  const extra = [];
  for (let x = x0 + 1; x < x1; x += 2) extra.push([x, y0, z0, x, y1, z0, iOscuro]);
  return { ...modelo, paleta, cajas: [...modelo.cajas, ...extra] };
}

/** Desgaste (pedido 2026-08-30): oscurece aleatoriamente ~1 de cada 3 cajas
 * (mismo criterio de "variación por vóxel" que ya usaba `sombrear`, aquí
 * amplificado y por caja entera) — genérico, no toca geometría, solo color. */
function aplicarDesgaste(modelo, rnd) {
  const paleta = modelo.paleta.slice();
  function colorOscuro(idx, factor) {
    const hex = sombrear(modelo.paleta[idx], factor);
    let i = paleta.indexOf(hex);
    if (i === -1) { i = paleta.length; paleta.push(hex); }
    return i;
  }
  const cajas = modelo.cajas.map((c) => {
    if (rnd() < 0.35) {
      const factor = 0.82 + rnd() * 0.15;
      return [c[0], c[1], c[2], c[3], c[4], c[5], colorOscuro(c[6], factor)];
    }
    return c;
  });
  return { ...modelo, paleta, cajas };
}

// --- pequeño constructor de piezas ---------------------------------------
// Cada generador es una función(v) -> {paleta:[...], piezas:[{c:[x0,y0,z0,x1,y1,z1], p:idx}]}
// convertido al final a {grid, paleta, cajas} con grid=[gx,gy,gz] explícito
// (permite piezas cuyo grid no es exactamente huella*U, como las colgadas).

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

function gridDe(huella, alturaCasillas) {
  const [hx, hy] = huella;
  return [Math.round(hx * U), Math.round(alturaCasillas * U), Math.round(hy * U)];
}

// --- arquetipos con detalle real ------------------------------------------

function generarAsiento(huella, color, id) {
  const [gx, gy, gz] = gridDe(huella, id.includes("trono") ? 3.4 : id.includes("mecedora") || id.includes("reclinatorio") ? 2.6 : 2.3);
  const b = Builder();
  const wood = color, dark = sombrear(color, 0.68), light = sombrear(color, 1.25);
  const legW = Math.max(2, Math.round(U * 0.16));
  const legH = Math.round(gy * 0.42);
  const seatY0 = legH, seatY1 = legH + Math.max(2, Math.round(U * 0.14));

  // 4 patas
  b.caja(0, 0, 0, legW - 1, legH - 1, legW - 1, dark);
  b.caja(gx - legW, 0, 0, gx - 1, legH - 1, legW - 1, dark);
  b.caja(0, 0, gz - legW, legW - 1, legH - 1, gz - 1, dark);
  b.caja(gx - legW, 0, gz - legW, gx - 1, legH - 1, gz - 1, dark);

  // travesaños (largueros) uniendo patas a media altura — refuerzo real
  const travY = Math.round(legH * 0.45);
  const travT = Math.max(1, Math.round(U * 0.06));
  b.caja(legW, travY, Math.round(legW / 2), gx - legW - 1, travY + travT, Math.round(legW / 2) + travT, wood);
  b.caja(legW, travY, gz - Math.round(legW / 2) - travT, gx - legW - 1, travY + travT, gz - Math.round(legW / 2), wood);
  b.caja(Math.round(legW / 2), travY, legW, Math.round(legW / 2) + travT, travY + travT, gz - legW - 1, wood);
  b.caja(gx - Math.round(legW / 2) - travT, travY, legW, gx - Math.round(legW / 2), travY + travT, gz - legW - 1, wood);

  // asiento con marco (faldón) visible bajo la tabla
  const faldonT = Math.max(1, Math.round(U * 0.1));
  b.caja(0, seatY0, 0, gx - 1, seatY0 + faldonT - 1, faldonT - 1, dark);
  b.caja(0, seatY0, gz - faldonT, gx - 1, seatY0 + faldonT - 1, gz - 1, dark);
  b.caja(0, seatY0, 0, faldonT - 1, seatY0 + faldonT - 1, gz - 1, dark);
  b.caja(gx - faldonT, seatY0, 0, gx - 1, seatY0 + faldonT - 1, gz - 1, dark);
  b.caja(0, seatY0 + faldonT, 0, gx - 1, seatY1, gz - 1, wood);

  const tienePatasTraseras = seatY1 + 1 < gy && !id.includes("taburete");
  if (tienePatasTraseras) {
    // postes traseros que suben para sostener el respaldo (mismo lado z que
    // las patas traseras: z = gz-postW..gz-1, no el lado delantero)
    const postW = legW;
    b.caja(0, seatY0, gz - postW, postW - 1, gy - 1, gz - 1, dark);
    b.caja(gx - postW, seatY0, gz - postW, gx - 1, gy - 1, gz - 1, dark);
    // travesaño superior (remate)
    const railH = Math.max(2, Math.round(U * 0.16));
    b.caja(0, gy - railH, gz - postW, gx - 1, gy - 1, gz - 1, wood);
    if (id.includes("trono")) {
      // pico ornamental central + reposabrazos
      const peakW = Math.max(2, Math.round(gx * 0.18));
      b.caja(Math.round(gx / 2 - peakW / 2), gy, gz - postW, Math.round(gx / 2 + peakW / 2), gy + Math.round(U * 0.3), gz - 1, light);
      const armY = seatY1 + 1;
      b.caja(0, armY, 0, legW - 1, armY + Math.round(U * 0.12), gz - legW, wood);
      b.caja(gx - legW, armY, 0, gx - 1, armY + Math.round(U * 0.12), gz - legW, wood);
    } else {
      // respaldo de tabla maciza con moldura central (silla de oficio/casa
      // medieval — no listones tipo spindle, eso es de sillería mucho más
      // tardía) encajada entre los dos postes
      const panelY0 = seatY1 + 1, panelY1 = gy - railH - 1;
      b.caja(postW, panelY0, gz - postW, gx - postW - 1, panelY1, gz - 1, wood);
      const molduraW = Math.max(1, Math.round(U * 0.06));
      const cx = Math.round(gx / 2);
      b.caja(cx - molduraW, panelY0, gz - postW, cx + molduraW - 1, panelY1, gz - postW, dark); // moldura vertical central en relieve
    }
  }
  if (id.includes("mecedora")) {
    // balancines (patines curvos aproximados por una tabla larga baja)
    const runnerT = Math.max(1, Math.round(U * 0.08));
    b.caja(-Math.round(U * 0.3), 0, Math.round(legW / 2) - runnerT, gx + Math.round(U * 0.3), runnerT - 1, Math.round(legW / 2), dark);
    b.caja(-Math.round(U * 0.3), 0, gz - Math.round(legW / 2), gx + Math.round(U * 0.3), runnerT - 1, gz - Math.round(legW / 2) + runnerT, dark);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarMesa(huella, color, esSuperficie, id) {
  const especial = ["yunque", "fregadero", "encimera", "mostrador", "especiero", "escritorio", "bancada_cultivo"];
  const [gx, gy, gz] = gridDe(huella, id === "yunque" ? 1.3 : especial.includes(id) ? 1.9 : 1.9);
  const b = Builder();
  const wood = color, dark = sombrear(color, 0.65), light = sombrear(color, 1.3);

  if (id === "yunque") {
    // base ancha (pie), cintura estrecha, cuerpo/mesa de trabajo, cuerno afilado lateral
    const baseH = Math.round(gy * 0.22);
    b.caja(Math.round(gx * 0.1), 0, Math.round(gz * 0.1), gx - 1 - Math.round(gx * 0.1), baseH - 1, gz - 1 - Math.round(gz * 0.1), dark);
    const waistY0 = baseH, waistY1 = Math.round(gy * 0.55);
    b.caja(Math.round(gx * 0.32), waistY0, Math.round(gz * 0.32), Math.round(gx * 0.68), waistY1, Math.round(gz * 0.68), METAL);
    const cuerpoY0 = waistY1, cuerpoY1 = Math.round(gy * 0.82);
    b.caja(Math.round(gx * 0.15), cuerpoY0, Math.round(gz * 0.15), gx - 1 - Math.round(gx * 0.15), cuerpoY1, gz - 1 - Math.round(gz * 0.15), METAL_CLARO);
    // mesa de trabajo plana (más ancha, poco alta) encima del cuerpo
    b.caja(0, cuerpoY1 + 1, Math.round(gz * 0.1), gx - 1, cuerpoY1 + Math.max(1, Math.round(U * 0.12)), gz - 1 - Math.round(gz * 0.1), METAL_CLARO);
    // cuerno cónico hacia -x, corto y afilado, a la altura de la mesa
    const hornY0 = cuerpoY1 + 1, hornY1 = cuerpoY1 + Math.max(1, Math.round(U * 0.12));
    b.caja(-Math.round(gx * 0.55), hornY0, Math.round(gz * 0.35), -Math.round(gx * 0.15), hornY1, Math.round(gz * 0.65), METAL_CLARO);
    b.caja(-Math.round(gx * 0.15), hornY0, Math.round(gz * 0.28), 0, hornY1, Math.round(gz * 0.72), METAL_CLARO);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "altar") {
    // bloque macizo de piedra/madera con relieve en cruz y dos velas
    const piedra = color, oscuro = sombrear(color, 0.65), tapa = sombrear(color, 1.3);
    b.caja(1, 0, 1, gx - 2, gy - 3, gz - 2, piedra);
    b.caja(0, gy - 2, 0, gx - 1, gy - 1, gz - 1, tapa); // losa superior, vuela sobre el cuerpo
    const cx = Math.round(gx / 2), cz = Math.round(gz / 2);
    b.caja(cx - 1, Math.round(gy * 0.15), 1, cx, Math.round(gy * 0.7), 2, oscuro); // brazo vertical de la cruz (relieve)
    b.caja(cx - 2, Math.round(gy * 0.35), 1, cx + 1, Math.round(gy * 0.42), 2, oscuro); // brazo horizontal
    for (const vx of [Math.round(gx * 0.2), Math.round(gx * 0.8)]) {
      b.caja(vx - 1, gy, cz - 1, vx, gy + Math.round(U * 0.15), cz, "#f0e6c8"); // vela
      b.caja(vx - 1, gy + Math.round(U * 0.15) + 1, cz - 1, vx, gy + Math.round(U * 0.15) + 2, cz, LLAMA);
    }
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "atril") {
    // atril de lectura medieval real: pie en cruz (no 4 patas de mesa),
    // poste central, y tablero INCLINADO (aproximado por escalones que se
    // desplazan en z al subir en y) con reborde para que el libro no resbale
    const madera = color, oscuro = sombrear(color, 0.65);
    const cx = Math.round(gx / 2), cz = Math.round(gz / 2);
    const brazo = Math.max(1, Math.round(U * 0.16));
    // pie en cruz: dos travesaños perpendiculares a ras de suelo
    b.caja(0, 0, cz - Math.round(brazo / 2), gx - 1, brazo - 1, cz + Math.round(brazo / 2), oscuro);
    b.caja(cx - Math.round(brazo / 2), 0, 0, cx + Math.round(brazo / 2), brazo - 1, gz - 1, oscuro);
    // poste vertical central
    const posteY1 = Math.round(gy * 0.62);
    b.caja(cx - Math.round(brazo / 2), brazo, cz - Math.round(brazo / 2), cx + Math.round(brazo / 2) - 1, posteY1, cz + Math.round(brazo / 2) - 1, madera);
    // tablero inclinado: escalones que avanzan en z a medida que sube en y,
    // se lee como un plano en rampa desde cualquier ángulo
    const escalones = Math.max(4, Math.round(U * 0.5));
    const tableroLargo = gz; // recorrido en profundidad de la rampa
    for (let i = 0; i < escalones; i++) {
      const y = posteY1 + i;
      const zEsc = Math.round((tableroLargo * i) / escalones);
      b.caja(0, y, zEsc, gx - 1, y, Math.min(gz - 1, zEsc + Math.round(tableroLargo / escalones) + 1), madera);
    }
    // reborde inferior para que el libro no se caiga + libro apoyado
    b.caja(0, posteY1, 0, gx - 1, posteY1 + Math.round(U * 0.15), Math.round(U * 0.12), oscuro);
    b.caja(Math.round(gx * 0.2), posteY1 + Math.round(U * 0.16), Math.round(U * 0.15), Math.round(gx * 0.8), posteY1 + Math.round(U * 0.24), Math.round(gz * 0.55), "#8a2a2a");
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "fregadero") {
    const baseH = Math.round(gy * 0.7);
    b.caja(0, 0, 0, gx - 1, baseH - 1, gz - 1, dark);
    const rim = Math.max(1, Math.round(U * 0.12));
    b.caja(0, baseH, 0, gx - 1, gy - 1, gz - 1, light);
    b.caja(rim, baseH + 1, rim, gx - 1 - rim, gy - 1, gz - 1 - rim, "#8fb0c2"); // hueco de agua
    b.caja(Math.round(gx * 0.4), gy, Math.round(gz * 0.3), Math.round(gx * 0.6), gy + Math.round(U * 0.3), Math.round(gz * 0.3) + 1, METAL);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }

  const legW = Math.max(2, Math.round(U * 0.15));
  const legH = Math.round(gy * 0.78);
  b.caja(0, 0, 0, legW - 1, legH - 1, legW - 1, dark);
  b.caja(gx - legW, 0, 0, gx - 1, legH - 1, legW - 1, dark);
  b.caja(0, 0, gz - legW, legW - 1, legH - 1, gz - 1, dark);
  b.caja(gx - legW, 0, gz - legW, gx - 1, legH - 1, gz - 1, dark);
  // faldón bajo la tabla (marco visible)
  const faldonT = Math.max(1, Math.round(U * 0.12));
  b.caja(0, legH, 0, gx - 1, legH + faldonT - 1, faldonT - 1, dark);
  b.caja(0, legH, gz - faldonT, gx - 1, legH + faldonT - 1, gz - 1, dark);
  b.caja(0, legH, 0, faldonT - 1, legH + faldonT - 1, gz - 1, dark);
  b.caja(gx - faldonT, legH, 0, gx - 1, legH + faldonT - 1, gz - 1, dark);
  // tablero con canto más claro
  b.caja(0, legH + faldonT, 0, gx - 1, gy - 2, gz - 1, wood);
  b.caja(0, gy - 1, 0, gx - 1, gy - 1, gz - 1, light);
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarCama(huella, color, id) {
  const [gx, gy, gz] = gridDe(huella, 1.5);
  const b = Builder();
  const wood = color, dark = sombrear(color, 0.65), light = sombrear(color, 1.3);
  const postW = Math.max(2, Math.round(U * 0.18));
  const isCuna = id.includes("cuna");
  const headH = isCuna ? Math.round(gy * 0.9) : gy - 1;
  const footH = Math.round(headH * 0.6);
  // postes: cabecero (z=0, más altos) y piecero (z=gz-1, más bajos)
  b.caja(0, 0, 0, postW - 1, headH, postW - 1, dark);
  b.caja(gx - postW, 0, 0, gx - 1, headH, postW - 1, dark);
  b.caja(0, 0, gz - postW, postW - 1, footH, gz - 1, dark);
  b.caja(gx - postW, 0, gz - postW, gx - 1, footH, gz - 1, dark);
  // remates (bolas) en los postes del cabecero
  const finial = Math.max(2, Math.round(U * 0.14));
  b.caja(0, headH + 1, 0, postW - 1, headH + finial, postW - 1, light);
  b.caja(gx - postW, headH + 1, 0, gx - 1, headH + finial, postW - 1, light);
  // cabecero — panel con listones
  const cabeceroY0 = Math.round(headH * 0.25);
  b.caja(postW, cabeceroY0, 0, gx - postW - 1, headH - 1, Math.max(1, Math.round(U * 0.08)), wood);
  for (let i = 0; i < 3; i++) {
    const x0 = postW + (gx - 2 * postW) * (i + 1) / 4 - 1;
    b.caja(x0, cabeceroY0, 0, x0 + 1, headH - 1, Math.max(1, Math.round(U * 0.08)), dark);
  }
  // piecero — panel bajo
  b.caja(postW, 0, gz - Math.max(1, Math.round(U * 0.08)), gx - postW - 1, footH - 1, gz - 1, wood);
  // largueros laterales
  const railY0 = Math.round(footH * 0.55), railY1 = railY0 + Math.max(1, Math.round(U * 0.1));
  b.caja(0, railY0, postW, postW - 1, railY1, gz - postW - 1, dark);
  b.caja(gx - postW, railY0, postW, gx - 1, railY1, gz - postW - 1, dark);
  // colchón + almohada + manta
  const colchonY0 = railY1 + 1, colchonY1 = colchonY0 + Math.max(2, Math.round(U * 0.22));
  b.caja(postW, colchonY0, postW, gx - postW - 1, colchonY1, gz - postW - 1, "#e8ddc4");
  b.caja(postW + 1, colchonY1 + 1, postW + 1, gx - postW - 2, colchonY1 + Math.max(2, Math.round(U * 0.15)), Math.round(gz * 0.32), "#f5f0e2");
  b.caja(postW, colchonY1 + 1, Math.round(gz * 0.42), gx - postW - 1, colchonY1 + Math.max(1, Math.round(U * 0.1)), gz - postW - 1, sombrear(color, 1.05));
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function puertaConDetalle(b, x0, y0, z0, x1, y1, z1, wood, dark, ladoTiradorDerecha, orientacionZ) {
  // panel de puerta con recuadro rehundido, bisagras de cincha larga (herraje
  // real de arca/armario medieval — tiras de hierro que cubren buena parte
  // de la altura, no bisagras de mueble ocultas) y tirador de anilla de
  // hierro en vez de pomo torneado. orientacionZ=true si la cara visible de
  // la puerta mira en +z/-z (si no, en +x/-x)
  b.caja(x0, y0, z0, x1, y1, z1, wood);
  const inset = Math.max(1, Math.round(U * 0.1));
  const alto = y1 - y0;
  const cinchaLargo = Math.round(alto * 0.38);
  const cinchaGrosor = Math.max(1, Math.round(U * 0.05));
  if (orientacionZ) {
    const zCara = z1;
    b.caja(x0 + inset, y0 + inset, zCara, x1 - inset, y1 - inset, zCara, dark);
    const bisagraX = ladoTiradorDerecha ? x0 : x1;
    for (const yc of [y0 + Math.round(alto * 0.12), y1 - Math.round(alto * 0.12) - cinchaLargo]) {
      b.caja(bisagraX, yc, zCara, bisagraX, yc + cinchaLargo, zCara + 1, METAL); // cincha vertical clavada en el canto
      b.caja(x0, yc + Math.round(cinchaLargo / 2) - cinchaGrosor, zCara, x1, yc + Math.round(cinchaLargo / 2) + cinchaGrosor, zCara + 1, METAL); // banda horizontal atravesando la puerta
    }
    const tiradorX = ladoTiradorDerecha ? x1 - inset : x0 + inset;
    const my = Math.round((y0 + y1) / 2);
    b.caja(tiradorX, my - 1, zCara + 1, tiradorX, my + 1, zCara + 2, METAL); // placa de anclaje
    b.caja(tiradorX - 1, my - 2, zCara + 2, tiradorX + 1, my - 2, zCara + 3, METAL); // anilla (arco superior)
    b.caja(tiradorX - 1, my + 2, zCara + 2, tiradorX + 1, my + 2, zCara + 3, METAL); // anilla (arco inferior)
  } else {
    const xCara = x1;
    b.caja(xCara, y0 + inset, z0 + inset, xCara, y1 - inset, z1 - inset, dark);
    const bisagraZ = ladoTiradorDerecha ? z0 : z1;
    for (const yc of [y0 + Math.round(alto * 0.12), y1 - Math.round(alto * 0.12) - cinchaLargo]) {
      b.caja(xCara, yc, bisagraZ, xCara + 1, yc + cinchaLargo, bisagraZ, METAL);
      b.caja(xCara, yc + Math.round(cinchaLargo / 2) - cinchaGrosor, z0, xCara + 1, yc + Math.round(cinchaLargo / 2) + cinchaGrosor, z1, METAL);
    }
    const tiradorZ = ladoTiradorDerecha ? z1 - inset : z0 + inset;
    const my = Math.round((y0 + y1) / 2);
    b.caja(xCara + 1, my - 1, tiradorZ, xCara + 2, my + 1, tiradorZ, METAL);
    b.caja(xCara + 2, my - 2, tiradorZ - 1, xCara + 3, my - 2, tiradorZ + 1, METAL);
    b.caja(xCara + 2, my + 2, tiradorZ - 1, xCara + 3, my + 2, tiradorZ + 1, METAL);
  }
}

function generarContenedorAlto(huella, color, id) {
  const [gx, gy, gz] = gridDe(huella, 3.2);
  const b = Builder();
  const wood = color, dark = sombrear(color, 0.6), light = sombrear(color, 1.25);
  const esAbierto = id.includes("estanteria");
  const plinth = Math.max(1, Math.round(U * 0.12));
  // zócalo
  b.caja(0, 0, 0, gx - 1, plinth - 1, gz - 1, dark);
  // cuerpo
  b.caja(0, plinth, 0, gx - 1, gy - Math.round(U * 0.12) - 1, gz - 1, wood);
  // cornisa superior
  b.caja(0, gy - Math.round(U * 0.12), 0, gx - 1, gy - 1, gz - 1, light);

  // el frente (puertas/panel trasero de estantería) va SIEMPRE en el lado
  // más ancho — con huella no cuadrada (p.ej. armario [1,2]) poner el
  // frente en el eje fijo z lo hacía angosto y alargado hacia el fondo;
  // aquí se elige el eje según cuál de gx/gz es realmente el ancho
  const frenteEnZ = gx >= gz;
  const doorY0 = plinth + 1, doorY1 = gy - Math.round(U * 0.12) - 2;

  if (esAbierto) {
    const nBaldas = 4;
    if (frenteEnZ) {
      b.caja(0, plinth, 0, gx - 1, gy - Math.round(U * 0.12) - 1, Math.max(1, Math.round(U * 0.08)), dark); // panel trasero en z=0
      for (let i = 1; i <= nBaldas; i++) {
        const y = plinth + (gy - Math.round(U * 0.12) - plinth) * i / (nBaldas + 1);
        b.caja(1, y, 1, gx - 2, y + Math.max(1, Math.round(U * 0.1)), gz - 2, dark);
      }
    } else {
      b.caja(0, plinth, 0, Math.max(1, Math.round(U * 0.08)), gy - Math.round(U * 0.12) - 1, gz - 1, dark); // panel trasero en x=0
      for (let i = 1; i <= nBaldas; i++) {
        const y = plinth + (gy - Math.round(U * 0.12) - plinth) * i / (nBaldas + 1);
        b.caja(1, y, 1, gx - 2, y + Math.max(1, Math.round(U * 0.1)), gz - 2, dark);
      }
    }
  } else if (frenteEnZ) {
    const midX = Math.floor(gx / 2);
    puertaConDetalle(b, 1, doorY0, gz - 1, midX - 1, doorY1, gz - 1, wood, dark, false, true);
    puertaConDetalle(b, midX + 1, doorY0, gz - 1, gx - 2, doorY1, gz - 1, wood, dark, true, true);
    b.caja(midX, doorY0, gz - 1, midX, doorY1, gz - 1, dark); // junta central
  } else {
    const midZ = Math.floor(gz / 2);
    puertaConDetalle(b, gx - 1, doorY0, 1, gx - 1, doorY1, midZ - 1, wood, dark, false, false);
    puertaConDetalle(b, gx - 1, doorY0, midZ + 1, gx - 1, doorY1, gz - 2, wood, dark, true, false);
    b.caja(gx - 1, doorY0, midZ, gx - 1, doorY1, midZ, dark);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarContenedorBajo(huella, color, id) {
  if (id === "barril" || id === "tinaja") {
    const [gx0, gy, gz0] = gridDe(huella, 1.5);
    const b = Builder();
    const wood = color, hoop = METAL;
    const nCapas = 8;
    for (let i = 0; i < nCapas; i++) {
      const t = i / (nCapas - 1);
      const bulge = Math.sin(t * Math.PI); // 0 en extremos, 1 en el centro
      const inset = Math.round((1 - bulge) * gx0 * 0.16);
      const y0 = Math.round((gy / nCapas) * i), y1 = Math.round((gy / nCapas) * (i + 1)) - 1;
      const esAro = i === 1 || i === nCapas - 2 || i === Math.floor(nCapas / 2);
      b.caja(inset, y0, inset, gx0 - 1 - inset, y1, gz0 - 1 - inset, esAro ? hoop : wood);
    }
    return { grid: [gx0, gy, gz0], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "caldero") {
    const [gx0, gy, gz0] = gridDe(huella, 1.3);
    const b = Builder();
    const legH = Math.round(gy * 0.2);
    b.caja(1, 0, 1, 2, legH - 1, 2, METAL);
    b.caja(gx0 - 3, 0, 1, gx0 - 2, legH - 1, 2, METAL);
    b.caja(Math.round(gx0 / 2) - 1, 0, gz0 - 3, Math.round(gx0 / 2) + 1, legH - 1, gz0 - 2, METAL);
    const bodyY0 = legH;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const inset = Math.round(t * gx0 * 0.15);
      const y0 = bodyY0 + Math.round(((gy - bodyY0) * i) / 4);
      const y1 = bodyY0 + Math.round((gy - bodyY0) * (i + 1) / 4) - 1;
      b.caja(inset, y0, inset, gx0 - 1 - inset, y1, gz0 - 1 - inset, METAL_CLARO);
    }
    b.caja(-1, gy - Math.round(U * 0.2), Math.round(gz0 / 2) - 1, 0, gy - Math.round(U * 0.1), Math.round(gz0 / 2) + 1, METAL);
    b.caja(gx0, gy - Math.round(U * 0.2), Math.round(gz0 / 2) - 1, gx0 + 1, gy - Math.round(U * 0.1), Math.round(gz0 / 2) + 1, METAL);
    return { grid: [gx0, gy, gz0], paleta: b.paleta, cajas: b.cajas };
  }
  if (id.includes("cesta")) {
    // cesta de mimbre: cuerpo troncocónico (más ancho arriba), textura de
    // trenzado (bandas horizontales alternas), reborde en el aro y asa en
    // arco — SIN herrajes de metal ni cerradura, eso es de cofre de madera
    const [gx, gy, gz] = gridDe(huella, 0.9);
    const b = Builder();
    const mimbre = color, oscuro = sombrear(color, 0.75), claro = sombrear(color, 1.2);
    const capas = 6;
    for (let i = 0; i < capas; i++) {
      const t = i / (capas - 1);
      const inset = Math.round((1 - t) * Math.min(gx, gz) * 0.22); // más estrecha abajo
      const y0 = Math.round((gy * i) / capas), y1 = Math.round((gy * (i + 1)) / capas) - 1;
      b.caja(inset, y0, inset, gx - 1 - inset, y1, gz - 1 - inset, i % 2 === 0 ? mimbre : oscuro);
    }
    b.caja(0, gy, 0, gx - 1, gy + Math.max(1, Math.round(U * 0.06)), gz - 1, claro); // reborde superior
    const asaAltura = Math.max(2, Math.round(U * 0.3));
    const cx = Math.round(gx / 2);
    b.caja(1, gy, Math.round(gz / 2) - 1, 2, gy + asaAltura, Math.round(gz / 2), oscuro);
    b.caja(gx - 3, gy, Math.round(gz / 2) - 1, gx - 2, gy + asaAltura, Math.round(gz / 2), oscuro);
    b.caja(1, gy + asaAltura, Math.round(gz / 2) - 1, gx - 2, gy + asaAltura + 1, Math.round(gz / 2), oscuro); // arco del asa
    return { grid: [gx, gy + asaAltura + 2, gz], paleta: b.paleta, cajas: b.cajas };
  }
  // baul / arcon / cofre — cofre con tapa y herrajes
  const [gx, gy, gz] = gridDe(huella, 1.3);
  const b = Builder();
  const wood = color, dark = sombrear(color, 0.65);
  const bodyY1 = Math.round(gy * 0.6);
  b.caja(0, 0, 0, gx - 1, bodyY1, gz - 1, wood);
  // tapa abombada (escalonada)
  const escalones = 3;
  for (let i = 0; i < escalones; i++) {
    const inset = i;
    const y0 = bodyY1 + 1 + Math.round((gy - bodyY1 - 1) * i / escalones);
    const y1 = bodyY1 + Math.round((gy - bodyY1 - 1) * (i + 1) / escalones);
    b.caja(inset, y0, inset, gx - 1 - inset, y1, gz - 1 - inset, i === escalones - 1 ? dark : wood);
  }
  // esquineras metálicas
  for (const cx of [0, gx - 1]) for (const cz of [0, gz - 1]) {
    b.caja(cx, 0, cz, cx, bodyY1, cz, METAL);
  }
  // cerradura/aldaba en la cara ANCHA (no siempre z: con huella no cuadrada
  // el frente real es el lado más largo) y asas en los dos lados cortos
  const frenteEnZ = gx >= gz;
  if (frenteEnZ) {
    b.caja(Math.round(gx / 2) - 1, Math.round(bodyY1 * 0.4), gz - 1, Math.round(gx / 2) + 1, Math.round(bodyY1 * 0.6), gz, METAL);
    b.caja(-1, Math.round(bodyY1 * 0.5), Math.round(gz / 2) - 1, 0, Math.round(bodyY1 * 0.5) + 1, Math.round(gz / 2) + 1, METAL);
    b.caja(gx, Math.round(bodyY1 * 0.5), Math.round(gz / 2) - 1, gx + 1, Math.round(bodyY1 * 0.5) + 1, Math.round(gz / 2) + 1, METAL);
  } else {
    b.caja(gx - 1, Math.round(bodyY1 * 0.4), Math.round(gz / 2) - 1, gx, Math.round(bodyY1 * 0.6), Math.round(gz / 2) + 1, METAL);
    b.caja(Math.round(gx / 2) - 1, Math.round(bodyY1 * 0.5), -1, Math.round(gx / 2) + 1, Math.round(bodyY1 * 0.5) + 1, 0, METAL);
    b.caja(Math.round(gx / 2) - 1, Math.round(bodyY1 * 0.5), gz, Math.round(gx / 2) + 1, Math.round(bodyY1 * 0.5) + 1, gz + 1, METAL);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarTina(huella, color) {
  const [gx, gy, gz] = gridDe(huella, 1.1);
  const b = Builder();
  const wood = color, dark = sombrear(color, 0.65), agua = "#7fa8b8";
  const rim = Math.max(1, Math.round(U * 0.12));
  b.caja(0, 0, 0, gx - 1, gy - 1, gz - 1, wood);
  b.caja(rim, Math.round(gy * 0.35), rim, gx - 1 - rim, gy - 1, gz - 1 - rim, agua);
  b.caja(0, Math.round(gy * 0.3), 0, gx - 1, Math.round(gy * 0.3) + 1, gz - 1, dark); // aro
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

// --- objetos colgados de pared: fuego real, marcos, herramientas ---------

function generarFuegoPared(huella, id) {
  const gz = Math.max(3, Math.round(U * 0.5));
  const gx = Math.max(4, Math.round(U * 0.6));
  const gy = Math.max(8, Math.round(U * 1.5));
  const b = Builder();
  const zWall = gz - 1;
  const astaY0 = Math.round(gy * 0.4), astaY1 = Math.round(gy * 0.68); // altura de sujeción a media pared, no a ras de suelo
  const astaX = Math.round(gx / 2);
  // escuadra de hierro en L bien visible: brazo pegado al muro + brazo que
  // sale perpendicular sujetando el asta lejos de la pared (soporte real,
  // no solo un tope pegado al muro)
  b.caja(astaX - 1, astaY0 - 1, 0, astaX, astaY0, zWall, METAL);
  b.caja(astaX - 1, astaY0 - 1, 0, astaX, astaY0 + Math.round(gy * 0.02), 1, METAL);
  if (id.includes("candelabro")) {
    // brazo curvo aproximado + vela + llama
    b.caja(astaX - 1, astaY0, zWall - 2, astaX, astaY1, zWall - 1, METAL);
    b.caja(astaX - 1, astaY1, zWall - 3, astaX, astaY1 + 1, zWall - 1, METAL);
    b.caja(astaX - 1, astaY1 + 1, zWall - 3, astaX, astaY1 + Math.round(gy * 0.18), zWall - 2, "#f0e6c8");
    const flameY0 = astaY1 + Math.round(gy * 0.18) + 1;
    b.caja(astaX - 1, flameY0, zWall - 3, astaX, flameY0 + 2, zWall - 2, LLAMA_BORDE);
    b.caja(astaX - 1, flameY0 + 1, zWall - 3, astaX, flameY0 + 3, zWall - 2, LLAMA_NUCLEO);
  } else {
    // antorcha: mango de madera + cabeza envuelta + llama grande, ASIMÉTRICA
    // (se inclina hacia un lado como si ondeara, no un cono perfecto)
    b.caja(astaX - 1, astaY0, zWall - 2, astaX, astaY1, zWall - 1, "#6b4a2a");
    b.caja(astaX - 2, astaY1, zWall - 3, astaX + 1, astaY1 + Math.round(gy * 0.1), zWall - 1, "#4a3a28");
    const flameY0 = astaY1 + Math.round(gy * 0.1) + 1;
    const flameH = Math.round(gy * 0.32);
    const lean = Math.max(1, Math.round(gx * 0.12)); // deriva hacia +x según sube, como si el aire la empujara
    b.caja(astaX - 2, flameY0, zWall - 3, astaX + 1, flameY0 + Math.round(flameH * 0.4), zWall - 1, LLAMA_BORDE);
    b.caja(astaX - 1, flameY0 + Math.round(flameH * 0.35), zWall - 3, astaX + lean, flameY0 + Math.round(flameH * 0.75), zWall - 1, LLAMA_BORDE);
    b.caja(astaX, flameY0 + Math.round(flameH * 0.7), zWall - 2, astaX + lean, flameY0 + flameH, zWall - 1, LLAMA_BORDE); // punta desviada, más estrecha
    b.caja(astaX - 1, flameY0 + 1, zWall - 3, astaX, flameY0 + Math.round(flameH * 0.55), zWall - 2, LLAMA);
    b.caja(astaX - 1, flameY0 + Math.round(flameH * 0.35), zWall - 3, astaX, flameY0 + Math.round(flameH * 0.75) - 1, zWall - 2, LLAMA_NUCLEO);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarLamparaArana(huella) {
  // candelabro de rueda ("corona lucis") — la araña de techo medieval real:
  // aro horizontal de hierro colgado del techo por cadena central, con
  // radios que lo sujetan al eje y velas repartidas por el borde. La
  // versión anterior dejaba las velas en plataformas sueltas sin nada que
  // las uniera al centro — aquí el aro y los radios son geometría continua.
  const gx = Math.round(U * 1.8), gz = Math.round(U * 1.8), gy = Math.round(U * 1.3);
  const b = Builder();
  const cx = gx / 2, cz = gz / 2;
  const ringY = Math.round(gy * 0.45);
  const r = Math.min(gx, gz) * 0.36;

  const linea = (x0, y0, z0, x1, y1, z1, hex) => {
    const pasos = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
    for (let s = 0; s <= pasos; s++) {
      const t = s / pasos;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t), z = Math.round(z0 + (z1 - z0) * t);
      b.caja(x, y, z, x, y, z, hex);
    }
  };

  // cadena central del techo al aro
  linea(cx, gy - 1, cz, cx, ringY, cz, METAL);
  b.caja(Math.round(cx) - 1, gy - 2, Math.round(cz) - 1, Math.round(cx), gy - 1, Math.round(cz), METAL); // anclaje al techo

  // aro: círculo continuo de vóxeles (sin huecos) a la altura del candelabro
  const pasosAro = Math.max(24, Math.round(r * 6));
  const puntosAro = [];
  for (let i = 0; i <= pasosAro; i++) {
    const ang = (i / pasosAro) * Math.PI * 2;
    puntosAro.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]);
  }
  for (let i = 0; i < puntosAro.length - 1; i++) {
    linea(puntosAro[i][0], ringY, puntosAro[i][1], puntosAro[i + 1][0], ringY, puntosAro[i + 1][1], METAL);
  }
  // 4 radios que unen el eje central con el aro (sujeción real, no solo el aro flotando)
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 8;
    linea(cx, ringY, cz, cx + Math.cos(ang) * r, ringY, cz + Math.sin(ang) * r, METAL);
  }

  // velas repartidas por el borde del aro, cada una con su llama encima
  const nVelas = 6;
  for (let i = 0; i < nVelas; i++) {
    const ang = (i / nVelas) * Math.PI * 2;
    const vx = Math.round(cx + Math.cos(ang) * r), vz = Math.round(cz + Math.sin(ang) * r);
    b.caja(vx - 1, ringY, vz - 1, vx, ringY + Math.round(gy * 0.18), vz, "#f0e6c8");
    const fy = ringY + Math.round(gy * 0.18) + 1;
    b.caja(vx - 1, fy, vz - 1, vx, fy + 1, vz, LLAMA_BORDE);
    b.caja(vx - 1, fy, vz - 1, vx, fy + 2, vz, LLAMA_NUCLEO);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarPanelPared(huella, color, id) {
  const gx = Math.max(6, Math.round(huella[0] * U));
  const gy = Math.max(6, Math.round(huella[1] * U));
  const gz = Math.max(3, Math.round(U * 0.35));
  const b = Builder();
  const marco = sombrear(color, 0.55);
  b.caja(0, 0, gz - 2, gx - 1, gy - 1, gz - 1, marco);
  const inset = Math.max(1, Math.round(U * 0.1));
  if (id === "cuadro") {
    // panel pintado — icono/escena simple de dos tonos (cielo/suelo), no un
    // rectángulo de color liso, más un filete fino de marco (no solo el
    // recuadro rehundido genérico)
    const filete = Math.max(1, Math.round(U * 0.04));
    b.caja(inset - filete, inset - filete, gz - 2, gx - 1 - inset + filete, gy - 1 - inset + filete, gz - 1, sombrear(color, 1.4));
    const horizonte = inset + Math.round((gy - 2 * inset) * 0.6);
    b.caja(inset, inset, gz - 1, gx - 1 - inset, horizonte, gz, "#a8c4d0"); // cielo
    b.caja(inset, horizonte + 1, gz - 1, gx - 1 - inset, gy - 1 - inset, gz, "#6a7a4a"); // suelo/paisaje
    const cx = Math.round(gx / 2);
    b.caja(cx - Math.round(gx * 0.08), horizonte - Math.round(gy * 0.18), gz, cx + Math.round(gx * 0.08), horizonte, gz + 1, sombrear(color, 0.7)); // figura/silueta central
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  b.caja(inset, inset, gz - 2, gx - 1 - inset, gy - 1 - inset, gz - 1, color);
  if (id === "escudo_pared") {
    const cx = Math.round(gx / 2);
    b.caja(cx - Math.round(gx * 0.1), inset, gz - 1, cx + Math.round(gx * 0.1), inset + Math.round(gy * 0.15), gz, METAL_CLARO);
  }
  if (id === "trofeo_caza") {
    const cx = Math.round(gx / 2);
    b.caja(cx - Math.round(gx * 0.35), gy, gz - 1, cx - Math.round(gx * 0.15), gy + Math.round(gy * 0.3), gz, "#d8cdb0");
    b.caja(cx + Math.round(gx * 0.15), gy, gz - 1, cx + Math.round(gx * 0.35), gy + Math.round(gy * 0.3), gz, "#d8cdb0");
  }
  if (id === "reja_ventana") {
    const barras = 4;
    for (let i = 1; i <= barras; i++) {
      const x = Math.round((gx / (barras + 1)) * i);
      b.caja(x, inset, gz - 1, x + 1, gy - 1 - inset, gz, METAL);
    }
    b.caja(inset, Math.round(gy / 2) - 1, gz - 1, gx - 1 - inset, Math.round(gy / 2), gz, METAL);
  }
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarHerramientaPared(id, color) {
  const gx = Math.round(U * 0.9), gy = Math.round(U * 0.9), gz = Math.max(3, Math.round(U * 0.3));
  const b = Builder();
  const mango = "#6b4a2a";
  const zBack = gz - 1;
  if (id === "martillo") {
    b.caja(Math.round(gx / 2) - 1, 0, zBack - 1, Math.round(gx / 2), Math.round(gy * 0.6), zBack, mango);
    b.caja(Math.round(gx / 2) - 4, Math.round(gy * 0.6), zBack - 1, Math.round(gx / 2) + 3, Math.round(gy * 0.75), zBack, METAL);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "tenazas") {
    b.caja(1, 0, zBack - 1, 2, Math.round(gy * 0.8), zBack, METAL);
    b.caja(gx - 3, 0, zBack - 1, gx - 2, Math.round(gy * 0.8), zBack, METAL);
    b.caja(1, Math.round(gy * 0.75), zBack - 1, gx - 2, Math.round(gy * 0.78), zBack, METAL);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "herradura") {
    const t = 2;
    b.caja(1, 0, zBack - 1, 1 + t, Math.round(gy * 0.7), zBack, METAL_CLARO);
    b.caja(gx - 2 - t, 0, zBack - 1, gx - 2, Math.round(gy * 0.7), zBack, METAL_CLARO);
    b.caja(1, Math.round(gy * 0.7), zBack - 1, gx - 2, Math.round(gy * 0.7) + t, zBack, METAL_CLARO);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "sarten") {
    b.caja(Math.round(gx / 2) - 1, Math.round(gy * 0.55), zBack - 1, Math.round(gx / 2), gy - 1, zBack, mango);
    b.caja(1, 0, zBack - 1, gx - 2, Math.round(gy * 0.55), zBack, METAL_CLARO);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "jaula_pajaro") {
    const barras = 4;
    for (let i = 0; i <= barras; i++) {
      const x = Math.round((gx / barras) * i) - (i === barras ? 1 : 0);
      b.caja(x, 0, zBack - 1, x, Math.round(gy * 0.85), zBack, METAL_CLARO);
    }
    b.caja(0, 0, zBack - 1, gx - 1, 1, zBack, METAL_CLARO);
    b.caja(0, Math.round(gy * 0.85), zBack - 1, gx - 1, Math.round(gy * 0.85) + 1, zBack, METAL_CLARO);
    b.caja(Math.round(gx / 2) - 1, Math.round(gy * 0.85) + 1, zBack - 1, Math.round(gx / 2), gy - 1, zBack, METAL_CLARO);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "hierbas_secas") {
    for (let i = 0; i < 3; i++) {
      const x = 1 + i * 2;
      b.caja(x, Math.round(gy * 0.3), zBack - 1, x + 1, Math.round(gy * 0.85), zBack, i % 2 ? "#8a9a4a" : "#a0b060");
    }
    b.caja(0, Math.round(gy * 0.75), zBack - 1, gx - 1, Math.round(gy * 0.8), zBack, "#6b4a2a");
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "toalla") {
    b.caja(0, Math.round(gy * 0.6), zBack - 1, gx - 1, Math.round(gy * 0.65), zBack, METAL_CLARO);
    b.caja(1, 0, zBack - 1, gx - 2, Math.round(gy * 0.62), zBack, color);
    b.caja(2, 0, zBack - 2, gx - 3, Math.round(gy * 0.5), zBack - 1, sombrear(color, 1.1));
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "balda") {
    b.caja(0, Math.round(gy * 0.5), zBack - 2, gx - 1, Math.round(gy * 0.6), zBack, color);
    b.caja(1, Math.round(gy * 0.2), zBack - 1, 2, Math.round(gy * 0.5) - 1, zBack, sombrear(color, 0.7));
    b.caja(gx - 3, Math.round(gy * 0.2), zBack - 1, gx - 2, Math.round(gy * 0.5) - 1, zBack, sombrear(color, 0.7));
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  if (id === "telaranas") {
    // hebras finas CONECTADAS (línea real, sin huecos) que irradian desde la
    // esquina + un par de hilos concéntricos que las cruzan — se lee como
    // telaraña de verdad, no como puntos sueltos flotando
    const linea = (x0, y0, x1, y1, hex) => {
      const pasos = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let s = 0; s <= pasos; s++) {
        const t = s / pasos;
        b.caja(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), zBack, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), zBack, hex);
      }
    };
    const esquinaX = gx - 1, esquinaY = gy - 1;
    const hebras = 5;
    const puntos = [];
    for (let i = 0; i < hebras; i++) {
      const largo = gx * (0.45 + 0.5 * (i / (hebras - 1)));
      const ang = (Math.PI / 2) * (i / (hebras - 1)); // de horizontal a vertical
      const ex = esquinaX - Math.cos(ang) * largo, ey = esquinaY - Math.sin(ang) * largo;
      linea(esquinaX, esquinaY, ex, ey, color);
      puntos.push([esquinaX - Math.cos(ang) * largo * 0.55, esquinaY - Math.sin(ang) * largo * 0.55]);
    }
    // hilo concéntrico: conecta los puntos a media distancia entre hebras consecutivas (arco poligonal real)
    for (let i = 0; i < puntos.length - 1; i++) {
      linea(puntos[i][0], puntos[i][1], puntos[i + 1][0], puntos[i + 1][1], sombrear(color, 1.2));
    }
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  }
  // resto de decoro/manchas — parche plano irregular, discreto
  b.caja(1, Math.round(gy * 0.3), zBack, gx - 3, Math.round(gy * 0.6), zBack, color);
  b.caja(2, Math.round(gy * 0.5), zBack, gx - 2, Math.round(gy * 0.75), zBack, sombrear(color, 1.15));
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarObjetoPequeno(id, color) {
  const G = Math.max(6, Math.round(U * 0.7));
  const b = Builder();
  const dark = sombrear(color, 0.7), light = sombrear(color, 1.3);

  const formas = {
    taza: () => { b.caja(1, 0, 1, G - 2, Math.round(G * 0.6), G - 2, color); b.caja(G - 1, Math.round(G * 0.2), Math.round(G / 2) - 1, G, Math.round(G * 0.5), Math.round(G / 2) + 1, color); },
    jarra_agua: () => { b.caja(1, 0, 1, G - 2, Math.round(G * 0.7), G - 2, color); b.caja(Math.round(G * 0.3), Math.round(G * 0.7), Math.round(G * 0.3), Math.round(G * 0.7), G - 1, Math.round(G * 0.7), color); b.caja(G - 1, Math.round(G * 0.3), Math.round(G / 2) - 1, G, Math.round(G * 0.6), Math.round(G / 2) + 1, color); },
    jarra_cerveza: () => { b.caja(1, 0, 1, G - 2, Math.round(G * 0.75), G - 2, color); b.caja(1, Math.round(G * 0.75), 1, G - 2, Math.round(G * 0.75) + 1, G - 2, light); b.caja(G - 1, Math.round(G * 0.25), Math.round(G / 2) - 1, G, Math.round(G * 0.55), Math.round(G / 2) + 1, dark); },
    plato: () => { b.caja(0, 0, 0, G - 1, Math.round(G * 0.15), G - 1, color); b.caja(1, Math.round(G * 0.15), 1, G - 2, Math.round(G * 0.2), G - 2, light); },
    cuenco: () => { b.caja(0, 0, 0, G - 1, Math.round(G * 0.35), G - 1, color); b.caja(1, Math.round(G * 0.2), 1, G - 2, Math.round(G * 0.4), G - 2, light); },
    libro: () => { for (let i = 0; i < 3; i++) b.caja(i, i, i, G - 1 - i, Math.round(G * 0.1), G - 1 - i, i === 1 ? light : color); },
    pergamino: () => { b.caja(0, 0, Math.round(G * 0.3), G - 1, Math.round(G * 0.2), Math.round(G * 0.7), "#e8d9a8"); b.caja(0, 0, Math.round(G * 0.3), 1, Math.round(G * 0.25), Math.round(G * 0.7), dark); b.caja(G - 2, 0, Math.round(G * 0.3), G - 1, Math.round(G * 0.25), Math.round(G * 0.7), dark); },
    frasco_pocion: () => { b.caja(Math.round(G * 0.25), 0, Math.round(G * 0.25), Math.round(G * 0.75), Math.round(G * 0.6), Math.round(G * 0.75), CRISTAL); b.caja(Math.round(G * 0.35), Math.round(G * 0.6), Math.round(G * 0.35), Math.round(G * 0.65), Math.round(G * 0.7), Math.round(G * 0.65), color); b.caja(Math.round(G * 0.3), 1, Math.round(G * 0.3), Math.round(G * 0.7), Math.round(G * 0.45), Math.round(G * 0.7), color); },
    espejo: () => { b.caja(0, 0, Math.round(G * 0.7), G - 1, G - 1, G - 1, dark); b.caja(1, 1, Math.round(G * 0.7) - 1, G - 2, G - 2, Math.round(G * 0.7) - 1, "#cfe0e6"); },
    reloj_pie: () => { b.caja(Math.round(G * 0.2), 0, Math.round(G * 0.2), Math.round(G * 0.8), G - Math.round(G * 0.15), Math.round(G * 0.8), color); b.caja(Math.round(G * 0.3), G - Math.round(G * 0.3), Math.round(G * 0.15), Math.round(G * 0.7), G - Math.round(G * 0.15), Math.round(G * 0.15) + 1, light); b.caja(Math.round(G * 0.2), G - Math.round(G * 0.15), Math.round(G * 0.15), Math.round(G * 0.8), G - 1, Math.round(G * 0.85), dark); },
    perchero: () => { b.caja(Math.round(G / 2) - 1, 0, Math.round(G / 2) - 1, Math.round(G / 2), G - 1, Math.round(G / 2), color); for (const dz of [-1, 1]) for (const dx of [-1, 1]) b.caja(Math.round(G / 2) + dx, Math.round(G * 0.75), Math.round(G / 2) + dz, Math.round(G / 2) + dx, Math.round(G * 0.78), Math.round(G / 2) + dz, dark); b.caja(Math.round(G * 0.2), 0, Math.round(G * 0.2), Math.round(G * 0.8), 1, Math.round(G * 0.8), dark); },
    maceta: () => { b.caja(Math.round(G * 0.15), 0, Math.round(G * 0.15), Math.round(G * 0.85), Math.round(G * 0.4), Math.round(G * 0.85), color); b.caja(Math.round(G * 0.1), Math.round(G * 0.4), Math.round(G * 0.3), Math.round(G * 0.5), Math.round(G * 0.9), Math.round(G * 0.5), "#4a7a3a"); b.caja(Math.round(G * 0.5), Math.round(G * 0.4), Math.round(G * 0.5), Math.round(G * 0.9), G - 1, Math.round(G * 0.7), "#5a8a45"); },
    mortero_mano: () => { b.caja(Math.round(G * 0.2), 0, Math.round(G * 0.2), Math.round(G * 0.8), Math.round(G * 0.35), Math.round(G * 0.8), color); b.caja(Math.round(G * 0.1), 0, Math.round(G * 0.85), Math.round(G * 0.3), Math.round(G * 0.15), G - 1, dark); },
    dados: () => { b.caja(0, 0, 0, Math.round(G * 0.4), Math.round(G * 0.4), Math.round(G * 0.4), "#e8e0d0"); b.caja(Math.round(G * 0.5), 0, Math.round(G * 0.5), Math.round(G * 0.9), Math.round(G * 0.4), Math.round(G * 0.9), "#e8e0d0"); },
    moneda_suelta: () => { b.caja(0, 0, 0, Math.round(G * 0.5), Math.round(G * 0.08), Math.round(G * 0.5), "#d4af37"); b.caja(Math.round(G * 0.6), 0, Math.round(G * 0.3), G - 1, Math.round(G * 0.08), Math.round(G * 0.3) + Math.round(G * 0.5), "#d4af37"); },
    baraja_cartas: () => { for (let i = 0; i < 4; i++) b.caja(i, 0, i, Math.round(G * 0.6) + i, Math.round(G * 0.05), Math.round(G * 0.8) + i, "#e8e0d0"); },
    reliquia: () => { b.caja(Math.round(G * 0.25), 0, Math.round(G * 0.25), Math.round(G * 0.75), Math.round(G * 0.7), Math.round(G * 0.75), "#d4af37"); b.caja(Math.round(G * 0.4), Math.round(G * 0.7), Math.round(G * 0.4), Math.round(G * 0.6), Math.round(G * 0.85), Math.round(G * 0.6), CRISTAL); },
    armero: () => { b.caja(0, 0, Math.round(G * 0.7), 1, G - 1, Math.round(G * 0.7) + 1, dark); b.caja(G - 2, 0, Math.round(G * 0.7), G - 1, G - 1, Math.round(G * 0.7) + 1, dark); for (const dx of [Math.round(G * 0.35), Math.round(G * 0.65)]) b.caja(dx, Math.round(G * 0.1), Math.round(G * 0.6), dx + 1, G - Math.round(G * 0.1), Math.round(G * 0.6) + 1, METAL_CLARO); },
    brasero: () => { b.caja(Math.round(G * 0.3), 0, Math.round(G * 0.3), Math.round(G * 0.35), Math.round(G * 0.4), Math.round(G * 0.35), METAL); b.caja(Math.round(G * 0.65), 0, Math.round(G * 0.65), Math.round(G * 0.7), Math.round(G * 0.4), Math.round(G * 0.7), METAL); b.caja(Math.round(G * 0.15), Math.round(G * 0.4), Math.round(G * 0.15), Math.round(G * 0.85), Math.round(G * 0.55), Math.round(G * 0.85), METAL_CLARO); b.caja(Math.round(G * 0.25), Math.round(G * 0.55), Math.round(G * 0.25), Math.round(G * 0.75), Math.round(G * 0.65), Math.round(G * 0.75), LLAMA); },
    antorcha_pie: () => {
      const cx = Math.round(G / 2);
      // base/pie trípode + mástil largo + cabeza envuelta + llama grande y visible (misma receta que la de pared)
      for (const dz of [-1, 1]) b.caja(cx + dz - 1, 0, cx + dz - 1, cx + dz, Math.round(G * 0.06), cx + dz, dark);
      b.caja(cx - 1, 0, cx - 1, cx, Math.round(G * 0.55), cx, "#6b4a2a");
      b.caja(cx - 2, Math.round(G * 0.55), cx - 2, cx + 1, Math.round(G * 0.62), cx + 1, "#4a3a28");
      const flameY0 = Math.round(G * 0.63), flameH = Math.round(G * 0.3);
      b.caja(cx - 2, flameY0, cx - 2, cx + 1, flameY0 + flameH, cx + 1, LLAMA_BORDE);
      b.caja(cx - 1, flameY0 + 1, cx - 1, cx, flameY0 + flameH, cx, LLAMA);
      b.caja(cx - 1, flameY0 + Math.round(flameH * 0.4), cx - 1, cx, flameY0 + flameH - 1, cx, LLAMA_NUCLEO);
    },
    regadera: () => { b.caja(Math.round(G * 0.2), 0, Math.round(G * 0.2), Math.round(G * 0.7), Math.round(G * 0.45), Math.round(G * 0.7), color); b.caja(Math.round(G * 0.7), Math.round(G * 0.3), Math.round(G * 0.4), G - 1, Math.round(G * 0.45), Math.round(G * 0.55), color); b.caja(Math.round(G * 0.2), Math.round(G * 0.45), Math.round(G * 0.3), Math.round(G * 0.4), Math.round(G * 0.65), Math.round(G * 0.5), dark); },
    reja_ventana: () => generarPanelPared([1, 1], color, "reja_ventana"),
    asiento_letrina: () => { b.caja(0, Math.round(G * 0.4), 0, G - 1, Math.round(G * 0.55), G - 1, color); b.caja(Math.round(G * 0.3), Math.round(G * 0.4), Math.round(G * 0.3), Math.round(G * 0.7), Math.round(G * 0.56), Math.round(G * 0.7), "#1c1a17"); b.caja(0, 0, 0, Math.round(G * 0.12), Math.round(G * 0.4), Math.round(G * 0.12), dark); b.caja(G - 1 - Math.round(G * 0.12), 0, 0, G - 1, Math.round(G * 0.4), Math.round(G * 0.12), dark); },
    instrumento_musical: () => { b.caja(Math.round(G * 0.2), 0, Math.round(G * 0.3), Math.round(G * 0.8), Math.round(G * 0.55), Math.round(G * 0.7), color); b.caja(Math.round(G * 0.4), Math.round(G * 0.5), Math.round(G * 0.4), Math.round(G * 0.6), G - 1, Math.round(G * 0.6), dark); },
    biombo: () => { for (let i = 0; i < 3; i++) b.caja(Math.round((G / 3) * i), 0, Math.round(i * 1.5), Math.round((G / 3) * i) + Math.round(G * 0.06), G - 1, Math.round(i * 1.5) + Math.round(G * 0.5), color); },
    bala_heno: () => { b.caja(0, 0, 0, G - 1, Math.round(G * 0.7), G - 1, "#c8a83a"); b.caja(1, Math.round(G * 0.7), 1, G - 2, Math.round(G * 0.85), G - 2, "#d8b84a"); },
    tijeras_podar: () => { b.caja(1, 0, Math.round(G / 2) - 1, Math.round(G * 0.6), Math.round(G * 0.1), Math.round(G / 2), METAL_CLARO); b.caja(1, Math.round(G * 0.1), Math.round(G / 2) - 1, Math.round(G * 0.6), Math.round(G * 0.15), Math.round(G / 2), "#6b4a2a"); },
    semillero_bandeja: () => { b.caja(0, 0, 0, G - 1, Math.round(G * 0.2), G - 1, "#8a6a4a"); for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) b.caja(1 + i * Math.round(G * 0.45), Math.round(G * 0.2), 1 + j * Math.round(G * 0.3), Math.round(G * 0.4) + i * Math.round(G * 0.45), Math.round(G * 0.3), Math.round(G * 0.25) + j * Math.round(G * 0.3), "#4a3a28"); },
    enrejado_trepador: () => generarPanelPared([1, 2], color, "enrejado_trepador"),
    cuchillo_cocina: () => { b.caja(0, 0, Math.round(G / 2) - 1, Math.round(G * 0.3), Math.round(G * 0.15), Math.round(G / 2), "#6b4a2a"); b.caja(Math.round(G * 0.3), Math.round(G * 0.02), Math.round(G / 2) - 1, G - 1, Math.round(G * 0.12), Math.round(G / 2), METAL_CLARO); },
    olla: () => { b.caja(0, 0, 0, G - 1, Math.round(G * 0.6), G - 1, METAL); b.caja(-1, Math.round(G * 0.45), Math.round(G / 2) - 1, 0, Math.round(G * 0.55), Math.round(G / 2) + 1, METAL); b.caja(G - 1, Math.round(G * 0.45), Math.round(G / 2) - 1, G, Math.round(G * 0.55), Math.round(G / 2) + 1, METAL); },
    clavos: () => { for (let i = 0; i < 4; i++) b.caja(i * 2, 0, Math.round(G / 2), i * 2, Math.round(G * 0.4), Math.round(G / 2) + 1, METAL_CLARO); },
    jabon: () => { b.caja(1, 0, 1, G - 2, Math.round(G * 0.2), G - 2, "#e0d8b8"); },
    tintero_pluma: () => { b.caja(Math.round(G * 0.2), 0, Math.round(G * 0.2), Math.round(G * 0.5), Math.round(G * 0.3), Math.round(G * 0.5), "#2a2a2a"); b.caja(Math.round(G * 0.5), Math.round(G * 0.2), Math.round(G * 0.3), G - 1, G - 1, Math.round(G * 0.4), "#e8e4d8"); },
  };

  if (formas[id]) {
    formas[id]();
  } else {
    // clutter/suciedad/escombros genérico — algo más orgánico que una caja lisa
    b.caja(Math.round(G * 0.15), 0, Math.round(G * 0.15), Math.round(G * 0.85), Math.round(G * 0.35), Math.round(G * 0.85), color);
    b.caja(Math.round(G * 0.3), Math.round(G * 0.3), Math.round(G * 0.35), Math.round(G * 0.6), Math.round(G * 0.5), Math.round(G * 0.65), light);
  }
  const grid = [G, G, G];
  return { grid, paleta: b.paleta, cajas: b.cajas };
}

// --- estructurales / especiales (12 piezas trabajadas a mano) ------------

const ESTRUCTURALES = {
  chimenea: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 3.4);
    const b = Builder(); const piedra = v.colorDebug, dark = sombrear(piedra, 0.6);
    b.caja(0, 0, 0, gx - 1, gy - 1, gz - 1, piedra);
    const boca = Math.max(2, Math.round(U * 0.3));
    b.caja(Math.round(gx * 0.2), 0, gz - 2, gx - Math.round(gx * 0.2), Math.round(gy * 0.45), gz - 1, "#1c1a17");
    b.caja(Math.round(gx * 0.15), Math.round(gy * 0.45), gz - 3, gx - Math.round(gx * 0.15), Math.round(gy * 0.45) + boca, gz - 1, LLAMA_BORDE);
    b.caja(Math.round(gx * 0.25), Math.round(gy * 0.45) + 1, gz - 3, gx - Math.round(gx * 0.25), Math.round(gy * 0.45) + boca - 1, gz - 1, LLAMA_NUCLEO);
    b.caja(0, Math.round(gy * 0.7), 0, gx - 1, Math.round(gy * 0.78), gz - 1, dark); // repisa/mantel
    b.caja(Math.round(gx * 0.3), Math.round(gy * 0.8), 0, gx - Math.round(gx * 0.3), gy - 1, Math.round(gz * 0.5), piedra); // tiro estrechado
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  columna: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 3.4);
    const b = Builder(); const piedra = v.colorDebug, dark = sombrear(piedra, 0.75);
    b.caja(0, 0, 0, gx - 1, Math.round(U * 0.15), gz - 1, dark); // basa
    for (let y = Math.round(U * 0.15) + 1; y < gy - Math.round(U * 0.15); y += 2) {
      b.caja(1, y, 1, gx - 2, y, gz - 2, piedra);
      b.caja(0, y, Math.round(gz / 2) - 1, gx - 1, y, Math.round(gz / 2), dark); // estría frontal
    }
    b.caja(0, gy - Math.round(U * 0.15), 0, gx - 1, gy - 1, gz - 1, dark); // capitel
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  sarcofago: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 1.3);
    const b = Builder(); const piedra = v.colorDebug, dark = sombrear(piedra, 0.65);
    b.caja(0, 0, 0, gx - 1, Math.round(gy * 0.8), gz - 1, piedra);
    b.caja(-1, Math.round(gy * 0.8), -1, gx, gy - 1, gz, dark); // tapa con reborde
    const cx = Math.round(gx / 2);
    b.caja(cx - 1, 1, 1, cx + 1, Math.round(gy * 0.75), gz - 2, sombrear(piedra, 0.85)); // relieve central
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  horno_pan: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 2.2);
    const b = Builder(); const barro = v.colorDebug, dark = sombrear(barro, 0.6);
    b.caja(0, 0, 0, gx - 1, Math.round(gy * 0.3), gz - 1, dark); // base
    const domeY0 = Math.round(gy * 0.3);
    const escalones = 4;
    for (let i = 0; i < escalones; i++) {
      const inset = Math.round((i / escalones) * gx * 0.35);
      const y0 = domeY0 + Math.round(((gy - domeY0) * i) / escalones);
      const y1 = domeY0 + Math.round((gy - domeY0) * (i + 1) / escalones) - 1;
      b.caja(inset, y0, inset, gx - 1 - inset, y1, gz - 1 - inset, barro);
    }
    b.caja(Math.round(gx * 0.3), domeY0 - 1, gz - 2, Math.round(gx * 0.7), domeY0 + Math.round(U * 0.3), gz - 1, "#1c1a17"); // boca
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  prensa_vino: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 2.6);
    const b = Builder(); const madera = v.colorDebug, dark = sombrear(madera, 0.65);
    b.caja(0, 0, 0, gx - 1, Math.round(gy * 0.2), gz - 1, dark); // cubeta base
    const postW = Math.max(1, Math.round(U * 0.14));
    b.caja(0, 0, 0, postW - 1, gy - 1, postW - 1, madera);
    b.caja(gx - postW, 0, 0, gx - 1, gy - 1, postW - 1, madera);
    b.caja(0, 0, gz - postW, postW - 1, gy - 1, gz - 1, madera);
    b.caja(gx - postW, 0, gz - postW, gx - 1, gy - 1, gz - 1, madera);
    b.caja(0, gy - Math.round(U * 0.2), 0, gx - 1, gy - 1, gz - 1, dark); // travesaño superior
    const cx = Math.round(gx / 2), cz = Math.round(gz / 2);
    b.caja(cx - 1, Math.round(gy * 0.25), cz - 1, cx + 1, gy - Math.round(U * 0.25), cz + 1, METAL_CLARO); // husillo
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  rueda_afilar: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 1.6);
    const b = Builder(); const madera = v.colorDebug;
    const legW = Math.max(1, Math.round(U * 0.14));
    for (const cx of [0, gx - legW]) for (const cz of [0, gz - legW]) b.caja(cx, 0, cz, cx + legW - 1, Math.round(gy * 0.45), cz + legW - 1, sombrear(madera, 0.65));
    const cz = Math.round(gz / 2);
    const r = Math.round(gx * 0.4);
    b.caja(Math.round(gx / 2) - r, Math.round(gy * 0.45), cz - 1, Math.round(gx / 2) + r, gy - 1, cz + 1, METAL_CLARO); // rueda vertical
    b.caja(Math.round(gx / 2) - 1, Math.round(gy * 0.45) + r - 1, cz - 2, Math.round(gx / 2) + 1, Math.round(gy * 0.45) + r + 1, cz + 2, sombrear(madera, 0.65)); // eje
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  pesebre: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 1.0);
    const b = Builder(); const madera = v.colorDebug, heno = "#c8a83a";
    const legW = Math.max(1, Math.round(U * 0.12));
    for (const cx of [0, gx - legW]) for (const cz of [0, gz - legW]) b.caja(cx, 0, cz, cx + legW - 1, Math.round(gy * 0.4), cz + legW - 1, sombrear(madera, 0.65));
    b.caja(0, Math.round(gy * 0.4), 0, gx - 1, Math.round(gy * 0.8), gz - 1, madera);
    const inset = Math.max(1, Math.round(U * 0.12));
    b.caja(inset, Math.round(gy * 0.5), inset, gx - 1 - inset, Math.round(gy * 0.8), gz - 1 - inset, heno);
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  fragua: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 2.4);
    const b = Builder(); const piedra = v.colorDebug, dark = sombrear(piedra, 0.6);
    b.caja(0, 0, 0, gx - 1, Math.round(gy * 0.45), gz - 1, piedra);
    const bocaW = Math.round(gx * 0.4);
    b.caja(Math.round(gx / 2) - Math.round(bocaW / 2), Math.round(gy * 0.15), gz - 2, Math.round(gx / 2) + Math.round(bocaW / 2), Math.round(gy * 0.4), gz - 1, "#1c1a17");
    b.caja(Math.round(gx / 2) - Math.round(bocaW / 3), Math.round(gy * 0.16), gz - 2, Math.round(gx / 2) + Math.round(bocaW / 3), Math.round(gy * 0.32), gz - 1, LLAMA_BORDE);
    b.caja(Math.round(gx / 2) - Math.round(bocaW / 5), Math.round(gy * 0.17), gz - 2, Math.round(gx / 2) + Math.round(bocaW / 5), Math.round(gy * 0.28), gz - 1, LLAMA_NUCLEO);
    b.caja(Math.round(gx * 0.35), Math.round(gy * 0.45), Math.round(gz * 0.35), Math.round(gx * 0.65), gy - 1, Math.round(gz * 0.65), dark); // campana/chimenea
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  telar: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 2.0);
    const b = Builder(); const madera = v.colorDebug;
    const postW = Math.max(1, Math.round(U * 0.12));
    for (const cx of [0, gx - postW]) b.caja(cx, 0, 0, cx + postW - 1, gy - 1, postW, madera);
    b.caja(0, gy - Math.round(U * 0.15), 0, gx - 1, gy - 1, postW, madera);
    for (let i = 0; i < 5; i++) {
      const y = Math.round(U * 0.2) + i * Math.round((gy - Math.round(U * 0.4)) / 5);
      b.caja(postW, y, Math.round(gz / 2), gx - postW - 1, y, Math.round(gz / 2) + 1, "#d8cdb0"); // hilos tensados
    }
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
  rueca: (v) => {
    const [gx, gy, gz] = gridDe(v.huella, 2.2);
    const b = Builder(); const madera = v.colorDebug;
    b.caja(Math.round(gx * 0.3), 0, Math.round(gz * 0.3), Math.round(gx * 0.7), Math.round(gy * 0.15), Math.round(gz * 0.7), sombrear(madera, 0.65)); // base
    const cx = Math.round(gx / 2), cz = Math.round(gz / 2);
    const r = Math.round(Math.min(gx, gy) * 0.32);
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(gy * 0.55 + Math.sin(ang) * r);
      b.caja(x, y, cz - 1, x, y, cz + 1, madera);
    }
    b.caja(cx - 1, Math.round(gy * 0.15), cz - 1, cx + 1, Math.round(gy * 0.55), cz + 1, sombrear(madera, 0.65)); // eje vertical
    return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas };
  },
};

// --- clasificación ---------------------------------------------------------

function clasificar(id, v) {
  const patasAsiento = ["silla", "taburete", "banco", "trono", "mecedora", "reclinatorio"];
  const camas = ["cama", "litera", "jergon", "cuna"];
  const mesas = ["mesa", "atril", "altar", "mostrador", "encimera", "escritorio", "bancada", "yunque", "fregadero", "especiero"];
  const colgadoParedRe = v.colocacion.includes("colgadoEnPared") || v.anchorType === "WALL_HIGH_FLOATING";
  const contenedorAlto = ["armario", "estanteria", "guardarropa"];
  const contenedorBajo = ["baul", "arcon", "cofre", "barril", "tinaja", "caldero", "cesta"];
  const tinas = ["tina_madera", "bañera"];
  if (ESTRUCTURALES[id]) return "ESTRUCTURAL";
  if (tinas.includes(id)) return "TINA";
  if (colgadoParedRe) return "COLGADO_PARED";
  if (camas.some((k) => id.includes(k))) return "CAMA";
  if (patasAsiento.some((k) => id.includes(k))) return "ASIENTO";
  if (mesas.some((k) => id.includes(k)) || v.esSuperficie) return "MESA";
  // los cofres (arcon, baúles...) también llevan esContenedor:true, así que
  // el nombre de cofre tiene que comprobarse ANTES que el genérico
  // esContenedor — si no, un cofre con tapa se clasifica como armario con puertas
  if (contenedorBajo.some((k) => id.includes(k))) return "CONTENEDOR_BAJO";
  if (v.esContenedor || contenedorAlto.some((k) => id.includes(k))) return "CONTENEDOR_ALTO";
  const [hx, hy] = v.huella;
  if (hx === 1 && hy === 1 && !v.esSuperficie) return "OBJETO_PEQUENO";
  return "GENERICO";
}

const FUEGO_IDS = ["antorcha_pared", "candelabro_pared"];
const PANEL_IDS = ["tapiz", "cuadro", "escudo_pared", "trofeo_caza", "reja_ventana"];
const HERRAMIENTA_PARED_IDS = ["martillo", "tenazas", "herradura", "sarten", "jaula_pajaro", "hierbas_secas", "toalla", "balda",
  "telaranas", "grietas_pared", "manchas_humedad", "moho", "sangre_seca", "viga_vista", "boveda_piedra", "artesonado"];

function generarColgadoPared(id, v) {
  if (FUEGO_IDS.includes(id)) return generarFuegoPared(v.huella, id);
  if (id === "lampara_arana") return generarLamparaArana(v.huella);
  if (id === "lampara_aceite") return generarFuegoPared(v.huella, "candelabro_pared");
  if (id === "farol_colgante") {
    const m = generarFuegoPared(v.huella, "candelabro_pared");
    return m;
  }
  if (PANEL_IDS.includes(id)) return generarPanelPared(v.huella, v.colorDebug, id);
  if (HERRAMIENTA_PARED_IDS.includes(id)) return generarHerramientaPared(id, v.colorDebug);
  return generarPanelPared(v.huella, v.colorDebug, id);
}

const ARQUETIPO_FN = {
  ASIENTO: (v, id) => generarAsiento(v.huella, v.colorDebug, id),
  MESA: (v, id) => generarMesa(v.huella, v.colorDebug, v.esSuperficie, id),
  CAMA: (v, id) => generarCama(v.huella, v.colorDebug, id),
  CONTENEDOR_ALTO: (v, id) => generarContenedorAlto(v.huella, v.colorDebug, id),
  CONTENEDOR_BAJO: (v, id) => generarContenedorBajo(v.huella, v.colorDebug, id),
  TINA: (v) => generarTina(v.huella, v.colorDebug),
  COLGADO_PARED: (v, id) => generarColgadoPared(id, v),
  OBJETO_PEQUENO: (v, id) => generarObjetoPequeno(id, v.colorDebug),
  ESTRUCTURAL: (v, id) => ESTRUCTURALES[id](v),
  GENERICO: (v) => generarObjetoPequeno("", v.colorDebug),
};

// --- resolución variable por pieza -----------------------------------------
// No todo necesita el mismo número de vóxeles: una silla con listones o un
// armario con bisagras se benefician de más subdivisión; una mancha de humedad
// o un escombro no ganan nada por tener más cuadraditos.

const ALTA_MESA = ["yunque", "altar", "fregadero", "atril"];
const FUEGO_RES = ["antorcha_pared", "candelabro_pared", "lampara_aceite", "farol_colgante", "lampara_arana"];
const PANEL_RES = ["tapiz", "cuadro", "escudo_pared", "trofeo_caza", "reja_ventana"];
const HERRAMIENTA_RES = ["martillo", "tenazas", "herradura", "sarten", "jaula_pajaro", "hierbas_secas", "toalla", "balda"];
const DECO_PARED_RES = ["viga_vista", "boveda_piedra", "artesonado"];
const GRIME_RES = ["grietas_pared", "manchas_humedad", "moho", "sangre_seca"]; // telarañas necesita más resolución para que se le vean las hebras finas
const OBJ_DETALLADO_RES = ["taza", "jarra_agua", "jarra_cerveza", "frasco_pocion", "espejo", "reloj_pie", "perchero",
  "maceta", "antorcha_pie", "armero", "brasero", "instrumento_musical", "biombo", "regadera", "asiento_letrina", "olla", "tintero_pluma"];
const OBJ_SIMPLE_RES = ["polvo", "hojas_secas", "mueble_roto", "oxido", "ceniza", "nido_ratas", "escombros", "cristales_rotos"];

function resolverU(id, arq) {
  let factor = 1.0;
  switch (arq) {
    case "ASIENTO": factor = 1.4; break; // listones, travesaños
    case "MESA": factor = ALTA_MESA.includes(id) ? 1.4 : 1.2; break;
    case "CAMA": factor = 1.3; break; // cabecero, remates
    case "CONTENEDOR_ALTO": factor = 1.5; break; // puertas, bisagras, pomos
    case "CONTENEDOR_BAJO": factor = (id === "barril" || id === "tinaja" || id === "caldero") ? 1.3 : 1.4; break;
    case "TINA": factor = 1.0; break;
    case "ESTRUCTURAL": factor = 1.5; break; // piezas trabajadas a mano, aguantan el detalle
    case "COLGADO_PARED":
      if (FUEGO_RES.includes(id)) factor = 1.6; // llama/vela necesitan más resolución para leerse
      else if (PANEL_RES.includes(id)) factor = 1.3;
      else if (HERRAMIENTA_RES.includes(id)) factor = 1.3;
      else if (DECO_PARED_RES.includes(id)) factor = 1.1;
      else if (GRIME_RES.includes(id)) factor = 0.8; // manchas/telarañas: menos, a propósito
      else factor = 1.1;
      break;
    case "OBJETO_PEQUENO":
      if (OBJ_DETALLADO_RES.includes(id)) factor = 1.4;
      else if (OBJ_SIMPLE_RES.includes(id)) factor = 0.8; // escombros/ceniza: no ganan nada con más cuadraditos
      else factor = 1.0;
      break;
    default: factor = 1.0;
  }
  return Math.max(6, Math.round(UBASE * factor));
}

const resultado = {};
const conteoArquetipos = {};
let variantesGeneradas = 0;
for (const [id, v] of Object.entries(catalogo)) {
  const arq = clasificar(id, v);
  conteoArquetipos[arq] = (conteoArquetipos[arq] || 0) + 1;
  U = resolverU(id, arq);
  const modelo = ARQUETIPO_FN[arq](v, id);
  resultado[id] = { nombre: id.replace(/_/g, " "), arquetipo: arq, capa: v.capa, resolucion: U, ...modelo };

  // Variantes nombradas (pedido 2026-08-30, ver resolverVariante arriba):
  // MISMA huella/arquetipo que el id base, pero con el tono + estilo que su
  // propio nombre sugiere — nunca antes generaban un modelo propio.
  for (const variante of v.variantesNombradas || []) {
    const { color, tallado, desgaste } = resolverVariante(variante.id, id, v.colorDebug);
    U = resolverU(id, arq); // resolverU vuelve a fijar U (aplicarTallado/Desgaste no lo necesitan, pero el arquetipo sí)
    let modeloVariante = ARQUETIPO_FN[arq]({ ...v, colorDebug: color }, id);
    if (tallado) modeloVariante = aplicarTallado(modeloVariante);
    if (desgaste) modeloVariante = aplicarDesgaste(modeloVariante, crearRnd(variante.id));
    resultado[variante.id] = {
      nombre: variante.id.replace(/_/g, " "), arquetipo: arq, capa: v.capa, resolucion: U,
      basadoEn: id, peso: variante.peso, ...modeloVariante,
    };
    variantesGeneradas++;
  }
}

fs.writeFileSync(__dirname + "/modelos_generados.json", JSON.stringify(resultado));
console.log("Generados:", Object.keys(resultado).length, "piezas (", variantesGeneradas, "variantes nombradas incluidas )");
console.log("Por arquetipo:", conteoArquetipos);
let totalVoxeles = 0, maxVoxeles = 0;
for (const m of Object.values(resultado)) {
  let n = 0;
  for (const [x0, y0, z0, x1, y1, z1] of m.cajas) n += (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
  totalVoxeles += n; maxVoxeles = Math.max(maxVoxeles, n);
}
console.log("Vóxeles totales:", totalVoxeles, "· máximo por pieza:", maxVoxeles);
