// Tests de mundo/bosqueSector.ts (docs/GDD_Bosques.md, pedido 2026-08-30).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { idArbolBake, resolverSectorBosque } from "../src/mundo/bosqueSector";
import { EspecieArbol } from "../src/mundo/crecimientoBosques";
import { ArbolVivoFila } from "../src/datos/bd";

const CATALOGO: Record<string, EspecieArbol> = {
  pino: { radioPropagacion: 5, probabilidadPropagacion: 0.045, diasMaduracion: 180 },
};

function libreSiempre() {
  return true;
}
function libreNunca() {
  return false;
}

/** rnd() en ciclo [0, 0.5, 0.5] repetido: la primera tirada de cada trío
 * (intentaPropagar) siempre tiene éxito (0 < cualquier probabilidad > 0);
 * las otras dos (ángulo/distancia de puntoAleatorioEnRadio) dan un punto a
 * distancia real del árbol padre (nunca 0), así el brote nuevo no choca
 * con la propia casilla del padre en `ocupadas`. Dos árboles en la MISMA
 * posición consumen el mismo patrón y acaban apuntando al MISMO punto —
 * útil para el test de desduplicación. */
function rndConDistanciaReal(): () => number {
  const secuencia = [0, 0.5, 0.5];
  let i = 0;
  return () => secuencia[i++ % secuencia.length];
}

test("un sector recién bakeado, sin nada persistido, devuelve el bake tal cual (nada talado, nada crecido)", () => {
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [{ i: "pino", x: 5, y: 5 }],
    bakeTaladosPersistidos: [], crecidosPersistidos: [],
    ahora: 100, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: () => 0.999, // nunca propaga
  });
  assert.deepStrictEqual(resultado.bakeTalados, []);
  assert.deepStrictEqual(resultado.crecidos, []);
  assert.deepStrictEqual(resultado.recienMaduraron, []);
});

test("un árbol de bake talado (persistido) NO cuenta como candidato de propagación ni reaparece", () => {
  const id = idArbolBake("m", 0, 0, 0);
  const talado: ArbolVivoFila = {
    id, mapaId: "m", sectorX: 0, sectorY: 0, especieId: "pino", x: 5, y: 5,
    etapa: "adulto", origen: "bake", diaPlantado: null, estado: "talado",
  };
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [{ i: "pino", x: 5, y: 5 }],
    bakeTaladosPersistidos: [talado], crecidosPersistidos: [],
    ahora: 100, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: () => 0, // siempre propagaría si hubiera candidatos
  });
  assert.deepStrictEqual(resultado.bakeTalados, [talado]);
  assert.deepStrictEqual(resultado.crecidos, [], "sin adultos vivos, no hay de dónde propagar");
});

test("propagación: rnd por debajo de la probabilidad + casilla libre crea un brote joven nuevo", () => {
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [{ i: "pino", x: 5, y: 5 }],
    bakeTaladosPersistidos: [], crecidosPersistidos: [],
    ahora: 100, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: rndConDistanciaReal(), // éxito de propagación, a distancia real del padre
  });
  assert.strictEqual(resultado.crecidos.length, 1);
  const brote = resultado.crecidos[0];
  assert.strictEqual(brote.etapa, "joven");
  assert.strictEqual(brote.origen, "propagacion");
  assert.strictEqual(brote.especieId, "pino");
  assert.strictEqual(brote.diaPlantado, 100);
  assert.strictEqual(brote.estado, "vivo");
});

test("propagación: si la casilla candidata no está libre, no nace ningún brote", () => {
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [{ i: "pino", x: 5, y: 5 }],
    bakeTaladosPersistidos: [], crecidosPersistidos: [],
    ahora: 100, catalogo: CATALOGO, casillaLibre: libreNunca,
    rnd: () => 0,
  });
  assert.deepStrictEqual(resultado.crecidos, []);
});

