"use strict";

// Bakeador de arenas de combate táctico (docs/GDD_Combate.md §9.4/§9.6, pedido
// 2026-08-30) — mapa NxN pequeño, MISMO formato indice.json+sector que el
// resto del proyecto (server/src/mundo/mapaColision.ts lo carga tal cual,
// cero parser nuevo): un terreno caminable homogéneo + decoración/obstáculos
// dispersos — nada de la cueva sellada de mazmorras/src/celular.js (esa
// reserva SIEMPRE el borde como pared, que en un grid táctico pequeño se
// comería parte del tablero; aquí no hace falta sala cerrada, la arena ya
// es un recorte finito por sí sola).
//
// Determinista por semilla (mulberry32, azar.js) — si la densidad pedida
// deja las dos zonas de aparición (izquierda/derecha) sin conectar, reintenta
// con la MISMA semilla + un sufijo de intento (nunca Math.random).
//
// Ampliado 2026-08-31 (pedido streamer: "crea alguno de cada bioma así vemos
// en PNG cómo quedó") con tres capacidades nuevas, todas opcionales y
// retrocompatibles (sin pasarlas, el resultado es BIT A BIT idéntico al de
// antes — mismos tests en verde):
//   - `decoracion`: lista PONDERADA de objetos (antes: uno solo fijo) — cada
//     casilla de obstáculo elige uno vía el `elegirPonderado` de siempre
//     (interiores/src/azar.js, mismo PRNG mulberry32, reusado en vez de
//     reinventado) con SU PROPIO stream de semilla (`${semilla}:deco`),
//     independiente del que decide QUÉ casillas son obstáculo — así la
//     lista de decoración puede crecer/cambiar sin perturbar la máscara de
//     conectividad ya probada.
//   - `patron`: modula la densidad por posición ("uniforme" = el
//     comportamiento de siempre; "denso-al-centro"/"pasillo-flanqueado"
//     quedan listas para las 3 variaciones por categoría que pactó el
//     streamer para la producción real — esta pasada de PRUEBA solo usa
//     "uniforme", ver TEMAS_PRUEBA más abajo).
//   - `agua`/`borde`: pintado de terreno SECUNDARIO opcional, capa aparte de
//     la máscara de obstáculos de siempre (nunca la toca): `agua` traza una
//     orilla+río con islas pequeñas dejando SIEMPRE seca la fila central
//     (ese "vado" ya lo garantizaba generarObstaculosArena desde el
//     principio — aquí solo se lee con otro nombre, no hace falta mecanismo
//     nuevo); `borde` pinta el anillo exterior (decoración densa, o un
//     terreno tipo muralla) para "cobertura en los bordes, centro despejado"
//     sin competir por presupuesto con la dispersión del interior. Ninguna
//     de las dos puede romper la conectividad garantizada: `agua` respeta la
//     fila central igual que los obstáculos, y `borde` vive en el anillo
//     x=0/x=ancho-1/y=0/y=alto-1, fuera del camino garantizado (spawns en
//     x=1/x=ancho-2).
//
// Verificación de compatibilidad de catálogo (antes de elegir ids, no
// asumido): `client/src/render3d/catalogoVisual.ts` y
// `server/src/mundo/mapaColision.ts` SOLO conocen objetos t:"v"/"r"/"a" de
// baker/catalogo/*.json y t:"m" de ciudades/catalogo/decoracion.json — los
// ids de interiores/catalogo/elementos.json (columna, estalagmita...) NO
// están enganchados a ninguno de los dos (ni color ni colisión), así que el
// tema "dungeon" de TEMAS_PRUEBA usa piedra real de baker/catalogo/rocas.json
// como plan B honesto en vez de forzar una referencia que pintaría magenta
// "desconocido" y no colisionaría en servidor.

const fs = require("fs");
const path = require("path");
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");
const { codificarPNG } = require("../../baker/src/png");

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
 * Multiplicador de densidad por posición — "uniforme" devuelve siempre 1
 * (densidad efectiva = densidad pedida, comportamiento de toda la vida).
 * Los otros dos patrones son las variaciones futuras que pactó el streamer
 * ("cada categoría pensada para 3 variaciones: denso/despejado/chokepoint")
 * — implementadas ya para que estén listas cuando toque la producción real,
 * aunque esta pasada de prueba solo use "uniforme" (ver TEMAS_PRUEBA).
 */
