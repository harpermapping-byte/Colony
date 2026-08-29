// Tests de la lógica PURA de la red motriz (server/src/construccion/energia.ts,
// docs/GDD_Motriz.md) — mapa SINTÉTICO, sin depender del demo real.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MundoColision, TIPO } from "../src/mundo/colisiones";
import { IndiceParcelas } from "../src/construccion/parcelas";
import { ContextoConstruccion, aplicarColocacion, ConstruccionViva } from "../src/construccion/construccion";
import { EntradaConstruible } from "../src/construccion/catalogo";
import { potenciaDisponibleEnCasillas, factorVelocidadPorEnergia } from "../src/construccion/energia";

const ANCHO = 300, ALTO = 300;

function mundoVacio(): MundoColision {
  return {
    ancho: ANCHO,
    alto: ALTO,
    casillas: new Uint8Array(ANCHO * ALTO).fill(TIPO.TIERRA),
    velocidad: new Float32Array(ANCHO * ALTO).fill(1),
  };
}

function crearCtx(): ContextoConstruccion {
  const mapa = mundoVacio();
  const parcelas: IndiceParcelas = { anchoMapa: ANCHO, parcelas: new Map(), indice: new Map() };
  return {
    mapa,
    casillasBase: mapa.casillas.slice(),
    parcelas,
    propiedades: new Map(),
    ocupacion: new Map(),
    vivas: new Map(),
    conteoPorPropiedad: new Map(),
    jarls: new Set(),
  };
}

const CATALOGO = new Map<string, EntradaConstruible>([
  ["molino", { id: "molino", categoria: "edificio", huella: [1, 1], colision: false, variantes: 1, energia: { produce: 100, fuente: "agua" } }],
  ["eje", { id: "eje", categoria: "mueble", huella: [1, 1], colision: false, variantes: 1, energia: { transmite: true } }],
  ["palanca_freno", { id: "palanca_freno", categoria: "mueble", huella: [1, 1], colision: false, variantes: 1, energia: { transmite: true, interrumpible: true } }],
  ["palanca_cambios", { id: "palanca_cambios", categoria: "mueble", huella: [1, 1], colision: false, variantes: 1, energia: { transmite: true, canales: 4 } }],
  ["mesa", { id: "mesa", categoria: "mueble", huella: [1, 1], colision: false, variantes: 1, energia: { consume: 50, multiplicador: 1.5 } }],
  ["decorativo", { id: "decorativo", categoria: "mueble", huella: [1, 1], colision: false, variantes: 1 }], // sin campo energia
]);

let siguienteId = 1;
function colocar(ctx: ContextoConstruccion, objeto: string, x: number, y: number, extra?: Record<string, unknown>): ConstruccionViva {
  return aplicarColocacion(ctx, {
    id: siguienteId++, propiedad: "p_test", objeto, categoria: "mueble",
    x, y, rot: 0, variante: 0, colision: false, huella: [1, 1], extra: extra ?? null,
  });
}

test("potenciaDisponibleEnCasillas: sin vecinos con energia, disponible 0", () => {
  const ctx = crearCtx();
  const mesa = colocar(ctx, "mesa", 0, 0);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 0);
  assert.strictEqual(r.fuentes, 0);
});

test("potenciaDisponibleEnCasillas: molino -> eje -> mesa, la potencia llega a través del eje", () => {
  const ctx = crearCtx();
  colocar(ctx, "molino", 30, 28);
  colocar(ctx, "eje", 30, 29);
  const mesa = colocar(ctx, "mesa", 30, 30);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 100);
  assert.strictEqual(r.fuentes, 1);
});

test("potenciaDisponibleEnCasillas: una pieza de solo-consumo (sin transmite) no reenvía la red", () => {
  const ctx = crearCtx();
  colocar(ctx, "molino", 40, 38);
  colocar(ctx, "mesa", 40, 39); // consume, sin transmite — corta la cadena
  const mesa2 = colocar(ctx, "mesa", 40, 40);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa2.claves);
  assert.strictEqual(r.disponible, 0, "la potencia no atraviesa un nodo de consumo puro");
});

test("potenciaDisponibleEnCasillas: la palanca de freno ACCIONADA corta la red antes de la fuente", () => {
  const ctx = crearCtx();
  colocar(ctx, "molino", 20, 18);
  colocar(ctx, "palanca_freno", 20, 19, { frenado: true });
  const mesa = colocar(ctx, "mesa", 20, 20);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 0);
  assert.strictEqual(r.fuentes, 0);
});

test("potenciaDisponibleEnCasillas: la palanca de freno SIN accionar deja pasar la potencia", () => {
  const ctx = crearCtx();
  colocar(ctx, "molino", 20, 18);
  colocar(ctx, "palanca_freno", 20, 19, { frenado: false });
  const mesa = colocar(ctx, "mesa", 20, 20);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 100);
});

