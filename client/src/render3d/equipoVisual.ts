import * as THREE from "three";
import { mallasPorPivote, type VoxelExportado } from "./voxelMalla";
import { generarPiezaVoxel } from "./generarEquipoVoxel";
import { generarPrendaVoxel } from "./generarPrendaVoxel";
import { obtenerPlantilla } from "./entityLoader";
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

type CatalogoItems = Record<string, { prendaId?: string; slotEquipo?: string; tipo?: string }>;
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

// Manos (docs/GDD_Motor_3D_Props.md, pedido streamer 2026-09-08: "las
// herramientas/armas equipadas siguen siendo una caja coloreada, el vóxel
// real ya existe (taller-vox/generar_herramientas.js+generar_armas.js) pero
// nadie lo consume") — SOLO estos dos slots (lo que de verdad se ve "en la
// mano") intentan cargar un `.glb` real por convención de nombre
// (`assets/herramientas|armas/<itemId>_01.glb`, clave = el id del ítem, NO
// el `prendaId` coarse que colapsa 60+ ítems a 8 cajas — ver §12bis de
// GDD_Inventario.md) ANTES de caer a la caja de siempre. Mismo offset/pivote
// que ya usaba la caja (`POSICION_POR_SLOT` de generarEquipoVoxel.ts,
// copiado aquí a propósito — mismo límite de sincronía a mano documentado
// en la cabecera del archivo) — el resto de slots (torso/piernas/cabeza...)
// NO tiene ningún pipeline de `.glb` todavía, se quedan con la caja tal cual.
const PIVOTE_MANO: Record<string, string> = { manoPrincipal: "manoDer", manoSecundaria: "manoIzq" };
const OFFSET_MANO = { x: 0, y: -0.18, z: 0.06 };

/** "herramientas"/"armas" si el ítem tiene `.glb` real posible por su `tipo` de catálogo, `null` si no (cae siempre a la caja). */
function categoriaRealDeMano(itemId: string): "herramientas" | "armas" | null {
  const tipo = ITEMS[itemId]?.tipo;
  if (tipo === "herramienta") return "herramientas";
  if (tipo === "arma") return "armas";
  return null;
}

// Generación actual por rig — incrementada en CADA llamada a
// `aplicarEquipoAlRig`; la carga async de un `.glb` de mano se descarta si,
// cuando resuelve, el rig ya pidió una generación más nueva (equipo
// cambiado de nuevo, o el rig se destruyó) — mismo criterio de guarda de
// carrera que `renderConstrucciones.ts::sustituirPorModeloRealSiExiste`.
const generacionPorRig = new WeakMap<THREE.Object3D, number>();

/**
 * Intenta sustituir la caja de un slot de mano por su `.glb` real — si no
 * existe (categoría sin pipeline, o pieza sin aprobar/exportar todavía), no
 * hace nada: la caja síncrona ya puesta por `aplicarEquipoAlRig` se queda.
 */
