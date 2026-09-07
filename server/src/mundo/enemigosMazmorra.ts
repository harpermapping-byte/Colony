/**
 * Movimiento de enemigos de mazmorra (docs/GDD_Combate.md §4bis, pedido
 * streamer 2026-09-07: "los enemigos pues moverse correr pelearse morir
 * cosas asi que tengan uso y aplicacion") — hasta ahora un `Enemigo`
 * aparecía QUIETO en su punto para siempre (comentario explícito en
 * `HubState.ts::Enemigo`, "sin movimiento/combate todavía"; combate ya se
 * cerró en una pasada anterior, aquí se cierra el movimiento). MISMO
 * patrón EXACTO que `GestorFauna` (mundo/fauna.ts): merodeo en línea recta
 * alrededor del punto de spawn, sin A* (regla dura del proyecto, ver
 * agentes.ts) — la persecución/combate de verdad la sigue disparando
 * `RoomExteriorBase.verificarAgroFauna` (extendido para leer también
 * `state.enemigos`, radio fijo — a diferencia de la fauna, un enemigo de
 * mazmorra SIEMPRE es hostil, no hay concepto de "enemigo pacífico"), el
 * mismo mecanismo ya usado para fauna peligrosa/patrullas bandidas: cuando
 * un jugador entra en su radio se abre un combate en arena, exactamente
 * igual que cualquier otro combate del juego.
 */
import { MapSchema } from "@colyseus/schema";
import { Enemigo } from "../rooms/schema/HubState";
import { MundoColision, TIPO } from "./colisiones";

const VEL_ENEMIGO = 1.2; // similar a VEL_FAUNA (fauna.ts) — un enemigo patrullando, no corriendo hacia nadie todavía (eso lo dispara el agro, no el merodeo)
const RADIO_MERODEO = 4; // casillas alrededor del spawn — mazmorras tienen salas/pasillos estrechos, un radio grande sacaría al enemigo de su sala

interface EstadoEnemigo {
  id: string;
  spawn: { x: number; y: number };
  esquema: Enemigo;
  destino: { x: number; y: number } | null;
  pausaRestante: number;
}

function transitable(mundo: MundoColision, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= mundo.ancho || yi >= mundo.alto) return false;
  return mundo.casillas[yi * mundo.ancho + xi] !== TIPO.SOLIDO;
}

export class GestorEnemigosMazmorra {
  private enemigos: EstadoEnemigo[] = [];

  constructor(
    private salida: MapSchema<Enemigo>,
    private mundo: MundoColision,
  ) {}

  /** Registra los enemigos YA colocados por `DungeonRoom.poblarEnemigos` (mismo `Enemigo`/misma clave en `salida`) — no crea nada nuevo, solo empieza a tickearlos. */
  registrarExistentes() {
    this.salida.forEach((esquema, id) => {
      this.enemigos.push({
        id,
        spawn: { x: esquema.x, y: esquema.y },
        esquema,
        destino: null,
        pausaRestante: 1 + Math.random() * 4,
      });
    });
  }

  /** Deja de tickear un enemigo muerto (llamar desde `finalizarMuerte`, antes o después de borrarlo del Schema — aquí solo se limpia la lista propia). */
  quitar(id: string): void {
    const idx = this.enemigos.findIndex((e) => e.id === id);
    if (idx !== -1) this.enemigos.splice(idx, 1);
  }

  tick(dt: number) {
    for (const e of this.enemigos) {
      if (e.destino) {
        this.avanzarHaciaDestino(e, dt);
        continue;
      }
      e.pausaRestante -= dt;
      if (e.pausaRestante > 0) continue;
      const destino = this.elegirDestino(e);
      if (destino) {
        e.destino = destino;
      } else {
        e.pausaRestante = 2; // 6 intentos sin punto transitable (sala pequeña/atascado): otra pausa en vez de insistir cada frame
      }
    }
  }

  private elegirDestino(e: EstadoEnemigo): { x: number; y: number } | null {
    for (let intento = 0; intento < 6; intento++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * RADIO_MERODEO;
      const cx = e.spawn.x + Math.cos(ang) * dist;
      const cy = e.spawn.y + Math.sin(ang) * dist;
      if (transitable(this.mundo, cx, cy)) return { x: cx, y: cy };
    }
    return null;
  }

  private avanzarHaciaDestino(e: EstadoEnemigo, dt: number) {
    const dx = e.destino!.x - e.esquema.x;
    const dy = e.destino!.y - e.esquema.y;
    const dist = Math.hypot(dx, dy);
    const paso = VEL_ENEMIGO * dt;
    if (dist <= paso) {
      e.esquema.x = e.destino!.x;
      e.esquema.y = e.destino!.y;
      e.destino = null;
      e.pausaRestante = 2 + Math.random() * 4;
    } else {
      e.esquema.x += (dx / dist) * paso;
      e.esquema.y += (dy / dist) * paso;
    }
  }
}
