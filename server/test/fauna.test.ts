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

const CATALOGO_REPRODUCCION = {
  perro: { tamanoReproduccion: "pequeno" as const, poneHuevos: false, dieta: "omnivoro" as const, criaId: "perro" },
  gallina_domestica: { tamanoReproduccion: "pequeno" as const, poneHuevos: true, dieta: "omnivoro" as const, criaId: "pollito" },
};

test("GestorFauna: especie SIN catálogo de reproducción — cero comportamiento nuevo (misma pausa/merodeo de siempre)", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo, {}, {}, () => 999); // catalogoReproduccion vacío a propósito
  gestor.iniciar([{ id: "a", especieId: "vaca_salvaje", x: 5, y: 5, radio: 3 }]);
  for (let i = 0; i < 50; i++) gestor.tick(0.1);
  gestor.resolverReproduccion(); // no debe explotar ni hacer nada con especies fuera del catálogo
  assert.strictEqual(gestor.cantidad, 1, "sin reproducción posible, sigue habiendo solo el original");
});

test("GestorFauna: sed diaria — un adulto con más de 1 día sin beber va derecho al agua más cercana", () => {
  const mundo = mundoAbierto();
  // pone una casilla de agua real en (9,9), lejos del spawn (5,5)
  mundo.casillas[9 * mundo.ancho + 9] = TIPO.AGUA;
  const salida = new MapSchema<Fauna>();
  let ahora = 10;
  const gestor = new GestorFauna(salida, mundo, {}, CATALOGO_REPRODUCCION, () => ahora);
  gestor.iniciar([{ id: "a", especieId: "perro", x: 5, y: 5, radio: 2 }]);
  ahora = 12; // más de VENTANA_AGUA_DIAS=1 desde que "nació" ya bebido (ultimaBebida=10)
  const animal = salida.get("a")!;
  let fueACaminarHaciaAgua = false;
  for (let i = 0; i < 300; i++) {
    gestor.tick(0.1);
    if (animal.accion === "caminar" && Math.hypot(animal.x - 9.5, animal.y - 9.5) < Math.hypot(5.5 - 9.5, 5.5 - 9.5)) {
      fueACaminarHaciaAgua = true;
    }
  }
  assert.ok(fueACaminarHaciaAgua, "debería haberse acercado al agua buscando beber");
});

// rnd totalmente determinista: primeras 2 llamadas fijan sexo opuesto de
// "m" (macho, 0.1<0.5) y "h" (hembra, 0.9>=0.5) en iniciar(); el resto
// siempre por debajo de PROBABILIDAD_APAREAMIENTO_DOMESTICO (0.85), así
// que cualquier intento de apareamiento posterior cuaja siempre.
function rndFauna(): () => number {
  const secuencia = [0.1, 0.9];
  let i = 0;
  return () => (i < secuencia.length ? secuencia[i++] : 0);
}

test("GestorFauna.resolverReproduccion: macho+hembra elegibles y cerca, rnd favorable — la hembra queda gestando (perro no pone huevos)", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  const gestor = new GestorFauna(salida, mundo, {}, CATALOGO_REPRODUCCION, () => 10, rndFauna());
  gestor.iniciar([
    { id: "m", especieId: "perro", x: 5, y: 5, radio: 2 },
    { id: "h", especieId: "perro", x: 5, y: 6, radio: 2 },
  ]);
  assert.strictEqual(gestor.estadoReproductivo("m")!.sexo, "macho");
  assert.strictEqual(gestor.estadoReproductivo("h")!.sexo, "hembra");
  gestor.resolverReproduccion();
  assert.notStrictEqual(gestor.estadoReproductivo("h")!.gestandoDesde, null, "con rnd favorable debería haber cuajado el apareamiento");
});

test("GestorFauna.resolverReproduccion: gestación cumplida da a luz una cría real, con su propio esquema y radio de merodeo por defecto", () => {
  const mundo = mundoAbierto();
  const salida = new MapSchema<Fauna>();
  let ahora = 10;
  const gestor = new GestorFauna(salida, mundo, {}, CATALOGO_REPRODUCCION, () => ahora, rndFauna());
  gestor.iniciar([
    { id: "m", especieId: "perro", x: 5, y: 5, radio: 2 },
    { id: "h", especieId: "perro", x: 5, y: 5, radio: 2 },
  ]);
  gestor.resolverReproduccion(); // cuaja el apareamiento — la hembra queda gestando
  const antes = gestor.cantidad;
  ahora = 10 + 20; // tiempo de sobra: gestación "pequeno" es GESTACION_DIAS.pequeno = {3,3} días
  gestor.resolverReproduccion(); // debería dar a luz
  assert.strictEqual(gestor.cantidad, antes + 1, "debería haber nacido exactamente una cría nueva");
  assert.strictEqual(salida.size, antes + 1);
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
