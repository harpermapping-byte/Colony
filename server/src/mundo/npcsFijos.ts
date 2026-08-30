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
