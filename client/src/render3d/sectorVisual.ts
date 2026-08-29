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
  m: "interiores", // deco urbana: mismo .glb que el mueble de interiores cuando exista
  // "e" (edificios de ciudad): prop real por instancia, con su ancho/largo
  // (obj.w/obj.h) y color por riqueza — ya NO sale de solar_edificio
  // extruida (ver ALTURA_TERRENO_SOLIDO abajo, que ahora no lo incluye).
  // taller-vox/generar_edificio.js ya genera el .glb; falta aprobarlo y
  // subirlo a assets/edificios/ para que esto deje de caer al placeholder.
  e: "edificios",
};

// Terrenos urbanos SÓLIDOS de los mapas de ciudad (bakeador de ciudades):
// se extruyen como cajas instanciadas — el "cubo sin techo" de verdad. La
// altura es placeholder; los módulos .glb de muralla la traerán. Los
// edificios ("e") NO van aquí: solar_edificio se quedó como marca de suelo
// plana (transitable:false, sigue bloqueando en el servidor) pero su
// VOLUMEN ahora lo pone el prop "e" de crearPropsSector, con el
// ancho/largo real de cada instancia — antes esto dibujaba una caja
// genérica de 2.1 por CADA CASILLA de solar, sin distinguir edificio ni
// riqueza; con las dos cosas activas a la vez habría dos cajas solapadas.
// `roca_inaccesible` (bakeador exterior, GDD_Bakeador_Exteriores sección 2:
// cumbre/salto de banda ≥2) se sumó aquí 2026-08-29 — pedido del streamer
// al ver que el terreno exterior se pintaba SIEMPRE plano, la elevación
// bakeada solo cambiaba de color (nunca de altura de malla), así que ni
// las rocas de acantilado ni la montaña se notaban de verdad al pasear.
// Altura placeholder (como el resto de esta tabla): un .glb de roca real
// la sustituirá más adelante.
const ALTURA_TERRENO_SOLIDO: Record<string, number> = {
  empalizada: 1.7,
  muralla_piedra: 2.6,
  roca_inaccesible: 3,
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
  // solo tipos con categoría de asset llegan aquí (se filtra al agrupar)
  tipo: "v" | "r" | "a" | "m" | "e";
  id: string;
  variante: number;
  objetos: { globalX: number; globalY: number; obj: ObjetoBakeado }[];
}

async function crearPropsSector(indice: IndiceMapa, sector: SectorBakeado): Promise<THREE.Group> {
  const grupos = new Map<string, GrupoEspecie>();
  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    for (const obj of chunk.objetos) {
      // tipos sin categoría de asset conocida no se instancian
      if (!CATEGORIA_POR_TIPO[obj.t]) continue;
      // La variante (obj.va) entra en la clave de grupo: cada plantilla .glb
      // cargada es UNA variante concreta (edificios/<tipo>_NN.glb) — sin
      // esto, dos edificios del mismo tipo con distinta variante bakeada
      // compartirían igualmente la plantilla de la variante 0.
      const variante = obj.va || 0;
      const claveGrupo = `${obj.t}:${obj.i}:${variante}`;
      if (!grupos.has(claveGrupo)) grupos.set(claveGrupo, { tipo: obj.t as GrupoEspecie["tipo"], id: obj.i, variante, objetos: [] });
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
      const plantilla = await obtenerPlantilla(CATEGORIA_POR_TIPO[grupo.tipo]!, grupo.id, { tipo: "numerada", indice: grupo.variante });

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
        // obj.x/obj.y ya es Math.floor(centro real) hecho por ciudades/ al
        // exportar (ed.cx/ed.cy son el centro continuo de la huella) —
        // +0.5 sigue siendo la mejor aproximación al centro para CUALQUIER
        // tamaño de prop, edificios incluidos; solo la ESCALA usa el
        // ancho/largo real de la instancia (obj.w/obj.h) en vez del
        // tamaño de catálogo cuando está disponible.
        // edificios: centro REAL sub-casilla (dx/dy), no el centro genérico
        // de la casilla — así la caja coincide con la huella "solar_edificio"
        // real del terreno en vez de quedar hasta ~0.7 casillas desplazada.
        const centroX = grupo.tipo === "e" && obj.dx !== undefined ? obj.dx : 0.5;
        const centroZ = grupo.tipo === "e" && obj.dy !== undefined ? obj.dy : 0.5;
        posicion.set(globalX + centroX, 0, globalY + centroZ);
        rotacion.setFromAxisAngle(ejeY, THREE.MathUtils.degToRad(obj.ro || 0));
        const es = obj.es || 1;
        const anchoReal = grupo.tipo === "e" && obj.w ? obj.w : dims.ancho;
        const largoReal = grupo.tipo === "e" && obj.h ? obj.h : dims.profundo;
        escala.set(anchoReal * es, dims.alto * es, largoReal * es);
        matriz.compose(posicion, rotacion, escala);
        malla.setMatrixAt(indice2, matriz);
      });
      malla.instanceMatrix.needsUpdate = true;
      raiz.add(malla);
    }),
  );

  return raiz;
}

