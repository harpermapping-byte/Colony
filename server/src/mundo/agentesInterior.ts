/**
 * Vida en interiores (GDD_Agentes_Moviles.md v1.2, pedido del streamer
 * 2026-08-28): cuando un jugador entra a un edificio, los NPCs cuya rutina
 * dice "estoy en ESTA casa, en ESTA sala, a esta hora" aparecen ahí de
 * verdad — con eso la familia socializando en el salón sale gratis: viven
 * en el mismo edificio, sus rutinas caen en la misma franja horaria
 * (dormir de noche, comer a las mismas horas), así que coinciden solos.
 *
 * Deliberadamente QUIETO, sin caminar entre salas — las habitaciones son
 * pequeñas y la regla dura sigue siendo "nunca A* en vivo"; caminar de
 * verdad dentro de casa es un pulido futuro (ver GDD, "Qué falta"). Un
 * cambio de sala se resuelve igual que el resto del sistema: teleport a
 * la nueva sala.
 */
import { MapSchema } from "@colyseus/schema";
import { Npc } from "../rooms/schema/HubState";
import { TramoRutina, tramoActivoPorHora } from "./agentes";
import { InteriorCargado } from "./interiorColision";

// Jitter determinista por NPC (hash simple de su slotId): cuando varios
// comparten sala — la familia en el salón, o un dormitorio comunal con
// varios inquilinos por déficit de camas — no aparecen exactamente
// apilados en el mismo punto. Estable entre llamadas (mismo slotId, mismo
// desplazamiento), radio pequeño para no salirse de la sala.
function jitterDe(slotId: string): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < slotId.length; i++) h = (h * 31 + slotId.charCodeAt(i)) >>> 0;
  const a = ((h % 1000) / 1000) * Math.PI * 2;
  const r = 0.15 + (((h >>> 8) % 1000) / 1000) * 0.2;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

export interface NpcConCasa {
  slotId: string;
  nombre: string;
  grito?: string;
  casaEdificioId?: string | null; // edificio (interior) donde "vive" — poblacion/src/generarRutina.js
  rutina: TramoRutina[];
}

/**
 * Reconstruye qué NPCs de `candidatos` están DENTRO de `edificioId` planta
 * `nivel` a la `hora` dada, y los escribe en `salida` (state.npcs de la
 * InteriorRoom). Se llama al crear la room y cada vez que puede haber
 * cambiado el tramo activo (InteriorRoom la re-ejecuta con un intervalo
 * bajo — la población de una casa no necesita más).
 */
export function poblarInterior(
  salida: MapSchema<Npc>,
  candidatos: NpcConCasa[],
  edificioId: string,
  nivel: number,
  interior: InteriorCargado,
  hora: number,
) {
  const vistos = new Set<string>();
  for (const npc of candidatos) {
    if (npc.casaEdificioId !== edificioId) continue;
    const i = tramoActivoPorHora(npc.rutina, hora);
    if (i < 0) continue;
    const tramo = npc.rutina[i];
    // solo "en casa" — un tramo con lugar!=="casa" ya se ve fuera, en la
    // puerta/ronda que resuelve el agente exterior (RegionRoom)
    if (tramo.lugar !== "casa") continue;
    const planta = tramo.sala?.planta ?? 0;
    if (planta !== nivel) continue;

    const puntos = tramo.sala ? interior.salasPorTipo.get(tramo.sala.tipoSalaId) : undefined;
    const punto = puntos?.[0] ?? { x: interior.spawnX - 0.5, y: interior.spawnY - 0.5 };

    vistos.add(npc.slotId);
    let esquema = salida.get(npc.slotId);
    if (!esquema) {
      esquema = new Npc();
      esquema.nombre = npc.nombre;
      esquema.grito = npc.grito ?? "";
      salida.set(npc.slotId, esquema);
    }
    const j = jitterDe(npc.slotId);
    esquema.x = punto.x + 0.5 + j.dx;
    esquema.y = punto.y + 0.5 + j.dy;
    esquema.accion = tramo.accion;
    esquema.visible = true;
  }
  // quita a quien ya no toca estar aquí (cambió de tramo, o de planta)
  for (const slotId of [...salida.keys()]) {
    if (!vistos.has(slotId)) salida.delete(slotId);
  }
}
