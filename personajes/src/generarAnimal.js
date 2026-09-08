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
// Plantillas de esqueleto implementadas: cuadrupedo, ave, insecto, pez,
// serpiente, crustaceo, anfibio (fauna terrestre/de agua dulce con patas o
// cuerpo alargado) + bivalvo, estrella, erizo, anemona, tubular, pulpo,
// calamar, caracol, medusa (2026-09-08, fauna marina radial/con concha que
// no encajaba en ninguna de las anteriores — ver docs/GDD_Generador_Personajes.md).

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
const COLOR_CARNE = "#d89a8a";

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
  const altoOreja = { largas: 0.9, puntiagudas: 0.45, laterales: 0.2, caidas: 0.65 }[orejas] * p.tamCabeza;
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

// --- Plantillas nuevas: fauna marina radial/con concha (2026-09-08,
// pedido streamer "crea esa fauna marina que falte") — los 7 esqueletos de
// arriba están pensados para animales con patas/aleta/cabeza al frente;
// moluscos con concha, equinodermos radiales y cefalópodos no encajan en
// ninguno (ya documentado en docs/GDD_Generador_Personajes.md), así que
// aquí van las plantillas nuevas que sí les corresponden — mismo contrato
// exacto (piezas = cajas colgando de pivotes con nombre). Limitación real
// del motor: una caja NUNCA se rota, solo se posiciona — así que un
// "brazo"/"púa" que debe apuntar en una dirección concreta se resuelve
// SIEMPRE eligiendo qué dimensión (w/h/d) se alarga en el eje correcto
// (vertical para lo que cuelga/pincha hacia arriba, profundidad para lo
// que apunta al frente), nunca con un ángulo arbitrario.

function esqueletoBivalvo(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Molusco sésil sin cabeza ni patas: dos valvas con bisagra trasera —
  // "valvaSuperior" queda como pivote propio (hoy fijo, listo para animar
  // una apertura de filtrado más adelante) y un resquicio de "carne" a la
  // vista entre ambas, igual que se ve un mejillón/ostra entreabiertos.
  pieza("valvaInferior", 0, 0, 0, p.anchoCuerpo, p.altoCuerpo * 0.48, p.largoCuerpo, color);
  pieza("carne", 0, p.altoCuerpo * 0.4, 0, p.anchoCuerpo * 0.7, p.altoCuerpo * 0.12, p.largoCuerpo * 0.75, COLOR_CARNE);
  pieza("valvaSuperior", 0, p.altoCuerpo * 0.5, 0, p.anchoCuerpo * 0.96, p.altoCuerpo * 0.48, p.largoCuerpo * 0.96, ajustarColor(color, -0.08));
  return piezas;
}