function modificadorDensidad(patron, x, y, ancho, alto, filaCentral) {
  if (patron === "denso-al-centro") {
    const dx = (x - ancho / 2) / (ancho / 2);
    const dy = (y - alto / 2) / (alto / 2);
    const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy)); // 0 centro .. 1 borde
    return 1.7 - 1.3 * dist; // más denso en el centro, casi limpio en el borde exterior
  }
  if (patron === "pasillo-flanqueado") {
    const distFila = Math.abs(y - filaCentral) / Math.max(1, alto / 2); // 0 en la fila central .. ~1 en el borde
    return 0.25 + 1.5 * distFila; // pasillo central casi despejado, flancos arriba/abajo cargados
  }
  return 1; // "uniforme"
}

/**
 * Genera la máscara de obstáculos de una arena — 0/1 por casilla,
 * `ancho*alto`. Garantiza que las columnas de aparición (x=1 a la
 * izquierda, x=ancho-2 a la derecha, fila central) queden SIEMPRE libres y
 * conectadas entre sí — nunca un combate imposible de empezar. `patron`
 * (opcional, default "uniforme") modula DÓNDE es más probable que salga
 * densidad sin tocar esa garantía — ver `modificadorDensidad`.
 */
function generarObstaculosArena({ ancho, alto, semilla, densidad = 0.15, patron = "uniforme" }) {
  const filaCentral = Math.floor(alto / 2);
  for (let intento = 0; intento < 20; intento++) {
    const rnd = crearPRNG(`${semilla}:${intento}`);
    const obstaculos = new Uint8Array(ancho * alto).fill(0);
    // recorrido y-externo/x-interno == recorrido lineal 0..length-1 (fila a
    // fila): con patron "uniforme" el multiplicador es constante 1, así que
    // esto tira EXACTAMENTE la misma secuencia de rnd() que el bucle plano
    // original — determinismo idéntico para quien no pase `patron`.
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const umbral = densidad * modificadorDensidad(patron, x, y, ancho, alto, filaCentral);
        if (rnd() < umbral) obstaculos[y * ancho + x] = 1;
      }
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
 * Pintado de terreno SECUNDARIO opcional (tema acuático): orilla desde el
 * borde superior con un límite que serpentea columna a columna (paso
 * acotado ±1, nunca una línea recta ni ruido sin control = costa
 * orgánica), un brazo de río que baja pegado a un lateral hasta el borde
 * opuesto, un par de islas pequeñas (claros secos dentro de la orilla) y el
 * "vado": la fila central (±`anchoVado`) se deja SIEMPRE seca — reutiliza
 * el mismo criterio que ya usa `generarObstaculosArena` para garantizar la
 * conectividad, así que un vado real (fila central) siempre cruza el agua
 * de lado a lado sin mecanismo nuevo. Devuelve una máscara 0/1 (`ancho*alto`,
 * 1=agua) — capa independiente de la de obstáculos, se combina en
 * `exportarArena`.
 */
function generarMascaraAgua({ ancho, alto, semilla, filaCentral, anchoVado = 1 }) {
  const rnd = crearPRNG(`${semilla}:agua`);
  const agua = new Uint8Array(ancho * alto);
  const esVado = (y) => Math.abs(y - filaCentral) <= anchoVado;

  const alturaBase = Math.max(2, Math.round(alto * 0.34));
  const limitePorColumna = new Array(ancho);
  let limite = alturaBase;
  for (let x = 0; x < ancho; x++) {
    limite = Math.max(1, Math.min(alturaBase + 2, limite + Math.round((rnd() - 0.5) * 2)));
    limitePorColumna[x] = limite;
    for (let y = 0; y < limite; y++) {
      if (esVado(y)) continue;
      agua[y * ancho + x] = 1;
    }
  }

  // brazo de río: franja estrecha bajando desde la orilla hacia el borde
  // opuesto, pegada a un lateral (evita las columnas extremas x=0/ancho-1,
  // que son las que pinta `generarBorde`) — la "R" de Río del tema.
  const xRio = Math.min(ancho - 4, ancho - 2);
  for (let y = limitePorColumna[Math.max(0, xRio)] ?? alturaBase; y < alto; y++) {
    if (esVado(y)) continue;
    for (const x of [xRio - 1, xRio, xRio + 1]) {
      if (x >= 1 && x < ancho - 1) agua[y * ancho + x] = 1;
    }
  }

  // islas pequeñas: un par de claros secos dentro de la orilla
  const islas = [
    [Math.round(ancho * 0.28), Math.round(alturaBase * 0.4)],
    [Math.round(ancho * 0.58), Math.round(alturaBase * 0.6)],
  ];
  for (const [cx, cy] of islas) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= ancho || y >= alto || esVado(y)) continue;
        agua[y * ancho + x] = 0;
      }
    }
  }

  return agua;
}

