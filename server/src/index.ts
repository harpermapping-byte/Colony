import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HubRoom } from "./rooms/HubRoom";
import { RegionRoom } from "./rooms/RegionRoom";
import { InteriorRoom } from "./rooms/InteriorRoom";
import { DungeonRoom } from "./rooms/DungeonRoom";

const port = Number(process.env.PORT) || 2567;

// Servidor HTTP plano: responde 200 a cualquier ruta, sirve como health
// check para que Render/Fly.io no maten el proceso pensando que esta caido.
const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Streamer Colony server OK");
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("hub", HubRoom);
// Instancias con tope de jugadores (docs/GDD_Sistema_Puertas.md): filterBy
// hace que dos joins con el MISMO mapaId/edificio caigan en la MISMA room
// (comparten la aldea/el edificio) y uno distinto cree una room aparte.
gameServer.define("region", RegionRoom).filterBy(["mapaId"]);
gameServer.define("interior", InteriorRoom).filterBy(["mapaId", "edificio", "nivel"]);
// Mazmorra (docs/GDD_Bakeador_Dungeons.md): MISMA instancia por planta que
// un interior normal — hereda de InteriorRoom, solo añade enemigos.
gameServer.define("mazmorra", DungeonRoom).filterBy(["mapaId", "edificio", "nivel"]);

httpServer.listen(port, () => {
  console.log(`Colony server escuchando en el puerto ${port}`);
});
