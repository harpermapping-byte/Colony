"use strict";

// Generador procedural de ANIMALES — la otra mitad del creador de
// personajes (decisión del streamer: todo lo que tenga esqueleto sale de
// este creador vóxel, PJs y fauna por igual). Mismo patrón determinista:
// especie del catálogo + semilla = individuo concreto, siempre el mismo.
//
// Cada individuo sale como PIEZAS (cajas) colgando de PIVOTES con nombre
// (cuerpo/cabeza/pataDelIzq/.../cola/alaIzq...) — el mismo contrato que el
// rig humanoide: el cliente creará un grupo por pivote y animar será rotar
// pivotes (andar = patas en contrafase, volar = alas). Toda caja se
// construye con sus 6 caras (regla del streamer: nada se ve hueco).
//
// Plantillas de esqueleto implementadas: cuadrupedo, ave, insecto. Las que
// faltan (pez, serpiente, crustaceo...) se añaden aquí + una entrada por
// especie en animales_rig.json — el resto no se toca.

const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");

function ajustarColor(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const aj = (c) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => aj(c).toString(16).padStart(2, "0")).join("");
}

function enRango([min, max], rnd) {
  return min + (max - min) * rnd();
}

const COLOR_OJO = "#1a140e";
const COLOR_PICO = "#c9922a";
const COLOR_CRESTA = "#c0392b";
const COLOR_ALA_INSECTO = "#dfe8f0";
const COLOR_CUERNO = "#d8cfc0";

// --- Plantillas de esqueleto ---
// Reciben proporciones YA escaladas al individuo. Convención igual que el
// rig humanoide: el animal mira hacia +z, anclado por los pies (y=0).
// Devuelven lista de piezas {pivote, cx, y0, cz, w, h, d, color}.

