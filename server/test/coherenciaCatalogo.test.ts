// Coherencia GLOBAL de los catálogos de crafteo (docs/GDD_Crafteo.md §11 y
// docs/GDD_Economia.md §12, 2026-09-11). No prueba una mecánica: prueba que
// items.json / recetas.json / elementos.json / exteriores.json / los
// catálogos del baker encajan entre sí — cada insumo tiene una fuente real,
// cada resultado existe, cada mesa existe, todo ítem tiene nombre y
// valorBase calculados (no a mano), crafteado nunca vale menos que sus
// insumos, tiempos/XP crecen con el nivel... Es la red que impide que una
// ampliación futura deje otra vez un "cera sin fuente" o un "efectoCuracion
// que nadie lee" en silencio. Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { cargarCatalogoItems, cargarCatalogoRecetas } from "../src/inventario/inventario";
import { CATEGORIA_HERRAMIENTA_RECOLECCION } from "../src/mundo/herramientasRecoleccion";
import { cargarCatalogoMercaderes, precioBaseArticulo } from "../src/mercado/catalogoMercaderes";
import { OFICIOS_JUGADOR_VALIDOS } from "../src/personaje/oficios";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const valorBase = require("../../items/catalogo/valorBase.js") as {
  calcularValores: (items: Record<string, unknown>, recetas: Record<string, unknown>) => { valores: Record<string, number>; avisos: string[] };
  xpDeReceta: (r: { nivelMinimo: number; tiempoBaseSeg: number }) => number;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nombreBonito } = require("../../items/catalogo/nombreBonito.js") as { nombreBonito: (id: string) => string };

const RAIZ = path.join(__dirname, "..", "..");
const items = cargarCatalogoItems();
const recetas = cargarCatalogoRecetas();
const elementos = JSON.parse(fs.readFileSync(path.join(RAIZ, "interiores/catalogo/elementos.json"), "utf8")) as Record<string, { requiereItemColocar?: string; produccion?: { itemId: string } } | string>;
const exteriores = JSON.parse(fs.readFileSync(path.join(RAIZ, "interiores/catalogo/exteriores.json"), "utf8")) as Record<string, { produccion?: { itemId: string } } | string>;
const vegetacion = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker/catalogo/vegetacion.json"), "utf8")) as unknown;
const rocas = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker/catalogo/rocas.json"), "utf8")) as unknown;
const animales = JSON.parse(fs.readFileSync(path.join(RAIZ, "baker/catalogo/animales.json"), "utf8")) as unknown;

function entradas(cat: unknown): Record<string, unknown>[] {
  if (Array.isArray(cat)) return cat as Record<string, unknown>[];
  const o = cat as Record<string, unknown>;
  for (const k of ["entradas", "especies", "lista"]) if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  return Object.values(o).filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
}
const idsMuebles = new Set(Object.keys(elementos).filter((k) => !k.startsWith("_")).concat(Object.keys(exteriores).filter((k) => !k.startsWith("_"))));

/** Todo itemId que el mundo puede ENTREGAR sin receta: recolección del bake, caza, granja, cultivo, producción pasiva, procesos a granel. */
function fuentesSinReceta(): Set<string> {
  const fuentes = new Set<string>();
  const cats = new Set<string>();
  for (const cat of [vegetacion, rocas]) for (const e of entradas(cat)) if (typeof e.categoriaRecurso === "string") cats.add(e.categoriaRecurso);
  for (const e of entradas(animales)) {
    if (typeof e.categoriaRecursoCarne === "string") cats.add(e.categoriaRecursoCarne);
    if (typeof e.categoriaRecursoPiel === "string") cats.add(e.categoriaRecursoPiel);
  }
  for (const [id, it] of Object.entries(items)) if (it.categoriaRecurso && cats.has(it.categoriaRecurso)) fuentes.add(id);
  for (const it of Object.values(items)) if (it.cultivo) fuentes.add(it.cultivo.itemIdCosecha);
  for (const cat of [elementos, exteriores]) for (const e of Object.values(cat)) if (typeof e === "object" && e.produccion) fuentes.add(e.produccion.itemId);
  // Sin categoría de bake pero con fuente real en código: caza/despiece (lootCaza.ts), ganadería (leche/huevo/lana/pienso en fauna.ts), curtido a granel (curtido.ts), letrina (hoja), semillas de árbol al talar, cebo al recolectar.
  for (const id of ["tendones", "tripas", "grasa", "leche", "huevo", "lana", "curtiente", "piel_salada", "piel_raspada", "hoja", "cebo_pesca",
    "cabeza_trofeo_pequena", "cabeza_trofeo_mediana", "cabeza_trofeo_grande", "moneda_suelta", "reliquia", "libro", "sal"]) fuentes.add(id);
  for (const [id, it] of Object.entries(items)) if (it.tipo === "semilla" || it.tipo === "libro" || id.startsWith("cadaver_") || id.startsWith("pocion_alquimica_")) fuentes.add(id);
  return fuentes;
}

