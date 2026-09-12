// Tests de mundo/recolectables.ts (fase 2 de inventario, "coger del mundo" —
// docs/GDD_Inventario.md §7) y de la integración con cargarMapaColision.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { recolectableCercano, recolectablesCercanosMismoTipo, recolectablesAgotadosDeMapa, RecolectableVivo } from "../src/mundo/recolectables";
import { cargarMapaColision } from "../src/mundo/mapaColision";

const RAIZ_REPO = path.resolve(__dirname, "..", "..");
const RUTA_DEMO = path.join(RAIZ_REPO, "assets", "mapas", "demo");
const RUTA_CATALOGO_BAKER = path.join(RAIZ_REPO, "baker", "catalogo");

test("recolectableCercano: encuentra la entrada más cercana dentro del radio, sin escanear todo el Map", () => {
  const recolectables = new Map<number, RecolectableVivo>();
  const ancho = 100;
  recolectables.set(50 * ancho + 50, { itemId: "trebol", x: 50, y: 50 }); // lejos del jugador
  recolectables.set(10 * ancho + 10, { itemId: "mora", x: 10, y: 10 }); // el más cercano
  recolectables.set(10 * ancho + 13, { itemId: "tomillo", x: 13, y: 10 }); // dentro del radio pero más lejos

  const encontrado = recolectableCercano(recolectables, ancho, 10.4, 10.4, 2.2);
  assert.ok(encontrado);
  assert.strictEqual(encontrado!.item.itemId, "mora");
});

test("recolectableCercano: nada dentro del radio devuelve null (no revienta con el Map vacío ni con todo lejos)", () => {
  assert.strictEqual(recolectableCercano(new Map(), 100, 5, 5, 2.2), null);

  const recolectables = new Map<number, RecolectableVivo>([[0, { itemId: "trebol", x: 0, y: 0 }]]);
  assert.strictEqual(recolectableCercano(recolectables, 100, 50, 50, 2.2), null);
});

test("cargarMapaColision: recolectables solo incluye el pool ACTIVO (fix del bug 'ac falsy-zero' — !obj.ac también colaba los inactivos ac:0)", () => {
  const vegetacion = JSON.parse(fs.readFileSync(path.join(RUTA_CATALOGO_BAKER, "vegetacion.json"), "utf8")) as Record<
    string,
    { desaparaceAlRecolectar?: boolean; categoriaRecurso?: string }
  >;
  const rocas = JSON.parse(fs.readFileSync(path.join(RUTA_CATALOGO_BAKER, "rocas.json"), "utf8")) as Record<string, unknown>;
  const animales = JSON.parse(fs.readFileSync(path.join(RUTA_CATALOGO_BAKER, "animales.json"), "utf8")) as Record<string, unknown>;
  const catalogoPorLetra: Record<string, Record<string, { desaparaceAlRecolectar?: boolean; categoriaRecurso?: string }>> = {
    v: vegetacion,
    r: rocas as any,
    a: animales as any,
  };

  // recuento de referencia hecho SIN pasar por el código bajo prueba: recorre
  // los mismos sectores a mano, contando solo obj.ac !== 0 (activo).
  let esperados = 0;
  const inactivosExcluidosEsperado = { cuenta: 0 };
  for (const archivo of fs.readdirSync(RUTA_DEMO)) {
    if (!/^sector_\d+_\d+\.json$/.test(archivo)) continue;
    const sector = JSON.parse(fs.readFileSync(path.join(RUTA_DEMO, archivo), "utf8")) as {
      chunks: Record<string, { objetos: { i: string; t: string; ac?: number }[] }>;
    };
    for (const chunk of Object.values(sector.chunks)) {
      for (const obj of chunk.objetos) {
        const def = catalogoPorLetra[obj.t]?.[obj.i];
        if (!def?.desaparaceAlRecolectar || !def.categoriaRecurso) continue;
        if (obj.ac === 0) {
          inactivosExcluidosEsperado.cuenta++;
          continue;
        }
        esperados++;
      }
    }
  }
  assert.ok(esperados > 0, "el mapa demo necesita al menos un recolectable activo para que la prueba diga algo");
  assert.ok(inactivosExcluidosEsperado.cuenta > 0, "el mapa demo necesita al menos un inactivo (ac:0) para que la prueba distinga el fix del bug");

  const mapa = cargarMapaColision(RUTA_DEMO, RUTA_CATALOGO_BAKER);
  assert.strictEqual(mapa.recolectables.size, esperados, "recolectables debe traer SOLO los activos, ni más (bug ac falsy-zero) ni menos");

  // cada entrada resuelve a un itemId real (categoriaRecurso), no al id de catálogo bake crudo
  for (const item of mapa.recolectables.values()) {
    assert.ok(item.itemId.length > 0);
    assert.ok(item.x >= 0 && item.x < mapa.ancho && item.y >= 0 && item.y < mapa.alto);
  }
});

