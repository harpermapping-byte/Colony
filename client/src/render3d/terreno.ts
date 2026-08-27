import * as THREE from "three";
import type { MapaCargado } from "../mapa/cargarMapa";
import { terrenoEn } from "../mapa/formatoMapa";
import { colorTerreno } from "./catalogoVisual";

/**
 * Suelo del mundo pintado desde el mapa bakeado, en DOS planos:
 *
 * - "suelo" (y=0): un plano con textura-canvas de 1 píxel por casilla
 *   (`NearestFilter` → tiles nítidos). La tierra va opaca; las casillas de
 *   agua van en AZUL TRANSLÚCIDO, para que se vea el fondo y a quien bucea
 *   (el PJ nada entre y=-0.55 y y=-1.35, ver game.ts).
 * - "fondo" (y=-1.5): el lecho bajo el agua, pintado con la ELEVACIÓN
 *   bakeada de cada casilla — más profundo = más oscuro. Solo se ve a
 *   través del agua; bajo la tierra queda tapado por el suelo opaco.
 *
 * El terreno sigue siendo 2D plano a propósito (decisión de
 * GDD_Motor_3D_Props.md: el suelo nunca pasa a vóxel) — cuando exista el
 * tileset de arte real, estas mismas texturas se pintan con esos tiles en
 * vez de con `colorDebug`, sin tocar nada más.
 *
 * Coste: DOS texturas y DOS draw calls para todo el suelo del mapa demo.
 */

/** Profundidad visual del lecho (por debajo del buzo a nivel -2). */
export const PROFUNDIDAD_FONDO = 1.5;

// Alfa contenida: con más de ~0.5 el buzo y el lecho dejan de leerse.
// `base` sitúa el sombreado del lecho cuando la elevación bakeada apenas
// varía dentro de una misma masa de agua (pasa en lagos pequeños).
const AGUAS: Record<string, { alfa: number; base: number }> = {
  agua: { alfa: 0.45, base: 0.8 },
  agua_profunda: { alfa: 0.55, base: 0.25 },
};

// Lecho: arena apagada que se oscurece con la profundidad.
const LECHO_CLARO = { r: 0xc9, g: 0xb2, b: 0x7a };
const LECHO_OSCURO = { r: 0x4f, g: 0x5c, b: 0x55 };
// La superficie translúcida usa el colorDebug del catálogo aclarado un
// punto: sobre el lecho oscuro, el azul puro del catálogo se iba a negro.
const ACLARADO_SUPERFICIE = 0.12;

function crearCanvas(anchoTiles: number, altoTiles: number) {
  const canvas = document.createElement("canvas");
  canvas.width = anchoTiles;
  canvas.height = altoTiles;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

function crearPlano(canvas: HTMLCanvasElement, anchoTiles: number, altoTiles: number, transparente: boolean): THREE.Mesh {
  const textura = new THREE.CanvasTexture(canvas);
  textura.magFilter = THREE.NearestFilter;
  textura.minFilter = THREE.NearestFilter;
  textura.colorSpace = THREE.SRGBColorSpace;
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(anchoTiles, altoTiles),
    new THREE.MeshStandardMaterial({
      map: textura,
      roughness: 1,
      metalness: 0,
      transparent: transparente,
      // el agua translúcida no escribe depth: el buzo (opaco) se dibuja
      // primero y se ve a través de ella sin artefactos de ordenación
      depthWrite: !transparente,
    }),
  );
  malla.rotation.x = -Math.PI / 2;
  // La casilla (0,0) del mapa queda en el mundo entre (0,0) y (1,1): la
  // misma convención que usan los objetos bakeados y los jugadores.
  malla.position.set(anchoTiles / 2, 0, altoTiles / 2);
  return malla;
}

export function crearTerreno(mapa: MapaCargado): THREE.Object3D {
  const { indice, sectores } = mapa;
  const anchoTiles = indice.anchoChunks * indice.tamanoChunk;
  const altoTiles = indice.altoChunks * indice.tamanoChunk;

  const suelo = crearCanvas(anchoTiles, altoTiles);
  const fondo = crearCanvas(anchoTiles, altoTiles);
  suelo.ctx.clearRect(0, 0, anchoTiles, altoTiles);
  fondo.ctx.fillStyle = "#000000";
  fondo.ctx.fillRect(0, 0, anchoTiles, altoTiles);

  // rango real de elevación de las casillas de agua, para normalizar el
  // sombreado del lecho a lo que de verdad hay en ESTE mapa
  let elevMin = Infinity, elevMax = -Infinity;
  for (const sector of sectores) {
    for (const chunk of Object.values(sector.chunks)) {
      for (let i = 0; i < chunk.terreno.length; i++) {
        const id = indice.leyendaTerreno[parseInt(chunk.terreno[i], 36)];
        if (!AGUAS[id]) continue;
        const e = parseInt(chunk.elevacion[i], 36);
        if (e < elevMin) elevMin = e;
        if (e > elevMax) elevMax = e;
      }
    }
  }
  const rangoElev = Math.max(1, elevMax - elevMin);

  for (const sector of sectores) {
    for (const [clave, chunk] of Object.entries(sector.chunks)) {
      const [cx, cy] = clave.split("_").map(Number);
      for (let y = 0; y < chunk.tamano; y++) {
        for (let x = 0; x < chunk.tamano; x++) {
          const px = cx * chunk.tamano + x;
          const py = cy * chunk.tamano + y;
          const id = terrenoEn(chunk, indice.leyendaTerreno, x, y);
          const agua = AGUAS[id];
          if (!agua) {
            suelo.ctx.fillStyle = colorTerreno(id);
            suelo.ctx.fillRect(px, py, 1, 1);
            continue;
          }
          // superficie translúcida con el color de catálogo aclarado
          const c = new THREE.Color(colorTerreno(id)).lerp(new THREE.Color(1, 1, 1), ACLARADO_SUPERFICIE);
          suelo.ctx.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${agua.alfa})`;
          suelo.ctx.fillRect(px, py, 1, 1);
          // lecho: mitad por tipo de agua (somera clara, profunda oscura),
          // mitad por la elevación bakeada (elevación baja = hondo = oscuro)
          const e = parseInt(chunk.elevacion[y * chunk.tamano + x], 36);
          const t = 0.5 * agua.base + 0.5 * ((e - elevMin) / rangoElev);
          const r = Math.round(LECHO_OSCURO.r + (LECHO_CLARO.r - LECHO_OSCURO.r) * t);
          const g = Math.round(LECHO_OSCURO.g + (LECHO_CLARO.g - LECHO_OSCURO.g) * t);
          const b = Math.round(LECHO_OSCURO.b + (LECHO_CLARO.b - LECHO_OSCURO.b) * t);
          fondo.ctx.fillStyle = `rgb(${r},${g},${b})`;
          fondo.ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  const grupo = new THREE.Group();
  const planoFondo = crearPlano(fondo.canvas, anchoTiles, altoTiles, false);
  planoFondo.position.y = -PROFUNDIDAD_FONDO;
  planoFondo.receiveShadow = true;
  const planoSuelo = crearPlano(suelo.canvas, anchoTiles, altoTiles, true);
  planoSuelo.receiveShadow = true;
  grupo.add(planoFondo, planoSuelo);
  return grupo;
}
