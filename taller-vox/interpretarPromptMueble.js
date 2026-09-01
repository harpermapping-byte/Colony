"use strict";

// Interpretación de texto libre → parámetros REALES del generador de
// muebles (docs/GDD_Ropa_Procedural.md §Carpintero legendario) — MISMO
// patrón exacto que ropa/src/interpretarPrompt.js (sastre legendario):
// diccionario de palabras clave, cero IA, siempre devuelve parámetros
// válidos. Módulo PURO (sin Colyseus): usado por el SERVIDOR (autoritativo,
// siempre reinterpreta el texto por su cuenta) y portado a TypeScript para
// el cliente (client/src/render3d/interpretarPromptMueble.ts, MISMO
// algoritmo, para que la vista previa instantánea del panel coincida con lo
// que el servidor acabará aceptando).

const fs = require("fs");
const path = require("path");

const RUTA_VOCABULARIO = path.join(__dirname, "catalogo", "vocabularioMuebles.json");
// Reutiliza el MISMO array de colores de acento que ya usa el sastre legendario
// (catálogo como fuente de verdad — cero tabla de colores duplicada).
const RUTA_COLORES_ROPA = path.join(__dirname, "..", "ropa", "catalogo", "vocabularioLegendario.json");

let cacheVocabulario = null;
function cargarVocabularioMuebles(ruta = RUTA_VOCABULARIO) {
  if (!cacheVocabulario) cacheVocabulario = JSON.parse(fs.readFileSync(ruta, "utf8"));
  return cacheVocabulario;
}

let cacheColores = null;
function cargarColoresAcento(ruta = RUTA_COLORES_ROPA) {
  if (!cacheColores) cacheColores = JSON.parse(fs.readFileSync(ruta, "utf8")).color;
  return cacheColores;
}

/** minúsculas + sin tildes, para comparar sin duplicar cada palabra del vocabulario con/sin acento. */
function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function algunaPalabraCoincide(textoNormalizado, palabras) {
  return palabras.some((p) => textoNormalizado.includes(normalizar(p)));
}

/**
 * Primera pasada: qué dice el texto, en bruto. `estilo` aplica primero como
 * PAQUETE base (madera+modificadores+color de acento); los bloques
 * `modificador`/`madera`/`color` más específicos corren DESPUÉS y pisan lo
 * que haga falta — mismo criterio que el sastre ("noble pero de pino" gana pino).
 */
function analizarPalabrasClave(texto, vocabulario, colores) {
  const t = normalizar(texto);
  const resultado = { tipoMueble: null, maderaId: null, colorAcento: null, tallado: false, desgaste: false, roto: false, tapizado: false, incrustado: false, herraje: false };

  for (const entrada of vocabulario.estilo || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) {
      if (entrada.madera) resultado.maderaId = entrada.madera;
      if (entrada.detalle) Object.assign(resultado, entrada.detalle);
      if (entrada.color) resultado.colorAcento = entrada.color;
      break; // un solo paquete de estilo, igual que el sastre
    }
  }
  for (const entrada of vocabulario.tipoMueble || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.tipoMueble = entrada.valor; break; }
  }
  for (const entrada of vocabulario.madera || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.maderaId = entrada.valor; break; }
  }
  for (const entrada of vocabulario.modificador || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) resultado[entrada.campo] = entrada.valor;
  }
  for (const entrada of colores) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.colorAcento = entrada.valor; break; }
  }
  return resultado;
}

// Arquetipo base real por tipoMueble — id de interiores/catalogo/elementos.json
// (silueta/huella) que DOBLA como itemId en items/catalogo/items.json (mismo
// criterio "sin catálogo carrier nuevo" que el sastre con prendaBaseId).
// Subconjunto pequeño y con sentido a propósito (docs/GDD_Ropa_Procedural.md
// §Carpintero legendario) — no los 123 tipos completos de interiores.
const ARQUETIPO_POR_TIPO = { silla: "silla", mesa: "mesa_comedor", cama: "cama_individual", arcon: "arcon" };
const MADERA_POR_DEFECTO = { valor: "roble", hex: "#5a3d20" };

function resolverMadera(maderaId, vocabulario) {
  if (maderaId) {
    const entrada = (vocabulario.madera || []).find((m) => m.valor === maderaId);
    if (entrada) return entrada;
  }
  return MADERA_POR_DEFECTO;
}

/**
 * Punto de entrada real: texto libre → parámetros completos y VÁLIDOS para
 * `generarMuebleVoxel()`. Nunca devuelve `null` ni campos a medias — sin
 * ninguna palabra reconocida, cae a "silla" de roble sin modificadores.
 */
function interpretarPromptMueble(texto, opciones = {}) {
  const vocabulario = opciones.vocabulario || cargarVocabularioMuebles();
  const colores = opciones.colores || cargarColoresAcento();

  const analisis = analizarPalabrasClave(texto, vocabulario, colores);
  const tipoMueble = analisis.tipoMueble || "silla";
  const arquetipoId = ARQUETIPO_POR_TIPO[tipoMueble];
  const madera = resolverMadera(analisis.maderaId, vocabulario);

  return {
    tipoMueble,
    arquetipoId,
    maderaId: madera.valor,
    colorMadera: madera.hex,
    colorAcento: analisis.colorAcento,
    tallado: !!analisis.tallado,
    desgaste: !!analisis.desgaste,
    roto: !!analisis.roto,
    tapizado: !!analisis.tapizado,
    incrustado: !!analisis.incrustado,
    herraje: !!analisis.herraje,
  };
}

module.exports = {
  cargarVocabularioMuebles,
  cargarColoresAcento,
  normalizar,
  analizarPalabrasClave,
  interpretarPromptMueble,
  ARQUETIPO_POR_TIPO,
};
