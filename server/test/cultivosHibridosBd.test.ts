// Tests de la persistencia de híbridos de cultivo (docs/GDD_Agricultura.md
// §4, diseño ya cerrado en Backlog_Mecanicas_Futuras.md "Injertos y cruces
// de cultivos"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos, CultivoHibrido } from "../src/datos/bd";

function hibrido(overrides: Partial<CultivoHibrido> = {}): CultivoHibrido {
  return {
    semillaId: "semilla_hibrida_abc123",
    cosechaId: "fruto_hibrido_abc123",
    nombre: "Híbrido Tomate×Fresa",
    padreA: "semilla_tomate",
    padreB: "semilla_fresa",
    rasgos: { rendimiento: 0.65, calidad: 0.75, resistenciaEnfermedad: 0.35, velocidadCrecimiento: 0.55, necesidadAgua: 0.65, tamanoFruto: 0.45 },
    diasCrecimiento: 6,
    mesesSiembra: [4, 5, 6, 9],
    cosechaRecurrente: true,
    cantidadPorCosecha: 3,
    colorDebug: "#c9506a",
    creadoEn: new Date().toISOString(),
    ...overrides,
  };
}

test("crearCultivoHibrido + listarCultivosHibridos: se guarda y recupera tal cual, rasgos y meses incluidos", async () => {
  const bd = new AlmacenDatos(":memory:");
  const original = hibrido();
  await bd.crearCultivoHibrido(original);
  const lista = await bd.listarCultivosHibridos();
  assert.strictEqual(lista.length, 1);
  assert.deepStrictEqual(lista[0], original);
  await bd.cerrar();
});

test("listarCultivosHibridos: varias especies, todas presentes", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCultivoHibrido(hibrido({ semillaId: "semilla_hibrida_1", cosechaId: "fruto_hibrido_1" }));
  await bd.crearCultivoHibrido(hibrido({ semillaId: "semilla_hibrida_2", cosechaId: "fruto_hibrido_2", nombre: "Híbrido Trigo×Zanahoria", cosechaRecurrente: false }));
  const lista = await bd.listarCultivosHibridos();
  assert.strictEqual(lista.length, 2);
  const segunda = lista.find((c) => c.semillaId === "semilla_hibrida_2");
  assert.strictEqual(segunda?.cosechaRecurrente, false);
  await bd.cerrar();
});

test("renombrarCultivoHibrido: cambia el nombre, todo lo demás igual", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCultivoHibrido(hibrido());
  await bd.renombrarCultivoHibrido("semilla_hibrida_abc123", "Tomatresa Real");
  const lista = await bd.listarCultivosHibridos();
  assert.strictEqual(lista[0].nombre, "Tomatresa Real");
  assert.strictEqual(lista[0].padreA, "semilla_tomate");
  await bd.cerrar();
});

test("renombrarCultivoHibrido: id inexistente es no-op silencioso", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.crearCultivoHibrido(hibrido());
  await bd.renombrarCultivoHibrido("no_existe", "Nombre Nuevo");
  const lista = await bd.listarCultivosHibridos();
  assert.strictEqual(lista[0].nombre, "Híbrido Tomate×Fresa");
  await bd.cerrar();
});
