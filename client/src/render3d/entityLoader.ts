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
  if (!cachePlantillas.has(url)) {
    cachePlantillas.set(
      url,
      loader
        .loadAsync(url)
        .then((gltf) => gltf.scene as THREE.Object3D)
        .catch(() => null),
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
