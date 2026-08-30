/**
 * Carga un mapa bakeado (assets/mapas/<nombre>/) y lo convierte en la
 * rejilla de colisión que usa la simulación. Se hace UNA vez al crear la
 * room (generar una vez, nunca en directo): el servidor en vivo solo lee
 * los typed arrays resultantes.
 *
 * Fuentes de verdad (no se duplica nada aquí):
 * - `baker/catalogo/terrenos.json`: `transitable`/`requiereNadar`/
 *   `modVelocidad` de cada terreno.
 * - `baker/catalogo/{vegetacion,rocas,animales}.json`: `colision: true`
 *   marca qué piezas bloquean su casilla.
 */

import * as fs from "fs";
import * as path from "path";
import { MundoColision, TIPO } from "./colisiones";
import { RecolectableVivo, catalogosPorCapa, recolectablesDeMapa } from "./recolectables";

// server/{src|dist}/mundo -> raíz del repo (assets/ y baker/ son hermanos de server/)
const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");

interface EntradaTerreno {
  transitable?: boolean;
  requiereNadar?: boolean;
  modVelocidad?: number;
}

function leerJSON<T>(ruta: string): T {
  return JSON.parse(fs.readFileSync(ruta, "utf8")) as T;
}

function idsConColision(rutaCatalogo: string): Set<string> {
  const ids = new Set<string>();
  for (const archivo of ["vegetacion.json", "rocas.json", "animales.json"]) {
    const catalogo = leerJSON<Record<string, { colision?: boolean }>>(path.join(rutaCatalogo, archivo));
    for (const [id, datos] of Object.entries(catalogo)) {
      if (!id.startsWith("_") && datos && datos.colision === true) ids.add(id);
    }
  }
  // deco urbana de los mapas de ciudad (t:"m"): su catálogo declara qué
  // piezas bloquean (vallas, farolas, puestos...) — misma regla de casilla
  const rutaDeco = path.join(RAIZ_REPO, "ciudades", "catalogo", "decoracion.json");
  if (fs.existsSync(rutaDeco)) {
    const decoracion = leerJSON<Record<string, { colision?: boolean }>>(rutaDeco);
    for (const [id, datos] of Object.entries(decoracion)) {
      if (!id.startsWith("_") && datos && datos.colision === true) ids.add(id);
    }
  }
  return ids;
}

/** Puerta/portón bakeado (ciudades/src/generar.js): "exterior" = puerta de
 * la muralla hacia fuera del asentamiento; "interior" = puerta de un
 * edificio concreto hacia su interior anidado (mismo `edificio` que el
 * nombre de archivo en `<rutaMapa>/interiores/`). `destino` (opcional,
 * solo en portales "exterior" de un mapa PADRE — hub o región — que
 * enlazan a otro mapa; ver docs/GDD_Sistema_Puertas.md) dice adónde va:
 * sin `destino`, un portal "exterior" es la salida propia del mapa hacia
 * quien lo abrió (comportamiento "volver"). */
export interface Portal {
  tipo: "exterior" | "interior";
  x: number;
  y: number;
  edificio?: string;
  tipoEdificioId?: string;
  destino?: { tipo: "region" | "hub"; mapaId?: string };
  /** true = el interior es una mazmorra (DungeonRoom, con enemigos) en vez
   * de un edificio normal (InteriorRoom) — docs/GDD_Bakeador_Dungeons.md. */
  esMazmorra?: boolean;
}

/** Hueco reservado por el bakeador de ciudades/ (SOLO tiers con `edificios.parcelasReservadas`,
 * hoy únicamente `capital_jarl`) para el futuro sistema de construcción-en-regiones —
 * ciudades/src/generar.js, docs/GDD_Ciudad_Capital.md §3bis. `x,y` = CENTRO del
 * rectángulo (no esquina), `rot` en radianes: mismo formato que usa
 * `rasterizarRectRotado` (ciudades/src/geometria.js) para pintarlo, así que se
 * rasteriza igual al convertirlo en parcela (server/src/construccion/parcelas.ts). */
export interface ParcelaReservada {
  tipo: "normal" | "especial";
  x: number;
  y: number;
  rot: number;
  ancho: number;
  largo: number;
}

