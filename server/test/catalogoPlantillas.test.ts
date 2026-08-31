// Tests de cargarCatalogoPlantillas (server/src/construccion/catalogo.ts,
// generalización 2026-08-31 a proyectos especiales, docs/GDD_Ciudad_Capital.md
// §5ter) — sobre todo cubre el bug real que esto corrigió: antes se
// forzaba `plantillaJarl: true` en TODAS las entradas del Map sin mirar el
// flag de origen, lo que habría dejado comprar (manejarPlantillaComprar) un
// proyecto especial del jarl como si fuera una plantilla de producción normal.
import { test } from "node:test";
import * as assert from "node:assert";
import { cargarCatalogoPlantillas } from "../src/construccion/catalogo";

test("cargarCatalogoPlantillas: incluye el aserradero (plantillaJarl) con su flag propio, sin proyectoJarl", () => {
  const catalogo = cargarCatalogoPlantillas();
  const aserradero = catalogo.get("aserradero");
  assert.ok(aserradero, "el aserradero debe estar en el catálogo de plantillas");
  assert.strictEqual(aserradero!.plantillaJarl, true);
  assert.strictEqual(aserradero!.proyectoJarl, false);
  assert.ok(aserradero!.produccion, "el aserradero produce madera_dura");
});

test("cargarCatalogoPlantillas: incluye los proyectos especiales del jarl con su flag propio, sin plantillaJarl", () => {
  const catalogo = cargarCatalogoPlantillas();
  const salonJarl = catalogo.get("salon_jarl");
  assert.ok(salonJarl, "salon_jarl (proyecto especial) debe estar en el catálogo de plantillas");
  assert.strictEqual(salonJarl!.proyectoJarl, true);
  assert.strictEqual(salonJarl!.plantillaJarl, false);
});

test("cargarCatalogoPlantillas: trae TODAS las plantillaJarl (producción) y TODOS los proyectoJarl (especiales) del catálogo, sin mezclarlos", () => {
  const catalogo = cargarCatalogoPlantillas();
  const produccion = [...catalogo.values()].filter((e) => e.plantillaJarl);
  const especiales = [...catalogo.values()].filter((e) => e.proyectoJarl);
  assert.strictEqual(especiales.length, 14, "docs/Backlog_Mecanicas_Futuras.md: 14 proyectos especiales del jarl construibles");
  assert.ok(produccion.length >= 1, "al menos el aserradero — las listas crecen (CLAUDE.md), no hay un número fijo esperado aquí");
  // ninguna entrada lleva los dos flags a la vez: son dos mecanismos distintos (ver JSDoc de cargarCatalogoPlantillas)
  assert.strictEqual([...catalogo.values()].filter((e) => e.plantillaJarl && e.proyectoJarl).length, 0);
  assert.strictEqual(catalogo.size, produccion.length + especiales.length);
});
