// Tests de la capa de persistencia (AlmacenDatos) — GDD_Construccion §2.
// Ejecutar: npm test (tsx --test) desde server/. Usan ":memory:" salvo el de
// idempotencia de migraciones, que necesita un archivo real para reabrirlo.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AlmacenDatos } from "../src/datos/bd";
import { crearContenedor, agregarItem, cargarCatalogoItems } from "../src/inventario/inventario";

test("obtenerOCrearJugador es idempotente: mismo nombre = mismo id", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearJugador("Ragnar");
  const b = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(a.nombre, "Ragnar");
  // Un nombre distinto sí crea otro jugador
  const c = await bd.obtenerOCrearJugador("Lagertha");
  assert.notStrictEqual(c.id, a.id);
  await bd.cerrar();
});

test("asignar/revocar propiedad: dueño por nombre, revocar deja la fila con dueno=null", async () => {
  const bd = new AlmacenDatos(":memory:");
  // Asignar crea al jugador si no existe (mismo camino que "parcela:asignar")
  await bd.asignarPropiedad("p_0001", "parcela", "ciudad", "Bjorn");
  let props = await bd.cargarPropiedades();
  assert.deepStrictEqual(props.get("p_0001"), {
    tipo: "parcela",
    asentamiento: "ciudad",
    dueno: "Bjorn",
  });

  // Reasignar (upsert sobre la misma id) cambia el dueño sin duplicar fila
  await bd.asignarPropiedad("p_0001", "parcela", "ciudad", "Floki");
  props = await bd.cargarPropiedades();
  assert.strictEqual(props.size, 1);
  assert.strictEqual(props.get("p_0001")!.dueno, "Floki");

  // Revocar: la fila QUEDA (decisión v1 del GDD) pero sin dueño
  await bd.revocarPropiedad("p_0001");
  props = await bd.cargarPropiedades();
  assert.deepStrictEqual(props.get("p_0001"), {
    tipo: "parcela",
    asentamiento: "ciudad",
    dueno: null,
  });

  // Asignar directamente sin dueño también es válido (parcela del jarl/asentamiento)
  await bd.asignarPropiedad("p_0002", "parcela", "aldea_norte", null);
  assert.strictEqual((await bd.cargarPropiedades()).get("p_0002")!.dueno, null);
  await bd.cerrar();
});

test("construcciones: insertar/listar/borrar con roundtrip del JSON de extra", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.asignarPropiedad("p_0001", "parcela", "ciudad", "Bjorn");

  const extra = { interior: { semilla: "construccion|p_0001|10_20", plantas: 2 } };
  const idEdificio = await bd.insertarConstruccion({
    propiedad: "p_0001",
    objeto: "casa_pequena",
    categoria: "edificio",
    x: 10,
    y: 20,
    rot: 1,
    variante: 0,
    extra,
  });
  const idMueble = await bd.insertarConstruccion({
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

  const lista = await bd.listarConstrucciones();
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
  assert.strictEqual(await bd.borrarConstruccion(idMueble), true);
  assert.strictEqual(await bd.borrarConstruccion(idMueble), false);
  assert.strictEqual((await bd.listarConstrucciones()).length, 1);
  await bd.cerrar();
});

test("migraciones idempotentes: abrir dos veces el mismo archivo conserva los datos", async () => {
  // ":memory:" crearía dos BD distintas; para probar la re-apertura real hace falta archivo.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-bd-"));
  const ruta = path.join(dir, "datos.sqlite");
  try {
    const bd1 = new AlmacenDatos(ruta);
    await bd1.obtenerOCrearJugador("Ragnar");
    await bd1.asignarPropiedad("p_0001", "parcela", "ciudad", "Ragnar");
    await bd1.cerrar();

    // Segunda apertura: las CREATE ... IF NOT EXISTS no deben fallar ni vaciar nada
    const bd2 = new AlmacenDatos(ruta);
    assert.strictEqual((await bd2.cargarPropiedades()).get("p_0001")!.dueno, "Ragnar");
    // Y el jugador sigue siendo el mismo (no se recreó)
    const j = await bd2.obtenerOCrearJugador("Ragnar");
    assert.strictEqual(j.id, 1);
    await bd2.cerrar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Facción bandida (docs/GDD_Faccion_Bandidos.md §6, fase 1) -----------------

test("asentamientos: obtenerOCrear es idempotente y guardarAsentamiento persiste los cambios", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearAsentamiento("aldea_bandidos_1");
  assert.strictEqual(a.bando, "bandido");
  assert.strictEqual(a.nivelMuralla, 1);
  assert.strictEqual(a.nivelEquipo, 1);
  assert.strictEqual(a.comida, 0);

  // Idempotente: no crea una segunda fila ni resetea la que ya había
  const otra = await bd.obtenerOCrearAsentamiento("aldea_bandidos_1");
  assert.deepStrictEqual(otra, a);

  await bd.guardarAsentamiento({ ...a, comida: 40, nivelMuralla: 2 });
  const listados = await bd.listarAsentamientos();
  assert.strictEqual(listados.length, 1);
  assert.strictEqual(listados[0].comida, 40);
  assert.strictEqual(listados[0].nivelMuralla, 2);
  await bd.cerrar();
});

test("tropas: crearTropa da ids únicos, marcarTropaMuerta NUNCA revierte (no hay respawn mágico)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearAsentamiento("aldea_bandidos_1");
  const t1 = await bd.crearTropa("aldea_bandidos_1", "recluta");
  const t2 = await bd.crearTropa("aldea_bandidos_1", "guardia");
  assert.notStrictEqual(t1.id, t2.id);

  let tropas = await bd.listarTropas("aldea_bandidos_1");
  assert.strictEqual(tropas.length, 2);
  assert.ok(tropas.every((t) => t.estado === "vivo"));

  await bd.marcarTropaMuerta(t1.id);
  tropas = await bd.listarTropas("aldea_bandidos_1");
  assert.strictEqual(tropas.find((t) => t.id === t1.id)!.estado, "muerto");
  assert.strictEqual(tropas.find((t) => t.id === t2.id)!.estado, "vivo");
  await bd.cerrar();
});

test("memoria del líder: registrarMemoriaLider + memoriaLiderReciente devuelve lo último primero", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.registrarMemoriaLider(1, "Fundación de la aldea");
  await bd.registrarMemoriaLider(3, "Jugadores mataron 5 bandidos en el sector B2");
  await bd.registrarMemoriaLider(5, "Muralla subida a nivel piedra");

  const recientes = await bd.memoriaLiderReciente(2);
  assert.strictEqual(recientes.length, 2);
  assert.strictEqual(recientes[0].evento, "Muralla subida a nivel piedra");
  assert.strictEqual(recientes[1].evento, "Jugadores mataron 5 bandidos en el sector B2");
  await bd.cerrar();
});

// Inventario (pedido 2026-08-29, fase 1) -------------------------------------

test("inventario: guardar/cargar contenedor hace roundtrip exacto (huecos, cantidades, siguienteId)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const catalogo = cargarCatalogoItems();
  const j = await bd.obtenerOCrearJugador("Ragnar");

  const cuerpo = crearContenedor(8, 6);
  agregarItem(cuerpo, catalogo, "hierro", 5);
  agregarItem(cuerpo, catalogo, "hacha_talar", 1);
  await bd.guardarContenedor(j.id, "cuerpo", cuerpo);

  const recuperado = await bd.cargarContenedor(j.id, "cuerpo");
  assert.deepStrictEqual(recuperado, cuerpo);
  await bd.cerrar();
});

