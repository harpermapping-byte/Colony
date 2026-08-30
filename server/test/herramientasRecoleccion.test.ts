// Gating de herramienta por tier al recolectar del mundo (docs/GDD_Profesiones.md
// §0, pedido 2026-08-30) — mejorHerramientaPara/requisitoDeCategoria son PURAS,
// se testean con un Contenedor sintético y el catálogo real de items.json.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { requisitoDeCategoria, mejorHerramientaPara, tiempoRespawnMsDeCategoria, CATEGORIA_HERRAMIENTA_RECOLECCION } from "../src/mundo/herramientasRecoleccion";
import { cargarCatalogoItems, Contenedor, ItemInstancia } from "../src/inventario/inventario";

const catalogo = cargarCatalogoItems();
const RAIZ_BAKER = path.resolve(__dirname, "..", "..", "baker", "catalogo");

function contenedorCon(items: Partial<ItemInstancia>[]): Contenedor {
  return {
    ancho: 10,
    alto: 10,
    items: items.map((it, i) => ({ id: i, itemId: it.itemId!, cantidad: 1, x: 0, y: 0, rot: 0, ...it })) as ItemInstancia[],
    siguienteId: items.length,
  } as Contenedor;
}

test("requisitoDeCategoria: madera_dura exige carpintero tier 2; una categoría no listada no exige nada", () => {
  assert.deepStrictEqual(requisitoDeCategoria("madera_dura"), { oficio: "carpintero", tier: 2 });
  assert.strictEqual(requisitoDeCategoria("categoria_inventada_sin_gate"), undefined);
});

test("mejorHerramientaPara: sin ninguna herramienta del oficio, no encuentra nada", () => {
  const contenedor = contenedorCon([{ itemId: "cuchillo_desollar" }]);
  const herramienta = mejorHerramientaPara(contenedor, catalogo, { oficio: "carpintero", tier: 1 });
  assert.strictEqual(herramienta, undefined);
});

test("mejorHerramientaPara: hacha_mano_cobre_hierro (tier 1) sirve para madera_blanda (tier 1)", () => {
  const contenedor = contenedorCon([{ itemId: "hacha_mano_cobre_hierro" }]);
  const herramienta = mejorHerramientaPara(contenedor, catalogo, requisitoDeCategoria("madera_blanda")!);
  assert.ok(herramienta);
  assert.strictEqual(herramienta!.itemId, "hacha_mano_cobre_hierro");
});

test("mejorHerramientaPara: hacha de tier 1 NO sirve para madera_palmera (tier 4)", () => {
  const contenedor = contenedorCon([{ itemId: "hacha_mano_cobre_hierro" }]);
  const herramienta = mejorHerramientaPara(contenedor, catalogo, requisitoDeCategoria("madera_palmera")!);
  assert.strictEqual(herramienta, undefined);
});

test("mejorHerramientaPara: hacha_maestro_lenador (tier 4) SÍ sirve para madera_blanda (tier 1) — un tier alto cubre los inferiores", () => {
  const contenedor = contenedorCon([{ itemId: "hacha_maestro_lenador" }]);
  const herramienta = mejorHerramientaPara(contenedor, catalogo, requisitoDeCategoria("madera_blanda")!);
  assert.ok(herramienta);
  assert.strictEqual(herramienta!.itemId, "hacha_maestro_lenador");
});

test("mejorHerramientaPara: con varias herramientas válidas, elige la de tier más alto", () => {
  const contenedor = contenedorCon([{ itemId: "hacha_mano_cobre_hierro" }, { itemId: "hacha_maestro_lenador" }, { itemId: "hacha_talar" }]);
  const herramienta = mejorHerramientaPara(contenedor, catalogo, requisitoDeCategoria("madera_blanda")!);
  assert.strictEqual(herramienta!.itemId, "hacha_maestro_lenador");
});

test("mejorHerramientaPara: una herramienta de OTRO oficio no cuenta aunque el tier alcance", () => {
  const contenedor = contenedorCon([{ itemId: "pico_maestro_minero" }]); // picapedrero tier 4
  const herramienta = mejorHerramientaPara(contenedor, catalogo, requisitoDeCategoria("madera_blanda")!); // carpintero tier 1
  assert.strictEqual(herramienta, undefined);
});

test("mejorHerramientaPara: herramienta rota (durabilidad a 0) no cuenta", () => {
  const contenedor = contenedorCon([{ itemId: "hacha_mano_cobre_hierro", durabilidad: 0 }]);
  const herramienta = mejorHerramientaPara(contenedor, catalogo, requisitoDeCategoria("madera_blanda")!);
  assert.strictEqual(herramienta, undefined);
});

test("tiempoRespawnMsDeCategoria: a más tier (más rareza), más tiempo de reaparición", () => {
  assert.strictEqual(tiempoRespawnMsDeCategoria("piedra_comun"), 5 * 60 * 1000); // tier 1
  assert.strictEqual(tiempoRespawnMsDeCategoria("hierro"), 15 * 60 * 1000); // tier 2
  assert.strictEqual(tiempoRespawnMsDeCategoria("plata"), 30 * 60 * 1000); // tier 3
  assert.strictEqual(tiempoRespawnMsDeCategoria("oro"), 60 * 60 * 1000); // tier 4
});

test("tiempoRespawnMsDeCategoria: categoría no listada (o inventada) devuelve undefined", () => {
  assert.strictEqual(tiempoRespawnMsDeCategoria("categoria_inventada_sin_gate"), undefined);
});

test("cobertura real: todo categoriaRecurso de vegetacion.json/rocas.json con recolectable tiene tabla de gating (o está deliberadamente fuera, semilla/fruta_cultivada)", () => {
  const vegetacion = JSON.parse(fs.readFileSync(path.join(RAIZ_BAKER, "vegetacion.json"), "utf8")) as Record<string, { categoriaRecurso?: string; desaparaceAlRecolectar?: boolean }>;
  const rocas = JSON.parse(fs.readFileSync(path.join(RAIZ_BAKER, "rocas.json"), "utf8")) as Record<string, { categoriaRecurso?: string; desaparaceAlRecolectar?: boolean }>;
  const EXENTAS = new Set(["semilla", "fruta_cultivada"]); // agricultura de parcela, sistema aparte (ver comentario del módulo)
  const huerfanas = new Set<string>();
  for (const catalogo of [vegetacion, rocas]) {
    for (const [id, def] of Object.entries(catalogo)) {
      if (id.startsWith("_") || !def.categoriaRecurso || !def.desaparaceAlRecolectar) continue;
      if (EXENTAS.has(def.categoriaRecurso)) continue;
      if (!CATEGORIA_HERRAMIENTA_RECOLECCION[def.categoriaRecurso]) huerfanas.add(def.categoriaRecurso);
    }
  }
  assert.deepStrictEqual([...huerfanas], [], `categorías recolectables reales sin gating asignado: ${[...huerfanas].join(", ")}`);
});
