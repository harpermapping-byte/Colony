"use strict";
// CLI del bakeador de ciudades ORGÁNICO:
//   node ciudades/src/index.js <tier> <semilla> [carpetaSalida]
//
// Salidas del MISMO bake (GDD_Bakeador_POIs §4):
// - sector_XXX_YYY.json + indice.json — formato del baker exterior
//   (crearExportador reutilizado): cliente y servidor los consumen sin
//   cambios. El indice añade la CAPA VECTORIAL: `portales`, `muralla`
//   (módulos recto/torre/puerta con posición+rotación+material), `caminos`
//   (polilíneas) y `tier`/`variante` — de ahí saldrán los .glb reales que
//   sustituyan a los placeholders (programa del usuario).
// - interiores/<edificioId>.json — bake anidado del motor de interiores.
// - overview.png — placeholder 2D a color para revisar el layout.

const fs = require("fs");
const path = require("path");
const { generarCiudad, validarCiudad } = require("./generar");
const { cargarCatalogos } = require("../../interiores/src/catalogo");
const { crearExportador } = require("../../baker/src/exportar");
const { codificarPNG } = require("../../baker/src/png");
const { semillaDesdeTexto } = require("../../baker/src/ruido");

const RAIZ = path.join(__dirname, "..", "..");
const TAMANO_CHUNK = 8; // el generador redondea el lado del mapa a múltiplos de 8
// taller-vox/generar_edificio.js "todo" exporta 4 variantes por tipoEdificioId
// (assets/edificios/<tipo>_01..04.glb) — mismo número aquí para elegir una
// determinista por edificio (GDD_Motor_3D_Props, enganche rápido de arte).
const VARIANTES_EDIFICIO = 4;

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function exportarCiudad(ciudad, carpetaSalida) {
  const { terreno, elevacion, ancho, alto } = ciudad;
  const anchoChunks = ancho / TAMANO_CHUNK;
  const altoChunks = alto / TAMANO_CHUNK;

  const leyenda = [...new Set(terreno.datos)].sort();
  const exportador = crearExportador(carpetaSalida, leyenda, anchoChunks, altoChunks);

  // ancla visual por edificio (t:"e" = estructura): el placeholder del
  // cliente pintará una caja con la huella; el .glb real llegará por
  // convención edificios/<tipo>_NN.glb con la MISMA rotación `ro`
  const objetosPorChunk = new Map();
  const meterObjeto = (gx, gy, objeto) => {
    const cxCh = Math.floor(gx / TAMANO_CHUNK), cyCh = Math.floor(gy / TAMANO_CHUNK);
    const clave = `${cxCh}_${cyCh}`;
    if (!objetosPorChunk.has(clave)) objetosPorChunk.set(clave, []);
    objetosPorChunk.get(clave).push({ ...objeto, x: Math.floor(gx) - cxCh * TAMANO_CHUNK, y: Math.floor(gy) - cyCh * TAMANO_CHUNK });
  };
  for (const ed of ciudad.edificios) {
    // UNA caja por PIEZA (cuerpo + cada ala en L/T/U), no una sola por
    // edificio — con una sola caja del tamaño del cuerpo, un edificio en L
    // dejaba el ala entera fuera de la caja: se veía el terreno
    // "solar_edificio" (tierra sucia) asomando donde el ala ocupaba
    // terreno pero no había caja encima (bug visual reportado). Misma
    // rotación de pieza-a-mundo que generar.js:rasterizarPiezas, para que
    // cada caja caiga EXACTO sobre el hueco que esa pieza rasterizó.
    const angulo = (ed.rot * Math.PI) / 180;
    const cosA = Math.cos(angulo), sinA = Math.sin(angulo);
    // Determinista por edificio (mismo criterio que el resto del bakeador:
    // misma semilla = mismo resultado siempre), no por pieza — todas las
    // alas de un mismo edificio en L/T/U comparten fachada/material.
    const va = semillaDesdeTexto(ed.semillaInterior) % VARIANTES_EDIFICIO;
    for (const p of ed.piezas) {
      const wx = ed.cx + p.ox * cosA - p.oy * sinA;
      const wy = ed.cy + p.oy * cosA + p.ox * sinA;
      // dx/dy: parte fraccionaria del centro real, que el redondeo a
      // casilla entera de meterObjeto pierde — sin esto la caja 3D del
      // cliente podía quedar hasta ~0.7 casillas desplazada de la huella
      // real del terreno. Solo hace falta en edificios: el resto de props
      // (árboles/deco) no necesitan precisión sub-casilla.
      meterObjeto(wx, wy, {
        i: ed.tipoEdificioId, t: "e", va, ro: ed.rot, es: 1, w: p.w, h: p.h,
        dx: wx - Math.floor(wx), dy: wy - Math.floor(wy),
      });
    }
  }
  // capa de vegetación: árboles/arbustos como vegetación normal del baker
  // (el cliente ya los instancia; la colisión la decide su catálogo)
  for (const a of ciudad.arboles || []) meterObjeto(a.x, a.y, { i: a.i, t: "v", va: a.va, ro: a.ro, es: a.es });
  // capa de decoración urbana (t:"m", catálogo ciudades/decoracion.json)
  for (const d of ciudad.deco || []) meterObjeto(d.x, d.y, { i: d.i, t: "m", va: d.va, ro: d.ro, es: d.es });

  for (let cy = 0; cy < altoChunks; cy++) {
    for (let cx = 0; cx < anchoChunks; cx++) {
      const casillas = [], elev = [];
      for (let y = 0; y < TAMANO_CHUNK; y++)
        for (let x = 0; x < TAMANO_CHUNK; x++) {
          const gx = cx * TAMANO_CHUNK + x, gy = cy * TAMANO_CHUNK + y;
          casillas.push(terreno.get(gx, gy));
          elev.push(elevacion[gy * ancho + gx].toString(36));
        }
      exportador.agregarChunk(cx, cy, TAMANO_CHUNK, casillas, objetosPorChunk.get(`${cx}_${cy}`) || [], [], elev.join(""));
    }
  }

  exportador.finalizar({
    nombre: `${ciudad.tier}-${ciudad.semilla}`,
    semilla: ciudad.semilla,
    tier: ciudad.tier,
    variante: ciudad.variante,
    anchoChunks, altoChunks, tamanoChunk: TAMANO_CHUNK,
    ciudad: { x: ciudad.spawn.x, y: ciudad.spawn.y },
    portales: ciudad.portales,
    muralla: { poligono: ciudad.poligonoMuralla.map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)]), modulos: ciudad.modulosMuralla },
    caminos: ciudad.caminos.map((r) => r.map((p) => [p.x, p.y])),
    zonasVerdes: ciudad.zonasVerdes || [],
    // CANAL DE ILUMINACIÓN: cuando exista el ciclo día/noche, el cliente
    // enciende aquí sus luces (posición + radio + color por farola/antorcha)
    luces: ciudad.luces || [],
    // PLAN DE SUELO por edificio: la forma REAL que decidió este bakeador
    // (jitter ±1 + alas L/T/U en coords locales, puerta en +Y). De aquí lee
    // taller-vox/generar_edificios_ciudad.js para que el .glb de cada casa
    // salga con exactamente la huella que se rasterizó en el terreno — la
    // semilla es la misma del interior anidado, así fachada e interior
    // siempre nacen del mismo tiro de dados.
    edificios: ciudad.edificios.map((ed) => ({
      id: ed.interior.id,
      tipo: ed.tipoEdificioId,
      semilla: ed.semillaInterior,
      cx: ed.cx, cy: ed.cy, rot: ed.rot,
      w: ed.w, h: ed.h, piezas: ed.piezas,
      puerta: ed.puerta,
    })),
  });
}

