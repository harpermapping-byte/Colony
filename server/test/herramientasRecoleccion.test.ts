// Gating de herramienta por tier al recolectar del mundo (docs/GDD_Profesiones.md
// §0, pedido 2026-08-30) — mejorHerramientaPara/requisitoDeCategoria son PURAS,
// se testean con un Contenedor sintético y el catálogo real de items.json.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { requisitoDeCategoria, mejorHerramientaPara, tiempoRespawnMsDeCategoria, msFaltantesParaRecolectar, CATEGORIA_HERRAMIENTA_RECOLECCION } from "../src/mundo/herramientasRecoleccion";
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

test("cobertura real: todo categoriaRecurso de vegetacion.json/rocas.json con recolectable tiene tabla de gating (o está deliberadamente fuera, semilla/fruta_cultivada/hierba)", () => {
  const vegetacion = JSON.parse(fs.readFileSync(path.join(RAIZ_BAKER, "vegetacion.json"), "utf8")) as Record<string, { categoriaRecurso?: string; desaparaceAlRecolectar?: boolean }>;
  const rocas = JSON.parse(fs.readFileSync(path.join(RAIZ_BAKER, "rocas.json"), "utf8")) as Record<string, { categoriaRecurso?: string; desaparaceAlRecolectar?: boolean }>;
  const EXENTAS = new Set(["semilla", "fruta_cultivada", "hierba"]); // agricultura de parcela (sistema aparte, ver comentario del módulo) + "hierba" (baker/catalogo/vegetacion.json::hierba_corta, pedido streamer 2026-09-12: "eso puede cualquiera") — la ÚNICA categoriaRecurso salvaje SIN requisito de herramienta a propósito, ver el comentario dedicado en herramientasRecoleccion.ts
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

// --- Velocidad real por tier (docs/GDD_Crafteo.md §8, 2026-09-08) ---

test("msFaltantesParaRecolectar: sin uso previo (ultimoMs=0, hace mucho) siempre puede recolectar ya", () => {
  assert.strictEqual(msFaltantesParaRecolectar(2200, 0, Date.now()), 0);
});

test("msFaltantesParaRecolectar: justo tras usar la herramienta, falta el cooldown entero", () => {
  const ahora = 100_000;
  assert.strictEqual(msFaltantesParaRecolectar(2200, ahora, ahora), 2200);
});

test("msFaltantesParaRecolectar: a mitad del cooldown, falta la mitad", () => {
  const ahora = 100_000;
  assert.strictEqual(msFaltantesParaRecolectar(2200, ahora, ahora + 1100), 1100);
});

test("msFaltantesParaRecolectar: pasado el cooldown entero, ya no falta nada (nunca negativo)", () => {
  const ahora = 100_000;
  assert.strictEqual(msFaltantesParaRecolectar(2200, ahora, ahora + 5000), 0);
});

test("msFaltantesParaRecolectar: cooldown 0 (herramienta sin gate) nunca bloquea", () => {
  assert.strictEqual(msFaltantesParaRecolectar(0, Date.now(), Date.now()), 0);
});

test("catálogo: toda herramienta_<oficio> tiene cooldownMs y durabilidadMax que MEJORAN con el tier (más rápida y más duradera de verdad, no solo una puerta de acceso)", () => {
  const porFamilia = new Map<string, { tier: number; cooldownMs?: number; durabilidadMax?: number }[]>();
  for (const [id, def] of Object.entries(catalogo)) {
    if (id.startsWith("_")) continue;
    const fm = (def as { familiaMaterial?: string }).familiaMaterial;
    if (typeof fm !== "string" || !fm.startsWith("herramienta_")) continue;
    const d = def as { tier?: number; cooldownMs?: number; durabilidadMax?: number };
    if (d.tier === undefined) continue; // las ~5 herramientas sin tier (cana_pesca...) quedan fuera a propósito
    const lista = porFamilia.get(fm) ?? [];
    lista.push({ tier: d.tier, cooldownMs: d.cooldownMs, durabilidadMax: d.durabilidadMax });
    porFamilia.set(fm, lista);
  }
  assert.ok(porFamilia.size >= 10, `deberían existir al menos 10 familias herramienta_<oficio>, hubo ${porFamilia.size}`);
  for (const [familia, entradas] of porFamilia) {
    for (const e of entradas) {
      assert.ok(typeof e.cooldownMs === "number" && e.cooldownMs > 0, `${familia} tier ${e.tier} sin cooldownMs real`);
      assert.ok(typeof e.durabilidadMax === "number" && e.durabilidadMax > 0, `${familia} tier ${e.tier} sin durabilidadMax real`);
    }
    // mismo tier puede repetirse (varias "líneas" de herramienta por oficio) — se compara
    // el PEOR cooldown/PEOR durabilidad de cada tier entre sí, tier a tier tiene que mejorar.
    const porTier = new Map<number, { cooldownMs: number; durabilidadMax: number }>();
    for (const e of entradas) {
      const actual = porTier.get(e.tier);
      if (!actual || e.cooldownMs! > actual.cooldownMs) porTier.set(e.tier, { cooldownMs: e.cooldownMs!, durabilidadMax: e.durabilidadMax! });
    }
    const tiers = [...porTier.keys()].sort((a, b) => a - b);
    for (let i = 1; i < tiers.length; i++) {
      const anterior = porTier.get(tiers[i - 1])!, actual = porTier.get(tiers[i])!;
      assert.ok(actual.cooldownMs < anterior.cooldownMs, `${familia}: tier ${tiers[i]} debería recolectar más rápido que tier ${tiers[i - 1]} (${actual.cooldownMs} vs ${anterior.cooldownMs})`);
      assert.ok(actual.durabilidadMax > anterior.durabilidadMax, `${familia}: tier ${tiers[i]} debería durar más que tier ${tiers[i - 1]} (${actual.durabilidadMax} vs ${anterior.durabilidadMax})`);
    }
  }
});