function esqueletoCuadrupedo(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  const topeCuerpo = p.altoPata + p.altoCuerpo;

  pieza("cuerpo", 0, p.altoPata, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo, color);

  const margenPata = p.grosorPata / 2;
  for (const [pivote, sx, sz] of [
    ["pataDelIzq", -1, 1], ["pataDelDer", 1, 1], ["pataTrasIzq", -1, -1], ["pataTrasDer", 1, -1],
  ]) {
    pieza(pivote, sx * (p.anchoCuerpo / 2 - margenPata), 0, sz * (p.largoCuerpo / 2 - margenPata), p.grosorPata, p.altoPata, p.grosorPata, ajustarColor(color, -0.06));
  }

  // cabeza al frente, levantada respecto al lomo
  const cabezaY = topeCuerpo - p.tamCabeza * 0.5;
  const cabezaZ = p.largoCuerpo / 2 + p.tamCabeza / 2;
  pieza("cabeza", 0, cabezaY, cabezaZ, p.tamCabeza, p.tamCabeza, p.tamCabeza, color);

  // hocico por rasgo (corto/medio/largo)
  const largoHocico = { corto: 0.25, medio: 0.45, largo: 0.7 }[rasgos.hocico || "medio"] * p.tamCabeza;
  pieza("cabeza", 0, cabezaY + p.tamCabeza * 0.15, cabezaZ + p.tamCabeza / 2 + largoHocico / 2, p.tamCabeza * 0.55, p.tamCabeza * 0.45, largoHocico, ajustarColor(color, -0.08));

  // ojos a los lados de la cabeza (los cuadrúpedos miran lateral)
  const ojo = p.tamCabeza * 0.16;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2 + 0.004), cabezaY + p.tamCabeza * 0.6, cabezaZ + p.tamCabeza * 0.2, 0.012, ojo, ojo, COLOR_OJO);
  }

  // orejas por rasgo
  const orejas = rasgos.orejas || "puntiagudas";
  const altoOreja = { largas: 0.9, puntiagudas: 0.45, laterales: 0.2 }[orejas] * p.tamCabeza;
  const anchoOreja = orejas === "laterales" ? p.tamCabeza * 0.45 : p.tamCabeza * 0.22;
  for (const lado of [-1, 1]) {
    const ox = orejas === "laterales" ? lado * (p.tamCabeza / 2 + anchoOreja / 2) : lado * p.tamCabeza * 0.28;
    const oy = orejas === "laterales" ? cabezaY + p.tamCabeza * 0.6 : cabezaY + p.tamCabeza;
    pieza("cabeza", ox, oy, cabezaZ - p.tamCabeza * 0.1, anchoOreja, altoOreja, p.tamCabeza * 0.14, ajustarColor(color, -0.05));
  }

  // cuernos por rasgo (cortos = tacos; ramificados = columna + travesaño)
  if (rasgos.cuernos === "cortos") {
    for (const lado of [-1, 1]) {
      pieza("cabeza", lado * p.tamCabeza * 0.32, cabezaY + p.tamCabeza, cabezaZ, p.tamCabeza * 0.14, p.tamCabeza * 0.4, p.tamCabeza * 0.14, COLOR_CUERNO);
    }
  } else if (rasgos.cuernos === "ramificados") {
    for (const lado of [-1, 1]) {
      const bx = lado * p.tamCabeza * 0.3;
      pieza("cabeza", bx, cabezaY + p.tamCabeza, cabezaZ, p.tamCabeza * 0.12, p.tamCabeza * 0.9, p.tamCabeza * 0.12, COLOR_CUERNO);
      pieza("cabeza", bx + lado * p.tamCabeza * 0.18, cabezaY + p.tamCabeza * 1.55, cabezaZ - p.tamCabeza * 0.05, p.tamCabeza * 0.45, p.tamCabeza * 0.1, p.tamCabeza * 0.1, COLOR_CUERNO);
    }
  }

  // cola por rasgo
  const colaZ = -p.largoCuerpo / 2;
  if (rasgos.cola === "pomo") {
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.3, colaZ - 0.03, p.anchoCuerpo * 0.3, p.anchoCuerpo * 0.3, 0.07, ajustarColor(color, 0.1));
  } else if (rasgos.cola === "corta") {
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.25, colaZ - 0.05, p.grosorPata, p.grosorPata, 0.12, ajustarColor(color, -0.05));
  } else if (rasgos.cola === "larga") {
    const largoCola = p.largoCuerpo * (0.35 + rnd() * 0.1); // variación individual sutil
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.35, colaZ - largoCola / 2, p.grosorPata, p.grosorPata, largoCola, ajustarColor(color, -0.05));
  }

  return piezas;
}

function esqueletoAve(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  const topeCuerpo = p.altoPata + p.altoCuerpo;

  pieza("cuerpo", 0, p.altoPata, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo, color);

  // patas finas (las aves del bake andan; volar es animación futura)
  const grosorPata = 0.035;
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "pataIzq" : "pataDer", lado * p.anchoCuerpo * 0.22, 0, 0, grosorPata, p.altoPata, grosorPata, COLOR_PICO);
  }

  // alas plegadas a los lados
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "alaIzq" : "alaDer", lado * (p.anchoCuerpo / 2 + 0.02), p.altoPata + p.altoCuerpo * 0.25, -p.largoCuerpo * 0.05, 0.05, p.altoCuerpo * 0.6, p.largoCuerpo * 0.75, ajustarColor(color, -0.1));
  }

  // cabeza sobre el frente del cuerpo
  const cabezaY = topeCuerpo + p.tamCabeza * 0.1;
  const cabezaZ = p.largoCuerpo * 0.32;
  pieza("cabeza", 0, cabezaY, cabezaZ, p.tamCabeza, p.tamCabeza, p.tamCabeza, color);

  // pico
  const largoPico = (rasgos.pico === "largo" ? 0.9 : 0.45) * p.tamCabeza;
  pieza("cabeza", 0, cabezaY + p.tamCabeza * 0.3, cabezaZ + p.tamCabeza / 2 + largoPico / 2, p.tamCabeza * 0.3, p.tamCabeza * 0.25, largoPico, COLOR_PICO);

  // ojos laterales
  const ojo = p.tamCabeza * 0.2;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2 + 0.003), cabezaY + p.tamCabeza * 0.55, cabezaZ + p.tamCabeza * 0.1, 0.01, ojo, ojo, COLOR_OJO);
  }

  if (rasgos.cresta) {
    pieza("cabeza", 0, cabezaY + p.tamCabeza, cabezaZ, p.tamCabeza * 0.2, p.tamCabeza * 0.35, p.tamCabeza * 0.7, COLOR_CRESTA);
  }

  // cola en abanico (caja plana inclinada hacia arriba se aproxima con caja horizontal elevada)
  if (rasgos.cola === "abanico") {
    pieza("cola", 0, topeCuerpo - p.altoCuerpo * 0.15, -p.largoCuerpo / 2 - p.largoCuerpo * 0.15, p.anchoCuerpo * 0.8, p.altoCuerpo * 0.5, p.largoCuerpo * 0.3, ajustarColor(color, -0.12));
  }

  return piezas;
}

