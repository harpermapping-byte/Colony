/**
 * Caché de PROCESO de gremios — mismo molde que ContextoConstruccion
 * (server/src/construccion/construccion.ts) y bdCompartida.ts: se carga UNA
 * vez leyendo la BD (dataset pequeño, cientos de filas como mucho) y cada
 * mensaje `gremio:*` es el ÚNICO punto que la muta, en el mismo instante en
 * que escribe a BD — cero setInterval, cero refresco periódico. Compartida
 * por las 4 rooms (Hub/Región/Interior/Mazmorra vía RoomExteriorBase), así
 * que un gremio fundado en una región lo ve de inmediato cualquier otra room
 * del mismo proceso.
 */
import { Gremio, GremioMiembro, IAlmacenDatos, RolGremio } from "../datos/bd";

export interface GremioVivo {
  id: number;
  nombre: string;
  liderJugadorId: number;
  color: string;
  emblemaId: string;
  saldoBanco: number;
  /** jugadorId -> rol */
  miembros: Map<number, RolGremio>;
}

export interface ContextoGremios {
  porId: Map<number, GremioVivo>;
  /** jugadorId -> gremioId, índice de pertenencia O(1) (un jugador, un gremio como mucho) */
  porJugador: Map<number, number>;
  /** nombreLower -> gremioId, para comprobar unicidad sin tocar BD */
  porNombreLower: Map<string, number>;
}

function gremioAVivo(g: Gremio, miembros: GremioMiembro[]): GremioVivo {
  return {
    id: g.id,
    nombre: g.nombre,
    liderJugadorId: g.liderJugadorId,
    color: g.color,
    emblemaId: g.emblemaId,
    saldoBanco: g.saldoBanco,
    miembros: new Map(miembros.map((m) => [m.jugadorId, m.rol])),
  };
}

async function construir(bd: IAlmacenDatos): Promise<ContextoGremios> {
  const ctx: ContextoGremios = { porId: new Map(), porJugador: new Map(), porNombreLower: new Map() };
  for (const g of await bd.listarGremios()) {
    const miembros = await bd.listarMiembros(g.id);
    ctx.porId.set(g.id, gremioAVivo(g, miembros));
    ctx.porNombreLower.set(g.nombre.toLowerCase(), g.id);
    for (const m of miembros) ctx.porJugador.set(m.jugadorId, g.id);
  }
  return ctx;
}

let promesa: Promise<ContextoGremios> | null = null;

/** Memoizada a nivel de proceso — la primera llamada construye desde BD, las siguientes devuelven la MISMA caché ya mutada por mensajes anteriores. */
export function obtenerContextoGremios(bd: IAlmacenDatos): Promise<ContextoGremios> {
  if (!promesa) promesa = construir(bd);
  return promesa;
}

/** SOLO para tests: resetea la caché de proceso para que el siguiente obtenerContextoGremios() reconstruya desde BD. */
export function _resetContextoGremiosParaTests(): void {
  promesa = null;
}
