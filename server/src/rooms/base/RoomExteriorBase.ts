import { Room, Client, Delayed } from "@colyseus/core";
import { HubState, Player, ObjetoMundoSchema, MarcadorCombateSchema, Mascota, Fauna } from "../schema/HubState";
import { CombateSchema, CombateUnidad } from "../schema/CombateState";
import { RosterArena, RetornoJugador, registrarRosterArena } from "../../combate/registroArenas";
import { cargarCatalogoArenas, elegirArena } from "../../combate/seleccionArena";
import { MundoColision, moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ, tipoEn } from "../../mundo/colisiones";
import {
  UnidadCombate,
  Bando,
  calcularIniciativa,
  enAlcance,
  jugarTurnoIA,
  ordenarTurnos,
  resolverAtaque,
} from "../../combate/arenaCombate";
import { Arena, costeCasilla } from "../../combate/pathfindingArena";
import { MapaCargado } from "../../mundo/mapaColision";
import { recolectableCercano } from "../../mundo/recolectables";
import { CatalogoItems, Contenedor, crearContenedor, cargarCatalogoItems, quitarItem, cargarCatalogoRecetas, excedePesoMaximo } from "../../inventario/inventario";
import { intentarCoger, Cogible } from "../../inventario/cogerSoltar";
import { sincronizarContenedor } from "../../inventario/sincronizarSchema";
import { IAlmacenDatos, ModoTenencia, ContratoTransporte, Mascota as MascotaFila, UbicacionMascota } from "../../datos/bd";
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
import { temperaturaMundo, Estacion } from "../../mundo/clima";
import { calcularCaminoRuntime } from "../../mundo/pathfindingRuntime";
import { potenciaDisponibleEnCasillas, factorVelocidadPorEnergia } from "../../construccion/energia";
import { RecetaCrafteo, EstadoCrafteo, nivelDeXp, validarCrafteo, crafteoListo } from "../../construccion/crafteo";
import { tickVitales, restaurarVital, aplicarInanicion, aplicarTemperaturaCorporal, VITAL_MAX } from "../../personaje/vitales";
import { Atributo, esAtributoValido } from "../../personaje/atributos";
import { UMBRALES_NIVEL_ATRIBUTO } from "../../progresion/nivel";
import {
  pesoMaximoTransportable,
  vidaMaximaPorResistencia,
  paMaxPorDestreza,
  factorVelocidadCrafteo,
  descuentoComercio,
} from "../../personaje/bonusAtributos";
import { curar } from "../../combate/combate";
import { RoomConectable, registrarRoom, quitarRoom, registrarJugador, quitarJugador } from "../../twitch/registro";
import { obtenerGestorTwitch } from "../../twitch/gestorTwitch";
import { TipoEvento } from "../../twitch/catalogoEventos";

const VEL_ANDAR = 3.75;
const VEL_CORRER = 6; // sprint (docs/GDD_Personaje.md §3.4) — gasta estamina, en tierra solamente
const VEL_NADAR = 2.2;
const VEL_BUCEAR = 1.7;
const ESTAMINA_GASTO_POR_SEG_CORRIENDO = 15; // vacía los 100 de estamina en ~6.7s de sprint continuo
export const TICK_HZ = 30;

/** Radio de interacción para portales Y para "coger" (fase 2 de inventario) —
 * antes repetido como 2.2 mágico en 3 sitios distintos (un portal por room),
 * ahora una única constante compartida. */
export const RADIO_INTERACCION = 2.2;

const ANCHO_CUERPO = 8;
const ALTO_CUERPO = 6;

// --- Combate táctico (docs/GDD_Combate.md, ✅ confirmado 2026-08-30) ---
// PA fijo para toda unidad — placeholder de balance (mismo criterio que el
// resto de números de referencia del proyecto): el árbol de
// habilidades/clases que lo variaría por unidad queda fuera de esta
// pasada (GDD §6, "trabajo posterior, como las recetas de Crafteo"). Un
// solo pool (§9.3) del que salen mover/atacar/objeto/magia — sustituye al
// AP+MP separado de la primera pasada.
export const PA_MAX_COMBATE = 6;
/** Coste fijo de un golpe con lo que se lleve equipado — placeholder, a afinar cuando exista árbol de habilidades. */
const COSTE_PA_ATAQUE = 2;
/** Coste fijo de usar un objeto (personaje:consumir) en el turno propio — mismo criterio que un golpe. */
const COSTE_PA_OBJETO = 2;
const LADO_ARENA_NORMAL = 8;
const LADO_ARENA_BOSS = 10;
const TOPE_RONDAS_CASCADA_IA = 60; // guarda-raíl: nunca debe hacer falta, pero evita un bucle infinito si algo queda mal configurado
// Ventana de unión antes de instanciar la arena (docs/GDD_Combate.md §9.1,
// pedido 2026-08-30) — placeholder de balance, mismo criterio que el resto.
const VENTANA_UNION_COMBATE_MS = 60_000;

// --- Producción/plantillas del jarl/transporte (docs/GDD_Produccion.md) ---
// Placeholders de balance — mismo criterio que pesoMaximoTransportable
// (inventario.ts): números de referencia a afinar, no decisiones cerradas.
const RADIO_PLANTILLAS_JARL_CASILLAS = Number(process.env.RADIO_PLANTILLAS_JARL_CASILLAS ?? 80);
const COSTE_TRABAJADOR_FARYCOINS = 50;
const CARGA_POR_VIAJE_TRANSPORTE = 10;
const PRECIO_INICIAL_TRANSPORTE_FARYCOINS = 1; // precio de salida al entregar un ítem nunca antes vendido ahí — el dueño lo ajusta con tenderete:fijarPrecio

// --- Crafteo (docs/GDD_Crafteo.md) — placeholder de balance, mismo criterio que el resto ---
const XP_POR_CRAFTEO = 20;

// --- Atributos (docs/GDD_Personaje.md §3.2, pedido 2026-08-30: "que cada
// atributo tenga varias formas de sacar exp") — cada atributo tiene AL
// MENOS 2 disparadores independientes (Carisma, tras fusionar Comercio
// dentro, tiene 4). Números de referencia, mismo criterio "placeholder de
// balance" que el resto — pensados para la curva de 10 niveles
// (UMBRALES_NIVEL_ATRIBUTO, tope 4500 XP): a este ritmo, el máximo pide
// cientos de acciones, no un puñado.
const XP_FUERZA_POR_RECOLECTA_PESADA = 2; // "talando/minando cosas con herramientas" — coger algo pesado del mundo
const PESO_MINIMO_FUERZA = 2; // solo objetos "pesados" (piedra, madera...) cuentan — coger una pluma no entrena fuerza
const XP_FUERZA_POR_GOLPE_CONECTADO = 1; // "dando golpes" — un golpe cuerpo a cuerpo también entrena fuerza, además de destreza
const XP_DESTREZA_POR_GOLPE_CONECTADO = 3;
const XP_DESTREZA_POR_MOVER_EN_COMBATE = 1; // moverse por la arena entrena reflejos/agilidad
const XP_INTELIGENCIA_POR_CRAFTEO = 4;
const XP_INTELIGENCIA_POR_RECOLECTAR = 1; // "todas las que tengan crafteo también crafteando o recolectando" — identificar y extraer un recurso también enseña
const XP_RESISTENCIA_POR_GOLPE_RECIBIDO = 2; // "recibir golpes" entrena aguante — encajar daño en combate
// "corres X tiempo y andas X cantidad de tiempo también" (pedido 2026-08-30)
// — tiempo REAL acumulado, no de mundo (mismo criterio que vitales.ts).
// Correr entrena más rápido que andar (umbral más corto, más XP): es el
// esfuerzo que de verdad gasta estamina.
const SEGUNDOS_CORRER_POR_XP_RESISTENCIA = 10;
const XP_RESISTENCIA_POR_INTERVALO_CORRIENDO = 3;
const SEGUNDOS_ANDAR_POR_XP_RESISTENCIA = 30;
const XP_RESISTENCIA_POR_INTERVALO_ANDANDO = 1;
const XP_CARISMA_POR_FUNDAR_GREMIO = 30; // mismo valor que antes tenía Liderazgo — fundar un gremio sigue siendo un acto social mayor
// Comercio fusionado dentro de Carisma (pedido 2026-08-30) — comprar/vender es tan "social" como hablar o fundar un gremio.
const XP_CARISMA_POR_COMPRAR = 2;
const XP_CARISMA_POR_REPONER = 3; // reponer/vender en tu propio tenderete entrena algo más que comprar

// --- Twitch: eventos de puntos de canal (docs/GDD_Twitch.md, catálogo real
// en twitch/catalogoEventos.ts) — placeholders de balance, mismo criterio
// "número de referencia" que el resto del proyecto. ---
const MODIFICADOR_CORRALITO = 0.3; // sube el precio de compra un 30% mientras dure
const MODIFICADOR_MERCADO_OFERTA = 0.2; // baja el precio de compra un 20% mientras dure
const PROB_RAYO_POR_SEG = 0.03; // ~1 impacto cada ~33s por jugador expuesto, de sobra en una tormenta de varios minutos
const DANO_RAYO = 25;
const PROB_TERREMOTO_POR_SEG = 0.04;
const DANO_TERREMOTO = 12; // más frecuente que el rayo pero más flojo — un temblor sacude, no fulmina
const VIDA_RATA = 8;
const ATAQUE_RATA = 1; // "poca vida poco daño" — molestan, no matan (pedido literal)
const RATAS_POR_JUGADOR = 10;
const DURACION_PLAGA_RATAS_MS = 120_000;

// --- Higiene y sueño en cama (docs/GDD_Personaje.md §3.6, pedido explícito
// 2026-08-30) — placeholders de balance, mismo criterio que el resto ---
/** "un tiempo limitado, no estarse horas" — dormir en cama recupera Estamina entera al cabo de esto (tiempo REAL, mismo criterio que el sprint). */
const DURACION_DORMIR_MS = 20_000;
/** Inanición (comida o bebida a 0): daño paulatino a `vida` por hora REAL — EXCEPCIÓN deliberada a "nadie se hace daño solo con el tiempo" (combate.ts), pedida por el streamer, ver aplicarInanicion(). */
const DANO_INANICION_POR_HORA = 8;

