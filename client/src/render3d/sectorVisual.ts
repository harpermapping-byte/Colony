import * as THREE from "three";
import type { IndiceMapa, SectorBakeado, ObjetoBakeado } from "../mapa/formatoMapa";
import { terrenoEn } from "../mapa/formatoMapa";
import { colorTerreno, colorObjeto, dimensionesObjeto } from "./catalogoVisual";
import { obtenerPlantilla } from "./entityLoader";
import type { CategoriaAsset } from "./assetCatalog";
import { crearRigHumanoide } from "./rigHumanoide";
import { NIVEL_MAXIMO_NIEVE } from "../mundo/nieve";

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

/**
 * "Clamp to edge" de un canvas: lo centra en uno nuevo `margen` píxeles más
 * grande por cada lado, replicando la fila/columna/esquina de borde real
 * estirada hacia fuera — relleno visual barato sin inventar terreno nuevo.
 * Uso: arenas de combate (GDD_Combate.md §9.x), el grid táctico real es
 * pequeño ("se ve enano" — pedido del streamer) y esto solo hace que se VEA
 * más grande alrededor; el bake/colisión/lógica de combate no cambian nada.
 */
function extenderConMargenClamp(origen: HTMLCanvasElement, margen: number): HTMLCanvasElement {
  const ancho = origen.width;
  const alto = origen.height;
  const destino = document.createElement("canvas");
  destino.width = ancho + margen * 2;
  destino.height = alto + margen * 2;
  const ctx = destino.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(origen, margen, margen);
  ctx.drawImage(origen, 0, 0, ancho, 1, margen, 0, ancho, margen); // borde arriba
  ctx.drawImage(origen, 0, alto - 1, ancho, 1, margen, alto + margen, ancho, margen); // borde abajo
  ctx.drawImage(origen, 0, 0, 1, alto, 0, margen, margen, alto); // borde izquierda
  ctx.drawImage(origen, ancho - 1, 0, 1, alto, ancho + margen, margen, margen, alto); // borde derecha
  ctx.drawImage(origen, 0, 0, 1, 1, 0, 0, margen, margen); // esquina arriba-izquierda
  ctx.drawImage(origen, ancho - 1, 0, 1, 1, ancho + margen, 0, margen, margen); // esquina arriba-derecha
  ctx.drawImage(origen, 0, alto - 1, 1, 1, 0, alto + margen, margen, margen); // esquina abajo-izquierda
  ctx.drawImage(origen, ancho - 1, alto - 1, 1, 1, ancho + margen, alto + margen, margen, margen); // esquina abajo-derecha
  return destino;
}

/**
 * Líneas de rejilla táctica (1 unidad = 1 casilla), desde (0,0) hasta
 * (ancho,alto) en espacio LOCAL del sector — quien llama la posiciona en su
 * esquina real. Pedido tras el margen visual de arena (`margenVisual` en
 * `crearTerrenoSector`): con terreno de relleno alrededor, el borde del
 * grid táctico real dejó de coincidir con el borde del plano y se volvió
 * invisible — esto NO es la "UI de rejilla" (overlay de movimiento/target)
 * que panelCombate.ts documenta como pendiente para el pase final; es solo
 * la referencia visual de dónde está el campo de combate real.
 */
function crearRejillaTactica(ancho: number, alto: number): THREE.LineSegments {
  const puntos: number[] = [];
  for (let i = 0; i <= ancho; i++) puntos.push(i, 0, 0, i, 0, alto);
  for (let j = 0; j <= alto; j++) puntos.push(0, 0, j, ancho, 0, j);
  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.Float32BufferAttribute(puntos, 3));
  const lineas = new THREE.LineSegments(
    geometria,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  lineas.userData.propioDelSector = true;
  return lineas;
}

type TemaArenaVisual = "exterior" | "urbano" | "acuatico" | "dungeon";

/**
 * Tema de decoración del margen visual de una arena, deducido de su
 * `leyendaTerreno` real (terrenos.json) — sin campo de catálogo nuevo que
 * mantener. "agua"/"agua_profunda" -> acuático; suelo urbano del bakeador
 * de ciudades -> urbano; "roca" SIN césped -> dungeon (ninguna biomas.json
 * real usa "roca" como terrenoBase — solo mazmorras/generarArena.js la usa
 * sola para cuevas/minas, confirmado); cualquier otra cosa (cesped/tierra/
 * arena/nieve/playa/barro/...) -> exterior, el caso por defecto.
 */
