/**
 * El CUERPO de los agentes móviles (GDD_Agentes_Moviles.md): un autómata
 * QUIETO/VIAJANDO que recorre polilíneas bakeadas y publica su posición en
 * el estado Colyseus. El cerebro v1 es la RUTINA horaria del bake de
 * poblacion/ (tramo activo por hora del reloj de mundo); merodeo (fauna) y
 * patrulla (bárbaros) llegarán como cerebros nuevos sobre este mismo
 * cuerpo.
 *
 * Reglas duras aplicadas aquí:
 * - Nada de A* en vivo: si el camino bakeado falta, TELEPORT al destino y
 *   un aviso en el log (raro y depurable > pathfinder en el tick).
 * - Estado derivable: al crear la room cada NPC nace YA donde le toca por
 *   la hora — no se persiste nada entre vidas de la room.
 */
import { MapSchema } from "@colyseus/schema";
import { Npc } from "../rooms/schema/HubState";

export interface Punto {
  x: number;
  y: number;
}

export interface ParadaRuta extends Punto {
  camino?: Punto[] | null; // ruta bakeada DESDE la parada anterior (la 0 cierra el bucle desde la última)
}

export interface TramoRutina {
  lugar: string;
  accion: string;
  horaInicio: number;
  horaFin: number;
  punto: Punto | null;
  camino?: Punto[] | null; // ruta bakeada DESDE el punto del tramo anterior
  // rondas/deambular (GDD_Agentes_Moviles.md): el agente recorre estas
  // paradas EN BUCLE durante todo el tramo, con una pausa corta en cada una
  paradas?: ParadaRuta[];
}

export interface NpcBakeado {
  slotId: string;
  nombre: string;
  grito?: string; // frase de calle de los especiales (poblacion/catalogo/especiales.json)
  velocidad?: number; // multiplicador de VEL_NPC (el "corredor" especial) — undefined = 1
  rutina: TramoRutina[];
}

// Más lento que el jugador (VEL_ANDAR 3.75): los NPC pasean, no compiten.
const VEL_NPC = 1.9;

// Un agente se ve salvo cuando está BAJO TECHO: en su casa, o durmiendo en
// el edificio donde le tocó (el guardia en el cuartel, el cura en el templo
// — la cadena "duerme donde trabaja" de generarRutina). "dormir_calle" del
// vagabundo NO es dormir bajo techo: se queda visible, que es su gracia.
function visibleEn(tramo: TramoRutina): boolean {
  return tramo.lugar !== "casa" && tramo.accion !== "dormir";
}

interface EstadoAgente {
  npc: NpcBakeado;
  esquema: Npc;
  tramoActivo: number;
  camino: Punto[] | null; // polilínea restante si está VIAJANDO
  segmento: number;
  paradaActual: number; // índice dentro de tramo.paradas cuando el tramo es un bucle
  pausaRestante: number; // segundos quieto en la parada antes de seguir la ronda
}

// Pausa en cada parada de una ronda/deambular: suficiente para "estar" en
// el sitio (vigilar la esquina, vocear la mercancía) sin parecer una estatua.
const PAUSA_PARADA_SEG = 7;

/** Índice del tramo que manda a esta hora (o -1 si la rutina está vacía). */
export function tramoActivoPorHora(rutina: TramoRutina[], hora: number): number {
  if (!rutina.length) return -1;
  for (let i = 0; i < rutina.length; i++) {
    const { horaInicio, horaFin } = rutina[i];
    // un tramo puede cruzar la medianoche (dormir 22-6, turno de guardia
    // 19-7): fin < inicio significa [inicio,24)∪[0,fin)
    const dentro = horaFin >= horaInicio ? hora >= horaInicio && hora < horaFin : hora >= horaInicio || hora < horaFin;
    if (dentro) return i;
  }
  // fuera de todo tramo (huecos del perfil): sigue vigente el último tramo
  // empezado; antes del primero del día, el último de ayer (el final)
  let ultimo = rutina.length - 1;
  for (let i = rutina.length - 1; i >= 0; i--) {
    if (rutina[i].horaInicio <= hora) {
      ultimo = i;
      break;
    }
  }
  return ultimo;
}

export class GestorAgentes {
  private agentes: EstadoAgente[] = [];

  constructor(private salida: MapSchema<Npc>) {}

