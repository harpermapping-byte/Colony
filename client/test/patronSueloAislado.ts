// Verificación AISLADA del patrón de suelo horneado en PRODUCCIÓN
// (patronTerreno.ts + sectorVisual.ts::crearTerrenoSector, pedido streamer
// 2026-09-11 "la prueba B es lo que hay que hacer") — mismo patrón que
// orillasAislado.ts: sin servidor de juego, carga un sector REAL del mapa
// principal (por defecto el más pesado, sector_009_001, 320x320 casillas)
// y mide con `performance.now()` cuánto tarda `crearSectorVisual` de
// verdad, además de renderizarlo con la cámara isométrica real para
// comprobar el aspecto a ojo.
//
//   cd client && npx vite --port 5212
//   abrir http://localhost:5212/test/patronSueloAislado.html?sx=9&sy=1&x=2890&y=350&mitad=4
//   (o usar client/test/patronSueloAisladoCaptura.mjs para capturas + tiempos)
import * as THREE from "three";
import { crearSectorVisual, crearTerrenoSector } from "../src/render3d/sectorVisual";
import type { IndiceMapa, SectorBakeado } from "../src/mapa/formatoMapa";

const params = new URLSearchParams(location.search);
const sx = Number(params.get("sx") ?? 9);
const sy = Number(params.get("sy") ?? 1);
const fx = Number(params.get("x") ?? 2890);
const fy = Number(params.get("y") ?? 350);
const mitad = Number(params.get("mitad") ?? 4); // zoom cercano por defecto: se ve el motivo, no solo el color

const base = "/assets/mapas/principal";
const indice: IndiceMapa = await (await fetch(`${base}/indice.json`)).json();
const pad = (n: number) => String(n).padStart(3, "0");
const sector: SectorBakeado = await (await fetch(`${base}/sector_${pad(sx)}_${pad(sy)}.json`)).json();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1000, 700);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ea0c8);
const luz = new THREE.DirectionalLight(0xffffff, 1.1);
luz.position.set(fx + 30, 60, fy + 20);
scene.add(luz);
scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const alto = mitad * (700 / 1000);
const camara = new THREE.OrthographicCamera(-mitad, mitad, alto, -alto, 0.1, 500);
camara.position.set(fx + 20, 20, fy + 20);
camara.lookAt(new THREE.Vector3(fx, 0, fy));
camara.updateProjectionMatrix();

// Medición real de la parte SÍNCRONA (`crearTerrenoSector`, sin ningún
// `await` de por medio — el bloque de riesgo real, ver PX_POR_TILE_SUELO en
// sectorVisual.ts) SEPARADA de `crearPropsSector` (carga de red de
// vegetación/rocas/edificios .glb — un coste enorme y completamente ajeno a
// este cambio, sin tocar). Medir el `crearSectorVisual` completo mezclaría
// ambos costes y escondería si el patrón de suelo en sí es barato o caro.
const t0 = performance.now();
const terreno = crearTerrenoSector(indice, sector);
const t1 = performance.now();
(window as any).__tiempoTerrenoMs = t1 - t0;
console.log(`crearTerrenoSector SOLO (sector ${sx}_${sy}, ${indice.tamanoSectorChunks * indice.tamanoChunk}x${indice.tamanoSectorChunks * indice.tamanoChunk} casillas reales): ${(t1 - t0).toFixed(1)}ms`);

const handle = await crearSectorVisual(indice, sector);
scene.add(handle.grupo);
renderer.render(scene, camara);

// Vista RAW del canvas de suelo (sin cámara 3D, sin vegetación tapando) —
// se extrae el propio canvas-textura del plano de suelo (segundo hijo del
// grupo QUE DEVUELVE `crearTerrenoSector` en sí, medido arriba —
// `crearSectorVisual` lo envuelve en OTRO grupo junto con las props, así
// que hay que mirar `terreno.grupo`, no `handle.grupo`) y se
// recorta+escala con `imageSmoothingEnabled=false` para verlo nítido a
// simple vista, exactamente los píxeles reales que genera el patrón.
const planoSuelo = terreno.grupo.children[1] as THREE.Mesh;
const material = planoSuelo.material as THREE.MeshStandardMaterial;
const canvasSuelo = material.map!.image as HTMLCanvasElement;
const recorteTiles = 40;
const px = Math.round(((fx % (indice.tamanoSectorChunks * indice.tamanoChunk)) / (indice.tamanoSectorChunks * indice.tamanoChunk)) * canvasSuelo.width);
const py = Math.round(((fy % (indice.tamanoSectorChunks * indice.tamanoChunk)) / (indice.tamanoSectorChunks * indice.tamanoChunk)) * canvasSuelo.height);
const pxPorTile = canvasSuelo.width / (indice.tamanoSectorChunks * indice.tamanoChunk);
const anchoRecorte = recorteTiles * pxPorTile;
const escala = 8;
const canvasVisor = document.createElement("canvas");
canvasVisor.width = anchoRecorte * escala;
canvasVisor.height = anchoRecorte * escala;
canvasVisor.style.cssText = "image-rendering:pixelated;display:block;margin-top:8px;";
const ctxVisor = canvasVisor.getContext("2d")!;
ctxVisor.imageSmoothingEnabled = false;
ctxVisor.drawImage(
  canvasSuelo,
  Math.max(0, px - anchoRecorte / 2), Math.max(0, py - anchoRecorte / 2), anchoRecorte, anchoRecorte,
  0, 0, canvasVisor.width, canvasVisor.height,
);
document.body.appendChild(canvasVisor);

(window as any).__listo = true;
