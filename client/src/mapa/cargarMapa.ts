import type { IndiceMapa, SectorBakeado } from "./formatoMapa";

/**
 * Carga de mapas bakeados servidos como asset estático
 * (`assets/mapas/<nombre>/indice.json` + `sector_XXX_YYY.json`).
 *
 * Desde la llegada del mapa principal (100 sectores, 70MB) el camino
 * normal es `cargarIndice` + `cargarSector` bajo demanda, orquestados por
 * `streamingSectores.ts` — cada sector es un fetch independiente y solo se
 * piden los cercanos al jugador. `cargarMapa` (todo de golpe) se conserva
 * para mapas pequeños y herramientas de prueba.
 */
export interface MapaCargado {
  indice: IndiceMapa;
  sectores: SectorBakeado[];
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export async function cargarIndice(rutaBase: string): Promise<IndiceMapa> {
  const r = await fetch(`${rutaBase}/indice.json`);
  if (!r.ok) throw new Error(`No se pudo cargar ${rutaBase}/indice.json (${r.status})`);
  return r.json();
}

/** Un sector concreto; null si no existe (borde de mapa no cuadrado, hueco). */
export async function cargarSector(rutaBase: string, sx: number, sy: number): Promise<SectorBakeado | null> {
  try {
    const r = await fetch(`${rutaBase}/sector_${pad3(sx)}_${pad3(sy)}.json`);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

export async function cargarMapa(rutaBase: string): Promise<MapaCargado> {
  const indice = await cargarIndice(rutaBase);

  const sectoresAncho = Math.max(1, Math.ceil(indice.anchoChunks / indice.tamanoSectorChunks));
  const sectoresAlto = Math.max(1, Math.ceil(indice.altoChunks / indice.tamanoSectorChunks));

  const peticiones: Promise<SectorBakeado | null>[] = [];
  for (let sy = 0; sy < sectoresAlto; sy++) {
    for (let sx = 0; sx < sectoresAncho; sx++) {
      peticiones.push(cargarSector(rutaBase, sx, sy));
    }
  }

  const sectores = (await Promise.all(peticiones)).filter((s): s is SectorBakeado => s !== null);
  return { indice, sectores };
}
