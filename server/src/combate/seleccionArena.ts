/**
 * Elegir qué mapa de arena bakeada usar para un combate (docs/GDD_Combate.md
 * §9.4) — determinista por `combateId` (mismo criterio mulberry32 que el
 * resto del proyecto, ver interiores/src/azar.js), no Math.random().
 */
import * as fs from "fs";
import * as path from "path";

const RUTA_CATALOGO_DEFECTO = path.join(__dirname, "..", "..", "..", "mazmorras", "catalogo", "arenas.json");

export function cargarCatalogoArenas(ruta: string = RUTA_CATALOGO_DEFECTO): string[] {
  const bruto = JSON.parse(fs.readFileSync(ruta, "utf8")) as { arenas: string[] };
  return bruto.arenas;
}

/** Índice determinista 0..n-1 a partir de una cadena — mismo hash que interiores/src/azar.js:crearPRNG, sin el generador entero (aquí solo hace falta UN número). */
function hashDeterminista(texto: string): number {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function elegirArena(combateId: string, arenas: string[]): string {
  if (arenas.length === 0) throw new Error("catálogo de arenas de combate vacío (mazmorras/catalogo/arenas.json)");
  return arenas[hashDeterminista(combateId) % arenas.length];
}
