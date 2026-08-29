// Tests del sistema de construcción (GDD_Construccion §3-§5) sobre la LÓGICA
// PURA (sin levantar Colyseus): mapa DEMO real + parcelas fixture en un tmp +
// BD ":memory:". Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cargarMapaColision } from "../src/mundo/mapaColision";
import { TIPO } from "../src/mundo/colisiones";
import { cargarParcelas, parcelaEn, runsDe, topeDe } from "../src/construccion/parcelas";
import { cargarCatalogoConstruible } from "../src/construccion/catalogo";
import {
  ContextoConstruccion,
  huellaRotada,
  casillasDe,
  validarColocacion,
  aplicarColocacion,
  quitarConstruccion,
} from "../src/construccion/construccion";
import { generarInteriorEdificio, semillaInterior } from "../src/construccion/interiorGenerado";
import { AlmacenDatos } from "../src/datos/bd";

const RUTA_DEMO = path.resolve(__dirname, "..", "..", "assets", "mapas", "demo");

// El demo es un bake real: en vez de fijar coordenadas a fuego (se romperían
// al rehornearlo), se BUSCAN las casillas que cada test necesita.
const mapaRef = cargarMapaColision(RUTA_DEMO);

// Bloques ya reservados por tests anteriores: las parcelas del fixture no
// deben solaparse entre sí (regla §1: una casilla, una parcela).
const bloquesUsados: { x: number; y: number; lado: number }[] = [];

/** esquina noroeste de un bloque lado x lado todo TIERRA, disjunto de los ya usados */
function buscarBloqueTierra(lado: number): { x: number; y: number } {
  for (let y = 0; y <= mapaRef.alto - lado; y++) {
    exterior: for (let x = 0; x <= mapaRef.ancho - lado; x++) {
      for (const b of bloquesUsados) {
        if (x < b.x + b.lado && b.x < x + lado && y < b.y + b.lado && b.y < y + lado) continue exterior;
      }
      for (let dy = 0; dy < lado; dy++)
        for (let dx = 0; dx < lado; dx++)
          if (mapaRef.casillas[(y + dy) * mapaRef.ancho + (x + dx)] !== TIPO.TIERRA) continue exterior;
      bloquesUsados.push({ x, y, lado });
      return { x, y };
    }
  }
  throw new Error(`el demo no tiene un bloque de tierra libre de ${lado}x${lado}`);
}

function buscarCasillaDeTipo(...tipos: number[]): { x: number; y: number } {
  for (let y = 0; y < mapaRef.alto; y++)
    for (let x = 0; x < mapaRef.ancho; x++)
      if (tipos.includes(mapaRef.casillas[y * mapaRef.ancho + x])) return { x, y };
  throw new Error(`el demo no tiene ninguna casilla de tipo ${tipos}`);
}

// El demo (48x48) no tiene claros enormes: 6x6 es el mayor bloque real.
const bloqueA = buscarBloqueTierra(6); // parcela de Ragnar (tope 20)
const bloqueB = buscarBloqueTierra(4); // parcela de Lagertha
const bloqueC = buscarBloqueTierra(2); // parcela "Chica" (tope 1)
// el demo actual solo trae agua profunda; cualquiera de las dos vale para la regla
const casillaAgua = buscarCasillaDeTipo(TIPO.AGUA, TIPO.AGUA_PROFUNDA);
const casillaSolida = buscarCasillaDeTipo(TIPO.SOLIDO);

/** parcelas.json fixture en un tmp — el mismo formato que escribe la herramienta */
function escribirParcelasFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parcelas-test-"));
  const filas = (b: { x: number; y: number }, lado: number) =>
    Array.from({ length: lado }, (_, i) => [b.y + i, b.x, b.x + lado - 1]);
  fs.writeFileSync(
    path.join(dir, "parcelas.json"),
    JSON.stringify({
      version: 1,
      mapa: "demo",
      siguienteId: 6,
      parcelas: {
        p_0001: { asentamiento: "demo", nombre: "De Ragnar", runs: filas(bloqueA, 6), casillas: 36, topeProps: 20 },
        p_0002: { asentamiento: "demo", nombre: "De Lagertha", runs: filas(bloqueB, 4), casillas: 16, topeProps: 7 },
        // parcela "tramposa" con agua y roca dentro: la herramienta lo veta,
        // pero el servidor RE-VALIDA (GDD §1) — sirve para probar la regla 3
        p_0003: {
          asentamiento: "demo",
          nombre: "Mixta",
          runs: [[casillaAgua.y, casillaAgua.x, casillaAgua.x], [casillaSolida.y, casillaSolida.x, casillaSolida.x]],
          casillas: 2,
          topeProps: 2,
        },
        // parcela mínima para el tope: 2 casillas, tope 1
        p_0004: {
          asentamiento: "demo",
          nombre: "Chica",
          runs: [[bloqueC.y, bloqueC.x, bloqueC.x + 1]],
          casillas: 2,
          topeProps: 1,
        },
      },
    }),
  );
  return dir;
}

