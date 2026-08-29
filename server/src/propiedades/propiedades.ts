/**
 * Propiedades comerciales — lógica PURA (sin Colyseus/BD), mismo patrón que
 * gremios.ts/construccion.ts. Pedido 2026-08-29: comprar/alquilar inmuebles
 * enteros (vivienda/tienda) en el asentamiento y habitaciones sueltas de
 * taberna/posada, con Farycoins. docs/GDD_Propiedades.md es el contrato.
 *
 * Precio por RIQUEZA del edificio (catálogo `precios_propiedad.json`), no un
 * número suelto por cada entrada de tipos_edificio.json — evita duplicar 40+
 * valores cuando la riqueza ya es la señal real de coste (regla 7 CLAUDE.md:
 * "los catálogos mandan").
 */

import * as path from "node:path";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const CARPETA_CATALOGO_INTERIORES = path.join(RAIZ_REPO, "interiores", "catalogo");

interface EntradaTipoEdificio {
  riqueza?: "humilde" | "modesta" | "noble";
  ventaJugador?: boolean;
  salasAlquilables?: boolean;
}

interface PrecioTenencia {
  compra: number | null;
  alquilerPeriodo: number;
  periodoHoras: number;
}

interface CatalogoPrecios {
  porRiqueza: Record<string, PrecioTenencia>;
  habitacion: Record<string, PrecioTenencia>;
}

function leerCatalogo<T>(carpeta: string, nombre: string): T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(carpeta, nombre)) as T;
}

let cacheTiposEdificio: Record<string, EntradaTipoEdificio> | null = null;
let cachePrecios: CatalogoPrecios | null = null;

function cargarTiposEdificio(): Record<string, EntradaTipoEdificio> {
  if (cacheTiposEdificio) return cacheTiposEdificio;
  const catalogo = leerCatalogo<Record<string, EntradaTipoEdificio>>(CARPETA_CATALOGO_INTERIORES, "tipos_edificio.json");
  cacheTiposEdificio = catalogo;
  return catalogo;
}

export function cargarPreciosPropiedad(): CatalogoPrecios {
  if (cachePrecios) return cachePrecios;
  const catalogo = leerCatalogo<CatalogoPrecios>(CARPETA_CATALOGO_INTERIORES, "precios_propiedad.json");
  cachePrecios = catalogo;
  return catalogo;
}

/** ¿Este tipo de edificio puede venderse/alquilarse ENTERO a un jugador? (`ventaJugador: true` en el catálogo) */
export function ventaJugadorPermitida(tipoEdificioId: string): boolean {
  return cargarTiposEdificio()[tipoEdificioId]?.ventaJugador === true;
}

/** ¿Este tipo de edificio (taberna/posada) alquila habitaciones sueltas? (`salasAlquilables: true` en el catálogo) */
export function salasAlquilablesPermitidas(tipoEdificioId: string): boolean {
  return cargarTiposEdificio()[tipoEdificioId]?.salasAlquilables === true;
}

function riquezaDe(tipoEdificioId: string): string {
  return cargarTiposEdificio()[tipoEdificioId]?.riqueza ?? "modesta";
}

/** Precio de compra/alquiler de un inmueble ENTERO, por la riqueza de su tipo de edificio. `null` si ese modo no está a la venta (p.ej. compra de dormitorio comunal). */
export function precioInmueble(tipoEdificioId: string, modo: "compra" | "alquiler"): { precio: number; periodoHoras: number | null } | null {
  const precios = cargarPreciosPropiedad().porRiqueza[riquezaDe(tipoEdificioId)];
  if (!precios) return null;
  if (modo === "compra") return precios.compra == null ? null : { precio: precios.compra, periodoHoras: null };
  return { precio: precios.alquilerPeriodo, periodoHoras: precios.periodoHoras };
}

/** Precio de compra/alquiler de una HABITACIÓN suelta, por su tipoSalaId (dormitorio_individual/dormitorio_comunal). */
export function precioHabitacion(tipoSalaId: string, modo: "compra" | "alquiler"): { precio: number; periodoHoras: number | null } | null {
  const precios = cargarPreciosPropiedad().habitacion[tipoSalaId];
  if (!precios) return null;
  if (modo === "compra") return precios.compra == null ? null : { precio: precios.compra, periodoHoras: null };
  return { precio: precios.alquilerPeriodo, periodoHoras: precios.periodoHoras };
}
