import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RADIO_FAUNA_DECORATIVA_VISIBLE, RADIO_FAUNA_DECORATIVA_OCULTAR } from "../src/render3d/faunaDecorativaMovimiento";
// Type-only: se borra en compilación, nunca dispara la evaluación real del
// módulo (mismo criterio ya establecido en sectorVisualDispose.test.ts).
import type { RegistroInstanciaProp } from "../src/render3d/sectorVisual";

// Culling real por distancia de vegetación/rocas (docs/GDD_Rendimiento.md,
// pedido streamer 2026-09-14: "cargan mas de 30 en pantalla... lo de que
// cargue solo lo que se ve en pantalla no esta funcionando") — lógica pura
// sobre THREE.InstancedMesh/Matrix4 (funcionan igual en Node), sin
// necesitar navegador. `sectorVisual.ts` importa (vía mundo/nieve.ts ->
// mundo/tiempoMundo.ts) un `location.search` leído en el CUERPO del módulo
// — stub + import DINÁMICO, mismo patrón ya establecido en
// sectorVisualDispose.test.ts. Ejecutar:
//   node --import tsx --test client/test/visibilidadPropsPorDistancia.test.ts
(globalThis as any).location = { search: "" };
const { ControladorVisibilidadProps } = await import("../src/render3d/sectorVisual");

function instanciadoFalso(count: number): THREE.InstancedMesh {
  return new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), count);
}

function matrizEnIndice(instanciado: THREE.InstancedMesh, indice: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  instanciado.getMatrixAt(indice, m);
  return m;
}

// Bug real encontrado escribiendo este mismo test, no del código de
// producción: `Matrix4.decompose()` tiene un fallback DEFENSIVO en Three.js
// para matrices singulares (determinante 0, como CUALQUIER escala-cero) que
// devuelve escala (1,1,1) — NUNCA (0,0,0) — precisamente para evitar
// dividir por cero al extraer la rotación (ver Matrix4.js::decompose,
// `if (det === 0) { scale.set(1,1,1); ... }`). Comprobar "¿está oculta?"
// con decompose() habría dado SIEMPRE un falso negativo. Comparar los
// elementos crudos de la matriz es la forma correcta.
function esCero(m: THREE.Matrix4): boolean {
  return m.equals(new THREE.Matrix4().makeScale(0, 0, 0));
}

function registro(overrides: Partial<RegistroInstanciaProp> & { x: number; y: number }): RegistroInstanciaProp {
  const instanciado = overrides.instanciado ?? instanciadoFalso(1);
  const indice = overrides.indice ?? 0;
  const matrizOriginal = overrides.matrizOriginal ?? new THREE.Matrix4().compose(
    new THREE.Vector3(overrides.x, 0, overrides.y),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
  );
  instanciado.setMatrixAt(indice, matrizOriginal);
  return {
    instanciado,
    indice,
    x: overrides.x,
    y: overrides.y,
    matrizOriginal,
    visible: overrides.visible ?? true,
    permanentementeOculto: overrides.permanentementeOculto ?? false,
  };
}

const INTERVALO_MS = 200; // debe coincidir con INTERVALO_ACTUALIZACION_VISIBILIDAD_PROPS_MS (privado a sectorVisual.ts)
const LEJOS = RADIO_FAUNA_DECORATIVA_OCULTAR + 10;
const CERCA = RADIO_FAUNA_DECORATIVA_VISIBLE - 5;

test("ControladorVisibilidadProps: oculta una instancia lejana (más allá de RADIO_OCULTAR)", () => {
  const r = registro({ x: 0, y: 0 });
  const c = new ControladorVisibilidadProps([r]);
  c.actualizar(INTERVALO_MS, LEJOS, 0);
  assert.equal(r.visible, false);
  assert.ok(esCero(matrizEnIndice(r.instanciado, r.indice)), "la matriz debe quedar a escala 0");
});

test("ControladorVisibilidadProps: NO hace nada antes de cumplirse el intervalo de cesión", () => {
  const r = registro({ x: 0, y: 0 });
  const c = new ControladorVisibilidadProps([r]);
  c.actualizar(INTERVALO_MS - 1, LEJOS, 0);
  assert.equal(r.visible, true, "todavía no debería haber evaluado la distancia");
});