async function intentarPiezaManoReal(rigObjeto: THREE.Object3D, slot: string, itemId: string, generacion: number): Promise<void> {
  const categoria = categoriaRealDeMano(itemId);
  if (!categoria) return;
  const plantilla = await obtenerPlantilla(categoria, itemId, { tipo: "numerada", indice: 0 });
  if (!plantilla) return; // sin .glb todavía (pieza sin exportar) — caja de siempre, sin error
  if (generacionPorRig.get(rigObjeto) !== generacion) return; // carrera perdida: el equipo ya cambió de nuevo

  const pivoteNombre = PIVOTE_MANO[slot];
  const nodo = rigObjeto.getObjectByName(pivoteNombre);
  if (!nodo) return;
  // Quita SOLO la caja placeholder de ESTE slot concreto (marcada con el
  // itemId que la generó) — nunca el resto del equipo, que puede seguir
  // resolviendo su propia carga real por separado.
  for (const hijo of [...nodo.children]) {
    if (hijo.userData?.[ETIQUETA_EQUIPO] && hijo.userData?.slotEquipoMano === slot) {
      (hijo as THREE.Mesh).geometry?.dispose();
      hijo.removeFromParent();
    }
  }
  const instancia = plantilla.clone(true);
  instancia.position.set(OFFSET_MANO.x, OFFSET_MANO.y, OFFSET_MANO.z);
  instancia.userData[ETIQUETA_EQUIPO] = true;
  instancia.userData.slotEquipoMano = slot;
  instancia.userData.esClonReal = true; // NO disponer su geometría al limpiar — es la plantilla cacheada, compartida
  nodo.add(instancia);
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
  const generacion = (generacionPorRig.get(rigObjeto) ?? 0) + 1;
  generacionPorRig.set(rigObjeto, generacion);

  rigObjeto.traverse((nodo) => {
    if (!nodo.userData?.[ETIQUETA_EQUIPO]) return;
    // Memory leak real de GPU (encontrado en la auditoría de calidad de
    // código 2026-09-06): `aplicarEquipoAlRig` reconstruye TODO el equipo
    // entero cada vez que CUALQUIER slot cambia (para jugador local Y
    // remoto), así que esto corre muchas veces por sesión. La geometría de
    // cada malla es la fusión ÚNICA que arma `mallaDeVoxeles`
    // (voxelMalla.ts, `mergeGeometries` por llamada) — nunca compartida —
    // así que quitarla del rig sin liberarla dejaba esa geometría vieja
    // huérfana en la GPU para siempre. El MATERIAL de voxelMalla.ts sí es
    // una única constante de módulo compartida por TODO vóxel del juego
    // (mismo draw call) — a propósito NO se dispone aquí, haría inservible
    // cualquier otra malla de vóxeles todavía en pantalla.
    // Excepción (2026-09-08): un clon de `.glb` real (`esClonReal`) es una
    // copia de la plantilla cacheada de `entityLoader.ts` — disponer SU
    // geometría corrompería el caché compartido para el resto de clones.
    if (!nodo.userData?.esClonReal) (nodo as THREE.Mesh).geometry?.dispose();
    nodo.removeFromParent();
  });

  const entradas: [string, string][] = Symbol.iterator in Object(equipo)
    ? [...(equipo as Iterable<[string, string]>)]
    : Object.entries(equipo as Record<string, string>);

  // Slots de mano con categoría real posible: caja síncrona YA (feedback
  // instantáneo, igual que `renderConstrucciones.ts` con muebles) + intento
  // async de sustituirla por el `.glb` real cuando resuelva. `mallasPorPivote`
  // FUSIONA en una única malla todo lo que comparta pivote — "manos"
  // (guantes), "brazalete" y los dos "anillo*" TAMBIÉN cuelgan de
  // manoDer/manoIzq (POSICION_POR_SLOT, generarEquipoVoxel.ts) — con
  // cualquiera de esos puestos a la vez, quitar SOLO la caja del arma para
  // sustituirla se llevaría por delante su geometría fusionada también. Con
  // cualquiera de esos slots equipados, esta pasada se queda con la caja de
  // siempre para AMBAS manos — más seguro que arriesgar corromper el resto
  // del equipo de esa mano por un caso que además no es el pedido explícito
  // ("verse en la mano" es sobre todo herramienta/arma sola).
  const otroSlotEnPivoteMano = entradas.some(([slot, itemId]) => !!itemId && ["manos", "brazalete", "anilloDerecho", "anilloIzquierdo"].includes(slot));
  const entradasMano = new Map<string, string>();
  const entradasResto: [string, string][] = [];
  for (const [slot, itemId] of entradas) {
    if (!itemId) continue;
    if (!otroSlotEnPivoteMano && PIVOTE_MANO[slot] && categoriaRealDeMano(itemId)) entradasMano.set(slot, itemId);
    else entradasResto.push([slot, itemId]);
  }

  const voxeles = voxelesDeEquipo(entradasResto, semilla, blueprintsPorSlot);
  for (const [slot, itemId] of entradasMano) {
    voxeles.push(...voxelesDePieza(itemId, slot, semilla, blueprintsPorSlot?.[slot]));
  }
  for (const [pivote, malla] of mallasPorPivote(voxeles)) {
    const nodo = rigObjeto.getObjectByName(pivote);
    if (!nodo) {
      console.warn(`equipoVisual: el rig no tiene pivote "${pivote}" — equipo descartado`);
      continue;
    }
    malla.userData[ETIQUETA_EQUIPO] = true;
    // Marca DE QUÉ slot de mano viene, para que `intentarPiezaManoReal`
    // pueda quitar solo su propia caja al sustituirla (varias piezas
    // pueden compartir pivote/malla fusionada — el resto de mallasPorPivote
    // no toca esto si el slot no es de mano).
    for (const [slot, itemId] of entradasMano) {
      if (PIVOTE_MANO[slot] === pivote) malla.userData.slotEquipoMano = slot;
    }
    nodo.add(malla);
  }

  for (const [slot, itemId] of entradasMano) {
    void intentarPiezaManoReal(rigObjeto, slot, itemId, generacion);
  }
}
