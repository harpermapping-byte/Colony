"use strict";

// Varita de crecimiento (GDD_Construccion §1): BFS aleatorizado desde una
// casilla semilla que se expande SOLO por casillas válidas y para al llegar
// al tamaño objetivo o al quedarse sin frontera. La elección del siguiente
// borde a comer usa el PRNG (mulberry32 de interiores/src/azar.js, inyectado
// como `rnd`) para que las parcelas salgan orgánicas — un BFS puro daría
// rombos perfectos — pero SIEMPRE iguales con la misma semilla de PRNG.
//
// El módulo no sabe de terrenos: recibe `esValida(x, y)` y así sirve igual
// en la GUI (que consulta sus sectores cacheados) que en Node (generador de
// demo y tests con fixtures sintéticos). La regla de qué está vetado vive en
// `terrenoVetado` para que todos los consumidores apliquen LA MISMA.

(function (raiz) {
  /**
   * Vetos de terreno del GDD §1 sobre una definición de baker/catalogo/terrenos.json:
   * caminos y puentes (no se parcelan las vías públicas), cualquier agua
   * (requiereNadar) y lo no transitable. El veto "casilla de otra parcela"
   * no va aquí: es del índice de pertenencia, no del terreno.
   */
  function terrenoVetado(terrenoId, def) {
    if (terrenoId === "camino" || terrenoId === "puente") return true;
    if (!def) return true; // terreno desconocido: mejor no dejar parcelar sobre él
    if (def.requiereNadar) return true;
    if (def.transitable === false) return true;
    return false;
  }

  /**
   * Crecimiento de parcela por BFS aleatorizado.
   * @param {object} p
   * @param {(x:number,y:number)=>boolean} p.esValida  casilla parcelable (terreno no vetado, sin otra parcela, dentro del mapa)
   * @param {number} p.semillaX @param {number} p.semillaY
   * @param {number} p.objetivo  nº de casillas deseado
   * @param {()=>number} p.rnd   PRNG determinista [0,1)
   * @param {number} p.anchoMapa ancho en casillas para las claves numéricas
   * @returns {{ casillas: Set<number>, completo: boolean }} claves y*anchoMapa+x; completo=false si la frontera se agotó antes del objetivo
   */
  function crecimientoParcela({ esValida, semillaX, semillaY, objetivo, rnd, anchoMapa }) {
    const casillas = new Set();
    if (!esValida(semillaX, semillaY) || objetivo < 1) return { casillas, completo: false };

    const clave = (x, y) => y * anchoMapa + x;
    // frontera = candidatas adyacentes a la parcela aún no incorporadas.
    // `vistos` evita meter la misma candidata dos veces (con dos vecinas ya
    // dentro) — duplicarla sesgaría el azar hacia las casillas más rodeadas.
    const frontera = [];
    const vistos = new Set();

    function incorporar(x, y) {
      casillas.add(clave(x, y));
      // Orden de vecinos fijo (N,E,S,O): el único azar permitido es rnd().
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        const k = clave(nx, ny);
        if (vistos.has(k) || casillas.has(k)) continue;
        vistos.add(k);
        if (esValida(nx, ny)) frontera.push([nx, ny]);
      }
    }

    vistos.add(clave(semillaX, semillaY));
    incorporar(semillaX, semillaY);

    while (casillas.size < objetivo && frontera.length > 0) {
      // Saca un borde al azar (swap con el último: O(1) y sin reordenar el
      // resto, así el resultado solo depende de la secuencia del PRNG).
      const i = Math.floor(rnd() * frontera.length);
      const [x, y] = frontera[i];
      frontera[i] = frontera[frontera.length - 1];
      frontera.pop();
      // Revalida: pudo dejar de ser válida desde que entró en la frontera
      // (p. ej. la GUI pinta mientras tanto). En uso puro es un no-op.
      if (!esValida(x, y)) continue;
      incorporar(x, y);
    }

    return { casillas, completo: casillas.size >= objetivo };
  }

  const api = { crecimientoParcela, terrenoVetado };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Varita = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
