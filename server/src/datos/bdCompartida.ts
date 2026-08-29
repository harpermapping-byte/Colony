/**
 * Una única instancia de IAlmacenDatos por PROCESO — antes cada sitio abría
 * la suya (HubRoom.iniciarConstruccion, RegionRoom para la facción bandida,
 * DungeonRoom para el cooldown de mazmorra, el tick de economía en
 * index.ts): con Postgres/Neon eso es un Pool nuevo por cada uno, y con
 * construcción-en-regiones (RegionRoom de la ciudad capital, ver
 * docs/GDD_Construccion.md) cada aldea/edificio visitado abriría el suyo —
 * riesgo real de agotar las conexiones del free tier (regla 4 CLAUDE.md,
 * "optimizado para gratis"). Memoiza la promesa: la primera llamada crea el
 * almacén, todas las siguientes devuelven la MISMA instancia ya lista.
 */
import { crearAlmacenDatos, IAlmacenDatos } from "./bd";

let promesa: Promise<IAlmacenDatos> | null = null;

export function obtenerBdCompartida(): Promise<IAlmacenDatos> {
  if (!promesa) promesa = crearAlmacenDatos();
  return promesa;
}
