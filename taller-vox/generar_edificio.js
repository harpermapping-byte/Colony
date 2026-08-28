"use strict";
// Generador de EDIFICIOS del taller de vóxeles — la pieza que faltaba junto a
// muebles/naturaleza/personajes: la "caja" que hoy pinta el bakeador de
// ciudades (t:"e", color por riqueza) se sustituye por un edificio de verdad
// por convención de nombre, sin tocar cliente ni servidor (docs/GDD_Motor_3D_Props.md
// §Convención de assets). Cero catálogos nuevos: lee DIRECTAMENTE
// interiores/catalogo/tipos_edificio.json (riqueza, plantas altas, material
// preferido), ciudades/catalogo/huellas.json (ancho x largo real que ya usa
// el bakeador de ciudades) e interiores/catalogo/materiales.json
// (colorDebug de madera/piedra/marmol/adobe... el mismo que usan los
// muebles). El edificio es la MASA exterior (igual que las piezas de
// decoración de ciudades/): no es el interior real caminable — ese sigue
// siendo la room instanciada aparte a la que se entra por la puerta.
//
// Mismo formato de salida que generar_modelos.js/generar_naturaleza.js
// ({grid, paleta, cajas}, U=10 subdivisiones por casilla) — exportar_glb.js
// lo convierte a .glb tal cual, con face-culling. Determinista puro: cada
// variante usa PRNG(id|NN) (mulberry32 compartido). Siempre orientado con
// la puerta hacia -Z ("frente"); la rotación real en el mapa la pone `ro`
// al colocar el prop, igual que el resto de props del baker.
//
//   node generar_edificio.js           # 1 edificio de ejemplo por arquetipo (10)
//   node generar_edificio.js todo      # los ~41 tipoEdificio del catálogo

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../interiores/src/azar");

const tiposEdificio = require("../interiores/catalogo/tipos_edificio.json");
const materiales = require("../interiores/catalogo/materiales.json");
const huellas = require("../ciudades/catalogo/huellas.json");

const U = 10; // vóxeles por casilla — mismo criterio que muebles/naturaleza
const PAD = Math.round(U * 0.6); // margen para que aleros/voladizos nunca den coordenada negativa

const MADERA_OSCURA = "#5a4326"; // mismo tono que cartel_poste/valla_madera de ciudades/catalogo/decoracion.json
const MADERA_CLARA = "#6a4a26"; // mismo tono que amarradero/antorcha_poste
const CRISTAL = materiales.cristal?.colorDebug || "#bcdff0";
const PAJA = materiales.paja?.colorDebug || "#d4b84a";
const TEJA = "#7a4228"; // teja de barro cocido — no hay campo "tejado" en materiales.json, constante local (como VERDE_FOLLAJE en generar_naturaleza)
const PIZARRA = "#454f5c";
const FUEGO = "#ff9a3a"; // brasas — mismo tono que antorcha_poste (coherencia visual con el canal de iluminación)
const ROOF_POR_RIQUEZA = { humilde: PAJA, modesta: TEJA, noble: PIZARRA };

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

// --- textura de material: LAS 4 CARAS, nunca solo la de delante -----------
// El edificio se ve desde cualquier ángulo al caminar alrededor en el mapa
// (no es mobiliario de interior visto siempre desde el mismo lado): las 4
// fachadas llevan la MISMA textura de material, no solo la que mira "a
// cámara". Vetas de madera = pobre; sillares de piedra = rico; entramado
// Tudor (vigas vistas sobre estuco) = casa noble con volaydizo.
const CARAS = ["S", "N", "E", "O"];

function limitesCara(piso, cara) {
  const vertical = cara === "S" || cara === "N";
  const desde = vertical ? piso.x0 : piso.z0, hasta = vertical ? piso.x1 : piso.z1;
  const fijo = cara === "S" ? piso.z0 : cara === "N" ? piso.z1 : cara === "O" ? piso.x0 : piso.x1;
  return { vertical, desde, hasta, fijo };
}

function vetasMadera(b, piso, cara, colorBase) {
  const oscuro = sombrear(colorBase, 0.8);
  const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
  const paso = Math.max(2, Math.round(U * 0.42));
  for (let p = desde + paso; p < hasta; p += paso) {
    if (vertical) b.caja(p, piso.y0, fijo, p, piso.y1, fijo, oscuro);
    else b.caja(fijo, piso.y0, p, fijo, piso.y1, p, oscuro);
  }
}

function sillarPiedra(b, piso, cara, colorBase) {
  const oscuro = sombrear(colorBase, 0.82);
  const claro = sombrear(colorBase, 1.08);
  const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
  const paso = Math.max(2, Math.round(U * 0.5));
  let fila = 0;
  for (let y = piso.y0 + paso; y < piso.y1; y += paso, fila++) {
    if (vertical) b.caja(desde, y, fijo, hasta, y, fijo, oscuro);
    else b.caja(fijo, y, desde, fijo, y, hasta, oscuro);
    // juntas verticales entre sillares, alternadas a hiladas (aparejo real, no rejilla)
    for (let p = desde + (fila % 2 === 0 ? paso / 2 : paso); p < hasta; p += paso) {
      const y0 = Math.max(piso.y0, y - paso + 1), y1 = y;
      if (vertical) b.caja(Math.round(p), y0, fijo, Math.round(p), y1, fijo, claro);
      else b.caja(fijo, y0, Math.round(p), fijo, y1, Math.round(p), claro);
    }
  }
}

