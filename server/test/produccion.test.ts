// Tests de la lógica PURA de producción pasiva (server/src/construccion/produccion.ts).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { resolverProduccion, resolverTransporte, DatosProduccion } from "../src/construccion/produccion";

const COLMENA: DatosProduccion = { itemId: "miel", cantidadPorIntervalo: 1, intervaloHoras: 4, capacidadMax: 10 };

test("resolverProduccion: sin trabajador requerido, acumula con el tiempo", () => {
  const inicio = { stock: 0, ultimoCalculo: 0 };
  const tras2h = resolverProduccion(inicio, COLMENA, 2 * 3_600_000);
  assert.strictEqual(tras2h.stock, 0.5); // 2h de 4h = medio intervalo = 0.5 unidades
  assert.strictEqual(tras2h.ultimoCalculo, 2 * 3_600_000);
});

test("resolverProduccion: nunca supera capacidadMax", () => {
  const inicio = { stock: 0, ultimoCalculo: 0 };
  const trasMuchoTiempo = resolverProduccion(inicio, COLMENA, 1000 * 3_600_000); // 1000h, de sobra
  assert.strictEqual(trasMuchoTiempo.stock, 10);
});

test("resolverProduccion: llamadas sucesivas acumulan correctamente (no se pierde nada entre resoluciones)", () => {
  let estado = { stock: 0, ultimoCalculo: 0 };
  estado = resolverProduccion(estado, COLMENA, 1 * 3_600_000);
  estado = resolverProduccion(estado, COLMENA, 2 * 3_600_000);
  estado = resolverProduccion(estado, COLMENA, 4 * 3_600_000);
  assert.strictEqual(estado.stock, 1); // 4h totales / 4h por intervalo = 1 unidad completa
});

test("resolverProduccion: requiereTrabajador sin trabajador asignado congela el reloj (sin deuda retroactiva)", () => {
  const conTrabajador: DatosProduccion = { ...COLMENA, itemId: "madera_dura", requiereTrabajador: true };
  const inicio = { stock: 0, ultimoCalculo: 0, trabajadorAsignado: false };
  const tras10h = resolverProduccion(inicio, conTrabajador, 10 * 3_600_000);
  assert.strictEqual(tras10h.stock, 0, "sin trabajador no produce nada");
  assert.strictEqual(tras10h.ultimoCalculo, 10 * 3_600_000, "el reloj avanza igual, para no acumular deuda cuando se active");

  // ahora se asigna trabajador — el reloj sigue desde AHORA, no desde el inicio
  const conTrabajadorActivo = { ...tras10h, trabajadorAsignado: true };
  const tras2hMas = resolverProduccion(conTrabajadorActivo, conTrabajador, 12 * 3_600_000);
  assert.ok(tras2hMas.stock > 0, "con trabajador activo, produce");
  assert.strictEqual(tras2hMas.stock, (2 / conTrabajador.intervaloHoras) * conTrabajador.cantidadPorIntervalo);
});

test("resolverTransporte: sin tiempo suficiente para un viaje completo, no transporta nada", () => {
  const datos = { duracionViajeSeg: 60, cargaPorViaje: 10 };
  const r = resolverTransporte(0, 30_000, datos, 100, 100); // solo 30s, hace falta 60s
  assert.strictEqual(r.transportado, 0);
  assert.strictEqual(r.nuevoUltimoResuelto, 0, "el reloj NO avanza si no hubo ni un viaje completo");
});

test("resolverTransporte: transporta en múltiplos de cargaPorViaje según viajes completos", () => {
  const datos = { duracionViajeSeg: 60, cargaPorViaje: 10 };
  const r = resolverTransporte(0, 150_000, datos, 1000, 1000); // 150s = 2 viajes completos (120s), 30s sobrantes no cuentan
  assert.strictEqual(r.transportado, 20);
  assert.strictEqual(r.nuevoUltimoResuelto, 120_000, "el reloj avanza EXACTAMENTE 2*60s, los 30s sobrantes se conservan para la próxima resolución");
});

test("resolverTransporte: capado por el stock disponible en origen", () => {
  const datos = { duracionViajeSeg: 60, cargaPorViaje: 10 };
  const r = resolverTransporte(0, 300_000, datos, 5, 1000); // 5 viajes posibles (50 unidades) pero origen solo tiene 5
  assert.strictEqual(r.transportado, 5);
});

test("resolverTransporte: capado por el hueco disponible en destino", () => {
  const datos = { duracionViajeSeg: 60, cargaPorViaje: 10 };
  const r = resolverTransporte(0, 300_000, datos, 1000, 3); // destino solo tiene hueco para 3
  assert.strictEqual(r.transportado, 3);
});

test("resolverTransporte: llamadas sucesivas no pierden tiempo transcurrido (reloj continuo, no se resetea a 'ahora')", () => {
  const datos = { duracionViajeSeg: 60, cargaPorViaje: 10 };
  const r1 = resolverTransporte(0, 90_000, datos, 1000, 1000); // 1 viaje completo, 30s sobrantes
  assert.strictEqual(r1.transportado, 10);
  assert.strictEqual(r1.nuevoUltimoResuelto, 60_000);
  const r2 = resolverTransporte(r1.nuevoUltimoResuelto, 120_000, datos, 1000, 1000); // otros 60s desde el reloj avanzado = 1 viaje más
  assert.strictEqual(r2.transportado, 10);
  assert.strictEqual(r2.nuevoUltimoResuelto, 120_000);
});
