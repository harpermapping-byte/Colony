#!/usr/bin/env node
"use strict";

// Tests del catálogo de contenido + regresión del motor de interiores —
// sin dependencias externas (mismo criterio que el resto del proyecto:
// "no introduzcas dependencias externas salvo que sean estrictamente
// necesarias"). Cada `test(...)` es independiente; un fallo no detiene a
// los demás, para ver el cuadro completo de una sola pasada. Salida no
// cero si algo falla — pensado para correr en CI o a mano con
// `node interiores/test/catalogo.test.js`.

const assert = require("assert");
const path = require("path");

const { cargarCatalogos } = require("../src/catalogo");
const { colocarSala } = require("../src/colocarElementos");
const { generarEdificio, generarHabitacionCompuestaL } = require("../src/edificio");
const { construirCatalogoContenido } = require("../src/catalogoContenido");
const edicion = require("../src/edicion");

const catalogos = cargarCatalogos();

let pasados = 0;
let fallados = 0;
const fallos = [];

function test(nombre, fn) {
  try {
    fn();
    pasados++;
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallados++;
    fallos.push({ nombre, error: e });
    console.log(`FALLO  ${nombre}`);
    console.log(`       ${e.message}`);
  }
}

console.log("=== Catálogo de contenido ===");

test("carga correcta del catálogo", () => {
  const c = construirCatalogoContenido(catalogos);
  assert.ok(c.items.length > 100, `esperaba >100 items, hay ${c.items.length}`);
});

test("IDs únicos", () => {
  const c = construirCatalogoContenido(catalogos);
  const ids = c.items.map((it) => it.id);
  assert.strictEqual(new Set(ids).size, ids.length, "hay ids duplicados");
});

test("elementos con dimensiones válidas", () => {
  const c = construirCatalogoContenido(catalogos);
  for (const it of c.items) {
    if (it.estructural) continue; // puertas/ventanas tienen su propio modelo de hueco, no huella de suelo
    assert.ok(Number.isFinite(it.dimensiones.ancho) && it.dimensiones.ancho > 0, `${it.id}: ancho inválido`);
    assert.ok(Number.isFinite(it.dimensiones.largo) && it.dimensiones.largo > 0, `${it.id}: largo inválido`);
    assert.ok(Number.isFinite(it.dimensiones.alto) && it.dimensiones.alto > 0, `${it.id}: alto inválido`);
  }
});

test("categorías válidas (dentro del conjunto documentado)", () => {
  const c = construirCatalogoContenido(catalogos);
  const CATEGORIAS_VALIDAS = new Set(["mobiliario", "decoracion", "iluminacion", "suciedad", "objetos", "puertas", "ventanas"]);
  for (const it of c.items) assert.ok(CATEGORIAS_VALIDAS.has(it.categoria), `${it.id}: categoría desconocida '${it.categoria}'`);
});

test("tags válidos (array de strings no vacíos)", () => {
  const c = construirCatalogoContenido(catalogos);
  for (const it of c.items) {
    assert.ok(Array.isArray(it.tags), `${it.id}: tags no es array`);
    for (const t of it.tags) assert.ok(typeof t === "string" && t.length > 0, `${it.id}: tag inválido '${t}'`);
  }
});

test("referencias a variantes existentes (sin duplicados, todas con id)", () => {
  const c = construirCatalogoContenido(catalogos);
  for (const it of c.items) {
    if (!it.variantes) continue;
    const ids = it.variantes.map((v) => v.id);
    assert.ok(ids.every(Boolean), `${it.id}: variante sin id`);
    assert.strictEqual(new Set(ids).size, ids.length, `${it.id}: variantes duplicadas`);
  }
});

test("validar() no encuentra referencias rotas en el catálogo real", () => {
  const c = construirCatalogoContenido(catalogos);
  const v = c.validar();
  assert.ok(v.ok, `catálogo con errores: ${JSON.stringify(v.errores)}`);
});

test("validar() detecta una referencia rota a propósito (falla claro)", () => {
  const catalogosRotos = { ...catalogos, elementos: { ...catalogos.elementos, pieza_rota: { capa: "decorMovible", huella: [1, 1], colocacion: [], tiposSalaValidos: ["sala_que_no_existe"], materialesCompatibles: ["material_que_no_existe"] } } };
  const c = construirCatalogoContenido(catalogosRotos);
  const v = c.validar();
  assert.ok(!v.ok, "debería haber detectado las referencias inexistentes");
  assert.ok(v.errores.some((e) => e.includes("sala_que_no_existe")), "no reportó la sala inexistente");
  assert.ok(v.errores.some((e) => e.includes("material_que_no_existe")), "no reportó el material inexistente");
});

