import * as THREE from "three";
import type { MapaCargado } from "../mapa/cargarMapa";
import type { ObjetoBakeado } from "../mapa/formatoMapa";
import { colorObjeto, dimensionesObjeto } from "./catalogoVisual";
import { obtenerPlantilla } from "./entityLoader";
import type { CategoriaAsset } from "./assetCatalog";

const CATEGORIA_POR_TIPO: Record<ObjetoBakeado["t"], CategoriaAsset> = {
  v: "vegetacion",
  r: "rocas",
  a: "animales",
};

interface GrupoEspecie {
  tipo: ObjetoBakeado["t"];
  id: string;
  objetos: { globalX: number; globalY: number; obj: ObjetoBakeado }[];
}

/**
 * Instancia en la escena todos los objetos (vegetación/rocas/fauna) que el
 * bakeador dejó colocados en el mapa — el bakeador da id + casilla +
 * variante + rotación + escala, y aquí solo se materializa eso, nunca se
 * decide nada nuevo (misma filosofía "generar una vez" del GDD).
 *
 * Rendimiento: los objetos se agrupan por especie y, mientras una especie
 * no tenga su `.glb` real, TODAS sus instancias se pintan con UN único
 * `InstancedMesh` (una llamada de dibujado por especie, da igual que haya
 * 3 o 3.000 árboles — el pendiente de instancing de GDD_Motor_3D_Props.md).
 * Si la especie ya tiene `.glb`, cada instancia es un clon de la plantilla
 * cacheada (pocas piezas tendrán arte real al principio; cuando sean
 * cientos, el mismo agrupamiento permite pasarlas a instancing de malla
 * real sin tocar a quien llama).
 */
export async function crearPropsBakeados(mapa: MapaCargado): Promise<THREE.Group> {
  const grupos = new Map<string, GrupoEspecie>();

  for (const sector of mapa.sectores) {
    for (const [clave, chunk] of Object.entries(sector.chunks)) {
      const [cx, cy] = clave.split("_").map(Number);
      for (const obj of chunk.objetos) {
        const claveGrupo = `${obj.t}:${obj.i}`;
        if (!grupos.has(claveGrupo)) grupos.set(claveGrupo, { tipo: obj.t, id: obj.i, objetos: [] });
        grupos.get(claveGrupo)!.objetos.push({
          globalX: cx * chunk.tamano + obj.x,
          globalY: cy * chunk.tamano + obj.y,
          obj,
        });
      }
    }
  }

  const raiz = new THREE.Group();
  raiz.name = "propsBakeados";

  await Promise.all(
    [...grupos.values()].map(async (grupo) => {
      // ¿Existe ya el .glb de esta especie? Se comprueba UNA vez por especie
      // (variante 0 como sonda); mientras no exista, placeholder instanciado.
      const plantilla = await obtenerPlantilla(CATEGORIA_POR_TIPO[grupo.tipo], grupo.id, { tipo: "numerada", indice: 0 });

      if (plantilla) {
        for (const { globalX, globalY, obj } of grupo.objetos) {
          const instancia = plantilla.clone(true);
          instancia.position.set(globalX + 0.5, 0, globalY + 0.5);
          instancia.rotation.y = THREE.MathUtils.degToRad(obj.ro || 0);
          instancia.scale.setScalar(obj.es || 1);
          raiz.add(instancia);
        }
        return;
      }

      const dims = dimensionesObjeto(grupo.tipo, grupo.id);
      // Caja unitaria anclada por la base; el tamaño real va en la matriz de
      // cada instancia (escala por dimensiones × escala del bake).
      const geometria = new THREE.BoxGeometry(1, 1, 1);
      geometria.translate(0, 0.5, 0);
      const material = new THREE.MeshStandardMaterial({
        color: colorObjeto(grupo.tipo, grupo.id),
        roughness: 0.85,
        metalness: 0.05,
      });
      const malla = new THREE.InstancedMesh(geometria, material, grupo.objetos.length);
      malla.castShadow = true;
      malla.receiveShadow = true;

      const matriz = new THREE.Matrix4();
      const posicion = new THREE.Vector3();
      const rotacion = new THREE.Quaternion();
      const escala = new THREE.Vector3();
      const ejeY = new THREE.Vector3(0, 1, 0);

      grupo.objetos.forEach(({ globalX, globalY, obj }, indice) => {
        posicion.set(globalX + 0.5, 0, globalY + 0.5);
        rotacion.setFromAxisAngle(ejeY, THREE.MathUtils.degToRad(obj.ro || 0));
        const es = obj.es || 1;
        escala.set(dims.ancho * es, dims.alto * es, dims.profundo * es);
        matriz.compose(posicion, rotacion, escala);
        malla.setMatrixAt(indice, matriz);
      });
      malla.instanceMatrix.needsUpdate = true;
      raiz.add(malla);
    }),
  );

  return raiz;
}
