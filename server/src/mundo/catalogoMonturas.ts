/**
 * Carga `personajes/catalogo/animales_rig.json` y lo reduce a lo único que
 * hace falta en el servidor para monturas (docs/GDD_Monturas.md, pedido
 * 2026-08-30): qué especies son `montable` y a qué velocidad. El resto del
 * catálogo (esqueleto/proporciones/rasgos/colores) es SOLO del generador
 * visual (`personajes/src/generarAnimal.js`) — cero duplicado aquí, mismo
 * criterio que `catalogoCombateFauna.ts` con `baker/catalogo/animales.json`.
 */
import * as fs from "fs";
import * as path from "path";

export interface DatosMontura {
  montable: boolean;
  /** casillas/seg — solo tiene sentido si montable es true. */
  velocidadMontura: number;
}

export type CatalogoMonturas = Record<string, DatosMontura>;

interface EntradaCatalogoRig {
  montable?: boolean;
  velocidadMontura?: number;
}

const RUTA_DEFECTO = path.join(__dirname, "..", "..", "..", "personajes", "catalogo", "animales_rig.json");

export function cargarCatalogoMonturas(ruta: string = RUTA_DEFECTO): CatalogoMonturas {
  const raw = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaCatalogoRig>;
  const catalogo: CatalogoMonturas = {};
  for (const [id, datos] of Object.entries(raw)) {
    if (id.startsWith("_") || !datos || typeof datos !== "object" || !datos.montable) continue;
    catalogo[id] = { montable: true, velocidadMontura: datos.velocidadMontura ?? 4 };
  }
  return catalogo;
}
