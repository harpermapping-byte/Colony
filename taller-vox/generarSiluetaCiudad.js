"use strict";
// Silueta 3D REAL del asentamiento visto desde fuera del mapa exterior —
// v2 (2026-09-09, misma noche que v1): el streamer mandó dos imágenes de
// referencia (muralla/castillo denso, macizo, con edificios apiñados
// dentro) y dejó claro que v1 (muralla de bloques sueltos cada ~3 casillas
// + tejados-lámina flotantes) "no se ve nada de eso" — v1 se leía como
// "estructuras dispersas asomando entre árboles", no como una ciudad
// amurallada real. v2 reescribe el generador entero con 3 cambios de
// fondo pedidos explícitamente:
//   1. Muralla CONTINUA de verdad (rasterizada en pasos de ~1 casilla a lo
//      largo del polígono REAL `ciudad.poligonoMuralla`, no bloques cada
//      3 casillas) — se lee como un anillo sólido, no como pilares sueltos.
//   2. Edificios SÓLIDOS y DENSOS dentro (bloque completo con tejado
//      escalonado, real posición/tamaño/riqueza de `ciudad.edificios`) en
//      vez de láminas finas flotantes — el pedido explícito fue "no tiene
//      que reproducir qué edificios tiene dentro, es un 3D que SIMULA el
//      espacio que ocupa" — sigue sin reproducir el interior real pieza a
//      pieza, pero ahora SÍ lee como un perfil urbano compacto.
//   3. Material por tier YA VENÍA CORRECTO gratis (`ciudad.modulosMuralla[].
//      material`, "empalizada pobre / piedra rica" — ver GDD_Bakeador_POIs
//      §6): aldea sale con muralla de madera, capital/castillo con piedra,
//      sin tocar nada — v2 solo EXTIENDE ese mismo material a las paredes
//      de los edificios de dentro (predominantemente madera en aldeas,
//      predominantemente piedra en el resto, con una mezcla minoritaria
//      del material contrario — pedido explícito: "si es aldea empalizada
//      madera... de piedra dentro [alguno]").
//
// Coste de vóxeles: v1 media res (U=10, la del resto de taller-vox) con
// tejados de lámina ya costaba 3.4-13.9s/650k-2.2M vóxeles por asentamiento
// — v2 añade muralla continua Y edificios sólidos, mucho más contenido.
// Bajado a U_SILUETA=4 (en vez de 10): esta pieza se ve SIEMPRE desde la
// cámara isométrica fija y a bastante distancia (nunca de cerca, a
// diferencia de un mueble o un edificio normal) — el detalle de "vóxel
// exacto por casilla" no aporta nada visible aquí, y la resolución más
// gruesa mantiene el coste real POR DEBAJO del de v1 pese a tener mucho
// más contenido (medido antes de comitear, ver docs/GDD_Bakeador_POIs.md
// §13ter).
//
// A DIFERENCIA del resto de taller-vox (arquetipo + unas pocas variantes
// PRE-generadas y subidas a mano tras revisión): esta pieza sigue siendo
// única POR INSTANCIA de asentamiento — cada ciudad tiene su propio
// polígono de muralla real (Perlin, irregular) y su propio reparto de
// edificios. Se genera EN EL MISMO PROCESO DE BAKEO (baker/src/
// instanciasPOI.js la llama directamente, perezosa, mismo criterio que
// generarEdificio/generarMazmorra) a partir del objeto `ciudad` REAL que
// ya devuelve `ciudades/src/index.js::hornearCiudad` — reutiliza datos ya
// calculados, cero generación nueva de forma/terreno.
//
// La PUERTA: v1 la colocaba siempre en el borde sur fijo de la huella
// entera, sin relación con ninguna puerta real del polígono — v2 devuelve
// `puertaPrincipal` (posición real + ángulo tangente de la muralla en ese
// punto, sacados de `ciudad.puertas`/`ciudad.modulosMuralla`) para que
// `instanciasPOI.js` alinee ahí la estructura interactiva de
// `generar_puerta_asentamiento.js` Y el portal real — cierra el pedido
// explícito "la puerta debe coincidir con una que se genere en la
// muralla". La silueta misma deja un hueco real en el anillo en TODAS las
// puertas reales del polígono (no solo la principal), para que el resto
// de cruces de camino no se vean con la muralla cerrada encima.

const U = 4; // subdivisiones de vóxel por casilla — deliberadamente más grueso que el resto del taller (10), ver cabecera

const PIEDRA = "#8a8580";
const PIEDRA_OSCURA = "#6e6a64";
const MADERA = "#5a4028";
const MADERA_OSCURA = "#43301d";
const TECHOS = ["#8a4a3a", "#6a5a3a", "#7a5a4a", "#5a6a5a"]; // tonos de tejado variados, tierra/musgo — nunca el morado de COLOR_DESCONOCIDO

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

