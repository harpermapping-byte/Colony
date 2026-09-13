import { test } from "node:test";
import assert from "node:assert/strict";
import { debeAbrirGuiaAutomaticamente } from "../src/ui/panelTutorial";
import { SECCIONES_GUIA, HISTORIAL_CAMBIOS } from "../src/ui/contenidoAyuda";

// Polyfill mínimo de `localStorage` para correr bajo `node --test` (mismo
// patrón que configAjustes.test.ts).
const almacen = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (almacen.has(k) ? almacen.get(k)! : null),
  setItem: (k: string, v: string) => { almacen.set(k, v); },
  removeItem: (k: string) => { almacen.delete(k); },
};

// Guía rápida + Novedades (docs/GDD_UI_Paneles.md, pedido streamer
// 2026-09-13): la preferencia de "no mostrar automáticamente" y el
// contenido curado que pinta el panel — sin DOM, panelBase.ts solo toca
// `document` DENTRO de sus funciones, nunca al importarse.

test("debeAbrirGuiaAutomaticamente: por defecto (localStorage nunca tocado) se abre sola", () => {
  assert.equal(debeAbrirGuiaAutomaticamente(), true);
});

test("debeAbrirGuiaAutomaticamente: respeta la preferencia guardada de no auto-abrir", () => {
  localStorage.setItem("colonyOcultarGuiaInicioAuto", "1");
  assert.equal(debeAbrirGuiaAutomaticamente(), false);
  localStorage.setItem("colonyOcultarGuiaInicioAuto", "0");
  assert.equal(debeAbrirGuiaAutomaticamente(), true);
});

test("SECCIONES_GUIA: cada sección tiene icono/título/texto reales, sin huecos", () => {
  assert.ok(SECCIONES_GUIA.length >= 10, "debería cubrir bastantes mecánicas reales del juego");
  for (const s of SECCIONES_GUIA) {
    assert.ok(s.icono.length > 0);
    assert.ok(s.titulo.trim().length > 0);
    assert.ok(s.texto.trim().length > 10, `texto demasiado corto para "${s.titulo}"`);
  }
});

test("HISTORIAL_CAMBIOS: entradas con fecha y al menos un cambio real, sin fechas repetidas", () => {
  assert.ok(HISTORIAL_CAMBIOS.length > 0, "el changelog no puede empezar vacío");
  const fechas = new Set<string>();
  for (const entrada of HISTORIAL_CAMBIOS) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha), `fecha con formato raro: "${entrada.fecha}"`);
    assert.ok(entrada.cambios.length > 0, `entrada de ${entrada.fecha} sin ningún cambio listado`);
    for (const cambio of entrada.cambios) assert.ok(cambio.trim().length > 5);
    assert.ok(!fechas.has(entrada.fecha), `fecha duplicada: ${entrada.fecha} — añade los cambios a la entrada ya existente en vez de una nueva`);
    fechas.add(entrada.fecha);
  }
});

test("HISTORIAL_CAMBIOS: viene ordenado de más reciente a más antiguo (se añade al principio)", () => {
  for (let i = 1; i < HISTORIAL_CAMBIOS.length; i++) {
    assert.ok(
      HISTORIAL_CAMBIOS[i - 1].fecha >= HISTORIAL_CAMBIOS[i].fecha,
      `"${HISTORIAL_CAMBIOS[i - 1].fecha}" debería ser >= "${HISTORIAL_CAMBIOS[i].fecha}"`,
    );
  }
});