function entramadoTudor(b, piso, colorViga) {
  for (const cara of CARAS) {
    const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
    if (vertical) { b.caja(desde, piso.y0, fijo, hasta, piso.y0, fijo, colorViga); b.caja(desde, piso.y1, fijo, hasta, piso.y1, fijo, colorViga); }
    else { b.caja(fijo, piso.y0, desde, fijo, piso.y0, hasta, colorViga); b.caja(fijo, piso.y1, desde, fijo, piso.y1, hasta, colorViga); }
    vetasMaderaConColor(b, piso, cara, colorViga);
  }
}
function vetasMaderaConColor(b, piso, cara, colorViga) {
  const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
  const paso = Math.max(2, Math.round(U * 0.55));
  for (let p = desde + paso; p < hasta; p += paso) {
    if (vertical) b.caja(p, piso.y0, fijo, p, piso.y1, fijo, colorViga);
    else b.caja(fijo, piso.y0, p, fijo, piso.y1, p, colorViga);
  }
}

// materialesPreferidos[0] del catálogo -> qué textura de fachada le toca.
// estuco/tela_tapiz/cristal se dejan lisos (los cubre el entramado Tudor si
// hay voladizo, o quedan de color plano — un escaparate de cristal no lleva
// sillar ni veta).
function familiaTextura(material) {
  if (["madera", "mimbre", "cuero"].includes(material)) return "madera";
  if (["piedra", "marmol", "ladrillo", "adobe", "metal"].includes(material)) return "piedra";
  return null;
}

// --- cuerpo compartido: pila de plantas con voladizo opcional -------------
// Cada archetipo parte de este "macizo" y le añade tejado + detalles. Las
// plantas altas con `jetty` sobresalen del piso de abajo (voladizo tipo casa
// medieval con entramado de madera) — solo en riqueza noble/modesta con más
// de una planta, es lo que distingue una casa_noble de una choza a simple vista.
function cuerpo(b, anchoVox, largoVox, alturaPlanta, nPlantas, colorMuro, opciones = {}) {
  const pisos = [];
  let y = 0;
  const x0 = PAD, x1 = PAD + anchoVox - 1, z0 = PAD, z1 = PAD + largoVox - 1;
  const familiaBase = familiaTextura(opciones.material);
  for (let p = 0; p < nPlantas; p++) {
    const voladizo = opciones.jetty && p > 0 ? opciones.jetty : 0;
    const px0 = x0 - voladizo, px1 = x1 + voladizo, pz0 = z0 - voladizo, pz1 = z1 + voladizo;
    const esPlantaAltaEspecial = p > 0 && opciones.colorPlantaAlta;
    const tono = esPlantaAltaEspecial ? opciones.colorPlantaAlta : colorMuro;
    // zócalo de piedra en la base (planta baja): las casas medievales asientan sobre un basamento más oscuro
    if (p === 0) {
      const zocalo = Math.min(2, alturaPlanta - 1);
      b.caja(px0, y, pz0, px1, y + zocalo - 1, pz1, sombrear(colorMuro, 0.72));
      b.caja(px0, y + zocalo, pz0, px1, y + alturaPlanta - 1, pz1, tono);
    } else {
      b.caja(px0, y, pz0, px1, y + alturaPlanta - 1, pz1, tono);
    }
    if (voladizo > 0) b.caja(px0, y, pz0, px1, y, pz1, MADERA_OSCURA); // viga de apoyo del voladizo, línea oscura visible
    const piso = { y0: y, y1: y + alturaPlanta - 1, x0: px0, x1: px1, z0: pz0, z1: pz1 };
    const familia = esPlantaAltaEspecial && opciones.tudor ? "tudor" : familiaBase;
    if (familia === "madera") for (const cara of CARAS) vetasMadera(b, piso, cara, tono);
    else if (familia === "piedra") for (const cara of CARAS) sillarPiedra(b, piso, cara, tono);
    else if (familia === "tudor") entramadoTudor(b, piso, MADERA_OSCURA);
    pisos.push(piso);
    y += alturaPlanta;
  }
  return { pisos, yTecho: y, x0, x1, z0, z1 };
}

function nVentanas(largoVox, riqueza) {
  const casillas = Math.max(1, Math.round(largoVox / U));
  const base = { humilde: 0, modesta: 1, noble: 2 }[riqueza] ?? 1;
  if (base === 0) return casillas >= 6 ? 1 : 0;
  return Math.max(base, Math.round(casillas / 3));
}

