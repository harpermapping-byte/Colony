import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  AnimadorFaunaDecorativaSector,
  type IndividuoFaunaDecorativa,
} from "../src/render3d/faunaDecorativaMovimiento";

// Suite del vagabundeo/manada de fauna decorativa (docs/GDD_Agentes_Moviles.md,
// pedido 2026-09-09 "la fauna decorativa se debe mover... los patrones de
// manada que ya pusimos") — lógica pura, sin navegador (THREE.InstancedMesh/
// Matrix4 funcionan igual en Node). Ejecutar:
// node --import tsx --test client/test/faunaDecorativaMovimiento.test.ts

const SIEMPRE_TRANSITABLE = () => true;
const NUNCA_TRANSITABLE = () => false;

function instanciadoFalso(count: number): THREE.InstancedMesh {
  return new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), count);
}

function individuo(overrides: Partial<IndividuoFaunaDecorativa> & { homeX: number; homeY: number }): IndividuoFaunaDecorativa {
  return {
    especieId: "conejo",
    gregario: false,
    instanciado: instanciadoFalso(1),
    indice: 0,
    x: overrides.homeX,
    y: overrides.homeY,
    rotY: 0,
    escala: 1,
    destino: null,
    pausaRestante: 0,
    oculto: false,
    acuatico: false,
    ...overrides,
  };
}

function posicionDeMatriz(ind: IndividuoFaunaDecorativa): { x: number; z: number } {
  const m = new THREE.Matrix4();
  ind.instanciado.getMatrixAt(ind.indice, m);
  const pos = new THREE.Vector3();
  m.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
  return { x: pos.x, z: pos.z };
}

test("actualizar: por debajo del intervalo de throttling (150ms), no hace nada", () => {
  const ind = individuo({ homeX: 5, homeY: 5, pausaRestante: 0 });
  const animador = new AnimadorFaunaDecorativaSector([ind], SIEMPRE_TRANSITABLE);
  animador.actualizar(50);
  animador.actualizar(50);
  assert.strictEqual(ind.destino, null, "50+50=100ms, todavía por debajo de 150ms");
});

test("actualizar: al superar el intervalo, un individuo sin pausa elige destino (nunca se mueve en el mismo tick que lo elige)", () => {
  const ind = individuo({ homeX: 5, homeY: 5, pausaRestante: 0 });
  const animador = new AnimadorFaunaDecorativaSector([ind], SIEMPRE_TRANSITABLE);
  animador.actualizar(200);
  assert.ok(ind.destino, "debería haber elegido un destino");
  assert.strictEqual(ind.x, 5, "no se mueve en el mismo tick que elige destino");
  assert.strictEqual(ind.y, 5);
});

test("actualizar: con destino activo, avanza hacia él a VEL=1 casilla/seg", () => {
  const ind = individuo({ homeX: 5, homeY: 5, destino: { x: 8, y: 5 } });
  const animador = new AnimadorFaunaDecorativaSector([ind], SIEMPRE_TRANSITABLE);
  animador.actualizar(500); // 0.5s * VEL(1) = 0.5 casillas
  assert.ok(Math.abs(ind.x - 5.5) < 1e-6, `esperaba x≈5.5, salió ${ind.x}`);
  assert.strictEqual(ind.y, 5);
  assert.ok(ind.destino, "sigue caminando, no ha llegado");
});

test("actualizar: un individuo oculto (recolectado en vivo) nunca se recompone — su matriz se queda tal cual el ocultamiento la dejó", () => {
  const ind = individuo({ homeX: 5, homeY: 5, destino: { x: 8, y: 5 }, oculto: true });
  const matrizAntes = new THREE.Matrix4();
  ind.instanciado.getMatrixAt(ind.indice, matrizAntes);
  const animador = new AnimadorFaunaDecorativaSector([ind], SIEMPRE_TRANSITABLE);
  animador.actualizar(1000);
  assert.strictEqual(ind.x, 5, "no se mueve aunque tenga destino activo");
  assert.strictEqual(ind.destino!.x, 8, "el destino no se limpia ni se toca — el individuo simplemente se ignora");
  const matrizDespues = new THREE.Matrix4();
  ind.instanciado.getMatrixAt(ind.indice, matrizDespues);
  assert.deepStrictEqual(matrizAntes.toArray(), matrizDespues.toArray(), "la matriz de instancia nunca se reescribe estando oculto");
});

