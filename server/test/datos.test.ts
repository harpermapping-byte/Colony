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

test("vida (docs/GDD_Mecanicas.md §5.4): un jugador nuevo nace a 100/100", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(j.vida, 100);
  assert.strictEqual(j.vidaMax, 100);
  await bd.cerrar();
});

test("actualizarVidaJugador: persiste y se lee de vuelta con obtenerOCrearJugador", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ragnar");
  await bd.actualizarVidaJugador(j.id, 42, 120);
  const releido = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(releido.vida, 42);
  assert.strictEqual(releido.vidaMax, 120);
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
    modoTenencia: null,
    precioFarycoins: null,
    periodoHoras: null,
    expiraEn: null,
    impuestoActivo: false,
    impuestoFarycoins: null,
    impuestoPeriodoHoras: null,
    impuestoUltimoCobro: null,
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
    modoTenencia: null,
    precioFarycoins: null,
    periodoHoras: null,
    expiraEn: null,
    impuestoActivo: false,
    impuestoFarycoins: null,
    impuestoPeriodoHoras: null,
    impuestoUltimoCobro: null,
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

// docs/GDD_Faccion_Bandidos.md §7quinquies (pedido 2026-08-30: "que la
// historia del servidor, nombres de jugadores y hazañas se recuerden").
test("memoria del líder: tipo/asentamientoId/jugador viajan tal cual (NULL si no se pasan, mismo comportamiento de siempre)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.registrarMemoriaLider(1, "Fundación de la aldea"); // sin opciones: sigue funcionando igual que antes de §7quinquies
  await bd.registrarMemoriaLider(2, "Yasser mató a un recluta de \"aldea_1\".", { tipo: "tropa_muerta", asentamientoId: "aldea_1", jugador: "Yasser" });

  const [conDatos, sinDatos] = await bd.memoriaLiderReciente(2);
  assert.strictEqual(conDatos.tipo, "tropa_muerta");
  assert.strictEqual(conDatos.asentamientoId, "aldea_1");
  assert.strictEqual(conDatos.jugador, "Yasser");
  assert.strictEqual(sinDatos.tipo, null);
  assert.strictEqual(sinDatos.asentamientoId, null);
  assert.strictEqual(sinDatos.jugador, null);
  await bd.cerrar();
});

test("historialJugadorEnAsentamiento: solo trae los eventos de ESE jugador con ESE asentamiento, más reciente primero", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.registrarMemoriaLider(1, "Yasser mató a un recluta de aldea_1", { tipo: "tropa_muerta", asentamientoId: "aldea_1", jugador: "Yasser" });
  await bd.registrarMemoriaLider(2, "Zoe mató a un recluta de aldea_1", { tipo: "tropa_muerta", asentamientoId: "aldea_1", jugador: "Zoe" }); // otro jugador: no debe salir
  await bd.registrarMemoriaLider(3, "Yasser mató a un recluta de aldea_2", { tipo: "tropa_muerta", asentamientoId: "aldea_2", jugador: "Yasser" }); // otro asentamiento: no debe salir
  await bd.registrarMemoriaLider(4, "Yasser conquistó aldea_1", { tipo: "asentamiento_conquistado", asentamientoId: "aldea_1", jugador: "Yasser" });

  const historial = await bd.historialJugadorEnAsentamiento("aldea_1", "Yasser", 10);
  assert.strictEqual(historial.length, 2);
  assert.strictEqual(historial[0].evento, "Yasser conquistó aldea_1"); // más reciente primero
  assert.strictEqual(historial[1].evento, "Yasser mató a un recluta de aldea_1");

  assert.strictEqual((await bd.historialJugadorEnAsentamiento("aldea_1", "Alguien_que_nunca_estuvo", 10)).length, 0);
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

// Farycoins (pedido 2026-08-29, decisión compartida por los 5 clusters de
// gremios/mercado/propiedades/producción/motriz: saldo numérico en `jugadores`,
// no un ítem de inventario) --------------------------------------------------

test("Farycoins: un jugador nuevo nace con SALDO_INICIAL_JUGADOR (20), obtenerOCrearJugador lo devuelve", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ivar");
  assert.strictEqual(j.farycoins, 20);
  assert.strictEqual(await bd.obtenerFarycoins(j.id), 20);
  await bd.cerrar();
});

test("Farycoins: ajustarFarycoins suma y resta dentro de saldo, devuelve el saldo actualizado", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ivar"); // nace con 20

  const r1 = await bd.ajustarFarycoins(j.id, 100);
  assert.deepStrictEqual(r1, { ok: true, saldo: 120 });

  const r2 = await bd.ajustarFarycoins(j.id, -30);
  assert.deepStrictEqual(r2, { ok: true, saldo: 90 });

  assert.strictEqual(await bd.obtenerFarycoins(j.id), 90);
  await bd.cerrar();
});

