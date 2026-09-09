import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
// Type-only: se borra en compilación, nunca dispara la evaluación real del
// módulo (a diferencia del import de valor de abajo) — seguro de tener
// arriba del todo.
import type { HandleSector } from "../src/render3d/sectorVisual";

// sectorVisual.ts importa (vía mundo/nieve.ts -> mundo/tiempoMundo.ts) un
// `location.search` leído en el CUERPO del módulo, no dentro de una función
// — en un test Node puro (sin navegador) eso revienta al importar. Import
// DINÁMICO tras el stub (no uno estático: los imports estáticos de VALOR se
// evalúan SIEMPRE antes que el resto del cuerpo del propio archivo, sin
// importar dónde se escriban) — ningún otro test de este repo había
// importado sectorVisual.ts directamente hasta ahora, primer choque real
// con este límite ya existente de tiempoMundo.ts.
(globalThis as any).location = { search: "" };
const { soltarSectorVisual } = await import("../src/render3d/sectorVisual");

// soltarSectorVisual — leak de GPU real encontrado y cerrado 2026-09-09 (un
// workflow de investigación lo reprodujo con un stall de hasta 42s tras
// acumular miles de InstancedMesh efímeros sin `.dispose()` propio, aparte
// de geometry/material): InstancedMesh.dispose() libera el buffer GPU de
// `instanceMatrix` — DISTINTO de geometry/material (que sí pueden ser
// compartidos entre sectores, p.ej. una plantilla `.glb` o una malla de
// fauna decorativa cacheada) — así que debe llamarse SIEMPRE, esté o no
// marcado `propioDelSector`, mientras que geometry/material solo se
// disponen si SÍ lo está (nunca tocar una plantilla compartida con otro
// sector materializado a la vez).
// Ejecutar: node --import tsx --test client/test/sectorVisualDispose.test.ts

interface ContadorDispose {
  disposeInstanciado: number;
  disposeGeom: number;
  disposeMat: number;
}

function handleFalso(): {
  handle: HandleSector;
  compartido: ContadorDispose;
  propio: ContadorDispose;
} {
  const grupo = new THREE.Group();

  // Devuelve el CONTADOR por REFERENCIA (nunca un spread — un spread copia
  // los valores en ese instante, así que los incrementos posteriores de
  // dispose() no se reflejarían en la copia devuelta; bug real que tuvo
  // este mismo test al escribirlo, encontrado con una prueba aislada de
  // three.js confirmando que el patrón de espiar sí funciona).
  function espiado(marcarPropio: boolean): ContadorDispose {
    const geometria = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const instanciado = new THREE.InstancedMesh(geometria, material, 3);
    const contador: ContadorDispose = { disposeInstanciado: 0, disposeGeom: 0, disposeMat: 0 };
    const disposeInstanciadoOriginal = instanciado.dispose.bind(instanciado);
    instanciado.dispose = () => { contador.disposeInstanciado++; disposeInstanciadoOriginal(); };
    const disposeGeomOriginal = geometria.dispose.bind(geometria);
    geometria.dispose = () => { contador.disposeGeom++; disposeGeomOriginal(); };
    const disposeMatOriginal = material.dispose.bind(material);
    material.dispose = () => { contador.disposeMat++; disposeMatOriginal(); };
    if (marcarPropio) instanciado.userData.propioDelSector = true;
    grupo.add(instanciado);
    return contador;
  }

  const compartido = espiado(false); // p.ej. plantilla .glb / malla de fauna decorativa cacheada por entityLoader/faunaDecorativaPool
  const propio = espiado(true); // p.ej. placeholder de caja generado solo para este sector

  const handle: HandleSector = {
    grupo,
    ocultarPosicion: () => {},
    actualizarFaunaDecorativa: () => {},
  };
  return { handle, compartido, propio };
}

test("soltarSectorVisual: dispone el buffer de instancia de TODO InstancedMesh, esté o no marcado propioDelSector", () => {
  const { handle, compartido, propio } = handleFalso();
  soltarSectorVisual(handle);
  assert.strictEqual(compartido.disposeInstanciado, 1, "el InstancedMesh compartido también debe liberar su propio buffer de instancia");
  assert.strictEqual(propio.disposeInstanciado, 1);
});

test("soltarSectorVisual: NUNCA dispone geometry/material de un InstancedMesh compartido (no propioDelSector)", () => {
  const { handle, compartido } = handleFalso();
  soltarSectorVisual(handle);
  assert.strictEqual(compartido.disposeGeom, 0, "geometría compartida — otro sector materializado a la vez la sigue necesitando");
  assert.strictEqual(compartido.disposeMat, 0);
});

test("soltarSectorVisual: SÍ dispone geometry/material de un InstancedMesh propioDelSector", () => {
  const { handle, propio } = handleFalso();
  soltarSectorVisual(handle);
  assert.strictEqual(propio.disposeGeom, 1);
  assert.strictEqual(propio.disposeMat, 1);
});

test("soltarSectorVisual: vacía el grupo de escena al terminar", () => {
  const { handle } = handleFalso();
  assert.ok(handle.grupo.children.length > 0);
  soltarSectorVisual(handle);
  assert.strictEqual(handle.grupo.children.length, 0);
});
