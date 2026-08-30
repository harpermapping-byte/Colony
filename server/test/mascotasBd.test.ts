// Tests de la persistencia de mascotas (docs/GDD_Mascotas.md, pedido
// 2026-08-30: "si se les da de comer unas 5 veces, podrás convertirlo en tu
// mascota"). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { AlmacenDatos } from "../src/datos/bd";

test("crearMascota: nace 'siguiendo', sin propiedad", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const mascota = await bd.crearMascota(jugador.id, "perro");
  assert.strictEqual(mascota.jugadorId, jugador.id);
  assert.strictEqual(mascota.especieId, "perro");
  assert.strictEqual(mascota.ubicacion, "siguiendo");
  assert.strictEqual(mascota.propiedadId, null);
  await bd.cerrar();
});

test("listarMascotas: solo las del jugador pedido", async () => {
  const bd = new AlmacenDatos(":memory:");
  const ragnar = await bd.obtenerOCrearJugador("Ragnar");
  const lagertha = await bd.obtenerOCrearJugador("Lagertha");
  await bd.crearMascota(ragnar.id, "perro");
  await bd.crearMascota(lagertha.id, "gato");
  const deRagnar = await bd.listarMascotas(ragnar.id);
  assert.strictEqual(deRagnar.length, 1);
  assert.strictEqual(deRagnar[0].especieId, "perro");
  await bd.cerrar();
});

test("actualizarUbicacionMascota: cambia a 'propiedad' con su id, y de vuelta a 'siguiendo'", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const mascota = await bd.crearMascota(jugador.id, "gato");

  const ok1 = await bd.actualizarUbicacionMascota(mascota.id, jugador.id, "propiedad", "i_aldea:casa_3");
  assert.strictEqual(ok1, true);
  let filas = await bd.listarMascotas(jugador.id);
  assert.strictEqual(filas[0].ubicacion, "propiedad");
  assert.strictEqual(filas[0].propiedadId, "i_aldea:casa_3");

  const ok2 = await bd.actualizarUbicacionMascota(mascota.id, jugador.id, "siguiendo", null);
  assert.strictEqual(ok2, true);
  filas = await bd.listarMascotas(jugador.id);
  assert.strictEqual(filas[0].ubicacion, "siguiendo");
  assert.strictEqual(filas[0].propiedadId, null);
  await bd.cerrar();
});

test("actualizarUbicacionMascota: false si la mascota es de OTRO jugador (nunca deja tocar lo ajeno)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const ragnar = await bd.obtenerOCrearJugador("Ragnar");
  const lagertha = await bd.obtenerOCrearJugador("Lagertha");
  const mascota = await bd.crearMascota(ragnar.id, "perro");

  const ok = await bd.actualizarUbicacionMascota(mascota.id, lagertha.id, "propiedad", "i_aldea:casa_1");
  assert.strictEqual(ok, false);
  const filas = await bd.listarMascotas(ragnar.id);
  assert.strictEqual(filas[0].ubicacion, "siguiendo", "no se tocó, sigue como estaba");
  await bd.cerrar();
});

test("actualizarUbicacionMascota: false si el id de mascota no existe", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const ok = await bd.actualizarUbicacionMascota(9999, jugador.id, "propiedad", "i_aldea:casa_1");
  assert.strictEqual(ok, false);
  await bd.cerrar();
});

// docs/GDD_Monturas.md (pedido 2026-08-30)
test("crearMascota: nace con montura=false", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const mascota = await bd.crearMascota(jugador.id, "caballo");
  assert.strictEqual(mascota.montura, false);
  await bd.cerrar();
});

test("ponerMonturaMascota: marca montura=true, es permanente al listar de nuevo", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const mascota = await bd.crearMascota(jugador.id, "caballo");
  const ok = await bd.ponerMonturaMascota(mascota.id, jugador.id);
  assert.strictEqual(ok, true);
  const filas = await bd.listarMascotas(jugador.id);
  assert.strictEqual(filas[0].montura, true);
  await bd.cerrar();
});

test("ponerMonturaMascota: false si la mascota es de OTRO jugador (nunca deja tocar lo ajeno)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const ragnar = await bd.obtenerOCrearJugador("Ragnar");
  const lagertha = await bd.obtenerOCrearJugador("Lagertha");
  const mascota = await bd.crearMascota(ragnar.id, "caballo");
  const ok = await bd.ponerMonturaMascota(mascota.id, lagertha.id);
  assert.strictEqual(ok, false);
  const filas = await bd.listarMascotas(ragnar.id);
  assert.strictEqual(filas[0].montura, false, "no se tocó, sigue sin silla");
  await bd.cerrar();
});
