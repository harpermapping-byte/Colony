import { Room, Client } from "@colyseus/core";
import { HubState, Player, ObjetoMundoSchema } from "../schema/HubState";
import { MundoColision, moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ } from "../../mundo/colisiones";
import { MapaCargado } from "../../mundo/mapaColision";
import { recolectableCercano } from "../../mundo/recolectables";
import { CatalogoItems, Contenedor, crearContenedor, cargarCatalogoItems, quitarItem } from "../../inventario/inventario";
import { intentarCoger, Cogible } from "../../inventario/cogerSoltar";
import { sincronizarContenedor } from "../../inventario/sincronizarSchema";
import { IAlmacenDatos, ModoTenencia } from "../../datos/bd";
import { obtenerBdCompartida } from "../../datos/bdCompartida";
import { IndiceParcelas, runsDe } from "../../construccion/parcelas";
import { cargarCatalogoConstruible, EntradaConstruible } from "../../construccion/catalogo";
import {
  ContextoConstruccion,
  validarColocacion,
  aplicarColocacion,
  quitarConstruccion,
  esJarl,
  esJarlGlobal,
} from "../../construccion/construccion";
import { generarInteriorEdificio } from "../../construccion/interiorGenerado";
import { ContextoGremios, GremioVivo, obtenerContextoGremios } from "../../gremios/contextoGremios";
import { EMBLEMA_POR_DEFECTO, colorGremioValido, colorPorDefecto, emblemaGremioValido, nombreGremioValido } from "../../gremios/gremios";

const VEL_ANDAR = 3.75;
const VEL_NADAR = 2.2;
const VEL_BUCEAR = 1.7;
export const TICK_HZ = 30;

/** Radio de interacción para portales Y para "coger" (fase 2 de inventario) —
 * antes repetido como 2.2 mágico en 3 sitios distintos (un portal por room),
 * ahora una única constante compartida. */
export const RADIO_INTERACCION = 2.2;

const ANCHO_CUERPO = 8;
const ALTO_CUERPO = 6;

/** Lo que hay para coger en un punto: cuánto entra al inventario y qué hacer con la FUENTE si entró. */
export interface ObjetoCogible extends Cogible {
  confirmar: () => void;
}

export interface Direccion {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Base común de las rooms de MOVIMIENTO LIBRE sobre una rejilla de
 * colisión (Hub, regiones/aldeas, interiores de edificio — docs/
 * GDD_Sistema_Puertas.md): input/movimiento/nadar-bucear/empuje PJ-PJ.
 * Cada subclase carga SU rejilla (exterior bakeada o interior de un
 * edificio) y llama a `iniciarMovimiento()` desde `onCreate`.
 */
export abstract class RoomExteriorBase extends Room<HubState> {
  maxClients = 40;
  protected inputs = new Map<string, Direccion>();
  protected mundo!: MundoColision;

  // --- inventario, fase 2 "coger/soltar" (docs/GDD_Inventario.md §7) ---
  // Contenedor PURO por sesión — fuente de verdad para agregarItem/quitarItem
  // (player.inventario.cuerpo, el Schema, es solo el espejo de red — se
  // sincroniza explícitamente tras cada mutación, ver sincronizarSchema.ts).
  // Sin persistencia ni jugador_id esta fase (alcance explícito del GDD):
  // vive y muere con la sesión, igual que `inputs`.
  protected inventarios = new Map<string, Contenedor>();
  protected catalogoItems: CatalogoItems = cargarCatalogoItems();
  private siguienteObjetoMundoId = 1;
  // Asignado por HubRoom/RegionRoom tras cargar su mapa — habilita "coger" de
  // recolectables del bake exterior sin que esta base conozca su tipo
  // concreto de room; InteriorRoom en cambio sobreescribe buscarCogibleEnMundo.
  protected mapaExterior?: MapaCargado;

  // --- construcción/parcelas/jarl (docs/GDD_Construccion.md) ---
  // Antes SOLO en HubRoom; con construcción-en-regiones (docs/
  // GDD_Ciudad_Capital.md §3bis, ciudad capital como RegionRoom con reglas
  // especiales) cualquier subclase puede llamar a iniciarConstruccion() si
  // su mapa trae parcelas — undefined = esta room no tiene construcción
  // (la inmensa mayoría de aldeas/POIs, sin `parcelasReservadas` en el bake).
  protected ctxConstruccion?: ContextoConstruccion;
  protected catalogoConstruible?: Map<string, EntradaConstruible>;
  protected bdConstruccion?: IAlmacenDatos;

  protected iniciarMovimiento() {
    this.setState(new HubState());
    this.setPatchRate(1000 / 15);

    this.onMessage("input", (client, dir: Direccion) => {
      this.inputs.set(client.sessionId, {
        x: clamp(dir?.x ?? 0, -1, 1),
        y: clamp(dir?.y ?? 0, -1, 1),
      });
    });

    this.onMessage("nivel", (client, delta: number) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const medio = medioEn(this.mundo, player.x, player.y);
      const minimo = nivelMinimo(medio);
      if (minimo === 0) return; // en tierra (o en un interior, sin agua) no hay niveles
      player.nivel = clamp(player.nivel + (delta > 0 ? 1 : -1), minimo, 0);
    });

    this.onMessage("coger", (client) => this.manejarCoger(client));
    this.onMessage("soltar", (client, msg: { instanciaId?: number; cantidad?: number }) => this.manejarSoltar(client, msg));

