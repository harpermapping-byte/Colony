// Tests de mundo/fauna.ts — fauna doméstica urbana (GDD_Agentes_Moviles.md
// v1.3). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MapSchema } from "@colyseus/schema";
import { GestorFauna, FaunaSpawn } from "../src/mundo/fauna";
import { Fauna } from "../src/rooms/schema/HubState";
import { TIPO } from "../src/mundo/colisiones";

// Mundo sintético 12x12 todo TIERRA (transitable) salvo un borde sólido —
// mismo patrón que los tests de colisiones.
function mundoAbierto(lado = 12) {
  const casillas = new Uint8Array(lado * lado).fill(TIPO.TIERRA);
  for (let x = 0; x < lado; x++) { casillas[x] = TIPO.SOLIDO; casillas[(lado - 1) * lado + x] = TIPO.SOLIDO; }
  for (let y = 0; y < lado; y++) { casillas[y * lado] = TIPO.SOLIDO; casillas[y * lado + lado - 1] = TIPO.SOLIDO; }
  return { ancho: lado, alto: lado, casillas, velocidad: new Float32Array(lado * lado).fill(1) };
}

test("GestorFauna.iniciar: cada spawn transitable aparece en el estado con su especie", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo);
  const spawns: FaunaSpawn[] = [
    { id: "a", especieId: "gallina_salvaje", x: 5, y: 5, radio: 3 },
    { id: "b", especieId: "perro", x: 6, y: 6, radio: 4 },
  ];
  gestor.iniciar(spawns);
  assert.strictEqual(salida.size, 2);
  assert.strictEqual(salida.get("a")!.especieId, "gallina_salvaje");
  assert.strictEqual(salida.get("b")!.especieId, "perro");
  assert.strictEqual(gestor.cantidad, 2);
});

test("GestorFauna.iniciar: un spawn que cae en un sólido se descarta (no rompe)", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo);
  gestor.iniciar([{ id: "muro", especieId: "gato", x: 0, y: 0, radio: 3 }]); // (0,0) es el borde sólido
  assert.strictEqual(salida.size, 0);
});

test("GestorFauna.tick: un animal en pausa no se mueve; tras agotarla, arranca a caminar y llega a destino", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo);
  gestor.iniciar([{ id: "a", especieId: "vaca_salvaje", x: 5, y: 5, radio: 3 }]);
  const animal = salida.get("a")!;
  const x0 = animal.x, y0 = animal.y;

  // pausas iniciales de 1-4s (ver fauna.ts): 6s de tiempo de sobra para
  // que arranque a caminar y recorra parte del trayecto
  let vioCaminar = false;
  for (let i = 0; i < 60; i++) {
    gestor.tick(0.1);
    if (animal.accion === "caminar") vioCaminar = true;
  }
  assert.ok(vioCaminar, "en 6s debería haber arrancado a caminar al menos una vez");
  const distancia = Math.hypot(animal.x - x0, animal.y - y0);
  assert.ok(distancia > 0, "el animal debería haberse movido de su punto de partida");
  // nunca se sale del radio de merodeo (+1 de margen por el propio paso)
  assert.ok(distancia < 3 + 1.5, `se alejó demasiado de su spawn (${distancia} casillas, radio 3)`);
});

test("GestorFauna.quitar: saca al animal del estado Y deja de tickearlo (docs/GDD_Mascotas.md, domesticación)", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo);
  gestor.iniciar([
    { id: "a", especieId: "perro", x: 5, y: 5, radio: 3 },
    { id: "b", especieId: "gato", x: 6, y: 6, radio: 3 },
  ]);
  assert.strictEqual(gestor.cantidad, 2);

  const ok = gestor.quitar("a");
  assert.strictEqual(ok, true);
  assert.strictEqual(salida.has("a"), false, "desaparece del Schema");
  assert.strictEqual(salida.has("b"), true, "el otro animal no se toca");
  assert.strictEqual(gestor.cantidad, 1);

  // tras quitarlo, seguir tickeando no debe revivirlo ni lanzar error
  for (let i = 0; i < 20; i++) gestor.tick(0.1);
  assert.strictEqual(salida.has("a"), false);
});

test("GestorFauna.quitar: false si el id no existe (ya se quitó, o nunca fue un spawn de esta room)", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo);
  gestor.iniciar([{ id: "a", especieId: "perro", x: 5, y: 5, radio: 3 }]);
  assert.strictEqual(gestor.quitar("no_existe"), false);
  assert.strictEqual(gestor.cantidad, 1);
});

test("GestorFauna: nunca sale de la rejilla transitable (respeta los bordes sólidos)", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo);
  // spawn pegado al borde, radio grande: sin la comprobación de
  // transitabilidad, el destino elegido caería fuera de la rejilla
  gestor.iniciar([{ id: "a", especieId: "perro", x: 2, y: 2, radio: 5 }]);
  const animal = salida.get("a");
  if (!animal) return; // spawn descartado por estar demasiado cerca del borde: válido también
  for (let i = 0; i < 200; i++) {
    gestor.tick(0.1);
    assert.ok(animal.x >= 1 && animal.x <= mundo.ancho - 1, `x fuera de rango: ${animal.x}`);
    assert.ok(animal.y >= 1 && animal.y <= mundo.alto - 1, `y fuera de rango: ${animal.y}`);
  }
});
