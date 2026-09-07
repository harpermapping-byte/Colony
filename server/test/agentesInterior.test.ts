// Tests de mundo/agentesInterior.ts — "vida en interiores"
// (docs/GDD_Agentes_Moviles.md v1.2/v1.4). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MapSchema } from "@colyseus/schema";
import { GestorVidaInterior, NpcConCasa } from "../src/mundo/agentesInterior";
import { Npc } from "../src/rooms/schema/HubState";
import { caminoEntre } from "../src/mundo/interiorColision";
import type { InteriorCargado, MuebleInteractivo } from "../src/mundo/interiorColision";
import { TIPO } from "../src/mundo/colisiones";

function interiorDe(
  salasPorTipo: Record<string, { x: number; y: number }[]>,
  mueblesPorSala: Record<string, MuebleInteractivo[]> = {},
): InteriorCargado {
  return {
    id: "casa-prueba",
    tipoEdificioId: "casa_humilde",
    nivel: 0,
    rol: "planta_baja",
    ancho: 10,
    alto: 10,
    // toda TIERRA (0) por defecto — un piso abierto de 10x10 sin paredes,
    // así `caminoEntre` siempre encuentra camino real en estos fixtures.
    casillas: new Uint8Array(100),
    velocidad: new Float32Array(100).fill(1),
    spawnX: 1.5,
    spawnY: 1.5,
    conectores: [],
    spawnsEnemigos: [],
    salasPorTipo: new Map(Object.entries(salasPorTipo)),
    mueblesPorSala: new Map(Object.entries(mueblesPorSala)),
    salasIndexadas: [],
    objetosSueltos: new Map(),
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

test("GestorVidaInterior.repoblar: una familia entera (misma casa) aparece junta en el salón a la hora de socializar", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }], dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  const familia = [npcCasa("padre"), npcCasa("madre"), npcCasa("hijo")];
  new GestorVidaInterior().repoblar(salida, familia, "casa-prueba", 0, interior, 20);
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

test("GestorVidaInterior.repoblar: a la hora de trabajar (fuera de casa) la familia NO aparece dentro", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }], dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 12); // 12h: tramo "trabajo"
  assert.strictEqual(salida.size, 0);
});

test("GestorVidaInterior.repoblar: solo entra quien vive en ESTE edificio, no en otra casa del mismo pueblo", () => {
  const interior = interiorDe({ dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  const otraCasa = npcCasa("vecino", { casaEdificioId: "otra-casa" });
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre"), otraCasa], "casa-prueba", 0, interior, 1);
  assert.strictEqual(salida.size, 1);
  assert.ok(salida.has("padre"));
});

test("GestorVidaInterior.repoblar: un cambio de tramo saca al NPC que ya no toca (se llama cada vez)", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }], dormitorio: [{ x: 2, y: 2 }] });
  const salida = new MapSchema<Npc>();
  const npc = npcCasa("padre");
  const gestor = new GestorVidaInterior();
  gestor.repoblar(salida, [npc], "casa-prueba", 0, interior, 20); // socializando
  assert.strictEqual(salida.size, 1);
  gestor.repoblar(salida, [npc], "casa-prueba", 0, interior, 12); // ahora trabaja fuera
  assert.strictEqual(salida.size, 0, "debería salir del interior al cambiar de tramo");
});

test("GestorVidaInterior.repoblar: sin sala resuelta (no hay dormitorio en esta casa) cae junto al spawn, no rompe", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }] }); // sin "dormitorio"
  const salida = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 23); // tramo dormir, sin sala dormitorio
  const npc = salida.get("padre")!;
  assert.ok(Math.abs(npc.x - interior.spawnX) < 0.4);
  assert.ok(Math.abs(npc.y - interior.spawnY) < 0.4);
});

test("GestorVidaInterior.repoblar: una planta distinta a la del tramo no entra (dormitorio en la planta 1, aquí es la 0)", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }] });
  const salida = new MapSchema<Npc>();
  const arriba = npcCasa("padre", {
    rutina: [{ lugar: "casa", accion: "dormir", horaInicio: 22, horaFin: 7, punto: { x: 1, y: 1 }, sala: { tipoSalaId: "dormitorio", planta: 1 } }],
  });
  new GestorVidaInterior().repoblar(salida, [arriba], "casa-prueba", 0, interior, 23);
  assert.strictEqual(salida.size, 0);
});