function esqueletoInsecto(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  const suelo = p.altoPata;

  // abdomen (atrás) — con rayas si la especie las declara (franjas alternas)
  const largoAbdomen = p.largoCuerpo * 0.5;
  const zAbdomen = -p.largoCuerpo * 0.25;
  if (rasgos.rayas) {
    const franjas = 3;
    const dFranja = largoAbdomen / franjas;
    for (let i = 0; i < franjas; i++) {
      const c = i % 2 === 0 ? color : rasgos.rayas;
      pieza("cuerpo", 0, suelo, zAbdomen - largoAbdomen / 2 + dFranja * (i + 0.5), p.anchoCuerpo, p.altoCuerpo, dFranja, c);
    }
  } else {
    pieza("cuerpo", 0, suelo, zAbdomen, p.anchoCuerpo, p.altoCuerpo, largoAbdomen, color);
  }

  // tórax (centro) y cabeza (frente)
  const largoTorax = p.largoCuerpo * 0.3;
  pieza("cuerpo", 0, suelo, p.largoCuerpo * 0.1, p.anchoCuerpo * 0.85, p.altoCuerpo * 0.9, largoTorax, ajustarColor(color, -0.06));
  const zCabeza = p.largoCuerpo * 0.25 + p.tamCabeza / 2;
  pieza("cabeza", 0, suelo + p.altoCuerpo * 0.05, zCabeza, p.tamCabeza, p.tamCabeza, p.tamCabeza, ajustarColor(color, -0.1));

  // ojos grandes de insecto
  const ojo = p.tamCabeza * 0.4;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2), suelo + p.altoCuerpo * 0.05 + p.tamCabeza * 0.45, zCabeza + p.tamCabeza * 0.15, 0.012, ojo, ojo, COLOR_OJO);
  }

  // antenas
  if (rasgos.antenas) {
    for (const lado of [-1, 1]) {
      pieza("cabeza", lado * p.tamCabeza * 0.25, suelo + p.tamCabeza, zCabeza + p.tamCabeza * 0.2, 0.012, p.tamCabeza * 0.8, 0.012, COLOR_OJO);
    }
  }

  // 6 patas finas colgando del tórax
  const grosor = 0.014;
  for (let i = 0; i < 3; i++) {
    const z = p.largoCuerpo * 0.1 - largoTorax / 2 + (largoTorax / 3) * (i + 0.5);
    for (const lado of [-1, 1]) {
      pieza(`pata${i}${lado < 0 ? "Izq" : "Der"}`, lado * (p.anchoCuerpo / 2 + grosor), 0, z, grosor, suelo, grosor, COLOR_OJO);
    }
  }

  // alas translúcidas plegadas encima (color claro fijo — la transparencia
  // real la decidirá el material del cliente)
  if (rasgos.alas) {
    for (const lado of [-1, 1]) {
      pieza(lado < 0 ? "alaIzq" : "alaDer", lado * p.anchoCuerpo * 0.35, suelo + p.altoCuerpo, -p.largoCuerpo * 0.1, p.anchoCuerpo * 0.5, 0.012, p.largoCuerpo * 0.6, COLOR_ALA_INSECTO);
    }
  }

  return piezas;
}

