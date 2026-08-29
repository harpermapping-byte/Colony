// Tests de mundo/reproduccionFauna.ts — reproducción de fauna salvaje
// (pedido del streamer 2026-08-30, ampliado 2026-08-30 con hambre/sed
// diaria por dieta y maduración de crías). Ejecutar: npm test desde server/.
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
  necesitaAgua,
  necesitaComida,
  resolverParto,
  sortearDuracionGestacion,
  tocaDarALuz,
  tocaMadurar,
  ventanaComidaDias,
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
    nacioEn: null,
    ...overrides,
  };
}

function especie(overrides: Partial<EspecieReproductiva> = {}): EspecieReproductiva {
  return { tamanoReproduccion: "mediano", poneHuevos: false, dieta: "herbivoro", ...overrides };
}

const RND_SIEMPRE_0 = () => 0; // fuerza éxito en tiradas "< 0.5"
const RND_SIEMPRE_1 = () => 0.999999; // fuerza fallo

test("diaFraccional: combina día entero y hora en un número creciente", () => {
  assert.strictEqual(diaFraccional(5, 0), 5);
  assert.strictEqual(diaFraccional(5, 12), 5.5);
  assert.ok(diaFraccional(5, 23) < diaFraccional(6, 0));
});

test("ventanaComidaDias: herbívoros/omnívoros 1 día, carnívoros 6 días (pedido explícito)", () => {
  assert.strictEqual(ventanaComidaDias("herbivoro"), 1);
  assert.strictEqual(ventanaComidaDias("omnivoro"), 1);
  assert.strictEqual(ventanaComidaDias("carnivoro"), 6);
});

test("necesitaAgua: adultos sí, según la ventana de 1 día — crías NUNCA (comen/beben de sus padres)", () => {
  const ahora = 10;
  assert.strictEqual(necesitaAgua(animal({ ultimaBebida: 9.5 }), ahora), false);
  assert.strictEqual(necesitaAgua(animal({ ultimaBebida: 8.9 }), ahora), true);
  assert.strictEqual(necesitaAgua(animal({ etapa: "cria", ultimaBebida: 0 }), ahora), false, "cría exenta pase lo que pase");
});

test("necesitaComida: depende de la dieta de la especie — un carnívoro aguanta mucho más que un herbívoro", () => {
  const ahora = 10;
  const herb = especie({ dieta: "herbivoro" });
  const carn = especie({ dieta: "carnivoro" });
  assert.strictEqual(necesitaComida(animal({ ultimaComida: 8.9 }), herb, ahora), true, "herbívoro: más de 1 día sin comer");
  assert.strictEqual(necesitaComida(animal({ ultimaComida: 8.9 }), carn, ahora), false, "carnívoro: 1.1 días es nada dentro de 6");
  assert.strictEqual(necesitaComida(animal({ ultimaComida: 3.9 }), carn, ahora), true, "carnívoro: más de 6 días sin comer");
  assert.strictEqual(necesitaComida(animal({ etapa: "cria", ultimaComida: 0 }), carn, ahora), false, "cría exenta pase lo que pase");
});

test("elegibleParaAparearse: exige vivo, adulto, no gestando, y agua/comida dentro de su ventana", () => {
  const ahora = 10;
  const herb = especie({ dieta: "herbivoro" });
  assert.strictEqual(elegibleParaAparearse(animal(), herb, ahora), true);
  assert.strictEqual(elegibleParaAparearse(animal({ vivo: false }), herb, ahora), false);
  assert.strictEqual(elegibleParaAparearse(animal({ etapa: "cria" }), herb, ahora), false);
  assert.strictEqual(elegibleParaAparearse(animal({ gestandoDesde: 8 }), herb, ahora), false);
  assert.strictEqual(elegibleParaAparearse(animal({ ultimaComida: 5 }), herb, ahora), false, "comió hace más de 1 día");
  assert.strictEqual(elegibleParaAparearse(animal({ ultimaBebida: 5 }), herb, ahora), false, "bebió hace más de 1 día (agua es igual para todos)");
  // un carnívoro con la misma última comida SÍ sigue elegible (ventana de 6 días)
  const carn = especie({ dieta: "carnivoro" });
  assert.strictEqual(elegibleParaAparearse(animal({ ultimaComida: 5 }), carn, ahora), true);
});

test("buscarPareja: encuentra la más cercana de la misma especie y sexo opuesto, elegible, dentro del radio", () => {
  const herb = especie();
  const yo = animal({ id: "yo", sexo: "macho", especieId: "lobo", x: 0, y: 0 });
  const candidatos = [
    animal({ id: "lejos", sexo: "hembra", especieId: "lobo", x: 100, y: 100 }),
    animal({ id: "otra_especie", sexo: "hembra", especieId: "oso_pardo", x: 1, y: 0 }),
    animal({ id: "mismo_sexo", sexo: "macho", especieId: "lobo", x: 1, y: 0 }),
    animal({ id: "no_comio", sexo: "hembra", especieId: "lobo", x: 2, y: 0, ultimaComida: 0 }),
    animal({ id: "cerca", sexo: "hembra", especieId: "lobo", x: 3, y: 0 }),
    animal({ id: "mas_cerca", sexo: "hembra", especieId: "lobo", x: 1.5, y: 0 }),
  ];
  const pareja = buscarPareja(yo, herb, candidatos, 10, 10);
  assert.strictEqual(pareja?.id, "mas_cerca");
});

