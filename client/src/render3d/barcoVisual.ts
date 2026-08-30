import * as THREE from "three";
import itemsJson from "../../../items/catalogo/items.json";
import { crearPlaceholder } from "./placeholder";

/**
 * Placeholder visual de un barco (docs/GDD_Barcos.md, pedido 2026-08-30) —
 * mismo criterio que animalPlaceholder.ts: una caja con la huella real del
 * catálogo (crece en largo según la talla) mientras taller-vox/generar_
 * barco.js no tenga su .glb aprobado y subido. Satisface la MISMA forma
 * {objeto:THREE.Group, actualizar, orientar} que RigHumanoide/AnimalVoxel
 * (worldScene/game.ts los tratan todos por igual) — sin animación propia
 * (un barco no anda), orientar solo gira el casco hacia donde apunta la proa.
 */
export interface BarcoVisual {
  objeto: THREE.Group;
  actualizar(dt: number): void;
  orientar(dx: number, dz: number): void;
}

interface EntradaItemBarco {
  esBarco?: boolean;
  huella?: [number, number];
  colorDebug?: string;
}

const ITEMS: Record<string, EntradaItemBarco> = itemsJson as unknown as Record<string, EntradaItemBarco>;

export function crearBarcoVisual(tipoId: string): BarcoVisual {
  const datos = ITEMS[tipoId];
  const [ancho, largo] = datos?.huella ?? [3, 1];
  const objeto = new THREE.Group();
  const casco = crearPlaceholder(datos?.colorDebug ?? "#5a3a20", ancho, 0.6, largo);
  objeto.add(casco);
  return {
    objeto,
    actualizar() {},
    orientar(dx: number, dz: number) {
      if (dx !== 0 || dz !== 0) objeto.rotation.y = Math.atan2(dx, dz);
    },
  };
}
