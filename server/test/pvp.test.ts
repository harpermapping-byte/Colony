// Tests de mundo/pvp.ts (docs/GDD_PvP.md, pedido 2026-08-30). Ejecutar: npm
// test desde server/. El estado es un único valor en memoria por proceso —
// cada test lo deja en un valor conocido con _fijarPvpParaTests para no
// depender del orden de ejecución.
import { test } from "node:test";
import * as assert from "node:assert";
import { pvpGlobalHabilitado, cargarPvpDesdeBd, fijarPvpGlobal, _fijarPvpParaTests } from "../src/mundo/pvp";
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

test("pvpGlobalHabilitado: arranca deshabilitado antes de cargar de BD", () => {
  _fijarPvpParaTests(false);
  assert.strictEqual(pvpGlobalHabilitado(), false);
});

test("cargarPvpDesdeBd: sin valor guardado, queda deshabilitado", async () => {
  _fijarPvpParaTests(true); // fuerzo lo contrario para probar que SÍ lo cambia
  const bd = bdFalsa(null);
  await cargarPvpDesdeBd(bd);
  assert.strictEqual(pvpGlobalHabilitado(), false);
});

test("cargarPvpDesdeBd: con '1' guardado, queda habilitado", async () => {
  _fijarPvpParaTests(false);
  const bd = bdFalsa("1");
  await cargarPvpDesdeBd(bd);
  assert.strictEqual(pvpGlobalHabilitado(), true);
});

test("fijarPvpGlobal: actualiza memoria y persiste en BD", async () => {
  _fijarPvpParaTests(false);
  const bd = bdFalsa(null);
  await fijarPvpGlobal(bd, true);
  assert.strictEqual(pvpGlobalHabilitado(), true);
  assert.strictEqual(bd.guardado, "1");
});

test("fijarPvpGlobal: desactivar persiste '0'", async () => {
  _fijarPvpParaTests(true);
  const bd = bdFalsa("1");
  await fijarPvpGlobal(bd, false);
  assert.strictEqual(pvpGlobalHabilitado(), false);
  assert.strictEqual(bd.guardado, "0");
});

_fijarPvpParaTests(false); // deja el módulo en el valor por defecto para el resto de la suite
