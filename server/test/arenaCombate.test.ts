// Tests de combate/arenaCombate.ts — motor táctico por turnos (docs/GDD_Combate.md,
// ✅ confirmado 2026-08-30, sustituye al daño directo simple). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  UnidadCombate,
  alcanceDeEquipo,
  calcularIniciativa,
  costeExtraPaDeHabilidad,
  enAlcance,
  golpesDeHabilidad,
  habilidadDeEquipo,
  jugarTurnoIA,
  municionDeEquipo,
  municionExtraDeHabilidad,
  ordenarTurnos,
  requiereQuietoHabilidad,
  resolverAtaque,
  resolverAtaqueConHabilidad,
  simularCombateAutomatico,
  tirarHuida,
} from "../src/combate/arenaCombate";
import { CatalogoItems } from "../src/inventario/inventario";
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

const catalogoArmas: CatalogoItems = {
  arco_corto: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 2], peso: 1.6, apilable: false, variantes: 3, colorDebug: "#000", alcance: 6, municionId: "flecha" },
  espada: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 2], peso: 2, apilable: false, variantes: 1, colorDebug: "#000" },
};

test("alcanceDeEquipo: usa el alcance del catálogo del arma en manoPrincipal", () => {
  assert.strictEqual(alcanceDeEquipo(catalogoArmas, { manoPrincipal: "arco_corto" }), 6);
});

test("alcanceDeEquipo: 1 (cuerpo a cuerpo) si el arma no declara alcance, no hay arma o no hay equipo", () => {
  assert.strictEqual(alcanceDeEquipo(catalogoArmas, { manoPrincipal: "espada" }), 1);
  assert.strictEqual(alcanceDeEquipo(catalogoArmas, {}), 1);
  assert.strictEqual(alcanceDeEquipo(catalogoArmas, undefined), 1);
});

test("municionDeEquipo: devuelve el municionId del arma en manoPrincipal, undefined si no consume ninguna", () => {
  assert.strictEqual(municionDeEquipo(catalogoArmas, { manoPrincipal: "arco_corto" }), "flecha");
  assert.strictEqual(municionDeEquipo(catalogoArmas, { manoPrincipal: "espada" }), undefined);
  assert.strictEqual(municionDeEquipo(catalogoArmas, undefined), undefined);
});

// --- Habilidades por familia de arma (docs/GDD_Combate.md, pedido 2026-09-03) ---

const catalogoHabilidades: CatalogoItems = {
  daga: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 1, habilidadId: "daga:puntoDebil" },
  espada_corta: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 1, habilidadId: "espada:estocada" },
  hacha_combate: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 1, habilidadId: "hacha:tajoPesado" },
  maza_guerra: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 1, habilidadId: "maza:aturdir" },
  baston_guerra: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 2, habilidadId: "baston:barrido" },
  lanza: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 2, habilidadId: "lanza:embiste" },
  arco_corto: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 6, municionId: "flecha", habilidadId: "arco:apuntar" },
  martillo_sin_habilidad: { tipo: "arma", slotEquipo: "manoPrincipal", huella: [1, 1], peso: 1, apilable: false, variantes: 1, colorDebug: "#000", alcance: 1 },
};

test("habilidadDeEquipo: lee habilidadId del arma en manoPrincipal, \"\" si no tiene/no hay arma/no hay equipo", () => {
  assert.strictEqual(habilidadDeEquipo(catalogoHabilidades, { manoPrincipal: "lanza" }), "lanza:embiste");
  assert.strictEqual(habilidadDeEquipo(catalogoHabilidades, { manoPrincipal: "martillo_sin_habilidad" }), "");
  assert.strictEqual(habilidadDeEquipo(catalogoHabilidades, {}), "");
  assert.strictEqual(habilidadDeEquipo(catalogoHabilidades, undefined), "");
});

test("golpesDeHabilidad/costeExtraPaDeHabilidad/municionExtraDeHabilidad/requiereQuietoHabilidad: solo arco:* pide 2 golpes/PA extra/munición extra/quietud, el resto (incluida \"\") va a los valores base", () => {
  assert.strictEqual(golpesDeHabilidad("arco:apuntar"), 2);
  assert.strictEqual(costeExtraPaDeHabilidad("arco:apuntar"), 1);
  assert.strictEqual(municionExtraDeHabilidad("arco:apuntar"), 1);
  assert.strictEqual(requiereQuietoHabilidad("arco:apuntar"), true);
  for (const h of ["", "daga:puntoDebil", "espada:estocada", "hacha:tajoPesado", "maza:aturdir", "baston:barrido", "lanza:embiste"]) {
    assert.strictEqual(golpesDeHabilidad(h), 1, h);
    assert.strictEqual(costeExtraPaDeHabilidad(h), 0, h);
    assert.strictEqual(municionExtraDeHabilidad(h), 0, h);
    assert.strictEqual(requiereQuietoHabilidad(h), false, h);
  }
});

