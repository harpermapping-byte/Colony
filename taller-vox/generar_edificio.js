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
// teja/pizarra: antes una constante fija cada una — toda una calle de casas
// modestas salía con el MISMO tejado exacto. Ahora varios tonos naturales
// (barro cocido más rojizo/más pardo, pizarra más azulada/más verdosa) y
// `elegirTecho` sortea uno por semilla — sigue sin haber campo "tejado" en
// materiales.json, constantes locales (mismo criterio que VERDE_FOLLAJE en
// generar_naturaleza).
const TEJAS = ["#7a4228", "#8a4a2a", "#6a3a20", "#8f5535"];
const PIZARRAS = ["#454f5c", "#3c4550", "#4f5a5f", "#3a424a"];
const TEJA = TEJAS[0]; // valor por defecto para quien no pase rnd (compatibilidad)
const PIZARRA = PIZARRAS[0];
const FUEGO = "#ff9a3a"; // brasas — mismo tono que antorcha_poste (coherencia visual con el canal de iluminación)
const ROOF_POR_RIQUEZA = { humilde: PAJA, modesta: TEJAS, noble: PIZARRAS };
// el material de MURO también puede decidir el tejado (adobe -> barro, no
// paja ni pizarra) — si el material no pinta nada especial, manda la riqueza.
const TEJADO_POR_MATERIAL = { adobe: "#b5723a" };
// `rnd` opcional: con él, teja/pizarra sale en uno de varios tonos por
// semilla en vez de siempre el mismo color plano; sin rnd (llamadas viejas
// que no lo pasan) cae al primer tono, mismo aspecto que antes.
function elegirTecho(material, riqueza, rnd) {
  if (TEJADO_POR_MATERIAL[material]) return TEJADO_POR_MATERIAL[material];
  const opciones = ROOF_POR_RIQUEZA[riqueza] || TEJAS;
  if (!Array.isArray(opciones)) return opciones; // PAJA es un único color, no hay variedad real de tono de paja
  return rnd ? opciones[Math.floor(rnd() * opciones.length)] : opciones[0];
}

// Variedad de material por variante: no siempre el materialesPreferidos[0]
// del catálogo — unas veces sale en el material "canónico" (peso doble) y
// otras en cualquiera de sus alternativas (casa_humilde en madera casi
// siempre, pero a veces en piedra pobre; sigue siendo el mismo tipoEdificio,
// solo cambia el aspecto — así ninguna calle se ve con 20 casas idénticas).
function elegirMaterial(rnd, materialesPreferidos) {
  // filtra a materiales que sirven de MURO EXTERIOR de verdad: tela_tapiz,
  // cristal, seda, lino, lana... son materialesPreferidos válidos para el
  // interior (tapices, cortinas) pero un muro no puede ser de tapiz —
  // familiaTextura() ya sabe distinguir "esto se puede levantar" de "esto es
  // decoración interior", así que reusarla aquí evita el catálogo nuevo.
  const candidatos = (materialesPreferidos || []).filter((m) => familiaTextura(m));
  const lista = candidatos.length ? candidatos : ["madera"];
  if (lista.length === 1) return lista[0];
  if (rnd() < 0.5) return lista[0];
  const resto = lista.slice(1);
  return resto[Math.min(resto.length - 1, Math.floor(rnd() * resto.length))];
}

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

// `rustico` (riqueza humilde): tablones más juntos y más oscuros — una choza
// pobre enseña MÁS madera vista que una casa modesta, no la misma textura
// más pequeña.
function vetasMadera(b, piso, cara, colorBase, rustico) {
  const oscuro = sombrear(colorBase, rustico ? 0.72 : 0.8);
  const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
  const paso = Math.max(2, Math.round(U * (rustico ? 0.3 : 0.42)));
  for (let p = desde + paso; p < hasta; p += paso) {
    if (vertical) b.caja(p, piso.y0, fijo, p, piso.y1, fijo, oscuro);
    else b.caja(fijo, piso.y0, p, fijo, piso.y1, p, oscuro);
  }
}

// "madera laminada": tablazón HORIZONTAL a media madera (como el revestimiento
// de listones apilados) en vez de tablones verticales — variante alterna de
// la textura de madera, elegida por semilla (opciones.estiloMadera en cuerpo()).
function tablonesHorizontales(b, piso, cara, colorBase, rustico) {
  const oscuro = sombrear(colorBase, rustico ? 0.78 : 0.85);
  const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
  const paso = Math.max(2, Math.round(U * (rustico ? 0.22 : 0.3)));
  for (let y = piso.y0 + paso; y < piso.y1; y += paso) {
    if (vertical) b.caja(desde, y, fijo, hasta, y, fijo, oscuro);
    else b.caja(fijo, y, desde, fijo, y, hasta, oscuro);
  }
}

function sillarPiedra(b, piso, cara, colorBase) {
  const oscuro = sombrear(colorBase, 0.78);
  const claro = sombrear(colorBase, 1.16);
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
  // esquinas reforzadas (sillares angulares/quoins): bloques alternos MÁS
  // marcados en los dos bordes de la fachada — sin esto un muro de piedra
  // grande lee plano y monótono; el quoin es lo que rompe esa planitud en
  // la piedra medieval de verdad, no solo la junta fina de antes.
  if (piso.rnd) {
    const altoBloque = Math.max(2, Math.round(U * 0.55));
    let i = 0;
    for (let y = piso.y0; y < piso.y1; y += altoBloque, i++) {
      const tono = i % 2 === 0 ? claro : oscuro;
      const y1 = Math.min(piso.y1, y + altoBloque - 1);
      if (vertical) { b.caja(desde, y, fijo, desde + 1, y1, fijo, tono); b.caja(hasta - 1, y, fijo, hasta, y1, fijo, tono); }
      else { b.caja(fijo, y, desde, fijo, y1, desde + 1, tono); b.caja(fijo, y, hasta - 1, fijo, y1, hasta, tono); }
    }
    // parches de humedad/musgo cerca de la base: un par por fachada, da vida a la piedra vieja
    const musgo = sombrear(colorBase, 0.55);
    const nParches = 1 + Math.floor(piso.rnd() * 2);
    for (let k = 0; k < nParches; k++) {
      const p0 = Math.round(desde + (hasta - desde) * piso.rnd());
      const tam = Math.max(2, Math.round(U * 0.3));
      if (vertical) b.caja(p0, piso.y0, fijo, Math.min(hasta, p0 + tam), Math.min(piso.y1, piso.y0 + tam), fijo, musgo);
      else b.caja(fijo, piso.y0, p0, fijo, Math.min(piso.y1, piso.y0 + tam), Math.min(hasta, p0 + tam), musgo);
    }
  }
}

