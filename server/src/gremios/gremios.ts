/**
 * Gremios/clanes — lógica PURA de validación (sin Colyseus/BD) para poder
 * testearla sola, mismo patrón que construccion.ts/inventario.ts. Pedido
 * 2026-08-29: NPC notario en la capital da "los papeles" para fundar un
 * gremio con nombre propio, banco común de Farycoins, color+emblema de
 * catálogo cerrado, el líder mete/expulsa miembros.
 *
 * Farycoins = saldo numérico en `jugadores`/`gremios` (server/src/datos/bd.ts),
 * NO un ItemInstancia de inventario.ts — decisión compartida documentada ahí.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const RUTA_CATALOGO_GREMIOS = path.join(RAIZ_REPO, "gremios", "catalogo");

interface EntradaEmblema {
  uso: string;
  colorDebug: string;
}

let cacheEmblemas: Record<string, EntradaEmblema> | null = null;
let cachePaleta: string[] | null = null;

/** Catálogo cerrado de emblemas (filtra claves `_nota*`, igual que el resto de catálogos del proyecto). */
export function cargarCatalogoEmblemas(): Record<string, EntradaEmblema> {
  if (cacheEmblemas) return cacheEmblemas;
  const bruto = JSON.parse(fs.readFileSync(path.join(RUTA_CATALOGO_GREMIOS, "emblemas.json"), "utf8")) as Record<string, unknown>;
  const catalogo: Record<string, EntradaEmblema> = {};
  for (const [id, datos] of Object.entries(bruto)) {
    if (id.startsWith("_")) continue;
    catalogo[id] = datos as EntradaEmblema;
  }
  cacheEmblemas = catalogo;
  return catalogo;
}

/** Paleta cerrada de colores de gremio. */
export function cargarPaletaColores(): string[] {
  if (cachePaleta) return cachePaleta;
  const datos = JSON.parse(fs.readFileSync(path.join(RUTA_CATALOGO_GREMIOS, "paletaColores.json"), "utf8")) as { colores: string[] };
  cachePaleta = datos.colores;
  return cachePaleta;
}

export const EMBLEMA_POR_DEFECTO = "emblema_generico";
export const NOMBRE_MIN = 3;
export const NOMBRE_MAX = 24;

export interface ResultadoValidacionGremio {
  ok: boolean;
  motivo?: string;
}

/** Nombre de gremio: 3-24 caracteres tras recortar espacios, sin más restricción de charset por ahora. */
export function nombreGremioValido(nombre: string): ResultadoValidacionGremio {
  const limpio = nombre.trim();
  if (limpio.length < NOMBRE_MIN || limpio.length > NOMBRE_MAX) {
    return { ok: false, motivo: `el nombre debe tener entre ${NOMBRE_MIN} y ${NOMBRE_MAX} caracteres` };
  }
  return { ok: true };
}

/** ¿Es un color de la paleta cerrada? Comparación case-insensitive sobre el hex. */
export function colorGremioValido(color: string): boolean {
  const paleta = cargarPaletaColores();
  return paleta.some((c) => c.toLowerCase() === color.toLowerCase());
}

/** ¿Es un emblema del catálogo cerrado? */
export function emblemaGremioValido(emblemaId: string): boolean {
  return emblemaId in cargarCatalogoEmblemas();
}

/** Color por defecto al fundar un gremio: el primero de la paleta (determinista, sin azar). */
export function colorPorDefecto(): string {
  return cargarPaletaColores()[0];
}