function exportarInteriores(ciudad, carpetaSalida) {
  const carpeta = path.join(carpetaSalida, "interiores");
  fs.mkdirSync(carpeta, { recursive: true });
  for (const ed of ciudad.edificios) {
    fs.writeFileSync(path.join(carpeta, `${ed.interior.id}.json`), JSON.stringify(ed.interior));
  }
}

// Placeholder 2D: colorDebug de terrenos; edificios por riqueza (tejado) con
// su puerta marcada; puertas de muralla en claro; sombreado sutil por altura.
const COLOR_RIQUEZA = { humilde: "#8a6a4a", modesta: "#a3762e", noble: "#7a3e8a" };

function exportarOverview(ciudad, carpetaSalida, terrenos, tiposEdificio, escala = 4) {
  const { terreno, elevacion, ancho, alto } = ciudad;
  const rgba = Buffer.alloc(ancho * escala * alto * escala * 4);
  const pinta = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= ancho || y >= alto) return;
    for (let dy = 0; dy < escala; dy++)
      for (let dx = 0; dx < escala; dx++) {
        const i = ((y * escala + dy) * ancho * escala + x * escala + dx) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
      }
  };
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = hexRGB(terrenos[terreno.get(x, y)]?.colorDebug || "#ff00ff");
      // luz por altura: el relieve se LEE en el placeholder (±14%)
      const luz = 0.86 + (elevacion[y * ancho + x] / 35) * 0.28;
      pinta(x, y, [Math.min(255, r * luz), Math.min(255, g * luz), Math.min(255, b * luz)]);
    }
  for (const ed of ciudad.edificios) {
    const color = hexRGB(COLOR_RIQUEZA[tiposEdificio[ed.tipoEdificioId]?.riqueza] || "#a3762e");
    for (const [x, y] of ed.casillas) pinta(x, y, color);
    pinta(ed.puerta.x, ed.puerta.y, [40, 24, 12]);
  }
  for (const a of ciudad.arboles || []) pinta(a.x, a.y, a.colisiona === false ? [64, 120, 58] : [26, 82, 34]); // arbustos claros, árboles oscuros
  for (const d of ciudad.deco || []) pinta(d.x, d.y, [96, 70, 44]); // muebles urbanos
  for (const l of ciudad.luces || []) pinta(l.x, l.y, [255, 196, 92]); // canal de iluminación
  for (const p of ciudad.puertas) pinta(p.x, p.y, [235, 215, 150]);
  fs.writeFileSync(path.join(carpetaSalida, "overview.png"), codificarPNG(ancho * escala, alto * escala, rgba));
}

