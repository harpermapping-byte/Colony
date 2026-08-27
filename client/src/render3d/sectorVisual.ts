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

const CATEGORIA_POR_TIPO: Partial<Record<string, CategoriaAsset>> = {
  v: "vegetacion",
  r: "rocas",
  a: "animales",
  // "e" (edificios de los mapas de ciudad) NO se instancia como prop: su
  // volumen ya sale de las casillas solar_edificio extruidas (abajo). El
  // .glb real de cada edificio entrará por aquí cuando exista.
};

// Terrenos urbanos SÓLIDOS de los mapas de ciudad (bakeador de ciudades):
// se extruyen como cajas instanciadas — el "cubo sin techo" de verdad. La
// altura es placeholder; los módulos .glb de muralla/edificio la traerán.
const ALTURA_TERRENO_SOLIDO: Record<string, number> = {
  empalizada: 1.7,
  muralla_piedra: 2.6,
  solar_edificio: 2.1,
};

// --- Agua translúcida con fondo visible (portado de la versión de mapa
// entero de terreno.ts al ámbito de sector, mismos valores) ---
// La superficie del agua va translúcida para ver el lecho y a quien bucea;
// el lecho es un segundo plano a -PROFUNDIDAD_FONDO sombreado por la
// elevación bakeada (más hondo = más oscuro).
export const PROFUNDIDAD_FONDO = 1.5;
const AGUAS: Record<string, { alfa: number; base: number }> = {
  agua: { alfa: 0.45, base: 0.8 },
  agua_profunda: { alfa: 0.55, base: 0.25 },
};
const LECHO_CLARO = { r: 0xc9, g: 0xb2, b: 0x7a };
const LECHO_OSCURO = { r: 0x4f, g: 0x5c, b: 0x55 };
const ACLARADO_SUPERFICIE = 0.12;
// Rango de elevación del agua para normalizar el sombreado del lecho. La
// versión de mapa entero lo calculaba recorriendo TODOS los sectores; en
// streaming no están todos, y un rango por-sector haría costuras visibles
// en la frontera de cada sector. Rango FIJO medido en el mapa principal
// real (elevaciones de agua 0..4, ~2.3M casillas) — con clamp: otro mapa
// que se salga solo satura el degradado, no rompe nada.
const ELEV_AGUA_MIN = 0;
const ELEV_AGUA_MAX = 4;

function crearPlanoSector(
  canvas: HTMLCanvasElement,
  ancho: number,
  alto: number,
  transparente: boolean,
): THREE.Mesh {
  const textura = new THREE.CanvasTexture(canvas);
  textura.magFilter = THREE.NearestFilter;
  textura.minFilter = THREE.NearestFilter;
  textura.colorSpace = THREE.SRGBColorSpace;
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(ancho, alto),
    new THREE.MeshStandardMaterial({
      map: textura,
      roughness: 1,
      metalness: 0,
      transparent: transparente,
      // el agua translúcida no escribe depth: el buzo (opaco) se dibuja
      // primero y se ve a través de ella sin artefactos de ordenación
      depthWrite: !transparente,
    }),
  );
  malla.rotation.x = -Math.PI / 2;
  malla.receiveShadow = true;
  malla.userData.propioDelSector = true;
  return malla;
}

