// Tests de la lógica PURA de cría de descendencia en ganadería
// (server/src/mundo/reproduccionGranja.ts). Ejecutar: npm test (tsx --test).
import { test } from "node:test";
import * as assert from "node:assert";
import * as path from "node:path";
import {
  cargarCatalogoReproduccionGranja,
  parejaDe,
  PAREJAS_GRANJA,
  PROBABILIDAD_EXITO_GRANJA,
  HUEVOS_SIN_NIDO,
  HUEVOS_MAX_CON_NIDO,
  resolverReproduccionPropiedad,
  AnimalGranjaMinimo,
} from "../src/mundo/reproduccionGranja";
import { EspecieReproductiva } from "../src/mundo/reproduccionFauna";

const RND_SIEMPRE_0 = () => 0;
const RND_SIEMPRE_1 = () => 0.999999;

function animal(id: string, especieId: string, extra: Record<string, unknown> = {}, x = 0, y = 0): AnimalGranjaMinimo {
  return { id, especieId, x, y, extra };
}

const CATALOGO: Record<string, EspecieReproductiva> = {
  vaca: { tamanoReproduccion: "grande", poneHuevos: false, dieta: "herbivoro", criaId: "ternero" },
  toro: { tamanoReproduccion: "grande", poneHuevos: false, dieta: "herbivoro", criaId: "ternero" },
  cerdo: { tamanoReproduccion: "mediano", poneHuevos: false, dieta: "omnivoro", criaId: "cerdito", criasPorCamada: 4 },
  cerda: { tamanoReproduccion: "mediano", poneHuevos: false, dieta: "omnivoro", criaId: "cerdito", criasPorCamada: 4 },
  gallo: { tamanoReproduccion: "pequeno", poneHuevos: true, dieta: "omnivoro", criaId: "pollito" },
  gallina_salvaje: { tamanoReproduccion: "pequeno", poneHuevos: true, dieta: "omnivoro", criaId: "pollito" },
};

test("parejaDe: reconoce macho y hembra de la misma clave", () => {
  assert.deepStrictEqual(parejaDe("toro"), { clave: "vaca", pareja: { machoId: "toro", hembraId: "vaca" } });
  assert.deepStrictEqual(parejaDe("vaca"), { clave: "vaca", pareja: { machoId: "toro", hembraId: "vaca" } });
  assert.strictEqual(parejaDe("carne_roja"), null);
});

test("PAREJAS_GRANJA: cerdos y conejos son las camadas grandes, el resto sin pasivo explícito no lleva de más", () => {
  assert.ok(PAREJAS_GRANJA["cerda"]);
  assert.ok(PAREJAS_GRANJA["coneja"]);
  assert.ok(PAREJAS_GRANJA["gallina"]); // reusa gallina_salvaje como hembra ya domesticable
  assert.strictEqual(PAREJAS_GRANJA["gallina"].hembraId, "gallina_salvaje");
});

test("cargarCatalogoReproduccionGranja: la ficha real de vaca/toro/coneja/gallina_salvaje trae lo necesario para criar", () => {
  const catalogo = cargarCatalogoReproduccionGranja(path.resolve(__dirname, "..", "..", "baker", "catalogo", "animales.json"));
  assert.ok(catalogo["vaca"] && catalogo["toro"], "faltan vaca/toro");
  assert.strictEqual(catalogo["vaca"].criaId, "ternero");
  assert.ok(catalogo["coneja"], "falta la coneja añadida esta pasada");
  assert.strictEqual(catalogo["coneja"].criasPorCamada, 3);
  assert.strictEqual(catalogo["cerdo"].criasPorCamada, 4);
  assert.ok(catalogo["gallina_salvaje"]?.poneHuevos, "gallina_salvaje debe poder poner huevos ahora");
  assert.strictEqual(catalogo["gallina_salvaje"].criaId, "pollito");
});

test("resolverReproduccionPropiedad: sin pareja elegible, no pasa nada", () => {
  const animales = [animal("v1", "vaca")]; // sin toro
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, false, 100, RND_SIEMPRE_0);
  assert.strictEqual(r.nuevos.length, 0);
  assert.strictEqual(r.maduraciones.length, 0);
  assert.strictEqual(r.extraPorId.size, 0);
});

test("resolverReproduccionPropiedad: macho+hembra elegibles, rnd favorable -> hembra queda gestando", () => {
  const animales = [animal("t1", "toro"), animal("v1", "vaca")];
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, false, 100, RND_SIEMPRE_0);
  assert.strictEqual(r.extraPorId.size, 1);
  const extra = r.extraPorId.get("v1") as { reproduccion: { gestandoDesde: number | null } };
  assert.strictEqual(extra.reproduccion.gestandoDesde, 100);
});

