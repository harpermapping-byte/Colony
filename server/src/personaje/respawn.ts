/**
 * Dónde reaparece un jugador tras morir (docs/GDD_Muerte_Respawn.md, pedido
 * 2026-08-30): "respawneas en la cama de tu casa o propiedad, y si no en el
 * punto de spawn inicial". Busca una construcción `esCama:true` (mismo
 * campo de catálogo que ya usa "dormir en cama", docs/GDD_Personaje.md
 * §3.6) sobre CUALQUIER propiedad que sea suya — point-query directo a BD,
 * nunca en memoria de una Room concreta (el jugador puede morir en un sitio
 * y tener su casa en otro).
 *
 * Alcance de esta pasada: solo camas colocadas como CONSTRUCCIÓN real en
 * una parcela (`bd.listarConstrucciones`) — un inmueble comprado/alquilado
 * (docs/GDD_Propiedades.md) sin nada construido dentro no tiene cama que
 * encontrar todavía, cae al spawn inicial igual que si no tuviera propiedad.
 * Si la cama está en el mapa del Hub, respawnea en el spawn POR DEFECTO del
 * Hub (no hay mecanismo hoy para aparecer en un punto concreto del Hub,
 * a diferencia de una región) — limitación conocida, documentada.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { IAlmacenDatos } from "../datos/bd";
import { EntradaConstruible } from "../construccion/catalogo";

export type DestinoRespawn = { tipo: "hub" } | { tipo: "region"; mapaId: string; x: number; y: number };

/** Mismo criterio que HubRoom (RUTA_MAPA env, si no "principal" si existe en disco, si no "demo") — duplicado a propósito para no crear un import circular Room↔personaje. */
function idMapaHub(): string {
  if (process.env.RUTA_MAPA) return path.basename(process.env.RUTA_MAPA);
  const principal = path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "principal");
  return fs.existsSync(path.join(principal, "indice.json")) ? "principal" : "demo";
}

export async function resolverRespawn(
  bd: IAlmacenDatos,
  catalogoConstruible: Map<string, EntradaConstruible>,
  nombreJugador: string,
): Promise<DestinoRespawn> {
  const propiedades = await bd.cargarPropiedades();
  const misPropiedades = new Set(
    [...propiedades].filter(([, p]) => p.dueno?.toLowerCase() === nombreJugador.trim().toLowerCase()).map(([id]) => id),
  );
  if (misPropiedades.size === 0) return { tipo: "hub" };

  const construcciones = await bd.listarConstrucciones();
  const cama = construcciones.find((c) => misPropiedades.has(c.propiedad) && catalogoConstruible.get(c.objeto)?.esCama);
  if (!cama) return { tipo: "hub" };

  const propiedad = propiedades.get(cama.propiedad)!;
  if (propiedad.asentamiento === idMapaHub()) return { tipo: "hub" };
  return { tipo: "region", mapaId: propiedad.asentamiento, x: cama.x, y: cama.y };
}
