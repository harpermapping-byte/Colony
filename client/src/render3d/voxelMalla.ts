import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Fusión de vóxeles exportados por los generadores (ropa/personajes) en UNA
 * geometría por grupo — el contrato pactado: cada prenda/pelo/pieza es una
 * sola malla colgada de su pivote del rig, sin física propia, y cada vóxel
 * se construye con TODAS sus caras (regla del streamer: nada se ve hueco
 * desde ningún ángulo; la única optimización permitida sería quitar caras
 * interiores entre vóxeles adyacentes — de momento ni eso, los recuentos
 * son pequeños). El color va por vértice (paleta del generador) sobre un
 * material único, así toda la fusión es un solo draw call.
 */

export interface VoxelExportado {
  x: number;
  y: number; // CENTRO de la celda
  z: number;
  tam: [number, number, number];
  color: string;
  pivote?: string;
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

export function mallaDeVoxeles(voxeles: VoxelExportado[]): THREE.Mesh | null {
  if (!voxeles.length) return null;
  const color = new THREE.Color();
  const geometrias = voxeles.map((v) => {
    const g = new THREE.BoxGeometry(v.tam[0], v.tam[1], v.tam[2]);
    g.translate(v.x, v.y, v.z);
    color.set(v.color);
    const n = g.attributes.position.count;
    const colores = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colores[i * 3] = color.r;
      colores[i * 3 + 1] = color.g;
      colores[i * 3 + 2] = color.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    return g;
  });
  const fusion = mergeGeometries(geometrias);
  geometrias.forEach((g) => g.dispose());
  const malla = new THREE.Mesh(fusion, material);
  malla.castShadow = true;
  return malla;
}

/** Agrupa vóxeles por su pivote y devuelve una malla fusionada por pivote. */
export function mallasPorPivote(voxeles: VoxelExportado[]): Map<string, THREE.Mesh> {
  const porPivote = new Map<string, VoxelExportado[]>();
  for (const v of voxeles) {
    const clave = v.pivote || "torso";
    if (!porPivote.has(clave)) porPivote.set(clave, []);
    porPivote.get(clave)!.push(v);
  }
  const resultado = new Map<string, THREE.Mesh>();
  for (const [pivote, lista] of porPivote) {
    const malla = mallaDeVoxeles(lista);
    if (malla) resultado.set(pivote, malla);
  }
  return resultado;
}