test("Farycoins: ajustarFarycoins es TODO O NADA — restar más de lo que hay no toca el saldo", async () => {
  const bd = new AlmacenDatos(":memory:");
  const j = await bd.obtenerOCrearJugador("Ivar"); // nace con 20
  await bd.ajustarFarycoins(j.id, 50); // 70

  const r = await bd.ajustarFarycoins(j.id, -100); // se iría a -30, debe rechazarse entero
  assert.deepStrictEqual(r, { ok: false, saldo: 70 });
  assert.strictEqual(await bd.obtenerFarycoins(j.id), 70, "el saldo no debe haberse movido ni un poco");
  await bd.cerrar();
});

test("Farycoins: dos jugadores distintos no comparten saldo", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearJugador("Ivar"); // nace con 20
  const b = await bd.obtenerOCrearJugador("Ubbe"); // nace con 20
  await bd.ajustarFarycoins(a.id, 200);
  assert.strictEqual(await bd.obtenerFarycoins(a.id), 220);
  assert.strictEqual(await bd.obtenerFarycoins(b.id), 20);
  await bd.cerrar();
});

test("Farycoins: ALTER TABLE añade la columna a un datos.sqlite creado ANTES de este cambio (sin farycoins)", async () => {
  // Simula un dev.sqlite real ya en disco con el esquema viejo (jugadores
  // sin columna farycoins) — el mismo escenario que un despliegue existente
  // en Neon antes de esta migración. Primera vez que bd.ts amplía una tabla
  // ya desplegada en vez de crearla de cero (ver docs/GDD_Construccion.md);
  // este test es la garantía de que el ALTER TABLE manual (PRAGMA table_info
  // + ADD COLUMN) no revienta ni pierde datos ya existentes.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (ruta: string) => { exec(sql: string): void; close(): void } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colony-bd-farycoins-"));
  const ruta = path.join(dir, "datos.sqlite");
  try {
    const crudo = new DatabaseSync(ruta);
    crudo.exec(`
      CREATE TABLE jugadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        creado_en TEXT NOT NULL
      );
      INSERT INTO jugadores (nombre, creado_en) VALUES ('Ragnar', '2020-01-01');
    `);
    crudo.close();

    // Abrir con el AlmacenDatos real debe: (a) no reventar, (b) añadir la
    // columna, (c) conservar la fila ya insertada con farycoins=0 por defecto.
    const bd = new AlmacenDatos(ruta);
    const j = await bd.obtenerOCrearJugador("Ragnar");
    assert.strictEqual(j.id, 1, "la fila preexistente no debe haberse recreado");
    assert.strictEqual(j.farycoins, 0, "columna nueva, DEFAULT 0 aplicado retroactivamente");

    const r = await bd.ajustarFarycoins(j.id, 25);
    assert.deepStrictEqual(r, { ok: true, saldo: 25 });
    await bd.cerrar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Gremios (pedido 2026-08-29) ------------------------------------------------

test("Gremios: crearGremio funda con el líder como único miembro, rol 'lider'", async () => {
  const bd = new AlmacenDatos(":memory:");
  const lider = await bd.obtenerOCrearJugador("Ragnar");
  const r = await bd.crearGremio("Cuervos de Hierro", lider.id, "#c0392b", "emblema_lobo");
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.gremio.nombre, "Cuervos de Hierro");
  assert.strictEqual(r.gremio.liderJugadorId, lider.id);
  assert.strictEqual(r.gremio.saldoBanco, 0);

  const miembros = await bd.listarMiembros(r.gremio.id);
  assert.strictEqual(miembros.length, 1);
  assert.strictEqual(miembros[0].jugadorId, lider.id);
  assert.strictEqual(miembros[0].rol, "lider");
  await bd.cerrar();
});

test("Gremios: crearGremio rechaza nombre duplicado sin dejar basura (nombre_en_uso)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearJugador("Ragnar");
  const b = await bd.obtenerOCrearJugador("Lagertha");
  const primero = await bd.crearGremio("Cuervos de Hierro", a.id, "#c0392b", "emblema_lobo");
  assert.strictEqual(primero.ok, true);

  const segundo = await bd.crearGremio("Cuervos de Hierro", b.id, "#c0392b", "emblema_lobo");
  assert.deepStrictEqual(segundo, { ok: false, motivo: "nombre_en_uso" });

  // Lagertha NO debe haber quedado con ningún gremio a medias
  const gremios = await bd.listarGremios();
  assert.strictEqual(gremios.length, 1, "el intento fallido no debe dejar una fila huérfana");
  await bd.cerrar();
});

test("Gremios: crearGremio rechaza a alguien que YA lidera otro gremio (ya_tienes_gremio) y limpia el gremio a medias", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearJugador("Ragnar");
  await bd.crearGremio("Cuervos de Hierro", a.id, "#c0392b", "emblema_lobo");

  const segundo = await bd.crearGremio("Lobos del Norte", a.id, "#2980b9", "emblema_oso");
  assert.deepStrictEqual(segundo, { ok: false, motivo: "ya_tienes_gremio" });

  // "Lobos del Norte" no debe haber quedado en la tabla (se compensó el insert a medias)
  const gremios = await bd.listarGremios();
  assert.strictEqual(gremios.length, 1);
  assert.strictEqual(gremios[0].nombre, "Cuervos de Hierro");
  await bd.cerrar();
});

