import * as fs from "fs";
import * as path from "path";
import { Room, Client, Delayed } from "@colyseus/core";
import { HubState, Player, ObjetoMundoSchema, MarcadorCombateSchema, Mascota, Barco, Fauna, Npc, ComercioSchema, OfertaComercioSchema, CadaverSchema, AnimalGranjaSchema } from "../schema/HubState";
import { Cadaver, cadaverDesaparecio, ANCHO_INVENTARIO_CADAVER, ALTO_INVENTARIO_CADAVER } from "../../mundo/cadaveres";
import { EstadisticasCombateAnimal, CategoriaVidaAnimal, CategoriaProductoGranja } from "../../mundo/catalogoCombateFauna";
import { pielDeDesollado, rellenarLootCaza } from "../../mundo/lootCaza";
import { estaEncerrado, tiroEscape } from "../../mundo/ganaderia";
import { cargarCatalogoReproduccionGranja, resolverReproduccionPropiedad } from "../../mundo/reproduccionGranja";
import { NPC_TENDERO_VENTA, NPC_TENDERO_COMPRA, REPOSICION_STOCK_NPC } from "../../mercado/catalogoNpcComercio";
import { diaFraccional } from "../../mundo/reproduccionFauna";
import { CombateSchema, CombateUnidad } from "../schema/CombateState";
import { RosterArena, RetornoJugador, registrarRosterArena } from "../../combate/registroArenas";
import { cargarCatalogoArenas, elegirArena } from "../../combate/seleccionArena";
import { MundoColision, moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ, tipoEn, casillaAguaCercana } from "../../mundo/colisiones";
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
import { MapaCargado, BordeMapa } from "../../mundo/mapaColision";
import { recolectableCercano, recolectablesQuitadosDeMapa } from "../../mundo/recolectables";
import {
  CatalogoItems,
  Contenedor,
  crearContenedor,
  cargarCatalogoItems,
  quitarItem,
  agregarItem,
  cargarCatalogoRecetas,
  excedePesoMaximo,
  moverItem,
  buscarHueco,
  SlotsEquipo,
  InventarioJugador,
  equiparItem,
  desequiparItem,
  calcularStatsEquipo,
  SLOTS_CONTENEDOR,
  comidaSirveParaDieta,
} from "../../inventario/inventario";
import { intentarCoger, Cogible } from "../../inventario/cogerSoltar";
import { sincronizarContenedor, sincronizarEquipo } from "../../inventario/sincronizarSchema";
import { CatalogoMonturas, cargarCatalogoMonturas } from "../../mundo/catalogoMonturas";
import { CatalogoBarcos, cargarCatalogoBarcos } from "../../mundo/catalogoBarcos";
import { IAlmacenDatos, ModoTenencia, ContratoTransporte, Mascota as MascotaFila, UbicacionMascota, CultivoHibrido, PlatoCreado, AnimalGranjaFila, Barco as BarcoFila, PREFIJO_NPC_COMERCIANTE } from "../../datos/bd";
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
import { EstadoCurtidor, aceptaEntradaCurtidor, huecoMaterialCurtidor, iniciarLoteCurtidor, curtidorListo, recolectarLoteCurtidor } from "../../construccion/curtido";
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
import { curar, ATAQUE_BASE_JUGADOR, DEFENSA_BASE_JUGADOR } from "../../combate/combate";
import { RoomConectable, registrarRoom, quitarRoom, registrarJugador, quitarJugador } from "../../twitch/registro";
import { obtenerGestorTwitch } from "../../twitch/gestorTwitch";
import { TipoEvento } from "../../twitch/catalogoEventos";
import { resolverSesionTwitch } from "../../twitch/oauthLogin";
import { aplicarPenalizacionMuerte, PiezaEquipada, registrarUso, estaRoto } from "../../inventario/desgaste";
import { resolverRespawn } from "../../personaje/respawn";
import { pvpGlobalHabilitado, fijarPvpGlobal } from "../../mundo/pvp";
import { tocaPicar, elegirCaptura, INTERVALO_PICADA_MS, VENTANA_REACCION_MS, MOVIMIENTOS_BOYA } from "../../personaje/pesca";
import { EstadoCultivo, nivelAgua, nivelFertilizante, puedeSembrarEnMes, listaParaCosechar, resolverCosecha, mezclarRasgos, derivarCrecimientoHibrido, nombreHibrido, nombreLegible, mezclarColor } from "../../cultivo/cultivo";
import { EstadoCocina, cocinarSimple, cocinarPlato, clavePlato, nombrePlato, estaHirviendo, segundosParaHervir, IngredienteCocina, familiaDePlato, prefijoDe, aceptaEnVasija, aptoParaEnsalada, aportesDesdeRestaura, FamiliaPlato, ResultadoCoccion, OrigenCocina } from "../../cocina/cocina";
import { EstadoQuesera, estadoQueseraInicial, iniciarLoteQueso, loteQuesoListo, recolectarLoteQueso } from "../../construccion/cuajado";

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

// Oficio de jugador (docs/GDD_Caza.md, sistema mínimo v1, pedido 2026-08-30):
// mismos ids que ya usa `receta.oficio` en items/catalogo/recetas.json, más
// "peletero" (nuevo, sin recetas de crafteo todavía, solo gatea desollar).
// Lista cerrada a propósito — un id que no está aquí no es un typo tolerado.
const OFICIOS_JUGADOR_VALIDOS = new Set([
  "herrero", "carpintero", "picapedrero", "curtidor", "sastre", "joyero", "peletero", "ganadero",
]);

// --- Ganadería (docs/GDD_Ganaderia.md, pedido 2026-08-30) ---
// Mismo umbral que las mascotas urbanas (RegionRoom.VECES_COMIDA_PARA_DOMESTICAR)
// — número de veces distinto a propósito: aquí es un animal de granja, no una
// mascota que sigue al jugador, así que no comparten la constante.
const VECES_COMIDA_PARA_DOMESTICAR_GRANJA = 5;
/**
 * Qué hace falta para recolectar cada producto "vivo" — ítem que produce,
 * herramienta+oficio exigidos (ausentes = cualquiera puede, como los
 * huevos), y el mismo molde de `resolverProduccion` (cantidadPorDia,
 * capacidadMax) que ya usa colmena/curtidor. Añadir un producto nuevo es
 * solo una entrada más aquí — cero mensaje nuevo (regla 7 del CLAUDE.md).
 */