function esqueletoEstrella(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Tumbada sobre el fondo: disco central + 4 brazos cardinales (elongados
  // de verdad, apuntan en su eje) + 4 nudos diagonales cortos que redondean
  // la silueta — aproximación de la simetría de 5 brazos con cajas rectas.
  const grosor = p.altoCuerpo;
  pieza("cuerpo", 0, 0, 0, p.anchoCuerpo * 0.32, grosor, p.anchoCuerpo * 0.32, color);
  const largoBrazo = p.anchoCuerpo * 0.42;
  const anchoBase = p.anchoCuerpo * 0.16;
  for (const [pivote, dx, dz] of [["brazoN", 0, 1], ["brazoS", 0, -1], ["brazoE", 1, 0], ["brazoO", -1, 0]]) {
    const w = dx !== 0 ? largoBrazo : anchoBase;
    const d = dz !== 0 ? largoBrazo : anchoBase;
    pieza(pivote, dx * (anchoBase + largoBrazo) / 2, 0, dz * (anchoBase + largoBrazo) / 2, w, grosor * 0.85, d, ajustarColor(color, -0.04));
  }
  const nub = p.anchoCuerpo * 0.14;
  for (const [pivote, sx, sz] of [["brazoNE", 1, 1], ["brazoNO", -1, 1], ["brazoSE", 1, -1], ["brazoSO", -1, -1]]) {
    pieza(pivote, sx * p.anchoCuerpo * 0.24, 0, sz * p.anchoCuerpo * 0.24, nub, grosor * 0.7, nub, ajustarColor(color, -0.08));
  }
  return piezas;
}

function esqueletoErizo(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Cúpula sobre el fondo + púas: verticales sobre el domo (correcto sin
  // rotar — una caja vertical pincha "hacia arriba" venga de donde venga
  // su offset) más un anillo ecuatorial solo en los 4 cardinales, donde sí
  // se puede alargar la caja en el eje que apunta hacia fuera de verdad.
  pieza("cuerpo", 0, 0, 0, p.anchoCuerpo, p.altoCuerpo, p.anchoCuerpo, color);
  const largoPua = p.anchoCuerpo * 0.5;
  const grosorPua = p.anchoCuerpo * 0.05;
  pieza("puaCima", 0, p.altoCuerpo * 0.75, 0, grosorPua, largoPua, grosorPua, ajustarColor(color, 0.15));
  for (const { r, n } of [{ r: 0.35, n: 6 }, { r: 0.65, n: 8 }]) {
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      pieza(`pua_${r}_${k}`, Math.cos(ang) * p.anchoCuerpo * r, p.altoCuerpo * 0.72, Math.sin(ang) * p.anchoCuerpo * r, grosorPua, largoPua * (0.85 + rnd() * 0.2), grosorPua, ajustarColor(color, 0.1 + rnd() * 0.08));
    }
  }
  for (const [pivote, dx, dz] of [["puaN", 0, 1], ["puaS", 0, -1], ["puaE", 1, 0], ["puaO", -1, 0]]) {
    const w = dx !== 0 ? largoPua : grosorPua;
    const d = dz !== 0 ? largoPua : grosorPua;
    pieza(pivote, dx * (p.anchoCuerpo / 2 + largoPua / 2), p.altoCuerpo * 0.4, dz * (p.anchoCuerpo / 2 + largoPua / 2), w, grosorPua, d, ajustarColor(color, 0.08));
  }
  return piezas;
}

function esqueletoAnemona(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Sésil: columna fija al sustrato + corona de tentáculos arriba, cada
  // uno con su propio pivote (nTentaculos) para poder ondular al animar.
  pieza("columna", 0, 0, 0, p.anchoCuerpo, p.altoCuerpo * 0.7, p.anchoCuerpo, color);
  pieza("columna", 0, p.altoCuerpo * 0.6, 0, p.anchoCuerpo * 1.15, p.altoCuerpo * 0.15, p.anchoCuerpo * 1.15, ajustarColor(color, -0.08));
  const nTentaculos = 10;
  const largoTent = p.altoCuerpo * 0.9;
  const grosorTent = p.anchoCuerpo * 0.09;
  for (let i = 0; i < nTentaculos; i++) {
    const ang = (i / nTentaculos) * Math.PI * 2;
    const r = p.anchoCuerpo * 0.5;
    pieza(`tentaculo${i}`, Math.cos(ang) * r, p.altoCuerpo * 0.75, Math.sin(ang) * r, grosorTent, largoTent, grosorTent, ajustarColor(color, 0.1 + (i % 3) * 0.04));
  }
  return piezas;
}

function esqueletoTubular(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Cuerpo blando tumbado en el fondo, sin cabeza diferenciada ni patas —
  // unos pocos segmentos que se afinan hacia los dos extremos, más un
  // ramillete corto de tentáculos bucales en el extremo delantero.
  const segmentos = 4;
  const dSeg = p.largoCuerpo / segmentos;
  for (let i = 0; i < segmentos; i++) {
    const z = p.largoCuerpo / 2 - dSeg * (i + 0.5);
    const factorExtremo = 1 - Math.min(i, segmentos - 1 - i) / (segmentos / 2 - 0.5) * 0.4;
    pieza(`segmento${i}`, 0, 0, z, p.anchoCuerpo * factorExtremo, p.altoCuerpo * factorExtremo, dSeg * 1.05, ajustarColor(color, (rnd() - 0.5) * 0.05));
  }
  const zBoca = p.largoCuerpo / 2 + p.anchoCuerpo * 0.15;
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * p.anchoCuerpo * 0.18;
    pieza("boca", x, p.altoCuerpo * 0.3, zBoca, p.anchoCuerpo * 0.08, p.anchoCuerpo * 0.08, p.anchoCuerpo * 0.22, ajustarColor(color, 0.15));
  }
  return piezas;
}

