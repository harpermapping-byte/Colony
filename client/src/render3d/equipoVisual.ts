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
 * pre-hornea, se construye en el navegador). `generarPiezaVoxel`
 * (generarEquipoVoxel.ts) es un PUERTO nativo a TS de la lógica de
 * `ropa/src/generarEquipo.js` (que solo corre offline/Node) — NO es la misma
 * función importada, así que un cambio en el generador offline (p.ej. un
 * slot nuevo en `POSICION_POR_SLOT`) hay que reflejarlo a mano aquí también
 * (auditoría de concurrencia 2026-09-02, ver el comentario propio de
 * generarEquipoVoxel.ts).
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
 * Blueprint YA resuelto (JSON parseado) de una prenda legendaria — espejo
 * de `HubState.blueprintsRopa` (docs/GDD_Ropa_Procedural.md §Sastre
 * legendario). Quien llama a `aplicarEquipoAlRig`/`voxelesDeEquipo` es
 * responsable de convertir el `MapSchema<BlueprintRopaSchema>` de Colyseus
 * a este shape (JSON.parse de detalleJson/tintesJson) — este módulo no
 * sabe nada de Colyseus a propósito, mismo criterio que el resto del archivo.
 */
export interface BlueprintRopaResuelto {
  prendaBaseId: string;
  materialId: string;
  detalle: Record<string, unknown>;
  tintes: Record<string, string>;
}

/**
 * Vóxeles de UNA pieza equipada, ya resueltos a un slot físico concreto (para
 * anillo, que puede caer en cualquier mano). Ropa civil craftable
 * (docs/GDD_Profesiones.md, 2026-08-30): `prendaId` se busca primero en
 * `prendas.json` (esquema RICO de vóxel, `generarPrendaVoxel` — mismo
 * detalle que la ropa de NPC) y solo si no está ahí en `equipo.json`
 * (esquema simple, un box por slot — las 48 piezas de armadura). Nunca
 * ambos a la vez: un `prendaId` pertenece a un único catálogo.
 *
 * `blueprint` (Sastre legendario, pedido 2026-08-31): si este slot concreto
 * lleva una prenda legendaria, SUSTITUYE el `materialId`/`detalle`/`tintes`
 * que usaría el catálogo estático — el `prendaBaseId` del blueprint decide
 * qué arquetipo (silueta/zonasColor) usar, igual que si fuera su propio
 * itemId. Así lo que se vio en el panel del telar se ve IGUAL puesto.
 */
function voxelesDePieza(itemId: string, slotFisico: string, semilla: string, blueprint?: BlueprintRopaResuelto): VoxelExportado[] {
  if (blueprint) {
    const prendaBase = CATALOGOS_ROPA.prendas[blueprint.prendaBaseId];
    const material = CATALOGOS_ROPA.materiales[blueprint.materialId];
    if (!prendaBase || !material) return [];
    return generarPrendaVoxel(prendaBase, material, {
      semilla, prendaId: blueprint.prendaBaseId, materialId: blueprint.materialId,
      detalleOverride: blueprint.detalle, tintes: blueprint.tintes,
    });
  }

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
 * MapSchema real como si ya se aplanó a un objeto plano). `blueprintsPorSlot`
 * (Sastre legendario, opcional) — slot->blueprint YA resuelto, para los
 * slots donde lo equipado es una prenda legendaria (ausente = todos los
 * slots se resuelven por catálogo estático, comportamiento de siempre).
 */
export function voxelesDeEquipo(
  equipo: Iterable<[string, string]> | Record<string, string>,
  semilla: string,
  blueprintsPorSlot?: Record<string, BlueprintRopaResuelto>,
): VoxelExportado[] {
  const entradas: [string, string][] = Symbol.iterator in Object(equipo)
    ? [...(equipo as Iterable<[string, string]>)]
    : Object.entries(equipo as Record<string, string>);
  const voxeles: VoxelExportado[] = [];
  for (const [slot, itemId] of entradas) {
    if (!itemId) continue;
    voxeles.push(...voxelesDePieza(itemId, slot, semilla, blueprintsPorSlot?.[slot]));
  }
  return voxeles;
}

/**
 * Cuelga el equipo (ya generado) del rig — quita primero cualquier malla de
 * equipo previa (mismo pivote o no) para que un cambio de equipo nunca
 * acumule piezas viejas encima de las nuevas.
 */
export function aplicarEquipoAlRig(
  rigObjeto: THREE.Object3D,
  equipo: Iterable<[string, string]> | Record<string, string>,
  semilla: string,
  blueprintsPorSlot?: Record<string, BlueprintRopaResuelto>,
): void {
  rigObjeto.traverse((nodo) => {
    if (nodo.userData?.[ETIQUETA_EQUIPO]) nodo.removeFromParent();
  });
  const voxeles = voxelesDeEquipo(equipo, semilla, blueprintsPorSlot);
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