function clasificarTemaArena(leyendaTerreno: string[]): TemaArenaVisual {
  const set = new Set(leyendaTerreno);
  if (set.has("agua") || set.has("agua_profunda")) return "acuatico";
  if (set.has("adoquin") || set.has("muralla_piedra") || set.has("empalizada") || set.has("solar_edificio")) return "urbano";
  const esRocoso = set.has("roca") || set.has("roca_volcanica") || set.has("roca_b");
  const tieneCesped = set.has("cesped") || set.has("cesped_b") || set.has("cesped_c") || set.has("cesped_ralo");
  if (esRocoso && !tieneCesped) return "dungeon";
  return "exterior";
}

interface DecoracionManual {
  tipo: "v" | "r" | "a" | "m";
  id: string;
  x: number;
  y: number;
  rotacionDeg?: number;
  escala?: number;
}

/**
 * Instancia decoración colocada A MANO (nunca aleatoria — pedido explícito
 * del streamer) en coordenadas LOCALES al centro del grid táctico; quien
 * llama traslada el grupo devuelto a su posición de mundo real. Mismo
 * mecanismo que `crearPropsSector` (plantilla .glb real si existe, si no
 * caja de color de catálogo) pero sin InstancedMesh ni "ocultables": esto
 * no es bake real, nunca se recoge/tala/reemplaza en vivo.
 */
async function crearDecoracionManual(items: DecoracionManual[]): Promise<THREE.Group> {
  const grupo = new THREE.Group();
  await Promise.all(
    items.map(async (item) => {
      const categoria = CATEGORIA_POR_TIPO[item.tipo];
      const plantilla = categoria ? await obtenerPlantilla(categoria, item.id, { tipo: "numerada", indice: 0 }) : null;
      let nodo: THREE.Object3D;
      if (plantilla) {
        nodo = plantilla.clone(true);
      } else {
        const dims = dimensionesObjeto(item.tipo, item.id);
        const geometria = new THREE.BoxGeometry(dims.ancho, dims.alto, dims.profundo);
        geometria.translate(0, dims.alto / 2, 0);
        const malla = new THREE.Mesh(
          geometria,
          new THREE.MeshStandardMaterial({ color: colorObjeto(item.tipo, item.id), roughness: 0.85, metalness: 0.05 }),
        );
        malla.castShadow = true;
        malla.receiveShadow = true;
        nodo = malla;
      }
      nodo.position.set(item.x, 0, item.y);
      nodo.rotation.y = THREE.MathUtils.degToRad(item.rotacionDeg || 0);
      if (item.escala) nodo.scale.setScalar(item.escala);
      nodo.userData.propioDelSector = true;
      grupo.add(nodo);
    }),
  );
  return grupo;
}

/** Ángulo (grados, convención `rotation.y=atan2(dx,dz)` de este proyecto) que hace mirar un objeto en (x,y) HACIA el centro (0,0). */
function anguloHaciaCentro(x: number, y: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(-x, -y));
}

const COLORES_TUNICA_NPC = ["#7a5a3a", "#3a5a7a", "#5a7a3a", "#7a3a5a"];

interface ClusterDecoracion {
  anguloDeg: number;
  radio: number;
  /** Una entrada por pieza del grupo — la LONGITUD decide la densidad (1 = casi vacío, 5-6 = grupo denso). */
  especies: { tipo: DecoracionManual["tipo"]; id: string }[];
}

// Desplazamientos fijos (no radiales) para separar las piezas DENTRO de un
// mismo cluster sin que queden todas apiladas en el mismo punto — a mano,
// nada de jitter aleatorio.
const OFFSETS_CLUSTER: [number, number][] = [
  [0, 0], [0.9, 0.35], [-0.75, 0.55], [0.4, -0.9], [-0.55, -0.7], [1.1, -0.15],
];

/** Reparte los `clusters` en items de decoración — cada pieza mira en un ángulo distinto (nada de filas mirando todas igual). */
function colocarClusters(clusters: ClusterDecoracion[]): DecoracionManual[] {
  const items: DecoracionManual[] = [];
  clusters.forEach((cluster, ci) => {
    const rad = THREE.MathUtils.degToRad(cluster.anguloDeg);
    const cx = Math.sin(rad) * cluster.radio;
    const cy = Math.cos(rad) * cluster.radio;
    cluster.especies.forEach((especie, i) => {
      const [ox, oy] = OFFSETS_CLUSTER[i % OFFSETS_CLUSTER.length];
      items.push({ tipo: especie.tipo, id: especie.id, x: cx + ox, y: cy + oy, rotacionDeg: (ci * 41 + i * 67) % 360 });
    });
  });
  return items;
}