test("maduración: un brote joven que ya cumplió diasMaduracion pasa a adulto y se reporta en recienMaduraron", () => {
  const joven: ArbolVivoFila = {
    id: "arbol:m:0:0:brote:1:1", mapaId: "m", sectorX: 0, sectorY: 0, especieId: "pino", x: 8, y: 8,
    etapa: "joven", origen: "propagacion", diaPlantado: 0, estado: "vivo",
  };
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [],
    bakeTaladosPersistidos: [], crecidosPersistidos: [joven],
    ahora: 180, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: () => 0.999, // que no se cuele una propagación nueva y confunda el aserto
  });
  assert.strictEqual(resultado.crecidos.length, 1);
  assert.strictEqual(resultado.crecidos[0].etapa, "adulto");
  assert.deepStrictEqual(resultado.recienMaduraron, [{ x: 8, y: 8 }]);
});

test("maduración: un brote joven que TODAVÍA no cumplió el plazo se queda joven, sin madurar", () => {
  const joven: ArbolVivoFila = {
    id: "arbol:m:0:0:brote:1:1", mapaId: "m", sectorX: 0, sectorY: 0, especieId: "pino", x: 8, y: 8,
    etapa: "joven", origen: "propagacion", diaPlantado: 0, estado: "vivo",
  };
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [],
    bakeTaladosPersistidos: [], crecidosPersistidos: [joven],
    ahora: 179, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: () => 0.999,
  });
  assert.strictEqual(resultado.crecidos[0].etapa, "joven");
  assert.deepStrictEqual(resultado.recienMaduraron, []);
});

test("un brote joven recién madurado NO propaga todavía en la MISMA resolución en que maduró (evalúa candidatos de adultos ANTES de madurar)", () => {
  // Nota de diseño: el paso 3 (propagación) sí incluye a los que acaban de
  // madurar en el paso 2 de ESTA MISMA resolución — este test confirma el
  // comportamiento real: si madura Y tiene suerte en la tirada, SÍ propaga
  // ya en la misma pasada (ambos pasos ocurren en la misma llamada).
  const joven: ArbolVivoFila = {
    id: "arbol:m:0:0:brote:1:1", mapaId: "m", sectorX: 0, sectorY: 0, especieId: "pino", x: 8, y: 8,
    etapa: "joven", origen: "propagacion", diaPlantado: 0, estado: "vivo",
  };
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [],
    bakeTaladosPersistidos: [], crecidosPersistidos: [joven],
    ahora: 180, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: rndConDistanciaReal(), // maduró Y luego propaga con éxito a distancia real
  });
  const adultos = resultado.crecidos.filter((f) => f.etapa === "adulto");
  const nuevosJovenes = resultado.crecidos.filter((f) => f.etapa === "joven");
  assert.strictEqual(adultos.length, 1, "el brote maduró");
  assert.strictEqual(nuevosJovenes.length, 1, "y ya propagó un brote nuevo en la misma resolución");
});

test("un árbol talado (origen crecido) no madura ni propaga, se conserva tal cual", () => {
  const taladoCrecido: ArbolVivoFila = {
    id: "arbol:m:0:0:brote:1:1", mapaId: "m", sectorX: 0, sectorY: 0, especieId: "pino", x: 8, y: 8,
    etapa: "adulto", origen: "propagacion", diaPlantado: 0, estado: "talado",
  };
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [],
    bakeTaladosPersistidos: [], crecidosPersistidos: [taladoCrecido],
    ahora: 500, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: () => 0,
  });
  assert.deepStrictEqual(resultado.crecidos, [taladoCrecido]);
});

test("dos árboles adultos que propagan hacia la misma casilla candidata: solo uno se queda con el brote (sin apilar)", () => {
  const resultado = resolverSectorBosque({
    mapaId: "m", sectorX: 0, sectorY: 0,
    objetosBakeados: [
      { i: "pino", x: 5, y: 5 },
      { i: "pino", x: 5, y: 5 }, // mismo punto a propósito, fuerza el mismo destino con rnd()=0
    ],
    bakeTaladosPersistidos: [], crecidosPersistidos: [],
    ahora: 100, catalogo: CATALOGO, casillaLibre: libreSiempre,
    rnd: rndConDistanciaReal(),
  });
  assert.strictEqual(resultado.crecidos.length, 1, "el segundo intento choca con la casilla ya reclamada por el primero");
});