test("PROBABILIDAD_EXITO_GRANJA (0.85) es mayor que la salvaje (0.5): una tirada de 0.6 cuaja en granja", () => {
  assert.ok(PROBABILIDAD_EXITO_GRANJA > 0.5);
  const animales = [animal("t1", "toro"), animal("v1", "vaca")];
  const rnd06 = () => 0.6; // 0.6 < 0.85 (éxito en granja) pero 0.6 >= 0.5 (fallo salvaje)
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, false, 100, rnd06);
  assert.strictEqual(r.extraPorId.size, 1, "con 0.85 de probabilidad, 0.6 debe cuajar");
});

test("resolverReproduccionPropiedad: hembra gestando que ya toca parir da a luz y queda libre", () => {
  const hembra = animal("v1", "vaca", { reproduccion: { gestandoDesde: 0, gestacionDuracionDias: 15, nacioEn: null, ultimoHuevoEn: null } });
  const r = resolverReproduccionPropiedad([hembra], CATALOGO, true, false, 20, RND_SIEMPRE_0);
  assert.strictEqual(r.nuevos.length, 1);
  assert.strictEqual(r.nuevos[0].especieId, "ternero");
  const extra = r.extraPorId.get("v1") as { reproduccion: { gestandoDesde: number | null } };
  assert.strictEqual(extra.reproduccion.gestandoDesde, null, "queda libre tras el parto");
});

test("resolverReproduccionPropiedad: camada de cerdos sale con criasPorCamada (4)", () => {
  const hembra = animal("c1", "cerda", { reproduccion: { gestandoDesde: 0, gestacionDuracionDias: 8, nacioEn: null, ultimoHuevoEn: null } });
  const r = resolverReproduccionPropiedad([hembra], CATALOGO, true, false, 10, RND_SIEMPRE_0);
  assert.strictEqual(r.nuevos.length, 4);
  assert.ok(r.nuevos.every((n) => n.especieId === "cerdito"));
});

test("resolverReproduccionPropiedad: sin comida/agua hoy, nadie es elegible para aparearse ni parir", () => {
  const animales = [animal("t1", "toro"), animal("v1", "vaca")];
  const r = resolverReproduccionPropiedad(animales, CATALOGO, false, false, 100, RND_SIEMPRE_0);
  assert.strictEqual(r.extraPorId.size, 0);
});

test("puesta de huevos: sin gallo cerca, la gallina no pone", () => {
  const animales = [animal("g1", "gallina_salvaje")];
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, false, 10, RND_SIEMPRE_1);
  assert.strictEqual(r.huevos.length, 0);
});

test("puesta de huevos: con gallo, sin nido -> exactamente 1 huevo en el suelo", () => {
  const animales = [animal("g1", "gallo"), animal("g2", "gallina_salvaje")];
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, false, 10, RND_SIEMPRE_1);
  assert.strictEqual(r.huevos.length, 1);
  assert.strictEqual(r.huevos[0].cantidad, HUEVOS_SIN_NIDO);
});

test("puesta de huevos: con nido, entre 1 y 3 -> con rnd siempre alto sale el máximo (3)", () => {
  const animales = [animal("g1", "gallo"), animal("g2", "gallina_salvaje")];
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, true, 10, RND_SIEMPRE_1);
  assert.strictEqual(r.huevos[0].cantidad, HUEVOS_MAX_CON_NIDO);
});

test("puesta de huevos: una vez por día de mundo — la segunda resolución del mismo día no pone más", () => {
  const gallina = animal("g2", "gallina_salvaje", { reproduccion: { gestandoDesde: null, gestacionDuracionDias: null, nacioEn: null, ultimoHuevoEn: 10 } });
  const animales = [animal("g1", "gallo"), gallina];
  const r = resolverReproduccionPropiedad(animales, CATALOGO, true, false, 10.5, RND_SIEMPRE_1);
  assert.strictEqual(r.huevos.length, 0, "todavía no ha pasado 1 día de mundo desde el último huevo");
});

test("maduración: una cría con nacioEn muy antiguo pasa a adulto (macho o hembra según el rnd)", () => {
  const cria = animal("p1", "cerdito", { reproduccion: { gestandoDesde: null, gestacionDuracionDias: null, nacioEn: 0, ultimoHuevoEn: null } });
  const rMacho = resolverReproduccionPropiedad([cria], CATALOGO, true, false, 1000, RND_SIEMPRE_0);
  assert.strictEqual(rMacho.maduraciones.length, 1);
  assert.strictEqual(rMacho.maduraciones[0].nuevoEspecieId, "cerdo");
  const rHembra = resolverReproduccionPropiedad([cria], CATALOGO, true, false, 1000, RND_SIEMPRE_1);
  assert.strictEqual(rHembra.maduraciones[0].nuevoEspecieId, "cerda");
});

test("maduración: una cría recién nacida no madura todavía", () => {
  const cria = animal("p1", "cerdito", { reproduccion: { gestandoDesde: null, gestacionDuracionDias: null, nacioEn: 100, ultimoHuevoEn: null } });
  const r = resolverReproduccionPropiedad([cria], CATALOGO, true, false, 101, RND_SIEMPRE_0);
  assert.strictEqual(r.maduraciones.length, 0);
});
