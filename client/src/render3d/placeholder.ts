import * as THREE from "three";

/**
 * Cubo de color — el equivalente 3D de los placeholders planos que ya
 * generaba `bakeSpritePlaceholders`-style (`baker/src/generar_placeholders.js`).
 * Se usa mientras un `id` del catálogo todavía no tiene su `.glb` generado
 * con el taller de vóxeles: mismo color de referencia (`colorDebug`, ya
 * existente en todos los catálogos), pero con volumen real y en su sitio
 * final, así sirve directamente para validar escala/posición/anclaje sin
 * esperar al arte definitivo.
 */
export function crearPlaceholder(colorHex: string, ancho = 1, alto = 1, profundo = 1): THREE.Object3D {
  const geometria = new THREE.BoxGeometry(ancho, alto, profundo);
  const material = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.85, metalness: 0.05 });
  const cubo = new THREE.Mesh(geometria, material);
  // Anclaje por la base (abajo-centro), igual que el resto del proyecto
  // (ver nota de anclaje en bakeSpritePlaceholders del otro repo): la
  // posición que recibe el objeto es su punto en el suelo, no su centro.
  cubo.position.y = alto / 2;
  cubo.castShadow = true;
  cubo.receiveShadow = true;
  return cubo;
}
