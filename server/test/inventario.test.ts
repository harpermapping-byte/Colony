// Tests de la lógica PURA de inventario (server/src/inventario/inventario.ts).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  cargarCatalogoItems,
  crearContenedor,
  agregarItem,
  quitarItem,
  moverItem,
  hayHueco,
  buscarHueco,
  pesoContenedor,
  excedePesoMaximo,
  puedeEquiparEnSlot,
  equiparItem,
  desequiparItem,
  calcularStatsEquipo,
  pesoTotalJugador,
  buscarInstanciaJugador,
  InventarioJugador,
  CatalogoItems,
  comidaSirveParaDieta,
} from "../src/inventario/inventario";

const catalogo: CatalogoItems = cargarCatalogoItems();

test("cargarCatalogoItems: filtra claves _nota* y trae los ítems reales (fase 1 + arcilla + objetos 'sobreSuperficie' curados de fase 2)", () => {
  const ids = Object.keys(catalogo);
  assert.ok(!ids.some((id) => id.startsWith("_")), "alguna clave _nota* se coló");
  assert.strictEqual(ids.length, 423); // 388 (ver historial) + grasa + 33 cadáveres de caza (docs/GDD_Caza.md, rediseño 2026-08-30) + jarabe_catarro (docs/GDD_Enfermedades.md)
  assert.ok(catalogo["hierro"], "falta un recurso base");
  assert.ok(catalogo["mochila_cuero"], "falta el ítem equipable de ejemplo");
  assert.strictEqual(catalogo["plato"]?.tipo, "objeto", "falta un objeto curado de interior");
});

test("armas (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): cuerpo a cuerpo y a distancia con sus stats de combate", () => {
  const CUERPO_A_CUERPO = ["daga", "espada_corta", "espada_larga", "hacha_combate", "maza_guerra", "lanza"];
  const A_DISTANCIA = ["honda", "arco_corto", "arco_largo", "ballesta"];
  for (const id of [...CUERPO_A_CUERPO, ...A_DISTANCIA]) {
    const e = catalogo[id];
    assert.ok(e, `falta el arma ${id}`);
    assert.strictEqual(e.tipo, "arma");
    assert.strictEqual(e.slotEquipo, "manoPrincipal");
    assert.ok((e.ataqueFisico ?? 0) > 0, `${id}: sin ataqueFisico`);
    assert.ok((e.alcance ?? 0) > 0, `${id}: sin alcance`);
    assert.ok((e.cooldownMs ?? 0) > 0, `${id}: sin cooldownMs`);
    assert.ok((e.durabilidadMax ?? 0) > 0, `${id}: sin durabilidadMax`);
  }
  for (const id of A_DISTANCIA) {
    assert.ok(catalogo[id].municionId, `${id}: arma a distancia sin municionId`);
    assert.ok(catalogo[catalogo[id].municionId!], `${id}: municionId no existe en el catálogo`);
  }
  for (const id of ["piedra_honda", "flecha", "virote_ballesta"]) {
    assert.strictEqual(catalogo[id]?.tipo, "municion", `${id}: falta o tipo incorrecto`);
    assert.strictEqual(catalogo[id].slotEquipo, undefined, `${id}: la munición no se equipa`);
    assert.ok(catalogo[id].apilable, `${id}: la munición debe apilar`);
  }
});

test("herramientas de gate (cuchillo_desollar/cuchillo_cocina) se desgastan con el uso (docs/GDD_Crafteo.md, pedido 2026-08-30)", () => {
  for (const id of ["cuchillo_desollar", "cuchillo_cocina"]) {
    const e = catalogo[id];
    assert.ok(e, `falta ${id}`);
    assert.ok((e.durabilidadMax ?? 0) > 0, `${id}: sin durabilidadMax`);
    assert.ok((e.desgastePorUso ?? 0) > 0, `${id}: sin desgastePorUso`);
  }
});

