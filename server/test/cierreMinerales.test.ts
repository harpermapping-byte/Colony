// Cierre del ciclo de minerales (docs/GDD_Crafteo.md §9, pedido streamer
// 2026-09-08: "revisa a ver... habría que cerrar los 4") — 4 huecos reales
// confirmados por auditoría (plomo sin consumidor, gemas preciosas
// colapsando en un único itemId "gema", 2 recetas de joyero sin mesa
// alcanzable, turba sin ningún uso) + slot "cuello" nuevo con collares/
// anillos temáticos por gema, + ampliación de vidrio interactivo/decorativo.
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { cargarCatalogoItems, cargarCatalogoRecetas, equiparItem, calcularStatsEquipo, crearContenedor, agregarItem, type InventarioJugador } from "../src/inventario/inventario";
import { CATEGORIA_HERRAMIENTA_RECOLECCION } from "../src/mundo/herramientasRecoleccion";

const catalogo = cargarCatalogoItems();
const recetas = cargarCatalogoRecetas();

function jugadorVacio(): InventarioJugador {
  return { cuerpo: crearContenedor(4, 4), extras: new Map(), equipo: {}, equipoBlueprintRopa: {}, equipoDurabilidad: {} };
}

const GEMAS = ["amatista", "esmeralda", "rubi", "zafiro", "diamante"];

test("las 5 gemas preciosas ya NO comparten categoriaRecurso — cada una da su propio itemId al recolectar (antes todas caían a 'gema')", () => {
  for (const id of GEMAS) {
    assert.ok(catalogo[id], `falta el itemId bruto ${id}`);
    assert.strictEqual(catalogo[id].categoriaRecurso, id, "categoriaRecurso debe ser la propia gema, no la 'gema' genérica compartida de antes");
    const requisito = CATEGORIA_HERRAMIENTA_RECOLECCION[id];
    assert.ok(requisito, `falta el gate de herramienta para ${id}`);
    assert.strictEqual(requisito.oficio, "picapedrero");
    assert.strictEqual(requisito.tier, 4, "mismo tier que la 'gema' genérica de siempre (geoda)");
  }
  // geoda se queda deliberadamente en la categoría genérica "gema" — es la más común de las 6.
  assert.strictEqual(CATEGORIA_HERRAMIENTA_RECOLECCION["gema"].tier, 4);
});

test("cada gema preciosa tiene su propia talla (procesado joyero) — no la 'gema_tallada' genérica", () => {
  for (const id of GEMAS) {
    const talladaId = id === "rubi" || id === "zafiro" || id === "diamante" ? `${id}_tallado` : `${id}_tallada`;
    assert.ok(catalogo[talladaId], `falta la gema tallada ${talladaId}`);
    const receta = recetas.get(`${talladaId}_procesado`);
    assert.ok(receta, `falta la receta de talla de ${id}`);
    assert.strictEqual(receta!.oficio, "joyero");
    assert.deepStrictEqual(receta!.mesas, ["mesa_tallado_cristal"]);
    assert.deepStrictEqual(receta!.insumos, [{ itemId: id, cantidad: 1 }]);
  }
});

test("anillo_rubi_craft ya consume rubi_tallado de verdad, no la gema_tallada genérica de antes", () => {
  const receta = recetas.get("anillo_rubi_craft")!;
  assert.ok(receta.insumos.some((i) => i.itemId === "rubi_tallado"), "debería pedir rubi_tallado");
  assert.ok(!receta.insumos.some((i) => i.itemId === "gema_tallada"), "ya no debería depender de la gema genérica");
});

test("mesa_tallado_cristal y horno_vidrio ya declaran 'joyeria' en temasProfesion (antes solo 'vidriero', que ni siquiera es oficio jugable — el joyero real nunca podía generarlas en su propio edificio)", () => {
  const interioresElementos = require("../../interiores/catalogo/elementos.json");
  for (const id of ["mesa_tallado_cristal", "horno_vidrio"]) {
    assert.ok(interioresElementos[id].temasProfesion.includes("joyeria"), `${id} debería servir también a joyeria`);
    assert.ok(interioresElementos[id].temasProfesion.includes("vidriero"), `${id} no debería perder su etiqueta original`);
  }
});

test("plomo/turba/sal ya tienen consumidor real en recetas.json (antes: 0 recetas los pedían)", () => {
  const usaComoInsumo = (itemId: string) =>
    [...recetas.values()].some((r) => r.insumos.some((i) => i.itemId === itemId));
  assert.ok(usaComoInsumo("lingote_plomo"), "lingote_plomo seguía siendo un callejón sin salida");
  assert.ok(usaComoInsumo("turba"), "turba seguía sin ningún uso");
  assert.ok(usaComoInsumo("sal"), "sal debería tener un uso central además del de alquimia");
});

test("slot 'cuello' nuevo: un collar se equipa de verdad y su bonificación temática se suma en calcularStatsEquipo", () => {
  const inv = jugadorVacio();
  const { instancia } = agregarItem(inv.cuerpo, catalogo, "collar_zafiro", 1);
  const res = equiparItem(inv, catalogo, instancia!.id, "cuello");
  assert.strictEqual(res.ok, true, "collar_zafiro debería equiparse en el slot cuello nuevo");
  assert.strictEqual(inv.equipo["cuello"], "collar_zafiro");
  const stats = calcularStatsEquipo(catalogo, inv.equipo);
  assert.ok(stats.defensaMagica > 0, "la bonificación temática del zafiro (defensaMagica) debe sumarse de verdad");
});

test("cada anillo temático de gema da una bonificación real distinta (dentro de los 4 stats que calcularStatsEquipo suma)", () => {
  const ANILLOS: Record<string, keyof ReturnType<typeof calcularStatsEquipo>> = {
    anillo_amatista: "ataqueMagico",
    anillo_esmeralda: "defensaFisica",
    anillo_zafiro: "defensaMagica",
    anillo_diamante: "defensaFisica",
  };
  for (const [id, statClave] of Object.entries(ANILLOS)) {
    const inv = jugadorVacio();
    const { instancia } = agregarItem(inv.cuerpo, catalogo, id, 1);
    const res = equiparItem(inv, catalogo, instancia!.id, "anilloDerecho");
    assert.strictEqual(res.ok, true, `${id} debería equiparse como anillo`);
    const stats = calcularStatsEquipo(catalogo, inv.equipo);
    assert.ok(stats[statClave] > 0, `${id} debería sumar ${statClave}`);
  }
});

test("catálogo de vidrio/joyero ampliado (vasos/jarras/frascos) — cada pieza craftea de verdad con cristal_pulido en horno_vidrio", () => {
  for (const id of ["vaso_cristal", "copa_cristal", "plato_cristal", "jarra_cristal", "decantador_cristal", "florero_cristal", "frasco_pocion_grande"]) {
    assert.ok(catalogo[id], `falta el item ${id}`);
    const receta = recetas.get(`${id}_craft`);
    assert.ok(receta, `falta la receta de ${id}`);
    assert.strictEqual(receta!.oficio, "joyero");
    assert.deepStrictEqual(receta!.mesas, ["horno_vidrio"]);
    assert.ok(receta!.insumos.some((i) => i.itemId === "cristal_pulido"), `${id} debería pedir cristal_pulido`);
  }
});
