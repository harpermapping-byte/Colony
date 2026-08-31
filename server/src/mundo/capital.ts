/**
 * Nombre de la ciudad capital, editable por el jarl (docs/GDD_Ciudad_Capital.md,
 * pedido 2026-08-31: "el jarl puede cambiar el nombre de la ciudad capital
 * inicial a su gusto"). MISMO patrón exacto que `mundo/pvp.ts` (interruptor
 * global): un único valor en memoria por proceso, respaldado en la tabla
 * genérica `configuracion_mundo` para que sobreviva a un reinicio — se
 * carga UNA vez al arrancar (`index.ts`). Vacío = sin override, se usa el
 * nombre que trae baked el `indice.json` del asentamiento `capital_jarl`.
 */
import { IAlmacenDatos } from "../datos/bd";

const CLAVE_NOMBRE_CAPITAL = "nombre_capital";
export const LONGITUD_MAXIMA_NOMBRE_CAPITAL = 60;

let nombreOverride = ""; // "" = sin renombrar, usa el nombre baked

/** "" si el jarl nunca la renombró — quien llama decide el nombre baked por defecto en ese caso. */
export function nombreCapitalOverride(): string {
  return nombreOverride;
}

/** UNA vez al arrancar el proceso (index.ts) — lee el último nombre que dejó el jarl. */
export async function cargarNombreCapitalDesdeBd(bd: IAlmacenDatos): Promise<void> {
  nombreOverride = (await bd.obtenerConfigMundo(CLAVE_NOMBRE_CAPITAL)) || "";
}

/** El jarl renombra la capital (mensaje `admin:capital:renombrar`, jarl-only) — persiste Y actualiza la memoria al instante. */
export async function fijarNombreCapital(bd: IAlmacenDatos, nombre: string): Promise<void> {
  nombreOverride = nombre;
  await bd.fijarConfigMundo(CLAVE_NOMBRE_CAPITAL, nombre);
}

/** SOLO para tests: fuerza el valor en memoria sin tocar BD. */
export function _fijarNombreCapitalParaTests(nombre: string): void {
  nombreOverride = nombre;
}
