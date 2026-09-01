"use strict";

// Interpretación de texto libre → parámetros REALES del generador de ropa
// (docs/GDD_Ropa_Procedural.md §Sastre legendario, pedido 2026-08-31: "podrá
// introducir imagen de ejemplo o texto para determinar cómo va a generarse
// esa nueva ropa"). Solo texto en esta v1 (imagen queda para más adelante,
// sin diseñar). Módulo PURO — mismo patrón que generarPrenda.js: sin fs
// salvo para cargar los catálogos, todo lo demás son funciones deterministas
// sobre los datos ya cargados. Usado por el SERVIDOR (autoritativo — nunca
// se fía de los parámetros que mande el cliente, siempre reinterpreta el
// texto por su cuenta) y portado a TypeScript para el cliente
// (client/src/render3d/interpretarPrompt.ts, MISMO algoritmo, para que la
// vista previa instantánea del cliente coincida con lo que el servidor
// acabará aceptando).

const fs = require("fs");
const path = require("path");

const RUTA_VOCABULARIO = path.join(__dirname, "..", "catalogo", "vocabularioLegendario.json");
const RUTA_PRENDAS = path.join(__dirname, "..", "catalogo", "prendas.json");

let cacheVocabulario = null;
function cargarVocabularioLegendario(ruta = RUTA_VOCABULARIO) {
  if (!cacheVocabulario) cacheVocabulario = JSON.parse(fs.readFileSync(ruta, "utf8"));
  return cacheVocabulario;
}

let cachePrendas = null;
function cargarCatalogoPrendas(ruta = RUTA_PRENDAS) {
  if (!cachePrendas) cachePrendas = JSON.parse(fs.readFileSync(ruta, "utf8"));
  return cachePrendas;
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
 * Primera pasada: qué dice el texto, en bruto (sin resolver todavía contra
 * el catálogo de prendas real — eso lo hace `interpretarPromptTejido`).
 * `estilo` aplica primero como PAQUETE base (material+detalle+color); los
 * bloques de `detalle`/`material`/`color` más específicos corren DESPUÉS y
 * pisan lo que haga falta — así "elegante pero de lana" funciona: el
 * paquete "elegante" pone seda, pero "lana" (más específico) gana al final.
 */
function analizarPalabrasClave(texto, vocabulario) {
  const t = normalizar(texto);
  const resultado = { tipoPrenda: null, detalle: {}, materialId: null, colorHint: null };

  for (const entrada of vocabulario.estilo || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) {
      if (entrada.material) resultado.materialId = entrada.material;
      if (entrada.detalle) resultado.detalle = { ...resultado.detalle, ...entrada.detalle };
      if (entrada.color) resultado.colorHint = entrada.color;
      break; // un solo paquete de estilo — mezclar dos sería contradictorio (ej. "noble" + "campesino" a la vez)
    }
  }
  for (const entrada of vocabulario.tipoPrenda || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.tipoPrenda = entrada.valor; break; }
  }
  for (const entrada of vocabulario.detalle || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) resultado.detalle[entrada.campo] = entrada.valor;
  }
  for (const entrada of vocabulario.material || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.materialId = entrada.valor; break; }
  }
  for (const entrada of vocabulario.color || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.colorHint = entrada.valor; break; }
  }
  return resultado;
}

/**
 * Arquetipo base concreto (`ropa/catalogo/prendas.json`) para un
 * `tipoPrenda` — prefiere uno cuyo `materialesCompatibles` incluya el
 * material que pidió el texto (si lo pidió); si ninguno lo admite, o no se
 * pidió material, cae al primero de ese tipo en el catálogo. Nunca revienta
 * por un `tipoPrenda` sin representantes — eso ya lo evita el propio
 * vocabulario (solo declara "camisa"/"pantalon"/"gorro", que SIEMPRE tienen
 * al menos una entrada en prendas.json).
 */
function elegirPrendaBase(tipoPrenda, materialPreferido, catalogoPrendas) {
  const candidatas = Object.entries(catalogoPrendas).filter(([id, def]) => !id.startsWith("_") && def.tipoPrenda === tipoPrenda);
  if (candidatas.length === 0) return null;
  if (materialPreferido) {
    const conMaterial = candidatas.find(([, def]) => (def.materialesCompatibles || []).includes(materialPreferido));
    if (conMaterial) return conMaterial[0];
  }
  return candidatas[0][0];
}

/**
 * Punto de entrada real: texto libre → parámetros completos y VÁLIDOS para
 * `generarPrenda()` (prendaBaseId real, detalle mezclado sobre la base del
 * arquetipo, material garantizado compatible). Nunca devuelve `null` ni
 * campos a medias — sin ninguna palabra reconocida, cae a los valores por
 * defecto del arquetipo "camisa" más básico (mismo criterio "nunca romper
 * por un dato ausente" del resto del proyecto).
 */
function interpretarPromptTejido(texto, opciones = {}) {
  const vocabulario = opciones.vocabulario || cargarVocabularioLegendario();
  const catalogoPrendas = opciones.catalogoPrendas || cargarCatalogoPrendas();

  const analisis = analizarPalabrasClave(texto, vocabulario);
  const tipoPrenda = analisis.tipoPrenda || "camisa";
  const prendaBaseId = elegirPrendaBase(tipoPrenda, analisis.materialId, catalogoPrendas);
  const base = catalogoPrendas[prendaBaseId];
  const materialId = analisis.materialId && (base.materialesCompatibles || []).includes(analisis.materialId)
    ? analisis.materialId
    : base.materialesCompatibles[0];
  const detalle = { ...base.detalle, ...analisis.detalle };

  return { prendaBaseId, materialId, detalle, colorHint: analisis.colorHint };
}

module.exports = {
  cargarVocabularioLegendario,
  cargarCatalogoPrendas,
  normalizar,
  analizarPalabrasClave,
  elegirPrendaBase,
  interpretarPromptTejido,
};