test("recolectableCercano: un idx marcado 'agotado' con timestamp futuro se salta, aunque sea el más cercano", () => {
  const recolectables = new Map<number, RecolectableVivo>();
  const ancho = 100;
  const idxCercano = 10 * ancho + 10;
  recolectables.set(idxCercano, { itemId: "mora", x: 10, y: 10 });
  recolectables.set(10 * ancho + 13, { itemId: "tomillo", x: 13, y: 10 });
  const agotados = new Map<number, number>([[idxCercano, Date.now() + 60_000]]);

  const encontrado = recolectableCercano(recolectables, ancho, 10.4, 10.4, 4, agotados);
  assert.ok(encontrado);
  assert.strictEqual(encontrado!.item.itemId, "tomillo", "debe saltarse el agotado y coger el siguiente más cercano");
  assert.strictEqual(agotados.size, 1, "el agotado con timestamp futuro no se toca");
});

test("recolectableCercano: un idx 'agotado' con timestamp YA pasado vuelve a estar disponible y se autolimpia del Map", () => {
  const recolectables = new Map<number, RecolectableVivo>();
  const ancho = 100;
  const idx = 10 * ancho + 10;
  recolectables.set(idx, { itemId: "mora", x: 10, y: 10 });
  const agotados = new Map<number, number>([[idx, Date.now() - 1000]]); // ya tocaba reaparecer

  const encontrado = recolectableCercano(recolectables, ancho, 10.4, 10.4, 2, agotados);
  assert.ok(encontrado);
  assert.strictEqual(encontrado!.item.itemId, "mora");
  assert.strictEqual(agotados.size, 0, "el timestamp vencido se borra solo (cálculo perezoso, sin tick de fondo)");
});

test("recolectablesAgotadosDeMapa: mismo Map por ruta mientras el proceso viva (mismo criterio de caché que recolectablesDeMapa)", () => {
  const ruta = "/ruta/de/prueba/no/existe/en/disco.json";
  const a = recolectablesAgotadosDeMapa(ruta);
  a.set(1, 12345);
  const b = recolectablesAgotadosDeMapa(ruta);
  assert.strictEqual(a, b, "debe ser el MISMO objeto Map en llamadas sucesivas");
  assert.strictEqual(b.get(1), 12345);
});

// --- Cosecha en área de hierba con azada (docs/GDD_Bakeador_Exteriores.md, pedido streamer 2026-09-12) ---

test("recolectablesCercanosMismoTipo: solo trae el MISMO itemId dentro del radio, excluyendo el idx ya elegido", () => {
  const recolectables = new Map<number, RecolectableVivo>();
  const ancho = 100;
  const idxElegido = 10 * ancho + 10;
  recolectables.set(idxElegido, { itemId: "hierba", x: 10, y: 10 }); // ya elegida, debe excluirse aunque esté dentro del radio
  recolectables.set(10 * ancho + 11, { itemId: "hierba", x: 11, y: 10 }); // vecina, misma especie
  recolectables.set(11 * ancho + 10, { itemId: "hierba", x: 10, y: 11 }); // vecina, misma especie
  recolectables.set(10 * ancho + 12, { itemId: "trebol", x: 12, y: 10 }); // dentro del radio pero OTRA especie
  recolectables.set(50 * ancho + 50, { itemId: "hierba", x: 50, y: 50 }); // misma especie pero lejos

  const extras = recolectablesCercanosMismoTipo(recolectables, ancho, 10.5, 10.5, 1.6, "hierba", idxElegido, 4);
  assert.strictEqual(extras.length, 2, "solo las 2 vecinas hierba dentro del radio, ni el trébol ni la lejana");
  assert.ok(extras.every((e) => e.item.itemId === "hierba"));
  assert.ok(!extras.some((e) => e.idx === idxElegido), "nunca se repite el idx ya elegido");
});

