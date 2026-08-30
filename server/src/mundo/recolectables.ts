/**
 * Recolectables EXTERIORES vivos — fase 2 de inventario ("coger del mundo",
 * docs/GDD_Inventario.md §7). Nace del pool activo/`ac:0` que YA bakea
 * baker/src/decoracion.js (docs/Backlog_Mecanicas_Futuras.md, "pool de
 * puntos de spawn") y vive MUTABLE en memoria del proceso: al coger uno se
 * borra de aquí, sin volver a aparecer hasta que el proceso se reinicie
 * (cálculo perezoso, sin tabla de BD nueva esta fase — decisión explícita,
 * ver GDD).
 */

import * as fs from "fs";
import * as path from "path";

export interface RecolectableVivo {
  itemId: string;
  x: number;
  y: number;
}

interface EntradaBake {
  categoriaRecurso?: string;
  desaparaceAlRecolectar?: boolean;
}

// t: v=vegetación, a=animal, r=roca (mismo código que ya asigna
// baker/src/decoracion.js al exportar cada objeto).
const CATALOGO_POR_CAPA: Record<string, string> = { v: "vegetacion.json", r: "rocas.json", a: "animales.json" };

const cacheCatalogos = new Map<string, Record<string, EntradaBake>>();

/** Los 3 catálogos bake, indexados por el código corto de capa (v/r/a) — con caché de proceso, son pequeños pero se piden una vez por room creada. */
export function catalogosPorCapa(rutaCatalogo: string): Record<string, Record<string, EntradaBake>> {
  const resultado: Record<string, Record<string, EntradaBake>> = {};
  for (const [capa, archivo] of Object.entries(CATALOGO_POR_CAPA)) {
    const ruta = path.join(rutaCatalogo, archivo);
    let catalogo = cacheCatalogos.get(ruta);
    if (!catalogo) {
      catalogo = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaBake>;
      cacheCatalogos.set(ruta, catalogo);
    }
    resultado[capa] = catalogo;
  }
  return resultado;
}

// Cacheado por ruta de mapa (proceso entero, no por room): una RegionRoom se
// autodispone al vaciarse y se recrea desde cero en la siguiente visita ("una
// aldea sin jugadores cuesta cero") — sin este caché, salir y volver a entrar
// resetearía todo lo ya recolectado (granjeo trivial, detectado en la crítica
// adversarial de esta fase). El Hub es singleton (un solo cargarMapaColision
// en su vida), así que aquí es un no-op salvo por consistencia.
const cachePorMapa = new Map<string, Map<number, RecolectableVivo>>();

/**
 * Devuelve el Map de recolectables vivos de este mapa — el MISMO objeto en
 * cada llamada mientras el proceso viva. `esNuevo` distingue la primera
 * llamada (toca poblarlo recorriendo el bake) de una recarga posterior
 * (reusar tal cual, con lo ya cogido todavía fuera).
 */
export function recolectablesDeMapa(rutaMapa: string): { mapa: Map<number, RecolectableVivo>; esNuevo: boolean } {
  let mapa = cachePorMapa.get(rutaMapa);
  const esNuevo = !mapa;
  if (!mapa) {
    mapa = new Map();
    cachePorMapa.set(rutaMapa, mapa);
  }
  return { mapa, esNuevo };
}

// Posiciones agotadas TEMPORALMENTE (docs/GDD_Bosques.md §7 + docs/GDD_Profesiones.md
// §0, pedido 2026-08-30: "si se puede recolectar... y se hace, acaba
// desapareciendo" — Y AHORA "con un timer para que vuelva a aparecer en el
// mismo sitio, unificado con árboles/rocas/todo recolectar". Los árboles
// se quedan con su propio sistema de semilla/propagación (GestorBosques),
// esto es SOLO para lo que pasa por `coger` (hierbas/rocas). idx -> epoch ms
// en que vuelve a estar disponible; se auto-limpia en `recolectableCercano`
// y en la consulta de exclusiones del cliente, sin ningún tick de fondo
// (mismo "cálculo perezoso" que el resto del proyecto). Mismo ciclo de vida
// que el pool activo: vive en memoria del proceso, SIN persistencia (un
// reinicio del servidor resetea recolectables Y agotados juntos, coherentes
// entre sí) — el cliente consulta esto vía `sector:exclusiones`
// (RoomExteriorBase.ts) para no dibujar el modelo bakeado de algo agotado.
const cacheAgotadosPorMapa = new Map<string, Map<number, number>>();

/** Mismo criterio de caché por proceso que `recolectablesDeMapa` — el MISMO Map en cada llamada mientras el proceso viva. */
export function recolectablesAgotadosDeMapa(rutaMapa: string): Map<number, number> {
  let agotados = cacheAgotadosPorMapa.get(rutaMapa);
  if (!agotados) {
    agotados = new Map();
    cacheAgotadosPorMapa.set(rutaMapa, agotados);
  }
  return agotados;
}

/**
 * Busca el recolectable más cercano dentro de `radio` casillas de (x,y).
 * Recorre solo la VECINDAD por clave (y*ancho+x) — nunca el Map entero, que
 * en el mapa principal puede tener decenas de miles de entradas (735k props
 * totales); escanear todo por cada pulsación de "coger" sería justo lo
 * contrario de "claves numéricas en Sets consultados por casilla" (CLAUDE.md).
 */
export function recolectableCercano(
  recolectables: Map<number, RecolectableVivo>,
  ancho: number,
  x: number,
  y: number,
  radio: number,
  agotados?: Map<number, number>,
): { idx: number; item: RecolectableVivo } | null {
  const r = Math.ceil(radio);
  const cx = Math.floor(x), cy = Math.floor(y);
  const ahora = Date.now();
  let mejor: { idx: number; item: RecolectableVivo } | null = null;
  let mejorDist = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    const py = cy + dy;
    if (py < 0) continue;
    for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx;
      if (px < 0) continue;
      const idx = py * ancho + px;
      const item = recolectables.get(idx);
      if (!item) continue;
      if (agotados) {
        const disponibleDesde = agotados.get(idx);
        if (disponibleDesde != null) {
          if (disponibleDesde > ahora) continue; // todavía regenerando, salta
          agotados.delete(idx); // ya tocaba reaparecer — autolimpieza perezosa, sin tick de fondo
        }
      }
      const d = Math.hypot(item.x + 0.5 - x, item.y + 0.5 - y);
      if (d < radio && d < mejorDist) {
        mejorDist = d;
        mejor = { idx, item };
      }
    }
  }
  return mejor;
}
