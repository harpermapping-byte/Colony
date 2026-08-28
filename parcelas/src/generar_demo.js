#!/usr/bin/env node
"use strict";

// Genera el parcelas.json DEMO del mapa principal usando la varita
// programáticamente (GDD_Construccion §1): 3 parcelas orgánicas cerca de la
// ciudad (1600,1600), semillas y tamaños FIJOS → el archivo resultante es
// byte a byte el mismo en cada ejecución (determinismo, regla 3).
//
// Uso: node parcelas/src/generar_demo.js
// Escribe assets/mapas/principal/parcelas.json ya validado (0 vetadas, 0 solapes).

const fs = require("fs");
const path = require("path");

const Mascara = require("./mascara");
const { crecimientoParcela, terrenoVetado } = require("./varita");
const { crearLectorMapa, validarParcelas } = require("../gui/servidor");
const { crearPRNG } = require("../../interiores/src/azar");

const RAIZ_REPO = path.join(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ_REPO, "assets", "mapas", "principal");

// Las 3 parcelas pactadas: alrededor de la ciudad, con sabor medieval y el
// asentamiento "ciudad" (el id que usará el jarl para asignarlas).
const PARCELAS_DEMO = [
  // 400 y no 300: la varita solo veta TERRENO, no props del bake — con 300
  // casillas ninguna zona 6x7 de p_0001 quedaba libre de rocas y un edificio
  // (casa_humilde, 7x6) no cabía; con 400 hay hueco limpio verificado
  // (client/test/construccion.e2e.cjs construye ahí de verdad).
  { nombre: "Huerto de Levante", semilla: [1680, 1600], objetivo: 400, semillaPRNG: "parcela-demo-1" },
  { nombre: "Prado del Herrero", semilla: [1600, 1680], objetivo: 450, semillaPRNG: "parcela-demo-2" },
  { nombre: "Bancal de la Vieja Muralla", semilla: [1520, 1600], objetivo: 220, semillaPRNG: "parcela-demo-3" },
];

function generarDemo() {
  const lector = crearLectorMapa(RUTA_MAPA);
  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "terrenos.json"), "utf8"));
  const ocupadas = new Set(); // claves de parcelas ya creadas: veto "otra parcela"

  const esParcelable = (x, y) => {
    const t = lector.terrenoEn(x, y);
    if (t === null || terrenoVetado(t, terrenos[t])) return false;
    return !ocupadas.has(Mascara.clave(x, y, lector.anchoMapa));
  };

  // La semilla nominal puede caer en camino/solar de la ciudad: se busca la
  // casilla válida más cercana en espiral determinista (orden fijo de barrido).
  function semillaValida(x0, y0) {
    for (let r = 0; r < 64; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // solo el anillo r
          if (esParcelable(x0 + dx, y0 + dy)) return [x0 + dx, y0 + dy];
        }
      }
    }
    throw new Error(`sin casilla parcelable cerca de (${x0},${y0})`);
  }

  const parcelas = {};
  PARCELAS_DEMO.forEach((def, i) => {
    const [sx, sy] = semillaValida(def.semilla[0], def.semilla[1]);
    const { casillas, completo } = crecimientoParcela({
      esValida: esParcelable,
      semillaX: sx,
      semillaY: sy,
      objetivo: def.objetivo,
      rnd: crearPRNG(def.semillaPRNG),
      anchoMapa: lector.anchoMapa,
    });
    if (!completo) throw new Error(`"${def.nombre}" se quedó en ${casillas.size}/${def.objetivo} casillas — mover la semilla`);
    for (const k of casillas) ocupadas.add(k);
    const id = `p_${String(i + 1).padStart(4, "0")}`;
    parcelas[id] = {
      asentamiento: "ciudad",
      nombre: def.nombre,
      runs: Mascara.aRuns(casillas, lector.anchoMapa),
      casillas: casillas.size,
      topeProps: Math.round(casillas.size / 5), // regla del GDD §1
    };
    console.log(`${id} "${def.nombre}": ${casillas.size} casillas desde (${sx},${sy})`);
  });

  const datos = {
    version: 1,
    mapa: lector.indice.nombre,
    siguienteId: PARCELAS_DEMO.length + 1,
    parcelas,
  };

  // Validación final con EXACTAMENTE la misma función que usa el POST de la
  // GUI — si esto no pasa, el archivo no se escribe.
  const veredicto = validarParcelas(datos, lector, terrenos);
  if (!veredicto.ok) throw new Error("demo inválida: " + veredicto.motivo);

  const rutaSalida = path.join(RUTA_MAPA, "parcelas.json");
  fs.writeFileSync(rutaSalida, JSON.stringify(datos, null, 2) + "\n");
  console.log(`OK → ${rutaSalida}`);
  return datos;
}

if (require.main === module) generarDemo();
module.exports = { generarDemo, PARCELAS_DEMO, RUTA_MAPA };
