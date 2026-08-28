// Tests de la capa de persistencia (AlmacenDatos) — GDD_Construccion §2.
// Ejecutar: npm test (tsx --test) desde server/. Usan ":memory:" salvo el de
// idempotencia de migraciones, que necesita un archivo real para reabrirlo.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AlmacenDatos } from "../src/datos/bd";

test("obtenerOCrearJugador es idempotente: mismo nombre = mismo id", () => {
  const bd = new AlmacenDatos(":memory:");
  const a = bd.obtenerOCrearJugador("Ragnar");
  const b = bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(a.nombre, "Ragnar");
  // Un nombre distinto sí crea otro jugador
  const c = bd.obtenerOCrearJugador("Lagertha");
  assert.notStrictEqual(c.id, a.id);
  bd.cerrar();
});

test("asignar/revocar propiedad: dueño por nombre, revocar deja la fila con dueno=null", () => {
  const bd = new AlmacenDatos(":memory:");
  // Asignar crea al jugador si no existe (mismo camino que "parcela:asignar")
  bd.asignarPropiedad("p_0001", "parcela", "ciudad", "Bjorn");
  let props = bd.cargarPropiedades();
  assert.deepStrictEqual(props.get("p_0001"), {
    tipo: "parcela",
    asentamiento: "ciudad",
    dueno: "Bjorn",
  });

  // Reasignar (upsert sobre la misma id) cambia el dueño sin duplicar fila
  bd.asignarPropiedad("p_0001", "parcela", "ciudad", "Floki");
  props = bd.cargarPropiedades();
  assert.strictEqual(props.size, 1);
  assert.strictEqual(props.get("p_0001")!.dueno, "Floki");

  // Revocar: la fila QUEDA (decisión v1 del GDD) pero sin dueño
  bd.revocarPropiedad("p_0001");
  props = bd.cargarPropiedades();
  assert.deepStrictEqual(props.get("p_0001"), {
    tipo: "parcela",
    asentamiento: "ciudad",
    dueno: null,
  });

  // Asignar directamente sin dueño también es válido (parcela del jarl/asentamiento)
  bd.asignarPropiedad("p_0002", "parcela", "aldea_norte", null);
  assert.strictEqual(bd.cargarPropiedades().get("p_0002")!.dueno, null);
  bd.cerrar();
});

test("construcciones: insertar/listar/borrar con roundtrip del JSON de extra", () => {
  const bd = new AlmacenDatos(":memory:");
  bd.asignarPropiedad("p_0001", "parcela", "ciudad", "Bjorn");

  const extra = { interior: { semilla: "construccion|p_0001|10_20", plantas: 2 } };
  const idEdificio = bd.insertarConstruccion({
    propiedad: "p_0001",
    objeto: "casa_pequena",
    categoria: "edificio",
    x: 10,
    y: 20,
    rot: 1,
    variante: 0,
    extra,
  });
  const idMueble = bd.insertarConstruccion({
    propiedad: "p_0001",
    objeto: "mesa_madera",
    categoria: "mueble",
    x: 12,
    y: 21,
    rot: 3,
    variante: 2,
    extra: null,
  });
  assert.notStrictEqual(idEdificio, idMueble);

  const lista = bd.listarConstrucciones();
  assert.strictEqual(lista.length, 2);
  const edificio = lista.find((c) => c.id === idEdificio)!;
  // extra vuelve parseado a objeto, idéntico al que entró (roundtrip JSON)
  assert.deepStrictEqual(edificio.extra, extra);
  assert.deepStrictEqual(
    { ...edificio, extra: undefined },
    {
      id: idEdificio,
      propiedad: "p_0001",
      objeto: "casa_pequena",
      categoria: "edificio",
      x: 10,
      y: 20,
      rot: 1,
      variante: 0,
      extra: undefined,
    }
  );
  assert.strictEqual(lista.find((c) => c.id === idMueble)!.extra, null);

  // Borrar: true la primera vez, false si ya no existe
  assert.strictEqual(bd.borrarConstruccion(idMueble), true);
  assert.strictEqual(bd.borrarConstruccion(idMueble), false);
  assert.strictEqual(bd.listarConstrucciones().length, 1);
  bd.cerrar();
});

test("migraciones idempotentes: abrir dos veces el mismo archivo conserva los datos", () => {
  // ":memory:" crearía dos BD distintas; para probar la re-apertura real hace falta archivo.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-bd-"));
  const ruta = path.join(dir, "datos.sqlite");
  try {
    const bd1 = new AlmacenDatos(ruta);
    bd1.obtenerOCrearJugador("Ragnar");
    bd1.asignarPropiedad("p_0001", "parcela", "ciudad", "Ragnar");
    bd1.cerrar();

    // Segunda apertura: las CREATE ... IF NOT EXISTS no deben fallar ni vaciar nada
    const bd2 = new AlmacenDatos(ruta);
    assert.strictEqual(bd2.cargarPropiedades().get("p_0001")!.dueno, "Ragnar");
    // Y el jugador sigue siendo el mismo (no se recreó)
    const j = bd2.obtenerOCrearJugador("Ragnar");
    assert.strictEqual(j.id, 1);
    bd2.cerrar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