/**
 * Anillo del borde exterior (x=0, x=ancho-1, y=0, y=alto-1) — decoración
 * densa (o un terreno tipo muralla, si se pide `terreno`) para dar
 * "cobertura en los bordes" sin gastar presupuesto de densidad del interior
 * disperso (pedido streamer: "zona jugable central despejada... decoración
 * en los bordes"). NUNCA toca x=1/x=ancho-2 (columnas de spawn) ni compite
 * con la garantía de conectividad: vive fuera del camino que
 * `generarObstaculosArena` protege, así que no necesita BFS propio.
 * `lados`/`filas` permiten un anillo parcial (el tema urbano solo pinta
 * `filas` — fachadas arriba/abajo de una calle que sigue más allá del
 * recorte por los laterales).
 */
function generarBorde({ ancho, alto, semilla, cobertura = 0.85, lados = true, filas = true }) {
  const rnd = crearPRNG(`${semilla}:borde`);
  const borde = new Uint8Array(ancho * alto);
  if (filas) {
    for (let x = 0; x < ancho; x++) {
      if (rnd() < cobertura) borde[0 * ancho + x] = 1;
      if (rnd() < cobertura) borde[(alto - 1) * ancho + x] = 1;
    }
  }
  if (lados) {
    for (let y = 0; y < alto; y++) {
      if (rnd() < cobertura) borde[y * ancho + 0] = 1;
      if (rnd() < cobertura) borde[y * ancho + (ancho - 1)] = 1;
    }
  }
  return borde;
}

/**
 * Exporta una arena bakeada a `rutaSalida` (indice.json + un único
 * sector_000_000.json — la arena entera cabe en un chunk) — mismo formato
 * que lee `server/src/mundo/mapaColision.ts`, verificado contra ESE loader
 * en `server/test/` (no un formato inventado aparte).
 *
 * `decoracion` (opcional): lista PONDERADA `[{i,t,peso?}, ...]` — por
 * defecto, la roca única de siempre con peso 1 (retrocompatible al 100%:
 * con un solo elemento, `elegirPonderado` lo devuelve siempre, así que el
 * resultado es idéntico a antes). `agua`/`borde` (opcionales): ver
 * `generarMascaraAgua`/`generarBorde` — ninguno de los dos se activa si no
 * se pide explícitamente.
 */
