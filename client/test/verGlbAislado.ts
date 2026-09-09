// Visor MÍNIMO de un .glb aislado, sin sectorVisual/mapa/servidor de por
// medio — para descartar el pipeline de props del juego como fuente de un
// posible bug de renderizado y ver la geometría exportada TAL CUAL.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "/test_solo_muro.glb";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 800);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const luz = new THREE.DirectionalLight(0xffffff, 1.0);
luz.position.set(30, 40, 20);
scene.add(luz);

const grid = new THREE.GridHelper(120, 60, 0x00ff00, 0x006600);
scene.add(grid);

const camara = new THREE.OrthographicCamera(-45, 45, 35, -35, 0.1, 500);
camara.position.set(45, 45, 45);
camara.lookAt(0, 0, 0);
scene.add(camara);

const loader = new GLTFLoader();
const gltf = await loader.loadAsync(url);
scene.add(gltf.scene);

renderer.render(scene, camara);
(window as any).__listo = true;
