"use strict";

// Bakeador de arenas de combate táctico (docs/GDD_Combate.md §9.4, pedido
// 2026-08-30) — mapa NxN pequeño, MISMO formato indice.json+sector que el
// resto del proyecto (server/src/mundo/mapaColision.ts lo carga tal cual,
// cero parser nuevo): un terreno caminable homogéneo + un puñado de rocas
// (`granito`, ya con colision:true en baker/catalogo/rocas.json) dispersas
// como cobertura — nada de la cueva sellada de mazmorras/src/celular.js
// (esa reserva SIEMPRE el borde como pared, que en un grid táctico de 8x8
// se comería un cuarto del tablero; aquí no hace falta sala cerrada, la
// arena ya es un recorte finito por sí sola).
//
// Determinista por semilla (mulberry32, azar.js) — si la densidad pedida
// deja las dos zonas de aparición (izquierda/derecha) sin conectar, reintenta
// con la MISMA semilla + un sufijo de intento (nunca Math.random).

const fs = require("fs");
const path = require("path");
const { crearPRNG } = require("../../interiores/src/azar");

const TERRENO_SUELO = "cesped"; // transitable, sin nadar (baker/catalogo/terrenos.json)
const OBJETO_OBSTACULO = { i: "granito", t: "r" }; // colision:true real (baker/catalogo/rocas.json)

/** BFS 4-vecinos sobre `libre` (Uint8Array, 1=libre) — ¿son (x0,y0) y (x1,y1) la misma región? */
function conectados(libre, ancho, alto, x0, y0, x1, y1) {
  if (!libre[y0 * ancho + x0] || !libre[y1 * ancho + x1]) return false;
  const visitado = new Uint8Array(ancho * alto);
  const cola = [[x0, y0]];
  visitado[y0 * ancho + x0] = 1;
  while (cola.length) {
    const [cx, cy] = cola.pop();
    if (cx === x1 && cy === y1) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const k = ny * ancho + nx;
      if (!libre[k] || visitado[k]) continue;
      visitado[k] = 1;
      cola.push([nx, ny]);
    }
  }
  return false;
}

/**
 * Genera la máscara de obstáculos de una arena — 0/1 por casilla,
 * `ancho*alto`. Garantiza que las columnas de aparición (x=1 a la
 * izquierda, x=ancho-2 a la derecha, fila central) queden SIEMPRE libres y
 * conectadas entre sí — nunca un combate imposible de empezar.
 */
function generarObstaculosArena({ ancho, alto, semilla, densidad = 0.15 }) {
  const filaCentral = Math.floor(alto / 2);
  for (let intento = 0; intento < 20; intento++) {
    const rnd = crearPRNG(`${semilla}:${intento}`);
    const obstaculos = new Uint8Array(ancho * alto).fill(0);
    for (let i = 0; i < obstaculos.length; i++) {
      if (rnd() < densidad) obstaculos[i] = 1;
    }
    // las dos columnas de aparición y la fila central siempre libres —
    // conecta ambos lados sin depender del azar para lo mínimo jugable
    for (let x = 0; x < ancho; x++) obstaculos[filaCentral * ancho + x] = 0;
    obstaculos[filaCentral * ancho + 1] = 0;
    obstaculos[filaCentral * ancho + (ancho - 2)] = 0;

    const libre = new Uint8Array(ancho * alto);
    for (let i = 0; i < obstaculos.length; i++) libre[i] = obstaculos[i] ? 0 : 1;
    if (conectados(libre, ancho, alto, 1, filaCentral, ancho - 2, filaCentral)) return obstaculos;
  }
  // 20 intentos sin conectar (densidad demasiado alta para el tamaño): sin
  // obstáculos, mejor una arena vacía que una imposible de jugar
  return new Uint8Array(ancho * alto).fill(0);
}

/**
 * Exporta una arena bakeada a `rutaSalida` (indice.json + un único
 * sector_000_000.json — la arena entera cabe en un chunk) — mismo formato
 * que lee `server/src/mundo/mapaColision.ts`, verificado contra ESE loader
 * en `server/test/` (no un formato inventado aparte).
 */
function exportarArena({ id, ancho, alto, semilla, rutaSalida, densidad = 0.15, terreno = TERRENO_SUELO, objetoObstaculo = OBJETO_OBSTACULO }) {
  const obstaculos = generarObstaculosArena({ ancho, alto, semilla, densidad });

  const objetos = [];
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (obstaculos[y * ancho + x]) objetos.push({ ...objetoObstaculo, x, y });
    }
  }

  fs.mkdirSync(rutaSalida, { recursive: true });
  fs.writeFileSync(
    path.join(rutaSalida, "indice.json"),
    JSON.stringify(
      {
        nombre: id,
        anchoChunks: 1,
        altoChunks: 1,
        tamanoChunk: Math.max(ancho, alto),
        tamanoSectorChunks: 1,
        leyendaTerreno: [terreno],
        portales: [],
        parcelasReservadas: [],
      },
      null,
      2,
    ),
  );
  // terreno homogéneo (índice 0 = TERRENO_SUELO): un dígito '0' por casilla,
  // fila a fila — el chunk siempre es cuadrado (tamanoChunk = max(ancho,alto)),
  // así que se rellena hasta ese lado y el resto simplemente no se pisa
  const lado = Math.max(ancho, alto);
  const digitosTerreno = "0".repeat(lado * lado);
  fs.writeFileSync(
    path.join(rutaSalida, "sector_000_000.json"),
    JSON.stringify({ chunks: { "0_0": { terreno: digitosTerreno, tamano: lado, objetos } } }),
  );

  return { ancho, alto, semilla, obstaculos: objetos.length };
}

module.exports = { generarObstaculosArena, exportarArena };

if (require.main === module) {
  const [, , id, semilla, anchoArg, altoArg, terrenoArg, densidadArg] = process.argv;
  if (!id || !semilla) {
    console.error("Uso: node generarArena.js <id> <semilla> [ancho=8] [alto=8] [terreno=cesped] [densidad=0.15]");
    process.exit(1);
  }
  const ancho = Number(anchoArg) || 8;
  const alto = Number(altoArg) || 8;
  const terreno = terrenoArg || TERRENO_SUELO;
  // Combate acuático (docs/GDD_Barcos.md, pedido 2026-08-30): una arena de
  // agua no lleva las mismas rocas de cobertura por defecto — se puede
  // pedir densidad=0 desde la CLI (orcas/tiburones nadan a mar abierto).
  const densidad = densidadArg !== undefined ? Number(densidadArg) : 0.15;
  const rutaSalida = path.join(__dirname, "..", "..", "assets", "mapas", "arenas", id);
  const resultado = exportarArena({ id, ancho, alto, semilla, rutaSalida, terreno, densidad });
  console.log(`Arena "${id}" (${ancho}x${alto}, semilla=${semilla}, terreno=${terreno}): ${resultado.obstaculos} obstáculos -> ${rutaSalida}`);
}