  /** Crea los agentes recolocados según la hora actual (regla de estado derivable). */
  iniciar(npcs: NpcBakeado[], hora: number) {
    for (const npc of npcs) {
      const i = tramoActivoPorHora(npc.rutina, hora);
      if (i < 0 || !npc.rutina[i].punto) continue; // sin rutina/punto: no sale al mapa
      const tramo = npc.rutina[i];
      const esquema = new Npc();
      esquema.x = tramo.punto!.x + 0.5;
      esquema.y = tramo.punto!.y + 0.5;
      esquema.nombre = npc.nombre;
      esquema.grito = npc.grito ?? "";
      esquema.accion = tramo.accion;
      esquema.visible = visibleEn(tramo);
      this.salida.set(npc.slotId, esquema);
      this.agentes.push({ npc, esquema, tramoActivo: i, camino: null, segmento: 0, paradaActual: 0, pausaRestante: PAUSA_PARADA_SEG });
    }
  }

  /** Un paso de simulación: cambios de tramo por hora + avance de los que viajan + bucles de ronda. */
  tick(dt: number, hora: number) {
    for (const a of this.agentes) {
      const i = tramoActivoPorHora(a.npc.rutina, hora);
      if (i !== a.tramoActivo) this.cambiarTramo(a, i);
      if (a.camino) {
        this.avanzar(a, dt);
        continue;
      }
      // QUIETO en un tramo con paradas: agotar la pausa y seguir la ronda
      const tramo = a.npc.rutina[a.tramoActivo];
      if (tramo?.paradas && tramo.paradas.length >= 2) {
        a.pausaRestante -= dt;
        if (a.pausaRestante <= 0) this.siguienteParada(a, tramo);
      }
    }
  }

  /** Arranca el viaje hacia la siguiente parada del bucle (su camino viene bakeado). */
  private siguienteParada(a: EstadoAgente, tramo: TramoRutina) {
    const paradas = tramo.paradas!;
    a.paradaActual = (a.paradaActual + 1) % paradas.length;
    const destino = paradas[a.paradaActual];
    a.pausaRestante = PAUSA_PARADA_SEG;
    if (destino.camino && destino.camino.length >= 2) {
      a.camino = destino.camino;
      a.segmento = 0;
    } else {
      // sin camino entre paradas (regla dura: nunca A* en vivo): teleport
      a.esquema.x = destino.x + 0.5;
      a.esquema.y = destino.y + 0.5;
    }
  }

  private cambiarTramo(a: EstadoAgente, i: number) {
    a.tramoActivo = i;
    a.paradaActual = 0;
    a.pausaRestante = PAUSA_PARADA_SEG;
    const tramo = a.npc.rutina[i];
    if (!tramo?.punto) return;
    a.esquema.accion = tramo.accion;
    // al ponerse en marcha vuelve a verse aunque viniera de casa; la
    // visibilidad del DESTINO se aplica al llegar (ver avanzar)
    const camino = tramo.camino;
    if (camino && camino.length >= 2) {
      a.camino = camino;
      a.segmento = 0;
      a.esquema.visible = true;
      // si el agente no está donde arranca el camino (rutina con huecos,
      // room recién creada a mitad de tramo), se recoloca al inicio
      const d0 = Math.hypot(camino[0].x + 0.5 - a.esquema.x, camino[0].y + 0.5 - a.esquema.y);
      if (d0 > 2) {
        a.esquema.x = camino[0].x + 0.5;
        a.esquema.y = camino[0].y + 0.5;
      }
    } else {
      // sin camino bakeado: teleport (regla dura — nunca A* en vivo)
      if (camino !== null && camino !== undefined) {
        console.warn(`agente ${a.npc.slotId}: camino bakeado inválido hacia "${tramo.lugar}" — teleport`);
      }
      a.camino = null;
      a.esquema.x = tramo.punto.x + 0.5;
      a.esquema.y = tramo.punto.y + 0.5;
      a.esquema.visible = visibleEn(tramo);
    }
  }

  private avanzar(a: EstadoAgente, dt: number) {
    let restante = VEL_NPC * (a.npc.velocidad ?? 1) * dt;
    const camino = a.camino!;
    while (restante > 0 && a.segmento < camino.length) {
      const objetivo = camino[a.segmento];
      const dx = objetivo.x + 0.5 - a.esquema.x;
      const dy = objetivo.y + 0.5 - a.esquema.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= restante) {
        a.esquema.x = objetivo.x + 0.5;
        a.esquema.y = objetivo.y + 0.5;
        restante -= dist;
        a.segmento++;
      } else {
        a.esquema.x += (dx / dist) * restante;
        a.esquema.y += (dy / dist) * restante;
        restante = 0;
      }
    }
    if (a.segmento >= camino.length) {
      // llegada: QUIETO en el punto del tramo, con su visibilidad real
      a.camino = null;
      const tramo = a.npc.rutina[a.tramoActivo];
      a.esquema.visible = visibleEn(tramo);
    }
  }

  get cantidad() {
    return this.agentes.length;
  }
}