test("inventario: cargarContenedor de uno nunca guardado da null (jugador nuevo, no revienta)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Lagertha");
  assert.strictEqual(await bd.cargarContenedor(j.id, "cuerpo"), null);
  await bd.cerrar();
});

test("inventario: guardarContenedor es upsert — sobrescribe sin duplicar fila", async () => {
  const bd = new AlmacenDatos(":memory:");
  const catalogo = cargarCatalogoItems();
  const j = await bd.obtenerOCrearJugador("Bjorn");

  const c1 = crearContenedor(8, 6);
  agregarItem(c1, catalogo, "hierro", 1);
  await bd.guardarContenedor(j.id, "cuerpo", c1);

  const c2 = crearContenedor(8, 6);
  agregarItem(c2, catalogo, "baya", 3);
  await bd.guardarContenedor(j.id, "cuerpo", c2);

  const recuperado = await bd.cargarContenedor(j.id, "cuerpo");
  assert.deepStrictEqual(recuperado, c2, "el último guardado gana, sin restos del primero");
  const todos = await bd.listarContenedores(j.id);
  assert.strictEqual(todos.size, 1, "una sola fila para 'cuerpo', no dos");
  await bd.cerrar();
});

test("inventario: listarContenedores devuelve TODOS los de un jugador (cuerpo + mochila), aislados por jugador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const catalogo = cargarCatalogoItems();
  const j1 = await bd.obtenerOCrearJugador("Floki");
  const j2 = await bd.obtenerOCrearJugador("Astrid");

  const cuerpo = crearContenedor(8, 6);
  agregarItem(cuerpo, catalogo, "hierro", 1);
  const mochila = crearContenedor(4, 4);
  agregarItem(mochila, catalogo, "madera_dura", 2);
  await bd.guardarContenedor(j1.id, "cuerpo", cuerpo);
  await bd.guardarContenedor(j1.id, "mochila_1", mochila);
  await bd.guardarContenedor(j2.id, "cuerpo", crearContenedor(8, 6));

  const deJ1 = await bd.listarContenedores(j1.id);
  assert.strictEqual(deJ1.size, 2);
  assert.deepStrictEqual(deJ1.get("cuerpo"), cuerpo);
  assert.deepStrictEqual(deJ1.get("mochila_1"), mochila);

  const deJ2 = await bd.listarContenedores(j2.id);
  assert.strictEqual(deJ2.size, 1, "el inventario de j1 no se filtra al de j2");
  await bd.cerrar();
});

test("inventario: equipo — guardar/cargar roundtrip, slot vacío (undefined) no se guarda como fila", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ivar");

  await bd.guardarEquipo(j.id, { espalda: "mochila_cuero", manoPrincipal: "hacha_talar", cinturon: undefined });
  const cargado = await bd.cargarEquipo(j.id);
  assert.deepStrictEqual(cargado, { espalda: "mochila_cuero", manoPrincipal: "hacha_talar" });
  await bd.cerrar();
});

test("inventario: guardarEquipo reemplaza el set completo (quitar un ítem lo borra de verdad)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ubbe");

  await bd.guardarEquipo(j.id, { espalda: "mochila_cuero", manoPrincipal: "hacha_talar" });
  await bd.guardarEquipo(j.id, { espalda: "mochila_cuero" }); // se quitó el hacha
  const cargado = await bd.cargarEquipo(j.id);
  assert.deepStrictEqual(cargado, { espalda: "mochila_cuero" });
  await bd.cerrar();
});