// Ventanas: marco + cristal "pintados" 1 vóxel por fuera de la fachada — el
// edificio es macizo por dentro (es una masa exterior, no interior real),
// así que no hace falta agujerear el muro: basta con la superficie.
function ventanasEnFachada(b, { cara, piso, n, esFrenteConPuerta }) {
  if (n <= 0) return;
  const vw = Math.max(2, Math.round(U * 0.55));
  const vh = Math.max(2, Math.round(U * 0.85));
  const altoPiso = piso.y1 - piso.y0;
  const vy = piso.y0 + Math.max(1, Math.round((altoPiso - vh) / 2));
  const vertical = cara === "S" || cara === "N";
  const desde = vertical ? piso.x0 : piso.z0;
  const hasta = vertical ? piso.x1 : piso.z1;
  const fijo = cara === "S" ? piso.z0 - 1 : cara === "N" ? piso.z1 + 1 : cara === "O" ? piso.x0 - 1 : piso.x1 + 1;
  const largo = hasta - desde + 1;
  const margen = Math.max(vw, Math.round(largo * 0.14));
  const centroFachada = desde + largo / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const centro = Math.round(desde + margen + (largo - 2 * margen) * t);
    if (esFrenteConPuerta && Math.abs(centro - centroFachada) < vw * 1.5) continue; // no pisar el hueco de la puerta
    const a = centro - Math.floor(vw / 2), c = a + vw - 1;
    if (vertical) {
      b.caja(a - 1, vy - 1, fijo, c + 1, vy + vh, fijo, MADERA_OSCURA);
      b.caja(a, vy, fijo, c, vy + vh - 1, fijo, CRISTAL);
    } else {
      b.caja(fijo, vy - 1, a - 1, fijo, vy + vh, c + 1, MADERA_OSCURA);
      b.caja(fijo, vy, a, fijo, vy + vh - 1, c, CRISTAL);
    }
  }
}

function puertaEnFachada(b, piso, opciones = {}) {
  const pw = Math.max(3, Math.round(U * (opciones.ancho || 0.8)));
  const ph = Math.min(piso.y1 - piso.y0, Math.round(U * (opciones.alto || 1.8)));
  const cx = Math.round((piso.x0 + piso.x1) / 2);
  const a = cx - Math.floor(pw / 2), c = a + pw - 1;
  const z = piso.z0 - 1;
  b.caja(a - 1, piso.y0, z - 1, c + 1, piso.y0 + ph, z - 1, MADERA_OSCURA); // marco
  b.caja(a, piso.y0, z, c, piso.y0 + ph - 1, z, MADERA_CLARA); // hoja
}

// --- tejados ----------------------------------------------------------------

// Tejado a dos aguas por ESCALONES DE TAMAÑO FIJO (no por altura total repartida
// en N pasos): cada escalón encoge un nº constante de vóxeles en horizontal y
// sube en proporción a la pendiente. Así la altura del tejado sale SIEMPRE
// proporcional al ancho real del edificio — con una altura fija (como se hizo
// al principio) un edificio ancho comprime la misma altura en muchos más
// pasos y el tejado sale a rayas finas en vez de una pendiente limpia.
function techoDosAguas(b, x0, x1, z0, z1, yBase, color, ejeX, opciones = {}) {
  const pendiente = opciones.pendiente ?? 0.55;
  // escalón GRANDE a propósito: con pasos finos (2-3 vox) el borde de cada
  // caja se ve a esta resolución como raya de pana en vez de peldaño — mejor
  // pocos escalones anchos que se lean como tejado a dos aguas de verdad.
  const escalon = opciones.escalon ?? Math.max(3, Math.round(U * 0.8));
  const alero = Math.max(1, Math.round(U * 0.18));
  const mitad = (ejeX ? (z1 - z0 + 1) : (x1 - x0 + 1)) / 2;
  let y = yBase, encog = 0, paso = 0;
  while (encog < mitad) {
    const encogSig = Math.min(mitad, encog + escalon);
    const altoEscalon = Math.max(1, Math.round((encogSig - encog) * pendiente));
    const tono = paso === 0 ? color : sombrear(color, 1 - paso * 0.02);
    if (ejeX) {
      const zz0 = z0 - alero + Math.round(encog), zz1 = z1 + alero - Math.round(encog);
      if (zz1 >= zz0) b.caja(x0 - alero, y, zz0, x1 + alero, y + altoEscalon - 1, zz1, tono);
    } else {
      const xx0 = x0 - alero + Math.round(encog), xx1 = x1 + alero - Math.round(encog);
      if (xx1 >= xx0) b.caja(xx0, y, z0 - alero, xx1, y + altoEscalon - 1, z1 + alero, tono);
    }
    y += altoEscalon; encog = encogSig; paso++;
  }
  const cx = Math.round((x0 + x1) / 2), cz = Math.round((z0 + z1) / 2);
  if (ejeX) b.caja(x0, y - 1, cz - 1, x1, y - 1, cz, sombrear(color, 1.2));
  else b.caja(cx - 1, y - 1, z0, cx, y - 1, z1, sombrear(color, 1.2));
  return y;
}

