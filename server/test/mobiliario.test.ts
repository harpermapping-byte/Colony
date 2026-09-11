// Mobiliario del carpintero (docs/GDD_Construccion.md §9, 2026-09-11):
// filtros de contenido, expositores, plazas y calidad de descanso — las
// funciones puras que consume RoomExteriorBase.ts, más una pasada sobre el
// catálogo real para que ninguna entrada nueva declare un filtro que no
// acepte NADA del catálogo (mueble inútil) o una rejilla en la que no quepa
// ni un solo ítem de lo que acepta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aceptaItemEnMueble, expuestosDe, factorDescansoDe, plazasDe, MAX_EXPUESTOS } from "../src/construccion/mobiliario";
import { cargarCatalogoConstruible } from "../src/construccion/catalogo";
import { cargarCatalogoItems, crearContenedor, agregarItem, hayHueco } from "../src/inventario/inventario";

const items = cargarCatalogoItems();
const construibles = cargarCatalogoConstruible();

test("aceptaItemEnMueble: sin filtro admite todo; con filtro basta cumplir UNA lista (tipo, slot, prefijo o id)", () => {
  assert.equal(aceptaItemEnMueble(undefined, "espada_corta", items.espada_corta), true);
  assert.equal(aceptaItemEnMueble({}, "espada_corta", items.espada_corta), true, "filtro vacío = sin filtro");
  const pociones = { prefijos: ["pocion_", "elixir_"] };
  assert.equal(aceptaItemEnMueble(pociones, "pocion_alquimica_clara", items.pocion_alquimica_clara), true);
  assert.equal(aceptaItemEnMueble(pociones, "espada_corta", items.espada_corta), false);
  const armas = { tipos: ["arma"] };
  assert.equal(aceptaItemEnMueble(armas, "espada_corta", items.espada_corta), true);
  assert.equal(aceptaItemEnMueble(armas, "hacha_talar", items.hacha_talar), false, "una herramienta no es un arma aunque se equipe en la mano");
  const joyas = { slots: ["anillo", "cuello"] };
  const anillo = Object.keys(items).find((id) => items[id].slotEquipo === "anillo")!;
  assert.ok(anillo);
  assert.equal(aceptaItemEnMueble(joyas, anillo, items[anillo]), true);
  assert.equal(aceptaItemEnMueble(joyas, "espada_corta", items.espada_corta), false);
  assert.equal(aceptaItemEnMueble({ ids: ["plato"] }, "plato", items.plato), true);
  assert.equal(aceptaItemEnMueble({ ids: ["plato"] }, "plato", undefined), true, "un id exacto no necesita la entrada de catálogo");
  assert.equal(aceptaItemEnMueble({ tipos: ["arma"] }, "inexistente", undefined), false, "sin entrada de catálogo no se puede cumplir un filtro por tipo");
});

test("expuestosDe: orden de rejilla estable (fila, columna), un montón cuenta una vez, tope MAX_EXPUESTOS", () => {
  assert.deepEqual(expuestosDe(undefined), []);
  const c = crearContenedor(6, 6);
  agregarItem(c, items, "pocion_alquimica_clara", 1);
  agregarItem(c, items, "plato", 1);
  const lista = expuestosDe(c);
  assert.equal(lista.length, 2);
  // los dos ítems ocupan (0,0) y (1,0) — la primera fila de izquierda a derecha
  assert.deepEqual(lista, ["pocion_alquimica_clara", "plato"]);
  const grande = crearContenedor(10, 10);
  for (let i = 0; i < 40; i++) agregarItem(grande, items, "clavos", 1);
  assert.ok(grande.items.length >= MAX_EXPUESTOS + 1 || grande.items.some((it) => it.cantidad > 1));
  assert.ok(expuestosDe(grande).length <= MAX_EXPUESTOS);
});

test("plazasDe / factorDescansoDe: ausentes = comportamiento de siempre (1 plaza, factor 1), valores raros acotados", () => {
  assert.equal(plazasDe(undefined), 1);
  assert.equal(plazasDe({ plazas: 3 } as never), 3);
  assert.equal(plazasDe({ plazas: 0 } as never), 1);
  assert.equal(plazasDe({ plazas: 2.7 } as never), 2);
  assert.equal(factorDescansoDe(undefined), 1);
  assert.equal(factorDescansoDe({ calidadDescanso: 2 } as never), 2);
  assert.equal(factorDescansoDe({ calidadDescanso: 99 } as never), 4, "tope superior");
  assert.equal(factorDescansoDe({ calidadDescanso: 0 } as never), 0.25, "tope inferior — nunca un buff nulo");
});