test("recipientes de líquido (cantimplora/cubo_madera): a más grande, más volumenMaxMl (docs/GDD_Inventario.md §9, pedido 2026-08-30)", () => {
  assert.ok((catalogo["cantimplora"]?.volumenMaxMl ?? 0) > 0, "falta volumenMaxMl en cantimplora");
  assert.ok((catalogo["cubo_madera"]?.volumenMaxMl ?? 0) > (catalogo["cantimplora"]?.volumenMaxMl ?? 0), "el cubo debe caber más que la cantimplora");
});

test("armas cuerpo a cuerpo: alcance corto (1-2), las de distancia llegan mucho más lejos", () => {
  assert.ok(catalogo["daga"].alcance! <= 2);
  assert.ok(catalogo["espada_larga"].alcance! <= 2);
  assert.ok(catalogo["arco_largo"].alcance! > catalogo["daga"].alcance!);
  assert.ok(catalogo["ballesta"].alcance! > catalogo["honda"].alcance!);
});

test("todo ítem del catálogo tiene huella/peso/colorDebug válidos", () => {
  for (const [id, e] of Object.entries(catalogo)) {
    assert.ok(Array.isArray(e.huella) && e.huella.length === 2 && e.huella[0] > 0 && e.huella[1] > 0, `${id}: huella inválida`);
    assert.ok(typeof e.peso === "number" && e.peso > 0, `${id}: peso inválido`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(e.colorDebug), `${id}: colorDebug inválido`);
    if (e.apilable) assert.ok((e.stackMax ?? 0) > 0, `${id}: apilable sin stackMax`);
  }
});

test("agregarItem: apila hasta stackMax antes de abrir una casilla nueva", () => {
  const c = crearContenedor(4, 4);
  const stackMax = catalogo["hierro"].stackMax!;
  const r1 = agregarItem(c, catalogo, "hierro", stackMax - 2);
  assert.ok(r1.ok);
  assert.strictEqual(c.items.length, 1, "primera tanda: una sola pila");

  const r2 = agregarItem(c, catalogo, "hierro", 5); // 2 caben en la pila existente, 3 abren pila nueva
  assert.ok(r2.ok);
  assert.strictEqual(c.items.length, 2, "el sobrante abre una SEGUNDA pila, no una tercera");
  assert.strictEqual(c.items[0].cantidad, stackMax, "la primera pila se llenó del todo");
  assert.strictEqual(c.items[1].cantidad, 3, "el resto cae en la pila nueva");
});

test("agregarItem: sin hueco devuelve ok:false sin perder lo que ya entró", () => {
  const c = crearContenedor(1, 1); // una sola casilla
  const r1 = agregarItem(c, catalogo, "hacha_talar", 1); // huella [1,2] — no cabe en 1x1
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.motivo, "sin_hueco");
  assert.strictEqual(c.items.length, 0);
});

test("agregarItem: ítem desconocido no revienta, devuelve motivo claro", () => {
  const c = crearContenedor(4, 4);
  const r = agregarItem(c, catalogo, "esto_no_existe", 1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "item_desconocido");
});

test("hayHueco: respeta límites de la rejilla y el solapamiento real por huella rotada", () => {
  const c = crearContenedor(3, 2);
  agregarItem(c, catalogo, "hacha_talar", 1); // huella [1,2] normal, cae en (0,0)
  assert.strictEqual(c.items[0].x, 0);
  assert.strictEqual(c.items[0].y, 0);
  // (1,0) libre en la misma huella vertical
  assert.strictEqual(hayHueco(c, catalogo, "antorcha_portatil", 1, 0, 0), true);
  // (0,0) ya ocupado por el hacha (huella 1x2 tapa (0,0) y (0,1))
  assert.strictEqual(hayHueco(c, catalogo, "antorcha_portatil", 0, 0, 0), false);
  assert.strictEqual(hayHueco(c, catalogo, "antorcha_portatil", 0, 1, 0), false);
  // fuera de la rejilla (ancho=3, x=3 se sale)
  assert.strictEqual(hayHueco(c, catalogo, "antorcha_portatil", 3, 0, 0), false);
  // rotar el hacha (rot=1) la deja horizontal 2x1, que en (1,0) SÍ se saldría de una rejilla de alto 2... probamos donde sí cabe
  assert.strictEqual(hayHueco(c, catalogo, "hacha_talar", 1, 0, 1), true); // huella rotada [2,1] en (1,0) -> (1,0)+(2,0), libres
});

