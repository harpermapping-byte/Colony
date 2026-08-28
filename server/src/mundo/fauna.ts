/**
 * Fauna doméstica urbana (GDD_Agentes_Moviles.md v1.3, pedido del streamer
 * 2026-08-28): gallinas, alguna vaca suelta, perros, gatos, algún gallo —
 * cerebro de MERODEO simple (el que quedó pendiente en el diseño
 * original): sin rutina horaria, sin censo, sin caminos bakeados. Cada
 * animal alterna QUIETO (comer/sentarse/jugar/dormir, una pausa al azar) y
 * CAMINANDO en línea recta a un punto al azar dentro de su radio de
 * merodeo — si la línea no es transitable se prueba otro punto; nunca A*.
 *
 * A diferencia de los NPC, esto es comportamiento AMBIENTAL en vivo, no
 * datos bakeados: usa Math.random() a propósito (no hay nada que
 * determinismo por semilla deba reproducir aquí — solo dónde APARECE cada
 * animal es determinista, eso lo decide ciudades/src/fauna.js al hornear).
 */
import { MapSchema } from "@colyseus/schema";
import { Fauna } from "../rooms/schema/HubState";
import { MundoColision, TIPO } from "./colisiones";

export interface FaunaSpawn {
  id: string;
  especieId: string;
  x: number;
  y: number;
  radio: number;
}

const VEL_FAUNA = 1.1; // más lenta que un NPC — los animales pasean, no van a ningún sitio
const ACCIONES_IDLE = ["comer", "sentarse", "jugar", "dormir"];

interface EstadoFauna {
  spawn: { x: number; y: number };
  radio: number;
  esquema: Fauna;
  destino: { x: number; y: number } | null;
  pausaRestante: number;
}

function transitable(mundo: MundoColision, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= mundo.ancho || yi >= mundo.alto) return false;
  return mundo.casillas[yi * mundo.ancho + xi] !== TIPO.SOLIDO;
}

function accionIdleAlAzar(): string {
  return ACCIONES_IDLE[Math.floor(Math.random() * ACCIONES_IDLE.length)];
}

export class GestorFauna {
  private animales: EstadoFauna[] = [];

  constructor(
    private salida: MapSchema<Fauna>,
    private mundo: MundoColision,
  ) {}

  iniciar(spawns: FaunaSpawn[]) {
    for (const s of spawns) {
      // el spawn cayó en un sólido tras rebakear el asentamiento: se
      // descarta en vez de aparecer dentro de una pared — no rompe nada
      if (!transitable(this.mundo, s.x, s.y)) continue;
      const esquema = new Fauna();
      esquema.x = s.x + 0.5;
      esquema.y = s.y + 0.5;
      esquema.especieId = s.especieId;
      esquema.accion = accionIdleAlAzar();
      this.salida.set(s.id, esquema);
      this.animales.push({
        spawn: { x: s.x, y: s.y },
        radio: s.radio,
        esquema,
        destino: null,
        pausaRestante: 1 + Math.random() * 3,
      });
    }
  }

  tick(dt: number) {
    for (const a of this.animales) {
      if (a.destino) {
        this.avanzarHaciaDestino(a, dt);
        continue;
      }
      a.pausaRestante -= dt;
      if (a.pausaRestante > 0) continue;
      const destino = this.elegirDestino(a);
      if (destino) {
        a.destino = destino;
        a.esquema.accion = "caminar";
      } else {
        // 6 intentos sin encontrar un punto transitable (radio muy
        // pequeño/atascado): otra pausa idle en vez de insistir cada frame
        a.pausaRestante = 2;
        a.esquema.accion = accionIdleAlAzar();
      }
    }
  }

  private elegirDestino(a: EstadoFauna): { x: number; y: number } | null {
    for (let intento = 0; intento < 6; intento++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * a.radio;
      const cx = a.spawn.x + Math.cos(ang) * dist;
      const cy = a.spawn.y + Math.sin(ang) * dist;
      if (transitable(this.mundo, cx, cy)) return { x: cx + 0.5, y: cy + 0.5 };
    }
    return null;
  }

  private avanzarHaciaDestino(a: EstadoFauna, dt: number) {
    const dx = a.destino!.x - a.esquema.x;
    const dy = a.destino!.y - a.esquema.y;
    const dist = Math.hypot(dx, dy);
    const paso = VEL_FAUNA * dt;
    if (dist <= paso) {
      a.esquema.x = a.destino!.x;
      a.esquema.y = a.destino!.y;
      a.destino = null;
      a.pausaRestante = 2 + Math.random() * 4;
      a.esquema.accion = accionIdleAlAzar();
    } else {
      a.esquema.x += (dx / dist) * paso;
      a.esquema.y += (dy / dist) * paso;
    }
  }

  get cantidad() {
    return this.animales.length;
  }
}
