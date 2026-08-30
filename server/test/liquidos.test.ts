// Tests de la lógica PURA de líquidos en recipientes portables
// (server/src/inventario/liquidos.ts). Ejecutar: npm test (tsx --test).
import { test } from "node:test";
import * as assert from "node:assert";
import { esRecipienteLiquido, tieneLiquido, llenar, vaciar, consumirVolumen } from "../src/inventario/liquidos";
import { EntradaCatalogoItem, ItemInstancia } from "../src/inventario/inventario";

function recipiente(volumenMaxMl: number): EntradaCatalogoItem {
  return { tipo: "objeto", huella: [1, 1], peso: 0.3, apilable: false, variantes: 1, colorDebug: "#000000", volumenMaxMl };
}
function objetoNormal(): EntradaCatalogoItem {
  return { tipo: "objeto", huella: [1, 1], peso: 0.3, apilable: false, variantes: 1, colorDebug: "#000000" };
}
function instancia(): ItemInstancia {
  return { id: 1, itemId: "cantimplora", cantidad: 1, x: 0, y: 0, rot: 0 };
}

test("esRecipienteLiquido: solo si el catálogo declara volumenMaxMl > 0", () => {
  assert.strictEqual(esRecipienteLiquido(recipiente(500)), true);
  assert.strictEqual(esRecipienteLiquido(objetoNormal()), false);
  assert.strictEqual(esRecipienteLiquido(recipiente(0)), false);
});

test("llenar: sustituye el contenido entero hasta el tope, sin mezclar", () => {
  const it = instancia();
  const cubo = recipiente(2000);
  llenar(it, cubo, "agua");
  assert.deepStrictEqual(it.liquido, { tipo: "agua", volumenMl: 2000, contaminada: false });

  llenar(it, cubo, "leche"); // vuelve a llenar: sustituye, no mezcla
  assert.deepStrictEqual(it.liquido, { tipo: "leche", volumenMl: 2000, contaminada: false });
});

test("llenar: no hace nada si la entrada no es un recipiente", () => {
  const it = instancia();
  llenar(it, objetoNormal(), "agua");
  assert.strictEqual(it.liquido, undefined);
});

test("llenar: puede marcar contaminada (agua estancada)", () => {
  const it = instancia();
  llenar(it, recipiente(500), "agua", true);
  assert.strictEqual(it.liquido?.contaminada, true);
});

test("tieneLiquido: false si está vacío o no coincide el tipo esperado", () => {
  const it = instancia();
  assert.strictEqual(tieneLiquido(it), false);
  llenar(it, recipiente(500), "agua");
  assert.strictEqual(tieneLiquido(it), true);
  assert.strictEqual(tieneLiquido(it, "agua"), true);
  assert.strictEqual(tieneLiquido(it, "leche"), false);
});

test("vaciar: deja el recipiente sin líquido", () => {
  const it = instancia();
  llenar(it, recipiente(500), "agua");
  vaciar(it);
  assert.strictEqual(it.liquido, undefined);
  assert.strictEqual(tieneLiquido(it), false);
});

test("consumirVolumen: bebe hasta lo pedido, nunca más de lo que hay", () => {
  const it = instancia();
  llenar(it, recipiente(500), "agua");
  const bebido1 = consumirVolumen(it, 250);
  assert.strictEqual(bebido1, 250);
  assert.strictEqual(it.liquido?.volumenMl, 250);

  const bebido2 = consumirVolumen(it, 400); // pide más de lo que queda
  assert.strictEqual(bebido2, 250, "solo da lo que había");
  assert.strictEqual(it.liquido, undefined, "se vacía del todo al agotarse");
});

test("consumirVolumen: sobre un recipiente vacío no da nada, no revienta", () => {
  const it = instancia();
  assert.strictEqual(consumirVolumen(it, 100), 0);
});
