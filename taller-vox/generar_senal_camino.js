"use strict";
// Generador de la SEÑAL DE DIRECCIÓN de camino — pedido streamer
// 2026-09-13: "faltaría añadir nombres a las ciudades aldeas o POIS...
// para poner un sistema de SEÑALES en los caminos que te indiquen hacia
// donde va ese camino... dando click sobre el prop (un palo con una señal
// de dirección flecha) te dice hacia que POI vas". Poste de madera con UN
// tablón-flecha apuntando en +X local (0° de rotación) — `baker/src/
// generar.js` calcula el `ro` real por señal con la MISMA convención ya
// verificada en los módulos de muralla (`Math.atan2(dy,dx)*180/PI`,
// ciudades/src/generar.js) para que la flecha señale de verdad hacia el
// asentamiento, sin importar hacia dónde serpentee el camino en ese tramo.
//
// Mismo patrón exacto que generar_puerta_asentamiento.js/generar_hitos_plaza.js
// (Builder/sombrear/PRNG propios, sin depender de generar_modelos.js — ese
// archivo NO es una librería, ejecuta su generación completa en cuanto se
// importa). Categoría de destino "interiores" (t:"m", igual que la
// decoración urbana de ciudades/ y los hitos de plaza) — `sectorVisual.ts`
// ya prueba genéricamente `assets/interiores/<id>_NN.glb` para ese tipo,
// cero cambio de cliente para el PROP visual en sí (la parte clicable/
// etiqueta va aparte, ver docs/GDD_Sistema_Señales.md).
//
//   node generar_senal_camino.js
//   node exportar_lote.js senal_camino_generada.json ../assets/interiores --centrar-xz
//
// (--centrar-xz: mismo criterio que el resto de decoración urbana — el
// cliente posiciona categoría "m" con esquina+ancho/2, un objeto anclado
// por la esquina saldría desplazado medio hueco de su huella.)
//
// Enganche rápido (mismo criterio ya usado repetidas veces esta sesión
// para lotes de arte procedural — hitos de plaza, puerta de asentamiento,
// decoración urbana): se sube DIRECTO a assets/interiores/ sin revisión
// pieza a pieza, decisión ya asumida por el streamer para este tipo de
// lote — puede pedirse rehacer cualquier variante tras verla en persona.

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../interiores/src/azar");

const U = 10; // subdivisiones de vóxel por casilla — mismo criterio que el resto del taller
const NUM_VARIANTES = 3;

const MADERA_POSTE = "#5a4028";
const MADERA_TABLON = "#8a6234";
const MADERA_TABLON_OSCURA = "#6b4a26";
const HIERRO_CLAVIJA = "#3a3630";

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

