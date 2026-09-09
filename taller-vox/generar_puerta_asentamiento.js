"use strict";
// Generador de la PUERTA DE ASENTAMIENTO — pieza nueva, pedido streamer
// 2026-09-09 jugando: "la capital sigue viéndose por fuera un placeholder,
// debería verse una aldea con puerta y poder entrar por ella (la puerta) a
// la instancia". El bulto entero de la ciudad (huella real ciudad.ancho x
// ciudad.alto) SIGUE siendo la caja placeholder de siempre (arte de la
// silueta completa queda pendiente, GDD_Bakeador_POIs.md §4.4/§11) — esta
// pieza es DISTINTA y más pequeña: una estructura de PUERTA real, a escala
// de edificio normal (huella fija [6,2] casillas, igual sea la aldea más
// chica o la gran_capital), colocada justo delante de la caja grande y con
// el portal real de entrada justo enfrente — mismo patrón exacto que
// generar_hitos_plaza.js (arquetipo propio + Builder/caja + PRNG por
// variante), pero pasando por el camino GENÉRICO de "edificio" de
// sectorVisual.ts (t:"e", tipoEdificioId="puerta_asentamiento") en vez de
// "interiores"/decoración — cero cambio de cliente.
//
//   node generar_puerta_asentamiento.js
//   node exportar_lote.js puerta_asentamiento_generada.json ../assets/edificios
//
// Enganche rápido (mismo criterio ya usado para el lote de 36 edificios de
// ciudad y para herramientas/armas esta misma sesión — decisión explícita
// del streamer de desbloquear jugabilidad real antes que revisar arte pieza
// a pieza): se exporta DIRECTO a assets/edificios/, sin pasar por el visor.

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../interiores/src/azar");

const U = 10; // subdivisiones de vóxel por casilla — mismo criterio que el resto del taller
const NUM_VARIANTES = 4; // misma cuenta que VARIANTES_EDIFICIO en baker/src/instanciasPOI.js

const PIEDRA = "#8a8580";
const PIEDRA_OSCURA = "#5d5852";
const MADERA = "#5a4028";
const TELA_ESTANDARTE = "#8a2020";

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

// Huella fija [6,2] casillas (60x20 subdivisiones) — pensada para leerse
// bien tanto en la aldea más pequeña como en la gran_capital, ya que el
// bulto real de la ciudad (caja placeholder aparte) es quien comunica la
// escala del asentamiento; la puerta solo marca "aquí se entra".
function puertaAsentamiento(rnd, opciones = {}) {
  const b = Builder();
  const gx = 6 * U, gz = 2 * U;
  const anchoStub = Math.round(1.5 * U);
  const anchoPilar = Math.round(0.9 * U);
  const altoPilar = Math.round(U * (1.9 + rnd() * 0.3)); // ~1.9-2.2 unidades, por encima del jugador (1.57u)
  const altoStub = Math.round(altoPilar * 0.65); // los tramos de muro laterales quedan más bajos que los pilares
  const espesorLintel = Math.max(2, Math.round(U * 0.22));

  const xPilarIzq0 = anchoStub, xPilarIzq1 = anchoStub + anchoPilar - 1;
  const xPilarDer1 = gx - anchoStub - 1, xPilarDer0 = xPilarDer1 - anchoPilar + 1;

  // tramos de muro laterales (sugieren la muralla que continúa fuera de cuadro)
  b.caja(0, 0, 0, anchoStub - 1, altoStub - 1, gz - 1, PIEDRA);
  b.caja(gx - anchoStub, 0, 0, gx - 1, altoStub - 1, gz - 1, PIEDRA);
  // remate superior de los tramos, un tono más claro
  b.caja(0, altoStub, 0, anchoStub - 1, altoStub, gz - 1, sombrear(PIEDRA, 1.12));
  b.caja(gx - anchoStub, altoStub, 0, gx - 1, altoStub, gz - 1, sombrear(PIEDRA, 1.12));

  // los dos pilares del arco, más altos y de piedra oscura (destacan del muro)
  b.caja(xPilarIzq0, 0, 0, xPilarIzq1, altoPilar - 1, gz - 1, PIEDRA_OSCURA);
  b.caja(xPilarDer0, 0, 0, xPilarDer1, altoPilar - 1, gz - 1, PIEDRA_OSCURA);

  // lintel: une los dos pilares por encima del hueco de paso — la silueta de "puerta"
  b.caja(xPilarIzq0, altoPilar, 0, xPilarDer1, altoPilar + espesorLintel - 1, gz - 1, PIEDRA);

  // almenas sobre el lintel (variante par/impar por semilla, mismo criterio "redondo"/"agua" de hitos_plaza.js)
  if (opciones.almenas) {
    const anchoAlmena = Math.max(2, Math.round(U * 0.18));
    const altoAlmena = Math.round(U * 0.16);
    const yAlmena = altoPilar + espesorLintel;
    for (let x = xPilarIzq0; x + anchoAlmena <= xPilarDer1; x += anchoAlmena * 2) {
      b.caja(x, yAlmena, gz * 0.3, x + anchoAlmena - 1, yAlmena + altoAlmena - 1, gz * 0.3 + anchoAlmena - 1, sombrear(PIEDRA, 0.9));
    }
  }

  // estandarte colgando de un pilar (solo algunas variantes) — un toque de color, nunca heráldica real inventada
  if (opciones.estandarte) {
    const lado = xPilarIzq1;
    const yTop = altoPilar - Math.round(U * 0.15);
    b.caja(lado + 1, yTop - Math.round(U * 0.6), gz * 0.5 - 1, lado + 1, yTop, gz * 0.5, MADERA);
    b.caja(lado + 2, yTop - Math.round(U * 0.55), gz * 0.5 - 1, lado + 2 + Math.round(U * 0.25), yTop - Math.round(U * 0.1), gz * 0.5, TELA_ESTANDARTE);
  }

  const yTope = altoPilar + espesorLintel + (opciones.almenas ? Math.round(U * 0.16) : 0);
  return { grid: [gx, yTope + 1, gz], paleta: b.paleta, cajas: b.cajas };
}

function generarTodo() {
  const resultado = {};
  for (let n = 1; n <= NUM_VARIANTES; n++) {
    const rnd = crearPRNG(`puerta_asentamiento|${n}`);
    const opciones = { almenas: n !== 2, estandarte: n === 3 || n === 4 };
    const modelo = puertaAsentamiento(rnd, opciones);
    const nn = String(n).padStart(2, "0");
    resultado[`puerta_asentamiento_${nn}`] = { nombre: `puerta de asentamiento (var ${nn})`, arquetipo: "PUERTA_ASENTAMIENTO", resolucion: U, ...modelo };
  }
  return resultado;
}

if (require.main === module) {
  const resultado = generarTodo();
  fs.writeFileSync(path.join(__dirname, "puerta_asentamiento_generada.json"), JSON.stringify(resultado));
  console.log(`Generadas ${Object.keys(resultado).length} variantes de puerta_asentamiento.`);
}

module.exports = { generarTodo, puertaAsentamiento, U, NUM_VARIANTES };