test("buscarHueco es determinista: misma rejilla + mismo catálogo = mismo resultado, fila a fila", () => {
  const c = crearContenedor(4, 4);
  agregarItem(c, catalogo, "hierro", 1); // ocupa (0,0)
  const hueco = buscarHueco(c, catalogo, "hierro");
  assert.deepStrictEqual(hueco, { x: 1, y: 0 }, "debe saltar a la siguiente casilla libre en orden de lectura");
});

test("quitarItem: decrementa y borra la instancia al llegar a 0; motivos claros si falla", () => {
  const c = crearContenedor(4, 4);
  agregarItem(c, catalogo, "hierro", 5);
  const id = c.items[0].id;
  assert.strictEqual(quitarItem(c, id, 2).ok, true);
  assert.strictEqual(c.items[0].cantidad, 3);
  assert.strictEqual(quitarItem(c, id, 10).ok, false); // no hay 10
  assert.strictEqual(quitarItem(c, id, 3).ok, true);
  assert.strictEqual(c.items.length, 0, "llegó a 0: la instancia desaparece");
  assert.strictEqual(quitarItem(c, id, 1).motivo, "no_encontrado");
});

test("moverItem: reposicionar dentro del MISMO contenedor no choca consigo mismo", () => {
  const c = crearContenedor(4, 4);
  agregarItem(c, catalogo, "hierro", 1);
  const id = c.items[0].id;
  const r = moverItem(c, c, catalogo, id, 2, 2, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.items[0].x, 2);
  assert.strictEqual(c.items[0].y, 2);
});