test("catálogo real: todo mueble con aceptaItems admite al menos un ítem real y su rejilla lo aloja; todo expositor es contenedor; plazas>1 solo en asientos/camas", () => {
  let conFiltro = 0, expositores = 0, conPlazas = 0;
  for (const [id, e] of construibles) {
    if (e.categoria !== "mueble") continue;
    if (e.aceptaItems) {
      conFiltro++;
      assert.ok(e.esContenedor, `${id}: aceptaItems sin esContenedor no sirve de nada`);
      const admitidos = Object.keys(items).filter((itemId) => aceptaItemEnMueble(e.aceptaItems, itemId, items[itemId]));
      assert.ok(admitidos.length > 0, `${id}: su filtro no acepta NINGÚN ítem del catálogo`);
      const [w, h] = e.rejillaCofre ?? [e.almacenamientoCofre ?? 3, e.almacenamientoCofre ?? 3];
      const rejilla = crearContenedor(w, h);
      const cabeAlguno = admitidos.some((itemId) => hayHueco(rejilla, items, itemId, 0, 0, 0) || hayHueco(rejilla, items, itemId, 0, 0, 1));
      assert.ok(cabeAlguno, `${id}: en una rejilla ${w}x${h} no cabe ninguno de los ${admitidos.length} ítems que acepta`);
      assert.ok(typeof e.aceptaItems.etiqueta === "string" && e.aceptaItems.etiqueta.length > 0, `${id}: aceptaItems sin etiqueta para el jugador`);
    }
    if (e.expositor) { expositores++; assert.ok(e.esContenedor, `${id}: expositor sin esContenedor`); }
    if (e.plazas !== undefined) {
      conPlazas++;
      assert.ok(e.esSilla || e.esAsiento || e.esCama, `${id}: plazas en algo que no es asiento ni cama`);
      assert.ok(Number.isInteger(e.plazas) && e.plazas >= 1 && e.plazas <= 4, `${id}: plazas ${e.plazas} fuera de rango`);
    }
    if (e.calidadDescanso !== undefined) assert.ok(e.esCama, `${id}: calidadDescanso en algo que no es cama`);
    if (e.rejillaCofre) {
      assert.ok(e.esContenedor, `${id}: rejillaCofre sin esContenedor`);
      assert.ok(e.rejillaCofre[0] >= 1 && e.rejillaCofre[1] >= 1 && e.rejillaCofre[0] * e.rejillaCofre[1] <= 64, `${id}: rejilla ${e.rejillaCofre} absurda`);
    }
  }
  assert.ok(conFiltro >= 20, `esperaba al menos 20 muebles con filtro, hay ${conFiltro}`);
  assert.ok(expositores >= 15, `esperaba al menos 15 expositores, hay ${expositores}`);
  assert.ok(conPlazas >= 20, `esperaba al menos 20 muebles con plazas, hay ${conPlazas}`);
});

test("catálogo real: las lámparas craftables llevan iluminacion=true (capa iluminacion) y las piezas del carpintero exigen su ítem (requiereItemColocar) — nunca gratis", () => {
  for (const id of ["lampara_arana_cobre", "candelabro_pie_hierro", "lampara_aceite_mesa_cobre", "lampara_vidrio_coloreado"]) {
    const e = construibles.get(id);
    assert.ok(e, `${id} no está en el catálogo construible`);
    assert.equal(e!.iluminacion, true, `${id}: sin iluminacion`);
  }
  for (const id of ["sofa_lino_doble", "cama_noble_dosel_doble", "estanteria_pociones_pino", "armario_ropa_abedul", "maniqui_armadura"]) {
    const e = construibles.get(id)!;
    assert.equal(e.requiereItemColocar, id, `${id}: debería exigir su propio ítem`);
    assert.ok(items[id], `${id}: el ítem portador no existe`);
  }
  assert.equal(construibles.get("sofa_lino_triple")!.plazas, 3);
  assert.equal(construibles.get("cama_noble_dosel_doble")!.calidadDescanso, 2);
  assert.deepEqual(construibles.get("estanteria_pociones_pino")!.rejillaCofre, [6, 1]);
});
