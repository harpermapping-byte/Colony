import * as THREE from "three";

/**
 * Silla de montura (docs/GDD_Monturas.md, pedido 2026-08-30: "objeto
 * MONTURA que aparecerá en su lomo, como en la vida real el prop sobre el
 * sprite del animal") + el rig del jinete encima — ambos colgados del
 * pivote "lomo" del animal (`animalPlaceholder.ts`), mismo patrón de
 * "quitar lo previo, colgar lo nuevo" que `equipoVisual.ts`. Servidor
 * autoritativo: aquí solo se pinta lo que `Player.monturaEspecieId` ya dice
 * que es verdad.
 */

const ETIQUETA_MONTURA = "monturaVisual";
const COLOR_SILLA = "#5a3a20";

/** Cuelga la silla (siempre) + el rig del jinete (si se pasa) del pivote "lomo" de la montura. Quita cualquier silla/jinete previos de ESTE animal antes de colgar. */
export function aplicarMonturaAlAnimal(animalObjeto: THREE.Object3D, rigJinete: THREE.Object3D | null): void {
  animalObjeto.traverse((nodo) => {
    if (nodo.userData?.[ETIQUETA_MONTURA]) nodo.removeFromParent();
  });
  const lomo = animalObjeto.getObjectByName("lomo");
  if (!lomo) return;

  const silla = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.1, 0.42),
    new THREE.MeshStandardMaterial({ color: COLOR_SILLA, roughness: 0.9, metalness: 0 }),
  );
  silla.position.y = 0.05;
  silla.castShadow = true;
  silla.userData[ETIQUETA_MONTURA] = true;
  lomo.add(silla);

  if (rigJinete) {
    rigJinete.position.set(0, 0.14, 0);
    rigJinete.userData[ETIQUETA_MONTURA] = true;
    lomo.add(rigJinete);
  }
}

/** Quita silla + jinete de un animal (al desmontar, o al reciclar la entidad). */
export function quitarMonturaDeAnimal(animalObjeto: THREE.Object3D): void {
  animalObjeto.traverse((nodo) => {
    if (nodo.userData?.[ETIQUETA_MONTURA]) nodo.removeFromParent();
  });
}