// "huevos" NO está aquí a propósito (docs/GDD_Ganaderia.md, ampliación
// 2026-08-30, pedido explícito del streamer): en vez de un acumulador
// abstracto recolectado por `animal:recolectarProducto`, las aves ponen
// huevos FÍSICOS visibles en el mundo — ver `resolverReproduccionAnimalesPropiedad`.
const PRODUCTOS_GRANJA: Partial<Record<CategoriaProductoGranja, { itemId: string; herramienta?: string; exigeOficio?: boolean; cantidadPorDia: number; capacidadMax: number }>> = {
  leche: { itemId: "leche", herramienta: "cubo_ordeno", exigeOficio: true, cantidadPorDia: 2, capacidadMax: 6 },
  lana: { itemId: "lana", herramienta: "tijeras_esquilar", exigeOficio: true, cantidadPorDia: 1, capacidadMax: 3 },
};

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
// vive aquí (cualquier room); "dar de comer"/domesticar (manejarMascotaDarComidaGenerico,
// abajo) también vive aquí desde docs/GDD_Monturas.md (2026-08-30) — cada
// Room solo aporta CÓMO encuentra/quita a su candidato (RegionRoom: fauna
// urbana vía GestorFauna; HubRoom: fauna salvaje vía GestorFaunaSalvaje),
// el resto (comida diet-aware, progreso, crear mascota) es idéntico.
// Placeholder de balance. ---
const VEL_MASCOTA = 3.4; // ligeramente más lenta que VEL_ANDAR — sigue, no adelanta
const DIST_SEGUIMIENTO_MASCOTA = 1.3; // separación objetivo respecto al dueño
const DIST_TELEPORT_MASCOTA = 15; // el dueño cambió de sitio de golpe (portal/spawn) — no perseguir media room a pie
const VECES_COMIDA_PARA_DOMESTICAR = 5;
const DISTANCIA_SALTO_MONTURA = 2.5; // casillas de un salto
const COOLDOWN_SALTO_MONTURA_MS = 3000;
// Barcos (docs/GDD_Barcos.md, pedido 2026-08-30) — a cuántas casillas del
// borde del mapa se considera "llegando" (para el aviso de mapa vecino).
const DISTANCIA_AVISO_BORDE_MAPA = 2.5;

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

  // Login con Twitch (docs/GDD_Twitch.md §7) — solo se guarda para poder dar
  // la MISMA clave a quitarJugador() en onLeave (ver registro.ts); vive y
  // muere con la sesión, igual que `inputs`.
  private twitchLoginPorSesion = new Map<string, string>();

  // Muerte/respawn (docs/GDD_Muerte_Respawn.md) — guardia de idempotencia,
  // ver el comentario de manejarMuerteJugador.
  private jugadoresMuriendo = new Set<string>();

  // PvP (docs/GDD_PvP.md, pedido 2026-08-30): "todas menos la ciudad
  // capital y alrededores" — zona segura SIEMPRE gana al interruptor
  // global, tenga el jarl el PvP activado o no. Por defecto false (una
  // aldea/POI normal, un interior, una arena...) — HubRoom y la región con
  // tier "capital_jarl" lo ponen a true en su propio onCreate.
  protected esZonaSeguraPropia = false;

  // --- Comercio jugador-jugador (docs/GDD_Comercio.md, pedido 2026-08-30) ---
  // Solicitud "pulsé T apuntando a X" sin respuesta mutua todavía — caduca
  // sola (VENTANA_SOLICITUD_COMERCIO_MS) para no dejar una intención colgada
  // si el otro nunca contesta. Vive y muere con la sesión, mismo criterio
  // que el resto del estado efímero de esta clase.
  private solicitudesComercio = new Map<string, { objetivo: string; expira: number }>();
  /** sessionId -> comercioId del comercio ABIERTO en el que participa (como mucho uno a la vez). */
  private comerciosPorSesion = new Map<string, string>();
  private siguienteComercioId = 1;
  private static readonly VENTANA_SOLICITUD_COMERCIO_MS = 8000;

  // --- Pesca (docs/GDD_Pesca.md, pedido 2026-08-30) — vive y muere con la
  // sesión, mismo criterio que `durmiendo`/`craftesEnCurso`. `timer` es el
  // Delayed de Colyseus que dispara la próxima picada o el escape del pez
  // (mismo patrón que `timeoutsVentanaCombate`).
  private pescaPorSesion = new Map<string, { x: number; y: number; fase: "esperando" | "picando"; itemId?: string; timer?: Delayed }>();

  // --- Mascotas (docs/GDD_Mascotas.md) — solo lo que "siguiendo" necesita
  // en ESTA room: qué sessionId es el dueño de cada mascotaId (nunca en el
  // Schema, ver comentario de Mascota en HubState.ts), y qué mascotaIds
  // spawneó cada sesión (limpieza O(1) en onLeave). El offset de seguimiento
  // es puramente cosmético — no hace falta persistirlo ni sincronizarlo.
  private mascotaDuenoSesion = new Map<number, string>();
  private mascotasPorSesion = new Map<string, Set<number>>();
  private offsetMascota = new Map<number, { ang: number; dist: number }>();
  // Domesticar (docs/GDD_Mascotas.md/docs/GDD_Monturas.md) — quién le está
  // dando de comer a QUÉ individuo salvaje/urbano ahora mismo, vive y muere
  // con la room (nunca en BD, se reinicia solo si nadie termina las 5 veces).
  protected progresoDomesticar = new Map<string, { sessionId: string; veces: number }>();
  // Montura (docs/GDD_Monturas.md, pedido 2026-08-30) — sessionId de quien
  // está montado -> datos de la montura en curso; separado del Schema
  // (Player.monturaEspecieId/monturaMascotaId solo replica lo visual, la
  // velocidad real y el cooldown de salto viven aquí, server-only, mismo
  // criterio que pescaPorSesion/tiempoMovimiento.
  protected montadoPorSesion = new Map<string, { mascotaId: number; especieId: string; velocidad: number }>();
  private cooldownSaltoMontura = new Map<string, number>(); // sessionId -> epoch ms del próximo salto permitido

  // --- Barcos (docs/GDD_Barcos.md, pedido 2026-08-30) — a diferencia de una
  // montura animal (1 jinete, desaparece del Schema), un barco tiene varias
  // plazas y SIGUE visible en state.barcos aunque esté ocupado: solo se
  // oculta el rig humanoide de cada ocupante en el cliente. Todo esto vive
  // y muere con la room, igual que montadoPorSesion/pescaPorSesion.
  protected catalogoBarcos: CatalogoBarcos = cargarCatalogoBarcos();
  /** sessionId -> en qué barco va y si es quien lo pilota (el resto son pasajeros que se mueven con él). */
  protected barcosPorSesion = new Map<string, { barcoId: number; esCapitan: boolean }>();
  /** barcoId (= clave numérica de state.barcos) -> sessionIds ocupantes ordenados, [0] siempre el capitán. */
  protected ocupantesDeBarco = new Map<number, string[]>();
  /** id de mapa (carpeta bajo assets/mapas/) que esta room representa — lo fija HubRoom en onCreate; usado para bd.listarBarcosDe/actualizarPosicionBarco. "" en rooms sin barcos (interior/región/arena). */
  protected mapaIdPropio = "";
  /** norte/sur/este/oeste del mapa actual (docs/GDD_Barcos.md "Barcos y navegación marítima") — solo HubRoom lo rellena en onCreate; undefined en el resto (RegionRoom/InteriorRoom no tienen "borde de mundo"). */
  protected bordesMapa?: Record<"norte" | "sur" | "este" | "oeste", BordeMapa>;
  /** sessionId (capitán) -> dirección del último aviso "mapa:vecino" enviado, o null si no está cerca de ningún borde ahora mismo — evita reenviar cada tick mientras se queda quieto ahí. */
  private avisoVecinoPorSesion = new Map<string, string | null>();

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
  // Equipo (docs/GDD_Equipo.md, 2026-08-30) — mismo criterio que `inventarios`
  // arriba: PURO por sesión, sin persistencia esta fase, `player.inventario.
  // equipo`/`extras` (Schema) son solo el espejo de red (sincronizarEquipo).
  // `extrasInventario`: slot contenedor (espalda/cinturon/bandolera) -> su
  // Contenedor propio — los 3 pueden convivir a la vez por diseño.
  protected extrasInventario = new Map<string, Map<string, Contenedor>>();
  protected equipoInventario = new Map<string, SlotsEquipo>();
  protected catalogoItems: CatalogoItems = cargarCatalogoItems();
  // Cadáveres (docs/GDD_Caza.md) — estado PURO (state.cadaveres es solo el
  // espejo de red, mismo criterio que `inventarios`/`player.inventario.cuerpo`).
  // Poblado por publicarCadaver(); mapaId lo fija cada subclase que llame a
  // publicarCadaver por primera vez (hoy solo HubRoom, vía fauna salvaje).
  protected cadaveresPuros = new Map<string, Cadaver>();
  private mapaIdCadaveres = "";
  // Ganadería (docs/GDD_Ganaderia.md) — mismo criterio que cadaveresPuros:
  // estado PURO, state.animalesGranja es solo el espejo de red. Poblado por
  // publicarAnimalGranja() en iniciarConstruccion() (disponible en
  // HubRoom Y RegionRoom, a diferencia de cadáveres).
  protected animalesGranjaPuros = new Map<string, AnimalGranjaFila>();
  private contadorAnimalGranja = 0;
  /** Cría de descendencia (docs/GDD_Ganaderia.md, ampliación 2026-08-30) — catálogo reducido, cargado perezosamente UNA vez por room, INDEPENDIENTE de `estadisticasFaunaDe`/`catalogoFaunaSalvaje` (ver `reproduccionGranja.ts`: sin el atajo de `poblacionInfinita`, que no aplica a un animal ya domesticado). */
  private catalogoReproduccionGranja?: Record<string, import("../../mundo/reproduccionFauna").EspecieReproductiva>;
  private cargarReproduccionGranja() {
    if (!this.catalogoReproduccionGranja) {
      this.catalogoReproduccionGranja = cargarCatalogoReproduccionGranja(path.resolve(__dirname, "..", "..", "..", "..", "baker", "catalogo", "animales.json"));
    }
    return this.catalogoReproduccionGranja;
  }
  /** Progreso de "domesticar" un animal de granja (docs/GDD_Ganaderia.md) — mismo patrón que RegionRoom.progresoDomesticar (mascotas), pero aquí vive en la base para funcionar en cualquier room. */
  private progresoDomesticarGranja = new Map<string, { faunaId: string; veces: number }>();
  // docs/GDD_Monturas.md — qué especies son `montable` y a qué velocidad
  // (personajes/catalogo/animales_rig.json), cargado una vez por room igual
  // que catalogoItems.
  protected catalogoMonturas: CatalogoMonturas = cargarCatalogoMonturas();
  private siguienteObjetoMundoId = 1;
  // Asignado por HubRoom/RegionRoom tras cargar su mapa — habilita "coger" de
  // recolectables del bake exterior sin que esta base conozca su tipo
  // concreto de room; InteriorRoom en cambio sobreescribe buscarCogibleEnMundo.
  protected mapaExterior?: MapaCargado;

  /** slotId (clave de `state.npcs`) → oficio, poblado por RegionRoom desde poblacion.json al cargar el mapa (docs/GDD_Economia.md) — SOLO se usa hoy para encontrar NPCs "tendero" con comercio real; el resto de oficios sigue siendo flavor. */
  protected oficiosNpc = new Map<string, string>();

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

  // --- Injertos (docs/GDD_Agricultura.md §4) — especies híbridas creadas
  // por OTRAS rooms/sesiones pasadas viven en BD, no en items.json en
  // disco; se funden en `catalogoItems` UNA vez por vida de esta room
  // (`asegurarHibridosCargados`, awaited al principio de cada mensaje
  // cultivo:*/injerto:* — barato tras la primera vez gracias a este flag).
  private hibridosCargados = false;

  // --- Cocina (docs/GDD_Cocina.md, pedido 2026-08-30) — mismo criterio que
  // los híbridos de injerto: los platos ya inventados por OTRAS
  // rooms/sesiones viven en BD, se funden en `catalogoItems` perezosamente.
  private platosCargados = false;

  // --- Combate instanciado (docs/GDD_Combate.md §9.1-9.2) ---
  /** Timer de cierre de la ventana de unión, por combate — se cancela si "comenzar ya" cierra antes. */
  private timeoutsVentanaCombate = new Map<string, Delayed>();
  /** Lo que mandó cada jugador en combate:iniciar/unirse para poder volver EXACTAMENTE de donde salió — vive y muere con el combate, nunca se persiste. */
  private retornosPendientes = new Map<string, RetornoJugador>();
  private catalogoArenas?: string[];
  /** docs/GDD_Caza.md — combates de "modo caza": sin ventana de unión, `cerrarVentanaCombate` se llama al instante y sus bucles de auto-unión (Enemigo/Fauna hostiles cercanos) se saltan. Se consume (borra) al usarse. */
  private combatesSinAutoUnion = new Set<string>();

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
      // Moverse de verdad también corta la pesca (docs/GDD_Pesca.md) — no
      // tiene sentido seguir "anclado" con la caña lanzada si el jugador se va.
      if (((dir?.x ?? 0) !== 0 || (dir?.y ?? 0) !== 0) && this.pescaPorSesion.has(client.sessionId)) {
        this.detenerPesca(client.sessionId);
        client.send("pesca:cancelada", {});
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
    // Exclusiones del bake por sector (docs/GDD_Bosques.md §7, pedido
    // 2026-08-30: "si se puede recolectar/talar/matar y se hace, acaba
    // desapareciendo" — también visualmente): el cliente lo pide justo
    // antes de materializar un sector (para no dibujar lo que ya no está)
    // Y también sirve para el caso "en vivo" si vuelve a preguntar. El
    // rectángulo de casillas (tileX0..tileY1, semiabierto) lo calcula el
    // cliente con su propio `indice` — esta base no necesita saber de
    // tamanoChunk/tamanoSectorChunks para los recolectables (posición
    // pura); solo el hook de árboles, ya sector-indexado en BD, necesita
    // sectorX/sectorY.
    this.onMessage("sector:exclusiones", async (client, msg: { sectorX?: number; sectorY?: number; tileX0?: number; tileY0?: number; tileX1?: number; tileY1?: number }) => {
      if (
        typeof msg?.sectorX !== "number" || typeof msg?.sectorY !== "number" ||
        typeof msg?.tileX0 !== "number" || typeof msg?.tileY0 !== "number" ||
        typeof msg?.tileX1 !== "number" || typeof msg?.tileY1 !== "number"
      ) return;
      const posiciones: string[] = [];
      const mapa = this.mapaExterior;
      if (mapa) {
        const quitados = recolectablesQuitadosDeMapa(mapa.rutaMapa);
        for (const idx of quitados) {
          const x = idx % mapa.ancho;
          const y = Math.floor(idx / mapa.ancho);
          if (x >= msg.tileX0 && x < msg.tileX1 && y >= msg.tileY0 && y < msg.tileY1) posiciones.push(`${x},${y}`);
        }
      }
      for (const { x, y } of await this.arbolesTaladosEnSector(msg.sectorX, msg.sectorY)) {
        posiciones.push(`${x},${y}`);
      }
      client.send("sector:exclusiones", { sectorX: msg.sectorX, sectorY: msg.sectorY, posiciones });
    });
    this.onMessage("soltar", (client, msg: { instanciaId?: number; cantidad?: number }) => this.manejarSoltar(client, msg));
    this.onMessage("equipo:equipar", (client, msg: { instanciaId?: number; slot?: string }) => this.manejarEquiparItem(client, msg));
    this.onMessage("equipo:desequipar", (client, msg: { slot?: string }) => this.manejarDesequiparItem(client, msg));
    this.onMessage("personaje:consumir", (client, msg: { instanciaId?: number }) => this.manejarPersonajeConsumir(client, msg));
    // Desempaquetar una "bolsa de N" (docs/GDD_Agricultura.md, pedido
    // 2026-08-30: "compras bolsa en tienda de 10 unidades, al abrir bolsa
    // salen 10u") — genérico, reusable para cualquier futuro paquete, no
    // solo bolsas de semillas.
    this.onMessage("objeto:abrir", (client, msg: { instanciaId?: number }) => this.manejarObjetoAbrir(client, msg));

    // Pesca (docs/GDD_Pesca.md, pedido 2026-08-30): caña + cebo, orilla, boya.
    this.onMessage("pesca:lanzar", (client) => this.manejarPescaLanzar(client));
    this.onMessage("pesca:interactuar", (client) => this.manejarPescaInteractuar(client));
    this.onMessage("pesca:cancelar", (client) => this.detenerPesca(client.sessionId));

    // Higiene y sueño en cama (docs/GDD_Personaje.md §3.6, pedido explícito 2026-08-30)
    this.onMessage("higiene:cagar", (client, msg: { instanciaId?: number }) => this.manejarHigieneCagar(client, msg));
    this.onMessage("higiene:lavar", (client) => this.manejarHigieneLavar(client));
    this.onMessage("dormir:iniciar", (client, msg: { construccionId?: number }) => this.manejarDormirIniciar(client, msg));
    this.onMessage("dormir:completar", (client) => this.manejarDormirCompletar(client));

    // Oficio de jugador (docs/GDD_Caza.md) — sistema mínimo, sin requisito ni exclusividad real.
    this.onMessage("oficio:elegir", (client, msg: { oficio?: string }) => this.manejarOficioElegir(client, msg));

    // Cadáveres/caza (docs/GDD_Caza.md)
    this.onMessage("cadaver:lootear", (client, msg: { cadaverId?: string }) => this.manejarCadaverLootear(client, msg));
    this.onMessage("cadaver:desollar", (client, msg: { cadaverId?: string }) => void this.manejarCadaverDesollar(client, msg));
    this.onMessage("piel:raspar", (client, msg: { instanciaId?: number; cantidad?: number }) => this.manejarPielRaspar(client, msg));

    // Encurtido de pieles (docs/GDD_Caza.md) — cubo_sal/barril_curtido,
    // mismo criterio que producción/crafteo: disponible en cualquier room,
    // no-op si no tiene ContextoConstruccion.
    this.onMessage("curtidor:cargarMaterial", (client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) => void this.manejarCurtidorCargarMaterial(client, msg));
    this.onMessage("curtidor:meterPiel", (client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) => void this.manejarCurtidorMeterPiel(client, msg));
    this.onMessage("curtidor:recolectar", (client, msg: { construccionId?: number }) => void this.manejarCurtidorRecolectar(client, msg));

    // Ganadería (docs/GDD_Ganaderia.md) — cría de animales domésticos:
    // domesticar en el exterior o comprar por tenderete, comedero/bebedero,
    // productos vivos (leche/lana/huevos), sacrificar. Disponible en
    // cualquier room, no-op si no tiene ContextoConstruccion.
    this.onMessage("animal:domesticar", (client, msg: { propiedadDestino?: string }) => void this.manejarAnimalDomesticar(client, msg));
    this.onMessage("animal:cargarComedero", (client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) => void this.manejarAnimalCargarComedero(client, msg));
    this.onMessage("animal:recolectarProducto", (client, msg: { animalId?: string; producto?: string }) => void this.manejarAnimalRecolectarProducto(client, msg));
    this.onMessage("animal:sacrificar", (client, msg: { animalId?: string }) => void this.manejarAnimalSacrificar(client, msg));
    this.onMessage("animal:consultar", (client, msg: { animalId?: string }) => void this.manejarAnimalConsultar(client, msg));

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
    // Venta de animales de granja (docs/GDD_Ganaderia.md) — mismo tenderete, categoría paralela a items (sin cantidad: un animal es una instancia entera).
    this.onMessage("tenderete:listarAnimal", (client, msg: { tenderoteId?: string; animalId?: string; precioFarycoins?: number }) => void this.manejarTenderoteListarAnimal(client, msg));
    this.onMessage("tenderete:quitarAnimalListado", (client, msg: { animalId?: string }) => void this.manejarTenderoteQuitarAnimalListado(client, msg));
    this.onMessage("tenderete:comprarAnimal", (client, msg: { tenderoteId?: string; animalId?: string; propiedadDestino?: string }) => void this.manejarTenderoteComprarAnimal(client, msg));

    // --- comercio con NPC tendero (docs/GDD_Economia.md, pedido 2026-08-30)
    // — auto-apuntado por proximidad al NPC "tendero" más cercano (mismo
    // criterio que mascota/cadáver/fauna), NO reusa tenderete:* (ese exige
    // una propiedad con dueño-jugador vía duenoDeTenderete; un NPC bakeado
    // no tiene propiedad ni jugador real detrás).
    this.onMessage("npc:comercioEscaparate", (client) => void this.manejarNpcComercioEscaparate(client));
    this.onMessage("npc:comprar", (client, msg: { npcId?: string; itemId?: string; cantidad?: number }) => void this.manejarNpcComprar(client, msg));
    this.onMessage("npc:vender", (client, msg: { npcId?: string; instanciaId?: number; cantidad?: number }) => void this.manejarNpcVender(client, msg));

    // --- producción/plantillas del jarl/transporte (docs/GDD_Produccion.md)
    // — mismo criterio que mercado: disponibles en cualquier room, no-op si
    // esta room no tiene ContextoConstruccion (comprobado dentro de cada handler).
    this.onMessage("produccion:recolectar", (client, msg: { construccionId?: number }) => this.manejarProduccionRecolectar(client, msg));

    // Agricultura (docs/GDD_Agricultura.md, pedido 2026-08-30): bancal/maceta.
    this.onMessage("cultivo:plantar", (client, msg: { construccionId?: number; instanciaId?: number }) => this.manejarCultivoPlantar(client, msg));
    this.onMessage("cultivo:regar", (client, msg: { construccionId?: number }) => this.manejarCultivoRegar(client, msg));
    this.onMessage("cultivo:abonar", (client, msg: { construccionId?: number }) => this.manejarCultivoAbonar(client, msg));
    this.onMessage("cultivo:cosechar", (client, msg: { construccionId?: number }) => this.manejarCultivoCosechar(client, msg));
    this.onMessage("cultivo:consultar", (client, msg: { construccionId?: number }) => this.manejarCultivoConsultar(client, msg));
    // Injertos (docs/GDD_Agricultura.md §4, diseño ya cerrado en el
    // backlog): mesa_injertos + dos semillas cualesquiera -> especie nueva.
    this.onMessage("injerto:crear", (client, msg: { construccionId?: number; instanciaIdA?: number; instanciaIdB?: number }) => this.manejarInjertoCrear(client, msg));

    // Cocina (docs/GDD_Cocina.md, pedido 2026-08-30, ampliado 2026-08-30
    // "cocina v2"): hoguera (sencillo) o vasija (combina varios ingredientes
    // en un plato — cuenco/cazuela/olla/cuenco_barro_grande/olla_grande/
    // tinaja_batidos, todas por el mismo protocolo genérico).
    this.onMessage("cocina:simple", (client, msg: { construccionId?: number; instanciaId?: number }) => this.manejarCocinaSimple(client, msg));
    this.onMessage("cocina:llenarAgua", (client, msg: { construccionId?: number }) => this.manejarCocinaLlenarAgua(client, msg));
    this.onMessage("cocina:anadir", (client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) => this.manejarCocinaAnadir(client, msg));
    this.onMessage("cocina:preparar", (client, msg: { construccionId?: number }) => this.manejarCocinaPreparar(client, msg));
    this.onMessage("cocina:consultar", (client, msg: { construccionId?: number }) => this.manejarCocinaConsultar(client, msg));
    // Cocina v2: combinaciones abiertas SIN vasija persistida (instantáneas,
    // mismo motor de identidad/caché que un plato de vasija) + cortar pan.
    this.onMessage("cocina:ensalada", (client, msg: { construccionId?: number; ingredientes?: { instanciaId: number; cantidad?: number }[] }) => void this.manejarCocinaEnsalada(client, msg));
    this.onMessage("cocina:bocadillo", (client, msg: { rellenos?: { instanciaId: number; cantidad?: number }[] }) => void this.manejarCocinaBocadillo(client, msg));
    this.onMessage("cocina:cortarPan", (client, msg: { instanciaId?: number }) => this.manejarCocinaCortarPan(client, msg));
    // Cocina v2: quesera (recipiente_queso) — mismo espíritu que curtidor,
    // módulo aparte (server/src/construccion/cuajado.ts) por no encajar
    // igual de bien en el modelo de curtido.ts (ver cabecera de cuajado.ts).
    this.onMessage("quesera:cargarLeche", (client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) => void this.manejarQueseraCargarLeche(client, msg));
    this.onMessage("quesera:iniciarLote", (client, msg: { construccionId?: number; conSal?: boolean }) => void this.manejarQueseraIniciarLote(client, msg));
    this.onMessage("quesera:recolectar", (client, msg: { construccionId?: number }) => void this.manejarQueseraRecolectar(client, msg));
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
    // con movimiento (Hub/Region/Interior): "dar de comer" está atado a
    // fauna concreta de cada room (urbana en RegionRoom, salvaje en
    // HubRoom), cada una lo registra por su cuenta llamando al genérico de
    // la base.
    this.onMessage("mascota:listar", (client) => this.manejarMascotaListar(client));
    this.onMessage("mascota:llamar", (client, msg: { mascotaId?: number }) => this.manejarMascotaLlamar(client, msg));
    this.onMessage("mascota:dejarEnPropiedad", (client, msg: { mascotaId?: number; propiedadId?: string }) => this.manejarMascotaDejarEnPropiedad(client, msg));

    // --- Monturas (docs/GDD_Monturas.md, pedido 2026-08-30) ---
    this.onMessage("mascota:ponerMontura", (client, msg: { mascotaId?: number }) => this.manejarMascotaPonerMontura(client, msg));
    this.onMessage("mascota:montar", (client, msg: { mascotaId?: number }) => this.manejarMascotaMontar(client, msg));
    this.onMessage("mascota:desmontar", (client) => this.manejarMascotaDesmontar(client));
    this.onMessage("montura:saltar", (client, msg: { dx?: number; dy?: number }) => this.manejarMonturaSaltar(client, msg));

    // --- Barcos (docs/GDD_Barcos.md, pedido 2026-08-30) ---
    this.onMessage("barco:colocar", (client, msg: { itemId?: string }) => this.manejarBarcoColocar(client, msg));
    this.onMessage("barco:montar", (client, msg: { barcoId?: number }) => this.manejarBarcoMontar(client, msg));
    this.onMessage("barco:desmontar", (client) => this.manejarBarcoDesmontar(client));
    this.onMessage("mapa:viajarVecino", (client) => this.manejarMapaViajarVecino(client));

    // --- Twitch: disparadores de PRUEBA (docs/GDD_Twitch.md) — jarl-only,
    // mismo criterio que "inmueble:revocar"/el resto de herramientas admin
    // ya existentes. En producción, el conector real (chatBot.ts/EventSub
    // pendiente) llama a las MISMAS funciones de gestorTwitch.ts — esto
    // solo es la puerta de entrada para poder probar todo el mecanismo sin
    // depender de credenciales reales de Twitch.
    this.onMessage("twitch:simularCanje", (client, msg: { tipo?: TipoEvento }) => this.manejarTwitchSimularCanje(client, msg));
    this.onMessage("twitch:simularComando", (client, msg: { comando?: string }) => this.manejarTwitchSimularComando(client, msg));
    this.onMessage("twitch:forzarDirecto", (client, msg: { on?: boolean }) => this.manejarTwitchForzarDirecto(client, msg));

    // PvP (docs/GDD_PvP.md, pedido 2026-08-30): jarl-only, "inicialmente deshabilitada".
    this.onMessage("pvp:fijar", (client, msg: { on?: boolean }) => this.manejarPvpFijar(client, msg));

    // Comercio jugador-jugador (docs/GDD_Comercio.md, pedido 2026-08-30):
    // tecla T, mutuo — ambos deben pulsarla apuntándose el uno al otro.
    this.onMessage("comercio:solicitar", (client) => this.manejarComercioSolicitar(client));
    this.onMessage("comercio:ofrecer", (client, msg: { instanciaId?: number }) => this.manejarComercioOfrecer(client, msg));
    this.onMessage("comercio:quitarOferta", (client, msg: { instanciaId?: number }) => this.manejarComercioQuitarOferta(client, msg));
    // Traspaso de animales de granja (docs/GDD_Ganaderia.md) — mismo trato, categoría paralela a los ítems.
    this.onMessage("comercio:ofrecerAnimal", (client, msg: { animalId?: string }) => this.manejarComercioOfrecerAnimal(client, msg));
    this.onMessage("comercio:quitarOfertaAnimal", (client, msg: { animalId?: string }) => this.manejarComercioQuitarOfertaAnimal(client, msg));
    this.onMessage("comercio:confirmar", (client) => void this.manejarComercioConfirmar(client));
    this.onMessage("comercio:cancelar", (client) => this.manejarComercioCancelar(client));

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

  protected crearJugador(client: Client, options: { name?: string; twitchSession?: string }, x: number, y: number): Player {
    const player = new Player();
    player.x = x;
    player.y = y;
    player.name = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { x: 0, y: 0 });

    // Login con Twitch (docs/GDD_Twitch.md §7, pedido 2026-08-30): resuelve
    // el token que el cliente trae desde el redirect de OAuth (lo reusa en
    // CADA join — cruzar un portal es una conexión Colyseus nueva) — si es
    // válido, el registro de Twitch usa el login REAL (único de verdad) en
    // vez del nombre del PJ, así que el chat te reconoce aunque tu PJ se
    // llame otra cosa. Sin `twitchSession` (nadie hizo login), todo sigue
    // exactamente igual que antes.
    const identidadTwitch = options?.twitchSession ? resolverSesionTwitch(options.twitchSession) : null;
    if (identidadTwitch) {
      this.twitchLoginPorSesion.set(client.sessionId, identidadTwitch.twitchLogin);
      client.send("twitch:loginConfirmado", { twitchLogin: identidadTwitch.twitchLogin });
    }
    registrarJugador(player.name, this, client.sessionId, identidadTwitch?.twitchLogin); // Twitch (docs/GDD_Twitch.md) — para comandos de chat y títulos

    const contenedor = crearContenedor(ANCHO_CUERPO, ALTO_CUERPO);
    this.inventarios.set(client.sessionId, contenedor);
    sincronizarContenedor(player.inventario.cuerpo, contenedor); // sin esto el Schema se queda en ancho=0/alto=0 (bug real, ver crítica del diseño)
    this.extrasInventario.set(client.sessionId, new Map());
    this.equipoInventario.set(client.sessionId, {});

    // Mascotas "siguiendo" (docs/GDD_Mascotas.md) — sin awaitear a propósito
    // (mismo criterio que otorgarXpAtributoPorSesion): el jugador entra ya,
    // sus mascotas aparecen un instante después vía BD, nunca bloquean el join.
    void this.cargarMascotasSiguiendoDe(client, player.name);

    // Inventario/equipo persistido (docs/GDD_Equipo.md §9 → ya implementado):
    // mismo criterio que las mascotas — el cuerpo vacío de arriba se ve un
    // instante y luego se sustituye por lo guardado, sin bloquear el join.
    void this.cargarInventarioYEquipoDe(client, player.name);

    return player;
  }

  async onLeave(client: Client) {
    const nombreSaliente = this.state.players.get(client.sessionId)?.name;
    const twitchLoginSaliente = this.twitchLoginPorSesion.get(client.sessionId);
    this.twitchLoginPorSesion.delete(client.sessionId);
    if (nombreSaliente) quitarJugador(nombreSaliente, client.sessionId, twitchLoginSaliente); // Twitch (docs/GDD_Twitch.md) — solo si el registro sigue siendo el de ESTA sesión (nombres duplicados, ver registro.ts)

    // Persistencia de inventario/equipo (docs/GDD_Equipo.md): se captura la
    // referencia ANTES de borrar los Map de abajo — guardarInventarioYEquipoDe
    // es la única vez que se AWAITEA de verdad (a diferencia de coger/soltar/
    // equipar, que disparan el guardado en segundo plano): aquí sí importa
    // que la escritura a BD termine antes de que Colyseus dé la sesión por
    // cerrada del todo, para no perder el último cambio de una desconexión
    // brusca.
    const invSaliente = nombreSaliente ? this.inventarioJugador(client.sessionId) : null;

    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.inventarios.delete(client.sessionId);
    this.extrasInventario.delete(client.sessionId);
    this.equipoInventario.delete(client.sessionId);
    this.tiempoMovimiento.delete(client.sessionId);
    this.solicitudesComercio.delete(client.sessionId);
    // Montura (docs/GDD_Monturas.md): solo limpieza en memoria — la mascota
    // sigue "siguiendo" en BD tal cual (nunca se persiste "montado"), vuelve
    // a aparecer desmontada en la próxima room a la que entre el dueño.
    this.montadoPorSesion.delete(client.sessionId);
    this.cooldownSaltoMontura.delete(client.sessionId);
    // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): a diferencia de una
    // mascota, el barco SÍ hace falta anclarlo en BD si el que se
    // desconecta era el último a bordo (si no, quedaría "flotando" en
    // memoria y reaparecería en su última posición del tick anterior en vez
    // de la real al recargar la room) — por eso este SÍ se await-ea.
    await this.desembarcarSesionId(client.sessionId);
    this.avisoVecinoPorSesion.delete(client.sessionId);
    // Comercio: desconectarse a medias cancela el trato entero (nada se
    // mueve, mismo criterio "todo o nada" que un hueco insuficiente).
    const comercioAbierto = this.comerciosPorSesion.get(client.sessionId);
    if (comercioAbierto) this.cerrarComercio(comercioAbierto, "cancelado");
    this.detenerPesca(client.sessionId);

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

    if (nombreSaliente && invSaliente) await this.guardarInventarioYEquipoDe(nombreSaliente, invSaliente);
  }

  /**
   * Carga cuerpo/mochilas/equipo guardados de una sesión (docs/GDD_Equipo.md
   * §9) — misma identidad que el resto de progreso del jugador (gremio,
   * oficios, mascotas): `jugador_id` vía `obtenerOCrearJugador(nombre)`, NO
   * el `twitchLogin` (ese es solo para que el chat te reconozca, GDD_Twitch
   * §7 — el nombre del PJ sigue siendo la identidad real de guardado, igual
   * que ya hace el resto del juego). Sin awaitear desde crearJugador a
   * propósito, igual que cargarMascotasSiguiendoDe.
   */
  private async cargarInventarioYEquipoDe(client: Client, nombre: string) {
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const equipo = await bd.cargarEquipo(jugador.id);
    const cuerpo = await bd.cargarContenedor(jugador.id, "cuerpo");

    // Mochila/bandolera/bolsa de cinturón (SLOTS_CONTENEDOR): solo se cargan
    // las que el equipo guardado dice que siguen puestas — una fila de
    // `inventarios` huérfana (bolsa que se desequipó en su día) se queda sin
    // referencia y no vuelve a aparecer, sin necesidad de borrarla aparte.
    const extras = new Map<string, Contenedor>();
    for (const slot of SLOTS_CONTENEDOR) {
      const itemId = equipo[slot];
      if (!itemId) continue;
      const guardado = await bd.cargarContenedor(jugador.id, slot);
      if (guardado) {
        extras.set(slot, guardado);
      } else {
        // No debería pasar (guardarInventarioYEquipoDe guarda ambos a la
        // vez) — por si acaso, una rejilla vacía del tamaño real del ítem en
        // vez de perder el hueco entero.
        const dims = this.catalogoItems[itemId]?.esContenedor;
        extras.set(slot, crearContenedor(dims?.ancho ?? 1, dims?.alto ?? 1));
      }
    }

    // La sesión pudo desconectarse mientras esto cargaba (mismo criterio de
    // guarda que spawnearMascota) — no resucitar Maps de una sesión que ya
    // se limpió en onLeave.
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (cuerpo) {
      this.inventarios.set(client.sessionId, cuerpo);
      sincronizarContenedor(player.inventario.cuerpo, cuerpo);
    }
    this.equipoInventario.set(client.sessionId, equipo);
    this.extrasInventario.set(client.sessionId, extras);
    sincronizarEquipo(player.inventario, equipo, extras);
    this.recalcularStatsJugador(client);
  }

  /** Guarda cuerpo + cada mochila/bandolera/bolsa puesta + equipo — reemplazo completo, mismo criterio que sincronizarContenedor/sincronizarEquipo (reconstruye entero, nunca diffea). */
  private async guardarInventarioYEquipoDe(nombre: string, inv: InventarioJugador) {
    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    await bd.guardarContenedor(jugador.id, "cuerpo", inv.cuerpo);
    for (const [slot, contenedorExtra] of inv.extras) {
      await bd.guardarContenedor(jugador.id, slot, contenedorExtra);
    }
    await bd.guardarEquipo(jugador.id, inv.equipo);
  }

  /**
   * Dispara el guardado de inventario/equipo de una sesión EN SEGUNDO PLANO
   * (mismo criterio que otorgarXpAtributoPorSesion/cargarMascotasSiguiendoDe
   * — nunca bloquea al jugador que acaba de coger/soltar/equipar/desequipar
   * algo) — se llama tras cada mutación real de coger/soltar/equipar/
   * desequipar; `onLeave` guarda por su cuenta (ahí sí importa awaitear).
   */
  private persistirInventarioPorSesion(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const inv = this.inventarioJugador(client.sessionId);
    if (!player?.name || !inv) return;
    void this.guardarInventarioYEquipoDe(player.name, inv);
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
    this.persistirInventarioPorSesion(client);

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
        recolectablesQuitadosDeMapa(mapa.rutaMapa).add(encontrado.idx);
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
    this.persistirInventarioPorSesion(client);
  }

  /** Vista unificada (cuerpo+extras+equipo) del inventario de UNA sesión — construida sobre los 3 Map puros, nunca guardada aparte (evita que se desincronicen entre sí). */
  private inventarioJugador(sessionId: string): InventarioJugador | null {
    const cuerpo = this.inventarios.get(sessionId);
    const extras = this.extrasInventario.get(sessionId);
    const equipo = this.equipoInventario.get(sessionId);
    if (!cuerpo || !extras || !equipo) return null;
    return { cuerpo, extras, equipo };
  }

  /**
   * Recalcula ataque/defensa (físico y mágico) del jugador a partir de la
   * base de combate (docs/GDD_Mecanicas.md §5.4) + lo que sume TODO lo
   * equipado (docs/GDD_Equipo.md) — se llama tras CUALQUIER cambio de
   * equipo, nunca en un tick; nunca toca vida/vidaMax (esos dependen de
   * Resistencia, docs/GDD_Personaje.md §3.3, no de equipo).
   */
  private recalcularStatsJugador(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const equipo = this.equipoInventario.get(client.sessionId);
    if (!player || !equipo) return;
    const stats = calcularStatsEquipo(this.catalogoItems, equipo);
    player.ataque = ATAQUE_BASE_JUGADOR + stats.ataqueFisico;
    player.defensa = DEFENSA_BASE_JUGADOR + stats.defensaFisica;
    player.ataqueMagico = stats.ataqueMagico;
    player.defensaMagica = stats.defensaMagica;
  }

  /**
   * Equipar (docs/GDD_Equipo.md): la instancia puede venir de CUALQUIER
   * contenedor propio (cuerpo o una mochila/bolsa ya puesta) — mismo
   * criterio "servidor autoritativo" que coger/soltar, el cliente solo pide
   * y muestra el resultado. Tras un cambio real: sincroniza cuerpo (la
   * instancia salió de ahí O de un extra) + equipo/extras + recalcula stats.
   */
  private manejarEquiparItem(client: Client, msg: { instanciaId?: number; slot?: string }) {
    const player = this.state.players.get(client.sessionId);
    const inv = this.inventarioJugador(client.sessionId);
    if (!player || !inv) return;
    if (typeof msg?.instanciaId !== "number" || typeof msg?.slot !== "string") return;

    const resultado = equiparItem(inv, this.catalogoItems, msg.instanciaId, msg.slot);
    if (!resultado.ok) {
      client.send("equipo:error", { motivo: resultado.motivo ?? "no_equipable_en_ese_slot" });
      return;
    }

    sincronizarContenedor(player.inventario.cuerpo, inv.cuerpo);
    sincronizarEquipo(player.inventario, inv.equipo, inv.extras);
    this.recalcularStatsJugador(client);
    this.persistirInventarioPorSesion(client);
  }

  /**
   * Desequipar (docs/GDD_Equipo.md): la pieza vuelve SIEMPRE al `cuerpo`
   * (nunca a una mochila, para no tener que decidir a cuál) — comprueba el
   * peso transportable real (Fuerza, docs/GDD_Personaje.md §3.3): mientras
   * algo está puesto no pesa en la mochila, pero vuelve a contar en cuanto
   * se quita.
   */
  private manejarDesequiparItem(client: Client, msg: { slot?: string }) {
    const player = this.state.players.get(client.sessionId);
    const inv = this.inventarioJugador(client.sessionId);
    if (!player || !inv) return;
    if (typeof msg?.slot !== "string") return;

    const pesoMaximo = pesoMaximoTransportable(player.atributos.fuerza);
    const resultado = desequiparItem(inv, this.catalogoItems, msg.slot, pesoMaximo);
    if (!resultado.ok) {
      client.send("equipo:error", { motivo: resultado.motivo ?? "slot_vacio" });
      return;
    }

    sincronizarContenedor(player.inventario.cuerpo, inv.cuerpo);
    sincronizarEquipo(player.inventario, inv.equipo, inv.extras);
    this.recalcularStatsJugador(client);
    this.persistirInventarioPorSesion(client);
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
    if (!entrada || entrada.tipo !== "consumible" || (!entrada.restaura && !entrada.restauraMultiple)) {
      return client.send("personaje:error", { motivo: "no_se_puede_consumir" });
    }

    const resultado = quitarItem(contenedor, msg.instanciaId, 1);
    if (!resultado.ok) return client.send("personaje:error", { motivo: resultado.motivo ?? "no_encontrado" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    if (unidadCombate) unidadCombate.pa -= COSTE_PA_OBJETO;

    let valores: Partial<Record<"vida" | "estamina" | "comida" | "bebida" | "sueno" | "caca", number>>;
    if (entrada.restauraMultiple) {
      // Cocina (docs/GDD_Cocina.md, pedido 2026-08-30): un plato sube VARIOS
      // vitales a la vez en un solo consumo — mismo aplicarUnVital que abajo,
      // una vez por cada eje que el plato/ingrediente cocinado declare.
      valores = {};
      for (const [vital, cantidad] of Object.entries(entrada.restauraMultiple) as [keyof typeof entrada.restauraMultiple, number][]) {
        if (cantidad == null) continue;
        valores[vital] = this.aplicarUnVital(player, vital, cantidad);
      }
    } else {
      valores = { [entrada.restaura!.vital]: this.aplicarUnVital(player, entrada.restaura!.vital, entrada.restaura!.cantidad) };
    }
    client.send("personaje:consumido", { itemId: it.itemId, valores });
  }

  /**
   * Un único vital, ambas rutas de consumo (`restaura`/`restauraMultiple`)
   * pasan por aquí. "vida" NO vive en player.vitales (docs/GDD_Mecanicas.md
   * §5.4: Player.vida/vidaMax es la única fuente de HP) — se cura con la
   * MISMA función pura que usa combate.ts, aquí disparada por una acción
   * explícita del jugador (consumir), no por un tick: respeta la regla
   * "nadie se cura solo con el tiempo" tal cual, curar sigue siendo evento.
   */
  private aplicarUnVital(player: Player, vital: "vida" | "estamina" | "comida" | "bebida" | "sueno" | "caca", cantidad: number): number {
    if (vital === "vida") {
      const curado = curar({ vida: player.vida, vidaMax: player.vidaMax, ataque: player.ataque, defensa: player.defensa }, cantidad);
      player.vida = curado.vida;
      return player.vida;
    }
    restaurarVital(player.vitales, vital, cantidad);
    // Higiene (docs/GDD_Personaje.md §3.6, pedido explícito): "cada vez que
    // comes esa comida aumenta la barrita [de cagar]" — misma cantidad que
    // sube `comida`, al tope se ensucia solo.
    if (vital === "comida") {
      restaurarVital(player.vitales, "caca", cantidad);
      if (player.vitales.caca >= VITAL_MAX) player.sucio = true;
    }
    return player.vitales[vital];
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
   * Oficio de jugador (docs/GDD_Caza.md) — sistema MÍNIMO v1: elegir es
   * gratis, instantáneo, sin requisito y sin exclusividad real (cambiable
   * en cualquier momento, no hay "un solo oficio para siempre"). `oficio:""`
   * lo quita. No hay progresión de aprendizaje todavía — mismo hueco
   * "placeholder de balance a afinar" que el resto del proyecto.
   */
  private manejarOficioElegir(client: Client, msg: { oficio?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const oficio = (msg.oficio ?? "").trim();
    if (oficio !== "" && !OFICIOS_JUGADOR_VALIDOS.has(oficio)) {
      return client.send("oficio:error", { motivo: `oficio desconocido: ${oficio}` });
    }
    player.oficio = oficio;
    client.send("oficio:elegido", { oficio });
  }

  /**
   * Publica un cadáver recién creado (docs/GDD_Caza.md) — estado puro
   * (`cadaveresPuros`, para lootear/desollar) + su espejo de red
   * (`state.cadaveres`, para que el cliente lo vea/renderice). Llamado hoy
   * SOLO por HubRoom al matar fauna salvaje (única room con cadáveres
   * reales); genérico a propósito (`Cadaver.tipoOrigen` ya admite
   * npc/jugador) para cuando exista muerte real de esos otros orígenes.
   */
  protected publicarCadaver(cadaver: Cadaver) {
    this.cadaveresPuros.set(cadaver.id, cadaver);
    this.mapaIdCadaveres = cadaver.mapaId;
    const schema = new CadaverSchema();
    schema.x = cadaver.x;
    schema.y = cadaver.y;
    schema.tipoOrigen = cadaver.tipoOrigen;
    schema.especieOrigenId = cadaver.especieOrigenId;
    sincronizarContenedor(schema.contenedor, cadaver.contenedor);
    this.state.cadaveres.set(cadaver.id, schema);
  }

  /**
   * Publica un animal de granja (docs/GDD_Ganaderia.md) — estado puro
   * (`animalesGranjaPuros`) + su espejo de red (`state.animalesGranja`).
   * A diferencia de publicarCadaver, se llama desde `iniciarConstruccion`
   * (compartido por HubRoom Y RegionRoom) — funciona en cualquier room con
   * ContextoConstruccion, no solo en el Hub.
   */
  protected publicarAnimalGranja(fila: AnimalGranjaFila) {
    this.animalesGranjaPuros.set(fila.id, fila);
    const schema = new AnimalGranjaSchema();
    schema.x = fila.x;
    schema.y = fila.y;
    schema.especieId = fila.especieId;
    schema.duenoNombre = this.ctxConstruccion?.propiedades.get(fila.propiedadId)?.dueno ?? "";
    this.state.animalesGranja.set(fila.id, schema);
  }

  /** Estadísticas de loot/combate de una especie — sobreescrito por HubRoom (única room con catalogoCombate real hoy); null en cualquier otra. */
  protected estadisticasFaunaDe(_especieId: string): EstadisticasCombateAnimal | null {
    return null;
  }

  /** Árboles de origen bake talados en un sector de bosque (docs/GDD_Bosques.md) — sobreescrito por HubRoom (único con GestorBosques hoy); `[]` en cualquier otra room. `sectorX/sectorY` en la MISMA numeración que el cliente (mismo `indice.tamanoSectorChunks`). */
  protected async arbolesTaladosEnSector(_sectorX: number, _sectorY: number): Promise<{ x: number; y: number }[]> {
    return [];
  }

  /** Barrido de expiración (docs/GDD_Caza.md, mismo `DIAS_HASTA_DESAPARECER_CADAVER` de cadaveres.ts) — llamarlo periódicamente desde onCreate de la subclase que publique cadáveres. */
  protected async limpiarCadaveresExpirados(ahora: number) {
    if (this.cadaveresPuros.size === 0) return;
    const bd = await obtenerBdCompartida();
    for (const [id, cadaver] of [...this.cadaveresPuros.entries()]) {
      if (!cadaverDesaparecio(cadaver, ahora)) continue;
      this.cadaveresPuros.delete(id);
      this.state.cadaveres.delete(id);
      await bd.borrarCadaver(id);
    }
  }

  /**
   * "Lootear todo": mueve al inventario del jugador todo lo que quepa
   * (peso/hueco) del contenedor del cadáver — carne/tendones/tripas del
   * loot automático al matar (lootCaza.ts), y cualquier cosa que quedara de
   * una sesión anterior. Lo que no quepa se queda en el cadáver para
   * después; no hace falta desollar para esto (verbos independientes,
   * decisión explícita del streamer).
   */
  private manejarCadaverLootear(client: Client, msg: { cadaverId?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const cadaverId = msg.cadaverId ?? "";
    const cadaver = this.cadaveresPuros.get(cadaverId);
    const cadaverSchema = this.state.cadaveres.get(cadaverId);
    if (!cadaver || !cadaverSchema) return client.send("cadaver:error", { motivo: "ese cadáver ya no está" });
    if (Math.hypot(cadaver.x - player.x, cadaver.y - player.y) > RADIO_INTERACCION) {
      return client.send("cadaver:error", { motivo: "demasiado lejos" });
    }

    const pesoMaximo = pesoMaximoTransportable(player.atributos.fuerza);
    let movidos = 0;
    for (const item of [...cadaver.contenedor.items]) {
      if (excedePesoMaximo(contenedor, this.catalogoItems, item.itemId, item.cantidad, pesoMaximo)) continue;
      if (intentarCoger(contenedor, this.catalogoItems, { itemId: item.itemId, cantidad: item.cantidad }).ok) {
        quitarItem(cadaver.contenedor, item.id, item.cantidad);
        movidos++;
      }
    }
    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    sincronizarContenedor(cadaverSchema.contenedor, cadaver.contenedor);
    void obtenerBdCompartida().then((bd) => bd.actualizarContenedorCadaver(cadaverId, cadaver.contenedor));
    client.send("cadaver:lootado", { movidos });
  }

  /**
   * Desollar (docs/GDD_Caza.md): exige oficio curtidor/peletero (Player.oficio)
   * Y un cuchillo_desollar en el inventario. Da la piel de la especie (si
   * tiene) + tirada de trofeo (5%, lootCaza.ts) y el cadáver DESAPARECE
   * ENTERO — verbos ESTRICTAMENTE independientes de `cadaver:lootear`
   * (decisión explícita del streamer): si no has looteado antes, la
   * carne/tendones/tripas que quedaran en el cadáver se pierden con él.
   */
  private async manejarCadaverDesollar(client: Client, msg: { cadaverId?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.oficio !== "curtidor" && player.oficio !== "peletero") {
      return client.send("cadaver:error", { motivo: "necesitas el oficio de curtidor o peletero" });
    }
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (!contenedor.items.some((it) => it.itemId === "cuchillo_desollar")) {
      return client.send("cadaver:error", { motivo: "necesitas un cuchillo de desollar" });
    }
    const cadaverId = msg.cadaverId ?? "";
    const cadaver = this.cadaveresPuros.get(cadaverId);
    if (!cadaver || !this.state.cadaveres.has(cadaverId)) {
      return client.send("cadaver:error", { motivo: "ese cadáver ya no está" });
    }
    if (Math.hypot(cadaver.x - player.x, cadaver.y - player.y) > RADIO_INTERACCION) {
      return client.send("cadaver:error", { motivo: "demasiado lejos" });
    }
    const especie = this.estadisticasFaunaDe(cadaver.especieOrigenId);
    if (!especie) return client.send("cadaver:error", { motivo: "no se puede desollar esto" });

    const pesoMaximo = pesoMaximoTransportable(player.atributos.fuerza);
    const entregar = (itemId: string, cantidad: number) => {
      if (excedePesoMaximo(contenedor, this.catalogoItems, itemId, cantidad, pesoMaximo)) return false;
      return intentarCoger(contenedor, this.catalogoItems, { itemId, cantidad }).ok;
    };

    const resultado = pielDeDesollado(especie);
    const entregados: string[] = [];
    if (resultado.pielItemId && entregar(resultado.pielItemId, resultado.pielCantidad)) entregados.push(resultado.pielItemId);
    if (resultado.trofeoItemId && entregar(resultado.trofeoItemId, 1)) entregados.push(resultado.trofeoItemId);

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    this.cadaveresPuros.delete(cadaverId);
    this.state.cadaveres.delete(cadaverId);
    const bd = await obtenerBdCompartida();
    await bd.borrarCadaver(cadaverId);
    client.send("cadaver:desollado", { entregados });
  }

  /**
   * Raspar una piel_salada con el cuchillo de desollar (docs/GDD_Caza.md,
   * paso 2/3 del encurtido, entre cubo_sal y barril_curtido) — acción
   * INSTANTÁNEA sobre el propio inventario, sin construcción de por medio.
   * Mismo gating que desollar: oficio curtidor/peletero + cuchillo_desollar.
   */
  private manejarPielRaspar(client: Client, msg: { instanciaId?: number; cantidad?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player || typeof msg?.instanciaId !== "number") return;
    if (player.oficio !== "curtidor" && player.oficio !== "peletero") {
      return client.send("piel:error", { motivo: "necesitas el oficio de curtidor o peletero" });
    }
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (!contenedor.items.some((it) => it.itemId === "cuchillo_desollar")) {
      return client.send("piel:error", { motivo: "necesitas un cuchillo de desollar" });
    }
    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it || it.itemId !== "piel_salada") return client.send("piel:error", { motivo: "eso no es una piel salada" });
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));

    const itemsAntes = contenedor.items.map((i) => ({ ...i }));
    const siguienteIdAntes = contenedor.siguienteId;
    const quitado = quitarItem(contenedor, it.id, cantidad);
    if (!quitado.ok) return;
    const agregado = agregarItem(contenedor, this.catalogoItems, "piel_raspada", cantidad);
    if (!agregado.ok) {
      contenedor.items = itemsAntes;
      contenedor.siguienteId = siguienteIdAntes;
      return client.send("piel:error", { motivo: "no tienes hueco para la piel raspada" });
    }

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("piel:raspada", { cantidad });
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

    // Ganadería (docs/GDD_Ganaderia.md) — `asentamiento` ES el mapaId real
    // aquí (HubRoom/RegionRoom llaman a iniciarConstruccion con el mismo
    // basename que usan para cadáveres) — se publican TAL CUAL, sin
    // resolver producción/escape en la carga: eso es perezoso, se resuelve
    // en la primera interacción real (mismo criterio que curtidor/colmena).
    for (const fila of await bd.listarAnimalesGranjaMapa(asentamiento)) {
      this.publicarAnimalGranja(fila);
    }

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

        // Cocina v2 (docs/GDD_Cocina.md): algunas piezas nuevas (olla_grande,
        // cuenco_barro_grande, tinaja_batidos, recipiente_queso,
        // estructura_palos) exigen tener el ítem craftado correspondiente en
        // el inventario y lo consumen al colocarse — el resto de construibles
        // del juego sigue gratis, sin excepción, esto es deliberadamente
        // acotado a estas piezas (ver `requiereItemColocar` en catalogo.ts).
        if (entrada.requiereItemColocar) {
          const contenedorColocar = this.inventarios.get(client.sessionId);
          const itemColocar = contenedorColocar?.items.find((it) => it.itemId === entrada.requiereItemColocar);
          if (!contenedorColocar || !itemColocar) {
            return this.errorConstruir(client, `necesitas ${entrada.requiereItemColocar} en el inventario para colocar esto`);
          }
          quitarItem(contenedorColocar, itemColocar.id, 1);
          const jugadorColocar = this.state.players.get(client.sessionId);
          if (jugadorColocar) sincronizarContenedor(jugadorColocar.inventario.cuerpo, contenedorColocar);
        }

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
    esquema.montura = mascota.montura; // docs/GDD_Monturas.md — la silla persiste con la mascota, se ve al reaparecer
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
    client.send("mascota:lista", mascotas.map((m) => ({ id: m.id, especieId: m.especieId, ubicacion: m.ubicacion, propiedadId: m.propiedadId, montura: m.montura })));
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

  /**
   * "Dar de comer" genérico (docs/GDD_Monturas.md, pedido 2026-08-30) — el
   * núcleo compartido entre RegionRoom (fauna urbana, `GestorFauna.quitar`
   * síncrono) y HubRoom (fauna salvaje, `GestorFaunaSalvaje.domesticar`
   * async, compartido con docs/GDD_Ganaderia.md): cada Room solo aporta
   * CÓMO encuentra su candidato más cercano (Schema/gestor distinto) y CÓMO
   * lo quita — comida diet-aware, progreso y creación de mascota son
   * idénticos en los dos sitios.
   */
  protected async manejarMascotaDarComidaGenerico(
    client: Client,
    candidato: { faunaId: string; especieId: string; dieta?: "herbivoro" | "carnivoro" | "omnivoro" } | null,
    quitarCandidato: (faunaId: string) => Promise<boolean> | boolean,
  ) {
    const player = this.state.players.get(client.sessionId);
    const contenedor = this.inventarios.get(client.sessionId);
    if (!player || !contenedor) return;
    if (!candidato) return client.send("mascota:error", { motivo: "nada_cerca" });

    const it = contenedor.items.find((i) => comidaSirveParaDieta(this.catalogoItems[i.itemId], candidato.dieta));
    if (!it) return client.send("mascota:error", { motivo: "sin_comida" });
    const resultado = quitarItem(contenedor, it.id, 1);
    if (!resultado.ok) return client.send("mascota:error", { motivo: resultado.motivo ?? "sin_comida" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    let progreso = this.progresoDomesticar.get(candidato.faunaId);
    if (!progreso || progreso.sessionId !== client.sessionId) progreso = { sessionId: client.sessionId, veces: 0 };
    progreso.veces++;

    if (progreso.veces >= VECES_COMIDA_PARA_DOMESTICAR) {
      this.progresoDomesticar.delete(candidato.faunaId);
      const quitado = await quitarCandidato(candidato.faunaId);
      if (!quitado) return; // se escapó/desactivó su sector justo entre medias (raro) — no crear una mascota fantasma
      const mascota = await this.crearMascota(client, candidato.especieId);
      client.send("mascota:domesticada", { mascotaId: mascota.id, especieId: candidato.especieId });
    } else {
      this.progresoDomesticar.set(candidato.faunaId, progreso);
      client.send("mascota:progreso", { faunaId: candidato.faunaId, veces: progreso.veces, faltan: VECES_COMIDA_PARA_DOMESTICAR - progreso.veces });
    }
  }

  // --- Monturas (docs/GDD_Monturas.md, pedido 2026-08-30) ---

  /**
   * Ponerle la silla a una mascota PROPIA ya domesticada y "siguiendo" cerca
   * (mismo auto-apuntado por `RADIO_INTERACCION` que darComida/coger) —
   * consume un ítem `esMontura` del inventario. Exige que la especie sea
   * `montable` de catálogo (docs/GDD_Mecanicas.md "Monturas acordado
   * 2026-08-27": "montable es un flag por especie, no por plantilla").
   * Permanente: una vez con silla, siempre se puede montar.
   */
  /**
   * Mascota PROPIA más cercana dentro de `RADIO_INTERACCION` que cumpla
   * `filtro` — mismo criterio "sin UI de targeting" que darComida/coger:
   * si el cliente ya manda un `mascotaId` explícito se respeta tal cual
   * (validado igual, por dueño+distancia), si no se auto-apunta.
   */
  private mascotaPropiaCercana(client: Client, mascotaId: number | undefined, filtro: (e: Mascota) => boolean): { id: number; esquema: Mascota } | null {
    const player = this.state.players.get(client.sessionId);
    if (!player) return null;
    if (typeof mascotaId === "number") {
      const esquema = this.state.mascotas.get(String(mascotaId));
      if (!esquema || this.mascotaDuenoSesion.get(mascotaId) !== client.sessionId) return null;
      if (Math.hypot(esquema.x - player.x, esquema.y - player.y) > RADIO_INTERACCION) return null;
      return filtro(esquema) ? { id: mascotaId, esquema } : null;
    }
    let mejor: { id: number; esquema: Mascota } | null = null;
    let mejorDist = RADIO_INTERACCION;
    this.state.mascotas.forEach((esquema, clave) => {
      const id = Number(clave);
      if (this.mascotaDuenoSesion.get(id) !== client.sessionId || !filtro(esquema)) return;
      const d = Math.hypot(esquema.x - player.x, esquema.y - player.y);
      if (d < mejorDist) { mejorDist = d; mejor = { id, esquema }; }
    });
    return mejor;
  }

  private async manejarMascotaPonerMontura(client: Client, msg: { mascotaId?: number }) {
    const player = this.state.players.get(client.sessionId);
    const contenedor = this.inventarios.get(client.sessionId);
    const nombre = this.nombreDe(client);
    if (!player || !contenedor || !nombre) return;

    const encontrada = this.mascotaPropiaCercana(client, msg?.mascotaId, (e) => !e.montura && !!this.catalogoMonturas[e.especieId]?.montable);
    if (!encontrada) return client.send("mascota:error", { motivo: "nada_cerca" });
    const { id: mascotaIdNum, esquema } = encontrada;

    const it = contenedor.items.find((i) => this.catalogoItems[i.itemId]?.esMontura === true);
    if (!it) return client.send("mascota:error", { motivo: "sin_silla" });
    const resultado = quitarItem(contenedor, it.id, 1);
    if (!resultado.ok) return client.send("mascota:error", { motivo: resultado.motivo ?? "sin_silla" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const ok = await bd.ponerMonturaMascota(mascotaIdNum, jugador.id);
    if (!ok) return client.send("mascota:error", { motivo: "no_es_tuya_o_no_esta_cerca" });
    esquema.montura = true;
    client.send("mascota:actualizada", { mascotaId: mascotaIdNum, ubicacion: "siguiendo" as UbicacionMascota, montura: true });
  }

  /**
   * Montar (docs/GDD_Mecanicas.md "Monturas acordado 2026-08-27"): fusiona
   * jugador+mascota en UNA sola entidad física — la mascota desaparece del
   * Schema (`quitarMascotaDeSchemaLocal`, igual que "dejar en propiedad")
   * mientras dura, el jugador pasa a moverse a la velocidad de la montura
   * (`actualizarMovimiento`, más abajo). `Player.monturaEspecieId` es lo
   * único que el cliente necesita para colgar el rig del jinete + el prop
   * de la silla del pivote `cuerpo` de la montura (client/src/render3d).
   */
  private manejarMascotaMontar(client: Client, msg: { mascotaId?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.montadoPorSesion.has(client.sessionId)) return client.send("mascota:error", { motivo: "ya_montado" });

    const encontrada = this.mascotaPropiaCercana(client, msg?.mascotaId, (e) => e.montura && !!this.catalogoMonturas[e.especieId]?.montable);
    if (!encontrada) return client.send("mascota:error", { motivo: "nada_cerca" });
    const { id: mascotaIdNum, esquema } = encontrada;
    const datosMontura = this.catalogoMonturas[esquema.especieId]!; // ya comprobado por el filtro de arriba

    this.montadoPorSesion.set(client.sessionId, { mascotaId: mascotaIdNum, especieId: esquema.especieId, velocidad: datosMontura.velocidadMontura });
    this.quitarMascotaDeSchemaLocal(mascotaIdNum);
    player.monturaEspecieId = esquema.especieId;
    player.monturaMascotaId = mascotaIdNum;
  }

  /** Desmontar: separa de nuevo en dos entidades — la mascota reaparece "siguiendo" justo donde está el jugador. */
  private manejarMascotaDesmontar(client: Client) {
    this.desmontarSesion(client);
  }

  /** Compartido con el auto-desmontar de combate/onLeave — `sessionId` directo, sin depender de tener un `Client` a mano. */
  protected desmontarSesionId(sessionId: string) {
    const montura = this.montadoPorSesion.get(sessionId);
    if (!montura) return;
    this.montadoPorSesion.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.monturaEspecieId = "";
    player.monturaMascotaId = 0;
    const nombre = player.name;
    if (!nombre) return;
    const esquema = new Mascota();
    esquema.especieId = montura.especieId;
    esquema.duenoNombre = nombre;
    esquema.x = player.x;
    esquema.y = player.y;
    esquema.montura = true;
    this.state.mascotas.set(String(montura.mascotaId), esquema);
    this.mascotaDuenoSesion.set(montura.mascotaId, sessionId);
    this.offsetMascota.set(montura.mascotaId, { ang: Math.random() * Math.PI * 2, dist: DIST_SEGUIMIENTO_MASCOTA });
    let set = this.mascotasPorSesion.get(sessionId);
    if (!set) { set = new Set(); this.mascotasPorSesion.set(sessionId, set); }
    set.add(montura.mascotaId);
  }

  private desmontarSesion(client: Client) {
    this.desmontarSesionId(client.sessionId);
  }

  /**
   * Saltar (pedido 2026-08-30, "solo es para moverse más rápido y saltar
   * nada más") — hop corto en la dirección en la que mira, ignora UN
   * obstáculo sólido de golpe (valla/muro bajo/hueco estrecho) pero nunca
   * sale del mapa ni aterriza en un medio distinto (un caballo no salta AL
   * agua). Cooldown para que no sea un dash infinito.
   */
  private manejarMonturaSaltar(client: Client, msg: { dx?: number; dy?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.montadoPorSesion.has(client.sessionId)) return;
    const ahora = Date.now();
    if ((this.cooldownSaltoMontura.get(client.sessionId) ?? 0) > ahora) return;
    let { dx = 0, dy = 0 } = msg ?? {};
    const norma = Math.hypot(dx, dy);
    if (norma < 0.01) return; // sin dirección (quieto): no hay hacia dónde saltar
    dx /= norma; dy /= norma;

    const medioActual = medioEn(this.mundo, player.x, player.y);
    const destinoX = player.x + dx * DISTANCIA_SALTO_MONTURA;
    const destinoY = player.y + dy * DISTANCIA_SALTO_MONTURA;
    if (tipoEn(this.mundo, destinoX, destinoY) === TIPO.SOLIDO) return; // no atraviesa un muro/borde de mapa
    if (medioEn(this.mundo, destinoX, destinoY) !== medioActual) return; // no cambia de medio de un salto (tierra<->agua)

    player.x = destinoX;
    player.y = destinoY;
    this.cooldownSaltoMontura.set(client.sessionId, ahora + COOLDOWN_SALTO_MONTURA_MS);
  }

  /**
   * Colocar un barco (docs/GDD_Barcos.md, pedido 2026-08-30): consume un
   * ítem `esBarco` del inventario y lo ancla en la casilla de agua más
   * cercana (nunca en el inventario de nuevo desde aquí — a diferencia de
   * la silla de montar, que se consume SOBRE otra cosa, un barco pasa a
   * vivir como su propia fila en `barcos` (BD) + entidad en state.barcos).
   */
  private async manejarBarcoColocar(client: Client, msg: { itemId?: string }) {
    const player = this.state.players.get(client.sessionId);
    const contenedor = this.inventarios.get(client.sessionId);
    const nombre = this.nombreDe(client);
    if (!player || !contenedor || !nombre || !this.mapaIdPropio) return;

    const it = typeof msg?.itemId === "string"
      ? contenedor.items.find((i) => i.itemId === msg.itemId && this.catalogoBarcos[i.itemId])
      : contenedor.items.find((i) => this.catalogoBarcos[i.itemId]);
    if (!it) return client.send("barco:error", { motivo: "sin_barco" });

    const agua = casillaAguaCercana(this.mundo, player.x, player.y, RADIO_INTERACCION);
    if (!agua) return client.send("barco:error", { motivo: "sin_agua_cerca" });

    const resultado = quitarItem(contenedor, it.id, 1);
    if (!resultado.ok) return client.send("barco:error", { motivo: resultado.motivo ?? "sin_barco" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const bd = await obtenerBdCompartida();
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const fila = await bd.crearBarco(jugador.id, it.itemId, this.mapaIdPropio, agua.x, agua.y);
    this.spawnearBarco(fila);
    client.send("barco:colocado", { barcoId: fila.id, x: fila.x, y: fila.y });
  }

  /** Crea/actualiza la entidad Schema de un barco a partir de su fila de BD — usado al colocar uno nuevo y al cargar los del mapa en onCreate. */
  protected spawnearBarco(fila: BarcoFila) {
    const esquema = new Barco();
    esquema.x = fila.x;
    esquema.y = fila.y;
    esquema.tipoId = fila.tipoId;
    this.state.barcos.set(String(fila.id), esquema);
  }

  /**
   * Barco propio... en realidad de CUALQUIERA — a diferencia de una
   * mascota, un barco no tiene "dueño con exclusiva": varias plazas, se
   * sube quien llegue mientras haya hueco (docs/GDD_Barcos.md §4). Nearest
   * dentro de RADIO_INTERACCION con hueco libre, o el `barcoId` explícito
   * si se manda (mismo criterio "sin UI de targeting" que mascotas).
   */
  private barcoConHuecoCercano(client: Client, barcoId: number | undefined): { id: number; esquema: Barco } | null {
    const player = this.state.players.get(client.sessionId);
    if (!player) return null;
    const tieneHueco = (id: number, esquema: Barco) => {
      const plazas = this.catalogoBarcos[esquema.tipoId]?.plazas ?? 1;
      return (this.ocupantesDeBarco.get(id)?.length ?? 0) < plazas;
    };
    if (typeof barcoId === "number") {
      const esquema = this.state.barcos.get(String(barcoId));
      if (!esquema || Math.hypot(esquema.x - player.x, esquema.y - player.y) > RADIO_INTERACCION) return null;
      return tieneHueco(barcoId, esquema) ? { id: barcoId, esquema } : null;
    }
    let mejor: { id: number; esquema: Barco } | null = null;
    let mejorDist = RADIO_INTERACCION;
    this.state.barcos.forEach((esquema, clave) => {
      const id = Number(clave);
      if (!tieneHueco(id, esquema)) return;
      const d = Math.hypot(esquema.x - player.x, esquema.y - player.y);
      if (d < mejorDist) { mejorDist = d; mejor = { id, esquema }; }
    });
    return mejor;
  }

  /** Embarcar: el primero en subir pilota (capitán), el resto son pasajeros que se mueven con el barco (RoomExteriorBase.actualizarMovimiento). A diferencia de montar un animal, el barco NUNCA desaparece del Schema (varias plazas a la vez). */
  private manejarBarcoMontar(client: Client, msg: { barcoId?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.barcosPorSesion.has(client.sessionId)) return client.send("barco:error", { motivo: "ya_embarcado" });

    const encontrado = this.barcoConHuecoCercano(client, msg?.barcoId);
    if (!encontrado) return client.send("barco:error", { motivo: "nada_cerca" });
    const { id: barcoId } = encontrado;

    let ocupantes = this.ocupantesDeBarco.get(barcoId);
    if (!ocupantes) { ocupantes = []; this.ocupantesDeBarco.set(barcoId, ocupantes); }
    const esCapitan = ocupantes.length === 0;
    ocupantes.push(client.sessionId);
    this.barcosPorSesion.set(client.sessionId, { barcoId, esCapitan });
    player.barcoId = barcoId;
    player.barcoCapitan = esCapitan;
  }

  private async manejarBarcoDesmontar(client: Client) {
    await this.desembarcarSesionId(client.sessionId);
  }

  /** Compartido con el auto-desembarco de combate/onLeave — `sessionId` directo, sin depender de tener un `Client` a mano (mismo criterio que desmontarSesionId de Monturas). */
  protected async desembarcarSesionId(sessionId: string) {
    const info = this.barcosPorSesion.get(sessionId);
    if (!info) return;
    this.barcosPorSesion.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) { player.barcoId = 0; player.barcoCapitan = false; }

    const ocupantes = this.ocupantesDeBarco.get(info.barcoId);
    if (ocupantes) {
      const idx = ocupantes.indexOf(sessionId);
      if (idx >= 0) ocupantes.splice(idx, 1);
      if (ocupantes.length === 0) {
        this.ocupantesDeBarco.delete(info.barcoId);
        // último en bajarse: ancla la posición actual en BD para que sobreviva a un reinicio de room.
        const esquema = this.state.barcos.get(String(info.barcoId));
        if (esquema && this.mapaIdPropio) {
          const bd = await obtenerBdCompartida();
          await bd.actualizarPosicionBarco(info.barcoId, this.mapaIdPropio, esquema.x, esquema.y);
        }
      } else if (info.esCapitan) {
        // el capitán se bajó con pasajeros a bordo: el siguiente en la lista pasa a pilotar.
        const nuevoCapitanId = ocupantes[0];
        const nuevoInfo = this.barcosPorSesion.get(nuevoCapitanId);
        if (nuevoInfo) nuevoInfo.esCapitan = true;
        const nuevoCapitan = this.state.players.get(nuevoCapitanId);
        if (nuevoCapitan) nuevoCapitan.barcoCapitan = true;
      }
    }
  }

  /**
   * Cruzar a un mapa exterior vecino en barco (docs/GDD_Barcos.md, pedido
   * 2026-08-30 "Barcos y navegación marítima"): solo el capitán, solo si de
   * verdad está junto a un borde `mar_abierto` con `nombre` (mapa vecino ya
   * bakeado — inerte mientras no lo esté, ver `bordesMapa`). Reancla el
   * barco en el mapa destino (BD) y manda `portal:ir` a TODOS los
   * ocupantes — cada cliente recarga a su cuenta (mismo mecanismo que
   * cualquier otro portal:ir), y cada `onLeave` que dispare esa recarga
   * limpia `barcosPorSesion` localmente (ver onLeave más abajo) SIN volver
   * a persistir posición (ya se hizo aquí, con el mapa correcto).
   */
  private async manejarMapaViajarVecino(client: Client) {
    const info = this.barcosPorSesion.get(client.sessionId);
    if (!info || !info.esCapitan) return client.send("barco:error", { motivo: "no_eres_capitan" });
    const player = this.state.players.get(client.sessionId);
    const esquema = this.state.barcos.get(String(info.barcoId));
    if (!player || !esquema || !this.bordesMapa) return;
    // Mismo criterio "sin UI de targeting" que portal:usar (F cerca de una
    // puerta la cruza): el servidor mira dónde está realmente el jugador
    // ahora mismo, ignorando cualquier dirección que mandara el cliente.
    const direccion = this.direccionBordeCercana(player);
    if (!direccion) return client.send("barco:error", { motivo: "no_estas_en_el_borde" });
    const borde = this.bordesMapa[direccion];
    if (!borde || borde.tipo !== "mar_abierto" || !borde.nombre) return client.send("barco:error", { motivo: "sin_mapa_vecino" });

    const rutaDestino = path.resolve(__dirname, "..", "..", "..", "..", "assets", "mapas", borde.nombre);
    if (!fs.existsSync(path.join(rutaDestino, "indice.json"))) return; // dato del índice apunta a un mapa que aún no existe en disco

    const bd = await obtenerBdCompartida();
    await bd.actualizarPosicionBarco(info.barcoId, borde.nombre, esquema.x, esquema.y);

    const ocupantes = this.ocupantesDeBarco.get(info.barcoId) ?? [client.sessionId];
    this.ocupantesDeBarco.delete(info.barcoId);
    this.state.barcos.delete(String(info.barcoId));
    for (const sid of ocupantes) {
      this.barcosPorSesion.delete(sid);
      this.avisoVecinoPorSesion.delete(sid);
      this.clients.find((c) => c.sessionId === sid)?.send("portal:ir", { tipo: "hub", mapaId: borde.nombre });
    }
  }

  /** Dirección de borde de mapa a la que `player` está pegado ahora mismo (dentro de DISTANCIA_AVISO_BORDE_MAPA), o null. Solo tiene sentido con `bordesMapa` cargado (HubRoom). */
  private direccionBordeCercana(player: Player): "norte" | "sur" | "este" | "oeste" | null {
    if (player.y <= DISTANCIA_AVISO_BORDE_MAPA) return "norte";
    if (player.y >= this.mundo.alto - DISTANCIA_AVISO_BORDE_MAPA) return "sur";
    if (player.x <= DISTANCIA_AVISO_BORDE_MAPA) return "oeste";
    if (player.x >= this.mundo.ancho - DISTANCIA_AVISO_BORDE_MAPA) return "este";
    return null;
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
    this.state.players.forEach((player, sessionId) => {
      if (this.eventoRayoActivo && !this.esInterior && Math.random() < PROB_RAYO_POR_SEG) {
        player.vida = Math.max(0, player.vida - DANO_RAYO);
      }
      if (this.eventoTerremotoActivo && Math.random() < PROB_TERREMOTO_POR_SEG) {
        player.vida = Math.max(0, player.vida - DANO_TERREMOTO);
      }
      // Muerte por daño ambiental (docs/GDD_Muerte_Respawn.md) — mismo
      // criterio "fire and forget" que el resto de efectos secundarios
      // async disparados desde un tick síncrono (otorgarXpAtributoPorSesion).
      if (player.vida <= 0) void this.manejarMuerteJugador(sessionId);
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

  /** Jarl-only: activa/desactiva PvP global (docs/GDD_PvP.md) — "todas menos la capital", inicialmente deshabilitado. */
  private async manejarPvpFijar(client: Client, msg: { on?: boolean }) {
    const nombre = this.nombreDe(client);
    if (!nombre || !esJarlGlobal(nombre)) return client.send("pvp:error", { motivo: "solo el jarl puede cambiar esto" });
    const bd = await obtenerBdCompartida();
    await fijarPvpGlobal(bd, !!msg?.on);
    this.broadcast("pvp:actualizado", { on: !!msg?.on });
  }

  /** Jugador vivo más cercano dentro de RADIO_INTERACCION, excluyendo al propio emisor — mismo criterio de auto-apuntado sin UI que "coger"/"combate:iniciar". */
  private jugadorMasCercanoPara(sessionId: string): string | null {
    const yo = this.state.players.get(sessionId);
    if (!yo) return null;
    let mejorId: string | null = null;
    let mejorDist = RADIO_INTERACCION;
    for (const [id, p] of this.state.players.entries()) {
      if (id === sessionId) continue;
      const d = Math.hypot(p.x - yo.x, p.y - yo.y);
      if (d < mejorDist) {
        mejorDist = d;
        mejorId = id;
      }
    }
    return mejorId;
  }

  /**
   * Comercio jugador-jugador (docs/GDD_Comercio.md, pedido 2026-08-30):
   * ambos deben pulsar la tecla de comercio apuntándose el uno al otro
   * dentro de RADIO_INTERACCION — el primero en pulsar deja una solicitud
   * con ventana corta; si el segundo pulsa apuntando de vuelta antes de que
   * caduque, el trato se abre para los dos a la vez.
   */
  private manejarComercioSolicitar(client: Client) {
    const sessionId = client.sessionId;
    if (this.comerciosPorSesion.has(sessionId)) return; // ya está comerciando
    const objetivoId = this.jugadorMasCercanoPara(sessionId);
    if (!objetivoId) return client.send("comercio:error", { motivo: "no hay nadie cerca" });
    if (this.comerciosPorSesion.has(objetivoId)) return client.send("comercio:error", { motivo: "ese jugador ya está comerciando" });

    const ahora = Date.now();
    const solicitudDelObjetivo = this.solicitudesComercio.get(objetivoId);
    if (solicitudDelObjetivo && solicitudDelObjetivo.objetivo === sessionId && solicitudDelObjetivo.expira > ahora) {
      this.solicitudesComercio.delete(sessionId);
      this.solicitudesComercio.delete(objetivoId);
      this.abrirComercio(sessionId, objetivoId);
      return;
    }
    this.solicitudesComercio.set(sessionId, { objetivo: objetivoId, expira: ahora + RoomExteriorBase.VENTANA_SOLICITUD_COMERCIO_MS });
    this.clients.find((c) => c.sessionId === objetivoId)?.send("comercio:propuesta", { deNombre: this.nombreDe(client) ?? "" });
  }

  private abrirComercio(sessionIdA: string, sessionIdB: string) {
    const comercioId = `com_${this.siguienteComercioId++}`;
    const comercio = new ComercioSchema();
    comercio.jugadorA = sessionIdA;
    comercio.jugadorB = sessionIdB;
    this.state.comercios.set(comercioId, comercio);
    this.comerciosPorSesion.set(sessionIdA, comercioId);
    this.comerciosPorSesion.set(sessionIdB, comercioId);
  }

  private cerrarComercio(comercioId: string, motivo: "cancelado" | "completado") {
    const comercio = this.state.comercios.get(comercioId);
    if (!comercio) return;
    this.comerciosPorSesion.delete(comercio.jugadorA);
    this.comerciosPorSesion.delete(comercio.jugadorB);
    this.state.comercios.delete(comercioId);
    for (const sid of [comercio.jugadorA, comercio.jugadorB]) {
      this.clients.find((c) => c.sessionId === sid)?.send("comercio:cerrado", { motivo });
    }
  }

  private manejarComercioOfrecer(client: Client, msg: { instanciaId?: number }) {
    const comercioId = this.comerciosPorSesion.get(client.sessionId);
    if (!comercioId || typeof msg?.instanciaId !== "number") return;
    const comercio = this.state.comercios.get(comercioId);
    if (!comercio || comercio.confirmadoA || comercio.confirmadoB) return; // nadie toca la oferta con el otro ya confirmado
    const soyA = comercio.jugadorA === client.sessionId;
    const contenedor = this.inventarios.get(client.sessionId);
    const item = contenedor?.items.find((i) => i.id === msg.instanciaId);
    if (!item) return;
    const oferta = soyA ? comercio.ofertaA : comercio.ofertaB;
    if (oferta.some((o) => o.instanciaId === item.id)) return; // ya está ofrecido

    const entrada = new OfertaComercioSchema();
    entrada.instanciaId = item.id;
    entrada.itemId = item.itemId;
    entrada.cantidad = item.cantidad; // instancia COMPLETA siempre, sin pilas parciales (pedido explícito)
    oferta.push(entrada);
  }

  private manejarComercioQuitarOferta(client: Client, msg: { instanciaId?: number }) {
    const comercioId = this.comerciosPorSesion.get(client.sessionId);
    if (!comercioId || typeof msg?.instanciaId !== "number") return;
    const comercio = this.state.comercios.get(comercioId);
    if (!comercio) return;
    const soyA = comercio.jugadorA === client.sessionId;
    const oferta = soyA ? comercio.ofertaA : comercio.ofertaB;
    const idx = oferta.findIndex((o) => o.instanciaId === msg.instanciaId);
    if (idx === -1) return;
    oferta.splice(idx, 1);
    comercio.confirmadoA = false;
    comercio.confirmadoB = false; // cualquier cambio de oferta reabre la confirmación de AMBOS
  }

  private manejarComercioCancelar(client: Client) {
    const comercioId = this.comerciosPorSesion.get(client.sessionId);
    if (comercioId) this.cerrarComercio(comercioId, "cancelado");
  }

  /** Ofrecer un animal de granja propio (docs/GDD_Ganaderia.md) — mismo criterio que ofrecer un ítem: instancia entera, nadie toca la oferta con el otro ya confirmado. */
  private manejarComercioOfrecerAnimal(client: Client, msg: { animalId?: string }) {
    const comercioId = this.comerciosPorSesion.get(client.sessionId);
    if (!comercioId || !msg?.animalId) return;
    const comercio = this.state.comercios.get(comercioId);
    if (!comercio || comercio.confirmadoA || comercio.confirmadoB) return;
    const ctx = this.ctxConstruccion;
    const nombre = this.state.players.get(client.sessionId)?.name;
    if (!ctx || !nombre) return;
    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila) return;
    const dueno = ctx.propiedades.get(fila.propiedadId)?.dueno;
    if (dueno?.toLowerCase() !== nombre.toLowerCase()) return; // solo puedes ofrecer TU propio animal
    const soyA = comercio.jugadorA === client.sessionId;
    const oferta = soyA ? comercio.ofertaAnimalesA : comercio.ofertaAnimalesB;
    if (oferta.includes(msg.animalId)) return;
    oferta.push(msg.animalId);
  }

  private manejarComercioQuitarOfertaAnimal(client: Client, msg: { animalId?: string }) {
    const comercioId = this.comerciosPorSesion.get(client.sessionId);
    if (!comercioId || !msg?.animalId) return;
    const comercio = this.state.comercios.get(comercioId);
    if (!comercio) return;
    const soyA = comercio.jugadorA === client.sessionId;
    const oferta = soyA ? comercio.ofertaAnimalesA : comercio.ofertaAnimalesB;
    const idx = oferta.indexOf(msg.animalId);
    if (idx === -1) return;
    oferta.splice(idx, 1);
    comercio.confirmadoA = false;
    comercio.confirmadoB = false;
  }

  /** Mueve cada instancia listada de `origen` a `destino` buscando hueco libre — false en cuanto una no cabe (o ya no existe), sin abortar a medias porque siempre se llama primero sobre COPIAS (ver manejarComercioConfirmar). */
  private simularIntercambio(origen: Contenedor, destino: Contenedor, instanciaIds: number[]): boolean {
    for (const id of instanciaIds) {
      const item = origen.items.find((i) => i.id === id);
      if (!item) return false;
      const hueco = buscarHueco(destino, this.catalogoItems, item.itemId, 0);
      if (!hueco) return false;
      if (!moverItem(origen, destino, this.catalogoItems, id, hueco.x, hueco.y, 0).ok) return false;
    }
    return true;
  }

  /** Primera propiedad de `nombre` (en ESTA room) con refugio para `categoriaVida` — `null` si no tiene ninguna así (aborta el traspaso del animal). */
  private primeraPropiedadConRefugio(nombre: string, categoriaVida: CategoriaVidaAnimal): string | null {
    const ctx = this.ctxConstruccion;
    if (!ctx) return null;
    for (const [propiedadId, info] of ctx.propiedades.entries()) {
      if (info.dueno?.toLowerCase() !== nombre.toLowerCase()) continue;
      if (this.tieneRefugioParaCategoria(propiedadId, categoriaVida)) return propiedadId;
    }
    return null;
  }

  /** Valida que cada animal SIGA siendo de `nombreDueno` y que `nombreReceptor` tenga refugio para recibirlo — `null` si cualquiera falla (todo o nada, mismo criterio que simularIntercambio con ítems). */
  private prepararTraspasoAnimales(animalIds: string[], nombreDueno: string, nombreReceptor: string): Map<string, string> | null {
    const ctx = this.ctxConstruccion;
    if (!ctx) return animalIds.length === 0 ? new Map() : null;
    const destinos = new Map<string, string>();
    for (const animalId of animalIds) {
      const fila = this.animalesGranjaPuros.get(animalId);
      const duenoActual = fila ? ctx.propiedades.get(fila.propiedadId)?.dueno : undefined;
      if (!fila || duenoActual?.toLowerCase() !== nombreDueno.toLowerCase()) return null;
      const stats = this.estadisticasFaunaDe(fila.especieId);
      const destino = stats ? this.primeraPropiedadConRefugio(nombreReceptor, stats.categoriaVida) : null;
      if (!destino) return null;
      destinos.set(animalId, destino);
    }
    return destinos;
  }

  /**
   * Cuando AMBOS confirman: todo o nada (docs/GDD_Comercio.md), AMPLIADO a
   * animales de granja (docs/GDD_Ganaderia.md) — se simula el intercambio
   * de ítems Y se valida el traspaso de animales (cada uno sigue siendo
   * del ofertante Y el receptor tiene refugio) sobre copias/consultas
   * primero; si CUALQUIERA de las dos partes no cuadra, nadie pierde ni
   * gana nada. Solo si TODO cuadra se aplica de verdad.
   */
  private async manejarComercioConfirmar(client: Client) {
    const comercioId = this.comerciosPorSesion.get(client.sessionId);
    if (!comercioId) return;
    const comercio = this.state.comercios.get(comercioId);
    if (!comercio) return;
    const soyA = comercio.jugadorA === client.sessionId;
    if (soyA) comercio.confirmadoA = true;
    else comercio.confirmadoB = true;
    if (!comercio.confirmadoA || !comercio.confirmadoB) return;

    const contA = this.inventarios.get(comercio.jugadorA);
    const contB = this.inventarios.get(comercio.jugadorB);
    if (!contA || !contB) return this.cerrarComercio(comercioId, "cancelado");

    const pasoAaB = comercio.ofertaA.map((o) => o.instanciaId);
    const pasoBaA = comercio.ofertaB.map((o) => o.instanciaId);
    const simA: Contenedor = structuredClone(contA);
    const simB: Contenedor = structuredClone(contB);
    const cuadraItems = this.simularIntercambio(simA, simB, pasoAaB) && this.simularIntercambio(simB, simA, pasoBaA);

    const nombreA = this.state.players.get(comercio.jugadorA)?.name;
    const nombreB = this.state.players.get(comercio.jugadorB)?.name;
    const animalesAaB = nombreA && nombreB ? this.prepararTraspasoAnimales([...comercio.ofertaAnimalesA], nombreA, nombreB) : null;
    const animalesBaA = nombreA && nombreB ? this.prepararTraspasoAnimales([...comercio.ofertaAnimalesB], nombreB, nombreA) : null;

    if (!cuadraItems || !animalesAaB || !animalesBaA) {
      comercio.confirmadoA = false;
      comercio.confirmadoB = false;
      const motivo = !cuadraItems ? "no hay hueco para completar el intercambio" : "un animal ofrecido ya no es válido (se movió, o el receptor no tiene refugio para él)";
      for (const sid of [comercio.jugadorA, comercio.jugadorB]) {
        this.clients.find((c) => c.sessionId === sid)?.send("comercio:error", { motivo });
      }
      return;
    }

    this.simularIntercambio(contA, contB, pasoAaB);
    this.simularIntercambio(contB, contA, pasoBaA);
    const playerA = this.state.players.get(comercio.jugadorA);
    const playerB = this.state.players.get(comercio.jugadorB);
    if (playerA) sincronizarContenedor(playerA.inventario.cuerpo, contA);
    if (playerB) sincronizarContenedor(playerB.inventario.cuerpo, contB);

    const bd = await obtenerBdCompartida();
    for (const [destinos, receptorPlayer] of [[animalesAaB, playerB] as const, [animalesBaA, playerA] as const]) {
      for (const [animalId, destino] of destinos) {
        const fila = this.animalesGranjaPuros.get(animalId);
        if (!fila) continue;
        const punto = this.puntoDePropiedad(destino) ?? (receptorPlayer ? { x: receptorPlayer.x, y: receptorPlayer.y } : { x: fila.x, y: fila.y });
        const ok = await bd.transferirAnimalGranja(animalId, fila.propiedadId, destino, this.asentamientoConstruccion ?? fila.mapaId, punto.x, punto.y);
        if (!ok) continue; // se movió/vendió justo entre la validación y aquí — se pierde ESE traspaso, no todo el trato (ya se aplicaron los ítems)
        this.animalesGranjaPuros.delete(animalId);
        this.state.animalesGranja.delete(animalId);
        this.publicarAnimalGranja({ ...fila, propiedadId: destino, mapaId: this.asentamientoConstruccion ?? fila.mapaId, x: punto.x, y: punto.y, enVentaTenderoteId: null, enVentaPrecio: null });
      }
    }

    this.cerrarComercio(comercioId, "completado");
  }

  /**
   * Pesca (docs/GDD_Pesca.md, pedido 2026-08-30): "necesitas caña con cebo
   * e irte a una superficie de agua en la orilla, con la caña en mano
   * usar". Requiere `cana_pesca` en buen estado + 1 `cebo_pesca` en el
   * inventario, estar en TIERRA con agua dentro de RADIO_INTERACCION — el
   * cebo se consume al lanzar, la caña se queda "anclada" (state en
   * `pescaPorSesion`) hasta capturar/escapar/cancelar/moverse.
   */
  private manejarPescaLanzar(client: Client) {
    const sessionId = client.sessionId;
    if (this.pescaPorSesion.has(sessionId)) return;
    const player = this.state.players.get(sessionId);
    const contenedor = this.inventarios.get(sessionId);
    if (!player || !contenedor) return;

    const cana = contenedor.items.find((it) => it.itemId === "cana_pesca");
    const entradaCana = cana && this.catalogoItems[cana.itemId];
    if (!cana || !entradaCana || estaRoto(cana, entradaCana)) {
      return client.send("pesca:error", { motivo: "necesitas una caña de pescar en buen estado" });
    }
    const cebo = contenedor.items.find((it) => it.itemId === "cebo_pesca");
    if (!cebo) return client.send("pesca:error", { motivo: "necesitas cebo" });

    if (medioEn(this.mundo, player.x, player.y) !== TIPO.TIERRA) {
      return client.send("pesca:error", { motivo: "tienes que estar en tierra, junto al agua" });
    }
    const boya = casillaAguaCercana(this.mundo, player.x, player.y, RADIO_INTERACCION);
    if (!boya) return client.send("pesca:error", { motivo: "no hay agua cerca" });

    quitarItem(contenedor, cebo.id, 1);
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    this.pescaPorSesion.set(sessionId, { x: boya.x, y: boya.y, fase: "esperando" });
    client.send("pesca:lanzada", { x: boya.x, y: boya.y });
    this.programarProximaPicada(sessionId);
  }

  private programarProximaPicada(sessionId: string) {
    const estado = this.pescaPorSesion.get(sessionId);
    if (!estado) return;
    estado.timer = this.clock.setTimeout(() => this.intentarPicada(sessionId), INTERVALO_PICADA_MS);
  }

  private intentarPicada(sessionId: string) {
    const estado = this.pescaPorSesion.get(sessionId);
    if (!estado || estado.fase !== "esperando") return;
    if (!tocaPicar()) return this.programarProximaPicada(sessionId);

    estado.fase = "picando";
    estado.itemId = elegirCaptura(); // se decide YA, no al reaccionar — reaccionar solo confirma que llega a tiempo
    this.clients.find((c) => c.sessionId === sessionId)?.send("pesca:pica", { movimientos: MOVIMIENTOS_BOYA, ventanaMs: VENTANA_REACCION_MS });
    estado.timer = this.clock.setTimeout(() => this.picadaEscapada(sessionId), VENTANA_REACCION_MS);
  }

  private picadaEscapada(sessionId: string) {
    const estado = this.pescaPorSesion.get(sessionId);
    if (!estado || estado.fase !== "picando") return;
    estado.fase = "esperando";
    estado.itemId = undefined;
    this.clients.find((c) => c.sessionId === sessionId)?.send("pesca:escapado", {});
    this.programarProximaPicada(sessionId);
  }

  /** El jugador reacciona a tiempo mientras la boya se agita — mismo criterio "sin UI de targeting" que el resto: un único mensaje sin payload. */
  private manejarPescaInteractuar(client: Client) {
    const sessionId = client.sessionId;
    const estado = this.pescaPorSesion.get(sessionId);
    if (!estado || estado.fase !== "picando" || !estado.itemId) return;
    estado.timer?.clear();

    const player = this.state.players.get(sessionId);
    const contenedor = this.inventarios.get(sessionId);
    if (player && contenedor) {
      const resultado = agregarItem(contenedor, this.catalogoItems, estado.itemId, 1);
      if (resultado.ok) {
        const cana = contenedor.items.find((it) => it.itemId === "cana_pesca");
        const entradaCana = cana && this.catalogoItems[cana.itemId];
        if (cana && entradaCana) registrarUso(cana, entradaCana, Date.now());
        sincronizarContenedor(player.inventario.cuerpo, contenedor);
        client.send("pesca:capturado", { itemId: estado.itemId });
      } else {
        client.send("pesca:error", { motivo: "no te cabe en el inventario" });
      }
    }
    estado.fase = "esperando";
    estado.itemId = undefined;
    this.programarProximaPicada(sessionId);
  }

  /** Corta la pesca activa de esta sesión, si la hay — cancelar, moverse, desconectar. */
  private detenerPesca(sessionId: string) {
    const estado = this.pescaPorSesion.get(sessionId);
    if (!estado) return;
    estado.timer?.clear();
    this.pescaPorSesion.delete(sessionId);
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
    const animales = await bd.listarAnimalesEnVentaTenderete(msg.tenderoteId);
    client.send("tenderete:escaparate", {
      tenderoteId: msg.tenderoteId,
      items: stock.map((s) => ({ itemId: s.itemId, precioFarycoins: s.precioFarycoins, disponible: s.cantidad > 0 })),
      animales: animales.map((a) => ({ animalId: a.id, especieId: a.especieId, precioFarycoins: a.enVentaPrecio ?? 0 })),
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
    client.send("tenderete:gestion", {
      tenderoteId: msg.tenderoteId,
      items: await bd.listarStockTenderete(msg.tenderoteId),
      animales: await bd.listarAnimalesEnVentaTenderete(msg.tenderoteId),
    });
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

  /**
   * Lista un animal de granja propio a la venta en un tenderete propio
   * (docs/GDD_Ganaderia.md) — el animal sigue viviendo en SU propiedad
   * hasta que se venda, no se mueve al listarlo. Requiere que el animal
   * exista en ESTA room (mismo mapaId que el tenderete — comerciar un
   * animal exige estar en su misma región, límite deliberado v1).
   */
  private async manejarTenderoteListarAnimal(client: Client, msg: { tenderoteId?: string; animalId?: string; precioFarycoins?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || !msg?.tenderoteId || !msg.animalId) return;
    const precio = Math.floor(msg.precioFarycoins ?? 0);
    if (!(precio > 0)) return this.errorTenderete(client, "precio inválido");

    const duenoTenderete = await this.duenoDeTenderete(msg.tenderoteId);
    if (!duenoTenderete || duenoTenderete.toLowerCase() !== nombre.toLowerCase()) {
      return this.errorTenderete(client, "no eres el dueño de este tenderete");
    }
    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila) return this.errorTenderete(client, "ese animal no existe aquí");
    const duenoAnimal = ctx.propiedades.get(fila.propiedadId)?.dueno;
    if (duenoAnimal?.toLowerCase() !== nombre.toLowerCase()) return this.errorTenderete(client, "ese animal no es tuyo");

    const bd = await obtenerBdCompartida();
    const ok = await bd.fijarVentaAnimalGranja(msg.animalId, fila.propiedadId, msg.tenderoteId, precio);
    if (!ok) return this.errorTenderete(client, "no se pudo listar ese animal");
    fila.enVentaTenderoteId = msg.tenderoteId;
    fila.enVentaPrecio = precio;
    client.send("tenderete:animalListado", { tenderoteId: msg.tenderoteId, animalId: msg.animalId, precioFarycoins: precio });
  }

  /** Quita un animal de la venta — solo el dueño (no hace falta ser dueño del tenderete: es SU animal). */
  private async manejarTenderoteQuitarAnimalListado(client: Client, msg: { animalId?: string }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || !msg?.animalId) return;
    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila) return this.errorTenderete(client, "ese animal no existe aquí");
    const duenoAnimal = ctx.propiedades.get(fila.propiedadId)?.dueno;
    if (duenoAnimal?.toLowerCase() !== nombre.toLowerCase()) return this.errorTenderete(client, "ese animal no es tuyo");

    const bd = await obtenerBdCompartida();
    await bd.fijarVentaAnimalGranja(msg.animalId, fila.propiedadId, null, null);
    fila.enVentaTenderoteId = null;
    fila.enVentaPrecio = null;
    client.send("tenderete:animalQuitado", { animalId: msg.animalId });
  }

  /**
   * Compra un animal listado — cualquiera salvo el propio dueño, con
   * `propiedadDestino` (tuya, EN ESTA MISMA región) que ya debe tener el
   * refugio adecuado para esa especie — mismo requisito que domesticar.
   * Compare-and-swap atómico en BD (cobro + abono + reubicación); si algo
   * falla, no se cobra ni se mueve nada.
   */
  private async manejarTenderoteComprarAnimal(client: Client, msg: { tenderoteId?: string; animalId?: string; propiedadDestino?: string }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || !msg?.tenderoteId || !msg.animalId || !msg.propiedadDestino) return;

    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila || fila.enVentaTenderoteId !== msg.tenderoteId) return this.errorTenderete(client, "ese animal ya no está en venta aquí");
    const duenoActual = ctx.propiedades.get(fila.propiedadId)?.dueno;
    if (duenoActual?.toLowerCase() === nombre.toLowerCase()) return this.errorTenderete(client, "no puedes comprarte tu propio animal");

    const duenoDestino = ctx.propiedades.get(msg.propiedadDestino)?.dueno;
    if (!duenoDestino || duenoDestino.toLowerCase() !== nombre.toLowerCase()) {
      return this.errorTenderete(client, "esa propiedad de destino no es tuya");
    }
    const stats = this.estadisticasFaunaDe(fila.especieId);
    if (stats && !this.tieneRefugioParaCategoria(msg.propiedadDestino, stats.categoriaVida)) {
      return this.errorTenderete(client, "necesitas un refugio en la propiedad de destino para esta especie");
    }

    const punto = this.puntoDePropiedad(msg.propiedadDestino) ?? { x: fila.x, y: fila.y };
    const bd = await obtenerBdCompartida();
    const resultado = await bd.comprarAnimalGranja({
      id: msg.animalId, tenderoteId: msg.tenderoteId, propiedadDestino: msg.propiedadDestino,
      mapaIdDestino: this.asentamientoConstruccion ?? fila.mapaId, x: punto.x, y: punto.y,
      compradorNombre: nombre, duenoNombre: duenoActual ?? nombre,
    });
    if (!resultado.ok) return this.errorTenderete(client, resultado.motivo);

    this.animalesGranjaPuros.delete(msg.animalId);
    this.state.animalesGranja.delete(msg.animalId);
    this.publicarAnimalGranja({
      ...fila, propiedadId: msg.propiedadDestino, mapaId: this.asentamientoConstruccion ?? fila.mapaId,
      x: punto.x, y: punto.y, enVentaTenderoteId: null, enVentaPrecio: null,
    });
    client.send("tenderete:animalComprado", { tenderoteId: msg.tenderoteId, animalId: msg.animalId, especieId: resultado.especieId, precioTotal: resultado.precioTotal });
  }

  // ---- Comercio con NPC tendero (docs/GDD_Economia.md, pedido 2026-08-30) ----
  // Cada NPC "tendero" es su propio comerciante: saldo real (jugadores.nombre
  // = "npc:<slotId>", SALDO_INICIAL_NPC_COMERCIANTE) y catálogo fijo de
  // compra/venta (catalogoNpcComercio.ts). Reusa `tenderete_items` como
  // almacén de stock (misma tabla que el Mercado de jugadores) pero NUNCA
  // pasa por `duenoDeTenderete` — no hay propiedad detrás, solo el NPC.

  private errorNpc(client: Client, motivo: string) {
    client.send("npc:error", { motivo });
  }

  /** NPC "tendero" más cercano dentro de RADIO_INTERACCION — mismo criterio de auto-apuntado que mascota/cadáver/fauna. */
  private npcTenderoMasCercano(x: number, y: number): { id: string; npc: Npc } | null {
    let mejorId: string | null = null;
    let mejorNpc: Npc | null = null;
    let mejorDist = RADIO_INTERACCION;
    for (const [id, npc] of this.state.npcs.entries()) {
      if (this.oficiosNpc.get(id) !== "tendero") continue;
      const d = Math.hypot(npc.x - x, npc.y - y);
      if (d < mejorDist) { mejorDist = d; mejorId = id; mejorNpc = npc; }
    }
    return mejorId && mejorNpc ? { id: mejorId, npc: mejorNpc } : null;
  }

  private tenderoteIdDeNpc(npcId: string): string {
    return `${PREFIJO_NPC_COMERCIANTE}${npcId}`;
  }

  /**
   * Ingreso diario del NPC (docs/GDD_Economia.md, pedido 2026-08-30: "los
   * npc cada día reciben 20 Farycoins también, así aumentan su dinero,
   * solo si están cargados o se acerca alguien") — cálculo perezoso, se
   * llama SIEMPRE que un jugador se acerca a este NPC de verdad (escaparate/
   * comprar/vender), nunca con un tick de fondo: si nadie lo visita en
   * días, se pone al día de golpe la próxima vez que alguien llegue.
   */
  private async resolverIngresoDiarioNpc(npcId: string): Promise<void> {
    const bd = await obtenerBdCompartida();
    await bd.resolverIngresoDiarioNpc(this.tenderoteIdDeNpc(npcId), tiempoMundo().dia);
  }

  /** Público: catálogo de venta/compra del NPC más cercano — sin gating de dueño (no hay dueño, es un comerciante del mundo). */
  private async manejarNpcComercioEscaparate(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const cercano = this.npcTenderoMasCercano(player.x, player.y);
    if (!cercano) return this.errorNpc(client, "no hay ningún comerciante cerca");
    await this.resolverIngresoDiarioNpc(cercano.id);
    client.send("npc:comercioEscaparate", {
      npcId: cercano.id,
      nombre: cercano.npc.nombre,
      venta: Object.entries(NPC_TENDERO_VENTA).map(([itemId, precioFarycoins]) => ({ itemId, precioFarycoins })),
      compra: Object.entries(NPC_TENDERO_COMPRA).map(([itemId, precioFarycoins]) => ({ itemId, precioFarycoins })),
    });
  }

  /** Comprar: el jugador paga, el NPC entrega — reusa `bd.comprarDeTenderete` tal cual, con tenderoteId/duenoNombre sintéticos del NPC. Repone stock perezosamente si se agotó (nunca un tick de fondo: solo al intentar comprar). */
  private async manejarNpcComprar(client: Client, msg: { npcId?: string; itemId?: string; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const player = this.state.players.get(client.sessionId);
    if (!nombre || !player || !msg?.npcId || !msg.itemId) return;
    const npc = this.state.npcs.get(msg.npcId);
    if (!npc || this.oficiosNpc.get(msg.npcId) !== "tendero") return this.errorNpc(client, "ese comerciante no existe");
    if (Math.hypot(npc.x - player.x, npc.y - player.y) > RADIO_INTERACCION) return this.errorNpc(client, "demasiado lejos");
    const precioUnitario = NPC_TENDERO_VENTA[msg.itemId];
    if (!precioUnitario) return this.errorNpc(client, "este comerciante no vende eso");
    const cantidad = Math.max(1, Math.floor(msg.cantidad ?? 1));
    await this.resolverIngresoDiarioNpc(msg.npcId);

    const tenderoteId = this.tenderoteIdDeNpc(msg.npcId);
    const npcNombre = tenderoteId;
    const bd = await obtenerBdCompartida();
    const stockActual = await bd.listarStockTenderete(tenderoteId);
    const enStock = stockActual.find((s) => s.itemId === msg.itemId)?.cantidad ?? 0;
    if (enStock < cantidad) await bd.reponerStockTenderete(tenderoteId, msg.itemId, REPOSICION_STOCK_NPC, precioUnitario);

    const r = await bd.comprarDeTenderete({ tenderoteId, itemId: msg.itemId, cantidad, compradorNombre: nombre, duenoNombre: npcNombre });
    if (!r.ok) return this.errorNpc(client, r.motivo);

    const contenedor = this.inventarios.get(client.sessionId);
    const resultado = contenedor ? intentarCoger(contenedor, this.catalogoItems, { itemId: msg.itemId, cantidad }) : { ok: false as const };
    if (!resultado.ok) {
      await bd.ajustarFarycoins((await bd.obtenerOCrearJugador(nombre)).id, r.precioTotal);
      await bd.reponerStockTenderete(tenderoteId, msg.itemId, cantidad, precioUnitario);
      return this.errorNpc(client, "no tienes hueco en tu inventario");
    }
    sincronizarContenedor(player.inventario.cuerpo, contenedor!);
    void this.otorgarXpAtributoPorSesion(client, "carisma", XP_CARISMA_POR_COMPRAR);
    client.send("npc:compraResultado", { npcId: msg.npcId, itemId: msg.itemId, cantidad, precioTotal: r.precioTotal, saldoRestante: r.saldoRestante });
  }

  /**
   * Vender: el jugador entrega el ítem, el NPC paga con SU PROPIO saldo
   * (limitado — `venderANpc` falla "todo o nada" si no le llega) y el
   * ítem se CONSUME (v1 deliberadamente simple, sin revenderlo — evita un
   * bucle comprar-barato/vender-caro contra el mismo NPC).
   */
  private async manejarNpcVender(client: Client, msg: { npcId?: string; instanciaId?: number; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const player = this.state.players.get(client.sessionId);
    if (!nombre || !player || !msg?.npcId || typeof msg.instanciaId !== "number") return;
    const npc = this.state.npcs.get(msg.npcId);
    if (!npc || this.oficiosNpc.get(msg.npcId) !== "tendero") return this.errorNpc(client, "ese comerciante no existe");
    if (Math.hypot(npc.x - player.x, npc.y - player.y) > RADIO_INTERACCION) return this.errorNpc(client, "demasiado lejos");

    const contenedor = this.inventarios.get(client.sessionId);
    const it = contenedor?.items.find((i) => i.id === msg.instanciaId);
    if (!contenedor || !it) return this.errorNpc(client, "no tienes ese objeto");
    const precioUnitario = NPC_TENDERO_COMPRA[it.itemId];
    if (!precioUnitario) return this.errorNpc(client, "este comerciante no compra eso");
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));
    await this.resolverIngresoDiarioNpc(msg.npcId); // antes de cobrar: que el ingreso de hoy ya cuente para lo que puede pagar

    const bd = await obtenerBdCompartida();
    const r = await bd.venderANpc({ npcNombre: this.tenderoteIdDeNpc(msg.npcId), itemId: it.itemId, cantidad, precioUnitario, vendedorNombre: nombre });
    if (!r.ok) return this.errorNpc(client, r.motivo);

    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) {
      // no debería pasar (ya comprobamos cantidad arriba), pero si pasa, deshace el cobro al NPC y el abono al jugador.
      await bd.ajustarFarycoins((await bd.obtenerOCrearJugador(this.tenderoteIdDeNpc(msg.npcId))).id, r.precioTotal);
      await bd.ajustarFarycoins((await bd.obtenerOCrearJugador(nombre)).id, -r.precioTotal);
      return this.errorNpc(client, resultado.motivo ?? "no se pudo vender");
    }
    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    void this.otorgarXpAtributoPorSesion(client, "carisma", XP_CARISMA_POR_REPONER);
    client.send("npc:ventaResultado", { npcId: msg.npcId, itemId: it.itemId, cantidad, precioTotal: r.precioTotal, saldoRestante: r.saldoRestante });
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

  private errorCultivo(client: Client, motivo: string) {
    client.send("cultivo:error", { motivo });
  }

  /** Dueño de la construcción o jarl — mismo criterio que produccion:recolectar, sin el fallback de tenderete (un bancal/maceta nunca es un tenderete). */
  private async duenoOJarlDe(viva: { propiedad: string }, nombre: string): Promise<boolean> {
    const ctx = this.ctxConstruccion!;
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? null;
    return dueno === nombre || esJarl(ctx, nombre);
  }

  private extraCultivoDe(viva: { extra?: Record<string, unknown> | null }): EstadoCultivo {
    return ((viva.extra as { cultivo?: EstadoCultivo } | null)?.cultivo ?? {}) as EstadoCultivo;
  }

  /**
   * Agricultura (docs/GDD_Agricultura.md, pedido 2026-08-30): sembrar una
   * semilla de la mochila en un bancal/maceta vacío. El mes de mundo actual
   * debe estar entre los `mesesSiembra` de la semilla — fuera de temporada
   * se rechaza, como en la vida real.
   */
  private async manejarCultivoPlantar(client: Client, msg: { construccionId?: number; instanciaId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number" || typeof msg?.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCultivo(client, "construcción inexistente");
    if (!(await this.duenoOJarlDe(viva, nombre))) return this.errorCultivo(client, "no eres el dueño de esta construcción");

    const entrada = this.entradaDe(viva.objeto);
    if (!entrada?.plantable) return this.errorCultivo(client, "aquí no se puede plantar");
    const estado = this.extraCultivoDe(viva);
    if (estado.semillaId) return this.errorCultivo(client, "ya hay algo plantado — cosecha primero");

    const bd = await obtenerBdCompartida();
    await this.asegurarHibridosCargados(bd); // una semilla híbrida creada en OTRA room debe reconocerse aquí también

    const contenedor = this.inventarios.get(client.sessionId);
    const semilla = contenedor?.items.find((it) => it.id === msg.instanciaId);
    if (!contenedor || !semilla) return this.errorCultivo(client, "esa semilla ya no está en tu inventario");
    const entradaSemilla = this.catalogoItems[semilla.itemId];
    if (!entradaSemilla?.cultivo) return this.errorCultivo(client, "eso no es una semilla");

    const { mes, dia } = tiempoMundo();
    if (!puedeSembrarEnMes(entradaSemilla.cultivo.mesesSiembra, mes)) {
      return this.errorCultivo(client, "esta semilla no se siembra en este mes");
    }

    quitarItem(contenedor, semilla.id, 1);
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    // Sembrar riega de golpe (la tierra recién trabajada queda húmeda) pero
    // NO abona — el fertilizante es opcional/bonus, requiere el ítem aparte
    // (docs/GDD_Agricultura.md §3).
    const nuevoEstado: EstadoCultivo = { semillaId: semilla.itemId, diaPlantado: dia, diaUltimoRiego: dia };
    viva.extra = { ...(viva.extra ?? {}), cultivo: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoCultivo(client, viva.id, nuevoEstado);
  }

  /** Riega el bancal/maceta — refresca el agua a 100 ahora mismo (decae sola con los días, ver cultivo.ts). */
  private async manejarCultivoRegar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCultivo(client, "construcción inexistente");
    if (!(await this.duenoOJarlDe(viva, nombre))) return this.errorCultivo(client, "no eres el dueño de esta construcción");
    const estado = this.extraCultivoDe(viva);
    if (!estado.semillaId) return this.errorCultivo(client, "no hay nada plantado aquí");

    const dia = tiempoMundo().dia;
    const nuevoEstado: EstadoCultivo = { ...estado, diaUltimoRiego: dia };
    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), cultivo: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoCultivo(client, viva.id, nuevoEstado);
  }

  /** Abona el bancal/maceta — consume 1 `fertilizante` del inventario, auto-apuntado (sin instanciaId, mismo criterio que "coger"). */
  private async manejarCultivoAbonar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCultivo(client, "construcción inexistente");
    if (!(await this.duenoOJarlDe(viva, nombre))) return this.errorCultivo(client, "no eres el dueño de esta construcción");
    const estado = this.extraCultivoDe(viva);
    if (!estado.semillaId) return this.errorCultivo(client, "no hay nada plantado aquí");

    const contenedor = this.inventarios.get(client.sessionId);
    const fertilizante = contenedor?.items.find((it) => it.itemId === "fertilizante");
    if (!contenedor || !fertilizante) return this.errorCultivo(client, "necesitas fertilizante");
    quitarItem(contenedor, fertilizante.id, 1);
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const dia = tiempoMundo().dia;
    const nuevoEstado: EstadoCultivo = { ...estado, diaUltimoAbono: dia };
    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), cultivo: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoCultivo(client, viva.id, nuevoEstado);
  }

  /**
   * Cosecha lo plantado — solo si ya cumplió `diasCrecimiento` Y hay algo
   * de agua ahora mismo (`listaParaCosechar`, cultivo.ts). Especies con
   * `cosechaRecurrente` siguen plantadas (reinician el contador de días);
   * el resto deja la parcela vacía, lista para volver a sembrar.
   */
  private async manejarCultivoCosechar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCultivo(client, "construcción inexistente");
    if (!(await this.duenoOJarlDe(viva, nombre))) return this.errorCultivo(client, "no eres el dueño de esta construcción");

    const entrada = this.entradaDe(viva.objeto);
    const estado = this.extraCultivoDe(viva);
    if (!entrada?.plantable || !estado.semillaId) return this.errorCultivo(client, "no hay nada plantado aquí");

    const bd = await obtenerBdCompartida();
    await this.asegurarHibridosCargados(bd);
    const datosCultivo = this.catalogoItems[estado.semillaId]?.cultivo;
    if (!datosCultivo) return this.errorCultivo(client, "semilla desconocida");

    const dia = tiempoMundo().dia;
    if (!listaParaCosechar(estado, datosCultivo.diasCrecimiento, dia)) {
      return this.errorCultivo(client, nivelAgua(estado, dia) <= 0 ? "le falta agua" : "todavía no está lista para cosechar");
    }

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const resultado = resolverCosecha(estado, datosCultivo.cantidadPorCosecha, datosCultivo.cosechaRecurrente, entrada.plantable.multiplicadorCosecha, dia);
    const cogido = agregarItem(contenedor, this.catalogoItems, datosCultivo.itemIdCosecha, resultado.cantidad);
    if (!cogido.ok) return this.errorCultivo(client, "no tienes hueco en tu inventario");

    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const nuevoEstado: EstadoCultivo = resultado.siguePlantada ? { ...estado, diaPlantado: dia } : {};
    viva.extra = { ...(viva.extra ?? {}), cultivo: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);

    client.send("cultivo:cosechado", { construccionId: viva.id, itemId: datosCultivo.itemIdCosecha, cantidad: resultado.cantidad });
    this.enviarEstadoCultivo(client, viva.id, nuevoEstado);
  }

  /** Estado resuelto AHORA MISMO (agua/fertilizante/días restantes) — sin mutar nada, solo consulta (mismo criterio que motriz:consultar). */
  private async manejarCultivoConsultar(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return;
    const estado = this.extraCultivoDe(viva);
    if (estado.semillaId && !this.catalogoItems[estado.semillaId]) {
      await this.asegurarHibridosCargados(await obtenerBdCompartida()); // puede ser un híbrido creado en otra room
    }
    this.enviarEstadoCultivo(client, viva.id, estado);
  }

  /**
   * Funde en `this.catalogoItems` (memoria de ESTA room) toda especie
   * híbrida creada por injerto que viva en BD — UNA vez por vida de la
   * room (flag `hibridosCargados`); barato en llamadas siguientes. Cada
   * fila genera DOS entradas sintéticas: la semilla híbrida (tipo
   * "semilla", con su `cultivo`) y el fruto que da (tipo "recurso") —
   * ninguna existe en items.json en disco, nacen aquí en memoria.
   */
  private async asegurarHibridosCargados(bd: IAlmacenDatos): Promise<void> {
    if (this.hibridosCargados) return;
    this.hibridosCargados = true;
    const hibridos = await bd.listarCultivosHibridos();
    for (const h of hibridos) this.registrarHibridoEnCatalogo(h);
  }

  private registrarHibridoEnCatalogo(h: CultivoHibrido): void {
    this.catalogoItems[h.semillaId] = {
      tipo: "semilla",
      categoriaRecurso: "semilla",
      huella: [1, 1],
      peso: 0.02,
      apilable: true,
      stackMax: 30,
      variantes: 1,
      colorDebug: h.colorDebug,
      cultivo: {
        itemIdCosecha: h.cosechaId,
        diasCrecimiento: h.diasCrecimiento,
        mesesSiembra: h.mesesSiembra,
        cosechaRecurrente: h.cosechaRecurrente,
        cantidadPorCosecha: h.cantidadPorCosecha,
        rasgos: h.rasgos,
      },
    };
    this.catalogoItems[h.cosechaId] = {
      tipo: "recurso",
      categoriaRecurso: "fruta_cultivada",
      huella: [1, 1],
      peso: 0.2,
      apilable: true,
      stackMax: 15,
      variantes: 1,
      colorDebug: h.colorDebug,
    };
  }

  private enviarEstadoCultivo(client: Client, construccionId: number, estado: EstadoCultivo) {
    const dia = tiempoMundo().dia;
    const datosCultivo = estado.semillaId ? this.catalogoItems[estado.semillaId]?.cultivo : undefined;
    client.send("cultivo:estado", {
      construccionId,
      semillaId: estado.semillaId ?? null,
      itemIdCosecha: datosCultivo?.itemIdCosecha ?? null,
      agua: nivelAgua(estado, dia),
      fertilizante: nivelFertilizante(estado, dia),
      diasParaCosecha: datosCultivo && estado.diaPlantado != null ? Math.max(0, datosCultivo.diasCrecimiento - (dia - estado.diaPlantado)) : null,
      listo: datosCultivo ? listaParaCosechar(estado, datosCultivo.diasCrecimiento, dia) : false,
    });
  }

  private static readonly NIVEL_MINIMO_INJERTO = 1;

  /**
   * Injerto (docs/GDD_Agricultura.md §4, diseño ya cerrado en el backlog):
   * combina dos semillas CUALESQUIERA en `mesa_injertos` — combinación
   * abierta, sin receta fija. Rasgos del resultado = media de los dos
   * padres + variación aleatoria; la especie nace PERMANENTE (BD) y se
   * funde de inmediato en `catalogoItems` de esta room. Mismo criterio de
   * permiso que crafteo: cualquiera con nivel de oficio suficiente, sin
   * comprobar dueño de la mesa (es un taller compartido).
   */
  private async manejarInjertoCrear(client: Client, msg: { construccionId?: number; instanciaIdA?: number; instanciaIdB?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number" || typeof msg?.instanciaIdA !== "number" || typeof msg?.instanciaIdB !== "number") return;
    if (msg.instanciaIdA === msg.instanciaIdB) return this.errorCultivo(client, "elige dos semillas distintas");
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva || viva.objeto !== "mesa_injertos") return this.errorCultivo(client, "necesitas estar en una mesa de injertos");

    const bd = await obtenerBdCompartida();
    await this.asegurarHibridosCargados(bd);
    const jugador = await bd.obtenerOCrearJugador(nombre);
    const xp = await bd.obtenerXpOficio(jugador.id, "botanica");
    if (nivelDeXp(xp) < RoomExteriorBase.NIVEL_MINIMO_INJERTO) return this.errorCultivo(client, "nivel de botánica insuficiente");

    const contenedor = this.inventarios.get(client.sessionId);
    const semillaA = contenedor?.items.find((it) => it.id === msg.instanciaIdA);
    const semillaB = contenedor?.items.find((it) => it.id === msg.instanciaIdB);
    if (!contenedor || !semillaA || !semillaB) return this.errorCultivo(client, "esas semillas ya no están en tu inventario");
    const entradaA = this.catalogoItems[semillaA.itemId];
    const entradaB = this.catalogoItems[semillaB.itemId];
    if (!entradaA?.cultivo || !entradaB?.cultivo) return this.errorCultivo(client, "ambas deben ser semillas");

    quitarItem(contenedor, semillaA.id, 1);
    quitarItem(contenedor, semillaB.id, 1);

    const rasgos = mezclarRasgos(entradaA.cultivo.rasgos, entradaB.cultivo.rasgos);
    const crecimiento = derivarCrecimientoHibrido(entradaA.cultivo, entradaB.cultivo, rasgos);
    const sufijo = Math.random().toString(36).slice(2, 8);
    const hibrido: CultivoHibrido = {
      semillaId: `semilla_hibrida_${sufijo}`,
      cosechaId: `fruto_hibrido_${sufijo}`,
      nombre: nombreHibrido(nombreLegible(semillaA.itemId), nombreLegible(semillaB.itemId)),
      padreA: semillaA.itemId,
      padreB: semillaB.itemId,
      rasgos,
      ...crecimiento,
      colorDebug: mezclarColor(entradaA.colorDebug, entradaB.colorDebug),
      creadoEn: new Date().toISOString(),
    };
    await bd.crearCultivoHibrido(hibrido);
    this.registrarHibridoEnCatalogo(hibrido);

    // El jugador se lleva un par de semillas de su propia creación para plantarla.
    agregarItem(contenedor, this.catalogoItems, hibrido.semillaId, 2);
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const nuevaXp = await bd.sumarXpOficio(jugador.id, "botanica", XP_POR_CRAFTEO);
    client.send("injerto:creado", {
      semillaId: hibrido.semillaId, cosechaId: hibrido.cosechaId, nombre: hibrido.nombre,
      rasgos: hibrido.rasgos, xp: nuevaXp, nivel: nivelDeXp(nuevaXp),
    });
  }

  private errorCocina(client: Client, motivo: string) {
    client.send("cocina:error", { motivo });
  }

  private extraCocinaDe(viva: { extra?: Record<string, unknown> | null }): EstadoCocina {
    return ((viva.extra as { cocina?: EstadoCocina } | null)?.cocina ?? { ingredientes: [] }) as EstadoCocina;
  }

  /**
   * Funde en `this.catalogoItems` (memoria de ESTA room) todo plato ya
   * inventado que viva en BD — mismo patrón perezoso que
   * `asegurarHibridosCargados`, UNA vez por vida de la room.
   */
  private async asegurarPlatosCargados(bd: IAlmacenDatos): Promise<void> {
    if (this.platosCargados) return;
    this.platosCargados = true;
    const platos = await bd.listarPlatosCreados();
    for (const p of platos) this.registrarPlatoEnCatalogo(p);
  }

  private registrarPlatoEnCatalogo(p: PlatoCreado): void {
    this.catalogoItems[p.itemId] = {
      tipo: "consumible",
      huella: [1, 1],
      peso: 0.4,
      apilable: true,
      stackMax: 10,
      variantes: 1,
      colorDebug: p.colorDebug,
      restauraMultiple: {
        vida: p.vida || undefined,
        estamina: p.estamina || undefined,
        comida: p.comida,
        bebida: p.bebida || undefined,
      },
    };
  }

  /** "Cocinar tal cual" (docs/GDD_Cocina.md) — un ingrediente crudo, al fuego, sin vasija: boost modesto sobre su aporte crudo. */
  private manejarCocinaSimple(client: Client, msg: { construccionId?: number; instanciaId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number" || typeof msg?.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.cocina) return this.errorCocina(client, "necesitas estar junto a un fuego");

    const contenedor = this.inventarios.get(client.sessionId);
    const item = contenedor?.items.find((it) => it.id === msg.instanciaId);
    if (!contenedor || !item) return this.errorCocina(client, "eso ya no está en tu inventario");
    const entradaItem = this.catalogoItems[item.itemId];
    if (!entradaItem?.aportesCocina || entradaItem.tipo !== "recurso") return this.errorCocina(client, "eso no se puede cocinar así");

    // Cocina v2: carne/pescado/huevo directo al fuego pasan a "Asado"
    // (pedido explícito) en vez del genérico "_cocinado" que sigue usando
    // el resto (fruta, baya, trigo...).
    const cocinadoId = entradaItem.origenCocina === "animal" ? `asado_${item.itemId}` : `${item.itemId}_cocinado`;
    if (!this.catalogoItems[cocinadoId]) return this.errorCocina(client, "esto todavía no tiene versión cocinada");

    quitarItem(contenedor, item.id, 1);
    const resultado = agregarItem(contenedor, this.catalogoItems, cocinadoId, 1);
    if (!resultado.ok) {
      agregarItem(contenedor, this.catalogoItems, item.itemId, 1); // deshace: el ingrediente no debe perderse si no cabe el resultado
      return this.errorCocina(client, "no tienes hueco para el resultado");
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("cocina:cocinado", { itemId: cocinadoId });
  }

  /**
   * Llena la vasija de agua y la pone al fuego — pedido explícito
   * (2026-08-30): "para hacer guisos y sopas necesitas llenar la olla de
   * agua y ponerla al fuego hasta que se caliente, un tiempo determinado".
   * Agua "libre" (no consume ningún ítem, como en la pesca) — arranca el
   * cronómetro de hervor; `cocina:anadir` la exige ya hirviendo.
   */
  private async manejarCocinaLlenarAgua(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.cocina?.esVasija) return this.errorCocina(client, "necesitas estar junto a una vasija");
    if (entrada.cocina.hierveAgua === false) return this.errorCocina(client, "esta vasija no necesita agua ni fuego, se usa directamente");
    const estado = this.extraCocinaDe(viva);
    if (estado.conAgua) return this.errorCocina(client, "esta vasija ya tiene agua puesta");

    const nuevoEstado: EstadoCocina = { ...estado, conAgua: true, calentandoDesde: Date.now() };
    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), cocina: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoCocina(client, viva.id, nuevoEstado);
  }

  /** Añade un ingrediente a la vasija (cuenco/cazuela/olla) — exige agua ya hirviendo, capado por `cocina.capacidad` TIPOS distintos (la cantidad de cada uno no tiene tope propio). */
  private async manejarCocinaAnadir(client: Client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number" || typeof msg?.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.cocina?.esVasija) return this.errorCocina(client, "necesitas estar junto a una vasija");

    const estadoPrevio = this.extraCocinaDe(viva);
    if (entrada.cocina.hierveAgua !== false && !estaHirviendo(estadoPrevio, Date.now())) {
      return this.errorCocina(client, estadoPrevio.conAgua ? "el agua todavía no ha hervido" : "primero llena la vasija de agua y ponla al fuego");
    }

    const contenedor = this.inventarios.get(client.sessionId);
    const item = contenedor?.items.find((it) => it.id === msg.instanciaId);
    if (!contenedor || !item) return this.errorCocina(client, "eso ya no está en tu inventario");
    const entradaItem = this.catalogoItems[item.itemId];
    if (!entradaItem?.aportesCocina || entradaItem.tipo !== "recurso") return this.errorCocina(client, "eso no es un ingrediente");
    if (!aceptaEnVasija(entrada.cocina.vasija ?? "", item.itemId, entradaItem.categoriaRecurso)) {
      return this.errorCocina(client, "eso no sirve para un batido");
    }

    const estado = estadoPrevio;
    const yaDentro = estado.ingredientes.find((i) => i.itemId === item.itemId);
    if (!yaDentro && estado.ingredientes.length >= entrada.cocina.capacidad!) {
      return this.errorCocina(client, "la vasija ya tiene demasiados ingredientes distintos");
    }
    const cantidad = Math.max(1, Math.min(Math.floor(msg.cantidad ?? 1), item.cantidad));
    const resultadoQuitar = quitarItem(contenedor, item.id, cantidad);
    if (!resultadoQuitar.ok) return;
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const nuevos = yaDentro
      ? estado.ingredientes.map((i) => (i.itemId === item.itemId ? { ...i, cantidad: i.cantidad + cantidad } : i))
      : [...estado.ingredientes, { itemId: item.itemId, cantidad }];
    const nuevoEstado: EstadoCocina = { ...estado, ingredientes: nuevos };
    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), cocina: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoCocina(client, viva.id, nuevoEstado);
  }

  /**
   * Cocina lo que hay en la vasija — la identidad del plato (nombre,
   * itemId) se cachea por el CONJUNTO de tipos de ingrediente usados
   * (`clavePlato`, cocina.ts): misma receta siempre da el mismo plato,
   * permanente en BD; más cantidad solo da más raciones. Vacía la vasija
   * al terminar.
   */
  private async manejarCocinaPreparar(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.cocina?.esVasija) return this.errorCocina(client, "necesitas estar junto a una vasija");
    const estado = this.extraCocinaDe(viva);
    if (estado.ingredientes.length === 0) return this.errorCocina(client, "la vasija está vacía");

    const ingredientesCocina: IngredienteCocina[] = estado.ingredientes.map((i) => {
      const e = this.catalogoItems[i.itemId]!;
      return { itemId: i.itemId, cantidad: i.cantidad, aportes: e.aportesCocina!, origen: e.origenCocina! };
    });
    const resultado = cocinarPlato(ingredientesCocina, entrada.cocina.capacidad);

    const familia = familiaDePlato(entrada.cocina.vasija ?? "", ingredientesCocina);
    const bd = await obtenerBdCompartida();
    await this.asegurarPlatosCargados(bd);
    const clave = clavePlato(familia, estado.ingredientes.map((i) => i.itemId));
    let plato = await bd.buscarPlatoPorClave(clave);
    if (!plato) {
      const sufijo = Math.random().toString(36).slice(2, 8);
      plato = {
        clave,
        itemId: `plato_${sufijo}`,
        nombre: nombrePlato(prefijoDe(familia), estado.ingredientes.map((i) => i.itemId)),
        ingredientes: estado.ingredientes.map((i) => i.itemId),
        vida: resultado.vida ?? 0,
        estamina: resultado.estamina ?? 0,
        comida: resultado.comida,
        bebida: resultado.bebida ?? 0,
        colorDebug: "#c98a4a",
        creadoEn: new Date().toISOString(),
      };
      await bd.crearPlatoCreado(plato);
      this.registrarPlatoEnCatalogo(plato);
    }

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const cogido = agregarItem(contenedor, this.catalogoItems, plato.itemId, resultado.platos);
    if (!cogido.ok) return this.errorCocina(client, "no tienes hueco para los platos");

    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const nuevoEstado: EstadoCocina = { ingredientes: [] };
    viva.extra = { ...(viva.extra ?? {}), cocina: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    client.send("cocina:preparado", { itemId: plato.itemId, nombre: plato.nombre, cantidad: resultado.platos, mezclaBonus: resultado.mezclaBonus });
  }

  /** Contenido actual de la vasija — sin mutar nada, solo consulta (mismo criterio que motriz:consultar/cultivo:consultar). */
  private manejarCocinaConsultar(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return;
    this.enviarEstadoCocina(client, viva.id, this.extraCocinaDe(viva));
  }

  private enviarEstadoCocina(client: Client, construccionId: number, estado: EstadoCocina) {
    const ahora = Date.now();
    client.send("cocina:estado", {
      construccionId,
      ingredientes: estado.ingredientes,
      conAgua: !!estado.conAgua,
      hirviendo: estaHirviendo(estado, ahora),
      segundosParaHervir: segundosParaHervir(estado, ahora),
    });
  }

  /**
   * Registra el plato (o lo reusa si ya existe) y lo entrega al inventario
   * — misma lógica de identidad/caché de `manejarCocinaPreparar`, extraída
   * para que ensalada/bocadillo (combinaciones SIN vasija persistida) la
   * reusen tal cual en vez de duplicarla.
   */
  private async entregarPlatoDinamico(
    client: Client,
    familia: FamiliaPlato,
    itemIdsIngredientes: string[],
    resultado: ResultadoCoccion,
    cantidadEntregar: number,
    colorDebug: string,
  ): Promise<boolean> {
    const bd = await obtenerBdCompartida();
    await this.asegurarPlatosCargados(bd);
    const clave = clavePlato(familia, itemIdsIngredientes);
    let plato = await bd.buscarPlatoPorClave(clave);
    if (!plato) {
      const sufijo = Math.random().toString(36).slice(2, 8);
      plato = {
        clave,
        itemId: `plato_${sufijo}`,
        nombre: nombrePlato(prefijoDe(familia), itemIdsIngredientes),
        ingredientes: itemIdsIngredientes,
        vida: resultado.vida ?? 0,
        estamina: resultado.estamina ?? 0,
        comida: resultado.comida,
        bebida: resultado.bebida ?? 0,
        colorDebug,
        creadoEn: new Date().toISOString(),
      };
      await bd.crearPlatoCreado(plato);
      this.registrarPlatoEnCatalogo(plato);
    }

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return false;
    const cogido = agregarItem(contenedor, this.catalogoItems, plato.itemId, cantidadEntregar);
    if (!cogido.ok) {
      this.errorCocina(client, "no tienes hueco para el resultado");
      return false;
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("cocina:preparado", { itemId: plato.itemId, nombre: plato.nombre, cantidad: cantidadEntregar, mezclaBonus: resultado.mezclaBonus });
    return true;
  }

  /**
   * Ensalada (docs/GDD_Cocina.md, cocina v2): cortar verduras/frutas crudas
   * EN un cuenco (cualquier vasija sirve, sin fuego ni hervor) con un
   * cuchillo_cocina en el inventario — instantáneo, sin estado persistido.
   */
  private async manejarCocinaEnsalada(client: Client, msg: { construccionId?: number; ingredientes?: { instanciaId: number; cantidad?: number }[] }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number" || !Array.isArray(msg.ingredientes)) return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.cocina?.esVasija) return this.errorCocina(client, "necesitas estar junto a un cuenco");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (!contenedor.items.some((it) => it.itemId === "cuchillo_cocina")) {
      return this.errorCocina(client, "necesitas un cuchillo_cocina para cortar la ensalada");
    }

    const picks: { instanciaId: number; itemId: string; cantidad: number }[] = [];
    const totalesPorItem = new Map<string, number>();
    for (const p of msg.ingredientes) {
      const item = contenedor.items.find((it) => it.id === p.instanciaId);
      if (!item) return this.errorCocina(client, "eso ya no está en tu inventario");
      const e = this.catalogoItems[item.itemId];
      if (!e?.aportesCocina || !e.origenCocina || !aptoParaEnsalada(e.categoriaRecurso)) {
        return this.errorCocina(client, "eso no se puede cortar en ensalada");
      }
      const cantidad = Math.max(1, Math.min(Math.floor(p.cantidad ?? 1), item.cantidad));
      picks.push({ instanciaId: item.id, itemId: item.itemId, cantidad });
      totalesPorItem.set(item.itemId, (totalesPorItem.get(item.itemId) ?? 0) + cantidad);
    }
    if (totalesPorItem.size < 2) return this.errorCocina(client, "una ensalada necesita al menos 2 ingredientes distintos");

    const ingredientesCocina: IngredienteCocina[] = [...totalesPorItem.entries()].map(([itemId, cantidad]) => {
      const e = this.catalogoItems[itemId]!;
      return { itemId, cantidad, aportes: e.aportesCocina!, origen: e.origenCocina! };
    });
    const resultado = cocinarPlato(ingredientesCocina);

    for (const p of picks) {
      const r = quitarItem(contenedor, p.instanciaId, p.cantidad);
      if (!r.ok) return; // ya validado arriba que había cantidad suficiente
    }
    await this.entregarPlatoDinamico(client, "ensalada", [...totalesPorItem.keys()], resultado, resultado.platos, "#6a9a3a");
  }

  /**
   * Bocadillo (docs/GDD_Cocina.md, cocina v2): 2 rebanada_pan + 1+ rellenos
   * (cualquier consumible ya cocinado) — "sin cuenco ni olla ni nada",
   * pedido explícito, así que no exige estar junto a ninguna construcción.
   */
  private async manejarCocinaBocadillo(client: Client, msg: { rellenos?: { instanciaId: number; cantidad?: number }[] }) {
    if (!Array.isArray(msg?.rellenos) || msg.rellenos.length === 0) return this.errorCocina(client, "el bocadillo necesita al menos un relleno");
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const rebanadas = contenedor.items.find((it) => it.itemId === "rebanada_pan" && it.cantidad >= 2);
    if (!rebanadas) return this.errorCocina(client, "necesitas 2 rebanadas de pan");

    const picks: { instanciaId: number; itemId: string; cantidad: number }[] = [];
    const totalesPorItem = new Map<string, number>();
    for (const p of msg.rellenos) {
      const item = contenedor.items.find((it) => it.id === p.instanciaId);
      if (!item) return this.errorCocina(client, "eso ya no está en tu inventario");
      const e = this.catalogoItems[item.itemId];
      if (!e || e.tipo !== "consumible" || !e.restauraMultiple) return this.errorCocina(client, "eso no sirve de relleno");
      const cantidad = Math.max(1, Math.min(Math.floor(p.cantidad ?? 1), item.cantidad));
      picks.push({ instanciaId: item.id, itemId: item.itemId, cantidad });
      totalesPorItem.set(item.itemId, (totalesPorItem.get(item.itemId) ?? 0) + cantidad);
    }

    // La propia rebanada cuenta como un "ingrediente" más en la media (el
    // pan también aporta), mismo motor que una vasija.
    const rebanadaAportes = aportesDesdeRestaura(this.catalogoItems["rebanada_pan"]!.restauraMultiple!);
    const ingredientesCocina: IngredienteCocina[] = [
      { itemId: "rebanada_pan", cantidad: 2, aportes: rebanadaAportes, origen: "vegetal" },
      ...[...totalesPorItem.entries()].map(([itemId, cantidad]) => {
        const e = this.catalogoItems[itemId]!;
        return { itemId, cantidad, aportes: aportesDesdeRestaura(e.restauraMultiple!), origen: (e.origenCocina ?? "vegetal") as OrigenCocina };
      }),
    ];
    const resultado = cocinarPlato(ingredientesCocina);

    quitarItem(contenedor, rebanadas.id, 2);
    for (const p of picks) {
      const r = quitarItem(contenedor, p.instanciaId, p.cantidad);
      if (!r.ok) return;
    }
    await this.entregarPlatoDinamico(client, "bocadillo", ["rebanada_pan", ...totalesPorItem.keys()], resultado, 1, "#d9a850");
  }

  /** Corta 1 pan con cuchillo_cocina -> 6 rebanada_pan, sin vasija ni fuego. */
  private manejarCocinaCortarPan(client: Client, msg: { instanciaId?: number }) {
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (!contenedor.items.some((it) => it.itemId === "cuchillo_cocina")) {
      return this.errorCocina(client, "necesitas un cuchillo_cocina");
    }
    const item = typeof msg?.instanciaId === "number" ? contenedor.items.find((it) => it.id === msg.instanciaId) : undefined;
    if (!item || item.itemId !== "pan") return this.errorCocina(client, "eso no es pan");

    quitarItem(contenedor, item.id, 1);
    const resultado = agregarItem(contenedor, this.catalogoItems, "rebanada_pan", 6);
    if (!resultado.ok) {
      agregarItem(contenedor, this.catalogoItems, "pan", 1); // deshace: el pan no debe perderse si no cabe el resultado
      return this.errorCocina(client, "no tienes hueco para las rebanadas");
    }
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("cocina:cocinado", { itemId: "rebanada_pan", cantidad: 6 });
  }

  // --- Quesera (recipiente_queso, docs/GDD_Cocina.md): leche a granel +
  // lote con/sin sal + tiempo real -> mantequilla/queso. Mismo espíritu que
  // curtidor pero módulo aparte (cuajado.ts) — ver su cabecera. ---

  private errorQuesera(client: Client, motivo: string) {
    client.send("quesera:error", { motivo });
  }

  private extraQueseraDe(viva: { extra?: Record<string, unknown> | null }): EstadoQuesera {
    return ((viva.extra as { quesera?: EstadoQuesera } | null)?.quesera ?? estadoQueseraInicial()) as EstadoQuesera;
  }

  private enviarEstadoQuesera(client: Client, construccionId: number, estado: EstadoQuesera) {
    const ahora = Date.now();
    client.send("quesera:estado", {
      construccionId,
      stockLeche: estado.stockLeche,
      lote: estado.lote ? { conSal: estado.lote.conSal, listo: loteQuesoListo(estado, ahora) } : null,
    });
  }

  private async manejarQueseraCargarLeche(client: Client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number" || typeof msg?.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.quesera) return this.errorQuesera(client, "necesitas estar junto a una quesera");

    const contenedor = this.inventarios.get(client.sessionId);
    const item = contenedor?.items.find((it) => it.id === msg.instanciaId);
    if (!contenedor || !item || item.itemId !== "leche") return this.errorQuesera(client, "eso no es leche");

    const cantidad = Math.max(1, Math.min(Math.floor(msg.cantidad ?? 1), item.cantidad));
    const resultadoQuitar = quitarItem(contenedor, item.id, cantidad);
    if (!resultadoQuitar.ok) return;
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const estado = this.extraQueseraDe(viva);
    const nuevoEstado: EstadoQuesera = { ...estado, stockLeche: estado.stockLeche + cantidad };
    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), quesera: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoQuesera(client, viva.id, nuevoEstado);
  }

  /** Arranca el lote — `conSal:true` (queso) exige y consume 1 "sal" del inventario del jugador AHORA (no es stock a granel del mueble, ver cuajado.ts). */
  private async manejarQueseraIniciarLote(client: Client, msg: { construccionId?: number; conSal?: boolean }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.quesera) return this.errorQuesera(client, "necesitas estar junto a una quesera");

    const conSal = msg.conSal === true;
    const contenedor = this.inventarios.get(client.sessionId);
    let salItem: { id: number } | undefined;
    if (conSal) {
      salItem = contenedor?.items.find((it) => it.itemId === "sal");
      if (!contenedor || !salItem) return this.errorQuesera(client, "necesitas sal para hacer queso");
    }

    const estado = this.extraQueseraDe(viva);
    const nuevoEstado = iniciarLoteQueso(estado, conSal, Date.now());
    if (!nuevoEstado) return this.errorQuesera(client, estado.lote ? "ya hay un lote en curso" : "necesitas más leche");

    if (conSal && contenedor && salItem) {
      quitarItem(contenedor, salItem.id, 1);
      const player = this.state.players.get(client.sessionId);
      if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    }

    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), quesera: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    this.enviarEstadoQuesera(client, viva.id, nuevoEstado);
  }

  private async manejarQueseraRecolectar(client: Client, msg: { construccionId?: number }) {
    const ctx = this.ctxConstruccion;
    if (!ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    const entrada = viva && this.entradaDe(viva.objeto);
    if (!viva || !entrada?.quesera) return this.errorQuesera(client, "necesitas estar junto a una quesera");

    const estado = this.extraQueseraDe(viva);
    const resultado = recolectarLoteQueso(estado, Date.now());
    if (!resultado) return this.errorQuesera(client, estado.lote ? "todavía no está listo" : "no hay ningún lote en curso");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const cogido = agregarItem(contenedor, this.catalogoItems, resultado.itemId, 1);
    if (!cogido.ok) return this.errorQuesera(client, "no tienes hueco para el resultado");
    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const bd = await obtenerBdCompartida();
    viva.extra = { ...(viva.extra ?? {}), quesera: resultado.estado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);
    client.send("quesera:recolectado", { itemId: resultado.itemId });
  }

  /** "Bolsa de N" (docs/GDD_Agricultura.md) — la abre en `abreEn.cantidad` unidades sueltas de `abreEn.itemId`, sin gastar la bolsa si no hay hueco. */
  private manejarObjetoAbrir(client: Client, msg: { instanciaId?: number }) {
    const contenedor = this.inventarios.get(client.sessionId);
    const bolsa = typeof msg?.instanciaId === "number" ? contenedor?.items.find((it) => it.id === msg.instanciaId) : undefined;
    if (!contenedor || !bolsa) return;
    const entrada = this.catalogoItems[bolsa.itemId];
    if (!entrada?.abreEn) return this.errorCultivo(client, "eso no se puede abrir");

    const resultado = agregarItem(contenedor, this.catalogoItems, entrada.abreEn.itemId, entrada.abreEn.cantidad);
    if (!resultado.ok) return this.errorCultivo(client, "no tienes hueco para lo que hay dentro");
    quitarItem(contenedor, bolsa.id, 1);

    const player = this.state.players.get(client.sessionId);
    if (player) sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("objeto:abierto", { itemId: entrada.abreEn.itemId, cantidad: entrada.abreEn.cantidad });
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

  private errorCurtidor(client: Client, motivo: string) {
    client.send("curtidor:error", { motivo });
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

    if (receta.edificioRequerido) {
      let existe = false;
      for (const v of ctx.vivas.values()) {
        if (v.objeto === receta.edificioRequerido) { existe = true; break; }
      }
      if (!existe) return this.errorCrafteo(client, `hace falta un ${receta.edificioRequerido} construido en el asentamiento`);
    }

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

  // ---- Encurtido de pieles (docs/GDD_Caza.md, cubo_sal/barril_curtido) ----
  // Mueble-contenedor con UN lote a la vez (server/src/construccion/curtido.ts,
  // reloj perezoso — sin tick): cargarMaterial mete stock a granel (cualquiera
  // puede aportar), meterPiel arranca el lote (exige oficio, consume stock +
  // la piel del inventario), recolectar entrega el resultado cuando toca.

  /** Carga el mueble con material a granel (sal/curtiente) desde el cuerpo del jugador — dueño o jarl, sin oficio (tarea de mantenimiento, no de artesano). */
  private async manejarCurtidorCargarMaterial(client: Client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number" || typeof msg.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCurtidor(client, "construcción inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? (await this.duenoDeTenderete(viva.propiedad));
    if (dueno !== nombre && !esJarl(ctx, nombre)) return this.errorCurtidor(client, "no eres el dueño de esta construcción");
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (Math.hypot(viva.x - player.x, viva.y - player.y) > RADIO_INTERACCION) return this.errorCurtidor(client, "demasiado lejos");

    const datos = this.entradaDe(viva.objeto)?.curtidor;
    if (!datos) return this.errorCurtidor(client, "esta construcción no admite material");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it || it.itemId !== datos.materialCarga) return this.errorCurtidor(client, "eso no es lo que necesita este mueble");

    const bd = await obtenerBdCompartida();
    const extraActual = (viva.extra ?? {}) as { curtidor?: EstadoCurtidor; [k: string]: unknown };
    const estadoPrevio: EstadoCurtidor = extraActual.curtidor ?? { stock: 0 };
    const hueco = huecoMaterialCurtidor(estadoPrevio, datos);
    if (hueco <= 0) return this.errorCurtidor(client, "ya está lleno");
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad, hueco));

    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) return this.errorCurtidor(client, resultado.motivo ?? "no se pudo cargar");

    const nuevoEstado: EstadoCurtidor = { ...estadoPrevio, stock: estadoPrevio.stock + cantidad };
    viva.extra = { ...extraActual, curtidor: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("curtidor:estado", { construccionId: viva.id, stock: nuevoEstado.stock, capacidadMax: datos.capacidadMaxMaterial, lote: nuevoEstado.lote ?? null });
  }

  /** Mete una piel a procesar — el paso ARTESANO: exige oficio curtidor/peletero, sin lote ya en curso y stock a granel suficiente. */
  private async manejarCurtidorMeterPiel(client: Client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number" || typeof msg.instanciaId !== "number") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.oficio !== "curtidor" && player.oficio !== "peletero") {
      return this.errorCurtidor(client, "necesitas el oficio de curtidor o peletero");
    }
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCurtidor(client, "construcción inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? (await this.duenoDeTenderete(viva.propiedad));
    if (dueno !== nombre && !esJarl(ctx, nombre)) return this.errorCurtidor(client, "no eres el dueño de esta construcción");
    if (Math.hypot(viva.x - player.x, viva.y - player.y) > RADIO_INTERACCION) return this.errorCurtidor(client, "demasiado lejos");

    const datos = this.entradaDe(viva.objeto)?.curtidor;
    if (!datos) return this.errorCurtidor(client, "esta construcción no procesa pieles");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it || !aceptaEntradaCurtidor(datos, it.itemId, this.catalogoItems)) {
      return this.errorCurtidor(client, "eso no se puede meter en este mueble");
    }

    const bd = await obtenerBdCompartida();
    const extraActual = (viva.extra ?? {}) as { curtidor?: EstadoCurtidor; [k: string]: unknown };
    const estadoPrevio: EstadoCurtidor = extraActual.curtidor ?? { stock: 0 };
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));
    const nuevoEstado = iniciarLoteCurtidor(estadoPrevio, datos, cantidad, Date.now());
    if (!nuevoEstado) {
      return this.errorCurtidor(client, estadoPrevio.lote ? "ya hay un lote en proceso" : "no hay suficiente material cargado");
    }

    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) return this.errorCurtidor(client, resultado.motivo ?? "no se pudo meter la piel");

    viva.extra = { ...extraActual, curtidor: nuevoEstado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("curtidor:estado", { construccionId: viva.id, stock: nuevoEstado.stock, capacidadMax: datos.capacidadMaxMaterial, lote: nuevoEstado.lote ?? null });
  }

  /** Recolecta el lote terminado — dueño o jarl, resuelto perezosamente por timestamp (sin tick de servidor). */
  private async manejarCurtidorRecolectar(client: Client, msg: { construccionId?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorCurtidor(client, "construcción inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? (await this.duenoDeTenderete(viva.propiedad));
    if (dueno !== nombre && !esJarl(ctx, nombre)) return this.errorCurtidor(client, "no eres el dueño de esta construcción");
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (Math.hypot(viva.x - player.x, viva.y - player.y) > RADIO_INTERACCION) return this.errorCurtidor(client, "demasiado lejos");

    const datos = this.entradaDe(viva.objeto)?.curtidor;
    if (!datos) return this.errorCurtidor(client, "esta construcción no procesa pieles");

    const extraActual = (viva.extra ?? {}) as { curtidor?: EstadoCurtidor; [k: string]: unknown };
    const estadoPrevio: EstadoCurtidor = extraActual.curtidor ?? { stock: 0 };
    const resultado = recolectarLoteCurtidor(estadoPrevio, datos, Date.now());
    if (!resultado) return this.errorCurtidor(client, estadoPrevio.lote ? "todavía no está listo" : "no hay ningún lote en proceso");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const entregado = intentarCoger(contenedor, this.catalogoItems, { itemId: datos.salida, cantidad: resultado.cantidad });
    if (!entregado.ok) return this.errorCurtidor(client, "no tienes hueco en tu inventario");

    const bd = await obtenerBdCompartida();
    viva.extra = { ...extraActual, curtidor: resultado.estado };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("curtidor:completado", { construccionId: viva.id, itemId: datos.salida, cantidad: resultado.cantidad });
  }

  // ---- Ganadería (docs/GDD_Ganaderia.md, cría de animales domésticos) ----

  private errorAnimal(client: Client, motivo: string) {
    client.send("animal:error", { motivo });
  }

  /** ¿Hay algún refugio de esa categoriaVida (gallinero/nido/cobertizo_ganado) en esta propiedad? Sin uno, no se puede traer un animal de esas categorías. */
  private tieneRefugioParaCategoria(propiedadId: string, categoriaVida: CategoriaVidaAnimal): boolean {
    const ctx = this.ctxConstruccion;
    if (!ctx) return false;
    for (const viva of ctx.vivas.values()) {
      if (viva.propiedad !== propiedadId) continue;
      if (this.entradaDe(viva.objeto)?.refugioGranja?.categoriasVida.includes(categoriaVida)) return true;
    }
    return false;
  }

  /**
   * ¿Tiene esta propiedad comedero con stock Y bebedero hoy? Un `bebedero`
   * se distingue de una trampa de pesca (que TAMBIÉN es `requiereAgua`)
   * por no tener `produccion` — ambas cosas junto al agua, pero solo una
   * es un abrevadero. Gatea la producción de leche/lana/huevos (se congela
   * sin comer/beber, nunca hace daño al animal — decisión explícita).
   */
  private tieneComidaYAguaHoy(propiedadId: string): boolean {
    const ctx = this.ctxConstruccion;
    if (!ctx) return false;
    let hayComedero = false, hayBebedero = false;
    for (const viva of ctx.vivas.values()) {
      if (viva.propiedad !== propiedadId) continue;
      const entrada = this.entradaDe(viva.objeto);
      if (!entrada) continue;
      if (entrada.alimentador) {
        const extra = (viva.extra ?? {}) as { alimentador?: { stock: number } };
        if ((extra.alimentador?.stock ?? 0) > 0) hayComedero = true;
      }
      if (entrada.requiereAgua && !entrada.produccion) hayBebedero = true;
    }
    return hayComedero && hayBebedero;
  }

  /**
   * Resuelve perezosamente el escape (docs/GDD_Ganaderia.md) desde
   * `ultimoDiaEscapeChequeado` hasta hoy — SIEMPRE se llama antes de
   * cualquier interacción con un animal concreto, para que uno ya escapado
   * deje de responder cuanto antes. Si escapa: se borra de BD/estado y
   * reaparece como `Fauna` normal en ESTA room (simplificación deliberada
   * v1 — NO se integra en faunaSalvajeViva/reproducción individual
   * persistente, ver docs/GDD_Ganaderia.md §escape). Devuelve `true` si
   * ACABA de escapar en esta resolución.
   */
  private async resolverEscapeAnimal(fila: AnimalGranjaFila): Promise<boolean> {
    const diaActual = tiempoMundo().dia;
    const extraActual = fila.extra as { produccion?: Partial<Record<CategoriaProductoGranja, EstadoProduccion>>; ultimoDiaEscapeChequeado?: number };
    const ultimoDia = extraActual.ultimoDiaEscapeChequeado ?? diaActual;
    const diasTranscurridos = diaActual - ultimoDia;
    if (diasTranscurridos <= 0) return false;

    const encerrado = estaEncerrado(this.mundo, fila.x, fila.y);
    const bd = await obtenerBdCompartida();
    if (tiroEscape(diasTranscurridos, encerrado)) {
      await bd.borrarAnimalGranja(fila.id);
      this.animalesGranjaPuros.delete(fila.id);
      this.state.animalesGranja.delete(fila.id);
      const f = new Fauna();
      f.x = fila.x; f.y = fila.y; f.especieId = fila.especieId;
      const stats = this.estadisticasFaunaDe(fila.especieId);
      f.vida = stats?.vidaMaxima ?? 15; f.vidaMax = stats?.vidaMaxima ?? 15; f.ataque = stats?.ataque ?? 2;
      this.state.fauna.set(`escapado:${fila.id}`, f);
      return true;
    }

    fila.extra = { ...extraActual, ultimoDiaEscapeChequeado: diaActual };
    await bd.actualizarExtraAnimalGranja(fila.id, fila.extra);
    return false;
  }

  /**
   * Cría de descendencia (docs/GDD_Ganaderia.md, ampliación 2026-08-30,
   * pedido del streamer) — resuelta perezosamente para TODA la propiedad
   * de una vez (necesita ver a todos sus animales para emparejar), cada
   * vez que se toca CUALQUIER animal de ella (recolectar/consultar, mismo
   * criterio que `resolverEscapeAnimal` por individuo). Gatea fertilidad
   * con el mismo "comida+agua hoy" que la producción de leche/lana/huevos;
   * "nido" reusa la construible `nido`/`gallinero` ya existente en la
   * propiedad (sin concepto nuevo). Los huevos se materializan como
   * `ObjetoMundoSchema` reales en el sitio del ave — visibles y recogibles
   * por cualquiera, pedido explícito "se puede ver en el suelo".
   */
  private async resolverReproduccionAnimalesPropiedad(propiedadId: string): Promise<void> {
    const animales = [...this.animalesGranjaPuros.values()].filter((a) => a.propiedadId === propiedadId);
    if (animales.length === 0) return;

    const ctx = this.ctxConstruccion;
    let tieneNido = false;
    if (ctx) {
      for (const viva of ctx.vivas.values()) {
        if (viva.propiedad === propiedadId && viva.objeto === "nido") { tieneNido = true; break; }
      }
    }
    const alimentado = this.tieneComidaYAguaHoy(propiedadId);
    const { dia, hora } = tiempoMundo();
    const ahora = diaFraccional(dia, hora);
    const catalogo = this.cargarReproduccionGranja();

    const resultado = resolverReproduccionPropiedad(animales, catalogo, alimentado, tieneNido, ahora);
    if (resultado.extraPorId.size === 0 && resultado.nuevos.length === 0 && resultado.maduraciones.length === 0 && resultado.huevos.length === 0) return;

    const bd = await obtenerBdCompartida();

    for (const [id, extra] of resultado.extraPorId) {
      const fila = this.animalesGranjaPuros.get(id);
      if (!fila) continue;
      fila.extra = extra;
      await bd.actualizarExtraAnimalGranja(id, extra);
    }

    for (const madurez of resultado.maduraciones) {
      await bd.borrarAnimalGranja(madurez.viejoId);
      this.animalesGranjaPuros.delete(madurez.viejoId);
      this.state.animalesGranja.delete(madurez.viejoId);
      const nueva: AnimalGranjaFila = {
        id: `animal:${madurez.nuevoEspecieId}:${Date.now()}:${this.contadorAnimalGranja++}`,
        especieId: madurez.nuevoEspecieId, mapaId: this.asentamientoConstruccion ?? "", propiedadId,
        x: madurez.x, y: madurez.y, extra: { ultimoDiaEscapeChequeado: dia },
        enVentaTenderoteId: null, enVentaPrecio: null, creadoEn: new Date().toISOString(),
      };
      await bd.crearAnimalGranjaBd(nueva);
      this.publicarAnimalGranja(nueva);
    }

    for (const cria of resultado.nuevos) {
      const nueva: AnimalGranjaFila = {
        id: `animal:${cria.especieId}:${Date.now()}:${this.contadorAnimalGranja++}`,
        especieId: cria.especieId, mapaId: this.asentamientoConstruccion ?? "", propiedadId,
        x: cria.x, y: cria.y, extra: { ultimoDiaEscapeChequeado: dia, reproduccion: { gestandoDesde: null, gestacionDuracionDias: null, nacioEn: ahora, ultimoHuevoEn: null } },
        enVentaTenderoteId: null, enVentaPrecio: null, creadoEn: new Date().toISOString(),
      };
      await bd.crearAnimalGranjaBd(nueva);
      this.publicarAnimalGranja(nueva);
    }

    for (const puesta of resultado.huevos) {
      for (let i = 0; i < puesta.cantidad; i++) {
        const o = new ObjetoMundoSchema();
        o.x = Math.floor(puesta.x) + 0.5;
        o.y = Math.floor(puesta.y) + 0.5;
        o.itemId = "huevo";
        o.cantidad = 1;
        this.state.objetosMundo.set(String(this.siguienteObjetoMundoId++), o);
      }
    }
  }

  /**
   * Domestica el animal de granja domesticable más cercano (auto-apunta,
   * mismo criterio sin targeting que el resto del proyecto) — funciona
   * tanto contra fauna SALVAJE (HubRoom, p.ej. cabra) como URBANA
   * (RegionRoom, p.ej. vaca/oveja/cerdo/gallina). `veces` = mismo umbral
   * que mascotas (5x dar de comida), pero crea un AnimalGranja en
   * `propiedadDestino` en vez de una Mascota que sigue al jugador — exige
   * ya tener un refugio (gallinero/nido/cobertizo_ganado) allí.
   */
  private async manejarAnimalDomesticar(client: Client, msg: { propiedadDestino?: string }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    const player = this.state.players.get(client.sessionId);
    if (!nombre || !ctx || !player || !msg?.propiedadDestino) return;

    const propiedadDestino = msg.propiedadDestino;
    const duenoDestino = ctx.propiedades.get(propiedadDestino)?.dueno;
    if (!duenoDestino || duenoDestino.toLowerCase() !== nombre.toLowerCase()) {
      return this.errorAnimal(client, "esa propiedad no es tuya");
    }

    let faunaId: string | null = null;
    let mejorDist = RADIO_INTERACCION;
    for (const [id, f] of this.state.fauna.entries()) {
      const stats = this.estadisticasFaunaDe(f.especieId);
      if (!stats?.domesticable || !stats.categoriaRecursoCarne) continue; // ganadería = domesticable CON carne (distingue de perro/gato/monturas)
      const d = Math.hypot(f.x - player.x, f.y - player.y);
      if (d < mejorDist) { mejorDist = d; faunaId = id; }
    }
    if (!faunaId) return this.errorAnimal(client, "no hay ningún animal de granja domesticable cerca");

    const especieId = this.state.fauna.get(faunaId)!.especieId;
    const stats = this.estadisticasFaunaDe(especieId)!;
    if (!this.tieneRefugioParaCategoria(propiedadDestino, stats.categoriaVida)) {
      return this.errorAnimal(client, "necesitas un refugio (gallinero/nido/cobertizo_ganado) en esa propiedad para esta especie");
    }

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const comida = contenedor.items.find((it) => this.catalogoItems[it.itemId]?.comidaMascota);
    if (!comida) return this.errorAnimal(client, "necesitas comida para domesticarlo");
    const quitado = quitarItem(contenedor, comida.id, 1);
    if (!quitado.ok) return;
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const progreso = this.progresoDomesticarGranja.get(client.sessionId);
    const veces = (progreso?.faunaId === faunaId ? progreso.veces : 0) + 1;
    if (veces < VECES_COMIDA_PARA_DOMESTICAR_GRANJA) {
      this.progresoDomesticarGranja.set(client.sessionId, { faunaId, veces });
      return client.send("animal:domesticando", { veces, faltan: VECES_COMIDA_PARA_DOMESTICAR_GRANJA - veces });
    }
    this.progresoDomesticarGranja.delete(client.sessionId);

    const manejado = await this.onFaunaDomesticada(faunaId);
    if (!manejado) this.state.fauna.delete(faunaId);

    const bd = await obtenerBdCompartida();
    const id = `animal:${especieId}:${Date.now()}:${this.contadorAnimalGranja++}`;
    const punto = this.puntoDePropiedad(propiedadDestino) ?? { x: player.x, y: player.y };
    const fila: AnimalGranjaFila = {
      id, especieId, mapaId: this.asentamientoConstruccion ?? "", propiedadId: propiedadDestino,
      x: punto.x, y: punto.y, extra: { ultimoDiaEscapeChequeado: tiempoMundo().dia },
      enVentaTenderoteId: null, enVentaPrecio: null, creadoEn: new Date().toISOString(),
    };
    await bd.crearAnimalGranjaBd(fila);
    this.publicarAnimalGranja(fila);
    client.send("animal:domesticado", { animalId: id, especieId });
  }

  /** Carga un comedero con pienso a granel — dueño o jarl, sin oficio (mantenimiento, no artesanía). Mismo patrón que curtidor:cargarMaterial pero sin lote/transformación, solo un contador de stock. */
  private async manejarAnimalCargarComedero(client: Client, msg: { construccionId?: number; instanciaId?: number; cantidad?: number }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    if (!nombre || !ctx || typeof msg?.construccionId !== "number" || typeof msg.instanciaId !== "number") return;
    const viva = ctx.vivas.get(msg.construccionId);
    if (!viva) return this.errorAnimal(client, "construcción inexistente");
    const dueno = ctx.propiedades.get(viva.propiedad)?.dueno ?? (await this.duenoDeTenderete(viva.propiedad));
    if (dueno !== nombre && !esJarl(ctx, nombre)) return this.errorAnimal(client, "no eres el dueño de esta construcción");
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (Math.hypot(viva.x - player.x, viva.y - player.y) > RADIO_INTERACCION) return this.errorAnimal(client, "demasiado lejos");

    const datos = this.entradaDe(viva.objeto)?.alimentador;
    if (!datos) return this.errorAnimal(client, "esta construcción no admite pienso");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it || it.itemId !== datos.itemId) return this.errorAnimal(client, "eso no es lo que necesita este comedero");

    const extraActual = (viva.extra ?? {}) as { alimentador?: { stock: number }; [k: string]: unknown };
    const stockActual = extraActual.alimentador?.stock ?? 0;
    const hueco = Math.max(0, datos.capacidadMaxMaterial - stockActual);
    if (hueco <= 0) return this.errorAnimal(client, "ya está lleno");
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad, hueco));

    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) return this.errorAnimal(client, resultado.motivo ?? "no se pudo cargar");

    const bd = await obtenerBdCompartida();
    viva.extra = { ...extraActual, alimentador: { stock: stockActual + cantidad } };
    await bd.actualizarExtraConstruccion(viva.id, viva.extra);

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("animal:comederoEstado", { construccionId: viva.id, stock: stockActual + cantidad, capacidadMax: datos.capacidadMaxMaterial });
  }

  /**
   * Recolecta un producto vivo (leche/lana/huevos) — dueño o jarl,
   * resuelve el escape primero, luego `resolverProduccion` reusado tal
   * cual (mismo mecanismo que colmena/curtidor): `requiereTrabajador`
   * pasa a significar "tiene comida y agua hoy", congelando el reloj sin
   * castigo cuando no las tiene.
   */
  private async manejarAnimalRecolectarProducto(client: Client, msg: { animalId?: string; producto?: string }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    const player = this.state.players.get(client.sessionId);
    if (!nombre || !ctx || !player || !msg?.animalId || !msg.producto) return;

    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila) return this.errorAnimal(client, "ese animal no existe");
    const dueno = ctx.propiedades.get(fila.propiedadId)?.dueno;
    if (dueno?.toLowerCase() !== nombre.toLowerCase() && !esJarl(ctx, nombre)) {
      return this.errorAnimal(client, "no eres el dueño de este animal");
    }
    if (Math.hypot(fila.x - player.x, fila.y - player.y) > RADIO_INTERACCION) return this.errorAnimal(client, "demasiado lejos");

    const producto = msg.producto as CategoriaProductoGranja;
    const cfg = PRODUCTOS_GRANJA[producto];
    if (!cfg) return this.errorAnimal(client, "producto desconocido");
    const stats = this.estadisticasFaunaDe(fila.especieId);
    if (!stats?.categoriaProductoGranja?.includes(producto)) return this.errorAnimal(client, "este animal no da ese producto");
    if (cfg.exigeOficio && player.oficio !== "ganadero") return this.errorAnimal(client, "necesitas el oficio de ganadero");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (cfg.herramienta && !contenedor.items.some((it) => it.itemId === cfg.herramienta)) {
      return this.errorAnimal(client, `necesitas ${cfg.herramienta}`);
    }

    if (await this.resolverEscapeAnimal(fila)) return this.errorAnimal(client, "ese animal ya no está — se ha escapado");
    await this.resolverReproduccionAnimalesPropiedad(fila.propiedadId);

    const bd = await obtenerBdCompartida();
    const extraActual = fila.extra as { produccion?: Partial<Record<CategoriaProductoGranja, EstadoProduccion>>; ultimoDiaEscapeChequeado?: number };
    const produccionPrevia = extraActual.produccion ?? {};
    const estadoPrevio: EstadoProduccion = produccionPrevia[producto] ?? { stock: 0, ultimoCalculo: Date.now() };
    const alimentado = this.tieneComidaYAguaHoy(fila.propiedadId);
    const datosProduccion: DatosProduccion = {
      itemId: cfg.itemId, cantidadPorIntervalo: cfg.cantidadPorDia, intervaloHoras: 24, capacidadMax: cfg.capacidadMax, requiereTrabajador: true,
    };
    const resuelto = resolverProduccion({ ...estadoPrevio, trabajadorAsignado: alimentado }, datosProduccion, Date.now());
    const cantidadEntera = Math.floor(resuelto.stock);

    if (cantidadEntera <= 0) {
      fila.extra = { ...extraActual, produccion: { ...produccionPrevia, [producto]: resuelto } };
      await bd.actualizarExtraAnimalGranja(fila.id, fila.extra);
      return this.errorAnimal(client, alimentado ? "todavía no hay nada que recolectar" : "el animal no ha comido ni bebido hoy");
    }

    const resultado = intentarCoger(contenedor, this.catalogoItems, { itemId: cfg.itemId, cantidad: cantidadEntera });
    if (!resultado.ok) return this.errorAnimal(client, "no tienes hueco en tu inventario");

    const nuevoEstado: EstadoProduccion = { ...resuelto, stock: resuelto.stock - cantidadEntera };
    fila.extra = { ...extraActual, produccion: { ...produccionPrevia, [producto]: nuevoEstado } };
    await bd.actualizarExtraAnimalGranja(fila.id, fila.extra);

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
    client.send("animal:producto", { animalId: fila.id, producto, itemId: cfg.itemId, cantidad: cantidadEntera });
  }

  /**
   * Sacrifica el animal — dueño o jarl, exige cuchillo_desollar (reusado
   * de docs/GDD_Caza.md, SIN exigir oficio: matar tu propio animal no
   * necesita entrenamiento). Da carne+piel reusando `rellenarLootCaza`/
   * `pielDeDesollado` TAL CUAL — mismas tablas que la caza, sin pasar por
   * cadáver (el animal desaparece del todo directamente).
   */
  private async manejarAnimalSacrificar(client: Client, msg: { animalId?: string }) {
    const nombre = this.nombreDe(client);
    const ctx = this.ctxConstruccion;
    const player = this.state.players.get(client.sessionId);
    if (!nombre || !ctx || !player || !msg?.animalId) return;

    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila) return this.errorAnimal(client, "ese animal no existe");
    const dueno = ctx.propiedades.get(fila.propiedadId)?.dueno;
    if (dueno?.toLowerCase() !== nombre.toLowerCase() && !esJarl(ctx, nombre)) {
      return this.errorAnimal(client, "no eres el dueño de este animal");
    }
    if (Math.hypot(fila.x - player.x, fila.y - player.y) > RADIO_INTERACCION) return this.errorAnimal(client, "demasiado lejos");

    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (!contenedor.items.some((it) => it.itemId === "cuchillo_desollar")) {
      return this.errorAnimal(client, "necesitas un cuchillo de desollar");
    }
    const especie = this.estadisticasFaunaDe(fila.especieId);
    if (!especie) return this.errorAnimal(client, "no se puede sacrificar esto");

    const temporal = crearContenedor(ANCHO_INVENTARIO_CADAVER, ALTO_INVENTARIO_CADAVER);
    rellenarLootCaza(temporal, this.catalogoItems, especie);
    const pielResultado = pielDeDesollado(especie);
    if (pielResultado.pielItemId) agregarItem(temporal, this.catalogoItems, pielResultado.pielItemId, pielResultado.pielCantidad);

    const pesoMaximo = pesoMaximoTransportable(player.atributos.fuerza);
    const entregados: string[] = [];
    for (const item of temporal.items) {
      if (excedePesoMaximo(contenedor, this.catalogoItems, item.itemId, item.cantidad, pesoMaximo)) continue;
      if (intentarCoger(contenedor, this.catalogoItems, { itemId: item.itemId, cantidad: item.cantidad }).ok) {
        entregados.push(item.itemId);
      }
    }
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    const bd = await obtenerBdCompartida();
    await bd.borrarAnimalGranja(fila.id);
    this.animalesGranjaPuros.delete(fila.id);
    this.state.animalesGranja.delete(fila.id);
    client.send("animal:sacrificado", { animalId: fila.id, entregados });
  }

  /** Consulta de solo lectura (estado/producción/vallado) — para UI/depuración, sin gating de dueño (información pública del animal, mismo criterio que tenderete:escaparate). */
  private async manejarAnimalConsultar(client: Client, msg: { animalId?: string }) {
    if (!msg?.animalId) return;
    const fila = this.animalesGranjaPuros.get(msg.animalId);
    if (!fila) return this.errorAnimal(client, "ese animal no existe");
    await this.resolverEscapeAnimal(fila);
    if (this.animalesGranjaPuros.has(msg.animalId)) await this.resolverReproduccionAnimalesPropiedad(fila.propiedadId);
    const filaActual = this.animalesGranjaPuros.get(msg.animalId);
    if (!filaActual) return this.errorAnimal(client, "ese animal ya no está — se escapó o (si era una cría) acaba de madurar");
    const stats = this.estadisticasFaunaDe(filaActual.especieId);
    client.send("animal:estado", {
      animalId: filaActual.id, especieId: filaActual.especieId, propiedadId: filaActual.propiedadId,
      productos: stats?.categoriaProductoGranja ?? [],
      encerrado: estaEncerrado(this.mundo, filaActual.x, filaActual.y),
      alimentadoHoy: this.tieneComidaYAguaHoy(filaActual.propiedadId),
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
      await this.repartirLootFarycoinsPorMuerte(id);
      this.state.enemigos.delete(id);
    } else if (tipo === "npc") {
      this.state.npcs.delete(id);
    } else if (tipo === "jugador") {
      await this.manejarMuerteJugador(id);
    }
  }

  /**
   * Loot de Farycoins al matar un enemigo hostil (docs/GDD_Economia.md,
   * pedido 2026-08-30: "al matar npc pueden lotear de 1 a 20 farycoins
   * aleatoriamente") — SOLO `enemigos` (bandidos/mazmorra, que sí tienen
   * combate y muerte reales); fauna y NPCs civiles quedan fuera a
   * propósito (civiles ni siquiera son atacables hoy). Cada jugador del
   * bando ganador de ESE combate concreto tira su PROPIA moneda 1-20 —
   * decisión simple y ajustable si en grupo grande se ve desbalanceado.
   */
  private async repartirLootFarycoinsPorMuerte(enemigoId: string) {
    const existente = this.combatePorUnidad(enemigoId);
    if (!existente) return;
    const [, combate] = existente;
    const cuEnemigo = combate.unidades.get(enemigoId);
    if (!cuEnemigo) return;
    const ganadores: string[] = [];
    for (const cu of combate.unidades.values()) {
      if (cu.esJugador && cu.bando !== cuEnemigo.bando && cu.estado === "activo") ganadores.push(cu.id);
    }
    if (ganadores.length === 0) return;
    const bd = await obtenerBdCompartida();
    for (const sessionId of ganadores) {
      const nombre = this.state.players.get(sessionId)?.name;
      if (!nombre) continue;
      const cantidad = 1 + Math.floor(Math.random() * 20); // 1..20, pedido explícito
      const jugador = await bd.obtenerOCrearJugador(nombre);
      const r = await bd.ajustarFarycoins(jugador.id, cantidad);
      this.clients.find((c) => c.sessionId === sessionId)?.send("economia:loot", { motivo: "enemigo", farycoins: cantidad, saldo: r.saldo });
    }
  }

  /**
   * Dónde caen los objetos perdidos al morir (docs/GDD_Muerte_Respawn.md) —
   * por defecto ESTA MISMA room, en la posición real del jugador (Hub/
   * Region/Interior: sus coordenadas ya son las del mundo). `ArenaCombateRoom`
   * lo sobreescribe: ahí las coordenadas son internas de la arena instanciada,
   * no del mundo real, así que hay que resolver la room de ORIGEN.
   */
  protected roomYPosicionParaDrop(sessionId: string): { room: RoomExteriorBase; x: number; y: number } | null {
    const player = this.state.players.get(sessionId);
    if (!player) return null;
    return { room: this, x: player.x, y: player.y };
  }

  /**
   * Muerte de jugador de verdad (docs/GDD_Muerte_Respawn.md, pedido
   * 2026-08-30) — llamada desde CUALQUIER camino que pueda dejar `vida` a 0
   * (combate vía `finalizarMuerte`, y los que se disparan directo desde
   * `actualizarMovimiento`: inanición, clima extremo, eventos Twitch de
   * daño ambiental):
   *
   * - **-20% de durabilidad FLAT** (`aplicarPenalizacionMuerte`, ya existía
   *   pura y testeada, sin nadie que la llamara) a lo que cuenta como
   *   "equipo" — aproximado por TIPO de ítem (`herramienta`/`equipable`/
   *   `arma`) porque todavía no existe un sistema de equipar en vivo (solo
   *   el esqueleto de datos, `SlotsEquipo`/`guardarEquipo`) — cuando exista
   *   de verdad, esto pasa a mirar los slots equipados en vez del tipo.
   * - **El resto del inventario se pierde** — cae al suelo en el sitio de
   *   la muerte como objetos sueltos normales (mismo `ObjetoMundoSchema`
   *   que "soltar", recogible por cualquiera, él mismo incluido si vuelve).
   * - **Respawn**: en la cama de su propiedad si tiene una, si no en el
   *   spawn inicial (`resolverRespawn`).
   */
  protected async manejarMuerteJugador(sessionId: string) {
    // Idempotencia (docs/GDD_Muerte_Respawn.md) — IMPRESCINDIBLE: el camino
    // de daño ambiental/inanición comprueba `vida<=0` en CADA tick de
    // movimiento (30hz) y `vida` no se resetea hasta el final de esta misma
    // función (que es async, con awaits a BD de por medio) — sin este
    // guardia, un jugador muerto por rayo/inanición dispararía esta función
    // decenas de veces por segundo mientras dure la ventana async.
    if (this.jugadoresMuriendo.has(sessionId)) return;
    this.jugadoresMuriendo.add(sessionId);
    try {
      await this.procesarMuerteJugador(sessionId);
    } finally {
      this.jugadoresMuriendo.delete(sessionId);
    }
  }

  private async procesarMuerteJugador(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const nombre = player.name;
    const contenedor = this.inventarios.get(sessionId);

    if (contenedor) {
      const ahora = Date.now();
      const equipoLike: PiezaEquipada[] = [];
      const resto: typeof contenedor.items = [];
      for (const it of contenedor.items) {
        const entrada = this.catalogoItems[it.itemId];
        if (entrada && (entrada.tipo === "herramienta" || entrada.tipo === "equipable" || entrada.tipo === "arma")) {
          equipoLike.push({ instancia: it, entrada });
        } else {
          resto.push(it);
        }
      }
      aplicarPenalizacionMuerte(equipoLike, ahora);

      const destinoDrop = resto.length > 0 ? this.roomYPosicionParaDrop(sessionId) : null;
      if (destinoDrop) {
        const { room, x, y } = destinoDrop;
        for (const it of resto) {
          const o = new ObjetoMundoSchema();
          o.x = Math.floor(x) + 0.5;
          o.y = Math.floor(y) + 0.5;
          o.itemId = it.itemId;
          o.cantidad = it.cantidad;
          room.state.objetosMundo.set(String(room.siguienteObjetoMundoId++), o);
        }
      }

      contenedor.items = equipoLike.map((p) => p.instancia); // el cuerpo se queda solo con lo "equipado"
      sincronizarContenedor(player.inventario.cuerpo, contenedor);
    }

    // Vida llena YA (antes de resolver el respawn, que awaitea BD): además
    // de "respawneas sano", esto es lo que corta el bucle de daño ambiental/
    // inanición (que solo comprueba vida<=0, ver el guardia de arriba).
    player.vida = player.vidaMax;

    const bd = await obtenerBdCompartida();
    if (!this.catalogoConstruible) this.catalogoConstruible = cargarCatalogoConstruible();
    const destino = await resolverRespawn(bd, this.catalogoConstruible, nombre);

    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (destino.tipo === "hub") client?.send("portal:ir", { tipo: "hub" });
    else client?.send("portal:ir", { tipo: "region", mapaId: destino.mapaId, x: destino.x, y: destino.y });
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

  /**
   * Punto de enganche gemelo de `onFaunaMuerta` (docs/GDD_Ganaderia.md,
   * pedido 2026-08-30): domesticar una fauna VIVA (no matarla) tiene que
   * quitarla de SU gestor real (GestorFaunaSalvaje en HubRoom, GestorFauna
   * en RegionRoom) para no dejar bookkeeping huérfano — cada room sabe cuál
   * es el suyo. `true` = ya se encargó de quitarla del estado (mismo
   * criterio que onFaunaMuerta); `false` = sin gestor aquí, cae al borrado
   * genérico de `state.fauna`.
   */
  protected async onFaunaDomesticada(_id: string): Promise<boolean> {
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
      pasivo: cu.pasivo,
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
    stats: { hp: number; hpMax: number; ataque: number; defensa: number; esJugador: boolean; pasivo?: boolean },
  ): CombateUnidad {
    const cu = new CombateUnidad();
    cu.id = id;
    cu.esJugador = stats.esJugador;
    cu.bando = bando;
    cu.gx = Math.max(0, Math.round(gx));
    cu.gy = Math.max(0, Math.round(gy));
    cu.hp = stats.hp;
    cu.hpMax = stats.hpMax;
    cu.pasivo = stats.pasivo ?? false;
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
    // PvP (docs/GDD_PvP.md, pedido 2026-08-30): atacar a OTRO jugador solo
    // si el jarl activó el interruptor global Y esta zona no es segura
    // (Hub/capital, siempre a salvo pase lo que pase) — PvE (fauna/enemigo/
    // npc) nunca pasa por aquí, sigue igual que siempre.
    if (objetivoStats.esJugador && !(pvpGlobalHabilitado() && !this.esZonaSeguraPropia)) {
      return client.send("combate:error", { motivo: "pvp deshabilitado aquí" });
    }
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

    // Modo caza (docs/GDD_Caza.md, pedido 2026-08-30): objetivo es fauna NO
    // peligrosa (jabalí/lobo/oso siguen siendo combate normal, vía
    // faunaEsPeligrosa) — presa pasiva (deambula, nunca ataca) y sin ventana
    // de unión: nadie más puede sumarse a cazar contigo a este bicho.
    const especieObjetivo = this.state.fauna.get(msg.objetivoId)?.especieId;
    const esModoCaza = especieObjetivo !== undefined && !this.faunaEsPeligrosa(especieObjetivo);

    const uAtacante = this.crearUnidadCombate(atacanteId, "A", atacante.x - gx0, atacante.y - gy0, {
      hp: atacante.vida, hpMax: atacante.vidaMax, ataque: atacante.ataque, defensa: atacante.defensa, esJugador: true,
    });
    const uObjetivo = this.crearUnidadCombate(msg.objetivoId, "B", objetivoStats.x - gx0, objetivoStats.y - gy0, {
      ...objetivoStats, pasivo: esModoCaza,
    });
    combate.unidades.set(atacanteId, uAtacante);
    combate.unidades.set(msg.objetivoId, uObjetivo);

    // Ventana de unión (docs/GDD_Combate.md §9.1) — NO se resuelve nada
    // todavía: ordenTurnos se queda vacío hasta cerrarVentanaCombate.
    combate.fase = "pendiente";
    combate.cierraEn = Date.now() + VENTANA_UNION_COMBATE_MS;

    const combateId = `combate:${atacanteId}:${Date.now()}`;
    this.state.combates.set(combateId, combate);
    if (esModoCaza) {
      // Sin ventana: cierra ya mismo y sin auto-unión de fauna/enemigos
      // hostiles cercanos (docs/GDD_Caza.md) — caza es estrictamente 1 vs 1.
      this.combatesSinAutoUnion.add(combateId);
      this.cerrarVentanaCombate(combateId);
    } else {
      this.timeoutsVentanaCombate.set(combateId, this.clock.setTimeout(() => this.cerrarVentanaCombate(combateId), VENTANA_UNION_COMBATE_MS));
    }
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
    // Modo caza (docs/GDD_Caza.md) es estrictamente 1 vs 1: se salta entera.
    const sinAutoUnion = this.combatesSinAutoUnion.has(combateId);
    this.combatesSinAutoUnion.delete(combateId);
    if (!sinAutoUnion) {
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
          pasivo: u.pasivo,
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
      // Monturas (docs/GDD_Monturas.md, pedido 2026-08-30): "si entra en
      // combate no aparece la montura, ni el PJ montado" — desmontar ANTES
      // de mandarlo a la arena (nueva conexión de Colyseus, la montura no
      // viaja con él). La mascota reaparece "siguiendo" en esta room.
      this.desmontarSesionId(p.id);
      // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): mismo criterio que
      // una montura animal — "ni el PJ montado" también vale para un barco.
      void this.desembarcarSesionId(p.id);
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
      // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): un pasajero (no
      // capitán) no se mueve con su propio input — su posición la fija el
      // barco entero en la pasada de sincronización, más abajo.
      const enBarco = this.barcosPorSesion.get(sessionId);
      if (enBarco && !enBarco.esCapitan) return;
      const esCapitanBarco = !!enBarco?.esCapitan;
      const barcoPilotado = esCapitanBarco ? this.state.barcos.get(String(enBarco!.barcoId)) : undefined;

      const idx = Math.floor(player.y) * this.mundo.ancho + Math.floor(player.x);
      const medio = medioEn(this.mundo, player.x, player.y);
      const seMueve = dir.x !== 0 || dir.y !== 0;
      // Montura (docs/GDD_Mecanicas.md "Monturas acordado 2026-08-27"):
      // "el input del jugador mueve a la montura" — sustituye ANDAR/CORRER
      // enteros, misma tabla de terreno (`this.mundo.velocidad`), sin sprint
      // ni gasto de estamina (no es el jugador quien corre).
      const montura = this.montadoPorSesion.get(sessionId);
      // Sprint (docs/GDD_Personaje.md §3.4): solo en tierra, solo con
      // estamina de sobra — sin ella, corre igual que andar aunque el
      // cliente siga pidiendo `correr` (no hay penalización dura, solo se
      // pierde la ventaja de velocidad hasta que la estamina se regenere).
      const corriendoDeVerdad = !montura && !esCapitanBarco && medio === TIPO.TIERRA && seMueve && !!dir.correr && player.vitales.estamina > 0;
      let vel: number;
      if (montura) {
        vel = montura.velocidad * (this.mundo.velocidad[idx] ?? 1);
      } else if (esCapitanBarco) {
        // Barco (docs/GDD_Barcos.md): velocidad fija del catálogo, SIN el
        // multiplicador de terreno (ese modifica hierba/barro/camino, no
        // tiene sentido sobre agua) — mismo criterio "no es el jugador quien
        // se mueve" que una montura animal, sin sprint ni estamina.
        vel = barcoPilotado ? this.catalogoBarcos[barcoPilotado.tipoId]?.velocidadBarco ?? 5 : 5;
      } else if (medio === TIPO.AGUA || medio === TIPO.AGUA_PROFUNDA) {
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
        if (esCapitanBarco) {
          // "solo por agua, no puede acceder a otro tipo de suelo" (pedido
          // 2026-08-30): si el destino deja de ser agua, el barco simplemente
          // no se mueve ese tick (nunca "vara" en la orilla a medias).
          const medioDestino = medioEn(this.mundo, destino.x, destino.y);
          if (medioDestino === TIPO.AGUA || medioDestino === TIPO.AGUA_PROFUNDA) {
            player.x = destino.x;
            player.y = destino.y;
          }
        } else {
          player.x = destino.x;
          player.y = destino.y;
        }
      }

      // Resistencia por movimiento (docs/GDD_Personaje.md §3.4, pedido
      // 2026-08-30): tiempo REAL acumulado corriendo/andando en tierra —
      // solo se toca BD al cruzar el umbral, nunca cada tick (30hz sería
      // reventar la BD por nada). Nunca montado: no es el jugador quien se
      // mueve, sería XP de Resistencia gratis a caballo.
      if (!montura && !esCapitanBarco && medio === TIPO.TIERRA && seMueve) {
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
      } else if (montura || esCapitanBarco) {
        // "un caballo no bucea" (docs/GDD_Mecanicas.md) — vadea a nivel
        // superficie, nunca se sumerge; un barco flota, tampoco (docs/GDD_Barcos.md).
        player.nivel = 0;
        player.estado = "nadando";
      } else {
        player.nivel = clamp(player.nivel, nivelMinimo(medioAhora), 0);
        player.estado = player.nivel < 0 ? "buceando" : "nadando";
      }
    });

    const cuerpos = [...this.state.players.values()];
    separarPJs(this.mundo, cuerpos, RADIO_PJ);

    // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): sincroniza el Schema
    // del barco con su capitán y "pega" a los pasajeros a bordo — pasada
    // FINAL, después de separarPJs, para que el barco gane siempre sobre el
    // empuje PJ-PJ (los pasajeros no deben resbalar fuera de la cubierta).
    // También dispara el aviso de mapa vecino al llegar a un borde mar_abierto.
    this.ocupantesDeBarco.forEach((ocupantes, barcoId) => {
      const esquema = this.state.barcos.get(String(barcoId));
      const capitanId = ocupantes[0];
      const capitan = capitanId ? this.state.players.get(capitanId) : undefined;
      if (!esquema || !capitan) return;
      esquema.x = capitan.x;
      esquema.y = capitan.y;
      for (let i = 1; i < ocupantes.length; i++) {
        const pasajero = this.state.players.get(ocupantes[i]);
        if (!pasajero) continue;
        const ang = (i / Math.max(1, ocupantes.length - 1)) * Math.PI * 2;
        pasajero.x = esquema.x + Math.cos(ang) * 0.5;
        pasajero.y = esquema.y + Math.sin(ang) * 0.5;
      }

      if (this.bordesMapa) {
        const dirActual = this.direccionBordeCercana(capitan);
        const borde = dirActual ? this.bordesMapa[dirActual] : undefined;
        const nombreVecino = borde && borde.tipo === "mar_abierto" ? borde.nombre : null;
        const yaAvisado = this.avisoVecinoPorSesion.get(capitanId) ?? null;
        if (nombreVecino && nombreVecino !== yaAvisado) {
          this.avisoVecinoPorSesion.set(capitanId, nombreVecino);
          this.clients.find((c) => c.sessionId === capitanId)?.send("mapa:vecino", { direccion: dirActual, nombre: nombreVecino });
        } else if (!nombreVecino && yaAvisado) {
          this.avisoVecinoPorSesion.delete(capitanId);
        }
      }
    });

    // Vitales (docs/GDD_Personaje.md) — mismo tick que YA existe para
    // movimiento/colisión, TODOS los jugadores conectados (no solo los que
    // tienen input activo: el hambre corre aunque el jugador esté quieto).
    // Integrador simple, sin checkpoint/timestamp — ver server/src/personaje/vitales.ts.
    const horasPorTick = dt / 3600;
    // Temperatura del mundo (docs/GDD_Clima.md): UNA vez por tick, no por
    // jugador — estación/hora son las mismas para todos en este instante.
    const { estacion, hora } = tiempoMundo();
    const tempMundoC = temperaturaMundo(estacion as Estacion, hora);
    this.state.players.forEach((player, sessionId) => {
      tickVitales(player.vitales, horasPorTick);
      const extremo = aplicarTemperaturaCorporal(player.vitales, tempMundoC, horasPorTick);
      this.aplicarInanicionA(player, horasPorTick, extremo !== null);
      // Muerte por inanición (docs/GDD_Muerte_Respawn.md) — mismo criterio
      // "fire and forget" que el resto de efectos async en un tick síncrono.
      if (player.vida <= 0) void this.manejarMuerteJugador(sessionId);
    });

    // Comercio (docs/GDD_Comercio.md): alejarse cancela el trato, mismo
    // criterio que desconectarse a medias — nadie confirma un intercambio
    // con alguien que ya no está al lado.
    for (const [comercioId, comercio] of this.state.comercios.entries()) {
      const a = this.state.players.get(comercio.jugadorA);
      const b = this.state.players.get(comercio.jugadorB);
      if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > RADIO_INTERACCION) {
        this.cerrarComercio(comercioId, "cancelado");
      }
    }
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
