/**
 * Ganadería (docs/GDD_Ganaderia.md, pedido 2026-08-30) — PURO (sin fs/BD/
 * Colyseus), mismo patrón que arenaCombate.ts/lootCaza.ts: recintos vallados
 * y escape diario de animales de granja.
 */
import { MundoColision, TIPO, tipoEn } from "./colisiones";

const DIRECCIONES: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * Si el flood-fill (BFS 4-vecinos, mismo algoritmo que `puntoEnPoligono`+
 * estanqueidad de `ciudades/src/generar.js`, portado a la rejilla de
 * colisión EN VIVO) desde (x,y) se agota dentro de `topeCasillas` sin
 * escapar, el animal está "encerrado" — cualquier `valla_madera`/
 * `empalizada_tramo` (colision:true) ya bloquea el flood-fill como
 * cualquier otro sólido, así que NO hace falta ningún concepto nuevo de
 * "recinto": una valla real ya lo es. Si el flood-fill sigue creciendo
 * más allá del tope (terreno abierto, sin vallar), se considera "abierto".
 */
export const TOPE_CASILLAS_VALLADO = 500;

export function estaEncerrado(mundo: MundoColision, x: number, y: number, topeCasillas: number = TOPE_CASILLAS_VALLADO): boolean {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const visitado = new Set<number>([y0 * mundo.ancho + x0]);
  const pendiente: Array<[number, number]> = [[x0, y0]];

  while (pendiente.length > 0) {
    if (visitado.size > topeCasillas) return false;
    const [cx, cy] = pendiente.pop()!;
    for (const [dx, dy] of DIRECCIONES) {
      const nx = cx + dx, ny = cy + dy;
      if (tipoEn(mundo, nx, ny) === TIPO.SOLIDO) continue; // valla, empalizada o terreno sólido: bloquea el flood-fill
      const clave = ny * mundo.ancho + nx;
      if (visitado.has(clave)) continue;
      visitado.add(clave);
      pendiente.push([nx, ny]);
    }
  }
  return true;
}

/** 20% diario, pedido explícito del streamer — fija, no varía por especie. */
export const PROBABILIDAD_ESCAPE_DIARIA = 0.2;
/** Tope de tiradas por resolución perezosa (jugador ausente muchos días de mundo) — evita miles de rnd() de golpe, y a partir de ~14 días sin vallar ya es prácticamente seguro que escapó. */
export const TOPE_DIAS_ESCAPE_CHEQUEADOS = 14;

/**
 * Una tirada de 20% por cada día transcurrido desde la última resolución —
 * si el animal está `encerrado` (vallado de verdad) NUNCA escapa, sea cual
 * sea `diasTranscurridos`. `rnd` inyectable (por defecto `Math.random`,
 * evento EN VIVO, no bake) para poder testear el 20% sin aleatoriedad real.
 */
export function tiroEscape(diasTranscurridos: number, encerrado: boolean, rnd: () => number = Math.random): boolean {
  if (encerrado || diasTranscurridos <= 0) return false;
  const dias = Math.min(diasTranscurridos, TOPE_DIAS_ESCAPE_CHEQUEADOS);
  for (let i = 0; i < dias; i++) {
    if (rnd() < PROBABILIDAD_ESCAPE_DIARIA) return true;
  }
  return false;
}