test("buscarPareja: null si no hay nadie elegible dentro del radio", () => {
  const yo = animal({ id: "yo", x: 0, y: 0 });
  const candidatos = [animal({ id: "lejos", sexo: "hembra", x: 50, y: 0 })];
  assert.strictEqual(buscarPareja(yo, especie(), candidatos, 5, 10), null);
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
  assert.throws(() => intentarAparearse(a, b, especie(), 10));
});

test("intentarAparearse: falla si alguno no está saciado, sin gastar la tirada de 50%", () => {
  const macho = animal({ sexo: "macho" });
  const hembra = animal({ sexo: "hembra", ultimaComida: 0 }); // no saciada
  const r = intentarAparearse(macho, hembra, especie(), 10, RND_SIEMPRE_0);
  assert.strictEqual(r.exito, false);
  assert.strictEqual(hembra.gestandoDesde, null);
});

test("intentarAparearse: mamífero (no pone huevos) — éxito deja a la hembra gestando, con duración concreta guardada", () => {
  const macho = animal({ sexo: "macho" });
  const hembra = animal({ sexo: "hembra" });
  const e = especie({ tamanoReproduccion: "grande" });
  const r = intentarAparearse(macho, hembra, e, 10, RND_SIEMPRE_0);
  assert.strictEqual(r.exito, true);
  if (r.exito) assert.strictEqual(r.huevo, null);
  assert.strictEqual(hembra.gestandoDesde, 10);
  assert.ok(hembra.gestacionDuracionDias! >= 15 && hembra.gestacionDuracionDias! <= 20);
  assert.strictEqual(elegibleParaAparearse(hembra, e, 10), false, "ya no puede volver a aparearse mientras gesta");
});

test("intentarAparearse: 50% — con rnd que siempre falla, nunca cuaja aunque las condiciones sean perfectas", () => {
  const macho = animal({ sexo: "macho" });
  const hembra = animal({ sexo: "hembra" });
  const r = intentarAparearse(macho, hembra, especie({ tamanoReproduccion: "pequeno" }), 10, RND_SIEMPRE_1);
  assert.strictEqual(r.exito, false);
  assert.strictEqual(hembra.gestandoDesde, null);
});

test("intentarAparearse: ovíparo — éxito pone un huevo y la hembra queda LIBRE al instante (no gestando)", () => {
  const macho = animal({ sexo: "macho", especieId: "gallo" });
  const hembra = animal({ sexo: "hembra", especieId: "gallina_salvaje" });
  const e = especie({ tamanoReproduccion: "pequeno", poneHuevos: true });
  const r = intentarAparearse(macho, hembra, e, 10, RND_SIEMPRE_0);
  assert.strictEqual(r.exito, true);
  if (r.exito) {
    assert.ok(r.huevo);
    assert.strictEqual(r.huevo!.especieMadreId, "gallina_salvaje");
    assert.strictEqual(r.huevo!.puestoEn, 10);
    assert.strictEqual(r.huevo!.duracionDias, 3);
  }
  assert.strictEqual(hembra.gestandoDesde, null, "las aves no quedan bloqueadas — lo que gesta es el huevo");
  assert.strictEqual(elegibleParaAparearse(hembra, e, 10), true, "libre para volver a aparearse enseguida");
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

test("tocaMadurar: false si no es cría, false si nunca 'nació' en el sistema (población base), true al cumplirse", () => {
  assert.strictEqual(tocaMadurar(animal({ etapa: "adulto", nacioEn: 0 }), "pequeno", 1000), false, "no es cría");
  assert.strictEqual(tocaMadurar(animal({ etapa: "cria", nacioEn: null }), "pequeno", 1000), false, "población base, nunca nació en el sistema");
  const cria = animal({ etapa: "cria", nacioEn: 10 });
  assert.strictEqual(tocaMadurar(cria, "pequeno", 19.9), false);
  assert.strictEqual(tocaMadurar(cria, "pequeno", 20), true);
  assert.strictEqual(tocaMadurar(animal({ etapa: "cria", nacioEn: 10 }), "grande", 20), false, "grande tarda mucho más (40 días)");
});

test("resolverParto: 1 cría por defecto, con el criaId del catálogo si existe", () => {
  const e = especie({ tamanoReproduccion: "grande", criaId: "jabato" });
  const r = resolverParto("jabali", e);
  assert.deepStrictEqual(r.criasEspecieId, ["jabato"]);
});

test("resolverParto: sin criaId en el catálogo, la cría sale con el mismo especieId del progenitor", () => {
  const r = resolverParto("lobo", especie({ tamanoReproduccion: "grande" }));
  assert.deepStrictEqual(r.criasEspecieId, ["lobo"]);
});

test("resolverParto: roedores con criasPorCamada 2 dan dos crías", () => {
  const e = especie({ tamanoReproduccion: "pequeno", criaId: "ratoncillo_de_campo", criasPorCamada: 2 });
  const r = resolverParto("raton_de_campo", e);
  assert.deepStrictEqual(r.criasEspecieId, ["ratoncillo_de_campo", "ratoncillo_de_campo"]);
});

test("faltanParaCompletarPoblacion: población infinita de insectos — rellena hasta el tope, nunca negativo", () => {
  assert.strictEqual(faltanParaCompletarPoblacion(3, 10), 7);
  assert.strictEqual(faltanParaCompletarPoblacion(10, 10), 0);
  assert.strictEqual(faltanParaCompletarPoblacion(15, 10), 0, "nunca pide de menos aunque haya de más");
});