test("GestorVidaInterior.repoblar: varios NPCs de la MISMA sala reciben puntos distintos (round-robin, no se apelotonan)", () => {
  const interior = interiorDe({
    salon: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 4, y: 5 }],
  });
  const salida = new MapSchema<Npc>();
  const grupo = [npcCasa("a"), npcCasa("b"), npcCasa("c"), npcCasa("d")];
  new GestorVidaInterior().repoblar(salida, grupo, "casa-prueba", 0, interior, 20);
  const posiciones = new Set<string>();
  for (const slot of ["a", "b", "c", "d"]) {
    const npc = salida.get(slot)!;
    posiciones.add(`${Math.round(npc.x)},${Math.round(npc.y)}`);
  }
  assert.strictEqual(posiciones.size, 4, `deberían caer en 4 casillas distintas, hubo ${posiciones.size}`);
});

test("GestorVidaInterior.repoblar: un trabajador aparece DENTRO de su tienda durante el tramo de trabajo (trabajoEdificioId)", () => {
  const interior = interiorDe({ sala_comercio: [{ x: 3, y: 3 }] });
  const salida = new MapSchema<Npc>();
  const tendero: NpcConCasa = {
    slotId: "tendero_0",
    nombre: "Tendero",
    casaEdificioId: "otra-casa",
    trabajoEdificioId: "casa-prueba",
    rutina: [
      { lugar: "casa", accion: "dormir", horaInicio: 22, horaFin: 7, punto: { x: 1, y: 1 } },
      { lugar: "trabajo", accion: "vender", horaInicio: 8, horaFin: 20, punto: { x: 3, y: 3 }, sala: { tipoSalaId: "sala_comercio", planta: 0 } },
    ],
  };
  const gestor = new GestorVidaInterior();
  gestor.repoblar(salida, [tendero], "casa-prueba", 0, interior, 12);
  const npc = salida.get("tendero_0")!;
  assert.ok(Math.abs(npc.x - 3.5) < 0.4, `x fuera de rango: ${npc.x}`);
  assert.ok(Math.abs(npc.y - 3.5) < 0.4, `y fuera de rango: ${npc.y}`);
  assert.strictEqual(npc.accion, "vender");

  // fuera de horario (durmiendo en SU casa, no en la tienda): no aparece aquí
  const salida2 = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida2, [tendero], "casa-prueba", 0, interior, 2);
  assert.strictEqual(salida2.size, 0);
});

// --- v1.4 (2026-09-08): silla/cama real + caminar entre salas ---

function mueble(x: number, y: number, instanceId: string, esCama: boolean, esSilla: boolean): MuebleInteractivo {
  return { x, y, instanceId, esCama, esSilla };
}

test("GestorVidaInterior.repoblar: con una cama real en el dormitorio, dormir se tumba EN la cama y enciende Npc.durmiendo", () => {
  const interior = interiorDe(
    { dormitorio: [{ x: 2, y: 2 }] },
    { dormitorio: [mueble(2, 3, "cama-1", true, false)] },
  );
  const salida = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 23); // tramo dormir
  const npc = salida.get("padre")!;
  assert.ok(Math.abs(npc.x - 2.5) < 0.05 && Math.abs(npc.y - 3.5) < 0.05, "debe caer EXACTO sobre la cama, sin jitter");
  assert.strictEqual(npc.durmiendo, true);
  assert.strictEqual(npc.sentado, false);
});

test("GestorVidaInterior.repoblar: con una silla real en el salón, socializar se sienta EN la silla y enciende Npc.sentado", () => {
  const interior = interiorDe(
    { salon: [{ x: 4, y: 4 }] },
    { salon: [mueble(5, 5, "silla-1", false, true)] },
  );
  const salida = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 20); // tramo socializar
  const npc = salida.get("padre")!;
  assert.ok(Math.abs(npc.x - 5.5) < 0.05 && Math.abs(npc.y - 5.5) < 0.05, "debe caer EXACTO sobre la silla, sin jitter");
  assert.strictEqual(npc.sentado, true);
  assert.strictEqual(npc.durmiendo, false);
});

test("GestorVidaInterior.repoblar: sin mueble real en la sala, cae al punto genérico de siempre (comportamiento IDÉNTICO a v1.2)", () => {
  const interior = interiorDe({ salon: [{ x: 4, y: 4 }] }); // sin mueblesPorSala
  const salida = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre")], "casa-prueba", 0, interior, 20);
  const npc = salida.get("padre")!;
  assert.strictEqual(npc.sentado, false);
  assert.strictEqual(npc.durmiendo, false);
});

test("GestorVidaInterior: dos NPCs de la misma sala NUNCA reservan la MISMA cama (una cama, un ocupante)", () => {
  const interior = interiorDe(
    { dormitorio: [{ x: 2, y: 2 }] },
    { dormitorio: [mueble(2, 3, "cama-unica", true, false)] },
  );
  const salida = new MapSchema<Npc>();
  new GestorVidaInterior().repoblar(salida, [npcCasa("padre"), npcCasa("madre")], "casa-prueba", 0, interior, 23);
  const padre = salida.get("padre")!, madre = salida.get("madre")!;
  // solo uno de los dos consigue la cama real (durmiendo=true); el otro cae al punto genérico de dormitorio
  const durmiendoEnCama = [padre, madre].filter((n) => n.durmiendo);
  assert.strictEqual(durmiendoEnCama.length, 1, "solo un NPC puede estar tumbado EN esa cama a la vez");
});

