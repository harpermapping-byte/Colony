// Tests de mundo/capital.ts (docs/GDD_Ciudad_Capital.md, pedido 2026-08-31).
// Mismo patrón que pvp.test.ts: un único valor en memoria por proceso —
// cada test lo deja en un valor conocido con _fijarNombreCapitalParaTests.
import { test } from "node:test";
import * as assert from "node:assert";
import { nombreCapitalOverride, cargarNombreCapitalDesdeBd, fijarNombreCapital, _fijarNombreCapitalParaTests } from "../src/mundo/capital";
import { IAlmacenDatos } from "../src/datos/bd";

function bdFalsa(valorGuardado: string | null): IAlmacenDatos & { guardado: string | null } {
  const estado = { guardado: valorGuardado };
  return {
    obtenerConfigMundo: async () => estado.guardado,
    fijarConfigMundo: async (_clave: string, valor: string) => {
      estado.guardado = valor;
    },
    get guardado() {
      return estado.guardado;
    },
  } as unknown as IAlmacenDatos & { guardado: string | null };
}

test("nombreCapitalOverride: arranca vacío (sin renombrar) antes de cargar de BD", () => {
  _fijarNombreCapitalParaTests("");
  assert.strictEqual(nombreCapitalOverride(), "");
});

test("cargarNombreCapitalDesdeBd: sin valor guardado, queda vacío", async () => {
  _fijarNombreCapitalParaTests("Lo Que Fuera"); // fuerzo lo contrario para probar que SÍ lo cambia
  const bd = bdFalsa(null);
  await cargarNombreCapitalDesdeBd(bd);
  assert.strictEqual(nombreCapitalOverride(), "");
});

test("cargarNombreCapitalDesdeBd: con nombre guardado, lo recupera", async () => {
  _fijarNombreCapitalParaTests("");
  const bd = bdFalsa("Puerto Cuervo");
  await cargarNombreCapitalDesdeBd(bd);
  assert.strictEqual(nombreCapitalOverride(), "Puerto Cuervo");
});

test("fijarNombreCapital: actualiza memoria y persiste en BD", async () => {
  _fijarNombreCapitalParaTests("");
  const bd = bdFalsa(null);
  await fijarNombreCapital(bd, "Piedraluna");
  assert.strictEqual(nombreCapitalOverride(), "Piedraluna");
  assert.strictEqual(bd.guardado, "Piedraluna");
});

test("fijarNombreCapital: vacío vuelve al nombre baked (borra el override)", async () => {
  _fijarNombreCapitalParaTests("Piedraluna");
  const bd = bdFalsa("Piedraluna");
  await fijarNombreCapital(bd, "");
  assert.strictEqual(nombreCapitalOverride(), "");
  assert.strictEqual(bd.guardado, "");
});

_fijarNombreCapitalParaTests(""); // deja el módulo en el valor por defecto para el resto de la suite