test("Gremios: invitación -> agregarMiembro -> eliminarInvitacion, roster crece", async () => {
  const bd = new AlmacenDatos(":memory:");
  const lider = await bd.obtenerOCrearJugador("Ragnar");
  const invitado = await bd.obtenerOCrearJugador("Bjorn");
  const { gremio } = (await bd.crearGremio("Cuervos de Hierro", lider.id, "#c0392b", "emblema_lobo")) as { gremio: { id: number } };

  await bd.crearInvitacion(gremio.id, invitado.id, lider.id);
  const invitacion = await bd.obtenerInvitacion(gremio.id, invitado.id);
  assert.deepStrictEqual(invitacion, { invitadoPorId: lider.id });

  await bd.agregarMiembro(gremio.id, invitado.id, "miembro");
  await bd.eliminarInvitacion(gremio.id, invitado.id);
  assert.strictEqual(await bd.obtenerInvitacion(gremio.id, invitado.id), null, "la invitación se consume al aceptar");

  const miembros = await bd.listarMiembros(gremio.id);
  assert.strictEqual(miembros.length, 2);
  assert.ok(miembros.some((m) => m.jugadorId === invitado.id && m.rol === "miembro"));
  await bd.cerrar();
});

test("Gremios: quitarMiembro (expulsar/abandonar) borra la fila, actualizarGremio cambia color/emblema", async () => {
  const bd = new AlmacenDatos(":memory:");
  const lider = await bd.obtenerOCrearJugador("Ragnar");
  const miembro = await bd.obtenerOCrearJugador("Bjorn");
  const { gremio } = (await bd.crearGremio("Cuervos de Hierro", lider.id, "#c0392b", "emblema_lobo")) as { gremio: { id: number } };
  await bd.agregarMiembro(gremio.id, miembro.id, "miembro");

  await bd.quitarMiembro(gremio.id, miembro.id);
  assert.strictEqual((await bd.listarMiembros(gremio.id)).length, 1, "solo queda el líder");

  await bd.actualizarGremio(gremio.id, { color: "#2980b9", emblemaId: "emblema_oso" });
  const actualizado = await bd.obtenerGremio(gremio.id);
  assert.strictEqual(actualizado?.color, "#2980b9");
  assert.strictEqual(actualizado?.emblemaId, "emblema_oso");
  await bd.cerrar();
});

test("Gremios: ajustarBancoGremio es TODO O NADA (mismo patrón que ajustarFarycoins)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const lider = await bd.obtenerOCrearJugador("Ragnar");
  const { gremio } = (await bd.crearGremio("Cuervos de Hierro", lider.id, "#c0392b", "emblema_lobo")) as { gremio: { id: number } };

  const r1 = await bd.ajustarBancoGremio(gremio.id, 100);
  assert.deepStrictEqual(r1, { ok: true, saldo: 100 });

  const r2 = await bd.ajustarBancoGremio(gremio.id, -150); // se iría a -50
  assert.deepStrictEqual(r2, { ok: false, saldo: 100 }, "rechazado entero, saldo intacto");
  await bd.cerrar();
});

test("Gremios: disolverGremio refunda el banco íntegro al líder y borra gremio+miembros+invitaciones", async () => {
  const bd = new AlmacenDatos(":memory:");
  const lider = await bd.obtenerOCrearJugador("Ragnar");
  const miembro = await bd.obtenerOCrearJugador("Bjorn");
  const invitado = await bd.obtenerOCrearJugador("Floki");
  const { gremio } = (await bd.crearGremio("Cuervos de Hierro", lider.id, "#c0392b", "emblema_lobo")) as { gremio: { id: number } };
  await bd.agregarMiembro(gremio.id, miembro.id, "miembro");
  await bd.crearInvitacion(gremio.id, invitado.id, lider.id);
  await bd.ajustarBancoGremio(gremio.id, 300);

  const saldoAntes = await bd.obtenerFarycoins(lider.id);
  await bd.disolverGremio(gremio.id);
  const saldoDespues = await bd.obtenerFarycoins(lider.id);
  assert.strictEqual(saldoDespues, saldoAntes + 300, "el banco se refunda íntegro al líder");

  assert.strictEqual(await bd.obtenerGremio(gremio.id), null);
  assert.strictEqual((await bd.listarMiembros(gremio.id)).length, 0);
  assert.strictEqual(await bd.obtenerInvitacion(gremio.id, invitado.id), null, "las invitaciones pendientes también se limpian");
  await bd.cerrar();
});

