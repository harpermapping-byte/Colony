import { Room, Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { HubState, Player } from "./schema/HubState";

const SPEED = 4; // px por tick de simulacion
const PX_POR_CASILLA = 32; // misma equivalencia que usa el cliente (PIXELES_POR_UNIDAD)

// Limites del mundo y punto de spawn: salen del indice.json del mapa
// principal bakeado (assets/mapas/principal/) — la unica fuente de verdad
// del tamano del mapa y de donde esta la ciudad. El servidor NO carga los
// sectores (70MB): solo el indice (1KB) una vez al arrancar. Si el indice
// no esta (repo parcial, entorno raro), se cae a los limites antiguos del
// hub de pruebas para no tumbar el servidor.
function cargarConfigMapa() {
  // __dirname en produccion es server/dist/rooms y en dev server/src/rooms
  // — en ambos casos la raiz del repo queda tres niveles arriba.
  const candidatos = [
    path.resolve(__dirname, "../../../assets/mapas/principal/indice.json"),
    path.resolve(process.cwd(), "../assets/mapas/principal/indice.json"),
    path.resolve(process.cwd(), "assets/mapas/principal/indice.json"),
  ];
  for (const ruta of candidatos) {
    try {
      const indice = JSON.parse(fs.readFileSync(ruta, "utf8"));
      const ancho = indice.anchoChunks * indice.tamanoChunk * PX_POR_CASILLA;
      const alto = indice.altoChunks * indice.tamanoChunk * PX_POR_CASILLA;
      // Spawn: la ciudad del mapa (casilla → centro de casilla en px);
      // sin ciudad definida, el centro del mapa.
      const spawnX = indice.ciudad ? (indice.ciudad.x + 0.5) * PX_POR_CASILLA : ancho / 2;
      const spawnY = indice.ciudad ? (indice.ciudad.y + 0.5) * PX_POR_CASILLA : alto / 2;
      console.log(`Mapa principal cargado de ${ruta}: ${ancho}x${alto}px, spawn (${spawnX}, ${spawnY})`);
      return { ancho, alto, spawnX, spawnY };
    } catch {
      // probar el siguiente candidato
    }
  }
  console.warn("indice.json del mapa principal no encontrado — limites de hub de pruebas");
  return { ancho: 800, alto: 600, spawnX: 400, spawnY: 300 };
}

const MAPA = cargarConfigMapa();

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
    player.x = MAPA.spawnX;
    player.y = MAPA.spawnY;
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

      player.x = clamp(player.x + dir.x * SPEED, 0, MAPA.ancho);
      player.y = clamp(player.y + dir.y * SPEED, 0, MAPA.alto);
    });
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
