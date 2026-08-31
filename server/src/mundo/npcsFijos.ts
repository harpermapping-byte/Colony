/**
 * NPCs FIJOS plantados a mano por el admin (docs/GDD_Profesiones.md ronda 2,
 * pedido 2026-08-30: "un NPC plantado estáticamente en una zona de la
 * capital... el admin elige su zona exactamente... y ese no se mueve de
 * ahí") — a diferencia de los NPCs con rutina de `poblacion/` (que nacen
 * recolocados según la hora y se mueven por caminos bakeados), estos son
 * SIEMPRE el mismo punto, las 24 horas: se reusa TAL CUAL el mecanismo de
 * agentes.ts (un `NpcBakeado` con un único tramo `horaInicio:0,horaFin:24`,
 * `punto` fijo y sin `camino` — `GestorAgentes` ya lo trata como "quieto en
 * el sitio" sin código nuevo, ver `cambiarTramo()`).
 *
 * Catálogo hecho a mano por mapa, `assets/mapas/<mapaId>/npcsFijos.json`
 * (ausente = sin NPCs fijos en ese mapa, no rompe nada): mismo criterio que
 * el resto de catálogos de este proyecto ("el admin edita JSON, sin GUI
 * dedicada" — ver p.ej. los proyectos especiales del jarl). Solo EXTERIOR
 * por ahora (RegionRoom/HubRoom); interior queda sin diseñar (ver README de
 * esta ronda).
 */
import * as fs from "fs";
import * as path from "path";
import { NpcBakeado } from "./agentes";
import { NpcTutorialColocado } from "../datos/bd";

export interface NpcFijoCatalogo {
  slotId: string;
  nombre: string;
  /** oficio "plano" del NPC — p.ej. "maestro_oficios" (ronda 2), o "tendero" si se quisiera un vendedor fijo sin rutina. */
  oficio: string;
  x: number;
  y: number;
  /** frase de calle opcional, mismo campo que los NPCs de poblacion/ (Npc.grito) — "" u omitido = sin pregón fijo. */
  grito?: string;
}

/** Lee `npcsFijos.json` del mapa si existe; [] si no hay ninguno — nunca lanza. */
export function cargarNpcsFijos(rutaMapa: string): NpcBakeado[] {
  const ruta = path.join(rutaMapa, "npcsFijos.json");
  if (!fs.existsSync(ruta)) return [];
  const datos = JSON.parse(fs.readFileSync(ruta, "utf8")) as { npcs: NpcFijoCatalogo[] };
  return (datos.npcs ?? []).map((n) => ({
    slotId: n.slotId,
    nombre: n.nombre,
    grito: n.grito ?? "",
    oficio: n.oficio,
    rutina: [{ lugar: "plaza", accion: "trabajar", horaInicio: 0, horaFin: 24, punto: { x: n.x, y: n.y }, camino: null }],
  }));
}

// --- NPCs TUTORIAL (docs/GDD_Profesiones.md ronda 3, pedido 2026-08-30) ---
// "un NPC por cada mecánica... colocados a mano por el admin/superadmin en
// su posición actual, con un panel que designa qué NPC y dónde... se
// generan vestidos con nombre, se podrá hablar con ellos con texto
// predefinido (el texto en sí, pendiente de escribir todavía)".

export interface NpcTutorial {
  id: string; // tipoTutorial — clave estable, referenciada desde la BD (npcs_tutoriales.tipo_tutorial)
  /** Nombre real de poblacion/catalogo/nombres.json (ronda 3, pedido 2026-08-30: "todo NPC tira de esa lista") — lo que se ve en la etiqueta del NPC. */
  nombre: string;
  /** Rol de sabor que antes era el propio `nombre` ("Maestro de Oficios"...) — flavor, no viaja al cliente. */
  titulo?: string;
  /** qué mecánica explica — lo que enseñaría el "spawner" del admin al elegir cuál colocar. */
  mecanica: string;
  /** slot->itemId (items/catalogo/items.json), MISMO shape que InventarioSchema.equipo — se renderiza reusando equipoVisual.ts tal cual, cero pipeline nuevo. */
  equipo: Record<string, string>;
}

const RUTA_CATALOGO_TUTORIALES = path.join(__dirname, "..", "..", "..", "poblacion", "catalogo", "npcsTutoriales.json");
let catalogoTutorialesCache: Map<string, NpcTutorial> | null = null;

/** Catálogo completo de arquetipos de NPC tutorial — cacheado en memoria, releído solo si el proceso arranca de cero. */
export function cargarCatalogoNpcsTutoriales(): Map<string, NpcTutorial> {
  if (catalogoTutorialesCache) return catalogoTutorialesCache;
  const datos = JSON.parse(fs.readFileSync(RUTA_CATALOGO_TUTORIALES, "utf8")) as { npcs: NpcTutorial[] };
  catalogoTutorialesCache = new Map(datos.npcs.map((n) => [n.id, n]));
  return catalogoTutorialesCache;
}

/**
 * Convierte una fila de `npcs_tutoriales` (BD, persistida por el admin) en
 * el `NpcBakeado` que `GestorAgentes` sabe recolocar — mismo tramo único
 * 0-24h sin `camino` que `cargarNpcsFijos`, más `tipoTutorial`/`equipo` para
 * que salga vestido. `slotId` es estable (`tutorial_<id de fila>`) para que
 * quitar/recolocar no deje huérfanos en `state.npcs`.
 */
export function npcTutorialAAgente(fila: NpcTutorialColocado, catalogo: Map<string, NpcTutorial>): NpcBakeado | null {
  const arquetipo = catalogo.get(fila.tipoTutorial);
  if (!arquetipo) return null; // tipoTutorial ya no existe en el catálogo (se quitó del JSON) — no revienta, simplemente no sale
  return {
    slotId: `tutorial_${fila.id}`,
    nombre: fila.nombre,
    oficio: "npc_tutorial",
    tipoTutorial: fila.tipoTutorial,
    equipo: arquetipo.equipo,
    rutina: [{ lugar: "tutorial", accion: "trabajar", horaInicio: 0, horaFin: 24, punto: { x: fila.x, y: fila.y }, camino: null }],
  };
}

/** Todos los NPCs tutorial persistidos de un mapa, ya convertidos a NpcBakeado — filas cuyo tipoTutorial ya no existe en el catálogo se omiten en vez de reventar. */
export async function cargarNpcsTutorialesDeMapa(bd: { listarNpcsTutorialesDeMapa(mapaId: string): Promise<NpcTutorialColocado[]> }, mapaId: string): Promise<NpcBakeado[]> {
  const catalogo = cargarCatalogoNpcsTutoriales();
  const filas = await bd.listarNpcsTutorialesDeMapa(mapaId);
  const npcs: NpcBakeado[] = [];
  for (const fila of filas) {
    const npc = npcTutorialAAgente(fila, catalogo);
    if (npc) npcs.push(npc);
  }
  return npcs;
}
