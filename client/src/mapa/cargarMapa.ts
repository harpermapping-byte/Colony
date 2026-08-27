import type { IndiceMapa, SectorBakeado } from "./formatoMapa";

/**
 * Carga un mapa bakeado servido como asset estático
 * (`assets/mapas/<nombre>/indice.json` + `sector_XXX_YYY.json`).
 *
 * De momento se cargan TODOS los sectores del mapa de golpe — válido para
 * el mapa demo (48x48) y mapas pequeños. La carga perezosa por cercanía al
 * jugador (mismo principio de chunks del servidor, GDD exteriores sección
 * 14) entra cuando se conecte el mapa principal grande; la interfaz ya lo
 * permite (cada sector es un fetch independiente).
 */
export interface MapaCargado {
  indice: IndiceMapa;
  sectores: SectorBakeado[];
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export async function cargarMapa(rutaBase: string): Promise<MapaCargado> {
  const r = await fetch(`${rutaBase}/indice.json`);
  if (!r.ok) throw new Error(`No se pudo cargar ${rutaBase}/indice.json (${r.status})`);
  const indice: IndiceMapa = await r.json();

  const sectoresAncho = Math.max(1, Math.ceil(indice.anchoChunks / indice.tamanoSectorChunks));
  const sectoresAlto = Math.max(1, Math.ceil(indice.altoChunks / indice.tamanoSectorChunks));

  const peticiones: Promise<SectorBakeado | null>[] = [];
  for (let sy = 0; sy < sectoresAlto; sy++) {
    for (let sx = 0; sx < sectoresAncho; sx++) {
      peticiones.push(
        fetch(`${rutaBase}/sector_${pad3(sx)}_${pad3(sy)}.json`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      );
    }
  }

  const sectores = (await Promise.all(peticiones)).filter((s): s is SectorBakeado => s !== null);
  return { indice, sectores };
}