/** Borde del mapa (docs/GDD_Barcos.md, pedido 2026-08-30 "Barcos y navegación
 * marítima"): `tipo:"mar_abierto"` = un barco puede cruzarlo; cualquier otro
 * valor (p.ej. "cerrado") = pared dura, igual que hoy. `nombre` = carpeta
 * bajo assets/mapas/ del mapa exterior vecino — null si aún no hay ninguno
 * bakeado en esa dirección (caso de assets/mapas/principal/ hoy: el campo ya
 * existía mudo en el índice desde el bakeador, esta pasada es la primera que
 * lo LEE). */
export interface BordeMapa {
  tipo: string;
  nombre: string | null;
}

export interface MapaCargado extends MundoColision {
  nombre: string;
  /** casilla de aparición (la ciudad del índice, corregida a suelo pisable) */
  spawnX: number;
  spawnY: number;
  /** ruta absoluta de donde se cargó — para resolver `interiores/<edificio>.json` */
  rutaMapa: string;
  portales: Portal[];
  /** recolectables EXTERIORES vivos (fase 2 de inventario, "coger" — mundo/recolectables.ts): clave y*ancho+x, mutable, sin persistencia. */
  recolectables: Map<number, RecolectableVivo>;
  /** [] en cualquier mapa que no sea la ciudad capital (o un futuro tier con el mismo campo) — ver ParcelaReservada. */
  parcelasReservadas: ParcelaReservada[];
  /** norte/sur/este/oeste — undefined en mapas sin ese campo en el índice (p.ej. demo antiguo). */
  bordes?: Record<"norte" | "sur" | "este" | "oeste", BordeMapa>;
}