test("Gremios: un jugador no puede pertenecer a dos gremios a la vez (UNIQUE en BD, defensa en profundidad)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const a = await bd.obtenerOCrearJugador("Ragnar");
  const b = await bd.obtenerOCrearJugador("Lagertha");
  await bd.crearGremio("Cuervos de Hierro", a.id, "#c0392b", "emblema_lobo");
  const segundo = await bd.crearGremio("Lobos del Norte", b.id, "#2980b9", "emblema_oso");
  assert.strictEqual(segundo.ok, true);
  if (!segundo.ok) return;

  // agregarMiembro NO debe reventar si el jugador ya está en otro gremio —
  // se traga el error (defensa en profundidad; el chequeo real vive en
  // ContextoGremios antes de llamar aquí) y no añade la fila.
  await bd.agregarMiembro(segundo.gremio.id, a.id, "miembro");
  const miembros = await bd.listarMiembros(segundo.gremio.id);
  assert.strictEqual(miembros.length, 1, "Ragnar NO debe haberse colado en un segundo gremio");
  await bd.cerrar();
});

// --- Propiedades comerciales (docs/GDD_Propiedades.md, pedido 2026-08-29) ---

test("Propiedades: obtenerPropiedad devuelve null para una propiedad nunca tocada (disponible)", async () => {
  const bd = new AlmacenDatos(":memory:");
  assert.strictEqual(await bd.obtenerPropiedad("i_aldea_pastoral_02:casa_humilde_014"), null);
  await bd.cerrar();
});

test("Propiedades: comprarOAlquilar cobra el precio y da la propiedad (compra = expiraEn null)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const comprador = await bd.obtenerOCrearJugador("Ragnar");
  await bd.ajustarFarycoins(comprador.id, 500);

  const r = await bd.comprarOAlquilar({
    id: "i_aldea:casa_humilde_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Ragnar", modo: "compra", precioFarycoins: 200, periodoHoras: null,
  });
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.saldoRestante, 320); // 20 iniciales + 500 - 200
  assert.strictEqual(r.expiraEn, null);

  const prop = await bd.obtenerPropiedad("i_aldea:casa_humilde_01");
  assert.strictEqual(prop?.dueno, "Ragnar");
  assert.strictEqual(prop?.modoTenencia, "compra");
  assert.strictEqual(prop?.precioFarycoins, 200);
  await bd.cerrar();
});

test("Propiedades: comprarOAlquilar sin Farycoins suficientes falla sin tocar nada (todo o nada)", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Bjorn");
  const r = await bd.comprarOAlquilar({
    id: "i_aldea:tienda_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Bjorn", modo: "compra", precioFarycoins: 500, periodoHoras: null,
  });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "no tienes suficientes Farycoins");
  assert.strictEqual(await bd.obtenerFarycoins((await bd.obtenerOCrearJugador("Bjorn")).id), 20, "no se descontó nada (sigue con el saldo inicial)");
  assert.strictEqual(await bd.obtenerPropiedad("i_aldea:tienda_01"), null, "la propiedad sigue libre");
  await bd.cerrar();
});

test("Propiedades: comprarOAlquilar sobre una propiedad YA ocupada reembolsa y falla", async () => {
  const bd = new AlmacenDatos(":memory:");
  const primero = await bd.obtenerOCrearJugador("Ragnar");
  await bd.ajustarFarycoins(primero.id, 1000);
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_humilde_02", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Ragnar", modo: "compra", precioFarycoins: 200, periodoHoras: null,
  });

  const segundo = await bd.obtenerOCrearJugador("Bjorn");
  await bd.ajustarFarycoins(segundo.id, 1000);
  const r = await bd.comprarOAlquilar({
    id: "i_aldea:casa_humilde_02", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Bjorn", modo: "compra", precioFarycoins: 200, periodoHoras: null,
  });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "ya no está disponible");
  assert.strictEqual(await bd.obtenerFarycoins(segundo.id), 1020, "el reembolso deja el saldo intacto (20 iniciales + 1000)");
  assert.strictEqual((await bd.obtenerPropiedad("i_aldea:casa_humilde_02"))?.dueno, "Ragnar", "el primer comprador sigue siendo el dueño");
  await bd.cerrar();
});

