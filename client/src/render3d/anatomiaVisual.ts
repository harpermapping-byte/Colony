/**
 * Anatomía por zona (docs/GDD_Anatomia.md, pedido 2026-08-30) — visual del
 * rig humanoide: oculta el pivote de una zona amputada, lo muestra tintado
 * de madera si tiene prótesis. Reusa el mismo mecanismo "buscar el pivote
 * por nombre" que equipoVisual.ts (`objeto.getObjectByName(zona)`) — los
 * pivotes de rigHumanoide.ts ya se llaman EXACTAMENTE cabeza/torso/brazoIzq/
 * brazoDer/piernaIzq/piernaDer, así que no hace falta ningún mapeo.
 */
import * as THREE from "three";

export type Zona = "cabeza" | "torso" | "brazoIzq" | "brazoDer" | "piernaIzq" | "piernaDer";
export const ZONAS: readonly Zona[] = ["cabeza", "torso", "brazoIzq", "brazoDer", "piernaIzq", "piernaDer"];

export interface EstadoZonaVista {
  amputado: boolean;
  protesis: boolean;
}

/** Mismo tono de madera que estructura_palos/tablilla en el catálogo (colorDebug). */
const COLOR_PROTESIS = 0x8a6838;

/** Aplica el estado visual de UNA zona sobre el rig — llamar para las 6 en cada cambio de `player.anatomia`. */
export function aplicarAnatomiaVisual(rigObjeto: THREE.Object3D, zona: Zona, estado: EstadoZonaVista): void {
  const pivote = rigObjeto.getObjectByName(zona);
  if (!pivote) return;

  if (estado.amputado && !estado.protesis) {
    pivote.visible = false;
    return;
  }
  pivote.visible = true;

  pivote.traverse((hijo) => {
    if (!(hijo instanceof THREE.Mesh)) return;
    const material = hijo.material as THREE.MeshStandardMaterial;
    if (!material || !("color" in material)) return;
    if (estado.protesis) {
      if (hijo.userData.colorAnatomiaOriginal == null) hijo.userData.colorAnatomiaOriginal = material.color.getHex();
      material.color.setHex(COLOR_PROTESIS);
    } else if (hijo.userData.colorAnatomiaOriginal != null) {
      material.color.setHex(hijo.userData.colorAnatomiaOriginal);
      delete hijo.userData.colorAnatomiaOriginal;
    }
  });
}

/** Las 6 zonas de golpe — `anatomiaSchema` es `player.anatomia` (AnatomiaSchema de Colyseus, con las 6 sub-entradas nombradas igual que Zona). */
export function aplicarAnatomiaCompleta(rigObjeto: THREE.Object3D, anatomiaSchema: Record<Zona, EstadoZonaVista>): void {
  for (const zona of ZONAS) {
    const zonaEstado = anatomiaSchema[zona];
    if (zonaEstado) aplicarAnatomiaVisual(rigObjeto, zona, zonaEstado);
  }
}