function esqueletoPez(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Los peces se anclan por el vientre a y=0 igual que el resto (el cliente
  // los colocará a su altura de nado dentro del agua — misma convención
  // que el hundimiento del PJ nadando).
  const vientre = 0.02;

  // cuerpo fusiforme: caja central + morro y arranque de cola más finos
  pieza("cuerpo", 0, vientre, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo * 0.55, color);
  pieza("cuerpo", 0, vientre + p.altoCuerpo * 0.15, p.largoCuerpo * 0.36, p.anchoCuerpo * 0.7, p.altoCuerpo * 0.7, p.largoCuerpo * 0.25, ajustarColor(color, -0.04));
  pieza("cola", 0, vientre + p.altoCuerpo * 0.2, -p.largoCuerpo * 0.36, p.anchoCuerpo * 0.5, p.altoCuerpo * 0.55, p.largoCuerpo * 0.22, ajustarColor(color, -0.06));

  // aleta caudal (vertical, plana) — pivote cola para el coleteo
  pieza("cola", 0, vientre + p.altoCuerpo * 0.05, -p.largoCuerpo * 0.55, 0.02, p.altoCuerpo * 1.1, p.largoCuerpo * 0.18, ajustarColor(color, -0.14));

  // aleta dorsal (alta en tiburones)
  const altoDorsal = (rasgos.dorsal === "alta" ? 0.9 : 0.4) * p.altoCuerpo;
  pieza("cuerpo", 0, vientre + p.altoCuerpo, p.largoCuerpo * 0.02, 0.02, altoDorsal, p.largoCuerpo * 0.2, ajustarColor(color, -0.12));

  // aletas pectorales
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "aletaIzq" : "aletaDer", lado * (p.anchoCuerpo / 2 + 0.03), vientre + p.altoCuerpo * 0.25, p.largoCuerpo * 0.18, 0.06, 0.02, p.largoCuerpo * 0.15, ajustarColor(color, -0.1));
  }

  // ojos laterales cerca del morro
  const ojo = p.altoCuerpo * 0.22;
  for (const lado of [-1, 1]) {
    pieza("cuerpo", lado * (p.anchoCuerpo * 0.36), vientre + p.altoCuerpo * 0.55, p.largoCuerpo * 0.4, 0.012, ojo, ojo, COLOR_OJO);
  }
  return piezas;
}

function esqueletoSerpiente(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // cuerpo en S sobre el suelo: segmentos con zigzag lateral, cada uno con
  // su pivote (segmento0..n) para poder ondular al animar
  const segmentos = 6;
  const dSeg = p.largoCuerpo / segmentos;
  for (let i = 0; i < segmentos; i++) {
    const z = p.largoCuerpo / 2 - dSeg * (i + 0.5);
    const x = Math.sin((i / (segmentos - 1)) * Math.PI * 1.5) * p.anchoCuerpo * 1.2;
    // la cola va afinándose
    const grosor = p.anchoCuerpo * (1 - (i / segmentos) * 0.55);
    const c = rasgos.anillos && i % 2 === 1 ? ajustarColor(color, -0.18) : color;
    pieza(`segmento${i}`, x, 0, z, grosor, p.altoCuerpo * (1 - (i / segmentos) * 0.4), dSeg * 1.05, c);
  }
  // cabeza algo más ancha al frente, con ojos arriba
  const zCabeza = p.largoCuerpo / 2 + p.tamCabeza * 0.4;
  pieza("cabeza", 0, 0, zCabeza, p.tamCabeza, p.altoCuerpo * 1.15, p.tamCabeza, ajustarColor(color, -0.05));
  const ojo = p.tamCabeza * 0.22;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * p.tamCabeza * 0.28, p.altoCuerpo * 1.15, zCabeza + p.tamCabeza * 0.2, ojo, 0.012, ojo, COLOR_OJO);
  }
  // cascabel/punta de cola destacada si la especie lo pide
  if (rasgos.cascabel) {
    pieza("cola", -p.anchoCuerpo * 0.5, 0, -p.largoCuerpo / 2 - 0.04, p.anchoCuerpo * 0.5, p.altoCuerpo * 0.7, 0.08, ajustarColor(color, 0.18));
  }
  return piezas;
}