// Huella nominal [1,1] casilla (10x10 subdivisiones) — el tablón sobresale
// un poco más allá en +X a propósito (una señal real vuela sobre el poste,
// igual que un estandarte o una farola sobresalen de su propia huella en
// otras piezas del taller) — decorativo puro, sin colisión reservada
// (baker/src/generar.js nunca marca "solar_edificio" para `t:"m"`).
function senalCamino(rnd, opciones = {}) {
  const b = Builder();
  const cx = Math.round(0.5 * U); // centro de la casilla, eje del poste
  const anchoPoste = Math.max(2, Math.round(U * 0.16));
  const altoPoste = Math.round(U * (1.7 + rnd() * 0.3)); // 1.7-2.0 casillas, por encima del jugador (1.57u) y de matorrales

  const x0Poste = cx - Math.round(anchoPoste / 2), x1Poste = x0Poste + anchoPoste - 1;
  const zPoste = cx;
  b.caja(x0Poste, 0, zPoste - Math.round(anchoPoste / 2), x1Poste, altoPoste - 1, zPoste + Math.round(anchoPoste / 2) - 1, MADERA_POSTE);

  // Tablón-flecha: nace pegado al poste (en +X) y apunta hacia +X local —
  // rotación 0° = "la flecha señala en la dirección +X del mundo", misma
  // convención que baker/src/generar.js usa para calcular `ro` por señal.
  //
  // BUG REAL encontrado con una captura, no dado por bueno de oído (mismo
  // criterio "los cambios se demuestran con capturas" del resto del
  // proyecto — pedido streamer viendo la primera captura: "la señal sale
  // como una bandeja, debería ser vertical no?"): la primera versión hacía
  // el tablón FINO en Y (vertical, `grosorTablon`) y ANCHO en Z
  // (perpendicular al camino, `anchoBase`) — un tablón real de fingerpost
  // es justo lo CONTRARIO: fino en profundidad (Z, el grosor de la
  // madera vista de canto) y con altura de verdad en Y (la cara ancha,
  // donde iría el texto/flecha, mirando a quien camina por el lado).
  // Con el reparto viejo, el tablón se veía tumbado como una bandeja/
  // repisa horizontal en vez de un cartel de pie. Arreglado intercambiando
  // qué eje es el fino (Z, `grosorTablon`) y cuál lleva la altura real del
  // tablón (Y, `altoTablon`) — el poste y la lógica de rotación (`ro` real
  // calculado en baker/src/generar.js) no cambian, solo la sección
  // transversal del brazo.
  const colorTablon = opciones.oscuro ? MADERA_TABLON_OSCURA : MADERA_TABLON;
  const altoTablon = Math.round(U * 0.34); // altura real del tablón (antes era la anchura Z, mal)
  const grosorTablon = Math.max(1, Math.round(U * 0.14)); // grosor fino de canto (antes era la altura Y, mal)
  const yTablon0 = Math.round((altoPoste - altoTablon) * (opciones.altoTablon ?? 0.62));
  const yTablon1 = yTablon0 + altoTablon - 1;
  const semiGrosor = Math.max(1, Math.round(grosorTablon / 2));
  const largoCuerpo = Math.round(U * (0.85 + rnd() * 0.25)); // tramo rectangular antes de la punta
  const largoPunta = Math.round(U * 0.4); // tramo que se va estrechando hasta el vértice

  const xCuerpo0 = x1Poste + 1;
  const xCuerpo1 = xCuerpo0 + largoCuerpo - 1;
  b.caja(xCuerpo0, yTablon0, cx - semiGrosor, xCuerpo1, yTablon1, cx + semiGrosor - 1, colorTablon);

  // Punta triangular aproximada por capas de ALTURA decreciente (mismo
  // truco voxel ya usado para el abombado de barriles/tinajas del taller,
  // aquí en el eje Y en vez de en el Z — la punta se estrecha de arriba y
  // abajo hacia el centro del brazo, como la punta real de una flecha
  // vista de canto).
  const CAPAS_PUNTA = 4;
  for (let k = 0; k < CAPAS_PUNTA; k++) {
    const t0 = k / CAPAS_PUNTA, t1 = (k + 1) / CAPAS_PUNTA;
    const xa = Math.round(xCuerpo1 + 1 + largoPunta * t0);
    const xb = Math.round(xCuerpo1 + largoPunta * t1);
    const semiAlto = Math.max(1, Math.round((altoTablon / 2) * (1 - t0)));
    const centroY = yTablon0 + Math.round(altoTablon / 2);
    b.caja(xa, centroY - semiAlto, cx - semiGrosor, xb, centroY + semiAlto - 1, cx + semiGrosor - 1, k % 2 === 0 ? colorTablon : sombrear(colorTablon, 1.08));
  }

  // Muesca corta en el lado OPUESTO del poste (contrapeso visual, mismo
  // criterio que un cartel real con dos brazos desiguales) — solo en
  // algunas variantes, nunca tan larga como el brazo principal.
  if (opciones.contrapeso) {
    const largoContra = Math.round(U * 0.35);
    b.caja(x0Poste - largoContra, yTablon0, cx - semiGrosor, x0Poste - 1, yTablon1, cx + semiGrosor - 1, sombrear(colorTablon, 0.92));
  }

  // Clavija de hierro que fija el tablón al poste (detalle pequeño, un
  // único vóxel de contraste — igual que las bisagras de otras piezas).
  b.caja(x1Poste, yTablon0 + Math.round(altoTablon / 2) - 1, cx - 1, x1Poste + 1, yTablon0 + Math.round(altoTablon / 2), cx, HIERRO_CLAVIJA);

  // `grid` declara la huella NOMINAL de UNA casilla [U,altoPoste,U] —
  // NUNCA el ancho real del tablón (que sobresale mucho más allá en +X).
  // `exportar_glb.js::mallarVoxeles` no usa `grid` para recortar geometría
  // (solo genera caras a partir de `cajas`, sin importar cuánto se salgan
  // del grid declarado) — SOLO lo usa `--centrar-xz` para calcular el
  // desplazamiento de centrado (`grid[0]/2, grid[2]/2`). Bug real evitado
  // aquí ANTES de exportar (no encontrado jugando, sino midiendo el bbox
  // exportado): declarar `grid[0]` como el ancho TOTAL del tablón habría
  // centrado el modelo en el CENTRO DE MASA del brazo (que no es donde
  // está el poste), desplazando el punto de anclaje real (la base del
  // poste, donde cae la etiqueta clicable y donde se coloca la señal en
  // el mapa) varias décimas de casilla del poste visible — el mismo tipo
  // de bug ya documentado varias veces en docs/GDD_Bakeador_POIs.md
  // (esquina-vs-centro). Con `grid=[U,altoPoste,U]`, `grid[0]/2=U/2=5`
  // coincide EXACTO con el centro del poste (`cx=U/2`), así que tras
  // `--centrar-xz` el origen del `.glb` cae en la base del poste, no en
  // mitad del tablón.
  return { grid: [U, altoPoste, U], paleta: b.paleta, cajas: b.cajas };
}

function generarTodo() {
  const resultado = {};
  for (let n = 1; n <= NUM_VARIANTES; n++) {
    const rnd = crearPRNG(`senal_camino|${n}`);
    const opciones = { oscuro: n === 2, contrapeso: n !== 1, altoTablon: n === 3 ? 0.72 : 0.62 };
    const modelo = senalCamino(rnd, opciones);
    const nn = String(n).padStart(2, "0");
    resultado[`senal_camino_${nn}`] = { nombre: `señal de camino (var ${nn})`, arquetipo: "SENAL_CAMINO", resolucion: U, ...modelo };
  }
  return resultado;
}

if (require.main === module) {
  const resultado = generarTodo();
  fs.writeFileSync(path.join(__dirname, "senal_camino_generada.json"), JSON.stringify(resultado));
  console.log(`Generadas ${Object.keys(resultado).length} variantes de senal_camino.`);
}

module.exports = { generarTodo, senalCamino, U, NUM_VARIANTES };