function exportarArena({
  id,
  ancho,
  alto,
  semilla,
  rutaSalida,
  densidad = 0.15,
  patron = "uniforme",
  terreno = TERRENO_SUELO,
  decoracion = [{ ...OBJETO_OBSTACULO, peso: 1 }],
  agua = null, // { terreno: "agua", anchoVado?: number }
  borde = null, // { terreno?: string, cobertura?: number, lados?: boolean, filas?: boolean }
}) {
  const filaCentral = Math.floor(alto / 2);
  const obstaculos = generarObstaculosArena({ ancho, alto, semilla, densidad, patron });
  const mascaraAgua = agua ? generarMascaraAgua({ ancho, alto, semilla, filaCentral, ...agua }) : null;
  const mascaraBorde = borde ? generarBorde({ ancho, alto, semilla, ...borde }) : null;

  // leyenda: base siempre en índice 0 (retrocompatible); agua/borde-terreno
  // solo se añaden si se piden, así una llamada sin ellos deja
  // leyendaTerreno EXACTAMENTE como antes ([terreno]).
  const leyendaTerreno = [terreno];
  const idxAgua = agua ? leyendaTerreno.push(agua.terreno) - 1 : -1;
  const idxBordeTerreno = borde && borde.terreno ? leyendaTerreno.push(borde.terreno) - 1 : -1;

  const rndDecoracion = crearPRNG(`${semilla}:deco`);
  const listaPonderada = decoracion.map((d) => [d, d.peso ?? 1]);

  // terreno: SIEMPRE se escribe el cuadrado completo lado*lado (igual que
  // antes) — agua/borde-terreno solo pintan dentro del rectángulo ancho x
  // alto real; lo que quede fuera (mapas no cuadrados) se queda en el
  // índice 0 (terreno base), igual que el "0".repeat(lado*lado) de siempre.
  const lado = Math.max(ancho, alto);
  const digitos = new Array(lado * lado).fill("0");

  const objetos = [];
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      const enAgua = mascaraAgua ? mascaraAgua[i] === 1 : false;
      const enBordeConTerreno = idxBordeTerreno >= 0 && mascaraBorde[i] === 1 && !enAgua;
      if (enAgua) digitos[y * lado + x] = idxAgua.toString(36);
      else if (enBordeConTerreno) digitos[y * lado + x] = idxBordeTerreno.toString(36);
      // si no, se queda en "0" (terreno base) — ya inicializado arriba

      if (enAgua || enBordeConTerreno) continue; // agua/muro: nada suelto encima

      // decoración de borde SOLO cuando ese borde no es ya un terreno tipo
      // muralla (idxBordeTerreno<0) — evita objetos flotando sobre el muro
      const enBordeDecorado = idxBordeTerreno < 0 && mascaraBorde && mascaraBorde[i] === 1;
      if (enBordeDecorado || obstaculos[i] === 1) {
        const elegido = elegirPonderado(listaPonderada, rndDecoracion);
        objetos.push({ i: elegido.i, t: elegido.t, x, y });
      }
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
        tamanoChunk: lado,
        tamanoSectorChunks: 1,
        leyendaTerreno,
        portales: [],
        parcelasReservadas: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(rutaSalida, "sector_000_000.json"),
    JSON.stringify({ chunks: { "0_0": { terreno: digitos.join(""), tamano: lado, objetos } } }),
  );

  const numAgua = mascaraAgua ? mascaraAgua.reduce((s, v) => s + v, 0) : 0;
  return { ancho, alto, semilla, obstaculos: objetos.length, agua: numAgua };
}

/**
 * Previsualización PNG rápida (pedido streamer, "así vemos en PNG cómo
 * quedó") — MISMO mecanismo que `ciudades/src/index.js:exportarOverview`
 * (colorDebug de catálogo, terreno de fondo + objetos encima, escala
 * arriba): relee del disco lo que acaba de escribir `exportarArena`, así
 * que también sirve para previsualizar cualquier arena YA bakeada sin
 * volver a generarla. Catálogos resueltos por tipo exactamente como
 * `client/src/render3d/catalogoVisual.ts` (v=vegetacion, r=rocas,
 * a=animales, m=decoracion de ciudades/) — un id sin entrada pinta magenta
 * "#ff00ff", igual que el resto del proyecto marca "desconocido".
 */