function entramadoTudor(b, piso, colorViga) {
  for (const cara of CARAS) {
    const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
    if (vertical) { b.caja(desde, piso.y0, fijo, hasta, piso.y0, fijo, colorViga); b.caja(desde, piso.y1, fijo, hasta, piso.y1, fijo, colorViga); }
    else { b.caja(fijo, piso.y0, desde, fijo, piso.y0, hasta, colorViga); b.caja(fijo, piso.y1, desde, fijo, piso.y1, hasta, colorViga); }
    vetasMaderaConColor(b, piso, cara, colorViga);
    riostrasDiagonales(b, piso, cara, colorViga);
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

// Riostras diagonales en las dos esquinas del paño — SIN esto entramadoTudor
// solo dibujaba una rejilla ortogonal (raíles + montantes rectos), que en
// las referencias del streamer se lee como "ventana con cuadrícula", no
// como entramado de madera real. Una casa Tudor de verdad lleva contraviento
// en diagonal en las esquinas de cada paño — esa diagonal (aproximada por
// escalón de 1 vóxel, mismo criterio de "pocos escalones anchos" que ya usa
// el tejado) es la pieza que de verdad distingue el estilo.
function riostrasDiagonales(b, piso, cara, colorViga) {
  const { vertical, desde, hasta, fijo } = limitesCara(piso, cara);
  const alturaPaño = piso.y1 - piso.y0;
  const tramo = Math.min(Math.round(alturaPaño * 0.75), Math.round((hasta - desde) * 0.22));
  if (tramo < 3) return; // paño demasiado estrecho/bajo para que la diagonal se lea
  const dibujar = (p0, signo) => {
    for (let i = 0; i <= tramo; i++) {
      const p = p0 + signo * i;
      const y = piso.y0 + Math.round((i / tramo) * tramo);
      if (vertical) b.caja(p, y, fijo, p, y, fijo, colorViga);
      else b.caja(fijo, y, p, fijo, y, p, colorViga);
    }
  };
  dibujar(desde, 1); // esquina "desde": sube hacia dentro
  dibujar(hasta, -1); // esquina "hasta": sube hacia dentro (simétrica)
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

// Ménsulas/corbeles bajo el voladizo — sin esto la única señal de "aquí
// vuela la planta" era una simple línea oscura recta; un jetty medieval de
// verdad cuelga sobre ménsulas visibles a intervalos, no sobre una tabla
// lisa. `x0,x1,z0,z1` son los límites de la planta de ABAJO (sin ajuste
// todavía) — el corbel sube en diagonal corta desde ese borde hasta el
// borde real del voladizo (a `ajuste` vóxeles hacia fuera).
function corbelesVoladizo(b, x0, x1, z0, z1, ajuste, y, colorViga) {
  const paso = Math.max(3, Math.round(U * 0.8));
  const tramo = Math.min(ajuste, 2); // el ajuste típico es 1-2 vóxeles: no hay más "diagonal" que dar
  for (let x = x0 + paso; x < x1; x += paso) {
    for (let i = 1; i <= tramo; i++) {
      b.caja(x, y - i + 1, z0 - i, x, y, z0 - i, colorViga);
      b.caja(x, y - i + 1, z1 + i, x, y, z1 + i, colorViga);
    }
  }
  for (let z = z0 + paso; z < z1; z += paso) {
    for (let i = 1; i <= tramo; i++) {
      b.caja(x0 - i, y - i + 1, z, x0 - i, y, z, colorViga);
      b.caja(x1 + i, y - i + 1, z, x1 + i, y, z, colorViga);
    }
  }
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
  const rustico = opciones.riqueza === "humilde";
  for (let p = 0; p < nPlantas; p++) {
    // voladizo (jetty, sobresale) y retranqueo (encoge, planta de ático) son
    // dos formas de planta alta distintas — nunca a la vez, y ambas solo en
    // el piso que le toque (jetty desde la 1ª alta, retranqueo solo la
    // última: "casas con distintas formas y pisos en una misma casa").
    const esUltima = p === nPlantas - 1;
    let ajuste = 0;
    // Escalonado (pedido 2026-08-30: "que no sea todo cubos rectos") — el
    // retranqueo deja de ser solo de la ÚLTIMA planta (ático) y se acumula
    // planta a planta: cada piso por encima de la baja encoge un poco más
    // que el anterior, silueta de pagoda/ziggurat en vez de un prisma recto.
    // Reusa el MISMO campo `retranqueo` (ajuste en vóxeles) que ya existía,
    // solo cambia cómo se acumula — jetty/retranqueo plano siguen igual.
    if (opciones.jetty && p > 0) ajuste = opciones.jetty;
    else if (opciones.escalonado && p > 0) ajuste = -opciones.retranqueo * p;
    else if (opciones.retranqueo && p > 0 && esUltima) ajuste = -opciones.retranqueo;
    const px0 = x0 - ajuste, px1 = x1 + ajuste, pz0 = z0 - ajuste, pz1 = z1 + ajuste;
    const esPlantaAltaEspecial = p > 0 && opciones.colorPlantaAlta;
    // Textura/tono por piso (pedido 2026-08-30: "más textura por pisos") —
    // variación sutil de tono planta a planta (cada una un pelín más clara
    // que la de abajo), aparte del zócalo oscuro de la base que ya existía;
    // se nota como "capas" reales del edificio, no un único bloque de color.
    const tonoBase = esPlantaAltaEspecial ? opciones.colorPlantaAlta : colorMuro;
    const tono = p > 0 ? sombrear(tonoBase, 1 + Math.min(p, 3) * 0.035) : tonoBase;
    // zócalo de piedra en la base (planta baja): las casas medievales asientan sobre un basamento más oscuro
    if (p === 0) {
      const zocalo = Math.min(2, alturaPlanta - 1);
      b.caja(px0, y, pz0, px1, y + zocalo - 1, pz1, sombrear(colorMuro, 0.72));
      b.caja(px0, y + zocalo, pz0, px1, y + alturaPlanta - 1, pz1, tono);
    } else {
      b.caja(px0, y, pz0, px1, y + alturaPlanta - 1, pz1, tono);
    }
    if (ajuste > 0) {
      b.caja(px0, y, pz0, px1, y, pz1, MADERA_OSCURA); // viga de apoyo del voladizo, línea oscura visible
      corbelesVoladizo(b, x0, x1, z0, z1, ajuste, y, MADERA_OSCURA);
    }
    const piso = { y0: y, y1: y + alturaPlanta - 1, x0: px0, x1: px1, z0: pz0, z1: pz1, estiloVentana: opciones.estiloVentana, rnd: opciones.rnd };
    // Entramado Tudor: antes SOLO en la planta con voladizo de una casa
    // noble (opciones.colorPlantaAlta) — se veía en casi ninguna casa de
    // madera. Ahora, en cualquier planta ALTA (p>0) de un edificio de
    // madera cuya riqueza lo pida (opciones.tudor, decidido por el
    // arquetipo — ver edificioCasa), tenga o no voladizo: una casa modesta
    // de madera con planta alta plana también enseña su entramado, no solo
    // las nobles con jetty.
    const esPisoTudor = p > 0 && opciones.tudor && familiaBase === "madera";
    const familia = esPisoTudor ? "tudor" : familiaBase;
    if (familia === "madera") {
      const dibujar = opciones.estiloMadera === "horizontal" ? tablonesHorizontales : vetasMadera;
      for (const cara of CARAS) dibujar(b, piso, cara, tono, rustico);
    } else if (familia === "piedra") for (const cara of CARAS) sillarPiedra(b, piso, cara, tono);
    else if (familia === "tudor") entramadoTudor(b, piso, MADERA_OSCURA);
    pisos.push(piso);
    y += alturaPlanta;
  }
  return { pisos, yTecho: y, x0, x1, z0, z1 };
}

function nVentanasBase(largoVox, riqueza) {
  const casillas = Math.max(1, Math.round(largoVox / U));
  const base = { humilde: 0, modesta: 1, noble: 2 }[riqueza] ?? 1;
  if (base === 0) return casillas >= 6 ? 1 : 0;
  // /5 en vez de /3 (bajado 2026-08-28 al comparar con las referencias del
  // streamer): con el entramado Tudor ahora mucho más presente, una
  // fachada ancha con ventana cada 3 casillas se veía "pared de cristal" —
  // el timbre visual de una casa Tudor real es la madera vista, no un
  // muro casi todo hueco.
  return Math.max(base, Math.round(casillas / 5));
}

// Fachadas "casi ciegas" en algunas variantes y otras con ventana por todas
// partes: generarEdificio crea un cierre sobre esta base con un factor de
// densidad por semilla y lo mete en ctx como `nVentanas` — cada arquetipo ya
// desestructura `nVentanas` de ctx, así que sus llamadas nVentanas(...) usan
// esta versión sin tener que tocar ninguna.
function crearNVentanas(densidad) {
  return (largoVox, riqueza) => {
    const base = nVentanasBase(largoVox, riqueza);
    if (base === 0) return 0;
    return Math.max(1, Math.round(base * densidad));
  };
}

// Dimensiones (fracción de casilla) propias de cada estilo — una buhardilla
// es minúscula, una bífora/ancha necesita más hueco que una redonda.
const DIM_VENTANA = {
  rect: [0.68, 0.98], cruz: [0.68, 0.98], arco: [0.68, 0.98], diamante: [0.68, 0.98],
  persianas: [0.6, 0.98], bifora: [1.0, 1.0], redonda: [0.72, 0.72], buhardilla: [0.35, 0.4],
  con_alfeizar: [0.68, 0.98], ancha: [1.05, 0.85],
};

// Ventanas: marco + cristal "pintados" 1 vóxel por fuera de la fachada — el
// edificio es macizo por dentro (es una masa exterior, no interior real),
// así que no hace falta agujerear el muro: basta con la superficie. Cada
// edificio tiene un estilo PRIMARIO y uno SECUNDARIO (piso.estiloVentana /
// piso.estiloVentanaAlt, elegidos por semilla en generarEdificio) — la
// mayoría de ventanas usan el primario pero unas cuantas (piso.rnd) salen
// con el secundario: dentro de la MISMA casa no todas las ventanas son
// iguales, sin caer en un mosaico de 10 estilos a la vez. piso.rnd también
// da la desalineación: ni a la misma altura ni perfectamente repartidas —
// una construcción medieval real no es tan regular.
// Devuelve los rangos horizontales ocupados (`puestas`, [a,c] con marco
// incluido) — quien llama los guarda por (planta,cara) para que OTRO
// elemento de fachada distinto (un balcón, ver edificioCasa) pueda
// comprobar contra ellos antes de colocarse encima; antes cada elemento se
// colocaba a ciegas de los demás (bug real reportado: balcón sobre ventana).
function ventanasEnFachada(b, { cara, piso, n, esFrenteConPuerta, probJardinera = 0 }) {
  if (n <= 0) return [];
  const principal = piso.estiloVentana || "rect";
  const alterno = piso.estiloVentanaAlt || principal;
  const altoPiso = piso.y1 - piso.y0;
  const vertical = cara === "S" || cara === "N";
  const desde = vertical ? piso.x0 : piso.z0;
  const hasta = vertical ? piso.x1 : piso.z1;
  const fijo = cara === "S" ? piso.z0 - 1 : cara === "N" ? piso.z1 + 1 : cara === "O" ? piso.x0 - 1 : piso.x1 + 1;
  const largo = hasta - desde + 1;
  const [fw0, fh0] = DIM_VENTANA[principal] || DIM_VENTANA.rect;
  const margen = Math.max(Math.round(U * fw0), Math.round(largo * 0.14));
  const centroFachada = desde + largo / 2;
  const rnd = piso.rnd;
  // huecos ya pintados en ESTA fachada (rango horizontal con su marco): el
  // jitter de posición podía montar dos marcos uno encima de otro en
  // fachadas densas — un hueco que pisa otro se descarta, no se desplaza
  // (desplazarlo re-encadenaría solapes)
  const puestas = [];
  for (let i = 0; i < n; i++) {
    const estilo = rnd && alterno !== principal && rnd() < 0.3 ? alterno : principal;
    const [fw, fh] = DIM_VENTANA[estilo] || DIM_VENTANA.rect;
    const vw = Math.max(2, Math.round(U * fw));
    const vh = Math.max(2, Math.round(U * fh));
    const jitterVMax = Math.max(0, Math.floor((altoPiso - vh) / 2) - 1);
    const vyBase = piso.y0 + Math.max(1, Math.round((altoPiso - vh) / 2));
    const t = (i + 1) / (n + 1);
    let centro = Math.round(desde + margen + (largo - 2 * margen) * t);
    if (rnd) centro += Math.round((rnd() - 0.5) * margen * 0.7); // desalineación horizontal
    let vy = vyBase;
    if (rnd && jitterVMax > 0) vy += Math.round((rnd() - 0.5) * 2 * jitterVMax); // desalineación vertical
    if (esFrenteConPuerta && Math.abs(centro - centroFachada) < vw * 1.5) continue; // no pisar el hueco de la puerta
    const a = centro - Math.floor(vw / 2), c = a + vw - 1;
    if (!rangoLibre(puestas, a, c)) continue; // pisaría otro hueco (marco incluido)
    puestas.push([a, c]);
    dibujarVentana(b, vertical, a, c, fijo, vy, vh, estilo);
    if (rnd && rnd() < probJardinera) jardineraBajoVentana(b, vertical, a, c, fijo, vy);
  }
  return puestas;
}

// ¿el rango [a,c] pisaría alguno de los `puestas` ya ocupados en esa
// planta+cara (por cualquier elemento, ventana u otro)? Mismo margen de 1
// vóxel que ya usaba ventanasEnFachada consigo misma.
function rangoLibre(puestas, a, c) {
  return !puestas.some(([pa, pc]) => a - 1 <= pc + 1 && c + 1 >= pa - 1);
}

function dibujarVentana(b, vertical, a, c, fijo, vy, vh, estilo) {
  const marco = (x0, y0, z0, x1, y1, z1) => b.caja(x0, y0, z0, x1, y1, z1, MADERA_OSCURA);
  const vidrio = (x0, y0, z0, x1, y1, z1) => b.caja(x0, y0, z0, x1, y1, z1, CRISTAL);
  const persiana = (x0, y0, z0, x1, y1, z1) => b.caja(x0, y0, z0, x1, y1, z1, MADERA_CLARA);
  if (vertical) {
    marco(a - 1, vy - 1, fijo, c + 1, vy + vh, fijo);
    vidrio(a, vy, fijo, c, vy + vh - 1, fijo);
    const midX = Math.round((a + c) / 2), midY = vy + Math.round(vh / 2);
    if (estilo === "cruz") {
      marco(midX, vy, fijo, midX, vy + vh - 1, fijo);
      marco(a, midY, fijo, c, midY, fijo);
    } else if (estilo === "arco") {
      const p1 = Math.max(1, Math.round((c - a) * 0.2));
      marco(a + p1, vy + vh, fijo, c - p1, vy + vh, fijo);
      if (c - 2 * p1 >= a + 2 * p1) marco(a + 2 * p1, vy + vh + 1, fijo, c - 2 * p1, vy + vh + 1, fijo);
    } else if (estilo === "diamante" || estilo === "redonda") {
      const cut = Math.max(1, Math.round((c - a) * (estilo === "redonda" ? 0.24 : 0.22)));
      marco(a, vy, fijo, a + cut - 1, vy + cut - 1, fijo); marco(c - cut + 1, vy, fijo, c, vy + cut - 1, fijo);
      marco(a, vy + vh - cut, fijo, a + cut - 1, vy + vh - 1, fijo); marco(c - cut + 1, vy + vh - cut, fijo, c, vy + vh - 1, fijo);
      if (estilo === "diamante") { marco(midX, midY, fijo, midX, midY, fijo); }
    } else if (estilo === "persianas") {
      const pw = Math.max(1, Math.round((c - a) * 0.45));
      persiana(a - pw - 1, vy - 1, fijo, a - 2, vy + vh, fijo);
      persiana(c + 2, vy - 1, fijo, c + pw + 1, vy + vh, fijo);
    } else if (estilo === "bifora") {
      vidrio(midX - 1, vy, fijo, midX - 1, vy + vh - 1, fijo);
      marco(midX, vy, fijo, midX, vy + vh - 1, fijo);
    } else if (estilo === "buhardilla") {
      marco(midX, vy - 1, fijo, midX, vy - 1, fijo);
    } else if (estilo === "con_alfeizar") {
      marco(a - 2, vy - 2, fijo, c + 2, vy - 1, fijo);
    } else if (estilo === "ancha") {
      const t1 = a + Math.round((c - a) / 3), t2 = a + Math.round((c - a) * 2 / 3);
      marco(t1, vy, fijo, t1, vy + vh - 1, fijo); marco(t2, vy, fijo, t2, vy + vh - 1, fijo);
    }
  } else {
    marco(fijo, vy - 1, a - 1, fijo, vy + vh, c + 1);
    vidrio(fijo, vy, a, fijo, vy + vh - 1, c);
    const midZ = Math.round((a + c) / 2), midY = vy + Math.round(vh / 2);
    if (estilo === "cruz") {
      marco(fijo, vy, midZ, fijo, vy + vh - 1, midZ);
      marco(fijo, midY, a, fijo, midY, c);
    } else if (estilo === "arco") {
      const p1 = Math.max(1, Math.round((c - a) * 0.2));
      marco(fijo, vy + vh, a + p1, fijo, vy + vh, c - p1);
      if (c - 2 * p1 >= a + 2 * p1) marco(fijo, vy + vh + 1, a + 2 * p1, fijo, vy + vh + 1, c - 2 * p1);
    } else if (estilo === "diamante" || estilo === "redonda") {
      const cut = Math.max(1, Math.round((c - a) * (estilo === "redonda" ? 0.24 : 0.22)));
      marco(fijo, vy, a, fijo, vy + cut - 1, a + cut - 1); marco(fijo, vy, c - cut + 1, fijo, vy + cut - 1, c);
      marco(fijo, vy + vh - cut, a, fijo, vy + vh - 1, a + cut - 1); marco(fijo, vy + vh - cut, c - cut + 1, fijo, vy + vh - 1, c);
      if (estilo === "diamante") { marco(fijo, midY, midZ, fijo, midY, midZ); }
    } else if (estilo === "persianas") {
      const pw = Math.max(1, Math.round((c - a) * 0.45));
      persiana(fijo, vy - 1, a - pw - 1, fijo, vy + vh, a - 2);
      persiana(fijo, vy - 1, c + 2, fijo, vy + vh, c + pw + 1);
    } else if (estilo === "bifora") {
      vidrio(fijo, vy, midZ - 1, fijo, vy + vh - 1, midZ - 1);
      marco(fijo, vy, midZ, fijo, vy + vh - 1, midZ);
    } else if (estilo === "buhardilla") {
      marco(fijo, vy - 1, midZ, fijo, vy - 1, midZ);
    } else if (estilo === "con_alfeizar") {
      marco(fijo, vy - 2, a - 2, fijo, vy - 1, c + 2);
    } else if (estilo === "ancha") {
      const t1 = a + Math.round((c - a) / 3), t2 = a + Math.round((c - a) * 2 / 3);
      marco(fijo, vy, t1, fijo, vy + vh - 1, t1); marco(fijo, vy, t2, fijo, vy + vh - 1, t2);
    }
  }
}

// Jardinera de flores bajo el alféizar — el toque "casita de cuento" de las
// referencias del streamer, ausente del todo hasta ahora. Caja de madera +
// una fila de motas de color asomando; pegada 1 vóxel por fuera de la
// fachada, igual que el resto de detalles pintados (el edificio es macizo).
const JARDINERA_MADERA = "#6a4a2a";
const FLORES = ["#c9453a", "#e0c060", "#c98aa0", "#e8ddc8"]; // rojo/amarillo/rosa/blanco — variedad simple, no un catálogo nuevo
function jardineraBajoVentana(b, vertical, a, c, fijo, vy) {
  const caja = (x0, y0, z0, x1, y1, z1, hex) => b.caja(x0, y0, z0, x1, y1, z1, hex);
  const y0 = vy - 2, y1 = vy - 1;
  const colorFlor = FLORES[(a + c) % FLORES.length]; // determinista por posición, sin pedir rnd aparte
  if (vertical) {
    caja(a, y0, fijo, c, y0, fijo, JARDINERA_MADERA);
    for (let x = a; x <= c; x += 2) caja(x, y1, fijo, x, y1, fijo, colorFlor);
  } else {
    caja(fijo, y0, a, fijo, y0, c, JARDINERA_MADERA);
    for (let z = a; z <= c; z += 2) caja(fijo, y1, z, fijo, y1, z, colorFlor);
  }
}

// Tonos de puerta (pedido 2026-08-30: "color de puerta independiente del
// muro") — antes SIEMPRE MADERA_CLARA sobre marco MADERA_OSCURA, ahora un
// tono real por semilla si se pasa `opciones.rnd` (compatibilidad: sin rnd,
// aspecto EXACTO de siempre). El marco se queda siempre oscuro (contorno
// que se lee bien contra cualquier muro), solo la HOJA varía.
const TONOS_PUERTA = ["#6a4a26", "#4a3018", "#7a5230", "#3a2814", "#8a5a30", "#5a3d20"];
function puertaEnFachada(b, piso, opciones = {}) {
  const pw = Math.max(3, Math.round(U * (opciones.ancho || 0.8)));
  const ph = Math.min(piso.y1 - piso.y0, Math.round(U * (opciones.alto || 1.8)));
  const cx = Math.round((piso.x0 + piso.x1) / 2);
  const a = cx - Math.floor(pw / 2), c = a + pw - 1;
  const z = piso.z0 - 1;
  const colorHoja = opciones.rnd ? TONOS_PUERTA[Math.floor(opciones.rnd() * TONOS_PUERTA.length)] : MADERA_CLARA;
  b.caja(a - 1, piso.y0, z - 1, c + 1, piso.y0 + ph, z - 1, MADERA_OSCURA); // marco
  b.caja(a, piso.y0, z, c, piso.y0 + ph - 1, z, colorHoja); // hoja
}

// Balcón volado en una planta alta: suelo + barandal de balaustres — casas
// ricas con voladizo (0, 1 o varios por semilla, ver edificioCasa). `centro`
// en la coordenada VARIABLE de la fachada (x si S/N, z si E/O).
function balconEnFachada(b, piso, cara, centro, anchoBalcon, colorMadera) {
  const profundidad = Math.max(2, Math.round(U * 0.4));
  const alturaBarandal = Math.max(2, Math.round(U * 0.45));
  const vertical = cara === "S" || cara === "N";
  const fijoMuro = cara === "S" ? piso.z0 : cara === "N" ? piso.z1 : cara === "O" ? piso.x0 : piso.x1;
  const signo = cara === "S" || cara === "O" ? -1 : 1;
  const fijoBorde = fijoMuro + signo * profundidad;
  const a = centro - Math.floor(anchoBalcon / 2), c = a + anchoBalcon - 1;
  const y = piso.y0;
  const tonoSuelo = sombrear(colorMadera, 0.85);
  if (vertical) {
    b.caja(a - 1, y, Math.min(fijoMuro, fijoBorde), c + 1, y, Math.max(fijoMuro, fijoBorde), tonoSuelo);
    for (let x = a - 1; x <= c + 1; x += 2) b.caja(x, y + 1, fijoBorde, x, y + alturaBarandal, fijoBorde, MADERA_OSCURA);
    b.caja(a - 1, y + alturaBarandal, fijoBorde, c + 1, y + alturaBarandal, fijoBorde, MADERA_OSCURA);
  } else {
    b.caja(Math.min(fijoMuro, fijoBorde), y, a - 1, Math.max(fijoMuro, fijoBorde), y, c + 1, tonoSuelo);
    for (let z = a - 1; z <= c + 1; z += 2) b.caja(fijoBorde, y + 1, z, fijoBorde, y + alturaBarandal, z, MADERA_OSCURA);
    b.caja(fijoBorde, y + alturaBarandal, a - 1, fijoBorde, y + alturaBarandal, c + 1, MADERA_OSCURA);
  }
}

// Porche a la entrada: 2 postes + tejadillo a dos aguas propio, siempre en la
// fachada SUR (donde va la puerta) — casas y posadas ricas.
function porcheEnPuerta(b, piso, colorMadera, colorTejado) {
  const cx = Math.round((piso.x0 + piso.x1) / 2);
  const anchoPorche = Math.max(4, Math.round(U * 1.3));
  const profundidad = Math.max(2, Math.round(U * 0.9));
  const alturaPorche = Math.round(U * 2.0);
  const z1 = piso.z0 - 2, z0 = z1 - profundidad;
  const a = cx - Math.floor(anchoPorche / 2), c = a + anchoPorche - 1;
  b.caja(a, piso.y0, z0, a + 1, piso.y0 + alturaPorche - 1, z0 + 1, colorMadera);
  b.caja(c - 1, piso.y0, z0, c, piso.y0 + alturaPorche - 1, z0 + 1, colorMadera);
  techoDosAguas(b, a, c, z0, z1, piso.y0 + alturaPorche, colorTejado, true, { pendiente: 0.5, escalon: 2 });
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

// Cúpula/tejado abovedado (pedido 2026-08-30: "formas de tejado diferentes,
// no solo dos aguas/piramidal") — mismo enfoque por filas que techoPiramidal
// pero con perfil de CUARTO DE CÍRCULO (sqrt) en vez de lineal: encoge poco
// arriba y mucho cerca de la base, la silueta redondeada de una cúpula real
// en vez de un cono recto. Pensada para INSTITUCION (rotonda/sala noble).
function techoAbovedado(b, x0, x1, z0, z1, yBase, color, opciones = {}) {
  const mitadX = (x1 - x0 + 1) / 2, mitadZ = (z1 - z0 + 1) / 2;
  const mitad = Math.min(mitadX, mitadZ);
  const altura = opciones.altura ?? Math.round(mitad * 1.1);
  const escalon = Math.max(1, Math.round(U * 0.22));
  let y = yBase, paso = 0;
  for (let h = 0; h < altura; h += escalon) {
    const hSig = Math.min(altura, h + escalon);
    // perfil de cuarto de círculo: radio(h) = mitad * sqrt(1 - (h/altura)^2)
    const radio = mitad * Math.sqrt(Math.max(0, 1 - (h / altura) * (h / altura)));
    const e = Math.round(mitad - radio);
    const xx0 = x0 + Math.min(e, Math.round(mitadX) - 1), xx1 = x1 - Math.min(e, Math.round(mitadX) - 1);
    const zz0 = z0 + Math.min(e, Math.round(mitadZ) - 1), zz1 = z1 - Math.min(e, Math.round(mitadZ) - 1);
    const altoFila = Math.max(1, Math.round(hSig - h));
    if (xx1 >= xx0 && zz1 >= zz0) b.caja(xx0, y, zz0, xx1, y + altoFila - 1, zz1, paso === 0 ? color : sombrear(color, 1 - paso * 0.02));
    y += altoFila; paso++;
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

// Decoración temática de fachada (pedido 2026-08-30: "decoración temática de
// fachada" — blasón/gárgolas/banderín, un detalle pequeño que identifica el
// arquetipo a simple vista, no solo su silueta general).

// Blasón/escudo sobre la puerta — INSTITUCION: un cartel de piedra tallada
// con un color de acento (oro/azul/rojo heráldico) centrado en la fachada.
const COLORES_BLASON = ["#c9a227", "#2a4d8f", "#8f2a2a", "#2a6b4a"];
function blasonFachada(b, planta0, rnd) {
  const cx = Math.round((planta0.x0 + planta0.x1) / 2);
  const y = planta0.y0 + Math.round((planta0.y1 - planta0.y0) * 0.75);
  const z = planta0.z0 - 1;
  const colorAcento = COLORES_BLASON[Math.floor(rnd() * COLORES_BLASON.length)];
  b.caja(cx - 1, y, z - 1, cx + 1, y + 2, z - 1, sombrear(materiales.marmol?.colorDebug || "#e8e4dc", 0.9)); // placa de piedra
  b.caja(cx, y, z - 1, cx, y + 1, z - 1, colorAcento); // emblema
}

// Gárgolas en las esquinas de la cornisa — TEMPLO: pequeños salientes de
// piedra oscura, silueta reconocible de iglesia/catedral sin tocar el tejado.
function gargolasEnCornisa(b, ultimo, y) {
  const colorPiedra = sombrear(materiales.piedra?.colorDebug || "#8a8a86", 0.6);
  const r = Math.max(1, Math.round(U * 0.1));
  for (const [x, z] of [[ultimo.x0, ultimo.z0], [ultimo.x1, ultimo.z0], [ultimo.x0, ultimo.z1], [ultimo.x1, ultimo.z1]]) {
    b.caja(x - r, y, z - r, x + r, y, z + r, colorPiedra);
  }
}

// Banderín ondeando sobre la entrada — POSADA: un mástil corto con tela de
// color vivo, anuncia la taberna desde la calle igual que cartel_tienda en ciudades/.
const COLORES_BANDERIN = ["#a83232", "#3255a8", "#3a8f3a", "#c98a1e"];
function banderinEnFachada(b, planta0, rnd) {
  const cx = Math.round((planta0.x0 + planta0.x1) / 2) + Math.round(U * 0.6);
  const y = planta0.y0 + Math.round((planta0.y1 - planta0.y0) * 0.85);
  const z = planta0.z0 - 1;
  const colorTela = COLORES_BANDERIN[Math.floor(rnd() * COLORES_BANDERIN.length)];
  b.caja(cx, y, z - 1, cx, y + Math.round(U * 0.5), z - 1, MADERA_OSCURA); // mástil
  b.caja(cx, y + Math.round(U * 0.35), z - 2, cx + Math.round(U * 0.25), y + Math.round(U * 0.5), z - 1, colorTela); // tela
}

// --- arquetipos --------------------------------------------------------------
// Cada uno recibe {ancho,largo,plantasAltas,colorMuro,riqueza,rnd,tema} en
// casillas y devuelve {grid,paleta,cajas}. El rnd solo varía detalle
// (chimenea sí/no, nº exacto de plantas dentro del rango) — la silueta base
// la decide el arquetipo, igual que en generar_naturaleza.js.

function alturaPlantaVox() { return Math.round(U * 2.7); }

function edificioChoza(ctx) {
  const { ancho, largo, colorMuro, riqueza, material, estiloMadera, estiloVentana, estiloVentanaAlt, rnd, nVentanas } = ctx;
  const b = Builder();
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), 1, colorMuro, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd });
  puertaEnFachada(b, pisos[0], { rnd });
  const nv = nVentanas(pisos[0].x1 - pisos[0].x0 + 1, riqueza);
  ventanasEnFachada(b, { cara: "S", piso: pisos[0], n: Math.min(1, nv), esFrenteConPuerta: true });
  ventanasEnFachada(b, { cara: "N", piso: pisos[0], n: nv });
  const nvLateral = nVentanas(pisos[0].z1 - pisos[0].z0 + 1, riqueza);
  ventanasEnFachada(b, { cara: "E", piso: pisos[0], n: Math.min(1, nvLateral) });
  ventanasEnFachada(b, { cara: "O", piso: pisos[0], n: Math.min(1, nvLateral) });
  const ejeX = ancho >= largo;
  const techoY = techoDosAguas(b, pisos[0].x0, pisos[0].x1, pisos[0].z0, pisos[0].z1, yTecho, elegirTecho(material, riqueza, rnd), ejeX);
  chimenea(b, pisos[0].x0 + Math.round(U * 0.7), pisos[0].z1 - Math.round(U * 0.7), yTecho - Math.round(U * 0.4), Math.round(U * 0.9), colorMuro, false);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioCasa(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, rnd, material, estiloMadera, estiloVentana, estiloVentanaAlt, nVentanas, nivel } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const rica = riqueza !== "humilde";
  // `nivel` (1/2/3, opcional — GDD_Motor_3D_Props.md "sistema de mejora"):
  // sin nivel explícito el comportamiento es EXACTAMENTE el de siempre
  // (decoMult=1). Con nivel, escala cuánta decoración sale (porche/balcón/
  // chimenea/jardinera) — el RIESGO (qué es posible: tudor, balcón...) lo
  // sigue decidiendo la riqueza del tipoEdificio, nivel solo mueve la
  // densidad; así una "casa_humilde" en nivel 3 se ve más cuidada sin dejar
  // de ser una choza (nunca saca lo que la riqueza no permite).
  const decoMult = nivel === 1 ? 0.5 : nivel === 3 ? 1.7 : 1;
  const prob = (p) => Math.min(1, p * decoMult);
  // Entramado Tudor: cualquier planta ALTA de una casa de madera no humilde
  // lo enseña (antes solo la noble con voladizo) — es lo que de verdad
  // acerca el aspecto a las referencias del streamer, no un detalle
  // exclusivo de la variante más rica.
  const base = { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd, tudor: rica && familiaTextura(material) === "madera" };
  // 3 formas de planta alta bien distintas por semilla — "casas con
  // diferentes formas y pisos en una misma casa" en vez de repetir siempre
  // el mismo voladizo: jetty (vuela hacia fuera, entramado Tudor a la vista),
  // retranqueo (encoge, planta de ático) o plana (sin gracia, la humilde
  // nunca saca ninguna de las dos — una choza no tiene ático con clase).
  // "escalonado" (pedido 2026-08-30, silueta de pagoda) solo con 2+ plantas
  // altas — con una sola no se distingue de un retranqueo normal.
  const puedeEscalonar = plantasAltas >= 2;
  const estiloPlanta = rica && plantasAltas > 0
    ? (rnd() < 0.4 ? "jetty" : rnd() < 0.55 ? "retranqueo" : puedeEscalonar && rnd() < 0.6 ? "escalonado" : "plano")
    : "plano";
  const opciones = { ...base };
  if (estiloPlanta === "jetty") {
    opciones.jetty = Math.round(U * 0.16);
    opciones.colorPlantaAlta = riqueza === "noble" ? (materiales.estuco?.colorDebug || "#e8ddc8") : colorMuro;
  } else if (estiloPlanta === "retranqueo") {
    opciones.retranqueo = Math.round(U * 0.5);
  } else if (estiloPlanta === "escalonado") {
    opciones.escalonado = true;
    opciones.retranqueo = Math.round(U * 0.28); // acumulativo por planta — más suave que el retranqueo plano de un solo golpe
  }
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, opciones);
  // porche a la entrada: solo en ricas, no siempre — deja huecas sin él para que se note la diferencia
  const conPorche = rica && rnd() < prob(0.4);
  if (conPorche) porcheEnPuerta(b, pisos[0], materiales.madera.colorDebug, elegirTecho(material, riqueza, rnd));
  puertaEnFachada(b, pisos[0], { ancho: riqueza === "noble" ? 1.0 : 0.85, alto: 1.9, rnd });
  // jardineras solo en fachadas con encanto (modesta/noble), más presentes cuanto más nivel
  const probJardinera = rica ? prob(riqueza === "noble" ? 0.22 : 0.12) : 0;
  // rangos ocupados por ventana en CADA (planta,cara) — los balcones de abajo
  // consultan esto antes de colocarse, ya no a ciegas (bug real arreglado).
  const ventanasPorPisoCara = new Map();
  for (const [i, piso] of pisos.entries()) {
    const nv = nVentanas(piso.x1 - piso.x0 + 1, riqueza);
    ventanasPorPisoCara.set(`${i}_S`, ventanasEnFachada(b, { cara: "S", piso, n: i === 0 ? Math.min(2, nv) : nv, esFrenteConPuerta: i === 0, probJardinera }));
    ventanasPorPisoCara.set(`${i}_N`, ventanasEnFachada(b, { cara: "N", piso, n: nv, probJardinera }));
    if (largo >= 6) {
      ventanasPorPisoCara.set(`${i}_E`, ventanasEnFachada(b, { cara: "E", piso, n: Math.max(0, nv - 1), probJardinera }));
      ventanasPorPisoCara.set(`${i}_O`, ventanasEnFachada(b, { cara: "O", piso, n: Math.max(0, nv - 1), probJardinera }));
    }
  }
  // balcones: 0, 1 o varios por semilla, SOLO en plantas altas de casas ricas
  // — "casa con balcón, sin balcón, con más de uno" pedido explícitamente.
  // Cada intento comprueba contra las ventanas YA pintadas en esa misma
  // (planta,cara) y, si pisaría alguna, prueba otra combinación en vez de
  // dibujar encima (hasta 6 intentos; si ninguno cabe, ese balcón se pierde
  // en vez de solaparse — mismo criterio de "descartar, no reubicar a la
  // fuerza" que ya usa ventanasEnFachada consigo misma).
  if (rica && pisos.length > 1) {
    const rBalcon = rnd();
    const nBalcones = rBalcon < 1 - prob(0.65) ? 0 : rBalcon < 1 - prob(0.25) ? 1 : 2;
    const caras = ["S", "N", "E", "O"];
    const anchoBalcon = Math.max(3, Math.round(U * 0.7));
    for (let k = 0; k < nBalcones; k++) {
      let colocado = false;
      for (let intento = 0; intento < 6 && !colocado; intento++) {
        const idxPiso = 1 + Math.floor(rnd() * (pisos.length - 1));
        const piso = pisos[idxPiso];
        const cara = caras[Math.floor(rnd() * caras.length)];
        const vertical = cara === "S" || cara === "N";
        const desde = vertical ? piso.x0 : piso.z0, hasta = vertical ? piso.x1 : piso.z1;
        const centro = Math.round(desde + (hasta - desde) * (0.3 + rnd() * 0.4));
        const a = centro - Math.floor(anchoBalcon / 2), c = a + anchoBalcon - 1;
        const ocupadas = ventanasPorPisoCara.get(`${idxPiso}_${cara}`) || [];
        if (!rangoLibre(ocupadas, a, c)) continue;
        balconEnFachada(b, piso, cara, centro, anchoBalcon, materiales.madera.colorDebug);
        ocupadas.push([a, c]); // un segundo balcón en la misma (planta,cara) tampoco debe pisar a este
        colocado = true;
      }
    }
  }
  const ultimo = pisos[pisos.length - 1];
  const ejeX = ancho >= largo;
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, elegirTecho(material, riqueza, rnd), ejeX, { pendiente: riqueza === "noble" ? 0.7 : 0.55 });
  // chimenea: casi segura en ricas (a veces 2, casas grandes con más de un
  // hogar), moderada en modestas — "chimeneas en casas ricas" pedido explícito.
  const pChimenea = riqueza === "noble" ? 0.92 : riqueza === "modesta" ? 0.6 : 0.3;
  if (rnd() < prob(pChimenea)) chimenea(b, ultimo.x1 - Math.round(U * 0.7), ultimo.z1 - Math.round(U * 0.7), yTecho - Math.round(U * 0.4), Math.round(U * 1.0), colorMuro, false);
  if (riqueza === "noble" && rnd() < prob(0.4)) chimenea(b, ultimo.x0 + Math.round(U * 0.7), ultimo.z0 + Math.round(U * 0.7), yTecho - Math.round(U * 0.4), Math.round(U * 0.9), colorMuro, false);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioTaller(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, rnd, tema, material, estiloMadera, estiloVentana, estiloVentanaAlt, nVentanas } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd });
  // escaparate: puerta ancha en vez de puerta estrecha — el comercio se anuncia con el hueco, cartel_tienda ya lo cuelga ciudades/
  puertaEnFachada(b, pisos[0], { ancho: 1.3, alto: 1.9, rnd });
  ventanasEnFachada(b, { cara: "S", piso: pisos[0], n: nVentanas(pisos[0].x1 - pisos[0].x0 + 1, "noble"), esFrenteConPuerta: true });
  for (const [i, piso] of pisos.entries()) {
    if (i > 0) ventanasEnFachada(b, { cara: "S", piso, n: nVentanas(piso.x1 - piso.x0 + 1, riqueza) });
    ventanasEnFachada(b, { cara: "N", piso, n: nVentanas(piso.x1 - piso.x0 + 1, riqueza) });
    ventanasEnFachada(b, { cara: "E", piso, n: Math.max(1, nVentanas(piso.z1 - piso.z0 + 1, riqueza)) });
    ventanasEnFachada(b, { cara: "O", piso, n: Math.max(1, nVentanas(piso.z1 - piso.z0 + 1, riqueza)) });
  }
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, elegirTecho(material, riqueza, rnd), ancho >= largo, { pendiente: 0.45 });
  // fragua/horno del oficio: chimenea con brasas — herrería, panadería, destilería, alfarería, molino
  const conFuego = ["herreria", "panaderia", "destileria", "alfareria"].includes(tema);
  if (conFuego || rnd() < 0.5) chimenea(b, ultimo.x0 + Math.round(U * 0.8), ultimo.z1 - Math.round(U * 0.8), yTecho - Math.round(U * 0.3), Math.round(U * 1.1), colorMuro, conFuego);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioPosada(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, rnd, material, estiloMadera, estiloVentana, estiloVentanaAlt, nVentanas } = ctx;
  const b = Builder();
  const nPlantas = 1 + Math.max(1, plantasAltas);
  // posadas/tabernas siempre con voladizo Y entramado a la vista, sea cual
  // sea su riqueza — es la silueta que las hace reconocibles entre las
  // casas de la calle, no un lujo exclusivo de las nobles.
  const opciones = { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd, jetty: Math.round(U * 0.14), tudor: familiaTextura(material) === "madera" };
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, opciones);
  puertaEnFachada(b, pisos[0], { ancho: 1.1, alto: 2.0, rnd });
  let ocupadasS1 = [];
  for (const [i, piso] of pisos.entries()) {
    // muchas ventanas pequeñas en las plantas altas — habitaciones de huéspedes, una tras otra
    const nv = i === 0 ? nVentanas(piso.x1 - piso.x0 + 1, "modesta") : Math.max(3, Math.round((piso.x1 - piso.x0) / U / 1.5));
    const nvLateral = i === 0 ? nVentanas(piso.z1 - piso.z0 + 1, "modesta") : Math.max(1, Math.round((piso.z1 - piso.z0) / U / 1.5));
    const ocupadasS = ventanasEnFachada(b, { cara: "S", piso, n: nv, esFrenteConPuerta: i === 0 });
    if (i === 1) ocupadasS1 = ocupadasS;
    ventanasEnFachada(b, { cara: "N", piso, n: nv });
    ventanasEnFachada(b, { cara: "E", piso, n: nvLateral });
    ventanasEnFachada(b, { cara: "O", piso, n: nvLateral });
  }
  // balcón sobre la entrada, planta 1 — "posada con balcón" (pedido 2026-08-30:
  // más arquetipos con balcón, no solo casa) — 45% de las veces, evita las
  // ventanas ya pintadas en esa misma fachada igual que en edificioCasa.
  if (pisos.length > 1 && rnd() < 0.45) {
    const piso1 = pisos[1];
    const anchoBalcon = Math.max(3, Math.round(U * 0.9));
    const centro = Math.round((piso1.x0 + piso1.x1) / 2);
    const a = centro - Math.floor(anchoBalcon / 2), c = a + anchoBalcon - 1;
    if (rangoLibre(ocupadasS1, a, c)) balconEnFachada(b, piso1, "S", centro, anchoBalcon, materiales.madera.colorDebug);
  }
  banderinEnFachada(b, pisos[0], rnd); // banderín sobre la entrada — anuncia la taberna desde la calle
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, elegirTecho(material, riqueza, rnd), ancho >= largo, { pendiente: 0.6 });
  chimenea(b, ultimo.x0 + Math.round(U * 0.8), ultimo.z0 + Math.round(U * 0.8), yTecho - Math.round(U * 0.4), Math.round(U * 1.1), colorMuro, rnd() < 0.6);
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioInstitucion(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, riqueza, material, estiloMadera, estiloVentana, estiloVentanaAlt, rnd, nVentanas } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorMuro, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 1.4, alto: 2.1, rnd });
  let ocupadasSInst = [];
  pisos.forEach((piso, i) => {
    const ocupadasS = ventanasEnFachada(b, { cara: "S", piso, n: nVentanas(piso.x1 - piso.x0 + 1, "noble"), esFrenteConPuerta: piso === planta0 });
    if (i === 1) ocupadasSInst = ocupadasS;
  });
  for (const piso of pisos) { ventanasEnFachada(b, { cara: "N", piso, n: nVentanas(piso.x1 - piso.x0 + 1, "noble") }); ventanasEnFachada(b, { cara: "E", piso, n: nVentanas(piso.z1 - piso.z0 + 1, "modesta") }); ventanasEnFachada(b, { cara: "O", piso, n: nVentanas(piso.z1 - piso.z0 + 1, "modesta") }); }
  // pórtico monumental de columnas ante la puerta — lo que distingue un ayuntamiento/templo/museo de una casa grande
  const nCols = Math.max(2, Math.floor((planta0.x1 - planta0.x0) / (U * 1.6)));
  porticoColumnas(b, planta0.x0 + Math.round(U * 0.4), planta0.x1 - Math.round(U * 0.4), planta0.z0, planta0.y0, planta0.y1 - planta0.y0 + 1, nCols, materiales.marmol?.colorDebug || "#e8e4dc");
  // balcón de piedra sobre el pórtico, planta 1 — "balcón en más arquetipos"
  // (pedido 2026-08-30), propio de un edificio institucional con presencia:
  // ayuntamiento/palacio de justicia con balcón para hablar a la plaza.
  if (pisos.length > 1 && rnd() < 0.35) {
    const piso1 = pisos[1];
    const anchoBalcon = Math.max(3, Math.round(U * 1.1));
    const centro = Math.round((piso1.x0 + piso1.x1) / 2);
    const a = centro - Math.floor(anchoBalcon / 2), c = a + anchoBalcon - 1;
    if (rangoLibre(ocupadasSInst, a, c)) balconEnFachada(b, piso1, "S", centro, anchoBalcon, materiales.marmol?.colorDebug || "#e8e4dc");
  }
  // blasón sobre la puerta — casi siempre, es lo que dice "edificio oficial" sin leer letreros
  if (rnd() < 0.8) blasonFachada(b, planta0, rnd);
  const ultimo = pisos[pisos.length - 1];
  // formaTejado (pedido 2026-08-30): 30% cúpula abovedada en vez del piramidal
  // de siempre — rotonda de museo/biblioteca, misma silueta noble pero no
  // todo el mundo sale con el mismo tejado.
  const techoY = rnd() < 0.3
    ? techoAbovedado(b, ultimo.x0 - Math.round(U * 0.3), ultimo.x1 + Math.round(U * 0.3), ultimo.z0 - Math.round(U * 0.3), ultimo.z1 + Math.round(U * 0.3), yTecho, elegirTecho(null, "noble", rnd))
    : techoPiramidal(b, ultimo.x0 - Math.round(U * 0.3), ultimo.x1 + Math.round(U * 0.3), ultimo.z0 - Math.round(U * 0.3), ultimo.z1 + Math.round(U * 0.3), yTecho, elegirTecho(null, "noble", rnd), { pendiente: 0.5 });
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioTemplo(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, Math.round(alturaPlantaVox() * 1.15), nPlantas, colorMuro, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 1.3, alto: 2.3, rnd });
  // vidrieras: ventanas altas y estrechas en vez de las cuadradas normales, en las 4 caras
  for (const piso of pisos) {
    ventanasEnFachada(b, { cara: "E", piso, n: Math.max(2, Math.round((piso.z1 - piso.z0) / U / 2)) });
    ventanasEnFachada(b, { cara: "O", piso, n: Math.max(2, Math.round((piso.z1 - piso.z0) / U / 2)) });
    ventanasEnFachada(b, { cara: "S", piso, n: 1, esFrenteConPuerta: piso === planta0 });
    ventanasEnFachada(b, { cara: "N", piso, n: Math.max(1, Math.round((piso.x1 - piso.x0) / U / 3)) });
  }
  const ultimo = pisos[pisos.length - 1];
  gargolasEnCornisa(b, ultimo, yTecho - 1); // gárgolas en las 4 esquinas de la cornisa — silueta de iglesia/catedral
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, PIZARRA, ancho >= largo, { pendiente: 0.75 });
  // aguja/campanario centrado sobre la cumbrera
  const cx = Math.round((ultimo.x0 + ultimo.x1) / 2), cz = Math.round((ultimo.z0 + ultimo.z1) / 2);
  const agujaY = techoPiramidal(b, cx - Math.round(U * 0.6), cx + Math.round(U * 0.6) - 1, cz - Math.round(U * 0.6), cz + Math.round(U * 0.6) - 1, techoY, PIZARRA, { pendiente: 1.4, escalon: 2 });
  return { grid: [ancho * U + PAD * 2, agujaY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioMilitar(ctx) {
  const { ancho, largo, plantasAltas, colorMuro, estiloVentana, estiloVentanaAlt, rnd } = ctx;
  const b = Builder();
  // militar siempre en piedra de verdad, sea cual sea el materialesPreferidos del catálogo — un cuartel de madera no lee como fortificación
  const colorPiedra = sombrear(materiales.piedra.colorDebug, 0.95);
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, alturaPlantaVox(), nPlantas, colorPiedra, { material: "piedra", estiloVentana, estiloVentanaAlt, rnd });
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 1.2, alto: 2.0, rnd });
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
  const { ancho, largo, plantasAltas, colorMuro, tema, material, estiloMadera, estiloVentana, estiloVentanaAlt, rnd } = ctx;
  const b = Builder();
  const nPlantas = 2 + plantasAltas; // las torres siempre altas aunque el catálogo pida pocas plantas
  // Escalonado (pedido 2026-08-30): una torre que se afina hacia arriba,
  // silueta real de torreón medieval — 35% de las veces, nunca en el faro
  // (su linterna necesita la plataforma superior entera).
  const escalonado = tema !== "faro" && rnd() < 0.35;
  const opcionesTorre = { material, estiloMadera, estiloVentana, estiloVentanaAlt, rnd };
  if (escalonado) { opcionesTorre.escalonado = true; opcionesTorre.retranqueo = Math.round(U * 0.12); }
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, Math.round(alturaPlantaVox() * 0.85), nPlantas, colorMuro, opcionesTorre);
  const planta0 = pisos[0];
  puertaEnFachada(b, planta0, { ancho: 0.9, alto: 1.9, rnd });
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
  const { ancho, largo, plantasAltas, colorMuro, riqueza, material, estiloMadera, estiloVentana, estiloVentanaAlt, rnd, nVentanas } = ctx;
  const b = Builder();
  const nPlantas = 1 + plantasAltas;
  const { pisos, yTecho } = cuerpo(b, ancho * U, largo * U, Math.round(alturaPlantaVox() * 1.1), nPlantas, colorMuro, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd });
  const planta0 = pisos[0];
  // portalón doble ancho — carros entran a descargar, no una puerta de casa
  puertaEnFachada(b, planta0, { ancho: 1.8, alto: 2.0, rnd });
  const nv = nVentanas(planta0.x1 - planta0.x0 + 1, riqueza === "humilde" ? "humilde" : "modesta");
  if (pisos.length > 1) ventanasEnFachada(b, { cara: "S", piso: pisos[1], n: nv });
  const ultimo = pisos[pisos.length - 1];
  const techoY = techoDosAguas(b, ultimo.x0, ultimo.x1, ultimo.z0, ultimo.z1, yTecho, elegirTecho(material, riqueza, rnd), ancho >= largo, { pendiente: 0.4 });
  return { grid: [ancho * U + PAD * 2, techoY + 2, largo * U + PAD * 2], paleta: b.paleta, cajas: b.cajas };
}

