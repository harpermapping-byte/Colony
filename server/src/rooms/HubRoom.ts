import { Room, Client } from "@colyseus/core";
import { HubState, Player } from "./schema/HubState";

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const SPEED = 4; // px por tick de simulacion

interface Direction {
  x: number;
  y: number;
}

// Habitacion del Hub central: aqui viven todos los avatares del pueblo.
// Optimizada para plan gratuito: la simulacion corre a 30hz (barata en CPU),
// pero el estado solo se manda al cliente 15 veces/seg (patchRate) para
// ahorrar ancho de banda, y el input solo se recibe cuando cambia de
// direccion en vez de en cada frame.
export class HubRoom extends Room<HubState> {
  maxClients = 40;
  private inputs = new Map<string, Direction>();

  onCreate() {
    this.setState(new HubState());
    this.setPatchRate(1000 / 15);

    this.onMessage("input", (client, dir: Direction) => {
      this.inputs.set(client.sessionId, {
        x: clamp(dir?.x ?? 0, -1, 1),
        y: clamp(dir?.y ?? 0, -1, 1),
      });
    });

    this.setSimulationInterval(() => this.update(), 1000 / 30);
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new Player();
    player.x = MAP_WIDTH / 2;
    player.y = MAP_HEIGHT / 2;
    player.name = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { x: 0, y: 0 });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
  }

  private update() {
    this.inputs.forEach((dir, sessionId) => {
      if (dir.x === 0 && dir.y === 0) return;
      const player = this.state.players.get(sessionId);
      if (!player) return;

      player.x = clamp(player.x + dir.x * SPEED, 0, MAP_WIDTH);
      player.y = clamp(player.y + dir.y * SPEED, 0, MAP_HEIGHT);
    });
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
