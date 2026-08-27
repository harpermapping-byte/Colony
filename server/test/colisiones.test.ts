// Tests de la mecánica de colisiones — reglas de docs/GDD_Mecanicas.md.
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ, MundoColision } from "../src/mundo/colisiones";
import { cargarMapaColision } from "../src/mundo/mapaColision";

// Mundo sintético 8x8 desde un dibujo: . tierra, # sólido, ~ agua, P profunda
function mundoDe(filas: string[]): MundoColision {
  const alto = filas.length, ancho = filas[0].length;
  const casillas = new Uint8Array(ancho * alto);
  const velocidad = new Float32Array(ancho * alto).fill(1);
  const porChar: Record<string, number> = { ".": TIPO.TIERRA, "#": TIPO.SOLIDO, "~": TIPO.AGUA, P: TIPO.AGUA_PROFUNDA };
  filas.forEach((fila, y) => [...fila].forEach((c, x) => (casillas[y * ancho + x] = porChar[c])));
  return { ancho, alto, casillas, velocidad };
}

test("un sólido bloquea: el PJ se queda pegado al borde, sin atravesarlo", () => {
  const m = mundoDe(["....", ".#..", "....", "...."]);
  // avanzando en +x hacia la casilla sólida (1,1) desde su misma fila
  const r = moverAABB(m, 0.5, 1.5, 5, 0);
  assert.ok(r.x < 1 - RADIO_PJ + 0.01, `no debe entrar en la casilla sólida (x=${r.x})`);
  assert.ok(r.x > 0.5, "pero sí acercarse hasta el borde");
  assert.strictEqual(r.y, 1.5);
});

test("slide: chocar en un eje no anula el movimiento del otro", () => {
  const m = mundoDe(["....", ".#..", "....", "...."]);
  const r = moverAABB(m, 0.5, 1.5, 5, 1);
  assert.ok(r.x < 1, "el eje X queda bloqueado por la pared");
  assert.ok(r.y > 1.5, "el eje Y sigue avanzando (desliza)");
});

test("el borde del mapa es pared aunque el terreno sea transitable", () => {
  const m = mundoDe(["....", "....", "....", "...."]);
  const r = moverAABB(m, 0.5, 0.5, -5, -5);
  assert.ok(r.x >= RADIO_PJ - 0.01 && r.y >= RADIO_PJ - 0.01, `no se sale del mundo (${r.x},${r.y})`);
});

test("el agua NO bloquea: se entra andando (y el medio cambia)", () => {
  const m = mundoDe(["..~~", "..~~", "....", "...."]);
  const r = moverAABB(m, 1.5, 0.5, 1.2, 0);
  assert.ok(r.x > 2, "el agua se cruza, no es pared");
  assert.strictEqual(medioEn(m, r.x, r.y), TIPO.AGUA);
});

test("niveles de buceo por medio: tierra 0, agua -1, profunda -2", () => {
  assert.strictEqual(nivelMinimo(TIPO.TIERRA), 0);
  assert.strictEqual(nivelMinimo(TIPO.SOLIDO), 0);
  assert.strictEqual(nivelMinimo(TIPO.AGUA), -1);
  assert.strictEqual(nivelMinimo(TIPO.AGUA_PROFUNDA), -2);
});

test("dos PJ solapados se empujan hasta separarse (sin bloquearse)", () => {
  const m = mundoDe(["....", "....", "....", "...."]);
  const a = { x: 2.0, y: 2.0 }, b = { x: 2.1, y: 2.0 };
  separarPJs(m, [a, b]);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(d >= RADIO_PJ * 2 - 0.02, `separados al menos un diámetro (d=${d})`);
});

test("el empuje entre PJ nunca mete a nadie dentro de una pared", () => {
  const m = mundoDe(["#...", "#...", "#...", "#..."]);
  // a contra la pared de la izquierda, b encima empujándole hacia ella
  const a = { x: 1 + RADIO_PJ + 0.01, y: 2.0 };
  const b = { x: a.x + 0.1, y: 2.0 };
  separarPJs(m, [a, b]);
  assert.ok(a.x >= 1 + RADIO_PJ - 0.02, `a no acaba dentro de la pared (x=${a.x})`);
});

test("el mapa demo bakeado carga: 48x48, spawn pisable y agua para bucear", () => {
  const mapa = cargarMapaColision();
  assert.strictEqual(mapa.ancho, 48);
  assert.strictEqual(mapa.alto, 48);
  assert.strictEqual(medioEn(mapa, mapa.spawnX, mapa.spawnY), TIPO.TIERRA, "se aparece en suelo firme");
  let profunda = 0, solidos = 0;
  for (const t of mapa.casillas) {
    if (t === TIPO.AGUA_PROFUNDA) profunda++;
    if (t === TIPO.SOLIDO) solidos++;
  }
  assert.ok(profunda > 0, "el demo tiene agua profunda (para probar el buceo)");
  assert.ok(solidos > 0, "y sólidos (roca inaccesible + piezas con colision)");
});
