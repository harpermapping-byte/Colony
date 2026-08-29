// Tests de inventario/cogerSoltar.ts (fase 2 de inventario, "coger del
// mundo" — docs/GDD_Inventario.md §7). El punto crítico: `agregarItem`
// puede dejar el contenedor A MEDIAS si la cantidad no cabe entera del todo
// (documentado en inventario.ts) — bug real encontrado en la crítica
// adversarial del diseño ("todo o nada" no era cierto tal cual, ver
// propuesta B). `intentarCoger` tiene que deshacerlo entero si falla.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { intentarCoger } from "../src/inventario/cogerSoltar";
import { CatalogoItems, Contenedor, crearContenedor, agregarItem } from "../src/inventario/inventario";

const CATALOGO: CatalogoItems = {
  trebol: { tipo: "recurso", huella: [1, 1], peso: 0.15, apilable: true, stackMax: 3, variantes: 1, colorDebug: "#000" },
  reliquia: { tipo: "objeto", huella: [1, 1], peso: 0.5, apilable: false, variantes: 1, colorDebug: "#000" },
};

test("intentarCoger: cabe entero -> ok, se añade tal cual (mismo comportamiento que agregarItem cuando no falla)", () => {
  const c = crearContenedor(4, 4);
  const resultado = intentarCoger(c, CATALOGO, { itemId: "trebol", cantidad: 2 });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(c.items.length, 1);
  assert.strictEqual(c.items[0].cantidad, 2);
});

test("intentarCoger: item desconocido -> ok:false, contenedor totalmente intacto", () => {
  const c = crearContenedor(4, 4);
  const antes = JSON.stringify(c);
  const resultado = intentarCoger(c, CATALOGO, { itemId: "no_existe", cantidad: 1 });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "item_desconocido");
  assert.strictEqual(JSON.stringify(c), antes);
});

test("intentarCoger: cantidad que solo cabe A MEDIAS (apila lo que puede, falla al abrir pila nueva) -> se DESHACE entera, cero duplicación/pérdida", () => {
  // contenedor de 1x1: una sola casilla, con un trébol ya apilado a 2/3 del stackMax
  const c: Contenedor = crearContenedor(1, 1);
  const primero = agregarItem(c, CATALOGO, "trebol", 2);
  assert.strictEqual(primero.ok, true);
  const snapshotAntes = JSON.stringify(c);

  // pedir coger 5 más: caben 1 (llega a stackMax=3) pero sobran 4 sin ningún
  // hueco donde abrir una pila nueva (contenedor 1x1 ya ocupado) — agregarItem
  // A PELO dejaría el contenedor con 3/3 (parcialmente mutado) y ok:false;
  // intentarCoger debe devolver el contenedor EXACTAMENTE como estaba.
  const resultado = intentarCoger(c, CATALOGO, { itemId: "trebol", cantidad: 5 });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "sin_hueco");
  assert.strictEqual(JSON.stringify(c), snapshotAntes, "el contenedor no debe quedar a medias tras un coger fallido");
});

test("intentarCoger: ítem no apilable sin hueco -> falla limpio, contenedor intacto", () => {
  const c = crearContenedor(1, 1);
  const primero = agregarItem(c, CATALOGO, "reliquia", 1);
  assert.strictEqual(primero.ok, true);
  const snapshotAntes = JSON.stringify(c);

  const resultado = intentarCoger(c, CATALOGO, { itemId: "reliquia", cantidad: 1 });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "sin_hueco");
  assert.strictEqual(JSON.stringify(c), snapshotAntes);
});