test("resolverAtaqueConHabilidad: habilidad vacía o desconocida = idéntico a resolverAtaque (ataque base nunca se rompe)", () => {
  const atacante = unidad({ ataqueFisico: 15 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 5 });
  const arena = arenaAbierta();
  const base = resolverAtaque(atacante, objetivo);
  assert.strictEqual(resolverAtaqueConHabilidad(atacante, objetivo, "", arena).objetivo.hp, base.hp);
  assert.strictEqual(resolverAtaqueConHabilidad(atacante, objetivo, "algo:inventado", arena).objetivo.hp, base.hp);
});

test("resolverAtaqueConHabilidad daga:puntoDebil — ignora parte de la defensa, hace MÁS daño que el ataque base", () => {
  const atacante = unidad({ ataqueFisico: 20 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 10 });
  const base = resolverAtaque(atacante, objetivo).hp;
  const conHabilidad = resolverAtaqueConHabilidad(atacante, objetivo, "daga:puntoDebil", arenaAbierta()).objetivo.hp;
  assert.ok(conHabilidad < base, "más daño (menos hp restante) que el ataque base");
});

test("resolverAtaqueConHabilidad espada:estocada — +daño plano, MÁS daño que el ataque base", () => {
  const atacante = unidad({ ataqueFisico: 20 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 5 });
  const base = resolverAtaque(atacante, objetivo).hp;
  const conHabilidad = resolverAtaqueConHabilidad(atacante, objetivo, "espada:estocada", arenaAbierta()).objetivo.hp;
  assert.ok(conHabilidad < base);
});

test("resolverAtaqueConHabilidad hacha:tajoPesado — más daño si el objetivo NO se movió este turno, igual que el base si sí se movió", () => {
  const atacante = unidad({ ataqueFisico: 20 });
  const quieto = unidad({ hp: 50, hpMax: 50, defensaFisica: 5, movioEsteTurno: false });
  const movido = unidad({ hp: 50, hpMax: 50, defensaFisica: 5, movioEsteTurno: true });
  const base = resolverAtaque(atacante, quieto).hp;
  const hpQuieto = resolverAtaqueConHabilidad(atacante, quieto, "hacha:tajoPesado", arenaAbierta()).objetivo.hp;
  const hpMovido = resolverAtaqueConHabilidad(atacante, movido, "hacha:tajoPesado", arenaAbierta()).objetivo.hp;
  assert.ok(hpQuieto < base, "objetivo quieto: más daño que el ataque base");
  assert.strictEqual(hpMovido, base, "objetivo que ya se movió: idéntico al ataque base");
});

test("resolverAtaqueConHabilidad maza:aturdir — con rnd por debajo del umbral aturde, por encima no; nunca aturde a un objetivo que cae con el golpe", () => {
  const atacante = unidad({ ataqueFisico: 10 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 0 });
  const aturdido = resolverAtaqueConHabilidad(atacante, objetivo, "maza:aturdir", arenaAbierta(), [], () => 0);
  assert.strictEqual(aturdido.objetivo.aturdido, true);
  const noAturdido = resolverAtaqueConHabilidad(atacante, objetivo, "maza:aturdir", arenaAbierta(), [], () => 0.99);
  assert.notStrictEqual(noAturdido.objetivo.aturdido, true, "rnd por encima del umbral: no aturde");

  const casiMuerto = unidad({ hp: 1, hpMax: 50, defensaFisica: 0 });
  const golpeFinal = resolverAtaqueConHabilidad(atacante, casiMuerto, "maza:aturdir", arenaAbierta(), [], () => 0);
  assert.strictEqual(golpeFinal.objetivo.estado, "caido");
  assert.notStrictEqual(golpeFinal.objetivo.aturdido, true, "un golpe que mata no aturde además");
});

test("resolverAtaqueConHabilidad baston:barrido — mismo daño que el ataque base, pero además reduce el PA del objetivo (mínimo 0)", () => {
  const atacante = unidad({ ataqueFisico: 10 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 0, pa: 2 });
  const r = resolverAtaqueConHabilidad(atacante, objetivo, "baston:barrido", arenaAbierta());
  assert.strictEqual(r.objetivo.hp, resolverAtaque(atacante, objetivo).hp);
  assert.strictEqual(r.objetivo.pa, 1);
  const sinPa = resolverAtaqueConHabilidad(atacante, { ...objetivo, pa: 0 }, "baston:barrido", arenaAbierta());
  assert.strictEqual(sinPa.objetivo.pa, 0, "nunca baja de 0");
});

test("resolverAtaqueConHabilidad lanza:embiste — empuja al objetivo 1 casilla alejándose del atacante si la casilla está libre", () => {
  const atacante = unidad({ gx: 0, gy: 0, ataqueFisico: 10 });
  const objetivo = unidad({ gx: 1, gy: 0, hp: 50, hpMax: 50, defensaFisica: 0 });
  const r = resolverAtaqueConHabilidad(atacante, objetivo, "lanza:embiste", arenaAbierta());
  assert.strictEqual(r.objetivo.gx, 2, "empujado 1 casilla más lejos del atacante");
  assert.strictEqual(r.objetivo.gy, 0);
});