const RAIZ_REPO = path.join(__dirname, "..", "..");
const CATALOGO_TERRENOS = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "terrenos.json"), "utf8"));
const CATALOGOS_POR_TIPO = {
  v: JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "vegetacion.json"), "utf8")),
  r: JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "rocas.json"), "utf8")),
  a: JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "baker", "catalogo", "animales.json"), "utf8")),
  m: JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, "ciudades", "catalogo", "decoracion.json"), "utf8")),
};
const COLOR_DESCONOCIDO = "#ff00ff";

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function previsualizarArena(rutaArena, rutaPng, escala = 20) {
  const indice = JSON.parse(fs.readFileSync(path.join(rutaArena, "indice.json"), "utf8"));
  const sector = JSON.parse(fs.readFileSync(path.join(rutaArena, "sector_000_000.json"), "utf8"));
  const chunk = sector.chunks["0_0"];
  const lado = chunk.tamano;

  const rgba = Buffer.alloc(lado * escala * lado * escala * 4);
  const pinta = (x, y, [r, g, b]) => {
    for (let dy = 0; dy < escala; dy++) {
      for (let dx = 0; dx < escala; dx++) {
        const i = ((y * escala + dy) * lado * escala + x * escala + dx) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
      }
    }
  };

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const idT = indice.leyendaTerreno[parseInt(chunk.terreno[y * lado + x], 36)];
      pinta(x, y, hexRGB(CATALOGO_TERRENOS[idT]?.colorDebug || COLOR_DESCONOCIDO));
    }
  }
  for (const obj of chunk.objetos) {
    const color = CATALOGOS_POR_TIPO[obj.t]?.[obj.i]?.colorDebug || COLOR_DESCONOCIDO;
    pinta(obj.x, obj.y, hexRGB(color));
  }
  // spawns (fila central, columnas x=1 / x=lado-2) en un cian que no existe
  // en ningún colorDebug del proyecto — referencia visual rápida de dónde
  // entra cada bando.
  const filaCentral = Math.floor(lado / 2);
  pinta(1, filaCentral, [40, 220, 220]);
  pinta(lado - 2, filaCentral, [40, 220, 220]);

  fs.writeFileSync(rutaPng, codificarPNG(lado * escala, lado * escala, rgba));
  return { lado, objetos: chunk.objetos.length };
}

// --- 4 temas de PRUEBA (pedido streamer 2026-08-31: "crea alguno de cada
// bioma así vemos en PNG cómo quedó") — 1 arena representativa por
// categoría, NO el catálogo de producción real (mazmorras/catalogo/arenas.json,
// que sigue con sus 3 entradas de siempre). Cada entrada ya trae
// densidad/patron/decoracion/agua/borde listos: cuando el streamer apruebe
// y toque generar las 3 variaciones por categoría de verdad, esto es
// exactamente el punto de partida (cambiar semilla y, si se quiere,
// `densidad`/`patron` para la variante "densa"/"chokepoint").
const TEMAS_PRUEBA = {
  acuatico: {
    ancho: 24,
    alto: 24,
    densidad: 0.06,
    patron: "uniforme",
    terreno: "barro", // orilla/vado embarrado, transitable (baker/catalogo/terrenos.json)
    decoracion: [
      { i: "roca_musgosa", t: "r", peso: 3 }, // "rocas húmedas" pedidas
      { i: "junco", t: "v", peso: 4 },
      { i: "espadana", t: "v", peso: 3 },
      { i: "musgo_de_turbera", t: "v", peso: 2 },
      { i: "sauce", t: "v", peso: 2 }, // vegetación ribereña, además cobertura (colision:true)
      { i: "juncos_de_playa", t: "v", peso: 2 },
    ],
    agua: { terreno: "agua", anchoVado: 1 }, // orilla + río + vado + islas (generarMascaraAgua)
    borde: { cobertura: 0.7 },
  },
  bosque: {
    ancho: 22,
    alto: 22,
    densidad: 0.09,
    patron: "uniforme",
    terreno: "cesped",
    decoracion: [
      { i: "pino", t: "v", peso: 3 },
      { i: "abeto", t: "v", peso: 3 },
      { i: "roble", t: "v", peso: 2 },
      { i: "arbol_joven", t: "v", peso: 2 },
      { i: "arbol_viejo", t: "v", peso: 1 },
      { i: "arbusto_comun", t: "v", peso: 3 },
      { i: "seto_silvestre", t: "v", peso: 2 },
      { i: "granito", t: "r", peso: 2 },
      { i: "roca_musgosa", t: "r", peso: 1 },
    ],
    borde: { cobertura: 0.85 }, // "árboles periféricos"
  },
  urbano: {
    ancho: 22,
    alto: 22,
    densidad: 0.08,
    patron: "uniforme",
    terreno: "adoquin", // suelo urbano real (baker/catalogo/terrenos.json)
    decoracion: [
      { i: "barril", t: "m", peso: 3 },
      { i: "caja_madera", t: "m", peso: 3 },
      { i: "carreta", t: "m", peso: 1 },
      { i: "puesto_mercado", t: "m", peso: 1 },
      { i: "farola_calle", t: "m", peso: 2 },
      { i: "valla_madera", t: "m", peso: 2 },
      { i: "tinaja_barro", t: "m", peso: 1 },
    ],
    // fachadas SOLO arriba/abajo (una calle que sigue más allá del recorte
    // por los laterales, no una plaza cerrada) — muralla_piedra se extruye
    // como caja 3D real en sectorVisual.ts (ALTURA_TERRENO_SOLIDO), así que
    // esto no es solo color: en cliente ya se ve como fachada de verdad.
    borde: { terreno: "muralla_piedra", cobertura: 0.92, lados: false, filas: true },
  },
  dungeon: {
    ancho: 20,
    alto: 20,
    densidad: 0.1,
    patron: "uniforme",
    terreno: "roca", // suelo de piedra/cueva, transitable (baker/catalogo/terrenos.json)
    // PLAN B documentado (ver cabecera del archivo): columna/estalagmita de
    // interiores/catalogo/elementos.json NO están enganchadas a
    // sectorVisual.ts/catalogoVisual.ts ni a mapaColision.ts para objetos
    // sueltos de sector exterior — usamos piedra real de rocas.json en su
    // lugar (SÍ confirmada en ambos: color de cliente y colisión de servidor).
    decoracion: [
      { i: "granito", t: "r", peso: 3 }, // columnas/pilares (plan B)
      { i: "roca_caliza", t: "r", peso: 2 }, // formación pálida, lee como estalagmita
      { i: "canto_rodado", t: "r", peso: 2 }, // escombros/cascotes
      { i: "pizarra", t: "r", peso: 1 },
      { i: "veta_hierro", t: "r", peso: 1 }, // veta mineral, variedad de color
    ],
    borde: { cobertura: 0.8 },
  },
};