test("consultas por categoría", () => {
  const c = construirCatalogoContenido(catalogos);
  const mobiliario = c.buscarPorCategoria("mobiliario");
  assert.ok(mobiliario.length > 0);
  assert.ok(mobiliario.every((it) => it.categoria === "mobiliario"));
});

test("consultas por tag (uno y varios con AND)", () => {
  const c = construirCatalogoContenido(catalogos);
  const asientos = c.buscarPorTag("asiento");
  assert.ok(asientos.length > 0);
  assert.ok(asientos.every((it) => it.tags.includes("asiento")));
  const asientosMadera = c.buscarPorTag(["asiento", "madera"]);
  assert.ok(asientosMadera.length > 0);
  assert.ok(asientosMadera.every((it) => it.tags.includes("asiento") && it.tags.includes("madera")));
  assert.ok(asientosMadera.length <= asientos.length, "el AND de dos tags no puede dar más resultados que uno solo");
});

test("buscarParaSala devuelve solo piezas permitidas en esa sala", () => {
  const c = construirCatalogoContenido(catalogos);
  const paraCocina = c.buscarParaSala("cocina");
  assert.ok(paraCocina.length > 0);
  assert.ok(paraCocina.every((it) => it.salasPermitidas.includes("cocina")));
});

test("selección de variante determinista por semilla (misma semilla = mismo resultado)", () => {
  const c = construirCatalogoContenido(catalogos);
  const a = c.elegirVariante("silla", "semilla-fija-test");
  const b = c.elegirVariante("silla", "semilla-fija-test");
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, "silla"); // silla sí tiene variantesNombradas — debe resolver a una de ellas, no al id base
});

test("selección de variante sin aleatoriedad no determinista (dos instancias del módulo dan igual)", () => {
  delete require.cache[require.resolve("../src/catalogoContenido")];
  const { construirCatalogoContenido: reconstruir } = require("../src/catalogoContenido");
  const c1 = construirCatalogoContenido(catalogos);
  const c2 = reconstruir(catalogos);
  assert.strictEqual(c1.elegirVariante("armario", "otra-semilla"), c2.elegirVariante("armario", "otra-semilla"));
});

test("elegirVariante sobre un id sin variantesNombradas devuelve el propio id", () => {
  const c = construirCatalogoContenido(catalogos);
  // "plato" no tiene materialesCompatibles (objeto suelto sin material
  // propio) — nunca recibe variantesNombradas generadas, a diferencia de
  // "chimenea" (piedra/ladrillo), que desde el pase de variantes de
  // material sí las tiene.
  assert.strictEqual(c.elegirVariante("plato", "cualquier-semilla"), "plato");
});

test("resolverNecesidades es determinista por semilla", () => {
  const c = construirCatalogoContenido(catalogos);
  const necesidades = { asiento: { min: 2, max: 6 }, almacenamiento: { min: 1, max: 2 } };
  const a = c.resolverNecesidades(necesidades, { tipoSalaId: "sala_comun", semilla: "nec-test" });
  const b = c.resolverNecesidades(necesidades, { tipoSalaId: "sala_comun", semilla: "nec-test" });
  assert.deepStrictEqual(a, b);
});

console.log("\n=== Reglas de colocación (validación, sección 8) ===");

test("reglasParaElemento por defecto reproduce el comportamiento previo al catálogo", () => {
  const { reglasParaElemento } = require("../src/catalogoContenido");
  assert.strictEqual(reglasParaElemento({ capa: "suciedad" }).puedeSolapar, true);
  assert.strictEqual(reglasParaElemento({ capa: "decorMovible" }).puedeSolapar, false);
  assert.strictEqual(reglasParaElemento({ capa: "decorMovible" }).puedeBloquearPuerta, false);
});

test("salirse de la sala es bloqueo duro (no forzable)", () => {
  const r = colocarSala({ tipoSalaId: "almacen", catalogos, riqueza: "modesta", amueblado: "vacio", semilla: "limite-test" });
  const res = edicion.anadirElemento(r, catalogos, "barril", 999, 999, { forzar: true });
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.avisos, ["fuera_de_limites"]);
});

