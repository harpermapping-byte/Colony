// Test de integración de mundo/agentesInterior.ts CONTRA un bake real
// (assets/mapas/testflat) — mundo/interiorColision.test.ts ya cubre el
// loader con fixtures sintéticas, agentesInterior.test.ts cubre la lógica
// con interiores sintéticos; este archivo cierra el hueco real que dejaban
// ambos: el bug de mismatch de id encontrado 2026-09-08 (poblacion.json
// escribe casaEdificioId con el "id" del bake, InteriorRoom.ts antes
// comparaba contra el nombre de ARCHIVO — nunca coincidían en
// testaldea/testflat, "vida en interiores" nunca poblaba NADA ahí en
// silencio) solo salió a la luz probando contra datos reales, ninguna
// fixture sintética lo habría detectado. Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { MapSchema } from "@colyseus/schema";
import { cargarInterior } from "../src/mundo/interiorColision";
import { GestorVidaInterior, NpcConCasa } from "../src/mundo/agentesInterior";
import { Npc } from "../src/rooms/schema/HubState";

const RAIZ = path.resolve(__dirname, "..", "..");
const RUTA_MAPA = path.join(RAIZ, "assets", "mapas", "testflat");
const RUTA_INTERIOR = path.join(RUTA_MAPA, "interiores", "casa_humilde_testaldea-01_casa_humilde_4.json");
const RUTA_POBLACION = path.join(RUTA_MAPA, "poblacion.json");

test("GestorVidaInterior contra un bake real: casaEdificioId (id del bake, con ':') SÍ coincide con interior.id, aunque el archivo en disco use '_'", () => {
  if (!fs.existsSync(RUTA_INTERIOR) || !fs.existsSync(RUTA_POBLACION)) return; // bake de prueba ausente en este checkout, no romper CI
  const interior = cargarInterior(RUTA_INTERIOR, 0);
  const poblacion = JSON.parse(fs.readFileSync(RUTA_POBLACION, "utf8")) as { npcs: NpcConCasa[] };

  // el bug real: interior.id lleva ':' (id interno del bake), el nombre de
  // archivo en disco lleva '_' — son DISTINTOS de verdad en este mapa
  assert.notStrictEqual(interior.id, path.basename(RUTA_INTERIOR, ".json"), "en testflat el id del bake y el nombre de archivo divergen de verdad — si esto deja de ser cierto, la regresión de abajo ya no prueba nada real");

  const residentes = poblacion.npcs.filter((n) => n.casaEdificioId === interior.id);
  assert.ok(residentes.length > 0, "poblacion.json debe tener al menos un NPC cuya casaEdificioId coincida con interior.id (el bug hacía que esto SIEMPRE diera 0 con el nombre de archivo)");
});

test("GestorVidaInterior contra un bake real: un residente real se tumba EXACTO sobre la cama real de su dormitorio a la hora de dormir", () => {
  if (!fs.existsSync(RUTA_INTERIOR) || !fs.existsSync(RUTA_POBLACION)) return;
  const interior = cargarInterior(RUTA_INTERIOR, 0);
  const poblacion = JSON.parse(fs.readFileSync(RUTA_POBLACION, "utf8")) as { npcs: NpcConCasa[] };
  const residentes = poblacion.npcs.filter((n) => n.casaEdificioId === interior.id);
  assert.ok(residentes.length > 0);

  const camas = interior.mueblesPorSala.get("dormitorio_individual")?.filter((m) => m.esCama) ?? [];
  assert.ok(camas.length > 0, "este bake de prueba debe traer al menos una cama real en el dormitorio");

  const salida = new MapSchema<Npc>();
  const gestor = new GestorVidaInterior();
  // 0.5h: dentro del tramo real "dormir" (23.62-7.95, cruza medianoche) de
  // aldeano_0 en este bake — ver poblacion.json.
  gestor.repoblar(salida, residentes, interior.id, 0, interior, 0.5);
  const durmiendo = [...salida.values()].filter((n) => n.durmiendo);
  assert.strictEqual(durmiendo.length, 1, "exactamente un residente durmiendo a esta hora en este bake de prueba");
  const npc = durmiendo[0];
  const cama = camas[0];
  assert.ok(Math.abs(npc.x - (cama.x + 0.5)) < 0.01 && Math.abs(npc.y - (cama.y + 0.5)) < 0.01, `debe caer EXACTO sobre la cama real (${cama.x},${cama.y}), cayó en (${npc.x},${npc.y})`);
});