// --- Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30) — el seguimiento
// vive aquí (cualquier room); "dar de comer"/domesticar vive en RegionRoom
// (única room con fauna urbana). Placeholder de balance. ---
const VEL_MASCOTA = 3.4; // ligeramente más lenta que VEL_ANDAR — sigue, no adelanta
const DIST_SEGUIMIENTO_MASCOTA = 1.3; // separación objetivo respecto al dueño
const DIST_TELEPORT_MASCOTA = 15; // el dueño cambió de sitio de golpe (portal/spawn) — no perseguir media room a pie

/** Lo que hay para coger en un punto: cuánto entra al inventario y qué hacer con la FUENTE si entró. */
export interface ObjetoCogible extends Cogible {
  confirmar: () => void;
}

export interface Direccion {
  x: number;
  y: number;
  /** Pedido de sprint del cliente — solo tiene efecto con estamina > 0 y en tierra (docs/GDD_Personaje.md §3.4). */
  correr?: boolean;
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
export abstract class RoomExteriorBase extends Room<HubState> implements RoomConectable {
  maxClients = 40;
  protected inputs = new Map<string, Direccion>();
  // Resistencia por movimiento (docs/GDD_Personaje.md §3.4): tiempo REAL
  // acumulado corriendo/andando desde el último umbral cruzado — vive y
  // muere con la sesión, igual que `inputs` (nunca se persiste, solo se
  // usa para saber cuándo tocar `otorgarXpAtributoPorSessionId`).
  private tiempoMovimiento = new Map<string, { correr: number; andar: number }>();
  // Sueño en cama (docs/GDD_Personaje.md §3.6): vive y muere con la sesión,
  // igual que `craftesEnCurso` — mismo patrón "terminaEn" que crafteo, sin
  // tick nuevo (el cliente pide `dormir:completar` cuando cree que ya toca).
  private durmiendo = new Map<string, { terminaEn: number }>();
  protected mundo!: MundoColision;

  // --- Mascotas (docs/GDD_Mascotas.md) — solo lo que "siguiendo" necesita
  // en ESTA room: qué sessionId es el dueño de cada mascotaId (nunca en el
  // Schema, ver comentario de Mascota en HubState.ts), y qué mascotaIds
  // spawneó cada sesión (limpieza O(1) en onLeave). El offset de seguimiento
  // es puramente cosmético — no hace falta persistirlo ni sincronizarlo.
  private mascotaDuenoSesion = new Map<number, string>();
  private mascotasPorSesion = new Map<string, Set<number>>();
  private offsetMascota = new Map<number, { ang: number; dist: number }>();

  // --- Twitch (docs/GDD_Twitch.md, pedido 2026-08-30) ---
  // Solo InteriorRoom/DungeonRoom lo ponen a true (onCreate) — decide si
  // "Tormenta de rayos" puede alcanzar a los jugadores de esta room ("si se
  // mete en interior se salva", pedido literal); Terremoto sí afecta a
  // interiores (un temblor no distingue techo).
  protected esInterior = false;
  private eventoRayoActivo = false;
  private eventoTerremotoActivo = false;
  private eventoFarmeoDobleActivo = false;
  // El Corralito (pool "malo") y Mercado en oferta (pool "bueno") pueden
  // estar activos A LA VEZ (cooldowns independientes, docs/GDD_Twitch.md) —
  // dos flags propios en vez de un único número compartido: con un solo
  // campo, terminar el evento que empezó primero (poniéndolo a 0 sin más)
  // borraría el efecto del segundo, que todavía debería seguir activo. El
  // modificador final se deriva siempre de los dos flags, nunca se asigna suelto.
  private eventoCorralitoActivo = false;
  private eventoMercadoOfertaActivo = false;
  private get modificadorPrecioEventoTwitch(): number {
    return (this.eventoMercadoOfertaActivo ? MODIFICADOR_MERCADO_OFERTA : 0) - (this.eventoCorralitoActivo ? MODIFICADOR_CORRALITO : 0);
  }
  private ratasEvento = new Set<string>();
  private timerPlagaRatas?: Delayed;
  private siguienteRataId = 1;

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

  // --- Combate instanciado (docs/GDD_Combate.md §9.1-9.2) ---
  /** Timer de cierre de la ventana de unión, por combate — se cancela si "comenzar ya" cierra antes. */
  private timeoutsVentanaCombate = new Map<string, Delayed>();
  /** Lo que mandó cada jugador en combate:iniciar/unirse para poder volver EXACTAMENTE de donde salió — vive y muere con el combate, nunca se persiste. */
  private retornosPendientes = new Map<string, RetornoJugador>();
  private catalogoArenas?: string[];

