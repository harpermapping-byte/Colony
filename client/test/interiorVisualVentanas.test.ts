import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { crearInteriorVisual, type InteriorBakeado } from "../src/render3d/interiorVisual";

// Ventanas visibles en el render de interiores (pedido streamer 2026-09-08:
// "interiores mucho más realistas... que se vieran ventanas en las paredes
// que no estorban a la vista") — antes `resultado.ventanas` solo sumaba luz
// ambiente, nunca se dibujaba nada; ver interiorVisual.ts. Prueba estructural
// (sin WebGL real, solo construcción de THREE.Group/Mesh, que no necesita
// canvas) — la verificación visual con servidor+cliente+Playwright queda
// como pendiente documentado, mismo criterio ya usado en otras piezas de
// render 3D de esta sesión.

function interiorConVentana(ventanas: NonNullable<InteriorBakeado["plantas"][0]["salas"][0]["resultado"]["ventanas"]>): InteriorBakeado {
  return {
    id: "test_interior",
    tipoEdificioId: "casa_pequena",
    plantas: [
      {
        nivel: 0,
        rol: "planta_baja",
        salas: [
          {
            tipoSalaId: "salon",
            offsetX: 0,
            offsetY: 0,
            resultado: { ancho: 4, largo: 4, colocados: [], ventanas },
          },
        ],
      },
    ],
  };
}

function esCristalVentana(mesh: THREE.Mesh): boolean {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  return mat instanceof THREE.MeshBasicMaterial && mat.transparent === true && mat.opacity === 0.55;
}

test("crearInteriorVisual: una ventana norte de 2 tiles añade 2 franjas de cristal translúcido", () => {
  const interior = interiorConVentana([{ x: 1, lado: "norte", ancho: 2, aporteLuz: 0.5, colorDebug: "#a9c9d6" }]);
  const { grupo } = crearInteriorVisual(interior);
  const cristales = grupo.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && esCristalVentana(c));
  assert.strictEqual(cristales.length, 2, "una franja por tile del tramo de ventana");
  for (const c of cristales) {
    assert.ok(c.position.y > 0 && c.position.y < 2.4, "la franja cae dentro de la altura del muro");
    assert.strictEqual(c.position.z, 0.08, "pegada a la cara interior del muro norte (offsetY=0 + BORDE_PARED)");
  }
  const xs = cristales.map((c) => c.position.x).sort();
  assert.deepStrictEqual(xs, [1.5, 2.5], "arranca en x=1 y crece en X (mismo eje que celdasVentana)");
});

test("crearInteriorVisual: ventana este usa y (no x) para el tramo y se pega a la cara este", () => {
  const interior = interiorConVentana([{ x: 0, y: 1, lado: "este", ancho: 1, aporteLuz: 0.3, colorDebug: "#a9c9d6" }]);
  const { grupo } = crearInteriorVisual(interior);
  const cristales = grupo.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && esCristalVentana(c));
  assert.strictEqual(cristales.length, 1);
  assert.strictEqual(cristales[0].position.x, 3.92, "cara este del muro (offsetX+ancho=4, menos BORDE_PARED)");
  assert.strictEqual(cristales[0].position.z, 1.5, "y=1 => centro de tile en z=1.5");
});

test("crearInteriorVisual: sin ventanas no añade ninguna franja de cristal (cero regresión)", () => {
  const interior = interiorConVentana([]);
  const { grupo } = crearInteriorVisual(interior);
  const cristales = grupo.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && esCristalVentana(c));
  assert.strictEqual(cristales.length, 0);
});

test("crearInteriorVisual: actualizarVisibilidad no revienta con ventanas presentes (registradas en el cono de visión)", () => {
  const interior = interiorConVentana([{ x: 0, lado: "sur", ancho: 1, aporteLuz: 0.4, colorDebug: "#a9c9d6" }]);
  const { actualizarVisibilidad } = crearInteriorVisual(interior);
  assert.doesNotThrow(() => actualizarVisibilidad(2, 2));
  assert.doesNotThrow(() => actualizarVisibilidad(-5, -5));
});