test("moverItem: transferir entre DOS contenedores reasigna el id de instancia al destino", () => {
  const cuerpo = crearContenedor(4, 4);
  const mochila = crearContenedor(4, 4);
  agregarItem(cuerpo, catalogo, "hierro", 1);
  const idOrigen = cuerpo.items[0].id;
  const r = moverItem(cuerpo, mochila, catalogo, idOrigen, 0, 0, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(cuerpo.items.length, 0, "ya no está en el origen");
  assert.strictEqual(mochila.items.length, 1, "ahora está en el destino");
  assert.strictEqual(mochila.items[0].itemId, "hierro");
});

test("moverItem: todo o nada — si no cabe en destino, el origen queda intacto", () => {
  const cuerpo = crearContenedor(4, 4);
  const mochilaLlena = crearContenedor(1, 1);
  agregarItem(mochilaLlena, catalogo, "hierro", 1); // llena la única casilla
  agregarItem(cuerpo, catalogo, "hierro", 1);
  const idOrigen = cuerpo.items[0].id;
  const r = moverItem(cuerpo, mochilaLlena, catalogo, idOrigen, 0, 0, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_hueco");
  assert.strictEqual(cuerpo.items.length, 1, "no se borró del origen pese a fallar el destino");
});

test("pesoContenedor: suma peso unitario * cantidad de cada pila, no por casilla", () => {
  const c = crearContenedor(4, 4);
  agregarItem(c, catalogo, "hierro", 3); // peso 3 c/u
  agregarItem(c, catalogo, "baya", 4); // peso 0.15 c/u
  const esperado = Math.round((3 * 3 + 4 * 0.15) * 100) / 100;
  assert.strictEqual(pesoContenedor(c, catalogo), esperado);
});

test("excedePesoMaximo: false con hueco de sobra, true al pasarse del máximo dado", () => {
  const c = crearContenedor(10, 10);
  agregarItem(c, catalogo, "hierro", 3); // 9 kg
  assert.strictEqual(excedePesoMaximo(c, catalogo, "hierro", 1, 20), false, "9+3=12, cabe en 20");
  assert.strictEqual(excedePesoMaximo(c, catalogo, "hierro", 10, 20), true, "9+30=39, no cabe en 20");
});

test("excedePesoMaximo: un ítem desconocido no revienta — lo rechaza intentarCoger, no esto", () => {
  const c = crearContenedor(10, 10);
  assert.strictEqual(excedePesoMaximo(c, catalogo, "no_existe", 1, 20), false);
});

test("puedeEquiparEnSlot: solo el slot declarado por el catálogo vale", () => {
  assert.strictEqual(puedeEquiparEnSlot(catalogo, "mochila_cuero", "espalda"), true);
  assert.strictEqual(puedeEquiparEnSlot(catalogo, "mochila_cuero", "cinturon"), false);
  assert.strictEqual(puedeEquiparEnSlot(catalogo, "hierro", "espalda"), false, "un recurso no es equipable");
});

test("determinismo: mismo catálogo cargado dos veces da el mismo contenido (sin aleatoriedad)", () => {
  const otra = cargarCatalogoItems();
  assert.deepStrictEqual(otra, catalogo);
});

// --- Equipo (docs/GDD_Equipo.md, 2026-08-30) ---

function jugadorVacio(): InventarioJugador {
  return { cuerpo: crearContenedor(8, 6), extras: new Map(), equipo: {} };
}

test("puedeEquiparEnSlot: un anillo vale para CUALQUIERA de las dos manos (GRUPOS_SLOT)", () => {
  assert.strictEqual(puedeEquiparEnSlot(catalogo, "anillo_oro", "anilloIzquierdo"), true);
  assert.strictEqual(puedeEquiparEnSlot(catalogo, "anillo_oro", "anilloDerecho"), true);
  assert.strictEqual(puedeEquiparEnSlot(catalogo, "anillo_oro", "cinturon"), false);
});

test("equiparItem: mueve la instancia del cuerpo al slot y la quita del contenedor", () => {
  const inv = jugadorVacio();
  const { instancia } = agregarItem(inv.cuerpo, catalogo, "casco_hierro", 1);
  const res = equiparItem(inv, catalogo, instancia!.id, "casco");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(inv.equipo["casco"], "casco_hierro");
  assert.strictEqual(inv.cuerpo.items.length, 0, "la pieza equipada ya no debe estar en el cuerpo");
});

test("equiparItem: rechaza un ítem que no declara ese slot", () => {
  const inv = jugadorVacio();
  const { instancia } = agregarItem(inv.cuerpo, catalogo, "hierro", 1);
  const res = equiparItem(inv, catalogo, instancia!.id, "casco");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.motivo, "no_equipable_en_ese_slot");
  assert.strictEqual(inv.cuerpo.items.length, 1, "un intento fallido no debe tocar el cuerpo");
});

test("equiparItem: rechaza un slot ya ocupado (desequipar es un paso explícito aparte)", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "casco_hierro", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "casco");
  const { instancia: segundo } = agregarItem(inv.cuerpo, catalogo, "casco_acero", 1);
  const res = equiparItem(inv, catalogo, segundo!.id, "casco");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.motivo, "slot_ocupado");
});

test("equiparItem con esContenedor: crea una rejilla PROPIA en extras, independiente del cuerpo", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "mochila_cuero", 1);
  const res = equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "espalda");
  assert.strictEqual(res.ok, true);
  const extra = inv.extras.get("espalda");
  assert.ok(extra, "debería existir un Contenedor nuevo para 'espalda'");
  assert.strictEqual(extra!.ancho, catalogo["mochila_cuero"].esContenedor!.ancho);
  assert.strictEqual(extra!.alto, catalogo["mochila_cuero"].esContenedor!.alto);
});