test("Propiedades: un alquiler vencido se libera solo (perezoso) al siguiente obtenerPropiedad/comprarOAlquilar", async () => {
  const bd = new AlmacenDatos(":memory:");
  const inquilino = await bd.obtenerOCrearJugador("Floki");
  await bd.ajustarFarycoins(inquilino.id, 1000);
  await bd.comprarOAlquilar({
    id: "h_aldea:taberna_01:0:2", tipo: "habitacion", asentamiento: "aldea",
    jugadorNombre: "Floki", modo: "alquiler", precioFarycoins: 15, periodoHoras: 24,
  });
  let prop = await bd.obtenerPropiedad("h_aldea:taberna_01:0:2");
  assert.strictEqual(prop?.dueno, "Floki");
  assert.ok(prop?.expiraEn);

  // Simula que el alquiler venció: retrocede expira_en a mano (no hay reloj
  // mockeable en esta capa — comprobamos el efecto observable, no el reloj).
  const bdInterna = bd as unknown as { bd: { prepare(sql: string): { run(...p: unknown[]): unknown } } };
  bdInterna.bd.prepare("UPDATE propiedades SET expira_en = ? WHERE id = ?").run(
    new Date(Date.now() - 1000).toISOString(),
    "h_aldea:taberna_01:0:2",
  );

  prop = await bd.obtenerPropiedad("h_aldea:taberna_01:0:2");
  // la fila SIGUE existiendo (igual que una parcela revocada, GDD_Construccion
  // §4) — "disponible" es dueno=null, no ausencia de fila.
  assert.strictEqual(prop?.dueno, null, "vencido = liberado, se ve como disponible de nuevo");
  assert.strictEqual(prop?.modoTenencia, null);

  // Otro jugador ya puede alquilarla
  const nuevoInquilino = await bd.obtenerOCrearJugador("Lagertha");
  await bd.ajustarFarycoins(nuevoInquilino.id, 1000);
  const r = await bd.comprarOAlquilar({
    id: "h_aldea:taberna_01:0:2", tipo: "habitacion", asentamiento: "aldea",
    jugadorNombre: "Lagertha", modo: "alquiler", precioFarycoins: 15, periodoHoras: 24,
  });
  assert.strictEqual(r.ok, true);
  await bd.cerrar();
});

test("Propiedades: renovarTenencia extiende expiraEn (no resetea) y cobra de nuevo; falla si no eres el dueño", async () => {
  const bd = new AlmacenDatos(":memory:");
  const inquilino = await bd.obtenerOCrearJugador("Floki");
  await bd.ajustarFarycoins(inquilino.id, 1000);
  const primero = await bd.comprarOAlquilar({
    id: "h_aldea:taberna_02:0:1", tipo: "habitacion", asentamiento: "aldea",
    jugadorNombre: "Floki", modo: "alquiler", precioFarycoins: 15, periodoHoras: 24,
  });
  assert.strictEqual(primero.ok, true);
  if (!primero.ok) return;

  const r = await bd.renovarTenencia("h_aldea:taberna_02:0:1", "Floki", 24, 15);
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  const expiraOriginal = new Date(primero.expiraEn!).getTime();
  const expiraNueva = new Date(r.expiraEn).getTime();
  assert.strictEqual(expiraNueva - expiraOriginal, 24 * 3600_000, "extiende +24h desde la expiración ANTERIOR, no desde ahora");
  assert.strictEqual(await bd.obtenerFarycoins(inquilino.id), 20 + 1000 - 15 - 15, "cobra el precio de nuevo");

  const intento = await bd.renovarTenencia("h_aldea:taberna_02:0:1", "OtroJugador", 24, 15);
  assert.strictEqual(intento.ok, false);
  if (intento.ok) return;
  assert.strictEqual(intento.motivo, "no eres el dueño de esta propiedad");
  await bd.cerrar();
});

test("Propiedades: revocarPropiedad libera dueño Y tenencia comercial (jarl puede revocar compra o alquiler)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const comprador = await bd.obtenerOCrearJugador("Ragnar");
  await bd.ajustarFarycoins(comprador.id, 1000);
  await bd.comprarOAlquilar({
    id: "i_aldea:casa_noble_01", tipo: "inmueble", asentamiento: "aldea",
    jugadorNombre: "Ragnar", modo: "compra", precioFarycoins: 1000, periodoHoras: null,
  });
  await bd.revocarPropiedad("i_aldea:casa_noble_01");
  const prop = await bd.obtenerPropiedad("i_aldea:casa_noble_01");
  assert.strictEqual(prop?.dueno, null);
  assert.strictEqual(prop?.modoTenencia, null);
  assert.strictEqual(prop?.precioFarycoins, null);
  assert.strictEqual(prop?.expiraEn, null);
  await bd.cerrar();
});

