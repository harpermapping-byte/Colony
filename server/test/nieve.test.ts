// Tests del acumulador de nieve PURO (server/src/mundo/nieve.ts, docs/GDD_Clima.md).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { nivelNieve, NIVEL_MAXIMO_NIEVE } from "../src/mundo/nieve";

const DIA_MITAD_VERANO = 135;
const DIA_MITAD_INVIERNO = 315;

test("nivelNieve: determinista", () => {
  assert.strictEqual(nivelNieve(400), nivelNieve(400));
});

test("nivelNieve: siempre 0 en pleno verano (ni ese día ni los 45 anteriores hizo suficiente frío)", () => {
  for (let dia = DIA_MITAD_VERANO; dia < DIA_MITAD_VERANO + 30; dia++) {
    assert.strictEqual(nivelNieve(dia), 0, `nivel de nieve > 0 en pleno verano, día ${dia}`);
  }
});

test("nivelNieve: nunca se sale de [0, NIVEL_MAXIMO_NIEVE]", () => {
  for (let dia = 0; dia < 2000; dia += 7) {
    const n = nivelNieve(dia);
    assert.ok(n >= 0 && n <= NIVEL_MAXIMO_NIEVE, `nivel fuera de rango: día ${dia} = ${n}`);
  }
});

test("nivelNieve: nunca cambia más de 1 entre dos días consecutivos (sube/baja/mantiene, nunca un salto)", () => {
  for (let anio = 0; anio < 6; anio++) {
    let anterior = nivelNieve(270 + anio * 360);
    for (let dia = 271 + anio * 360; dia <= 359 + anio * 360; dia++) {
      const actual = nivelNieve(dia);
      assert.ok(Math.abs(actual - anterior) <= 1, `salto de nivel entre días ${dia - 1} y ${dia}: ${anterior} -> ${actual}`);
      anterior = actual;
    }
  }
});

test("nivelNieve: llega a acumular en algún invierno de varios probados (sube por encima de 0)", () => {
  let maximoVisto = 0;
  for (let anio = 0; anio < 10; anio++) {
    for (let dia = 270 + anio * 360; dia < 360 + anio * 360; dia++) {
      maximoVisto = Math.max(maximoVisto, nivelNieve(dia));
    }
  }
  assert.ok(maximoVisto > 0, "el nivel de nieve nunca subió de 0 en 10 inviernos probados");
});

test("nivelNieve: puede llegar al tope si nieva racha suficiente (con inviernos de sobra probados)", () => {
  let maximoVisto = 0;
  for (let anio = 0; anio < 15; anio++) {
    for (let dia = 270 + anio * 360; dia < 360 + anio * 360; dia++) {
      maximoVisto = Math.max(maximoVisto, nivelNieve(dia));
    }
  }
  assert.strictEqual(maximoVisto, NIVEL_MAXIMO_NIEVE, `esperaba llegar al tope (${NIVEL_MAXIMO_NIEVE}) en 15 inviernos probados, máximo visto ${maximoVisto}`);
});

test("nivelNieve: vuelve a 0 antes de que el invierno siguiente vuelva a acumular (no se acarrea de un invierno a dos inviernos después)", () => {
  // A mitad de verano/otoño temprano el nivel siempre debe haber vuelto a 0 —
  // si no, algo se está acarreando de un invierno a otro de forma indebida.
  for (let anio = 0; anio < 8; anio++) {
    assert.strictEqual(nivelNieve(DIA_MITAD_VERANO + anio * 360), 0);
  }
});
