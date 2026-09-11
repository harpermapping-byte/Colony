import { Vector3, Quaternion } from "three";

/**
 * Compensa el desplazamiento esquina-vs-centro de un edificio (pedido
 * streamer 2026-09-11: "la generacion de edificios... la colision NO
 * COINCIDE con la forma"). `taller-vox/generar_edificio.js` exporta el
 * `.glb` de un edificio ANCLADO POR LA ESQUINA de su propia rejilla local
 * (`centrarXZ:false` por defecto en `exportar_glb.js`, nunca re-exportado
 * con `--centrar-xz` como sí se hizo para el mobiliario de interiores) —
 * mientras que la posición que maneja `sectorVisual.ts` (`obj.dx/dy`) es
 * el CENTRO real del footprint de colisión. Sin compensar, la geometría
 * (cuyo origen local (0,0,0) es su ESQUINA) se renderiza con esa esquina
 * en el centro del footprint, desplazando el edificio entero media
 * anchura/altura de su huella de colisión real — documentado como
 * pendiente real en `docs/GDD_Motor_3D_Props.md` desde 2026-09-09
 * ("blast radius mucho mayor: cientos de .glb ya aprobados y subidos"),
 * cerrado aquí SIN tocar ningún `.glb` ya aprobado: pura corrección de
 * posición en el cliente.
 *
 * Devuelve la posición de TRASLACIÓN que hay que usar en vez del centro
 * real del footprint, para que la esquina local (0,0,0) de la geometría
 * caiga sobre la esquina real de la huella (rotada/escalada igual que el
 * resto de la instancia) — función PURA (nunca muta `centroFootprint`),
 * testeable en Node con las clases de math de `three` (sin DOM/WebGL).
 */
export function posicionEsquinaEdificio(
  centroFootprint: Vector3,
  rotacion: Quaternion,
  anchoReal: number,
  largoReal: number,
  escala: number,
): Vector3 {
  const offset = new Vector3((anchoReal / 2) * escala, 0, (largoReal / 2) * escala).applyQuaternion(rotacion);
  return centroFootprint.clone().sub(offset);
}