function crearContexto(): { ctx: ContextoConstruccion; dir: string } {
  const dir = escribirParcelasFixture();
  const mapa = cargarMapaColision(RUTA_DEMO); // rejilla fresca por test
  const ctx: ContextoConstruccion = {
    mapa,
    casillasBase: mapa.casillas.slice(),
    parcelas: cargarParcelas(dir, mapa.ancho),
    propiedades: new Map([
      ["p_0001", { dueno: "Ragnar" }],
      ["p_0002", { dueno: "Lagertha" }],
      ["p_0003", { dueno: "Ragnar" }],
      ["p_0004", { dueno: "Ragnar" }],
    ]),
    ocupacion: new Map(),
    vivas: new Map(),
    conteoPorPropiedad: new Map(),
    jarls: new Set(["floki"]), // ya normalizado (trim+lowercase), como hace HubRoom
  };
  return { ctx, dir };
}

const catalogo = cargarCatalogoConstruible();

test("catálogo construible: fusiona las tres fuentes con las reglas del GDD §3", () => {
  // mueble normal: colisiona; alfombra (FLOOR_DECAL): pisable
  assert.strictEqual(catalogo.get("cama_individual")?.categoria, "mueble");
  assert.strictEqual(catalogo.get("cama_individual")?.colision, true);
  assert.strictEqual(catalogo.get("alfombra_grande")?.colision, false);
  // los specialModifier (enemigos/eventos) NO se ofrecen
  for (const entrada of catalogo.values()) assert.ok(!entrada.id.startsWith("_"));
  // exterior: su campo colision manda (bancal pisable, empalizada no)
  assert.strictEqual(catalogo.get("bancal_cultivo")?.colision, false);
  assert.strictEqual(catalogo.get("empalizada_tramo")?.colision, true);
  // edificio: solo construible:true, con huellaExterior
  // (energia:undefined queda como propiedad propia porque el fusionador la
  // copia siempre — docs/GDD_Motriz.md — casa_humilde simplemente no la usa)
  assert.deepStrictEqual(catalogo.get("casa_humilde"), {
    id: "casa_humilde", categoria: "edificio", huella: [7, 6], colision: true, variantes: 1, energia: undefined,
  });
  assert.strictEqual(catalogo.get("mansion"), undefined); // sin construible:true
});

test("parcelas: índice numérico, helpers y tolerancia a mapa sin parcelas.json", () => {
  const { ctx, dir } = crearContexto();
  assert.strictEqual(parcelaEn(ctx.parcelas, bloqueA.x, bloqueA.y), "p_0001");
  assert.strictEqual(parcelaEn(ctx.parcelas, bloqueA.x + 5, bloqueA.y + 5), "p_0001");
  assert.strictEqual(parcelaEn(ctx.parcelas, 0, mapaRef.alto - 1), undefined);
  assert.strictEqual(topeDe(ctx.parcelas, "p_0001"), 20);
  assert.strictEqual(runsDe(ctx.parcelas, "p_0002").length, 4);
  // sin archivo = sin parcelas (no revienta)
  const vacio = cargarParcelas(path.join(dir, "no-existe"), mapaRef.ancho);
  assert.strictEqual(vacio.parcelas.size, 0);
  assert.strictEqual(cargarParcelas(undefined, mapaRef.ancho).indice.size, 0);
});

test("huellaRotada y casillasDe: rot impar intercambia ejes", () => {
  assert.deepStrictEqual(huellaRotada([3, 2], 0), [3, 2]);
  assert.deepStrictEqual(huellaRotada([3, 2], 1), [2, 3]);
  assert.deepStrictEqual(huellaRotada([3, 2], 2), [3, 2]);
  assert.deepStrictEqual(huellaRotada([3, 2], 3), [2, 3]);
  const casillas = casillasDe(10, 20, [2, 1], 1); // rotada: 1 ancho x 2 largo
  assert.deepStrictEqual(casillas, [{ x: 10, y: 20 }, { x: 10, y: 21 }]);
});