export function cargarMapaColision(
  rutaMapa: string = process.env.RUTA_MAPA || path.join(RAIZ_REPO, "assets", "mapas", "demo"),
  rutaCatalogo: string = process.env.RUTA_CATALOGO || path.join(RAIZ_REPO, "baker", "catalogo"),
): MapaCargado {
  const indice = leerJSON<{
    nombre: string;
    anchoChunks: number;
    altoChunks: number;
    tamanoChunk: number;
    tamanoSectorChunks: number;
    leyendaTerreno: string[];
    ciudad?: { x: number; y: number };
    portales?: Portal[];
    parcelasReservadas?: ParcelaReservada[];
    bordes?: Record<"norte" | "sur" | "este" | "oeste", BordeMapa>;
  }>(path.join(rutaMapa, "indice.json"));

  const terrenos = leerJSON<Record<string, EntradaTerreno>>(path.join(rutaCatalogo, "terrenos.json"));
  const solidosCatalogo = idsConColision(rutaCatalogo);
  const catalogosCapa = catalogosPorCapa(rutaCatalogo);
  // recolectables: el MISMO Map vive mientras dure el proceso (ver
  // mundo/recolectables.ts) — `poblar` es true solo la primera vez que se
  // carga ESTE rutaMapa, así una room que se recrea (RegionRoom autoDispose)
  // no resetea lo ya cogido.
  const { mapa: recolectables, esNuevo: poblarRecolectables } = recolectablesDeMapa(rutaMapa);

  const T = indice.tamanoChunk;
  const ancho = indice.anchoChunks * T;
  const alto = indice.altoChunks * T;
  const casillas = new Uint8Array(ancho * alto).fill(TIPO.SOLIDO); // chunk ausente = pared
  const velocidad = new Float32Array(ancho * alto).fill(1);

  // tipo por id de terreno, precalculado una vez sobre la leyenda del índice
  const tipoPorIndice = indice.leyendaTerreno.map((id) => {
    const t = terrenos[id];
    if (!t) return TIPO.SOLIDO; // terreno desconocido: mejor pared que agujero
    if (t.requiereNadar) return id === "agua_profunda" ? TIPO.AGUA_PROFUNDA : TIPO.AGUA;
    return t.transitable === false ? TIPO.SOLIDO : TIPO.TIERRA;
  });
  const velPorIndice = indice.leyendaTerreno.map((id) => terrenos[id]?.modVelocidad ?? 1);

  const sectoresAncho = Math.max(1, Math.ceil(indice.anchoChunks / indice.tamanoSectorChunks));
  const sectoresAlto = Math.max(1, Math.ceil(indice.altoChunks / indice.tamanoSectorChunks));
  const pad3 = (n: number) => String(n).padStart(3, "0");

  for (let sy = 0; sy < sectoresAlto; sy++) {
    for (let sx = 0; sx < sectoresAncho; sx++) {
      const ruta = path.join(rutaMapa, `sector_${pad3(sx)}_${pad3(sy)}.json`);
      if (!fs.existsSync(ruta)) continue;
      const sector = leerJSON<{
        chunks: Record<
          string,
          { terreno: string; tamano: number; objetos: { i: string; t: string; x: number; y: number; ac?: number }[] }
        >;
      }>(ruta);
      for (const [clave, chunk] of Object.entries(sector.chunks)) {
        const [cx, cy] = clave.split("_").map(Number); // coordenada GLOBAL de chunk
        const baseX = cx * T, baseY = cy * T;
        for (let y = 0; y < chunk.tamano; y++) {
          for (let x = 0; x < chunk.tamano; x++) {
            const idx = (baseY + y) * ancho + (baseX + x);
            const iTerreno = parseInt(chunk.terreno[y * chunk.tamano + x], 36);
            casillas[idx] = tipoPorIndice[iTerreno] ?? TIPO.SOLIDO;
            velocidad[idx] = velPorIndice[iTerreno] ?? 1;
          }
        }
        for (const obj of chunk.objetos) {
          if (solidosCatalogo.has(obj.i)) {
            const idx = (baseY + obj.y) * ancho + (baseX + obj.x);
            // una pieza sólida solo endurece suelo firme: un árbol no convierte
            // agua en pared (y el agua nunca debería traer piezas sólidas)
            if (casillas[idx] === TIPO.TIERRA) casillas[idx] = TIPO.SOLIDO;
          }
          // `ac` se OMITE cuando el candidato nace activo (caso normal) y solo
          // se guarda `ac:0` para los inactivos/reserva del pool (baker/src/
          // decoracion.js) — así que "activo" es `obj.ac !== 0`, NUNCA
          // `!obj.ac` (bug real: `!undefined` y `!0` son ambos `true` en JS,
          // esa condición habría marcado como recolectable el 100% del pool,
          // no solo la fracción activa — encontrado en la crítica adversarial
          // del diseño de esta fase antes de escribir una sola línea).
          if (poblarRecolectables && obj.ac !== 0) {
            const def = catalogosCapa[obj.t]?.[obj.i];
            if (def?.desaparaceAlRecolectar && def.categoriaRecurso) {
              const idx = (baseY + obj.y) * ancho + (baseX + obj.x);
              recolectables.set(idx, { itemId: def.categoriaRecurso, x: baseX + obj.x, y: baseY + obj.y });
            }
          }
        }
      }
    }
  }

  // spawn: la ciudad del índice, o el centro; corregido a la casilla
  // pisable más cercana (búsqueda en anillos, el mapa demo nace en roca)
  const objetivo = indice.ciudad ?? { x: Math.floor(ancho / 2), y: Math.floor(alto / 2) };
  const spawn = casillaPisableMasCercana(casillas, ancho, alto, objetivo.x, objetivo.y);

  return {
    nombre: indice.nombre,
    ancho,
    alto,
    casillas,
    velocidad,
    spawnX: spawn.x + 0.5,
    spawnY: spawn.y + 0.5,
    rutaMapa,
    portales: indice.portales ?? [],
    recolectables,
    parcelasReservadas: indice.parcelasReservadas ?? [],
    bordes: indice.bordes,
  };
}

function casillaPisableMasCercana(
  casillas: Uint8Array,
  ancho: number,
  alto: number,
  x0: number,
  y0: number,
): { x: number; y: number } {
  const radioMax = Math.max(ancho, alto);
  for (let r = 0; r < radioMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // solo el anillo
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
        if (casillas[y * ancho + x] === TIPO.TIERRA) return { x, y };
      }
    }
  }
  return { x: x0, y: y0 }; // mapa sin tierra: se aparece donde sea
}
