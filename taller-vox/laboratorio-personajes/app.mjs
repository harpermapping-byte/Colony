import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const NOMBRES = {
  hips: "Cadera (raíz)", spine: "Torso", head: "Cabeza",
  upperarmL: "Brazo izq.", lowerarmL: "Antebrazo izq.", handL: "Mano izq.",
  upperarmR: "Brazo der.", lowerarmR: "Antebrazo der.", handR: "Mano der.",
  upperlegL: "Muslo izq.", lowerlegL: "Pierna izq.", footL: "Pie izq.",
  upperlegR: "Muslo der.", lowerlegR: "Pierna der.", footR: "Pie der.",
};

const statusEl = document.getElementById("status");
const listaEl = document.getElementById("lista");
const fichaNombreEl = document.getElementById("fichaNombre");
const fichaMetaEl = document.getElementById("fichaMeta");
const infoEl = document.getElementById("infoModelo");
const canvas = document.getElementById("stage");
const sliders = ["X", "Y", "Z"].map((eje) => ({
  eje,
  input: document.getElementById("rot" + eje),
  out: document.getElementById("rot" + eje + "Val"),
}));
const btnReposo = document.getElementById("btnReposo");
const btnAndar = document.getElementById("btnAndar");
const btnEsqueleto = document.getElementById("btnEsqueleto");
const fileInput = document.getElementById("fileGlb");

function status(msg, err) {
  statusEl.textContent = msg;
  statusEl.className = err ? "err" : "";
}

// ---- escena ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4ddcb);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(2.3, 1.7, 2.8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.85, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.72;
controls.minDistance = 0.6;
controls.maxDistance = 12;

scene.add(new THREE.HemisphereLight(0xfff6e6, 0x8a8577, 0.85));
const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.position.set(3, 5, 2.5);
sol.castShadow = true;
sol.shadow.mapSize.set(1024, 1024);
sol.shadow.camera.left = -2.5; sol.shadow.camera.right = 2.5;
sol.shadow.camera.top = 3.5; sol.shadow.camera.bottom = -0.5;
sol.shadow.bias = -0.0004;
scene.add(sol);

const suelo = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0xd9d0bc, roughness: 1 })
);
suelo.rotation.x = -Math.PI / 2;
suelo.receiveShadow = true;
scene.add(suelo);
const rejilla = new THREE.GridHelper(30, 60, 0xb9a98c, 0xc9c0aa);
rejilla.position.y = 0.001;
scene.add(rejilla);

// marcador del hueso seleccionado
const marcador = new THREE.Mesh(
  new THREE.SphereGeometry(0.028, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xb96a2c, depthTest: false, transparent: true, opacity: 0.95 })
);
marcador.renderOrder = 3;
marcador.visible = false;
scene.add(marcador);

// ---- estado del laboratorio ------------------------------------------------
let modeloRaiz = null;      // Group del gltf.scene actual
let skinned = null;         // SkinnedMesh
let huesos = [];            // THREE.Bone[] en orden de skeleton.bones
let seleccionado = null;    // THREE.Bone
let helper = null;          // SkeletonHelper
let verEsqueleto = true;
let andando = false;
let tAndar = 0;
const poseUsuario = new Map(); // bone.name -> {x,y,z} en radianes (la pose de los sliders)
let hipsBaseY = 0;

const deg = (r) => Math.round((r * 180) / Math.PI);
const rad = (d) => (d * Math.PI) / 180;

