import { Room, Client } from "@colyseus/core";
import { HubState, Player, ObjetoMundoSchema } from "../schema/HubState";
import { MundoColision, moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ } from "../../mundo/colisiones";
import { MapaCargado } from "../../mundo/mapaColision";
import { recolectableCercano } from "../../mundo/recolectables";
import { CatalogoItems, Contenedor, crearContenedor, cargarCatalogoItems, quitarItem, cargarCatalogoRecetas } from "../../inventario/inventario";
import { intentarCoger, Cogible } from "../../inventario/cogerSoltar";
import { sincronizarContenedor } from "../../inventario/sincronizarSchema";
import { IAlmacenDatos, ModoTenencia, ContratoTransporte } from "../../datos/bd";
import { obtenerBdCompartida } from "../../datos/bdCompartida";
import { IndiceParcelas, runsDe } from "../../construccion/parcelas";
import { cargarCatalogoConstruible, cargarCatalogoPlantillas, EntradaConstruible } from "../../construccion/catalogo";
import {
  ContextoConstruccion,
  validarColocacion,
  aplicarColocacion,
  quitarConstruccion,
  validarColocacionPlantilla,
  esJarl,
  esJarlGlobal,
} from "../../construccion/construccion";
import { generarInteriorEdificio } from "../../construccion/interiorGenerado";
import { resolverProduccion, resolverTransporte, EstadoProduccion, DatosProduccion } from "../../construccion/produccion";
import { ContextoGremios, GremioVivo, obtenerContextoGremios } from "../../gremios/contextoGremios";
import { EMBLEMA_POR_DEFECTO, colorGremioValido, colorPorDefecto, emblemaGremioValido, nombreGremioValido } from "../../gremios/gremios";
import { precioInmueble } from "../../propiedades/propiedades";
import { GestorAgentes, VEL_NPC } from "../../mundo/agentes";
import { tiempoMundo } from "../../mundo/tiempoMundo";
import { calcularCaminoRuntime } from "../../mundo/pathfindingRuntime";
import { potenciaDisponibleEnCasillas, factorVelocidadPorEnergia } from "../../construccion/energia";
import { RecetaCrafteo, EstadoCrafteo, nivelDeXp, validarCrafteo, crafteoListo } from "../../construccion/crafteo";

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

// --- Producción/plantillas del jarl/transporte (docs/GDD_Produccion.md) ---
// Placeholders de balance — mismo criterio que pesoMaximoTransportable
// (inventario.ts): números de referencia a afinar, no decisiones cerradas.
const RADIO_PLANTILLAS_JARL_CASILLAS = Number(process.env.RADIO_PLANTILLAS_JARL_CASILLAS ?? 80);
const COSTE_TRABAJADOR_FARYCOINS = 50;
const CARGA_POR_VIAJE_TRANSPORTE = 10;
const PRECIO_INICIAL_TRANSPORTE_FARYCOINS = 1; // precio de salida al entregar un ítem nunca antes vendido ahí — el dueño lo ajusta con tenderete:fijarPrecio

// --- Crafteo (docs/GDD_Crafteo.md) — placeholder de balance, mismo criterio que el resto ---
const XP_POR_CRAFTEO = 20;

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