test("3 contenedores SIMULTÁNEOS (espalda+cinturon+bandolera) — cada uno con su propia rejilla independiente", () => {
  const inv = jugadorVacio();
  for (const [itemId, slot] of [["mochila_cuero", "espalda"], ["bolsa_cinturon", "cinturon"], ["bandolera_cuero", "bandolera"]] as const) {
    agregarItem(inv.cuerpo, catalogo, itemId, 1);
    const instancia = inv.cuerpo.items.find((it) => it.itemId === itemId)!;
    const res = equiparItem(inv, catalogo, instancia.id, slot);
    assert.strictEqual(res.ok, true, `equipar ${itemId} en ${slot} debería funcionar`);
  }
  assert.strictEqual(inv.extras.size, 3, "las 3 mochilas/bolsas deben convivir a la vez, cada una con su Contenedor");
  assert.strictEqual(inv.equipo["espalda"], "mochila_cuero");
  assert.strictEqual(inv.equipo["cinturon"], "bolsa_cinturon");
  assert.strictEqual(inv.equipo["bandolera"], "bandolera_cuero");
});

test("desequiparItem: la pieza vuelve al cuerpo, al primer hueco libre", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "casco_hierro", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "casco");
  const res = desequiparItem(inv, catalogo, "casco");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(inv.equipo["casco"], undefined);
  assert.strictEqual(inv.cuerpo.items.length, 1);
  assert.strictEqual(inv.cuerpo.items[0].itemId, "casco_hierro");
});

test("desequiparItem: rechaza un slot vacío", () => {
  const inv = jugadorVacio();
  const res = desequiparItem(inv, catalogo, "casco");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.motivo, "slot_vacio");
});

test("desequiparItem: rechaza una mochila que TODAVÍA tiene cosas dentro", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "mochila_cuero", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "espalda");
  agregarItem(inv.extras.get("espalda")!, catalogo, "hierro", 1);
  const res = desequiparItem(inv, catalogo, "espalda");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.motivo, "contenedor_no_vacio");
  assert.ok(inv.extras.has("espalda"), "la mochila NO debe desaparecer si el rechazo es por no estar vacía");
});

test("desequiparItem: una mochila VACÍA sí se puede quitar, y su Contenedor extra se borra", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "mochila_cuero", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "espalda");
  const res = desequiparItem(inv, catalogo, "espalda");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(inv.extras.has("espalda"), false);
});

test("desequiparItem: rechaza sin destruir nada si el cuerpo no tiene hueco libre", () => {
  const inv: InventarioJugador = { cuerpo: crearContenedor(1, 1), extras: new Map(), equipo: {} };
  // la única casilla del cuerpo ya está ocupada por otra cosa
  agregarItem(inv.cuerpo, catalogo, "hierro", 1);
  inv.equipo["casco"] = "casco_hierro"; // equipado "a mano" para el test, sin pasar por equiparItem
  const res = desequiparItem(inv, catalogo, "casco");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.motivo, "sin_hueco");
  assert.strictEqual(inv.equipo["casco"], "casco_hierro", "no debe desequiparse si no cabe de vuelta");
});

test("desequiparItem: con pesoMaximo, rechaza si al volver al cuerpo se pasaría del límite (pero SÍ permite si no se pasa)", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "pechera_placas_acero", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "pechera");
  const pesoPechera = catalogo["pechera_placas_acero"].peso;
  const rechazo = desequiparItem(inv, catalogo, "pechera", pesoPechera - 0.1);
  assert.strictEqual(rechazo.ok, false);
  assert.strictEqual(rechazo.motivo, "excede_peso");
  assert.strictEqual(inv.equipo["pechera"], "pechera_placas_acero", "no debe desequiparse si excede el peso");

  const permitido = desequiparItem(inv, catalogo, "pechera", pesoPechera + 5);
  assert.strictEqual(permitido.ok, true);
});

test("calcularStatsEquipo: suma defensa/ataque físico y mágico de TODO lo equipado", () => {
  const inv = jugadorVacio();
  for (const [itemId, slot] of [["pechera_cota_malla", "pechera"], ["casco_acero", "casco"], ["daga", "manoPrincipal"]] as const) {
    agregarItem(inv.cuerpo, catalogo, itemId, 1);
    equiparItem(inv, catalogo, inv.cuerpo.items.find((it) => it.itemId === itemId)!.id, slot);
  }
  const stats = calcularStatsEquipo(catalogo, inv.equipo);
  const esperadoDefensa = catalogo["pechera_cota_malla"].defensaFisica! + catalogo["casco_acero"].defensaFisica!;
  assert.strictEqual(stats.defensaFisica, esperadoDefensa);
  assert.strictEqual(stats.defensaMagica, catalogo["pechera_cota_malla"].defensaMagica ?? 0);
  assert.strictEqual(stats.ataqueFisico, catalogo["daga"].ataqueFisico);
});

