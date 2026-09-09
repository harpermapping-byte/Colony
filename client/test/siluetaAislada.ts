// Prueba AISLADA de la silueta 3D de asentamiento v2 (generarSiluetaCiudad
// + puerta alineada) — mismo patrón que nieveAislado.ts: sin servidor de
// juego ni bake completo, carga un sector fabricado a mano (pero con
// objetos REALES, exportados por generarInstanciasPOI de verdad) desde
// client/test/siluetaTestSector.json y lo renderiza con el mismo
// crearSectorVisual que usa el juego real.
//
//   node client/test/generarSiluetaTestSector.js [tier]   (genera el JSON)
//   cd client && npx vite --port 5209
//   abrir http://localhost:5209/test/siluetaAislada.html?vista=cerca|lejos
//
// (o usar client/test/siluetaAisladaCaptura.mjs para capturas automáticas)
import * as THREE from "three";
import { crearSectorVisual } from "../src/render3d/sectorVisual";
import type { IndiceMapa, SectorBakeado } from "../src/mapa/formatoMapa";

const params = new URLSearchParams(location.search);
const vista = params.get("vista") ?? "lejos";

const datos = await (await fetch("/test/siluetaTestSector.json")).json();
const indice: IndiceMapa = datos.indice;
const sector: SectorBakeado = datos.sector;
const centro = datos.centroCiudad;
const portal = datos.portal;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 800);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ea0c8);

const sueloBase = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x4a6b3a }));
sueloBase.rotation.x = -Math.PI / 2;
sueloBase.position.set(centro.x, -0.05, centro.y);
scene.add(sueloBase);

const luz = new THREE.DirectionalLight(0xffffff, 1.1);
luz.position.set(centro.x + 80, 120, centro.y + 60);
scene.add(luz);
scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const camara = new THREE.OrthographicCamera(-60, 60, 46, -46, 0.1, 500);
if (vista === "lejos" || vista === "cerca" || vista === "puertaiso") {
  // vista general isométrica desde fuera, encuadrando toda la ciudad —
  // MISMO ángulo fijo que worldScene.ts::posicionarCamaraIsometrica
  // ((+d,+d,+d) mirando al objetivo), la única cámara real del juego.
  // "cerca" usa un frustum ajustado al tamaño real de la ciudad (como
  // vería un jugador acercándose a pie), "lejos" el mismo encuadre amplio
  // de antes (para comparar). "puertaiso" (2026-09-09, verificación del
  // snap de rotación a 90°) es el MISMO ángulo isométrico fijo, solo que
  // encuadrado sobre la puerta real en vez del centro de la ciudad — a
  // diferencia del "puerta" de abajo (look-at dinámico desde el hueco
  // hacia el centro, útil para continuidad de muralla pero NO representa
  // el ángulo real del juego).
  const objetivoPuerta = vista === "puertaiso";
  const objetivo = objetivoPuerta
    ? new THREE.Vector3(portal.x, 0, portal.y)
    : new THREE.Vector3(centro.x, 0, centro.y);
  const mitad = objetivoPuerta ? 12 : vista === "cerca" ? 45 : 110;
  const alto = mitad * (46 / 60);
  camara.left = -mitad; camara.right = mitad; camara.top = alto; camara.bottom = -alto;
  const distancia = objetivoPuerta ? 20 : vista === "cerca" ? 40 : 90;
  camara.position.set(objetivo.x + distancia, distancia, objetivo.z + distancia);
  camara.lookAt(objetivo);
} else {
  // vista cerca de la puerta real, mirando hacia el centro de la ciudad —
  // confirma si el hueco de la muralla y la estructura interactiva coinciden
  const objetivo = new THREE.Vector3(portal.x, 0, portal.y);
  const dx = centro.x - portal.x, dz = centro.y - portal.y;
  const dist = Math.hypot(dx, dz) || 1;
  camara.position.set(portal.x - (dx / dist) * 25 + 25, 25, portal.y - (dz / dist) * 25 + 25);
  camara.lookAt(objetivo);
}
camara.updateProjectionMatrix();
scene.add(camara);

// referencia de altura de persona (1.57u) EN el portal real — confirma si
// el punto de interacción cae en terreno abierto o dentro de algo sólido
const persona = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.57, 0.3), new THREE.MeshStandardMaterial({ color: 0xd82020 }));
persona.position.set(portal.x, 1.57 / 2, portal.y);
scene.add(persona);

const handle = await crearSectorVisual(indice, sector, new Set(), 0, 0);
scene.add(handle.grupo);

renderer.render(scene, camara);
(window as any).__listo = true;