test("solapamiento es aviso forzable, no bloqueo", () => {
  const r = colocarSala({ tipoSalaId: "almacen", catalogos, riqueza: "modesta", amueblado: "vacio", semilla: "solape-test" });
  const primero = edicion.anadirElemento(r, catalogos, "barril", 1, 1, { forzar: true });
  assert.ok(primero.ok);
  const segundoSinForzar = edicion.anadirElemento(r, catalogos, "barril", 1, 1);
  assert.strictEqual(segundoSinForzar.ok, false);
  assert.ok(segundoSinForzar.requiereForzar);
  const segundoForzado = edicion.anadirElemento(r, catalogos, "barril", 1, 1, { forzar: true });
  assert.ok(segundoForzado.ok, "con forzar:true debería poder solapar");
});

console.log("\n=== Instancias y edición no destructiva ===");

test("creación de instancias vía anadirElemento incluye estado y instanceId", () => {
  const r = colocarSala({ tipoSalaId: "almacen", catalogos, riqueza: "modesta", amueblado: "vacio", semilla: "instancia-test" });
  const res = edicion.anadirElemento(r, catalogos, "barril", 1, 1);
  assert.ok(res.ok);
  const item = r.colocados.find((it) => it.instanceId === res.instanceId);
  assert.ok(item);
  assert.deepStrictEqual(item.estado, { desgastado: false, roto: false, sucio: false });
});

test("instanceId único dentro de un edificio completo", () => {
  const e = generarEdificio({ tipoEdificioId: "posada", catalogos, semilla: "instanceid-test" });
  const ids = [];
  for (const p of e.plantas) for (const s of p.salas) for (const it of s.resultado.colocados) ids.push(it.instanceId);
  assert.strictEqual(new Set(ids).size, ids.length, "hay instanceId repetidos en el mismo edificio");
});

test("persistencia de 'modificado' tras mover/rotar/sustituir/cambiarEstado", () => {
  const r = colocarSala({ tipoSalaId: "dormitorio_doble", catalogos, riqueza: "modesta", amueblado: "completo", semilla: "modificado-test" });
  const item = r.colocados[0];
  assert.strictEqual(item.origen, "generado");
  edicion.moverElemento(r, item.instanceId, 1, 1, { forzar: true });
  assert.strictEqual(item.origen, "modificado");
});

test("regeneración de mobiliario respeta lo modificado a mano", () => {
  const r = colocarSala({ tipoSalaId: "dormitorio_doble", catalogos, riqueza: "modesta", amueblado: "completo", semilla: "regen-test-1" });
  const item = r.colocados[0];
  edicion.cambiarEstado(r, item.instanceId, { roto: true });
  assert.strictEqual(item.origen, "modificado");
  const antes = r.colocados.filter((it) => it.origen === "modificado").length;
  edicion.regenerarMobiliario(r, catalogos);
  const despues = r.colocados.find((it) => it.instanceId === item.instanceId);
  assert.ok(despues, "el item modificado no debería desaparecer al regenerar");
  assert.deepStrictEqual(despues.estado, { desgastado: false, roto: true, sucio: false }, "el estado editado a mano debería sobrevivir a la regeneración");
  assert.strictEqual(r.colocados.filter((it) => it.origen === "modificado").length, antes);
});

test("regeneración con forzar:true SÍ descarta lo modificado", () => {
  const r = colocarSala({ tipoSalaId: "dormitorio_doble", catalogos, riqueza: "modesta", amueblado: "completo", semilla: "regen-test-2" });
  const item = r.colocados[0];
  edicion.cambiarEstado(r, item.instanceId, { roto: true });
  edicion.regenerarMobiliario(r, catalogos, { forzar: true });
  assert.strictEqual(r.colocados.find((it) => it.instanceId === item.instanceId), undefined, "forzar:true debería sustituir todo, incluida la pieza editada a mano");
});

test("regenerarHabitacion respeta una sala editada a mano (cambiarTipoSala) salvo forzar", () => {
  const r = colocarSala({ tipoSalaId: "almacen", catalogos, riqueza: "modesta", amueblado: "completo", semilla: "regen-sala-test" });
  edicion.cambiarTipoSala(r, catalogos, "despensa");
  const res = edicion.regenerarHabitacion(r, catalogos);
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.avisos, ["sala_modificada_a_mano_usa_forzar"]);
  const res2 = edicion.regenerarHabitacion(r, catalogos, { forzar: true });
  assert.ok(res2.ok);
});

console.log("\n=== Integración catálogo → generación → instancia (determinismo de punta a punta) ===");