function esqueletoCrustaceo(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  const suelo = p.altoPata;

  // caparazón ancho y bajo (los cangrejos son más anchos que largos)
  pieza("cuerpo", 0, suelo, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo, color);
  pieza("cuerpo", 0, suelo + p.altoCuerpo, 0, p.anchoCuerpo * 0.7, p.altoCuerpo * 0.35, p.largoCuerpo * 0.7, ajustarColor(color, -0.08));

  // pinzas al frente: brazo + pinza más gorda
  for (const lado of [-1, 1]) {
    const pivote = lado < 0 ? "pinzaIzq" : "pinzaDer";
    pieza(pivote, lado * (p.anchoCuerpo / 2 + p.anchoCuerpo * 0.15), suelo, p.largoCuerpo * 0.35, p.anchoCuerpo * 0.18, p.altoCuerpo * 0.5, p.largoCuerpo * 0.3, ajustarColor(color, -0.05));
    pieza(pivote, lado * (p.anchoCuerpo / 2 + p.anchoCuerpo * 0.22), suelo, p.largoCuerpo * 0.62, p.anchoCuerpo * 0.3, p.altoCuerpo * 0.7, p.largoCuerpo * 0.28, ajustarColor(color, 0.06));
  }

  // 3 patas finas por lado
  const grosor = 0.022;
  for (let i = 0; i < 3; i++) {
    const z = -p.largoCuerpo * 0.3 + (p.largoCuerpo * 0.5 / 3) * (i + 0.5);
    for (const lado of [-1, 1]) {
      pieza(`pata${i}${lado < 0 ? "Izq" : "Der"}`, lado * (p.anchoCuerpo / 2 + 0.04), 0, z, grosor, suelo, grosor, ajustarColor(color, -0.12));
    }
  }

  // ojos sobre pedúnculos
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * p.anchoCuerpo * 0.18, suelo + p.altoCuerpo * 1.3, p.largoCuerpo * 0.35, 0.02, p.altoCuerpo * 0.45, 0.02, ajustarColor(color, -0.15));
    pieza("cabeza", lado * p.anchoCuerpo * 0.18, suelo + p.altoCuerpo * 1.75, p.largoCuerpo * 0.35, 0.035, 0.035, 0.035, COLOR_OJO);
  }
  return piezas;
}

function esqueletoAnfibio(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // cuerpo agachado casi a ras de suelo, más alto atrás
  pieza("cuerpo", 0, p.altoPata * 0.4, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo, color);
  pieza("cuerpo", 0, p.altoPata * 0.4 + p.altoCuerpo * 0.7, -p.largoCuerpo * 0.15, p.anchoCuerpo * 0.8, p.altoCuerpo * 0.4, p.largoCuerpo * 0.55, ajustarColor(color, -0.05));

  // patas traseras grandes plegadas (el muslo sobresale por los lados)
  for (const lado of [-1, 1]) {
    const pivote = lado < 0 ? "pataTrasIzq" : "pataTrasDer";
    pieza(pivote, lado * (p.anchoCuerpo / 2 + p.anchoCuerpo * 0.2), 0, -p.largoCuerpo * 0.25, p.anchoCuerpo * 0.4, p.altoCuerpo * 0.95, p.largoCuerpo * 0.45, ajustarColor(color, -0.08));
    pieza(pivote, lado * (p.anchoCuerpo / 2 + p.anchoCuerpo * 0.25), 0, p.largoCuerpo * 0.0, p.anchoCuerpo * 0.3, p.altoPata * 0.4, p.largoCuerpo * 0.4, ajustarColor(color, -0.12));
  }
  // patas delanteras cortas
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "pataDelIzq" : "pataDelDer", lado * p.anchoCuerpo * 0.32, 0, p.largoCuerpo * 0.32, p.anchoCuerpo * 0.16, p.altoPata * 0.4 + p.altoCuerpo * 0.3, p.anchoCuerpo * 0.16, ajustarColor(color, -0.06));
  }

  // ojos saltones ENCIMA de la cabeza (lo más reconocible de una rana)
  const ojo = p.tamCabeza * 0.5;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * p.anchoCuerpo * 0.25, p.altoPata * 0.4 + p.altoCuerpo, p.largoCuerpo * 0.32, ojo, ojo, ojo, ajustarColor(color, 0.12));
    pieza("cabeza", lado * p.anchoCuerpo * 0.25, p.altoPata * 0.4 + p.altoCuerpo + ojo * 0.25, p.largoCuerpo * 0.32 + ojo * 0.3, ojo * 0.45, ojo * 0.45, ojo * 0.2, COLOR_OJO);
  }
  // papada clara
  pieza("cabeza", 0, p.altoPata * 0.4, p.largoCuerpo * 0.42, p.anchoCuerpo * 0.6, p.altoCuerpo * 0.5, 0.04, ajustarColor(color, 0.16));
  return piezas;
}