test("actualizar: al llegar al destino, lo limpia y fija una pausa de 2-6s", () => {
  const ind = individuo({ homeX: 5, homeY: 5, destino: { x: 5.2, y: 5 } });
  const animador = new AnimadorFaunaDecorativaSector([ind], SIEMPRE_TRANSITABLE);
  animador.actualizar(1000); // 1s * VEL(1) = 1 casilla > 0.2 restante
  assert.strictEqual(ind.destino, null);
  assert.strictEqual(ind.x, 5.2, "snap exacto al destino, no de largo");
  assert.ok(ind.pausaRestante >= 2 && ind.pausaRestante <= 6, `pausa fuera de rango: ${ind.pausaRestante}`);
});

test("actualizar: nunca elige un destino fuera de lo transitable — se queda en pausa corta si los 6 intentos fallan", () => {
  const ind = individuo({ homeX: 5, homeY: 5, pausaRestante: 0 });
  const animador = new AnimadorFaunaDecorativaSector([ind], NUNCA_TRANSITABLE);
  animador.actualizar(200);
  assert.strictEqual(ind.destino, null, "sin hueco transitable, no debería tener destino");
  assert.strictEqual(ind.pausaRestante, 2, "pausa fija de 2s cuando fallan los 6 intentos");
});

test("acuático: el comprobador de transitabilidad recibe el flag acuatico del individuo, nunca ignorado (bug real 2026-09-09: 'los peces se salen del agua')", () => {
  // Mapa de "agua" muy simple: transitable SOLO si acuatico===true — el
  // inverso exacto de un animal de tierra normal. Si el pez pasara `false`
  // (o el comprobador ignorase el parámetro), nunca encontraría destino.
  const soloAguaSiAcuatico = (_x: number, _y: number, acuatico: boolean) => acuatico;
  const pez = individuo({ homeX: 5, homeY: 5, pausaRestante: 0, acuatico: true });
  const animadorPez = new AnimadorFaunaDecorativaSector([pez], soloAguaSiAcuatico);
  animadorPez.actualizar(200);
  assert.ok(pez.destino, "el pez SÍ debería encontrar destino en agua (acuatico=true pasado correctamente)");

  const conejo = individuo({ homeX: 5, homeY: 5, pausaRestante: 0, acuatico: false });
  const animadorConejo = new AnimadorFaunaDecorativaSector([conejo], soloAguaSiAcuatico);
  animadorConejo.actualizar(200);
  assert.strictEqual(conejo.destino, null, "un animal de tierra (acuatico=false) NUNCA debería elegir una casilla que solo es transitable para acuáticos");
});

test("actualizar: recompone la matriz de instancia real (posición visual = x+0.5, y+0.5 en el eje Z)", () => {
  const ind = individuo({ homeX: 10, homeY: 20, destino: { x: 10, y: 21 } });
  const animador = new AnimadorFaunaDecorativaSector([ind], SIEMPRE_TRANSITABLE);
  animador.actualizar(200);
  const { x, z } = posicionDeMatriz(ind);
  assert.ok(Math.abs(x - (ind.x + 0.5)) < 1e-5);
  assert.ok(Math.abs(z - (ind.y + 0.5)) < 1e-5);
});