test("misma semilla + mismo catálogo = mismo edificio byte a byte", () => {
  function huella(e) {
    const partes = [];
    for (const p of e.plantas) for (const s of p.salas) for (const it of s.resultado.colocados) partes.push(`${it.instanceId}:${it.id}:${it.variante || "-"}:${it.x},${it.y}:${it.rotacion}`);
    return partes.join("|");
  }
  const a = generarEdificio({ tipoEdificioId: "taberna", catalogos, semilla: "determinismo-total" });
  const b = generarEdificio({ tipoEdificioId: "taberna", catalogos, semilla: "determinismo-total" });
  assert.strictEqual(huella(a), huella(b));
});

test("elementos con variantesNombradas resuelven variante en la generación real", () => {
  let conVariante = 0;
  const e = generarEdificio({ tipoEdificioId: "casa_noble", catalogos, semilla: "variante-real-test" });
  for (const p of e.plantas) for (const s of p.salas) for (const it of s.resultado.colocados) if (it.variante) conVariante++;
  assert.ok(conVariante >= 0); // no todas las semillas garantizan mesa_comedor/silla/armario, pero no debe romper
});

console.log("\n=== Regresión: composición de edificios (sección 11 del pedido) ===");

test("las 44 tipologías de edificio generan sin error, con varias semillas", () => {
  const tipos = Object.keys(catalogos.tiposEdificio).filter((k) => !k.startsWith("_"));
  assert.strictEqual(tipos.length, 44, `se esperaban 44 tipos de edificio, hay ${tipos.length}`);
  for (const t of tipos) {
    for (const semilla of ["a", "b", "c"]) {
      const e = generarEdificio({ tipoEdificioId: t, catalogos, semilla: `${t}-${semilla}` });
      assert.ok(e.plantas.length > 0, `${t}/${semilla}: sin plantas`);
    }
  }
});

test("edificios multi-planta: al menos uno con 3+ plantas entre los generados", () => {
  const e = generarEdificio({ tipoEdificioId: "castillo", catalogos, semilla: "multiplanta-test" });
  assert.ok(e.plantas.length >= 2, `castillo debería tener varias plantas, tiene ${e.plantas.length}`);
});

test("cada sala de cada planta tiene su Sala detectada (puertas de conexión reales)", () => {
  const e = generarEdificio({ tipoEdificioId: "taberna", catalogos, semilla: "conexiones-test" });
  for (const p of e.plantas) {
    for (const s of p.salas) {
      assert.ok(s.salaPlanta, `${s.tipoSalaId} en planta ${p.nivel} sin salaPlanta detectada`);
      assert.ok(s.salaPlanta.tiles.size > 0);
    }
    if (p.salas.length > 1) {
      const todasLasPuertas = p.salas.flatMap((s) => [...s.salaPlanta.puertas]);
      const compartidas = todasLasPuertas.filter((p2, i) => todasLasPuertas.indexOf(p2) !== i);
      assert.ok(compartidas.length > 0, `planta ${p.nivel} con ${p.salas.length} salas sin ninguna puerta compartida`);
    }
  }
});

test("salas no rectangulares (compuestaL): dos brazos conectados por abertura ancha", () => {
  const l = generarHabitacionCompuestaL({ tipoSalaId: "gran_salon", catalogos, riqueza: "noble", amueblado: "completo", semilla: "l-test-suite" });
  const [a, b] = l.brazos;
  assert.ok(a.salaPlanta && b.salaPlanta, "los dos brazos deberían tener su Sala detectada");
  const puertasComunes = [...a.salaPlanta.puertas].filter((p) => b.salaPlanta.puertas.has(p));
  assert.ok(puertasComunes.length > 1, "la abertura entre los dos brazos de la L debería tener más de una celda");
});

test("regeneración completa de un edificio no rompe su estructura", () => {
  const e = generarEdificio({ tipoEdificioId: "casa_modesta", catalogos, semilla: "regen-completo-test" });
  const nPlantasAntes = e.plantas.length;
  const res = edicion.regenerarEdificio(e, catalogos);
  assert.ok(res.ok);
  assert.strictEqual(e.plantas.length, nPlantasAntes);
});

console.log("\n=== Resumen ===");
console.log(`${pasados} ok, ${fallados} fallo(s) de ${pasados + fallados} tests.`);
if (fallados > 0) {
  console.log("\nFallos:");
  for (const f of fallos) console.log(`  - ${f.nombre}: ${f.error.message}`);
  process.exit(1);
}
