import { Room, Client } from "@colyseus/core";
import { HubState, Player, ObjetoMundoSchema } from "../schema/HubState";
import { MundoColision, moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ } from "../../mundo/colisiones";
import { MapaCargado } from "../../mundo/mapaColision";
import { recolectableCercano } from "../../mundo/recolectables";
import { CatalogoItems, Contenedor, crearContenedor, cargarCatalogoItems, quitarItem } from "../../inventario/inventario";
import { intentarCoger, Cogible } from "../../inventario/cogerSoltar";
import { sincronizarContenedor } from "../../inventario/sincronizarSchema";
import { IAlmacenDatos } from "../../datos/bd";
import { obtenerBdCompartida } from "../../datos/bdCompartida";
import { IndiceParcelas, runsDe } from "../../construccion/parcelas";
import { cargarCatalogoConstruible, EntradaConstruible } from "../../construccion/catalogo";
import {
  ContextoConstruccion,
  validarColocacion,
  aplicarColocacion,
  quitarConstruccion,
  esJarl,
} from "../../construccion/construccion";
import { generarInteriorEdificio } from "../../construccion/interiorGenerado";

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
