/**
 * Interruptor GLOBAL de PvP (docs/GDD_PvP.md, pedido 2026-08-30: "esta
 * opción la habilitará el jarl, inicialmente está deshabilitada"). Un único
 * valor en memoria por proceso (mismo criterio que `enDirecto` de Twitch),
 * respaldado en la tabla genérica `configuracion_mundo` para que sobreviva
 * a un reinicio del servidor — se carga UNA vez al arrancar (`index.ts`).
 */
import { IAlmacenDatos } from "../datos/bd";

const CLAVE_PVP = "pvp_habilitado";

let habilitado = false; // arranca SIEMPRE deshabilitado hasta cargar de BD (o si nunca se activó)

export function pvpGlobalHabilitado(): boolean {
  return habilitado;
}

/** UNA vez al arrancar el proceso (index.ts) — lee el último valor que dejó el jarl. */
export async function cargarPvpDesdeBd(bd: IAlmacenDatos): Promise<void> {
  habilitado = (await bd.obtenerConfigMundo(CLAVE_PVP)) === "1";
}

/** El jarl activa/desactiva PvP (mensaje `pvp:fijar`, jarl-only) — persiste Y actualiza la memoria al instante. */
export async function fijarPvpGlobal(bd: IAlmacenDatos, valor: boolean): Promise<void> {
  habilitado = valor;
  await bd.fijarConfigMundo(CLAVE_PVP, valor ? "1" : "0");
}

/** SOLO para tests: fuerza el valor en memoria sin tocar BD. */
export function _fijarPvpParaTests(valor: boolean): void {
  habilitado = valor;
}
