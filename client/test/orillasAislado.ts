// Prueba AISLADA de las orillas verticales (orillasTerreno.ts, pedido
// streamer 2026-09-10) — mismo patrón que siluetaAislada.ts: sin servidor de
// juego, carga un sector REAL del mapa principal y lo renderiza con el mismo
// crearSectorVisual que usa el juego, con la cámara isométrica real
// encuadrada sobre una orilla concreta.
//
//   cd client && npx vite --port 5210
//   abrir http://localhost:5210/test/orillasAislado.html?sx=4&sy=6&x=1310&y=2010
//   (o usar client/test/orillasAisladoCaptura.mjs para capturas automáticas)
import * as THREE from "three";
import { crearSectorVisual } from "../src/render3d/sectorVisual";
import type { IndiceMapa, SectorBakeado } from "../src/mapa/formatoMapa";

const params = new URLSearchParams(location.search);
const sx = Number(params.get("sx") ?? 4);
const sy = Number(params.get("sy") ?? 6);
const fx = Number(params.get("x") ?? 1310);
const fy = Number(params.get("y") ?? 2010);
const mitad = Number(params.get("mitad") ?? 9);

const base = "/assets/mapas/principal";
const indice: IndiceMapa = await (await fetch(`${base}/indice.json`)).json();
const pad = (n: number) => String(n).padStart(3, "0");
const sector: SectorBakeado = await (await fetch(`${base}/sector_${pad(sx)}_${pad(sy)}.json`)).json();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 800);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ea0c8);
const luz = new THREE.DirectionalLight(0xffffff, 1.1);
luz.position.set(fx + 30, 60, fy + 20);
scene.add(luz);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// MISMO ángulo fijo que worldScene.ts::posicionarCamaraIsometrica
const alto = mitad * (800 / 1280);
const camara = new THREE.OrthographicCamera(-mitad, mitad, alto, -alto, 0.1, 500);
camara.position.set(fx + 20, 20, fy + 20);
camara.lookAt(new THREE.Vector3(fx, 0, fy));
camara.updateProjectionMatrix();

const handle = await crearSectorVisual(indice, sector);
scene.add(handle.grupo);

// referencia de altura de persona (1.57u) en el punto de foco
const persona = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.57, 0.3), new THREE.MeshStandardMaterial({ color: 0xd82020 }));
persona.position.set(fx + 0.5, 0.785, fy + 0.5);
scene.add(persona);

renderer.render(scene, camara);
(window as any).__listo = true;
