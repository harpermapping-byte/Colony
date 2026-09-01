"use strict";

// Interpretación de texto libre → parámetros REALES del generador de
// edificios del ingeniero legendario (docs/GDD_Ropa_Procedural.md §Ingeniero
// legendario) — MISMO patrón exacto que interpretarPromptMueble.js/
// interpretarPrompt.js (sastre). Puerto TS gemelo:
// client/src/render3d/interpretarPromptEdificio.ts.

const fs = require("fs");
const path = require("path");

const RUTA_VOCABULARIO = path.join(__dirname, "catalogo", "vocabularioEdificios.json");
const RUTA_COLORES_ROPA = path.join(__dirname, "..", "ropa", "catalogo", "vocabularioLegendario.json");

let cacheVocabulario = null;
function cargarVocabularioEdificios(ruta = RUTA_VOCABULARIO) {
  if (!cacheVocabulario) cacheVocabulario = JSON.parse(fs.readFileSync(ruta, "utf8"));
  return cacheVocabulario;
}

let cacheColores = null;
function cargarColoresAcento(ruta = RUTA_COLORES_ROPA) {
  if (!cacheColores) cacheColores = JSON.parse(fs.readFileSync(ruta, "utf8")).color;
  return cacheColores;
}

function normalizar(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function algunaPalabraCoincide(t, palabras) {
  return palabras.some((p) => t.includes(normalizar(p)));
}

function analizarPalabrasClave(texto, vocabulario, colores) {
  const t = normalizar(texto);
  const resultado = { tipoEdificio: null, materialId: null, forma: null, techoId: null, colorAcento: null, balcon: false, porche: false, ventanasGrandes: false };

  for (const entrada of vocabulario.tipoEdificio || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.tipoEdificio = entrada.valor; break; }
  }
  for (const entrada of vocabulario.material || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.materialId = entrada.valor; break; }
  }
  for (const entrada of vocabulario.forma || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.forma = entrada.valor; break; }
  }
  for (const entrada of vocabulario.techo || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.techoId = entrada.valor; break; }
  }
  for (const entrada of vocabulario.modificador || []) {
    if (algunaPalabraCoincide(t, entrada.palabras)) resultado[entrada.campo] = entrada.valor;
  }
  for (const entrada of colores) {
    if (algunaPalabraCoincide(t, entrada.palabras)) { resultado.colorAcento = entrada.valor; break; }
  }
  return resultado;
}

const MATERIAL_POR_DEFECTO = { valor: "madera", hex: "#8a6a3a" };
const TECHO_POR_DEFECTO = { valor: "paja", hex: "#d4b84a" };

function resolverEntrada(id, lista, porDefecto) {
  if (id) {
    const entrada = lista.find((e) => e.valor === id);
    if (entrada) return entrada;
  }
  return porDefecto;
}

/**
 * Texto libre → parámetros completos y VÁLIDOS para `generarEdificioVoxel()`.
 * Sin ninguna palabra reconocida, cae a "casa_humilde" de madera, forma
 * rect, techo de paja, sin balcón/porche.
 */
function interpretarPromptEdificio(texto, opciones = {}) {
  const vocabulario = opciones.vocabulario || cargarVocabularioEdificios();
  const colores = opciones.colores || cargarColoresAcento();

  const analisis = analizarPalabrasClave(texto, vocabulario, colores);
  const tipoEdificio = analisis.tipoEdificio || "casa_humilde";
  const material = resolverEntrada(analisis.materialId, vocabulario.material, MATERIAL_POR_DEFECTO);
  const techo = resolverEntrada(analisis.techoId, vocabulario.techo, TECHO_POR_DEFECTO);
  const forma = analisis.forma || "rect";

  return {
    tipoEdificio,
    materialId: material.valor,
    colorMaterial: material.hex,
    techoId: techo.valor,
    colorTecho: techo.hex,
    forma,
    colorAcento: analisis.colorAcento,
    balcon: !!analisis.balcon,
    porche: !!analisis.porche,
    ventanasGrandes: !!analisis.ventanasGrandes,
  };
}

module.exports = {
  cargarVocabularioEdificios,
  cargarColoresAcento,
  normalizar,
  analizarPalabrasClave,
  interpretarPromptEdificio,
};
