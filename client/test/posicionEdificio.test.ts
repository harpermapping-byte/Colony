import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { posicionEsquinaEdificio } from "../src/render3d/posicionEdificio";

// Fix esquina-vs-centro de edificios (pedido streamer 2026-09-11: "la
// colision NO COINCIDE con la forma"). Función pura — usa las clases de
// math de `three` (sin DOM/WebGL, corren igual en Node).

test("sin rotación: la esquina cae ancho/2, largo/2 al oeste/norte del centro", () => {
  const centro = new Vector3(10, 0, 20);
  const r = posicionEsquinaEdificio(centro, new Quaternion(), 8, 6, 1);
  assert.ok(Math.abs(r.x - 6) < 1e-9, r.x); // 10 - 8/2
  assert.ok(Math.abs(r.z - 17) < 1e-9, r.z); // 20 - 6/2
});

test("no muta el vector centroFootprint recibido", () => {
  const centro = new Vector3(10, 0, 20);
  posicionEsquinaEdificio(centro, new Quaternion(), 8, 6, 1);
  assert.equal(centro.x, 10);
  assert.equal(centro.z, 20);
});

test("rotación de 180°: la esquina cae al lado OPUESTO del centro", () => {
  const centro = new Vector3(0, 0, 0);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const r = posicionEsquinaEdificio(centro, q, 8, 6, 1);
  assert.ok(Math.abs(r.x - 4) < 1e-9, r.x); // -(-8/2)
  assert.ok(Math.abs(r.z - 3) < 1e-9, r.z);
});

test("rotación de 90°: ancho y largo se intercambian de eje (mismo convenio de rotación Y que el resto de sectorVisual.ts)", () => {
  const centro = new Vector3(0, 0, 0);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const r = posicionEsquinaEdificio(centro, q, 8, 6, 1);
  // offset local (4,0,3) rotado 90° en el convenio de Three.js (x'=x·cosθ+z·sinθ, z'=-x·sinθ+z·cosθ) -> (3,0,-4)
  assert.ok(Math.abs(r.x - -3) < 1e-6, r.x);
  assert.ok(Math.abs(r.z - 4) < 1e-6, r.z);
});

test("escala: el offset escala junto con el edificio", () => {
  const centro = new Vector3(10, 0, 10);
  const r1 = posicionEsquinaEdificio(centro, new Quaternion(), 8, 6, 1);
  const r2 = posicionEsquinaEdificio(centro, new Quaternion(), 8, 6, 2);
  assert.ok(Math.abs((10 - r2.x) - 2 * (10 - r1.x)) < 1e-9, `r1=${r1.x} r2=${r2.x}`);
});

test("caso real medido: edificio 9x6 a 45°, el centro esperado del footprint queda dentro de la huella tras aplicar la esquina y volver a sumar la mitad rotada", () => {
  // Reproduce sectorVisual.ts: posicion = centro - offset(rotado); el
  // footprint real (centro ± mitad rotada) debe seguir centrado en el
  // punto ORIGINAL — ida y vuelta exacta.
  const centroOriginal = new Vector3(95.6, 0, 85.4);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (45 * Math.PI) / 180);
  const esquina = posicionEsquinaEdificio(centroOriginal, q, 9, 6, 1);
  const vueltaAlCentro = esquina.clone().add(new Vector3(9 / 2, 0, 6 / 2).applyQuaternion(q));
  assert.ok(vueltaAlCentro.distanceTo(centroOriginal) < 1e-9, vueltaAlCentro);
});