test("ControladorVisibilidadProps: restaura la matriz ORIGINAL exacta al volver a estar cerca", () => {
  const r = registro({ x: 10, y: 20 });
  const original = r.matrizOriginal.clone();
  const c = new ControladorVisibilidadProps([r]);
  c.actualizar(INTERVALO_MS, r.x + LEJOS, r.y); // se aleja -> se oculta
  assert.equal(r.visible, false);
  c.actualizar(INTERVALO_MS, r.x + CERCA, r.y); // se acerca -> vuelve a mostrarse
  assert.equal(r.visible, true);
  const restaurada = matrizEnIndice(r.instanciado, r.indice);
  assert.ok(restaurada.equals(original), "debe restaurar EXACTAMENTE la matriz original, no una aproximación");
});

test("ControladorVisibilidadProps: histéresis — no parpadea en la zona entre los dos radios", () => {
  const r = registro({ x: 0, y: 0 });
  const c = new ControladorVisibilidadProps([r]);
  const distanciaIntermedia = (RADIO_FAUNA_DECORATIVA_VISIBLE + RADIO_FAUNA_DECORATIVA_OCULTAR) / 2;
  c.actualizar(INTERVALO_MS, distanciaIntermedia, 0); // arranca visible, sigue visible (nunca cruzó RADIO_OCULTAR)
  assert.equal(r.visible, true);
  c.actualizar(INTERVALO_MS, LEJOS, 0); // ahora sí cruza -> oculto
  assert.equal(r.visible, false);
  c.actualizar(INTERVALO_MS, distanciaIntermedia, 0); // vuelve a la zona intermedia -> sigue oculto (no cruzó RADIO_VISIBLE)
  assert.equal(r.visible, false);
});

test("ControladorVisibilidadProps: un registro permanentementeOculto NUNCA se restaura, ni estando cerca", () => {
  const r = registro({ x: 0, y: 0 });
  const c = new ControladorVisibilidadProps([r]);
  c.actualizar(INTERVALO_MS, LEJOS, 0);
  assert.equal(r.visible, false);
  // Simula una recolección/tala real en vivo (docs/GDD_Bosques.md §7):
  // ocultarPosicion pone la matriz a cero Y marca permanentementeOculto.
  r.instanciado.setMatrixAt(r.indice, new THREE.Matrix4().makeScale(0, 0, 0));
  r.permanentementeOculto = true;
  c.actualizar(INTERVALO_MS, 0, 0); // el jugador vuelve justo encima
  assert.ok(esCero(matrizEnIndice(r.instanciado, r.indice)), "debe seguir a cero: talado/recolectado de verdad, no 'lejos'");
});

test("ControladorVisibilidadProps: varios registros del MISMO InstancedMesh marcan needsUpdate una sola vez, cada uno con su propio estado", () => {
  // Bug real de TEST encontrado escribiendo esta prueba, no del código de
  // producción: `BufferAttribute.needsUpdate` es un accessor de SOLO
  // ESCRITURA en Three.js (ver BufferAttribute.js: `set needsUpdate(value){
  // if (value===true) this.version++; }`, sin ningún `get` correspondiente)
  // — leerlo de vuelta siempre da `undefined`, nunca el último valor
  // asignado. La forma correcta de comprobar "¿se marcó needsUpdate?" es
  // mirar si `version` (propiedad de instancia normal, sí legible) subió.
  const instanciado = instanciadoFalso(2);
  const cerca = registro({ x: 0, y: 0, instanciado, indice: 0 });
  const lejos = registro({ x: 1000, y: 1000, instanciado, indice: 1 });
  const c = new ControladorVisibilidadProps([cerca, lejos]);
  const versionAntes = instanciado.instanceMatrix.version;
  c.actualizar(INTERVALO_MS, 0, 0);
  assert.equal(cerca.visible, true, "el jugador está literalmente encima, sigue visible");
  assert.equal(lejos.visible, false, "a 1000+ casillas, se oculta");
  assert.ok(instanciado.instanceMatrix.version > versionAntes, "needsUpdate=true debe subir version (write-only, ver comentario arriba)");
});

test("ControladorVisibilidadProps: sector sin registro (edificios/decoración, nunca añadidos) no hace nada, sin explotar", () => {
  const c = new ControladorVisibilidadProps([]);
  assert.doesNotThrow(() => c.actualizar(INTERVALO_MS, 0, 0));
});