// --- Mercado (docs/GDD_Mercado.md, pedido 2026-08-29) ---

test("Mercado: reponerStockTenderete SUMA a la cantidad existente y actualiza el precio", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.reponerStockTenderete("p_0001", "madera", 10, 5);
  await bd.reponerStockTenderete("p_0001", "madera", 5, 8); // repone más, sube el precio
  const stock = await bd.listarStockTenderete("p_0001");
  assert.deepStrictEqual(stock, [{ itemId: "madera", cantidad: 15, precioFarycoins: 8 }]);
  await bd.cerrar();
});

test("Mercado: fijarPrecioTenderete solo funciona sobre un ítem YA repuesto", async () => {
  const bd = new AlmacenDatos(":memory:");
  const sinReponer = await bd.fijarPrecioTenderete("p_0001", "madera", 3);
  assert.strictEqual(sinReponer, false, "no se puede fijar precio de algo que nunca se repuso");

  await bd.reponerStockTenderete("p_0001", "madera", 10, 5);
  const conReponer = await bd.fijarPrecioTenderete("p_0001", "madera", 3);
  assert.strictEqual(conReponer, true);
  assert.strictEqual((await bd.listarStockTenderete("p_0001"))[0].precioFarycoins, 3);
  await bd.cerrar();
});

test("Mercado: comprarDeTenderete cobra al comprador, decrementa stock, acredita al vendedor", async () => {
  const bd = new AlmacenDatos(":memory:");
  const comprador = await bd.obtenerOCrearJugador("Bjorn");
  await bd.ajustarFarycoins(comprador.id, 100);
  const vendedor = await bd.obtenerOCrearJugador("Ragnar");
  await bd.reponerStockTenderete("p_0001", "madera", 10, 5);

  const r = await bd.comprarDeTenderete({
    tenderoteId: "p_0001", itemId: "madera", cantidad: 3,
    compradorNombre: "Bjorn", duenoNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, true);
  if (!r.ok) return;
  assert.strictEqual(r.precioTotal, 15);
  assert.strictEqual(r.saldoRestante, 105); // 20 iniciales + 100 - 15
  assert.strictEqual(r.cantidadRestante, 7);
  assert.strictEqual(await bd.obtenerFarycoins(comprador.id), 105);
  assert.strictEqual(await bd.obtenerFarycoins(vendedor.id), 35, "el vendedor cobra aunque nunca haya tocado la BD directamente (20 iniciales + 15)");
  await bd.cerrar();
});

test("Mercado: comprarDeTenderete sin Farycoins suficientes falla sin tocar el stock", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Bjorn"); // nace con 20, no le llega para 10x5=50
  await bd.reponerStockTenderete("p_0001", "madera", 10, 5);

  const r = await bd.comprarDeTenderete({
    tenderoteId: "p_0001", itemId: "madera", cantidad: 10,
    compradorNombre: "Bjorn", duenoNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "no tienes suficientes Farycoins");
  assert.strictEqual((await bd.listarStockTenderete("p_0001"))[0].cantidad, 10, "el stock no se tocó");
  await bd.cerrar();
});

test("Mercado: comprarDeTenderete sin stock suficiente reembolsa al comprador (todo o nada)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const comprador = await bd.obtenerOCrearJugador("Bjorn");
  await bd.ajustarFarycoins(comprador.id, 100);
  await bd.reponerStockTenderete("p_0001", "madera", 2, 5);

  const r = await bd.comprarDeTenderete({
    tenderoteId: "p_0001", itemId: "madera", cantidad: 5,
    compradorNombre: "Bjorn", duenoNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "no queda stock suficiente");
  assert.strictEqual(await bd.obtenerFarycoins(comprador.id), 120, "reembolso completo, nada perdido (20 iniciales + 100)");
  assert.strictEqual((await bd.listarStockTenderete("p_0001"))[0].cantidad, 2, "el stock no bajó de 0");
  await bd.cerrar();
});

test("Mercado: comprarDeTenderete sobre un ítem que nunca se puso en venta falla limpio", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.obtenerOCrearJugador("Bjorn");
  const r = await bd.comprarDeTenderete({
    tenderoteId: "p_0001", itemId: "espada_hierro", cantidad: 1,
    compradorNombre: "Bjorn", duenoNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, false);
  if (r.ok) return;
  assert.strictEqual(r.motivo, "ese ítem no está en venta aquí");
  await bd.cerrar();
});

test("Mercado: agotado (cantidad:0) sigue visible, la fila NUNCA se borra", async () => {
  const bd = new AlmacenDatos(":memory:");
  const comprador = await bd.obtenerOCrearJugador("Bjorn");
  await bd.ajustarFarycoins(comprador.id, 100);
  await bd.reponerStockTenderete("p_0001", "madera", 3, 5);
  const r = await bd.comprarDeTenderete({
    tenderoteId: "p_0001", itemId: "madera", cantidad: 3,
    compradorNombre: "Bjorn", duenoNombre: "Ragnar",
  });
  assert.strictEqual(r.ok, true);
  const stock = await bd.listarStockTenderete("p_0001");
  assert.strictEqual(stock.length, 1, "la fila sigue ahí, no desaparece");
  assert.strictEqual(stock[0].cantidad, 0);
  await bd.cerrar();
});

test("Mercado: revocarPropiedad vacía el tenderete de esa propiedad", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.asignarPropiedad("p_0001", "parcela", "hub", "Ragnar");
  await bd.reponerStockTenderete("p_0001", "madera", 10, 5);
  assert.strictEqual((await bd.listarStockTenderete("p_0001")).length, 1);

  await bd.revocarPropiedad("p_0001");
  assert.strictEqual((await bd.listarStockTenderete("p_0001")).length, 0, "revocar la propiedad vacía su tenderete");
  await bd.cerrar();
});