function hornearCiudad(tier, semilla, carpetaSalida) {
  const catalogos = cargarCatalogos();
  const terrenos = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker", "catalogo", "terrenos.json"), "utf8"));
  const ciudad = generarCiudad({ tier, semilla, catalogos });
  const errores = validarCiudad(ciudad);
  if (errores.length) throw new Error("ciudad inválida:\n  - " + errores.join("\n  - "));

  fs.mkdirSync(carpetaSalida, { recursive: true });
  exportarCiudad(ciudad, carpetaSalida);
  exportarInteriores(ciudad, carpetaSalida);
  exportarOverview(ciudad, carpetaSalida, terrenos, catalogos.tiposEdificio);
  return ciudad;
}

module.exports = { hornearCiudad, exportarCiudad, exportarOverview, TAMANO_CHUNK };

if (require.main === module) {
  const [tier, semilla, salida] = process.argv.slice(2);
  if (!tier || !semilla) {
    console.log("Uso: node ciudades/src/index.js <tier> <semilla> [carpetaSalida]");
    console.log("Tiers: aldea_pequena, aldea, pueblo, capital, castillo");
    process.exit(1);
  }
  const carpeta = salida || path.join(RAIZ, "ciudades", "output", `${tier}-${semilla}`);
  const ciudad = hornearCiudad(tier, semilla, carpeta);
  const enL = ciudad.edificios.filter((e) => e.piezas.length > 1).length;
  console.log(
    `${tier} "${semilla}" (${ciudad.variante}): ${ciudad.ancho}x${ciudad.alto} casillas, ` +
    `${ciudad.edificios.length} edificios (${enL} en L), ${ciudad.zonasVerdes.length} zonas verdes ` +
    `(${ciudad.arboles.length} árboles), ${ciudad.puertas.length} puertas, ${ciudad.modulosMuralla.length} módulos de muralla` +
    (ciudad.descartados.length ? ` · sin sitio: ${ciudad.descartados.join(", ")}` : "")
  );
  console.log(`-> ${carpeta}`);
}
