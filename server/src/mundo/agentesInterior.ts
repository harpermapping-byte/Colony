/**
 * Vida en interiores (GDD_Agentes_Moviles.md v1.2/v1.3, pedido del
 * streamer 2026-08-28): cuando un jugador entra a un edificio, los NPCs
 * cuya rutina dice "estoy AQUÍ, en ESTA sala, a esta hora" aparecen de
 * verdad — casa (la familia socializando en el salón sale gratis: viven
 * en el mismo edificio, sus rutinas caen en franjas horarias parecidas) o
 * trabajo (el tendero vendiendo en su tienda de verdad, no solo en la
 * puerta).
 *
 * Deliberadamente QUIETO, sin caminar entre salas — las habitaciones son
 * pequeñas y la regla dura sigue siendo "nunca A* en vivo"; caminar de
 * verdad dentro de casa es un pulido futuro (ver GDD, "Qué falta"). Un
 * cambio de sala se resuelve igual que el resto del sistema: teleport a
 * la nueva sala.
 *
 * "No se apelotonen" (v1.3): cada sala trae VARIOS puntos pisables
 * (interiorColision.ts) y aquí se reparten por turno rotatorio — dos NPCs
 * de la MISMA sala nunca comparten literalmente la misma casilla, salvo
 * que haya más NPCs que puntos (entonces se repite el ciclo, con un
 * jitter mínimo de desempate).
 */
import { MapSchema } from "@colyseus/schema";
import { Npc } from "../rooms/schema/HubState";
import { TramoRutina, tramoActivoPorHora } from "./agentes";
import { InteriorCargado } from "./interiorColision";

// Jitter determinista por NPC (hash simple de su slotId): SOLO entra en
// juego si el ciclo de puntos de la sala se repite (más NPCs que puntos
// distintos) — así ni siquiera los que comparten punto por falta de sitio
// quedan exactamente apilados.
function jitterDe(slotId: string): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < slotId.length; i++) h = (h * 31 + slotId.charCodeAt(i)) >>> 0;
  const a = ((h % 1000) / 1000) * Math.PI * 2;
  const r = 0.1 + (((h >>> 8) % 1000) / 1000) * 0.12;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

export interface NpcConCasa {
  slotId: string;
  nombre: string;
  grito?: string;
  casaEdificioId?: string | null; // edificio (interior) donde "vive" — poblacion/src/generarRutina.js
  trabajoEdificioId?: string | null; // edificio (interior) donde "trabaja" — ídem
  rutina: TramoRutina[];
}

/**
 * Reconstruye qué NPCs de `candidatos` están DENTRO de `edificioId` planta
 * `nivel` a la `hora` dada (en casa o en su trabajo — el que caiga en ESTE
 * edificio), y los escribe en `salida` (state.npcs de la InteriorRoom). Se
 * llama al crear la room y cada vez que puede haber cambiado el tramo
 * activo (InteriorRoom la re-ejecuta con un intervalo bajo).
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
  // reparto sin repetir casilla: un contador por tipoSalaId, incrementado
  // cada vez que se coloca a alguien ahí en ESTA pasada
  const turnoPorSala = new Map<string, number>();
  for (const npc of candidatos) {
    const enCasa = npc.casaEdificioId === edificioId;
    const enTrabajo = npc.trabajoEdificioId === edificioId;
    if (!enCasa && !enTrabajo) continue;
    const i = tramoActivoPorHora(npc.rutina, hora);
    if (i < 0) continue;
    const tramo = npc.rutina[i];
    // el tramo activo tiene que coincidir con el motivo por el que este
    // NPC podría estar AQUÍ (en casa si es su vivienda, trabajando si es
    // su tienda/taller) — un tramo con otro `lugar` ya se ve fuera, en la
    // puerta/ronda que resuelve el agente exterior (RegionRoom)
    const encaja = (tramo.lugar === "casa" && enCasa) || (tramo.lugar === "trabajo" && enTrabajo);
    if (!encaja) continue;
    const planta = tramo.sala?.planta ?? 0;
    if (planta !== nivel) continue;

    const puntos = tramo.sala ? interior.salasPorTipo.get(tramo.sala.tipoSalaId) : undefined;
    let punto: { x: number; y: number };
    if (puntos && puntos.length > 0) {
      const clave = tramo.sala!.tipoSalaId;
      const turno = turnoPorSala.get(clave) ?? 0;
      turnoPorSala.set(clave, turno + 1);
      punto = puntos[turno % puntos.length];
    } else {
      punto = { x: interior.spawnX - 0.5, y: interior.spawnY - 0.5 };
    }

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