// Mismo criterio de escalón fijo que techoDosAguas, pero encoge en los dos ejes
// a la vez (planta cuadrada/rectangular convergiendo a cumbrera o punta).
function techoPiramidal(b, x0, x1, z0, z1, yBase, color, opciones = {}) {
  const pendiente = opciones.pendiente ?? 0.6;
  const escalon = opciones.escalon ?? Math.max(3, Math.round(U * 0.8));
  const mitadX = (x1 - x0 + 1) / 2, mitadZ = (z1 - z0 + 1) / 2;
  const mitad = Math.min(mitadX, mitadZ);
  let y = yBase, encog = 0, paso = 0;
  while (encog < mitad) {
    const encogSig = Math.min(mitad, encog + escalon);
    const altoEscalon = Math.max(1, Math.round((encogSig - encog) * pendiente));
    const e = Math.round(encog);
    const xx0 = x0 + Math.min(e, Math.round(mitadX) - 1), xx1 = x1 - Math.min(e, Math.round(mitadX) - 1);
    const zz0 = z0 + Math.min(e, Math.round(mitadZ) - 1), zz1 = z1 - Math.min(e, Math.round(mitadZ) - 1);
    if (xx1 >= xx0 && zz1 >= zz0) b.caja(xx0, y, zz0, xx1, y + altoEscalon - 1, zz1, paso === 0 ? color : sombrear(color, 1 - paso * 0.015));
    y += altoEscalon; encog = encogSig; paso++;
  }
  return y;
}

function techoAlmenado(b, x0, x1, z0, z1, y, colorMuro) {
  b.caja(x0, y, z0, x1, y, z1, sombrear(colorMuro, 0.85)); // azotea
  const paso = Math.max(2, Math.round(U * 0.5));
  const altoMerlon = Math.max(1, Math.round(U * 0.35));
  const tono = sombrear(colorMuro, 0.9);
  for (let xx = x0; xx <= x1; xx += paso * 2) { const c = Math.min(xx + paso - 1, x1); b.caja(xx, y + 1, z0, c, y + altoMerlon, z0, tono); b.caja(xx, y + 1, z1, c, y + altoMerlon, z1, tono); }
  for (let zz = z0; zz <= z1; zz += paso * 2) { const c = Math.min(zz + paso - 1, z1); b.caja(x0, y + 1, zz, x0, y + altoMerlon, c, tono); b.caja(x1, y + 1, zz, x1, y + altoMerlon, c, tono); }
  return y + altoMerlon + 1;
}

function torreEsquina(b, cx, cz, radio, yBase, altura, colorMuro, colorTejado) {
  b.caja(cx - radio, yBase, cz - radio, cx + radio - 1, yBase + altura - 1, cz + radio - 1, colorMuro);
  techoAlmenado(b, cx - radio, cx + radio - 1, cz - radio, cz + radio - 1, yBase + altura, colorMuro);
  techoPiramidal(b, cx - radio + 1, cx + radio - 2, cz - radio + 1, cz + radio - 2, yBase + altura + Math.round(U * 0.35), colorTejado, { pendiente: 1.1, escalon: 2 });
}

function chimenea(b, x, z, yBase, altura, colorMuro, brasas) {
  const r = Math.max(1, Math.round(U * 0.12));
  b.caja(x - r, yBase, z - r, x + r, yBase + altura - 1, z + r, sombrear(colorMuro, 0.7));
  if (brasas) b.caja(x - r, yBase + altura, z - r, x + r, yBase + altura, z + r, FUEGO);
}

function porticoColumnas(b, x0, x1, z, yBase, altura, n, color) {
  const paso = (x1 - x0) / (n + 1);
  for (let i = 1; i <= n; i++) {
    const cx = Math.round(x0 + paso * i);
    b.caja(cx - 1, yBase, z - 2, cx, yBase + altura - 1, z - 2, sombrear(color, 0.8));
  }
  b.caja(x0 - 1, yBase + altura, z - 3, x1 + 1, yBase + altura + Math.round(U * 0.15), z - 1, sombrear(color, 1.1)); // arquitrabe/frontón
}

// --- arquetipos --------------------------------------------------------------
// Cada uno recibe {ancho,largo,plantasAltas,colorMuro,riqueza,rnd,tema} en
// casillas y devuelve {grid,paleta,cajas}. El rnd solo varía detalle
// (chimenea sí/no, nº exacto de plantas dentro del rango) — la silueta base
// la decide el arquetipo, igual que en generar_naturaleza.js.

function alturaPlantaVox() { return Math.round(U * 2.7); }

