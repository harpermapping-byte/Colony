// Tests del cuerpo de agentes móviles — reglas de docs/GDD_Agentes_Moviles.md.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MapSchema } from "@colyseus/schema";
import { GestorAgentes, tramoActivoPorHora, NpcBakeado, TramoRutina } from "../src/mundo/agentes";
import { Npc } from "../src/rooms/schema/HubState";

const tramo = (parcial: Partial<TramoRutina>): TramoRutina => ({
  lugar: "plaza",
  accion: "pasear",
  horaInicio: 0,
  horaFin: 24,
  punto: { x: 0, y: 0 },
  camino: null,
  ...parcial,
});

// rutina típica: casa (dormir) → trabajo → taberna → casa
const rutinaTipo = (): TramoRutina[] => [
  tramo({ lugar: "casa", accion: "dormir", horaInicio: 0, horaFin: 7, punto: { x: 2, y: 2 } }),
  tramo({
    lugar: "trabajo",
    accion: "trabajar",
    horaInicio: 7,
    horaFin: 18,
    punto: { x: 10, y: 2 },
    camino: [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 10, y: 2 },
    ],
  }),
  tramo({ lugar: "taberna", accion: "beber", horaInicio: 18, horaFin: 22, punto: { x: 10, y: 8 } }),
  tramo({ lugar: "casa", accion: "dormir", horaInicio: 22, horaFin: 24, punto: { x: 2, y: 2 } }),
];

const npcDe = (rutina: TramoRutina[]): NpcBakeado => ({ slotId: "npc_test", nombre: "Prueba", rutina });

test("tramoActivoPorHora: dentro de tramo, en hueco y en la madrugada antes del primero", () => {
  const rutina = rutinaTipo();
  assert.strictEqual(tramoActivoPorHora(rutina, 8), 1);
  assert.strictEqual(tramoActivoPorHora(rutina, 21.9), 2);
  // hueco imposible aquí, pero la madrugada tras el último tramo del día
  // debe caer en el ÚLTIMO empezado, no en el primero del día siguiente
  assert.strictEqual(tramoActivoPorHora(rutina, 23.5), 3);
});

test("iniciar: el NPC nace YA en el punto de su tramo activo (estado derivable de la hora)", () => {
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  gestor.iniciar([npcDe(rutinaTipo())], 12); // mediodía: en el trabajo
  const npc = salida.get("npc_test")!;
  assert.strictEqual(npc.x, 10.5);
  assert.strictEqual(npc.y, 2.5);
  assert.strictEqual(npc.accion, "trabajar");
  assert.strictEqual(npc.visible, true);
});

test("un NPC en casa no se pinta en el exterior (visible=false)", () => {
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  gestor.iniciar([npcDe(rutinaTipo())], 3); // durmiendo
  assert.strictEqual(salida.get("npc_test")!.visible, false);
});

test("cambio de tramo CON camino bakeado: viaja por la polilínea a velocidad de NPC, y al llegar queda QUIETO", () => {
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  gestor.iniciar([npcDe(rutinaTipo())], 6.9); // aún dormido en casa
  const npc = salida.get("npc_test")!;

  gestor.tick(0.1, 7.01); // arranca el tramo de trabajo → VIAJANDO
  assert.strictEqual(npc.visible, true, "al ponerse en marcha debe verse");
  const x0 = npc.x;
  gestor.tick(1, 7.02); // 1 s de viaje ≈ 1.9 casillas
  assert.ok(npc.x > x0 && npc.x < 10.5, `debería estar de camino (x=${npc.x})`);

  for (let i = 0; i < 10; i++) gestor.tick(1, 7.1); // de sobra para llegar
  assert.strictEqual(npc.x, 10.5);
  assert.strictEqual(npc.y, 2.5);
});

test("cambio de tramo SIN camino bakeado: teleport al destino (regla dura: nunca A* en vivo)", () => {
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  gestor.iniciar([npcDe(rutinaTipo())], 12);
  const npc = salida.get("npc_test")!;
  gestor.tick(0.1, 19); // tramo taberna, sin camino
  assert.strictEqual(npc.x, 10.5);
  assert.strictEqual(npc.y, 8.5);
  assert.strictEqual(npc.accion, "beber");
});

