import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HubRoom } from "./rooms/HubRoom";

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

httpServer.listen(port, () => {
  console.log(`Colony server escuchando en el puerto ${port}`);
});
