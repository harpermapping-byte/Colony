import * as THREE from "three";
import type { MapaCargado } from "../mapa/cargarMapa";
import { terrenoEn } from "../mapa/formatoMapa";
import { colorTerreno } from "./catalogoVisual";

/**
 * Suelo del mundo pintado desde el mapa bakeado: un único plano con una
 * textura-canvas de 1 píxel por casilla (`NearestFilter` → cada casilla se
 * ve como un tile nítido, sin difuminar). El terreno se queda 2D plano a
 * propósito (decisión de GDD_Motor_3D_Props.md: el suelo nunca pasa a
 * vóxel) — cuando exista el tileset de arte real, esta misma textura se
 * pinta con esos tiles en vez de con `colorDebug`, sin tocar nada más.
 *
 * Coste: UNA textura y UN draw call para todo el suelo del mapa demo.
 */
export function crearTerreno(mapa: MapaCargado): THREE.Mesh {
  const { indice, sectores } = mapa;
  const anchoTiles = indice.anchoChunks * indice.tamanoChunk;
  const altoTiles = indice.altoChunks * indice.tamanoChunk;

  const canvas = document.createElement("canvas");
  canvas.width = anchoTiles;
  canvas.height = altoTiles;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, anchoTiles, altoTiles);

  for (const sector of sectores) {
    for (const [clave, chunk] of Object.entries(sector.chunks)) {
      const [cx, cy] = clave.split("_").map(Number);
      for (let y = 0; y < chunk.tamano; y++) {
        for (let x = 0; x < chunk.tamano; x++) {
          const id = terrenoEn(chunk, indice.leyendaTerreno, x, y);
          ctx.fillStyle = colorTerreno(id);
          ctx.fillRect(cx * chunk.tamano + x, cy * chunk.tamano + y, 1, 1);
        }
      }
    }
  }

  const textura = new THREE.CanvasTexture(canvas);
  textura.magFilter = THREE.NearestFilter;
  textura.minFilter = THREE.NearestFilter;
  textura.colorSpace = THREE.SRGBColorSpace;

  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(anchoTiles, altoTiles),
    new THREE.MeshStandardMaterial({ map: textura, roughness: 1, metalness: 0 }),
  );
  malla.rotation.x = -Math.PI / 2;
  // La casilla (0,0) del mapa queda en el mundo entre (0,0) y (1,1): la
  // misma convención que usan los objetos bakeados y los jugadores.
  malla.position.set(anchoTiles / 2, 0, altoTiles / 2);
  malla.receiveShadow = true;
  return malla;
}
