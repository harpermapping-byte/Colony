import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { crearRigHumanoide, type RigHumanoide, type OpcionesRig, ALTO_RIG } from "./rigHumanoide";

/**
 * El personaje vóxel REAL con esqueleto (taller-vox/), sustituyendo al rig
 * placeholder de cajas. Carga `assets/personajes/pj_01.glb` (SkinnedMesh con
 * 15 huesos, skinning rígido por vóxel) y lo anima rotando huesos — la misma
 * filosofía de pivotes que `rigHumanoide.ts`, así que expone la MISMA
 * interfaz `RigHumanoide` y `game.ts` no distingue uno de otro.
 *
 * Si el .glb no existe o falla, degrada al rig placeholder de siempre — el
 * mismo criterio de fallback que `entityLoader.ts` para los props.
 */

const URL_PERSONAJE = "/assets/personajes/pj_01.glb";
const ALTO_MODELO = 1.7; // el .glb mide 1.7 (34 vóxeles × 0.05); se escala a ALTO_RIG

let plantilla: Promise<{ escena: THREE.Object3D } | null> | null = null;

function cargarPlantilla() {
  if (!plantilla) {
    plantilla = new GLTFLoader()
      .loadAsync(URL_PERSONAJE)
      .then((gltf) => ({ escena: gltf.scene as THREE.Object3D }))
      .catch(() => null);
  }
  return plantilla;
}

// Huesos cuyo vóxel es "túnica" (ropa) — se retiñen con el color del jugador
// para distinguir local/remoto, igual que hacía el placeholder. El resto
// (piel, pelo, piernas, zapatos) conserva su color de vóxel.
const HUESOS_TUNICA = new Set(["spine", "upperarmL", "upperarmR"]);

function tintarTunica(skinned: THREE.SkinnedMesh, colorTunica: string) {
  // La geometría de la plantilla es compartida entre clones — se clona para
  // poder editar COLOR_0 de esta instancia sin pintar a los demás jugadores.
  const geo = skinned.geometry.clone();
  skinned.geometry = geo;
  const colores = geo.getAttribute("color") as THREE.BufferAttribute;
  const joints = geo.getAttribute("skinIndex") as THREE.BufferAttribute;
  if (!colores || !joints) return;
  const indicesTunica = new Set(
    skinned.skeleton.bones.map((b, i) => (HUESOS_TUNICA.has(b.name) ? i : -1)).filter((i) => i >= 0),
  );
  const c = new THREE.Color(colorTunica);
  for (let i = 0; i < colores.count; i++) {
    if (indicesTunica.has(joints.getX(i))) colores.setXYZ(i, c.r, c.g, c.b);
  }
  colores.needsUpdate = true;
}

export function crearPersonajeVoxel(opciones: OpcionesRig): RigHumanoide {
  const raiz = new THREE.Group(); // anclada por los pies, como todo en el proyecto

  // Estado de animación (compartido entre el modelo vóxel y el fallback)
  let fase = 0;
  let pesoAndar = 0;
  let huesos: Map<string, THREE.Bone> | null = null;
  let hipsBaseY = 0;
  let rigFallback: RigHumanoide | null = null;

  cargarPlantilla().then((p) => {
    if (!p) {
      // Sin .glb: el placeholder de cajas de siempre, delegando la animación.
      rigFallback = crearRigHumanoide(opciones);
      raiz.add(rigFallback.objeto);
      return;
    }
    const escena = SkeletonUtils.clone(p.escena);
    let skinned: THREE.SkinnedMesh | null = null;
    escena.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    if (!skinned) return;
    const sk = skinned as THREE.SkinnedMesh;
    sk.frustumCulled = false; // los huesos mueven la malla fuera de su bbox estática
    tintarTunica(sk, opciones.colorTunica);
    huesos = new Map(sk.skeleton.bones.map((b) => [b.name, b]));
    hipsBaseY = huesos.get("hips")?.position.y ?? 0;
    escena.scale.setScalar(ALTO_RIG / ALTO_MODELO);
    raiz.add(escena);
  });

  const set = (nombre: string, x: number, y = 0, z = 0) => {
    const b = huesos!.get(nombre);
    if (b) b.rotation.set(x, y, z);
  };

  function actualizar(dt: number, andando: boolean) {
    if (rigFallback) {
      rigFallback.actualizar(dt, andando);
      return;
    }
    if (!huesos) return;
    pesoAndar = THREE.MathUtils.clamp(pesoAndar + (andando ? dt : -dt) * 6, 0, 1);
    fase += dt * 9 * Math.max(pesoAndar, 0.15);
    const A = 0.62 * pesoAndar;
    const swing = Math.sin(fase) * A;
    set("upperlegL", swing);
    set("upperlegR", -swing);
    set("lowerlegL", (0.55 * Math.max(0, Math.sin(fase - 1.1)) + 0.08) * pesoAndar);
    set("lowerlegR", (0.55 * Math.max(0, Math.sin(fase + Math.PI - 1.1)) + 0.08) * pesoAndar);
    set("footL", -0.15 * Math.sin(fase - 0.5) * pesoAndar);
    set("footR", 0.15 * Math.sin(fase - 0.5 + Math.PI) * -pesoAndar);
    set("upperarmL", -0.75 * swing);
    set("upperarmR", 0.75 * swing);
    set("lowerarmL", (-0.22 - 0.1 * Math.max(0, -Math.sin(fase))) * pesoAndar);
    set("lowerarmR", (-0.22 - 0.1 * Math.max(0, Math.sin(fase))) * pesoAndar);
    set("spine", 0, 0.07 * Math.sin(fase) * pesoAndar, 0);
    set("head", 0.04 * Math.sin(2 * fase) * pesoAndar, -0.07 * Math.sin(fase) * pesoAndar, 0);
    const hips = huesos.get("hips");
    if (hips) {
      // andando: rebote de zancada; parado: respiración sutil (mismos valores
      // de sensación que el rig placeholder)
      hips.position.y =
        hipsBaseY + (pesoAndar > 0.01 ? Math.abs(Math.cos(fase)) * 0.033 * pesoAndar : Math.sin(fase * 0.35) * 0.009);
    }
  }

  function orientar(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    raiz.rotation.y = Math.atan2(dx, dz); // la cara está en +Z local, como el rig
  }

  return { objeto: raiz, actualizar, orientar };
}