// --- Producción y transporte (docs/GDD_Produccion.md, pedido 2026-08-29) ---

test("Produccion: actualizarExtraConstruccion persiste el JSON de estado sin migración (columna extra ya existente)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const id = await bd.insertarConstruccion({
    propiedad: "p_0001", objeto: "colmena", categoria: "exterior", x: 5, y: 5, rot: 0, variante: 0,
    extra: { produccion: { stock: 0, ultimoCalculo: 0 } },
  });
  await bd.actualizarExtraConstruccion(id, { produccion: { stock: 3.5, ultimoCalculo: 12345 } });
  const construcciones = await bd.listarConstrucciones();
  const viva = construcciones.find((c) => c.id === id);
  assert.deepStrictEqual(viva?.extra, { produccion: { stock: 3.5, ultimoCalculo: 12345 } });
  await bd.cerrar();
});

test("Produccion: sumarStockTenderete SUMA cantidad y NUNCA toca el precio en conflictos (a diferencia de reponerStockTenderete)", async () => {
  const bd = new AlmacenDatos(":memory:");
  // primera vez: usa precioInicial porque la fila no existía
  await bd.sumarStockTenderete("i_aldea:tienda_01", "madera_dura", 10, 7);
  let stock = await bd.listarStockTenderete("i_aldea:tienda_01");
  assert.deepStrictEqual(stock, [{ itemId: "madera_dura", cantidad: 10, precioFarycoins: 7 }]);

  // el dueño cambia el precio a mano
  await bd.fijarPrecioTenderete("i_aldea:tienda_01", "madera_dura", 20);

  // el transporte suma más stock — el precio NO debe volver a 7, debe seguir en 20
  await bd.sumarStockTenderete("i_aldea:tienda_01", "madera_dura", 5, 7);
  stock = await bd.listarStockTenderete("i_aldea:tienda_01");
  assert.deepStrictEqual(stock, [{ itemId: "madera_dura", cantidad: 15, precioFarycoins: 20 }]);
  await bd.cerrar();
});

test("Transporte: crearContratoTransporte + listarContratosTransporte hacen un round-trip completo", async () => {
  const bd = new AlmacenDatos(":memory:");
  const dueno = await bd.obtenerOCrearJugador("Ragnar");
  const origenId = await bd.insertarConstruccion({
    propiedad: "p_0001", objeto: "aserradero", categoria: "edificio", x: 5, y: 5, rot: 0, variante: 0, extra: null,
  });
  const contrato = await bd.crearContratoTransporte({
    origenConstruccionId: origenId, destinoTenderoteId: "p_0002", dueno: dueno.id, itemId: "madera_dura",
    caminoIda: [{ x: 5, y: 5 }, { x: 6, y: 6 }], caminoVuelta: [{ x: 6, y: 6 }, { x: 5, y: 5 }],
    duracionViajeSeg: 30, cargaPorViaje: 10,
  });
  assert.strictEqual(contrato.activo, true);
  assert.ok(contrato.id > 0);

  const activos = await bd.listarContratosTransporte();
  assert.strictEqual(activos.length, 1);
  assert.deepStrictEqual(activos[0].caminoIda, [{ x: 5, y: 5 }, { x: 6, y: 6 }]);
  assert.strictEqual(activos[0].origenConstruccionId, origenId);
  assert.strictEqual(activos[0].destinoTenderoteId, "p_0002");
  await bd.cerrar();
});

