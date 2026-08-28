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
}

export interface MapaCargado extends MundoColision {
  nombre: string;
  /** casilla de aparición (la ciudad del índice, corregida a suelo pisable) */
  spawnX: number;
  spawnY: number;
  /** ruta absoluta de donde se cargó — para resolver `interiores/<edificio>.json` */
  rutaMapa: string;
  portales: Portal[];
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
  }>(path.join(rutaMapa, "indice.json"));

  const terrenos = leerJSON<Record<string, EntradaTerreno>>(path.join(rutaCatalogo, "terrenos.json"));
  const solidosCatalogo = idsConColision(rutaCatalogo);

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
        chunks: Record<string, { terreno: string; tamano: number; objetos: { i: string; x: number; y: number }[] }>;
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
          if (!solidosCatalogo.has(obj.i)) continue;
          const idx = (baseY + obj.y) * ancho + (baseX + obj.x);
          // una pieza sólida solo endurece suelo firme: un árbol no convierte
          // agua en pared (y el agua nunca debería traer piezas sólidas)
          if (casillas[idx] === TIPO.TIERRA) casillas[idx] = TIPO.SOLIDO;
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
