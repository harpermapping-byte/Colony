import * as THREE from "three";
import type { AnimalExportado } from "./animalVoxel";
import { mallaDeVoxeles, type VoxelExportado } from "./voxelMalla";

/**
 * Fauna DECORATIVA estática del bakeador exterior (`baker/src/decoracion.js`,
 * `obj.t==="a"` en el sector bakeado) — distinta de la fauna VIVA simulada
 * (`animalVoxel.ts::crearAnimalVoxel`, con pivotes reales para animar). El
 * bake solo guarda especie+variante+posición (nunca vóxeles propios, sería
 * duplicar ~187.000 veces los mismos pocos cientos de vóxeles reales), así
 * que el aspecto real sale de un POOL pre-generado offline (mismo criterio
 * que `assets/enemigos/pool.json`, generado por
 * `personajes/src/exportar_fauna_decorativa.js`): unas pocas variantes por
 * especie (el mismo campo `variantes` de `baker/catalogo/animales.json`,
 * pensado en su día para nombrar `.glb`, nunca usado hasta ahora porque
 * nunca hubo arte real), `obj.va` cae siempre dentro de rango.
 *
 * Cada variante se funde en UNA malla estática (`voxelMalla.ts::
 * mallaDeVoxeles`, mismo mecanismo que ropa/pelo de personajes) — sin
 * pivotes ni animación, es decoración de fondo inmóvil — para poder
 * instanciarla con `InstancedMesh` en `sectorVisual.ts`, mismo patrón ya
 * usado ahí para vegetación/rocas/edificios reales: un único draw call por
 * (especie, variante, sector) en vez de un grupo de cajas por individuo.
 */

interface PoolFaunaDecorativa {
  pool: Record<string, AnimalExportado[]>;
  /** ¿Vagabundea en manada? (2026-09-09) — misma regla exacta que `esGregario` en el servidor (server/src/mundo/faunaSalvajeViva.ts, fauna VIVA): nunca carnívoros ni especies peligrosas. Calculada offline en `exportar_fauna_decorativa.js`, cero catálogo duplicado en cliente. */
  gregarioPorEspecie: Record<string, boolean>;
}

let promesaPool: Promise<PoolFaunaDecorativa | null> | null = null;

function cargarPool(): Promise<PoolFaunaDecorativa | null> {
  if (!promesaPool) {
    promesaPool = fetch("/assets/animales/pool.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return promesaPool;
}

/** `null` mientras el pool no ha terminado de cargar (defensivo — `faunaDecorativaMovimiento.ts` ya llama primero a `obtenerMallaFaunaDecorativa`, que espera a `cargarPool()`, así que en la práctica esto siempre resuelve de inmediato desde caché para cuando se consulta). */
export async function esFaunaDecorativaGregaria(especieId: string): Promise<boolean> {
  const datos = await cargarPool();
  return datos?.gregarioPorEspecie[especieId] ?? false;
}

// Malla fusionada (geometría+material COMPARTIDOS, nunca dispose-ados por
// `soltarSectorVisual` — mismo criterio que la plantilla `.glb` cacheada de
// `entityLoader`, viva mientras dure la sesión y reusada por cualquier
// sector con la misma especie+variante a la vez) o `null` si esa especie no
// tiene pool (defensivo — hoy las 189/189 especies del catálogo lo tienen).
const cacheMallas = new Map<string, THREE.Mesh | null>();

export async function obtenerMallaFaunaDecorativa(especieId: string, variante: number): Promise<THREE.Mesh | null> {
  const clave = `${especieId}:${variante}`;
  if (cacheMallas.has(clave)) return cacheMallas.get(clave)!;

  const datos = await cargarPool();
  const variantes = datos?.pool[especieId];
  if (!variantes || variantes.length === 0) {
    cacheMallas.set(clave, null);
    return null;
  }
  const elegida = variantes[variante % variantes.length];
  const voxeles: VoxelExportado[] = elegida.piezas.map((p) => ({
    x: p.cx,
    y: p.y0 + p.h / 2,
    z: p.cz,
    tam: [p.w, p.h, p.d],
    color: p.color,
  }));
  const malla = mallaDeVoxeles(voxeles);
  cacheMallas.set(clave, malla);
  return malla;
}