    // --- gremios (docs/GDD_Gremios.md) — disponibles en las 4 rooms, no
    // dependen de ContextoConstruccion/parcelas (a diferencia de "construir"),
    // solo de la BD compartida.
    this.onMessage("gremio:fundar", (client, msg: { nombre?: string }) => this.manejarGremioFundar(client, msg));
    this.onMessage("gremio:invitar", (client, msg: { jugadorNombre?: string }) => this.manejarGremioInvitar(client, msg));
    this.onMessage("gremio:aceptarInvitacion", (client, msg: { gremioId?: number }) => this.manejarGremioAceptarInvitacion(client, msg));
    this.onMessage("gremio:rechazarInvitacion", (client, msg: { gremioId?: number }) => this.manejarGremioRechazarInvitacion(client, msg));
    this.onMessage("gremio:expulsar", (client, msg: { jugadorNombre?: string }) => this.manejarGremioExpulsar(client, msg));
    this.onMessage("gremio:abandonar", (client) => this.manejarGremioAbandonar(client));
    this.onMessage("gremio:disolver", (client) => this.manejarGremioDisolver(client));
    this.onMessage("gremio:actualizar", (client, msg: { color?: string; emblemaId?: string }) => this.manejarGremioActualizar(client, msg));
    this.onMessage("gremio:depositar", (client, msg: { cantidad?: number }) => this.manejarGremioDepositar(client, msg));
    this.onMessage("gremio:retirar", (client, msg: { cantidad?: number }) => this.manejarGremioRetirar(client, msg));
    this.onMessage("gremio:estado", (client) => this.manejarGremioEstado(client));

    // --- mercado (docs/GDD_Mercado.md) — un tenderete vive SOBRE una
    // propiedad que el emisor YA posee (parcela asignada por el jarl, vía
    // ContextoConstruccion si esta room lo tiene — Hub o capital —, o
    // inmueble/habitación comprado vía GDD_Propiedades.md, vía BD). Mismos
    // 5 mensajes disponibles en cualquier room: RegionRoom/HubRoom para
    // tenderetes sobre parcela, InteriorRoom para tenderetes dentro de un
    // inmueble propio.
    this.onMessage("tenderete:escaparate", (client, msg: { tenderoteId?: string }) => this.manejarTenderoteEscaparate(client, msg));
    this.onMessage("tenderete:gestion", (client, msg: { tenderoteId?: string }) => this.manejarTenderoteGestion(client, msg));
    this.onMessage("tenderete:reponer", (client, msg: { tenderoteId?: string; instanciaId?: number; cantidad?: number; precioFarycoins?: number }) => this.manejarTenderoteReponer(client, msg));
    this.onMessage("tenderete:fijarPrecio", (client, msg: { tenderoteId?: string; itemId?: string; precioFarycoins?: number }) => this.manejarTenderoteFijarPrecio(client, msg));
    this.onMessage("tenderete:comprar", (client, msg: { tenderoteId?: string; itemId?: string; cantidad?: number }) => this.manejarTenderoteComprar(client, msg));

    this.setSimulationInterval(() => this.actualizarMovimiento(), 1000 / TICK_HZ);
  }

  protected nombreDe(client: Client): string | undefined {
    return this.state.players.get(client.sessionId)?.name;
  }

  protected crearJugador(client: Client, options: { name?: string }, x: number, y: number): Player {
    const player = new Player();
    player.x = x;
    player.y = y;
    player.name = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { x: 0, y: 0 });

    const contenedor = crearContenedor(ANCHO_CUERPO, ALTO_CUERPO);
    this.inventarios.set(client.sessionId, contenedor);
    sincronizarContenedor(player.inventario.cuerpo, contenedor); // sin esto el Schema se queda en ancho=0/alto=0 (bug real, ver crítica del diseño)