function edificioCastillo(ctx) {
  const { ancho, largo, colorMuro, estiloVentana, estiloVentanaAlt, rnd } = ctx;
  const b = Builder();
  const colorPiedra = sombrear(colorMuro, 0.95);
  const alturaCuerpo = Math.round(alturaPlantaVox() * 2.4);
  const x0 = PAD, x1 = PAD + ancho * U - 1, z0 = PAD, z1 = PAD + largo * U - 1;
  b.caja(x0, 0, z0, x1, alturaCuerpo - 1, z1, colorPiedra);
  const planta0 = { x0, x1, y0: 0, y1: alturaCuerpo - 1, z0, z1, estiloVentana, estiloVentanaAlt, rnd };
  for (const cara of CARAS) sillarPiedra(b, planta0, cara, colorPiedra); // las 4 caras del lienzo, no solo la de la puerta
  puertaEnFachada(b, planta0, { ancho: 1.6, alto: 2.6, rnd });
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

// Tipos "huérfanos" del mapa explícito (pedido 2026-08-30: "completa lo que
// falta" — 30 de los 74 tipoEdificio del catálogo, casi todos oficios reales
// como molino_agua/carnicería/astillero/gran_herrería, caían en la CASA/
// INSTITUCION genérica del fallback en vez de la fachada de taller/templo/
// militar que les toca). En vez de listar cada id a mano (el catálogo YA
// dice qué es cada edificio vía temaTaller/salasPorPlanta), se lee esa señal
// estructural — mismo espíritu "catálogo como fuente de verdad" que el resto
// del proyecto: un tipoEdificio nuevo con sala de taller o temaTaller cae
// solo en TALLER sin tocar este archivo.
function clasificarEdificio(tipoId, info) {
  if (ARQUETIPO_DE[tipoId]) return ARQUETIPO_DE[tipoId];
  const salas = Object.values(info.salasPorPlanta || {}).flat().map((s) => s[0]);
  if (info.temaTaller || salas.some((s) => s.startsWith("taller") || s === "sala_molino" || s === "gran_herreria" || s === "cocina")) return "TALLER";
  if (salas.includes("cripta")) return "TEMPLO";
  if (salas.includes("cuadra")) return "GRANERO";
  if (salas.some((s) => s.startsWith("cuartel_guardia"))) return "MILITAR";
  // fallback por riqueza/plantas para cualquier tipoEdificio futuro no listado — nunca se deja un edificio sin forma
  if (info.riqueza === "noble" && info.rangoPlantasAltas[1] >= 2) return "INSTITUCION";
  if (info.riqueza === "noble" || salas.includes("capitania_puerto")) return "INSTITUCION";
  return "CASA";
}

// --- variedad de forma: elongación + ala en L -------------------------------
// huellas.json ya trae qué tipos pueden salir en L y el tamaño del ala (lo
// usa ciudades/ para la huella de colocación) — se reutiliza tal cual, cero
// catálogos nuevos. La elongación es propia de este generador (no afecta a
// la huella de colocación en ciudades/, que sigue siendo la del catálogo).
function elegirForma(rnd, tipoId, anchoBase, largoBase, arquetipo) {
  let ancho = anchoBase, largo = largoBase;
  // las torres deben quedarse compactas — alargar una torre le rompe la silueta
  if (arquetipo !== "TORRE" && rnd() < 0.22) {
    const factor = 1.25 + rnd() * 0.35;
    if (rnd() < 0.5) ancho = Math.round(ancho * factor); else largo = Math.round(largo * factor);
  }
  const alaBase = huellas.alas && huellas.alas[tipoId];
  let ala = null;
  if (alaBase && rnd() < 0.42) {
    const lados = ["E", "O", "N"]; // nunca "S": no tapar la puerta/fachada principal
    ala = { ancho: alaBase[0], largo: alaBase[1], lado: lados[Math.floor(rnd() * lados.length)] };
  }
  return { ancho, largo, ala };
}

// Ala en L: un anexo de una sola planta con su propio tejado a dos aguas,
// generado como un modelo pequeño aparte y luego FUSIONADO al cuerpo
// principal (trasladando sus cajas) — así ningún arquetipo necesita saber
// nada de alas, se pega desde fuera al resultado ya terminado.
function generarAla(ala, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd, nVentanas }) {
  const b = Builder();
  const colorMuro = materiales[material]?.colorDebug || materiales.madera.colorDebug;
  const { pisos, yTecho } = cuerpo(b, ala.ancho * U, ala.largo * U, alturaPlantaVox(), 1, colorMuro, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza, rnd });
  const p0 = pisos[0];
  const nv = Math.max(1, nVentanas(p0.x1 - p0.x0 + 1, riqueza));
  ventanasEnFachada(b, { cara: "S", piso: p0, n: nv });
  ventanasEnFachada(b, { cara: "N", piso: p0, n: nv });
  techoDosAguas(b, p0.x0, p0.x1, p0.z0, p0.z1, yTecho, elegirTecho(material, riqueza, rnd), ala.ancho >= ala.largo, { pendiente: 0.5 });
  return { cajas: b.cajas, paleta: b.paleta };
}