  protected iniciarMovimiento() {
    this.setState(new HubState());
    this.setPatchRate(1000 / 15);
    registrarRoom(this); // Twitch (docs/GDD_Twitch.md) — eventos globales necesitan poder llegar a esta room
    obtenerGestorTwitch().aplicarEventosActivosA(this); // por si esta room nace a mitad de un evento de mundo ya en curso

    this.onMessage("input", (client, dir: Direccion) => {
      // Moverse de verdad cancela el sueño en cama (docs/GDD_Personaje.md
      // §3.6) — un simple "soltar teclas" (x=0,y=0) NO cuenta, para no
      // despertar al jugador con el propio paquete que confirma que se ha
      // quedado quieto al tumbarse.
      if (((dir?.x ?? 0) !== 0 || (dir?.y ?? 0) !== 0) && this.durmiendo.has(client.sessionId)) {
        this.durmiendo.delete(client.sessionId);
        const durmiente = this.state.players.get(client.sessionId);
        if (durmiente) durmiente.durmiendo = false;
        client.send("dormir:cancelado", {});
      }
      this.inputs.set(client.sessionId, {
        x: clamp(dir?.x ?? 0, -1, 1),
        y: clamp(dir?.y ?? 0, -1, 1),
        correr: !!dir?.correr,
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
    this.onMessage("personaje:consumir", (client, msg: { instanciaId?: number }) => this.manejarPersonajeConsumir(client, msg));

    // Higiene y sueño en cama (docs/GDD_Personaje.md §3.6, pedido explícito 2026-08-30)
    this.onMessage("higiene:cagar", (client, msg: { instanciaId?: number }) => this.manejarHigieneCagar(client, msg));
    this.onMessage("higiene:lavar", (client) => this.manejarHigieneLavar(client));
    this.onMessage("dormir:iniciar", (client, msg: { construccionId?: number }) => this.manejarDormirIniciar(client, msg));
    this.onMessage("dormir:completar", (client) => this.manejarDormirCompletar(client));

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

    // Actividades diarias de entrenamiento (docs/GDD_Personaje.md §3.5,
    // pedido 2026-08-30): un único mensaje genérico para pesas/diana/atril
    // — qué atributo y cuánta XP salen del propio catálogo construible
    // (`actividadAtributo`), no de un handler por atributo.
    this.onMessage("actividad:realizar", (client, msg: { construccionId?: number }) => this.manejarActividadRealizar(client, msg));

    // Combate táctico por turnos (docs/GDD_Combate.md, ✅ CONFIRMADO
    // 2026-08-30 — sustituye al daño directo simple de GDD_Mecanicas.md
    // §5.4, que queda interino hasta que este camino esté completo).
    this.onMessage("combate:iniciar", (client, msg: { objetivoId?: string; retorno?: RetornoJugador }) => this.manejarCombateIniciar(client, msg));
    this.onMessage("combate:unirse", (client, msg: { combateId?: string; retorno?: RetornoJugador }) => this.manejarCombateUnirse(client, msg));
    this.onMessage("combate:comenzarYa", (client, msg: { combateId?: string }) => this.manejarCombateComenzarYa(client, msg));
    this.onMessage("combate:mover", (client, msg: { combateId?: string; gx?: number; gy?: number }) => this.manejarCombateMover(client, msg));
    this.onMessage("combate:accion", (client, msg: { combateId?: string; objetivoId?: string }) => this.manejarCombateAccion(client, msg));
    this.onMessage("combate:pasarTurno", (client, msg: { combateId?: string }) => this.manejarCombatePasarTurno(client, msg));
    this.onMessage("combate:huir", (client, msg: { combateId?: string }) => this.manejarCombateHuir(client, msg));

    // --- Mascotas (docs/GDD_Mascotas.md) — disponibles en cualquier room
    // con movimiento (Hub/Region/Interior): "dar de comer" es lo único
    // atado a fauna urbana concreta (solo RegionRoom, registrado ahí).
    this.onMessage("mascota:listar", (client) => this.manejarMascotaListar(client));
    this.onMessage("mascota:llamar", (client, msg: { mascotaId?: number }) => this.manejarMascotaLlamar(client, msg));
    this.onMessage("mascota:dejarEnPropiedad", (client, msg: { mascotaId?: number; propiedadId?: string }) => this.manejarMascotaDejarEnPropiedad(client, msg));

    // --- Twitch: disparadores de PRUEBA (docs/GDD_Twitch.md) — jarl-only,
    // mismo criterio que "inmueble:revocar"/el resto de herramientas admin
    // ya existentes. En producción, el conector real (chatBot.ts/EventSub
    // pendiente) llama a las MISMAS funciones de gestorTwitch.ts — esto
    // solo es la puerta de entrada para poder probar todo el mecanismo sin
    // depender de credenciales reales de Twitch.
    this.onMessage("twitch:simularCanje", (client, msg: { tipo?: TipoEvento }) => this.manejarTwitchSimularCanje(client, msg));
    this.onMessage("twitch:simularComando", (client, msg: { comando?: string }) => this.manejarTwitchSimularComando(client, msg));
    this.onMessage("twitch:forzarDirecto", (client, msg: { on?: boolean }) => this.manejarTwitchForzarDirecto(client, msg));

    this.setSimulationInterval(() => this.actualizarMovimiento(), 1000 / TICK_HZ);
    // Seguimiento de mascotas — cosmético, no necesita 30hz (mismo criterio que GestorFauna, 5hz de sobra para un paseo).
    this.clock.setInterval(() => this.moverMascotas(0.2), 200);
    // Daño ambiental de eventos Twitch (rayo/terremoto) — igual de barato que
    // el resto de ticks lentos de esta base, ver aplicarDanoEventosAmbientales.
    this.clock.setInterval(() => this.aplicarDanoEventosAmbientales(1), 1000);
  }

  onDispose() {
    quitarRoom(this); // Twitch (docs/GDD_Twitch.md) — esta room ya no debe recibir eventos globales
    this.timerPlagaRatas?.clear();
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
    registrarJugador(player.name, this, client.sessionId); // Twitch (docs/GDD_Twitch.md) — para comandos de chat y títulos

    const contenedor = crearContenedor(ANCHO_CUERPO, ALTO_CUERPO);
    this.inventarios.set(client.sessionId, contenedor);
    sincronizarContenedor(player.inventario.cuerpo, contenedor); // sin esto el Schema se queda en ancho=0/alto=0 (bug real, ver crítica del diseño)

    // Mascotas "siguiendo" (docs/GDD_Mascotas.md) — sin awaitear a propósito
    // (mismo criterio que otorgarXpAtributoPorSesion): el jugador entra ya,
    // sus mascotas aparecen un instante después vía BD, nunca bloquean el join.
    void this.cargarMascotasSiguiendoDe(client, player.name);

    return player;
  }

  onLeave(client: Client) {
    const nombreSaliente = this.state.players.get(client.sessionId)?.name;
    if (nombreSaliente) quitarJugador(nombreSaliente, client.sessionId); // Twitch (docs/GDD_Twitch.md) — solo si el registro sigue siendo el de ESTA sesión (nombres duplicados, ver registro.ts)
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.inventarios.delete(client.sessionId);
    this.tiempoMovimiento.delete(client.sessionId);

    // Mascotas: desaparecen de ESTA room (no se persiste x/y, ver Mascota en
    // HubState.ts) — su fila en BD sigue "siguiendo", vuelven a aparecer en
    // la próxima room a la que entre el dueño.
    const mascotaIds = this.mascotasPorSesion.get(client.sessionId);
    if (mascotaIds) {
      for (const id of mascotaIds) {
        this.state.mascotas.delete(String(id));
        this.mascotaDuenoSesion.delete(id);
        this.offsetMascota.delete(id);
      }
      this.mascotasPorSesion.delete(client.sessionId);
    }
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
    // "Hay que trabajar" (docs/GDD_Twitch.md, evento de puntos de canal):
    // x2 materiales mientras dure — se dobla ANTES del chequeo de peso, a
    // propósito (cargar el doble también pesa el doble).
    if (this.eventoFarmeoDobleActivo) candidato.cantidad *= 2;

    // Fuerza (docs/GDD_Personaje.md §3.3): el peso máximo transportable
    // ahora SÍ limita de verdad — antes la fórmula existía pero nada la
    // llamaba (ver Backlog). Se comprueba ANTES de intentarCoger, la
    // propia fuente (bake/objetosMundo) no se toca si esto rechaza.
    const pesoMaximo = pesoMaximoTransportable(player.atributos.fuerza);
    if (excedePesoMaximo(contenedor, this.catalogoItems, candidato.itemId, candidato.cantidad, pesoMaximo)) {
      client.send("coger:error", { motivo: "demasiado_peso" });
      return;
    }

    const resultado = intentarCoger(contenedor, this.catalogoItems, candidato);
    if (!resultado.ok) {
      client.send("coger:error", { motivo: resultado.motivo ?? "sin_hueco" });
      return;
    }
    candidato.confirmar();
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    // Fuerza/Inteligencia (docs/GDD_Personaje.md §3.2) — SIN awaitear, a
    // propósito (ver el comentario de esta función: coger es 100%
    // síncrono, esto es un efecto secundario en segundo plano que no
    // puede reabrir esa ventana de atomicidad). Fuerza solo con objetos
    // "pesados" (talar/minar); Inteligencia con CUALQUIER recolecta —
    // identificar y extraer un recurso enseña algo, sea cual sea su peso.
    const pesoItem = this.catalogoItems[candidato.itemId]?.peso ?? 0;
    const factorXp = this.eventoFarmeoDobleActivo ? 2 : 1; // "Hay que trabajar" también dobla la XP, no solo los materiales
    if (pesoItem >= PESO_MINIMO_FUERZA) {
      void this.otorgarXpAtributoPorSesion(client, "fuerza", XP_FUERZA_POR_RECOLECTA_PESADA * factorXp);
    }
    void this.otorgarXpAtributoPorSesion(client, "inteligencia", XP_INTELIGENCIA_POR_RECOLECTAR * factorXp);
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
   * Consumir un ítem del cuerpo (docs/GDD_Personaje.md) — solo tipo
   * "consumible" con `restaura` en el catálogo; sin `restaura` = consumible
   * de contenido futuro, se rechaza en vez de desaparecer sin efecto.
   */
  private manejarPersonajeConsumir(client: Client, msg: { instanciaId?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor || typeof msg?.instanciaId !== "number") return;

    // Dentro de un combate activo, "objetos" es una acción de turno más
    // (docs/GDD_Combate.md §9.3): solo en el turno propio, cuesta PA como
    // cualquier otra. Fuera de combate, sin cambios (como siempre).
    const enCombate = this.combatePorUnidad(client.sessionId);
    let unidadCombate: CombateUnidad | null = null;
    if (enCombate) {
      const [, combate] = enCombate;
      if (combate.ordenTurnos[combate.turnoActual] !== client.sessionId) {
        return client.send("personaje:error", { motivo: "no es tu turno" });
      }
      unidadCombate = combate.unidades.get(client.sessionId)!;
      if (unidadCombate.pa < COSTE_PA_OBJETO) return client.send("personaje:error", { motivo: "sin PA suficiente" });
    }

    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it) return client.send("personaje:error", { motivo: "no_encontrado" });
    const entrada = this.catalogoItems[it.itemId];
    if (!entrada || entrada.tipo !== "consumible" || !entrada.restaura) {
      return client.send("personaje:error", { motivo: "no_se_puede_consumir" });
    }

    const resultado = quitarItem(contenedor, msg.instanciaId, 1);
    if (!resultado.ok) return client.send("personaje:error", { motivo: resultado.motivo ?? "no_encontrado" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    if (unidadCombate) unidadCombate.pa -= COSTE_PA_OBJETO;

    // "vida" NO vive en player.vitales (docs/GDD_Mecanicas.md §5.4:
    // Player.vida/vidaMax es la única fuente de HP) — se cura con la MISMA
    // función pura que usa combate.ts, aquí disparada por una acción
    // explícita del jugador (consumir), no por un tick: respeta la regla
    // "nadie se cura solo con el tiempo" tal cual, curar sigue siendo evento.
    let valor: number;
    if (entrada.restaura.vital === "vida") {
      const curado = curar({ vida: player.vida, vidaMax: player.vidaMax, ataque: player.ataque, defensa: player.defensa }, entrada.restaura.cantidad);
      player.vida = curado.vida;
      valor = player.vida;
    } else {
      restaurarVital(player.vitales, entrada.restaura.vital, entrada.restaura.cantidad);
      valor = player.vitales[entrada.restaura.vital];
      // Higiene (docs/GDD_Personaje.md §3.6, pedido explícito): "cada vez
      // que comes esa comida aumenta la barrita [de cagar]" — misma
      // cantidad que sube `comida`, al tope se ensucia solo.
      if (entrada.restaura.vital === "comida") {
        restaurarVital(player.vitales, "caca", entrada.restaura.cantidad);
        if (player.vitales.caca >= VITAL_MAX) player.sucio = true;
      }
    }
    client.send("personaje:consumido", { itemId: it.itemId, vital: entrada.restaura.vital, valor });
  }

  /**
   * Higiene (docs/GDD_Personaje.md §3.6, pedido explícito 2026-08-30): usar
   * una hoja (cogida de `mata_de_hojas_anchas`, baker/catalogo/vegetacion.json)
   * vacía `caca` a 0 ANTES de llegar al tope — evita ensuciarse. No limpia
   * `sucio` si ya estaba puesto (eso solo se quita lavándose, ver abajo).
   */
  private manejarHigieneCagar(client: Client, msg: { instanciaId?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor || typeof msg?.instanciaId !== "number") return;

    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it || it.itemId !== "hoja") return client.send("higiene:error", { motivo: "necesitas una hoja" });

    const resultado = quitarItem(contenedor, msg.instanciaId, 1);
    if (!resultado.ok) return client.send("higiene:error", { motivo: resultado.motivo ?? "no_encontrado" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    player.vitales.caca = 0;
    // "animación incluida" (pedido) — sin sistema de animaciones por acción
    // todavía (UI/anim es "lo último", pedido explícito del streamer para
    // todo el proyecto): el cliente puede reaccionar a este mensaje cuando
    // exista esa pasada, sin que el servidor cambie.
    client.send("higiene:cagado", {});
  }

  /**
   * Higiene: quita `sucio` — solo dentro del agua (mismo `player.estado` que
   * ya distingue nadar/bucear de tierra, cero mecanismo nuevo de detección).
   */
  private manejarHigieneLavar(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.estado === "tierra") return client.send("higiene:error", { motivo: "necesitas estar en el agua" });
    if (!player.sucio) return client.send("higiene:error", { motivo: "no estás sucio" });
    player.sucio = false;
    client.send("higiene:lavado", {});
  }

  /**
   * Sueño en cama (docs/GDD_Personaje.md §3.6): reusa el sistema de
   * construcción del jugador (mismo `ctx.vivas`/`RADIO_INTERACCION` que las
   * actividades diarias de atributo, §3.5) — la cama tiene que ser una
   * CONSTRUCCIÓN real colocada por un jugador, `entradaDe(...).esCama`.
   * Mismo patrón "terminaEn" que `crafteo:iniciar`, sin tick nuevo.
   */
  private manejarDormirIniciar(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    if (this.durmiendo.has(client.sessionId)) return client.send("dormir:error", { motivo: "ya estás durmiendo" });

    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return client.send("dormir:error", { motivo: "construcción inexistente" });
    if (!this.entradaDe(viva.objeto)?.esCama) return client.send("dormir:error", { motivo: "eso no es una cama" });

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (Math.hypot(viva.x - player.x, viva.y - player.y) > RADIO_INTERACCION) {
      return client.send("dormir:error", { motivo: "demasiado lejos de la cama" });
    }

    const terminaEn = Date.now() + DURACION_DORMIR_MS;
    this.durmiendo.set(client.sessionId, { terminaEn });
    player.durmiendo = true;
    client.send("dormir:iniciado", { terminaEn });
  }

  /** Recoge el resultado de dormir — no-op amable si todavía no ha pasado el tiempo mínimo (mismo patrón que crafteo:recolectar). */
  private manejarDormirCompletar(client: Client) {
    const estado = this.durmiendo.get(client.sessionId);
    if (!estado) return client.send("dormir:error", { motivo: "no estás durmiendo" });
    if (Date.now() < estado.terminaEn) return client.send("dormir:error", { motivo: "todavía no" });

    this.durmiendo.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.durmiendo = false;
      player.vitales.estamina = VITAL_MAX;
    }
    client.send("dormir:completado", {});
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
    // Carisma (docs/GDD_Personaje.md §3.2): fundar un gremio es un acto de
    // liderazgo social — con `liderazgo` retirado de la lista de atributos
    // (2026-08-30, un único disparador no lo justificaba), esta XP pasa a
    // Carisma, que ya tenía otro disparador real (`npc:hablar`).
    if (player) await this.otorgarXpAtributo(bd, jugador.id, "carisma", player, XP_CARISMA_POR_FUNDAR_GREMIO);
    client.send("gremio:estado", await this.detalleGremio(bd, vivo));
  }

  /**
   * Otorga XP de un atributo (docs/GDD_Personaje.md, mismo mecanismo que
   * `sumarXpOficio`) y refresca el nivel replicado en `player.atributos` —
   * SOLO el atributo tocado (los demás siguen "oportunistamente" desfasados
   * hasta que su propio disparador los toque, mismo criterio ya aceptado
   * para gremioId/gremioNombre).
   */
  protected async otorgarXpAtributo(bd: IAlmacenDatos, jugadorId: number, atributo: Atributo, player: Player, delta: number) {
    const nuevaXp = await bd.sumarXpAtributo(jugadorId, atributo, delta);
    const nivel = nivelDeXp(nuevaXp, UMBRALES_NIVEL_ATRIBUTO);
    player.atributos[atributo] = nivel;
    // Bonus por nivel (docs/GDD_Personaje.md §3.3) — Resistencia es el
    // único que toca OTRO campo de Player además de su propio nivel: sube
    // vidaMax al instante (nunca baja `vida` de golpe, solo el techo).
    if (atributo === "resistencia") player.vidaMax = vidaMaximaPorResistencia(nivel);
  }

  /**
   * Conveniencia para disparadores que NO tienen ya `bd`/`jugador` a mano
   * (a diferencia de `gremio:fundar`/`crafteo:recolectar`, que sí) —
   * resuelve el jugador por nombre y llama a `otorgarXpAtributo`. Pensada
   * para invocarse SIN awaitear desde un handler síncrono (p.ej.
   * `manejarCoger`, deliberadamente 100% síncrono — ver su comentario) sin
   * romper esa garantía: la XP se persiste en segundo plano, la acción
   * principal ya se resolvió antes de que esto termine.
   */
  protected async otorgarXpAtributoPorSesion(client: Client, atributo: Atributo, delta: number) {
    await this.otorgarXpAtributoPorSessionId(client.sessionId, atributo, delta);
  }

  /**
   * Igual que `otorgarXpAtributoPorSesion` pero por `sessionId` directo —
   * para sitios que NO tienen un `Client` a mano (p.ej. la cascada de
   * turnos de combate, `avanzarTurnosIA`, que se dispara sola sin que
   * ningún cliente envíe un mensaje ese instante concreto).
   */
  protected async otorgarXpAtributoPorSessionId(sessionId: string, atributo: Atributo, delta: number) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const nombre = player.name;
    if (!nombre) return;
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    await this.otorgarXpAtributo(bd, jugador.id, atributo, player, delta);
  }

  // --- Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30) ---

  /** Al entrar a CUALQUIER room, reaparecen aquí las mascotas que el jugador tiene puestas a "siguiendo". */
  private async cargarMascotasSiguiendoDe(client: Client, nombre: string) {
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const mascotas = await bd.listarMascotas(jugador.id);
    for (const m of mascotas) {
      if (m.ubicacion !== "siguiendo") continue;
      this.spawnearMascota(client, m, nombre);
    }
  }

  /** Crea la fila en BD (nace "siguiendo") y la spawnea en ESTA room — usado por RegionRoom al completar la domesticación (5x comida). */
  protected async crearMascota(client: Client, especieId: string): Promise<MascotaFila> {
    const nombre = this.nombreDe(client)!;
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const mascota = await bd.crearMascota(jugador.id, especieId);
    this.spawnearMascota(client, mascota, nombre);
    return mascota;
  }

  /** Mete la entrada en el Schema de ESTA room + registra a quién sigue — offset de seguimiento nuevo cada vez que aparece (cosmético). */
  private spawnearMascota(client: Client, mascota: MascotaFila, duenoNombre: string) {
    const dueno = this.state.players.get(client.sessionId);
    if (!dueno) return;
    const esquema = new Mascota();
    esquema.especieId = mascota.especieId;
    esquema.duenoNombre = duenoNombre;
    esquema.x = dueno.x;
    esquema.y = dueno.y;
    this.state.mascotas.set(String(mascota.id), esquema);
    this.mascotaDuenoSesion.set(mascota.id, client.sessionId);
    this.offsetMascota.set(mascota.id, { ang: Math.random() * Math.PI * 2, dist: DIST_SEGUIMIENTO_MASCOTA });
    let set = this.mascotasPorSesion.get(client.sessionId);
    if (!set) { set = new Set(); this.mascotasPorSesion.set(client.sessionId, set); }
    set.add(mascota.id);
  }

  /** La quita de ESTA room (deja de seguir/renderizarse) sin tocar su fila en BD — usado por "dejar en propiedad" y por domesticar (por si acaso ya existiera, no debería). */
  private quitarMascotaDeSchemaLocal(mascotaId: number) {
    this.state.mascotas.delete(String(mascotaId));
    const sessionId = this.mascotaDuenoSesion.get(mascotaId);
    this.mascotaDuenoSesion.delete(mascotaId);
    this.offsetMascota.delete(mascotaId);
    if (sessionId) this.mascotasPorSesion.get(sessionId)?.delete(mascotaId);
  }

  /** Seguimiento simple: cada mascota persigue un punto fijo (ángulo+distancia) alrededor de su dueño — sin pathing, sin colisión, sin acción (pedido explícito: "no hace ninguna acción de momento, solo te sigue"). */
  private moverMascotas(dt: number) {
    this.state.mascotas.forEach((m, clave) => {
      const mascotaId = Number(clave);
      const sessionId = this.mascotaDuenoSesion.get(mascotaId);
      const dueno = sessionId ? this.state.players.get(sessionId) : undefined;
      if (!dueno) return; // no debería pasar (se limpia en onLeave) — por si acaso, no mover a ningún sitio
      const off = this.offsetMascota.get(mascotaId) ?? { ang: 0, dist: DIST_SEGUIMIENTO_MASCOTA };
      const tx = dueno.x + Math.cos(off.ang) * off.dist;
      const ty = dueno.y + Math.sin(off.ang) * off.dist;
      const dx = tx - m.x;
      const dy = ty - m.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05) return;
      if (dist > DIST_TELEPORT_MASCOTA) { m.x = tx; m.y = ty; return; }
      const paso = VEL_MASCOTA * dt;
      if (dist <= paso) { m.x = tx; m.y = ty; }
      else { m.x += (dx / dist) * paso; m.y += (dy / dist) * paso; }
    });
  }

  private async manejarMascotaListar(client: Client) {
    const nombre = this.nombreDe(client);
    if (!nombre) return;
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const mascotas = await bd.listarMascotas(jugador.id);
    client.send("mascota:lista", mascotas.map((m) => ({ id: m.id, especieId: m.especieId, ubicacion: m.ubicacion, propiedadId: m.propiedadId })));
  }

  private async manejarMascotaLlamar(client: Client, msg: { mascotaId?: number }) {
    const nombre = this.nombreDe(client);
    if (!nombre || typeof msg?.mascotaId !== "number") return;
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const mascotas = await bd.listarMascotas(jugador.id);
    const fila = mascotas.find((m) => m.id === msg.mascotaId);
    if (!fila) return client.send("mascota:error", { motivo: "no_es_tuya" });
    const ok = await bd.actualizarUbicacionMascota(msg.mascotaId, jugador.id, "siguiendo", null);
    if (!ok) return client.send("mascota:error", { motivo: "no_es_tuya" });
    this.spawnearMascota(client, { ...fila, ubicacion: "siguiendo", propiedadId: null }, nombre);
    client.send("mascota:actualizada", { mascotaId: msg.mascotaId, ubicacion: "siguiendo" as UbicacionMascota });
  }

  private async manejarMascotaDejarEnPropiedad(client: Client, msg: { mascotaId?: number; propiedadId?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre || typeof msg?.mascotaId !== "number" || !msg?.propiedadId) return;
    const bd = await obtenerBdCompartida();
    const propiedad = await bd.obtenerPropiedad(msg.propiedadId);
    if (!propiedad || propiedad.dueno !== nombre) return client.send("mascota:error", { motivo: "no_es_tu_propiedad" });
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const ok = await bd.actualizarUbicacionMascota(msg.mascotaId, jugador.id, "propiedad", msg.propiedadId);
    if (!ok) return client.send("mascota:error", { motivo: "no_es_tuya" });
    this.quitarMascotaDeSchemaLocal(msg.mascotaId);
    client.send("mascota:actualizada", { mascotaId: msg.mascotaId, ubicacion: "propiedad" as UbicacionMascota, propiedadId: msg.propiedadId });
  }

  // --- Twitch (docs/GDD_Twitch.md, pedido 2026-08-30) — implementa
  // RoomConectable: gestorTwitch.ts llama a estos métodos por `sessionId`
  // (comandos de chat) o los dispara en TODAS las rooms activas a la vez
  // (eventos de puntos de canal), sin que esta clase sepa nada de Twitch en
  // sí — solo "qué le pasa al mundo cuando toca".

  /** `!curar` — cura entero, evento explícito disparado por el chat (respeta la regla "nadie se cura solo con el tiempo"). */
  curarCompleto(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (player) player.vida = player.vidaMax;
  }

  /** `!comer` / `!beber` — llena del todo el vital pedido. */
  llenarVital(sessionId: string, vital: "comida" | "bebida"): void {
    const player = this.state.players.get(sessionId);
    if (player) restaurarVital(player.vitales, vital, VITAL_MAX);
  }

  /** `!cagar` — vacía `caca` a 0, mismo efecto que usar una hoja de verdad (docs/GDD_Personaje.md §3.6) pero sin gastar inventario ni limpiar `sucio`. */
  vaciarCaca(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (player) player.vitales.caca = 0;
  }

  /** Refresca el título social sobre el PJ (docs/GDD_Mecanicas.md §5.11) — puramente cosmético. */
  fijarTituloTwitch(sessionId: string, titulo: string): void {
    const player = this.state.players.get(sessionId);
    if (player) player.tituloTwitch = titulo;
  }

  /** Activa/desactiva un evento de puntos de canal en ESTA room — gestorTwitch.ts lo llama en cada room activa a la vez. */
  aplicarEventoTwitch(eventoId: string, activar: boolean): void {
    switch (eventoId) {
      case "eclipse":
        this.state.oscuridadAbsoluta = activar;
        break;
      case "tormenta_rayos":
        this.eventoRayoActivo = activar;
        break;
      case "terremoto":
        this.eventoTerremotoActivo = activar;
        break;
      case "corralito":
        this.eventoCorralitoActivo = activar;
        break;
      case "mercado_oferta":
        this.eventoMercadoOfertaActivo = activar;
        break;
      case "hay_que_trabajar":
        this.eventoFarmeoDobleActivo = activar;
        break;
      case "plaga_ratas":
        if (activar) this.iniciarPlagaRatas();
        else this.limpiarPlagaRatas();
        break;
    }
  }

  /**
   * Daño ambiental de "Tormenta de rayos"/"Terremoto" — chequeo barato una
   * vez por segundo (no hace falta más resolución que esa para un % por
   * jugador), reutiliza el mismo patrón "vida se toca directo" que ya
   * aceptó `aplicarInanicion` (vitales.ts) como excepción explícita a
   * "nadie se hace daño solo con el tiempo". El rayo respeta estar en
   * interior ("si se mete en interior se salva", pedido literal); el
   * terremoto no distingue techo.
   */
  private aplicarDanoEventosAmbientales(_dt: number): void {
    if (!this.eventoRayoActivo && !this.eventoTerremotoActivo) return;
    this.state.players.forEach((player) => {
      if (this.eventoRayoActivo && !this.esInterior && Math.random() < PROB_RAYO_POR_SEG) {
        player.vida = Math.max(0, player.vida - DANO_RAYO);
      }
      if (this.eventoTerremotoActivo && Math.random() < PROB_TERREMOTO_POR_SEG) {
        player.vida = Math.max(0, player.vida - DANO_TERREMOTO);
      }
    });
  }

  /**
   * "Plaga de ratas" — van apareciendo alrededor de cada jugador presente
   * (también en interior), ~10 en total por jugador repartidas a lo largo
   * de los 2 minutos del evento. Reusa el Schema `Fauna` (mismo circuito de
   * render que la fauna doméstica/mascotas, cero cliente nuevo) pero SIN
   * pasar por `GestorFauna` — no merodean, no tienen IA, son un incordio
   * ambiental barato que desaparece solo al terminar el evento (vivo o no:
   * "molestan, no matan" — no hace falta cazarlas todas).
   */
  private iniciarPlagaRatas(): void {
    const intervaloMs = DURACION_PLAGA_RATAS_MS / RATAS_POR_JUGADOR;
    this.timerPlagaRatas = this.clock.setInterval(() => {
      this.state.players.forEach((player) => {
        const id = `rata_evento:${this.siguienteRataId++}`;
        const rata = new Fauna();
        rata.especieId = "rata";
        rata.x = player.x + (Math.random() - 0.5) * 2;
        rata.y = player.y + (Math.random() - 0.5) * 2;
        rata.accion = "caminar";
        rata.vida = VIDA_RATA;
        rata.vidaMax = VIDA_RATA;
        rata.ataque = ATAQUE_RATA;
        this.state.fauna.set(id, rata);
        this.ratasEvento.add(id);
      });
    }, intervaloMs);
  }

  private limpiarPlagaRatas(): void {
    this.timerPlagaRatas?.clear();
    this.timerPlagaRatas = undefined;
    for (const id of this.ratasEvento) this.state.fauna.delete(id);
    this.ratasEvento.clear();
  }

  /** Jarl-only: canjea un punto de canal de PRUEBA (mismo entry point que usará el conector real). */
  private manejarTwitchSimularCanje(client: Client, msg: { tipo?: TipoEvento }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !esJarlGlobal(nombre)) return client.send("twitch:error", { motivo: "solo el jarl puede probar esto" });
    if (msg?.tipo !== "bueno" && msg?.tipo !== "malo") return client.send("twitch:error", { motivo: "tipo debe ser 'bueno' o 'malo'" });
    const r = obtenerGestorTwitch().intentarCanje(msg.tipo);
    if (!r.ok) return client.send("twitch:error", { motivo: r.motivo });
    client.send("twitch:canjeado", { tipo: msg.tipo, eventoId: r.evento.id, nombre: r.evento.nombre });
  }

  /** Jarl-only: simula `!curar`/`!comer`/`!beber`/`!cagar` sobre SÍ MISMO (docs/GDD_Twitch.md). */
  private manejarTwitchSimularComando(client: Client, msg: { comando?: string }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !esJarlGlobal(nombre)) return client.send("twitch:error", { motivo: "solo el jarl puede probar esto" });
    if (!msg?.comando) return;
    obtenerGestorTwitch().manejarComandoChat(nombre, msg.comando);
  }

  /** Jarl-only: fuerza el flag "en directo" — para probar sin depender de la detección real de Twitch (docs/GDD_Twitch.md). */
  private manejarTwitchForzarDirecto(client: Client, msg: { on?: boolean }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !esJarlGlobal(nombre)) return client.send("twitch:error", { motivo: "solo el jarl puede probar esto" });
    obtenerGestorTwitch().fijarEnDirecto(!!msg?.on);
    client.send("twitch:directoForzado", { on: !!msg?.on });
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
    // Carisma (docs/GDD_Personaje.md §3.2, Comercio fusionado dentro): reponer/vender en tu propio tenderete.
    void this.otorgarXpAtributoPorSesion(client, "carisma", XP_CARISMA_POR_REPONER);
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
    // Carisma (docs/GDD_Personaje.md §3.3, Comercio fusionado dentro):
    // descuento por nivel, sin awaitear una segunda vuelta a BD para
    // leerlo — player.atributos.carisma ya está replicado y actualizado.
    const compradorPlayer = this.state.players.get(client.sessionId);
    // El Corralito/Mercado en oferta (docs/GDD_Twitch.md): modifica el precio
    // GLOBAL de mercado por encima del descuento de Carisma — negativo sube
    // el precio (corralito), positivo lo baja más (oferta). Mismo parámetro
    // `descuento` de comprarDeTenderete, ahora también admite negativos.
    const descuento = descuentoComercio(compradorPlayer?.atributos.carisma ?? 1) + this.modificadorPrecioEventoTwitch;
    const r = await bd.comprarDeTenderete({ tenderoteId: msg.tenderoteId, itemId: msg.itemId, cantidad, compradorNombre: nombre, duenoNombre: dueno, descuento });
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
    // Carisma (docs/GDD_Personaje.md §3.2, Comercio fusionado dentro): comprar en un tenderete entrena regateo/mercado.
    void this.otorgarXpAtributoPorSesion(client, "carisma", XP_CARISMA_POR_COMPRAR);
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
    const factorEnergia = factorVelocidadPorEnergia(ctx, this.catalogoConstruible, { objeto: viva.objeto, claves: viva.claves });
    // Inteligencia (docs/GDD_Personaje.md §3.3): "craftea más rápido" — multiplica el factor de energía, nunca lo sustituye.
    const factor = factorEnergia * factorVelocidadCrafteo(player?.atributos.inteligencia ?? 1);
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
    const jugadorParaPeso = this.state.players.get(client.sessionId);
    const pesoMaximo = pesoMaximoTransportable(jugadorParaPeso?.atributos.fuerza ?? 1);
    if (excedePesoMaximo(contenedor, this.catalogoItems, receta.resultado.itemId, receta.resultado.cantidad, pesoMaximo)) {
      return this.errorCrafteo(client, "demasiado peso para cargar el resultado — descarga algo primero");
    }
    const resultado = intentarCoger(contenedor, this.catalogoItems, { itemId: receta.resultado.itemId, cantidad: receta.resultado.cantidad });
    if (!resultado.ok) return this.errorCrafteo(client, "no tienes hueco en tu inventario");

    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const nuevaXp = await bd.sumarXpOficio(jugador.id, receta.oficio, XP_POR_CRAFTEO);
    // Inteligencia (docs/GDD_Personaje.md): completar un crafteo entrena tanto el oficio como el atributo general.
    if (player) await this.otorgarXpAtributo(bd, jugador.id, "inteligencia", player, XP_INTELIGENCIA_POR_CRAFTEO);
    client.send("crafteo:completado", {
      recetaId: receta.id, itemId: receta.resultado.itemId, cantidad: receta.resultado.cantidad,
      oficio: receta.oficio, xp: nuevaXp, nivel: nivelDeXp(nuevaXp),
    });
  }

