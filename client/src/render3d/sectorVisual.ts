import * as THREE from "three";
import type { IndiceMapa, SectorBakeado, ObjetoBakeado } from "../mapa/formatoMapa";
import { terrenoEn } from "../mapa/formatoMapa";
import { colorTerreno, colorObjeto, dimensionesObjeto } from "./catalogoVisual";
import { obtenerPlantilla } from "./entityLoader";
import type { CategoriaAsset } from "./assetCatalog";

/**
 * Materialización de UN sector del mapa bakeado (terreno + props) — la
 * unidad que carga/suelta `streamingSectores.ts`. Es el mismo pintado que
 * hacían `terreno.ts`/`propsBakeados.ts` para el mapa entero del demo,
 * reorganizado con ámbito de sector para poder soltarlo entero al alejarse:
 * un plano+canvas de 320x320 px por sector (en vez del canvas único global)
 * y los props instanciados por especie DENTRO del sector.
 *
 * Liberar GPU al soltar: todo lo creado aquí (geometrías, materiales,
 * texturas-canvas, InstancedMesh de placeholder) se marca con
 * `userData.propioDelSector` y `soltarSectorVisual` lo dispose-a. Los
 * clones de plantillas `.glb` NO se marcan: su geometría/material es
 * compartida con la plantilla cacheada de `entityLoader` (dispose-arla
 * rompería el resto de instancias vivas) — a esos solo se les quita la
 * escena, que es gratis.
 */

const CATEGORIA_POR_TIPO: Record<ObjetoBakeado["t"], CategoriaAsset> = {
  v: "vegetacion",
  r: "rocas",
  a: "animales",
};

function crearTerrenoSector(indice: IndiceMapa, sector: SectorBakeado): THREE.Mesh {
  const t = indice.tamanoChunk;
  const tilesSector = indice.tamanoSectorChunks * t;
  const origenTileX = sector.sectorX * tilesSector;
  const origenTileY = sector.sectorY * tilesSector;
  // Un sector de borde puede venir parcial (mapa no múltiplo del tamaño de
  // sector, como el demo de 48x48): el plano se ajusta a los chunks reales.
  let maxTileX = 0;
  let maxTileY = 0;
  for (const clave of Object.keys(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    maxTileX = Math.max(maxTileX, (cx + 1) * t - origenTileX);
    maxTileY = Math.max(maxTileY, (cy + 1) * t - origenTileY);
  }
  const ancho = Math.min(tilesSector, maxTileX);
  const alto = Math.min(tilesSector, maxTileY);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, ancho, alto);

  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    const baseX = cx * t - origenTileX;
    const baseY = cy * t - origenTileY;
    for (let y = 0; y < chunk.tamano; y++) {
      for (let x = 0; x < chunk.tamano; x++) {
        ctx.fillStyle = colorTerreno(terrenoEn(chunk, indice.leyendaTerreno, x, y));
        ctx.fillRect(baseX + x, baseY + y, 1, 1);
      }
    }
  }

  const textura = new THREE.CanvasTexture(canvas);
  textura.magFilter = THREE.NearestFilter;
  textura.minFilter = THREE.NearestFilter;
  textura.colorSpace = THREE.SRGBColorSpace;

  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(ancho, alto),
    new THREE.MeshStandardMaterial({ map: textura, roughness: 1, metalness: 0 }),
  );
  malla.rotation.x = -Math.PI / 2;
  malla.position.set(origenTileX + ancho / 2, 0, origenTileY + alto / 2);
  malla.receiveShadow = true;
  malla.userData.propioDelSector = true;
  return malla;
}

interface GrupoEspecie {
  tipo: ObjetoBakeado["t"];
  id: string;
  objetos: { globalX: number; globalY: number; obj: ObjetoBakeado }[];
}

async function crearPropsSector(indice: IndiceMapa, sector: SectorBakeado): Promise<THREE.Group> {
  const grupos = new Map<string, GrupoEspecie>();
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

  const raiz = new THREE.Group();

  await Promise.all(
    [...grupos.values()].map(async (grupo) => {
      // ¿.glb real de la especie? La sonda va cacheada por URL en
      // entityLoader, así que preguntarlo por cada sector es gratis.
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
      malla.userData.propioDelSector = true;

      const matriz = new THREE.Matrix4();
      const posicion = new THREE.Vector3();
      const rotacion = new THREE.Quaternion();
      const escala = new THREE.Vector3();
      const ejeY = new THREE.Vector3(0, 1, 0);

      grupo.objetos.forEach(({ globalX, globalY, obj }, indice2) => {
        posicion.set(globalX + 0.5, 0, globalY + 0.5);
        rotacion.setFromAxisAngle(ejeY, THREE.MathUtils.degToRad(obj.ro || 0));
        const es = obj.es || 1;
        escala.set(dims.ancho * es, dims.alto * es, dims.profundo * es);
        matriz.compose(posicion, rotacion, escala);
        malla.setMatrixAt(indice2, matriz);
      });
      malla.instanceMatrix.needsUpdate = true;
      raiz.add(malla);
    }),
  );

  return raiz;
}

/** Terreno + props de un sector, listos para añadir a escena como un único grupo. */
export async function crearSectorVisual(indice: IndiceMapa, sector: SectorBakeado): Promise<THREE.Group> {
  const grupo = new THREE.Group();
  grupo.name = `sector_${sector.sectorX}_${sector.sectorY}`;
  grupo.add(crearTerrenoSector(indice, sector));
  grupo.add(await crearPropsSector(indice, sector));
  return grupo;
}

/** Libera GPU/memoria de lo que creó `crearSectorVisual` (llamar tras quitarlo de escena). */
export function soltarSectorVisual(grupo: THREE.Group): void {
  grupo.traverse((obj) => {
    if (!obj.userData.propioDelSector) return;
    const malla = obj as THREE.Mesh;
    malla.geometry?.dispose();
    const materiales = Array.isArray(malla.material) ? malla.material : [malla.material];
    for (const material of materiales) {
      const estandar = material as THREE.MeshStandardMaterial;
      estandar.map?.dispose();
      material.dispose();
    }
  });
  grupo.clear();
}