// Desplazamiento para pegar el ala al lado elegido del cuerpo principal
// (ambos modelos nacen con su propio origen en PAD,PAD): un pequeño solape
// negativo para que se fundan en una sola masa, no dos cajas que se tocan.
function offsetAla(anchoPrincipal, largoPrincipal, ala) {
  const solape = Math.round(U * 0.4);
  if (ala.lado === "E") return { dx: anchoPrincipal * U - solape, dz: 0 };
  if (ala.lado === "O") return { dx: solape - ala.ancho * U + 1, dz: 0 };
  return { dx: 0, dz: largoPrincipal * U - solape }; // "N", trasera
}

// Offset de una pieza de PLAN (formato de ciudades/: coords locales con el
// cuerpo centrado en 0,0 y la puerta en +Y). El modelo vóxel nace con la
// puerta en z bajo (z=PAD-1), así que el eje local Y se invierte a Z:
// oy negativo (ala trasera) cae detrás del cuerpo, como en el plano.
function offsetPiezaPlan(anchoPrincipal, largoPrincipal, pieza) {
  const solape = Math.round(U * 0.4);
  const dx = Math.round((pieza.ox - pieza.w / 2 + anchoPrincipal / 2) * U);
  const dz = Math.round((largoPrincipal / 2 - (pieza.oy + pieza.h / 2)) * U) - solape;
  return { dx, dz };
}

