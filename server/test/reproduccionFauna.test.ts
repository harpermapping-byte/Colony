// Tests de mundo/reproduccionFauna.ts — reproducción de fauna salvaje
// (pedido del streamer 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  AnimalReproductor,
  EspecieReproductiva,
  buscarPareja,
  diaFraccional,
  elegibleParaAparearse,
  faltanParaCompletarPoblacion,
  huevoEclosiona,
  intentarAparearse,
  resolverParto,
  sortearDuracionGestacion,
  tocaDarALuz,
} from "../src/mundo/reproduccionFauna";

function animal(overrides: Partial<AnimalReproductor> = {}): AnimalReproductor {
  return {
    id: "a",
    especieId: "lobo",
    sexo: "macho",
    etapa: "adulto",
    vivo: true,
    x: 0,
    y: 0,
    ultimaComida: 10,
    ultimaBebida: 10,
    gestandoDesde: null,
    gestacionDuracionDias: null,
    ...overrides,
  };
}

const RND_SIEMPRE_0 = () => 0; // fuerza éxito en tiradas "< 0.5"
const RND_SIEMPRE_1 = () => 0.999999; // fuerza fallo

test("diaFraccional: combina día entero y hora en un número creciente", () => {
  assert.strictEqual(diaFraccional(5, 0), 5);
  assert.strictEqual(diaFraccional(5, 12), 5.5);
  assert.ok(diaFraccional(5, 23) < diaFraccional(6, 0));
});

test("elegibleParaAparearse: exige vivo, adulto, no gestando, y comido/bebido recientemente", () => {
  const ahora = 10;
  assert.strictEqual(elegibleParaAparearse(animal(), ahora), true);
  assert.strictEqual(elegibleParaAparearse(animal({ vivo: false }), ahora), false);
  assert.strictEqual(elegibleParaAparearse(animal({ etapa: "cria" }), ahora), false);
  assert.strictEqual(elegibleParaAparearse(animal({ gestandoDesde: 8 }), ahora), false);
  assert.strictEqual(elegibleParaAparearse(animal({ ultimaComida: 5 }), ahora), false, "comió hace más de 1 día");
  assert.strictEqual(elegibleParaAparearse(animal({ ultimaBebida: 5 }), ahora), false, "bebió hace más de 1 día");
});

test("buscarPareja: encuentra la más cercana de la misma especie y sexo opuesto, elegible, dentro del radio", () => {
  const yo = animal({ id: "yo", sexo: "macho", especieId: "lobo", x: 0, y: 0 });
  const candidatos = [
    animal({ id: "lejos", sexo: "hembra", especieId: "lobo", x: 100, y: 100 }),
    animal({ id: "otra_especie", sexo: "hembra", especieId: "oso_pardo", x: 1, y: 0 }),
    animal({ id: "mismo_sexo", sexo: "macho", especieId: "lobo", x: 1, y: 0 }),
    animal({ id: "no_comio", sexo: "hembra", especieId: "lobo", x: 2, y: 0, ultimaComida: 0 }),
    animal({ id: "cerca", sexo: "hembra", especieId: "lobo", x: 3, y: 0 }),
    animal({ id: "mas_cerca", sexo: "hembra", especieId: "lobo", x: 1.5, y: 0 }),
  ];
  const pareja = buscarPareja(yo, candidatos, 10, 10);
  assert.strictEqual(pareja?.id, "mas_cerca");
});

test("buscarPareja: null si no hay nadie elegible dentro del radio", () => {
  const yo = animal({ id: "yo", x: 0, y: 0 });
  const candidatos = [animal({ id: "lejos", sexo: "hembra", x: 50, y: 0 })];
  assert.strictEqual(buscarPareja(yo, candidatos, 5, 10), null);
});

test("sortearDuracionGestacion: cae siempre dentro del rango de su tamaño", () => {
  for (let i = 0; i < 50; i++) {
    const rnd = () => i / 50;
    assert.ok(sortearDuracionGestacion("pequeno", rnd) === 3);
    const m = sortearDuracionGestacion("mediano", rnd);
    assert.ok(m >= 5 && m <= 8, `mediano fuera de rango: ${m}`);
    const g = sortearDuracionGestacion("grande", rnd);
    assert.ok(g >= 15 && g <= 20, `grande fuera de rango: ${g}`);
  }
});

test("intentarAparearse: exige (macho, hembra) en ese orden", () => {
  const a = animal({ sexo: "hembra" });
  const b = animal({ sexo: "macho" });
  const especie: EspecieReproductiva = { tamanoReproduccion: "mediano", poneHuevos: false };
  assert.throws(() => intentarAparearse(a, b, especie, 10));
});

test("intentarAparearse: falla si alguno no está saciado, sin gastar la tirada de 50%", () => {
  const macho = animal({ sexo: "macho" });
  const hembra = animal({ sexo: "hembra", ultimaComida: 0 }); // no saciada
  const especie: EspecieReproductiva = { tamanoReproduccion: "mediano", poneHuevos: false };
  const r = intentarAparearse(macho, hembra, especie, 10, RND_SIEMPRE_0);
  assert.strictEqual(r.exito, false);
  assert.strictEqual(hembra.gestandoDesde, null);
});

