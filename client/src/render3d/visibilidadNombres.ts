/**
 * Nombres flotantes SOLO de cerca (docs/GDD_UI_Paneles.md, pedido streamer
 * 2026-09-12: "los nombres... solo se muestran al acercarte mucho... o al
 * darle click") — lógica de histéresis PURA, sin THREE/DOM, en su PROPIO
 * módulo a propósito: `worldScene.ts` importa transitivamente `cicloDia.ts`
 * -> `tiempoMundo.ts`, que lee `location.search` en el TOP LEVEL del
 * módulo — importar `worldScene.ts` entero revienta en un test de Node
 * puro (sin `location` global). Separar esto aquí es lo que permite
 * testear la histéresis sin arrastrar esa cadena.
 */

/** Doble radio con histéresis (mismo patrón ya usado por streamingSectores.ts/RADIO_INTERES_SALIDA_TILES): aparece a <=12, desaparece a >15 — nunca al revés, para no parpadear justo en el borde. */
export const RADIO_NOMBRE_VISIBLE = 12;
export const RADIO_NOMBRE_OCULTAR = 15;

/**
 * Decisión pura: dado si la etiqueta YA estaba visible y la distancia al
 * cuadrado (evita `Math.sqrt` en el hot path de cada frame) contra los dos
 * radios al cuadrado, dice si debería seguir/pasar a visible. Nunca cambia
 * de estado a medio camino (entre los dos radios) — eso es la histéresis.
 */
export function decidirVisibilidadNombre(visibleAhora: boolean, distancia2: number, radioVisible2: number, radioOcultar2: number): boolean {
  if (!visibleAhora && distancia2 <= radioVisible2) return true;
  if (visibleAhora && distancia2 > radioOcultar2) return false;
  return visibleAhora;
}