  /**
   * Actividad diaria de entrenamiento (docs/GDD_Personaje.md §3.5, pedido
   * 2026-08-30): acercarse a una construcción con `actividadAtributo` en su
   * catálogo (pesas, diana, atril...) y otorga esa XP a ESE atributo, una
   * vez por día de MUNDO (`tiempoMundo().dia`, no horas reales — así un
   * jugador offline durante el día in-game no pierde el turno). El
   * atributo/XP salen del catálogo, no de un handler por actividad — añadir
   * una nueva (p.ej. un yunque para Fuerza) es solo una entrada de catálogo
   * más, cero código nuevo aquí.
   */
  private async manejarActividadRealizar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;

    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorActividad(client, "construcción inexistente");
    const cfg = this.entradaDe(viva.objeto)?.actividadAtributo;
    if (!cfg || !esAtributoValido(cfg.atributo)) return this.errorActividad(client, "esta construcción no tiene ninguna actividad de entrenamiento");

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (Math.hypot(viva.x - player.x, viva.y - player.y) > RADIO_INTERACCION) {
      return this.errorActividad(client, "demasiado lejos de la construcción");
    }

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const dia = tiempoMundo().dia;
    const ultimoDia = await bd.obtenerUltimoDiaActividadAtributo(jugador.id, cfg.atributo);
    if (ultimoDia === dia) return this.errorActividad(client, "ya hiciste esta actividad hoy — vuelve mañana");