    return player;
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.inventarios.delete(client.sessionId);
  }

  /**
   * "Coger" sin payload: auto-apunta al interactuable más cercano dentro de
   * RADIO_INTERACCION (mismo criterio que "portal:usar" — el cliente no
   * tiene UI de targeting hoy). Prioridad: lo soltado por otros jugadores
   * (objetosMundo, universal a las 4 rooms vía HubState) antes que lo del
   * bake — caso raro de empate exacto, aceptado.
   *
   * Orden crítico (fijado tras la crítica adversarial del diseño): la fuente
   * NUNCA se borra antes de confirmar que agregarItem tuvo éxito. Como este
   * handler es 100% síncrono (memoria pura, sin ningún `await` de por medio
   * — decisión explícita de esta fase, ver GDD §7), no hay ninguna ventana
   * en la que un segundo "coger" pueda colarse entre "encontrar" y "borrar":
   * el propio single-thread de Colyseus basta para que sea atómico.
   */
  private manejarCoger(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;

    const candidato = this.buscarObjetoSoltadoCercano(player.x, player.y) ?? this.buscarCogibleEnMundo(player.x, player.y);
    if (!candidato) {
      client.send("coger:error", { motivo: "nada_cerca" });
      return;
    }

    const resultado = intentarCoger(contenedor, this.catalogoItems, candidato);
    if (!resultado.ok) {
      client.send("coger:error", { motivo: resultado.motivo ?? "sin_hueco" });
      return;
    }
    candidato.confirmar();
    sincronizarContenedor(player.inventario.cuerpo, contenedor);
  }

  /** Objeto soltado por CUALQUIER jugador (HubState.objetosMundo, compartido por las 4 rooms) más cercano dentro del radio. Universal: no requiere que la subclase sepa nada. */
  private buscarObjetoSoltadoCercano(x: number, y: number): ObjetoCogible | null {
    let mejorId: string | null = null;
    let mejorDist = Infinity;
    this.state.objetosMundo.forEach((o, id) => {
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < RADIO_INTERACCION && d < mejorDist) {
        mejorDist = d;
        mejorId = id;
      }
    });
    if (!mejorId) return null;
    const objetosMundo = this.state.objetosMundo;
    const idElegido = mejorId as string;
    const o = objetosMundo.get(idElegido)!;
    return {
      itemId: o.itemId,
      cantidad: o.cantidad,
      confirmar: () => objetosMundo.delete(idElegido), // MapSchema: el delete YA se replica solo a todos, sin broadcast manual
    };
  }

  /**
   * Recolectables del BAKE exterior — por defecto usa `mapaExterior` (Hub/
   * Region, tras cargar su mapa); InteriorRoom sobreescribe esto para sus
   * objetos "sobre" en vez de heredar este comportamiento.
   */
  protected buscarCogibleEnMundo(x: number, y: number): ObjetoCogible | null {
    if (!this.mapaExterior) return null;
    const encontrado = recolectableCercano(this.mapaExterior.recolectables, this.mapaExterior.ancho, x, y, RADIO_INTERACCION);
    if (!encontrado) return null;
    const mapa = this.mapaExterior;
    return {
      itemId: encontrado.item.itemId,
      cantidad: 1,
      confirmar: () => {
        mapa.recolectables.delete(encontrado.idx);
        this.broadcast("mundo:objetoQuitado", { origen: "exterior", x: encontrado.item.x, y: encontrado.item.y });
      },
    };
  }

  /**
   * "Soltar" — SOLO desde `cuerpo`, la pila ENTERA de una instancia (soltar
   * cantidad parcial es UI que no existe todavía, fuera de alcance de esta
   * fase). `quitarItem` ya es atómico por sí solo (falla sin tocar nada), no
   * hace falta el snapshot/restauración que sí necesita "coger".
   */
  private manejarSoltar(client: Client, msg: { instanciaId?: number; cantidad?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (typeof msg?.instanciaId !== "number") return;

    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it) {
      client.send("soltar:error", { motivo: "no_encontrado" });
      return;
    }
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));
    const itemId = it.itemId;

    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) {
      client.send("soltar:error", { motivo: resultado.motivo ?? "no_encontrado" });
      return;
    }

    const o = new ObjetoMundoSchema();
    o.x = Math.floor(player.x) + 0.5;
    o.y = Math.floor(player.y) + 0.5;
    o.itemId = itemId;
    o.cantidad = cantidad;
    this.state.objetosMundo.set(String(this.siguienteObjetoMundoId++), o); // MapSchema: se replica solo, incluida la foto inicial a quien se una después

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
  }

  /**
   * Construcción/parcelas/jarl (docs/GDD_Construccion.md §4-§5) — antes solo
   * vivía en HubRoom; generalizado para construcción-en-regiones (docs/
   * GDD_Ciudad_Capital.md §3bis): la ciudad capital es una RegionRoom
   * NORMAL, con `parcelasReservadas` ya bakeadas y las mismas reglas de
   * construcción que el Hub — "reglas especiales" dentro del mismo tipo de
   * room, no un sistema aparte. Cualquier otra aldea/POI sin parcelas
   * simplemente nunca llama a este método — cero cambio de comportamiento.
   *
   * `parcelas`/`asentamiento` los resuelve el llamador (Hub: parcelas.json
   * del mapa principal; Region: rasterizado de `parcelasReservadas` del bake
   * — server/src/construccion/parcelas.ts) — este método es agnóstico a de
   * dónde vienen, igual que `construccion.ts` (ContextoConstruccion) ya lo es.
   */
  protected async iniciarConstruccion(parcelas: IndiceParcelas, asentamiento: string) {
    const bd = await obtenerBdCompartida();
    this.bdConstruccion = bd;
    if (!this.catalogoConstruible) this.catalogoConstruible = cargarCatalogoConstruible();
    const catalogoConstruible = this.catalogoConstruible;

    const jarls = new Set(
      (process.env.JARL_NOMBRES ?? "")
        .split(",")
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n.length > 0),
    );

    // cargarPropiedades()/listarConstrucciones() traen TODA la BD (todos los
    // asentamientos comparten las mismas tablas) — se filtra a lo que cae
    // dentro de LAS PARCELAS de este mapa, nunca por nombre de asentamiento
    // a pelo (evita depender de un esquema de ids consistente entre Hub y
    // regiones).
    const recargarPropiedades = async () => {
      const todas = await bd.cargarPropiedades();
      return new Map([...todas].filter(([id]) => parcelas.parcelas.has(id)));
    };

    const ctx: ContextoConstruccion = {
      mapa: this.mundo,
      // copia del bake ANTES de endurecer construcciones: es lo que se
      // restaura al recoger (una casilla vuelve a ser lo que era)
      casillasBase: this.mundo.casillas.slice(),
      parcelas,
      propiedades: await recargarPropiedades(),
      ocupacion: new Map(),
      vivas: new Map(),
      conteoPorPropiedad: new Map(),
      jarls,
    };
    this.ctxConstruccion = ctx;

    const todasConstrucciones = await bd.listarConstrucciones();
    const guardadas = todasConstrucciones.filter((c) => parcelas.parcelas.has(c.propiedad));
    for (const c of guardadas) {
      const entrada = catalogoConstruible.get(c.objeto);
      if (!entrada) {
        console.warn(`Construcción ${c.id} ("${c.objeto}") ya no está en el catálogo — sin colisión`);
      }
      aplicarColocacion(ctx, {
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
      `Construcción (${asentamiento}): ${ctx.parcelas.parcelas.size} parcelas, ` +
      `${guardadas.length} construcciones cargadas, ${jarls.size} jarl(s)`,
    );

    this.onMessage("parcela:asignar", async (client, msg: { parcelaId?: string; nombreJugador?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !esJarl(ctx, nombre)) return this.errorConstruir(client, "solo el jarl asigna parcelas");
      const parcela = msg?.parcelaId ? ctx.parcelas.parcelas.get(msg.parcelaId) : undefined;
      if (!parcela || !msg.parcelaId || !msg.nombreJugador) return this.errorConstruir(client, "parcela o jugador inválidos");
      await bd.asignarPropiedad(msg.parcelaId, "parcela", parcela.asentamiento, msg.nombreJugador);
      ctx.propiedades = await recargarPropiedades();
      this.broadcast("parcelas:estado", this.estadoParcelas());
    });

    this.onMessage("parcela:revocar", async (client, msg: { parcelaId?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !esJarl(ctx, nombre)) return this.errorConstruir(client, "solo el jarl revoca parcelas");
      if (!msg?.parcelaId || !ctx.parcelas.parcelas.has(msg.parcelaId)) {
        return this.errorConstruir(client, "parcela inválida");
      }
      // las construcciones QUEDAN (pasan con la parcela al jarl — decisión v1, GDD §4)
      await bd.revocarPropiedad(msg.parcelaId);
      ctx.propiedades = await recargarPropiedades();
      this.broadcast("parcelas:estado", this.estadoParcelas());
    });

    this.onMessage(
      "construir",
      async (client, msg: { objeto?: string; categoria?: string; x?: number; y?: number; rot?: number; variante?: number }) => {
        const nombre = this.nombreDe(client);
        if (!nombre) return;
        const entrada = msg?.objeto ? catalogoConstruible.get(msg.objeto) : undefined;
        if (!entrada || entrada.categoria !== msg.categoria) {
          return this.errorConstruir(client, "objeto no construible");
        }
        const x = Math.floor(msg.x ?? -1), y = Math.floor(msg.y ?? -1);
        const rot = ((Math.floor(msg.rot ?? 0) % 4) + 4) % 4;
        const variante = Math.floor(msg.variante ?? 0);

        const veredicto = validarColocacion(ctx, { nombre, entrada, x, y, rot });
        if (!veredicto.ok) return this.errorConstruir(client, veredicto.motivo);
        const propiedadId = veredicto.parcelaId;

        // la parcela puede no tener fila aún (nunca asignada): se crea sin
        // dueño para que la FK de construcciones apunte a algo real
        if (!ctx.propiedades.has(propiedadId)) {
          const parcela = ctx.parcelas.parcelas.get(propiedadId)!;
          await bd.asignarPropiedad(propiedadId, "parcela", parcela.asentamiento, null);
          ctx.propiedades.set(propiedadId, { dueno: null });
        }

        // edificio: su interior se genera UNA VEZ aquí y viaja en extra (§5)
        let extra: Record<string, unknown> | null = null;
        if (entrada.categoria === "edificio") {
          extra = { interior: generarInteriorEdificio(entrada.id, propiedadId, x, y) };
        }

        const id = await bd.insertarConstruccion({
          propiedad: propiedadId,
          objeto: entrada.id,
          categoria: entrada.categoria,
          x, y, rot, variante,
          extra,
        });
        aplicarColocacion(ctx, {
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
      const viva = typeof msg?.construccionId === "number" ? ctx.vivas.get(msg.construccionId) : undefined;
      if (!viva) return this.errorConstruir(client, "construcción inexistente");
      const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? null;
      if (dueno !== nombre && !esJarl(ctx, nombre)) {
        return this.errorConstruir(client, "no eres el dueño de esta construcción");
      }
      await bd.borrarConstruccion(viva.id);
      quitarConstruccion(ctx, viva.id); // restaura la colisión del bake
      this.broadcast("construccion:quitada", { id: viva.id });
    });
  }

  /** Los rechazos van SOLO al emisor (GDD §4). */
  protected errorConstruir(client: Client, motivo: string) {
    client.send("construir:error", { motivo });
  }

  /** { [parcelaId]: { dueno } } + runs para que el cliente pinte bordes. */
  protected estadoParcelas() {
    const ctx = this.ctxConstruccion!;
    const estado: Record<string, { dueno: string | null; runs: [number, number, number][] }> = {};
    for (const parcelaId of ctx.parcelas.parcelas.keys()) {
      estado[parcelaId] = {
        dueno: ctx.propiedades.get(parcelaId)?.dueno ?? null,
        runs: runsDe(ctx.parcelas, parcelaId),
      };
    }
    return estado;
  }

  /** Estado de construcción al entrar (GDD §4) — llamar desde onJoin SOLO si esta room tiene construcción habilitada. */
  protected enviarEstadoConstruccion(client: Client) {
    if (!this.ctxConstruccion) return;
    client.send("parcelas:estado", this.estadoParcelas());
    client.send(
      "construcciones:lista",
      [...this.ctxConstruccion.vivas.values()].map((c) => ({
        id: c.id, propiedad: c.propiedad, objeto: c.objeto, categoria: c.categoria,
        x: c.x, y: c.y, rot: c.rot, variante: c.variante,
      })),
    );
  }

  // ---- Gremios (docs/GDD_Gremios.md) ----

  private errorGremio(client: Client, motivo: string) {
    client.send("gremio:error", { motivo });
  }

  private gremioDeJugador(ctx: ContextoGremios, jugadorId: number): GremioVivo | undefined {
    const id = ctx.porJugador.get(jugadorId);
    return id !== undefined ? ctx.porId.get(id) : undefined;
  }

  /** Etiqueta pública (Player Schema) — visible a cualquiera en la room, como un nametag. */
  private aplicarEtiquetaGremio(player: Player, gremio: GremioVivo | null) {
    player.gremioId = gremio ? String(gremio.id) : "";
    player.gremioNombre = gremio ? gremio.nombre : "";
    player.gremioColor = gremio ? gremio.color : "";
    player.gremioEmblemaId = gremio ? gremio.emblemaId : "";
  }

  /** El Client de un jugador por NOMBRE si está conectado a ESTA room ahora mismo (undefined si no). */
  private clientDeJugador(nombre: string): Client | undefined {
    return this.clients.find((c) => this.state.players.get(c.sessionId)?.name === nombre);
  }

  /** Detalle completo (roster con nombres, banco) — SOLO por mensaje privado, nunca por Schema pública. */
  private async detalleGremio(bd: IAlmacenDatos, gremio: GremioVivo) {
    const miembros = await bd.listarMiembros(gremio.id);
    return {
      id: gremio.id,
      nombre: gremio.nombre,
      color: gremio.color,
      emblemaId: gremio.emblemaId,
      saldoBanco: gremio.saldoBanco,
      liderJugadorId: gremio.liderJugadorId,
      miembros: miembros.map((m) => ({ jugadorNombre: m.jugadorNombre, rol: m.rol, ingresoEn: m.ingresoEn })),
    };
  }

  private async manejarGremioFundar(client: Client, msg: { nombre?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.nombre) return;
    const validacion = nombreGremioValido(msg.nombre);
    if (!validacion.ok) return this.errorGremio(client, validacion.motivo!);

    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    if (ctx.porJugador.has(jugador.id)) return this.errorGremio(client, "ya perteneces a un gremio");

    const nombreLimpio = msg.nombre.trim();
    if (ctx.porNombreLower.has(nombreLimpio.toLowerCase())) return this.errorGremio(client, "ese nombre de gremio ya existe");

    const resultado = await bd.crearGremio(nombreLimpio, jugador.id, colorPorDefecto(), EMBLEMA_POR_DEFECTO);
    if (!resultado.ok) return this.errorGremio(client, resultado.motivo);

    const vivo: GremioVivo = {
      id: resultado.gremio.id,
      nombre: resultado.gremio.nombre,
      liderJugadorId: jugador.id,
      color: resultado.gremio.color,
      emblemaId: resultado.gremio.emblemaId,
      saldoBanco: 0,
      miembros: new Map([[jugador.id, "lider"]]),
    };
    ctx.porId.set(vivo.id, vivo);
    ctx.porNombreLower.set(vivo.nombre.toLowerCase(), vivo.id);
    ctx.porJugador.set(jugador.id, vivo.id);

    const player = this.state.players.get(client.sessionId);
    if (player) this.aplicarEtiquetaGremio(player, vivo);
    client.send("gremio:estado", await this.detalleGremio(bd, vivo));
  }

  private async manejarGremioInvitar(client: Client, msg: { jugadorNombre?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.jugadorNombre) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio || gremio.liderJugadorId !== jugador.id) return this.errorGremio(client, "solo el líder invita");

    const objetivoNombre = msg.jugadorNombre.trim();
    if (!objetivoNombre || objetivoNombre.toLowerCase() === nombre.toLowerCase()) {
      return this.errorGremio(client, "no puedes invitarte a ti mismo");
    }
    const objetivo = await bd.obtenerOCrearJugador(objetivoNombre);
    if (ctx.porJugador.has(objetivo.id)) return this.errorGremio(client, "ese jugador ya está en un gremio");

    await bd.crearInvitacion(gremio.id, objetivo.id, jugador.id);
    const clienteObjetivo = this.clientDeJugador(objetivoNombre);
    if (clienteObjetivo) {
      clienteObjetivo.send("gremio:invitacionRecibida", { gremioId: gremio.id, gremioNombre: gremio.nombre, invitadoPor: nombre });
    }
    client.send("gremio:estado", await this.detalleGremio(bd, gremio));
  }

  private async manejarGremioAceptarInvitacion(client: Client, msg: { gremioId?: number }) {
    const nombre = this.nombreDe(client);
    if (!nombre || typeof msg?.gremioId !== "number") return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    if (ctx.porJugador.has(jugador.id)) return this.errorGremio(client, "ya perteneces a un gremio");

    const invitacion = await bd.obtenerInvitacion(msg.gremioId, jugador.id);
    if (!invitacion) return this.errorGremio(client, "no tienes ninguna invitación de ese gremio");
    const gremio = ctx.porId.get(msg.gremioId);
    if (!gremio) return this.errorGremio(client, "ese gremio ya no existe");

    await bd.agregarMiembro(gremio.id, jugador.id, "miembro");
    await bd.eliminarInvitacion(gremio.id, jugador.id);
    gremio.miembros.set(jugador.id, "miembro");
    ctx.porJugador.set(jugador.id, gremio.id);

    const player = this.state.players.get(client.sessionId);
    if (player) this.aplicarEtiquetaGremio(player, gremio);
    client.send("gremio:estado", await this.detalleGremio(bd, gremio));
  }

  private async manejarGremioRechazarInvitacion(client: Client, msg: { gremioId?: number }) {
    const nombre = this.nombreDe(client);
    if (!nombre || typeof msg?.gremioId !== "number") return;
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    await bd.eliminarInvitacion(msg.gremioId, jugador.id);
  }

  private async manejarGremioExpulsar(client: Client, msg: { jugadorNombre?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.jugadorNombre) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio || gremio.liderJugadorId !== jugador.id) return this.errorGremio(client, "solo el líder expulsa");

    const objetivoNombre = msg.jugadorNombre.trim();
    if (objetivoNombre.toLowerCase() === nombre.toLowerCase()) {
      return this.errorGremio(client, "no puedes expulsarte a ti mismo (usa disolver)");
    }
    const objetivo = await bd.obtenerOCrearJugador(objetivoNombre);
    if (ctx.porJugador.get(objetivo.id) !== gremio.id) return this.errorGremio(client, "ese jugador no es miembro de tu gremio");

    await bd.quitarMiembro(gremio.id, objetivo.id);
    gremio.miembros.delete(objetivo.id);
    ctx.porJugador.delete(objetivo.id);

    const clienteObjetivo = this.clientDeJugador(objetivoNombre);
    if (clienteObjetivo) {
      const playerObjetivo = this.state.players.get(clienteObjetivo.sessionId);
      if (playerObjetivo) this.aplicarEtiquetaGremio(playerObjetivo, null);
    }
    client.send("gremio:estado", await this.detalleGremio(bd, gremio));
  }

  private async manejarGremioAbandonar(client: Client) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio) return this.errorGremio(client, "no perteneces a ningún gremio");
    if (gremio.liderJugadorId === jugador.id) return this.errorGremio(client, "el líder no puede abandonar, usa disolver");

    await bd.quitarMiembro(gremio.id, jugador.id);
    gremio.miembros.delete(jugador.id);
    ctx.porJugador.delete(jugador.id);

    const player = this.state.players.get(client.sessionId);
    if (player) this.aplicarEtiquetaGremio(player, null);
  }

  private async manejarGremioDisolver(client: Client) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio || gremio.liderJugadorId !== jugador.id) return this.errorGremio(client, "solo el líder disuelve el gremio");

    await bd.disolverGremio(gremio.id);
    ctx.porId.delete(gremio.id);
    ctx.porNombreLower.delete(gremio.nombre.toLowerCase());
    for (const jugadorId of gremio.miembros.keys()) ctx.porJugador.delete(jugadorId);

    // limpiar la etiqueta de cualquier miembro conectado a ESTA room ahora mismo
    const idTexto = String(gremio.id);
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (p && p.gremioId === idTexto) this.aplicarEtiquetaGremio(p, null);
    }
  }

  private async manejarGremioActualizar(client: Client, msg: { color?: string; emblemaId?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio || gremio.liderJugadorId !== jugador.id) return this.errorGremio(client, "solo el líder cambia color/emblema");

    const cambios: { color?: string; emblemaId?: string } = {};
    if (msg?.color !== undefined) {
      if (!colorGremioValido(msg.color)) return this.errorGremio(client, "color fuera de la paleta");
      cambios.color = msg.color;
    }
    if (msg?.emblemaId !== undefined) {
      if (!emblemaGremioValido(msg.emblemaId)) return this.errorGremio(client, "emblema desconocido");
      cambios.emblemaId = msg.emblemaId;
    }
    if (Object.keys(cambios).length === 0) return;

    await bd.actualizarGremio(gremio.id, cambios);
    if (cambios.color !== undefined) gremio.color = cambios.color;
    if (cambios.emblemaId !== undefined) gremio.emblemaId = cambios.emblemaId;

    const idTexto = String(gremio.id);
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (p && p.gremioId === idTexto) this.aplicarEtiquetaGremio(p, gremio);
    }
    client.send("gremio:estado", await this.detalleGremio(bd, gremio));
  }

  private async manejarGremioDepositar(client: Client, msg: { cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const cantidad = Math.floor(msg?.cantidad ?? 0);
    if (!nombre || !(cantidad > 0)) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio) return this.errorGremio(client, "no perteneces a ningún gremio");

    const debito = await bd.ajustarFarycoins(jugador.id, -cantidad);
    if (!debito.ok) return this.errorGremio(client, "no tienes suficientes Farycoins");
    const credito = await bd.ajustarBancoGremio(gremio.id, cantidad);
    if (!credito.ok) {
      // no debería ocurrir (el banco solo crece aquí) — deshace el débito si pasa
      await bd.ajustarFarycoins(jugador.id, cantidad);
      return this.errorGremio(client, "no se pudo depositar");
    }
    gremio.saldoBanco = credito.saldo;
    client.send("gremio:estado", await this.detalleGremio(bd, gremio));
  }

  private async manejarGremioRetirar(client: Client, msg: { cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const cantidad = Math.floor(msg?.cantidad ?? 0);
    if (!nombre || !(cantidad > 0)) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);
    if (!gremio || gremio.liderJugadorId !== jugador.id) return this.errorGremio(client, "solo el líder retira del banco (v1)");

    const debito = await bd.ajustarBancoGremio(gremio.id, -cantidad);
    if (!debito.ok) return this.errorGremio(client, "el banco no tiene suficiente saldo");
    gremio.saldoBanco = debito.saldo;
    await bd.ajustarFarycoins(jugador.id, cantidad);
    client.send("gremio:estado", await this.detalleGremio(bd, gremio));
  }

  private async manejarGremioEstado(client: Client) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const gremio = this.gremioDeJugador(ctx, jugador.id);

    // sincroniza la etiqueta pública al pedir estado — cubre el caso de un
    // jugador que YA pertenecía a un gremio de una sesión anterior y esta
    // room/sesión todavía no lo sabía (ver nota en HubState.ts).
    const player = this.state.players.get(client.sessionId);
    if (player) this.aplicarEtiquetaGremio(player, gremio ?? null);

    client.send("gremio:estado", gremio ? await this.detalleGremio(bd, gremio) : null);
  }

  // ---- Propiedades comerciales (docs/GDD_Propiedades.md) ----
  // Compartido entre RegionRoom (inmuebles enteros) e InteriorRoom
  // (habitaciones de taberna/posada) — la única diferencia entre ambas es el
  // esquema de id y de dónde sale el precio; el flujo de cobro/cesión es el
  // MISMO (bd.comprarOAlquilar ya es todo-o-nada). `canalError` porque cada
  // room usa su propio namespace de mensajes ("inmueble:error"/"habitacion:error").

  /** `null` si falló (ya se le mandó el error al cliente) o si no hay jugador identificado. */
  protected async comprarOAlquilarPropiedad(
    client: Client,
    canalError: string,
    params: { id: string; tipo: "inmueble" | "habitacion"; asentamiento: string; modo: ModoTenencia; precioFarycoins: number; periodoHoras: number | null },
  ): Promise<{ ok: true; saldoRestante: number; expiraEn: string | null } | null> {
    const nombre = this.nombreDe(client);
    if (!nombre) return null;
    const bd = await obtenerBdCompartida();
    const r = await bd.comprarOAlquilar({ ...params, jugadorNombre: nombre });
    if (!r.ok) {
      client.send(canalError, { motivo: r.motivo });
      return null;
    }
    return r;
  }

  // ---- Mercado (docs/GDD_Mercado.md) ----
  // Un tenderete NO es una entidad propia: vive SOBRE una propiedad que su
  // dueño ya tiene (parcela asignada por el jarl, o inmueble/habitación
  // comprado — GDD_Propiedades.md). `duenoDeTenderete` resuelve "quién puede
  // gestionar esto" mirando PRIMERO el ContextoConstruccion de esta room (si
  // lo tiene — Hub o capital, parcelas) y si no cae a la BD (inmuebles,
  // habitaciones, o parcelas de OTRA room sin ctx propio) — misma propiedad,
  // dos caminos de lectura porque una vive en caché de room y la otra no.

  private errorTenderete(client: Client, motivo: string) {
    client.send("tenderete:error", { motivo });
  }

  protected async duenoDeTenderete(tenderoteId: string): Promise<string | null> {
    if (this.ctxConstruccion?.propiedades.has(tenderoteId)) {
      return this.ctxConstruccion.propiedades.get(tenderoteId)!.dueno;
    }
    const bd = await obtenerBdCompartida();
    const prop = await bd.obtenerPropiedad(tenderoteId);
    return prop?.dueno ?? null;
  }

  /** Público — cualquiera puede pedirlo. Cantidad exacta NUNCA viaja aquí (solo disponible:bool) — lo detallado es privado (gestion). */
  private async manejarTenderoteEscaparate(client: Client, msg: { tenderoteId?: string }) {
    if (!msg?.tenderoteId) return;
    const bd = await obtenerBdCompartida();
    const stock = await bd.listarStockTenderete(msg.tenderoteId);
    client.send("tenderete:escaparate", {
      tenderoteId: msg.tenderoteId,
      items: stock.map((s) => ({ itemId: s.itemId, precioFarycoins: s.precioFarycoins, disponible: s.cantidad > 0 })),
    });
  }

  /** Privado — solo dueño o jarl: cantidades EXACTAS ("solo lo ve el dueño y el admin", pedido explícito). */
  private async manejarTenderoteGestion(client: Client, msg: { tenderoteId?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.tenderoteId) return;
    const dueno = await this.duenoDeTenderete(msg.tenderoteId);
    if (!dueno || (dueno.toLowerCase() !== nombre.toLowerCase() && !esJarlGlobal(nombre))) {
      return this.errorTenderete(client, "no tienes permiso para gestionar este tenderete");
    }
    const bd = await obtenerBdCompartida();
    client.send("tenderete:gestion", { tenderoteId: msg.tenderoteId, items: await bd.listarStockTenderete(msg.tenderoteId) });
  }

  /**
   * Reponer: solo el dueño, saca del CUERPO (en memoria, misma fuente que
   * "soltar") por instancia — snapshot+restaura si algo falla a medias,
   * mismo mecanismo que intentarCoger/manejarSoltar.
   */
  private async manejarTenderoteReponer(
    client: Client,
    msg: { tenderoteId?: string; instanciaId?: number; cantidad?: number; precioFarycoins?: number },
  ) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.tenderoteId || typeof msg.instanciaId !== "number") return;
    const precio = Math.floor(msg.precioFarycoins ?? 0);
    if (!(precio > 0)) return this.errorTenderete(client, "precio inválido");

    const dueno = await this.duenoDeTenderete(msg.tenderoteId);
    if (!dueno || dueno.toLowerCase() !== nombre.toLowerCase()) {
      return this.errorTenderete(client, "no eres el dueño de este tenderete");
    }

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it) return this.errorTenderete(client, "no tienes ese objeto");
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));
    const itemId = it.itemId;

    const itemsAntes = contenedor.items.map((i) => ({ ...i }));
    const siguienteIdAntes = contenedor.siguienteId;
    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) return this.errorTenderete(client, resultado.motivo ?? "no se pudo reponer");

    const bd = await obtenerBdCompartida();
    try {
      await bd.reponerStockTenderete(msg.tenderoteId, itemId, cantidad, precio);
    } catch (e) {
      contenedor.items = itemsAntes;
      contenedor.siguienteId = siguienteIdAntes;
      throw e;
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("tenderete:gestion", { tenderoteId: msg.tenderoteId, items: await bd.listarStockTenderete(msg.tenderoteId) });
  }

  /** Solo cambia el precio de un ítem YA repuesto — no toca cantidad. */
  private async manejarTenderoteFijarPrecio(client: Client, msg: { tenderoteId?: string; itemId?: string; precioFarycoins?: number }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.tenderoteId || !msg.itemId) return;
    const precio = Math.floor(msg.precioFarycoins ?? 0);
    if (!(precio > 0)) return this.errorTenderete(client, "precio inválido");

    const dueno = await this.duenoDeTenderete(msg.tenderoteId);
    if (!dueno || dueno.toLowerCase() !== nombre.toLowerCase()) {
      return this.errorTenderete(client, "no eres el dueño de este tenderete");
    }
    const bd = await obtenerBdCompartida();
    const ok = await bd.fijarPrecioTenderete(msg.tenderoteId, msg.itemId, precio);
    if (!ok) return this.errorTenderete(client, "ese ítem no está en venta aquí — repón stock primero");
    client.send("tenderete:gestion", { tenderoteId: msg.tenderoteId, items: await bd.listarStockTenderete(msg.tenderoteId) });
  }

  /**
   * Comprar: cualquiera salvo el propio dueño. La compra en BD (cobro +
   * stock + abono al vendedor) es todo-o-nada por sí sola; si DESPUÉS de
   * cobrar el cuerpo del comprador no tiene hueco (raro, pero el cuerpo es
   * independiente de la BD), se compensa devolviendo Farycoins Y stock —
   * mismo espíritu que el resto de compensaciones del proyecto.
   */
  private async manejarTenderoteComprar(client: Client, msg: { tenderoteId?: string; itemId?: string; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !msg?.tenderoteId || !msg.itemId) return;
    const cantidad = Math.max(1, Math.floor(msg.cantidad ?? 1));

    const dueno = await this.duenoDeTenderete(msg.tenderoteId);
    if (!dueno) return this.errorTenderete(client, "este tenderete no tiene dueño");
    if (dueno.toLowerCase() === nombre.toLowerCase()) return this.errorTenderete(client, "no puedes comprarte a ti mismo");

    const bd = await obtenerBdCompartida();
    const r = await bd.comprarDeTenderete({ tenderoteId: msg.tenderoteId, itemId: msg.itemId, cantidad, compradorNombre: nombre, duenoNombre: dueno });
    if (!r.ok) return this.errorTenderete(client, r.motivo);

    const contenedor = this.inventarios.get(client.sessionId);
    const resultado = contenedor ? intentarCoger(contenedor, this.catalogoItems, { itemId: msg.itemId, cantidad }) : { ok: false as const };
    if (!resultado.ok) {
      // compensar: el cuerpo no tenía hueco — devolver Farycoins Y stock (al MISMO precio que ya tenía)
      const comprador = await bd.obtenerOCrearJugador(nombre);
      await bd.ajustarFarycoins(comprador.id, r.precioTotal);
      const stockActual = await bd.listarStockTenderete(msg.tenderoteId);
      const precioActual = stockActual.find((s) => s.itemId === msg.itemId)?.precioFarycoins ?? 0;
      await bd.reponerStockTenderete(msg.tenderoteId, msg.itemId, cantidad, precioActual);
      return this.errorTenderete(client, "no tienes hueco en tu inventario");
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor!);
    client.send("tenderete:compraResultado", {
      ok: true, tenderoteId: msg.tenderoteId, itemId: msg.itemId, cantidad,
      precioTotal: r.precioTotal, saldoRestante: r.saldoRestante,
    });
  }

  private actualizarMovimiento() {
    const dt = 1 / TICK_HZ;
    this.inputs.forEach((dir, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) return;

      const idx = Math.floor(player.y) * this.mundo.ancho + Math.floor(player.x);
      const medio = medioEn(this.mundo, player.x, player.y);
      let vel: number;
      if (medio === TIPO.AGUA || medio === TIPO.AGUA_PROFUNDA) {
        vel = player.nivel < 0 ? VEL_BUCEAR : VEL_NADAR;
      } else {
        vel = VEL_ANDAR * (this.mundo.velocidad[idx] ?? 1);
      }

      if (dir.x !== 0 || dir.y !== 0) {
        const norma = Math.hypot(dir.x, dir.y);
        const paso = (vel * dt) / norma;
        const destino = moverAABB(this.mundo, player.x, player.y, dir.x * paso, dir.y * paso);
        player.x = destino.x;
        player.y = destino.y;
      }

      const medioAhora = medioEn(this.mundo, player.x, player.y);
      if (medioAhora === TIPO.TIERRA || medioAhora === TIPO.SOLIDO) {
        player.nivel = 0;
        player.estado = "tierra";
      } else {
        player.nivel = clamp(player.nivel, nivelMinimo(medioAhora), 0);
        player.estado = player.nivel < 0 ? "buceando" : "nadando";
      }
    });

    const cuerpos = [...this.state.players.values()];
    separarPJs(this.mundo, cuerpos, RADIO_PJ);
  }
}