function limpiarModelo() {
  if (modeloRaiz) {
    scene.remove(modeloRaiz);
    modeloRaiz.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
  if (helper) { scene.remove(helper); helper.dispose?.(); helper = null; }
  modeloRaiz = null; skinned = null; huesos = []; seleccionado = null;
  poseUsuario.clear();
  marcador.visible = false;
}

function cargarGLTF(arrayBuffer, etiqueta) {
  new GLTFLoader().parse(arrayBuffer, "", (gltf) => {
    limpiarModelo();
    modeloRaiz = gltf.scene;
    modeloRaiz.traverse((o) => {
      if (o.isSkinnedMesh) { skinned = o; o.castShadow = true; o.frustumCulled = false; }
      else if (o.isMesh) o.castShadow = true;
    });
    scene.add(modeloRaiz);
    if (!skinned) {
      status(`"${etiqueta}" no trae esqueleto (SkinnedMesh) — se muestra como malla rígida.`, true);
      infoEl.textContent = "";
      listaEl.innerHTML = "";
      return;
    }
    huesos = skinned.skeleton.bones;
    huesos.forEach((b) => poseUsuario.set(b.name, { x: 0, y: 0, z: 0 }));
    const hips = huesos.find((b) => b.name === "hips");
    hipsBaseY = hips ? hips.position.y : 0;

    helper = new THREE.SkeletonHelper(modeloRaiz);
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.9;
    helper.renderOrder = 2;
    helper.visible = verEsqueleto;
    scene.add(helper);

    const g = skinned.geometry;
    infoEl.textContent =
      `${huesos.length} huesos · ${g.attributes.position.count.toLocaleString("es")} vértices · ` +
      `${(g.index.count / 3).toLocaleString("es")} triángulos`;

    construirLista();
    seleccionar(huesos.find((b) => b.name === "upperarmL") || huesos[0]);
    status(`Cargado "${etiqueta}". Elige un hueso y muévelo con los sliders.`);
  }, (e) => status(`Error al cargar ${etiqueta}: ${e.message || e}`, true));
}

// ---- lista de huesos -------------------------------------------------------
function profundidad(b) {
  let d = 0, p = b.parent;
  while (p && p.isBone) { d++; p = p.parent; }
  return d;
}

function construirLista() {
  listaEl.innerHTML = "";
  for (const b of huesos) {
    const div = document.createElement("div");
    div.className = "item";
    div.dataset.bone = b.name;
    div.style.paddingLeft = 10 + profundidad(b) * 14 + "px";
    const dot = document.createElement("span");
    dot.className = "dot";
    const nom = document.createElement("span");
    nom.className = "nombre";
    nom.textContent = NOMBRES[b.name] || b.name;
    div.append(dot, nom);
    div.addEventListener("click", () => seleccionar(b));
    listaEl.appendChild(div);
  }
}

function seleccionar(b) {
  seleccionado = b;
  for (const el of listaEl.children) el.classList.toggle("selected", el.dataset.bone === b.name);
  fichaNombreEl.textContent = NOMBRES[b.name] || b.name;
  fichaMetaEl.textContent = `hueso "${b.name}"` + (b.parent?.isBone ? ` · cuelga de "${b.parent.name}"` : " · raíz del esqueleto");
  sincronizarSliders();
}

function sincronizarSliders() {
  if (!seleccionado) return;
  const p = poseUsuario.get(seleccionado.name);
  const ejes = { X: p.x, Y: p.y, Z: p.z };
  for (const s of sliders) {
    s.input.value = deg(ejes[s.eje]);
    s.out.textContent = deg(ejes[s.eje]) + "°";
  }
}

for (const s of sliders) {
  s.input.addEventListener("input", () => {
    if (!seleccionado) return;
    const v = rad(Number(s.input.value));
    const p = poseUsuario.get(seleccionado.name);
    p[s.eje.toLowerCase()] = v;
    s.out.textContent = s.input.value + "°";
    if (!andando) seleccionado.rotation[s.eje.toLowerCase()] = v;
  });
}

// ---- acciones --------------------------------------------------------------
function aplicarPoseUsuario() {
  for (const b of huesos) {
    const p = poseUsuario.get(b.name);
    b.rotation.set(p.x, p.y, p.z);
    if (b.name === "hips") b.position.y = hipsBaseY;
  }
}

btnReposo.addEventListener("click", () => {
  pararAndar();
  for (const p of poseUsuario.values()) { p.x = 0; p.y = 0; p.z = 0; }
  aplicarPoseUsuario();
  sincronizarSliders();
  status("Pose de reposo.");
});

function pararAndar() {
  if (!andando) return;
  andando = false;
  btnAndar.textContent = "▶ Andar";
  btnAndar.classList.remove("active");
  aplicarPoseUsuario();
}

btnAndar.addEventListener("click", () => {
  if (andando) { pararAndar(); status("Ciclo de andar parado — vuelve tu pose."); return; }
  if (!huesos.length) return;
  andando = true;
  tAndar = 0;
  btnAndar.textContent = "⏸ Parar";
  btnAndar.classList.add("active");
  status("Ciclo de andar de prueba — demuestra que el skinning gira sobre cada pivote.");
});

const porNombre = (n) => huesos.find((b) => b.name === n);
function pasoAndar(dt) {
  tAndar += dt;
  const w = tAndar * 5.2;
  const A = 0.62;
  const set = (n, x, y = 0, z = 0) => { const b = porNombre(n); if (b) b.rotation.set(x, y, z); };
  const swing = Math.sin(w);
  set("upperlegL", A * swing);
  set("upperlegR", -A * swing);
  set("lowerlegL", 0.55 * Math.max(0, Math.sin(w - 1.1)) + 0.08);
  set("lowerlegR", 0.55 * Math.max(0, Math.sin(w + Math.PI - 1.1)) + 0.08);
  set("footL", -0.15 * Math.sin(w - 0.5));
  set("footR", 0.15 * Math.sin(w - 0.5 + Math.PI) * -1);
  set("upperarmL", -0.75 * A * swing);
  set("upperarmR", 0.75 * A * swing);
  set("lowerarmL", -0.22 - 0.1 * Math.max(0, -swing));
  set("lowerarmR", -0.22 - 0.1 * Math.max(0, swing));
  set("spine", 0, 0.07 * Math.sin(w), 0);
  set("head", 0.04 * Math.sin(2 * w), -0.07 * Math.sin(w), 0);
  const hips = porNombre("hips");
  if (hips) hips.position.y = hipsBaseY + 0.018 * Math.abs(Math.cos(w));
}

btnEsqueleto.addEventListener("click", () => {
  verEsqueleto = !verEsqueleto;
  if (helper) helper.visible = verEsqueleto;
  btnEsqueleto.classList.toggle("active", verEsqueleto);
  marcador.visible = verEsqueleto && !!seleccionado;
});
btnEsqueleto.classList.add("active");

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => cargarGLTF(r.result, f.name);
  r.onerror = () => status("No se pudo leer el archivo.", true);
  r.readAsArrayBuffer(f);
  fileInput.value = "";
});

// ---- bucle -----------------------------------------------------------------
function ajustarTamano() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * devicePixelRatio) || canvas.height !== Math.round(h * devicePixelRatio)) {
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

const vTmp = new THREE.Vector3();
let tPrev = performance.now();
renderer.setAnimationLoop(() => {
  const t = performance.now();
  const dt = Math.min(0.05, (t - tPrev) / 1000);
  tPrev = t;
  ajustarTamano();
  controls.update();
  if (andando) pasoAndar(dt);
  if (seleccionado && verEsqueleto) {
    seleccionado.getWorldPosition(vTmp);
    marcador.position.copy(vTmp);
    marcador.visible = true;
  } else marcador.visible = false;
  renderer.render(scene, camera);
});

// ---- arranque: personaje embebido -----------------------------------------
try {
  const b64 = document.getElementById("glb-data").textContent.trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  cargarGLTF(bytes.buffer, "personaje.glb (34 vóxeles de alto)");
} catch (e) {
  status("No se pudo decodificar el modelo embebido: " + (e.message || e), true);
}