    await bd.marcarActividadAtributoHoy(jugador.id, cfg.atributo, dia);
    await this.otorgarXpAtributo(bd, jugador.id, cfg.atributo, player, cfg.xp);
    client.send("actividad:hecha", { construccionId: msg.construccionId, atributo: cfg.atributo, xp: cfg.xp });
  }

  private errorActividad(client: Client, motivo: string) {
    client.send("actividad:error", { motivo });
  }

  // ============================================================
  // Combate táctico por turnos (docs/GDD_Combate.md, ✅ CONFIRMADO
  // 2026-08-30). Los handlers son deliberadamente delgados: TODA la
  // lógica de turnos/daño vive en server/src/combate/{combate,
  // arenaCombate,pathfindingArena}.ts (puro, testeado) — aquí solo se
  // valida el mensaje, se traduce Schema<->UnidadCombate y se aplica el
  // resultado. Mismo criterio que crafteo/motriz: el cliente pide, el
  // servidor resuelve entero y publica el nuevo estado.
  // ============================================================

  private tipoCombatiente(id: string): "jugador" | "fauna" | "enemigo" | "npc" | null {
    if (this.state.players.has(id)) return "jugador";
    if (this.state.fauna.has(id)) return "fauna";
    if (this.state.enemigos.has(id)) return "enemigo";
    if (this.state.npcs.has(id)) return "npc";
    return null;
  }