test("resolverAtaqueConHabilidad lanza:embiste — no empuja si la casilla destino es un obstáculo o está ocupada, y no empuja un cadáver", () => {
  const atacante = unidad({ gx: 0, gy: 0, ataqueFisico: 10 });
  const objetivo = unidad({ gx: 1, gy: 0, hp: 50, hpMax: 50, defensaFisica: 0 });

  const arenaConMuro = arenaAbierta();
  arenaConMuro.obstaculos[0 * arenaConMuro.ancho + 2] = 1; // (2,0) obstáculo, justo donde caería el empuje
  const bloqueado = resolverAtaqueConHabilidad(atacante, objetivo, "lanza:embiste", arenaConMuro);
  assert.strictEqual(bloqueado.objetivo.gx, 1, "sigue en su sitio, el muro bloquea el empuje");

  const ocupada: import("../src/combate/pathfindingArena").Casilla[] = [{ gx: 2, gy: 0 }];
  const conOcupante = resolverAtaqueConHabilidad(atacante, objetivo, "lanza:embiste", arenaAbierta(), ocupada);
  assert.strictEqual(conOcupante.objetivo.gx, 1, "otra unidad ya está ahí, no se apila");

  const cadaver = unidad({ gx: 1, gy: 0, hp: 1, hpMax: 50, defensaFisica: 0 });
  const golpeMortal = resolverAtaqueConHabilidad(atacante, cadaver, "lanza:embiste", arenaAbierta());
  assert.strictEqual(golpeMortal.objetivo.estado, "caido");
  assert.strictEqual(golpeMortal.objetivo.gx, 1, "un golpe que mata no empuja el cadáver");
});

test("resolverAtaqueConHabilidad: absorbido = ataque efectivo - daño real (lo que 'paró' la defensa, para desgastar armadura)", () => {
  const atacante = unidad({ ataqueFisico: 20 });
  const objetivo = unidad({ hp: 50, hpMax: 50, defensaFisica: 8 });
  const r = resolverAtaqueConHabilidad(atacante, objetivo, "", arenaAbierta());
  assert.strictEqual(r.danio, 12); // 20-8
  assert.strictEqual(r.absorbido, 8); // toda la defensa se aplicó de verdad
  // Defensa mayor que el ataque: el daño se clampa a 1 (calcularDanio), pero
  // lo absorbido nunca puede superar el ataque bruto del golpe.
  const objetivoBlindado = unidad({ hp: 50, hpMax: 50, defensaFisica: 999 });
  const rBlindado = resolverAtaqueConHabilidad(atacante, objetivoBlindado, "", arenaAbierta());
  assert.strictEqual(rBlindado.danio, 1);
  assert.strictEqual(rBlindado.absorbido, 19); // 20 - 1
});

test("jugarTurnoIA: una unidad aturdida no ataca ni se mueve, solo se limpia la bandera", () => {
  const aturdida = unidad({ id: "a", bando: "A", gx: 0, gy: 0, pa: 3, aturdido: true });
  const objetivo = unidad({ id: "b", bando: "B", gx: 1, gy: 0, hp: 50, hpMax: 50 });
  const resultado = jugarTurnoIA("a", [aturdida, objetivo], arenaAbierta());
  const a = resultado.find((u) => u.id === "a")!;
  assert.strictEqual(a.gx, 0, "no se movió");
  assert.strictEqual(a.aturdido, false, "la bandera se consume");
  assert.strictEqual(resultado.find((u) => u.id === "b")!.hp, 50, "no atacó pese a estar en alcance");
});

test("jugarTurnoIA: marca movioEsteTurno al desplazarse hacia el objetivo, no lo toca si ataca sin moverse", () => {
  const lejos = unidad({ id: "a", bando: "A", gx: 0, gy: 0, alcance: 1, pa: 2 });
  const objetivoLejos = unidad({ id: "b", bando: "B", gx: 5, gy: 0 });
  const seMovio = jugarTurnoIA("a", [lejos, objetivoLejos], arenaAbierta());
  assert.strictEqual(seMovio.find((u) => u.id === "a")!.movioEsteTurno, true);

  const cerca = unidad({ id: "a", bando: "A", gx: 0, gy: 0, alcance: 1 });
  const objetivoCerca = unidad({ id: "b", bando: "B", gx: 1, gy: 0, hp: 50, hpMax: 50 });
  const ataco = jugarTurnoIA("a", [cerca, objetivoCerca], arenaAbierta());
  assert.strictEqual(ataco.find((u) => u.id === "a")!.movioEsteTurno, undefined, "atacar sin moverse no toca la bandera");
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
