"use strict";

// Máscara de parcela — conversión entre el formato compacto del GDD de
// Construcción (§1: runs [[y, x0, x1], ...], ambos extremos inclusive) y un
// Set de claves numéricas (clave = y*anchoMapa + x, regla 4 del CLAUDE.md:
// claves numéricas en Sets consultados por casilla, nunca strings).
//
// Usable en Node (module.exports) y en el navegador (window.Mascara) sin
// bundler: la GUI de parcelas lo carga con un <script> normal, los tests y
// el generador de demo con require(). Por eso no depende de nada.

(function (raiz) {
  /** Clave numérica única de la casilla (x,y) — la misma en todo consumidor de parcelas.json. */
  function clave(x, y, anchoMapa) {
    return y * anchoMapa + x;
  }

  /** Inversa de clave(): coordenadas de casilla a partir de la clave numérica. */
  function coordenadas(claveNum, anchoMapa) {
    const y = Math.floor(claveNum / anchoMapa);
    return { x: claveNum - y * anchoMapa, y };
  }

  /** runs del GDD → Set de claves numéricas. */
  function desdeRuns(runs, anchoMapa) {
    const casillas = new Set();
    for (const [y, x0, x1] of runs || []) {
      for (let x = x0; x <= x1; x++) casillas.add(clave(x, y, anchoMapa));
    }
    return casillas;
  }

  /**
   * Set de claves → runs [[y, x0, x1], ...] ordenados por fila y luego por x0.
   * El orden fijo importa: el mismo conjunto de casillas produce SIEMPRE el
   * mismo JSON (determinismo del archivo guardado, diffs limpios).
   */
  function aRuns(casillas, anchoMapa) {
    const claves = [...casillas].sort((a, b) => a - b);
    const runs = [];
    let actual = null; // [y, x0, x1] en construcción
    for (const c of claves) {
      const { x, y } = coordenadas(c, anchoMapa);
      if (actual && actual[0] === y && actual[2] === x - 1) {
        actual[2] = x; // contigua en la misma fila: alarga el run
      } else {
        actual = [y, x, x];
        runs.push(actual);
      }
    }
    return runs;
  }

  function anadir(casillas, x, y, anchoMapa) {
    casillas.add(clave(x, y, anchoMapa));
  }

  function quitar(casillas, x, y, anchoMapa) {
    casillas.delete(clave(x, y, anchoMapa));
  }

  function contar(casillas) {
    return casillas.size;
  }

  /**
   * Índice de pertenencia del GDD §1: Map<clave numérica, parcelaId> sobre
   * TODAS las parcelas del archivo. Consulta O(1) por casilla; también sirve
   * para detectar solapes (si una clave ya está con otro id, hay solape).
   * `parcelas` = objeto { p_0001: { runs, ... }, ... } tal cual parcelas.json.
   */
  function construirIndice(parcelas, anchoMapa) {
    const indice = new Map();
    for (const id of Object.keys(parcelas || {})) {
      for (const [y, x0, x1] of parcelas[id].runs || []) {
        for (let x = x0; x <= x1; x++) indice.set(clave(x, y, anchoMapa), id);
      }
    }
    return indice;
  }

  const api = { clave, coordenadas, desdeRuns, aRuns, anadir, quitar, contar, construirIndice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Mascara = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
