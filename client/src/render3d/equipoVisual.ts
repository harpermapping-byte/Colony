import * as THREE from "three";
import { mallasPorPivote, type VoxelExportado } from "./voxelMalla";
import { generarPiezaVoxel } from "./generarEquipoVoxel";
import { generarPrendaVoxel } from "./generarPrendaVoxel";
import equipoJson from "../../../ropa/catalogo/equipo.json";
import prendasJson from "../../../ropa/catalogo/prendas.json";
import materialesJson from "../../../interiores/catalogo/materiales.json";
import itemsJson from "../../../items/catalogo/items.json";

/**
 * Render EN VIVO del equipo puesto (docs/GDD_Equipo.md) — a diferencia de la
 * ropa/vóxeles de un NPC (bakeados una vez offline, `poblacion/`, el
 * cliente solo los LEE), lo que un jugador tiene equipado cambia en
 * caliente y es imposible de pre-hornear por combinación — mismo criterio
 * que ya usa `rigHumanoide.ts` (el propio rig del jugador tampoco se
 * pre-hornea, se construye en el navegador). `generarPieza` (ropa/src/
 * generarEquipo.js) es la MISMA función que usaría cualquier bakeador
 * offline — no se duplica su lógica aquí, solo se importa (mismo patrón ya
 * usado por client/src/render3d/catalogoVisual.ts para JSON de otros
 * paquetes, extendido aquí a una función pura sin dependencias de Node).
 *
 * Catálogos importados como JSON de Vite (build-time, no `fs` en el
 * navegador) — `materialesJson` es la MISMA fuente que ya usa el bakeador
 * (interiores/catalogo/materiales.json, CLAUDE.md "catálogo como fuente de
 * verdad"), nunca una copia.
 */

type CatalogoItems = Record<string, { prendaId?: string; slotEquipo?: string }>;
const ITEMS: CatalogoItems = itemsJson as unknown as CatalogoItems;
const CATALOGOS_ROPA = {
  equipo: equipoJson as Record<string, any>,
  prendas: prendasJson as Record<string, any>,
  materiales: materialesJson as Record<string, any>,
};

// Marca las mallas que este módulo añade al rig, para poder quitarlas todas
// de golpe antes de regenerar (equipo cambiado) sin tocar el resto del rig
// (cuerpo, ropa base si algún día existe, pelo...).
const ETIQUETA_EQUIPO = "equipoVisual";

/**
 * Vóxeles de UNA pieza equipada, ya resueltos a un slot físico concreto (para
 * anillo, que puede caer en cualquier mano). Ropa civil craftable
 * (docs/GDD_Profesiones.md, 2026-08-30): `prendaId` se busca primero en
 * `prendas.json` (esquema RICO de vóxel, `generarPrendaVoxel` — mismo
 * detalle que la ropa de NPC) y solo si no está ahí en `equipo.json`
 * (esquema simple, un box por slot — las 48 piezas de armadura). Nunca
 * ambos a la vez: un `prendaId` pertenece a un único catálogo.
 */
function voxelesDePieza(itemId: string, slotFisico: string, semilla: string): VoxelExportado[] {
  const entrada = ITEMS[itemId];
  if (!entrada?.prendaId) return []; // ítem sin representación visual todavía (placeholder de contenido, no error)

  const prenda = CATALOGOS_ROPA.prendas[entrada.prendaId];
  if (prenda) {
    const materialId = prenda.materialesCompatibles[0];
    const material = CATALOGOS_ROPA.materiales[materialId];
    if (!material) return [];
    const voxeles = generarPrendaVoxel(prenda, material, { semilla, prendaId: entrada.prendaId, materialId });
    // slotCuerpo (torso/piernas/cabeza) no distingue mano/anillo como
    // slotFisico — la ropa cuelga siempre del pivote que fija generarPrendaVoxel.
    return voxeles;
  }

  const pieza = CATALOGOS_ROPA.equipo[entrada.prendaId];
  if (!pieza) return [];
  const materialId = pieza.materialesCompatibles[0]; // determinista: siempre el primero declarado (mismo criterio simple que el resto de este módulo, sin sesgo de riqueza aquí — eso ya lo decidió qué pieza se generó/dropeó, no cómo se pinta)
  const material = CATALOGOS_ROPA.materiales[materialId];
  if (!material) return [];
  return generarPiezaVoxel(pieza, material, { semilla, piezaId: entrada.prendaId, materialId, slotFisico });
}

/**
 * Vóxeles de TODO lo equipado por un jugador — `equipo` es slot->itemId
 * (mismo shape que `InventarioSchema.equipo`, tanto si llega como
 * MapSchema real como si ya se aplanó a un objeto plano).
 */
export function voxelesDeEquipo(equipo: Iterable<[string, string]> | Record<string, string>, semilla: string): VoxelExportado[] {
  const entradas: [string, string][] = Symbol.iterator in Object(equipo)
    ? [...(equipo as Iterable<[string, string]>)]
    : Object.entries(equipo as Record<string, string>);
  const voxeles: VoxelExportado[] = [];
  for (const [slot, itemId] of entradas) {
    if (!itemId) continue;
    voxeles.push(...voxelesDePieza(itemId, slot, semilla));
  }
  return voxeles;
}

/**
 * Cuelga el equipo (ya generado) del rig — quita primero cualquier malla de
 * equipo previa (mismo pivote o no) para que un cambio de equipo nunca
 * acumule piezas viejas encima de las nuevas.
 */
export function aplicarEquipoAlRig(rigObjeto: THREE.Object3D, equipo: Iterable<[string, string]> | Record<string, string>, semilla: string): void {
  rigObjeto.traverse((nodo) => {
    if (nodo.userData?.[ETIQUETA_EQUIPO]) nodo.removeFromParent();
  });
  const voxeles = voxelesDeEquipo(equipo, semilla);
  for (const [pivote, malla] of mallasPorPivote(voxeles)) {
    const nodo = rigObjeto.getObjectByName(pivote);
    if (!nodo) {
      console.warn(`equipoVisual: el rig no tiene pivote "${pivote}" — equipo descartado`);
      continue;
    }
    malla.userData[ETIQUETA_EQUIPO] = true;
    nodo.add(malla);
  }
}