const ALTURA_MURALLA: Record<string, number> = { empalizada: 1.7, muralla_piedra: 2.6 };

/**
 * Torres y puertas de la muralla, distintas de un tramo recto — el terreno
 * ya extruye CADA casilla de muro como una caja uniforme (crearTerrenoSector,
 * ALTURA_TERRENO_SOLIDO), así que un tramo "recto" no necesita nada más
 * aquí. Lo que faltaba (pedido del streamer): que una torre se note como
 * torre y que una puerta de piedra se vea como una entrada de fortaleza de
 * verdad (dos torreones flanqueando el hueco) en vez de un simple corte en
 * el muro — mientras que una empalizada humilde se queda con dos palos
 * simples, sin sillería. Puramente decorativo: la colisión real del hueco
 * ya la resuelve el terreno (el raster de la muralla salta las puertas),
 * esto no la toca.
 */
function crearMurallaSector(indice: IndiceMapa, sector: SectorBakeado): THREE.Group {
  const grupo = new THREE.Group();
  const modulos = indice.muralla?.modulos;
  if (!modulos || modulos.length === 0) return grupo;

  const t = indice.tamanoChunk;
  const tilesSector = indice.tamanoSectorChunks * t;
  const origenTileX = sector.sectorX * tilesSector;
  const origenTileY = sector.sectorY * tilesSector;
  const dentroDeEsteSector = (x: number, y: number) =>
    x >= origenTileX && x < origenTileX + tilesSector && y >= origenTileY && y < origenTileY + tilesSector;

  for (const mod of modulos) {
    if (mod.tipo === "recto" || !dentroDeEsteSector(mod.x, mod.y)) continue;

    const altoBase = ALTURA_MURALLA[mod.material] ?? 2;
    const color = colorTerreno(mod.material === "empalizada" ? "empalizada" : "muralla_piedra");
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
    const rotRad = THREE.MathUtils.degToRad(mod.rot);

    if (mod.tipo === "torre") {
      const alto = altoBase + 1.4;
      const caja = new THREE.Mesh(new THREE.BoxGeometry(2.2, alto, 2.2), mat);
      caja.position.set(mod.x + 0.5, alto / 2, mod.y + 0.5);
      caja.castShadow = true;
      caja.userData.propioDelSector = true;
      grupo.add(caja);
      continue;
    }

    // "puerta": piedra = dos torreones (fortaleza de verdad), empalizada =
    // dos palos simples — flanqueando el hueco real que ya deja el terreno.
    const esPiedra = mod.material !== "empalizada";
    const perpendicular = rotRad + Math.PI / 2;
    const offset = esPiedra ? 2.6 : 1.8;
    for (const lado of [-1, 1]) {
      const px = mod.x + 0.5 + Math.cos(perpendicular) * offset * lado;
      const py = mod.y + 0.5 + Math.sin(perpendicular) * offset * lado;
      const alto = esPiedra ? altoBase + 1.8 : altoBase + 0.6;
      const ancho = esPiedra ? 1.8 : 0.35;
      const caja = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, ancho), mat);
      caja.position.set(px, alto / 2, py);
      caja.castShadow = true;
      caja.userData.propioDelSector = true;
      grupo.add(caja);
    }
  }

  return grupo;
}

/** Terreno + muralla + props de un sector, listos para añadir a escena como un único grupo. */
export async function crearSectorVisual(indice: IndiceMapa, sector: SectorBakeado): Promise<THREE.Group> {
  const grupo = new THREE.Group();
  grupo.name = `sector_${sector.sectorX}_${sector.sectorY}`;
  grupo.add(crearTerrenoSector(indice, sector));
  grupo.add(crearMurallaSector(indice, sector));
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
