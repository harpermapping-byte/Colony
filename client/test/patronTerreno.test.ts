import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generarParcheTerreno, obtenerParcheTerreno, obtenerParchesTerreno, obtenerParchesTerrenoTranslucido,
  obtenerParcheSolido, copiarParcheEnBuffer, hashCasilla,
} from "../src/render3d/patronTerreno";

// Patrón de suelo horneado (pedido streamer 2026-09-11, "la prueba B es lo
// que hay que hacer" tras comparar visualmente 3 técnicas). Función pura
// sobre Uint8ClampedArray, sin canvas — se puede testear en Node.

test("un parche tam x tam produce exactamente tam*tam*4 bytes, todos opacos (alfa=255)", () => {
  const p = generarParcheTerreno("cesped", [90, 156, 76], 8, 123);
  assert.equal(p.length, 8 * 8 * 4);
  for (let i = 3; i < p.length; i += 4) assert.equal(p[i], 255);
});

test("determinista: misma familia+color+semilla siempre da el mismo parche byte a byte", () => {
  const a = generarParcheTerreno("roca", [138, 138, 138], 8, 999);
  const b = generarParcheTerreno("roca", [138, 138, 138], 8, 999);
  assert.deepEqual([...a], [...b]);
});

test("semillas distintas dan parches distintos (no es un color plano disfrazado)", () => {
  const a = generarParcheTerreno("cesped", [90, 156, 76], 8, 1);
  const b = generarParcheTerreno("cesped", [90, 156, 76], 8, 2);
  assert.notDeepEqual([...a], [...b]);
});

test("el color medio del parche se mantiene cerca del color base (no lo desnaturaliza)", () => {
  const base: [number, number, number] = [90, 156, 76];
  const p = generarParcheTerreno("cesped", base, 16, 42);
  let sr = 0, sg = 0, sb = 0;
  const n = p.length / 4;
  for (let i = 0; i < p.length; i += 4) { sr += p[i]; sg += p[i + 1]; sb += p[i + 2]; }
  assert.ok(Math.abs(sr / n - base[0]) < 40, `rojo medio ${sr / n} lejos de ${base[0]}`);
  assert.ok(Math.abs(sg / n - base[1]) < 40, `verde medio ${sg / n} lejos de ${base[1]}`);
  assert.ok(Math.abs(sb / n - base[2]) < 40, `azul medio ${sb / n} lejos de ${base[2]}`);
});

test("las 6 familias originales generan sin lanzar excepción a varios tamaños", () => {
  const familias = ["cesped", "tierra", "camino", "roca", "arena", "nieve"] as const;
  for (const f of familias) for (const tam of [1, 4, 8, 16]) {
    const p = generarParcheTerreno(f, [128, 128, 128], tam, 7);
    assert.equal(p.length, tam * tam * 4);
  }
});

// Familias añadidas 2026-09-13 (pedido streamer: "aplícalo también a lo que
// falta" — agua/hielo/lecho quedaron sin patrón a propósito en la pasada
// original; "madera" es nueva para los muros de empalizada).
test("las 4 familias nuevas (agua/hielo/lecho/madera) generan sin lanzar excepción a varios tamaños, siempre opacas", () => {
  const familias = ["agua", "hielo", "lecho", "madera"] as const;
  for (const f of familias) for (const tam of [1, 4, 8, 16]) {
    const p = generarParcheTerreno(f, [80, 120, 160], tam, 7);
    assert.equal(p.length, tam * tam * 4);
    for (let i = 3; i < p.length; i += 4) assert.equal(p[i], 255, `${f} tam=${tam}: alfa debe salir opaco de generarParcheTerreno (el alfa translúcido de agua se fuerza aparte)`);
  }
});

test("familia 'lecho' comparte el algoritmo de 'arena' a propósito (mismo grano fino, distinto color base)", () => {
  const arena = generarParcheTerreno("arena", [200, 180, 120], 16, 42);
  const lecho = generarParcheTerreno("lecho", [200, 180, 120], 16, 42);
  assert.deepEqual([...arena], [...lecho]);
});

test("familia 'madera': se distinguen al menos 2 tonos de tabla (no un color plano disfrazado)", () => {
  const p = generarParcheTerreno("madera", [120, 90, 55], 16, 3);
  const tonos = new Set<number>();
  for (let i = 0; i < p.length; i += 4) tonos.add(p[i] * 65536 + p[i + 1] * 256 + p[i + 2]);
  assert.ok(tonos.size >= 3, `se esperaban varios tonos distintos (tablas+juntas+vetas), salieron ${tonos.size}`);
});