test("recolectablesCercanosMismoTipo: nunca trae más de maxExtra, ordenado por distancia (las más cercanas primero)", () => {
  const recolectables = new Map<number, RecolectableVivo>();
  const ancho = 100;
  for (let i = 0; i < 6; i++) recolectables.set(10 * ancho + (11 + i), { itemId: "hierba", x: 11 + i, y: 10 });

  const extras = recolectablesCercanosMismoTipo(recolectables, ancho, 10.5, 10.5, 10, "hierba", -1, 3);
  assert.strictEqual(extras.length, 3, "tope de maxExtra respetado aunque haya 6 candidatas dentro del radio");
  const xs = extras.map((e) => e.item.x);
  assert.deepStrictEqual(xs, [11, 12, 13], "las 3 más cercanas, en orden de distancia");
});

test("recolectablesCercanosMismoTipo: maxExtra=0 devuelve [] sin escanear (caso 'sin azada')", () => {
  const recolectables = new Map<number, RecolectableVivo>([[0, { itemId: "hierba", x: 0, y: 0 }]]);
  assert.deepStrictEqual(recolectablesCercanosMismoTipo(recolectables, 100, 0.5, 0.5, 5, "hierba", -1, 0), []);
});

test("recolectablesCercanosMismoTipo: respeta 'agotados' igual que recolectableCercano (salta timestamp futuro, autolimpia el vencido)", () => {
  const recolectables = new Map<number, RecolectableVivo>();
  const ancho = 100;
  const idxAgotado = 10 * ancho + 11;
  const idxVencido = 10 * ancho + 12;
  recolectables.set(idxAgotado, { itemId: "hierba", x: 11, y: 10 });
  recolectables.set(idxVencido, { itemId: "hierba", x: 12, y: 10 });
  const agotados = new Map<number, number>([
    [idxAgotado, Date.now() + 60_000], // todavía regenerando
    [idxVencido, Date.now() - 1000], // ya tocaba reaparecer
  ]);

  const extras = recolectablesCercanosMismoTipo(recolectables, ancho, 10.5, 10.5, 5, "hierba", -1, 4, agotados);
  assert.strictEqual(extras.length, 1, "solo la vencida (ya disponible), la que sigue agotada se salta");
  assert.strictEqual(extras[0].idx, idxVencido);
  assert.strictEqual(agotados.size, 1, "la vencida se autolimpia del Map de agotados");
  assert.ok(agotados.has(idxAgotado), "la que de verdad sigue agotada permanece");
});

test("cargarMapaColision: recargar el MISMO mapa reusa el Map de recolectables (no resetea lo ya cogido — evita el granjeo 'sal y entra' de RegionRoom)", () => {
  const mapaA = cargarMapaColision(RUTA_DEMO, RUTA_CATALOGO_BAKER);
  const tamanoOriginal = mapaA.recolectables.size;
  assert.ok(tamanoOriginal > 0);

  const [claveBorrada] = mapaA.recolectables.keys();
  mapaA.recolectables.delete(claveBorrada); // simula un "coger" con éxito

  const mapaB = cargarMapaColision(RUTA_DEMO, RUTA_CATALOGO_BAKER); // simula RegionRoom recreándose (autoDispose)
  assert.strictEqual(mapaB.recolectables, mapaA.recolectables, "debe ser el MISMO objeto Map, no uno reconstruido");
  assert.strictEqual(mapaB.recolectables.size, tamanoOriginal - 1, "lo ya cogido no debe reaparecer al recargar el mismo mapa");
});