function esqueletoPulpo(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Cabeza abombada elevada sobre 8 brazos colgantes — cajas verticales
  // (correcto sin rotar: cuelgan hacia el suelo desde un punto de la
  // cabeza, ninguno "apunta" en diagonal) — pose de reposo sobre roca.
  const largoBrazo = p.largoCuerpo;
  const cabezaY = largoBrazo * 0.92;
  pieza("cabeza", 0, cabezaY, 0, p.tamCabeza, p.tamCabeza * 0.9, p.tamCabeza, color);
  const ojo = p.tamCabeza * 0.22;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2 + 0.006), cabezaY + p.tamCabeza * 0.6, p.tamCabeza * 0.3, 0.014, ojo, ojo, COLOR_OJO);
  }
  const nBrazos = 8;
  const grosorBrazo = p.tamCabeza * 0.14;
  for (let i = 0; i < nBrazos; i++) {
    const ang = (i / nBrazos) * Math.PI * 2;
    const r = p.tamCabeza * 0.42;
    pieza(`brazo${i}`, Math.cos(ang) * r, 0, Math.sin(ang) * r, grosorBrazo, largoBrazo * (0.85 + rnd() * 0.2), grosorBrazo, ajustarColor(color, -0.05 - (i % 2) * 0.05));
  }
  return piezas;
}

function esqueletoCalamar(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Manto torpedo + aletas laterales (mismo planteamiento que "pez") pero
  // con un ramillete de brazos/tentáculos colgando de la cabeza en vez de
  // cola caudal — cada brazo se alarga en PROFUNDIDAD (apunta al frente,
  // +z, la dirección real de nado) y se reparte en x/y para abrir el
  // ramillete sin necesitar rotar ninguna caja.
  const vientre = 0.02;
  pieza("cuerpo", 0, vientre, 0, p.anchoCuerpo, p.altoCuerpo, p.largoCuerpo * 0.7, color);
  pieza("cuerpo", 0, vientre, -p.largoCuerpo * 0.42, p.anchoCuerpo * 0.55, p.altoCuerpo * 0.55, p.largoCuerpo * 0.18, ajustarColor(color, -0.08));
  for (const lado of [-1, 1]) {
    pieza(lado < 0 ? "aletaIzq" : "aletaDer", lado * (p.anchoCuerpo / 2 + 0.02), vientre + p.altoCuerpo * 0.6, -p.largoCuerpo * 0.2, 0.05, p.altoCuerpo * 0.5, p.largoCuerpo * 0.4, ajustarColor(color, -0.1));
  }
  const zCabeza = p.largoCuerpo * 0.42;
  pieza("cabeza", 0, vientre, zCabeza, p.tamCabeza, p.tamCabeza * 0.85, p.tamCabeza, ajustarColor(color, -0.04));
  const ojo = p.tamCabeza * 0.24;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * (p.tamCabeza / 2 + 0.006), vientre + p.tamCabeza * 0.5, zCabeza, 0.014, ojo, ojo, COLOR_OJO);
  }
  const nBrazos = 8;
  const grosorBrazo = p.tamCabeza * 0.12;
  const zBaseBrazos = zCabeza + p.tamCabeza * 0.5;
  for (let i = 0; i < nBrazos; i++) {
    const ang = (i / nBrazos) * Math.PI * 2;
    const esTentaculoLargo = i < 2; // 2 tentáculos de caza más largos que los 6 brazos
    const largo = p.tamCabeza * (esTentaculoLargo ? 1.7 : 1.0);
    pieza(`brazo${i}`, Math.cos(ang) * p.tamCabeza * 0.3, vientre + p.tamCabeza * 0.4 + Math.sin(ang) * p.tamCabeza * 0.25, zBaseBrazos + largo / 2, grosorBrazo, grosorBrazo, largo, ajustarColor(color, -0.1));
  }
  return piezas;
}

function esqueletoCaracol(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Pie plano reptando por el fondo + concha en espiral aproximada como 3
  // cajas decrecientes apiladas (sin rotación real, pero el degradado de
  // tamaño/altura sostiene la lectura "concha enrollada") + 2 tentáculos
  // oculares largos con el ojo en la punta, lo más reconocible del grupo.
  pieza("pie", 0, 0, 0, p.anchoCuerpo, p.altoCuerpo * 0.35, p.largoCuerpo, color);
  const colorConcha = ajustarColor(color, -0.1);
  pieza("concha", 0, p.altoCuerpo * 0.3, -p.largoCuerpo * 0.1, p.tamCabeza, p.tamCabeza * 0.75, p.tamCabeza, colorConcha);
  pieza("concha", p.tamCabeza * 0.12, p.altoCuerpo * 0.3 + p.tamCabeza * 0.32, -p.largoCuerpo * 0.05, p.tamCabeza * 0.65, p.tamCabeza * 0.5, p.tamCabeza * 0.65, ajustarColor(colorConcha, -0.06));
  pieza("concha", p.tamCabeza * 0.2, p.altoCuerpo * 0.3 + p.tamCabeza * 0.55, 0, p.tamCabeza * 0.35, p.tamCabeza * 0.3, p.tamCabeza * 0.35, ajustarColor(colorConcha, -0.12));
  const largoTent = p.anchoCuerpo * 0.5;
  const ojo = p.anchoCuerpo * 0.12;
  for (const lado of [-1, 1]) {
    pieza("cabeza", lado * p.anchoCuerpo * 0.18, p.altoCuerpo * 0.35, p.largoCuerpo * 0.42, p.anchoCuerpo * 0.06, largoTent, p.anchoCuerpo * 0.06, ajustarColor(color, 0.05));
    pieza("cabeza", lado * p.anchoCuerpo * 0.18, p.altoCuerpo * 0.35 + largoTent, p.largoCuerpo * 0.42, ojo, ojo, ojo, COLOR_OJO);
  }
  return piezas;
}