test("obtenerParchesTerrenoTranslucido: mismo RGB que la versión opaca, alfa forzado al valor pedido en TODOS los píxeles", () => {
  const opacos = obtenerParchesTerreno("agua", [60, 110, 180], 8);
  const translucidos = obtenerParchesTerrenoTranslucido("agua", [60, 110, 180], 8, 130);
  assert.equal(opacos.length, translucidos.length);
  for (let v = 0; v < opacos.length; v++) {
    for (let i = 0; i < opacos[v].length; i += 4) {
      assert.equal(translucidos[v][i], opacos[v][i], "R debe coincidir con la versión opaca");
      assert.equal(translucidos[v][i + 1], opacos[v][i + 1], "G debe coincidir con la versión opaca");
      assert.equal(translucidos[v][i + 2], opacos[v][i + 2], "B debe coincidir con la versión opaca");
      assert.equal(translucidos[v][i + 3], 130, "alfa debe ser el valor forzado, no 255");
    }
  }
});

test("obtenerParchesTerrenoTranslucido cachea por (familia,color,tam,alfa): dos llamadas iguales devuelven la MISMA referencia, un alfa distinto da una copia aparte", () => {
  const a = obtenerParchesTerrenoTranslucido("agua", [10, 20, 30], 4, 100);
  const b = obtenerParchesTerrenoTranslucido("agua", [10, 20, 30], 4, 100);
  assert.equal(a, b);
  const c = obtenerParchesTerrenoTranslucido("agua", [10, 20, 30], 4, 200);
  assert.notEqual(a, c);
  assert.equal(c[0][3], 200);
});

test("obtenerParchesTerrenoTranslucido nunca muta la caché opaca compartida (mutar una copia no puede corromper `obtenerParchesTerreno`)", () => {
  const opacosAntes = obtenerParchesTerreno("hielo", [200, 220, 230], 8).map((p) => [...p]);
  obtenerParchesTerrenoTranslucido("hielo", [200, 220, 230], 8, 50);
  const opacosDespues = obtenerParchesTerreno("hielo", [200, 220, 230], 8);
  for (let v = 0; v < opacosDespues.length; v++) {
    assert.deepEqual([...opacosDespues[v]], opacosAntes[v]);
    for (let i = 3; i < opacosDespues[v].length; i += 4) assert.equal(opacosDespues[v][i], 255);
  }
});

test("obtenerParcheTerreno cachea: dos llamadas con la misma clave devuelven la MISMA referencia", () => {
  const a = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 3);
  const b = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 3);
  assert.equal(a, b);
});

test("obtenerParcheTerreno con variantes distintas da parches distintos", () => {
  const a = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 0);
  const b = obtenerParcheTerreno("tierra", [122, 90, 58], 8, 1);
  assert.notDeepEqual([...a], [...b]);
});

test("obtenerParcheSolido: color uniforme exacto en todos los píxeles, cacheado por clave", () => {
  const p = obtenerParcheSolido(10, 20, 30, 200, 4);
  assert.equal(p.length, 4 * 4 * 4);
  for (let i = 0; i < p.length; i += 4) assert.deepEqual([p[i], p[i + 1], p[i + 2], p[i + 3]], [10, 20, 30, 200]);
  assert.equal(obtenerParcheSolido(10, 20, 30, 200, 4), p);
});

test("copiarParcheEnBuffer coloca el parche en la casilla correcta de un buffer más grande, sin tocar el resto", () => {
  const tam = 2;
  const parche = obtenerParcheSolido(255, 0, 0, 255, tam); // rojo puro
  const anchoTiles = 3, altoTiles = 2;
  const destino = new Uint8ClampedArray(anchoTiles * tam * altoTiles * tam * 4); // arranca todo en 0 (negro transparente)
  copiarParcheEnBuffer(destino, anchoTiles * tam, 1, 0, parche, tam); // casilla (1,0) de 3x2
  // los 2x2 píxeles de la casilla (1,0) deben ser rojo puro
  for (let dy = 0; dy < tam; dy++) for (let dx = 0; dx < tam; dx++) {
    const px = 1 * tam + dx, py = 0 * tam + dy;
    const i = (py * anchoTiles * tam + px) * 4;
    assert.deepEqual([destino[i], destino[i + 1], destino[i + 2], destino[i + 3]], [255, 0, 0, 255]);
  }
  // una casilla vecina (0,0) debe seguir en cero (no se ha escrito ahí)
  const i0 = (0 * anchoTiles * tam + 0) * 4;
  assert.deepEqual([destino[i0], destino[i0 + 1], destino[i0 + 2], destino[i0 + 3]], [0, 0, 0, 0]);
});

test("hashCasilla es determinista por posición: misma (gx,gy,sal) siempre el mismo valor", () => {
  assert.equal(hashCasilla(10, 20, 1), hashCasilla(10, 20, 1));
  assert.notEqual(hashCasilla(10, 20, 1), hashCasilla(11, 20, 1));
});
