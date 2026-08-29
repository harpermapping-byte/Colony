// Tests de combate/arenaCombate.ts — motor táctico por turnos (docs/GDD_Combate.md,
// ✅ confirmado 2026-08-30, sustituye al daño directo simple). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  UnidadCombate,
  calcularIniciativa,
  enAlcance,
  ordenarTurnos,
  resolverAtaque,
  simularCombateAutomatico,
} from "../src/combate/arenaCombate";
import { Arena } from "../src/combate/pathfindingArena";

function arenaAbierta(ancho = 8, alto = 8): Arena {
  return { ancho, alto, obstaculos: new Uint8Array(ancho * alto) };
}

function unidad(overrides: Partial<UnidadCombate> = {}): UnidadCombate {
  return {
    id: "u1", esJugador: false, bando: "A",
    gx: 0, gy: 0, hp: 50, hpMax: 50, ap: 3, apMax: 3, mp: 3, mpMax: 3,
    iniciativa: 10, estado: "activo",
    ataqueFisico: 10, defensaFisica: 0, alcance: 1,
    ...overrides,
  };
}

test("calcularIniciativa: determinista con un rnd fijo, y sube la base con rnd creciente", () => {
  assert.strictEqual(calcularIniciativa(10, () => 0), 10);
  assert.strictEqual(calcularIniciativa(10, () => 1), 15);
});

test("ordenarTurnos: iniciativa descendente", () => {
  const a = unidad({ id: "a", iniciativa: 5 });
  const b = unidad({ id: "b", iniciativa: 20 });
  const c = unidad({ id: "c", iniciativa: 10 });
  assert.deepStrictEqual(ordenarTurnos([a, b, c]), ["b", "c", "a"]);
});

test("enAlcance: distancia Chebyshev contra el alcance de la unidad", () => {
  const atacante = unidad({ gx: 0, gy: 0, alcance: 2 });
  assert.strictEqual(enAlcance(atacante, unidad({ gx: 2, gy: 2 })), true);
  assert.strictEqual(enAlcance(atacante, unidad({ gx: 3, gy: 0 })), false);
});

test("resolverAtaque: usa la misma fórmula que combate.ts (max(1, ataque-defensa)), no muta el objetivo", () => {
  const atacante = unidad({ ataqueFisico: 15 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 5 });
  const actualizado = resolverAtaque(atacante, objetivo);
  assert.strictEqual(actualizado.hp, 40); // 50 - (15-5)
  assert.strictEqual(objetivo.hp, 50, "no muta el original");
});

test("resolverAtaque: marca 'caido' al llegar a 0, nunca por debajo", () => {
  const atacante = unidad({ ataqueFisico: 999 });
  const actualizado = resolverAtaque(atacante, unidad({ hp: 10, hpMax: 50 }));
  assert.strictEqual(actualizado.hp, 0);
  assert.strictEqual(actualizado.estado, "caido");
});

test("simularCombateAutomatico: dos animales sin defensa, uno mucho más fuerte gana siempre igual (determinista)", () => {
  const fuerte = unidad({ id: "lobo", bando: "A", gx: 0, gy: 0, hp: 50, hpMax: 50, ataqueFisico: 20, alcance: 1, mp: 3, iniciativa: 10 });
  const debil = unidad({ id: "conejo", bando: "B", gx: 1, gy: 0, hp: 15, hpMax: 15, ataqueFisico: 2, alcance: 1, mp: 3, iniciativa: 5 });
  const resultado = simularCombateAutomatico([fuerte], [debil], arenaAbierta(), () => 0);
  assert.strictEqual(resultado.bandoGanador, "A");
  const lobo = resultado.unidades.find((u) => u.id === "lobo")!;
  const conejo = resultado.unidades.find((u) => u.id === "conejo")!;
  assert.strictEqual(conejo.estado, "caido");
  assert.strictEqual(lobo.estado, "activo");
  assert.ok(lobo.hp > 0);
});

test("simularCombateAutomatico: si empiezan lejos, se acercan antes de poder golpear", () => {
  const a = unidad({ id: "a", bando: "A", gx: 0, gy: 0, ataqueFisico: 30, alcance: 1, mp: 2, hp: 100, hpMax: 100, iniciativa: 20 });
  const b = unidad({ id: "b", bando: "B", gx: 7, gy: 7, ataqueFisico: 30, alcance: 1, mp: 2, hp: 100, hpMax: 100, iniciativa: 1 });
  const resultado = simularCombateAutomatico([a], [b], arenaAbierta(), () => 0);
  assert.ok(resultado.bandoGanador === "A" || resultado.bandoGanador === "B");
  assert.ok(resultado.turnos > 0, "no gana en el turno 0 — tuvieron que acercarse primero");
});

test("simularCombateAutomatico: no muta las unidades de entrada", () => {
  const a = unidad({ id: "a", bando: "A", hp: 50, hpMax: 50 });
  const b = unidad({ id: "b", bando: "B", gx: 1, gy: 0, hp: 5, hpMax: 5 });
  simularCombateAutomatico([a], [b], arenaAbierta(), () => 0);
  assert.strictEqual(a.hp, 50);
  assert.strictEqual(b.hp, 5);
});

test("simularCombateAutomatico: es determinista — misma entrada + mismo rnd fijo = mismo resultado", () => {
  const crear = () => [
    [unidad({ id: "a", bando: "A", gx: 0, gy: 0, hp: 40, hpMax: 40, ataqueFisico: 8, iniciativa: 10 })],
    [unidad({ id: "b", bando: "B", gx: 6, gy: 6, hp: 40, hpMax: 40, ataqueFisico: 9, iniciativa: 11 })],
  ] as const;
  const [a1, b1] = crear();
  const [a2, b2] = crear();
  const r1 = simularCombateAutomatico(a1, b1, arenaAbierta(), () => 0.3);
  const r2 = simularCombateAutomatico(a2, b2, arenaAbierta(), () => 0.3);
  assert.deepStrictEqual(r1, r2);
});