function fusionarModelo(principal, secundario, dx, dz) {
  const offsetPaleta = principal.paleta.length;
  const paleta = principal.paleta.concat(secundario.paleta);
  const cajas = principal.cajas.concat(
    secundario.cajas.map(([x0, y0, z0, x1, y1, z1, p]) => [x0 + dx, y0, z0 + dz, x1 + dx, y1, z1 + dz, p + offsetPaleta])
  );
  return { paleta, cajas };
}

// --- generación --------------------------------------------------------------

// 10 estilos de ventana con pesos (rect/cruz más comunes, buhardilla/bífora
// más raras) — mismo criterio "peso doble al canónico, variedad real en el
// resto" que elegirMaterial.
const ESTILOS_VENTANA = ["rect", "cruz", "arco", "diamante", "persianas", "bifora", "redonda", "buhardilla", "con_alfeizar", "ancha"];
const PESO_VENTANA = [20, 18, 11, 7, 10, 6, 6, 5, 8, 9];
function elegirEstiloVentana(rnd) {
  const total = PESO_VENTANA.reduce((a, c) => a + c, 0);
  let r = rnd() * total;
  for (let i = 0; i < ESTILOS_VENTANA.length; i++) { r -= PESO_VENTANA[i]; if (r <= 0) return ESTILOS_VENTANA[i]; }
  return "rect";
}