function esqueletoMedusa(p, rasgos, color, rnd) {
  const piezas = [];
  const pieza = (pivote, cx, y0, cz, w, h, d, c) => piezas.push({ pivote, cx, y0, cz, w, h, d, color: c });
  // Flota en el agua, misma convención que "pez": ancla cerca de y=0, el
  // cliente decide su altura de nado real. Campana (2 cajas, más ancha
  // abajo) + tentáculos colgando en anillo bajo el borde.
  const base = 0.02;
  pieza("cuerpo", 0, base, 0, p.anchoCuerpo, p.altoCuerpo * 0.55, p.anchoCuerpo, color);
  pieza("cuerpo", 0, base + p.altoCuerpo * 0.45, 0, p.anchoCuerpo * 0.8, p.altoCuerpo * 0.55, p.anchoCuerpo * 0.8, ajustarColor(color, 0.1));
  const nTentaculos = 8;
  const largoTent = p.altoCuerpo * 2.2;
  const grosorTent = p.anchoCuerpo * 0.06;
  for (let i = 0; i < nTentaculos; i++) {
    const ang = (i / nTentaculos) * Math.PI * 2;
    const r = p.anchoCuerpo * 0.38;
    pieza(`tentaculo${i}`, Math.cos(ang) * r, base - largoTent, Math.sin(ang) * r, grosorTent, largoTent, grosorTent, ajustarColor(color, -0.1 - (i % 2) * 0.1));
  }
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
  bivalvo: esqueletoBivalvo,
  estrella: esqueletoEstrella,
  erizo: esqueletoErizo,
  anemona: esqueletoAnemona,
  tubular: esqueletoTubular,
  pulpo: esqueletoPulpo,
  calamar: esqueletoCalamar,
  caracol: esqueletoCaracol,
  medusa: esqueletoMedusa,
};

/**
 * Genera un individuo concreto de una especie animal.
 * @param {string} especieId - id en baker/catalogo/animales.json Y en personajes/catalogo/animales_rig.json
 * @param {object} opciones - { semilla, catalogos }
 */
// Herencia de rig (pedido streamer 2026-09-02: "¿la perra y el perro no
// pueden ser el mismo 3D con un atributo de sexo distinto?" — sí, y con
// esto es UN CAMPO en vez de duplicar todo el bloque de proporciones/razas).
// `heredaDe` apunta al id de OTRA especie ya rigada: toma su esqueleto/
// proporciones/razas/coloresPosibles enteros, sin copiarlos — solo la
// `escala` (obligatoria en quien hereda: una yegua no tiene por qué medir
// lo mismo que el caballo) y un `rasgos` PARCIAL opcional (ej. cuernos más
// largos en el macho) pisan a la base. `esCria:true` además quita razas y
// coloresPosibles propios (una cría no distingue raza a esta fidelidad
// visual) y limpia cuernos/cresta (no le han crecido aún) del resultado.
function limpiarRasgosCria(rasgos) {
  const limpio = { ...rasgos };
  if (limpio.cuernos) limpio.cuernos = "ninguno";
  if ("cresta" in limpio) limpio.cresta = false;
  return limpio;
}
function resolverHerencia(rig, catalogoRig, especieId) {
  let resuelto = rig;
  if (rig.heredaDe) {
    const base = catalogoRig[rig.heredaDe];
    if (!base) throw new Error(`${especieId}: heredaDe apunta a una especie sin rig: ${rig.heredaDe}`);
    let rasgos = { ...base.rasgos, ...(rig.rasgos || {}) };
    if (rig.esCria) rasgos = limpiarRasgosCria(rasgos);
    resuelto = {
      esqueleto: base.esqueleto,
      escala: rig.escala || base.escala,
      proporciones: base.proporciones,
      rasgos,
      razas: rig.esCria ? undefined : base.razas,
      coloresPosibles: rig.esCria ? undefined : base.coloresPosibles,
    };
  } else if (rig.heredaRazasDe) {
    // Caso más ligero: la especie YA tiene su propio cuerpo/color (ej.
    // gallina_salvaje, con proporciones reales distintas de gallo) pero
    // quiere compartir el mismo REPARTO de razas que otra especie — sin
    // heredar esqueleto/proporciones, solo `razas`.
    const otra = catalogoRig[rig.heredaRazasDe];
    if (!otra) throw new Error(`${especieId}: heredaRazasDe apunta a una especie sin rig: ${rig.heredaRazasDe}`);
    resuelto = { ...rig, razas: otra.razas };
  }
  return resuelto;
}