test("recetas: cada insumo, resultado, resultadoPerfecto y mesa existen de verdad", () => {
  for (const [id, r] of recetas) {
    for (const i of r.insumos) assert.ok(items[i.itemId], `${id}: insumo ${i.itemId} no existe en items.json`);
    assert.ok(items[r.resultado.itemId], `${id}: resultado ${r.resultado.itemId} no existe`);
    if (r.resultadoPerfecto) assert.ok(items[r.resultadoPerfecto.itemId], `${id}: resultadoPerfecto ${r.resultadoPerfecto.itemId} no existe`);
    assert.ok(r.mesas.length > 0, `${id}: sin mesas`);
    for (const m of r.mesas) assert.ok(idsMuebles.has(m), `${id}: mesa ${m} no existe en elementos/exteriores`);
    assert.ok(OFICIOS_JUGADOR_VALIDOS.has(r.oficio), `${id}: oficio ${r.oficio} no es un oficio jugable`);
    assert.ok(r.nivelMinimo >= 1 && r.nivelMinimo <= 10, `${id}: nivelMinimo ${r.nivelMinimo} fuera de 1-10`);
    assert.ok(r.tiempoBaseSeg > 0 && r.resultado.cantidad >= 1 && r.insumos.length > 0, `${id}: receta vacía o instantánea`);
  }
});

test("recetas: todo insumo tiene una fuente real (otra receta, recolección/caza/cultivo/producción, o un proceso del servidor) — nunca 'cera sin fuente' otra vez", () => {
  const producidos = new Set([...recetas.values()].map((r) => r.resultado.itemId));
  const fuentes = fuentesSinReceta();
  const sinFuente: string[] = [];
  for (const [, r] of recetas) for (const i of r.insumos) if (!producidos.has(i.itemId) && !fuentes.has(i.itemId)) sinFuente.push(i.itemId);
  assert.deepStrictEqual([...new Set(sinFuente)], [], "insumos sin ninguna fuente");
});

test("recursos crudos del bake: ninguno se queda sin consumidor (receta o mecánica) — coral/abedul/sauce/carbonizada/cereal/algas/raíces/hongos tenían 0 antes de 2026-09-11", () => {
  const consumidos = new Set<string>();
  for (const [, r] of recetas) for (const i of r.insumos) consumidos.add(i.itemId);
  // Con uso por mecánica (no por receta): ingredientes/catalizadores/corruptivos de alquimia, cocina directa (aportesCocina), cebo, fertilizante, pienso, hoja.
  for (const [id, it] of Object.entries(items)) {
    const e = it as unknown as Record<string, unknown>;
    if (e.alquimiaIngrediente || e.alquimiaCatalizador || e.alquimiaCorruptivo || it.aportesCocina) consumidos.add(id);
  }
  for (const id of ["cebo_pesca", "fertilizante", "pienso", "hoja"]) consumidos.add(id);
  const cats = new Set<string>();
  for (const cat of [vegetacion, rocas]) for (const e of entradas(cat)) if (typeof e.categoriaRecurso === "string") cats.add(e.categoriaRecurso);
  const muertos = Object.entries(items).filter(([id, it]) => it.categoriaRecurso && cats.has(it.categoriaRecurso) && !consumidos.has(id)).map(([id]) => id);
  assert.deepStrictEqual(muertos, [], "recursos recolectables que nadie consume");
});

test("items: todo ítem tiene nombre (nombreBonito.js) y valorBase (valorBase.js) EXACTAMENTE iguales a los calculados — dar de alta algo sin pasar por los dos scripts rompe aquí a propósito", () => {
  const bruto = (valorBase as unknown as { cargar: (r: string) => { reales: Record<string, unknown> } });
  const brutoItems = bruto.cargar(path.join(RAIZ, "items/catalogo/items.json")).reales;
  const brutoRecetas = bruto.cargar(path.join(RAIZ, "items/catalogo/recetas.json")).reales;
  const { valores, avisos } = valorBase.calcularValores(brutoItems, brutoRecetas);
  assert.deepStrictEqual(avisos, [], "valorBase.js no sabe valorar algún ítem");
  const malos: string[] = [];
  for (const [id, it] of Object.entries(items)) {
    if (!it.valorBase || it.valorBase !== valores[id]) malos.push(`${id}: guardado ${it.valorBase} calculado ${valores[id]}`);
    const nombre = (it as unknown as { nombre?: string }).nombre;
    if (!nombre) malos.push(`${id}: sin nombre`);
  }
  assert.deepStrictEqual(malos, [], "ejecuta `node items/catalogo/valorBase.js --aplicar` (y nombreBonito.js para los nombres)");
});