  private statsCombatiente(id: string): { x: number; y: number; hp: number; hpMax: number; ataque: number; defensa: number; esJugador: boolean } | null {
    const tipo = this.tipoCombatiente(id);
    if (tipo === "jugador") {
      const p = this.state.players.get(id)!;
      return { x: p.x, y: p.y, hp: p.vida, hpMax: p.vidaMax, ataque: p.ataque, defensa: p.defensa, esJugador: true };
    }
    if (tipo === "fauna") {
      const f = this.state.fauna.get(id)!;
      return { x: f.x, y: f.y, hp: f.vida, hpMax: f.vidaMax, ataque: f.ataque, defensa: 0, esJugador: false };
    }
    if (tipo === "enemigo") {
      const e = this.state.enemigos.get(id)!;
      return { x: e.x, y: e.y, hp: e.vida, hpMax: e.vidaMax, ataque: e.ataque, defensa: e.defensa, esJugador: false };
    }
    if (tipo === "npc") {
      const n = this.state.npcs.get(id)!;
      return { x: n.x, y: n.y, hp: n.vida, hpMax: n.vidaMax, ataque: n.ataque, defensa: n.defensa, esJugador: false };
    }
    return null;
  }

  private aplicarVida(id: string, hp: number) {
    const tipo = this.tipoCombatiente(id);
    if (tipo === "jugador") this.state.players.get(id)!.vida = hp;
    else if (tipo === "fauna") this.state.fauna.get(id)!.vida = hp;
    else if (tipo === "enemigo") this.state.enemigos.get(id)!.vida = hp;
    else if (tipo === "npc") this.state.npcs.get(id)!.vida = hp;
  }

  /** Quita a un combatiente muerto de su lista real y hace lo que corresponda a su tipo. */
  protected async finalizarMuerte(id: string) {
    const tipo = this.tipoCombatiente(id);
    if (tipo === "fauna") {
      const manejado = await this.onFaunaMuerta(id);
      if (!manejado) this.state.fauna.delete(id); // sin GestorFaunaSalvaje en esta room: solo se quita del estado
    } else if (tipo === "enemigo") {
      this.state.enemigos.delete(id);
    } else if (tipo === "npc") {
      this.state.npcs.delete(id);
    } else if (tipo === "jugador") {
      // Sin diseño de muerte "de verdad" de jugador todavía (mismo hueco
      // que el sistema interino, GDD_Mecanicas.md §5.4): rellena a vidaMax
      // en el sitio en vez de un jugador "muerto" andante.
      const p = this.state.players.get(id);
      if (p) p.vida = p.vidaMax;
    }
  }

  /**
   * Punto de enganche (patrón "mecanismo listo" ya usado por
   * matarIndividuo/cadáveres): una fauna salvaje muerta en combate debe
   * pasar por GestorFaunaSalvaje.matarIndividuo (persiste, quita del
   * estado Y crea su cadáver) — pero ese gestor solo vive en HubRoom.
   * Devuelve `true` si ya se encargó de quitarla del estado (para que
   * `finalizarMuerte` no lo intente otra vez); `false` = no hay gestor
   * aquí, que la quite el camino genérico (sin cadáver).
   */
  protected async onFaunaMuerta(_id: string): Promise<boolean> {
    return false;
  }

  private combatePorUnidad(id: string): [string, CombateSchema] | null {
    for (const [combateId, combate] of this.state.combates.entries()) {
      if (combate.unidades.has(id)) return [combateId, combate];
    }
    return null;
  }

  private unidadDesdeSchema(cu: CombateUnidad): UnidadCombate {
    return {
      id: cu.id, esJugador: cu.esJugador, bando: cu.bando as Bando,
      gx: cu.gx, gy: cu.gy, hp: cu.hp, hpMax: cu.hpMax,
      pa: cu.pa, paMax: cu.paMax,
      iniciativa: cu.iniciativa, estado: cu.estado as UnidadCombate["estado"],
      ataqueFisico: cu.ataqueFisico, defensaFisica: cu.defensaFisica, alcance: cu.alcance,
    };
  }

  /** Aplica una lista de UnidadCombate (salida del motor puro) sobre el CombateSchema real. */
  private aplicarUnidadesASchema(combate: CombateSchema, unidades: UnidadCombate[]) {
    for (const u of unidades) {
      const cu = combate.unidades.get(u.id);
      if (!cu) continue;
      const hpAntes = cu.hp;
      cu.gx = u.gx; cu.gy = u.gy; cu.hp = u.hp; cu.pa = u.pa; cu.estado = u.estado;
      this.aplicarVida(u.id, u.hp); // el estado "real" (Player/Fauna/Npc/Enemigo) es la fuente de verdad fuera del combate

      // Resistencia (docs/GDD_Personaje.md §3.2, "recibir golpes"): el
      // objetivo puede haber sido golpeado por otro jugador (manejarCombateAccion)
      // o por la IA de un enemigo/fauna (avanzarTurnosIA) — este es el
      // único punto donde ambos caminos convergen, así que es el sitio
      // correcto para detectar "un jugador encajó daño" sea quien sea el atacante.
      if (cu.esJugador && u.hp < hpAntes) {
        void this.otorgarXpAtributoPorSessionId(u.id, "resistencia", XP_RESISTENCIA_POR_GOLPE_RECIBIDO);
      }
    }
  }

  private arenaDeCombate(combate: CombateSchema): Arena {
    return { ancho: combate.ancho, alto: combate.alto, obstaculos: Uint8Array.from(combate.obstaculos) };
  }

  /** Recorta un NxN de `this.mundo` centrado en (cx,cy) — se desplaza para caber entero si choca con el borde del mapa. */
  private construirArenaDeCombate(cx: number, cy: number, lado: number): { gx0: number; gy0: number; arena: Arena } {
    let gx0 = Math.round(cx - lado / 2);
    let gy0 = Math.round(cy - lado / 2);
    gx0 = Math.max(0, Math.min(gx0, this.mundo.ancho - lado));
    gy0 = Math.max(0, Math.min(gy0, this.mundo.alto - lado));
    const obstaculos = new Uint8Array(lado * lado);
    for (let gy = 0; gy < lado; gy++) {
      for (let gx = 0; gx < lado; gx++) {
        if (tipoEn(this.mundo, gx0 + gx, gy0 + gy) === TIPO.SOLIDO) obstaculos[gy * lado + gx] = 1;
      }
    }
    return { gx0, gy0, arena: { ancho: lado, alto: lado, obstaculos } };
  }

  protected crearUnidadCombate(
    id: string,
    bando: Bando,
    gx: number,
    gy: number,
    stats: { hp: number; hpMax: number; ataque: number; defensa: number; esJugador: boolean },
  ): CombateUnidad {
    const cu = new CombateUnidad();
    cu.id = id;
    cu.esJugador = stats.esJugador;
    cu.bando = bando;
    cu.gx = Math.max(0, Math.round(gx));
    cu.gy = Math.max(0, Math.round(gy));
    cu.hp = stats.hp;
    cu.hpMax = stats.hpMax;
    // Destreza (docs/GDD_Personaje.md §3.3): un jugador con más nivel tiene
    // más PA (más acciones por turno, ahora que AP+MP están unificados en un
    // único pool, §9.3) — solo aplica a jugadores, fauna/enemigos/NPCs se
    // quedan en el tope fijo de siempre.
    const paMax = stats.esJugador ? paMaxPorDestreza(this.state.players.get(id)?.atributos.destreza ?? 1) : PA_MAX_COMBATE;
    cu.pa = paMax; cu.paMax = paMax;
    cu.iniciativa = calcularIniciativa(10, Math.random);
    cu.estado = "activo";
    cu.ataqueFisico = stats.ataque;
    cu.defensaFisica = stats.defensa;
    cu.alcance = 1; // cuerpo a cuerpo por defecto — sin cálculo de arma equipada todavía (GDD_Mecanicas §5.4)
    return cu;
  }

  /**
   * Especie es "peligrosa" para efectos de auto-unión a un combate cercano
   * (docs/GDD_Combate.md §9.1) — por defecto nadie (una room sin catálogo de
   * fauna salvaje cargado, p.ej. un interior, no auto-une nada); HubRoom lo
   * sobreescribe con su `catalogoCombate` real.
   */
  protected faunaEsPeligrosa(_especieId: string): boolean {
    return false;
  }

  /** Hook para cuando un combate de ESTA room se resuelve (bando entero caído/huido) — no-op por defecto; ArenaCombateRoom lo usa para teleportar de vuelta y propagar resultados. */
  protected onCombateResuelto(_combateId: string, _combate: CombateSchema): void {}

  /** Quita el marcador de "combate en curso" de esta room — lo llama la room de arena, vía matchMaker, cuando el combate termina (docs/GDD_Combate.md §9.2). */
  public quitarMarcadorCombate(combateId: string) {
    this.state.combatesEnCurso.delete(combateId);
  }

  /** Aplica el resultado final de un combatiente NO-jugador que peleó en una arena aparte, sobre SU entidad real en esta room (docs/GDD_Combate.md §9.2) — mismo efecto que si hubiera muerto/sobrevivido aquí mismo. */
  public async aplicarResultadoRemoto(id: string, hp: number, estadoFinal: "activo" | "caido" | "huido") {
    this.aplicarVida(id, hp);
    if (estadoFinal === "caido") await this.finalizarMuerte(id);
  }