function generarAnimal(especieId, opciones) {
  const { catalogos, semilla } = opciones;
  const rigDeclarado = catalogos.animalesRig[especieId];
  if (!rigDeclarado) throw new Error(`Especie sin rig: ${especieId} (añadir a personajes/catalogo/animales_rig.json)`);
  const rig = resolverHerencia(rigDeclarado, catalogos.animalesRig, especieId);
  const baker = catalogos.animalesBaker[especieId];
  if (!baker) throw new Error(`Especie desconocida en baker/catalogo/animales.json: ${especieId}`);
  const plantilla = ESQUELETOS[rig.esqueleto];
  if (!plantilla) throw new Error(`Esqueleto sin plantilla: ${rig.esqueleto}`);

  const rnd = crearPRNG(`${semilla}|animal|${especieId}`);

  // Razas de verdad — tamaño Y forma, no solo color (pedido 2026-08-29,
  // "perros y gatos con razas diferentes, tamaños diferentes colores y
  // forma, estilo doberman/caniche/labrador"): si la especie declara
  // `razas` en animales_rig.json (lista de {id, peso, escala?,
  // proporciones?, rasgos?, coloresPosibles?}), se sortea UNA raza entera
  // con `elegirPonderado` — igual que rasgos.json para pelo/piel humanos —
  // y sus campos SUSTITUYEN a los de la especie base solo para lo que la
  // raza declare (patrón "solo lo que cambie", igual que los overrides de
  // NPC por profesión en npcs.json); lo que la raza no toque sigue
  // saliendo de la base. Especies sin `razas` funcionan exactamente igual
  // que antes.
  const raza = rig.razas ? elegirPonderado(rig.razas.map((r) => [r, r.peso]), rnd) : null;
  const escalaRango = raza?.escala ?? rig.escala;
  const proporcionesBase = { ...rig.proporciones, ...(raza?.proporciones ?? {}) };
  const rasgosBase = { ...rig.rasgos, ...(raza?.rasgos ?? {}) };
  // Razas por color (pedido 2026-08-29 anterior, "vacas negras/marrones..."):
  // si la raza no trae su propia paleta, cae a la de la especie base — así
  // una especie sin sistema de razas de forma sigue teniendo razas de color.
  const coloresPosibles = raza?.coloresPosibles ?? rig.coloresPosibles;

  const escala = Number(enRango(escalaRango, rnd).toFixed(3));
  const colorBase = coloresPosibles ? elegirPonderado(coloresPosibles, rnd) : baker.colorDebug;
  // tono individual sutil sobre la raza (o el colorDebug) elegida — variedad
  // dentro de la misma raza, no sustituye a la raza en sí.
  const color = ajustarColor(colorBase, (rnd() - 0.5) * 0.12);
  // sexo: de momento solo decide rasgos marcados como "solo machos"
  // (cuernos ramificados del ciervo) — 50/50 salvo que la especie diga otra cosa
  const sexo = rnd() < 0.5 ? "macho" : "hembra";

  const proporciones = {};
  for (const [k, v] of Object.entries(proporcionesBase)) proporciones[k] = v * escala;

  const rasgos = { ...rasgosBase };
  if (rasgos.cuernos === "ramificados" && sexo === "hembra") delete rasgos.cuernos;

  const piezas = plantilla(proporciones, rasgos, color, rnd);

  return {
    ficha: { especieId, semilla, esqueleto: rig.esqueleto, escala, color, sexo, rasgos, raza: raza?.id ?? null },
    piezas,
  };
}

module.exports = { generarAnimal, ESQUELETOS };