const ESQUELETOS = {
  cuadrupedo: esqueletoCuadrupedo,
  ave: esqueletoAve,
  insecto: esqueletoInsecto,
  pez: esqueletoPez,
  serpiente: esqueletoSerpiente,
  crustaceo: esqueletoCrustaceo,
  anfibio: esqueletoAnfibio,
};

/**
 * Genera un individuo concreto de una especie animal.
 * @param {string} especieId - id en baker/catalogo/animales.json Y en personajes/catalogo/animales_rig.json
 * @param {object} opciones - { semilla, catalogos }
 */
function generarAnimal(especieId, opciones) {
  const { catalogos, semilla } = opciones;
  const rig = catalogos.animalesRig[especieId];
  if (!rig) throw new Error(`Especie sin rig: ${especieId} (añadir a personajes/catalogo/animales_rig.json)`);
  const baker = catalogos.animalesBaker[especieId];
  if (!baker) throw new Error(`Especie desconocida en baker/catalogo/animales.json: ${especieId}`);
  const plantilla = ESQUELETOS[rig.esqueleto];
  if (!plantilla) throw new Error(`Esqueleto sin plantilla: ${rig.esqueleto}`);

  const rnd = crearPRNG(`${semilla}|animal|${especieId}`);
  const escala = Number(enRango(rig.escala, rnd).toFixed(3));
  // Razas por color (pedido 2026-08-29, "vacas negras/marrones/blanco y
  // negro, mismo criterio para ovejas/perros — como razas cambiando el
  // color"): si la especie declara `coloresPosibles` en animales_rig.json
  // (mismo formato [id-color, peso] que ya usa rasgos.json para pelo/piel
  // humanos, vía el mismo `elegirPonderado`), se sortea UNA raza entera —
  // no un tono sutil sobre un único color. Especies sin el campo siguen
  // igual que antes (colorDebug del baker + jitter pequeño) — no hace
  // falta tocar las que aún no tienen razas definidas.
  const colorBase = rig.coloresPosibles ? elegirPonderado(rig.coloresPosibles, rnd) : baker.colorDebug;
  // tono individual sutil sobre la raza (o el colorDebug) elegida — variedad
  // dentro de la misma raza, no sustituye a la raza en sí.
  const color = ajustarColor(colorBase, (rnd() - 0.5) * 0.12);
  // sexo: de momento solo decide rasgos marcados como "solo machos"
  // (cuernos ramificados del ciervo) — 50/50 salvo que la especie diga otra cosa
  const sexo = rnd() < 0.5 ? "macho" : "hembra";

  const proporciones = {};
  for (const [k, v] of Object.entries(rig.proporciones)) proporciones[k] = v * escala;

  const rasgos = { ...rig.rasgos };
  if (rasgos.cuernos === "ramificados" && sexo === "hembra") delete rasgos.cuernos;

  const piezas = plantilla(proporciones, rasgos, color, rnd);

  return {
    ficha: { especieId, semilla, esqueleto: rig.esqueleto, escala, color, sexo, rasgos },
    piezas,
  };
}

module.exports = { generarAnimal, ESQUELETOS };