/** Agrega las instancias de un contenedor por itemId — docs/GDD_Crafteo.md: validarCrafteo mira "cuánto tienes en total", no en qué pila concreta está. */
function sumarPorItemId(items: { itemId: string; cantidad: number }[]): { itemId: string; cantidad: number }[] {
  const totales = new Map<string, number>();
  for (const it of items) totales.set(it.itemId, (totales.get(it.itemId) ?? 0) + it.cantidad);
  return [...totales.entries()].map(([itemId, cantidad]) => ({ itemId, cantidad }));
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
  /** Nombre del asentamiento pasado a iniciarConstruccion — reusado por plantillas (id "pt_<asentamiento>_<x>_<y>"). */
  protected asentamientoConstruccion?: string;

  // --- Producción/plantillas del jarl/transporte (docs/GDD_Produccion.md) ---
  protected catalogoPlantillas?: Map<string, EntradaConstruible>;
  /** Compartido con los NPC de rutina de poblacion/ (RegionRoom) cuando existen — un único gestor por room, un único tick. */
  protected gestorAgentes?: GestorAgentes;

  // --- Crafteo (docs/GDD_Crafteo.md) ---
  protected catalogoRecetas?: Map<string, RecetaCrafteo>;
  /** Crafteo en curso por sesión — vive y muere con la sesión (mismo criterio que `inventarios`, fase 2 de Inventario): si el jugador se desconecta a medias, se pierde, aceptable en v1. */
  protected craftesEnCurso = new Map<string, EstadoCrafteo>();

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

    // --- producción/plantillas del jarl/transporte (docs/GDD_Produccion.md)
    // — mismo criterio que mercado: disponibles en cualquier room, no-op si
    // esta room no tiene ContextoConstruccion (comprobado dentro de cada handler).
    this.onMessage("produccion:recolectar", (client, msg: { construccionId?: number }) => this.manejarProduccionRecolectar(client, msg));
    this.onMessage("plantilla:colocar", (client, msg: { tipoEdificioId?: string; x?: number; y?: number; rot?: number }) => this.manejarPlantillaColocar(client, msg));
    this.onMessage("plantilla:comprar", (client, msg: { construccionId?: number }) => this.manejarPlantillaComprar(client, msg));
    this.onMessage("plantilla:asignarTrabajador", (client, msg: { construccionId?: number; activo?: boolean }) => this.manejarPlantillaAsignarTrabajador(client, msg));
    this.onMessage("transporte:contratar", (client, msg: { origenConstruccionId?: number; destinoTenderoteId?: string }) => this.manejarTransporteContratar(client, msg));
    this.onMessage("transporte:cancelar", (client, msg: { contratoId?: number }) => this.manejarTransporteCancelar(client, msg));
    this.onMessage("transporte:estado", (client) => this.manejarTransporteEstado(client));

    // --- red motriz (docs/GDD_Motriz.md) — mismo criterio: disponible en
    // cualquier room con ContextoConstruccion, no-op si no lo hay.
    this.onMessage("motriz:accionar", (client, msg: { construccionId?: number; accion?: string; canal?: number }) => this.manejarMotrizAccionar(client, msg));
    this.onMessage("motriz:consultar", (client, msg: { construccionId?: number }) => this.manejarMotrizConsultar(client, msg));

    // --- crafteo (docs/GDD_Crafteo.md) ---
    this.onMessage("refinamiento:depositar", (client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) => this.manejarRefinamientoDepositar(client, msg));
    this.onMessage("crafteo:iniciar", (client, msg: { recetaId?: string; construccionId?: number }) => this.manejarCrafteoIniciar(client, msg));
    this.onMessage("crafteo:recolectar", (client) => this.manejarCrafteoRecolectar(client));

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
    // Producción/plantillas del jarl (docs/GDD_Produccion.md) necesitan el
    // nombre de asentamiento fuera de esta función (para el id de una
    // plantilla nueva, "pt_<asentamiento>_<x>_<y>") — se guarda tal cual,
    // sin tocar el resto de esta función ya probada.
    this.asentamientoConstruccion = asentamiento;
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
    // Una construcción pertenece a ESTA región si su propiedad es una
    // parcela conocida (caso normal) O una plantilla del jarl de ESTE
    // asentamiento (docs/GDD_Produccion.md: "pt_<asentamiento>_x_y" nunca
    // vive en `parcelas.parcelas` — es un mecanismo paralelo, no una
    // parcela) — sin esto, un aserradero desaparecía de `ctx.vivas` (y por
    // tanto de producción/transporte) en cuanto la room se recreaba.
    const prefijoPlantilla = `pt_${asentamiento}_`;
    const guardadas = todasConstrucciones.filter(
      (c) => parcelas.parcelas.has(c.propiedad) || c.propiedad.startsWith(prefijoPlantilla),
    );
    for (const c of guardadas) {
      const entrada = catalogoConstruible.get(c.objeto) ?? cargarCatalogoPlantillas().get(c.objeto);
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
        // Producción (docs/GDD_Produccion.md): el acumulador vive AQUÍ, en
        // memoria de la room — sin propagarlo al recargar, un reinicio de
        // Render (disco efímero, pero la BD no lo es) "olvidaría" toda la
        // producción acumulada aunque siguiera persistida en `extra`.
        extra: c.extra,
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
    await this.resolverContratosDeDestino(msg.tenderoteId);
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
    await this.resolverContratosDeDestino(msg.tenderoteId);
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
    await this.resolverContratosDeDestino(msg.tenderoteId);

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

  // ---- Producción/plantillas del jarl/transporte (docs/GDD_Produccion.md) ----
  // Todo gira sobre `ctxConstruccion.vivas` (construcciones ya existentes:
  // colmenas del "construir" normal, plantillas del jarl) y reusa
  // `duenoDeTenderete` (Mercado) para "quién puede tocar esto", porque una
  // plantilla es una propiedad más en la MISMA tabla `propiedades` — cero
  // concepto nuevo de propiedad, solo de PRODUCCIÓN encima de lo que ya existía.

  private errorProduccion(client: Client, motivo: string) {
    client.send("produccion:error", { motivo });
  }

  private errorPlantilla(client: Client, motivo: string) {
    client.send("plantilla:error", { motivo });
  }

  private errorTransporte(client: Client, motivo: string) {
    client.send("transporte:error", { motivo });
  }

  /** Un único GestorAgentes por room, compartido entre los NPC de rutina de poblacion/ (si los hay) y los transportistas — un solo tick, nunca dos. */
  protected obtenerOCrearGestorAgentes(): GestorAgentes {
    if (!this.gestorAgentes) {
      this.gestorAgentes = new GestorAgentes(this.state.npcs);
      this.clock.setInterval(() => this.gestorAgentes!.tick(0.1, tiempoMundo().hora), 100);
    }
    return this.gestorAgentes;
  }

  /** Busca la entrada de catálogo (construible normal O plantilla) de un objeto ya colocado — una colmena vive en el primero, un aserradero en el segundo. */
  private entradaDe(objeto: string): EntradaConstruible | undefined {
    if (!this.catalogoConstruible) this.catalogoConstruible = cargarCatalogoConstruible();
    if (!this.catalogoPlantillas) this.catalogoPlantillas = cargarCatalogoPlantillas();
    return this.catalogoConstruible.get(objeto) ?? this.catalogoPlantillas.get(objeto);
  }

  /** Posición física de una propiedad (para calcular el camino de un transporte): el punto medio de una parcela, o la casilla de una construcción cuya propiedad coincide (una tienda, p.ej.). `null` si esta room no la conoce. */
  private puntoDePropiedad(propiedadId: string): { x: number; y: number } | null {
    const ctx = this.ctxConstruccion;
    if (!ctx) return null;
    const parcela = ctx.parcelas.parcelas.get(propiedadId);
    if (parcela && parcela.runs.length > 0) {
      const [y, x0, x1] = parcela.runs[0];
      return { x: Math.floor((x0 + x1) / 2), y };
    }
    for (const viva of ctx.vivas.values()) {
      if (viva.propiedad === propiedadId) return { x: viva.x, y: viva.y };
    }
    return null;
  }

  /** Resuelve TODOS los contratos activos que SALEN de esta construcción — llamar antes de leer/mutar su extra.produccion. */
  private async resolverContratosDeOrigen(construccionId: number) {
    if (!this.ctxConstruccion) return;
    const bd = await obtenerBdCompartida();
    const contratos = await bd.listarContratosTransporte();
    for (const contrato of contratos) {
      if (contrato.origenConstruccionId === construccionId) await this.resolverUnContrato(contrato);
    }
  }

  /** Resuelve TODOS los contratos activos que ENTREGAN en este tenderete — llamar antes de leer su stock. */
  private async resolverContratosDeDestino(tenderoteId: string) {
    if (!this.ctxConstruccion) return;
    const bd = await obtenerBdCompartida();
    const contratos = await bd.listarContratosTransporte();
    for (const contrato of contratos) {
      if (contrato.destinoTenderoteId === tenderoteId) await this.resolverUnContrato(contrato);
    }
  }

  /**
   * El corazón del cálculo perezoso de transporte: cuánto se ha producido
   * en el origen desde la última vez (resolverProduccion) + cuántos viajes
   * completos ha hecho el contrato desde entonces (resolverTransporte) — y
   * mueve esa cantidad, entera, de un lado a otro. Nunca se llama por
   * temporizador, solo cuando alguien toca el origen o el destino de verdad.
   */
  private async resolverUnContrato(contrato: ContratoTransporte) {
    const ctx = this.ctxConstruccion;
    if (!ctx) return;
    const origenViva = ctx.vivas.get(contrato.origenConstruccionId);
    if (!origenViva) return; // la construcción de origen ya no existe en ESTA room (recogida, u otra room)

    const datosProduccion = this.entradaDe(origenViva.objeto)?.produccion;
    if (!datosProduccion) return;

    const bd = await obtenerBdCompartida();
    const ahora = Date.now();
    const extraActual = (origenViva.extra ?? {}) as { produccion?: EstadoProduccion; [k: string]: unknown };
    const estadoPrevio: EstadoProduccion = extraActual.produccion ?? { stock: 0, ultimoCalculo: ahora };
    const producidoActualizado = await this.resolverProduccionConInsumos(origenViva.propiedad, estadoPrevio, datosProduccion, ahora);

    const { transportado, nuevoUltimoResuelto } = resolverTransporte(
      new Date(contrato.ultimoViajeResuelto).getTime(),
      ahora,
      { duracionViajeSeg: contrato.duracionViajeSeg, cargaPorViaje: contrato.cargaPorViaje },
      producidoActualizado.stock,
      Infinity, // el tenderete destino no tiene tope propio (docs/GDD_Mercado.md: la lista de venta no limita cantidad)
    );
    const transportadoEntero = Math.floor(transportado);

    if (transportadoEntero <= 0) {
      // igual persiste lo producido hasta ahora, aunque no haya viaje completo todavía
      origenViva.extra = { ...extraActual, produccion: producidoActualizado };
      await bd.actualizarExtraConstruccion(origenViva.id, origenViva.extra);
      return;
    }

    origenViva.extra = { ...extraActual, produccion: { ...producidoActualizado, stock: producidoActualizado.stock - transportadoEntero } };
    await bd.actualizarExtraConstruccion(origenViva.id, origenViva.extra);
    await bd.sumarStockTenderete(contrato.destinoTenderoteId, contrato.itemId, transportadoEntero, PRECIO_INICIAL_TRANSPORTE_FARYCOINS);
    await bd.actualizarUltimoViajeContrato(contrato.id, new Date(nuevoUltimoResuelto).toISOString());
  }

  /** Recoger lo acumulado: dueño o jarl, entra al CUERPO del jugador (mismo mecanismo que "coger"). */
  private async manejarProduccionRecolectar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorProduccion(client, "construcción inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? (await this.duenoDeTenderete(viva.propiedad));
    if (dueno !== nombre && !esJarl(ctx, nombre)) return this.errorProduccion(client, "no eres el dueño de esta construcción");

    const datos = this.entradaDe(viva.objeto)?.produccion;
    if (!datos) return this.errorProduccion(client, "esta construcción no produce nada");

    // lo ya enviado a un tenderete por transporte no debe contarse dos veces
    await this.resolverContratosDeOrigen(viva.id);

    const bd = await obtenerBdCompartida();
    const extraActual = (viva.extra ?? {}) as { produccion?: EstadoProduccion; [k: string]: unknown };
    const estadoPrevio: EstadoProduccion = extraActual.produccion ?? { stock: 0, ultimoCalculo: Date.now() };
    const resuelto = await this.resolverProduccionConInsumos(viva.propiedad, estadoPrevio, datos, Date.now());
    const cantidadEntera = Math.floor(resuelto.stock);

    if (cantidadEntera <= 0) {
      viva.extra = { ...extraActual, produccion: resuelto };
      await bd.actualizarExtraConstruccion(viva.id, viva.extra);
      return this.errorProduccion(client, "todavía no hay nada que recolectar");
    }

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const resultado = intentarCoger(contenedor, this.catalogoItems, { itemId: datos.itemId, cantidad: cantidadEntera });
    if (!resultado.ok) return this.errorProduccion(client, "no tienes hueco en tu inventario");

    const nuevoEstado: EstadoProduccion = { ...resuelto, stock: resuelto.stock - cantidadEntera };
    viva.extra = { ...extraActual, produccion: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);

    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("produccion:estado", {
      construccionId: viva.id, itemId: datos.itemId, cantidad: cantidadEntera,
      stockRestante: nuevoEstado.stock, capacidadMax: datos.capacidadMax,
      trabajadorAsignado: nuevoEstado.trabajadorAsignado ?? null,
    });
  }

  /** Coloca una plantilla — SOLO jarl, dentro del radio a la capital, fuera de cualquier parcela. */
  private async manejarPlantillaColocar(client: Client, msg: { tipoEdificioId?: string; x?: number; y?: number; rot?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx) return;
    if (!this.catalogoPlantillas) this.catalogoPlantillas = cargarCatalogoPlantillas();
    const entrada = msg?.tipoEdificioId ? this.catalogoPlantillas.get(msg.tipoEdificioId) : undefined;
    if (!entrada) return this.errorPlantilla(client, "plantilla desconocida");

    const x = Math.floor(msg.x ?? -1);
    const y = Math.floor(msg.y ?? -1);
    const rot = ((Math.floor(msg.rot ?? 0) % 4) + 4) % 4;
    if (!this.mapaExterior) return this.errorPlantilla(client, "esta región no tiene un punto de referencia de capital");
    const capital = { x: Math.floor(this.mapaExterior.spawnX), y: Math.floor(this.mapaExterior.spawnY) };
    const veredicto = validarColocacionPlantilla(ctx, { nombre, entrada, x, y, rot }, capital, RADIO_PLANTILLAS_JARL_CASILLAS);
    if (!veredicto.ok) return this.errorPlantilla(client, veredicto.motivo);

    const bd = await obtenerBdCompartida();
    const asentamiento = this.asentamientoConstruccion ?? "hub";
    const plantillaId = `pt_${asentamiento}_${x}_${y}`;
    await bd.asignarPropiedad(plantillaId, "plantilla", asentamiento, null);

    const extra: Record<string, unknown> = { interior: generarInteriorEdificio(entrada.id, plantillaId, x, y) };
    if (entrada.produccion) {
      extra.produccion = {
        stock: 0, ultimoCalculo: Date.now(),
        trabajadorAsignado: entrada.produccion.requiereTrabajador ? false : undefined,
      };
    }

    const id = await bd.insertarConstruccion({ propiedad: plantillaId, objeto: entrada.id, categoria: entrada.categoria, x, y, rot, variante: 0, extra });
    aplicarColocacion(ctx, { id, propiedad: plantillaId, objeto: entrada.id, categoria: entrada.categoria, x, y, rot, variante: 0, colision: entrada.colision, huella: entrada.huella, extra });
    this.broadcast("construccion:nueva", { id, propiedad: plantillaId, objeto: entrada.id, categoria: entrada.categoria, x, y, rot, variante: 0 });
    client.send("plantilla:colocada", { construccionId: id, plantillaId });
  }

  /** Compra una plantilla libre — cualquier jugador, mismo mecanismo atómico que Propiedades (comprarOAlquilar). */
  private async manejarPlantillaComprar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorPlantilla(client, "plantilla inexistente");
    const entrada = this.entradaDe(viva.objeto);
    if (!entrada?.plantillaJarl) return this.errorPlantilla(client, "eso no es una plantilla");

    const precio = precioInmueble(entrada.id, "compra");
    if (!precio) return this.errorPlantilla(client, "esta plantilla no está en venta");

    const bd = await obtenerBdCompartida();
    const asentamiento = this.asentamientoConstruccion ?? "hub";
    const r = await bd.comprarOAlquilar({
      id: viva.propiedad, tipo: "plantilla", asentamiento, jugadorNombre: nombre,
      modo: "compra", precioFarycoins: precio.precio, periodoHoras: null,
    });
    if (!r.ok) return this.errorPlantilla(client, r.motivo);
    this.broadcast("plantilla:actualizada", { construccionId: viva.id, dueno: nombre });
  }

  /** Activa/desactiva el trabajador de una plantilla — dueño o jarl, pago único al activar. */
  private async manejarPlantillaAsignarTrabajador(client: Client, msg: { construccionId?: number; activo?: boolean }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorPlantilla(client, "plantilla inexistente");
    const dueno = await this.duenoDeTenderete(viva.propiedad);
    if (!dueno || (dueno.toLowerCase() !== nombre.toLowerCase() && !esJarl(ctx, nombre))) {
      return this.errorPlantilla(client, "no eres el dueño de esta plantilla");
    }
    const datos = this.entradaDe(viva.objeto)?.produccion;
    if (!datos?.requiereTrabajador) return this.errorPlantilla(client, "esta plantilla no necesita trabajador");

    const activo = msg.activo === true;
    const bd = await obtenerBdCompartida();
    const extraActual = (viva.extra ?? {}) as { produccion?: EstadoProduccion; [k: string]: unknown };
    const estadoPrevio: EstadoProduccion = extraActual.produccion ?? { stock: 0, ultimoCalculo: Date.now() };

    if (activo && !estadoPrevio.trabajadorAsignado) {
      const jugador = await bd.obtenerOCrearJugador(nombre);
      const debito = await bd.ajustarFarycoins(jugador.id, -COSTE_TRABAJADOR_FARYCOINS);
      if (!debito.ok) return this.errorPlantilla(client, "no tienes suficientes Farycoins para el trabajador");
    }
    const nuevoEstado: EstadoProduccion = { ...estadoPrevio, trabajadorAsignado: activo, ultimoCalculo: Date.now() };
    viva.extra = { ...extraActual, produccion: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    client.send("plantilla:actualizada", { construccionId: viva.id, trabajadorAsignado: activo });
  }

  private async listadoTransporte(nombre: string) {
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const contratos = await bd.listarContratosTransporte();
    return contratos
      .filter((c) => c.dueno === jugador.id)
      .map((c) => ({
        id: c.id, origenConstruccionId: c.origenConstruccionId, destinoTenderoteId: c.destinoTenderoteId,
        itemId: c.itemId, cargaPorViaje: c.cargaPorViaje, duracionViajeSeg: c.duracionViajeSeg, activo: c.activo,
      }));
  }

  /**
   * Firma un contrato de transporte: origen y destino deben pertenecer AL
   * MISMO jugador (dueño) y a ESTA MISMA room (el A* solo conoce su propia
   * rejilla — transportar entre dos regiones distintas no está soportado
   * en v1). El camino se calcula UNA VEZ aquí y se cachea para siempre.
   */
  private async manejarTransporteContratar(client: Client, msg: { origenConstruccionId?: number; destinoTenderoteId?: string }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.origenConstruccionId !== "number" || !msg.destinoTenderoteId) return;

    const origenViva = ctx.vivas.get(msg.origenConstruccionId);
    if (!origenViva) return this.errorTransporte(client, "construcción de origen inexistente");
    const duenoOrigen = ctx.propiedades.get(origenViva.propiedad)?.dueno ?? (await this.duenoDeTenderete(origenViva.propiedad));
    if (!duenoOrigen || duenoOrigen.toLowerCase() !== nombre.toLowerCase()) return this.errorTransporte(client, "no eres el dueño del origen");

    const duenoDestino = await this.duenoDeTenderete(msg.destinoTenderoteId);
    if (!duenoDestino || duenoDestino.toLowerCase() !== nombre.toLowerCase()) return this.errorTransporte(client, "no eres el dueño del destino");

    const datos = this.entradaDe(origenViva.objeto)?.produccion;
    if (!datos) return this.errorTransporte(client, "el origen no produce nada transportable");

    const origenPunto = { x: origenViva.x, y: origenViva.y };
    const destinoPunto = this.puntoDePropiedad(msg.destinoTenderoteId);
    if (!destinoPunto) return this.errorTransporte(client, "destino desconocido en esta región");

    const caminoIda = calcularCaminoRuntime(this.mundo, origenPunto, destinoPunto);
    if (!caminoIda || caminoIda.length < 2) return this.errorTransporte(client, "no hay camino posible hasta el destino");
    const caminoVuelta = [...caminoIda].reverse();
    const duracionViajeSeg = Math.max(5, caminoIda.length / VEL_NPC);

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const contrato = await bd.crearContratoTransporte({
      origenConstruccionId: origenViva.id, destinoTenderoteId: msg.destinoTenderoteId, dueno: jugador.id,
      itemId: datos.itemId, caminoIda, caminoVuelta, duracionViajeSeg, cargaPorViaje: CARGA_POR_VIAJE_TRANSPORTE,
    });

    // paseo visual: NPC dedicado en bucle origen↔destino (cosmético, el
    // cálculo económico de arriba no depende de que "llegue" de verdad)
    this.obtenerOCrearGestorAgentes().agregarAgenteTransportista(
      `contrato:${contrato.id}`, `Carretero de ${nombre}`, origenPunto, destinoPunto, caminoIda, caminoVuelta,
    );

    client.send("transporte:estado", await this.listadoTransporte(nombre));
  }

  private async manejarTransporteCancelar(client: Client, msg: { contratoId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || typeof msg?.contratoId !== "number") return;
    const bd = await obtenerBdCompartida();
    const contratos = await bd.listarContratosTransporte();
    const contrato = contratos.find((c) => c.id === msg.contratoId);
    if (!contrato) return this.errorTransporte(client, "contrato inexistente");
    const jugador = await bd.obtenerOCrearJugador(nombre);
    if (contrato.dueno !== jugador.id && !(ctx && esJarl(ctx, nombre))) {
      return this.errorTransporte(client, "no eres el dueño de este contrato");
    }
    await bd.desactivarContratoTransporte(contrato.id);
    this.gestorAgentes?.quitarAgente(`contrato:${contrato.id}`);
    client.send("transporte:estado", await this.listadoTransporte(nombre));
  }

  private async manejarTransporteEstado(client: Client) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    client.send("transporte:estado", await this.listadoTransporte(nombre));
  }

  // ---- Red motriz (docs/GDD_Motriz.md) ----
  // Sin tabla ni tick nuevos: el BFS de potencia (potenciaDisponibleEnCasillas,
  // construccion/energia.ts) recorre `ctxConstruccion.ocupacion`, que ya
  // existe. Lo único mutable aquí es `ConstruccionViva.extra` (frenado/
  // canalActivo de una palanca) — se persiste solo al accionar, nunca poleado.

  private errorMotriz(client: Client, motivo: string) {
    client.send("motriz:error", { motivo });
  }

  /** Frena/desfrena o cambia el canal de una palanca — dueño de la propiedad (parcela) o jarl. */
  private async manejarMotrizAccionar(client: Client, msg: { construccionId?: number; accion?: string; canal?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorMotriz(client, "pieza inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? null;
    if (dueno !== nombre && !esJarl(ctx, nombre)) {
      return this.errorMotriz(client, "no eres el dueño de esta propiedad");
    }

    const en = this.entradaDe(viva.objeto)?.energia;
    const extraActual = (viva.extra ?? {}) as { frenado?: boolean; canalActivo?: number; [k: string]: unknown };

    let nuevoExtra: Record<string, unknown>;
    if (msg.accion === "frenar" || msg.accion === "desfrenar") {
      if (!en?.interrumpible) return this.errorMotriz(client, "esta pieza no tiene palanca de freno");
      nuevoExtra = { ...extraActual, frenado: msg.accion === "frenar" };
    } else if (msg.accion === "seleccionarCanal") {
      if (en?.canales === undefined) return this.errorMotriz(client, "esta pieza no tiene palanca de cambios");
      const canal = Math.floor(msg.canal ?? -1);
      if (canal < 0 || canal >= en.canales) return this.errorMotriz(client, "canal inválido");
      nuevoExtra = { ...extraActual, canalActivo: canal };
    } else {
      return this.errorMotriz(client, "acción desconocida");
    }

    const bd = await obtenerBdCompartida();
    viva.extra = nuevoExtra;
    await bd.actualizarExtraConstruccion(viva.id, nuevoExtra);
    this.broadcast("motriz:estado", { construccionId: viva.id, extra: nuevoExtra });
  }

  /**
   * Lectura opcional (docs/GDD_Motriz.md §mensajesColyseus): sin sistema de
   * crafteo aún que consuma `factorVelocidadPorEnergia` de verdad, esto deja
   * al jugador VER si su red está bien montada — puro round-trip, sin
   * estado ni coste de fondo, solo al cliente que preguntó.
   */
  private async manejarMotrizConsultar(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorMotriz(client, "pieza inexistente");
    if (!this.catalogoConstruible) this.catalogoConstruible = cargarCatalogoConstruible();
    const resultado = potenciaDisponibleEnCasillas(ctx, this.catalogoConstruible, viva.claves);
    client.send("motriz:respuesta", { construccionId: viva.id, disponible: resultado.disponible, fuentes: resultado.fuentes });
  }

  // ---- Crafteo (docs/GDD_Crafteo.md) ----
  // Dos capas: refinamiento PASIVO (una plantilla con `produccion.insumos`
  // consume lo que el jugador deposita, igual que Producción pero con
  // insumo real) y crafteo ACTIVO (el jugador dispara la acción en su mesa,
  // consume de SU inventario, tarda un tiempo). Ninguna de las dos usa tick.

  private errorRefinamiento(client: Client, motivo: string) {
    client.send("refinamiento:error", { motivo });
  }

  private errorCrafteo(client: Client, motivo: string) {
    client.send("crafteo:error", { motivo });
  }

  /**
   * Envoltorio async de resolverProduccion: si `datos.insumos` existe, lee
   * el stock actual del almacén de la construcción (misma tabla
   * `tenderete_items`, tenderoteId = su propia propiedad — el jugador la
   * llena con "refinamiento:depositar") y descuenta lo consumido tras
   * resolver. Sin insumos, delega directo — comportamiento IDÉNTICO a antes
   * (colmena, y cualquier plantilla que no declare insumos).
   */
  private async resolverProduccionConInsumos(
    propiedadId: string,
    estadoPrevio: EstadoProduccion,
    datos: DatosProduccion,
    ahoraMs: number,
  ): Promise<EstadoProduccion> {
    if (!datos.insumos || datos.insumos.length === 0) {
      return resolverProduccion(estadoPrevio, datos, ahoraMs);
    }
    const bd = await obtenerBdCompartida();
    const stockActual = await bd.listarStockTenderete(propiedadId);
    const disponibles = new Map(stockActual.map((s) => [s.itemId, s.cantidad]));
    const resuelto = resolverProduccion(estadoPrevio, datos, ahoraMs, disponibles);
    const producido = resuelto.stock - estadoPrevio.stock;
    if (producido > 0) {
      for (const insumo of datos.insumos) {
        const consumir = producido * insumo.cantidadPorUnidad;
        if (consumir > 0) await bd.consumirStockTenderete(propiedadId, insumo.itemId, consumir);
      }
    }
    return resuelto;
  }

  /** Deposita insumo crudo del CUERPO del jugador al almacén de una plantilla de refinamiento — dueño o jarl, mismo mecanismo que "tenderete:reponer" pero sin precio. */
  private async manejarRefinamientoDepositar(client: Client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number" || typeof msg.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorRefinamiento(client, "construcción inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? (await this.duenoDeTenderete(viva.propiedad));
    if (dueno !== nombre && !esJarl(ctx, nombre)) return this.errorRefinamiento(client, "no eres el dueño de esta construcción");

    const datos = this.entradaDe(viva.objeto)?.produccion;
    if (!datos?.insumos) return this.errorRefinamiento(client, "esta construcción no admite insumos");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it) return this.errorRefinamiento(client, "no tienes ese objeto");
    if (!datos.insumos.some((i) => i.itemId === it.itemId)) return this.errorRefinamiento(client, "esta construcción no acepta ese insumo");
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));
    const itemId = it.itemId;

    const itemsAntes = contenedor.items.map((i) => ({ ...i }));
    const siguienteIdAntes = contenedor.siguienteId;
    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) return this.errorRefinamiento(client, resultado.motivo ?? "no se pudo depositar");

    const bd = await obtenerBdCompartida();
    try {
      await bd.sumarStockTenderete(viva.propiedad, itemId, cantidad, 0);
    } catch (e) {
      contenedor.items = itemsAntes;
      contenedor.siguienteId = siguienteIdAntes;
      throw e;
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("refinamiento:estado", { construccionId: viva.id, insumos: await bd.listarStockTenderete(viva.propiedad) });
  }

  /**
   * Inicia un crafteo activo: valida mesa+nivel+insumos (validarCrafteo,
   * pura), descuenta los insumos del inventario YA (no al final — mismo
   * criterio que reservar el coste de una acción antes de tardar en
   * completarla, evita que el jugador gaste el material en otra cosa
   * mientras espera), y calcula `terminaEn` UNA VEZ con el multiplicador de
   * energía de la mesa en ese instante — nunca se recalcula mientras está
   * en curso, ni siquiera si la red motriz cambia entretanto.
   */
  private async manejarCrafteoIniciar(client: Client, msg: { recetaId?: string; construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || !msg?.recetaId || typeof msg.construccionId !== "number") return;
    if (this.craftesEnCurso.has(client.sessionId)) return this.errorCrafteo(client, "ya tienes un crafteo en curso");

    if (!this.catalogoRecetas) this.catalogoRecetas = cargarCatalogoRecetas();
    const receta = this.catalogoRecetas.get(msg.recetaId);
    if (!receta) return this.errorCrafteo(client, "receta desconocida");

    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCrafteo(client, "mesa inexistente");

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const xp = await bd.obtenerXpOficio(jugador.id, receta.oficio);

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const inventario = sumarPorItemId(contenedor.items);
    const veredicto = validarCrafteo(receta, viva.objeto, xp, inventario);
    if (!veredicto.ok) return this.errorCrafteo(client, veredicto.motivo);

    // descuenta los insumos AHORA — instanciaId a instanciaId, por si el
    // mismo itemId está repartido en varias pilas del inventario
    for (const insumo of receta.insumos) {
      let restante = insumo.cantidad;
      for (const it of [...contenedor.items]) {
        if (restante <= 0) break;
        if (it.itemId !== insumo.itemId) continue;
        const quitar = Math.min(restante, it.cantidad);
        quitarItem(contenedor, it.id, quitar);
        restante -= quitar;
      }
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    if (!this.catalogoConstruible) this.catalogoConstruible = cargarCatalogoConstruible();
    const factor = factorVelocidadPorEnergia(ctx, this.catalogoConstruible, { objeto: viva.objeto, claves: viva.claves });
    const duracionMs = (receta.tiempoBaseSeg / Math.max(0.01, factor)) * 1000;
    const terminaEn = Date.now() + duracionMs;
    this.craftesEnCurso.set(client.sessionId, { recetaId: receta.id, terminaEn });
    client.send("crafteo:iniciado", { recetaId: receta.id, terminaEn });
  }

  /** Recoge el resultado de un crafteo en curso — no-op amable si todavía no ha terminado. */
  private async manejarCrafteoRecolectar(client: Client) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    const estado = this.craftesEnCurso.get(client.sessionId);
    if (!estado) return this.errorCrafteo(client, "no tienes ningún crafteo en curso");
    if (!crafteoListo(estado, Date.now())) return this.errorCrafteo(client, "todavía no está listo");

    if (!this.catalogoRecetas) this.catalogoRecetas = cargarCatalogoRecetas();
    const receta = this.catalogoRecetas.get(estado.recetaId);
    this.craftesEnCurso.delete(client.sessionId);
    if (!receta) return; // la receta se quitó del catálogo entre medias — nada que entregar, insumos ya se perdieron (mismo riesgo que cualquier estado en memoria de sesión)

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const resultado = intentarCoger(contenedor, this.catalogoItems, { itemId: receta.resultado.itemId, cantidad: receta.resultado.cantidad });
    if (!resultado.ok) return this.errorCrafteo(client, "no tienes hueco en tu inventario");

    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const nuevaXp = await bd.sumarXpOficio(jugador.id, receta.oficio, XP_POR_CRAFTEO);
    client.send("crafteo:completado", {
      recetaId: receta.id, itemId: receta.resultado.itemId, cantidad: receta.resultado.cantidad,
      oficio: receta.oficio, xp: nuevaXp, nivel: nivelDeXp(nuevaXp),
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
