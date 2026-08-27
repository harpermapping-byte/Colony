import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resolverUrlModelo, type CategoriaAsset, type Variante } from "./assetCatalog";
import { crearPlaceholder } from "./placeholder";

const loader = new GLTFLoader();

// Cache por URL resuelta: la primera entidad que pida "arbol_pino_01.glb"
// dispara la carga real; el resto de instancias (o placeholders) reciben
// una copia (`clone()`) de la ya cargada — nunca se vuelve a pedir por red
// ni se vuelve a decodificar el mismo archivo dos veces.
const cachePlantillas = new Map<string, Promise<THREE.Object3D>>();

export interface PeticionEntidad {
  categoria: CategoriaAsset;
  id: string;
  variante: Variante;
  colorPlaceholder: string;
  // Dimensiones aproximadas (en unidades de mundo) para el placeholder,
  // normalmente sacadas de `huella`/`dimensions` del catálogo de datos.
  dimensiones?: { ancho: number; alto: number; profundo: number };
}

async function cargarPlantilla(url: string): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

/**
 * Devuelve una instancia lista para añadir a la escena: el `.glb` real si
 * existe en `assets/`, o un cubo de color (`colorDebug`) si todavía no se
 * ha generado con el taller de vóxeles. Nunca lanza — un modelo que falla
 * al cargar (404, glb corrupto) degrada a placeholder en vez de romper el
 * frame.
 */
export async function cargarInstanciaEntidad(peticion: PeticionEntidad): Promise<THREE.Object3D> {
  const url = resolverUrlModelo(peticion.categoria, peticion.id, peticion.variante);

  if (!cachePlantillas.has(url)) {
    cachePlantillas.set(
      url,
      cargarPlantilla(url).catch(() => {
        // No hay .glb todavia para este id/variante: placeholder, y se
        // cachea igual para no reintentar la carga en cada instancia nueva.
        const { ancho = 1, alto = 1, profundo = 1 } = peticion.dimensiones || {};
        return crearPlaceholder(peticion.colorPlaceholder, ancho, alto, profundo);
      }),
    );
  }

  const plantilla = await cachePlantillas.get(url)!;
  return plantilla.clone(true);
}