test("manada: dos gregarios cercanos (dentro de RADIO_MANADA=10) tienden a caminar el uno hacia el otro en media, más que dos no-gregarios a la misma distancia", () => {
  const a = individuo({ especieId: "conejo", gregario: true, homeX: 5, homeY: 5, x: 5, y: 5 });
  const b = individuo({ especieId: "conejo", gregario: true, homeX: 13, homeY: 5, x: 13, y: 5, instanciado: instanciadoFalso(1) });
  const animadorGregario = new AnimadorFaunaDecorativaSector([a, b], SIEMPRE_TRANSITABLE);

  const c = individuo({ especieId: "lobo", gregario: false, homeX: 5, homeY: 5, x: 5, y: 5 });
  const d = individuo({ especieId: "lobo", gregario: false, homeX: 13, homeY: 5, x: 13, y: 5, instanciado: instanciadoFalso(1) });
  const animadorSolitario = new AnimadorFaunaDecorativaSector([c, d], SIEMPRE_TRANSITABLE);

  const distanciasGregario: number[] = [];
  const distanciasSolitario: number[] = [];
  for (let i = 0; i < 400; i++) {
    animadorGregario.actualizar(300);
    animadorSolitario.actualizar(300);
    if (i >= 300) {
      distanciasGregario.push(Math.hypot(a.x - b.x, a.y - b.y));
      distanciasSolitario.push(Math.hypot(c.x - d.x, c.y - d.y));
    }
  }
  const mediaGregario = distanciasGregario.reduce((s, v) => s + v, 0) / distanciasGregario.length;
  const mediaSolitario = distanciasSolitario.reduce((s, v) => s + v, 0) / distanciasSolitario.length;
  assert.ok(
    mediaGregario < mediaSolitario - 0.5,
    `esperaba que los gregarios quedaran más cerca en media (gregario=${mediaGregario}, solitario=${mediaSolitario})`,
  );
});

test("manada: el vagabundeo se queda SIEMPRE acotado cerca de HOME (nunca deriva sin límite como el servidor con vida persistida) — a diferencia del servidor, la base del paseo es homeX/homeY, no la posición actual", () => {
  const a = individuo({ especieId: "conejo", gregario: true, homeX: 5, homeY: 5, x: 5, y: 5 });
  const b = individuo({ especieId: "conejo", gregario: true, homeX: 13, homeY: 5, x: 13, y: 5, instanciado: instanciadoFalso(1) });
  const animador = new AnimadorFaunaDecorativaSector([a, b], SIEMPRE_TRANSITABLE);
  for (let i = 0; i < 600; i++) animador.actualizar(300);
  // RADIO_MERODEO=3 + el desplazamiento del centro por cohesión (15% de la
  // distancia al centroide) nunca puede alejar el destino más de unas
  // pocas casillas de HOME — nunca "migra" indefinidamente hacia el otro.
  assert.ok(Math.hypot(a.x - 5, a.y - 5) < 6, `a se alejó demasiado de su home: ${a.x},${a.y}`);
  assert.ok(Math.hypot(b.x - 13, b.y - 5) < 6, `b se alejó demasiado de su home: ${b.x},${b.y}`);
});

test("varios individuos en el mismo InstancedMesh: cada uno mueve SOLO su propio índice", () => {
  const compartido = instanciadoFalso(2);
  const a = individuo({ homeX: 0, homeY: 0, x: 0, y: 0, destino: { x: 3, y: 0 }, instanciado: compartido, indice: 0 });
  const b = individuo({ homeX: 20, homeY: 20, x: 20, y: 20, destino: null, pausaRestante: 999, instanciado: compartido, indice: 1 });
  const animador = new AnimadorFaunaDecorativaSector([a, b], SIEMPRE_TRANSITABLE);
  animador.actualizar(500);
  assert.ok(a.x > 0, "a debería haberse movido");
  assert.strictEqual(b.x, 20, "b tiene pausa larga, no debería moverse");
  const posA = posicionDeMatriz(a);
  const posB = posicionDeMatriz(b);
  assert.ok(Math.abs(posB.x - 20.5) < 1e-5, "la matriz del índice 1 (b) no debería haberse pisado con la de a");
  assert.ok(Math.abs(posA.x - (a.x + 0.5)) < 1e-5);
});