function crearTerrenoSector(indice: IndiceMapa, sector: SectorBakeado): THREE.Group {
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

  const suelo = document.createElement("canvas");
  suelo.width = ancho;
  suelo.height = alto;
  const ctxSuelo = suelo.getContext("2d")!;
  ctxSuelo.clearRect(0, 0, ancho, alto);
  const fondo = document.createElement("canvas");
  fondo.width = ancho;
  fondo.height = alto;
  const ctxFondo = fondo.getContext("2d")!;
  ctxFondo.fillStyle = "#000000";
  ctxFondo.fillRect(0, 0, ancho, alto);

  const rangoElev = Math.max(1, ELEV_AGUA_MAX - ELEV_AGUA_MIN);
  const solidosPorTipo = new Map<string, number[]>(); // terreno urbano -> [gx,gy,...]
  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    const baseX = cx * t - origenTileX;
    const baseY = cy * t - origenTileY;
    for (let y = 0; y < chunk.tamano; y++) {
      for (let x = 0; x < chunk.tamano; x++) {
        const id = terrenoEn(chunk, indice.leyendaTerreno, x, y);
        if (ALTURA_TERRENO_SOLIDO[id] !== undefined) {
          if (!solidosPorTipo.has(id)) solidosPorTipo.set(id, []);
          solidosPorTipo.get(id)!.push(origenTileX + baseX + x, origenTileY + baseY + y);
        }
        const agua = AGUAS[id];
        if (!agua) {
          ctxSuelo.fillStyle = colorTerreno(id);
          ctxSuelo.fillRect(baseX + x, baseY + y, 1, 1);
          continue;
        }
        // superficie translúcida con el color de catálogo aclarado
        const c = new THREE.Color(colorTerreno(id)).lerp(new THREE.Color(1, 1, 1), ACLARADO_SUPERFICIE);
        ctxSuelo.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${agua.alfa})`;
        ctxSuelo.fillRect(baseX + x, baseY + y, 1, 1);
        // lecho: mitad por tipo de agua (somera clara, profunda oscura),
        // mitad por la elevación bakeada (elevación baja = hondo = oscuro)
        const e = parseInt(chunk.elevacion[y * chunk.tamano + x], 36);
        const eNorm = Math.min(1, Math.max(0, (e - ELEV_AGUA_MIN) / rangoElev));
        const tono = 0.5 * agua.base + 0.5 * eNorm;
        const r = Math.round(LECHO_OSCURO.r + (LECHO_CLARO.r - LECHO_OSCURO.r) * tono);
        const g = Math.round(LECHO_OSCURO.g + (LECHO_CLARO.g - LECHO_OSCURO.g) * tono);
        const b = Math.round(LECHO_OSCURO.b + (LECHO_CLARO.b - LECHO_OSCURO.b) * tono);
        ctxFondo.fillStyle = `rgb(${r},${g},${b})`;
        ctxFondo.fillRect(baseX + x, baseY + y, 1, 1);
      }
    }
  }

  const grupo = new THREE.Group();
  const planoFondo = crearPlanoSector(fondo, ancho, alto, false);
  planoFondo.position.set(origenTileX + ancho / 2, -PROFUNDIDAD_FONDO, origenTileY + alto / 2);
  const planoSuelo = crearPlanoSector(suelo, ancho, alto, true);
  planoSuelo.position.set(origenTileX + ancho / 2, 0, origenTileY + alto / 2);
  grupo.add(planoFondo, planoSuelo);

  // extrusión de los sólidos urbanos: una InstancedMesh de cubos por tipo
  // de terreno (muralla/empalizada/solar) — mismo coste que los props
  const m = new THREE.Matrix4();
  for (const [id, coords] of solidosPorTipo) {
    const altura = ALTURA_TERRENO_SOLIDO[id];
    const n = coords.length / 2;
    const malla = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, altura, 1),
      new THREE.MeshStandardMaterial({ color: colorTerreno(id), roughness: 0.95, metalness: 0 }),
      n,
    );
    for (let i = 0; i < n; i++) {
      m.makeTranslation(coords[i * 2] + 0.5, altura / 2, coords[i * 2 + 1] + 0.5);
      malla.setMatrixAt(i, m);
    }
    malla.castShadow = true;
    malla.receiveShadow = true;
    malla.userData.propioDelSector = true;
    grupo.add(malla);
  }
  return grupo;
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
      // tipos sin categoría de asset (p.ej. "e", edificios de ciudad) no se
      // instancian: su volumen ya lo ponen las casillas sólidas extruidas
      if (!CATEGORIA_POR_TIPO[obj.t]) continue;
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
      const plantilla = await obtenerPlantilla(CATEGORIA_POR_TIPO[grupo.tipo]!, grupo.id, { tipo: "numerada", indice: 0 });

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
