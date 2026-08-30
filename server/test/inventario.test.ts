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
  CatalogoItems,
} from "../src/inventario/inventario";

const catalogo: CatalogoItems = cargarCatalogoItems();

test("cargarCatalogoItems: filtra claves _nota* y trae los ítems reales (fase 1 + arcilla + objetos 'sobreSuperficie' curados de fase 2)", () => {
  const ids = Object.keys(catalogo);
  assert.ok(!ids.some((id) => id.startsWith("_")), "alguna clave _nota* se coló");
  assert.strictEqual(ids.length, 138); // 121 anteriores + 17 de agricultura (docs/GDD_Agricultura.md: fertilizante, 6 cultivos, 6 semillas, 4 bolsas de semillas)
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
