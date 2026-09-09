import { test } from "node:test";
import assert from "node:assert/strict";
import { obtenerVolumenGuardado, guardarVolumen, obtenerVolumenMusicaGuardado, guardarVolumenMusica } from "../src/ajustes/configAjustes";

// Polyfill mínimo de `localStorage` para correr bajo `node --test` (no hay
// nada parecido fuera de un navegador) — el módulo real solo usa
// getItem/setItem/removeItem, así que un Map basta.
const almacen = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (almacen.has(k) ? almacen.get(k)! : null),
  setItem: (k: string, v: string) => { almacen.set(k, v); },
  removeItem: (k: string) => { almacen.delete(k); },
};

// Bug real encontrado verificando el hilo musical de fondo (2026-09-09,
// docs/GDD_Ajustes.md): `Number(localStorage.getItem(clave))` con la clave
// AUSENTE da `Number(null) === 0` (no `NaN`), y la validación
// `crudo>=0 && crudo<=100` lo aceptaba como si fuera un 0 GUARDADO a
// propósito — así que cualquier volumen de Ajustes arrancaba muteado en un
// navegador nuevo en vez de con su valor por defecto real (100 para
// instrumentos, 40 para música). Debe correr ANTES de cualquier test que
// guarde algo (el `Map` de arriba se comparte entre tests de este archivo).
test("localStorage nunca tocado da el default real, no 0 silencioso", () => {
  assert.equal(obtenerVolumenGuardado(), 100);
  assert.equal(obtenerVolumenMusicaGuardado(), 40);
});

test("guardar 0 de verdad se respeta como mute explícito (no se confunde con 'nunca guardado')", () => {
  guardarVolumen(0);
  assert.equal(obtenerVolumenGuardado(), 0);
  guardarVolumenMusica(0);
  assert.equal(obtenerVolumenMusicaGuardado(), 0);
});

test("guardar y releer un valor intermedio, cada bus por separado", () => {
  guardarVolumen(63);
  guardarVolumenMusica(12);
  assert.equal(obtenerVolumenGuardado(), 63);
  assert.equal(obtenerVolumenMusicaGuardado(), 12);
});
