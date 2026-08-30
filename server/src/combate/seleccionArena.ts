/**
 * Elegir qué mapa de arena bakeada usar para un combate (docs/GDD_Combate.md
 * §9.4) — determinista por `combateId` (mismo criterio mulberry32 que el
 * resto del proyecto, ver interiores/src/azar.js), no Math.random().
 */
import * as fs from "fs";
import * as path from "path";

const RUTA_CATALOGO_DEFECTO = path.join(__dirname, "..", "..", "..", "mazmorras", "catalogo", "arenas.json");

/** docs/GDD_Barcos.md (pedido 2026-08-30) — "tierra" (pradera/bosque/...) o "agua" (combate acuático: orca/tiburón/...). */
export type TerrenoArena = "tierra" | "agua";

export interface EntradaArena {
  id: string;
  terreno: TerrenoArena;
}

export function cargarCatalogoArenas(ruta: string = RUTA_CATALOGO_DEFECTO): EntradaArena[] {
  const bruto = JSON.parse(fs.readFileSync(ruta, "utf8")) as { arenas: EntradaArena[] };
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

/**
 * `terreno` (docs/GDD_Barcos.md, pedido 2026-08-30): si se pide, filtra a
 * solo las arenas de ese terreno — un combate acuático NUNCA debería caer
 * en una arena de pradera. Si el catálogo todavía no tiene ninguna de ese
 * terreno (p.ej. antes de que el streamer bakee más variantes de agua),
 * cae al catálogo COMPLETO en vez de romper el combate — mejor una arena
 * de tierra "incorrecta" que un combate que no puede ni empezar.
 */
export function elegirArena(combateId: string, arenas: EntradaArena[], terreno?: TerrenoArena): string {
  if (arenas.length === 0) throw new Error("catálogo de arenas de combate vacío (mazmorras/catalogo/arenas.json)");
  const candidatas = terreno ? arenas.filter((a) => a.terreno === terreno) : arenas;
  const lista = candidatas.length > 0 ? candidatas : arenas;
  return lista[hashDeterminista(combateId) % lista.length].id;
}
