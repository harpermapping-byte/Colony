// Tests de mundo/agentesInterior.ts — "vida en interiores"
// (docs/GDD_Agentes_Moviles.md v1.2). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MapSchema } from "@colyseus/schema";
import { poblarInterior, NpcConCasa } from "../src/mundo/agentesInterior";
import { Npc } from "../src/rooms/schema/HubState";
import type { InteriorCargado } from "../src/mundo/interiorColision";

function interiorDe(salasPorTipo: Record<string, { x: number; y: number }[]>): InteriorCargado {
  return {
    id: "casa-prueba",
    nivel: 0,
    rol: "planta_baja",
    ancho: 10,
    alto: 10,
    casillas: new Uint8Array(100),
    velocidad: new Float32Array(100).fill(1),
    spawnX: 1.5,
    spawnY: 1.5,
    conectores: [],
    spawnsEnemigos: [],
    salasPorTipo: new Map(Object.entries(salasPorTipo)),
  };
}

const npcCasa = (slotId: string, extra: Partial<NpcConCasa> = {}): NpcConCasa => ({
  slotId,
  nombre: slotId,
  casaEdificioId: "casa-prueba",
  rutina: [
    { lugar: "casa", accion: "dormir", horaInicio: 22, horaFin: 7, punto: { x: 1, y: 1 }, sala: { tipoSalaId: "dormitorio", planta: 0 } },
    { lugar: "casa", accion: "socializar", horaInicio: 19, horaFin: 22, punto: { x: 1, y: 1 }, sala: { tipoSalaId: "salon", planta: 0 } },
    { lugar: "trabajo", accion: "trabajar", horaInicio: 7, horaFin: 19, punto: { x: 50, y: 50 } },
  ],
  ...extra,
});

test("poblarInterior: una familia entera (misma casa) aparece junta en el salón a la hora de socializar", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }], dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  const familia = [npcCasa("padre"), npcCasa("madre"), npcCasa("hijo")];
  poblarInterior(salida, familia, "casa-prueba", 0, interior, 20);
  assert.strictEqual(salida.size, 3);
  for (const slot of ["padre", "madre", "hijo"]) {
    const npc = salida.get(slot)!;
    // jitter determinista por slotId (nunca perfectamente apilados): cerca
    // del punto de la sala, no exacto
    assert.ok(Math.abs(npc.x - 4.5) < 0.4, `x fuera de rango: ${npc.x}`);
    assert.ok(Math.abs(npc.y - 4.5) < 0.4, `y fuera de rango: ${npc.y}`);
    assert.strictEqual(npc.accion, "socializar");
    assert.strictEqual(npc.visible, true);
  }
});

test("poblarInterior: a la hora de trabajar (fuera de casa) la familia NO aparece dentro", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }], dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  poblarInterior(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 12); // 12h: tramo "trabajo"
  assert.strictEqual(salida.size, 0);
});

test("poblarInterior: solo entra quien vive en ESTE edificio, no en otra casa del mismo pueblo", () => {
  const interior = interiorDe({ dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  const otraCasa = npcCasa("vecino", { casaEdificioId: "otra-casa" });
  poblarInterior(salida, [npcCasa("padre"), otraCasa], "casa-prueba", 0, interior, 1);
  assert.strictEqual(salida.size, 1);
  assert.ok(salida.has("padre"));
});

test("poblarInterior: un cambio de tramo saca al NPC que ya no toca (se llama nombre-la-planta cada vez)", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }], dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  const npc = npcCasa("padre");
  poblarInterior(salida, [npc], "casa-prueba", 0, interior, 20); // socializando
  assert.strictEqual(salida.size, 1);
  poblarInterior(salida, [npc], "casa-prueba", 0, interior, 12); // ahora trabaja fuera
  assert.strictEqual(salida.size, 0, "debería salir del interior al cambiar de tramo");
});

test("poblarInterior: sin sala resuelta (no hay dormitorio en esta casa) cae junto al spawn, no rompe", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }] }); // sin "dormitorio"
  const salida = new MapSchema<Npc>();
  poblarInterior(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 23); // tramo dormir, sin sala dormitorio
  const npc = salida.get("padre")!;
  assert.ok(Math.abs(npc.x - interior.spawnX) < 0.4);
  assert.ok(Math.abs(npc.y - interior.spawnY) < 0.4);
});

test("poblarInterior: una planta distinta a la del tramo no entra (dormitorio en la planta 1, aquí es la 0)", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }] });
  const salida = new MapSchema<Npc>();
  const arriba = npcCasa("padre", {
    rutina: [{ lugar: "casa", accion: "dormir", horaInicio: 22, horaFin: 7, punto: { x: 1, y: 1 }, sala: { tipoSalaId: "dormitorio", planta: 1 } }],
  });
  poblarInterior(salida, [arriba], "casa-prueba", 0, interior, 23);
  assert.strictEqual(salida.size, 0);
});
