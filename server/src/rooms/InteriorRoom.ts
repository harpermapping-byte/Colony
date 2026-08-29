import { Client, ServerError } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION, ObjetoCogible } from "./base/RoomExteriorBase";
import { cargarInterior, InteriorCargado } from "../mundo/interiorColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";
import { poblarInterior, NpcConCasa } from "../mundo/agentesInterior";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { esJarlGlobal } from "../construccion/construccion";
import { salasAlquilablesPermitidas, precioHabitacion } from "../propiedades/propiedades";

export interface OpcionesInterior {
  name?: string;
  mapaId: string; // asentamiento del que cuelga este edificio
  edificio: string; // id único del interior (nombre de archivo sin .json)
  nivel?: number; // planta en la que se entra (0 = planta baja, por defecto)
  entradaX?: number; // llegando por una escalera: casilla donde aparece en ESTA planta
  entradaY?: number;
}

/**
 * Instancia del interior de UN edificio — docs/GDD_Sistema_Puertas.md.
 * Una room por `edificio`+`nivel` (mismo patrón de instancia que
 * RegionRoom): dos jugadores en la MISMA planta del MISMO edificio
 * comparten room, otra planta es otra room — subir/bajar escaleras es un
 * portal más (cambia de room), igual que cruzar una puerta exterior; sin
 * construcción ni propiedad, los interiores de ciudades/ no son de ningún
 * jugador.
 */
export class InteriorRoom extends RoomExteriorBase {
  // protected (no private): DungeonRoom hereda de esta clase y reutiliza
  // TAL CUAL la carga + el portal:usar de escaleras/salida (docs/GDD_Bakeador_Dungeons.md) —
  // solo añade la población de enemigos encima, sin duplicar nada de esto.
  protected interior!: InteriorCargado;
  protected opciones!: OpcionesInterior;

  async onCreate(options: OpcionesInterior) {
    if (!options?.mapaId || !options?.edificio) {
      throw new Error("InteriorRoom necesita options.mapaId y options.edificio");
    }
    this.opciones = options;
    this.esInterior = true; // Twitch (docs/GDD_Twitch.md): "Tormenta de rayos" no alcanza aquí dentro
    const rutaArchivo = path.join(rutaDeMapaId(options.mapaId), "interiores", `${options.edificio}.json`);
    this.interior = cargarInterior(rutaArchivo, options.nivel ?? 0);
    this.mundo = this.interior;
    console.log(
      `Interior "${this.interior.id}" nivel=${this.interior.nivel} (${this.interior.rol}): ` +
      `${this.interior.ancho}x${this.interior.alto} casillas, ${this.interior.conectores.length} conector(es)`,
    );
    this.iniciarMovimiento();

    // Vida en interiores (GDD_Agentes_Moviles.md v1.2): si el asentamiento
    // tiene poblacion.json, los NPCs cuya rutina dice "estoy en ESTA casa
    // ahora" aparecen dentro — la familia coincide sola porque comparten
    // edificio y horarios parecidos. Se recalcula cada 20s (no hace falta
    // más: la hora de juego avanza despacio) para que un cambio de tramo
    // mientras el jugador sigue dentro se note (alguien se va a dormir,
    // llega de trabajar...). Sin coste si el bake no trae población.
    const rutaPoblacion = path.join(rutaDeMapaId(options.mapaId), "poblacion.json");
    if (fs.existsSync(rutaPoblacion)) {
      const poblacion = JSON.parse(fs.readFileSync(rutaPoblacion, "utf8")) as { npcs: NpcConCasa[] };
      const repoblar = () =>
        poblarInterior(this.state.npcs, poblacion.npcs, options.edificio, options.nivel ?? 0, this.interior, tiempoMundo().hora);
      repoblar();
      this.clock.setInterval(repoblar, 20_000);
    }

    // Interacción con la escalera/trampilla más cercana -> cambia de
    // planta (otra InteriorRoom, mismo edificio, distinto `nivel`); si no
    // hay ninguna cerca, se trata como la salida del edificio — pero SOLO
    // desde la planta baja: no hay forma de "salir" saltándose las
    // escaleras desde un piso alto o la bodega (regla explícita del
    // usuario: solo puertas exteriores y escaleras son TP).
    this.onMessage("portal:usar", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const conector = this.interior.conectores.find(
        (c) => Math.hypot(c.x + c.huella[0] / 2 - player.x, c.y + c.huella[1] / 2 - player.y) < RADIO_INTERACCION,
      );
      if (conector) {
        client.send("portal:ir", {
          tipo: "interior",
          mapaId: this.opciones.mapaId,
          edificio: this.opciones.edificio,
          nivel: conector.destinoNivel,
          // casilla del conector YA en la rejilla de la planta destino — las
          // plantas no comparten XY, así que la posición de aquí (conector.x/y)
          // no vale para saber dónde aparecer allí (bug real: el jugador
          // aparecía en la coordenada de la escalera de ORIGEN, que en la
          // planta destino podía caer dentro de una pared).
          x: conector.entradaDestino.x,
          y: conector.entradaDestino.y,
        });
        return;
      }
      if (this.interior.rol === "planta_baja") {
        client.send("portal:ir", { tipo: "volver" });
      } else {
        client.send("portal:error", { motivo: "hay que usar la escalera" });
      }
    });

