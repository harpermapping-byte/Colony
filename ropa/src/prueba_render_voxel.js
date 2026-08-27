"use strict";

// Prueba visual isométrica de las prendas generadas — mismo criterio de
// proyección que interiores/src/prueba_render_iso.js (sx/sy con 30°),
// solo que aquí el "suelo" son los ejes x/z del vóxel y la altura es y.
// Sin dependencias nuevas: SVG de texto plano, igual que el resto del
// proyecto. Uso: node ropa/src/prueba_render_voxel.js

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarPrenda, ajustarColor } = require("./generarPrenda");

const catalogos = cargarCatalogos();

const PRUEBAS = [
  { prendaId: "camisa_lino_campesina", materialId: "lino", semilla: "prueba-campesino-01", tintes: { cuerpo: "#c9a86a", cuello: "#8a6a3a" } },
  { prendaId: "pantalon_lana_campesino", materialId: "lana", semilla: "prueba-campesino-01", tintes: { cinturon: "#4a3220" } },
  { prendaId: "gorro_lino_campesino", materialId: "lino", semilla: "prueba-campesino-01" },
];

const U = 220; // px por unidad de mundo (las prendas son diminutas, ~0.3-0.7)
const UZ = 220;
const ANG = Math.PI / 6;

function proyectar(x, y, z) {
  const sx = (x - z) * Math.cos(ANG) * U;
  const sy = -(x + z) * Math.sin(ANG) * U - y * UZ;
  return [sx, sy];
}

function cara(puntosMundo, color) {
  const pts = puntosMundo.map(([x, y, z]) => proyectar(x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ");
  return `<polygon points="${pts}" fill="${color}" stroke="${color}" stroke-width="0.6"/>`;
}

// Dibuja un vóxel como caja 3D (top/derecha/frente) — el mismo cubo que
// ya usa el resto del cliente para el placeholder de vóxel sin .glb.
function dibujarVoxel(v, celda) {
  const { x, y, z } = v;
  const [cw, ch, cd] = celda;
  const x0 = x - cw / 2, x1 = x + cw / 2;
  const y0 = y, y1 = y + ch;
  const z0 = z - cd / 2, z1 = z + cd / 2;
  const top = cara([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], v.color);
  const derecha = cara([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], ajustarColor(v.color, -0.16));
  const frente = cara([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], ajustarColor(v.color, -0.3));
  return top + derecha + frente;
}

// Solo para ESTA vista de prueba: en el juego cada `pivote` (brazoIzq,
// piernaDer...) es un nodo real del rig que ya trae su propio desplazamiento
// (rigHumanoide.ts). Aquí no hay rig, así que para poder ver la prenda
// completa (mangas a los lados del torso, las dos piernas separadas) hay
// que aplicar esos mismos desplazamientos a mano sobre los vóxeles antes
// de proyectar. Los vóxeles que devuelve generarPrenda() siguen sin tocar.
function desplazamientosPivote(rig) {
  return {
    torso: { x: 0, y: 0, z: 0 },
    brazoIzq: { x: -rig.brazo.offsetX, y: rig.altoTorso + rig.brazo.pivoteYOffset, z: 0 },
    brazoDer: { x: rig.brazo.offsetX, y: rig.altoTorso + rig.brazo.pivoteYOffset, z: 0 },
    piernaIzq: { x: -rig.pierna.offsetX, y: 0, z: 0 },
    piernaDer: { x: rig.pierna.offsetX, y: 0, z: 0 },
    cabeza: { x: 0, y: 0, z: 0 },
  };
}

function renderPrenda({ prendaId, materialId, semilla, tintes }) {
  const resultado = generarPrenda(prendaId, { catalogos, materialId, semilla, tintes });
  const prenda = catalogos.prendas[prendaId];
  const { x: nx, y: ny, z: nz } = prenda.voxelResolucion;

  // Tamaño de celda real (aprox — cada parte puede tener su propio bbox,
  // pero para la vista de prueba basta una estimación uniforme a partir
  // de la resolución declarada y las proporciones del rig).
  const celdaAprox = [0.44 / nx, 0.55 / ny, 0.3 / nz];

  const desplazamientos = desplazamientosPivote(catalogos.proporcionesRig);
  const voxelesDesplazados = resultado.voxeles.map((v) => {
    const d = desplazamientos[v.pivote] || { x: 0, y: 0, z: 0 };
    return { ...v, x: v.x + d.x, y: v.y + d.y, z: v.z + d.z };
  });
  const voxelesOrdenados = voxelesDesplazados.slice().sort((a, b) => (a.y - a.z) - (b.y - b.z) || (a.x + a.z) - (b.x + b.z));
  const cuerpo = voxelesOrdenados.map((v) => dibujarVoxel(v, celdaAprox)).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="-250 -420 500 500">
  <rect x="-250" y="-420" width="500" height="500" fill="#1b1b22"/>
  <text x="-240" y="-395" fill="#eee" font-family="monospace" font-size="14">${prendaId} — ${materialId} (${resultado.voxeles.length} vóxeles)</text>
  ${cuerpo}
</svg>`;

  const salida = path.join(__dirname, "..", "output", `${prendaId}.svg`);
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, svg, "utf8");
  console.log(`${prendaId}: ${resultado.voxeles.length} vóxeles -> ${salida}`);
  return { prendaId, svg, total: resultado.voxeles.length };
}

if (require.main === module) {
  for (const prueba of PRUEBAS) renderPrenda(prueba);
}

module.exports = { renderPrenda, PRUEBAS };
