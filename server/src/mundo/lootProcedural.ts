/**
 * Loot procedural de cadáver de JEFE HUMANOIDE (pedido 2026-08-31: "loot
 * procedural por cadáver de enemigos de bosses humanoides, no animales") —
 * reusa el cadáver looteable que ya existía (mundo/cadaveres.ts) y el pool
 * de artículos en server/src/combate/catalogoLootBoss.json; este módulo
 * solo decide QUÉ cae dentro. Tirada EN VIVO (Math.random(), mismo criterio
 * que el loot 1-20 de Farycoins, docs/GDD_Economia.md: esto es economía
 * viva, no generación offline con semilla).
 */
import * as fs from "fs";
import * as path from "path";

const RUTA_CATALOGO = path.join(__dirname, "..", "combate", "catalogoLootBoss.json");
const RUTA_CATALOGO_NORMAL = path.join(__dirname, "..", "combate", "catalogoLootNormal.json");
const RUTA_CATALOGO_TEMATICO = path.join(__dirname, "..", "combate", "catalogoLootTematico.json");

interface EntradaLootBoss {
  itemId: string;
  peso: number;
  cantidadMin: number;
  cantidadMax: number;
}

interface CatalogoLootBoss {
  numDropsMin: number;
  numDropsMax: number;
  pool: EntradaLootBoss[];
}

interface CatalogoLootTematico {
  [tema: string]: { armas: string[]; armaduras: string[] };
}

let cache: CatalogoLootBoss | null = null;
let cacheNormal: CatalogoLootBoss | null = null;
let cacheTematico: CatalogoLootTematico | null = null;

export function cargarCatalogoLootBoss(): CatalogoLootBoss {
  if (!cache) cache = JSON.parse(fs.readFileSync(RUTA_CATALOGO, "utf8")) as CatalogoLootBoss;
  return cache;
}

/** docs/GDD_Combate.md §4bis — pool de loot de un enemigo de mazmorra NORMAL (no boss), mucho más pequeño que el de boss (ver catalogoLootNormal.json). */
export function cargarCatalogoLootNormal(): CatalogoLootBoss {
  if (!cacheNormal) cacheNormal = JSON.parse(fs.readFileSync(RUTA_CATALOGO_NORMAL, "utf8")) as CatalogoLootBoss;
  return cacheNormal;
}

/** docs/GDD_Combate.md §11ter — arma/armadura temática por `temasEnemigo`, complemento del pool genérico de boss. */
export function cargarCatalogoLootTematico(): CatalogoLootTematico {
  if (!cacheTematico) cacheTematico = JSON.parse(fs.readFileSync(RUTA_CATALOGO_TEMATICO, "utf8")) as CatalogoLootTematico;
  return cacheTematico;
}

// Probabilidad de que, ADEMÁS de los numDropsMin-numDropsMax genéricos de
// siempre, un boss con tema conocido suelte una pieza temática suya (arma o
// armadura, mitad y mitad) — nunca sustituye al pool genérico, solo lo
// complementa; nunca se aplica a enemigos normales (generarLootNormal jamás
// pasa `temas`, respeta el "nunca equipo real" ya documentado ahí).
const PROB_LOOT_TEMATICO = 0.5;

/**
 * Tira entre numDropsMin y numDropsMax artículos ponderados del pool, sin
 * repetir el mismo itemId dos veces en la misma muerte (evita cadáveres
 * redundantes tipo "3 dagas").
 */
/** Mismo generador ponderado, sirve tanto para el pool de boss como el de enemigo normal — solo cambia el catálogo. */
export function generarLootNormal(catalogo: CatalogoLootBoss = cargarCatalogoLootNormal()): { itemId: string; cantidad: number }[] {
  return generarLootBoss(catalogo);
}

/** `temas` (opcional, docs/GDD_Combate.md §11ter): `temasEnemigo` del boss que murió — si alguno tiene entrada en catalogoLootTematico.json, hay una probabilidad extra (PROB_LOOT_TEMATICO) de sumar UNA pieza temática (arma o armadura) al loot genérico de siempre. Nunca la pasa `generarLootNormal` (sigue sin equipo real para enemigos normales). */
export function generarLootBoss(
  catalogo: CatalogoLootBoss = cargarCatalogoLootBoss(),
  temas: string[] = [],
): { itemId: string; cantidad: number }[] {
  const numDrops = catalogo.numDropsMin + Math.floor(Math.random() * (catalogo.numDropsMax - catalogo.numDropsMin + 1));
  const disponibles = [...catalogo.pool];
  const elegidos: { itemId: string; cantidad: number }[] = [];
  for (let i = 0; i < numDrops && disponibles.length > 0; i++) {
    const pesoTotal = disponibles.reduce((s, e) => s + e.peso, 0);
    let r = Math.random() * pesoTotal;
    let idx = disponibles.length - 1;
    for (let j = 0; j < disponibles.length; j++) {
      r -= disponibles[j].peso;
      if (r <= 0) { idx = j; break; }
    }
    const entrada = disponibles.splice(idx, 1)[0];
    const cantidad = entrada.cantidadMin + Math.floor(Math.random() * (entrada.cantidadMax - entrada.cantidadMin + 1));
    elegidos.push({ itemId: entrada.itemId, cantidad });
  }

  const tematico = cargarCatalogoLootTematico();
  for (const tema of temas) {
    const entrada = tematico[tema];
    if (!entrada) continue;
    if (Math.random() < PROB_LOOT_TEMATICO) {
      const pool = [...entrada.armas, ...entrada.armaduras];
      if (pool.length > 0) elegidos.push({ itemId: pool[Math.floor(Math.random() * pool.length)], cantidad: 1 });
    }
    break; // solo el primer tema con entrada conocida (guardian_arcano es cultista+no_muerto — un único bonus, no dos)
  }
  return elegidos;
}
