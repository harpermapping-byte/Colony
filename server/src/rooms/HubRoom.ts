import { Room, Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { HubState, Player } from "./schema/HubState";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ } from "../mundo/colisiones";

// Velocidades en casillas/segundo (el terreno multiplica con su modVelocidad)
const VEL_ANDAR = 3.75;
const VEL_NADAR = 2.2;
const VEL_BUCEAR = 1.7;
const TICK_HZ = 30;

// El hub juega sobre el MAPA PRINCIPAL (assets/mapas/principal/) — mismo
// mapa que el cliente carga por streaming. Si no está en disco (repo
// parcial, entorno raro), se cae al demo para no tumbar el servidor; los
// tests unitarios siguen usando el demo a propósito (pequeño y rápido).
function rutaMapaHub(): string | undefined {
  if (process.env.RUTA_MAPA) return process.env.RUTA_MAPA;
  const principal = path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "principal");
  return fs.existsSync(path.join(principal, "indice.json")) ? principal : undefined;
}

interface Direction {
  x: number;
  y: number;
}

// Habitacion del Hub central: aqui viven todos los avatares del pueblo.
// Optimizada para plan gratuito: la simulacion corre a 30hz (barata en CPU),
// pero el estado solo se manda al cliente 15 veces/seg (patchRate) para
// ahorrar ancho de banda, y el input solo se recibe cuando cambia de
// direccion en vez de en cada frame.
//
// La simulación es AUTORITATIVA contra el mapa bakeado (mundo/mapaColision):
// sólidos con caja simple por casilla, agua como medio (nadar/bucear) y
// empuje suave entre PJ. Las reglas viven en docs/GDD_Mecanicas.md.
export class HubRoom extends Room<HubState> {
  maxClients = 40;
  private inputs = new Map<string, Direction>();
  private mapa!: MapaCargado;

  onCreate() {
    this.setState(new HubState());
    this.setPatchRate(1000 / 15);
    this.mapa = cargarMapaColision(rutaMapaHub());
    console.log(
      `Hub con mapa "${this.mapa.nombre}" (${this.mapa.ancho}x${this.mapa.alto} casillas), ` +
      `spawn en ${this.mapa.spawnX.toFixed(1)},${this.mapa.spawnY.toFixed(1)}`,
    );

    this.onMessage("input", (client, dir: Direction) => {
      this.inputs.set(client.sessionId, {
        x: clamp(dir?.x ?? 0, -1, 1),
        y: clamp(dir?.y ?? 0, -1, 1),
      });
    });

    // bucear/subir un nivel (solo tiene efecto dentro del agua; el medio
    // de la casilla decide hasta dónde se puede bajar)
    this.onMessage("nivel", (client, delta: number) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const medio = medioEn(this.mapa, player.x, player.y);
      const minimo = nivelMinimo(medio);
      if (minimo === 0) return; // en tierra no hay niveles
      player.nivel = clamp(player.nivel + (delta > 0 ? 1 : -1), minimo, 0);
    });

    this.setSimulationInterval(() => this.update(), 1000 / TICK_HZ);
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new Player();
    player.x = this.mapa.spawnX;
    player.y = this.mapa.spawnY;
    player.name = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { x: 0, y: 0 });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
  }

  private update() {
    const dt = 1 / TICK_HZ;
    this.inputs.forEach((dir, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) return;

      // medio ANTES de moverse: decide la velocidad de este tick
      const idx = Math.floor(player.y) * this.mapa.ancho + Math.floor(player.x);
      const medio = medioEn(this.mapa, player.x, player.y);
      let vel: number;
      if (medio === TIPO.AGUA || medio === TIPO.AGUA_PROFUNDA) {
        vel = player.nivel < 0 ? VEL_BUCEAR : VEL_NADAR;
      } else {
        vel = VEL_ANDAR * (this.mapa.velocidad[idx] ?? 1);
      }

      if (dir.x !== 0 || dir.y !== 0) {
        // diagonal normalizada: moverse en diagonal no es más rápido
        const norma = Math.hypot(dir.x, dir.y);
        const paso = (vel * dt) / norma;
        const destino = moverAABB(this.mapa, player.x, player.y, dir.x * paso, dir.y * paso);
        player.x = destino.x;
        player.y = destino.y;
      }

      // medio DESPUÉS de moverse: transición tierra/agua y estado visible
      const medioAhora = medioEn(this.mapa, player.x, player.y);
      if (medioAhora === TIPO.TIERRA || medioAhora === TIPO.SOLIDO) {
        player.nivel = 0;
        player.estado = "tierra";
      } else {
        // el agua somera no deja seguir a -2: se sube solo
        player.nivel = clamp(player.nivel, nivelMinimo(medioAhora), 0);
        player.estado = player.nivel < 0 ? "buceando" : "nadando";
      }
    });

    // empuje PJ-PJ después de mover a todos (nadie se atasca con nadie)
    const cuerpos = [...this.state.players.values()];
    separarPJs(this.mapa, cuerpos, RADIO_PJ);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
