// Movimiento de enemigos de mazmorra (docs/GDD_Combate.md §4bis, pedido
// streamer 2026-09-07: "moverse correr pelearse morir") — GestorEnemigosMazmorra
// es una copia deliberada del patrón de GestorFauna (mundo/fauna.ts), así que
// esta suite espeja fauna.test.ts en lo que puede: merodeo real alrededor del
// spawn, nunca sobre un sólido, nunca fuera del radio.
// Ejecutar: node --import tsx --test server/test/enemigosMazmorra.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MapSchema } from "@colyseus/schema";
import { Enemigo } from "../src/rooms/schema/HubState";
import { GestorEnemigosMazmorra } from "../src/mundo/enemigosMazmorra";
import { TIPO, MundoColision } from "../src/mundo/colisiones";

function mundoAbierto(ancho: number, alto: number): MundoColision {
  return { ancho, alto, casillas: new Uint8Array(ancho * alto).fill(TIPO.TIERRA), velocidad: new Float32Array(ancho * alto).fill(1) };
}

function crearGestorConUno(x: number, y: number, mundo: MundoColision): { gestor: GestorEnemigosMazmorra; salida: MapSchema<Enemigo>; id: string } {
  const salida = new MapSchema<Enemigo>();
  const e = new Enemigo();
  e.x = x; e.y = y; e.enemigoId = "goblin"; e.vida = 40; e.vidaMax = 40;
  salida.set("e_0", e);
  const gestor = new GestorEnemigosMazmorra(salida, mundo);
  gestor.registrarExistentes();
  return { gestor, salida, id: "e_0" };
}

test("GestorEnemigosMazmorra: un enemigo QUIETO para siempre (bug real cerrado) ya se mueve tras varios ticks", () => {
  const mundo = mundoAbierto(20, 20);
  const { gestor, salida } = crearGestorConUno(10, 10, mundo);
  const inicio = { x: salida.get("e_0")!.x, y: salida.get("e_0")!.y };
  let seMovio = false;
  for (let i = 0; i < 200; i++) {
    gestor.tick(0.2);
    const e = salida.get("e_0")!;
    if (Math.hypot(e.x - inicio.x, e.y - inicio.y) > 0.05) { seMovio = true; break; }
  }
  assert.ok(seMovio, "el enemigo debería haberse alejado de su punto de spawn en 200 ticks (40s simulados)");
});

test("GestorEnemigosMazmorra: nunca cruza un sólido (pared de la mazmorra)", () => {
  // Sala 20x20 rodeada de sólido en x=15 (una "pared" vertical) — el
  // enemigo spawnea a la izquierda, su radio de merodeo (4 casillas) no
  // debería nunca cruzar esa pared si `transitable()` funciona de verdad.
  const mundo = mundoAbierto(20, 20);
  for (let y = 0; y < 20; y++) mundo.casillas[y * 20 + 15] = TIPO.SOLIDO;
  const { gestor, salida } = crearGestorConUno(10, 10, mundo);
  for (let i = 0; i < 500; i++) {
    gestor.tick(0.2);
    const e = salida.get("e_0")!;
    assert.ok(e.x < 15, `el enemigo cruzó la pared sólida en el tick ${i} (x=${e.x})`);
  }
});

test("GestorEnemigosMazmorra: se queda dentro de un radio razonable de su spawn (no se va a merodear medio mapa)", () => {
  const mundo = mundoAbierto(40, 40);
  const { gestor, salida } = crearGestorConUno(20, 20, mundo);
  let maxDist = 0;
  for (let i = 0; i < 1000; i++) {
    gestor.tick(0.2);
    const e = salida.get("e_0")!;
    maxDist = Math.max(maxDist, Math.hypot(e.x - 20, e.y - 20));
  }
  assert.ok(maxDist <= 5, `el enemigo se alejó ${maxDist.toFixed(2)} casillas de su spawn, el radio de merodeo es de 4`);
});

test("GestorEnemigosMazmorra: quitar() deja de tickear un enemigo (ya muerto) sin lanzar", () => {
  const mundo = mundoAbierto(20, 20);
  const { gestor, salida } = crearGestorConUno(10, 10, mundo);
  gestor.quitar("e_0");
  salida.delete("e_0"); // mismo orden que DungeonRoom.finalizarMuerte: super.finalizarMuerte ya borró la entidad del Schema
  assert.doesNotThrow(() => { for (let i = 0; i < 10; i++) gestor.tick(0.2); });
});

test("GestorEnemigosMazmorra: un enemigo acorralado (todo sólido alrededor) se queda quieto sin romper nada", () => {
  // Nota de diseño: a diferencia de GestorFauna.iniciar (que sí filtra
  // spawns no transitables ANTES de crear la entidad), aquí el `Enemigo`
  // ya viene colocado por DungeonRoom.poblarEnemigos con SU PROPIA
  // posición — este gestor solo empieza a merodearlo. Si TODO su radio de
  // merodeo cae en sólido (celda de 1x1 real, o bake corrupto), sigue
  // registrado pero simplemente nunca encuentra un destino transitable
  // (elegirDestino devuelve null los 6 intentos) — se queda pausado sin
  // romper el resto de la mazmorra ni lanzar ninguna excepción.
  const mundo = mundoAbierto(20, 20);
  mundo.casillas.fill(TIPO.SOLIDO); // todo el mapa sólido salvo la propia casilla del enemigo
  mundo.casillas[10 * 20 + 10] = TIPO.TIERRA;
  const { gestor, salida } = crearGestorConUno(10, 10, mundo);
  assert.doesNotThrow(() => { for (let i = 0; i < 50; i++) gestor.tick(0.2); });
  // Tolerancia real (no exacta): `transitable()` redondea al entero más
  // cercano, así que un destino candidato dentro de la MISMA casilla
  // (p.ej. 10.3,9.7 -> redondea a 10,10) pasa el chequeo aunque no sea el
  // punto exacto de spawn — mismo comportamiento que GestorFauna, no un
  // bug de este gestor. Lo que importa es que nunca sale de esa casilla.
  const e = salida.get("e_0")!;
  assert.ok(Math.abs(e.x - 10) < 0.5, `x se salió de la casilla de spawn: ${e.x}`);
  assert.ok(Math.abs(e.y - 10) < 0.5, `y se salió de la casilla de spawn: ${e.y}`);
});
