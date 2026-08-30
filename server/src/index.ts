import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HubRoom } from "./rooms/HubRoom";
import { RegionRoom } from "./rooms/RegionRoom";
import { InteriorRoom } from "./rooms/InteriorRoom";
import { DungeonRoom } from "./rooms/DungeonRoom";
import { ArenaCombateRoom } from "./rooms/ArenaCombateRoom";
import { obtenerBdCompartida } from "./datos/bdCompartida";
import { ejecutarTickEconomia } from "./mundo/economiaAsentamientos";
import { iniciarChatBot } from "./twitch/chatBot";
import { iniciarDeteccionDirecto } from "./twitch/estadoDirecto";
import { obtenerGestorTwitch } from "./twitch/gestorTwitch";
import { manejarPeticionLoginTwitch } from "./twitch/rutasOauth";
import { cargarPvpDesdeBd } from "./mundo/pvp";

const port = Number(process.env.PORT) || 2567;

// Servidor HTTP plano: responde 200 a cualquier ruta que no sea de login de
// Twitch, sirve como health check para que Render/Fly.io no maten el
// proceso pensando que esta caido. Las dos rutas de /auth/twitch/* (docs/
// GDD_Twitch.md §7) son no-op si faltan las credenciales — ver rutasOauth.ts.
const httpServer = createServer((req, res) => {
  if (manejarPeticionLoginTwitch(req, res)) return;
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Streamer Colony server OK");
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("hub", HubRoom);
// Barcos y navegación marítima (docs/GDD_Barcos.md, pedido 2026-08-30):
// SEGUNDA definición de la MISMA clase, esta vez con mapaId obligatorio vía
// filterBy — permite unirse al Hub de un mapa exterior DISTINTO al
// principal (cruzar un borde mar_abierto en barco) sin tocar "hub" (que
// sigue siendo el único mapa principal de siempre, cero riesgo para el
// resto de conexiones). Ver HubRoom.onCreate(options.mapaId).
gameServer.define("hub_mapa", HubRoom).filterBy(["mapaId"]);
// Instancias con tope de jugadores (docs/GDD_Sistema_Puertas.md): filterBy
// hace que dos joins con el MISMO mapaId/edificio caigan en la MISMA room
// (comparten la aldea/el edificio) y uno distinto cree una room aparte.
gameServer.define("region", RegionRoom).filterBy(["mapaId"]);
gameServer.define("interior", InteriorRoom).filterBy(["mapaId", "edificio", "nivel"]);
// Mazmorra (docs/GDD_Bakeador_Dungeons.md): MISMA instancia por planta que
// un interior normal — hereda de InteriorRoom, solo añade enemigos.
gameServer.define("mazmorra", DungeonRoom).filterBy(["mapaId", "edificio", "nivel"]);
// Arena de combate instanciada (docs/GDD_Combate.md §9.2): una room POR
// combate — todos los que reciben el mismo combateId (vía portal:ir) caen
// en la MISMA instancia, el roster ya lo dejó preparado la room de origen.
gameServer.define("arena", ArenaCombateRoom).filterBy(["combateId"]);

httpServer.listen(port, () => {
  console.log(`Colony server escuchando en el puerto ${port}`);
});

// Twitch (docs/GDD_Twitch.md, pedido 2026-08-30) — UNA sola vez por proceso
// (mismo criterio que el tick de economía, abajo): un único bot de chat, un
// único sondeo de "en directo", nunca uno por room. Ambos son no-op si
// faltan las variables de entorno correspondientes (ver cada módulo).
iniciarChatBot();
iniciarDeteccionDirecto((valor) => obtenerGestorTwitch().fijarEnDirecto(valor));

// Tick de economía de la facción bandida (docs/GDD_Faccion_Bandidos.md §6):
// UNA sola vez por proceso, no por room — si se pusiera dentro de
// RegionRoom se repetiría una vez por cada aldea hostil cargada a la vez,
// recalculando TODOS los asentamientos en cada una. Cálculo perezoso puro
// (sin 3D, ver economiaAsentamientos.ts), corre exista o no un jugador
// conectado — un asentamiento sigue produciendo/gastando aunque nadie lo
// esté mirando, igual que el reloj de mundo.
// TICK_ECONOMIA_MS: override SOLO para tests/depuración (un E2E real no
// puede esperar 10 min reales por pulso) — mismo criterio que HORA_FORZADA.
const INTERVALO_TICK_ECONOMIA_MS = Number(process.env.TICK_ECONOMIA_MS) || 10 * 60 * 1000; // cada 10 min reales
obtenerBdCompartida().then((bd) => {
  setInterval(() => {
    ejecutarTickEconomia(bd).catch((err) => console.error("Tick de economía de la facción bandida falló:", err));
  }, INTERVALO_TICK_ECONOMIA_MS);
});

// PvP (docs/GDD_PvP.md, pedido 2026-08-30): recupera el último valor que
// dejó el jarl — arranca en `false` (seguro) hasta que esto resuelve.
obtenerBdCompartida().then((bd) => cargarPvpDesdeBd(bd));