test("potenciaDisponibleEnCasillas: la palanca de cambios SOLO deja pasar por el canal seleccionado", () => {
  const ctx = crearCtx();
  const mesa = colocar(ctx, "mesa", 10, 10);
  // vecino norte de la mesa = la palanca (dirección 0=Norte desde la mesa)
  colocar(ctx, "palanca_cambios", 10, 9, { canalActivo: 0 }); // 0=Norte: deja pasar SOLO hacia (10,8)
  colocar(ctx, "molino", 10, 8); // Norte de la palanca — DEBE contar
  colocar(ctx, "eje", 11, 9); // Este de la palanca — NO debe contar
  colocar(ctx, "molino", 12, 9); // detrás del eje del Este — tampoco alcanzable
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 100, "solo el molino en el canal activo (Norte) cuenta");
  assert.strictEqual(r.fuentes, 1);
});

test("potenciaDisponibleEnCasillas: cambiar el canal activo cambia qué fuente se alcanza", () => {
  const ctx = crearCtx();
  const mesa = colocar(ctx, "mesa", 10, 10);
  colocar(ctx, "palanca_cambios", 10, 9, { canalActivo: 1 }); // 1=Este
  colocar(ctx, "molino", 10, 8); // Norte — ya no cuenta
  colocar(ctx, "eje", 11, 9); // Este — SÍ cuenta ahora
  colocar(ctx, "molino", 12, 9);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 100, "con canalActivo=Este, se alcanza el molino tras el eje del Este");
});

test("potenciaDisponibleEnCasillas: acota el recorrido (tope de nodos) — una red patológicamente larga no llega a una fuente lejana", () => {
  const ctx = crearCtx();
  const mesa = colocar(ctx, "mesa", 0, 0);
  // cadena de 250 ejes en fila — supera el tope interno (200) antes de llegar al molino del final
  for (let x = 1; x <= 250; x++) colocar(ctx, "eje", x, 0);
  colocar(ctx, "molino", 251, 0);
  const r = potenciaDisponibleEnCasillas(ctx, CATALOGO, mesa.claves);
  assert.strictEqual(r.disponible, 0, "el molino queda fuera del tope de nodos visitados");
});

test("potenciaDisponibleEnCasillas: una fuente con huella >1x1 (molino) cuenta su `produce` UNA sola vez, no una por casilla de su huella", () => {
  const ctx = crearCtx();
  const MOLINO_GRANDE: EntradaConstruible = {
    id: "molino_agua", categoria: "edificio", huella: [3, 3], colision: false, variantes: 1,
    energia: { produce: 100, fuente: "agua" },
  };
  const catalogo = new Map(CATALOGO);
  catalogo.set("molino_agua", MOLINO_GRANDE);
  aplicarColocacion(ctx, {
    id: siguienteId++, propiedad: "p_test", objeto: "molino_agua", categoria: "edificio",
    x: 100, y: 100, rot: 0, variante: 0, colision: false, huella: [3, 3], extra: null,
  }); // ocupa 9 casillas: (100,100)..(102,102)
  const mesa = colocar(ctx, "mesa", 103, 101); // pegada al lado este del molino
  const r = potenciaDisponibleEnCasillas(ctx, catalogo, mesa.claves);
  assert.strictEqual(r.disponible, 100, "el molino aporta 100 UNA vez, no 100 por cada una de sus 9 casillas");
  assert.strictEqual(r.fuentes, 1);
});

test("factorVelocidadPorEnergia: mesa sin campo energia devuelve 1 (comportamiento de hoy, sin cambios)", () => {
  const ctx = crearCtx();
  const deco = colocar(ctx, "decorativo", 0, 0);
  const factor = factorVelocidadPorEnergia(ctx, CATALOGO, deco);
  assert.strictEqual(factor, 1);
});

test("factorVelocidadPorEnergia: potencia insuficiente devuelve 1 (sin bonus)", () => {
  const ctx = crearCtx();
  colocar(ctx, "eje", 5, 4); // sin fuente detrás — 0 de potencia
  const mesa = colocar(ctx, "mesa", 5, 5); // consume:50
  const factor = factorVelocidadPorEnergia(ctx, CATALOGO, mesa);
  assert.strictEqual(factor, 1);
});

test("factorVelocidadPorEnergia: potencia suficiente aplica el multiplicador del catálogo", () => {
  const ctx = crearCtx();
  colocar(ctx, "molino", 5, 3); // produce:100
  colocar(ctx, "eje", 5, 4);
  const mesa = colocar(ctx, "mesa", 5, 5); // consume:50, multiplicador:1.5
  const factor = factorVelocidadPorEnergia(ctx, CATALOGO, mesa);
  assert.strictEqual(factor, 1.5);
});
