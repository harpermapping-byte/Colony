import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resolverUrlModelo, type CategoriaAsset, type Variante } from "./assetCatalog";
import { crearPlaceholder } from "./placeholder";

const loader = new GLTFLoader();

// Cache por URL resuelta: la primera petición de "arbol_pino_01.glb" dispara
// la carga real; el resto reutiliza la plantilla ya cargada — nunca se vuelve
// a pedir por red ni a decodificar el mismo archivo dos veces. Se cachea
// `null` cuando el .glb no existe (404): así el "no hay modelo" tampoco se
// reintenta, pero el placeholder se construye POR PETICIÓN con el color y
// dimensiones de cada solicitante (antes se cacheaba el placeholder del
// primer solicitante y todos los demás heredaban su color — un jugador
// remoto salía con el color del local).
const cachePlantillas = new Map<string, Promise<THREE.Object3D | null>>();

// "animales" (fauna DECORATIVA estática del bakeador exterior — la fauna
// VIVA simulada usa el rig paramétrico de animalVoxel.ts, cero red) tiene
// 0/N .glb reales en assets/animales/ (solo quedan los .png placeholder
// viejos) — confirmado jugando de verdad "Isla 1" por primera vez
// (2026-09-08): entrar en una zona nueva con mucha fauna decorativa
// disparaba cientos de peticiones 404 EN PARALELO (una por cada especie+
// variante nunca vista, Promise.all en sectorVisual.ts), suficiente para
// notarse como tirones al moverte. La caché por URL de abajo evita
// RE-pedir la misma, pero no evita ese primer estallido de cientos de
// URLs distintas a la vez. Cortoccamino aquí en vez de tocar el patrón
// genérico: en cuanto existan .glb reales de fauna decorativa (mismo
// pipeline taller-vox que vegetación/rocas), quitar "animales" de este
// Set y vuelve a intentarlo normal, sin más cambios.
const CATEGORIAS_SIN_GLB_TODAVIA = new Set<CategoriaAsset>(["animales"]);

export interface PeticionEntidad {
  categoria: CategoriaAsset;
  id: string;
  variante: Variante;
  colorPlaceholder: string;
  // Dimensiones aproximadas (en unidades de mundo) para el placeholder,
  // normalmente sacadas de `huella`/`dimensions` del catálogo de datos.
  dimensiones?: { ancho: number; alto: number; profundo: number };
}

/**
 * Plantilla compartida del modelo real, o `null` si su .glb no existe
 * todavía. NUNCA añadir el objeto devuelto a una escena directamente —
 * clonar siempre (es la plantilla compartida del cache).
 */
export function obtenerPlantilla(categoria: CategoriaAsset, id: string, variante: Variante): Promise<THREE.Object3D | null> {
  const url = resolverUrlModelo(categoria, id, variante);
  if (CATEGORIAS_SIN_GLB_TODAVIA.has(categoria)) {
    if (!cachePlantillas.has(url)) cachePlantillas.set(url, Promise.resolve(null));
    return cachePlantillas.get(url)!;
  }
  if (!cachePlantillas.has(url)) {
    cachePlantillas.set(
      url,
      loader
        .loadAsync(url)
        .then((gltf) => gltf.scene as THREE.Object3D)
        .catch((err: unknown) => {
          // Solo un 404 real es "no hay modelo" para siempre. Un fallo
          // TRANSITORIO (conexión reseteada bajo carga, 5xx — visto de
          // verdad en el playtest multijugador 2026-09-10) se olvida de la
          // caché: la siguiente petición de esa misma URL (otro sector con
          // la misma especie, o volver a este) vuelve a intentarlo, en vez
          // de dejar esa especie como caja de color el resto de la sesión.
          const status = (err as { response?: { status?: number } } | null)?.response?.status;
          if (status !== 404) cachePlantillas.delete(url);
          return null;
        }),
    );
  }
  return cachePlantillas.get(url)!;
}

/**
 * Devuelve una instancia lista para añadir a la escena: el `.glb` real si
 * existe en `assets/`, o un cubo de color (`colorDebug`) si todavía no se
 * ha generado con el taller de vóxeles. Nunca lanza — un modelo que falla
 * al cargar (404, glb corrupto) degrada a placeholder en vez de romper el
 * frame.
 */
export async function cargarInstanciaEntidad(peticion: PeticionEntidad): Promise<THREE.Object3D> {
  const plantilla = await obtenerPlantilla(peticion.categoria, peticion.id, peticion.variante);
  if (plantilla) return plantilla.clone(true);
  const { ancho = 1, alto = 1, profundo = 1 } = peticion.dimensiones || {};
  return crearPlaceholder(peticion.colorPlaceholder, ancho, alto, profundo);
}