test("§5.1: fuera de parcela y parcela ajena se rechazan; el jarl sí puede", () => {
  const { ctx } = crearContexto();
  const pozo = catalogo.get("pozo")!;
  // tierra de nadie
  let r = validarColocacion(ctx, { nombre: "Ragnar", entrada: pozo, x: 0, y: mapaRef.alto - 1, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "fuera de parcela" });
  // parcela de Lagertha
  r = validarColocacion(ctx, { nombre: "Ragnar", entrada: pozo, x: bloqueB.x, y: bloqueB.y, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "no eres el dueño de esta parcela" });
  // el jarl construye en cualquier parcela (comparación trim+lowercase)
  r = validarColocacion(ctx, { nombre: "  FLOKI ", entrada: pozo, x: bloqueB.x, y: bloqueB.y, rot: 0 });
  assert.strictEqual(r.ok, true);
});

test("§5.2: la huella ROTADA entera debe caer en la misma parcela", () => {
  const { ctx } = crearContexto();
  const gallinero = catalogo.get("gallinero")!; // huella [3,2]
  // pegado al borde derecho de p_0001 (6 de ancho): sin rotar (3 de ancho) se sale...
  const x = bloqueA.x + 4, y = bloqueA.y;
  let r = validarColocacion(ctx, { nombre: "Ragnar", entrada: gallinero, x, y, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "la huella se sale de la parcela" });
  // ...pero rotado (2 de ancho x 3 de largo) cabe
  r = validarColocacion(ctx, { nombre: "Ragnar", entrada: gallinero, x, y, rot: 1 });
  assert.strictEqual(r.ok, true);
});

test("§5.3: agua y sólido del bake se rechazan aunque la parcela los incluya", () => {
  const { ctx } = crearContexto();
  const colmena = catalogo.get("colmena")!; // 1x1
  let r = validarColocacion(ctx, { nombre: "Ragnar", entrada: colmena, x: casillaAgua.x, y: casillaAgua.y, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "casilla no construible (agua u obstáculo)" });
  r = validarColocacion(ctx, { nombre: "Ragnar", entrada: colmena, x: casillaSolida.x, y: casillaSolida.y, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "casilla no construible (agua u obstáculo)" });
});

test("§5.3: dos construcciones no se solapan (aunque la primera no colisione)", () => {
  const { ctx } = crearContexto();
  const bancal = catalogo.get("bancal_cultivo")!; // [3,2], colision:false (pisable)
  const v = validarColocacion(ctx, { nombre: "Ragnar", entrada: bancal, x: bloqueA.x, y: bloqueA.y, rot: 0 });
  assert.strictEqual(v.ok, true);
  aplicarColocacion(ctx, {
    id: 1, propiedad: "p_0001", objeto: "bancal_cultivo", categoria: "exterior",
    x: bloqueA.x, y: bloqueA.y, rot: 0, variante: 0, colision: false, huella: bancal.huella,
  });
  // el bancal NO endurece (se pisa)... pero SÍ reserva sus casillas
  assert.strictEqual(ctx.mapa.casillas[bloqueA.y * ctx.mapa.ancho + bloqueA.x], TIPO.TIERRA);
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: bancal, x: bloqueA.x + 2, y: bloqueA.y, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "casilla ocupada por otra construcción" });
});

test("§5.4: topeProps de la parcela", () => {
  const { ctx } = crearContexto();
  const colmena = catalogo.get("colmena")!;
  // p_0004: 2 casillas, tope 1 — la primera entra, la segunda no
  const v = validarColocacion(ctx, { nombre: "Ragnar", entrada: colmena, x: bloqueC.x, y: bloqueC.y, rot: 0 });
  assert.strictEqual(v.ok, true);
  aplicarColocacion(ctx, {
    id: 1, propiedad: "p_0004", objeto: "colmena", categoria: "exterior",
    x: bloqueC.x, y: bloqueC.y, rot: 0, variante: 0, colision: true, huella: colmena.huella,
  });
  const r = validarColocacion(ctx, { nombre: "Ragnar", entrada: colmena, x: bloqueC.x + 1, y: bloqueC.y, rot: 0 });
  assert.deepStrictEqual(r, { ok: false, motivo: "tope de construcciones de la parcela alcanzado" });
});

