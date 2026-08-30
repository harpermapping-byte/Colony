import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION, PA_MAX_COMBATE } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { cargarParcelas } from "../construccion/parcelas";
import { GestorConversacionesNpc } from "../ia/npcChat";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { cargarCatalogoFaunaSalvaje } from "../mundo/catalogoFaunaSalvaje";
import { DependenciasFaunaSalvaje, GestorFaunaSalvaje } from "../mundo/faunaSalvajeViva";
import { ObjetoFaunaBakeado } from "../mundo/faunaSalvajeSector";
import { cadaverDesaparecio } from "../mundo/cadaveres";
import { diaFraccional } from "../mundo/reproduccionFauna";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { cargarCatalogoCombateFauna, CatalogoCombateFauna } from "../mundo/catalogoCombateFauna";
import { cargarCatalogoItems } from "../inventario/inventario";
import { aplicarDanio, calcularDanio, estaMuerto } from "../combate/combate";
import { UnidadCombate, calcularIniciativa, simularCombateAutomatico } from "../combate/arenaCombate";
import { TIPO, tipoEn } from "../mundo/colisiones";
import { cooldownNpcHablarMs } from "../personaje/bonusAtributos";

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
export function rutaMapaHub(): string | undefined {
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
  // Fauna salvaje en vivo (docs/GDD_Agentes_Moviles.md) — undefined si el
  // mapa no tiene sectores bakeados de verdad o si algo falló al iniciar
  // (ver el try/catch de onCreate). `matarIndividuo` es el punto de
  // enganche para un futuro sistema de combate.
  private gestorFaunaSalvaje?: GestorFaunaSalvaje;
  // Guardado aparte (además de dentro de deps.catalogoCombate) para que lo
  // use también la autosimulación NPC-vs-fauna (docs/GDD_Combate.md §7).
  private catalogoCombate?: CatalogoCombateFauna;
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
    this.esZonaSeguraPropia = true; // PvP (docs/GDD_PvP.md): el Hub es el pueblo donde vive todo el mundo, siempre a salvo
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
        this.catalogoCombate = cargarCatalogoCombateFauna(
          path.resolve(__dirname, "..", "..", "..", "baker", "catalogo", "animales.json"),
        );
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
          crearCadaver: (c) => bd.crearCadaverBd(c),
          catalogoCombate: this.catalogoCombate,
          catalogoItems: cargarCatalogoItems(),
        };
        // Guardado como campo (no variable local): `onFaunaMuerta` (docs/
        // GDD_Combate.md) llama a matarIndividuo() al cerrar un combate real.
        this.gestorFaunaSalvaje = new GestorFaunaSalvaje(this.state.fauna, deps);

        // Cadáveres de sesiones anteriores que todavía no han expirado
        // (docs/GDD_Caza.md) — sin esto, un reinicio del servidor los deja
        // persistidos en BD pero invisibles hasta el próximo `matarIndividuo`.
        const ahoraCadaveres = () => {
          const t = tiempoMundo();
          return diaFraccional(t.dia, t.hora);
        };
        for (const fila of await bd.listarCadaveresMapa(mapaId)) {
          if (cadaverDesaparecio(fila, ahoraCadaveres())) {
            void bd.borrarCadaver(fila.id);
            continue;
          }
          this.publicarCadaver(fila);
        }
        this.clock.setInterval(
          () => void this.limpiarCadaveresExpirados(ahoraCadaveres()),
          60_000,
        );
        // Merodeo a 5hz (igual que la fauna doméstica); activar/desactivar
        // sectores es mucho más caro (E/S a BD) así que va aparte y más
        // despacio — de sobra para notar que un jugador cambió de sector.
        this.clock.setInterval(() => this.gestorFaunaSalvaje!.tick(0.2), 200);
        this.clock.setInterval(() => {
          const posiciones = [...this.state.players.values()].map((p) => ({ x: p.x, y: p.y }));
          this.gestorFaunaSalvaje!
            .actualizarPorJugadores(posiciones, indice.tamanoChunk, indice.tamanoSectorChunks, 1)
            .catch((err) => console.error("Fauna salvaje: fallo actualizando sectores activos:", err));
        }, 8000);
        // Autosimulación de encuentros NPC-vs-fauna peligrosa (docs/GDD_Combate.md
        // §7, confirmado 2026-08-30: "en combates de NPC contra animales... se
        // autosimule"). Baja frecuencia — es un rastreo O(npcs*fauna_activa),
        // barato porque solo hay fauna activa cerca de jugadores (mismo criterio
        // de "cálculo perezoso" que el resto del proyecto).
        this.clock.setInterval(
          () => this.comprobarEncuentrosAutomaticos().catch((err) => console.error("Autosimulación NPC-vs-fauna: fallo:", err)),
          5000,
        );
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
      // Carisma (docs/GDD_Personaje.md §3.3): "más interacciones o
      // conversaciones" — más nivel de carisma acorta este cooldown, nunca
      // por debajo de 1000ms (la cuota de Gemini/Groq sigue mandando).
      const nivelCarisma = this.state.players.get(client.sessionId)?.atributos.carisma ?? 1;
      const COOLDOWN_MS = cooldownNpcHablarMs(nivelCarisma);
      if (ahora - anterior < COOLDOWN_MS) {
        client.send("npc:error", { npcId: msg.npcId, motivo: "espera un momento antes de volver a hablar" });
        return;
      }
      this.ultimoMensajeNpc.set(client.sessionId, ahora);
      try {
        const texto = await this.conversacionesNpc.hablar(msg.npcId, nombre, msg.mensaje.slice(0, 300));
        client.send("npc:respuesta", { npcId: msg.npcId, texto });
        // Carisma (docs/GDD_Personaje.md): hablar con un NPC ya está
        // limitado por el cooldown de arriba (3s), así que reusarlo también
        // acota la ganancia de XP sin necesidad de un límite propio.
        const player = this.state.players.get(client.sessionId);
        if (player) {
          const bd = await obtenerBdCompartida();
          const jugador = await bd.obtenerOCrearJugador(nombre);
          await this.otorgarXpAtributo(bd, jugador.id, "carisma", player, 5);
        }
      } catch (err) {
        client.send("npc:error", { npcId: msg.npcId, motivo: (err as Error).message });
      }
    });


    // Combate (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): un jugador
    // ataca a un animal salvaje activo o a otro jugador dentro de
    // RADIO_INTERACCION. Los animales NO tienen defensa (calcularDanio
    // recibe 0); un jugador SÍ, según su `defensa` de red (Player.defensa
    // — base 0, sin cálculo de equipo todavía: ese enganche queda para
    // cuando se decida qué sistema de combate lo conecta, ver la nota de
    // coordinación con docs/GDD_Combate.md en el GDD de mecánicas).
    // Servidor autoritativo: el cliente solo pide, nunca decide vida.
    this.onMessage("combate:atacar", async (client, msg: { objetivoTipo?: "fauna" | "jugador"; objetivoId?: string }) => {
      const atacante = this.state.players.get(client.sessionId);
      if (!atacante || !msg?.objetivoTipo || !msg?.objetivoId) return;

      if (msg.objetivoTipo === "fauna") {
        if (!this.gestorFaunaSalvaje) return client.send("combate:error", { motivo: "sin fauna salvaje en este mapa" });
        const animal = this.state.fauna.get(msg.objetivoId);
        if (!animal) return client.send("combate:error", { motivo: "objetivo no encontrado" });
        if (Math.hypot(animal.x - atacante.x, animal.y - atacante.y) > RADIO_INTERACCION) {
          return client.send("combate:error", { motivo: "demasiado lejos" });
        }
        const danio = calcularDanio(atacante.ataque, 0); // los animales no tienen defensa
        const resultado = await this.gestorFaunaSalvaje.recibirDanio(msg.objetivoId, danio);
        if (!resultado) return client.send("combate:error", { motivo: "objetivo ya no está activo" });
        this.broadcast("combate:golpe", {
          objetivoTipo: "fauna", objetivoId: msg.objetivoId, danio,
          vida: resultado.vida, vidaMax: resultado.vidaMax, muerto: resultado.muerto,
        });
        return;
      }

      // objetivoTipo === "jugador" (PvP)
      const objetivo = this.state.players.get(msg.objetivoId);
      if (!objetivo || msg.objetivoId === client.sessionId) return client.send("combate:error", { motivo: "objetivo no válido" });
      if (Math.hypot(objetivo.x - atacante.x, objetivo.y - atacante.y) > RADIO_INTERACCION) {
        return client.send("combate:error", { motivo: "demasiado lejos" });
      }
      const danio = calcularDanio(atacante.ataque, objetivo.defensa);
      const stats = aplicarDanio(
        { vida: objetivo.vida, vidaMax: objetivo.vidaMax, ataque: objetivo.ataque, defensa: objetivo.defensa },
        danio,
      );
      const muerto = estaMuerto(stats);
      // Sin diseño de muerte/respawn todavía (fuera de esta pasada): por
      // ahora, morir simplemente rellena la vida al máximo en el sitio —
      // mejor que un jugador "muerto" andante, sin inventar penalización.
      objetivo.vida = muerto ? objetivo.vidaMax : stats.vida;
      if (objetivo.name) {
        const bd = await obtenerBdCompartida();
        const jugador = await bd.obtenerOCrearJugador(objetivo.name);
        await bd.actualizarVidaJugador(jugador.id, objetivo.vida, objetivo.vidaMax);
      }
      this.broadcast("combate:golpe", {
        objetivoTipo: "jugador", objetivoId: msg.objetivoId, danio,
        vida: objetivo.vida, vidaMax: objetivo.vidaMax, muerto,
      });
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    this.crearJugador(client, options, this.mapa.spawnX, this.mapa.spawnY);

    // Vida persistida (docs/GDD_Mecanicas.md §5.4): carga best-effort, no
    // bloquea el join — mismo criterio que el resto de datos "oportunistas"
    // (gremio, etc.) que no viajan síncronos en onJoin. Si falla, el
    // jugador se queda con la base 100/100 del Schema — no rompe nada.
    const nombre = this.nombreDe(client);
    if (nombre) {
      obtenerBdCompartida()
        .then((bd) => bd.obtenerOCrearJugador(nombre))
        .then((jugador) => {
          const player = this.state.players.get(client.sessionId);
          if (player) {
            player.vida = jugador.vida;
            player.vidaMax = jugador.vidaMax;
          }
        })
        .catch((err) => console.error("No se pudo cargar la vida persistida del jugador:", err));
    }

    // estado de construcción al entrar (GDD §4); el interior de los
    // edificios de CONSTRUCCIÓN (player-placed) no viaja aquí — solo los
    // de ciudades/ se entran por portal (docs/GDD_Sistema_Puertas.md)
    this.enviarEstadoConstruccion(client);
  }

  async onLeave(client: Client) {
    await super.onLeave(client);
    this.ultimoMensajeNpc.delete(client.sessionId);
  }

  // Combate táctico (docs/GDD_Combate.md): una fauna salvaje muerta en
  // combate pasa por matarIndividuo (persiste, quita del estado Y crea su
  // cadáver — cierra el círculo con el sistema de cadáveres) en vez del
  // borrado genérico de RoomExteriorBase.finalizarMuerte.
  protected async onFaunaMuerta(id: string): Promise<boolean> {
    if (!this.gestorFaunaSalvaje) return false;
    const cadaver = await this.gestorFaunaSalvaje.matarIndividuo(id);
    if (cadaver) this.publicarCadaver(cadaver); // docs/GDD_Caza.md — visible/lootable para cualquier jugador
    return cadaver !== null;
  }

  /** Ganadería (docs/GDD_Ganaderia.md): domesticar aquí saca al individuo de su sector activo (GestorFaunaSalvaje), sin cadáver ni loot. */
  protected async onFaunaDomesticada(id: string): Promise<boolean> {
    if (!this.gestorFaunaSalvaje) return false;
    return (await this.gestorFaunaSalvaje.domesticar(id)) !== null;
  }

  /** docs/GDD_Caza.md — solo el Hub conoce categoriaVida/categoriaRecursoCarne/Piel por especie (catalogoCombate real). */
  protected estadisticasFaunaDe(especieId: string) {
    return this.catalogoCombate?.[especieId] ?? null;
  }

  /** docs/GDD_Combate.md §9.1 — solo el Hub sabe qué fauna es peligrosa (catalogoCombate real), así que solo aquí auto-se-une a una ventana de combate cercana. */
  protected faunaEsPeligrosa(especieId: string): boolean {
    return this.catalogoCombate?.[especieId]?.peligroso ?? false;
  }

  /**
   * Disparador real de autosimulación (docs/GDD_Combate.md §7): un NPC
   * cerca de fauna `peligroso` combate contra ella de una sentada, sin
   * turnos interactivos ni UI (nadie la está mirando). Un solo encuentro
   * por pasada — es un guarda-raíl simple, no una simulación masiva; si
   * hay varios candidatos a la vez, los siguientes se resuelven en la
   * próxima pasada (5s después).
   */
  private async comprobarEncuentrosAutomaticos() {
    if (!this.catalogoCombate) return;
    const RADIO_ENCUENTRO = 4;
    for (const [npcId, npc] of this.state.npcs.entries()) {
      for (const [faunaId, fauna] of this.state.fauna.entries()) {
        const datos = this.catalogoCombate[fauna.especieId];
        if (!datos?.peligroso) continue;
        if (Math.hypot(npc.x - fauna.x, npc.y - fauna.y) > RADIO_ENCUENTRO) continue;

        const lado = 8;
        const cx = Math.floor((npc.x + fauna.x) / 2);
        const cy = Math.floor((npc.y + fauna.y) / 2);
        let gx0 = Math.round(cx - lado / 2);
        let gy0 = Math.round(cy - lado / 2);
        gx0 = Math.max(0, Math.min(gx0, this.mapa.ancho - lado));
        gy0 = Math.max(0, Math.min(gy0, this.mapa.alto - lado));
        const obstaculos = new Uint8Array(lado * lado);
        for (let gy = 0; gy < lado; gy++) {
          for (let gx = 0; gx < lado; gx++) {
            if (tipoEn(this.mapa, gx0 + gx, gy0 + gy) === TIPO.SOLIDO) obstaculos[gy * lado + gx] = 1;
          }
        }

        const uNpc: UnidadCombate = {
          id: npcId, esJugador: false, bando: "A",
          gx: Math.round(npc.x - gx0), gy: Math.round(npc.y - gy0),
          hp: npc.vida, hpMax: npc.vidaMax, pa: PA_MAX_COMBATE, paMax: PA_MAX_COMBATE,
          iniciativa: calcularIniciativa(10, Math.random), estado: "activo",
          ataqueFisico: npc.ataque, defensaFisica: npc.defensa, alcance: 1,
        };
        const uFauna: UnidadCombate = {
          id: faunaId, esJugador: false, bando: "B",
          gx: Math.round(fauna.x - gx0), gy: Math.round(fauna.y - gy0),
          hp: fauna.vida, hpMax: fauna.vidaMax, pa: PA_MAX_COMBATE, paMax: PA_MAX_COMBATE,
          iniciativa: calcularIniciativa(10, Math.random), estado: "activo",
          ataqueFisico: fauna.ataque, defensaFisica: 0, alcance: 1,
        };

        const resultado = simularCombateAutomatico([uNpc], [uFauna], { ancho: lado, alto: lado, obstaculos }, Math.random);
        for (const u of resultado.unidades) {
          if (u.id === npcId) {
            if (u.estado === "caido") this.state.npcs.delete(npcId);
            else npc.vida = u.hp;
          } else if (u.id === faunaId) {
            if (u.estado === "caido") await this.onFaunaMuerta(faunaId);
            else fauna.vida = u.hp;
          }
        }
        return; // un encuentro por pasada — de sobra para un mecanismo recién estrenado
      }
    }
  }
}