test("calcularStatsEquipo: sin nada equipado, todo a 0", () => {
  const stats = calcularStatsEquipo(catalogo, {});
  assert.deepStrictEqual(stats, { defensaFisica: 0, defensaMagica: 0, ataqueFisico: 0, ataqueMagico: 0 });
});

test("pesoTotalJugador: suma el cuerpo Y cada mochila/bolsa equipada, no solo el cuerpo", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "hierro", 2); // peso en el cuerpo
  agregarItem(inv.cuerpo, catalogo, "mochila_cuero", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items.find((it) => it.itemId === "mochila_cuero")!.id, "espalda");
  agregarItem(inv.extras.get("espalda")!, catalogo, "hierro", 3); // peso DENTRO de la mochila
  const total = pesoTotalJugador(inv, catalogo);
  const esperado = pesoContenedor(inv.cuerpo, catalogo) + pesoContenedor(inv.extras.get("espalda")!, catalogo);
  assert.strictEqual(total, esperado);
  assert.ok(total > pesoContenedor(inv.cuerpo, catalogo), "el peso total debe ser mayor que solo el del cuerpo");
});

test("buscarInstanciaJugador: encuentra una instancia tanto en el cuerpo como dentro de una mochila equipada", () => {
  const inv = jugadorVacio();
  agregarItem(inv.cuerpo, catalogo, "mochila_cuero", 1);
  equiparItem(inv, catalogo, inv.cuerpo.items[0].id, "espalda");
  const { instancia } = agregarItem(inv.extras.get("espalda")!, catalogo, "hierro", 1);
  const encontrado = buscarInstanciaJugador(inv, instancia!.id);
  assert.ok(encontrado);
  assert.strictEqual(encontrado!.contenedorId, "espalda");
  assert.strictEqual(buscarInstanciaJugador(inv, 999999), null);
});

// docs/GDD_Monturas.md (pedido 2026-08-30): "dar de comer" ya no acepta
// cualquier comidaMascota — tiene que encajar con la dieta real de la especie.
test("comidaSirveParaDieta", () => {
  const carneRoja = catalogo["carne_roja"]; // comidaMascota, origenCocina "animal"
  const zanahoria = catalogo["zanahoria"]; // comidaMascota, origenCocina "vegetal"
  const hierro = catalogo["hierro"]; // ni siquiera comidaMascota

  assert.strictEqual(comidaSirveParaDieta(carneRoja, "carnivoro"), true);
  assert.strictEqual(comidaSirveParaDieta(carneRoja, "herbivoro"), false, "un herbívoro no come carne");
  assert.strictEqual(comidaSirveParaDieta(zanahoria, "herbivoro"), true);
  assert.strictEqual(comidaSirveParaDieta(zanahoria, "carnivoro"), false, "un carnívoro no come verdura");
  assert.strictEqual(comidaSirveParaDieta(carneRoja, "omnivoro"), true, "un omnívoro come de todo");
  assert.strictEqual(comidaSirveParaDieta(zanahoria, "omnivoro"), true, "un omnívoro come de todo");
  assert.strictEqual(comidaSirveParaDieta(hierro, "carnivoro"), false, "sin comidaMascota, nunca sirve");

  // sin dato de un lado u otro = universal (racion_viaje sin origenCocina, o especie sin dieta en catálogo)
  const racionViaje = catalogo["racion_viaje"];
  assert.strictEqual(comidaSirveParaDieta(racionViaje, "herbivoro"), true);
  assert.strictEqual(comidaSirveParaDieta(racionViaje, "carnivoro"), true);
  assert.strictEqual(comidaSirveParaDieta(carneRoja, undefined), true, "especie sin dieta conocida: acepta cualquier comidaMascota");
});
