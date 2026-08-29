// Tests de mundo/cadaveres.ts — cadáveres lootables (pedido del streamer
// 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  ALTO_INVENTARIO_CADAVER,
  ANCHO_INVENTARIO_CADAVER,
  cadaverDesaparecio,
  crearCadaver,
} from "../src/mundo/cadaveres";

test("crearCadaver: guarda origen/posición/momento y un contenedor vacío del tamaño estándar", () => {
  const c = crearCadaver({
    id: "cadaver:1",
    mapaId: "principal",
    tipoOrigen: "animal",
    especieOrigenId: "lobo",
    x: 10.5,
    y: 20.5,
    ahora: 30,
  });
  assert.strictEqual(c.tipoOrigen, "animal");
  assert.strictEqual(c.especieOrigenId, "lobo");
  assert.strictEqual(c.x, 10.5);
  assert.strictEqual(c.y, 20.5);
  assert.strictEqual(c.muertoEn, 30);
  assert.strictEqual(c.contenedor.ancho, ANCHO_INVENTARIO_CADAVER);
  assert.strictEqual(c.contenedor.alto, ALTO_INVENTARIO_CADAVER);
  assert.deepStrictEqual(c.contenedor.items, []);
});

test("crearCadaver: mismo tamaño de inventario sea cual sea el tipo de origen (animal/npc/jugador)", () => {
  const base = { id: "x", mapaId: "principal", x: 0, y: 0, ahora: 0 };
  const animal = crearCadaver({ ...base, tipoOrigen: "animal", especieOrigenId: "lobo" });
  const npc = crearCadaver({ ...base, tipoOrigen: "npc", especieOrigenId: "guardia" });
  const jugador = crearCadaver({ ...base, tipoOrigen: "jugador", especieOrigenId: "Ragnar" });
  assert.strictEqual(animal.contenedor.ancho, npc.contenedor.ancho);
  assert.strictEqual(npc.contenedor.ancho, jugador.contenedor.ancho);
  assert.strictEqual(animal.contenedor.alto, npc.contenedor.alto);
  assert.strictEqual(npc.contenedor.alto, jugador.contenedor.alto);
});

test("cadaverDesaparecio: false antes de 1 día, true al cumplirse — da igual que se haya lootado o no (no hay ese dato aquí)", () => {
  const c = { muertoEn: 10 };
  assert.strictEqual(cadaverDesaparecio(c, 10.9), false);
  assert.strictEqual(cadaverDesaparecio(c, 11), true);
  assert.strictEqual(cadaverDesaparecio(c, 50), true);
});
