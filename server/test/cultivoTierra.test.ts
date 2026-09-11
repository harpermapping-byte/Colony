/**
 * docs/GDD_Agricultura.md §9 — tierra para macetas y agua para regar:
 * la parte PURA (cultivo.ts) y la coherencia del catálogo con ella.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tierraNecesariaDe, tierraQueFalta, ML_POR_RIEGO } from "../src/cultivo/cultivo";
import exteriores from "../../interiores/catalogo/exteriores.json";
import items from "../../items/catalogo/items.json";

const EXT = exteriores as unknown as Record<string, { plantable?: { multiplicadorCosecha: number; tierraNecesaria?: number }; requiereItemColocar?: string }>;
const ITEMS = items as unknown as Record<string, { volumenMaxMl?: number; tipo?: string; slotEquipo?: string }>;

test("tierraNecesariaDe: 0 sin campo (bancal), entero positivo si lo declara, nunca negativo ni fraccionario", () => {
  assert.equal(tierraNecesariaDe(undefined), 0);
  assert.equal(tierraNecesariaDe({ multiplicadorCosecha: 1 }), 0);
  assert.equal(tierraNecesariaDe({ multiplicadorCosecha: 1, tierraNecesaria: 2 }), 2);
  assert.equal(tierraNecesariaDe({ multiplicadorCosecha: 1, tierraNecesaria: -3 }), 0);
  assert.equal(tierraNecesariaDe({ multiplicadorCosecha: 1, tierraNecesaria: 1.9 }), 1);
});

test("tierraQueFalta: cuenta unidad a unidad hasta la necesaria y nunca pide de más", () => {
  assert.equal(tierraQueFalta({}, 2), 2);
  assert.equal(tierraQueFalta({ tierra: 1 }, 2), 1);
  assert.equal(tierraQueFalta({ tierra: 2 }, 2), 0);
  assert.equal(tierraQueFalta({ tierra: 5 }, 2), 0); // meter de más nunca deja deuda negativa
  assert.equal(tierraQueFalta({ tierra: 1 }, 0), 0); // un bancal nunca "necesita"
});

test("catálogo: toda maceta/jardinera/tiesto exige tierra, el bancal no, y las nuevas se colocan con su ítem crafteado", () => {
  for (const id of ["maceta_pequena", "maceta_mediana", "maceta_grande", "jardinera_madera", "tiesto_piedra"]) {
    assert.ok(EXT[id]?.plantable, `${id} debe ser plantable`);
    assert.ok(tierraNecesariaDe(EXT[id].plantable) >= 1, `${id} debe exigir tierra`);
  }
  assert.equal(tierraNecesariaDe(EXT.bancal_cultivo.plantable), 0);
  assert.equal(EXT.maceta_grande.plantable!.tierraNecesaria, 2, "la maceta de dos casillas pide dos paladas");
  for (const id of ["jardinera_madera", "tiesto_piedra"]) {
    assert.equal(EXT[id].requiereItemColocar, id);
    assert.ok(ITEMS[id], `${id} existe como ítem`);
  }
});

test("catálogo: pala equipable en la mano, tierra como recurso, y los recipientes dan riegos enteros", () => {
  assert.equal(ITEMS.pala.tipo, "herramienta");
  assert.equal(ITEMS.pala.slotEquipo, "manoPrincipal");
  assert.equal(ITEMS.tierra.tipo, "recurso");
  assert.equal(ML_POR_RIEGO, 500);
  assert.equal((ITEMS.cantimplora.volumenMaxMl ?? 0) / ML_POR_RIEGO, 1);
  assert.equal((ITEMS.cubo_madera.volumenMaxMl ?? 0) / ML_POR_RIEGO, 4);
  assert.equal((ITEMS.regadera.volumenMaxMl ?? 0) / ML_POR_RIEGO, 6);
});
