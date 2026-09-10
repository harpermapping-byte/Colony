import { test } from "node:test";
import assert from "node:assert/strict";
import { generarAnimalVoxel } from "../src/render3d/generarAnimalVoxel";
import { animalPlaceholder } from "../src/render3d/animalPlaceholder";

// Port parcial de generarAnimal.js (cuadrupedo/ave) para fauna/mascotas/
// monturas EN VIVO — ver el comentario de cabecera de generarAnimalVoxel.ts.
// Estas pruebas verifican lo que un test visual no puede confirmar barato:
// determinismo por semilla, que las especies soportadas dejan de caer al
// placeholder de una caja, y que el resto sigue cayendo exactamente igual
// que antes de este port.

function sinNaN(piezas: { cx: number; y0: number; cz: number; w: number; h: number; d: number }[]): boolean {
  return piezas.every((p) => [p.cx, p.y0, p.cz, p.w, p.h, p.d].every((n) => Number.isFinite(n)));
}

test("mismo especieId+individuoId siempre da el mismo resultado (determinista)", () => {
  const a = generarAnimalVoxel("lobo", "fauna_123");
  const b = generarAnimalVoxel("lobo", "fauna_123");
  assert.deepEqual(a, b);
});

test("individuoId distinto da (normalmente) un individuo distinto de la misma especie", () => {
  const a = generarAnimalVoxel("lobo", "fauna_1");
  const b = generarAnimalVoxel("lobo", "fauna_2");
  assert.equal(a.ficha.especieId, b.ficha.especieId);
  assert.equal(a.ficha.esqueleto, "cuadrupedo");
  // con escala/color/rasgos variando por semilla, dos individuos distintos
  // no deberían coincidir pieza a pieza (probabilísticamente imposible que
  // coincida por azar con estos dos ids concretos).
  assert.notDeepEqual(a, b);
});

test("una especie cuadrupedo real (lobo) deja de ser una caja — cuerpo articulado con patas/cabeza/cola", () => {
  const lobo = generarAnimalVoxel("lobo", "fauna_lobo_1");
  assert.equal(lobo.ficha.esqueleto, "cuadrupedo");
  const pivotes = new Set(lobo.piezas.map((p) => p.pivote));
  assert.ok(pivotes.has("cuerpo"));
  assert.ok(pivotes.has("cabeza"));
  assert.ok(pivotes.has("pataDelIzq"));
  assert.ok(pivotes.has("pataDelDer"));
  assert.ok(pivotes.has("pataTrasIzq"));
  assert.ok(pivotes.has("pataTrasDer"));
  assert.ok(pivotes.has("cola")); // lobo tiene rasgos.cola = "larga"
  // mucho más que las 2 piezas del placeholder (cuerpo + "lomo" invisible)
  assert.ok(lobo.piezas.length > 2);
  assert.ok(sinNaN(lobo.piezas));
});

test("una especie ave real (arrendajo) deja de ser una caja — cuerpo con patas/alas/pico", () => {
  const ave = generarAnimalVoxel("arrendajo", "fauna_ave_1");
  assert.equal(ave.ficha.esqueleto, "ave");
  const pivotes = new Set(ave.piezas.map((p) => p.pivote));
  assert.ok(pivotes.has("cuerpo"));
  assert.ok(pivotes.has("cabeza"));
  assert.ok(pivotes.has("pataIzq"));
  assert.ok(pivotes.has("pataDer"));
  assert.ok(pivotes.has("alaIzq"));
  assert.ok(pivotes.has("alaDer"));
  assert.ok(ave.piezas.length > 2);
  assert.ok(sinNaN(ave.piezas));
});

test("herencia heredaDe (perra hereda el esqueleto/razas de perro): también sale articulada, no placeholder", () => {
  const perra = generarAnimalVoxel("perra", "fauna_perra_1");
  assert.equal(perra.ficha.esqueleto, "cuadrupedo");
  const pivotes = new Set(perra.piezas.map((p) => p.pivote));
  assert.ok(pivotes.has("pataDelIzq"));
  assert.ok(sinNaN(perra.piezas));
});

test("herencia heredaRazasDe (gallina_salvaje comparte razas de gallo): sale articulada, no placeholder", () => {
  const gallina = generarAnimalVoxel("gallina_salvaje", "fauna_gallina_1");
  assert.equal(gallina.ficha.esqueleto, "ave");
  assert.ok(gallina.piezas.some((p) => p.pivote === "alaIzq"));
  assert.ok(sinNaN(gallina.piezas));
});

test("razas de verdad (perro): la escala cae dentro del rango combinado esperado", () => {
  for (let i = 0; i < 20; i++) {
    const perro = generarAnimalVoxel("perro", `fauna_perro_${i}`);
    // el rango más amplio de cualquier raza declarada de perro es
    // chihuahua [0.22,0.32] .. husky/doberman [0.7,0.9]
    assert.ok(perro.ficha.escala >= 0.2 && perro.ficha.escala <= 0.95, `escala fuera de rango: ${perro.ficha.escala}`);
  }
});

test("regresión bug real 2026-09-09: orejas 'ninguna' (lagarto_ocelado) no produce piezas NaN/corruptas", () => {
  const lagarto = generarAnimalVoxel("lagarto_ocelado", "fauna_lagarto_1");
  assert.equal(lagarto.ficha.esqueleto, "cuadrupedo");
  assert.ok(sinNaN(lagarto.piezas));
});

test("sexo determinista: cuernos ramificados (ciervo, solo macho) aparecen o no según la semilla, nunca al azar entre llamadas", () => {
  let vistoConCuernos = false;
  let vistoSinCuernos = false;
  for (let i = 0; i < 40; i++) {
    const id = `fauna_ciervo_${i}`;
    const a = generarAnimalVoxel("ciervo", id);
    const b = generarAnimalVoxel("ciervo", id);
    assert.deepEqual(a, b); // repetible para el mismo id
    const tieneCuernos = a.piezas.some((p) => p.color === "#d8cfc0");
    if (tieneCuernos) vistoConCuernos = true; else vistoSinCuernos = true;
  }
  assert.ok(vistoConCuernos, "en 40 semillas debería salir al menos un macho con cuernos");
  assert.ok(vistoSinCuernos, "en 40 semillas debería salir al menos una hembra sin cuernos");
});

test("esqueleto no portado (pez) sigue cayendo al placeholder de siempre, sin romper nada", () => {
  const pez = generarAnimalVoxel("pez_mediano", "fauna_pez_1");
  const placeholder = animalPlaceholder("pez_mediano");
  assert.deepEqual(pez, placeholder);
});

test("especie sin rig en el catálogo cae al placeholder en vez de lanzar", () => {
  assert.doesNotThrow(() => generarAnimalVoxel("especie_inventada_inexistente", "x"));
  const resultado = generarAnimalVoxel("especie_inventada_inexistente", "x");
  assert.deepEqual(resultado, animalPlaceholder("especie_inventada_inexistente"));
});
