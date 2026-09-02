// Tests de la lógica PURA de líquidos en recipientes portables
// (server/src/inventario/liquidos.ts). Ejecutar: npm test (tsx --test).
import { test } from "node:test";
import * as assert from "node:assert";
import { esRecipienteLiquido, tieneLiquido, llenar, vaciar, consumirVolumen, transferirLiquido, LiquidoGranel } from "../src/inventario/liquidos";
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

// docs/GDD_Carros.md §8.5 (Fase 2, pedido 2026-09-03) — cisterna de carro -> recipiente portable.
function cisterna(volumenMl: number, volumenMaxMl = 20000, tipo = "agua"): LiquidoGranel {
  return { tipo, volumenMl, volumenMaxMl };
}

test("transferirLiquido: llena el recipiente vacío hasta su tope, resta lo mismo de la cisterna", () => {
  const c = cisterna(20000);
  const it = instancia();
  const transferido = transferirLiquido(c, it, recipiente(2000));
  assert.strictEqual(transferido, 2000);
  assert.strictEqual(it.liquido?.volumenMl, 2000);
  assert.strictEqual(it.liquido?.tipo, "agua");
  assert.strictEqual(c.volumenMl, 18000);
});

test("transferirLiquido: vacía la cisterna entera si tiene menos que el hueco del recipiente", () => {
  const c = cisterna(500);
  const it = instancia();
  const transferido = transferirLiquido(c, it, recipiente(2000));
  assert.strictEqual(transferido, 500);
  assert.strictEqual(it.liquido?.volumenMl, 500);
  assert.strictEqual(c.volumenMl, 0);
});

test("transferirLiquido: SUMA sobre el mismo tipo de líquido que ya llevara el destino, respetando el tope", () => {
  const c = cisterna(20000);
  const it = instancia();
  llenar(it, recipiente(2000), "agua"); // ya tiene 2000/2000 lleno
  const transferido = transferirLiquido(c, it, recipiente(2000));
  assert.strictEqual(transferido, 0, "ya estaba lleno, no cabe nada más");
  assert.strictEqual(c.volumenMl, 20000, "la cisterna no pierde nada si no se transfirió nada");

  vaciar(it);
  const it2 = instancia();
  llenar(it2, recipiente(2000), "agua");
  const bebido = consumirVolumen(it2, 500); // deja 1500/2000
  assert.strictEqual(bebido, 500);
  const transferido2 = transferirLiquido(c, it2, recipiente(2000));
  assert.strictEqual(transferido2, 500, "solo lo que faltaba para llenar");
  assert.strictEqual(it2.liquido?.volumenMl, 2000);
});

test("transferirLiquido: rechaza mezclar con un líquido DISTINTO ya presente (todo o nada)", () => {
  const c = cisterna(20000, 20000, "agua");
  const it = instancia();
  llenar(it, recipiente(2000), "leche");
  const transferido = transferirLiquido(c, it, recipiente(2000));
  assert.strictEqual(transferido, 0);
  assert.strictEqual(it.liquido?.tipo, "leche", "no se sobrescribe el líquido existente");
  assert.strictEqual(c.volumenMl, 20000);
});

test("transferirLiquido: nada si la cisterna está vacía, o el destino no es un recipiente de líquido", () => {
  const cVacia = cisterna(0);
  const it = instancia();
  assert.strictEqual(transferirLiquido(cVacia, it, recipiente(2000)), 0);

  const c = cisterna(20000);
  const it2 = instancia();
  assert.strictEqual(transferirLiquido(c, it2, objetoNormal()), 0);
  assert.strictEqual(it2.liquido, undefined);
});