test("GestorVidaInterior: un NPC ya existente que cambia de sala CAMINA de verdad (posición avanza paso a paso, no salta)", () => {
  const interior = interiorDe({ salon: [{ x: 8, y: 8 }], dormitorio: [{ x: 1, y: 1 }] });
  const salida = new MapSchema<Npc>();
  const npc = npcCasa("padre");
  const gestor = new GestorVidaInterior();
  // primera aparición (socializando en el salón, lejos): instantáneo, como siempre
  gestor.repoblar(salida, [npc], "casa-prueba", 0, interior, 20);
  const inicioX = salida.get("padre")!.x, inicioY = salida.get("padre")!.y;
  assert.ok(Math.abs(inicioX - 8.5) < 0.4 && Math.abs(inicioY - 8.5) < 0.4);

  // cambia a dormir (dormitorio, lejos del salón): esta vez NO debe saltar
  // directo — debe quedar caminando poco a poco
  gestor.repoblar(salida, [npc], "casa-prueba", 0, interior, 23);
  const trasCambioDeTramo = { x: salida.get("padre")!.x, y: salida.get("padre")!.y };
  assert.ok(
    Math.abs(trasCambioDeTramo.x - inicioX) < 0.01 && Math.abs(trasCambioDeTramo.y - inicioY) < 0.01,
    "justo al cambiar de objetivo todavía no se ha movido — el camino se recorre en avanzarCaminos, no de golpe aquí",
  );

  // avanza el camino paso a paso hasta llegar de verdad al dormitorio
  let pasos = 0;
  while (pasos < 200 && Math.hypot(salida.get("padre")!.x - 1.5, salida.get("padre")!.y - 1.5) > 0.01) {
    gestor.avanzarCaminos(salida);
    pasos++;
  }
  assert.ok(pasos > 3, `debería tardar varios pasos en cruzar la casa (tardó ${pasos})`);
  assert.ok(pasos < 200, "debe llegar de verdad al dormitorio, no quedarse atascado");
  assert.strictEqual(salida.get("padre")!.durmiendo, false, "de camino todavía no está tumbado");
});

test("GestorVidaInterior: al llegar al final del camino se sienta/tumba (la pose solo se activa AL LLEGAR, no de camino)", () => {
  const interior = interiorDe(
    { salon: [{ x: 8, y: 8 }], dormitorio: [{ x: 1, y: 1 }] },
    { dormitorio: [mueble(1, 1, "cama-x", true, false)] },
  );
  const salida = new MapSchema<Npc>();
  const npc = npcCasa("padre");
  const gestor = new GestorVidaInterior();
  gestor.repoblar(salida, [npc], "casa-prueba", 0, interior, 20); // aparece lejos, de pie
  gestor.repoblar(salida, [npc], "casa-prueba", 0, interior, 23); // ahora se dirige a la cama real

  for (let i = 0; i < 200 && !salida.get("padre")!.durmiendo; i++) gestor.avanzarCaminos(salida);
  const final = salida.get("padre")!;
  assert.strictEqual(final.durmiendo, true);
  assert.ok(Math.abs(final.x - 1.5) < 0.05 && Math.abs(final.y - 1.5) < 0.05, "termina EXACTO sobre la cama");
});

test("interiorColision.caminoEntre: BFS real que evita paredes (TIPO.SOLIDO)", () => {
  // fila y=5 entera bloqueada salvo el hueco en x=5 — el camino debe pasar por ahí
  const interior = interiorDe({});
  for (let x = 0; x < 10; x++) interior.casillas[5 * 10 + x] = TIPO.SOLIDO;
  interior.casillas[5 * 10 + 5] = TIPO.TIERRA; // hueco real
  const camino = caminoEntre(interior, { x: 2, y: 2 }, { x: 2, y: 8 });
  assert.ok(camino && camino.length > 0, "debe existir un camino real por el hueco");
  assert.ok(camino!.some((p: { x: number; y: number }) => p.x === 5 && p.y === 5), "el camino debe pasar por el único hueco de la pared");
});

test("interiorColision.caminoEntre: sin hueco en la pared, no hay camino (null, no revienta)", () => {
  const interior = interiorDe({});
  for (let x = 0; x < 10; x++) interior.casillas[5 * 10 + x] = TIPO.SOLIDO; // pared completa, sin hueco
  const camino = caminoEntre(interior, { x: 2, y: 2 }, { x: 2, y: 8 });
  assert.strictEqual(camino, null);
});