// `plan` (opcional) = plan de suelo REAL de una instancia concreta, tal y
// como lo exporta ciudades/ en su indice.json (clave `edificios`): en vez
// de tirar dados de forma, el modelo se construye con exactamente la huella
// que se rasterizó en el terreno — {semilla, w, h, piezas, plantasAltas?}.
// La semilla del plan es la del interior anidado: fachada, forma e interior
// nacen del mismo tiro de dados y el .glb encaja casilla a casilla.
// `nivel` (opcional, 1/2/3): eje de MEJORA del edificio — casa nivel 1/2/3
// con más pisos y decoración conforme sube, para que el mismo tipoEdificio
// dé variantes claramente distintas (pedido del streamer: "casa1, casa
// mejora2, casa mejora3", de cara a una futura progresión por tiempo/dinero
// que hoy NO existe — ver docs/Backlog_Mecanicas_Futuras.md; aquí solo se
// construye el EJE DE VARIEDAD del generador, sin enganche de juego
// todavía). Sin `nivel` (como hasta ahora, ningún caller existente lo
// pasa) el comportamiento es EXACTAMENTE el de antes — retrocompatible al
// 100%, cero riesgo para lo que ya generaba `ciudades/`.
function generarEdificio(tipoId, nn = 1, plan = null, nivel = null, opciones = {}) {
  const info = tiposEdificio[tipoId];
  if (!info) throw new Error(`tipoEdificio desconocido: ${tipoId}`);
  const huella = huellas.porTipo[tipoId] || huellas.porRiqueza[info.riqueza];
  const [anchoBase, largoBase] = huella;
  const rnd = crearPRNG(plan?.semilla != null ? String(plan.semilla) : `${tipoId}|${nn}`);
  const [pMin, pMax] = info.rangoPlantasAltas;
  // consumir SIEMPRE la tirada de plantas aunque el plan o el nivel la
  // sustituyan — así el resto de decisiones (material, ventanas...) no se
  // desplazan y una misma semilla da la misma fachada pase lo que pase con
  // plantasAltas después.
  const plantasTirada = pMin + Math.floor(rnd() * (pMax - pMin + 1));
  // el plan (instancia real de ciudades/) manda siempre que exista; si no,
  // un nivel explícito fija el nº de plantas al extremo que le toque
  // (nivel 2 = la tirada normal, ni el mínimo ni el máximo a propósito);
  // sin plan ni nivel, la tirada de siempre.
  const plantasAltas = plan?.plantasAltas ?? (nivel === 1 ? pMin : nivel === 3 ? pMax : plantasTirada);
  const material = elegirMaterial(rnd, info.materialesPreferidos);
  const colorMuro = materiales[material]?.colorDebug || materiales.madera.colorDebug;
  const estiloMadera = rnd() < 0.55 ? "vertical" : "horizontal";
  const estiloVentana = elegirEstiloVentana(rnd);
  // estilo SECUNDARIO, siempre distinto del principal — dentro de la MISMA
  // casa una parte de las ventanas (piso.rnd en ventanasEnFachada) sale con
  // este segundo estilo en vez del principal. Antes toda la fachada de un
  // edificio compartía un único estilo y se veía demasiado uniforme.
  // estiloVentanaUnico (pedido 2026-08-30): para un prompt tipo "casa muy
  // austera y uniforme" — todas las ventanas del mismo estilo, en vez de
  // forzar siempre 2 estilos mezclados. Sigue consumiendo la misma tirada de
  // rnd() que antes (elegirEstiloVentana se llama igual) para no desplazar
  // el resto de decisiones que dependen de la semilla.
  let estiloVentanaAlt = elegirEstiloVentana(rnd);
  if (opciones.estiloVentanaUnico) {
    estiloVentanaAlt = estiloVentana;
  } else if (estiloVentanaAlt === estiloVentana) {
    estiloVentanaAlt = ESTILOS_VENTANA[(ESTILOS_VENTANA.indexOf(estiloVentana) + 1) % ESTILOS_VENTANA.length];
  }
  // densidad de ventanas por semilla: fachadas casi ciegas en unas variantes,
  // llenas de huecos en otras — no todas las casas del mismo tipo se ven
  // igual, y en general MENOS ventanas y más grandes que antes (una casa de
  // piedra con demasiadas ventanitas iguales se veía plana y monótona).
  const densidadVentanas = 0.4 + rnd() * 0.6;
  const nVentanas = crearNVentanas(densidadVentanas);
  const arquetipo = clasificarEdificio(tipoId, info);
  const forma = plan
    ? { ancho: plan.w, largo: plan.h, ala: null }
    : elegirForma(rnd, tipoId, anchoBase, largoBase, arquetipo);
  let modelo = ARQUETIPO_FN[arquetipo]({
    ancho: forma.ancho, largo: forma.largo, plantasAltas, colorMuro, material, estiloMadera, estiloVentana, estiloVentanaAlt, nVentanas,
    riqueza: info.riqueza, rnd, tema: tipoId, nivel,
  });
  // alas a fusionar: la aleatoria de elegirForma O las piezas reales del
  // plan (pieza 0 = cuerpo principal, ya construido; el resto son alas
  // L/T/U con su posición exacta en el plano)
  const alas = [];
  if (forma.ala) alas.push({ ancho: forma.ala.ancho, largo: forma.ala.largo, ...offsetAla(forma.ancho, forma.largo, forma.ala) });
  if (plan) for (const p of (plan.piezas || []).slice(1)) alas.push({ ancho: p.w, largo: p.h, ...offsetPiezaPlan(forma.ancho, forma.largo, p) });
  for (const ala of alas) {
    const alaModelo = generarAla(ala, { material, estiloMadera, estiloVentana, estiloVentanaAlt, riqueza: info.riqueza, rnd, nVentanas });
    const fusion = fusionarModelo(modelo, alaModelo, ala.dx, ala.dz);
    modelo = {
      grid: [
        Math.max(modelo.grid[0], ala.dx + ala.ancho * U + PAD),
        modelo.grid[1],
        Math.max(modelo.grid[2], ala.dz + ala.largo * U + PAD),
      ],
      paleta: fusion.paleta, cajas: fusion.cajas,
    };
  }
  return {
    nombre: `${tipoId.replace(/_/g, " ")} (var ${String(nn).padStart(2, "0")}${nivel ? `, nivel ${nivel}` : ""})`,
    arquetipo, tipoId, huella, material, estiloMadera, estiloVentana, estiloVentanaAlt, nivel,
    forma: plan ? "plan" : forma.ancho !== anchoBase || forma.largo !== largoBase ? "alargado" : "base", enL: alas.length > 0,
    resolucion: U, ...modelo,
  };
}

