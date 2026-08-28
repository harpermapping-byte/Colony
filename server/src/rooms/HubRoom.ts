import { Room, Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { HubState, Player } from "./schema/HubState";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ } from "../mundo/colisiones";
import { crearAlmacenDatos, IAlmacenDatos } from "../datos/bd";
import { cargarParcelas, runsDe } from "../construccion/parcelas";
import { cargarCatalogoConstruible, EntradaConstruible } from "../construccion/catalogo";
import {
  ContextoConstruccion,
  validarColocacion,
  aplicarColocacion,
  quitarConstruccion,
  esJarl,
} from "../construccion/construccion";
import { generarInteriorEdificio } from "../construccion/interiorGenerado";
import { GestorConversacionesNpc } from "../ia/npcChat";

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
  private bd!: IAlmacenDatos;
  private ctx!: ContextoConstruccion;
  private catalogoConstruible!: Map<string, EntradaConstruible>;
  private conversacionesNpc = new GestorConversacionesNpc();

  // Colyseus espera (y awaitea) el lifecycle de creación de la room: async
  // aquí es lo correcto, no un apaño — la matchmaker no da la room por lista
  // hasta que esta promesa resuelve, así que abrir la BD (posible red real
  // contra Neon) antes de aceptar jugadores es seguro.
  async onCreate() {
    this.setState(new HubState());
    this.setPatchRate(1000 / 15);
    const rutaMapa =
      rutaMapaHub() ?? path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "demo");
    this.mapa = cargarMapaColision(rutaMapa);
    console.log(
      `Hub con mapa "${this.mapa.nombre}" (${this.mapa.ancho}x${this.mapa.alto} casillas), ` +
      `spawn en ${this.mapa.spawnX.toFixed(1)},${this.mapa.spawnY.toFixed(1)}`,
    );

    await this.iniciarConstruccion(rutaMapa);

    this.onMessage("input", (client, dir: Direction) => {
      this.inputs.set(client.sessionId, {
        x: clamp(dir?.x ?? 0, -1, 1),
        y: clamp(dir?.y ?? 0, -1, 1),
      });
    });

    // Diálogo con NPCs (docs/GDD_IA_NPCs.md): respuesta va SOLO al que
    // preguntó (conversación privada), nunca en broadcast.
    this.onMessage("npc:hablar", async (client, msg: { npcId?: string; mensaje?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !msg?.npcId || !msg?.mensaje) return;
      try {
        const texto = await this.conversacionesNpc.hablar(msg.npcId, nombre, msg.mensaje.slice(0, 300));
        client.send("npc:respuesta", { npcId: msg.npcId, texto });
      } catch (err) {
        client.send("npc:error", { npcId: msg.npcId, motivo: (err as Error).message });
      }
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

  // ---- Construcción, parcelas y propiedad (docs/GDD_Construccion §4-§5) ----

  /**
   * Estado persistente al arrancar la room (regla GDD §2: leer al arrancar,
   * escribir al cambiar — nunca polling): abre la BD (env BD_RUTA o
   * server/datos.sqlite), carga las parcelas del MISMO mapa que juega el hub
   * y aplica a la rejilla la colisión de todo lo ya construido.
   */
  private async iniciarConstruccion(rutaMapa: string) {
    this.bd = await crearAlmacenDatos();
    this.catalogoConstruible = cargarCatalogoConstruible();
    // Jarl v1 por env: JARL_NOMBRES="Nombre1,Nombre2" (trim + lowercase)
    const jarls = new Set(
      (process.env.JARL_NOMBRES ?? "")
        .split(",")
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n.length > 0),
    );

    this.ctx = {
      mapa: this.mapa,
      // copia del bake ANTES de endurecer construcciones: es lo que se
      // restaura al recoger (una casilla vuelve a ser lo que era)
      casillasBase: this.mapa.casillas.slice(),
      parcelas: cargarParcelas(rutaMapa, this.mapa.ancho),
      propiedades: await this.bd.cargarPropiedades(),
      ocupacion: new Map(),
      vivas: new Map(),
      conteoPorPropiedad: new Map(),
      jarls,
    };

    const guardadas = await this.bd.listarConstrucciones();
    for (const c of guardadas) {
      const entrada = this.catalogoConstruible.get(c.objeto);
      if (!entrada) {
        // objeto retirado del catálogo: se conserva en BD pero no colisiona
        console.warn(`Construcción ${c.id} ("${c.objeto}") ya no está en el catálogo — sin colisión`);
      }
      aplicarColocacion(this.ctx, {
        id: c.id,
        propiedad: c.propiedad,
        objeto: c.objeto,
        categoria: c.categoria,
        x: c.x,
        y: c.y,
        rot: c.rot,
        variante: c.variante,
        colision: entrada?.colision ?? false,
        huella: entrada?.huella ?? [1, 1],
      });
    }
    console.log(
      `Construcción: ${this.ctx.parcelas.parcelas.size} parcelas, ` +
      `${guardadas.length} construcciones cargadas, ${jarls.size} jarl(s)`,
    );

    this.onMessage("parcela:asignar", async (client, msg: { parcelaId?: string; nombreJugador?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !esJarl(this.ctx, nombre)) return this.errorConstruir(client, "solo el jarl asigna parcelas");
      const parcela = msg?.parcelaId ? this.ctx.parcelas.parcelas.get(msg.parcelaId) : undefined;
      if (!parcela || !msg.parcelaId || !msg.nombreJugador) return this.errorConstruir(client, "parcela o jugador inválidos");
      await this.bd.asignarPropiedad(msg.parcelaId, "parcela", parcela.asentamiento, msg.nombreJugador);
      this.ctx.propiedades = await this.bd.cargarPropiedades();
      this.broadcast("parcelas:estado", this.estadoParcelas());
    });

    this.onMessage("parcela:revocar", async (client, msg: { parcelaId?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !esJarl(this.ctx, nombre)) return this.errorConstruir(client, "solo el jarl revoca parcelas");
      if (!msg?.parcelaId || !this.ctx.parcelas.parcelas.has(msg.parcelaId)) {
        return this.errorConstruir(client, "parcela inválida");
      }
      // las construcciones QUEDAN (pasan con la parcela al jarl — decisión v1, GDD §4)
      await this.bd.revocarPropiedad(msg.parcelaId);
      this.ctx.propiedades = await this.bd.cargarPropiedades();
      this.broadcast("parcelas:estado", this.estadoParcelas());
    });

    this.onMessage(
      "construir",
      async (client, msg: { objeto?: string; categoria?: string; x?: number; y?: number; rot?: number; variante?: number }) => {
        const nombre = this.nombreDe(client);
        if (!nombre) return;
        const entrada = msg?.objeto ? this.catalogoConstruible.get(msg.objeto) : undefined;
        if (!entrada || entrada.categoria !== msg.categoria) {
          return this.errorConstruir(client, "objeto no construible");
        }
        const x = Math.floor(msg.x ?? -1), y = Math.floor(msg.y ?? -1);
        const rot = ((Math.floor(msg.rot ?? 0) % 4) + 4) % 4;
        const variante = Math.floor(msg.variante ?? 0);

        const veredicto = validarColocacion(this.ctx, { nombre, entrada, x, y, rot });
        if (!veredicto.ok) return this.errorConstruir(client, veredicto.motivo);
        const propiedadId = veredicto.parcelaId;

        // la parcela puede no tener fila aún (nunca asignada): se crea sin
        // dueño para que la FK de construcciones apunte a algo real
        if (!this.ctx.propiedades.has(propiedadId)) {
          const parcela = this.ctx.parcelas.parcelas.get(propiedadId)!;
          await this.bd.asignarPropiedad(propiedadId, "parcela", parcela.asentamiento, null);
          this.ctx.propiedades.set(propiedadId, { dueno: null });
        }

        // edificio: su interior se genera UNA VEZ aquí y viaja en extra (§5)
        let extra: Record<string, unknown> | null = null;
        if (entrada.categoria === "edificio") {
          extra = { interior: generarInteriorEdificio(entrada.id, propiedadId, x, y) };
        }

        const id = await this.bd.insertarConstruccion({
          propiedad: propiedadId,
          objeto: entrada.id,
          categoria: entrada.categoria,
          x, y, rot, variante,
          extra,
        });
        aplicarColocacion(this.ctx, {
          id, propiedad: propiedadId, objeto: entrada.id, categoria: entrada.categoria,
          x, y, rot, variante, colision: entrada.colision, huella: entrada.huella,
        });
        this.broadcast("construccion:nueva", {
          id, propiedad: propiedadId, objeto: entrada.id, categoria: entrada.categoria,
          x, y, rot, variante,
        });
      },
    );

    this.onMessage("recoger", async (client, msg: { construccionId?: number }) => {
      const nombre = this.nombreDe(client);
      if (!nombre) return;
      const viva = typeof msg?.construccionId === "number" ? this.ctx.vivas.get(msg.construccionId) : undefined;
      if (!viva) return this.errorConstruir(client, "construcción inexistente");
      const dueno = this.ctx.propiedades.get(viva.propiedad)?.dueno ?? null;
      if (dueno !== nombre && !esJarl(this.ctx, nombre)) {
        return this.errorConstruir(client, "no eres el dueño de esta construcción");
      }
      await this.bd.borrarConstruccion(viva.id);
      quitarConstruccion(this.ctx, viva.id); // restaura la colisión del bake
      this.broadcast("construccion:quitada", { id: viva.id });
    });
  }

  private nombreDe(client: Client): string | undefined {
    return this.state.players.get(client.sessionId)?.name;
  }

  /** Los rechazos van SOLO al emisor (GDD §4). */
  private errorConstruir(client: Client, motivo: string) {
    client.send("construir:error", { motivo });
  }

  /** { [parcelaId]: { dueno } } + runs para que el cliente pinte bordes. */
  private estadoParcelas() {
    const estado: Record<string, { dueno: string | null; runs: [number, number, number][] }> = {};
    for (const parcelaId of this.ctx.parcelas.parcelas.keys()) {
      estado[parcelaId] = {
        dueno: this.ctx.propiedades.get(parcelaId)?.dueno ?? null,
        runs: runsDe(this.ctx.parcelas, parcelaId),
      };
    }
    return estado;
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new Player();
    player.x = this.mapa.spawnX;
    player.y = this.mapa.spawnY;
    player.name = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { x: 0, y: 0 });

    // estado de construcción al entrar (GDD §4); el interior de los
    // edificios NO viaja aquí — se pedirá al entrar por su portal (futuro)
    client.send("parcelas:estado", this.estadoParcelas());
    client.send(
      "construcciones:lista",
      [...this.ctx.vivas.values()].map((c) => ({
        id: c.id, propiedad: c.propiedad, objeto: c.objeto, categoria: c.categoria,
        x: c.x, y: c.y, rot: c.rot, variante: c.variante,
      })),
    );
  }

  async onDispose() {
    await this.bd?.cerrar();
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