module.exports = {
  generarObstaculosArena,
  exportarArena,
  generarMascaraAgua,
  generarBorde,
  previsualizarArena,
  TEMAS_PRUEBA,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const temaFlag = argv.find((a) => a.startsWith("--tema="));

  if (temaFlag) {
    const nombreTema = temaFlag.slice("--tema=".length);
    const [id, semilla, anchoArg, altoArg] = argv.filter((a) => a !== temaFlag);
    const tema = TEMAS_PRUEBA[nombreTema];
    if (!tema || !id || !semilla) {
      console.error(`Uso: node generarArena.js --tema=<${Object.keys(TEMAS_PRUEBA).join("|")}> <id> <semilla> [ancho] [alto]`);
      process.exit(1);
    }
    const { ancho: anchoTema, alto: altoTema, ...config } = tema;
    const ancho = Number(anchoArg) || anchoTema;
    const alto = Number(altoArg) || altoTema;
    const rutaSalida = path.join(__dirname, "..", "..", "assets", "mapas", "arenas", id);
    const resultado = exportarArena({ id, ancho, alto, semilla, rutaSalida, ...config });
    console.log(
      `Arena temática "${nombreTema}" -> "${id}" (${ancho}x${alto}, semilla=${semilla}): ${resultado.obstaculos} objetos, ${resultado.agua} casillas de agua -> ${rutaSalida}`,
    );
  } else {
    const [id, semilla, anchoArg, altoArg, terrenoArg, densidadArg] = argv;
    if (!id || !semilla) {
      console.error("Uso: node generarArena.js <id> <semilla> [ancho=8] [alto=8] [terreno=cesped] [densidad=0.15]");
      console.error(`   o: node generarArena.js --tema=<${Object.keys(TEMAS_PRUEBA).join("|")}> <id> <semilla> [ancho] [alto]`);
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
}
