import animalesRigJson from "../../../personajes/catalogo/animales_rig.json";
import type { AnimalExportado, PiezaAnimal } from "./animalVoxel";

/**
 * Cuerpo PLACEHOLDER de un animal en vivo (mascota o montura) — una única
 * caja con las proporciones reales de `personajes/catalogo/animales_rig.json`,
 * a diferencia del vóxel completo que sí existe para la fauna PRE-HORNEADA
 * (`fauna.json` de cada mapa, `voxFaunaPorId` en game.ts). Una mascota/
 * montura nace en vivo (domesticación en pleno juego, imposible de
 * pre-hornear) así que hoy no tiene vóxel real — antes ni siquiera tenía
 * esta caja (grupo vacío, invisible del todo, `piezas: []`); esto es
 * mínimamente mejor y además da un pivote "lomo" real donde colgar la silla
 * de montura (docs/GDD_Monturas.md, pedido 2026-08-30). El vóxel completo
 * (patas/cabeza/cola reales) queda para cuando se porte `generarAnimal.js`
 * a TypeScript — mismo criterio ya aceptado en el proyecto de "mecanismo
 * real, arte placeholder, se pule después".
 */

interface EntradaRig {
  proporciones?: { largoCuerpo: number; altoCuerpo: number; anchoCuerpo: number; altoPata: number };
  coloresPosibles?: [string, number][];
}

const RIG: Record<string, EntradaRig> = animalesRigJson as unknown as Record<string, EntradaRig>;
const COLOR_DEFECTO = "#8a7a5a";

export function animalPlaceholder(especieId: string): AnimalExportado {
  const rig = RIG[especieId];
  const p = rig?.proporciones ?? { largoCuerpo: 1, altoCuerpo: 0.5, anchoCuerpo: 0.4, altoPata: 0.4 };
  const color = rig?.coloresPosibles?.[0]?.[0] ?? COLOR_DEFECTO;

  const cuerpo: PiezaAnimal = { pivote: "cuerpo", cx: 0, y0: p.altoPata, cz: 0, w: p.anchoCuerpo, h: p.altoCuerpo, d: p.largoCuerpo, color };
  // "lomo" (docs/GDD_Mecanicas.md "Monturas acordado 2026-08-27": "el punto
  // de silla se deriva de las proporciones: centro del lomo = altoPata +
  // altoCuerpo") — pieza casi invisible SOLO para tener un pivote con
  // nombre ahí (crearAnimalVoxel solo crea un THREE.Group por cada pivote
  // que aparece en `piezas`, nunca uno "vacío" a mano).
  const lomo: PiezaAnimal = { pivote: "lomo", cx: 0, y0: p.altoPata + p.altoCuerpo - 0.02, cz: 0, w: 0.05, h: 0.05, d: 0.05, color };

  return { ficha: { especieId, esqueleto: "cuadrupedo", escala: 1 }, piezas: [cuerpo, lomo] };
}