test("un NPC sin rutina no sale al mapa", () => {
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  gestor.iniciar([npcDe([])], 12);
  assert.strictEqual(salida.size, 0);
  assert.strictEqual(gestor.cantidad, 0);
});

test("turno de noche (19→7): el tramo que cruza la medianoche manda a las 23h y a las 3h", () => {
  const rutina: TramoRutina[] = [
    tramo({ lugar: "puesto", accion: "vigilar", horaInicio: 19, horaFin: 7, punto: { x: 5, y: 5 } }),
    tramo({ lugar: "casa", accion: "dormir", horaInicio: 7.5, horaFin: 14, punto: { x: 1, y: 1 } }),
    tramo({ lugar: "taberna", accion: "beber", horaInicio: 15, horaFin: 18.7, punto: { x: 8, y: 8 } }),
  ];
  assert.strictEqual(tramoActivoPorHora(rutina, 23), 0);
  assert.strictEqual(tramoActivoPorHora(rutina, 3), 0);
  assert.strictEqual(tramoActivoPorHora(rutina, 10), 1);
  assert.strictEqual(tramoActivoPorHora(rutina, 16), 2);
});

test("ronda con paradas: el agente recorre el bucle parada a parada con pausas, sin quedarse clavado", () => {
  const paradas = [
    { x: 0, y: 0, camino: [{ x: 8, y: 0 }, { x: 0, y: 0 }] },
    { x: 8, y: 0, camino: [{ x: 0, y: 0 }, { x: 8, y: 0 }] },
  ];
  const rutina: TramoRutina[] = [
    tramo({ lugar: "ronda", accion: "patrullar", horaInicio: 0, horaFin: 24, punto: { x: 0, y: 0 }, paradas }),
  ];
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  gestor.iniciar([npcDe(rutina)], 12);
  const npc = salida.get("npc_test")!;
  assert.strictEqual(npc.x, 0.5);

  // pasan la pausa (7s) y viaja hacia la parada 1 (x=8)
  const posiciones = new Set<number>();
  for (let i = 0; i < 60; i++) {
    gestor.tick(0.5, 12);
    posiciones.add(Math.round(npc.x));
  }
  assert.ok(posiciones.has(8) || posiciones.has(9), "debería haber llegado a la parada opuesta");
  assert.ok(posiciones.size > 3, `debería haberse visto en varias posiciones del trayecto (${[...posiciones]})`);
});

test("el multiplicador de velocidad (npc.velocidad) acelera el avance sin romper la llegada", () => {
  const rutinaRapida = () => [
    tramo({ lugar: "casa", accion: "dormir", horaInicio: 0, horaFin: 7, punto: { x: 2, y: 2 } }),
    tramo({
      lugar: "trabajo", accion: "correr", horaInicio: 7, horaFin: 20, punto: { x: 20, y: 2 },
      camino: [{ x: 2, y: 2 }, { x: 20, y: 2 }],
    }),
  ];
  const salida = new MapSchema<Npc>();
  const gestor = new GestorAgentes(salida);
  const rapido: NpcBakeado = { slotId: "rapido", nombre: "Corredor", velocidad: 3, rutina: rutinaRapida() };
  const normal: NpcBakeado = { slotId: "normal", nombre: "Normal", rutina: rutinaRapida() };
  gestor.iniciar([rapido, normal], 6.9);
  gestor.tick(0.1, 7.01);
  gestor.tick(2, 7.02); // 2s de viaje: normal ≈3.8 casillas, rápido ≈11.4
  const xRapido = salida.get("rapido")!.x;
  const xNormal = salida.get("normal")!.x;
  assert.ok(xRapido > xNormal, `el corredor (${xRapido}) debería ir más lejos que el normal (${xNormal}) en el mismo tiempo`);
});