  private manejarCombateIniciar(client: Client, msg: { objetivoId?: string; retorno?: RetornoJugador }) {
    const atacanteId = client.sessionId;
    const atacante = this.state.players.get(atacanteId);
    if (!atacante || !msg?.objetivoId || msg.objetivoId === atacanteId) return;
    if (this.combatePorUnidad(atacanteId)) return client.send("combate:error", { motivo: "ya estás en combate" });
    if (msg.retorno) this.retornosPendientes.set(atacanteId, msg.retorno);

    // Si el objetivo ya está en un combate (co-op, GDD §1) — únete a ese
    // bando contrario. Si sigue "pendiente" (ventana de unión abierta,
    // §9.1) no hace falta tocar ordenTurnos: se recalcula entero al cerrar.
    const existente = this.combatePorUnidad(msg.objetivoId);
    if (existente) {
      const [, combate] = existente;
      const objetivoUnidad = combate.unidades.get(msg.objetivoId)!;
      const bandoPropio: Bando = objetivoUnidad.bando === "A" ? "B" : "A";
      const cu = this.crearUnidadCombate(atacanteId, bandoPropio, atacante.x - combate.gx0, atacante.y - combate.gy0, {
        hp: atacante.vida, hpMax: atacante.vidaMax, ataque: atacante.ataque, defensa: atacante.defensa, esJugador: true,
      });
      combate.unidades.set(atacanteId, cu);
      if (combate.fase === "activo") combate.ordenTurnos.push(atacanteId);
      return;
    }

    const objetivoStats = this.statsCombatiente(msg.objetivoId);
    if (!objetivoStats) return client.send("combate:error", { motivo: "objetivo no encontrado" });
    if (Math.hypot(objetivoStats.x - atacante.x, objetivoStats.y - atacante.y) > RADIO_INTERACCION) {
      return client.send("combate:error", { motivo: "demasiado lejos" });
    }

    const esBoss = this.state.enemigos.get(msg.objetivoId)?.esBoss ?? false;
    const lado = esBoss ? LADO_ARENA_BOSS : LADO_ARENA_NORMAL;
    const cx = Math.floor((atacante.x + objetivoStats.x) / 2);
    const cy = Math.floor((atacante.y + objetivoStats.y) / 2);
    const { gx0, gy0, arena } = this.construirArenaDeCombate(cx, cy, lado);

    const combate = new CombateSchema();
    combate.gx0 = gx0; combate.gy0 = gy0; combate.ancho = arena.ancho; combate.alto = arena.alto;
    for (const casilla of arena.obstaculos) combate.obstaculos.push(casilla);

    const uAtacante = this.crearUnidadCombate(atacanteId, "A", atacante.x - gx0, atacante.y - gy0, {
      hp: atacante.vida, hpMax: atacante.vidaMax, ataque: atacante.ataque, defensa: atacante.defensa, esJugador: true,
    });
    const uObjetivo = this.crearUnidadCombate(msg.objetivoId, "B", objetivoStats.x - gx0, objetivoStats.y - gy0, objetivoStats);
    combate.unidades.set(atacanteId, uAtacante);
    combate.unidades.set(msg.objetivoId, uObjetivo);

    // Ventana de unión (docs/GDD_Combate.md §9.1) — NO se resuelve nada
    // todavía: ordenTurnos se queda vacío hasta cerrarVentanaCombate.
    combate.fase = "pendiente";
    combate.cierraEn = Date.now() + VENTANA_UNION_COMBATE_MS;

    const combateId = `combate:${atacanteId}:${Date.now()}`;
    this.state.combates.set(combateId, combate);
    this.timeoutsVentanaCombate.set(combateId, this.clock.setTimeout(() => this.cerrarVentanaCombate(combateId), VENTANA_UNION_COMBATE_MS));
  }

  /** Unirse al bando del jugador que empezó el combate, mientras la ventana de unión sigue abierta (docs/GDD_Combate.md §9.1). */
  private manejarCombateUnirse(client: Client, msg: { combateId?: string; retorno?: RetornoJugador }) {
    const jugadorId = client.sessionId;
    const jugador = this.state.players.get(jugadorId);
    if (!jugador || !msg?.combateId) return;
    if (this.combatePorUnidad(jugadorId)) return client.send("combate:error", { motivo: "ya estás en combate" });

    const combate = this.state.combates.get(msg.combateId);
    if (!combate || combate.fase !== "pendiente") return client.send("combate:error", { motivo: "no se puede unir ahora" });

    const origenX = combate.gx0 + combate.ancho / 2, origenY = combate.gy0 + combate.alto / 2;
    if (Math.hypot(jugador.x - origenX, jugador.y - origenY) > RADIO_INTERACCION) {
      return client.send("combate:error", { motivo: "demasiado lejos" });
    }

    if (msg.retorno) this.retornosPendientes.set(jugadorId, msg.retorno);
    const cu = this.crearUnidadCombate(jugadorId, "A", jugador.x - combate.gx0, jugador.y - combate.gy0, {
      hp: jugador.vida, hpMax: jugador.vidaMax, ataque: jugador.ataque, defensa: jugador.defensa, esJugador: true,
    });
    combate.unidades.set(jugadorId, cu);
  }

  /** Cualquier participante ya apuntado puede saltarse lo que quede de la ventana de unión (docs/GDD_Combate.md §9.1). */
  private manejarCombateComenzarYa(client: Client, msg: { combateId?: string }) {
    if (!msg?.combateId) return;
    const combate = this.state.combates.get(msg.combateId);
    if (!combate || combate.fase !== "pendiente") return;
    if (!combate.unidades.has(client.sessionId)) return client.send("combate:error", { motivo: "no eres participante" });

    this.timeoutsVentanaCombate.get(msg.combateId)?.clear();
    this.timeoutsVentanaCombate.delete(msg.combateId);
    this.cerrarVentanaCombate(msg.combateId);
  }

  /**
   * Cierra la ventana de unión (por timeout o "comenzar ya"): auto-une
   * fauna/enemigos cercanos hostiles, calcula el roster final y lo pasa a
   * la arena instanciada (docs/GDD_Combate.md §9.1-9.2) — NUNCA resuelve
   * turnos aquí mismo, eso ya es trabajo de la room de arena.
   */
  private cerrarVentanaCombate(combateId: string) {
    const combate = this.state.combates.get(combateId);
    if (!combate || combate.fase !== "pendiente") return;
    this.timeoutsVentanaCombate.delete(combateId);

    const origenX = combate.gx0 + combate.ancho / 2, origenY = combate.gy0 + combate.alto / 2;

    // Auto-unión: Enemigo de mazmorra SIEMPRE (son hostiles por definición),
    // Fauna solo si la room sabe que es peligrosa (HubRoom, catalogoCombate).
    for (const [id, e] of this.state.enemigos.entries()) {
      if (combate.unidades.has(id)) continue;
      if (Math.hypot(e.x - origenX, e.y - origenY) > RADIO_INTERACCION) continue;
      const stats = this.statsCombatiente(id)!;
      combate.unidades.set(id, this.crearUnidadCombate(id, "B", stats.x - combate.gx0, stats.y - combate.gy0, stats));
    }
    for (const [id, f] of this.state.fauna.entries()) {
      if (combate.unidades.has(id) || !this.faunaEsPeligrosa(f.especieId)) continue;
      if (Math.hypot(f.x - origenX, f.y - origenY) > RADIO_INTERACCION) continue;
      const stats = this.statsCombatiente(id)!;
      combate.unidades.set(id, this.crearUnidadCombate(id, "B", stats.x - combate.gx0, stats.y - combate.gy0, stats));
    }

    // Roster para la room de arena — la fuente de verdad de este combate
    // deja de ser esta room a partir de aquí.
    const participantes: RosterArena["participantes"] = [];
    for (const u of combate.unidades.values()) {
      if (u.esJugador) {
        participantes.push({
          id: u.id, bando: u.bando as Bando, esJugador: true,
          hp: u.hp, hpMax: u.hpMax, ataqueFisico: u.ataqueFisico, defensaFisica: u.defensaFisica, alcance: u.alcance,
          nombreJugador: this.state.players.get(u.id)?.name,
          retorno: this.retornosPendientes.get(u.id),
        });
        this.retornosPendientes.delete(u.id);
      } else {
        const esEnemigo = this.state.enemigos.has(u.id);
        const base = {
          id: u.id, bando: u.bando as Bando, esJugador: false,
          hp: u.hp, hpMax: u.hpMax, ataqueFisico: u.ataqueFisico, defensaFisica: u.defensaFisica, alcance: u.alcance,
        };
        if (esEnemigo) {
          const e = this.state.enemigos.get(u.id)!;
          participantes.push({ ...base, tipoEntidad: "enemigo", enemigoId: e.enemigoId, variante: e.variante, esBoss: e.esBoss });
        } else {
          const f = this.state.fauna.get(u.id);
          participantes.push({ ...base, tipoEntidad: "fauna", especieId: f?.especieId ?? "" });
        }
      }
    }

    if (!this.catalogoArenas) this.catalogoArenas = cargarCatalogoArenas();
    const mapaArenaId = elegirArena(combateId, this.catalogoArenas);
    registrarRosterArena(combateId, { mapaArenaId, participantes, origenRoomId: this.roomId });

    const marcador = new MarcadorCombateSchema();
    marcador.x = origenX; marcador.y = origenY;
    this.state.combatesEnCurso.set(combateId, marcador);
    this.state.combates.delete(combateId); // el combate se va a la room de arena — esta room ya no lo resuelve

    for (const p of participantes) {
      if (!p.esJugador) continue;
      const c = this.clients.find((cl) => cl.sessionId === p.id);
      c?.send("portal:ir", { tipo: "combate", combateId, mapaArenaId });
    }
  }

  private manejarCombateMover(client: Client, msg: { combateId?: string; gx?: number; gy?: number }) {
    if (!msg?.combateId || typeof msg.gx !== "number" || typeof msg.gy !== "number") return;
    const combate = this.state.combates.get(msg.combateId);
    if (!combate) return;
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== client.sessionId) return client.send("combate:error", { motivo: "no es tu turno" });
    const cu = combate.unidades.get(client.sessionId);
    if (!cu || cu.estado !== "activo") return;

    const arena = this.arenaDeCombate(combate);
    const ocupadas = new Set<string>();
    for (const otra of combate.unidades.values()) {
      if (otra.id !== cu.id && otra.estado === "activo") ocupadas.add(`${otra.gx},${otra.gy}`);
    }
    const coste = costeCasilla(arena, { gx: cu.gx, gy: cu.gy }, { gx: msg.gx, gy: msg.gy }, cu.pa, ocupadas);
    if (coste === null) return client.send("combate:error", { motivo: "casilla no alcanzable con tu PA" });

    cu.gx = msg.gx; cu.gy = msg.gy; cu.pa -= coste;

