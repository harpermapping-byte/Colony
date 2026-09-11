// Verificación VISUAL del fix esquina-vs-centro de edificios (pedido
// streamer 2026-09-11: "la generacion de edificios... la colision NO
// COINCIDE con la forma") — carga un sector REAL de ciudad_demo (con
// varios edificios rotados de verdad, no solo 0/90/180/270) y dibuja un
// contorno wireframe amarillo en el footprint de colisión ESPERADO
// (centro + ancho/alto reales rotados) de cada edificio, encima del
// render real — si el fix es correcto, el modelo 3D debe caer DENTRO del
// wireframe, no desplazado medio edificio.
//
//   cd client && npx vite --port 5216
//   abrir http://localhost:5216/test/colisionEdificioAislado.html
import * as THREE from "three";
import { crearSectorVisual } from "../src/render3d/sectorVisual";
import type { IndiceMapa, SectorBakeado, ObjetoBakeado } from "../src/mapa/formatoMapa";

const base = "/assets/mapas/ciudad_demo";
const indice: IndiceMapa = await (await fetch(`${base}/indice.json`)).json();
const sector: SectorBakeado = await (await fetch(`${base}/sector_001_001.json`)).json();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1100, 800);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ea0c8);
const luz = new THREE.DirectionalLight(0xffffff, 1.1);
luz.position.set(150, 80, 130);
scene.add(luz);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

const foco = new THREE.Vector3(100, 0, 90);
const MITAD = 22;
const camara = new THREE.OrthographicCamera(-MITAD, MITAD, MITAD * (800 / 1100), -MITAD * (800 / 1100), 0.1, 500);
camara.position.set(foco.x + 40, 40, foco.z + 40);
camara.lookAt(foco);
camara.updateProjectionMatrix();

const handle = await crearSectorVisual(indice, sector);
scene.add(handle.grupo);

// Wireframe amarillo en el footprint ESPERADO de cada edificio (centro
// real globalX+dx/globalY+dy, ancho/alto reales w/h, rotado por ro) — la
// MISMA fuente de verdad que usa la colisión de servidor (huella real de
// ciudades/, no el .glb).
const t = indice.tamanoChunk;
for (const [clave, chunk] of Object.entries(sector.chunks)) {
  const [cx, cy] = clave.split("_").map(Number);
  for (const obj of chunk.objetos as ObjetoBakeado[]) {
    if (obj.t !== "e") continue;
    const globalX = cx * t + obj.x;
    const globalY = cy * t + obj.y;
    const cxWorld = globalX + (obj.dx ?? 0.5);
    const czWorld = globalY + (obj.dy ?? 0.5);
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(obj.w || 1, 3, obj.h || 1));
    const wire = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffee00 }));
    wire.position.set(cxWorld, 1.5, czWorld);
    wire.rotation.y = THREE.MathUtils.degToRad(obj.ro || 0);
    scene.add(wire);
  }
}

renderer.render(scene, camara);
(window as any).__listo = true;
