// Crónica de la facción bandida (docs/GDD_Faccion_Bandidos.md §7quinquies,
// pedido 2026-08-30: "que la historia del servidor, nombres de jugadores y
// hazañas se recuerden"). Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { narrarConquista, generarGritoBandido } from "../src/ia/cronicaBandida";
import { IProveedorIA } from "../src/ia/proveedor";

function proveedorFalso(respuesta: string | Error): IProveedorIA {
  return {
    nombre: "falso",
    async generarTexto() {
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
  };
}

test("narrarConquista: sin proveedor de IA, el texto de siempre (mismo comportamiento que antes de §7quinquies)", async () => {
  const texto = await narrarConquista("aldea_1", ["Yasser"], undefined);
  assert.match(texto, /aldea_1.*ha caído/);
});

test("narrarConquista: si la IA falla, cae al texto de siempre en vez de propagar el error", async () => {
  const texto = await narrarConquista("aldea_1", ["Yasser"], proveedorFalso(new Error("sin cuota")));
  assert.match(texto, /aldea_1.*ha caído/);
});

test("narrarConquista: con IA disponible, usa el texto que devuelve (no el de siempre)", async () => {
  const texto = await narrarConquista("aldea_1", ["Yasser"], proveedorFalso("La leyenda de Yasser, azote de aldea_1."));
  assert.strictEqual(texto, "La leyenda de Yasser, azote de aldea_1.");
});

test("narrarConquista: si la IA devuelve vacío, cae al texto de siempre", async () => {
  const texto = await narrarConquista("aldea_1", [], proveedorFalso("   "));
  assert.match(texto, /aldea_1.*ha caído/);
});

test("generarGritoBandido: sin proveedor de IA, silencio (cadena vacía) — nunca finge personalidad sin IA de verdad", async () => {
  const grito = await generarGritoBandido(
    { asentamientoId: "aldea_1", rango: "recluta", nivelEquipo: 1, jugador: "Yasser", historial: [] },
    undefined,
  );
  assert.strictEqual(grito, "");
});

test("generarGritoBandido: si la IA falla, silencio en vez de propagar el error", async () => {
  const grito = await generarGritoBandido(
    { asentamientoId: "aldea_1", rango: "recluta", nivelEquipo: 1, jugador: "Yasser", historial: [] },
    proveedorFalso(new Error("sin cuota")),
  );
  assert.strictEqual(grito, "");
});

test("generarGritoBandido: con IA disponible, devuelve la frase generada", async () => {
  const grito = await generarGritoBandido(
    { asentamientoId: "aldea_1", rango: "recluta", nivelEquipo: 1, jugador: "Yasser", historial: [] },
    proveedorFalso("¡Tú otra vez no!"),
  );
  assert.strictEqual(grito, "¡Tú otra vez no!");
});