    // Destreza (docs/GDD_Personaje.md §3.2): moverse por la arena entrena
    // reflejos/agilidad — cu.esJugador ya lo garantiza (solo un jugador
    // envía este mensaje, ver la comprobación de turno de arriba).
    void this.otorgarXpAtributoPorSesion(client, "destreza", XP_DESTREZA_POR_MOVER_EN_COMBATE);
  }

  private async manejarCombateAccion(client: Client, msg: { combateId?: string; objetivoId?: string }) {
    if (!msg?.combateId || !msg?.objetivoId) return;
    const combate = this.state.combates.get(msg.combateId);
    if (!combate) return;
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== client.sessionId) return client.send("combate:error", { motivo: "no es tu turno" });
    const atacante = combate.unidades.get(client.sessionId);
    const objetivo = combate.unidades.get(msg.objetivoId);
    if (!atacante || atacante.estado !== "activo" || !objetivo || objetivo.estado !== "activo") return;
    if (atacante.pa < COSTE_PA_ATAQUE) return client.send("combate:error", { motivo: "sin PA suficiente" });
    if (!enAlcance(this.unidadDesdeSchema(atacante), this.unidadDesdeSchema(objetivo))) {
      return client.send("combate:error", { motivo: "fuera de alcance" });
    }

    const actualizado = resolverAtaque(this.unidadDesdeSchema(atacante), this.unidadDesdeSchema(objetivo));
    this.aplicarUnidadesASchema(combate, [actualizado]);
    atacante.pa -= COSTE_PA_ATAQUE;

    // Destreza Y Fuerza (docs/GDD_Personaje.md §3.2, "dando golpes"): un
    // golpe conectado entrena ambas — atacante SIEMPRE es un jugador aquí
    // (idActual===client.sessionId ya lo garantiza más arriba).
    void this.otorgarXpAtributoPorSesion(client, "destreza", XP_DESTREZA_POR_GOLPE_CONECTADO);
    void this.otorgarXpAtributoPorSesion(client, "fuerza", XP_FUERZA_POR_GOLPE_CONECTADO);

    if (await this.comprobarFinDeCombate(msg.combateId)) return;
    void this.avanzarTurnosIA(msg.combateId);
  }

  private async manejarCombatePasarTurno(client: Client, msg: { combateId?: string }) {
    if (!msg?.combateId) return;
    const combate = this.state.combates.get(msg.combateId);
    if (!combate) return;
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== client.sessionId) return;
    this.avanzarTurno(combate);
    if (await this.comprobarFinDeCombate(msg.combateId)) return;
    void this.avanzarTurnosIA(msg.combateId);
  }

  private async manejarCombateHuir(client: Client, msg: { combateId?: string }) {
    if (!msg?.combateId) return;
    const combate = this.state.combates.get(msg.combateId);
    if (!combate) return;
    const idActual = combate.ordenTurnos[combate.turnoActual];
    if (idActual !== client.sessionId) return;
    const cu = combate.unidades.get(client.sessionId);
    if (!cu) return;
    cu.estado = "huido";
    this.avanzarTurno(combate);
    if (await this.comprobarFinDeCombate(msg.combateId)) return;
    void this.avanzarTurnosIA(msg.combateId);
  }

  /** Avanza turnoActual (con vuelta); al dar la vuelta completa regenera PA de las unidades activas. */
  private avanzarTurno(combate: CombateSchema) {
    if (combate.ordenTurnos.length === 0) return;
    const anterior = combate.turnoActual;
    combate.turnoActual = (combate.turnoActual + 1) % combate.ordenTurnos.length;
    if (combate.turnoActual <= anterior) {
      for (const cu of combate.unidades.values()) {
        if (cu.estado === "activo") cu.pa = cu.paMax;
      }
    }
  }

  /** Resuelve automáticamente los turnos de fauna/enemigo/npc en cascada hasta que le toque a un jugador o el combate termine. */
  protected async avanzarTurnosIA(combateId: string) {
    for (let ronda = 0; ronda < TOPE_RONDAS_CASCADA_IA; ronda++) {
      const combate = this.state.combates.get(combateId);
      if (!combate || combate.ordenTurnos.length === 0) return;
      const idActual = combate.ordenTurnos[combate.turnoActual];
      const cu = combate.unidades.get(idActual);
      if (!cu || cu.estado !== "activo") {
        this.avanzarTurno(combate);
        if (await this.comprobarFinDeCombate(combateId)) return;
        continue;
      }
      if (cu.esJugador) return; // le toca a un jugador: esperar su mensaje

      const arena = this.arenaDeCombate(combate);
      const unidadesPuras = [...combate.unidades.values()].map((u) => this.unidadDesdeSchema(u));
      const resultado = jugarTurnoIA(idActual, unidadesPuras, arena);
      this.aplicarUnidadesASchema(combate, resultado);
      if (await this.comprobarFinDeCombate(combateId)) return;
      const combateVivo = this.state.combates.get(combateId);
      if (!combateVivo) return;
      this.avanzarTurno(combateVivo);
    }
  }

  private bandoTerminado(combate: CombateSchema, bando: Bando): boolean {
    let hayAlguno = false;
    for (const cu of combate.unidades.values()) {
      if (cu.bando !== bando) continue;
      hayAlguno = true;
      if (cu.estado === "activo") return false;
    }
    return hayAlguno;
  }

  /** Aplica bajas reales (finalizarMuerte por cada "caido") y termina el combate si algún bando cayó entero. Devuelve true si terminó. */
  private async comprobarFinDeCombate(combateId: string): Promise<boolean> {
    const combate = this.state.combates.get(combateId);
    if (!combate) return true;
    for (const cu of [...combate.unidades.values()]) {
      if (cu.estado === "caido") await this.finalizarMuerte(cu.id);
    }
    if (this.bandoTerminado(combate, "A") || this.bandoTerminado(combate, "B")) {
      this.onCombateResuelto(combateId, combate);
      this.state.combates.delete(combateId);
      return true;
    }
    return false;
  }

  private actualizarMovimiento() {
    const dt = 1 / TICK_HZ;
    this.inputs.forEach((dir, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) return;

      const idx = Math.floor(player.y) * this.mundo.ancho + Math.floor(player.x);
      const medio = medioEn(this.mundo, player.x, player.y);
      const seMueve = dir.x !== 0 || dir.y !== 0;
      // Sprint (docs/GDD_Personaje.md §3.4): solo en tierra, solo con
      // estamina de sobra — sin ella, corre igual que andar aunque el
      // cliente siga pidiendo `correr` (no hay penalización dura, solo se
      // pierde la ventaja de velocidad hasta que la estamina se regenere).
      const corriendoDeVerdad = medio === TIPO.TIERRA && seMueve && !!dir.correr && player.vitales.estamina > 0;
      let vel: number;
      if (medio === TIPO.AGUA || medio === TIPO.AGUA_PROFUNDA) {
        vel = player.nivel < 0 ? VEL_BUCEAR : VEL_NADAR;
      } else if (corriendoDeVerdad) {
        vel = VEL_CORRER * (this.mundo.velocidad[idx] ?? 1);
        player.vitales.estamina = Math.max(0, player.vitales.estamina - ESTAMINA_GASTO_POR_SEG_CORRIENDO * dt);
      } else {
        vel = VEL_ANDAR * (this.mundo.velocidad[idx] ?? 1);
      }

      if (seMueve) {
        const norma = Math.hypot(dir.x, dir.y);
        const paso = (vel * dt) / norma;
        const destino = moverAABB(this.mundo, player.x, player.y, dir.x * paso, dir.y * paso);
        player.x = destino.x;
        player.y = destino.y;
      }

      // Resistencia por movimiento (docs/GDD_Personaje.md §3.4, pedido
      // 2026-08-30): tiempo REAL acumulado corriendo/andando en tierra —
      // solo se toca BD al cruzar el umbral, nunca cada tick (30hz sería
      // reventar la BD por nada).
      if (medio === TIPO.TIERRA && seMueve) {
        const acumulado = this.tiempoMovimiento.get(sessionId) ?? { correr: 0, andar: 0 };
        if (corriendoDeVerdad) {
          acumulado.correr += dt;
          if (acumulado.correr >= SEGUNDOS_CORRER_POR_XP_RESISTENCIA) {
            acumulado.correr -= SEGUNDOS_CORRER_POR_XP_RESISTENCIA;
            void this.otorgarXpAtributoPorSessionId(sessionId, "resistencia", XP_RESISTENCIA_POR_INTERVALO_CORRIENDO);
          }
        } else {
          acumulado.andar += dt;
          if (acumulado.andar >= SEGUNDOS_ANDAR_POR_XP_RESISTENCIA) {
            acumulado.andar -= SEGUNDOS_ANDAR_POR_XP_RESISTENCIA;
            void this.otorgarXpAtributoPorSessionId(sessionId, "resistencia", XP_RESISTENCIA_POR_INTERVALO_ANDANDO);
          }
        }
        this.tiempoMovimiento.set(sessionId, acumulado);
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

    // Vitales (docs/GDD_Personaje.md) — mismo tick que YA existe para
    // movimiento/colisión, TODOS los jugadores conectados (no solo los que
    // tienen input activo: el hambre corre aunque el jugador esté quieto).
    // Integrador simple, sin checkpoint/timestamp — ver server/src/personaje/vitales.ts.
    const horasPorTick = dt / 3600;
    // Temperatura del mundo (docs/GDD_Clima.md): UNA vez por tick, no por
    // jugador — estación/hora son las mismas para todos en este instante.
    const { estacion, hora } = tiempoMundo();
    const tempMundoC = temperaturaMundo(estacion as Estacion, hora);
    this.state.players.forEach((player) => {
      tickVitales(player.vitales, horasPorTick);
      const extremo = aplicarTemperaturaCorporal(player.vitales, tempMundoC, horasPorTick);
      this.aplicarInanicionA(player, horasPorTick, extremo !== null);
    });
  }

  /** Aplica la inanición pura de vitales.ts (docs/GDD_Personaje.md §3.6, §GDD_Clima.md) sobre este Player concreto — resuelve sus dos vidaMax (normal vs. reducido) a partir de su Resistencia real; `temperaturaExtrema` añade el mismo debilitamiento que la inanición sin dañar `vida` por sí solo. */
  private aplicarInanicionA(player: Player, horasTranscurridas: number, temperaturaExtrema: boolean) {
    aplicarInanicion(
      player.vitales,
      player,
      vidaMaximaPorResistencia(player.atributos.resistencia),
      vidaMaximaPorResistencia(1),
      DANO_INANICION_POR_HORA,
      horasTranscurridas,
      temperaturaExtrema,
    );
  }
}