    this.registrarMensajesHabitacion();
  }

  /** id de propiedad del inmueble ENTERO al que pertenece este interior (independiente del nivel/planta). */
  private idInmuebleContenedor(): string {
    return `i_${this.opciones.mapaId}:${this.opciones.edificio}`;
  }

  private idHabitacion(salaIndex: number): string {
    return `h_${this.opciones.mapaId}:${this.opciones.edificio}:${this.interior.nivel}:${salaIndex}`;
  }

  /**
   * Habitaciones SUELTAS de taberna/posada (docs/GDD_Propiedades.md) — no-op
   * si este tipo de edificio no tiene `salasAlquilables` en el catálogo
   * (la inmensa mayoría: viviendas privadas no venden habitaciones sueltas,
   * se venden ENTERAS vía RegionRoom "inmueble:*").
   */
  private registrarMensajesHabitacion() {
    if (!salasAlquilablesPermitidas(this.interior.tipoEdificioId)) return;

    this.onMessage("habitacion:listar", async (client) => {
      const bd = await obtenerBdCompartida();
      const lista = [];
      for (const sala of this.interior.salasIndexadas) {
        const prop = await bd.obtenerPropiedad(this.idHabitacion(sala.salaIndex));
        lista.push({
          salaIndex: sala.salaIndex, tipoSalaId: sala.tipoSalaId,
          dueno: prop?.dueno ?? null,
          modoTenencia: prop?.modoTenencia ?? null,
          precioFarycoins: prop?.precioFarycoins ?? null,
          expiraEn: prop?.expiraEn ?? null,
        });
      }
      client.send("habitacion:lista", lista);
    });

    this.onMessage("habitacion:comprar", (client, msg: { salaIndex?: number }) => this.manejarHabitacionAdquirir(client, msg?.salaIndex, "compra"));
    this.onMessage("habitacion:alquilar", (client, msg: { salaIndex?: number }) => this.manejarHabitacionAdquirir(client, msg?.salaIndex, "alquiler"));

    this.onMessage("habitacion:renovar", async (client, msg: { salaIndex?: number }) => {
      const nombre = this.nombreDe(client);
      const sala = this.salaIndexadaDe(msg?.salaIndex);
      if (!nombre || !sala) return client.send("habitacion:error", { motivo: "habitación desconocida" });
      const precio = precioHabitacion(sala.tipoSalaId, "alquiler");
      if (!precio || precio.periodoHoras == null) return client.send("habitacion:error", { motivo: "esta habitación no se alquila" });
      const bd = await obtenerBdCompartida();
      const r = await bd.renovarTenencia(this.idHabitacion(sala.salaIndex), nombre, precio.periodoHoras, precio.precio);
      if (!r.ok) return client.send("habitacion:error", { motivo: r.motivo });
      this.broadcast("habitacion:actualizada", { salaIndex: sala.salaIndex, dueno: nombre, modoTenencia: "alquiler", expiraEn: r.expiraEn });
    });
  }

  private salaIndexadaDe(salaIndex: number | undefined) {
    return typeof salaIndex === "number" ? this.interior.salasIndexadas.find((s) => s.salaIndex === salaIndex) : undefined;
  }

  private async manejarHabitacionAdquirir(client: Client, salaIndex: number | undefined, modo: "compra" | "alquiler") {
    const sala = this.salaIndexadaDe(salaIndex);
    if (!sala) return client.send("habitacion:error", { motivo: "habitación desconocida" });
    const precio = precioHabitacion(sala.tipoSalaId, modo);
    if (!precio) return client.send("habitacion:error", { motivo: modo === "compra" ? "esta habitación no está en venta" : "esta habitación no se alquila" });

    const r = await this.comprarOAlquilarPropiedad(client, "habitacion:error", {
      id: this.idHabitacion(sala.salaIndex),
      tipo: "habitacion",
      asentamiento: this.opciones.mapaId,
      modo,
      precioFarycoins: precio.precio,
      periodoHoras: precio.periodoHoras,
    });
    if (!r) return;
    const nombre = this.nombreDe(client)!;
    this.broadcast("habitacion:actualizada", { salaIndex: sala.salaIndex, dueno: nombre, modoTenencia: modo, expiraEn: r.expiraEn });
  }

  /**
   * Acceso a viviendas/tiendas COMPRADAS o ALQUILADAS (docs/GDD_Propiedades.md,
   * pedido 2026-08-29: "restringido a dueño + jarl"): solo se gatea si la
   * propiedad TIENE dueño ahora mismo (point-query fresca — resuelve
   * expiración perezosa) — un inmueble nunca tocado, o cuya tenencia venció,
   * sigue abierto a cualquiera como cualquier interior normal.
   */
  async onJoin(client: Client, options: OpcionesInterior) {
    const nombre = options?.name?.slice(0, 20)?.trim();
    const bd = await obtenerBdCompartida();
    const prop = await bd.obtenerPropiedad(this.idInmuebleContenedor());
    if (prop?.dueno) {
      const esDueno = !!nombre && prop.dueno.toLowerCase() === nombre.toLowerCase();
      if (!esDueno && !(nombre && esJarlGlobal(nombre))) {
        throw new ServerError(403, "esta vivienda es privada");
      }
    }

    const x = options?.entradaX ?? this.interior.spawnX;
    const y = options?.entradaY ?? this.interior.spawnY;
    this.crearJugador(client, options, x, y);
  }

  /**
   * "Coger" de interior — sobreescribe el comportamiento de mapaExterior
   * (aquí no hay bake exterior): los objetos "sobre" no tienen casilla
   * propia, se interactúa por la posición del MUEBLE que los sostiene
   * (this.interior.objetosSueltos ya trae esa posición resuelta).
   * Recorrer todo el Map es aceptable aquí — a diferencia del pool
   * exterior (potencialmente decenas de miles de entradas en el mapa
   * principal), el clutter "sobre" de UN edificio es un puñado de objetos.
   */
  protected buscarCogibleEnMundo(x: number, y: number): ObjetoCogible | null {
    let mejorId: string | null = null;
    let mejorDist = Infinity;
    for (const [instanceId, o] of this.interior.objetosSueltos) {
      const d = Math.hypot(o.x + 0.5 - x, o.y + 0.5 - y);
      if (d < RADIO_INTERACCION && d < mejorDist) {
        mejorDist = d;
        mejorId = instanceId;
      }
    }
    if (!mejorId) return null;
    const objetosSueltos = this.interior.objetosSueltos;
    const idElegido = mejorId;
    const o = objetosSueltos.get(idElegido)!;
    return {
      itemId: o.itemId,
      cantidad: 1,
      confirmar: () => {
        objetosSueltos.delete(idElegido);
        this.broadcast("mundo:objetoQuitado", { origen: "interior", instanceId: idElegido });
      },
    };
  }
}
