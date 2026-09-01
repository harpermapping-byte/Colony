// Tests de combate/arenaCombate.ts — motor táctico por turnos (docs/GDD_Combate.md,
// ✅ confirmado 2026-08-30, sustituye al daño directo simple). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  UnidadCombate,
  calcularIniciativa,
  enAlcance,
  jugarTurnoIA,
  ordenarTurnos,
  resolverAtaque,
  simularCombateAutomatico,
  tirarHuida,
} from "../src/combate/arenaCombate";
import { Arena } from "../src/combate/pathfindingArena";

function arenaAbierta(ancho = 8, alto = 8): Arena {
  return { ancho, alto, obstaculos: new Uint8Array(ancho * alto) };
}

function unidad(overrides: Partial<UnidadCombate> = {}): UnidadCombate {
  return {
    id: "u1", esJugador: false, bando: "A",
    gx: 0, gy: 0, hp: 50, hpMax: 50, pa: 3, paMax: 3,
    iniciativa: 10, estado: "activo",
    ataqueFisico: 10, defensaFisica: 0, alcance: 1,
    ...overrides,
  };
}

test("calcularIniciativa: determinista con un rnd fijo, y sube la base con rnd creciente", () => {
  assert.strictEqual(calcularIniciativa(10, () => 0), 10);
  assert.strictEqual(calcularIniciativa(10, () => 1), 15);
});