// tiers con presencia real de "gran estructura central" (castillo/palacio) —
// el resto (aldeas, pueblos, campamentos hostiles) se queda con edificios
// normales, sin torre de homenaje — coherente con el pedido "si es castillo
// pues un castillo de piedra" sin inventar un castillo en una aldea pequeña.
const TIERS_CON_TORRE_HOMENAJE = new Set(["capital", "gran_capital", "capital_jarl", "castillo"]);

/**
 * @param {object} ciudad - objeto REAL devuelto por hornearCiudad() (ciudades/src/index.js)
 * @param {() => number} rnd - PRNG mulberry32 (crearPRNG), para variación menor de altura/tejados/mezcla de material
 */
function generarSiluetaCiudad(ciudad, rnd) {
  const b = Builder();
  const gx = Math.round(ciudad.ancho * U);
  const gz = Math.round(ciudad.alto * U);

  const materialMuro = ciudad.modulosMuralla[0]?.material || "piedra"; // uniforme por ciudad (def.muralla.material, una sola vez por hornearCiudad)
  const esMadera = materialMuro === "empalizada";
  const colorMuro = esMadera ? MADERA : PIEDRA;
  const colorMuroOscuro = esMadera ? MADERA_OSCURA : PIEDRA_OSCURA;
  const alturaMuro = Math.round(U * (esMadera ? 1.9 : 2.5));
  // grosor: subido de 0.75/0.95 a 1.4/1.7 casillas (2026-09-09, verificando
  // en vivo) — a U=4 un muro fino se leía como una hilera de puntitos
  // sueltos en vez de una franja sólida (el solape geométrico entre
  // bloques consecutivos SÍ era real y continuo, confirmado numéricamente
  // trazando el polígono real; el problema era puramente de grosor visual
  // insuficiente a esta resolución/distancia de cámara).
  const grosorMuro = Math.max(2, Math.round(U * (esMadera ? 1.4 : 1.7)));
  const hwMuro = Math.max(1, Math.round(grosorMuro / 2));

  // --- hueco en TODAS las puertas reales del polígono (no solo la
  // principal) — un cruce de camino real nunca debe verse con la muralla
  // cerrada encima, aunque solo la principal reciba la estructura interactiva ---
  const puertasReales = ciudad.puertas || [];
  const RADIO_GAP = 3.5; // casillas — sobra margen para la huella [6,2] de generar_puerta_asentamiento.js
  const dentroDeGap = (x, y) => puertasReales.some((p) => Math.hypot(p.x - x, p.y - y) < RADIO_GAP);

  // --- muralla CONTINUA: recorre el polígono REAL vértice a vértice, un
  // bloque cuadrado cada ~1 casilla a lo largo de cada tramo (se solapan
  // entre sí porque el paso es menor que el grosor visual del bloque) —
  // se lee como un anillo sólido, no como pilares sueltos cada 3 casillas
  // (el problema real de v1) ---
  const poligono = ciudad.poligonoMuralla || [];
  const NV = poligono.length;
  for (let i = 0; i < NV; i++) {
    const a = poligono[i], c = poligono[(i + 1) % NV];
    const largo = Math.hypot(c.x - a.x, c.y - a.y);
    // 2 pasos por casilla (no 1): a U=4 el redondeo a vóxel entero de
    // `vx=Math.round(px*U)` puede dejar huecos de 1 vóxel entre bloques
    // consecutivos si el paso coincide justo con el ancho del bloque — el
    // primer intento (1 paso/casilla) se veía como pilares/puntos sueltos
    // en vez de un anillo continuo (bug real encontrado verificando en
    // vivo). El solape extra es barato (la muralla ya es la parte más
    // ligera del coste total, ver medición en la cabecera del archivo).
    const pasos = Math.max(1, Math.round(largo * 2));
    for (let t = 0; t <= pasos; t++) {
      const px = a.x + (t / pasos) * (c.x - a.x);
      const py = a.y + (t / pasos) * (c.y - a.y);
      if (dentroDeGap(px, py)) continue;
      const vx = Math.round(px * U), vz = Math.round(py * U);
      b.caja(vx - hwMuro, 0, vz - hwMuro, vx + hwMuro - 1, alturaMuro - 1, vz + hwMuro - 1, colorMuro);
    }
  }

  // --- torres: bloque más ancho y alto en cada módulo "torre" real, con
  // remate/almena simple para romper la silueta plana ---
  const altoTorre = Math.round(alturaMuro * 1.55);
  for (const m of ciudad.modulosMuralla) {
    if (m.tipo !== "torre") continue;
    const vx = Math.round(m.x * U), vz = Math.round(m.y * U);
    const hw = Math.round(U * (esMadera ? 0.9 : 1.15));
    b.caja(vx - hw, 0, vz - hw, vx + hw - 1, altoTorre - 1, vz + hw - 1, colorMuroOscuro);
    const hw2 = Math.round(hw * 0.6);
    b.caja(vx - hw2, altoTorre, vz - hw2, vx + hw2 - 1, altoTorre + Math.round(U * 0.35) - 1, vz + hw2 - 1, sombrear(colorMuroOscuro, 0.8));
  }

  // --- edificios: bloque SÓLIDO real (posición/tamaño/riqueza reales de
  // ciudad.edificios) con tejado escalonado — nunca lámina flotante
  // (bug de v1: "no se ve una ciudad, se ven cajas dispersas"). Material
  // de pared por edificio: predominantemente el de la muralla de esta
  // ciudad, con una mezcla minoritaria del material contrario (pedido
  // explícito: "si es aldea empalizada madera... de piedra dentro" —
  // alguna construcción de piedra real incluso en una aldea de madera,
  // y viceversa unas pocas de madera en una ciudad de piedra) ---
  let mayor = null;
  for (const ed of ciudad.edificios || []) {
    const area = (ed.w || 6) * (ed.h || 6);
    if (!mayor || area > mayor.area) mayor = { ed, area };
  }
  const tieneTorreHomenaje = TIERS_CON_TORRE_HOMENAJE.has(ciudad.tier);

  let indice = 0;
  for (const ed of ciudad.edificios || []) {
    const w = Math.max(U, Math.round((ed.w || 6) * U * 0.86));
    const d = Math.max(U, Math.round((ed.h || 6) * U * 0.86));
    const vx = Math.round((ed.cx ?? ed.x ?? 0) * U);
    const vz = Math.round((ed.cy ?? ed.y ?? 0) * U);
    const esHomenaje = tieneTorreHomenaje && ed === mayor.ed;

    // riqueza real (interior.riqueza) empuja algo de altura extra —
    // noble/rico se nota un poco más que humilde/modesta, sin inventar
    // un dato nuevo
    const riqueza = ed.interior?.riqueza;
    const bonusRiqueza = riqueza === "noble" || riqueza === "rico" ? 1.25 : riqueza === "humilde" ? 0.85 : 1;
    let alturaBase = Math.round(U * (1.3 + rnd() * 1.4) * bonusRiqueza);
    if (esHomenaje) alturaBase = Math.round(alturaBase * 1.7);

    // mezcla de material: ~80% el material dominante de la ciudad, ~20%
    // el contrario — nunca 100% uniforme, un asentamiento real mezcla
    const colorPared = rnd() < 0.8 ? (esMadera ? MADERA : sombrear(PIEDRA, 1.04)) : (esMadera ? sombrear(PIEDRA, 1.04) : MADERA);

    b.caja(vx - w / 2, 0, vz - d / 2, vx + w / 2 - 1, alturaBase - 1, vz + d / 2 - 1, colorPared);

    // tejado escalonado (2 capas, la de arriba más pequeña) — silueta de
    // "tejado a dos aguas" leída desde la cámara isométrica fija, barata
    // en vóxeles (dos cajas, no una pirámide real)
    const tono = TECHOS[indice % TECHOS.length];
    const capa1 = Math.max(1, Math.round(U * 0.45));
    b.caja(vx - w / 2 - 1, alturaBase, vz - d / 2 - 1, vx + w / 2, alturaBase + capa1 - 1, vz + d / 2, tono);
    const w2 = Math.max(2, Math.round(w * 0.55)), d2 = Math.max(2, Math.round(d * 0.55));
    const capa2 = Math.max(1, Math.round(U * (esHomenaje ? 0.9 : 0.4)));
    b.caja(vx - w2 / 2, alturaBase + capa1, vz - d2 / 2, vx + w2 / 2 - 1, alturaBase + capa1 + capa2 - 1, vz + d2 / 2 - 1, sombrear(tono, 0.85));

    indice++;
  }

  // --- puerta principal: la real más cercana al primer cruce de camino
  // (ciudad.puertas[0]), con el ángulo tangente de la muralla en ese
  // punto (modulosMuralla ya lo calcula) — instanciasPOI.js la usa para
  // alinear la estructura interactiva y el portal real ---
  let puertaPrincipal = null;
  if (puertasReales.length) {
    const p0 = puertasReales[0];
    let mejor = null, mejorD = Infinity;
    for (const m of ciudad.modulosMuralla) {
      if (m.tipo !== "puerta") continue;
      const dd = Math.hypot(m.x - p0.x, m.y - p0.y);
      if (dd < mejorD) { mejorD = dd; mejor = m; }
    }
    puertaPrincipal = { x: p0.x, y: p0.y, rotDeg: mejor ? mejor.rot : 0 };
  }

  return {
    grid: [gx, Math.round(U * 8), gz], // altura nominal generosa (torre de homenaje + almenas) — solo usado por centrarXZ para X/Z, no restringe la geometría real
    paleta: b.paleta,
    cajas: b.cajas,
    puertaPrincipal,
  };
}

module.exports = { generarSiluetaCiudad, U };