/**
 * Segunda capa de clusters DERIVADA de `base` (pedido streamer: "aun mas
 * densidad, el doble minimo") — mismos grupos girados `deltaAngulo` y
 * acercados al grid (factor sobre el margen, no sobre hw entero, así nunca
 * cae DENTRO del grid real) — dobla la cantidad de decoración manteniendo
 * el mismo patrón irregular de huecos (una copia girada de algo irregular
 * sigue siendo irregular), sin tener que escribir cada cluster otra vez.
 */
function duplicarClustersDesplazados(base: ClusterDecoracion[], hw: number, deltaAngulo: number, factorMargen: number): ClusterDecoracion[] {
  return base.map((c) => ({
    anguloDeg: (c.anguloDeg + deltaAngulo) % 360,
    radio: hw + (c.radio - hw) * factorMargen,
    especies: c.especies,
  }));
}

// Hash + PRNG determinista (xmur3 + mulberry32, mismo mecanismo que
// interiores/src/azar.js::crearPRNG y server/src/combate/seleccionArena.ts)
// — SOLO para las rocas grandes de hito de abajo (pedido streamer: "no me
// seas literal, añade mas de 1, de 2 a 5 dependiendo del mapa
// aleatoriamente"): el resto de la decoración de esta función sigue siendo
// 100% a mano/determinista por ángulo fijo, esto es la ÚNICA parte con
// variación real — pero sembrada por el nombre+semilla de LA ARENA, nunca
// Math.random() puro, así que la MISMA arena siempre se ve igual entre
// visitas y solo cambia "según el mapa" (una arena distinta, otra tirada).
function hashDeterminista(texto: string): number {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function prngDesdeSemilla(semilla: number): () => number {
  let a = semilla >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decoración A MANO del margen visual de una arena (pedido streamer
 * 2026-08-31: "fuera del grid NO TIENE DECORACION... que haya arboles algun
 * animal... rocas arbustos flores... si es urbano decoracion urbana...
 * bastante... en el mapa agua peces... alga... orca o tiburon mirando
 * estatico... en el mapa ciudad NPC mirando estaticos"; corrección del
 * mismo streamer justo después de ver la primera versión en anillo
 * equiespaciado: "parece un damero de ajedrez... algo mas disperso, agrupar
 * en un sitio, en otro menos") — grupos (`colocarClusters`) en ángulos y
 * radios DESIGUALES a propósito (huecos grandes entre unos y otros, tamaño
 * de grupo variable) en vez de un anillo uniforme, alternando ids REALES de
 * catálogo, más fauna/depredadores/NPCs/rocas de hito sueltos — todo
 * determinista por ángulo fijo, salvo las rocas de hito (ver
 * `hashDeterminista`/`prngDesdeSemilla` arriba).
 */
async function crearDecoracionMargenArena(
  anchoReal: number,
  altoReal: number,
  margenVisual: number,
  leyendaTerreno: string[],
  semillaArena: string,
): Promise<THREE.Group> {
  const tema = clasificarTemaArena(leyendaTerreno);
  const hw = anchoReal / 2; // arenas de hoy son siempre cuadradas (anchoReal===altoReal), un solo semi-lado basta
  const v = (id: string) => ({ tipo: "v" as const, id });
  const m = (id: string) => ({ tipo: "m" as const, id });
  const rc = (id: string) => ({ tipo: "r" as const, id });
  const a = (id: string) => ({ tipo: "a" as const, id });

  let items: DecoracionManual[] = [];

  // Segunda capa (duplicarClustersDesplazados) girada+acercada sobre la
  // base a mano — pedido streamer tras ver la primera pasada: "aun mas
  // densidad, el doble minimo".
  const DELTA_CAPA2 = 33;
  const FACTOR_CAPA2 = 0.7;

  // Rocas grandes de hito (pedido streamer: "rocas grandes como tenemos en
  // mapa exterior... en las zonas que ahora no has puesto decoracion, algo
  // sencillo" — mismo espíritu que roca_erratica en el bake real: "hito
  // raro que rompe la monotonía"; corrección tras verlo: "no me seas
  // literal, añade mas de 1, de 2 a 5 dependiendo del mapa
  // aleatoriamente") — de 2 a 5 piezas a escala grande, en un subconjunto
  // de 8 huecos candidatos (repartidos por el anillo, desplazados de los
  // ángulos que ya usan los clusters de abajo) elegido con
  // `prngDesdeSemilla(hashDeterminista(semillaArena+tema))`: "aleatorio"
  // de verdad entre arenas distintas, pero la MISMA arena sale siempre
  // igual (nunca Math.random() puro). NUNCA en urbano (pedido explícito:
  // "menos en ciudad", un pedrusco no pinta nada en mitad de una calle).
  const ANGULOS_CANDIDATOS_ROCA = [15, 60, 105, 150, 195, 240, 285, 330];
  const pushRocasGrandes = (ids: string[]) => {
    const rnd = prngDesdeSemilla(hashDeterminista(`${semillaArena}:${tema}:hito`));
    const cuenta = 2 + Math.floor(rnd() * 4); // 2..5
    const angulosDisponibles = [...ANGULOS_CANDIDATOS_ROCA];
    const radio = hw + margenVisual * 0.6;
    for (let i = 0; i < cuenta && angulosDisponibles.length > 0; i++) {
      const anguloDeg = angulosDisponibles.splice(Math.floor(rnd() * angulosDisponibles.length), 1)[0];
      const id = ids[Math.floor(rnd() * ids.length)];
      const rad = THREE.MathUtils.degToRad(anguloDeg);
      const x = Math.sin(rad) * radio, y = Math.cos(rad) * radio;
      items.push({ tipo: "r", id, x, y, rotacionDeg: anguloHaciaCentro(x, y), escala: 2.2 });
    }
  };

  if (tema === "exterior") {
    const base: ClusterDecoracion[] = [
      { anguloDeg: 8, radio: hw + margenVisual * 0.6, especies: [v("roble"), v("pino"), v("abeto"), v("roble"), v("haya"), v("pino")] }, // bosquecillo denso
      { anguloDeg: 48, radio: hw + 1.5, especies: [v("margarita"), v("amapola"), v("trebol")] },
      { anguloDeg: 95, radio: hw + margenVisual * 0.42, especies: [v("arbusto_comun"), v("seto_silvestre")] },
      { anguloDeg: 150, radio: hw + margenVisual * 0.66, especies: [v("haya"), v("roble"), v("abeto"), v("haya")] },
      // hueco grande 150->270 (120°): sin decoración a propósito
      { anguloDeg: 270, radio: hw + 1.6, especies: [v("diente_de_leon")] },
      { anguloDeg: 310, radio: hw + margenVisual * 0.58, especies: [v("pino"), v("abeto"), v("arbusto_comun"), v("roble"), v("trebol")] },
    ];
    items = colocarClusters([...base, ...duplicarClustersDesplazados(base, hw, DELTA_CAPA2, FACTOR_CAPA2)]);
    const fauna: [string, number][] = [
      ["corzo", 25], ["conejo", 118], ["ciervo", 205], ["ardilla", 330], ["zorro", 65], ["liebre", 285],
    ];
    const rFauna = hw + margenVisual * 0.55;
    for (const [id, deg] of fauna) {
      const rad = THREE.MathUtils.degToRad(deg);
      const x = Math.sin(rad) * rFauna, y = Math.cos(rad) * rFauna;
      items.push({ tipo: "a", id, x, y, rotacionDeg: anguloHaciaCentro(x, y) });
    }
    pushRocasGrandes(["roca_erratica", "roca_acantilado_grande", "roca_acantilado_pequena"]);
  } else if (tema === "urbano") {
    const base: ClusterDecoracion[] = [
      { anguloDeg: 15, radio: hw + 1.5, especies: [m("barril"), m("caja_madera"), m("cesta_pan")] },
      { anguloDeg: 70, radio: hw + margenVisual * 0.65, especies: [m("puesto_mercado"), m("tenderete_comida"), m("farola_calle")] },
      { anguloDeg: 125, radio: hw + 1.4, especies: [m("saco_harina")] },
      { anguloDeg: 170, radio: hw + margenVisual * 0.6, especies: [m("banco_piedra"), m("fuente_piedra"), m("estatua_piedra"), m("banco_madera")] },
      // hueco 170->250 (80°): calle despejada
      { anguloDeg: 250, radio: hw + 1.6, especies: [m("cubo_madera"), m("lena_apilada")] },
      { anguloDeg: 300, radio: hw + margenVisual * 0.68, especies: [m("carreta"), m("carromato"), m("valla_madera"), m("barril")] },
    ];
    items = colocarClusters([...base, ...duplicarClustersDesplazados(base, hw, DELTA_CAPA2, FACTOR_CAPA2)]);
  } else if (tema === "acuatico") {
    const base: ClusterDecoracion[] = [
      { anguloDeg: 20, radio: hw + 1.3, especies: [v("alga_parda"), a("pez_pequeno"), v("posidonia")] },
      { anguloDeg: 100, radio: hw + margenVisual * 0.6, especies: [v("coral_cerebro"), v("coral_blando"), a("pez_mediano")] },
      { anguloDeg: 155, radio: hw + 1.4, especies: [v("algas_varadas")] },
      // hueco 155->205 corto, pero el siguiente 205->300 (95°) sí es amplio
      { anguloDeg: 205, radio: hw + margenVisual * 0.5, especies: [a("pez_grande"), v("coral_cuerno_de_ciervo"), a("pez_mediano"), v("posidonia")] },
      { anguloDeg: 300, radio: hw + 1.3, especies: [v("alga_parda"), a("pez_pequeno")] },
    ];
    items = colocarClusters([...base, ...duplicarClustersDesplazados(base, hw, DELTA_CAPA2, FACTOR_CAPA2)]);
    // orca/tiburón: colorDebug real (camuflaje de mar profundo) se pierde
    // contra el fondo oscuro del agua a tamaño normal — escala grande
    // (depredador de verdad, no un pez más) para que se note igual.
    const rPredador = hw + margenVisual * 0.62;
    for (const [id, deg] of [["orca", 55], ["tiburon", 235]] as [string, number][]) {
      const rad = THREE.MathUtils.degToRad(deg);
      const x = Math.sin(rad) * rPredador, y = Math.cos(rad) * rPredador;
      items.push({ tipo: "a", id, x, y, rotacionDeg: anguloHaciaCentro(x, y), escala: 2.6 });
    }
    // roca_coralina/roca_acantilado_grande (no roca_erratica): formación de
    // arrecife o peñasco sumergido, coherentes bajo el agua.
    pushRocasGrandes(["roca_coralina", "roca_acantilado_grande"]);
  } else {
    const base: ClusterDecoracion[] = [
      { anguloDeg: 25, radio: hw + 1.4, especies: [rc("guijarros"), rc("canto_rodado")] },
      { anguloDeg: 80, radio: hw + margenVisual * 0.62, especies: [rc("roca_erratica"), rc("pizarra"), rc("granito")] },
      // hueco 80->190 (110°): suelo de cueva despejado
      { anguloDeg: 190, radio: hw + 1.5, especies: [rc("canto_rodado")] },
      { anguloDeg: 250, radio: hw + margenVisual * 0.66, especies: [rc("roca_caliza"), rc("granito"), rc("roca_erratica"), rc("guijarros")] },
      { anguloDeg: 320, radio: hw + 1.3, especies: [rc("pizarra"), rc("canto_rodado")] },
    ];
    items = colocarClusters([...base, ...duplicarClustersDesplazados(base, hw, DELTA_CAPA2, FACTOR_CAPA2)]);
    pushRocasGrandes(["roca_acantilado_grande", "roca_erratica", "roca_acantilado_pequena"]);
  }

  const grupo = await crearDecoracionManual(items);

  if (tema === "urbano") {
    // NPCs estáticos (sin rig de red: crearRigHumanoide puro, misma pinta
    // que un aldeano real, quieto — nunca se llama actualizar()) mirando
    // al centro del grid, en ángulos/radios DESIGUALES (no una cruz perfecta).
    const posiciones: [number, number][] = [
      [35, hw + margenVisual * 0.58], [140, hw + margenVisual * 0.5],
      [210, hw + margenVisual * 0.62], [320, hw + margenVisual * 0.55],
      [75, hw + margenVisual * 0.4], [180, hw + margenVisual * 0.68],
      [265, hw + margenVisual * 0.45], [355, hw + margenVisual * 0.6],
    ];
    posiciones.forEach(([deg, radio], i) => {
      const rad = THREE.MathUtils.degToRad(deg);
      const x = Math.sin(rad) * radio, y = Math.cos(rad) * radio;
      const rig = crearRigHumanoide({ colorTunica: COLORES_TUNICA_NPC[i % COLORES_TUNICA_NPC.length] });
      rig.orientar(-x, -y);
      rig.objeto.position.set(x, 0, y);
      rig.objeto.traverse((o) => { o.userData.propioDelSector = true; });
      grupo.add(rig.objeto);
    });
  }

  return grupo;
}

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

/** Opacidad + altura de la capa de nieve de UN plano ya creado, según el nivel (0..NIVEL_MAXIMO_NIEVE) — nunca reconstruye geometría/textura. */
function aplicarNivelNieveAPlano(plano: THREE.Mesh, nivel: number): void {
  const material = plano.material as THREE.MeshStandardMaterial;
  const fraccion = Math.max(0, Math.min(1, nivel / NIVEL_MAXIMO_NIEVE));
  material.opacity = OPACIDAD_MAX_NIEVE * fraccion;
  plano.position.y = ALTURA_MAX_NIEVE * fraccion;
  plano.visible = nivel > 0;
}

// Hielo (docs/GDD_Clima.md): agua con nieve acumulada encima — sustituye
// el tono translúcido de AGUAS por un tono opaco frío, mismo criterio que
// el resto de esta tabla (placeholder de color, sin textura real todavía).
const COLOR_HIELO = new THREE.Color(0xcfe4ec);
// Capa de nieve en tierra: blanco simple, opacidad y altura crecientes con
// el nivel (0..NIVEL_MAXIMO_NIEVE) — PLACEHOLDER (docs/GDD_Clima.md §nieve
// visual): un plano semitransparente por sector, nunca una malla por
// casilla (sería carísimo). Nunca cubre agua/hielo (ver más abajo).
const OPACIDAD_MAX_NIEVE = 0.85;
const ALTURA_MAX_NIEVE = 0.22;

function crearTerrenoSector(
  indice: IndiceMapa,
  sector: SectorBakeado,
  margenVisual = 0,
  nivelNieveActual = 0,
): { grupo: THREE.Group; ancho: number; alto: number } {
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
  // Máscara de nieve (docs/GDD_Clima.md): blanco opaco donde SÍ puede haber
  // nieve (tierra), transparente donde no (agua/hielo) — se pinta UNA vez
  // al materializar el sector; la opacidad/altura de todo el plano (no de
  // este canvas) es lo que sube y baja con el nivel, ver `actualizarNieveSector`.
  const nieveCanvas = document.createElement("canvas");
  nieveCanvas.width = ancho;
  nieveCanvas.height = alto;
  const ctxNieve = nieveCanvas.getContext("2d")!;
  ctxNieve.clearRect(0, 0, ancho, alto);
  ctxNieve.fillStyle = "#ffffff";

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
          ctxNieve.fillRect(baseX + x, baseY + y, 1, 1);
          continue;
        }
        if (nivelNieveActual > 0) {
          // Hielo (docs/GDD_Clima.md): opaco, sin lecho visible debajo — no
          // se nada encima, es "tierra" a efectos de juego (RoomExteriorBase.ts).
          ctxSuelo.fillStyle = `#${COLOR_HIELO.getHexString()}`;
          ctxSuelo.fillRect(baseX + x, baseY + y, 1, 1);
          continue;
        }
        // superficie translúcida con el color de catálogo aclarado
        const c = new THREE.Color(colorTerreno(id)).lerp(new THREE.Color(1, 1, 1), ACLARADO_SUPERFICIE);
        ctxSuelo.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${agua.alfa})`;
        ctxSuelo.fillRect(baseX + x, baseY + y, 1, 1);
        // lecho: mitad por tipo de agua (somera clara, profunda oscura),
        // mitad por la elevación bakeada (elevación baja = hondo = oscuro).
        // BUG REAL encontrado verificando visualmente la arena acuática
        // (docs/GDD_Combate.md §9.6): `chunk.elevacion` es un campo del
        // bakeador EXTERIOR (baker/src/exportar.js) que los bakes más
        // simples (mazmorras/src/generarArena.js para arenas de combate —
        // "sin salas ni mobiliario, una arena es solo suelo+obstáculos" — y
        // baker/src/generar_mapas_prueba_barcos.js para los mapas de prueba
        // 100% agua) nunca escriben. `mar_01` es agua entera, así que ESTE
        // acceso indexaba `undefined` en la primera casilla y tiraba abajo
        // el sector entero (nunca se detectó porque ningún e2e con
        // navegador había cargado antes una arena/mapa de prueba con agua
        // de verdad). Sin dato de elevación, un tono medio fijo es un lecho
        // plano razonable — sigue sin romper nada donde SÍ hay elevación.
        const e = chunk.elevacion ? parseInt(chunk.elevacion[y * chunk.tamano + x], 36) : (ELEV_AGUA_MIN + ELEV_AGUA_MAX) / 2;
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
  // margenVisual > 0: los planos crecen simétricamente por los 4 lados, así
  // que el centro (origenTileX+ancho/2, origenTileY+alto/2) NO se mueve —
  // solo se pide geometría/textura más grandes, la posición es la misma.
  const anchoFinal = ancho + margenVisual * 2;
  const altoFinal = alto + margenVisual * 2;
  const sueloFinal = margenVisual > 0 ? extenderConMargenClamp(suelo, margenVisual) : suelo;
  const fondoFinal = margenVisual > 0 ? extenderConMargenClamp(fondo, margenVisual) : fondo;
  const planoFondo = crearPlanoSector(fondoFinal, anchoFinal, altoFinal, false);
  planoFondo.position.set(origenTileX + ancho / 2, -PROFUNDIDAD_FONDO, origenTileY + alto / 2);
  const planoSuelo = crearPlanoSector(sueloFinal, anchoFinal, altoFinal, true);
  planoSuelo.position.set(origenTileX + ancho / 2, 0, origenTileY + alto / 2);
  grupo.add(planoFondo, planoSuelo);

  // Capa de nieve (docs/GDD_Clima.md): mismo plano/textura que el suelo,
  // la máscara ya excluye agua/hielo. Opacidad/altura arrancan acordes al
  // nivel de HOY; `actualizarNieveSector` las retoca sin reconstruir nada
  // cuando el nivel global cambie mientras el sector siga materializado.
  const nieveFinal = margenVisual > 0 ? extenderConMargenClamp(nieveCanvas, margenVisual) : nieveCanvas;
  const planoNieve = crearPlanoSector(nieveFinal, anchoFinal, altoFinal, true);
  planoNieve.name = "capaNieve";
  planoNieve.position.set(origenTileX + ancho / 2, 0, origenTileY + alto / 2);
  // `renderOrder` explícito: dos planos transparentes casi a la misma
  // altura (suelo y nieve) pueden ordenarse mal en la pasada de
  // transparencia de Three (por distancia a cámara, no por orden de
  // escena) y la nieve queda invisible por debajo del suelo. Forzar que
  // la nieve se dibuje SIEMPRE después del suelo (orden 0) lo evita.
  planoNieve.renderOrder = 1;
  aplicarNivelNieveAPlano(planoNieve, nivelNieveActual);
  grupo.add(planoNieve);

  if (margenVisual > 0) {
    // margenVisual>0 hoy SOLO pasa en arenas (game.ts) — ver crearRejillaTactica.
    const rejilla = crearRejillaTactica(ancho, alto);
    rejilla.position.set(origenTileX, 0.02, origenTileY);
    grupo.add(rejilla);
  }

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
  return { grupo, ancho, alto };
}

interface GrupoEspecie {
  // solo tipos con categoría de asset llegan aquí (se filtra al agrupar)
  tipo: "v" | "r" | "a" | "m" | "e";
  id: string;
  variante: number;
  objetos: { globalX: number; globalY: number; obj: ObjetoBakeado }[];
}

/** Clave de posición GLOBAL (casilla) — mismo criterio que el servidor usa para recolectables/árboles talados (docs/GDD_Bosques.md §7): la identidad de un prop bakeado es su posición, no su índice de instancia. */
function clavePosicion(x: number, y: number): string {
  return `${x},${y}`;
}

async function crearPropsSector(
  indice: IndiceMapa,
  sector: SectorBakeado,
  excluidos: Set<string>,
): Promise<{ raiz: THREE.Group; ocultables: Map<string, () => void> }> {
  const grupos = new Map<string, GrupoEspecie>();
  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    for (const obj of chunk.objetos) {
      // tipos sin categoría de asset conocida no se instancian
      if (!CATEGORIA_POR_TIPO[obj.t]) continue;
      const globalX = cx * chunk.tamano + obj.x;
      const globalY = cy * chunk.tamano + obj.y;
      // Ya no existe (recolectado, o árbol talado — docs/GDD_Bosques.md §7):
      // ni se instancia. El servidor es quien decide esto (sector:exclusiones,
      // RoomExteriorBase.ts) — este cliente nunca lo infiere solo.
      if (excluidos.has(clavePosicion(globalX, globalY))) continue;
      // La variante (obj.va) entra en la clave de grupo: cada plantilla .glb
      // cargada es UNA variante concreta (edificios/<tipo>_NN.glb) — sin
      // esto, dos edificios del mismo tipo con distinta variante bakeada
      // compartirían igualmente la plantilla de la variante 0.
      const variante = obj.va || 0;
      const claveGrupo = `${obj.t}:${obj.i}:${variante}`;
      if (!grupos.has(claveGrupo)) grupos.set(claveGrupo, { tipo: obj.t as GrupoEspecie["tipo"], id: obj.i, variante, objetos: [] });
      grupos.get(claveGrupo)!.objetos.push({ globalX, globalY, obj });
    }
  }

  const raiz = new THREE.Group();
  // Posición -> "ocúltate" (docs/GDD_Bosques.md §7): para cuando el jugador
  // ve en vivo cómo se tala/recolecta algo de ESTE sector ya materializado.
  // InstancedMesh no tiene "quitar instancia" nativo — la técnica estándar
  // es escalarla a 0 (invisible, sin reconstruir el buffer entero); un
  // clon .glb individual simplemente se oculta.
  const ocultables = new Map<string, () => void>();
  const matrizCero = new THREE.Matrix4().makeScale(0, 0, 0);

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
          ocultables.set(clavePosicion(globalX, globalY), () => { instancia.visible = false; });
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
        ocultables.set(clavePosicion(globalX, globalY), () => {
          malla.setMatrixAt(indice2, matrizCero);
          malla.instanceMatrix.needsUpdate = true;
        });
      });
      malla.instanceMatrix.needsUpdate = true;
      raiz.add(malla);
    }),
  );

  return { raiz, ocultables };
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

/**
 * Handle de un sector materializado — además del `Group` de escena, expone
 * `ocultarPosicion` (docs/GDD_Bosques.md §7) para apagar en vivo un prop
 * concreto ya renderizado (talado/recogido mientras el jugador lo tenía
 * delante), sin reconstruir el sector entero. No-op si esa posición no
 * tenía nada instanciado (terreno, o ya estaba excluida al construir).
 */
export interface HandleSector {
  grupo: THREE.Group;
  ocultarPosicion: (x: number, y: number) => void;
}

/**
 * Terreno + muralla + props de un sector, listos para añadir a escena.
 * `excluidos` (docs/GDD_Bosques.md §7) son posiciones GLOBALes "x,y" que ya
 * no existen en el servidor (recogidas/taladas) — nunca se instancian.
 * `margenVisual` (casillas): relleno de terreno alrededor del sector real,
 * "clamp to edge" (ver `extenderConMargenClamp`) MÁS decoración a mano por
 * tema del bioma (ver `crearDecoracionMargenArena`) y la rejilla táctica
 * (`crearRejillaTactica`) — pensado para arenas de combate, donde el bake
 * es SIEMPRE un único sector completo (`anchoChunks/altoChunks/
 * tamanoSectorChunks = 1`, confirmado en los bakes de prueba), así que no
 * hay sector vecino con el que pueda hacer costura.
 */
export async function crearSectorVisual(
  indice: IndiceMapa,
  sector: SectorBakeado,
  excluidos: Set<string> = new Set(),
  margenVisual = 0,
  nivelNieveActual = 0,
): Promise<HandleSector> {
  const grupo = new THREE.Group();
  grupo.name = `sector_${sector.sectorX}_${sector.sectorY}`;
  const terreno = crearTerrenoSector(indice, sector, margenVisual, nivelNieveActual);
  grupo.add(terreno.grupo);
  grupo.add(crearMurallaSector(indice, sector));
  const { raiz, ocultables } = await crearPropsSector(indice, sector, excluidos);
  grupo.add(raiz);
  if (margenVisual > 0) {
    // margenVisual>0 hoy SOLO pasa en arenas — decoración A MANO del margen
    // visual (crearDecoracionMargenArena), mismo centro que los planos de
    // terreno (terreno.ancho/alto son los del sector REAL, sin el margen).
    const tilesSector = indice.tamanoSectorChunks * indice.tamanoChunk;
    const origenTileX = sector.sectorX * tilesSector;
    const origenTileY = sector.sectorY * tilesSector;
    // nombre+semilla del BAKE (indice.json) como semilla de las rocas de
    // hito: identifica la arena concreta, así "depende del mapa" de verdad
    // (dos arenas distintas del mismo bioma no salen iguales) sin dejar de
    // ser la MISMA cada vez que se entra a ESTA arena.
    const decoracion = await crearDecoracionMargenArena(terreno.ancho, terreno.alto, margenVisual, indice.leyendaTerreno, `${indice.nombre}:${indice.semilla}`);
    decoracion.position.set(origenTileX + terreno.ancho / 2, 0, origenTileY + terreno.alto / 2);
    grupo.add(decoracion);
  }
  return { grupo, ocultarPosicion: (x, y) => ocultables.get(clavePosicion(x, y))?.() };
}

/** Libera GPU/memoria de lo que creó `crearSectorVisual` (llamar tras quitarlo de escena). */
export function soltarSectorVisual(handle: HandleSector): void {
  handle.grupo.traverse((obj) => {
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
  handle.grupo.clear();
}

/** Retoca opacidad/altura de la capa de nieve de un sector YA materializado, sin reconstruir nada — llamar cuando el nivel global de nieve cambie (docs/GDD_Clima.md, una vez por día de mundo). No-op si este sector no tiene capa de nieve (arenas/mazmorras u otro caso raro). */
export function actualizarNieveSector(handle: HandleSector, nivel: number): void {
  const plano = handle.grupo.getObjectByName("capaNieve") as THREE.Mesh | undefined;
  if (plano) aplicarNivelNieveAPlano(plano, nivel);
}
