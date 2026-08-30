// Módulos de mejora adyacentes (docs/GDD_Profesiones.md, pedido 2026-08-30):
// bonusModulosAdyacentes es PURA (sin Colyseus/BD/fs) — se testea con un
// ContextoConstruccion sintético mínimo, sin necesidad del mapa demo real.
import { test } from "node:test";
import * as assert from "node:assert";
import { bonusModulosAdyacentes } from "../src/construccion/construccion";
import type { ContextoConstruccion, ConstruccionViva } from "../src/construccion/construccion";
import type { EntradaConstruible } from "../src/construccion/catalogo";

const ANCHO = 6;

function mapaVacio() {
  return { ancho: ANCHO, alto: ANCHO, casillas: new Uint8Array(ANCHO * ANCHO), velocidad: new Float32Array(ANCHO * ANCHO) };
}

function claveDe(x: number, y: number): number {
  return y * ANCHO + x;
}

/** Contexto sintético con la mesa en (2,2) y, opcionalmente, construcciones vecinas. */
function crearContexto(vecinos: { x: number; y: number; objeto: string }[]): { ctx: ContextoConstruccion; mesa: ConstruccionViva } {
  const mesa: ConstruccionViva = {
    id: 1, propiedad: "p1", objeto: "yunque_cuerno", categoria: "mueble",
    x: 2, y: 2, rot: 0, variante: 0, colision: true, claves: [claveDe(2, 2)],
  };
  const ocupacion = new Map<number, number>([[claveDe(2, 2), 1]]);
  const vivas = new Map<number, ConstruccionViva>([[1, mesa]]);
  let siguienteId = 2;
  for (const v of vecinos) {
    const id = siguienteId++;
    const clave = claveDe(v.x, v.y);
    const viva: ConstruccionViva = {
      id, propiedad: "p1", objeto: v.objeto, categoria: "mueble",
      x: v.x, y: v.y, rot: 0, variante: 0, colision: true, claves: [clave],
    };
    ocupacion.set(clave, id);
    vivas.set(id, viva);
  }
  const ctx: ContextoConstruccion = {
    mapa: mapaVacio() as any,
    casillasBase: new Uint8Array(ANCHO * ANCHO),
    parcelas: {} as any,
    propiedades: new Map(),
    ocupacion,
    vivas,
    conteoPorPropiedad: new Map(),
    jarls: new Set(),
  };
  return { ctx, mesa };
}

function catalogoCon(entradas: Record<string, Partial<EntradaConstruible>>): Map<string, EntradaConstruible> {
  const m = new Map<string, EntradaConstruible>();
  for (const [id, e] of Object.entries(entradas)) {
    m.set(id, { id, categoria: "mueble", huella: [1, 1], colision: true, variantes: 1, ...e } as EntradaConstruible);
  }
  return m;
}

test("bonusModulosAdyacentes: sin nada adyacente, ambos bonus en 0", () => {
  const { ctx, mesa } = crearContexto([]);
  const catalogo = catalogoCon({ yunque_cuerno: {} });
  const bonus = bonusModulosAdyacentes(ctx, catalogo, mesa);
  assert.deepStrictEqual(bonus, { velocidad: 0, cantidad: 0 });
});

test("bonusModulosAdyacentes: un módulo de velocidad adyacente aplica su bonus", () => {
  const { ctx, mesa } = crearContexto([{ x: 2, y: 1, objeto: "fuelle_mecanico_pedal" }]);
  const catalogo = catalogoCon({
    yunque_cuerno: {},
    fuelle_mecanico_pedal: { mejoraMesa: { mesa: "yunque_cuerno", tipo: "velocidad", bonus: 0.12 } },
  });
  const bonus = bonusModulosAdyacentes(ctx, catalogo, mesa);
  assert.deepStrictEqual(bonus, { velocidad: 0.12, cantidad: 0 });
});

test("bonusModulosAdyacentes: velocidad Y cantidad adyacentes a la vez, cada uno con su bonus", () => {
  const { ctx, mesa } = crearContexto([
    { x: 2, y: 1, objeto: "fuelle_mecanico_pedal" },
    { x: 2, y: 3, objeto: "cuba_temple_recogedor" },
  ]);
  const catalogo = catalogoCon({
    yunque_cuerno: {},
    fuelle_mecanico_pedal: { mejoraMesa: { mesa: "yunque_cuerno", tipo: "velocidad", bonus: 0.12 } },
    cuba_temple_recogedor: { mejoraMesa: { mesa: "yunque_cuerno", tipo: "cantidad", bonus: 0.12 } },
  });
  const bonus = bonusModulosAdyacentes(ctx, catalogo, mesa);
  assert.deepStrictEqual(bonus, { velocidad: 0.12, cantidad: 0.12 });
});

test("bonusModulosAdyacentes: un módulo para OTRA mesa distinta no cuenta", () => {
  const { ctx, mesa } = crearContexto([{ x: 2, y: 1, objeto: "fuelle_mecanico_pedal" }]);
  const catalogo = catalogoCon({
    yunque_cuerno: {},
    fuelle_mecanico_pedal: { mejoraMesa: { mesa: "otra_mesa_distinta", tipo: "velocidad", bonus: 0.12 } },
  });
  const bonus = bonusModulosAdyacentes(ctx, catalogo, mesa);
  assert.deepStrictEqual(bonus, { velocidad: 0, cantidad: 0 });
});

test("bonusModulosAdyacentes: diagonal NO cuenta (solo ortogonalmente adyacente)", () => {
  const { ctx, mesa } = crearContexto([{ x: 3, y: 1, objeto: "fuelle_mecanico_pedal" }]); // diagonal a (2,2)
  const catalogo = catalogoCon({
    yunque_cuerno: {},
    fuelle_mecanico_pedal: { mejoraMesa: { mesa: "yunque_cuerno", tipo: "velocidad", bonus: 0.12 } },
  });
  const bonus = bonusModulosAdyacentes(ctx, catalogo, mesa);
  assert.deepStrictEqual(bonus, { velocidad: 0, cantidad: 0 });
});

test("bonusModulosAdyacentes: dos módulos de velocidad adyacentes NO se suman, gana el mayor", () => {
  const { ctx, mesa } = crearContexto([
    { x: 2, y: 1, objeto: "fuelle_mecanico_pedal" },
    { x: 1, y: 2, objeto: "fuelle_de_repuesto" },
  ]);
  const catalogo = catalogoCon({
    yunque_cuerno: {},
    fuelle_mecanico_pedal: { mejoraMesa: { mesa: "yunque_cuerno", tipo: "velocidad", bonus: 0.12 } },
    fuelle_de_repuesto: { mejoraMesa: { mesa: "yunque_cuerno", tipo: "velocidad", bonus: 0.25 } },
  });
  const bonus = bonusModulosAdyacentes(ctx, catalogo, mesa);
  assert.deepStrictEqual(bonus, { velocidad: 0.25, cantidad: 0 });
});
