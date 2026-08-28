import * as THREE from "three";
import { resolverUrlTextura, type CategoriaTextura, type Variante } from "./assetCatalog";

const loader = new THREE.TextureLoader();

// Mismo patrón que entityLoader.ts (caché por URL, `null` cacheado si el
// PNG no existe todavía) pero para texturas tileables de suelo/pared
// (docs/GDD_Bakeador_Texturas.md) en vez de modelos .glb — nunca lanza, un
// material sin textura real sigue pintándose con su colorDebug de siempre.
const cacheTexturas = new Map<string, Promise<THREE.Texture | null>>();

export function obtenerTextura(categoria: CategoriaTextura, id: string, variante: Variante): Promise<THREE.Texture | null> {
  const url = resolverUrlTextura(categoria, id, variante);
  if (!cacheTexturas.has(url)) {
    cacheTexturas.set(
      url,
      loader
        .loadAsync(url)
        .then((textura) => {
          textura.wrapS = THREE.RepeatWrapping;
          textura.wrapT = THREE.RepeatWrapping;
          textura.colorSpace = THREE.SRGBColorSpace;
          return textura;
        })
        .catch(() => null),
    );
  }
  return cacheTexturas.get(url)!;
}
