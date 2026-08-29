import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { cargarParcelas } from "../construccion/parcelas";
import { GestorConversacionesNpc } from "../ia/npcChat";

// El hub juega sobre el MAPA PRINCIPAL (assets/mapas/principal/) — mismo
// mapa que el cliente carga por streaming. Si no está en disco (repo
// parcial, entorno raro), se cae al demo para no tumbar el servidor; los
// tests unitarios siguen usando el demo a propósito (pequeño y rápido).
function rutaMapaHub(): string | undefined {
  if (process.env.RUTA_MAPA) return process.env.RUTA_MAPA;
  const principal = path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "principal");
  return fs.existsSync(path.join(principal, "indice.json")) ? principal : undefined;
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
export class HubRoom extends RoomExteriorBase {
  private mapa!: MapaCargado;
  private conversacionesNpc = new GestorConversacionesNpc();
  private ultimoMensajeNpc = new Map<string, number>();

  // Colyseus espera (y awaitea) el lifecycle de creación de la room: async
  // aquí es lo correcto, no un apaño — la matchmaker no da la room por lista
  // hasta que esta promesa resuelve, así que abrir la BD (posible red real
  // contra Neon) antes de aceptar jugadores es seguro.
  async onCreate() {
    const rutaMapa =
      rutaMapaHub() ?? path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "demo");
    this.mapa = cargarMapaColision(rutaMapa);
    this.mundo = this.mapa;
    this.mapaExterior = this.mapa; // habilita "coger" de recolectables del bake (fase 2 de inventario)
    console.log(
      `Hub con mapa "${this.mapa.nombre}" (${this.mapa.ancho}x${this.mapa.alto} casillas), ` +
      `spawn en ${this.mapa.spawnX.toFixed(1)},${this.mapa.spawnY.toFixed(1)}`,
    );
    this.iniciarMovimiento();

    // Parcelas pintadas a mano (parcelas/gui/servidor.js) sobre el mapa
    // principal — construcción-en-regiones (ciudad capital) usa la MISMA
    // lógica compartida (RoomExteriorBase.iniciarConstruccion) pero con
    // parcelas rasterizadas del bake, ver RegionRoom.ts.
    await this.iniciarConstruccion(cargarParcelas(rutaMapa, this.mapa.ancho), path.basename(rutaMapa));

    // Puertas del Hub (docs/GDD_Sistema_Puertas.md): al ser la raíz, sus
    // portales "exterior" DEBEN traer `destino` (a una región) — no hay
    // "volver" desde aquí. Los "interior" entran al edificio bakeado (si
    // el Hub llegara a tener alguno propio; hoy los del mapa principal no).
    this.onMessage("portal:usar", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const portal = this.mapa.portales.find(
        (p) => Math.hypot(p.x + 0.5 - player.x, p.y + 0.5 - player.y) < RADIO_INTERACCION,
      );
      if (!portal) return client.send("portal:error", { motivo: "no hay puerta cerca" });

      if (portal.tipo === "interior") {
        client.send("portal:ir", {
          tipo: "interior",
          mapaId: path.basename(rutaMapa),
          edificio: portal.edificio,
          tipoEdificioId: portal.tipoEdificioId,
          esMazmorra: portal.esMazmorra ?? false,
          x: portal.x,
          y: portal.y,
        });
      } else if (portal.destino) {
        client.send("portal:ir", { tipo: portal.destino.tipo, mapaId: portal.destino.mapaId });
      } else {
        client.send("portal:error", { motivo: "puerta sin destino configurado" });
      }
    });

    // Diálogo con NPCs (docs/GDD_IA_NPCs.md): respuesta va SOLO al que
    // preguntó (conversación privada), nunca en broadcast.
    this.onMessage("npc:hablar", async (client, msg: { npcId?: string; mensaje?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !msg?.npcId || !msg?.mensaje) return;
      // rate-limit por jugador (GDD_Mecanicas §5.12, "rate-limit por
      // mensaje" pendiente): sin esto un cliente puede spamear el handler y
      // agotar la cuota gratuita de Gemini/Groq para todos los jugadores.
      const ahora = Date.now();
      const anterior = this.ultimoMensajeNpc.get(client.sessionId) ?? 0;
      const COOLDOWN_MS = 3000;
      if (ahora - anterior < COOLDOWN_MS) {
        client.send("npc:error", { npcId: msg.npcId, motivo: "espera un momento antes de volver a hablar" });
        return;
      }
      this.ultimoMensajeNpc.set(client.sessionId, ahora);
      try {
        const texto = await this.conversacionesNpc.hablar(msg.npcId, nombre, msg.mensaje.slice(0, 300));
        client.send("npc:respuesta", { npcId: msg.npcId, texto });
      } catch (err) {
        client.send("npc:error", { npcId: msg.npcId, motivo: (err as Error).message });
      }
    });

  }

  onJoin(client: Client, options: { name?: string }) {
    this.crearJugador(client, options, this.mapa.spawnX, this.mapa.spawnY);

    // estado de construcción al entrar (GDD §4); el interior de los
    // edificios de CONSTRUCCIÓN (player-placed) no viaja aquí — solo los
    // de ciudades/ se entran por portal (docs/GDD_Sistema_Puertas.md)
    this.enviarEstadoConstruccion(client);
  }

  onLeave(client: Client) {
    super.onLeave(client);
    this.ultimoMensajeNpc.delete(client.sessionId);
  }
}