test("colocar endurece y recoger restaura EXACTAMENTE el bake y libera casillas", () => {
  const { ctx } = crearContexto();
  const gallinero = catalogo.get("gallinero")!;
  const claves = casillasDe(bloqueA.x + 2, bloqueA.y + 2, gallinero.huella, 0)
    .map((c) => c.y * ctx.mapa.ancho + c.x);
  aplicarColocacion(ctx, {
    id: 7, propiedad: "p_0001", objeto: "gallinero", categoria: "exterior",
    x: bloqueA.x + 2, y: bloqueA.y + 2, rot: 0, variante: 0, colision: true, huella: gallinero.huella,
  });
  for (const k of claves) {
    assert.strictEqual(ctx.mapa.casillas[k], TIPO.SOLIDO);
    assert.strictEqual(ctx.ocupacion.get(k), 7);
  }
  const quitada = quitarConstruccion(ctx, 7);
  assert.strictEqual(quitada?.objeto, "gallinero");
  for (const k of claves) {
    assert.strictEqual(ctx.mapa.casillas[k], ctx.casillasBase[k]); // vuelve a ser lo que era
    assert.strictEqual(ctx.ocupacion.has(k), false);
  }
  assert.strictEqual(ctx.conteoPorPropiedad.get("p_0001"), undefined);
  // recoger dos veces no revienta
  assert.strictEqual(quitarConstruccion(ctx, 7), undefined);
});

test("edificio: interior determinista por semilla del GDD §5 y serializable", () => {
  assert.strictEqual(semillaInterior("p_0001", 10, 20), "construccion|p_0001|10_20");
  const a = generarInteriorEdificio("casa_humilde", "p_0001", 10, 20);
  const b = generarInteriorEdificio("casa_humilde", "p_0001", 10, 20);
  assert.deepStrictEqual(a, b); // misma semilla = mismo interior, siempre
  const c = generarInteriorEdificio("casa_humilde", "p_0001", 11, 20);
  assert.notDeepStrictEqual(a, c); // otro sitio = otra semilla
  assert.strictEqual((a as { amueblado?: string }).amueblado, "vacio");
  // serializable tal cual para el campo extra de la BD
  const ida = JSON.parse(JSON.stringify(a));
  assert.deepStrictEqual(ida, a);
});

test("ciclo con BD ':memory:': insertar → recargar → recoger (lo que hace HubRoom)", async () => {
  const { ctx } = crearContexto();
  const bd = new AlmacenDatos(":memory:");
  await bd.asignarPropiedad("p_0001", "parcela", "demo", "Ragnar");
  const interior = generarInteriorEdificio("choza_pescador", "p_0001", bloqueA.x, bloqueA.y);
  const id = await bd.insertarConstruccion({
    propiedad: "p_0001", objeto: "choza_pescador", categoria: "edificio",
    x: bloqueA.x, y: bloqueA.y, rot: 0, variante: 0, extra: { interior },
  });
  // recargar de BD y aplicar, como onCreate
  const cargadas = await bd.listarConstrucciones();
  assert.strictEqual(cargadas.length, 1);
  assert.deepStrictEqual((cargadas[0].extra as { interior: unknown }).interior, interior);
  const entrada = catalogo.get("choza_pescador")!;
  aplicarColocacion(ctx, {
    id, propiedad: "p_0001", objeto: "choza_pescador", categoria: "edificio",
    x: bloqueA.x, y: bloqueA.y, rot: 0, variante: 0, colision: entrada.colision, huella: entrada.huella,
  });
  assert.strictEqual(ctx.mapa.casillas[bloqueA.y * ctx.mapa.ancho + bloqueA.x], TIPO.SOLIDO);
  // recoger: borrar de BD + restaurar rejilla
  assert.strictEqual(await bd.borrarConstruccion(id), true);
  quitarConstruccion(ctx, id);
  assert.strictEqual(ctx.mapa.casillas[bloqueA.y * ctx.mapa.ancho + bloqueA.x], TIPO.TIERRA);
  assert.strictEqual((await bd.listarConstrucciones()).length, 0);
  await bd.cerrar();
});
