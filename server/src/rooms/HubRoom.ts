import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { cargarParcelas } from "../construccion/parcelas";
import { GestorConversacionesNpc } from "../ia/npcChat";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { cargarCatalogoFaunaSalvaje } from "../mundo/catalogoFaunaSalvaje";
import { DependenciasFaunaSalvaje, GestorFaunaSalvaje } from "../mundo/faunaSalvajeViva";
import { ObjetoFaunaBakeado } from "../mundo/faunaSalvajeSector";
import { diaFraccional } from "../mundo/reproduccionFauna";
import { tiempoMundo } from "../mundo/tiempoMundo";

// Lee un `sector_XXX_YYY.json` bakeado y devuelve solo sus objetos de
// fauna (t==="a") con coordenadas GLOBALAS de casilla — mismo formato de
// nombre de archivo que usa `mundo/mapaColision.ts`. `[]` si el sector no
// existe (fuera del mapa, o hueco sin bakear).
function leerObjetosFaunaDeSector(rutaMapa: string, tamanoChunk: number, sectorX: number, sectorY: number): ObjetoFaunaBakeado[] {
  const pad3 = (n: number) => String(n).padStart(3, "0");
  const ruta = path.join(rutaMapa, `sector_${pad3(sectorX)}_${pad3(sectorY)}.json`);
  if (!fs.existsSync(ruta)) return [];
  const sector = JSON.parse(fs.readFileSync(ruta, "utf8")) as {
    chunks: Record<string, { objetos: { i: string; t: string; x: number; y: number }[] }>;
  };
  const salida: ObjetoFaunaBakeado[] = [];
  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    const baseX = cx * tamanoChunk;
    const baseY = cy * tamanoChunk;
    for (const obj of chunk.objetos) {
      if (obj.t === "a") salida.push({ i: obj.i, x: baseX + obj.x, y: baseY + obj.y });
    }
  }
  return salida;
}

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

    // Fauna salvaje EN VIVO (docs/GDD_Agentes_Moviles.md, pedido
    // 2026-08-30): activa/desactiva sectores según se acercan o alejan
    // jugadores — el resto del mapa (miles de sectores) no cuesta nada
    // mientras nadie esté cerca. Reusa el mismo algoritmo de merodeo que
    // la fauna doméstica (mundo/fauna.ts). Envuelto entero en try/catch:
    // esto es una capa nueva sobre un Hub que ya funcionaba — si algo
    // falla (mapa sin indice.json completo, BD no disponible...) se
    // registra y la partida sigue exactamente igual que antes, sin fauna
    // salvaje viva, en vez de tumbar la room para todos los jugadores.
    try {
      const indice = JSON.parse(fs.readFileSync(path.join(rutaMapa, "indice.json"), "utf8")) as {
        tamanoChunk: number;
        tamanoSectorChunks: number;
      };
      if (indice.tamanoSectorChunks) {
        const bd = await obtenerBdCompartida();
        const catalogo = cargarCatalogoFaunaSalvaje(
          path.resolve(__dirname, "..", "..", "..", "baker", "catalogo", "animales.json"),
        );
        const mapaId = path.basename(rutaMapa);
        const deps: DependenciasFaunaSalvaje = {
          mapaId,
          catalogo,
          mundo: this.mapa,
          ahora: () => {
            const t = tiempoMundo();
            return diaFraccional(t.dia, t.hora);
          },
          cargarBakeSector: (s) => leerObjetosFaunaDeSector(rutaMapa, indice.tamanoChunk, s.sectorX, s.sectorY),
          cargarPersistido: async (s) => ({
            filas: await bd.listarFaunaSector(mapaId, s.sectorX, s.sectorY),
            huevos: await bd.listarHuevosSector(mapaId, s.sectorX, s.sectorY),
            ultimaResolucion: await bd.obtenerUltimaResolucionSector(mapaId, s.sectorX, s.sectorY),
          }),
          guardarIndividuo: (f) => bd.guardarFaunaIndividuo(f),
          guardarHuevo: (h) => bd.guardarHuevo(h),
          marcarSectorResuelto: (s, momento) => bd.marcarSectorResuelto(mapaId, s.sectorX, s.sectorY, momento),
        };
        const gestorFaunaSalvaje = new GestorFaunaSalvaje(this.state.fauna, deps);
        // Merodeo a 5hz (igual que la fauna doméstica); activar/desactivar
        // sectores es mucho más caro (E/S a BD) así que va aparte y más
        // despacio — de sobra para notar que un jugador cambió de sector.
        this.clock.setInterval(() => gestorFaunaSalvaje.tick(0.2), 200);
        this.clock.setInterval(() => {
          const posiciones = [...this.state.players.values()].map((p) => ({ x: p.x, y: p.y }));
          gestorFaunaSalvaje
            .actualizarPorJugadores(posiciones, indice.tamanoChunk, indice.tamanoSectorChunks, 1)
            .catch((err) => console.error("Fauna salvaje: fallo actualizando sectores activos:", err));
        }, 8000);
        console.log("  Fauna salvaje en vivo activada (sectores bajo demanda)");
      }
    } catch (err) {
      console.error("Fauna salvaje: no se pudo iniciar, el Hub sigue sin ella:", err);
    }

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
