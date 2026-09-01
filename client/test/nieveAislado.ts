// Prueba AISLADA de la geometría real de la capa de nieve (sectorVisual.ts,
// crearSectorVisual) — sin mapa/servidor/colisiones de por medio, para
// verificar de verdad si el borde del sector muestra una cara vertical y
// si la altura llega a la cintura de una persona, sin las incógnitas de
// navegar el mapa demo (obstáculos, sector único, etc.).
import * as THREE from "three";
import { crearSectorVisual } from "../src/render3d/sectorVisual";
import type { IndiceMapa, SectorBakeado } from "../src/mapa/formatoMapa";

const params = new URLSearchParams(location.search);
const nivel = Number(params.get("nivel") ?? "4");
// "borde": todo hierba, mira al borde EXTERIOR del sector (el muro que
// pide docs/GDD_Clima.md). "agua": mitad hierba/mitad agua, mira al
// borde INTERIOR entre nieve y agua (para comprobar si ahí también hay
// muro, o si es solo un "agujero" sin pared — lo que dice el GDD).
const tipo = params.get("tipo") ?? "borde";

const TAM = 16;
let terreno = "0".repeat(TAM * TAM); // todo hierba (índice 0)
const leyendaTerreno = tipo === "agua" ? ["hierba", "agua"] : ["hierba"];
if (tipo === "agua") {
  // mitad izquierda hierba (0), mitad derecha agua (1) — línea recta en x=8.
  const filas: string[] = [];
  for (let y = 0; y < TAM; y++) filas.push("0".repeat(8) + "1".repeat(8));
  terreno = filas.join("");
}
const indice: IndiceMapa = {
  version: 1, nombre: "test-aislado", semilla: "x",
  anchoChunks: 1, altoChunks: 1, tamanoChunk: TAM, tamanoSectorChunks: 1,
  leyendaTerreno,
};
const sector: SectorBakeado = {
  sectorX: 0, sectorY: 0,
  chunks: { "0_0": { terreno, tamano: TAM, objetos: [] } },
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(900, 650);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x27303d);

// Suelo neutro grande, por debajo del sector, para que fuera de él no sea vacío negro.
const sueloBase = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x4a5568 }));
sueloBase.rotation.x = -Math.PI / 2;
sueloBase.position.set(8, -0.02, 8);
scene.add(sueloBase);

const luz = new THREE.DirectionalLight(0xffffff, 1.0);
luz.position.set(15, 25, 10);
scene.add(luz);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const camara = new THREE.OrthographicCamera(-9, 9, 7, -7, 0.1, 100);
// "borde": borde SUR del sector entero (z=16). "agua": línea interior hierba/agua (x=8).
const objetivo = tipo === "agua" ? new THREE.Vector3(8, 0, 8) : new THREE.Vector3(8, 0, 16);
camara.position.set(objetivo.x + 12, objetivo.y + 12, objetivo.z + 12);
camara.lookAt(objetivo);
scene.add(camara);

// Referencia de altura de persona (proporcionesRig.json: altoPierna 0.7 +
// altoTorso 0.55 + ladoCabeza 0.32 ≈ 1.57 total) a CABALLO del borde, para
// ver a la vez el muro (si lo hay) y cuánto le tapa la nieve.
const persona = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.57, 0.3), new THREE.MeshStandardMaterial({ color: 0xd08050 }));
persona.position.set(objetivo.x, 1.57 / 2, objetivo.z);
scene.add(persona);

const handle = await crearSectorVisual(indice, sector, new Set(), 0, nivel);
scene.add(handle.grupo);

renderer.render(scene, camara);
(window as any).__listo = true;