test("recetas: xpOtorgada presente y exactamente la de la fórmula de valorBase.js; XP y tiempo nunca decrecen con el nivel (medias por nivel)", () => {
  const porNivel = new Map<number, { xp: number[]; t: number[] }>();
  for (const [id, r] of recetas) {
    assert.strictEqual(r.xpOtorgada, valorBase.xpDeReceta(r), `${id}: xpOtorgada ${r.xpOtorgada} ≠ fórmula ${valorBase.xpDeReceta(r)} — ejecuta valorBase.js --aplicar`);
    const e = porNivel.get(r.nivelMinimo) ?? { xp: [], t: [] };
    e.xp.push(r.xpOtorgada!); e.t.push(r.tiempoBaseSeg);
    porNivel.set(r.nivelMinimo, e);
  }
  const media = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
  let anterior = { xp: 0, t: 0 };
  for (let n = 1; n <= 10; n++) {
    const e = porNivel.get(n);
    assert.ok(e && e.xp.length > 0, `nivel ${n}: ningún oficio tiene receta — el nivel no desbloquea nada`);
    const actual = { xp: media(e.xp), t: media(e.t) };
    assert.ok(actual.xp >= anterior.xp, `nivel ${n}: XP media ${actual.xp} < nivel anterior ${anterior.xp}`);
    assert.ok(actual.t >= anterior.t, `nivel ${n}: tiempo medio ${actual.t}s < nivel anterior ${anterior.t}s`);
    anterior = actual;
  }
});

test("progresión: los 10 oficios tienen recetas en niveles 1-5 y al menos una en cada tramo 6-7 y 8-10 (antes 8/10 oficios estaban vacíos por encima de 5)", () => {
  for (const oficio of OFICIOS_JUGADOR_VALIDOS) {
    const niveles = new Set([...recetas.values()].filter((r) => r.oficio === oficio).map((r) => r.nivelMinimo));
    for (let n = 1; n <= 5; n++) assert.ok(niveles.has(n), `${oficio}: sin receta de nivel ${n}`);
    assert.ok(niveles.has(6) || niveles.has(7), `${oficio}: sin receta de nivel 6-7`);
    assert.ok(niveles.has(8) || niveles.has(9) || niveles.has(10), `${oficio}: sin receta de nivel 8-10`);
  }
});

test("valor: lo crafteado nunca vale menos que sus insumos (la receta más barata fija el valor; una alternativa puede ser algo peor trato, nunca destruir más del 20%), y las escaleras de tier ordenan", () => {
  for (const [id, r] of recetas) {
    const coste = r.insumos.reduce((a, i) => a + (items[i.itemId].valorBase ?? 0) * i.cantidad, 0);
    const valor = (items[r.resultado.itemId].valorBase ?? 0) * r.resultado.cantidad;
    assert.ok(valor >= coste * 0.8, `${id}: el resultado (${valor}) vale bastante menos que sus insumos (${coste})`);
  }
  // Tier de metal: platino > oro > plata > hierro; mithril > acero templado > acero > lingote de hierro.
  const v = (id: string) => items[id].valorBase!;
  assert.ok(v("platino") > v("oro") && v("oro") > v("plata") && v("plata") > v("hierro"), "orden de minerales");
  assert.ok(v("mithril") > v("acero_templado") && v("acero_templado") > v("acero") && v("acero") > v("lingote_hierro") && v("lingote_hierro") > v("hierro"), "cadena del metal");
  assert.ok(v("espada_mithril") > v("espada_acero_templado") && v("espada_acero_templado") > v("espada_larga") && v("espada_larga") > v("espada_corta") && v("espada_corta") > v("daga"), "escalera de espadas");
  assert.ok(v("legendario_pechera_orco") > v("peto_placas_mithril") * 0.4, "un set legendario de jefe cotiza en la misma liga que el mejor peto craftable, nunca como chatarra");
});

