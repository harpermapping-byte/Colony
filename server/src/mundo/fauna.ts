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
import { CatalogoCombateFauna, estadisticasCombatePorDefecto } from "./catalogoCombateFauna";

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
  id: string;
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
    // Vida/ataque (docs/GDD_Mecanicas.md §5.4) — opcional, con relleno
    // seguro si no se pasa (no rompe a quien instanciaba esto antes de
    // que existiera combate). Esta fauna doméstica no persiste vida
    // individual: mismo criterio ya decidido de que solo la salvaje
    // persiste (docs/GDD_Agentes_Moviles.md, "Domésticos... pendiente").
    private catalogoCombate: CatalogoCombateFauna = {},
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
      const combate = this.catalogoCombate[s.especieId] ?? estadisticasCombatePorDefecto();
      esquema.vida = combate.vidaMaxima;
      esquema.vidaMax = combate.vidaMaxima;
      esquema.ataque = combate.ataque;
      this.salida.set(s.id, esquema);
      this.animales.push({
        id: s.id,
        spawn: { x: s.x, y: s.y },
        radio: s.radio,
        esquema,
        destino: null,
        pausaRestante: 1 + Math.random() * 3,
      });
    }
  }

  /**
   * Saca un individuo del merodeo (docs/GDD_Mascotas.md — domesticado tras
   * 5x "dar de comer"): deja de tickearse Y desaparece del Schema, quien
   * llama es responsable de darle su nueva vida (mascota siguiendo al
   * jugador, otro Schema aparte). `false` si el id no existe (ya se quitó,
   * o nunca fue un spawn de esta room).
   */
  quitar(id: string): boolean {
    const idx = this.animales.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.animales.splice(idx, 1);
    this.salida.delete(id);
    return true;
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
