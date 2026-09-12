import { test } from "node:test";
import assert from "node:assert/strict";
import {
  obtenerModoControlesGuardado,
  guardarModoControles,
  resolverControlesActivos,
  onCambioControlesTactiles,
} from "../src/controles/deteccionControl";

// Mismo polyfill mínimo que configAjustes.test.ts — el módulo real solo usa
// getItem/setItem, un Map basta para correr bajo `node --test`.
const almacen = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (almacen.has(k) ? almacen.get(k)! : null),
  setItem: (k: string, v: string) => { almacen.set(k, v); },
  removeItem: (k: string) => { almacen.delete(k); },
};

test("resolverControlesActivos: 'auto' sigue al dispositivo real", () => {
  assert.equal(resolverControlesActivos("auto", true), true);
  assert.equal(resolverControlesActivos("auto", false), false);
});

test("resolverControlesActivos: 'siempre'/'nunca' fuerzan el resultado sin importar el dispositivo", () => {
  assert.equal(resolverControlesActivos("siempre", false), true);
  assert.equal(resolverControlesActivos("siempre", true), true);
  assert.equal(resolverControlesActivos("nunca", true), false);
  assert.equal(resolverControlesActivos("nunca", false), false);
});

test("sin nada guardado, el modo por defecto es 'auto'", () => {
  assert.equal(obtenerModoControlesGuardado(), "auto");
});

test("guardarModoControles persiste y se relee tal cual", () => {
  guardarModoControles("siempre");
  assert.equal(obtenerModoControlesGuardado(), "siempre");
  guardarModoControles("nunca");
  assert.equal(obtenerModoControlesGuardado(), "nunca");
  guardarModoControles("auto");
  assert.equal(obtenerModoControlesGuardado(), "auto");
});

test("un valor corrupto/inesperado en localStorage cae a 'auto', nunca revienta", () => {
  almacen.set("ajustesControlesTactiles", "cualquier-cosa-rara");
  assert.equal(obtenerModoControlesGuardado(), "auto");
  almacen.delete("ajustesControlesTactiles");
});

test("guardarModoControles avisa a los suscritos con onCambioControlesTactiles", () => {
  let avisos = 0;
  onCambioControlesTactiles(() => { avisos++; });
  guardarModoControles("siempre");
  guardarModoControles("nunca");
  assert.equal(avisos, 2);
  guardarModoControles("auto");
});