test("mercaderes: todo artículo de pool existe en items.json y su precioBase cae al valorBase del catálogo cuando el pool no fija número", () => {
  const cat = cargarCatalogoMercaderes();
  for (const [oficio, entrada] of Object.entries(cat.oficios)) {
    for (const itemId of Object.keys(entrada.pool)) {
      assert.ok(items[itemId], `${oficio}: ${itemId} no existe en items.json`);
      const precio = precioBaseArticulo(entrada, itemId, (id) => items[id]?.valorBase);
      assert.ok(precio >= 1, `${oficio}/${itemId}: precioBase ${precio}`);
      if (entrada.pool[itemId] == null) assert.strictEqual(precio, items[itemId].valorBase, `${oficio}/${itemId}: sin número en el pool debe usar valorBase`);
    }
  }
  assert.strictEqual(precioBaseArticulo({ pool: { x: 7 } }, "x", () => 99), 7, "un número fijado a mano manda");
  assert.strictEqual(precioBaseArticulo({ pool: { x: null } }, "x", () => undefined), 1, "sin valorBase nunca vende a 0");
});

test("equipo: todo slotEquipo es un hueco REAL del muñeco (SlotsEquipo) — 4 piezas insignia llevaban 'torso'/'cabeza' y nunca se podían equipar", () => {
  const slotsReales = new Set(["manoPrincipal", "manoSecundaria", "casco", "mascara", "gafas", "brazos", "manos", "piernas", "zapatos", "hombreras", "rodilleras", "coderas", "pechera", "anillo", "brazalete", "bandolera", "capa", "cuello", "espalda", "cinturon"]);
  for (const [id, it] of Object.entries(items)) if (it.slotEquipo) assert.ok(slotsReales.has(it.slotEquipo), `${id}: slot ${it.slotEquipo} no existe`);
  for (const [id, it] of Object.entries(items)) {
    const e = it as unknown as Record<string, unknown>;
    if (it.tipo === "arma" && it.alcance && it.alcance >= 3 && !it.municionId && !e.legendario && it.tipoDano === "perforante" && /arco|ballesta/.test(id)) assert.fail(`${id}: arma a distancia sin municionId`);
    assert.ok(!e.requiereMunicion, `${id}: 'requiereMunicion' no es un campo real (el servidor lee municionId)`);
    assert.ok(!e.efectoCuracion, `${id}: 'efectoCuracion' no lo lee nadie — usa restauraMultiple`);
    // Consumibles que se usan por SU PROPIA mecánica (médico: venda/ungüento/tablilla/prótesis/jarabe; alquimia: pocion:beber) no pasan por personaje:consumir.
    const usoPropio = /^(venda|unguento|tablilla|protesis_madera|protesis_metal|jarabe_catarro|pocion_alquimica_[a-z]+)$/.test(id);
    if (it.tipo === "consumible" && !usoPropio) assert.ok(it.restaura || it.restauraMultiple || it.efectoBuff, `${id}: consumible que personaje:consumir rechazaría`);
  }
});

test("muebles craftables: cada requiereItemColocar apunta a un ítem con receta, y cada 'mueble como ítem' tiene su mueble", () => {
  const producidos = new Set([...recetas.values()].map((r) => r.resultado.itemId));
  const fuentes = fuentesSinReceta(); // p.ej. trofeo_pared_* se cuelga con una cabeza_trofeo_* que cae al desollar, no de una receta
  for (const [id, e] of Object.entries(elementos)) {
    if (typeof e !== "object" || !e.requiereItemColocar) continue;
    assert.ok(items[e.requiereItemColocar], `${id}: requiereItemColocar ${e.requiereItemColocar} no existe como ítem`);
    assert.ok(producidos.has(e.requiereItemColocar) || fuentes.has(e.requiereItemColocar), `${id}: el ítem ${e.requiereItemColocar} no tiene receta ni fuente — mueble incolocable`);
  }
});

test("herramientas: cada categoría de recolección con gate apunta a un oficio jugable y el tier es 1-5", () => {
  for (const [cat, req] of Object.entries(CATEGORIA_HERRAMIENTA_RECOLECCION)) {
    assert.ok(OFICIOS_JUGADOR_VALIDOS.has(req.oficio), `${cat}: oficio ${req.oficio}`);
    assert.ok(req.tier >= 1 && req.tier <= 5, `${cat}: tier ${req.tier}`);
  }
});

test("nombres: ningún ítem nuevo lleva un nombre inventado a mano (coincide con nombreBonito.js salvo excepciones curadas ya registradas allí)", () => {
  const distintos: string[] = [];
  for (const [id, it] of Object.entries(items)) {
    const nombre = (it as unknown as { nombre?: string }).nombre;
    if (it.tipo === "libro") continue; // los libros llevan TÍTULO (items/catalogo/librosContenido.json), no nombre de catálogo — diseño de docs/GDD_Libreria.md
    if (nombre !== nombreBonito(id)) distintos.push(`${id}: "${nombre}" ≠ "${nombreBonito(id)}"`);
  }
  assert.deepStrictEqual(distintos, [], "nombre a mano en el catálogo — añade la excepción a nombreBonito.js en vez de escribirlo a fuego");
});