test("tirarHuida: éxito/fallo exactos en el borde de la probabilidad (rnd inyectable, mismo patrón que calcularIniciativa)", () => {
  assert.strictEqual(tirarHuida(0.3, () => 0.29), true); // por debajo del umbral -> éxito
  assert.strictEqual(tirarHuida(0.3, () => 0.3), false); // igual al umbral -> fallo (estrictamente menor que)
  assert.strictEqual(tirarHuida(0.3, () => 0.31), false);
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

test("jugarTurnoIA: ataca si el objetivo ya está en alcance", () => {
  const a = unidad({ id: "a", bando: "A", gx: 0, gy: 0, alcance: 1, ataqueFisico: 10 });
  const b = unidad({ id: "b", bando: "B", gx: 1, gy: 0, hp: 50, hpMax: 50 });
  const resultado = jugarTurnoIA("a", [a, b], arenaAbierta());
  assert.strictEqual(resultado.find((u) => u.id === "b")!.hp, 40);
  assert.strictEqual(resultado.find((u) => u.id === "a")!.gx, 0, "atacar no mueve al atacante");
});

test("jugarTurnoIA: se acerca si el objetivo está fuera de alcance", () => {
  const a = unidad({ id: "a", bando: "A", gx: 0, gy: 0, alcance: 1, pa: 2 });
  const b = unidad({ id: "b", bando: "B", gx: 5, gy: 0 });
  const resultado = jugarTurnoIA("a", [a, b], arenaAbierta());
  const actualizado = resultado.find((u) => u.id === "a")!;
  assert.strictEqual(actualizado.gx, 2, "se movió 2 casillas (su pa) hacia el objetivo");
  assert.strictEqual(actualizado.hp, a.hp, "moverse no cambia su propia vida");
});

test("jugarTurnoIA: no hace nada si la unidad ya cayó, o si no queda enemigo vivo", () => {
  const caida = unidad({ id: "a", bando: "A", estado: "caido" });
  const b = unidad({ id: "b", bando: "B", gx: 1, gy: 0 });
  assert.deepStrictEqual(jugarTurnoIA("a", [caida, b], arenaAbierta()), [caida, b]);

  const vivo = unidad({ id: "a", bando: "A" });
  const bCaido = unidad({ id: "b", bando: "B", gx: 1, gy: 0, estado: "caido" });
  assert.deepStrictEqual(jugarTurnoIA("a", [vivo, bCaido], arenaAbierta()), [vivo, bCaido]);
});

test("simularCombateAutomatico: dos animales sin defensa, uno mucho más fuerte gana siempre igual (determinista)", () => {
  const fuerte = unidad({ id: "lobo", bando: "A", gx: 0, gy: 0, hp: 50, hpMax: 50, ataqueFisico: 20, alcance: 1, pa: 3, iniciativa: 10 });
  const debil = unidad({ id: "conejo", bando: "B", gx: 1, gy: 0, hp: 15, hpMax: 15, ataqueFisico: 2, alcance: 1, pa: 3, iniciativa: 5 });
  const resultado = simularCombateAutomatico([fuerte], [debil], arenaAbierta(), () => 0);
  assert.strictEqual(resultado.bandoGanador, "A");
  const lobo = resultado.unidades.find((u) => u.id === "lobo")!;
  const conejo = resultado.unidades.find((u) => u.id === "conejo")!;
  assert.strictEqual(conejo.estado, "caido");
  assert.strictEqual(lobo.estado, "activo");
  assert.ok(lobo.hp > 0);
});

test("simularCombateAutomatico: si empiezan lejos, se acercan antes de poder golpear", () => {
  const a = unidad({ id: "a", bando: "A", gx: 0, gy: 0, ataqueFisico: 30, alcance: 1, pa: 2, hp: 100, hpMax: 100, iniciativa: 20 });
  const b = unidad({ id: "b", bando: "B", gx: 7, gy: 7, ataqueFisico: 30, alcance: 1, pa: 2, hp: 100, hpMax: 100, iniciativa: 1 });
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

// --- Modo caza (docs/GDD_Caza.md, pedido 2026-08-30): presa pasiva ---

test("jugarTurnoIA: una unidad pasiva NUNCA ataca aunque el objetivo esté en alcance", () => {
  const presa = unidad({ id: "conejo", bando: "B", gx: 1, gy: 0, pasivo: true });
  const cazador = unidad({ id: "jugador", bando: "A", gx: 0, gy: 0, hp: 50, hpMax: 50 });
  // rnd fijo a 0 -> PASOS_DEAMBULAR[0] = "quieto" (0,0), así que además se queda en su sitio.
  const resultado = jugarTurnoIA("conejo", [presa, cazador], arenaAbierta(), () => 0);
  assert.strictEqual(resultado.find((u) => u.id === "jugador")!.hp, 50, "nunca ataca al jugador, esté a tiro o no");
});

test("jugarTurnoIA: una unidad pasiva deambula sin perseguir — puede alejarse del objetivo, al revés que la IA normal", () => {
  const presa = unidad({ id: "conejo", bando: "B", gx: 4, gy: 4, pasivo: true });
  const cazador = unidad({ id: "jugador", bando: "A", gx: 0, gy: 0 });
  // rnd fijo a 0.3 -> floor(0.3*5)=1 -> PASOS_DEAMBULAR[1] = {gx:1,gy:0}: se aleja del jugador.
  const resultado = jugarTurnoIA("conejo", [presa, cazador], arenaAbierta(), () => 0.3);
  const actualizada = resultado.find((u) => u.id === "conejo")!;
  assert.strictEqual(actualizada.gx, 5, "se alejó del jugador en vez de perseguirlo");
  assert.strictEqual(actualizada.gy, 4);
});

test("jugarTurnoIA: una unidad pasiva no deambula sobre un obstáculo", () => {
  const arena = arenaAbierta();
  arena.obstaculos[0 * arena.ancho + 2] = 1; // (gx=2, gy=0) obstáculo
  const presa = unidad({ id: "conejo", bando: "B", gx: 1, gy: 0, pasivo: true });
  // rnd -> PASOS_DEAMBULAR[1] = {gx:1,gy:0} (derecha, hacia el obstáculo en x=2,y=0): bloqueado.
  const resultado = jugarTurnoIA("conejo", [presa], arena, () => 0.2);
  assert.deepStrictEqual(resultado.find((u) => u.id === "conejo")!, presa, "bloqueado por el obstáculo, no se mueve");
});

test("jugarTurnoIA: una unidad pasiva no deambula sobre otra unidad activa (jugador u otro animal)", () => {
  const presa = unidad({ id: "conejo", bando: "B", gx: 1, gy: 0, pasivo: true });
  const ocupante = unidad({ id: "otro", bando: "A", gx: 2, gy: 0 });
  // rnd -> PASOS_DEAMBULAR[1] = {gx:1,gy:0} (derecha, hacia la casilla ocupada): bloqueado.
  const resultado = jugarTurnoIA("conejo", [presa, ocupante], arenaAbierta(), () => 0.2);
  assert.deepStrictEqual(resultado.find((u) => u.id === "conejo")!, presa, "bloqueado por la unidad, no se mueve");
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