// Subconjunto de PRUEBA: un tipo representativo por arquetipo (10) — valida
// la silueta antes de la pasada completa (los ~41 tipos, "todo"). 3 variantes
// por tipo incluso en el subconjunto de prueba: la semilla ya mueve forma
// (rectangular/alargada/en L), material, estilo de madera y de ventana, así
// que hace falta más de 1 variante para verlo.
const TIPOS_PRUEBA = ["casa_humilde", "casa_noble", "herreria", "taberna", "ayuntamiento", "templo", "cuartel_guardia", "torre_mago", "granero", "castillo"];

// `conNiveles` (opcional, default false: comportamiento EXACTO de siempre,
// mismo conteo que antes) multiplica cada variante por los 3 niveles de
// mejora — es el modo que de verdad saca las ~100 combinaciones pedidas
// (10 arquetipos de prueba × 3 semillas × 3 niveles = 90; con el catálogo
// completo, ~44 tipos × 4 semillas × 3 niveles ≈ 500 — ESE run grande lo
// corre el streamer, CLAUDE.md: "los bakes grandes los corre el usuario").
function generarTodo(soloPrueba, conNiveles = false) {
  const resultado = {};
  const conteo = {};
  const tipos = soloPrueba ? TIPOS_PRUEBA : Object.keys(tiposEdificio).filter((id) => !id.startsWith("_"));
  const niveles = conNiveles ? [1, 2, 3] : [null];
  for (const tipoId of tipos) {
    // 4 variantes por tipo en modo "todo": con ~41 tipoEdificio reales, salen
    // bastantes más de 41 edificios distintos (forma/material/ventana varían
    // por semilla) sin inventar tipoEdificio que no pactó el usuario.
    const nVariantes = soloPrueba ? 3 : 4;
    for (let n = 1; n <= nVariantes; n++) {
      for (const nivel of niveles) {
        const modelo = generarEdificio(tipoId, n, null, nivel);
        conteo[modelo.arquetipo] = (conteo[modelo.arquetipo] || 0) + 1;
        const clave = conNiveles ? `${tipoId}_${String(n).padStart(2, "0")}_n${nivel}` : `${tipoId}_${String(n).padStart(2, "0")}`;
        resultado[clave] = modelo;
      }
    }
  }
  return { resultado, conteo };
}

