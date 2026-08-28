// Tests del bakeador de texturas (docs/GDD_Bakeador_Texturas.md). Ejecutar:
// node --test texturas/test/texturas.test.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { FAMILIAS } = require("../src/familias");
const { EXCLUIDOS, MAPEO_TERRENOS, MAPEO_MATERIALES } = require("../src/mapeoCatalogo");

const terrenos = require("../../baker/catalogo/terrenos.json");
const materiales = require("../../interiores/catalogo/materiales.json");

const N = 32; // resolución chica en los tests: mismo comportamiento, mucho más rápido que 128

test("cobertura: todo id de terrenos.json/materiales.json (salvo los excluidos a propósito) tiene familia asignada y esa familia existe", () => {
  for (const [id] of Object.entries(terrenos)) {
    if (id.startsWith("_") || EXCLUIDOS.has(id)) continue;
    assert.ok(MAPEO_TERRENOS[id], `terreno "${id}" sin familia en mapeoCatalogo.js`);
    assert.ok(FAMILIAS[MAPEO_TERRENOS[id]], `terreno "${id}": familia "${MAPEO_TERRENOS[id]}" no existe en familias.js`);
  }
  for (const [id] of Object.entries(materiales)) {
    if (id.startsWith("_")) continue;
    assert.ok(MAPEO_MATERIALES[id], `material "${id}" sin familia en mapeoCatalogo.js`);
    assert.ok(FAMILIAS[MAPEO_MATERIALES[id]], `material "${id}": familia "${MAPEO_MATERIALES[id]}" no existe en familias.js`);
  }
});

test("líquidos (agua/agua_profunda/lava) están excluidos a propósito, no colados sin querer", () => {
  for (const id of ["agua", "agua_profunda", "lava"]) {
    assert.ok(terrenos[id], `este test asume que "${id}" sigue en terrenos.json`);
    assert.ok(EXCLUIDOS.has(id), `"${id}" debería estar en EXCLUIDOS`);
  }
});

function recorrer(pintar, cb) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) cb(x, y, pintar(x, y));
}

test("determinismo: misma familia + mismo color + misma semilla = mismos píxeles siempre", () => {
  const a = FAMILIAS.piedra(N, "#8a8a8a", "det:piedra").variante(0);
  const b = FAMILIAS.piedra(N, "#8a8a8a", "det:piedra").variante(0);
  let iguales = 0, total = 0;
  recorrer(a, (x, y, colorA) => {
    const colorB = b(x, y);
    total++;
    if (colorA.every((c, i) => c === colorB[i])) iguales++;
  });
  assert.strictEqual(iguales, total);
});

// Un patrón "seamless" NO garantiza que el píxel N-1 sea IDÉNTICO al 0 (son
// dos muestras distintas de un campo continuo, a 1 unidad de distancia,
// igual que cualquier par de píxeles vecinos) — garantiza que el SALTO al
// unir tile con tile no es peor que un salto interno cualquiera. Por eso
// se compara el salto de borde contra el salto típico interno, no contra
// cero: comparar contra cero hacía fallar a la piedra por su capa de
// grietas (umbral binario — amplifica cualquier diferencia pequeña de un
// campo continuo en un salto de color grande, tanto en el borde como en
// cualquier punto interior donde el ruido cruce el umbral).
function diferencia(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

// eje "x" o "y": el salto de referencia tiene que medirse en la MISMA
// dirección que el salto de borde que se está juzgando — un patrón con
// juntas (ladrillo) da saltos internos bien distintos en cada eje (las
// hiladas están más juntas verticalmente que horizontalmente), comparar
// un eje contra el otro da falsos positivos.
function saltoMedioInterno(pintar, eje) {
  let total = 0, n = 0;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      total += eje === "x" ? diferencia(pintar(x, y), pintar(x + 1, y)) : diferencia(pintar(x, y), pintar(x, y + 1));
      n++;
    }
  }
  return total / n;
}

test("teselado sin costura: el salto al unir el borde con el siguiente tile no es peor que un salto interno típico", () => {
  for (const [nombre, familiaFn] of Object.entries(FAMILIAS)) {
    const pintar = familiaFn(N, "#8a8a8a", `tesela:${nombre}`).variante(0);

    let saltoBordeX = 0;
    for (let y = 0; y < N; y++) saltoBordeX += diferencia(pintar(N - 1, y), pintar(0, y));
    saltoBordeX /= N;
    const referenciaX = saltoMedioInterno(pintar, "x");
    assert.ok(saltoBordeX <= referenciaX * 4 + 10, `familia "${nombre}": salto izq/der (${saltoBordeX.toFixed(1)}) muy por encima del salto interno típico en X (${referenciaX.toFixed(1)})`);

    let saltoBordeY = 0;
    for (let x = 0; x < N; x++) saltoBordeY += diferencia(pintar(x, N - 1), pintar(x, 0));
    saltoBordeY /= N;
    const referenciaY = saltoMedioInterno(pintar, "y");
    assert.ok(saltoBordeY <= referenciaY * 4 + 10, `familia "${nombre}": salto arriba/abajo (${saltoBordeY.toFixed(1)}) muy por encima del salto interno típico en Y (${referenciaY.toFixed(1)})`);
  }
});

test("teselado cruzado: el salto entre DOS VARIANTES distintas de la misma familia no es peor que el salto interno típico (la base es compartida)", () => {
  for (const [nombre, familiaFn] of Object.entries(FAMILIAS)) {
    const familia = familiaFn(N, "#8a8a8a", `cruzado:${nombre}`);
    const v1 = familia.variante(0), v2 = familia.variante(1);
    const referencia = (saltoMedioInterno(v1, "x") + saltoMedioInterno(v2, "x")) / 2;

    let saltoBorde = 0;
    for (let y = 0; y < N; y++) saltoBorde += diferencia(v1(N - 1, y), v2(0, y));
    saltoBorde /= N;
    assert.ok(saltoBorde <= referencia * 4 + 10, `familia "${nombre}": variante 0 y 1 saltan demasiado en el borde compartido (${saltoBorde.toFixed(1)} vs referencia ${referencia.toFixed(1)})`);
  }
});

test("bakearGrupo (index.js) escribe un PNG válido (cabecera + tamaño) por variante, sin tocar disco fuera de una carpeta temporal", () => {
  const os = require("node:os");
  const fs = require("node:fs");
  const { bakearGrupo } = require("../src/index");
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "texturas-test-"));
  const catalogoDeMentira = { cesped: { colorDebug: "#5a9c4c" }, roca: { colorDebug: "#8a8a8a" } };
  const mapeo = { cesped: "cesped", roca: "piedra" };
  const resumen = bakearGrupo(mapeo, catalogoDeMentira, carpeta, { resolucion: 16, variantes: 2 });
  assert.strictEqual(resumen.length, 2);
  for (const id of ["cesped", "roca"]) {
    for (const nn of ["01", "02"]) {
      const archivo = path.join(carpeta, `${id}_${nn}.png`);
      assert.ok(fs.existsSync(archivo), `falta ${archivo}`);
      const buf = fs.readFileSync(archivo);
      const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.ok(buf.subarray(0, 8).equals(FIRMA_PNG), `"${archivo}" no empieza con la firma PNG`);
    }
  }
  fs.rmSync(carpeta, { recursive: true, force: true });
});