function edificioChoza(ctx) {
  const { ancho, largo, colorMuro, riqueza, material } = ctx;
  const b = Builder();
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), 1, colorMuro, { material });
  puertaEnFachada(b, pisos[0]);
  const nv = nVentanas(pisos[0].x1 - pisos[0].x0 + 1, riqueza);
  ventanasEnFachada(b, { cara: "S", piso: pisos[0], n: Math.min(1, nv), esFrenteConPuerta: true });
  ventanasEnFachada(b, { cara: "N", piso: pisos[0], n: nv });
  const nvLateral = nVentanas(pisos[0].z1 - pisos[0].z0 + 1, riqueza);
  ventanasEnFachada(b, { cara: "E", piso: pisos[0], n: Math.min(1, nvLateral) });
  ventanasEnFachada(b, { cara: "O", piso: pisos[0], n: Math.min(1, nvLateral) });
  const ejeX = ancho >= largo;
  const techoY = techoDosAguas(b, pisos[0].x0, pisos[0].x1, pisos[0].z0, pisos[0].z1, yTecho, ROOF_POR_RIQUEZA[riqueza] || PAJA, ejeX);
  chimenea(b, pisos[0].x0 + Math.round(U * 0.7), pisos[0].z1 - Math.round(U * 0.7), yTecho - Math.round(U * 0.4), Math.round(U * 0.9), colorMuro, false);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioCasa(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, rnd, material } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const conVoladizo = riqueza !== "humilde" && plantasAltas > 0;
  const opciones = conVoladizo
    ? { material, jetty: Math.round(U * 0.16), colorPlantaAlta: riqueza === "noble" ? (materiales.estuco?.colorDebug || "#e8ddc8") : colorMuro, tudor: riqueza === "noble" }
    : { material };
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, opciones);
  puertaEnFachada(b, pisos[0], { ancho: riqueza === "noble" ? 1.0 : 0.85, alto: 1.9 });
  for (const [i, piso] of pisos.entries()) {
    const nv = nVentanas(piso.x1 - piso.x0 + 1, riqueza);
    ventanasEnFachada(b, { cara: "S", piso, n: i === 0 ? Math.min(2, nv) : nv, esFrenteConPuerta: i === 0 });
    ventanasEnFachada(b, { cara: "N", piso, n: nv });
    if (largo >= 6) { ventanasEnFachada(b, { cara: "E", piso, n: Math.max(0, nv - 1) }); ventanasEnFachada(b, { cara: "O", piso, n: Math.max(0, nv - 1) }); }
  }
  const ultimo = pisos[pisos.length - 1];
  const ejeX = ancho >= largo;
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, ROOF_POR_RIQUEZA[riqueza] || TEJA, ejeX, { pendiente: riqueza === "noble" ? 0.7 : 0.55 });
  if (rnd() < 0.7) chimenea(b, ultimo.x1 - Math.round(U * 0.7), ultimo.z1 - Math.round(U * 0.7), yTecho - Math.round(U * 0.4), Math.round(U * 1.0), colorMuro, false);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioTaller(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, rnd, tema, material } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, { material });
  // escaparate: puerta ancha en vez de puerta estrecha — el comercio se anuncia con el hueco, cartel_tienda ya lo cuelga ciudades/
  puertaEnFachada(b, pisos[0], { ancho: 1.3, alto: 1.9 });
  ventanasEnFachada(b, { cara: "S", piso: pisos[0], n: nVentanas(pisos[0].x1 - pisos[0].x0 + 1, "noble"), esFrenteConPuerta: true });
  for (const [i, piso] of pisos.entries()) {
    if (i > 0) ventanasEnFachada(b, { cara: "S", piso, n: nVentanas(piso.x1 - piso.x0 + 1, riqueza) });
    ventanasEnFachada(b, { cara: "N", piso, n: nVentanas(piso.x1 - piso.x0 + 1, riqueza) });
    ventanasEnFachada(b, { cara: "E", piso, n: Math.max(1, nVentanas(piso.z1 - piso.z0 + 1, riqueza)) });
    ventanasEnFachada(b, { cara: "O", piso, n: Math.max(1, nVentanas(piso.z1 - piso.z0 + 1, riqueza)) });
  }
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, ROOF_POR_RIQUEZA[riqueza] || TEJA, ancho >= largo, { pendiente: 0.45 });
  // fragua/horno del oficio: chimenea con brasas — herrería, panadería, destilería, alfarería, molino
  const conFuego = ["herreria", "panaderia", "destileria", "alfareria"].includes(tema);
  if (conFuego || rnd() < 0.5) chimenea(b, ultimo.x0 + Math.round(U * 0.8), ultimo.z1 - Math.round(U * 0.8), yTecho - Math.round(U * 0.3), Math.round(U * 1.1), colorMuro, conFuego);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioPosada(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, rnd, material } = ctx;
  const b = Builder();
  const nPlantas = 1 + Math.max(1, plantasAltas);
  const opciones = { material, jetty: Math.round(U * 0.14) };
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, opciones);
  puertaEnFachada(b, pisos[0], { ancho: 1.1, alto: 2.0 });
  for (const [i, piso] of pisos.entries()) {
    // muchas ventanas pequeñas en las plantas altas — habitaciones de huéspedes, una tras otra
    const nv = i === 0 ? nVentanas(piso.x1 - piso.x0 + 1, "modesta") : Math.max(3, Math.round((piso.x1 - piso.x0) / U / 1.5));
    const nvLateral = i === 0 ? nVentanas(piso.z1 - piso.z0 + 1, "modesta") : Math.max(1, Math.round((piso.z1 - piso.z0) / U / 1.5));
    ventanasEnFachada(b, { cara: "S", piso, n: nv, esFrenteConPuerta: i === 0 });
    ventanasEnFachada(b, { cara: "N", piso, n: nv });
    ventanasEnFachada(b, { cara: "E", piso, n: nvLateral });
    ventanasEnFachada(b, { cara: "O", piso, n: nvLateral });
  }
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, ROOF_POR_RIQUEZA[riqueza] || TEJA, ancho >= largo, { pendiente: 0.6 });
  chimenea(b, ultimo.x0 + Math.round(U * 0.8), ultimo.z0 + Math.round(U * 0.8), yTecho - Math.round(U * 0.4), Math.round(U * 1.1), colorMuro, rnd() < 0.6);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioInstitucion(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, material } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, { material });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 1.4, alto: 2.1 });
  for (const piso of pisos) ventanasEnFachada(b, { cara: "S", piso, n: nVentanas(piso.x1 - piso.x0 + 1, "noble"), esFrenteConPuerta: piso === planta0 });
  for (const piso of pisos) { ventanasEnFachada(b, { cara: "N", piso, n: nVentanas(piso.x1 - piso.x0 + 1, "noble") }); ventanasEnFachada(b, { cara: "E", piso, n: nVentanas(piso.z1 - piso.z0 + 1, "modesta") }); ventanasEnFachada(b, { cara: "O", piso, n: nVentanas(piso.z1 - piso.z0 + 1, "modesta") }); }
  // pórtico monumental de columnas ante la puerta — lo que distingue un ayuntamiento/templo/museo de una casa grande
  const nCols = Math.max(2, Math.floor((planta0.x1 - planta0.x0) / (U * 1.6)));
  porticoColumnas(b, planta0.x0 + Math.round(U * 0.4), planta0.x1 - Math.round(U * 0.4), planta0.z0, planta0.y0, planta0.y1 - planta0.y0 + 1, nCols, materiales.marmol?.colorDebug || "#e8e4dc");
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoPiramidal(b, ultimo.x0 - Math.round(U * 0.3), ultimo.x1 + Math.round(U * 0.3), ultimo.z0 - Math.round(U * 0.3), ultimo.z1 + Math.round(U * 0.3), yTecho, ROOF_POR_RIQUEZA.noble, { pendiente: 0.5 });
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioTemplo(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, material } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, Math.round(alturaPlantaVox() * 1.15), nPlantas, colorMuro, { material });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 1.3, alto: 2.3 });
  // vidrieras: ventanas altas y estrechas en vez de las cuadradas normales, en las 4 caras
  for (const piso of pisos) {
    ventanasEnFachada(b, { cara: "E", piso, n: Math.max(2, Math.round((piso.z1 - piso.z0) / U / 2)) });
    ventanasEnFachada(b, { cara: "O", piso, n: Math.max(2, Math.round((piso.z1 - piso.z0) / U / 2)) });
    ventanasEnFachada(b, { cara: "S", piso, n: 1, esFrenteConPuerta: piso === planta0 });
    ventanasEnFachada(b, { cara: "N", piso, n: Math.max(1, Math.round((piso.x1 - piso.x0) / U / 3)) });
  }
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, PIZARRA, ancho >= largo, { pendiente: 0.75 });
  // aguja/campanario centrado sobre la cumbrera
  const cx = Math.round((ultimo.x0 + ultimo.x1) / 2), cz = Math.round((ultimo.z0 + ultimo.z1) / 2);
  const agujaY = techoPiramidal(b, cx - Math.round(U * 0.6), cx + Math.round(U * 0.6) - 1, cz - Math.round(U * 0.6), cz + Math.round(U * 0.6) - 1, techoY, PIZARRA, { pendiente: 1.4, escalon: 2 });
  return { grid: [ancho * U + PAD * 2, agujaY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioMilitar(ctx) {
  const { ancho, largo, plantasAltas, colorMuro } = ctx;
  const b = Builder();
  // militar siempre en piedra de verdad, sea cual sea el materialesPreferidos del catálogo — un cuartel de madera no lee como fortificación
  const colorPiedra = sombrear(materiales.piedra.colorDebug, 0.95);
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorPiedra, { material: "piedra" });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 1.2, alto: 2.0 });
  // aspilleras: ventanas escasas y estrechas en las 4 caras, nada de lujo
  for (const piso of pisos) {
    ventanasEnFachada(b, { cara: "S", piso, n: 2, esFrenteConPuerta: piso === planta0 });
    ventanasEnFachada(b, { cara: "N", piso, n: 2 });
    ventanasEnFachada(b, { cara: "E", piso, n: 1 });
    ventanasEnFachada(b, { cara: "O", piso, n: 1 });
  }
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoAlmenado(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, ultimo.y1 + 1, colorPiedra);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioTorre(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, tema, material } = ctx;
  const b = Builder();
  const nPlantas = 2 + plantasAltas; // las torres siempre altas aunque el catálogo pida pocas plantas
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, Math.round(alturaPlantaVox() * 0.85), nPlantas, colorMuro, { material });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 0.9, alto: 1.9 });
  // ventanas en espiral: una por planta, girando de cara — sugiere la escalera de caracol interior
  const ORDEN_ESPIRAL = ["S", "E", "N", "O"];
  pisos.forEach((piso, i) => { if (i === 0) return; ventanasEnFachada(b, { cara: ORDEN_ESPIRAL[i % 4], piso, n: 1 }); });
  const ultimo = pisos[pisos.length - 1];
  const colorTejado = tema === "faro" ? "#c9453a" : PIZARRA;
  const techoY = techoPiramidal(b, ultimo.x0 - Math.round(U * 0.25), ultimo.x1 + Math.round(U * 0.25), ultimo.z0 - Math.round(U * 0.25), ultimo.z1 + Math.round(U * 0.25), yTecho, colorTejado, { pendiente: 1.3, escalon: 2 });
  if (tema === "faro") b.caja(Math.round((ultimo.x0 + ultimo.x1) / 2) - 1, techoY, Math.round((ultimo.z0 + ultimo.z1) / 2) - 1, Math.round((ultimo.x0 + ultimo.x1) / 2), techoY + 2, Math.round((ultimo.z0 + ultimo.z1) / 2), FUEGO); // linterna del faro
  return { grid: [ancho * U + PAD * 2, techoY + 4, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioGranero(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, material } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, Math.round(alturaPlantaVox() * 1.1), nPlantas, colorMuro, { material });
  const planta0 = pisos[0];
  // portalón doble ancho — carros entran a descargar, no una puerta de casa
  puertaEnFachada(b, planta0, { ancho: 1.8, alto: 2.0 });
  const nv = nVentanas(planta0.x1 - planta0.x0 + 1, riqueza === "humilde" ? "humilde" : "modesta");
  if (pisos.length > 1) ventanasEnFachada(b, { cara: "S", piso: pisos[1], n: nv });
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, ROOF_POR_RIQUEZA[riqueza] || PAJA, ancho >= largo, { pendiente: 0.4 });
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioCastillo(ctx) {
  const { ancho, largo, colorMuro } = ctx;
  const b = Builder();
  const colorPiedra = sombrear(colorMuro, 0.95);
  const alturaCuerpo = Math.round(alturaPlantaVox() * 2.4);
  const x0 = PAD, x1 = PAD + ancho * U - 1, z0 = PAD, z1 = PAD + largo * U - 1;
  b.caja(x0, 0, z0, x1, alturaCuerpo - 1, z1, colorPiedra);
  const planta0 = { x0, x1, y0: 0, y1: alturaCuerpo - 1, z0, z1 };
  for (const cara of CARAS) sillarPiedra(b, planta0, cara, colorPiedra); // las 4 caras del lienzo, no solo la de la puerta
  puertaEnFachada(b, planta0, { ancho: 1.6, alto: 2.6 });
  ventanasEnFachada(b, { cara: "S", piso: planta0, n: 2, esFrenteConPuerta: true });
  ventanasEnFachada(b, { cara: "N", piso: planta0, n: 3 });
  ventanasEnFachada(b, { cara: "E", piso: planta0, n: 2 });
  ventanasEnFachada(b, { cara: "O", piso: planta0, n: 2 });
  techoAlmenado(b, x0, x1, z0, z1, alturaCuerpo, colorPiedra);
  // torre en cada esquina — lo que hace inconfundible un castillo entre los edificios de la ciudad
  const radioTorre = Math.round(U * 0.9);
  const alturaTorre = Math.round(alturaCuerpo * 1.35);
  torreEsquina(b, x0 + radioTorre, z0 + radioTorre, radioTorre, 0, alturaTorre, colorPiedra, PIZARRA);
  torreEsquina(b, x1 - radioTorre, z0 + radioTorre, radioTorre, 0, alturaTorre, colorPiedra, PIZARRA);
  torreEsquina(b, x0 + radioTorre, z1 - radioTorre, radioTorre, 0, alturaTorre, colorPiedra, PIZARRA);
  torreEsquina(b, x1 - radioTorre, z1 - radioTorre, radioTorre, 0, alturaTorre, colorPiedra, PIZARRA);
  const techoY = alturaTorre + Math.round(U * 1.8);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

const ARQUETIPO_FN = {
  CHOZA: edificioChoza,
  CASA: edificioCasa,
  TALLER: edificioTaller,
  POSADA: edificioPosada,
  INSTITUCION: edificioInstitucion,
  TEMPLO: edificioTemplo,
  MILITAR: edificioMilitar,
  TORRE: edificioTorre,
  GRANERO: edificioGranero,
  CASTILLO: edificioCastillo,
};

// --- clasificación: tipoEdificio -> arquetipo -------------------------------

const POR_ARQUETIPO = {
  CASTILLO: ["castillo"],
  TORRE: ["torre_militar", "torre_mago", "faro"],
  MILITAR: ["cuartel_guardia", "arena_combate"],
  INSTITUCION: ["ayuntamiento", "casa_gremio", "casa_de_cambio", "biblioteca_publica", "museo", "banos_publicos", "escuela", "teatro", "academia_magia"],
  TEMPLO: ["templo", "mausoleo"],
  POSADA: ["taberna", "posada"],
  TALLER: ["tienda", "herreria", "panaderia", "botica", "taller_sastre", "joyeria", "carpinteria", "curtiduria", "alfareria", "destileria", "molino", "aserradero", "lonja_pescado"],
  GRANERO: ["granero", "establo"],
  CHOZA: ["casa_humilde", "choza_pescador", "choza_curandero", "ruina", "campamento_hostil", "carromato_mercader", "barco_encallado"],
  CASA: ["casa_modesta", "casa_noble", "mansion"],
};
const ARQUETIPO_DE = {};
for (const [arq, ids] of Object.entries(POR_ARQUETIPO)) for (const id of ids) ARQUETIPO_DE[id] = arq;

function clasificarEdificio(tipoId, info) {
  if (ARQUETIPO_DE[tipoId]) return ARQUETIPO_DE[tipoId];
  // fallback por riqueza/plantas para cualquier tipoEdificio futuro no listado — nunca se deja un edificio sin forma
  if (info.riqueza === "noble" && info.rangoPlantasAltas[1] >= 2) return "INSTITUCION";
  return "CASA";
}

// --- generación --------------------------------------------------------------

function generarEdificio(tipoId, nn = 1) {
  const info = tiposEdificio[tipoId];
  if (!info) throw new Error(`tipoEdificio desconocido: ${tipoId}`);
  const huella = huellas.porTipo[tipoId] || huellas.porRiqueza[info.riqueza];
  const [ancho, largo] = huella;
  const rnd = crearPRNG(`${tipoId}|${nn}`);
  const [pMin, pMax] = info.rangoPlantasAltas;
  const plantasAltas = pMin + Math.floor(rnd() * (pMax - pMin + 1));
  const material = (info.materialesPreferidos || ["madera"])[0];
  const colorMuro = materiales[material]?.colorDebug || materiales.madera.colorDebug;
  const arquetipo = clasificarEdificio(tipoId, info);
  const modelo = ARQUETIPO_FN[arquetipo]({ ancho, largo, plantasAltas, colorMuro, material, riqueza: info.riqueza, rnd, tema: tipoId });
  return { nombre: `${tipoId.replace(/_/g, " ")} (var ${String(nn).padStart(2, "0")})`, arquetipo, tipoId, huella, resolucion: U, ...modelo };
}

// Subconjunto de PRUEBA: un tipo representativo por arquetipo (10) — valida
// la silueta antes de la pasada completa (los ~41 tipos, "todo").
const TIPOS_PRUEBA = ["casa_humilde", "casa_noble", "herreria", "taberna", "ayuntamiento", "templo", "cuartel_guardia", "torre_mago", "granero", "castillo"];

function generarTodo(soloPrueba) {
  const resultado = {};
  const conteo = {};
  const tipos = soloPrueba ? TIPOS_PRUEBA : Object.keys(tiposEdificio).filter((id) => !id.startsWith("_"));
  for (const tipoId of tipos) {
    const nVariantes = soloPrueba ? 1 : 2; // 2 variantes por tipo: la semilla mueve nº de plantas/chimenea, no la silueta
    for (let n = 1; n <= nVariantes; n++) {
      const modelo = generarEdificio(tipoId, n);
      conteo[modelo.arquetipo] = (conteo[modelo.arquetipo] || 0) + 1;
      resultado[`${tipoId}_${String(n).padStart(2, "0")}`] = modelo;
    }
  }
  return { resultado, conteo };
}

if (require.main === module) {
  const todo = process.argv.includes("todo");
  const { resultado, conteo } = generarTodo(!todo);
  fs.writeFileSync(path.join(__dirname, "edificios_generados.json"), JSON.stringify(resultado));
  console.log(`Generados: ${Object.keys(resultado).length} modelos (${todo ? "catálogo completo" : "subconjunto de prueba: 10 arquetipos"})`);
  console.log("Por arquetipo:", conteo);
}

module.exports = { generarTodo, generarEdificio, ARQUETIPO_FN, clasificarEdificio, TIPOS_PRUEBA, POR_ARQUETIPO, U };