/**
 * Los 3 niveles de UN edificio concreto, generados y devueltos JUNTOS
 * (pedido 2026-08-30: "si creo casa nivel 1 creo también esa en nivel 2 y
 * nivel 3... se guardan para cuando la casa se amplíe") — mismo `tipoId|nn`
 * de semilla en los 3 (`generarEdificio` ya lo garantiza: `nivel` solo se
 * lee DESPUÉS de fijar material/forma/estilo de ventana, así que las 3
 * versiones comparten aspecto y solo difieren en plantas/decoración). Nota
 * honesta: la coherencia NO es perfecta hasta el último detalle — algunas
 * decisiones posteriores (porche, jardineras) sí dependen de si hubo
 * plantas altas o no en CADA nivel, así que pueden divergir un poco entre
 * niveles cuando nivel 1 tiene 0 plantas altas y nivel 3 tiene 2; el
 * aspecto principal (material/forma/ventanas) es idéntico siempre.
 */
function generarEdificioConNiveles(tipoId, nn = 1, plan = null, opciones = {}) {
  return {
    nivel1: generarEdificio(tipoId, nn, plan, 1, opciones),
    nivel2: generarEdificio(tipoId, nn, plan, 2, opciones),
    nivel3: generarEdificio(tipoId, nn, plan, 3, opciones),
  };
}

if (require.main === module) {
  const todo = process.argv.includes("todo");
  const conNiveles = process.argv.includes("niveles");
  const { resultado, conteo } = generarTodo(!todo, conNiveles);
  fs.writeFileSync(path.join(__dirname, "edificios_generados.json"), JSON.stringify(resultado));
  console.log(`Generados: ${Object.keys(resultado).length} modelos (${todo ? "catálogo completo" : "subconjunto de prueba: 10 arquetipos"}${conNiveles ? " × 3 niveles" : ""})`);
  console.log("Por arquetipo:", conteo);
}

module.exports = { generarTodo, generarEdificio, generarEdificioConNiveles, ARQUETIPO_FN, clasificarEdificio, TIPOS_PRUEBA, POR_ARQUETIPO, U, PAD, MADERA_CLARA, TONOS_PUERTA, elegirTecho, elegirMaterial, ESTILOS_VENTANA };
