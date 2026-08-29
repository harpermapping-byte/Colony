import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
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
  private bd!: IAlmacenDatos;
  private ctx!: ContextoConstruccion;
  private catalogoConstruible!: Map<string, EntradaConstruible>;
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

    await this.iniciarConstruccion(rutaMapa);

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
    this.crearJugador(client, options, this.mapa.spawnX, this.mapa.spawnY);

    // estado de construcción al entrar (GDD §4); el interior de los
    // edificios de CONSTRUCCIÓN (player-placed) no viaja aquí — solo los
    // de ciudades/ se entran por portal (docs/GDD_Sistema_Puertas.md)
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
    super.onLeave(client);
    this.ultimoMensajeNpc.delete(client.sessionId);
  }
}