test("Transporte: actualizarUltimoViajeContrato persiste el nuevo timestamp", async () => {
  const bd = new AlmacenDatos(":memory:");
  const dueno = await bd.obtenerOCrearJugador("Ragnar");
  const origenId = await bd.insertarConstruccion({
    propiedad: "p_0001", objeto: "aserradero", categoria: "edificio", x: 5, y: 5, rot: 0, variante: 0, extra: null,
  });
  const contrato = await bd.crearContratoTransporte({
    origenConstruccionId: origenId, destinoTenderoteId: "p_0002", dueno: dueno.id, itemId: "madera_dura",
    caminoIda: [], caminoVuelta: [], duracionViajeSeg: 30, cargaPorViaje: 10,
  });
  const nuevoTs = new Date(Date.now() + 60_000).toISOString();
  await bd.actualizarUltimoViajeContrato(contrato.id, nuevoTs);
  const activos = await bd.listarContratosTransporte();
  assert.strictEqual(activos[0].ultimoViajeResuelto, nuevoTs);
  await bd.cerrar();
});

test("Transporte: desactivarContratoTransporte lo saca de listarContratosTransporte (que solo trae activos)", async () => {
  const bd = new AlmacenDatos(":memory:");
  const dueno = await bd.obtenerOCrearJugador("Ragnar");
  const origenId = await bd.insertarConstruccion({
    propiedad: "p_0001", objeto: "aserradero", categoria: "edificio", x: 5, y: 5, rot: 0, variante: 0, extra: null,
  });
  const contrato = await bd.crearContratoTransporte({
    origenConstruccionId: origenId, destinoTenderoteId: "p_0002", dueno: dueno.id, itemId: "madera_dura",
    caminoIda: [], caminoVuelta: [], duracionViajeSeg: 30, cargaPorViaje: 10,
  });
  await bd.desactivarContratoTransporte(contrato.id);
  assert.strictEqual((await bd.listarContratosTransporte()).length, 0);
  await bd.cerrar();
});

// --- docs/GDD_Crafteo.md: consumirStockTenderete + XP de oficio ---

test("consumirStockTenderete: decrementa el insumo guardado en una construcción, compare-and-swap", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.sumarStockTenderete("pt_hub_5_5", "hierro", 10, 0);
  const ok = await bd.consumirStockTenderete("pt_hub_5_5", "hierro", 6);
  assert.strictEqual(ok, true);
  const stock = await bd.listarStockTenderete("pt_hub_5_5");
  assert.strictEqual(stock.find((s) => s.itemId === "hierro")?.cantidad, 4);
  await bd.cerrar();
});

test("consumirStockTenderete: false si no hay suficiente, nunca deja cantidad negativa", async () => {
  const bd = new AlmacenDatos(":memory:");
  await bd.sumarStockTenderete("pt_hub_5_5", "hierro", 3, 0);
  const ok = await bd.consumirStockTenderete("pt_hub_5_5", "hierro", 10);
  assert.strictEqual(ok, false);
  const stock = await bd.listarStockTenderete("pt_hub_5_5");
  assert.strictEqual(stock.find((s) => s.itemId === "hierro")?.cantidad, 3, "el stock no cambia si falla");
  await bd.cerrar();
});

test("consumirStockTenderete: false si el insumo nunca se depositó ahí", async () => {
  const bd = new AlmacenDatos(":memory:");
  const ok = await bd.consumirStockTenderete("pt_hub_5_5", "hierro", 1);
  assert.strictEqual(ok, false);
  await bd.cerrar();
});

test("XP de oficio: obtenerXpOficio empieza en 0 sin fila previa", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  assert.strictEqual(await bd.obtenerXpOficio(jugador.id, "herrero"), 0);
  await bd.cerrar();
});

test("XP de oficio: sumarXpOficio acumula y devuelve el nuevo total", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  const r1 = await bd.sumarXpOficio(jugador.id, "herrero", 50);
  assert.strictEqual(r1, 50);
  const r2 = await bd.sumarXpOficio(jugador.id, "herrero", 30);
  assert.strictEqual(r2, 80);
  assert.strictEqual(await bd.obtenerXpOficio(jugador.id, "herrero"), 80);
  await bd.cerrar();
});

test("XP de oficio: cada oficio lleva su propio contador, independiente entre sí", async () => {
  const bd = new AlmacenDatos(":memory:");
  const jugador = await bd.obtenerOCrearJugador("Ragnar");
  await bd.sumarXpOficio(jugador.id, "herrero", 100);
  await bd.sumarXpOficio(jugador.id, "alfarero", 20);
  assert.strictEqual(await bd.obtenerXpOficio(jugador.id, "herrero"), 100);
  assert.strictEqual(await bd.obtenerXpOficio(jugador.id, "alfarero"), 20);
  await bd.cerrar();
});