test("intentarAparearse: mamífero (no pone huevos) — éxito deja a la hembra gestando, con duración concreta guardada", () => {
  const macho = animal({ sexo: "macho" });
  const hembra = animal({ sexo: "hembra" });
  const especie: EspecieReproductiva = { tamanoReproduccion: "grande", poneHuevos: false };
  const r = intentarAparearse(macho, hembra, especie, 10, RND_SIEMPRE_0);
  assert.strictEqual(r.exito, true);
  if (r.exito) assert.strictEqual(r.huevo, null);
  assert.strictEqual(hembra.gestandoDesde, 10);
  assert.ok(hembra.gestacionDuracionDias! >= 15 && hembra.gestacionDuracionDias! <= 20);
  assert.strictEqual(elegibleParaAparearse(hembra, 10), false, "ya no puede volver a aparearse mientras gesta");
});

test("intentarAparearse: 50% — con rnd que siempre falla, nunca cuaja aunque las condiciones sean perfectas", () => {
  const macho = animal({ sexo: "macho" });
  const hembra = animal({ sexo: "hembra" });
  const especie: EspecieReproductiva = { tamanoReproduccion: "pequeno", poneHuevos: false };
  const r = intentarAparearse(macho, hembra, especie, 10, RND_SIEMPRE_1);
  assert.strictEqual(r.exito, false);
  assert.strictEqual(hembra.gestandoDesde, null);
});

test("intentarAparearse: ovíparo — éxito pone un huevo y la hembra queda LIBRE al instante (no gestando)", () => {
  const macho = animal({ sexo: "macho", especieId: "gallo" });
  const hembra = animal({ sexo: "hembra", especieId: "gallina_salvaje" });
  const especie: EspecieReproductiva = { tamanoReproduccion: "pequeno", poneHuevos: true };
  const r = intentarAparearse(macho, hembra, especie, 10, RND_SIEMPRE_0);
  assert.strictEqual(r.exito, true);
  if (r.exito) {
    assert.ok(r.huevo);
    assert.strictEqual(r.huevo!.especieMadreId, "gallina_salvaje");
    assert.strictEqual(r.huevo!.puestoEn, 10);
    assert.strictEqual(r.huevo!.duracionDias, 3);
  }
  assert.strictEqual(hembra.gestandoDesde, null, "las aves no quedan bloqueadas — lo que gesta es el huevo");
  assert.strictEqual(elegibleParaAparearse(hembra, 10), true, "libre para volver a aparearse enseguida");
});

test("tocaDarALuz: false antes de cumplirse la duración, true justo al cumplirse", () => {
  const hembra = animal({ sexo: "hembra", gestandoDesde: 10, gestacionDuracionDias: 5 });
  assert.strictEqual(tocaDarALuz(hembra, 14.9), false);
  assert.strictEqual(tocaDarALuz(hembra, 15), true);
  assert.strictEqual(tocaDarALuz(hembra, 20), true);
});

test("tocaDarALuz: false si no está gestando", () => {
  assert.strictEqual(tocaDarALuz(animal({ gestandoDesde: null }), 1000), false);
});

test("huevoEclosiona: false antes, true al cumplirse la duración", () => {
  const h = { id: "h", especieMadreId: "gallina_salvaje", x: 0, y: 0, puestoEn: 10, duracionDias: 3 };
  assert.strictEqual(huevoEclosiona(h, 12.9), false);
  assert.strictEqual(huevoEclosiona(h, 13), true);
});

test("resolverParto: 1 cría por defecto, con el criaId del catálogo si existe", () => {
  const especie: EspecieReproductiva = { tamanoReproduccion: "grande", poneHuevos: false, criaId: "jabato" };
  const r = resolverParto("jabali", especie);
  assert.deepStrictEqual(r.criasEspecieId, ["jabato"]);
});

test("resolverParto: sin criaId en el catálogo, la cría sale con el mismo especieId del progenitor", () => {
  const especie: EspecieReproductiva = { tamanoReproduccion: "grande", poneHuevos: false };
  const r = resolverParto("lobo", especie);
  assert.deepStrictEqual(r.criasEspecieId, ["lobo"]);
});

test("resolverParto: roedores con criasPorCamada 2 dan dos crías", () => {
  const especie: EspecieReproductiva = {
    tamanoReproduccion: "pequeno",
    poneHuevos: false,
    criaId: "ratoncillo_de_campo",
    criasPorCamada: 2,
  };
  const r = resolverParto("raton_de_campo", especie);
  assert.deepStrictEqual(r.criasEspecieId, ["ratoncillo_de_campo", "ratoncillo_de_campo"]);
});

test("faltanParaCompletarPoblacion: población infinita de insectos — rellena hasta el tope, nunca negativo", () => {
  assert.strictEqual(faltanParaCompletarPoblacion(3, 10), 7);
  assert.strictEqual(faltanParaCompletarPoblacion(10, 10), 0);
  assert.strictEqual(faltanParaCompletarPoblacion(15, 10), 0, "nunca pide de menos aunque haya de más");
});
