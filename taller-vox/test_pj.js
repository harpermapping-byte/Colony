"use strict";
// Tests del generador paramétrico de PJ y del mallado con esqueleto.
// Ejecutar: node --test test_pj.js
const test = require("node:test");
const assert = require("node:assert");
const { construirGLBConSkin } = require("./exportar_personaje_glb");
const { generarPJ, pjAleatorio, PRESETS_TEST, VOXELES_POR_METRO } = require("./generar_pj");

// Lee el chunk JSON de un .glb para poder afirmar sobre triángulos/huesos.
function jsonDeGLB(buf) {
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
}
const triangulos = (buf) => {
  const j = jsonDeGLB(buf);
  return j.accessors[j.meshes[0].primitives[0].indices].count / 3;
};

test("articulaciones tapadas: vóxeles vecinos de huesos DISTINTOS conservan sus caras", () => {
  // Dos vóxeles apilados, cada uno de un hueso: al animar se separan, así
  // que ambos deben ser cubos CERRADOS (12 quads = 24 triángulos).
  const dosHuesos = {
    bones: [
      { name: "a", parent: null, offset: [0, 0, 0], cajas: [[0, 0, 0, 0, 0, 0, "#ff0000"]] },
      { name: "b", parent: "a", offset: [0, 1, 0], cajas: [[0, 0, 0, 0, 0, 0, "#00ff00"]] },
    ],
  };
  assert.strictEqual(triangulos(construirGLBConSkin(dosHuesos, 0.05)), 24);
});

test("face-culling intacto dentro del MISMO hueso", () => {
  // Dos vóxeles apilados del mismo hueso: las 2 caras interiores se
  // eliminan (10 quads = 20 triángulos).
  const unHueso = {
    bones: [
      { name: "a", parent: null, offset: [0, 0, 0], cajas: [[0, 0, 0, 0, 1, 0, "#ff0000"]] },
    ],
  };
  assert.strictEqual(triangulos(construirGLBConSkin(unHueso, 0.05)), 20);
});

test("determinismo: mismos parámetros → mismo GLB byte a byte", () => {
  const params = PRESETS_TEST[0].params;
  const a = construirGLBConSkin(generarPJ(params), 1 / VOXELES_POR_METRO);
  const b = construirGLBConSkin(generarPJ(params), 1 / VOXELES_POR_METRO);
  assert.ok(a.equals(b));
});

test("pjAleatorio: misma semilla → mismo PJ; semillas distintas → PJ distintos", () => {
  assert.deepStrictEqual(pjAleatorio(123).meta, pjAleatorio(123).meta);
  const metas = new Set([1, 2, 3, 4, 5].map((s) => JSON.stringify(pjAleatorio(s).meta)));
  assert.ok(metas.size >= 4, "5 semillas deberían dar al menos 4 PJ distintos");
});

test("la altura en metros manda: vóxeles = altura × densidad", () => {
  assert.strictEqual(generarPJ({ alturaMetros: 1.75 }).alturaVoxeles, Math.round(1.75 * VOXELES_POR_METRO));
  assert.strictEqual(generarPJ({ alturaMetros: 1.5 }).alturaVoxeles, 48);
});

// Semiancho máximo (en vóxeles, normalizado por altura) de las cajas de un
// hueso concreto — para comparar siluetas entre sexos/pesos.
function anchoHueso(esqueleto, nombre) {
  const b = esqueleto.bones.find((x) => x.name === nombre);
  let max = 0;
  for (const c of b.cajas) max = Math.max(max, Math.abs(c[0]), Math.abs(c[3]));
  return max / esqueleto.alturaVoxeles;
}

test("silueta por sexo: hombros de hombre > mujer; el esqueleto no cambia", () => {
  const base = { alturaMetros: 1.7, peso: 0.5 };
  const el = generarPJ({ ...base, sexo: "hombre" });
  const ella = generarPJ({ ...base, sexo: "mujer" });
  assert.ok(anchoHueso(el, "spine") > anchoHueso(ella, "spine"), "el torso masculino debe ser más ancho de hombros");
  assert.deepStrictEqual(el.bones.map((b) => b.name), ella.bones.map((b) => b.name), "mismos 15 huesos y nombres");
  assert.strictEqual(el.bones.length, 15);
});

test("peso: un PJ corpulento es más ancho que uno delgado a igual altura", () => {
  const gordo = generarPJ({ alturaMetros: 1.7, peso: 1 });
  const flaco = generarPJ({ alturaMetros: 1.7, peso: 0 });
  assert.ok(anchoHueso(gordo, "spine") > anchoHueso(flaco, "spine"));
  assert.ok(anchoHueso(gordo, "upperleg.L") >= anchoHueso(flaco, "upperleg.L"));
  assert.strictEqual(gordo.alturaVoxeles, flaco.alturaVoxeles, "el peso no cambia la altura");
});

test("pelo y barba añaden geometría; calvo/ninguna no", () => {
  const cajas = (p) => generarPJ(p).bones.reduce((n, b) => n + b.cajas.length, 0);
  const base = { sexo: "hombre", pelo: "calvo", barba: "ninguna" };
  assert.ok(cajas({ ...base, pelo: "melena" }) > cajas(base));
  assert.ok(cajas({ ...base, barba: "completa" }) > cajas(base));
  // la mujer ignora la barba
  assert.strictEqual(cajas({ sexo: "mujer", pelo: "calvo", barba: "completa" }), cajas({ sexo: "mujer", pelo: "calvo", barba: "ninguna" }));
});

test("los 3 presets del test exportan GLB válidos y distintos entre sí", () => {
  const tam = new Set();
  for (const preset of PRESETS_TEST) {
    const glb = construirGLBConSkin(generarPJ(preset.params), 1 / VOXELES_POR_METRO);
    assert.strictEqual(glb.readUInt32LE(0), 0x46546c67, "magic glTF");
    const j = jsonDeGLB(glb);
    assert.strictEqual(j.skins[0].joints.length, 15);
    tam.add(glb.length);
  }
  assert.strictEqual(tam.size, 3, "los 3 PJ deben tener mallas distintas");
});
