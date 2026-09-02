// Capa de persistencia del juego — GDD_Construccion §2 (el GDD es el contrato).
// Dos motores tras la MISMA interfaz async (IAlmacenDatos): SQLite (node:sqlite,
// integrado en Node 22, cero dependencias) para desarrollo/pruebas, y Postgres
// (Neon, vía `pg`) para producción — Render tiene disco efímero, así que lo
// construido/asignado necesita una base real fuera del proceso.
//
// La interfaz es async EN LOS DOS MOTORES aunque SQLite resuelva al instante
// (DatabaseSync no cede el hilo): así el resto del servidor (HubRoom) hace
// `await this.bd.algo()` sin que le importe cuál está detrás — cambiar de
// motor es cambiar `crearAlmacenDatos()`, nada más (regla GDD §2: "el
// adaptador cambia de motor solo").
//
// Al cargar el módulo con SQLite, Node emite un ExperimentalWarning ("SQLite
// is an experimental feature"): es aceptable y esperado, el API síncrono que
// usamos es estable para SQL básico.

import * as path from "node:path";
import { Pool } from "pg";
import { Contenedor, ItemInstancia, SlotsEquipo, RasgosCultivo } from "../inventario/inventario";
import { ContenedorMuebles } from "../inventario/contenedorMuebles";
import { nombresJarlTalCual } from "../construccion/construccion";

// @types/node del monorepo es v20 y no conoce "node:sqlite" (los tipos llegaron en v22.5),
// así que declaramos a mano lo mínimo que usamos y cargamos con require (estamos en CommonJS).
// Cuando se suba @types/node a 22+, esto se puede sustituir por el import tipado normal.
interface SentenciaSync {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface BaseDatosSync {
  exec(sql: string): void;
  prepare(sql: string): SentenciaSync;
  close(): void;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (ruta: string) => BaseDatosSync;
};

// Economía (docs/GDD_Economia.md, pedido 2026-08-30): saldo inicial al
// crear la fila de un jugador NUEVO por primera vez (nunca reajusta uno
// existente) — "cada player cuando se crea tiene 20 Farycoins", pedido
// explícito del streamer. El comerciante NPC pasa SALDO_INICIAL_NPC_COMERCIANTE
// (500) en su propia llamada, ver `manejarNpcComercio` en RoomExteriorBase.ts.
export const SALDO_INICIAL_JUGADOR = 20;
export const SALDO_INICIAL_NPC_COMERCIANTE = 500;
/** Prefijo de identidad de un comerciante NPC en `jugadores.nombre` — nunca puede chocar con un nombre de jugador real (docs/GDD_Economia.md). */
export const PREFIJO_NPC_COMERCIANTE = "npc:";
/** docs/GDD_Companeros.md (pedido 2026-08-30) — mismo truco que PREFIJO_NPC_COMERCIANTE: una fila sintética en `jugadores` para reusar GRATIS inventario/equipo/vida ya existentes en vez de tablas paralelas. */
export const PREFIJO_NPC_COMPANERO = "companero:";
/** Saldo inicial correcto según de quién sea la fila que se está creando por primera vez. */
export function saldoInicialPara(nombre: string): number {
  if (nombre.startsWith(PREFIJO_NPC_COMERCIANTE)) return SALDO_INICIAL_NPC_COMERCIANTE;
  if (nombre.startsWith(PREFIJO_NPC_COMPANERO)) return 0; // un compañero no compra/vende, no necesita saldo
  return SALDO_INICIAL_JUGADOR;
}
/** Ingreso diario de un NPC comerciante (pedido 2026-08-30: "los npc cada día reciben 20 Farycoins también, así aumentan su dinero") — mismo importe que el saldo inicial de jugador, cálculo perezoso vía `resolverIngresoDiarioNpc`. */
export const INGRESO_DIARIO_NPC = 20;

export interface Jugador {
  id: number;
  nombre: string;
  /** Saldo de Farycoins (pedido 2026-08-29, moneda del mundo) — saldo NUMÉRICO
   * en la fila del jugador, NO un ItemInstancia de inventario.ts: el
   * Contenedor exige huella física por diseño (hayHueco/buscarHueco),
   * modelar dinero como ítem forzaría una excepción al sistema de rejilla.
   * Decisión compartida por los 5 clusters investigados (gremios, mercado,
   * propiedades, producción, motriz) — se implementa UNA vez aquí. */
  farycoins: number;
  // Vida (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): base obligatoria
  // 100/100 en jugadores nuevos, modificable en vivo por equipo/atributos/
  // magia (vidaMax) y por combate/comida/pociones (vida). Sin regeneración
  // automática — solo comida fuera de combate o pociones/magia la suben.
  vida: number;
  vidaMax: number;
  /** docs/GDD_Anatomia.md — JSON de server/src/personaje/anatomia.ts::Anatomia, o null si nunca se tocó (se resuelve a anatomiaInicial() en RoomExteriorBase). */
  anatomia: string | null;
  /** docs/GDD_Enfermedades.md — JSON de server/src/personaje/enfermedades.ts::EstadoEnfermedades, o null si nunca se tocó (se resuelve a enfermedadesInicial() en RoomExteriorBase). */
  enfermedades: string | null;
  /**
   * Oficio de jugador RONDA 2 (docs/GDD_Profesiones.md, pedido 2026-08-30):
   * los 2 slots elegidos con el NPC "maestro de oficios" —
   * `server/src/personaje/oficios.ts` (`OFICIOS_JUGADOR_VALIDOS`,
   * `tieneOficio`). "" = slot vacío. A diferencia de gremioId, SÍ
   * persiste entre sesiones — es una elección deliberada, no estado volátil.
   */
  oficio1: string;
  oficio2: string;
  /**
   * Cuántas veces ha pagado ya por cambiar de oficio (docs/GDD_Profesiones.md
   * ronda 3, pedido 2026-08-30: "primer cambio 50 farycoins, si cambia más
   * veces es exponencial el precio sube") — nunca baja, solo se lee para
   * calcular `precioCambioOficio(cambios)` (server/src/personaje/oficios.ts)
   * ANTES de cobrar, y se incrementa DESPUÉS de cobrar con éxito.
   */
  cambiosOficio: number;
  /**
   * Vitales (docs/GDD_Personaje.md §2, persistencia añadida 2026-09-01,
   * pedido del streamer: "que tenga persistencia... que persista en
   * desconexiones o F5") — hambre/sed/sueño/estamina (0-100), mismo rango
   * que `server/src/personaje/vitales.ts::VITAL_MAX`. Se guardan SOLO al
   * desconectar (`onLeave`), nunca cada tick (decaen a 30hz, guardar en
   * cada tick sería una escritura de BD por jugador cada ~33ms) — mismo
   * criterio de "escritura por evento, no por tick" que el resto del
   * proyecto. NO hay decaimiento retroactivo mientras está desconectado
   * (igual que `vida`: nadie decae/regenera solo con el paso del tiempo).
   */
  comida: number;
  bebida: number;
  sueno: number;
  estamina: number;
}

/**
 * NPC tutorial fijo ya persistido (docs/GDD_Profesiones.md ronda 3, pedido
 * 2026-08-30) — una fila por NPC colocado por un admin/superadmin.
 */
export interface NpcTutorialColocado {
  id: number;
  mapaId: string;
  /** id de `poblacion/catalogo/npcsTutoriales.json` — qué mecánica explica. */
  tipoTutorial: string;
  nombre: string;
  x: number;
  y: number;
  colocadoPor: string;
  colocadoEn: string;
}

/**
 * NPC trabajador contratado (docs/GDD_NPCs_Contratables.md, pedido
 * 2026-09-01): un Npc real, con 1+ oficios, asignado por su dueño a una
 * mesa (`construccionId`) y opcionalmente a una receta que craftea solo
 * (`recetaId`). `fechaContratacionDia`/`ultimoPagoDia` son DÍAS DE MUNDO
 * (`tiempoMundo().dia`), nunca timestamps reales — el salario mensual se
 * resuelve perezosamente comparando estos contra el día actual (ver
 * `server/src/construccion/trabajadores.ts::resolverPayroll`).
 */
export interface NpcTrabajador {
  id: number;
  mapaId: string;
  duenoId: number;
  nombre: string;
  oficios: string[];
  construccionId: number | null;
  recetaId: string | null;
  x: number;
  y: number;
  fechaContratacionDia: number;
  ultimoPagoDia: number;
  /**
   * docs/GDD_Carros.md §12 (Fase 5, pedido 2026-09-03) — mascota PROPIA
   * `montable` asignada para que este trabajador (oficio "transporte") viaje
   * más rápido que a pie. Mutuamente excluyente con `conjuntoAsignadoId`
   * (una montura suelta o un conjunto fusionado, nunca los dos a la vez —
   * son dos formas de la MISMA idea: "qué usa para desplazarse").
   */
  mascotaAsignadaId: number | null;
  /** docs/GDD_Carros.md §12 — conjunto de tiro PROPIO asignado; si su categoria es "materiales" también sustituye `cargaPorViaje` por la capacidad real de su rejilla (§12/§8.2). Mutuamente excluyente con `mascotaAsignadaId`. */
  conjuntoAsignadoId: number | null;
}

export interface NuevoNpcTrabajador {
  mapaId: string;
  duenoId: number;
  nombre: string;
  oficios: string[];
  x: number;
  y: number;
  diaActual: number;
}

/**
 * Cuenta de admin (docs/GDD_Admin.md, pedido 2026-08-30) — identidad
 * SEPARADA de `Jugador` (que es libre/mutable por nombre de PJ): esto es
 * una cuenta real, con contraseña propia y/o un login de Twitch ya
 * vinculado. `mapaId` solo tiene sentido con `rol==="jarl"` (qué mapa
 * administra — "1 jarl por mapa"); `null` para `rol==="superadmin"`
 * (cualquier mapa) o si a un jarl aún no se le ha asignado ninguno.
 */
export type RolAdmin = "jarl" | "superadmin";
export interface CuentaAdmin {
  id: number;
  usuario: string;
  /** "salt:hash" de server/src/admin/passwordHash.ts, o null si solo se loguea por Twitch. */
  passwordHash: string | null;
  /** login de Twitch ya vinculado (docs/GDD_Twitch.md), o null si solo usuario/contraseña. */
  twitchLogin: string | null;
  rol: RolAdmin;
  mapaId: string | null;
  creadoEn: string;
}

// Gremios/clanes (pedido 2026-08-29): banco común (Farycoins), roster de
// miembros, color+emblema de un catálogo cerrado. `id` es un entero
// autoincrementado (mismo criterio que jugadores/construcciones — no un id
// de texto fabricado como las parcelas, que sí vienen del bake/GUI admin).
export type RolGremio = "lider" | "miembro";

export interface Gremio {
  id: number;
  nombre: string;
  liderJugadorId: number;
  color: string;
  emblemaId: string;
  saldoBanco: number;
  creadoEn: string;
}

export interface GremioMiembro {
  gremioId: number;
  jugadorId: number;
  jugadorNombre: string;
  rol: RolGremio;
  ingresoEn: string;
}

export type ResultadoCrearGremio =
  | { ok: true; gremio: Gremio }
  | { ok: false; motivo: "nombre_en_uso" | "ya_tienes_gremio" };

// Propiedades comerciales (pedido 2026-08-29, junto con gremios/mercado/
// producción/motriz): inmuebles enteros (vivienda/tienda) y habitaciones de
// taberna/posada comprables o alquilables con Farycoins — docs/GDD_Propiedades.md.
// Reusa la MISMA tabla `propiedades` que ya modelan las parcelas del jarl
// (mismo `dueno`, mismo "quién es dueño de qué") en vez de una tabla aparte:
// `modoTenencia===null` = asignación de jarl v1 (parcela), sin cambio de
// comportamiento; `"compra"`/`"alquiler"` = tenencia comercial nueva.
export type ModoTenencia = "compra" | "alquiler";

export interface Propiedad {
  tipo: string;
  asentamiento: string;
  dueno: string | null; // resuelto a NOMBRE (identidad v1) — NULL = del jarl/asentamiento (o libre, si es comercial)
  modoTenencia: ModoTenencia | null;
  precioFarycoins: number | null;
  periodoHoras: number | null;
  expiraEn: string | null; // ISO, horas REALES (Date.now()) — NULL si es compra o si nunca fue tenencia comercial
  // Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30: "es una
  // decisión que toma el jarl, puede ponerlo o no y poner qué cantidad y
  // cada cuánto tiempo") — independiente de modoTenencia, aplica igual a
  // parcelas asignadas por el jarl que a inmuebles/habitaciones comerciales.
  impuestoActivo: boolean;
  impuestoFarycoins: number | null; // cantidad cobrada por periodo
  impuestoPeriodoHoras: number | null; // cada cuántas horas REALES se cobra
  impuestoUltimoCobro: string | null; // ISO — ancla del próximo cobro, arranca en AHORA al activar (nunca retroactivo)
}

// Mercado (pedido 2026-08-29, docs/GDD_Mercado.md): un tenderete NO es una
// entidad propia — vive SOBRE una propiedad que el jugador YA posee (una
// parcela asignada por el jarl, o un inmueble comprado/alquilado vía
// GDD_Propiedades.md). `tenderete_items` es solo la lista de venta de esa
// propiedad; la fila NUNCA se borra al agotarse (cantidad:0 = "agotado",
// visible pero no comprable) — evita el patrón "borrar antes de confirmar"
// que ya causó un bug real en cogerSoltar.ts.
export interface ItemEnVentaTenderete {
  itemId: string;
  cantidad: number;
  precioFarycoins: number;
}

// Transporte (docs/GDD_Produccion.md, pedido 2026-08-29): contrato entre
// una construcción productora y un tenderete destino. `caminoIda`/
// `caminoVuelta` son Punto[] calculados UNA VEZ al firmar (nunca en vivo
// después) — el paseo visual del NPC transportista los recorre en bucle
// (server/src/mundo/agentes.ts), pero el resultado ECONÓMICO se resuelve
// perezoso por comparación de timestamps (ultimoViajeResuelto), 100%
// independiente de si el agente visual ha "llegado" de verdad.
export interface ContratoTransporte {
  id: number;
  origenConstruccionId: number;
  destinoTenderoteId: string;
  dueno: number;
  itemId: string;
  caminoIda: { x: number; y: number }[];
  caminoVuelta: { x: number; y: number }[];
  duracionViajeSeg: number;
  cargaPorViaje: number;
  ultimoViajeResuelto: string;
  activo: boolean;
  /** NPC trabajador (npcs_trabajadores.id, oficio "transporte") que opera esta ruta — NULL en contratos antiguos previos a la fusión (docs/GDD_NPCs_Contratables.md §Fusión con transporte). Tablas separadas, enlazadas por id (mínima fricción con toda la maquinaria de resolución perezosa ya existente). */
  trabajadorId: number | null;
}

export interface NuevoContratoTransporte {
  origenConstruccionId: number;
  destinoTenderoteId: string;
  dueno: number;
  itemId: string;
  caminoIda: { x: number; y: number }[];
  caminoVuelta: { x: number; y: number }[];
  duracionViajeSeg: number;
  cargaPorViaje: number;
  trabajadorId: number | null;
}

export interface Construccion {
  id: number;
  propiedad: string;
  objeto: string;
  categoria: string;
  x: number;
  y: number;
  rot: number;
  variante: number;
  extra: Record<string, unknown> | null; // JSON parseado (interior generado, estado futuro)
}

export interface NuevaConstruccion {
  propiedad: string;
  objeto: string;
  categoria: string;
  x: number;
  y: number;
  rot: number;
  variante: number;
  extra?: Record<string, unknown> | null;
}

// Facción bandida (docs/GDD_Faccion_Bandidos.md) — enganchada a los
// asentamientos "asentamiento_hostil" que ya bakea el sistema de mazmorras
// (mismo id/slug de POI, ver mazmorras/catalogo/tipos_dungeon.json). `bando`
// se deja abierto ("bandido" hoy) para una futura progresión de
// asentamientos neutrales por donaciones/misiones — GDD §4, fuera de
// alcance de esta fase.
export interface Asentamiento {
  id: string;
  bando: string;
  nivelMuralla: number; // 1 = empalizada, 2 = muralla_piedra (los 2 materiales reales que ya existen)
  nivelEquipo: number; // 1 = garrote/túnica, 2 = cota/espada, 3 = placas/hacha
  comida: number;
  madera: number;
  piedra: number;
  hierro: number;
}

export type RangoTropa = "recluta" | "guardia" | "lider";
export type EstadoTropa = "vivo" | "muerto";

export interface Tropa {
  id: string;
  asentamientoId: string;
  rango: RangoTropa;
  estado: EstadoTropa;
}

// Reproducción de fauna salvaje (docs/GDD_Agentes_Moviles.md, pedido
// 2026-08-30): un individuo por fila, agrupado por sector (mismo
// TAMANO_SECTOR_CHUNKS que usa el bakeador para exportar el mapa) — la
// integración en vivo carga/guarda SOLO el sector que se activa, nunca
// todo el mapa de golpe. `estado` nunca vuelve de 'muerto' a 'vivo',
// mismo criterio que tropas_asentamiento. Los timestamps (`ultimaComida`,
// `ultimaBebida`, `gestandoDesde`) son "día de mundo" fraccional
// (día entero + hora/24, ver tiempoMundo()/diaFraccional en
// reproduccionFauna.ts) — nunca un contador que corra solo.
export type SexoFauna = "macho" | "hembra";
export type EtapaFauna = "cria" | "adulto";
export type EstadoFaunaSalvaje = "vivo" | "muerto";

export interface FaunaSalvajeFila {
  id: string;
  mapaId: string;
  sectorX: number;
  sectorY: number;
  especieId: string;
  sexo: SexoFauna;
  etapa: EtapaFauna;
  estado: EstadoFaunaSalvaje;
  x: number;
  y: number;
  ultimaComida: number;
  ultimaBebida: number;
  gestandoDesde: number | null;
  gestacionDuracionDias: number | null;
  /** día de mundo en que nació (para saber cuándo madura de cría a adulto); null en la población base del bake, que ya nace adulta. */
  nacioEn: number | null;
  // Vida/ataque (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): los
  // animales NO tienen defensa, solo vida — se acarrean tal cual entre
  // resoluciones de sector para que el daño sufrido sobreviva a
  // desactivar/reactivar (nunca se regeneran solos).
  vida: number;
  vidaMax: number;
  ataque: number;
}

// Huevo puesto en el mundo (especies ovíparas, ver intentarAparearse en
// reproduccionFauna.ts) — objeto aparte de la madre, que queda libre al
// instante; el huevo eclosiona por su cuenta al consultarse pasada su
// `duracionDias` desde `puestoEn`.
export interface FaunaHuevoFila {
  id: string;
  mapaId: string;
  sectorX: number;
  sectorY: number;
  especieMadreId: string;
  x: number;
  y: number;
  puestoEn: number;
  duracionDias: number;
}

// Crecimiento de bosques (docs/GDD_Bosques.md, pedido 2026-08-30) — mismo
// criterio por sector que FaunaSalvajeFila, con una diferencia real: un
// árbol de origen "bake" que nadie ha tocado NUNCA se persiste aquí (se
// re-deriva del propio bake en cada resolución, ver bosqueSector.ts) —
// solo aparecen los talados (origen:"bake", estado:"talado") y los
// nacidos en el sistema (origen:"propagacion"|"plantado").
export type EtapaArbol = "joven" | "adulto";
export type OrigenArbol = "bake" | "propagacion" | "plantado";
export type EstadoArbol = "vivo" | "talado";

export interface ArbolVivoFila {
  id: string;
  mapaId: string;
  sectorX: number;
  sectorY: number;
  especieId: string;
  x: number;
  y: number;
  etapa: EtapaArbol;
  origen: OrigenArbol;
  /** día de mundo en que nació/se plantó; null en `origen:"bake"` (ya nace adulto, nunca "creció" en el sistema). */
  diaPlantado: number | null;
  estado: EstadoArbol;
}

// Cadáveres (docs/GDD_Agentes_Moviles.md, pedido 2026-08-30): al morir
// un animal/NPC/jugador, deja de contar como esa entidad viva y aparece
// esta fila — un cadáver lootable con SU PROPIO contenedor (reusa
// Contenedor de inventario.ts tal cual, mismo tamaño para cualquier
// origen). No va por sector como fauna_salvaje/fauna_huevo: las muertes
// son mucho menos frecuentes que la población base, así que basta con
// filtrar por mapa entero al listar.
export type TipoOrigenCadaver = "animal" | "npc" | "jugador";

export interface CadaverFila {
  id: string;
  mapaId: string;
  tipoOrigen: TipoOrigenCadaver;
  especieOrigenId: string;
  x: number;
  y: number;
  muertoEn: number;
  contenedor: Contenedor;
  /** JSON de `DatosVisualCadaver` (mundo/cadaveres.ts) — "" (u omitido) si no aplica (fauna). */
  datosVisual?: string;
}

// Ganadería (docs/GDD_Ganaderia.md, pedido 2026-08-30): un animal de granja
// vivo, propiedad de un jugador — nace al domesticar en el exterior o
// comprar por tenderete, vive en la propiedad destino, y muere/desaparece
// al sacrificarlo o escaparse. `extra` (mismo patrón JSON que
// construcciones.extra) guarda el acumulador de producción POR PRODUCTO
// (leche/lana/huevos, `resolverProduccion` reusado tal cual) y el último
// día de mundo en que se resolvió el chequeo de escape. `enVenta*` es
// NULL salvo mientras está listado en un tenderete (docs/GDD_Mercado.md).
export interface AnimalGranjaFila {
  id: string;
  especieId: string;
  mapaId: string;
  propiedadId: string;
  x: number;
  y: number;
  extra: Record<string, unknown>;
  enVentaTenderoteId: string | null;
  enVentaPrecio: number | null;
  creadoEn: string;
}

// Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30): un animal urbano
// domesticable (perro/gato) se convierte en mascota tras 5 veces de darle
// de comer — server/src/rooms/base/RoomExteriorBase.ts es el mecanismo en
// vivo, esto solo persiste "quién tiene qué" para que sobreviva a
// desconexiones y cambios de room. Sin acción propia todavía (solo sigue o
// se queda en una propiedad) — ver GDD.
export type UbicacionMascota = "siguiendo" | "propiedad";

export interface Mascota {
  id: number;
  jugadorId: number;
  especieId: string;
  ubicacion: UbicacionMascota;
  /** id de la propiedad donde se dejó (docs/GDD_Propiedades.md) — solo con ubicacion==="propiedad". */
  propiedadId: string | null;
  creadoEn: string;
  /** docs/GDD_Monturas.md (pedido 2026-08-30) — true tras usar un ítem `esMontura` sobre ella (mascota:ponerMontura); solo entonces se puede `mascota:montar`. Permanente, nunca se quita. */
  montura: boolean;
  /** docs/GDD_Carros.md §2 (pedido 2026-09-03) — true tras usar un ítem `esApero` sobre ella (mascota:ponerArnes); solo entonces se puede `carro:enganchar`. Ranura independiente de `montura` (un animal puede llevar silla Y arnés a la vez). Permanente, nunca se quita. */
  arnes: boolean;
  /** docs/GDD_Carros.md §3 — SOLO con arnes:true: `pesoMaximoArnes` del ítem `esApero` consumido (catalogo/items.json), qué carro máximo puede tirar. 0 con arnes:false. */
  arnesPesoMaximo: number;
}

/**
 * Compañero NPC reclutado (docs/GDD_Companeros.md, pedido 2026-08-30) — un
 * Npc real de `poblacion/` que dejó de ser ambiental y ahora sigue a un
 * jugador. `companeroJugadorId` es la fila SINTÉTICA en `jugadores` (nombre
 * `PREFIJO_NPC_COMPANERO + npcOrigenSlot`, mismo truco que un comerciante
 * NPC) que reusa GRATIS inventario/equipo/vida ya existentes — esta fila
 * `companeros` solo guarda la relación de propiedad + progresión + de qué
 * Npc salió (para repintar el mismo aspecto/vox).
 */
export interface Companero {
  id: number;
  jugadorId: number;
  companeroJugadorId: number;
  npcOrigenSlot: string;
  nombre: string;
  xp: number;
  ubicacion: UbicacionMascota;
  propiedadId: string | null;
  creadoEn: string;
}

/**
 * Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): crafteado en el astillero,
 * "colocado" junto al agua (barco:colocar, consume el ítem) — a partir de
 * ahí vive anclado en el mundo, NUNCA en el inventario. `mapaId` es la
 * carpeta bajo assets/mapas/ que lo ancla (qué HubRoom lo carga en
 * onCreate); cruzar a un mapa vecino por un borde `mar_abierto` actualiza
 * `mapaId`+x,y al spawn del mapa destino (mismo registro, no se recrea).
 * Sin dueño real de "quién puede subir" — cualquiera puede embarcar si hay
 * hueco (ver RoomExteriorBase.ts:manejarBarcoMontar), jugadorId es solo
 * quién lo crafteó/colocó.
 */
export interface Barco {
  id: number;
  jugadorId: number;
  tipoId: string;
  mapaId: string;
  x: number;
  y: number;
  creadoEn: string;
}

/**
 * Carro aparcado, SIN enganchar (docs/GDD_Carros.md §3, pedido 2026-09-03):
 * mismo contrato exacto que Barco — `carro:colocar` lo crea junto al
 * jugador, `mapaId` es la carpeta bajo assets/mapas/ que lo ancla. Sin dueño
 * real de "quién puede engancharlo" (mismo criterio "cualquiera" que un
 * barco varado, GDD_Carros §3) — `jugadorId` es solo quién lo crafteó/colocó.
 * Deja de existir en cuanto se engancha (pasa a ConjuntoTiro).
 */
/**
 * docs/GDD_Carros.md §5/§8 (Fase 2, pedido 2026-09-03): lo que lleva CARGADO
 * un carro/conjunto según la `categoria` de su catálogo (`catalogoCarros.ts`)
 * — como mucho UNA de las 4 claves tiene sentido a la vez (la que
 * corresponda a esa categoría), el resto quedan `undefined`. Serializado tal
 * cual a JSON en la columna `contenido` de `carros`/`conjuntos_tiro` (mismo
 * criterio "un blob TEXT, JSON.stringify/parse a mano" que `construcciones.extra`).
 * Sobrevive a enganchar/desenganchar: la carga es del CARRO, no del animal.
 */
export interface ContenidoCarro {
  /** categoria "materiales" — rejilla Tetris grande. */
  carga?: Contenedor;
  /** categoria "muebles" — capacidad por tamaño, no rejilla (docs/GDD_Carros.md §8.3). */
  muebles?: ContenedorMuebles;
  /** categoria "animales" — ids de mascotas propias enjauladas (docs/GDD_Carros.md §8.4). */
  jaula?: number[];
  /** categoria "liquidos" — cisterna (docs/GDD_Carros.md §8.5). */
  liquido?: { tipo: string; volumenMl: number; volumenMaxMl: number };
}

export interface Carro {
  id: number;
  jugadorId: number;
  tipoId: string;
  mapaId: string;
  x: number;
  y: number;
  creadoEn: string;
  contenido: ContenidoCarro | null;
}

/**
 * Animal+carro fusionados (docs/GDD_Carros.md §5, pedido 2026-09-03) —
 * `carro:enganchar` la crea (consume la fila `mascotas` de `mascotaId` sin
 * borrarla, y la fila `Carro` de origen SÍ se borra), `carro:desenganchar`
 * la borra de vuelta (recrea un `Carro` aparcado + reactiva la mascota como
 * "siguiendo"). Ancla en el mundo igual que un barco — sobrevive aparcada
 * sin conductor a un reinicio de room (HubRoom la rehidrata en onCreate).
 */
export interface ConjuntoTiro {
  id: number;
  jugadorId: number;
  mascotaId: number;
  /** denormalizado desde la mascota fusionada (personajes/catalogo/animales_rig.json) — evita un segundo cruce contra `mascotas` solo para saber qué renderizar al rehidratar en onCreate, mismo criterio que Barco.tipoId. */
  especieAnimalId: string;
  carroTipoId: string;
  mapaId: string;
  x: number;
  y: number;
  creadoEn: string;
  contenido: ContenidoCarro | null;
}

/**
 * Casilla de cultivo a CAMPO ABIERTO (docs/GDD_Carros.md §9.1, Fase 3,
 * pedido 2026-09-03) — agricultura DIRECTA sobre suelo abierto, en paralelo
 * a la de construcción (`bancal_cultivo`, sin tocar). A diferencia de un
 * recolectable silvestre (mundo/recolectables.ts, sin BD, cálculo
 * perezoso), una casilla labrada/sembrada SÍ se persiste — un jugador no
 * puede perder días de trabajo si la room se reinicia. `idxCasilla` es
 * `Math.floor(y) * anchoMapa + Math.floor(x)` (misma convención de índice
 * global que el resto del proyecto).
 */
export interface CasillaCultivo {
  mapaId: string;
  idxCasilla: number;
  x: number;
  y: number;
  duenoId: number;
  estado: "labrada" | "sembrada";
  semillaId: string | null;
  /** tiempoMundo().dia en que se plantó — solo con estado "sembrada". */
  diaPlantado: number | null;
}

/**
 * Especie híbrida creada por injerto (docs/GDD_Agricultura.md §4, diseño
 * ya cerrado en Backlog_Mecanicas_Futuras.md) — permanente, sobrevive a un
 * reinicio del servidor. `semillaId`/`cosechaId` son los itemId sintéticos
 * (nunca en items.json en disco) que cada room funde en su copia en
 * memoria de `catalogoItems` al arrancar.
 */
export interface CultivoHibrido {
  semillaId: string;
  cosechaId: string;
  nombre: string;
  padreA: string;
  padreB: string;
  rasgos: RasgosCultivo;
  diasCrecimiento: number;
  mesesSiembra: number[];
  cosechaRecurrente: boolean;
  cantidadPorCosecha: number;
  colorDebug: string;
  creadoEn: string;
}

/**
 * Plato cocinado en una vasija (docs/GDD_Cocina.md, pedido 2026-08-30) —
 * permanente, identificado por `clave` (conjunto de tipos de ingrediente,
 * ver `cocina/cocina.ts::clavePlato`). `itemId` es el id sintético que
 * cada room funde en su copia en memoria de `catalogoItems`.
 */
export interface PlatoCreado {
  clave: string;
  itemId: string;
  nombre: string;
  ingredientes: string[];
  vida: number;
  estamina: number;
  comida: number;
  bebida: number;
  colorDebug: string;
  creadoEn: string;
}

/**
 * Prenda legendaria bakeada por un sastre (docs/GDD_Ropa_Procedural.md
 * §Sastre legendario, pedido 2026-08-31: "1 vez al día... una prenda de
 * ropa nueva pero bakeada en ese momento, no placeholder") — a diferencia
 * de `PlatoCreado` (que se DEDUPLICA por clave de ingredientes, "misma
 * receta = mismo plato siempre"), aquí CADA generación es su propio
 * blueprint aunque el texto sea idéntico: dos sastres distintos con el
 * mismo prompt no deben compartir diseño (solo el creador puede recraftear
 * el suyo — pedido explícito), así que la identidad es un id autoincremental,
 * nunca una clave derivada del contenido.
 */
export interface PrendaGenerada {
  id: number;
  /** jugadores.id del sastre que la creó — SOLO él puede craftear copias después (pedido explícito). */
  creadorId: number;
  /** id real de ropa/catalogo/prendas.json (el arquetipo base que resolvió interpretarPromptTejido). */
  prendaBaseId: string;
  materialId: string;
  /** override de `detalle` sobre el arquetipo base — mismo campo que ya acepta generarPrenda()/generarPrendaVoxel() vía detalleOverride. */
  detalle: Record<string, unknown>;
  /** tintes por zona (zonasColor del arquetipo) — vacío = usa el color de material sin tintar. */
  tintes: Record<string, string>;
  nombre: string;
  /** el texto original que el jugador escribió — para mostrarlo en "mis diseños" y depurar interpretaciones raras. */
  promptTexto: string;
  creadoEn: string;
}

/**
 * Mueble legendario bakeado por un carpintero (docs/GDD_Ropa_Procedural.md
 * §Carpintero legendario) — MISMO patrón exacto que `PrendaGenerada`: id
 * autoincremental (nunca deduplicado por contenido), solo el creador puede
 * craftear copias.
 */
export interface MuebleGenerado {
  id: number;
  creadorId: number;
  /** id real de interiores/catalogo/elementos.json (silla/mesa_comedor/cama_individual/arcon) que dobla como itemId. */
  arquetipoId: string;
  /** parámetros resueltos por interpretarPromptMueble (madera/colorAcento/modificadores) — JSON. */
  parametros: Record<string, unknown>;
  nombre: string;
  promptTexto: string;
  creadoEn: string;
}

/**
 * Edificio legendario proyectado por un ingeniero (docs/GDD_Ropa_Procedural.md
 * §Ingeniero legendario) — MISMO patrón. A diferencia de la ropa/muebles,
 * hoy NO se coloca en el mundo (pendiente documentado): el blueprint queda
 * persistente y listable, sin ítem físico ni construcción real todavía.
 */
export interface EdificioGenerado {
  id: number;
  creadorId: number;
  /** id real de interiores/catalogo/tipos_edificio.json (casa_humilde/casa_noble/tienda/taberna). */
  tipoEdificio: string;
  /** parámetros resueltos por interpretarPromptEdificio (material/forma/techo/balcón/porche...) — JSON. */
  parametros: Record<string, unknown>;
  nombre: string;
  promptTexto: string;
  creadoEn: string;
}

/**
 * Libro escrito por un jugador (docs/GDD_Libreria.md, pedido 2026-09-01) —
 * MISMO patrón que MuebleGenerado/PrendaGenerada/EdificioGenerado: id
 * autoincremental, enlazado desde una instancia de `libro_en_blanco_jugador`
 * por `libroGeneradoId` (inventario.ts). A diferencia de los otros tres, SÍ
 * se puede reescribir por su propio autor (`actualizarLibroGenerado`) — un
 * libro no es un blueprint para craftear copias, es contenido de un único
 * objeto físico que su dueño puede seguir editando.
 */
export interface LibroGenerado {
  id: number;
  autorId: number;
  titulo: string;
  /** una página por entrada — se lee con clic izquierda/derecha en el visor del cliente. */
  paginas: string[];
  creadoEn: string;
}

// Un único líder bandido supremo (GDD §1): memoria GLOBAL, no por
// asentamiento — el registro de eventos que alimenta su contexto de IA.
// tipo/asentamientoId/jugador (docs/GDD_Faccion_Bandidos.md §7quinquies,
// pedido 2026-08-30 "que la historia del servidor, nombres de jugadores y
// hazañas se recuerden") son opcionales: NULL en eventos viejos o sin un
// asentamiento/jugador concreto atribuible — `evento` sigue siendo la
// narración en texto, la fuente de verdad para mostrarla tal cual.
export interface MemoriaLider {
  id: number;
  diaIngame: number;
  evento: string;
  tipo?: "tropa_muerta" | "asentamiento_conquistado" | null;
  asentamientoId?: string | null;
  jugador?: string | null;
}

/**
 * Contrato único de persistencia — GDD_Construccion §2. Ambos motores lo
 * implementan tal cual; HubRoom solo conoce esta interfaz, nunca la clase
 * concreta (así el motor real es un detalle de `crearAlmacenDatos`).
 */
export interface IAlmacenDatos {
  /** `saldoInicial` (docs/GDD_Economia.md, pedido 2026-08-30) SOLO se aplica si la fila no existía — 20 por defecto (jugador nuevo); un comerciante NPC ("npc:<id>") pasa 500. Nunca reajusta el saldo de una fila ya existente. */
  obtenerOCrearJugador(nombre: string, saldoInicial?: number): Promise<Jugador>;
  /** Vida/vidaMax tras combate/comida/pociones (docs/GDD_Mecanicas.md §5.4) — sin regeneración automática, solo se llama en un evento explícito. */
  actualizarVidaJugador(jugadorId: number, vida: number, vidaMax: number): Promise<void>;
  /** Vitales (hambre/sed/sueño/estamina) — SOLO se llama al desconectar (`onLeave`), nunca cada tick. Ver el comentario de `Jugador.comida` para el porqué. */
  actualizarVitalesJugador(jugadorId: number, comida: number, bebida: number, sueno: number, estamina: number): Promise<void>;
  /** docs/GDD_Anatomia.md — JSON de Anatomia; misma cadencia que actualizarVidaJugador (tras un golpe con efecto anatómico o una acción médica), no cada tick. */
  actualizarAnatomiaJugador(jugadorId: number, anatomiaJson: string): Promise<void>;
  /** docs/GDD_Enfermedades.md — JSON de EstadoEnfermedades; misma cadencia que actualizarAnatomiaJugador (inicio/cura de catarro o gripe), no cada tick. */
  actualizarEnfermedadesJugador(jugadorId: number, enfermedadesJson: string): Promise<void>;

  // --- Cuentas de admin (docs/GDD_Admin.md, pedido 2026-08-30) ---
  crearCuentaAdmin(datos: { usuario: string; passwordHash: string | null; twitchLogin: string | null; rol: RolAdmin; mapaId: string | null }): Promise<CuentaAdmin>;
  obtenerCuentaAdminPorUsuario(usuario: string): Promise<CuentaAdmin | null>;
  obtenerCuentaAdminPorTwitchLogin(twitchLogin: string): Promise<CuentaAdmin | null>;
  listarCuentasAdmin(): Promise<CuentaAdmin[]>;
  actualizarPasswordAdmin(id: number, passwordHash: string): Promise<void>;
  /** "1 jarl por mapa": asigna `usuario` como jarl de `mapaId`, y de paso le QUITA ese mapa a quien lo tuviera antes (si era otro). No toca cuentas superadmin. */
  asignarJarlDeMapa(mapaId: string, usuario: string): Promise<{ ok: boolean; motivo?: string }>;

  // --- NPCs tutoriales fijos (docs/GDD_Profesiones.md ronda 3, pedido 2026-08-30) ---
  /** Coloca un NPC tutorial en la posición actual del admin — `tipoTutorial` debe ser un id real de `poblacion/catalogo/npcsTutoriales.json` (no se valida aquí, lo valida quien llama). */
  colocarNpcTutorial(datos: { mapaId: string; tipoTutorial: string; nombre: string; x: number; y: number; colocadoPor: string }): Promise<NpcTutorialColocado>;
  /** Todos los NPCs tutoriales persistidos de un mapa — para recrearlos al arrancar la room (mismo criterio que poblacion.json/npcsFijos.json). */
  listarNpcsTutorialesDeMapa(mapaId: string): Promise<NpcTutorialColocado[]>;
  /** `true` si de verdad había una fila con ese id (para que el admin sepa si el id ya no existía). */
  quitarNpcTutorial(id: number): Promise<boolean>;

  // --- NPCs trabajadores contratables (docs/GDD_NPCs_Contratables.md, pedido 2026-09-01) ---
  /** Alta: nace en la posición del reclutador, sin mesa ni receta (el jugador las asigna después). */
  contratarNpcTrabajador(datos: NuevoNpcTrabajador): Promise<NpcTrabajador>;
  /** Todos los trabajadores (de cualquier dueño) persistidos de un mapa — para recrearlos al arrancar la room. */
  listarNpcsTrabajadoresDeMapa(mapaId: string): Promise<NpcTrabajador[]>;
  /** Los trabajadores de UN jugador — para el panel del reclutador y para resolver el pago mensual en bloque. */
  listarNpcsTrabajadoresDeJugador(duenoId: number): Promise<NpcTrabajador[]>;
  /** `false` si `construccionId` ya no existe como fila — validado por quien llama, no aquí (esta capa no conoce ConstruccionViva). */
  asignarMesaNpcTrabajador(id: number, construccionId: number, x: number, y: number): Promise<boolean>;
  asignarRecetaNpcTrabajador(id: number, recetaId: string | null): Promise<boolean>;
  /** docs/GDD_Carros.md §12 (Fase 5) — mismo patrón que asignarMesaNpcTrabajador: pasar `null` en ambos quita la asignación (vuelve a andar a pie). Mutuamente excluyentes, quien llama decide cuál de los dos va con valor. */
  asignarMonturaNpcTrabajador(id: number, mascotaAsignadaId: number | null, conjuntoAsignadoId: number | null): Promise<boolean>;
  /** Pone `ultimoPagoDia = dia` a la vez para varios trabajadores — el pago mensual se cobra "de golpe" a todo el grupo (docs/GDD_NPCs_Contratables.md). */
  marcarPagoNpcTrabajador(ids: number[], dia: number): Promise<void>;
  /** Despido/eliminación (a mano por el dueño, o automático por impago) — `false` si el id ya no existía. */
  despedirNpcTrabajador(id: number): Promise<boolean>;

  obtenerFarycoins(jugadorId: number): Promise<number>;
  /** Suma (delta>0) o resta (delta<0) Farycoins de un jugador, TODO O NADA:
   * si restar dejaría el saldo negativo, no toca nada y `ok:false` — mismo
   * patrón compare-and-swap por WHERE que el resto de mutaciones económicas
   * del proyecto (una sola fila, no hace falta una transacción explícita).
   * Primitiva única reusada por gremios (depositar/retirar del banco),
   * mercado (pagar/cobrar) y propiedades (comprar/alquilar) — se decide UNA
   * vez, no en cada sistema por separado. */
  ajustarFarycoins(jugadorId: number, delta: number): Promise<{ ok: boolean; saldo: number }>;
  /** docs/GDD_Crafteo.md §6: XP de oficio (nivel se DERIVA de esto, nunca se persiste el nivel en sí). */
  obtenerXpOficio(jugadorId: number, oficio: string): Promise<number>;
  /** Suma (nunca resta) XP a un oficio — crea la fila si no existía. Devuelve el nuevo total. */
  sumarXpOficio(jugadorId: number, oficio: string, delta: number): Promise<number>;
  /** Pone a 0 la XP de un oficio (docs/GDD_Profesiones.md ronda 2: cambiar un slot ya ocupado "reinicia de cero" el oficio que se quita) — no borra la fila, solo la XP. */
  reiniciarXpOficio(jugadorId: number, oficio: string): Promise<void>;
  /** Slots de oficio elegidos por el jugador (0 = ninguno actualizado, "" en el campo si vacío). Elegir un slot vacío no cuesta nada; RoomExteriorBase cobra el precio y reinicia la XP ANTES de llamar a esto cuando el slot ya estaba ocupado. */
  fijarOficioSlot(jugadorId: number, slot: 1 | 2, oficio: string): Promise<void>;
  /** Suma 1 a `jugadores.cambios_oficio` y devuelve el nuevo total — se llama DESPUÉS de cobrar con éxito un `oficio:cambiar` (precio exponencial, ver `Jugador.cambiosOficio`). */
  incrementarCambiosOficio(jugadorId: number): Promise<number>;
  /** docs/GDD_Personaje.md: XP de atributo — mismo mecanismo EXACTO que oficios (nivel derivado en server/src/progresion/nivel.ts, nunca persistido en sí). */
  obtenerXpAtributo(jugadorId: number, atributo: string): Promise<number>;
  /** Suma (nunca resta) XP a un atributo — crea la fila si no existía. Devuelve el nuevo total. */
  sumarXpAtributo(jugadorId: number, atributo: string, delta: number): Promise<number>;
  /** docs/GDD_Personaje.md §3.5: día de mundo (tiempoMundo().dia) de la última actividad diaria de entrenamiento que otorgó XP de este atributo — null si nunca. */
  obtenerUltimoDiaActividadAtributo(jugadorId: number, atributo: string): Promise<number | null>;
  /** Marca hoy (día de mundo `dia`) como ya usado para la actividad diaria de este atributo — crea la fila si no existía. */
  marcarActividadAtributoHoy(jugadorId: number, atributo: string, dia: number): Promise<void>;
  // Gremios (pedido 2026-08-29) — un jugador pertenece a UN gremio como
  // mucho (UNIQUE en gremio_miembros.jugador_id, defensa en profundidad
  // además del chequeo en memoria de ContextoGremios antes de escribir).
  crearGremio(nombre: string, liderJugadorId: number, color: string, emblemaId: string): Promise<ResultadoCrearGremio>;
  listarGremios(): Promise<Gremio[]>;
  obtenerGremio(id: number): Promise<Gremio | null>;
  listarMiembros(gremioId: number): Promise<GremioMiembro[]>;
  agregarMiembro(gremioId: number, jugadorId: number, rol: RolGremio): Promise<void>;
  quitarMiembro(gremioId: number, jugadorId: number): Promise<void>;
  actualizarGremio(id: number, cambios: { color?: string; emblemaId?: string }): Promise<void>;
  /** Refunda saldo_banco íntegro a saldo_farycoins del líder (vía ajustarFarycoins) y borra gremio+miembros+invitaciones. */
  disolverGremio(id: number): Promise<void>;
  crearInvitacion(gremioId: number, jugadorId: number, invitadoPorId: number): Promise<void>;
  obtenerInvitacion(gremioId: number, jugadorId: number): Promise<{ invitadoPorId: number } | null>;
  eliminarInvitacion(gremioId: number, jugadorId: number): Promise<void>;
  /** Mismo primitivo compare-and-swap que ajustarFarycoins, pero sobre gremios.saldo_banco. */
  ajustarBancoGremio(gremioId: number, delta: number): Promise<{ ok: boolean; saldo: number }>;
  // Inventario compartido de gremio (docs/GDD_Gremios.md §7, pedido
  // 2026-08-30) — mismo contrato/shape que guardarContenedor/cargarContenedor
  // de jugador, pero UNA sola fila por gremio (sin contenedor_id): un
  // almacén compartido, no cuerpo+mochilas.
  guardarInventarioGremio(gremioId: number, contenedor: Contenedor): Promise<void>;
  /** `null` si el gremio nunca tuvo inventario tocado — quien llame crea uno con `crearContenedor()` por defecto. */
  cargarInventarioGremio(gremioId: number): Promise<Contenedor | null>;
  cargarPropiedades(): Promise<Map<string, Propiedad>>;
  /** Panel "todo lo que tienes" (docs/GDD_Resumen_Jugador.md, pedido 2026-08-31): TODAS las propiedades (parcela/inmueble/habitacion/plantilla) cuyo dueño es este jugador exacto — mismo shape que `cargarPropiedades`, ya filtrado en SQL en vez de traer la tabla entera y filtrar en memoria. */
  listarPropiedadesDeJugador(nombre: string): Promise<Array<Propiedad & { id: string }>>;
  asignarPropiedad(id: string, tipo: string, asentamiento: string, duenoNombre: string | null): Promise<void>;
  /** Libera dueño Y cualquier tenencia comercial (modo/precio/periodo/expira) — el jarl revoca cualquier propiedad, compra o alquiler (docs/GDD_Propiedades.md). */
  revocarPropiedad(id: string): Promise<void>;
  // Propiedades comerciales (docs/GDD_Propiedades.md) — point-query, NUNCA
  // cacheadas en memoria de room (a diferencia de ContextoConstruccion): el
  // volumen por asentamiento es pequeño (decenas) y esto GARANTIZA que la
  // expiración de un alquiler se re-evalúa en cada toque real, sin caché que
  // pueda quedarse desfasada mientras la room sigue viva.
  /** Point-query — resuelve la expiración perezosa (alquiler vencido → libera la fila) Y el impuesto del jarl pendiente (§ abajo) ANTES de devolver. `null` = nunca se tocó (disponible, libre). */
  obtenerPropiedad(id: string): Promise<(Propiedad & { id: string }) | null>;
  /** Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30) — activa/desactiva y fija cantidad/cadencia de una propiedad concreta. Resetea el reloj de cobro a AHORA al activar (nunca retroactivo). El cobro EN SÍ se resuelve perezosamente dentro de `obtenerPropiedad`, no aquí. */
  configurarImpuestoPropiedad(id: string, activo: boolean, farycoins: number | null, periodoHoras: number | null): Promise<void>;
  /** Todo o nada: cobra el precio, y solo si la propiedad sigue libre (o su alquiler venció) se la queda — si no, reembolsa. */
  comprarOAlquilar(params: {
    id: string;
    tipo: "inmueble" | "habitacion" | "plantilla";
    asentamiento: string;
    jugadorNombre: string;
    modo: ModoTenencia;
    precioFarycoins: number;
    periodoHoras: number | null;
    /** docs/GDD_Gremios.md §7 (pedido 2026-08-30) — con esto el precio sale del banco del gremio en vez del monedero del jugador; el dueño de la propiedad sigue siendo el jugador. */
    gremioId?: number;
  }): Promise<{ ok: true; saldoRestante: number; expiraEn: string | null } | { ok: false; motivo: string }>;
  /** Extiende (no resetea) `expiraEn` del alquiler ACTIVO de `jugadorNombre`, cobrando de nuevo el precio. */
  renovarTenencia(
    id: string,
    jugadorNombre: string,
    periodoHoras: number,
    precioFarycoins: number,
  ): Promise<{ ok: true; expiraEn: string } | { ok: false; motivo: string }>;
  // Mercado (docs/GDD_Mercado.md) — `tenderoteId` es el id de una propiedad
  // YA existente (parcela/inmueble/habitación) que su dueño abre como
  // escaparate; sin tabla de "tenderetes" propia, reusa `propiedades` para
  // saber quién puede gestionarlo (ver duenoDeTenderete en RoomExteriorBase).
  listarStockTenderete(tenderoteId: string): Promise<ItemEnVentaTenderete[]>;
  /** Upsert: SUMA a la cantidad existente (repone, no reemplaza) y actualiza el precio al último valor puesto. */
  reponerStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioFarycoins: number): Promise<void>;
  /** Solo cambia el precio de un ítem YA en venta — `false` si ese ítem nunca se repuso ahí. */
  fijarPrecioTenderete(tenderoteId: string, itemId: string, precioFarycoins: number): Promise<boolean>;
  /** Todo o nada: cobra al comprador, decrementa stock atómicamente (nunca por debajo de 0), acredita al vendedor — sin transacción SQL explícita, mismo patrón compare-and-swap por WHERE que el resto de mutaciones económicas. `descuento` (-1..1, docs/GDD_Personaje.md §3.3 bonus de Comercio + docs/GDD_Twitch.md El Corralito/Mercado en oferta) reduce (positivo) o sube (negativo, evento Twitch) el precio TOTAL que paga el comprador Y el que recibe el vendedor por igual (negociación, no regalo — no crea ni destruye Farycoins de la nada). `abonarACaja` (docs/GDD_Mercado.md §12, pedido posterior a v1: "el dinero se queda en el inventario del mueble... botón de recoger ganancias") — si `true`, el importe NO se acredita directamente al monedero de `duenoNombre`, se acumula en la caja del propio tenderete (`tenderete_caja`, `recogerCajaTenderete`); solo lo usa el tenderete de JUGADOR (`tenderete:comprar`), nunca el comercio con NPC (`npc:comprar`, que sigue pagando directo al monedero sintético del NPC). */
  comprarDeTenderete(params: {
    tenderoteId: string;
    itemId: string;
    cantidad: number;
    compradorNombre: string;
    duenoNombre: string;
    descuento?: number;
    abonarACaja?: boolean;
  }): Promise<
    | { ok: true; saldoRestante: number; cantidadRestante: number; precioTotal: number }
    | { ok: false; motivo: string }
  >;
  /** Caja de ganancias del tenderete (docs/GDD_Mercado.md §12) — cuánto hay acumulado sin recoger todavía. 0 si nunca vendió nada. */
  obtenerCajaTenderete(tenderoteId: string): Promise<number>;
  /** Suma `farycoins` a la caja del tenderete — usado por `comprarDeTenderete` cuando `abonarACaja: true`. */
  incrementarCajaTenderete(tenderoteId: string, farycoins: number): Promise<void>;
  /** Atómico: pone la caja a 0 y devuelve lo que había ANTES de vaciarla (quien llame lo acredita al dueño) — 0 si no había nada. */
  recogerCajaTenderete(tenderoteId: string): Promise<number>;
  /** Como reponerStockTenderete, pero SIN tocar el precio — usado por el transporte (docs/GDD_Produccion.md) para no pisar el precio que el dueño ya puso. `precioInicial` solo se usa si la fila no existía todavía. */
  sumarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioInicial: number): Promise<void>;
  /** docs/GDD_Crafteo.md §4: descuenta insumo del almacén de una construcción (misma tabla `tenderete_items`, reusada como "qué hay guardado aquí" — sin cobro, sin precio). Compare-and-swap: `false` si no quedaba suficiente, nunca deja cantidad negativa. */
  consumirStockTenderete(tenderoteId: string, itemId: string, cantidad: number): Promise<boolean>;
  /** docs/GDD_Economia.md (pedido 2026-08-30): vende AL comerciante — el NPC paga con su PROPIO saldo (limitado, `SALDO_INICIAL_NPC_COMERCIANTE`) y el ítem se consume (no se acumula stock revendible, v1 deliberadamente simple: sin bucle comprar-barato/vender-caro entre el mismo NPC). Todo o nada: si el NPC no tiene suficiente, no se cobra nada. */
  venderANpc(params: {
    npcNombre: string;
    itemId: string;
    cantidad: number;
    precioUnitario: number;
    vendedorNombre: string;
  }): Promise<{ ok: true; saldoRestante: number; precioTotal: number } | { ok: false; motivo: string }>;
  /** docs/GDD_Economia.md (pedido 2026-08-30, "los npc cada día reciben 20 Farycoins también"): acredita `INGRESO_DIARIO_NPC` por cada día de mundo transcurrido desde la última resolución — cálculo perezoso, SOLO se llama cuando un jugador de verdad se acerca al NPC (nunca un tick de fondo). La primera vez que se ve a un NPC no le da nada retroactivo (solo fija el día de partida). */
  resolverIngresoDiarioNpc(npcNombre: string, diaActual: number): Promise<{ diasAcreditados: number; saldo: number }>;
  /** Como reponerStockTenderete, pero FIJA la cantidad en vez de sumarla — mercaderes por oficio (docs/GDD_Economia.md §9): el reinicio diario re-sortea el stock a un valor absoluto nuevo, no lo acumula sobre lo que quedaba. */
  fijarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioFarycoins: number): Promise<void>;
  /**
   * ¿Toca reiniciar el stock/presupuesto de compra de este mercader?
   * (docs/GDD_Economia.md §9, pedido literal: "reset cada 24 horas REALES,
   * no ligado al reloj de mundo"). `true` la PRIMERA vez que se ve al NPC
   * (para que nazca con stock) y cada vez que hayan pasado >= `ventanaMs`
   * desde el último reinicio — y en ese caso YA marca el reinicio como
   * hecho (para que el llamador re-sortee el stock exactamente una vez).
   * Requiere que la fila de `npc_comerciantes` YA exista — llamar SIEMPRE
   * después de `resolverIngresoDiarioNpc` en el mismo punto de contacto.
   */
  resolverResetStockMercader(npcNombre: string, ahoraMs: number, ventanaMs: number): Promise<boolean>;
  listarConstrucciones(): Promise<Construccion[]>;
  insertarConstruccion(c: NuevaConstruccion): Promise<number>;
  borrarConstruccion(id: number): Promise<boolean>;
  /** Producción pasiva (docs/GDD_Produccion.md): persiste el JSON de estado (interior generado, acumulador de producción) de una construcción ya existente — columna `extra` que YA existe, sin migración. */
  actualizarExtraConstruccion(id: number, extra: Record<string, unknown> | null): Promise<void>;
  // Transporte (docs/GDD_Produccion.md): contrato entre una construcción
  // productora (origen) y un tenderete (destino, propiedad — docs/
  // GDD_Mercado.md) donde entrega lo transportado. La ruta se calcula UNA
  // VEZ al firmar (server/src/mundo/pathfindingRuntime.ts) y se cachea aquí.
  crearContratoTransporte(c: NuevoContratoTransporte): Promise<ContratoTransporte>;
  listarContratosTransporte(): Promise<ContratoTransporte[]>;
  actualizarUltimoViajeContrato(id: number, ultimoViajeResuelto: string): Promise<void>;
  /** docs/GDD_Carros.md §12 (Fase 5) — recalculada al asignar/quitar montura/conjunto a mitad de ruta activa (la velocidad efectiva cambia, la duración persistida del viaje tiene que seguirla). */
  actualizarDuracionContrato(id: number, duracionViajeSeg: number): Promise<void>;
  desactivarContratoTransporte(id: number): Promise<void>;
  /** El contrato ACTIVO (si hay) que opera este trabajador de oficio "transporte" — docs/GDD_NPCs_Contratables.md §Fusión con transporte. */
  buscarContratoDeTrabajador(trabajadorId: number): Promise<ContratoTransporte | null>;
  // Mazmorras (docs/GDD_Bakeador_Dungeons.md §4.2): cooldown de 1h tras
  // limpiar una planta, para que no se repueble al instante y se pueda
  // "farmear a saco". `clave` = mapaId:edificio:nivel.
  obtenerLimpiezaMazmorra(clave: string): Promise<string | null>;
  marcarMazmorraLimpiada(clave: string): Promise<void>;
  // Facción bandida (docs/GDD_Faccion_Bandidos.md §6, fase 1: datos + tick,
  // sin IA ni patrullas en vivo todavía).
  obtenerOCrearAsentamiento(id: string, bando?: string): Promise<Asentamiento>;
  listarAsentamientos(): Promise<Asentamiento[]>;
  guardarAsentamiento(a: Asentamiento): Promise<void>;
  listarTropas(asentamientoId: string): Promise<Tropa[]>;
  crearTropa(asentamientoId: string, rango: RangoTropa): Promise<Tropa>;
  // Costura para el sistema de combate (todavía sin diseñar, GDD §2.4): hoy
  // nada la llama en producción — la persistencia ya está lista para cuando
  // combate exista, mismo patrón que marcarMazmorraLimpiada en su día.
  marcarTropaMuerta(tropaId: string): Promise<void>;
  // Reproducción de fauna salvaje (docs/GDD_Agentes_Moviles.md, pedido
  // 2026-08-30) — todo por sector, para que la integración en vivo cargue
  // y guarde SOLO el sector que se activa. `guardarFaunaIndividuo` es
  // upsert (inserta si no existe, si no actualiza todos los campos).
  listarFaunaSector(mapaId: string, sectorX: number, sectorY: number): Promise<FaunaSalvajeFila[]>;
  guardarFaunaIndividuo(f: FaunaSalvajeFila): Promise<void>;
  listarHuevosSector(mapaId: string, sectorX: number, sectorY: number): Promise<FaunaHuevoFila[]>;
  guardarHuevo(h: FaunaHuevoFila): Promise<void>;
  borrarHuevo(id: string): Promise<void>;
  /** `null` = este sector nunca se resolvió — el primer spawn se genera determinista, no se "resuelve" un hueco. */
  obtenerUltimaResolucionSector(mapaId: string, sectorX: number, sectorY: number): Promise<number | null>;
  marcarSectorResuelto(mapaId: string, sectorX: number, sectorY: number, momento: number): Promise<void>;
  // Crecimiento de bosques (docs/GDD_Bosques.md, pedido 2026-08-30) — mismo
  // criterio por sector que la fauna salvaje, pero SIN materializar la
  // población base: un árbol bakeado sin tocar nunca se persiste (se
  // re-deriva del propio bake, ver server/src/mundo/bosqueSector.ts), solo
  // los talados y los nacidos en el sistema (propagación/plantado).
  listarArbolesVivosSector(mapaId: string, sectorX: number, sectorY: number): Promise<ArbolVivoFila[]>;
  guardarArbolVivo(a: ArbolVivoFila): Promise<void>;
  obtenerUltimaResolucionSectorBosque(mapaId: string, sectorX: number, sectorY: number): Promise<number | null>;
  marcarSectorBosqueResuelto(mapaId: string, sectorX: number, sectorY: number, momento: number): Promise<void>;
  // Cadáveres (docs/GDD_Agentes_Moviles.md, pedido 2026-08-30) — sin
  // sector, por mapa entero (las muertes son mucho menos frecuentes que
  // la población base de fauna).
  listarCadaveresMapa(mapaId: string): Promise<CadaverFila[]>;
  crearCadaverBd(c: CadaverFila): Promise<void>;
  /** Actualiza SOLO el contenedor (tras lootear) — el resto de campos de un cadáver no cambian nunca. */
  actualizarContenedorCadaver(id: string, contenedor: Contenedor): Promise<void>;
  borrarCadaver(id: string): Promise<void>;
  // Ganadería (docs/GDD_Ganaderia.md, pedido 2026-08-30) — mismo criterio
  // que cadáveres: sin sector, por mapa entero (mucho menos frecuente que
  // la población base de fauna salvaje).
  listarAnimalesGranjaMapa(mapaId: string): Promise<AnimalGranjaFila[]>;
  crearAnimalGranjaBd(a: AnimalGranjaFila): Promise<void>;
  /** Actualiza SOLO `extra` (acumulador de producción + último día de escape chequeado) — el resto de campos no cambian salvo venta/traspaso. */
  actualizarExtraAnimalGranja(id: string, extra: Record<string, unknown>): Promise<void>;
  borrarAnimalGranja(id: string): Promise<void>;
  /** Lista/quita de venta en un tenderete — solo el dueño de la propiedad del animal Y del tenderete puede llamarlo (comprobación en RoomExteriorBase). `false` si el animal no existe o no pertenece a `propiedadId`. */
  fijarVentaAnimalGranja(id: string, propiedadId: string, tenderoteId: string | null, precioFarycoins: number | null): Promise<boolean>;
  listarAnimalesEnVentaTenderete(tenderoteId: string): Promise<AnimalGranjaFila[]>;
  /**
   * Compra atómica: cobra al comprador, acredita al vendedor, y SOLO si
   * ambas cobranzas van bien reubica el animal (propiedad/mapa/x/y) y lo
   * quita de la venta — compare-and-swap por `enVentaTenderoteId` (mismo
   * criterio que `comprarDeTenderete`, evita comprar dos veces el mismo animal).
   */
  comprarAnimalGranja(params: {
    id: string; tenderoteId: string; propiedadDestino: string; mapaIdDestino: string; x: number; y: number;
    compradorNombre: string; duenoNombre: string;
  }): Promise<{ ok: true; especieId: string; precioTotal: number } | { ok: false; motivo: string }>;
  /** Traspaso SIN farycoins (docs/GDD_Comercio.md) — reubica el animal a la propiedad del receptor. `false` si el animal ya no pertenece a `propiedadOrigen` (se vendió/movió mientras se negociaba). */
  transferirAnimalGranja(id: string, propiedadOrigen: string, propiedadDestino: string, mapaIdDestino: string, x: number, y: number): Promise<boolean>;
  registrarMemoriaLider(
    diaIngame: number,
    evento: string,
    opciones?: { tipo?: "tropa_muerta" | "asentamiento_conquistado"; asentamientoId?: string; jugador?: string },
  ): Promise<void>;
  memoriaLiderReciente(limite: number): Promise<MemoriaLider[]>;
  /** docs/GDD_Faccion_Bandidos.md §7quinquies — historial de ESTE jugador con ESTE asentamiento concreto (para el diálogo de un bandido: "¿ya me conoce?"). Vacío si nunca coincidieron. */
  historialJugadorEnAsentamiento(asentamientoId: string, jugador: string, limite: number): Promise<MemoriaLider[]>;
  // Inventario (pedido 2026-08-29, fase 1: catálogo + servidor + persistencia
  // — server/src/inventario/inventario.ts es el contrato de la lógica pura,
  // esto solo guarda/recupera su estado tal cual). `null` en cargarContenedor
  // = ese contenedor nunca se guardó (jugador nuevo); quien llama decide el
  // tamaño por defecto con crearContenedor().
  guardarContenedor(jugadorId: number, contenedorId: string, contenedor: Contenedor): Promise<void>;
  cargarContenedor(jugadorId: number, contenedorId: string): Promise<Contenedor | null>;
  listarContenedores(jugadorId: number): Promise<Map<string, Contenedor>>;
  guardarEquipo(jugadorId: number, slots: SlotsEquipo): Promise<void>;
  cargarEquipo(jugadorId: number): Promise<SlotsEquipo>;
  // Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30) — nace "siguiendo" (RoomExteriorBase la spawnea de inmediato).
  crearMascota(jugadorId: number, especieId: string): Promise<Mascota>;
  listarMascotas(jugadorId: number): Promise<Mascota[]>;
  /** Todo o nada: solo cambia si `id` pertenece de verdad a `jugadorId` — `false` si no existe o es de otro jugador. */
  actualizarUbicacionMascota(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean>;
  /** docs/GDD_Monturas.md — marca `montura:true` permanentemente (mismo compare-and-swap por jugadorId que actualizarUbicacionMascota). */
  ponerMonturaMascota(id: number, jugadorId: number): Promise<boolean>;
  /** docs/GDD_Carros.md §2 — marca `arnes:true` + `arnesPesoMaximo` permanentemente (mismo compare-and-swap que ponerMonturaMascota, ranura independiente). */
  ponerArnesMascota(id: number, jugadorId: number, pesoMaximo: number): Promise<boolean>;
  // Compañeros NPC (docs/GDD_Companeros.md, pedido 2026-08-30) — nace "siguiendo" (RoomExteriorBase lo spawnea de inmediato), mismo patrón que mascotas.
  crearCompanero(jugadorId: number, companeroJugadorId: number, npcOrigenSlot: string, nombre: string): Promise<Companero>;
  listarCompaneros(jugadorId: number): Promise<Companero[]>;
  /** Todo o nada: solo cambia si `id` pertenece de verdad a `jugadorId` — `false` si no existe o es de otro jugador. */
  actualizarUbicacionCompanero(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean>;
  /** XP acumulada (nivel se deriva en vivo con nivelDeXp, nunca se persiste el nivel en sí — mismo criterio que atributos de jugador). */
  actualizarXpCompanero(id: number, jugadorId: number, xp: number): Promise<boolean>;
  // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30) — nace anclado donde se coloca (barco:colocar).
  crearBarco(jugadorId: number, tipoId: string, mapaId: string, x: number, y: number): Promise<Barco>;
  /** Todos los barcos anclados en ESE mapa — HubRoom los carga a state.barcos en onCreate. */
  listarBarcosDe(mapaId: string): Promise<Barco[]>;
  /** Se llama al desembarcar (ancla donde quedó) y al cruzar de mapa (ancla en el spawn del destino). */
  actualizarPosicionBarco(id: number, mapaId: string, x: number, y: number): Promise<void>;
  // Carros (docs/GDD_Carros.md §3/§5, pedido 2026-09-03) — mismo patrón exacto que Barcos, con el paso intermedio de fusión en ConjuntoTiro.
  /** Nace aparcado (carro:colocar) — `contenido` ya inicializado vacío según categoría (docs/GDD_Carros.md §8, Fase 2). */
  crearCarro(jugadorId: number, tipoId: string, mapaId: string, x: number, y: number, contenido: ContenidoCarro | null): Promise<Carro>;
  /** Todos los carros aparcados en ESE mapa — HubRoom los carga a state.carros en onCreate. */
  listarCarrosDe(mapaId: string): Promise<Carro[]>;
  /** Se llama al enganchar (deja de estar "aparcado", pasa a ConjuntoTiro). */
  eliminarCarro(id: number): Promise<void>;
  /** docs/GDD_Carros.md §8 (Fase 2) — persiste la carga tras `carro:meterCarga`/`meterMueble`/`meterAnimal`/`conectarManguera`/etc. sobre un carro APARCADO. */
  actualizarContenidoCarro(id: number, contenido: ContenidoCarro | null): Promise<void>;
  /** carro:enganchar — funde una mascota (ya existente, sin borrar su fila) con un carro (que SÍ se borra vía eliminarCarro) en una entidad nueva; `contenido` es el que traía el carro (sobrevive al enganche, la carga es del carro no del animal). */
  crearConjuntoTiro(jugadorId: number, mascotaId: number, especieAnimalId: string, carroTipoId: string, mapaId: string, x: number, y: number, contenido: ContenidoCarro | null): Promise<ConjuntoTiro>;
  /** Todos los conjuntos enganchados en ESE mapa (con o sin conductor) — HubRoom los carga a state.conjuntosTiro en onCreate. */
  listarConjuntosTiroDe(mapaId: string): Promise<ConjuntoTiro[]>;
  /** Se llama al desmontar el conductor (ancla donde quedó) — mismo criterio que actualizarPosicionBarco. */
  actualizarPosicionConjuntoTiro(id: number, mapaId: string, x: number, y: number): Promise<void>;
  /** docs/GDD_Carros.md §8 (Fase 2) — misma idea que actualizarContenidoCarro, pero sobre un conjunto YA enganchado. */
  actualizarContenidoConjuntoTiro(id: number, contenido: ContenidoCarro | null): Promise<void>;
  /** carro:desenganchar — separa de vuelta en un Carro aparcado + la mascota vuelve a "siguiendo" (RoomExteriorBase recrea ambos, esto solo borra la fusión). */
  eliminarConjuntoTiro(id: number): Promise<void>;
  // Agricultura de casilla (docs/GDD_Carros.md §9.1, Fase 3, pedido 2026-09-03) — cultivoCasilla:labrar/plantar/cosechar.
  /** Upsert por (mapaId, idxCasilla) — labrar/plantar/cosechar llaman a esto en cada transición de estado. */
  guardarCasillaCultivo(c: CasillaCultivo): Promise<void>;
  /** Todas las casillas de cultivo de ESE mapa — iniciarConstruccion las carga a la caché de proceso (cultivoCasillaVivo.ts) la PRIMERA vez que se visita. */
  listarCasillasCultivoDe(mapaId: string): Promise<CasillaCultivo[]>;
  // Flags globales (docs/GDD_PvP.md, pedido 2026-08-30) — tabla genérica de un solo valor por clave.
  obtenerConfigMundo(clave: string): Promise<string | null>;
  fijarConfigMundo(clave: string, valor: string): Promise<void>;
  // Niebla de guerra del mapa de mundo (docs/GDD_Mapa_Mundo.md, pedido
  // 2026-08-31) — sectores revelados por jugador+mapa, permanente. `[]` si
  // nunca abrió el mapa en ese mapaId.
  obtenerExploracion(jugadorId: number, mapaId: string): Promise<number[]>;
  guardarExploracion(jugadorId: number, mapaId: string, sectores: number[]): Promise<void>;
  // Injertos (docs/GDD_Agricultura.md §4, pedido 2026-08-30) — especies híbridas permanentes.
  crearCultivoHibrido(c: CultivoHibrido): Promise<void>;
  listarCultivosHibridos(): Promise<CultivoHibrido[]>;
  /** "Renombrar a mano" (diseño ya cerrado) — no-op silencioso si el id no existe. */
  renombrarCultivoHibrido(semillaId: string, nombre: string): Promise<void>;
  // Cocina (docs/GDD_Cocina.md, pedido 2026-08-30) — platos permanentes.
  crearPlatoCreado(p: PlatoCreado): Promise<void>;
  /** Por `clavePlato` (conjunto de tipos de ingrediente) — null si esta combinación nunca se cocinó antes. */
  buscarPlatoPorClave(clave: string): Promise<PlatoCreado | null>;
  listarPlatosCreados(): Promise<PlatoCreado[]>;
  // Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre legendario, pedido 2026-08-31).
  /** Cooldown de 24h REALES (Date.now(), mismo criterio que resolverResetStockMercader) — `true` y CONSUME el cooldown si tocaba, `false` (sin tocar nada) si sigue en ventana. */
  resolverCooldownTejidoLegendario(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean>;
  crearPrendaGenerada(p: Omit<PrendaGenerada, "id" | "creadoEn">): Promise<PrendaGenerada>;
  obtenerPrendaGenerada(id: number): Promise<PrendaGenerada | null>;
  listarPrendasGeneradasDeCreador(creadorId: number): Promise<PrendaGenerada[]>;
  // Carpintero legendario (docs/GDD_Ropa_Procedural.md §Carpintero legendario, mismo patrón exacto que el sastre).
  resolverCooldownCarpinteriaLegendaria(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean>;
  crearMuebleGenerado(m: Omit<MuebleGenerado, "id" | "creadoEn">): Promise<MuebleGenerado>;
  obtenerMuebleGenerado(id: number): Promise<MuebleGenerado | null>;
  listarMueblesGeneradosDeCreador(creadorId: number): Promise<MuebleGenerado[]>;
  // Ingeniero legendario (docs/GDD_Ropa_Procedural.md §Ingeniero legendario, mismo patrón exacto).
  resolverCooldownIngenieriaLegendaria(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean>;
  crearEdificioGenerado(e: Omit<EdificioGenerado, "id" | "creadoEn">): Promise<EdificioGenerado>;
  obtenerEdificioGenerado(id: number): Promise<EdificioGenerado | null>;
  listarEdificiosGeneradosDeCreador(creadorId: number): Promise<EdificioGenerado[]>;
  // Librería (docs/GDD_Libreria.md, pedido 2026-09-01) — sin cooldown: escribir un libro no compite con ningún recurso escaso, solo con tener el blueprint y la pluma.
  crearLibroGenerado(l: Omit<LibroGenerado, "id" | "creadoEn">): Promise<LibroGenerado>;
  obtenerLibroGenerado(id: number): Promise<LibroGenerado | null>;
  /** Reescribe un libro YA creado — el llamante (RoomExteriorBase) ya comprobó que `autorId` coincide antes de llamar. */
  actualizarLibroGenerado(id: number, titulo: string, paginas: string[]): Promise<void>;
  cerrar(): Promise<void>;
}

// Esquema EXACTO del GDD_Construccion §2 (mismas tablas/columnas en los dos
// motores; solo cambia la sintaxis de autoincremento — SERIAL en Postgres,
// INTEGER PRIMARY KEY AUTOINCREMENT en SQLite — no tocar aquí sin cambiar el
// GDD en el mismo commit). Sin FK reales (ni aquí ni en SQLite, que no las
// aplica por defecto): "propiedad"/"dueno" son referencias documentales.
const MIGRACIONES_SQLITE = `
CREATE TABLE IF NOT EXISTS jugadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,          -- identidad v1 = nombre (hasta que haya login real; documentado)
  creado_en TEXT NOT NULL,
  farycoins INTEGER NOT NULL DEFAULT 0, -- moneda del mundo, saldo numérico (no ítem de inventario)
  vida INTEGER NOT NULL DEFAULT 100,    -- docs/GDD_Mecanicas.md §5.4: base 100/100, modificable por equipo/combate
  vida_max INTEGER NOT NULL DEFAULT 100,
  anatomia TEXT,                        -- docs/GDD_Anatomia.md: JSON de las 6 zonas (server/src/personaje/anatomia.ts::Anatomia); NULL = nunca se ha tocado, se resuelve a anatomiaInicial()
  enfermedades TEXT,                    -- docs/GDD_Enfermedades.md: JSON de server/src/personaje/enfermedades.ts::EstadoEnfermedades; NULL = nunca se ha tocado, se resuelve a enfermedadesInicial()
  oficio_1 TEXT NOT NULL DEFAULT '',    -- docs/GDD_Profesiones.md ronda 2: los 2 slots de oficio elegidos con el NPC "maestro de oficios" — "" = vacío
  oficio_2 TEXT NOT NULL DEFAULT '',
  cambios_oficio INTEGER NOT NULL DEFAULT 0, -- ronda 3: cuántas veces ya pagó por cambiar — precio exponencial, ver Jugador.cambiosOficio
  comida INTEGER NOT NULL DEFAULT 100,  -- vitales (docs/GDD_Personaje.md §2), persistencia 2026-09-01 — ver comentario de Jugador.comida
  bebida INTEGER NOT NULL DEFAULT 100,
  sueno INTEGER NOT NULL DEFAULT 100,
  estamina INTEGER NOT NULL DEFAULT 100
);
-- NPCs tutoriales fijos (docs/GDD_Profesiones.md ronda 3, pedido 2026-08-30):
-- una fila por NPC colocado a mano por un admin/superadmin — RegionRoom/
-- HubRoom los recrea al arrancar leyendo esta tabla (mismo criterio que
-- poblacion.json/npcsFijos.json, pero editable en vivo desde el juego).
CREATE TABLE IF NOT EXISTS npcs_tutoriales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapa_id TEXT NOT NULL,
  tipo_tutorial TEXT NOT NULL,          -- id de poblacion/catalogo/npcsTutoriales.json
  nombre TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  colocado_por TEXT NOT NULL,
  colocado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npcs_tutoriales_mapa ON npcs_tutoriales(mapa_id);
-- Cuentas de admin (docs/GDD_Admin.md, pedido 2026-08-30): jarl por mapa +
-- superadmin. Identidad SEPARADA de la tabla jugadores a propósito — el
-- nombre de PJ es libre/mutable, esto es una cuenta real (login por
-- contraseña propia Y/O por twitch_login ya vinculado). rol="jarl" exige
-- mapa_id (a qué mapa administra); rol="superadmin" lo deja NULL (cualquier mapa).
CREATE TABLE IF NOT EXISTS admin_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  password_hash TEXT,     -- server/src/admin/passwordHash.ts ("salt:hash"), NULL si solo se loguea por Twitch
  twitch_login TEXT UNIQUE, -- login de Twitch ya vinculado (docs/GDD_Twitch.md oauthLogin.ts), NULL si solo usuario/contraseña
  rol TEXT NOT NULL,     -- "jarl" | "superadmin"
  mapa_id TEXT,           -- solo con rol="jarl" — 1 jarl por mapa, se aplica en el código (asignarJarlDeMapa), no con un UNIQUE de columna
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gremios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  lider_jugador_id INTEGER NOT NULL,     -- FK jugadores.id
  color TEXT NOT NULL DEFAULT '#8a8a8a',
  emblema_id TEXT NOT NULL DEFAULT 'emblema_generico',
  saldo_banco INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gremio_miembros (
  gremio_id INTEGER NOT NULL,            -- FK gremios.id
  jugador_id INTEGER NOT NULL,           -- FK jugadores.id
  rol TEXT NOT NULL DEFAULT 'miembro',   -- 'lider' | 'miembro'
  ingreso_en TEXT NOT NULL,
  PRIMARY KEY (gremio_id, jugador_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gremio_miembros_jugador ON gremio_miembros(jugador_id);
CREATE TABLE IF NOT EXISTS gremio_invitaciones (
  gremio_id INTEGER NOT NULL,
  jugador_id INTEGER NOT NULL,           -- invitado
  invitado_por INTEGER NOT NULL,         -- FK jugadores.id del líder que invitó
  creado_en TEXT NOT NULL,
  PRIMARY KEY (gremio_id, jugador_id)
);
-- Inventario compartido del gremio (docs/GDD_Gremios.md §7, pedido
-- 2026-08-30: "se puede compartir... el inventariado de objetos") — mismo
-- shape EXACTO que un Contenedor de jugador (tabla inventarios), pero UNA
-- sola fila por gremio (no hace falta contenedor_id, un gremio tiene un
-- único almacén compartido, no cuerpo+mochilas).
CREATE TABLE IF NOT EXISTS gremio_inventario (
  gremio_id INTEGER PRIMARY KEY,
  ancho INTEGER NOT NULL,
  alto INTEGER NOT NULL,
  siguiente_id INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propiedades (
  id TEXT PRIMARY KEY,                  -- "p_0001" (parcela), "i_<mapaId>:<edificioId>" (inmueble) o "h_<mapaId>:<edificioId>:<nivel>:<salaIndex>" (habitación)
  tipo TEXT NOT NULL,                   -- 'parcela' | 'inmueble' | 'habitacion'
  asentamiento TEXT NOT NULL,
  dueno INTEGER,                        -- FK jugadores.id; NULL = del jarl/asentamiento (o libre, si es comercial)
  asignada_en TEXT,
  -- Tenencia comercial (docs/GDD_Propiedades.md, pedido 2026-08-29) — las 4
  -- columnas quedan NULL para las parcelas de siempre (asignación de jarl,
  -- cero cambio de comportamiento). modo_tenencia: NULL | 'compra' | 'alquiler'.
  modo_tenencia TEXT,
  precio_farycoins INTEGER,
  periodo_horas INTEGER,
  expira_en TEXT,
  -- Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30) — 4
  -- columnas nuevas, mismo criterio "queda NULL/0 si nunca se configuró,
  -- cero cambio de comportamiento" que la tenencia comercial de arriba.
  impuesto_activo INTEGER NOT NULL DEFAULT 0,
  impuesto_farycoins INTEGER,
  impuesto_periodo_horas INTEGER,
  impuesto_ultimo_cobro TEXT
);
CREATE TABLE IF NOT EXISTS construcciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  propiedad TEXT NOT NULL,              -- FK propiedades.id
  objeto TEXT NOT NULL,                 -- id de catálogo
  categoria TEXT NOT NULL,              -- 'mueble' | 'exterior' | 'edificio'
  x INTEGER NOT NULL, y INTEGER NOT NULL,  -- casilla global (esquina noroeste de la huella YA rotada)
  rot INTEGER NOT NULL DEFAULT 0,       -- 0..3 (x90° horario; huella rotada = [h,w] en rot impar)
  variante INTEGER NOT NULL DEFAULT 0,
  extra TEXT,                           -- JSON: interior generado (edificios); estado futuro (energía...)
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_construcciones_prop ON construcciones(propiedad);
-- Mercado (docs/GDD_Mercado.md, pedido 2026-08-29): tenderete_id = id de una
-- fila YA existente en "propiedades" (parcela/inmueble/habitación) — sin
-- tabla "tenderetes" propia, la propiedad YA modela quién puede vender ahí.
CREATE TABLE IF NOT EXISTS tenderete_items (
  tenderete_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  precio_farycoins INTEGER NOT NULL,
  PRIMARY KEY (tenderete_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_tenderete_items_tenderete ON tenderete_items(tenderete_id);
-- Mercado v2 (docs/GDD_Mercado.md §12, pedido posterior a v1): ganancias de
-- venta acumuladas SIN recoger todavía — el dueño las cobra a mano con
-- "tenderete:recogerGanancias" ("el dinero se queda en el inventario del
-- mueble... botón de recoger ganancias", pedido literal). Tabla separada de
-- tenderete_items a propósito: esa tabla la reusan crafteo/transporte/
-- mercaderes NPC con semántica de "stock", nunca de "dinero acumulado" —
-- mezclar ambas habría exigido distinguir filas por item_id especial.
CREATE TABLE IF NOT EXISTS tenderete_caja (
  tenderete_id TEXT PRIMARY KEY,
  farycoins INTEGER NOT NULL DEFAULT 0
);
-- Economía (docs/GDD_Economia.md, pedido 2026-08-30): ingreso diario de un
-- NPC comerciante ("npc:<slotId>" en jugadores.nombre) — cálculo perezoso,
-- SOLO cuando alguien se acerca de verdad (nunca un tick de fondo): guarda
-- el último día de mundo ya acreditado para saber cuántos días atrasados tocan.
CREATE TABLE IF NOT EXISTS npc_comerciantes (
  nombre TEXT PRIMARY KEY,
  ultimo_dia_ingreso INTEGER NOT NULL,
  ultimo_reset_stock_ms INTEGER
);
-- Producción/transporte (docs/GDD_Produccion.md, pedido 2026-08-29): un
-- contrato entre una construcción productora y un tenderete destino. La
-- ruta se calcula UNA VEZ al firmar (nunca en vivo después) y se cachea aquí.
CREATE TABLE IF NOT EXISTS contratos_transporte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origen_construccion_id INTEGER NOT NULL,
  destino_tenderete_id TEXT NOT NULL,
  dueno INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  camino_ida TEXT NOT NULL,             -- JSON Punto[]
  camino_vuelta TEXT NOT NULL,          -- JSON Punto[]
  duracion_viaje_seg REAL NOT NULL,
  carga_por_viaje INTEGER NOT NULL DEFAULT 10,
  ultimo_viaje_resuelto TEXT NOT NULL,  -- ISO, cálculo perezoso (igual que expira_en de Propiedades)
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL,
  trabajador_id INTEGER               -- FK npcs_trabajadores.id (fusión con "transporte" como oficio, docs/GDD_NPCs_Contratables.md) — NULL en contratos previos a la fusión
);
CREATE INDEX IF NOT EXISTS idx_contratos_origen ON contratos_transporte(origen_construccion_id);
CREATE INDEX IF NOT EXISTS idx_contratos_destino ON contratos_transporte(destino_tenderete_id);
CREATE INDEX IF NOT EXISTS idx_contratos_trabajador ON contratos_transporte(trabajador_id);
-- NPCs trabajadores contratables (docs/GDD_NPCs_Contratables.md, pedido
-- 2026-09-01): un NPC real por fila, contratado desde el reclutador de la
-- capital, con 1+ oficios (JSON de strings — más oficios, más caro, ver
-- costeContratacionTrabajador en construccion/trabajadores.ts), asignado por
-- su dueño a UNA mesa de construcción (construccion_id, NULL = recién
-- contratado, todavía sin mesa) y opcionalmente una receta que craftea solo
-- (receta_id, NULL = sin asignar, no hace nada todavía). x/y son su
-- posición actual en el mundo (la del reclutador al contratar; la de la
-- mesa tras asignarla — GestorAgentes lo trata como "NPC fijo", mismo
-- mecanismo que npcs_tutoriales, sin caminar hasta allí — regla dura de
-- agentes.ts: nunca A* en vivo). fecha_contratacion_dia/ultimo_pago_dia son
-- DÍAS DE MUNDO (tiempoMundo().dia), no timestamps reales — el salario
-- mensual se resuelve perezosamente comparando estos contra el día actual
-- (resolverPayroll, mismo patrón que resolverIngresoDiarioNpc).
CREATE TABLE IF NOT EXISTS npcs_trabajadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapa_id TEXT NOT NULL,
  dueno_id INTEGER NOT NULL,             -- FK jugadores.id
  nombre TEXT NOT NULL,
  oficios TEXT NOT NULL,                 -- JSON string[] — subconjunto de OFICIOS_JUGADOR_VALIDOS
  construccion_id INTEGER,               -- FK construcciones.id — mesa asignada, NULL = sin asignar
  receta_id TEXT,                        -- id de items/catalogo/recetas.json — receta que craftea solo, NULL = sin asignar
  x REAL NOT NULL,
  y REAL NOT NULL,
  fecha_contratacion_dia INTEGER NOT NULL,
  ultimo_pago_dia INTEGER NOT NULL,
  creado_en TEXT NOT NULL,
  mascota_asignada_id INTEGER,           -- FK mascotas.id, docs/GDD_Carros.md §12 (Fase 5) — NULL = anda a pie
  conjunto_asignado_id INTEGER           -- FK conjuntos_tiro.id, docs/GDD_Carros.md §12 — mutuamente excluyente con mascota_asignada_id
);
CREATE INDEX IF NOT EXISTS idx_npcs_trabajadores_dueno ON npcs_trabajadores(dueno_id);
CREATE INDEX IF NOT EXISTS idx_npcs_trabajadores_mapa ON npcs_trabajadores(mapa_id);
-- Crafteo (docs/GDD_Crafteo.md, pedido 2026-08-29): XP por oficio — el nivel
-- se DERIVA de esto en código puro, nunca se persiste el nivel en sí.
CREATE TABLE IF NOT EXISTS jugador_oficios (
  jugador_id INTEGER NOT NULL,
  oficio TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jugador_id, oficio)
);
-- Personaje (docs/GDD_Personaje.md, pedido 2026-08-29): XP por atributo,
-- MISMO mecanismo que jugador_oficios (nivel derivado, nunca persistido en
-- sí) — vida y vitales (comida/bebida/sueño/estamina) SÍ persisten (columnas
-- de "jugadores" arriba, comida/bebida/sueno/estamina añadidas 2026-09-01),
-- solo el NIVEL de atributo (XP) vive en esta tabla aparte.
CREATE TABLE IF NOT EXISTS jugador_atributos (
  jugador_id INTEGER NOT NULL,
  atributo TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  ultimo_dia_actividad INTEGER, -- docs/GDD_Personaje.md §3.5: día de mundo (tiempoMundo().dia) de la última actividad diaria de entrenamiento que otorgó XP de este atributo
  PRIMARY KEY (jugador_id, atributo)
);
-- Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30): perro/gato urbanos
-- domesticados a base de comida. "siguiendo" = viva en la room del dueño
-- (RoomExteriorBase la spawnea/mueve); "propiedad" = guardada, sin room.
CREATE TABLE IF NOT EXISTS mascotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  ubicacion TEXT NOT NULL DEFAULT 'siguiendo',
  propiedad_id TEXT,
  creado_en TEXT NOT NULL,
  montura INTEGER NOT NULL DEFAULT 0,
  arnes INTEGER NOT NULL DEFAULT 0,
  arnes_peso_maximo REAL NOT NULL DEFAULT 0
);
-- Compañeros NPC (docs/GDD_Companeros.md, pedido 2026-08-30): un Npc real de
-- poblacion/ reclutado por un jugador. companero_jugador_id es la fila
-- SINTÉTICA en jugadores (nombre 'companero:<slot>') que reusa inventario/
-- equipo/vida ya existentes — esta tabla solo guarda la relación de
-- propiedad + progresión + de qué Npc salió (para repintar su mismo aspecto).
CREATE TABLE IF NOT EXISTS companeros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL,
  companero_jugador_id INTEGER NOT NULL,
  npc_origen_slot TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  ubicacion TEXT NOT NULL DEFAULT 'siguiendo',
  propiedad_id TEXT,
  creado_en TEXT NOT NULL
);
-- Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): crafteado en el astillero
-- y "colocado" junto al agua — ancla en el mundo (mapa_id+x+y), nunca vuelve
-- al inventario. mapa_id cambia al cruzar un borde mar_abierto a otro mapa.
CREATE TABLE IF NOT EXISTS barcos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL,
  tipo_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  creado_en TEXT NOT NULL
);
-- Carros (docs/GDD_Carros.md §3, pedido 2026-09-03): mismo patrón exacto que
-- barcos — "colocado" (carro:colocar), ancla en el mundo hasta que se
-- engancha (pasa a conjuntos_tiro) o se vuelve a desenganchar.
CREATE TABLE IF NOT EXISTS carros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL,
  tipo_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  creado_en TEXT NOT NULL,
  contenido TEXT
);
-- Conjuntos de tiro (docs/GDD_Carros.md §5, pedido 2026-09-03): animal
-- (mascota_id, su fila en mascotas NO se borra) + carro fusionados por
-- carro:enganchar. Ancla en el mundo igual que un carro/barco -- sobrevive
-- aparcado sin conductor a un reinicio de room. contenido = misma carga que
-- traía el Carro de origen (JSON, docs/GDD_Carros.md §8 Fase 2) -- la carga
-- es del carro, no del animal, sobrevive a enganchar/desenganchar.
CREATE TABLE IF NOT EXISTS conjuntos_tiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL,
  mascota_id INTEGER NOT NULL,
  especie_animal_id TEXT NOT NULL,
  carro_tipo_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  creado_en TEXT NOT NULL,
  contenido TEXT
);
-- Agricultura de casilla (docs/GDD_Carros.md §9.1, Fase 3, pedido
-- 2026-09-03): campo abierto labrado/sembrado directamente sobre suelo,
-- en paralelo a bancal_cultivo (construcción, sin tocar). idx_casilla es
-- el índice global de casilla dentro de mapa_id (misma convención que el
-- resto del proyecto) -- persistida porque un jugador no puede perder
-- días de trabajo si la room se reinicia (a diferencia de un recolectable
-- silvestre).
CREATE TABLE IF NOT EXISTS casillas_cultivo (
  mapa_id TEXT NOT NULL,
  idx_casilla INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  dueno_id INTEGER NOT NULL,
  estado TEXT NOT NULL,
  semilla_id TEXT,
  dia_plantado INTEGER,
  PRIMARY KEY (mapa_id, idx_casilla)
);
-- Flags globales de un solo valor (pedido 2026-08-30: PvP apagado por
-- defecto, el jarl lo activa) — genérica a propósito, cualquier futuro
-- interruptor de mundo reusa esta MISMA tabla en vez de una columna nueva
-- cada vez ("las listas crecen, el código no").
CREATE TABLE IF NOT EXISTS configuracion_mundo (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
-- Niebla de guerra del mapa de mundo (docs/GDD_Mapa_Mundo.md, pedido
-- 2026-08-31): "aunque mueras sigas teniendo eso descubierto, o si
-- desconectas igual" — un array JSON de sectores empaquetados (mundo/
-- exploracion.ts) por jugador+mapa, reescrito entero en cada revelado
-- nuevo (los revelados son infrecuentes, no vale la pena una fila por
-- sector).
CREATE TABLE IF NOT EXISTS exploracion (
  jugador_id INTEGER NOT NULL,
  mapa_id TEXT NOT NULL,
  sectores TEXT NOT NULL,
  PRIMARY KEY (jugador_id, mapa_id)
);
-- Injertos (docs/GDD_Agricultura.md §4, diseño ya cerrado en
-- Backlog_Mecanicas_Futuras.md "Injertos y cruces de cultivos", construido
-- 2026-08-30): cada especie híbrida creada en una mesa_injertos se
-- registra aquí como PERMANENTE — sobrevive a un reinicio del servidor y
-- se funde en el catálogo de ítems en memoria de cada room al arrancar
-- (RoomExteriorBase.asegurarHibridosCargados). rasgos/meses_siembra viajan
-- como JSON de texto (mismo criterio que "extra" de construcciones).
CREATE TABLE IF NOT EXISTS cultivos_hibridos (
  semilla_id TEXT PRIMARY KEY,          -- itemId de la semilla híbrida generada
  cosecha_id TEXT NOT NULL,             -- itemId del fruto/cosecha que da
  nombre TEXT NOT NULL,                 -- nombre automático, renombrable a mano
  padre_a TEXT NOT NULL,
  padre_b TEXT NOT NULL,
  rasgos TEXT NOT NULL,                 -- JSON de RasgosCultivo
  dias_crecimiento INTEGER NOT NULL,
  meses_siembra TEXT NOT NULL,          -- JSON de number[]
  cosecha_recurrente INTEGER NOT NULL,  -- 0/1 (SQLite no tiene boolean nativo)
  cantidad_por_cosecha INTEGER NOT NULL,
  color_debug TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
-- Cocina (docs/GDD_Cocina.md, pedido 2026-08-30): un plato cocinado en
-- cuenco/cazuela/olla se identifica por el CONJUNTO de tipos de
-- ingrediente usados (clave, ordenada, sin cantidades — misma receta =
-- mismo plato siempre) — permanente, igual criterio que cultivos_hibridos.
CREATE TABLE IF NOT EXISTS platos_creados (
  clave TEXT PRIMARY KEY,               -- itemIds distintos ORDENADOS, unidos por "|" — identidad de la receta
  item_id TEXT NOT NULL,                -- itemId sintético del plato (p.ej. "plato_ab12cd")
  nombre TEXT NOT NULL,                 -- nombre automático ("Guiso de Zanahoria y Carne Roja")
  ingredientes TEXT NOT NULL,           -- JSON string[] (mismos ids que la clave, para lectura humana)
  vida INTEGER NOT NULL,
  estamina INTEGER NOT NULL,
  comida INTEGER NOT NULL,
  bebida INTEGER NOT NULL,
  color_debug TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mazmorras_estado (
  clave TEXT PRIMARY KEY,               -- "mapaId:edificio:nivel"
  limpiada_en TEXT                      -- timestamp ISO de la última vez que se limpió (null = nunca)
);
CREATE TABLE IF NOT EXISTS asentamientos (
  id TEXT PRIMARY KEY,                  -- slug del POI "asentamiento_hostil" ya bakeado por mazmorras/
  bando TEXT NOT NULL DEFAULT 'bandido',
  nivel_muralla INTEGER NOT NULL DEFAULT 1,
  nivel_equipo INTEGER NOT NULL DEFAULT 1,
  comida INTEGER NOT NULL DEFAULT 0,
  madera INTEGER NOT NULL DEFAULT 0,
  piedra INTEGER NOT NULL DEFAULT 0,
  hierro INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tropas_asentamiento (
  id TEXT PRIMARY KEY,                  -- "<asentamientoId>:<n>"
  asentamiento_id TEXT NOT NULL,        -- FK asentamientos.id
  rango TEXT NOT NULL,                  -- 'recluta' | 'guardia' | 'lider'
  estado TEXT NOT NULL DEFAULT 'vivo'   -- 'vivo' | 'muerto' — una baja real NUNCA vuelve a 'vivo' (GDD §1)
);
CREATE INDEX IF NOT EXISTS idx_tropas_asentamiento ON tropas_asentamiento(asentamiento_id);
CREATE TABLE IF NOT EXISTS fauna_salvaje (
  id TEXT PRIMARY KEY,                  -- "<mapaId>:<sectorX>:<sectorY>:<n>"
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  sexo TEXT NOT NULL,                   -- 'macho' | 'hembra'
  etapa TEXT NOT NULL DEFAULT 'adulto', -- 'cria' | 'adulto'
  estado TEXT NOT NULL DEFAULT 'vivo',  -- 'vivo' | 'muerto' — nunca vuelve a 'vivo'
  x REAL NOT NULL,
  y REAL NOT NULL,
  ultima_comida REAL NOT NULL,
  ultima_bebida REAL NOT NULL,
  gestando_desde REAL,
  gestacion_duracion_dias REAL,
  nacio_en REAL,
  vida REAL NOT NULL DEFAULT 0,         -- docs/GDD_Mecanicas.md §5.4: los animales no tienen defensa, solo vida
  vida_max REAL NOT NULL DEFAULT 0,
  ataque REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fauna_salvaje_sector ON fauna_salvaje(mapa_id, sector_x, sector_y);
CREATE TABLE IF NOT EXISTS fauna_huevo (
  id TEXT PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  especie_madre_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  puesto_en REAL NOT NULL,
  duracion_dias REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fauna_huevo_sector ON fauna_huevo(mapa_id, sector_x, sector_y);
CREATE TABLE IF NOT EXISTS fauna_sector_resuelto (
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  ultima_resolucion REAL NOT NULL,
  PRIMARY KEY (mapa_id, sector_x, sector_y)
);
CREATE TABLE IF NOT EXISTS arboles_vivos (
  id TEXT PRIMARY KEY,                  -- "arbol:<mapaId>:<sectorX>:<sectorY>:<n>" (bake talado) o "...:brote:<dia>:<n>" (crecido)
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  etapa TEXT NOT NULL,                  -- 'joven' | 'adulto'
  origen TEXT NOT NULL,                 -- 'bake' | 'propagacion' | 'plantado'
  dia_plantado REAL,                    -- null en origen 'bake' (nace ya adulto, nunca "creció" en el sistema)
  estado TEXT NOT NULL DEFAULT 'vivo'   -- 'vivo' | 'talado' — nunca vuelve a 'vivo'
);
CREATE INDEX IF NOT EXISTS idx_arboles_vivos_sector ON arboles_vivos(mapa_id, sector_x, sector_y);
CREATE TABLE IF NOT EXISTS arboles_sector_resuelto (
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  ultima_resolucion REAL NOT NULL,
  PRIMARY KEY (mapa_id, sector_x, sector_y)
);
CREATE TABLE IF NOT EXISTS cadaveres (
  id TEXT PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  tipo_origen TEXT NOT NULL,        -- 'animal' | 'npc' | 'jugador'
  especie_origen_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  muerto_en REAL NOT NULL,
  contenedor TEXT NOT NULL,         -- JSON del Contenedor (loot), mismo patrón que construcciones.extra
  datos_visual TEXT NOT NULL DEFAULT ''  -- JSON de DatosVisualCadaver (mundo/cadaveres.ts), '' si no aplica
);
CREATE INDEX IF NOT EXISTS idx_cadaveres_mapa ON cadaveres(mapa_id);
CREATE TABLE IF NOT EXISTS animales_granja (
  id TEXT PRIMARY KEY,
  especie_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  propiedad_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  extra TEXT NOT NULL,               -- JSON: {produccion:{leche?/lana?/huevos?: EstadoProduccion}, ultimoDiaEscapeChequeado}
  en_venta_tenderete_id TEXT,        -- NULL = no está en venta (docs/GDD_Mercado.md)
  en_venta_precio INTEGER,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_animales_granja_mapa ON animales_granja(mapa_id);
CREATE INDEX IF NOT EXISTS idx_animales_granja_propiedad ON animales_granja(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_animales_granja_venta ON animales_granja(en_venta_tenderete_id);
CREATE TABLE IF NOT EXISTS memoria_lider (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dia_ingame INTEGER NOT NULL,
  evento TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  tipo TEXT,             -- docs/GDD_Faccion_Bandidos.md §7quinquies: 'tropa_muerta' | 'asentamiento_conquistado' | NULL (eventos viejos, sin tipo)
  asentamiento_id TEXT,  -- NULL si el evento no es de un asentamiento concreto
  jugador TEXT           -- NULL si no hay un jugador concreto atribuible (o el evento es viejo)
);
-- Inventario (docs/Backlog_Mecanicas_Futuras.md "Inventario, contenedores y
-- objetos en el mundo" + server/src/inventario/inventario.ts, pedido
-- 2026-08-29 fase 1). Un contenedor = una rejilla ("cuerpo", "mochila_1"...);
-- items es el array de ItemInstancia serializado, igual que construcciones.extra.
CREATE TABLE IF NOT EXISTS inventarios (
  jugador_id INTEGER NOT NULL,
  contenedor_id TEXT NOT NULL,
  ancho INTEGER NOT NULL,
  alto INTEGER NOT NULL,
  siguiente_id INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL,
  PRIMARY KEY (jugador_id, contenedor_id)
);
-- Equipo: slots con nombre (no rejilla) — un ítem por slot, mismos ids que
-- items/catalogo/items.json (campo slotEquipo).
CREATE TABLE IF NOT EXISTS equipo (
  jugador_id INTEGER NOT NULL,
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (jugador_id, slot)
);
-- Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre legendario, pedido
-- 2026-08-31): blueprint permanente de una prenda bakeada por un sastre en
-- el telar — id autoincremental (nunca deduplicado por contenido, a
-- diferencia de platos_creados: dos sastres con el mismo prompt NO
-- comparten diseño, cada tirada es su propio blueprint).
CREATE TABLE IF NOT EXISTS prendas_generadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creador_id INTEGER NOT NULL,          -- FK jugadores.id — solo él puede craftear copias después
  prenda_base_id TEXT NOT NULL,         -- id real de ropa/catalogo/prendas.json
  material_id TEXT NOT NULL,
  detalle TEXT NOT NULL,                -- JSON (override sobre el detalle del arquetipo)
  tintes TEXT NOT NULL,                 -- JSON (zona -> color hex)
  nombre TEXT NOT NULL,
  prompt_texto TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prendas_generadas_creador ON prendas_generadas(creador_id);
-- Carpintero legendario (docs/GDD_Ropa_Procedural.md §Carpintero legendario) — mismo patrón exacto que prendas_generadas.
CREATE TABLE IF NOT EXISTS muebles_generados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creador_id INTEGER NOT NULL,
  arquetipo_id TEXT NOT NULL,
  parametros TEXT NOT NULL,
  nombre TEXT NOT NULL,
  prompt_texto TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_muebles_generados_creador ON muebles_generados(creador_id);
-- Ingeniero legendario (docs/GDD_Ropa_Procedural.md §Ingeniero legendario) — mismo patrón exacto.
CREATE TABLE IF NOT EXISTS edificios_generados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creador_id INTEGER NOT NULL,
  tipo_edificio TEXT NOT NULL,
  parametros TEXT NOT NULL,
  nombre TEXT NOT NULL,
  prompt_texto TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edificios_generados_creador ON edificios_generados(creador_id);
-- Librería (docs/GDD_Libreria.md, pedido 2026-09-01) — mismo patrón exacto que prendas_generadas/muebles_generados/edificios_generados.
CREATE TABLE IF NOT EXISTS libros_generados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autor_id INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  paginas TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_libros_generados_autor ON libros_generados(autor_id);
`;

const MIGRACIONES_POSTGRES = `
CREATE TABLE IF NOT EXISTS jugadores (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  creado_en TEXT NOT NULL,
  farycoins INTEGER NOT NULL DEFAULT 0
);
-- ALTER ... IF NOT EXISTS: primera vez que se amplía una tabla YA
-- desplegada en Neon (hasta ahora todo era CREATE TABLE de cero) — Postgres
-- lo soporta nativo, no rompe nada si la columna ya existe.
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS farycoins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS vida INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS vida_max INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS anatomia TEXT;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS enfermedades TEXT;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS oficio_1 TEXT NOT NULL DEFAULT '';
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS oficio_2 TEXT NOT NULL DEFAULT '';
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS cambios_oficio INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS ultimo_tejido_legendario_ms BIGINT;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS ultimo_carpinteria_legendaria_ms BIGINT;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS ultimo_ingenieria_legendaria_ms BIGINT;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS comida INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS bebida INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS sueno INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS estamina INTEGER NOT NULL DEFAULT 100;
-- NPCs tutoriales fijos (docs/GDD_Profesiones.md ronda 3) — ver comentario gemelo en MIGRACIONES_SQLITE.
CREATE TABLE IF NOT EXISTS npcs_tutoriales (
  id SERIAL PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  tipo_tutorial TEXT NOT NULL,
  nombre TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  colocado_por TEXT NOT NULL,
  colocado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npcs_tutoriales_mapa ON npcs_tutoriales(mapa_id);
-- Cuentas de admin (docs/GDD_Admin.md, pedido 2026-08-30) — ver comentario
-- gemelo en MIGRACIONES_SQLITE, misma tabla exacta.
CREATE TABLE IF NOT EXISTS admin_cuentas (
  id SERIAL PRIMARY KEY,
  usuario TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  twitch_login TEXT UNIQUE,
  rol TEXT NOT NULL,
  mapa_id TEXT,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gremios (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  lider_jugador_id INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#8a8a8a',
  emblema_id TEXT NOT NULL DEFAULT 'emblema_generico',
  saldo_banco INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gremio_miembros (
  gremio_id INTEGER NOT NULL,
  jugador_id INTEGER NOT NULL,
  rol TEXT NOT NULL DEFAULT 'miembro',
  ingreso_en TEXT NOT NULL,
  PRIMARY KEY (gremio_id, jugador_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gremio_miembros_jugador ON gremio_miembros(jugador_id);
CREATE TABLE IF NOT EXISTS gremio_invitaciones (
  gremio_id INTEGER NOT NULL,
  jugador_id INTEGER NOT NULL,
  invitado_por INTEGER NOT NULL,
  creado_en TEXT NOT NULL,
  PRIMARY KEY (gremio_id, jugador_id)
);
CREATE TABLE IF NOT EXISTS gremio_inventario (
  gremio_id INTEGER PRIMARY KEY,
  ancho INTEGER NOT NULL,
  alto INTEGER NOT NULL,
  siguiente_id INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propiedades (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  asentamiento TEXT NOT NULL,
  dueno INTEGER,
  asignada_en TEXT,
  modo_tenencia TEXT,
  precio_farycoins INTEGER,
  periodo_horas INTEGER,
  expira_en TEXT
);
-- ALTER ... IF NOT EXISTS: mismo patrón que farycoins arriba — "propiedades"
-- ya existe desplegada en Neon desde v1 de construcción (docs/GDD_Construccion.md).
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS modo_tenencia TEXT;
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS precio_farycoins INTEGER;
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS periodo_horas INTEGER;
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS expira_en TEXT;
-- Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30).
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS impuesto_activo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS impuesto_farycoins INTEGER;
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS impuesto_periodo_horas INTEGER;
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS impuesto_ultimo_cobro TEXT;
CREATE TABLE IF NOT EXISTS construcciones (
  id SERIAL PRIMARY KEY,
  propiedad TEXT NOT NULL,
  objeto TEXT NOT NULL,
  categoria TEXT NOT NULL,
  x INTEGER NOT NULL, y INTEGER NOT NULL,
  rot INTEGER NOT NULL DEFAULT 0,
  variante INTEGER NOT NULL DEFAULT 0,
  extra TEXT,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_construcciones_prop ON construcciones(propiedad);
CREATE TABLE IF NOT EXISTS tenderete_items (
  tenderete_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  precio_farycoins INTEGER NOT NULL,
  PRIMARY KEY (tenderete_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_tenderete_items_tenderete ON tenderete_items(tenderete_id);
-- Mercado v2 (docs/GDD_Mercado.md §12) — ver comentario del motor SQLite.
CREATE TABLE IF NOT EXISTS tenderete_caja (
  tenderete_id TEXT PRIMARY KEY,
  farycoins INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS npc_comerciantes (
  nombre TEXT PRIMARY KEY,
  ultimo_dia_ingreso INTEGER NOT NULL,
  ultimo_reset_stock_ms BIGINT
);
-- Mercaderes por oficio (docs/GDD_Economia.md §9, pedido 2026-08-31) — tabla
-- ya desplegada sin esta columna en Neon.
ALTER TABLE npc_comerciantes ADD COLUMN IF NOT EXISTS ultimo_reset_stock_ms BIGINT;
CREATE TABLE IF NOT EXISTS contratos_transporte (
  id SERIAL PRIMARY KEY,
  origen_construccion_id INTEGER NOT NULL,
  destino_tenderete_id TEXT NOT NULL,
  dueno INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  camino_ida TEXT NOT NULL,
  camino_vuelta TEXT NOT NULL,
  duracion_viaje_seg REAL NOT NULL,
  carga_por_viaje INTEGER NOT NULL DEFAULT 10,
  ultimo_viaje_resuelto TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contratos_origen ON contratos_transporte(origen_construccion_id);
CREATE INDEX IF NOT EXISTS idx_contratos_destino ON contratos_transporte(destino_tenderete_id);
-- Fusión "transporte" como oficio de trabajador (docs/GDD_NPCs_Contratables.md) — tabla ya desplegada sin esta columna en Neon.
ALTER TABLE contratos_transporte ADD COLUMN IF NOT EXISTS trabajador_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_contratos_trabajador ON contratos_transporte(trabajador_id);
-- NPCs trabajadores contratables — ver comentario gemelo en MIGRACIONES_SQLITE.
CREATE TABLE IF NOT EXISTS npcs_trabajadores (
  id SERIAL PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  dueno_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  oficios TEXT NOT NULL,
  construccion_id INTEGER,
  receta_id TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  fecha_contratacion_dia INTEGER NOT NULL,
  ultimo_pago_dia INTEGER NOT NULL,
  creado_en TEXT NOT NULL
);
ALTER TABLE npcs_trabajadores ADD COLUMN IF NOT EXISTS mascota_asignada_id INTEGER;
ALTER TABLE npcs_trabajadores ADD COLUMN IF NOT EXISTS conjunto_asignado_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_npcs_trabajadores_dueno ON npcs_trabajadores(dueno_id);
CREATE INDEX IF NOT EXISTS idx_npcs_trabajadores_mapa ON npcs_trabajadores(mapa_id);
CREATE TABLE IF NOT EXISTS jugador_oficios (
  jugador_id INTEGER NOT NULL,
  oficio TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jugador_id, oficio)
);
CREATE TABLE IF NOT EXISTS jugador_atributos (
  jugador_id INTEGER NOT NULL,
  atributo TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  ultimo_dia_actividad INTEGER,
  PRIMARY KEY (jugador_id, atributo)
);
ALTER TABLE jugador_atributos ADD COLUMN IF NOT EXISTS ultimo_dia_actividad INTEGER;
CREATE TABLE IF NOT EXISTS mascotas (
  id SERIAL PRIMARY KEY,
  jugador_id INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  ubicacion TEXT NOT NULL DEFAULT 'siguiendo',
  propiedad_id TEXT,
  creado_en TEXT NOT NULL,
  montura BOOLEAN NOT NULL DEFAULT FALSE,
  arnes BOOLEAN NOT NULL DEFAULT FALSE,
  arnes_peso_maximo DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS companeros (
  id SERIAL PRIMARY KEY,
  jugador_id INTEGER NOT NULL,
  companero_jugador_id INTEGER NOT NULL,
  npc_origen_slot TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  ubicacion TEXT NOT NULL DEFAULT 'siguiendo',
  propiedad_id TEXT,
  creado_en TEXT NOT NULL
);
ALTER TABLE mascotas ADD COLUMN IF NOT EXISTS montura BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mascotas ADD COLUMN IF NOT EXISTS arnes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mascotas ADD COLUMN IF NOT EXISTS arnes_peso_maximo DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS barcos (
  id SERIAL PRIMARY KEY,
  jugador_id INTEGER NOT NULL,
  tipo_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS carros (
  id SERIAL PRIMARY KEY,
  jugador_id INTEGER NOT NULL,
  tipo_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  creado_en TEXT NOT NULL,
  contenido TEXT
);
ALTER TABLE carros ADD COLUMN IF NOT EXISTS contenido TEXT;
CREATE TABLE IF NOT EXISTS conjuntos_tiro (
  id SERIAL PRIMARY KEY,
  jugador_id INTEGER NOT NULL,
  mascota_id INTEGER NOT NULL,
  especie_animal_id TEXT NOT NULL,
  carro_tipo_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  creado_en TEXT NOT NULL,
  contenido TEXT
);
ALTER TABLE conjuntos_tiro ADD COLUMN IF NOT EXISTS contenido TEXT;
CREATE TABLE IF NOT EXISTS casillas_cultivo (
  mapa_id TEXT NOT NULL,
  idx_casilla INTEGER NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  dueno_id INTEGER NOT NULL,
  estado TEXT NOT NULL,
  semilla_id TEXT,
  dia_plantado INTEGER,
  PRIMARY KEY (mapa_id, idx_casilla)
);
CREATE TABLE IF NOT EXISTS configuracion_mundo (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exploracion (
  jugador_id INTEGER NOT NULL,
  mapa_id TEXT NOT NULL,
  sectores TEXT NOT NULL,
  PRIMARY KEY (jugador_id, mapa_id)
);
CREATE TABLE IF NOT EXISTS cultivos_hibridos (
  semilla_id TEXT PRIMARY KEY,
  cosecha_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  padre_a TEXT NOT NULL,
  padre_b TEXT NOT NULL,
  rasgos TEXT NOT NULL,
  dias_crecimiento INTEGER NOT NULL,
  meses_siembra TEXT NOT NULL,
  cosecha_recurrente INTEGER NOT NULL,
  cantidad_por_cosecha INTEGER NOT NULL,
  color_debug TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platos_creados (
  clave TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  ingredientes TEXT NOT NULL,
  vida INTEGER NOT NULL,
  estamina INTEGER NOT NULL,
  comida INTEGER NOT NULL,
  bebida INTEGER NOT NULL,
  color_debug TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mazmorras_estado (
  clave TEXT PRIMARY KEY,
  limpiada_en TEXT
);
CREATE TABLE IF NOT EXISTS asentamientos (
  id TEXT PRIMARY KEY,
  bando TEXT NOT NULL DEFAULT 'bandido',
  nivel_muralla INTEGER NOT NULL DEFAULT 1,
  nivel_equipo INTEGER NOT NULL DEFAULT 1,
  comida INTEGER NOT NULL DEFAULT 0,
  madera INTEGER NOT NULL DEFAULT 0,
  piedra INTEGER NOT NULL DEFAULT 0,
  hierro INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tropas_asentamiento (
  id TEXT PRIMARY KEY,
  asentamiento_id TEXT NOT NULL,
  rango TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'vivo'
);
CREATE INDEX IF NOT EXISTS idx_tropas_asentamiento ON tropas_asentamiento(asentamiento_id);
CREATE TABLE IF NOT EXISTS fauna_salvaje (
  id TEXT PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  sexo TEXT NOT NULL,
  etapa TEXT NOT NULL DEFAULT 'adulto',
  estado TEXT NOT NULL DEFAULT 'vivo',
  x REAL NOT NULL,
  y REAL NOT NULL,
  ultima_comida REAL NOT NULL,
  ultima_bebida REAL NOT NULL,
  gestando_desde REAL,
  gestacion_duracion_dias REAL,
  nacio_en REAL,
  vida REAL NOT NULL DEFAULT 0,         -- docs/GDD_Mecanicas.md §5.4: los animales no tienen defensa, solo vida
  vida_max REAL NOT NULL DEFAULT 0,
  ataque REAL NOT NULL DEFAULT 0
);
-- ALTER ... IF NOT EXISTS: mismo patrón que farycoins arriba — fauna_salvaje
-- puede ya estar desplegada en Neon desde la fase 2 de fauna salvaje.
ALTER TABLE fauna_salvaje ADD COLUMN IF NOT EXISTS vida REAL NOT NULL DEFAULT 0;
ALTER TABLE fauna_salvaje ADD COLUMN IF NOT EXISTS vida_max REAL NOT NULL DEFAULT 0;
ALTER TABLE fauna_salvaje ADD COLUMN IF NOT EXISTS ataque REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_fauna_salvaje_sector ON fauna_salvaje(mapa_id, sector_x, sector_y);
CREATE TABLE IF NOT EXISTS fauna_huevo (
  id TEXT PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  especie_madre_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  puesto_en REAL NOT NULL,
  duracion_dias REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fauna_huevo_sector ON fauna_huevo(mapa_id, sector_x, sector_y);
CREATE TABLE IF NOT EXISTS fauna_sector_resuelto (
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  ultima_resolucion REAL NOT NULL,
  PRIMARY KEY (mapa_id, sector_x, sector_y)
);
CREATE TABLE IF NOT EXISTS arboles_vivos (
  id TEXT PRIMARY KEY,                  -- "arbol:<mapaId>:<sectorX>:<sectorY>:<n>" (bake talado) o "...:brote:<dia>:<n>" (crecido)
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  etapa TEXT NOT NULL,                  -- 'joven' | 'adulto'
  origen TEXT NOT NULL,                 -- 'bake' | 'propagacion' | 'plantado'
  dia_plantado REAL,                    -- null en origen 'bake' (nace ya adulto, nunca "creció" en el sistema)
  estado TEXT NOT NULL DEFAULT 'vivo'   -- 'vivo' | 'talado' — nunca vuelve a 'vivo'
);
CREATE INDEX IF NOT EXISTS idx_arboles_vivos_sector ON arboles_vivos(mapa_id, sector_x, sector_y);
CREATE TABLE IF NOT EXISTS arboles_sector_resuelto (
  mapa_id TEXT NOT NULL,
  sector_x INTEGER NOT NULL,
  sector_y INTEGER NOT NULL,
  ultima_resolucion REAL NOT NULL,
  PRIMARY KEY (mapa_id, sector_x, sector_y)
);
CREATE TABLE IF NOT EXISTS cadaveres (
  id TEXT PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  tipo_origen TEXT NOT NULL,
  especie_origen_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  muerto_en REAL NOT NULL,
  contenedor TEXT NOT NULL
);
ALTER TABLE cadaveres ADD COLUMN IF NOT EXISTS datos_visual TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_cadaveres_mapa ON cadaveres(mapa_id);
CREATE TABLE IF NOT EXISTS animales_granja (
  id TEXT PRIMARY KEY,
  especie_id TEXT NOT NULL,
  mapa_id TEXT NOT NULL,
  propiedad_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  extra TEXT NOT NULL,
  en_venta_tenderete_id TEXT,
  en_venta_precio INTEGER,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_animales_granja_mapa ON animales_granja(mapa_id);
CREATE INDEX IF NOT EXISTS idx_animales_granja_propiedad ON animales_granja(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_animales_granja_venta ON animales_granja(en_venta_tenderete_id);
CREATE TABLE IF NOT EXISTS memoria_lider (
  id SERIAL PRIMARY KEY,
  dia_ingame INTEGER NOT NULL,
  evento TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  tipo TEXT,
  asentamiento_id TEXT,
  jugador TEXT
);
ALTER TABLE memoria_lider ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE memoria_lider ADD COLUMN IF NOT EXISTS asentamiento_id TEXT;
ALTER TABLE memoria_lider ADD COLUMN IF NOT EXISTS jugador TEXT;
CREATE TABLE IF NOT EXISTS inventarios (
  jugador_id INTEGER NOT NULL,
  contenedor_id TEXT NOT NULL,
  ancho INTEGER NOT NULL,
  alto INTEGER NOT NULL,
  siguiente_id INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL,
  PRIMARY KEY (jugador_id, contenedor_id)
);
CREATE TABLE IF NOT EXISTS equipo (
  jugador_id INTEGER NOT NULL,
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (jugador_id, slot)
);
CREATE TABLE IF NOT EXISTS prendas_generadas (
  id SERIAL PRIMARY KEY,
  creador_id INTEGER NOT NULL,
  prenda_base_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  detalle TEXT NOT NULL,
  tintes TEXT NOT NULL,
  nombre TEXT NOT NULL,
  prompt_texto TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prendas_generadas_creador ON prendas_generadas(creador_id);
CREATE TABLE IF NOT EXISTS muebles_generados (
  id SERIAL PRIMARY KEY,
  creador_id INTEGER NOT NULL,
  arquetipo_id TEXT NOT NULL,
  parametros TEXT NOT NULL,
  nombre TEXT NOT NULL,
  prompt_texto TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_muebles_generados_creador ON muebles_generados(creador_id);
CREATE TABLE IF NOT EXISTS edificios_generados (
  id SERIAL PRIMARY KEY,
  creador_id INTEGER NOT NULL,
  tipo_edificio TEXT NOT NULL,
  parametros TEXT NOT NULL,
  nombre TEXT NOT NULL,
  prompt_texto TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edificios_generados_creador ON edificios_generados(creador_id);
CREATE TABLE IF NOT EXISTS libros_generados (
  id SERIAL PRIMARY KEY,
  autor_id INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  paginas TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_libros_generados_autor ON libros_generados(autor_id);
`;

// Mapeo de fila cruda (SQLite o Postgres, misma forma de columnas) a los
// tipos de reproduccionFauna.ts — compartido por los dos motores para no
// duplicar el mapeo de cada campo dos veces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaFaunaSalvajeDesdeSql(f: any): FaunaSalvajeFila {
  return {
    id: String(f.id),
    mapaId: String(f.mapa_id),
    sectorX: Number(f.sector_x),
    sectorY: Number(f.sector_y),
    especieId: String(f.especie_id),
    sexo: String(f.sexo) as SexoFauna,
    etapa: String(f.etapa) as EtapaFauna,
    estado: String(f.estado) as EstadoFaunaSalvaje,
    x: Number(f.x),
    y: Number(f.y),
    ultimaComida: Number(f.ultima_comida),
    ultimaBebida: Number(f.ultima_bebida),
    gestandoDesde: f.gestando_desde === null || f.gestando_desde === undefined ? null : Number(f.gestando_desde),
    gestacionDuracionDias:
      f.gestacion_duracion_dias === null || f.gestacion_duracion_dias === undefined
        ? null
        : Number(f.gestacion_duracion_dias),
    nacioEn: f.nacio_en === null || f.nacio_en === undefined ? null : Number(f.nacio_en),
    vida: Number(f.vida),
    vidaMax: Number(f.vida_max),
    ataque: Number(f.ataque),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaFaunaHuevoDesdeSql(f: any): FaunaHuevoFila {
  return {
    id: String(f.id),
    mapaId: String(f.mapa_id),
    sectorX: Number(f.sector_x),
    sectorY: Number(f.sector_y),
    especieMadreId: String(f.especie_madre_id),
    x: Number(f.x),
    y: Number(f.y),
    puestoEn: Number(f.puesto_en),
    duracionDias: Number(f.duracion_dias),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaArbolVivoDesdeSql(f: any): ArbolVivoFila {
  return {
    id: String(f.id),
    mapaId: String(f.mapa_id),
    sectorX: Number(f.sector_x),
    sectorY: Number(f.sector_y),
    especieId: String(f.especie_id),
    x: Number(f.x),
    y: Number(f.y),
    etapa: String(f.etapa) as EtapaArbol,
    origen: String(f.origen) as OrigenArbol,
    diaPlantado: f.dia_plantado === null || f.dia_plantado === undefined ? null : Number(f.dia_plantado),
    estado: String(f.estado) as EstadoArbol,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAMemoriaLider(f: any): MemoriaLider {
  return {
    id: Number(f.id),
    diaIngame: Number(f.dia_ingame),
    evento: String(f.evento),
    tipo: f.tipo == null ? null : (String(f.tipo) as MemoriaLider["tipo"]),
    asentamientoId: f.asentamiento_id == null ? null : String(f.asentamiento_id),
    jugador: f.jugador == null ? null : String(f.jugador),
  };
}

function filaCadaverDesdeSql(f: any): CadaverFila {
  return {
    id: String(f.id),
    mapaId: String(f.mapa_id),
    tipoOrigen: String(f.tipo_origen) as TipoOrigenCadaver,
    especieOrigenId: String(f.especie_origen_id),
    x: Number(f.x),
    y: Number(f.y),
    muertoEn: Number(f.muerto_en),
    contenedor: JSON.parse(f.contenedor) as Contenedor,
    datosVisual: f.datos_visual == null ? "" : String(f.datos_visual),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAnimalGranjaDesdeSql(f: any): AnimalGranjaFila {
  return {
    id: String(f.id),
    especieId: String(f.especie_id),
    mapaId: String(f.mapa_id),
    propiedadId: String(f.propiedad_id),
    x: Number(f.x),
    y: Number(f.y),
    extra: JSON.parse(f.extra) as Record<string, unknown>,
    enVentaTenderoteId: f.en_venta_tenderete_id === null || f.en_venta_tenderete_id === undefined ? null : String(f.en_venta_tenderete_id),
    enVentaPrecio: f.en_venta_precio === null || f.en_venta_precio === undefined ? null : Number(f.en_venta_precio),
    creadoEn: String(f.creado_en),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAMascota(f: any): Mascota {
  return {
    id: Number(f.id),
    jugadorId: Number(f.jugador_id),
    especieId: String(f.especie_id),
    ubicacion: String(f.ubicacion) as UbicacionMascota,
    propiedadId: f.propiedad_id === null || f.propiedad_id === undefined ? null : String(f.propiedad_id),
    creadoEn: String(f.creado_en),
    montura: !!f.montura,
    arnes: !!f.arnes,
    arnesPesoMaximo: Number(f.arnes_peso_maximo ?? 0),
  };
}

function filaACompanero(f: any): Companero {
  return {
    id: Number(f.id),
    jugadorId: Number(f.jugador_id),
    companeroJugadorId: Number(f.companero_jugador_id),
    npcOrigenSlot: String(f.npc_origen_slot),
    nombre: String(f.nombre),
    xp: Number(f.xp),
    ubicacion: String(f.ubicacion) as UbicacionMascota,
    propiedadId: f.propiedad_id === null || f.propiedad_id === undefined ? null : String(f.propiedad_id),
    creadoEn: String(f.creado_en),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaABarco(f: any): Barco {
  return {
    id: Number(f.id),
    jugadorId: Number(f.jugador_id),
    tipoId: String(f.tipo_id),
    mapaId: String(f.mapa_id),
    x: Number(f.x),
    y: Number(f.y),
    creadoEn: String(f.creado_en),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaACarro(f: any): Carro {
  return {
    id: Number(f.id),
    jugadorId: Number(f.jugador_id),
    tipoId: String(f.tipo_id),
    mapaId: String(f.mapa_id),
    x: Number(f.x),
    y: Number(f.y),
    creadoEn: String(f.creado_en),
    contenido: f.contenido == null ? null : (JSON.parse(String(f.contenido)) as ContenidoCarro),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAConjuntoTiro(f: any): ConjuntoTiro {
  return {
    id: Number(f.id),
    jugadorId: Number(f.jugador_id),
    mascotaId: Number(f.mascota_id),
    especieAnimalId: String(f.especie_animal_id),
    carroTipoId: String(f.carro_tipo_id),
    mapaId: String(f.mapa_id),
    x: Number(f.x),
    y: Number(f.y),
    creadoEn: String(f.creado_en),
    contenido: f.contenido == null ? null : (JSON.parse(String(f.contenido)) as ContenidoCarro),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaACasillaCultivo(f: any): CasillaCultivo {
  return {
    mapaId: String(f.mapa_id),
    idxCasilla: Number(f.idx_casilla),
    x: Number(f.x),
    y: Number(f.y),
    duenoId: Number(f.dueno_id),
    estado: String(f.estado) as "labrada" | "sembrada",
    semillaId: f.semilla_id === null || f.semilla_id === undefined ? null : String(f.semilla_id),
    diaPlantado: f.dia_plantado === null || f.dia_plantado === undefined ? null : Number(f.dia_plantado),
  };
}

function filaACultivoHibrido(f: any): CultivoHibrido {
  return {
    semillaId: String(f.semilla_id),
    cosechaId: String(f.cosecha_id),
    nombre: String(f.nombre),
    padreA: String(f.padre_a),
    padreB: String(f.padre_b),
    rasgos: JSON.parse(f.rasgos),
    diasCrecimiento: Number(f.dias_crecimiento),
    mesesSiembra: JSON.parse(f.meses_siembra),
    cosechaRecurrente: Number(f.cosecha_recurrente) === 1,
    cantidadPorCosecha: Number(f.cantidad_por_cosecha),
    colorDebug: String(f.color_debug),
    creadoEn: String(f.creado_en),
  };
}

function filaAPlatoCreado(f: any): PlatoCreado {
  return {
    clave: String(f.clave),
    itemId: String(f.item_id),
    nombre: String(f.nombre),
    ingredientes: JSON.parse(f.ingredientes),
    vida: Number(f.vida),
    estamina: Number(f.estamina),
    comida: Number(f.comida),
    bebida: Number(f.bebida),
    colorDebug: String(f.color_debug),
    creadoEn: String(f.creado_en),
  };
}

function filaAPrendaGenerada(f: any): PrendaGenerada {
  return {
    id: Number(f.id),
    creadorId: Number(f.creador_id),
    prendaBaseId: String(f.prenda_base_id),
    materialId: String(f.material_id),
    detalle: JSON.parse(f.detalle),
    tintes: JSON.parse(f.tintes),
    nombre: String(f.nombre),
    promptTexto: String(f.prompt_texto),
    creadoEn: String(f.creado_en),
  };
}

function filaAMuebleGenerado(f: any): MuebleGenerado {
  return {
    id: Number(f.id),
    creadorId: Number(f.creador_id),
    arquetipoId: String(f.arquetipo_id),
    parametros: JSON.parse(f.parametros),
    nombre: String(f.nombre),
    promptTexto: String(f.prompt_texto),
    creadoEn: String(f.creado_en),
  };
}

function filaAEdificioGenerado(f: any): EdificioGenerado {
  return {
    id: Number(f.id),
    creadorId: Number(f.creador_id),
    tipoEdificio: String(f.tipo_edificio),
    parametros: JSON.parse(f.parametros),
    nombre: String(f.nombre),
    promptTexto: String(f.prompt_texto),
    creadoEn: String(f.creado_en),
  };
}

function filaALibroGenerado(f: any): LibroGenerado {
  return {
    id: Number(f.id),
    autorId: Number(f.autor_id),
    titulo: String(f.titulo),
    paginas: JSON.parse(f.paginas),
    creadoEn: String(f.creado_en),
  };
}

function filaACuentaAdmin(f: any): CuentaAdmin {
  return {
    id: Number(f.id),
    usuario: String(f.usuario),
    passwordHash: f.password_hash == null ? null : String(f.password_hash),
    twitchLogin: f.twitch_login == null ? null : String(f.twitch_login),
    rol: f.rol as RolAdmin,
    mapaId: f.mapa_id == null ? null : String(f.mapa_id),
    creadoEn: String(f.creado_en),
  };
}

// ---------------------------------------------------------------------------
// Motor SQLite — desarrollo/pruebas. Constructor síncrono (como siempre);
// los métodos se declaran `async` solo para devolver Promise y cumplir
// IAlmacenDatos — el trabajo real sigue siendo síncrono, cero coste.
// ---------------------------------------------------------------------------
export class AlmacenDatosSqlite implements IAlmacenDatos {
  private bd: BaseDatosSync;

  constructor(ruta?: string) {
    // __dirname = server/src/datos (o dist/datos compilado): dos niveles arriba = carpeta server.
    const rutaFinal = ruta ?? process.env.BD_RUTA ?? path.join(__dirname, "..", "..", "datos.sqlite");
    this.bd = new DatabaseSync(rutaFinal);
    // CREATE ... IF NOT EXISTS en todo: abrir dos veces el mismo archivo es inocuo.
    this.bd.exec(MIGRACIONES_SQLITE);
    // SQLite no tiene "ADD COLUMN IF NOT EXISTS" portable entre versiones —
    // CREATE TABLE IF NOT EXISTS no amplía una tabla que YA existía sin la
    // columna nueva (un datos.sqlite de dev creado antes de este cambio).
    // PRAGMA table_info + ALTER manual es el mismo patrón que ya usa Postgres
    // (columna nueva sobre tabla desplegada), aplicado a mano aquí.
    const columnas = this.bd.prepare("PRAGMA table_info(jugadores)").all();
    const nombresJugadores = new Set(columnas.map((c) => String(c.name)));
    if (!nombresJugadores.has("farycoins")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN farycoins INTEGER NOT NULL DEFAULT 0");
    }
    if (!nombresJugadores.has("vida")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN vida INTEGER NOT NULL DEFAULT 100");
    }
    if (!nombresJugadores.has("vida_max")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN vida_max INTEGER NOT NULL DEFAULT 100");
    }
    if (!nombresJugadores.has("anatomia")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN anatomia TEXT");
    }
    if (!nombresJugadores.has("enfermedades")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN enfermedades TEXT");
    }
    if (!nombresJugadores.has("oficio_1")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN oficio_1 TEXT NOT NULL DEFAULT ''");
    }
    if (!nombresJugadores.has("oficio_2")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN oficio_2 TEXT NOT NULL DEFAULT ''");
    }
    if (!nombresJugadores.has("cambios_oficio")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN cambios_oficio INTEGER NOT NULL DEFAULT 0");
    }
    if (!nombresJugadores.has("ultimo_tejido_legendario_ms")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN ultimo_tejido_legendario_ms INTEGER");
    }
    if (!nombresJugadores.has("ultimo_carpinteria_legendaria_ms")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN ultimo_carpinteria_legendaria_ms INTEGER");
    }
    if (!nombresJugadores.has("ultimo_ingenieria_legendaria_ms")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN ultimo_ingenieria_legendaria_ms INTEGER");
    }
    if (!nombresJugadores.has("comida")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN comida INTEGER NOT NULL DEFAULT 100");
    }
    if (!nombresJugadores.has("bebida")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN bebida INTEGER NOT NULL DEFAULT 100");
    }
    if (!nombresJugadores.has("sueno")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN sueno INTEGER NOT NULL DEFAULT 100");
    }
    if (!nombresJugadores.has("estamina")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN estamina INTEGER NOT NULL DEFAULT 100");
    }
    // Mismo patrón para las 4 columnas de tenencia comercial de `propiedades`
    // (docs/GDD_Propiedades.md) — un datos.sqlite de dev creado antes de este
    // cambio no las tendría; CREATE TABLE IF NOT EXISTS no amplía una tabla ya existente.
    const columnasPropiedades = this.bd.prepare("PRAGMA table_info(propiedades)").all();
    const nombresPropiedades = new Set(columnasPropiedades.map((c) => String(c.name)));
    for (const [col, tipo] of [
      ["modo_tenencia", "TEXT"],
      ["precio_farycoins", "INTEGER"],
      ["periodo_horas", "INTEGER"],
      ["expira_en", "TEXT"],
      // Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30).
      ["impuesto_activo", "INTEGER NOT NULL DEFAULT 0"],
      ["impuesto_farycoins", "INTEGER"],
      ["impuesto_periodo_horas", "INTEGER"],
      ["impuesto_ultimo_cobro", "TEXT"],
    ] as const) {
      if (!nombresPropiedades.has(col)) this.bd.exec(`ALTER TABLE propiedades ADD COLUMN ${col} ${tipo}`);
    }
    // Mismo patrón para `ultimo_dia_actividad` de `jugador_atributos`
    // (docs/GDD_Personaje.md §3.5, actividades diarias de entrenamiento) —
    // un datos.sqlite de dev creado antes de este cambio no la tendría.
    const columnasAtributos = this.bd.prepare("PRAGMA table_info(jugador_atributos)").all();
    if (!columnasAtributos.some((c) => String(c.name) === "ultimo_dia_actividad")) {
      this.bd.exec("ALTER TABLE jugador_atributos ADD COLUMN ultimo_dia_actividad INTEGER");
    }
    // Mismo patrón para `montura` de `mascotas` (docs/GDD_Monturas.md,
    // pedido 2026-08-30) — un datos.sqlite de dev creado antes de este
    // cambio no la tendría.
    const columnasMascotas = this.bd.prepare("PRAGMA table_info(mascotas)").all();
    if (!columnasMascotas.some((c) => String(c.name) === "montura")) {
      this.bd.exec("ALTER TABLE mascotas ADD COLUMN montura INTEGER NOT NULL DEFAULT 0");
    }
    // Mismo patrón para `arnes`/`arnes_peso_maximo` de `mascotas`
    // (docs/GDD_Carros.md §2, pedido 2026-09-03) — un datos.sqlite de dev
    // creado antes de este cambio no las tendría.
    if (!columnasMascotas.some((c) => String(c.name) === "arnes")) {
      this.bd.exec("ALTER TABLE mascotas ADD COLUMN arnes INTEGER NOT NULL DEFAULT 0");
    }
    if (!columnasMascotas.some((c) => String(c.name) === "arnes_peso_maximo")) {
      this.bd.exec("ALTER TABLE mascotas ADD COLUMN arnes_peso_maximo REAL NOT NULL DEFAULT 0");
    }
    // Mismo patrón para `contenido` de `carros`/`conjuntos_tiro`
    // (docs/GDD_Carros.md §8, Fase 2, pedido 2026-09-03) — un datos.sqlite
    // de dev creado en Fase 1 no la tendría todavía.
    const columnasCarros = this.bd.prepare("PRAGMA table_info(carros)").all();
    if (!columnasCarros.some((c) => String(c.name) === "contenido")) {
      this.bd.exec("ALTER TABLE carros ADD COLUMN contenido TEXT");
    }
    const columnasConjuntosTiro = this.bd.prepare("PRAGMA table_info(conjuntos_tiro)").all();
    if (!columnasConjuntosTiro.some((c) => String(c.name) === "contenido")) {
      this.bd.exec("ALTER TABLE conjuntos_tiro ADD COLUMN contenido TEXT");
    }
    // Mismo patrón para tipo/asentamiento_id/jugador de `memoria_lider`
    // (docs/GDD_Faccion_Bandidos.md §7quinquies) — un datos.sqlite de dev
    // creado antes de este cambio no las tendría.
    const columnasMemoriaLider = this.bd.prepare("PRAGMA table_info(memoria_lider)").all();
    const nombresMemoriaLider = new Set(columnasMemoriaLider.map((c) => String(c.name)));
    for (const col of ["tipo", "asentamiento_id", "jugador"] as const) {
      if (!nombresMemoriaLider.has(col)) this.bd.exec(`ALTER TABLE memoria_lider ADD COLUMN ${col} TEXT`);
    }
    // Mismo patrón para `ultimo_reset_stock_ms` de `npc_comerciantes`
    // (docs/GDD_Economia.md §9, mercaderes por oficio, pedido 2026-08-31) —
    // un datos.sqlite de dev creado antes de este cambio no la tendría.
    const columnasNpcComerciantes = this.bd.prepare("PRAGMA table_info(npc_comerciantes)").all();
    if (!columnasNpcComerciantes.some((c) => String(c.name) === "ultimo_reset_stock_ms")) {
      this.bd.exec("ALTER TABLE npc_comerciantes ADD COLUMN ultimo_reset_stock_ms INTEGER");
    }
    // Mismo patrón para `datos_visual` de `cadaveres` (docs/GDD_Muerte_Respawn.md,
    // pedido 2026-09-01: identidad visual del cadáver) — un datos.sqlite de
    // dev creado antes de este cambio no la tendría.
    const columnasCadaveres = this.bd.prepare("PRAGMA table_info(cadaveres)").all();
    if (!columnasCadaveres.some((c) => String(c.name) === "datos_visual")) {
      this.bd.exec("ALTER TABLE cadaveres ADD COLUMN datos_visual TEXT NOT NULL DEFAULT ''");
    }
    // Mismo patrón para `trabajador_id` de `contratos_transporte` (fusión
    // "transporte" como oficio de trabajador, docs/GDD_NPCs_Contratables.md,
    // pedido 2026-09-01) — un datos.sqlite de dev creado antes de este
    // cambio no la tendría.
    const columnasContratos = this.bd.prepare("PRAGMA table_info(contratos_transporte)").all();
    if (!columnasContratos.some((c) => String(c.name) === "trabajador_id")) {
      this.bd.exec("ALTER TABLE contratos_transporte ADD COLUMN trabajador_id INTEGER");
      this.bd.exec("CREATE INDEX IF NOT EXISTS idx_contratos_trabajador ON contratos_transporte(trabajador_id)");
    }
    // Mismo patrón para `mascota_asignada_id`/`conjunto_asignado_id` de
    // `npcs_trabajadores` (docs/GDD_Carros.md §12, Fase 5, pedido
    // 2026-09-03) — un datos.sqlite de dev creado antes de este cambio no
    // las tendría.
    const columnasTrabajadores = this.bd.prepare("PRAGMA table_info(npcs_trabajadores)").all();
    if (!columnasTrabajadores.some((c) => String(c.name) === "mascota_asignada_id")) {
      this.bd.exec("ALTER TABLE npcs_trabajadores ADD COLUMN mascota_asignada_id INTEGER");
    }
    if (!columnasTrabajadores.some((c) => String(c.name) === "conjunto_asignado_id")) {
      this.bd.exec("ALTER TABLE npcs_trabajadores ADD COLUMN conjunto_asignado_id INTEGER");
    }
  }

  async obtenerOCrearJugador(nombre: string, saldoInicial = SALDO_INICIAL_JUGADOR): Promise<Jugador> {
    const existente = this.bd
      .prepare("SELECT id, nombre, farycoins, vida, vida_max, anatomia, enfermedades, oficio_1, oficio_2, cambios_oficio, comida, bebida, sueno, estamina FROM jugadores WHERE nombre = ?")
      .get(nombre);
    if (existente) {
      return {
        id: Number(existente.id),
        nombre: String(existente.nombre),
        farycoins: Number(existente.farycoins),
        vida: Number(existente.vida),
        vidaMax: Number(existente.vida_max),
        anatomia: existente.anatomia == null ? null : String(existente.anatomia),
        enfermedades: existente.enfermedades == null ? null : String(existente.enfermedades),
        oficio1: String(existente.oficio_1 ?? ""),
        oficio2: String(existente.oficio_2 ?? ""),
        cambiosOficio: Number(existente.cambios_oficio ?? 0),
        comida: Number(existente.comida ?? 100),
        bebida: Number(existente.bebida ?? 100),
        sueno: Number(existente.sueno ?? 100),
        estamina: Number(existente.estamina ?? 100),
      };
    }
    const r = this.bd
      .prepare("INSERT INTO jugadores (nombre, creado_en, farycoins) VALUES (?, ?, ?)")
      .run(nombre, new Date().toISOString(), saldoInicial);
    return {
      id: Number(r.lastInsertRowid), nombre, farycoins: saldoInicial, vida: 100, vidaMax: 100, anatomia: null, enfermedades: null,
      oficio1: "", oficio2: "", cambiosOficio: 0, comida: 100, bebida: 100, sueno: 100, estamina: 100,
    };
  }

  async fijarOficioSlot(jugadorId: number, slot: 1 | 2, oficio: string): Promise<void> {
    this.bd.prepare(`UPDATE jugadores SET oficio_${slot} = ? WHERE id = ?`).run(oficio, jugadorId);
  }

  async reiniciarXpOficio(jugadorId: number, oficio: string): Promise<void> {
    this.bd.prepare("UPDATE jugador_oficios SET xp = 0 WHERE jugador_id = ? AND oficio = ?").run(jugadorId, oficio);
  }

  async incrementarCambiosOficio(jugadorId: number): Promise<number> {
    this.bd.prepare("UPDATE jugadores SET cambios_oficio = cambios_oficio + 1 WHERE id = ?").run(jugadorId);
    const fila = this.bd.prepare("SELECT cambios_oficio FROM jugadores WHERE id = ?").get(jugadorId);
    return fila ? Number(fila.cambios_oficio) : 0;
  }

  async colocarNpcTutorial(datos: { mapaId: string; tipoTutorial: string; nombre: string; x: number; y: number; colocadoPor: string }): Promise<NpcTutorialColocado> {
    const colocadoEn = new Date().toISOString();
    const r = this.bd
      .prepare("INSERT INTO npcs_tutoriales (mapa_id, tipo_tutorial, nombre, x, y, colocado_por, colocado_en) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(datos.mapaId, datos.tipoTutorial, datos.nombre, datos.x, datos.y, datos.colocadoPor, colocadoEn);
    return { id: Number(r.lastInsertRowid), mapaId: datos.mapaId, tipoTutorial: datos.tipoTutorial, nombre: datos.nombre, x: datos.x, y: datos.y, colocadoPor: datos.colocadoPor, colocadoEn };
  }

  async listarNpcsTutorialesDeMapa(mapaId: string): Promise<NpcTutorialColocado[]> {
    const filas = this.bd.prepare("SELECT * FROM npcs_tutoriales WHERE mapa_id = ? ORDER BY id").all(mapaId);
    return filas.map((f) => ({
      id: Number(f.id), mapaId: String(f.mapa_id), tipoTutorial: String(f.tipo_tutorial), nombre: String(f.nombre),
      x: Number(f.x), y: Number(f.y), colocadoPor: String(f.colocado_por), colocadoEn: String(f.colocado_en),
    }));
  }

  async quitarNpcTutorial(id: number): Promise<boolean> {
    const r = this.bd.prepare("DELETE FROM npcs_tutoriales WHERE id = ?").run(id);
    return Number(r.changes) > 0;
  }

  private filaATrabajador(f: Record<string, unknown>): NpcTrabajador {
    return {
      id: Number(f.id), mapaId: String(f.mapa_id), duenoId: Number(f.dueno_id), nombre: String(f.nombre),
      oficios: JSON.parse(String(f.oficios)), construccionId: f.construccion_id == null ? null : Number(f.construccion_id),
      recetaId: f.receta_id == null ? null : String(f.receta_id), x: Number(f.x), y: Number(f.y),
      fechaContratacionDia: Number(f.fecha_contratacion_dia), ultimoPagoDia: Number(f.ultimo_pago_dia),
      mascotaAsignadaId: f.mascota_asignada_id == null ? null : Number(f.mascota_asignada_id),
      conjuntoAsignadoId: f.conjunto_asignado_id == null ? null : Number(f.conjunto_asignado_id),
    };
  }

  async contratarNpcTrabajador(datos: NuevoNpcTrabajador): Promise<NpcTrabajador> {
    const creadoEn = new Date().toISOString();
    const r = this.bd
      .prepare(
        `INSERT INTO npcs_trabajadores (mapa_id, dueno_id, nombre, oficios, construccion_id, receta_id, x, y, fecha_contratacion_dia, ultimo_pago_dia, creado_en)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(datos.mapaId, datos.duenoId, datos.nombre, JSON.stringify(datos.oficios), datos.x, datos.y, datos.diaActual, datos.diaActual, creadoEn);
    return {
      id: Number(r.lastInsertRowid), mapaId: datos.mapaId, duenoId: datos.duenoId, nombre: datos.nombre, oficios: datos.oficios,
      construccionId: null, recetaId: null, x: datos.x, y: datos.y, fechaContratacionDia: datos.diaActual, ultimoPagoDia: datos.diaActual,
      mascotaAsignadaId: null, conjuntoAsignadoId: null,
    };
  }

  async listarNpcsTrabajadoresDeMapa(mapaId: string): Promise<NpcTrabajador[]> {
    const filas = this.bd.prepare("SELECT * FROM npcs_trabajadores WHERE mapa_id = ? ORDER BY id").all(mapaId);
    return filas.map((f) => this.filaATrabajador(f));
  }

  async listarNpcsTrabajadoresDeJugador(duenoId: number): Promise<NpcTrabajador[]> {
    const filas = this.bd.prepare("SELECT * FROM npcs_trabajadores WHERE dueno_id = ? ORDER BY id").all(duenoId);
    return filas.map((f) => this.filaATrabajador(f));
  }

  async asignarMesaNpcTrabajador(id: number, construccionId: number, x: number, y: number): Promise<boolean> {
    const r = this.bd.prepare("UPDATE npcs_trabajadores SET construccion_id = ?, x = ?, y = ? WHERE id = ?").run(construccionId, x, y, id);
    return Number(r.changes) > 0;
  }

  async asignarRecetaNpcTrabajador(id: number, recetaId: string | null): Promise<boolean> {
    const r = this.bd.prepare("UPDATE npcs_trabajadores SET receta_id = ? WHERE id = ?").run(recetaId, id);
    return Number(r.changes) > 0;
  }

  async asignarMonturaNpcTrabajador(id: number, mascotaAsignadaId: number | null, conjuntoAsignadoId: number | null): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE npcs_trabajadores SET mascota_asignada_id = ?, conjunto_asignado_id = ? WHERE id = ?")
      .run(mascotaAsignadaId, conjuntoAsignadoId, id);
    return Number(r.changes) > 0;
  }

  async marcarPagoNpcTrabajador(ids: number[], dia: number): Promise<void> {
    if (ids.length === 0) return;
    const stmt = this.bd.prepare("UPDATE npcs_trabajadores SET ultimo_pago_dia = ? WHERE id = ?");
    for (const id of ids) stmt.run(dia, id);
  }

  async despedirNpcTrabajador(id: number): Promise<boolean> {
    const r = this.bd.prepare("DELETE FROM npcs_trabajadores WHERE id = ?").run(id);
    return Number(r.changes) > 0;
  }

  async actualizarAnatomiaJugador(jugadorId: number, anatomiaJson: string): Promise<void> {
    this.bd.prepare("UPDATE jugadores SET anatomia = ? WHERE id = ?").run(anatomiaJson, jugadorId);
  }

  async actualizarEnfermedadesJugador(jugadorId: number, enfermedadesJson: string): Promise<void> {
    this.bd.prepare("UPDATE jugadores SET enfermedades = ? WHERE id = ?").run(enfermedadesJson, jugadorId);
  }

  async crearCuentaAdmin(datos: { usuario: string; passwordHash: string | null; twitchLogin: string | null; rol: RolAdmin; mapaId: string | null }): Promise<CuentaAdmin> {
    this.bd
      .prepare("INSERT INTO admin_cuentas (usuario, password_hash, twitch_login, rol, mapa_id, creado_en) VALUES (?, ?, ?, ?, ?, ?)")
      .run(datos.usuario, datos.passwordHash, datos.twitchLogin, datos.rol, datos.mapaId, new Date().toISOString());
    return (await this.obtenerCuentaAdminPorUsuario(datos.usuario))!;
  }

  async obtenerCuentaAdminPorUsuario(usuario: string): Promise<CuentaAdmin | null> {
    const fila = this.bd.prepare("SELECT * FROM admin_cuentas WHERE usuario = ?").get(usuario);
    return fila ? filaACuentaAdmin(fila) : null;
  }

  async obtenerCuentaAdminPorTwitchLogin(twitchLogin: string): Promise<CuentaAdmin | null> {
    const fila = this.bd.prepare("SELECT * FROM admin_cuentas WHERE twitch_login = ?").get(twitchLogin);
    return fila ? filaACuentaAdmin(fila) : null;
  }

  async listarCuentasAdmin(): Promise<CuentaAdmin[]> {
    const filas = this.bd.prepare("SELECT * FROM admin_cuentas ORDER BY id").all();
    return filas.map(filaACuentaAdmin);
  }

  async actualizarPasswordAdmin(id: number, passwordHash: string): Promise<void> {
    this.bd.prepare("UPDATE admin_cuentas SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }

  async asignarJarlDeMapa(mapaId: string, usuario: string): Promise<{ ok: boolean; motivo?: string }> {
    const cuenta = await this.obtenerCuentaAdminPorUsuario(usuario);
    if (!cuenta) return { ok: false, motivo: "no existe esa cuenta de admin" };
    if (cuenta.rol === "superadmin") return { ok: false, motivo: "una cuenta superadmin no se asigna a un mapa" };
    // "1 jarl por mapa": a quien lo tuviera antes se le quita (mapa_id a NULL, sigue siendo jarl, solo que sin mapa).
    this.bd.prepare("UPDATE admin_cuentas SET mapa_id = NULL WHERE rol = 'jarl' AND mapa_id = ? AND usuario != ?").run(mapaId, usuario);
    this.bd.prepare("UPDATE admin_cuentas SET rol = 'jarl', mapa_id = ? WHERE id = ?").run(mapaId, cuenta.id);
    return { ok: true };
  }

  async obtenerFarycoins(jugadorId: number): Promise<number> {
    const fila = this.bd.prepare("SELECT farycoins FROM jugadores WHERE id = ?").get(jugadorId);
    return fila ? Number(fila.farycoins) : 0;
  }

  async actualizarVidaJugador(jugadorId: number, vida: number, vidaMax: number): Promise<void> {
    this.bd.prepare("UPDATE jugadores SET vida = ?, vida_max = ? WHERE id = ?").run(vida, vidaMax, jugadorId);
  }

  async actualizarVitalesJugador(jugadorId: number, comida: number, bebida: number, sueno: number, estamina: number): Promise<void> {
    this.bd.prepare("UPDATE jugadores SET comida = ?, bebida = ?, sueno = ?, estamina = ? WHERE id = ?").run(comida, bebida, sueno, estamina, jugadorId);
  }

  async ajustarFarycoins(jugadorId: number, delta: number): Promise<{ ok: boolean; saldo: number }> {
    const r = this.bd
      .prepare("UPDATE jugadores SET farycoins = farycoins + ? WHERE id = ? AND farycoins + ? >= 0")
      .run(delta, jugadorId, delta);
    const saldo = await this.obtenerFarycoins(jugadorId);
    return { ok: Number(r.changes) > 0, saldo };
  }

  async obtenerXpOficio(jugadorId: number, oficio: string): Promise<number> {
    const fila = this.bd.prepare("SELECT xp FROM jugador_oficios WHERE jugador_id = ? AND oficio = ?").get(jugadorId, oficio);
    return fila ? Number(fila.xp) : 0;
  }

  async sumarXpOficio(jugadorId: number, oficio: string, delta: number): Promise<number> {
    const fila = this.bd
      .prepare(
        `INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES (?, ?, ?)
         ON CONFLICT(jugador_id, oficio) DO UPDATE SET xp = jugador_oficios.xp + excluded.xp
         RETURNING xp`,
      )
      .get(jugadorId, oficio, delta);
    return Number(fila!.xp);
  }

  async obtenerXpAtributo(jugadorId: number, atributo: string): Promise<number> {
    const fila = this.bd.prepare("SELECT xp FROM jugador_atributos WHERE jugador_id = ? AND atributo = ?").get(jugadorId, atributo);
    return fila ? Number(fila.xp) : 0;
  }

  async sumarXpAtributo(jugadorId: number, atributo: string, delta: number): Promise<number> {
    const fila = this.bd
      .prepare(
        `INSERT INTO jugador_atributos (jugador_id, atributo, xp) VALUES (?, ?, ?)
         ON CONFLICT(jugador_id, atributo) DO UPDATE SET xp = jugador_atributos.xp + excluded.xp
         RETURNING xp`,
      )
      .get(jugadorId, atributo, delta);
    return Number(fila!.xp);
  }

  async obtenerUltimoDiaActividadAtributo(jugadorId: number, atributo: string): Promise<number | null> {
    const fila = this.bd
      .prepare("SELECT ultimo_dia_actividad FROM jugador_atributos WHERE jugador_id = ? AND atributo = ?")
      .get(jugadorId, atributo);
    if (!fila || fila.ultimo_dia_actividad === null || fila.ultimo_dia_actividad === undefined) return null;
    return Number(fila.ultimo_dia_actividad);
  }

  async marcarActividadAtributoHoy(jugadorId: number, atributo: string, dia: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO jugador_atributos (jugador_id, atributo, xp, ultimo_dia_actividad) VALUES (?, ?, 0, ?)
         ON CONFLICT(jugador_id, atributo) DO UPDATE SET ultimo_dia_actividad = excluded.ultimo_dia_actividad`,
      )
      .run(jugadorId, atributo, dia);
  }

  private filaAGremio(f: Record<string, unknown>): Gremio {
    return {
      id: Number(f.id),
      nombre: String(f.nombre),
      liderJugadorId: Number(f.lider_jugador_id),
      color: String(f.color),
      emblemaId: String(f.emblema_id),
      saldoBanco: Number(f.saldo_banco),
      creadoEn: String(f.creado_en),
    };
  }

  async crearGremio(nombre: string, liderJugadorId: number, color: string, emblemaId: string): Promise<ResultadoCrearGremio> {
    const ahora = new Date().toISOString();
    let gremioId: number;
    try {
      const r = this.bd
        .prepare("INSERT INTO gremios (nombre, lider_jugador_id, color, emblema_id, saldo_banco, creado_en) VALUES (?, ?, ?, ?, 0, ?)")
        .run(nombre, liderJugadorId, color, emblemaId, ahora);
      gremioId = Number(r.lastInsertRowid);
    } catch (e) {
      if (String((e as Error).message).includes("gremios.nombre")) return { ok: false, motivo: "nombre_en_uso" };
      throw e;
    }
    try {
      this.bd
        .prepare("INSERT INTO gremio_miembros (gremio_id, jugador_id, rol, ingreso_en) VALUES (?, ?, 'lider', ?)")
        .run(gremioId, liderJugadorId, ahora);
    } catch (e) {
      // compensar: el jugador ya estaba en otro gremio (UNIQUE jugador_id) — deshacer el gremio recién creado
      this.bd.prepare("DELETE FROM gremios WHERE id = ?").run(gremioId);
      if (String((e as Error).message).includes("gremio_miembros")) return { ok: false, motivo: "ya_tienes_gremio" };
      throw e;
    }
    return { ok: true, gremio: (await this.obtenerGremio(gremioId))! };
  }

  async listarGremios(): Promise<Gremio[]> {
    const filas = this.bd
      .prepare("SELECT id, nombre, lider_jugador_id, color, emblema_id, saldo_banco, creado_en FROM gremios")
      .all();
    return filas.map((f) => this.filaAGremio(f));
  }

  async obtenerGremio(id: number): Promise<Gremio | null> {
    const fila = this.bd
      .prepare("SELECT id, nombre, lider_jugador_id, color, emblema_id, saldo_banco, creado_en FROM gremios WHERE id = ?")
      .get(id);
    return fila ? this.filaAGremio(fila) : null;
  }

  async listarMiembros(gremioId: number): Promise<GremioMiembro[]> {
    const filas = this.bd
      .prepare(
        `SELECT m.gremio_id, m.jugador_id, j.nombre AS jugador_nombre, m.rol, m.ingreso_en
         FROM gremio_miembros m JOIN jugadores j ON j.id = m.jugador_id WHERE m.gremio_id = ?`
      )
      .all(gremioId);
    return filas.map((f) => ({
      gremioId: Number(f.gremio_id),
      jugadorId: Number(f.jugador_id),
      jugadorNombre: String(f.jugador_nombre),
      rol: String(f.rol) as RolGremio,
      ingresoEn: String(f.ingreso_en),
    }));
  }

  async agregarMiembro(gremioId: number, jugadorId: number, rol: RolGremio): Promise<void> {
    try {
      this.bd
        .prepare("INSERT INTO gremio_miembros (gremio_id, jugador_id, rol, ingreso_en) VALUES (?, ?, ?, ?)")
        .run(gremioId, jugadorId, rol, new Date().toISOString());
    } catch (e) {
      // UNIQUE(jugador_id): ya está en otro gremio — el chequeo real vive en
      // ContextoGremios (memoria) antes de llamar aquí; esto es defensa en
      // profundidad, no el punto de decisión.
      console.warn(`agregarMiembro: jugador ${jugadorId} ya pertenece a un gremio, no se añadió a ${gremioId}`);
    }
  }

  async quitarMiembro(gremioId: number, jugadorId: number): Promise<void> {
    this.bd.prepare("DELETE FROM gremio_miembros WHERE gremio_id = ? AND jugador_id = ?").run(gremioId, jugadorId);
  }

  async actualizarGremio(id: number, cambios: { color?: string; emblemaId?: string }): Promise<void> {
    if (cambios.color !== undefined) this.bd.prepare("UPDATE gremios SET color = ? WHERE id = ?").run(cambios.color, id);
    if (cambios.emblemaId !== undefined) {
      this.bd.prepare("UPDATE gremios SET emblema_id = ? WHERE id = ?").run(cambios.emblemaId, id);
    }
  }

  async disolverGremio(id: number): Promise<void> {
    const gremio = await this.obtenerGremio(id);
    if (gremio && gremio.saldoBanco > 0) await this.ajustarFarycoins(gremio.liderJugadorId, gremio.saldoBanco);
    this.bd.prepare("DELETE FROM gremio_miembros WHERE gremio_id = ?").run(id);
    this.bd.prepare("DELETE FROM gremio_invitaciones WHERE gremio_id = ?").run(id);
    this.bd.prepare("DELETE FROM gremios WHERE id = ?").run(id);
  }

  async ajustarBancoGremio(gremioId: number, delta: number): Promise<{ ok: boolean; saldo: number }> {
    const r = this.bd
      .prepare("UPDATE gremios SET saldo_banco = saldo_banco + ? WHERE id = ? AND saldo_banco + ? >= 0")
      .run(delta, gremioId, delta);
    const gremio = await this.obtenerGremio(gremioId);
    return { ok: Number(r.changes) > 0, saldo: gremio?.saldoBanco ?? 0 };
  }

  async guardarInventarioGremio(gremioId: number, contenedor: Contenedor): Promise<void> {
    const r = this.bd
      .prepare("UPDATE gremio_inventario SET ancho = ?, alto = ?, siguiente_id = ?, items = ? WHERE gremio_id = ?")
      .run(contenedor.ancho, contenedor.alto, contenedor.siguienteId, JSON.stringify(contenedor.items), gremioId);
    if (Number(r.changes) === 0) {
      this.bd
        .prepare("INSERT INTO gremio_inventario (gremio_id, ancho, alto, siguiente_id, items) VALUES (?, ?, ?, ?, ?)")
        .run(gremioId, contenedor.ancho, contenedor.alto, contenedor.siguienteId, JSON.stringify(contenedor.items));
    }
  }

  async cargarInventarioGremio(gremioId: number): Promise<Contenedor | null> {
    const f = this.bd.prepare("SELECT ancho, alto, siguiente_id, items FROM gremio_inventario WHERE gremio_id = ?").get(gremioId);
    if (!f) return null;
    return {
      ancho: Number(f.ancho),
      alto: Number(f.alto),
      siguienteId: Number(f.siguiente_id),
      items: JSON.parse(String(f.items)) as ItemInstancia[],
    };
  }

  async crearInvitacion(gremioId: number, jugadorId: number, invitadoPorId: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO gremio_invitaciones (gremio_id, jugador_id, invitado_por, creado_en) VALUES (?, ?, ?, ?)
         ON CONFLICT(gremio_id, jugador_id) DO UPDATE SET invitado_por = excluded.invitado_por, creado_en = excluded.creado_en`
      )
      .run(gremioId, jugadorId, invitadoPorId, new Date().toISOString());
  }

  async obtenerInvitacion(gremioId: number, jugadorId: number): Promise<{ invitadoPorId: number } | null> {
    const fila = this.bd
      .prepare("SELECT invitado_por FROM gremio_invitaciones WHERE gremio_id = ? AND jugador_id = ?")
      .get(gremioId, jugadorId);
    return fila ? { invitadoPorId: Number(fila.invitado_por) } : null;
  }

  async eliminarInvitacion(gremioId: number, jugadorId: number): Promise<void> {
    this.bd.prepare("DELETE FROM gremio_invitaciones WHERE gremio_id = ? AND jugador_id = ?").run(gremioId, jugadorId);
  }

  // Se llama UNA vez al arrancar la room (regla GDD §2: leer al arrancar, nunca polling).
  async cargarPropiedades(): Promise<Map<string, Propiedad>> {
    const filas = this.bd
      .prepare(
        // LEFT JOIN: una propiedad sin dueño (dueno NULL) debe salir igualmente, con dueno=null
        `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en,
                p.impuesto_activo, p.impuesto_farycoins, p.impuesto_periodo_horas, p.impuesto_ultimo_cobro
         FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno`
      )
      .all();
    const mapa = new Map<string, Propiedad>();
    // Sin `id` en el valor (sería redundante — ya es la clave del Map, mismo
    // shape que devolvía esta función antes de la tenencia comercial).
    for (const f of filas) {
      const { id, ...propiedad } = this.filaAPropiedad(f);
      mapa.set(id, propiedad);
    }
    return mapa;
  }

  async listarPropiedadesDeJugador(nombre: string): Promise<Array<Propiedad & { id: string }>> {
    const filas = this.bd
      .prepare(
        `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en,
                p.impuesto_activo, p.impuesto_farycoins, p.impuesto_periodo_horas, p.impuesto_ultimo_cobro
         FROM propiedades p JOIN jugadores j ON j.id = p.dueno
         WHERE j.nombre = ?`
      )
      .all(nombre);
    return filas.map((f) => this.filaAPropiedad(f));
  }

  private filaAPropiedad(f: Record<string, unknown>): Propiedad & { id: string } {
    return {
      id: String(f.id),
      tipo: String(f.tipo),
      asentamiento: String(f.asentamiento),
      dueno: f.dueno == null ? null : String(f.dueno),
      modoTenencia: f.modo_tenencia == null ? null : (String(f.modo_tenencia) as ModoTenencia),
      precioFarycoins: f.precio_farycoins == null ? null : Number(f.precio_farycoins),
      periodoHoras: f.periodo_horas == null ? null : Number(f.periodo_horas),
      expiraEn: f.expira_en == null ? null : String(f.expira_en),
      impuestoActivo: Boolean(Number(f.impuesto_activo ?? 0)),
      impuestoFarycoins: f.impuesto_farycoins == null ? null : Number(f.impuesto_farycoins),
      impuestoPeriodoHoras: f.impuesto_periodo_horas == null ? null : Number(f.impuesto_periodo_horas),
      impuestoUltimoCobro: f.impuesto_ultimo_cobro == null ? null : String(f.impuesto_ultimo_cobro),
    };
  }

  async asignarPropiedad(id: string, tipo: string, asentamiento: string, duenoNombre: string | null): Promise<void> {
    // El dueño llega por NOMBRE (identidad v1) y puede no existir aún: se crea aquí,
    // igual que hace "parcela:asignar" en el protocolo (GDD §4).
    const duenoId = duenoNombre == null ? null : (await this.obtenerOCrearJugador(duenoNombre)).id;
    const ahora = new Date().toISOString();
    // Upsert portable (UPDATE y, si no tocó fila, INSERT) en vez de ON CONFLICT de SQLite.
    const r = this.bd
      .prepare("UPDATE propiedades SET tipo = ?, asentamiento = ?, dueno = ?, asignada_en = ? WHERE id = ?")
      .run(tipo, asentamiento, duenoId, ahora, id);
    if (Number(r.changes) === 0) {
      this.bd
        .prepare("INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES (?, ?, ?, ?, ?)")
        .run(id, tipo, asentamiento, duenoId, ahora);
    }
  }

  // Revoca dueño Y cualquier tenencia comercial — el jarl puede revocar tanto
  // un alquiler como una COMPRA (decisión 2026-08-29: el jarl mantiene
  // autoridad total). Las construcciones de una parcela QUEDAN (GDD §4);
  // aquí no aplica (inmuebles/habitaciones no llevan construcciones propias).
  async revocarPropiedad(id: string): Promise<void> {
    this.bd
      .prepare(
        `UPDATE propiedades SET dueno = NULL, asignada_en = ?, modo_tenencia = NULL, precio_farycoins = NULL, periodo_horas = NULL, expira_en = NULL WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
    // Mercado (docs/GDD_Mercado.md): revocar la propiedad subyacente vacía
    // también cualquier tenderete que hubiera sobre ella — sin esto, un
    // tenderete "huérfano" seguiría vendiendo sin dueño reconocible.
    this.bd.prepare("DELETE FROM tenderete_items WHERE tenderete_id = ?").run(id);
    this.bd.prepare("DELETE FROM tenderete_caja WHERE tenderete_id = ?").run(id);
  }

  /** Compare-and-swap: libera la fila SOLO si es un alquiler vencido — no toca compras ni alquileres vigentes. */
  private liberarSiVencida(id: string): void {
    this.bd
      .prepare(
        `UPDATE propiedades SET dueno = NULL, modo_tenencia = NULL, precio_farycoins = NULL, periodo_horas = NULL, expira_en = NULL
         WHERE id = ? AND modo_tenencia = 'alquiler' AND expira_en IS NOT NULL AND expira_en < ?`,
      )
      .run(id, new Date().toISOString());
  }

  async obtenerPropiedad(id: string): Promise<(Propiedad & { id: string }) | null> {
    this.liberarSiVencida(id);
    await this.resolverImpuestoPropiedad(id);
    const fila = this.bd
      .prepare(
        `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en,
                p.impuesto_activo, p.impuesto_farycoins, p.impuesto_periodo_horas, p.impuesto_ultimo_cobro
         FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno WHERE p.id = ?`,
      )
      .get(id);
    return fila ? this.filaAPropiedad(fila) : null;
  }

  /**
   * Impuesto del jarl (docs/GDD_Economia.md §6, pedido 2026-08-30): activa o
   * desactiva el cobro periódico de una propiedad concreta y fija su
   * cantidad/cadencia — SOLO el jarl (guard en RoomExteriorBase, igual que
   * `parcela:asignar`). Al ACTIVAR (o cambiar cantidad/periodo estando ya
   * activo), `impuestoUltimoCobro` se resetea a AHORA: nunca cobra
   * retroactivo de antes de la configuración nueva, mismo criterio que
   * `resolverIngresoDiarioNpc` con NPCs recién descubiertos.
   */
  async configurarImpuestoPropiedad(id: string, activo: boolean, farycoins: number | null, periodoHoras: number | null): Promise<void> {
    this.bd
      .prepare(
        `UPDATE propiedades SET impuesto_activo = ?, impuesto_farycoins = ?, impuesto_periodo_horas = ?, impuesto_ultimo_cobro = ? WHERE id = ?`,
      )
      .run(activo ? 1 : 0, farycoins, periodoHoras, activo ? new Date().toISOString() : null, id);
  }

  /**
   * Cálculo perezoso (mismo patrón que `resolverIngresoDiarioNpc`, cero
   * timers/polling): cobra de golpe TODOS los periodos completos
   * transcurridos desde `impuestoUltimoCobro` — nada si el impuesto está
   * desactivado, sin dueño, o no ha pasado ni un periodo entero todavía.
   * Todo o nada por LOTE: si el dueño no puede pagar el lote completo, no
   * se cobra nada y el reloj NO avanza — la deuda se acumula hasta que
   * pueda (sin mecanismo de embargo/desahucio todavía, ver GDD). El precio
   * se acredita al jarl con la MISMA `creditarJarl` que compra/alquiler.
   */
  private async resolverImpuestoPropiedad(id: string): Promise<void> {
    const fila = this.bd
      .prepare(
        `SELECT dueno, impuesto_activo, impuesto_farycoins, impuesto_periodo_horas, impuesto_ultimo_cobro FROM propiedades WHERE id = ?`,
      )
      .get(id);
    if (!fila || !fila.dueno || !Number(fila.impuesto_activo) || !fila.impuesto_farycoins || !fila.impuesto_periodo_horas || !fila.impuesto_ultimo_cobro) {
      return;
    }
    const periodoMs = Number(fila.impuesto_periodo_horas) * 3600_000;
    const transcurridoMs = Date.now() - new Date(String(fila.impuesto_ultimo_cobro)).getTime();
    const periodos = Math.floor(transcurridoMs / periodoMs);
    if (periodos <= 0) return;
    const total = periodos * Number(fila.impuesto_farycoins);
    const debito = await this.ajustarFarycoins(Number(fila.dueno), -total);
    if (!debito.ok) return; // no puede pagar el lote entero — no cobra nada, no avanza el reloj (deuda se acumula)
    const nuevoUltimoCobro = new Date(new Date(String(fila.impuesto_ultimo_cobro)).getTime() + periodos * periodoMs).toISOString();
    this.bd.prepare("UPDATE propiedades SET impuesto_ultimo_cobro = ? WHERE id = ?").run(nuevoUltimoCobro, id);
    await this.creditarJarl(total);
  }

  async comprarOAlquilar(params: {
    id: string;
    tipo: "inmueble" | "habitacion" | "plantilla";
    asentamiento: string;
    jugadorNombre: string;
    modo: ModoTenencia;
    precioFarycoins: number;
    periodoHoras: number | null;
    // Gremios (docs/GDD_Gremios.md §7, pedido 2026-08-30: "comprar terrenos
    // más fácil al unir dineros") — con `gremioId` el precio sale del banco
    // del gremio (`ajustarBancoGremio`) en vez del monedero del jugador;
    // quien es DUEÑO de la propiedad sigue siendo el jugador (identidad v1
    // no cambia, el gremio solo puso el dinero). El guard de "solo el líder
    // gasta del banco" vive en RoomExteriorBase, no aquí.
    gremioId?: number;
  }): Promise<{ ok: true; saldoRestante: number; expiraEn: string | null } | { ok: false; motivo: string }> {
    this.liberarSiVencida(params.id);
    const jugador = await this.obtenerOCrearJugador(params.jugadorNombre);
    const debito =
      params.gremioId != null
        ? await this.ajustarBancoGremio(params.gremioId, -params.precioFarycoins)
        : await this.ajustarFarycoins(jugador.id, -params.precioFarycoins);
    if (!debito.ok) return { ok: false, motivo: params.gremioId != null ? "el banco del gremio no tiene fondos suficientes" : "no tienes suficientes Farycoins" };

    const ahora = new Date().toISOString();
    const expiraEn =
      params.modo === "alquiler" && params.periodoHoras
        ? new Date(Date.now() + params.periodoHoras * 3600_000).toISOString()
        : null;

    // Upsert atómico: si la fila no existe (nunca se tocó) se inserta; si
    // existe y sigue LIBRE (dueno IS NULL — liberarSiVencida ya limpió
    // cualquier alquiler vencido) se actualiza; si existe y tiene dueño
    // vigente, la cláusula WHERE del DO UPDATE la deja intacta y RETURNING
    // no da fila — mismo compare-and-swap por sentencia única que el resto
    // de mutaciones económicas del proyecto, sin necesitar una transacción.
    const fila = this.bd
      .prepare(
        `INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en, modo_tenencia, precio_farycoins, periodo_horas, expira_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tipo=excluded.tipo, asentamiento=excluded.asentamiento, dueno=excluded.dueno, asignada_en=excluded.asignada_en,
           modo_tenencia=excluded.modo_tenencia, precio_farycoins=excluded.precio_farycoins, periodo_horas=excluded.periodo_horas, expira_en=excluded.expira_en
         WHERE propiedades.dueno IS NULL
         RETURNING id`,
      )
      .get(params.id, params.tipo, params.asentamiento, jugador.id, ahora, params.modo, params.precioFarycoins, params.periodoHoras, expiraEn);

    if (!fila) {
      // reembolso: alguien se adelantó — al mismo origen que pagó
      if (params.gremioId != null) await this.ajustarBancoGremio(params.gremioId, params.precioFarycoins);
      else await this.ajustarFarycoins(jugador.id, params.precioFarycoins);
      return { ok: false, motivo: "ya no está disponible" };
    }
    await this.creditarJarl(params.precioFarycoins);
    return { ok: true, saldoRestante: debito.saldo, expiraEn };
  }

  /** docs/GDD_Economia.md (pedido 2026-08-30): compras/alquileres de propiedad "se pagan al jarl" — se reparte a partes iguales entre los `JARL_NOMBRES` configurados (el resto, si no divide exacto, se pierde — nunca se crea dinero de más). Sin jarl configurado, no pasa nada (mismo comportamiento sumidero de antes). */
  private async creditarJarl(precioFarycoins: number): Promise<void> {
    const jarls = nombresJarlTalCual();
    if (jarls.length === 0 || precioFarycoins <= 0) return;
    const parte = Math.floor(precioFarycoins / jarls.length);
    if (parte <= 0) return;
    for (const nombreJarl of jarls) {
      const jugadorJarl = await this.obtenerOCrearJugador(nombreJarl);
      await this.ajustarFarycoins(jugadorJarl.id, parte);
    }
  }

  async renovarTenencia(
    id: string,
    jugadorNombre: string,
    periodoHoras: number,
    precioFarycoins: number,
  ): Promise<{ ok: true; expiraEn: string } | { ok: false; motivo: string }> {
    const prop = await this.obtenerPropiedad(id); // resuelve expiración perezosa primero
    if (!prop || prop.dueno?.toLowerCase() !== jugadorNombre.trim().toLowerCase()) {
      return { ok: false, motivo: "no eres el dueño de esta propiedad" };
    }
    if (prop.modoTenencia !== "alquiler" || prop.expiraEn == null) {
      return { ok: false, motivo: "esta propiedad no es de alquiler" };
    }
    const jugador = await this.obtenerOCrearJugador(jugadorNombre);
    const debito = await this.ajustarFarycoins(jugador.id, -precioFarycoins);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

    const nuevaExpira = new Date(new Date(prop.expiraEn).getTime() + periodoHoras * 3600_000).toISOString();
    this.bd.prepare("UPDATE propiedades SET expira_en = ? WHERE id = ? AND dueno = ?").run(nuevaExpira, id, jugador.id);
    await this.creditarJarl(precioFarycoins);
    return { ok: true, expiraEn: nuevaExpira };
  }

  async listarStockTenderete(tenderoteId: string): Promise<ItemEnVentaTenderete[]> {
    const filas = this.bd
      .prepare("SELECT item_id, cantidad, precio_farycoins FROM tenderete_items WHERE tenderete_id = ?")
      .all(tenderoteId);
    return filas.map((f) => ({
      itemId: String(f.item_id),
      cantidad: Number(f.cantidad),
      precioFarycoins: Number(f.precio_farycoins),
    }));
  }

  async reponerStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioFarycoins: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenderete_id, item_id) DO UPDATE SET
           cantidad = tenderete_items.cantidad + excluded.cantidad, precio_farycoins = excluded.precio_farycoins`,
      )
      .run(tenderoteId, itemId, cantidad, precioFarycoins);
  }

  async fijarPrecioTenderete(tenderoteId: string, itemId: string, precioFarycoins: number): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE tenderete_items SET precio_farycoins = ? WHERE tenderete_id = ? AND item_id = ?")
      .run(precioFarycoins, tenderoteId, itemId);
    return Number(r.changes) > 0;
  }

  async comprarDeTenderete(params: {
    tenderoteId: string;
    itemId: string;
    cantidad: number;
    compradorNombre: string;
    duenoNombre: string;
    descuento?: number;
    abonarACaja?: boolean;
  }): Promise<
    | { ok: true; saldoRestante: number; cantidadRestante: number; precioTotal: number }
    | { ok: false; motivo: string }
  > {
    const fila = this.bd
      .prepare("SELECT precio_farycoins FROM tenderete_items WHERE tenderete_id = ? AND item_id = ?")
      .get(params.tenderoteId, params.itemId);
    if (!fila) return { ok: false, motivo: "ese ítem no está en venta aquí" };
    const descuento = Math.max(-1, Math.min(1, params.descuento ?? 0));
    const precioTotal = Math.round(Number(fila.precio_farycoins) * params.cantidad * (1 - descuento));

    const comprador = await this.obtenerOCrearJugador(params.compradorNombre);
    const debito = await this.ajustarFarycoins(comprador.id, -precioTotal);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

    // Compare-and-swap: decrementa SOLO si queda stock suficiente — nunca por debajo de 0.
    const stock = this.bd
      .prepare(
        `UPDATE tenderete_items SET cantidad = cantidad - ? WHERE tenderete_id = ? AND item_id = ? AND cantidad >= ?
         RETURNING cantidad`,
      )
      .get(params.cantidad, params.tenderoteId, params.itemId, params.cantidad);
    if (!stock) {
      await this.ajustarFarycoins(comprador.id, precioTotal); // reembolso: se agotó justo antes
      return { ok: false, motivo: "no queda stock suficiente" };
    }

    // Mercado v2 (docs/GDD_Mercado.md §12): tenderete de JUGADOR acumula en
    // su propia caja en vez de pagar directo al monedero del dueño — el
    // resto de usos (NPC comerciante) sigue pagando directo, sin cambio.
    if (params.abonarACaja) {
      await this.incrementarCajaTenderete(params.tenderoteId, precioTotal);
    } else {
      const vendedor = await this.obtenerOCrearJugador(params.duenoNombre, saldoInicialPara(params.duenoNombre));
      await this.ajustarFarycoins(vendedor.id, precioTotal);
    }
    return { ok: true, saldoRestante: debito.saldo, cantidadRestante: Number(stock.cantidad), precioTotal };
  }

  async obtenerCajaTenderete(tenderoteId: string): Promise<number> {
    const fila = this.bd.prepare("SELECT farycoins FROM tenderete_caja WHERE tenderete_id = ?").get(tenderoteId);
    return fila ? Number(fila.farycoins) : 0;
  }

  async incrementarCajaTenderete(tenderoteId: string, farycoins: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO tenderete_caja (tenderete_id, farycoins) VALUES (?, ?)
         ON CONFLICT(tenderete_id) DO UPDATE SET farycoins = tenderete_caja.farycoins + excluded.farycoins`,
      )
      .run(tenderoteId, farycoins);
  }

  async recogerCajaTenderete(tenderoteId: string): Promise<number> {
    // RETURNING de un UPDATE da el valor DESPUÉS de aplicarse (0, ya vaciado)
    // — para devolver lo que había ANTES hace falta leer primero. better-
    // sqlite3 es síncrono (sin await entre el SELECT y el UPDATE, nada puede
    // colarse en medio), mismo criterio de "secuencial, no transacción
    // explícita" que el resto de este fichero (p.ej. comprarDeTenderete).
    const fila = this.bd.prepare("SELECT farycoins FROM tenderete_caja WHERE tenderete_id = ?").get(tenderoteId);
    const cantidad = fila ? Number(fila.farycoins) : 0;
    if (cantidad > 0) this.bd.prepare("UPDATE tenderete_caja SET farycoins = 0 WHERE tenderete_id = ?").run(tenderoteId);
    return cantidad;
  }

  async sumarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioInicial: number): Promise<void> {
    // igual que reponerStockTenderete pero el DO UPDATE NUNCA toca precio_farycoins —
    // el transporte no debe pisar el precio que el dueño ya puso a mano.
    this.bd
      .prepare(
        `INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenderete_id, item_id) DO UPDATE SET cantidad = tenderete_items.cantidad + excluded.cantidad`,
      )
      .run(tenderoteId, itemId, cantidad, precioInicial);
  }

  async consumirStockTenderete(tenderoteId: string, itemId: string, cantidad: number): Promise<boolean> {
    // Compare-and-swap, mismo patrón que comprarDeTenderete pero SIN cobro —
    // docs/GDD_Crafteo.md: aquí `tenderete_items` guarda el insumo de una
    // construcción de refinamiento, no mercancía en venta.
    const r = this.bd
      .prepare("UPDATE tenderete_items SET cantidad = cantidad - ? WHERE tenderete_id = ? AND item_id = ? AND cantidad >= ?")
      .run(cantidad, tenderoteId, itemId, cantidad);
    return Number(r.changes) > 0;
  }

  async venderANpc(params: {
    npcNombre: string;
    itemId: string;
    cantidad: number;
    precioUnitario: number;
    vendedorNombre: string;
  }): Promise<{ ok: true; saldoRestante: number; precioTotal: number } | { ok: false; motivo: string }> {
    const precioTotal = Math.max(0, Math.round(params.precioUnitario * params.cantidad));
    const npc = await this.obtenerOCrearJugador(params.npcNombre, saldoInicialPara(params.npcNombre));
    const debitoNpc = await this.ajustarFarycoins(npc.id, -precioTotal);
    if (!debitoNpc.ok) return { ok: false, motivo: "el comerciante no tiene suficiente dinero ahora mismo" };
    const vendedor = await this.obtenerOCrearJugador(params.vendedorNombre);
    const abono = await this.ajustarFarycoins(vendedor.id, precioTotal);
    return { ok: true, saldoRestante: abono.saldo, precioTotal };
  }


  async resolverIngresoDiarioNpc(npcNombre: string, diaActual: number): Promise<{ diasAcreditados: number; saldo: number }> {
    const fila = this.bd.prepare("SELECT ultimo_dia_ingreso FROM npc_comerciantes WHERE nombre = ?").get(npcNombre);
    if (!fila) {
      // primera vez que se ve a este NPC: fija el día de partida, sin retroactivo.
      this.bd.prepare("INSERT INTO npc_comerciantes (nombre, ultimo_dia_ingreso) VALUES (?, ?)").run(npcNombre, diaActual);
      const npc = await this.obtenerOCrearJugador(npcNombre, saldoInicialPara(npcNombre));
      return { diasAcreditados: 0, saldo: npc.farycoins };
    }
    const ultimoDia = Number(fila.ultimo_dia_ingreso);
    const diasAcreditados = Math.max(0, diaActual - ultimoDia);
    const npc = await this.obtenerOCrearJugador(npcNombre, saldoInicialPara(npcNombre));
    if (diasAcreditados === 0) return { diasAcreditados: 0, saldo: npc.farycoins };
    const r = await this.ajustarFarycoins(npc.id, diasAcreditados * INGRESO_DIARIO_NPC);
    this.bd.prepare("UPDATE npc_comerciantes SET ultimo_dia_ingreso = ? WHERE nombre = ?").run(diaActual, npcNombre);
    return { diasAcreditados, saldo: r.saldo };
  }

  async fijarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioFarycoins: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenderete_id, item_id) DO UPDATE SET
           cantidad = excluded.cantidad, precio_farycoins = excluded.precio_farycoins`,
      )
      .run(tenderoteId, itemId, cantidad, precioFarycoins);
  }

  async resolverResetStockMercader(npcNombre: string, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = this.bd.prepare("SELECT ultimo_reset_stock_ms FROM npc_comerciantes WHERE nombre = ?").get(npcNombre);
    const ultimo = fila && fila.ultimo_reset_stock_ms != null ? Number(fila.ultimo_reset_stock_ms) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    this.bd.prepare("UPDATE npc_comerciantes SET ultimo_reset_stock_ms = ? WHERE nombre = ?").run(ahoraMs, npcNombre);
    return true;
  }

  async listarConstrucciones(): Promise<Construccion[]> {
    const filas = this.bd
      .prepare("SELECT id, propiedad, objeto, categoria, x, y, rot, variante, extra FROM construcciones")
      .all();
    return filas.map((f) => ({
      id: Number(f.id),
      propiedad: String(f.propiedad),
      objeto: String(f.objeto),
      categoria: String(f.categoria),
      x: Number(f.x),
      y: Number(f.y),
      rot: Number(f.rot),
      variante: Number(f.variante),
      extra: f.extra == null ? null : (JSON.parse(String(f.extra)) as Record<string, unknown>),
    }));
  }

  async insertarConstruccion(c: NuevaConstruccion): Promise<number> {
    const r = this.bd
      .prepare(
        `INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        c.propiedad,
        c.objeto,
        c.categoria,
        c.x,
        c.y,
        c.rot,
        c.variante,
        c.extra == null ? null : JSON.stringify(c.extra),
        new Date().toISOString()
      );
    return Number(r.lastInsertRowid);
  }

  async borrarConstruccion(id: number): Promise<boolean> {
    const r = this.bd.prepare("DELETE FROM construcciones WHERE id = ?").run(id);
    return Number(r.changes) > 0;
  }

  async actualizarExtraConstruccion(id: number, extra: Record<string, unknown> | null): Promise<void> {
    this.bd.prepare("UPDATE construcciones SET extra = ? WHERE id = ?").run(extra == null ? null : JSON.stringify(extra), id);
  }

  private filaAContrato(f: Record<string, unknown>): ContratoTransporte {
    return {
      id: Number(f.id),
      origenConstruccionId: Number(f.origen_construccion_id),
      destinoTenderoteId: String(f.destino_tenderete_id),
      dueno: Number(f.dueno),
      itemId: String(f.item_id),
      caminoIda: JSON.parse(String(f.camino_ida)),
      caminoVuelta: JSON.parse(String(f.camino_vuelta)),
      duracionViajeSeg: Number(f.duracion_viaje_seg),
      cargaPorViaje: Number(f.carga_por_viaje),
      ultimoViajeResuelto: String(f.ultimo_viaje_resuelto),
      activo: Number(f.activo) === 1,
      trabajadorId: f.trabajador_id == null ? null : Number(f.trabajador_id),
    };
  }

  async crearContratoTransporte(c: NuevoContratoTransporte): Promise<ContratoTransporte> {
    const ahora = new Date().toISOString();
    const r = this.bd
      .prepare(
        `INSERT INTO contratos_transporte
           (origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, creado_en, trabajador_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        c.origenConstruccionId, c.destinoTenderoteId, c.dueno, c.itemId,
        JSON.stringify(c.caminoIda), JSON.stringify(c.caminoVuelta),
        c.duracionViajeSeg, c.cargaPorViaje, ahora, ahora, c.trabajadorId ?? null,
      );
    return {
      id: Number(r.lastInsertRowid), origenConstruccionId: c.origenConstruccionId, destinoTenderoteId: c.destinoTenderoteId,
      dueno: c.dueno, itemId: c.itemId, caminoIda: c.caminoIda, caminoVuelta: c.caminoVuelta,
      duracionViajeSeg: c.duracionViajeSeg, cargaPorViaje: c.cargaPorViaje, ultimoViajeResuelto: ahora, activo: true,
      trabajadorId: c.trabajadorId ?? null,
    };
  }

  async listarContratosTransporte(): Promise<ContratoTransporte[]> {
    const filas = this.bd
      .prepare(
        "SELECT id, origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, trabajador_id FROM contratos_transporte WHERE activo = 1",
      )
      .all();
    return filas.map((f) => this.filaAContrato(f));
  }

  async buscarContratoDeTrabajador(trabajadorId: number): Promise<ContratoTransporte | null> {
    const fila = this.bd
      .prepare(
        "SELECT id, origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, trabajador_id FROM contratos_transporte WHERE activo = 1 AND trabajador_id = ?",
      )
      .get(trabajadorId);
    return fila ? this.filaAContrato(fila) : null;
  }

  async actualizarUltimoViajeContrato(id: number, ultimoViajeResuelto: string): Promise<void> {
    this.bd.prepare("UPDATE contratos_transporte SET ultimo_viaje_resuelto = ? WHERE id = ?").run(ultimoViajeResuelto, id);
  }

  async actualizarDuracionContrato(id: number, duracionViajeSeg: number): Promise<void> {
    this.bd.prepare("UPDATE contratos_transporte SET duracion_viaje_seg = ? WHERE id = ?").run(duracionViajeSeg, id);
  }

  async desactivarContratoTransporte(id: number): Promise<void> {
    this.bd.prepare("UPDATE contratos_transporte SET activo = 0 WHERE id = ?").run(id);
  }

  async obtenerLimpiezaMazmorra(clave: string): Promise<string | null> {
    const fila = this.bd.prepare("SELECT limpiada_en FROM mazmorras_estado WHERE clave = ?").get(clave);
    return fila?.limpiada_en == null ? null : String(fila.limpiada_en);
  }

  async marcarMazmorraLimpiada(clave: string): Promise<void> {
    const ahora = new Date().toISOString();
    const r = this.bd.prepare("UPDATE mazmorras_estado SET limpiada_en = ? WHERE clave = ?").run(ahora, clave);
    if (Number(r.changes) === 0) {
      this.bd.prepare("INSERT INTO mazmorras_estado (clave, limpiada_en) VALUES (?, ?)").run(clave, ahora);
    }
  }

  private filaAAsentamiento(f: Record<string, unknown>): Asentamiento {
    return {
      id: String(f.id),
      bando: String(f.bando),
      nivelMuralla: Number(f.nivel_muralla),
      nivelEquipo: Number(f.nivel_equipo),
      comida: Number(f.comida),
      madera: Number(f.madera),
      piedra: Number(f.piedra),
      hierro: Number(f.hierro),
    };
  }

  async obtenerOCrearAsentamiento(id: string, bando = "bandido"): Promise<Asentamiento> {
    const existente = this.bd.prepare("SELECT * FROM asentamientos WHERE id = ?").get(id);
    if (existente) return this.filaAAsentamiento(existente);
    this.bd.prepare("INSERT INTO asentamientos (id, bando) VALUES (?, ?)").run(id, bando);
    return { id, bando, nivelMuralla: 1, nivelEquipo: 1, comida: 0, madera: 0, piedra: 0, hierro: 0 };
  }

  async listarAsentamientos(): Promise<Asentamiento[]> {
    return this.bd.prepare("SELECT * FROM asentamientos").all().map((f) => this.filaAAsentamiento(f));
  }

  async guardarAsentamiento(a: Asentamiento): Promise<void> {
    const r = this.bd
      .prepare(
        `UPDATE asentamientos SET bando = ?, nivel_muralla = ?, nivel_equipo = ?, comida = ?, madera = ?, piedra = ?, hierro = ? WHERE id = ?`
      )
      .run(a.bando, a.nivelMuralla, a.nivelEquipo, a.comida, a.madera, a.piedra, a.hierro, a.id);
    if (Number(r.changes) === 0) {
      this.bd
        .prepare(
          `INSERT INTO asentamientos (id, bando, nivel_muralla, nivel_equipo, comida, madera, piedra, hierro) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(a.id, a.bando, a.nivelMuralla, a.nivelEquipo, a.comida, a.madera, a.piedra, a.hierro);
    }
  }

  async listarTropas(asentamientoId: string): Promise<Tropa[]> {
    const filas = this.bd
      .prepare("SELECT id, asentamiento_id, rango, estado FROM tropas_asentamiento WHERE asentamiento_id = ?")
      .all(asentamientoId);
    return filas.map((f) => ({
      id: String(f.id),
      asentamientoId: String(f.asentamiento_id),
      rango: String(f.rango) as RangoTropa,
      estado: String(f.estado) as EstadoTropa,
    }));
  }

  async crearTropa(asentamientoId: string, rango: RangoTropa): Promise<Tropa> {
    const n = this.bd
      .prepare("SELECT COUNT(*) AS n FROM tropas_asentamiento WHERE asentamiento_id = ?")
      .get(asentamientoId);
    const id = `${asentamientoId}:${Number(n?.n ?? 0)}`;
    this.bd
      .prepare("INSERT INTO tropas_asentamiento (id, asentamiento_id, rango, estado) VALUES (?, ?, ?, 'vivo')")
      .run(id, asentamientoId, rango);
    return { id, asentamientoId, rango, estado: "vivo" };
  }

  async marcarTropaMuerta(tropaId: string): Promise<void> {
    this.bd.prepare("UPDATE tropas_asentamiento SET estado = 'muerto' WHERE id = ?").run(tropaId);
  }

  async listarFaunaSector(mapaId: string, sectorX: number, sectorY: number): Promise<FaunaSalvajeFila[]> {
    const filas = this.bd
      .prepare(
        `SELECT id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y,
                ultima_comida, ultima_bebida, gestando_desde, gestacion_duracion_dias, nacio_en,
                vida, vida_max, ataque
         FROM fauna_salvaje WHERE mapa_id = ? AND sector_x = ? AND sector_y = ?`,
      )
      .all(mapaId, sectorX, sectorY);
    return filas.map(filaFaunaSalvajeDesdeSql);
  }

  async guardarFaunaIndividuo(f: FaunaSalvajeFila): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO fauna_salvaje
           (id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y,
            ultima_comida, ultima_bebida, gestando_desde, gestacion_duracion_dias, nacio_en,
            vida, vida_max, ataque)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sexo = excluded.sexo, etapa = excluded.etapa, estado = excluded.estado,
           x = excluded.x, y = excluded.y, ultima_comida = excluded.ultima_comida,
           ultima_bebida = excluded.ultima_bebida, gestando_desde = excluded.gestando_desde,
           gestacion_duracion_dias = excluded.gestacion_duracion_dias, nacio_en = excluded.nacio_en,
           vida = excluded.vida, vida_max = excluded.vida_max, ataque = excluded.ataque`,
      )
      .run(
        f.id, f.mapaId, f.sectorX, f.sectorY, f.especieId, f.sexo, f.etapa, f.estado, f.x, f.y,
        f.ultimaComida, f.ultimaBebida, f.gestandoDesde, f.gestacionDuracionDias, f.nacioEn,
        f.vida, f.vidaMax, f.ataque,
      );
  }

  async listarHuevosSector(mapaId: string, sectorX: number, sectorY: number): Promise<FaunaHuevoFila[]> {
    const filas = this.bd
      .prepare(
        `SELECT id, mapa_id, sector_x, sector_y, especie_madre_id, x, y, puesto_en, duracion_dias
         FROM fauna_huevo WHERE mapa_id = ? AND sector_x = ? AND sector_y = ?`,
      )
      .all(mapaId, sectorX, sectorY);
    return filas.map(filaFaunaHuevoDesdeSql);
  }

  async guardarHuevo(h: FaunaHuevoFila): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO fauna_huevo (id, mapa_id, sector_x, sector_y, especie_madre_id, x, y, puesto_en, duracion_dias)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y`,
      )
      .run(h.id, h.mapaId, h.sectorX, h.sectorY, h.especieMadreId, h.x, h.y, h.puestoEn, h.duracionDias);
  }

  async borrarHuevo(id: string): Promise<void> {
    this.bd.prepare("DELETE FROM fauna_huevo WHERE id = ?").run(id);
  }

  async obtenerUltimaResolucionSector(mapaId: string, sectorX: number, sectorY: number): Promise<number | null> {
    const fila = this.bd
      .prepare("SELECT ultima_resolucion FROM fauna_sector_resuelto WHERE mapa_id = ? AND sector_x = ? AND sector_y = ?")
      .get(mapaId, sectorX, sectorY);
    return fila ? Number(fila.ultima_resolucion) : null;
  }

  async marcarSectorResuelto(mapaId: string, sectorX: number, sectorY: number, momento: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO fauna_sector_resuelto (mapa_id, sector_x, sector_y, ultima_resolucion)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(mapa_id, sector_x, sector_y) DO UPDATE SET ultima_resolucion = excluded.ultima_resolucion`,
      )
      .run(mapaId, sectorX, sectorY, momento);
  }

  async listarArbolesVivosSector(mapaId: string, sectorX: number, sectorY: number): Promise<ArbolVivoFila[]> {
    const filas = this.bd
      .prepare(
        `SELECT id, mapa_id, sector_x, sector_y, especie_id, x, y, etapa, origen, dia_plantado, estado
         FROM arboles_vivos WHERE mapa_id = ? AND sector_x = ? AND sector_y = ?`,
      )
      .all(mapaId, sectorX, sectorY);
    return filas.map(filaArbolVivoDesdeSql);
  }

  async guardarArbolVivo(a: ArbolVivoFila): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO arboles_vivos (id, mapa_id, sector_x, sector_y, especie_id, x, y, etapa, origen, dia_plantado, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET etapa = excluded.etapa, estado = excluded.estado`,
      )
      .run(a.id, a.mapaId, a.sectorX, a.sectorY, a.especieId, a.x, a.y, a.etapa, a.origen, a.diaPlantado, a.estado);
  }

  async obtenerUltimaResolucionSectorBosque(mapaId: string, sectorX: number, sectorY: number): Promise<number | null> {
    const fila = this.bd
      .prepare("SELECT ultima_resolucion FROM arboles_sector_resuelto WHERE mapa_id = ? AND sector_x = ? AND sector_y = ?")
      .get(mapaId, sectorX, sectorY);
    return fila ? Number(fila.ultima_resolucion) : null;
  }

  async marcarSectorBosqueResuelto(mapaId: string, sectorX: number, sectorY: number, momento: number): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO arboles_sector_resuelto (mapa_id, sector_x, sector_y, ultima_resolucion)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(mapa_id, sector_x, sector_y) DO UPDATE SET ultima_resolucion = excluded.ultima_resolucion`,
      )
      .run(mapaId, sectorX, sectorY, momento);
  }

  async listarCadaveresMapa(mapaId: string): Promise<CadaverFila[]> {
    const filas = this.bd
      .prepare(
        "SELECT id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor, datos_visual FROM cadaveres WHERE mapa_id = ?",
      )
      .all(mapaId);
    return filas.map(filaCadaverDesdeSql);
  }

  async crearCadaverBd(c: CadaverFila): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO cadaveres (id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor, datos_visual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.mapaId, c.tipoOrigen, c.especieOrigenId, c.x, c.y, c.muertoEn, JSON.stringify(c.contenedor), c.datosVisual ?? "");
  }

  async actualizarContenedorCadaver(id: string, contenedor: Contenedor): Promise<void> {
    this.bd.prepare("UPDATE cadaveres SET contenedor = ? WHERE id = ?").run(JSON.stringify(contenedor), id);
  }

  async borrarCadaver(id: string): Promise<void> {
    this.bd.prepare("DELETE FROM cadaveres WHERE id = ?").run(id);
  }

  async listarAnimalesGranjaMapa(mapaId: string): Promise<AnimalGranjaFila[]> {
    const filas = this.bd
      .prepare(
        "SELECT id, especie_id, mapa_id, propiedad_id, x, y, extra, en_venta_tenderete_id, en_venta_precio, creado_en FROM animales_granja WHERE mapa_id = ?",
      )
      .all(mapaId);
    return filas.map(filaAnimalGranjaDesdeSql);
  }

  async crearAnimalGranjaBd(a: AnimalGranjaFila): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO animales_granja (id, especie_id, mapa_id, propiedad_id, x, y, extra, en_venta_tenderete_id, en_venta_precio, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.especieId, a.mapaId, a.propiedadId, a.x, a.y, JSON.stringify(a.extra), a.enVentaTenderoteId, a.enVentaPrecio, a.creadoEn);
  }

  async actualizarExtraAnimalGranja(id: string, extra: Record<string, unknown>): Promise<void> {
    this.bd.prepare("UPDATE animales_granja SET extra = ? WHERE id = ?").run(JSON.stringify(extra), id);
  }

  async borrarAnimalGranja(id: string): Promise<void> {
    this.bd.prepare("DELETE FROM animales_granja WHERE id = ?").run(id);
  }

  async fijarVentaAnimalGranja(id: string, propiedadId: string, tenderoteId: string | null, precioFarycoins: number | null): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE animales_granja SET en_venta_tenderete_id = ?, en_venta_precio = ? WHERE id = ? AND propiedad_id = ?")
      .run(tenderoteId, precioFarycoins, id, propiedadId);
    return Number(r.changes) > 0;
  }

  async listarAnimalesEnVentaTenderete(tenderoteId: string): Promise<AnimalGranjaFila[]> {
    const filas = this.bd
      .prepare(
        "SELECT id, especie_id, mapa_id, propiedad_id, x, y, extra, en_venta_tenderete_id, en_venta_precio, creado_en FROM animales_granja WHERE en_venta_tenderete_id = ?",
      )
      .all(tenderoteId);
    return filas.map(filaAnimalGranjaDesdeSql);
  }

  async comprarAnimalGranja(params: {
    id: string; tenderoteId: string; propiedadDestino: string; mapaIdDestino: string; x: number; y: number;
    compradorNombre: string; duenoNombre: string;
  }): Promise<{ ok: true; especieId: string; precioTotal: number } | { ok: false; motivo: string }> {
    const fila = this.bd
      .prepare("SELECT especie_id, en_venta_precio FROM animales_granja WHERE id = ? AND en_venta_tenderete_id = ?")
      .get(params.id, params.tenderoteId);
    if (!fila) return { ok: false, motivo: "ese animal ya no está en venta aquí" };
    const precioTotal = Number(fila.en_venta_precio ?? 0);

    const comprador = await this.obtenerOCrearJugador(params.compradorNombre);
    const debito = await this.ajustarFarycoins(comprador.id, -precioTotal);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

    // Compare-and-swap: reubica SOLO si sigue en venta en ESE tenderete —
    // evita comprar dos veces el mismo animal si dos jugadores lo intentan a la vez.
    const r = this.bd
      .prepare(
        `UPDATE animales_granja SET propiedad_id = ?, mapa_id = ?, x = ?, y = ?, en_venta_tenderete_id = NULL, en_venta_precio = NULL
         WHERE id = ? AND en_venta_tenderete_id = ?`,
      )
      .run(params.propiedadDestino, params.mapaIdDestino, params.x, params.y, params.id, params.tenderoteId);
    if (Number(r.changes) === 0) {
      await this.ajustarFarycoins(comprador.id, precioTotal); // reembolso: se vendió/quitó justo antes
      return { ok: false, motivo: "ese animal se vendió justo antes" };
    }

    const vendedor = await this.obtenerOCrearJugador(params.duenoNombre, saldoInicialPara(params.duenoNombre));
    await this.ajustarFarycoins(vendedor.id, precioTotal);
    return { ok: true, especieId: String(fila.especie_id), precioTotal };
  }

  async transferirAnimalGranja(id: string, propiedadOrigen: string, propiedadDestino: string, mapaIdDestino: string, x: number, y: number): Promise<boolean> {
    const r = this.bd
      .prepare(
        `UPDATE animales_granja SET propiedad_id = ?, mapa_id = ?, x = ?, y = ?, en_venta_tenderete_id = NULL, en_venta_precio = NULL
         WHERE id = ? AND propiedad_id = ?`,
      )
      .run(propiedadDestino, mapaIdDestino, x, y, id, propiedadOrigen);
    return Number(r.changes) > 0;
  }

  async registrarMemoriaLider(
    diaIngame: number,
    evento: string,
    opciones?: { tipo?: "tropa_muerta" | "asentamiento_conquistado"; asentamientoId?: string; jugador?: string },
  ): Promise<void> {
    this.bd
      .prepare("INSERT INTO memoria_lider (dia_ingame, evento, creado_en, tipo, asentamiento_id, jugador) VALUES (?, ?, ?, ?, ?, ?)")
      .run(diaIngame, evento, new Date().toISOString(), opciones?.tipo ?? null, opciones?.asentamientoId ?? null, opciones?.jugador ?? null);
  }

  async memoriaLiderReciente(limite: number): Promise<MemoriaLider[]> {
    const filas = this.bd
      .prepare("SELECT id, dia_ingame, evento, tipo, asentamiento_id, jugador FROM memoria_lider ORDER BY id DESC LIMIT ?")
      .all(limite);
    return filas.map((f) => filaAMemoriaLider(f));
  }

  async historialJugadorEnAsentamiento(asentamientoId: string, jugador: string, limite: number): Promise<MemoriaLider[]> {
    const filas = this.bd
      .prepare("SELECT id, dia_ingame, evento, tipo, asentamiento_id, jugador FROM memoria_lider WHERE asentamiento_id = ? AND jugador = ? ORDER BY id DESC LIMIT ?")
      .all(asentamientoId, jugador, limite);
    return filas.map((f) => filaAMemoriaLider(f));
  }

  async guardarContenedor(jugadorId: number, contenedorId: string, contenedor: Contenedor): Promise<void> {
    const r = this.bd
      .prepare("UPDATE inventarios SET ancho = ?, alto = ?, siguiente_id = ?, items = ? WHERE jugador_id = ? AND contenedor_id = ?")
      .run(contenedor.ancho, contenedor.alto, contenedor.siguienteId, JSON.stringify(contenedor.items), jugadorId, contenedorId);
    if (Number(r.changes) === 0) {
      this.bd
        .prepare("INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items) VALUES (?, ?, ?, ?, ?, ?)")
        .run(jugadorId, contenedorId, contenedor.ancho, contenedor.alto, contenedor.siguienteId, JSON.stringify(contenedor.items));
    }
  }

  async cargarContenedor(jugadorId: number, contenedorId: string): Promise<Contenedor | null> {
    const f = this.bd
      .prepare("SELECT ancho, alto, siguiente_id, items FROM inventarios WHERE jugador_id = ? AND contenedor_id = ?")
      .get(jugadorId, contenedorId);
    if (!f) return null;
    return {
      ancho: Number(f.ancho),
      alto: Number(f.alto),
      siguienteId: Number(f.siguiente_id),
      items: JSON.parse(String(f.items)) as ItemInstancia[],
    };
  }

  async listarContenedores(jugadorId: number): Promise<Map<string, Contenedor>> {
    const filas = this.bd
      .prepare("SELECT contenedor_id, ancho, alto, siguiente_id, items FROM inventarios WHERE jugador_id = ?")
      .all(jugadorId);
    const mapa = new Map<string, Contenedor>();
    for (const f of filas) {
      mapa.set(String(f.contenedor_id), {
        ancho: Number(f.ancho),
        alto: Number(f.alto),
        siguienteId: Number(f.siguiente_id),
        items: JSON.parse(String(f.items)) as ItemInstancia[],
      });
    }
    return mapa;
  }

  async guardarEquipo(jugadorId: number, slots: SlotsEquipo): Promise<void> {
    // Reemplazo completo (borrar+reinsertar): más simple que upsert slot a
    // slot y el equipo de un jugador siempre cabe entero en memoria.
    this.bd.prepare("DELETE FROM equipo WHERE jugador_id = ?").run(jugadorId);
    const insertar = this.bd.prepare("INSERT INTO equipo (jugador_id, slot, item_id) VALUES (?, ?, ?)");
    for (const [slot, itemId] of Object.entries(slots)) {
      if (itemId) insertar.run(jugadorId, slot, itemId);
    }
  }

  async cargarEquipo(jugadorId: number): Promise<SlotsEquipo> {
    const filas = this.bd.prepare("SELECT slot, item_id FROM equipo WHERE jugador_id = ?").all(jugadorId);
    const slots: SlotsEquipo = {};
    for (const f of filas) slots[String(f.slot)] = String(f.item_id);
    return slots;
  }

  async crearMascota(jugadorId: number, especieId: string): Promise<Mascota> {
    const ahora = new Date().toISOString();
    const r = this.bd
      .prepare("INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en) VALUES (?, ?, 'siguiendo', NULL, ?)")
      .run(jugadorId, especieId, ahora);
    return { id: Number(r.lastInsertRowid), jugadorId, especieId, ubicacion: "siguiendo", propiedadId: null, creadoEn: ahora, montura: false, arnes: false, arnesPesoMaximo: 0 };
  }

  async listarMascotas(jugadorId: number): Promise<Mascota[]> {
    const filas = this.bd.prepare("SELECT id, jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo FROM mascotas WHERE jugador_id = ?").all(jugadorId);
    return filas.map(filaAMascota);
  }

  async actualizarUbicacionMascota(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE mascotas SET ubicacion = ?, propiedad_id = ? WHERE id = ? AND jugador_id = ?")
      .run(ubicacion, propiedadId, id, jugadorId);
    return Number(r.changes) > 0;
  }

  async ponerMonturaMascota(id: number, jugadorId: number): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE mascotas SET montura = 1 WHERE id = ? AND jugador_id = ?")
      .run(id, jugadorId);
    return Number(r.changes) > 0;
  }

  async ponerArnesMascota(id: number, jugadorId: number, pesoMaximo: number): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE mascotas SET arnes = 1, arnes_peso_maximo = ? WHERE id = ? AND jugador_id = ?")
      .run(pesoMaximo, id, jugadorId);
    return Number(r.changes) > 0;
  }

  async crearCompanero(jugadorId: number, companeroJugadorId: number, npcOrigenSlot: string, nombre: string): Promise<Companero> {
    const ahora = new Date().toISOString();
    const r = this.bd
      .prepare("INSERT INTO companeros (jugador_id, companero_jugador_id, npc_origen_slot, nombre, xp, ubicacion, propiedad_id, creado_en) VALUES (?, ?, ?, ?, 0, 'siguiendo', NULL, ?)")
      .run(jugadorId, companeroJugadorId, npcOrigenSlot, nombre, ahora);
    return { id: Number(r.lastInsertRowid), jugadorId, companeroJugadorId, npcOrigenSlot, nombre, xp: 0, ubicacion: "siguiendo", propiedadId: null, creadoEn: ahora };
  }

  async listarCompaneros(jugadorId: number): Promise<Companero[]> {
    const filas = this.bd.prepare("SELECT id, jugador_id, companero_jugador_id, npc_origen_slot, nombre, xp, ubicacion, propiedad_id, creado_en FROM companeros WHERE jugador_id = ?").all(jugadorId);
    return filas.map(filaACompanero);
  }

  async actualizarUbicacionCompanero(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE companeros SET ubicacion = ?, propiedad_id = ? WHERE id = ? AND jugador_id = ?")
      .run(ubicacion, propiedadId, id, jugadorId);
    return Number(r.changes) > 0;
  }

  async actualizarXpCompanero(id: number, jugadorId: number, xp: number): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE companeros SET xp = ? WHERE id = ? AND jugador_id = ?")
      .run(xp, id, jugadorId);
    return Number(r.changes) > 0;
  }

  async crearBarco(jugadorId: number, tipoId: string, mapaId: string, x: number, y: number): Promise<Barco> {
    const ahora = new Date().toISOString();
    const r = this.bd
      .prepare("INSERT INTO barcos (jugador_id, tipo_id, mapa_id, x, y, creado_en) VALUES (?, ?, ?, ?, ?, ?)")
      .run(jugadorId, tipoId, mapaId, x, y, ahora);
    return { id: Number(r.lastInsertRowid), jugadorId, tipoId, mapaId, x, y, creadoEn: ahora };
  }

  async listarBarcosDe(mapaId: string): Promise<Barco[]> {
    const filas = this.bd.prepare("SELECT id, jugador_id, tipo_id, mapa_id, x, y, creado_en FROM barcos WHERE mapa_id = ?").all(mapaId);
    return filas.map(filaABarco);
  }

  async actualizarPosicionBarco(id: number, mapaId: string, x: number, y: number): Promise<void> {
    this.bd.prepare("UPDATE barcos SET mapa_id = ?, x = ?, y = ? WHERE id = ?").run(mapaId, x, y, id);
  }

  async crearCarro(jugadorId: number, tipoId: string, mapaId: string, x: number, y: number, contenido: ContenidoCarro | null): Promise<Carro> {
    const ahora = new Date().toISOString();
    const contenidoJson = contenido == null ? null : JSON.stringify(contenido);
    const r = this.bd
      .prepare("INSERT INTO carros (jugador_id, tipo_id, mapa_id, x, y, creado_en, contenido) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(jugadorId, tipoId, mapaId, x, y, ahora, contenidoJson);
    return { id: Number(r.lastInsertRowid), jugadorId, tipoId, mapaId, x, y, creadoEn: ahora, contenido };
  }

  async listarCarrosDe(mapaId: string): Promise<Carro[]> {
    const filas = this.bd.prepare("SELECT id, jugador_id, tipo_id, mapa_id, x, y, creado_en, contenido FROM carros WHERE mapa_id = ?").all(mapaId);
    return filas.map(filaACarro);
  }

  async eliminarCarro(id: number): Promise<void> {
    this.bd.prepare("DELETE FROM carros WHERE id = ?").run(id);
  }

  async actualizarContenidoCarro(id: number, contenido: ContenidoCarro | null): Promise<void> {
    this.bd.prepare("UPDATE carros SET contenido = ? WHERE id = ?").run(contenido == null ? null : JSON.stringify(contenido), id);
  }

  async crearConjuntoTiro(jugadorId: number, mascotaId: number, especieAnimalId: string, carroTipoId: string, mapaId: string, x: number, y: number, contenido: ContenidoCarro | null): Promise<ConjuntoTiro> {
    const ahora = new Date().toISOString();
    const contenidoJson = contenido == null ? null : JSON.stringify(contenido);
    const r = this.bd
      .prepare("INSERT INTO conjuntos_tiro (jugador_id, mascota_id, especie_animal_id, carro_tipo_id, mapa_id, x, y, creado_en, contenido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(jugadorId, mascotaId, especieAnimalId, carroTipoId, mapaId, x, y, ahora, contenidoJson);
    return { id: Number(r.lastInsertRowid), jugadorId, mascotaId, especieAnimalId, carroTipoId, mapaId, x, y, creadoEn: ahora, contenido };
  }

  async listarConjuntosTiroDe(mapaId: string): Promise<ConjuntoTiro[]> {
    const filas = this.bd
      .prepare("SELECT id, jugador_id, mascota_id, especie_animal_id, carro_tipo_id, mapa_id, x, y, creado_en, contenido FROM conjuntos_tiro WHERE mapa_id = ?")
      .all(mapaId);
    return filas.map(filaAConjuntoTiro);
  }

  async actualizarPosicionConjuntoTiro(id: number, mapaId: string, x: number, y: number): Promise<void> {
    this.bd.prepare("UPDATE conjuntos_tiro SET mapa_id = ?, x = ?, y = ? WHERE id = ?").run(mapaId, x, y, id);
  }

  async actualizarContenidoConjuntoTiro(id: number, contenido: ContenidoCarro | null): Promise<void> {
    this.bd.prepare("UPDATE conjuntos_tiro SET contenido = ? WHERE id = ?").run(contenido == null ? null : JSON.stringify(contenido), id);
  }

  async eliminarConjuntoTiro(id: number): Promise<void> {
    this.bd.prepare("DELETE FROM conjuntos_tiro WHERE id = ?").run(id);
  }

  async guardarCasillaCultivo(c: CasillaCultivo): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO casillas_cultivo (mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_id, dia_plantado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mapa_id, idx_casilla) DO UPDATE SET
           x = excluded.x, y = excluded.y, dueno_id = excluded.dueno_id, estado = excluded.estado,
           semilla_id = excluded.semilla_id, dia_plantado = excluded.dia_plantado`,
      )
      .run(c.mapaId, c.idxCasilla, c.x, c.y, c.duenoId, c.estado, c.semillaId, c.diaPlantado);
  }

  async listarCasillasCultivoDe(mapaId: string): Promise<CasillaCultivo[]> {
    const filas = this.bd
      .prepare("SELECT mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_id, dia_plantado FROM casillas_cultivo WHERE mapa_id = ?")
      .all(mapaId);
    return filas.map(filaACasillaCultivo);
  }

  async obtenerConfigMundo(clave: string): Promise<string | null> {
    const fila = this.bd.prepare("SELECT valor FROM configuracion_mundo WHERE clave = ?").get(clave);
    return fila ? String(fila.valor) : null;
  }

  async obtenerExploracion(jugadorId: number, mapaId: string): Promise<number[]> {
    const fila = this.bd.prepare("SELECT sectores FROM exploracion WHERE jugador_id = ? AND mapa_id = ?").get(jugadorId, mapaId);
    return fila ? (JSON.parse(String(fila.sectores)) as number[]) : [];
  }

  async guardarExploracion(jugadorId: number, mapaId: string, sectores: number[]): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO exploracion (jugador_id, mapa_id, sectores) VALUES (?, ?, ?)
         ON CONFLICT(jugador_id, mapa_id) DO UPDATE SET sectores = excluded.sectores`,
      )
      .run(jugadorId, mapaId, JSON.stringify(sectores));
  }

  async fijarConfigMundo(clave: string, valor: string): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO configuracion_mundo (clave, valor) VALUES (?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
      )
      .run(clave, valor);
  }

  async crearCultivoHibrido(c: CultivoHibrido): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO cultivos_hibridos (semilla_id, cosecha_id, nombre, padre_a, padre_b, rasgos, dias_crecimiento, meses_siembra, cosecha_recurrente, cantidad_por_cosecha, color_debug, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.semillaId, c.cosechaId, c.nombre, c.padreA, c.padreB, JSON.stringify(c.rasgos),
        c.diasCrecimiento, JSON.stringify(c.mesesSiembra), c.cosechaRecurrente ? 1 : 0, c.cantidadPorCosecha, c.colorDebug, c.creadoEn,
      );
  }

  async listarCultivosHibridos(): Promise<CultivoHibrido[]> {
    const filas = this.bd.prepare("SELECT * FROM cultivos_hibridos").all() as any[];
    return filas.map(filaACultivoHibrido);
  }

  async renombrarCultivoHibrido(semillaId: string, nombre: string): Promise<void> {
    this.bd.prepare("UPDATE cultivos_hibridos SET nombre = ? WHERE semilla_id = ?").run(nombre, semillaId);
  }

  async crearPlatoCreado(p: PlatoCreado): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO platos_creados (clave, item_id, nombre, ingredientes, vida, estamina, comida, bebida, color_debug, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.clave, p.itemId, p.nombre, JSON.stringify(p.ingredientes), p.vida, p.estamina, p.comida, p.bebida, p.colorDebug, p.creadoEn);
  }

  async buscarPlatoPorClave(clave: string): Promise<PlatoCreado | null> {
    const fila = this.bd.prepare("SELECT * FROM platos_creados WHERE clave = ?").get(clave) as any;
    return fila ? filaAPlatoCreado(fila) : null;
  }

  async listarPlatosCreados(): Promise<PlatoCreado[]> {
    const filas = this.bd.prepare("SELECT * FROM platos_creados").all() as any[];
    return filas.map(filaAPlatoCreado);
  }

  async resolverCooldownTejidoLegendario(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = this.bd.prepare("SELECT ultimo_tejido_legendario_ms FROM jugadores WHERE id = ?").get(jugadorId) as any;
    const ultimo = fila && fila.ultimo_tejido_legendario_ms != null ? Number(fila.ultimo_tejido_legendario_ms) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    this.bd.prepare("UPDATE jugadores SET ultimo_tejido_legendario_ms = ? WHERE id = ?").run(ahoraMs, jugadorId);
    return true;
  }

  async crearPrendaGenerada(p: Omit<PrendaGenerada, "id" | "creadoEn">): Promise<PrendaGenerada> {
    const creadoEn = new Date().toISOString();
    const r = this.bd
      .prepare(
        `INSERT INTO prendas_generadas (creador_id, prenda_base_id, material_id, detalle, tintes, nombre, prompt_texto, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.creadorId, p.prendaBaseId, p.materialId, JSON.stringify(p.detalle), JSON.stringify(p.tintes), p.nombre, p.promptTexto, creadoEn);
    return { id: Number(r.lastInsertRowid), creadoEn, ...p };
  }

  async obtenerPrendaGenerada(id: number): Promise<PrendaGenerada | null> {
    const fila = this.bd.prepare("SELECT * FROM prendas_generadas WHERE id = ?").get(id) as any;
    return fila ? filaAPrendaGenerada(fila) : null;
  }

  async listarPrendasGeneradasDeCreador(creadorId: number): Promise<PrendaGenerada[]> {
    const filas = this.bd.prepare("SELECT * FROM prendas_generadas WHERE creador_id = ?").all(creadorId) as any[];
    return filas.map(filaAPrendaGenerada);
  }

  async resolverCooldownCarpinteriaLegendaria(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = this.bd.prepare("SELECT ultimo_carpinteria_legendaria_ms FROM jugadores WHERE id = ?").get(jugadorId) as any;
    const ultimo = fila && fila.ultimo_carpinteria_legendaria_ms != null ? Number(fila.ultimo_carpinteria_legendaria_ms) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    this.bd.prepare("UPDATE jugadores SET ultimo_carpinteria_legendaria_ms = ? WHERE id = ?").run(ahoraMs, jugadorId);
    return true;
  }

  async crearMuebleGenerado(m: Omit<MuebleGenerado, "id" | "creadoEn">): Promise<MuebleGenerado> {
    const creadoEn = new Date().toISOString();
    const r = this.bd
      .prepare(
        `INSERT INTO muebles_generados (creador_id, arquetipo_id, parametros, nombre, prompt_texto, creado_en)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(m.creadorId, m.arquetipoId, JSON.stringify(m.parametros), m.nombre, m.promptTexto, creadoEn);
    return { id: Number(r.lastInsertRowid), creadoEn, ...m };
  }

  async obtenerMuebleGenerado(id: number): Promise<MuebleGenerado | null> {
    const fila = this.bd.prepare("SELECT * FROM muebles_generados WHERE id = ?").get(id) as any;
    return fila ? filaAMuebleGenerado(fila) : null;
  }

  async listarMueblesGeneradosDeCreador(creadorId: number): Promise<MuebleGenerado[]> {
    const filas = this.bd.prepare("SELECT * FROM muebles_generados WHERE creador_id = ?").all(creadorId) as any[];
    return filas.map(filaAMuebleGenerado);
  }

  async resolverCooldownIngenieriaLegendaria(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = this.bd.prepare("SELECT ultimo_ingenieria_legendaria_ms FROM jugadores WHERE id = ?").get(jugadorId) as any;
    const ultimo = fila && fila.ultimo_ingenieria_legendaria_ms != null ? Number(fila.ultimo_ingenieria_legendaria_ms) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    this.bd.prepare("UPDATE jugadores SET ultimo_ingenieria_legendaria_ms = ? WHERE id = ?").run(ahoraMs, jugadorId);
    return true;
  }

  async crearEdificioGenerado(e: Omit<EdificioGenerado, "id" | "creadoEn">): Promise<EdificioGenerado> {
    const creadoEn = new Date().toISOString();
    const r = this.bd
      .prepare(
        `INSERT INTO edificios_generados (creador_id, tipo_edificio, parametros, nombre, prompt_texto, creado_en)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(e.creadorId, e.tipoEdificio, JSON.stringify(e.parametros), e.nombre, e.promptTexto, creadoEn);
    return { id: Number(r.lastInsertRowid), creadoEn, ...e };
  }

  async obtenerEdificioGenerado(id: number): Promise<EdificioGenerado | null> {
    const fila = this.bd.prepare("SELECT * FROM edificios_generados WHERE id = ?").get(id) as any;
    return fila ? filaAEdificioGenerado(fila) : null;
  }

  async listarEdificiosGeneradosDeCreador(creadorId: number): Promise<EdificioGenerado[]> {
    const filas = this.bd.prepare("SELECT * FROM edificios_generados WHERE creador_id = ?").all(creadorId) as any[];
    return filas.map(filaAEdificioGenerado);
  }

  async crearLibroGenerado(l: Omit<LibroGenerado, "id" | "creadoEn">): Promise<LibroGenerado> {
    const creadoEn = new Date().toISOString();
    const r = this.bd
      .prepare("INSERT INTO libros_generados (autor_id, titulo, paginas, creado_en) VALUES (?, ?, ?, ?)")
      .run(l.autorId, l.titulo, JSON.stringify(l.paginas), creadoEn);
    return { id: Number(r.lastInsertRowid), creadoEn, ...l };
  }

  async obtenerLibroGenerado(id: number): Promise<LibroGenerado | null> {
    const fila = this.bd.prepare("SELECT * FROM libros_generados WHERE id = ?").get(id) as any;
    return fila ? filaALibroGenerado(fila) : null;
  }

  async actualizarLibroGenerado(id: number, titulo: string, paginas: string[]): Promise<void> {
    this.bd.prepare("UPDATE libros_generados SET titulo = ?, paginas = ? WHERE id = ?").run(titulo, JSON.stringify(paginas), id);
  }

  async cerrar(): Promise<void> {
    this.bd.close();
  }
}

// ---------------------------------------------------------------------------
// Motor Postgres — producción (Neon). Mismo esquema y misma API que SQLite;
// aquí sí hay red de por medio, así que todo es genuinamente async con `pg`.
// La conexión usa el endpoint "pooler" de Neon (PgBouncer incluido): Render
// es un proceso siempre vivo, no serverless, así que un Pool normal por TCP
// es lo correcto (no hace falta el driver HTTP de Neon pensado para edge).
// ---------------------------------------------------------------------------
export class AlmacenDatosPostgres implements IAlmacenDatos {
  private constructor(private readonly pool: Pool) {}

  /** Crea el pool y corre las migraciones — único punto async de arranque. */
  static async crear(connectionString: string): Promise<AlmacenDatosPostgres> {
    const pool = new Pool({ connectionString });
    await pool.query(MIGRACIONES_POSTGRES);
    return new AlmacenDatosPostgres(pool);
  }

  async obtenerOCrearJugador(nombre: string, saldoInicial = SALDO_INICIAL_JUGADOR): Promise<Jugador> {
    // INSERT ... ON CONFLICT DO UPDATE + RETURNING: upsert real de Postgres,
    // devuelve la fila exista ya o se acabe de crear, en una sola ida y vuelta.
    // farycoins SOLO se fija en el INSERT (fila nueva) — el DO UPDATE nunca
    // toca esa columna, así que una fila ya existente conserva su saldo.
    const r = await this.pool.query<{ id: number; nombre: string; farycoins: number; vida: number; vida_max: number; anatomia: string | null; enfermedades: string | null; oficio_1: string; oficio_2: string; cambios_oficio: number; comida: number; bebida: number; sueno: number; estamina: number }>(
      `INSERT INTO jugadores (nombre, creado_en, farycoins) VALUES ($1, $2, $3)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre, farycoins, vida, vida_max, anatomia, enfermedades, oficio_1, oficio_2, cambios_oficio, comida, bebida, sueno, estamina`,
      [nombre, new Date().toISOString(), saldoInicial]
    );
    return {
      id: r.rows[0].id,
      nombre: r.rows[0].nombre,
      farycoins: r.rows[0].farycoins,
      vida: r.rows[0].vida,
      vidaMax: r.rows[0].vida_max,
      anatomia: r.rows[0].anatomia,
      enfermedades: r.rows[0].enfermedades,
      oficio1: r.rows[0].oficio_1 ?? "",
      oficio2: r.rows[0].oficio_2 ?? "",
      cambiosOficio: r.rows[0].cambios_oficio ?? 0,
      comida: r.rows[0].comida ?? 100,
      bebida: r.rows[0].bebida ?? 100,
      sueno: r.rows[0].sueno ?? 100,
      estamina: r.rows[0].estamina ?? 100,
    };
  }

  async fijarOficioSlot(jugadorId: number, slot: 1 | 2, oficio: string): Promise<void> {
    await this.pool.query(`UPDATE jugadores SET oficio_${slot} = $1 WHERE id = $2`, [oficio, jugadorId]);
  }

  async reiniciarXpOficio(jugadorId: number, oficio: string): Promise<void> {
    await this.pool.query("UPDATE jugador_oficios SET xp = 0 WHERE jugador_id = $1 AND oficio = $2", [jugadorId, oficio]);
  }

  async incrementarCambiosOficio(jugadorId: number): Promise<number> {
    const r = await this.pool.query<{ cambios_oficio: number }>(
      "UPDATE jugadores SET cambios_oficio = cambios_oficio + 1 WHERE id = $1 RETURNING cambios_oficio",
      [jugadorId],
    );
    return r.rows[0]?.cambios_oficio ?? 0;
  }

  async colocarNpcTutorial(datos: { mapaId: string; tipoTutorial: string; nombre: string; x: number; y: number; colocadoPor: string }): Promise<NpcTutorialColocado> {
    const colocadoEn = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      "INSERT INTO npcs_tutoriales (mapa_id, tipo_tutorial, nombre, x, y, colocado_por, colocado_en) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [datos.mapaId, datos.tipoTutorial, datos.nombre, datos.x, datos.y, datos.colocadoPor, colocadoEn],
    );
    return { id: r.rows[0].id, mapaId: datos.mapaId, tipoTutorial: datos.tipoTutorial, nombre: datos.nombre, x: datos.x, y: datos.y, colocadoPor: datos.colocadoPor, colocadoEn };
  }

  async listarNpcsTutorialesDeMapa(mapaId: string): Promise<NpcTutorialColocado[]> {
    const r = await this.pool.query<{ id: number; mapa_id: string; tipo_tutorial: string; nombre: string; x: number; y: number; colocado_por: string; colocado_en: string }>(
      "SELECT * FROM npcs_tutoriales WHERE mapa_id = $1 ORDER BY id",
      [mapaId],
    );
    return r.rows.map((f) => ({
      id: f.id, mapaId: f.mapa_id, tipoTutorial: f.tipo_tutorial, nombre: f.nombre,
      x: f.x, y: f.y, colocadoPor: f.colocado_por, colocadoEn: f.colocado_en,
    }));
  }

  async quitarNpcTutorial(id: number): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM npcs_tutoriales WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  private filaATrabajador(f: { id: number; mapa_id: string; dueno_id: number; nombre: string; oficios: string; construccion_id: number | null; receta_id: string | null; x: number; y: number; fecha_contratacion_dia: number; ultimo_pago_dia: number; mascota_asignada_id: number | null; conjunto_asignado_id: number | null }): NpcTrabajador {
    return {
      id: f.id, mapaId: f.mapa_id, duenoId: f.dueno_id, nombre: f.nombre, oficios: JSON.parse(f.oficios),
      construccionId: f.construccion_id, recetaId: f.receta_id, x: f.x, y: f.y,
      fechaContratacionDia: f.fecha_contratacion_dia, ultimoPagoDia: f.ultimo_pago_dia,
      mascotaAsignadaId: f.mascota_asignada_id, conjuntoAsignadoId: f.conjunto_asignado_id,
    };
  }

  async contratarNpcTrabajador(datos: NuevoNpcTrabajador): Promise<NpcTrabajador> {
    const creadoEn = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO npcs_trabajadores (mapa_id, dueno_id, nombre, oficios, construccion_id, receta_id, x, y, fecha_contratacion_dia, ultimo_pago_dia, creado_en)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $7, $8) RETURNING id`,
      [datos.mapaId, datos.duenoId, datos.nombre, JSON.stringify(datos.oficios), datos.x, datos.y, datos.diaActual, creadoEn],
    );
    return {
      id: r.rows[0].id, mapaId: datos.mapaId, duenoId: datos.duenoId, nombre: datos.nombre, oficios: datos.oficios,
      construccionId: null, recetaId: null, x: datos.x, y: datos.y, fechaContratacionDia: datos.diaActual, ultimoPagoDia: datos.diaActual,
      mascotaAsignadaId: null, conjuntoAsignadoId: null,
    };
  }

  async listarNpcsTrabajadoresDeMapa(mapaId: string): Promise<NpcTrabajador[]> {
    const r = await this.pool.query("SELECT * FROM npcs_trabajadores WHERE mapa_id = $1 ORDER BY id", [mapaId]);
    return r.rows.map((f) => this.filaATrabajador(f));
  }

  async listarNpcsTrabajadoresDeJugador(duenoId: number): Promise<NpcTrabajador[]> {
    const r = await this.pool.query("SELECT * FROM npcs_trabajadores WHERE dueno_id = $1 ORDER BY id", [duenoId]);
    return r.rows.map((f) => this.filaATrabajador(f));
  }

  async asignarMesaNpcTrabajador(id: number, construccionId: number, x: number, y: number): Promise<boolean> {
    const r = await this.pool.query("UPDATE npcs_trabajadores SET construccion_id = $1, x = $2, y = $3 WHERE id = $4", [construccionId, x, y, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async asignarRecetaNpcTrabajador(id: number, recetaId: string | null): Promise<boolean> {
    const r = await this.pool.query("UPDATE npcs_trabajadores SET receta_id = $1 WHERE id = $2", [recetaId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async asignarMonturaNpcTrabajador(id: number, mascotaAsignadaId: number | null, conjuntoAsignadoId: number | null): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE npcs_trabajadores SET mascota_asignada_id = $1, conjunto_asignado_id = $2 WHERE id = $3",
      [mascotaAsignadaId, conjuntoAsignadoId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async marcarPagoNpcTrabajador(ids: number[], dia: number): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query("UPDATE npcs_trabajadores SET ultimo_pago_dia = $1 WHERE id = ANY($2::int[])", [dia, ids]);
  }

  async despedirNpcTrabajador(id: number): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM npcs_trabajadores WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async actualizarVidaJugador(jugadorId: number, vida: number, vidaMax: number): Promise<void> {
    await this.pool.query("UPDATE jugadores SET vida = $1, vida_max = $2 WHERE id = $3", [vida, vidaMax, jugadorId]);
  }

  async actualizarVitalesJugador(jugadorId: number, comida: number, bebida: number, sueno: number, estamina: number): Promise<void> {
    await this.pool.query("UPDATE jugadores SET comida = $1, bebida = $2, sueno = $3, estamina = $4 WHERE id = $5", [comida, bebida, sueno, estamina, jugadorId]);
  }

  async actualizarAnatomiaJugador(jugadorId: number, anatomiaJson: string): Promise<void> {
    await this.pool.query("UPDATE jugadores SET anatomia = $1 WHERE id = $2", [anatomiaJson, jugadorId]);
  }

  async actualizarEnfermedadesJugador(jugadorId: number, enfermedadesJson: string): Promise<void> {
    await this.pool.query("UPDATE jugadores SET enfermedades = $1 WHERE id = $2", [enfermedadesJson, jugadorId]);
  }

  async crearCuentaAdmin(datos: { usuario: string; passwordHash: string | null; twitchLogin: string | null; rol: RolAdmin; mapaId: string | null }): Promise<CuentaAdmin> {
    const r = await this.pool.query(
      `INSERT INTO admin_cuentas (usuario, password_hash, twitch_login, rol, mapa_id, creado_en) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [datos.usuario, datos.passwordHash, datos.twitchLogin, datos.rol, datos.mapaId, new Date().toISOString()],
    );
    return filaACuentaAdmin(r.rows[0]);
  }

  async obtenerCuentaAdminPorUsuario(usuario: string): Promise<CuentaAdmin | null> {
    const r = await this.pool.query("SELECT * FROM admin_cuentas WHERE usuario = $1", [usuario]);
    return r.rows.length > 0 ? filaACuentaAdmin(r.rows[0]) : null;
  }

  async obtenerCuentaAdminPorTwitchLogin(twitchLogin: string): Promise<CuentaAdmin | null> {
    const r = await this.pool.query("SELECT * FROM admin_cuentas WHERE twitch_login = $1", [twitchLogin]);
    return r.rows.length > 0 ? filaACuentaAdmin(r.rows[0]) : null;
  }

  async listarCuentasAdmin(): Promise<CuentaAdmin[]> {
    const r = await this.pool.query("SELECT * FROM admin_cuentas ORDER BY id");
    return r.rows.map(filaACuentaAdmin);
  }

  async actualizarPasswordAdmin(id: number, passwordHash: string): Promise<void> {
    await this.pool.query("UPDATE admin_cuentas SET password_hash = $1 WHERE id = $2", [passwordHash, id]);
  }

  async asignarJarlDeMapa(mapaId: string, usuario: string): Promise<{ ok: boolean; motivo?: string }> {
    const cuenta = await this.obtenerCuentaAdminPorUsuario(usuario);
    if (!cuenta) return { ok: false, motivo: "no existe esa cuenta de admin" };
    if (cuenta.rol === "superadmin") return { ok: false, motivo: "una cuenta superadmin no se asigna a un mapa" };
    await this.pool.query("UPDATE admin_cuentas SET mapa_id = NULL WHERE rol = 'jarl' AND mapa_id = $1 AND usuario != $2", [mapaId, usuario]);
    await this.pool.query("UPDATE admin_cuentas SET rol = 'jarl', mapa_id = $1 WHERE id = $2", [mapaId, cuenta.id]);
    return { ok: true };
  }

  async obtenerFarycoins(jugadorId: number): Promise<number> {
    const r = await this.pool.query<{ farycoins: number }>("SELECT farycoins FROM jugadores WHERE id = $1", [jugadorId]);
    return r.rows[0]?.farycoins ?? 0;
  }

  async ajustarFarycoins(jugadorId: number, delta: number): Promise<{ ok: boolean; saldo: number }> {
    const r = await this.pool.query<{ farycoins: number }>(
      `UPDATE jugadores SET farycoins = farycoins + $1 WHERE id = $2 AND farycoins + $1 >= 0 RETURNING farycoins`,
      [delta, jugadorId]
    );
    if (r.rows.length > 0) return { ok: true, saldo: r.rows[0].farycoins };
    return { ok: false, saldo: await this.obtenerFarycoins(jugadorId) };
  }

  async obtenerXpOficio(jugadorId: number, oficio: string): Promise<number> {
    const r = await this.pool.query<{ xp: number }>(
      "SELECT xp FROM jugador_oficios WHERE jugador_id = $1 AND oficio = $2",
      [jugadorId, oficio],
    );
    return r.rows.length > 0 ? r.rows[0].xp : 0;
  }

  async sumarXpOficio(jugadorId: number, oficio: string, delta: number): Promise<number> {
    const r = await this.pool.query<{ xp: number }>(
      `INSERT INTO jugador_oficios (jugador_id, oficio, xp) VALUES ($1, $2, $3)
       ON CONFLICT (jugador_id, oficio) DO UPDATE SET xp = jugador_oficios.xp + EXCLUDED.xp
       RETURNING xp`,
      [jugadorId, oficio, delta],
    );
    return r.rows[0].xp;
  }

  async obtenerXpAtributo(jugadorId: number, atributo: string): Promise<number> {
    const r = await this.pool.query<{ xp: number }>(
      "SELECT xp FROM jugador_atributos WHERE jugador_id = $1 AND atributo = $2",
      [jugadorId, atributo],
    );
    return r.rows.length > 0 ? r.rows[0].xp : 0;
  }

  async sumarXpAtributo(jugadorId: number, atributo: string, delta: number): Promise<number> {
    const r = await this.pool.query<{ xp: number }>(
      `INSERT INTO jugador_atributos (jugador_id, atributo, xp) VALUES ($1, $2, $3)
       ON CONFLICT (jugador_id, atributo) DO UPDATE SET xp = jugador_atributos.xp + EXCLUDED.xp
       RETURNING xp`,
      [jugadorId, atributo, delta],
    );
    return r.rows[0].xp;
  }

  async obtenerUltimoDiaActividadAtributo(jugadorId: number, atributo: string): Promise<number | null> {
    const r = await this.pool.query<{ ultimo_dia_actividad: number | null }>(
      "SELECT ultimo_dia_actividad FROM jugador_atributos WHERE jugador_id = $1 AND atributo = $2",
      [jugadorId, atributo],
    );
    return r.rows.length > 0 ? r.rows[0].ultimo_dia_actividad : null;
  }

  async marcarActividadAtributoHoy(jugadorId: number, atributo: string, dia: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO jugador_atributos (jugador_id, atributo, xp, ultimo_dia_actividad) VALUES ($1, $2, 0, $3)
       ON CONFLICT (jugador_id, atributo) DO UPDATE SET ultimo_dia_actividad = EXCLUDED.ultimo_dia_actividad`,
      [jugadorId, atributo, dia],
    );
  }

  private filaAGremio(f: { id: number; nombre: string; lider_jugador_id: number; color: string; emblema_id: string; saldo_banco: number; creado_en: string }): Gremio {
    return {
      id: f.id,
      nombre: f.nombre,
      liderJugadorId: f.lider_jugador_id,
      color: f.color,
      emblemaId: f.emblema_id,
      saldoBanco: f.saldo_banco,
      creadoEn: f.creado_en,
    };
  }

  async crearGremio(nombre: string, liderJugadorId: number, color: string, emblemaId: string): Promise<ResultadoCrearGremio> {
    const ahora = new Date().toISOString();
    let gremioId: number;
    try {
      const r = await this.pool.query<{ id: number }>(
        "INSERT INTO gremios (nombre, lider_jugador_id, color, emblema_id, saldo_banco, creado_en) VALUES ($1, $2, $3, $4, 0, $5) RETURNING id",
        [nombre, liderJugadorId, color, emblemaId, ahora]
      );
      gremioId = r.rows[0].id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return { ok: false, motivo: "nombre_en_uso" };
      throw e;
    }
    try {
      await this.pool.query(
        "INSERT INTO gremio_miembros (gremio_id, jugador_id, rol, ingreso_en) VALUES ($1, $2, 'lider', $3)",
        [gremioId, liderJugadorId, ahora]
      );
    } catch (e) {
      // compensar: el jugador ya estaba en otro gremio (UNIQUE jugador_id) — deshacer el gremio recién creado
      await this.pool.query("DELETE FROM gremios WHERE id = $1", [gremioId]);
      if ((e as { code?: string }).code === "23505") return { ok: false, motivo: "ya_tienes_gremio" };
      throw e;
    }
    return { ok: true, gremio: (await this.obtenerGremio(gremioId))! };
  }

  async listarGremios(): Promise<Gremio[]> {
    const r = await this.pool.query<{ id: number; nombre: string; lider_jugador_id: number; color: string; emblema_id: string; saldo_banco: number; creado_en: string }>(
      "SELECT id, nombre, lider_jugador_id, color, emblema_id, saldo_banco, creado_en FROM gremios"
    );
    return r.rows.map((f) => this.filaAGremio(f));
  }

  async obtenerGremio(id: number): Promise<Gremio | null> {
    const r = await this.pool.query<{ id: number; nombre: string; lider_jugador_id: number; color: string; emblema_id: string; saldo_banco: number; creado_en: string }>(
      "SELECT id, nombre, lider_jugador_id, color, emblema_id, saldo_banco, creado_en FROM gremios WHERE id = $1",
      [id]
    );
    return r.rows.length > 0 ? this.filaAGremio(r.rows[0]) : null;
  }

  async listarMiembros(gremioId: number): Promise<GremioMiembro[]> {
    const r = await this.pool.query<{ gremio_id: number; jugador_id: number; jugador_nombre: string; rol: string; ingreso_en: string }>(
      `SELECT m.gremio_id, m.jugador_id, j.nombre AS jugador_nombre, m.rol, m.ingreso_en
       FROM gremio_miembros m JOIN jugadores j ON j.id = m.jugador_id WHERE m.gremio_id = $1`,
      [gremioId]
    );
    return r.rows.map((f) => ({
      gremioId: f.gremio_id,
      jugadorId: f.jugador_id,
      jugadorNombre: f.jugador_nombre,
      rol: f.rol as RolGremio,
      ingresoEn: f.ingreso_en,
    }));
  }

  async agregarMiembro(gremioId: number, jugadorId: number, rol: RolGremio): Promise<void> {
    try {
      await this.pool.query(
        "INSERT INTO gremio_miembros (gremio_id, jugador_id, rol, ingreso_en) VALUES ($1, $2, $3, $4)",
        [gremioId, jugadorId, rol, new Date().toISOString()]
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        console.warn(`agregarMiembro: jugador ${jugadorId} ya pertenece a un gremio, no se añadió a ${gremioId}`);
        return;
      }
      throw e;
    }
  }

  async quitarMiembro(gremioId: number, jugadorId: number): Promise<void> {
    await this.pool.query("DELETE FROM gremio_miembros WHERE gremio_id = $1 AND jugador_id = $2", [gremioId, jugadorId]);
  }

  async actualizarGremio(id: number, cambios: { color?: string; emblemaId?: string }): Promise<void> {
    if (cambios.color !== undefined) await this.pool.query("UPDATE gremios SET color = $1 WHERE id = $2", [cambios.color, id]);
    if (cambios.emblemaId !== undefined) {
      await this.pool.query("UPDATE gremios SET emblema_id = $1 WHERE id = $2", [cambios.emblemaId, id]);
    }
  }

  async disolverGremio(id: number): Promise<void> {
    const gremio = await this.obtenerGremio(id);
    if (gremio && gremio.saldoBanco > 0) await this.ajustarFarycoins(gremio.liderJugadorId, gremio.saldoBanco);
    await this.pool.query("DELETE FROM gremio_miembros WHERE gremio_id = $1", [id]);
    await this.pool.query("DELETE FROM gremio_invitaciones WHERE gremio_id = $1", [id]);
    await this.pool.query("DELETE FROM gremios WHERE id = $1", [id]);
  }

  async ajustarBancoGremio(gremioId: number, delta: number): Promise<{ ok: boolean; saldo: number }> {
    const r = await this.pool.query<{ saldo_banco: number }>(
      "UPDATE gremios SET saldo_banco = saldo_banco + $1 WHERE id = $2 AND saldo_banco + $1 >= 0 RETURNING saldo_banco",
      [delta, gremioId]
    );
    if (r.rows.length > 0) return { ok: true, saldo: r.rows[0].saldo_banco };
    const gremio = await this.obtenerGremio(gremioId);
    return { ok: false, saldo: gremio?.saldoBanco ?? 0 };
  }

  async guardarInventarioGremio(gremioId: number, contenedor: Contenedor): Promise<void> {
    await this.pool.query(
      `INSERT INTO gremio_inventario (gremio_id, ancho, alto, siguiente_id, items) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (gremio_id) DO UPDATE SET ancho = EXCLUDED.ancho, alto = EXCLUDED.alto, siguiente_id = EXCLUDED.siguiente_id, items = EXCLUDED.items`,
      [gremioId, contenedor.ancho, contenedor.alto, contenedor.siguienteId, JSON.stringify(contenedor.items)],
    );
  }

  async cargarInventarioGremio(gremioId: number): Promise<Contenedor | null> {
    const r = await this.pool.query<{ ancho: number; alto: number; siguiente_id: number; items: string }>(
      "SELECT ancho, alto, siguiente_id, items FROM gremio_inventario WHERE gremio_id = $1",
      [gremioId],
    );
    if (r.rows.length === 0) return null;
    const f = r.rows[0];
    return { ancho: f.ancho, alto: f.alto, siguienteId: f.siguiente_id, items: JSON.parse(f.items) as ItemInstancia[] };
  }

  async crearInvitacion(gremioId: number, jugadorId: number, invitadoPorId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO gremio_invitaciones (gremio_id, jugador_id, invitado_por, creado_en) VALUES ($1, $2, $3, $4)
       ON CONFLICT (gremio_id, jugador_id) DO UPDATE SET invitado_por = EXCLUDED.invitado_por, creado_en = EXCLUDED.creado_en`,
      [gremioId, jugadorId, invitadoPorId, new Date().toISOString()]
    );
  }

  async obtenerInvitacion(gremioId: number, jugadorId: number): Promise<{ invitadoPorId: number } | null> {
    const r = await this.pool.query<{ invitado_por: number }>(
      "SELECT invitado_por FROM gremio_invitaciones WHERE gremio_id = $1 AND jugador_id = $2",
      [gremioId, jugadorId]
    );
    return r.rows.length > 0 ? { invitadoPorId: r.rows[0].invitado_por } : null;
  }

  async eliminarInvitacion(gremioId: number, jugadorId: number): Promise<void> {
    await this.pool.query("DELETE FROM gremio_invitaciones WHERE gremio_id = $1 AND jugador_id = $2", [gremioId, jugadorId]);
  }

  private filaAPropiedad(f: {
    id: string;
    tipo: string;
    asentamiento: string;
    dueno: string | null;
    modo_tenencia: string | null;
    precio_farycoins: number | null;
    periodo_horas: number | null;
    expira_en: string | null;
    impuesto_activo: boolean | number | null;
    impuesto_farycoins: number | null;
    impuesto_periodo_horas: number | null;
    impuesto_ultimo_cobro: string | null;
  }): Propiedad & { id: string } {
    return {
      id: f.id,
      tipo: f.tipo,
      asentamiento: f.asentamiento,
      dueno: f.dueno,
      modoTenencia: f.modo_tenencia as ModoTenencia | null,
      precioFarycoins: f.precio_farycoins,
      periodoHoras: f.periodo_horas,
      expiraEn: f.expira_en,
      impuestoActivo: Boolean(f.impuesto_activo),
      impuestoFarycoins: f.impuesto_farycoins,
      impuestoPeriodoHoras: f.impuesto_periodo_horas,
      impuestoUltimoCobro: f.impuesto_ultimo_cobro,
    };
  }

  async cargarPropiedades(): Promise<Map<string, Propiedad>> {
    const r = await this.pool.query<{
      id: string; tipo: string; asentamiento: string; dueno: string | null;
      modo_tenencia: string | null; precio_farycoins: number | null; periodo_horas: number | null; expira_en: string | null;
      impuesto_activo: boolean | number | null; impuesto_farycoins: number | null; impuesto_periodo_horas: number | null; impuesto_ultimo_cobro: string | null;
    }>(
      `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en,
              p.impuesto_activo, p.impuesto_farycoins, p.impuesto_periodo_horas, p.impuesto_ultimo_cobro
       FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno`
    );
    const mapa = new Map<string, Propiedad>();
    for (const f of r.rows) {
      const { id, ...propiedad } = this.filaAPropiedad(f);
      mapa.set(id, propiedad);
    }
    return mapa;
  }

  async listarPropiedadesDeJugador(nombre: string): Promise<Array<Propiedad & { id: string }>> {
    const r = await this.pool.query<{
      id: string; tipo: string; asentamiento: string; dueno: string | null;
      modo_tenencia: string | null; precio_farycoins: number | null; periodo_horas: number | null; expira_en: string | null;
      impuesto_activo: boolean | number | null; impuesto_farycoins: number | null; impuesto_periodo_horas: number | null; impuesto_ultimo_cobro: string | null;
    }>(
      `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en,
              p.impuesto_activo, p.impuesto_farycoins, p.impuesto_periodo_horas, p.impuesto_ultimo_cobro
       FROM propiedades p JOIN jugadores j ON j.id = p.dueno
       WHERE j.nombre = $1`,
      [nombre],
    );
    return r.rows.map((f) => this.filaAPropiedad(f));
  }

  async asignarPropiedad(id: string, tipo: string, asentamiento: string, duenoNombre: string | null): Promise<void> {
    const duenoId = duenoNombre == null ? null : (await this.obtenerOCrearJugador(duenoNombre)).id;
    await this.pool.query(
      `INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         tipo = EXCLUDED.tipo, asentamiento = EXCLUDED.asentamiento,
         dueno = EXCLUDED.dueno, asignada_en = EXCLUDED.asignada_en`,
      [id, tipo, asentamiento, duenoId, new Date().toISOString()]
    );
  }

  async revocarPropiedad(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE propiedades SET dueno = NULL, asignada_en = $1, modo_tenencia = NULL, precio_farycoins = NULL, periodo_horas = NULL, expira_en = NULL WHERE id = $2`,
      [new Date().toISOString(), id],
    );
    await this.pool.query("DELETE FROM tenderete_items WHERE tenderete_id = $1", [id]);
    await this.pool.query("DELETE FROM tenderete_caja WHERE tenderete_id = $1", [id]);
  }

  /** Compare-and-swap: libera la fila SOLO si es un alquiler vencido. */
  private async liberarSiVencida(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE propiedades SET dueno = NULL, modo_tenencia = NULL, precio_farycoins = NULL, periodo_horas = NULL, expira_en = NULL
       WHERE id = $1 AND modo_tenencia = 'alquiler' AND expira_en IS NOT NULL AND expira_en < $2`,
      [id, new Date().toISOString()],
    );
  }

  async obtenerPropiedad(id: string): Promise<(Propiedad & { id: string }) | null> {
    await this.liberarSiVencida(id);
    await this.resolverImpuestoPropiedad(id);
    const r = await this.pool.query<{
      id: string; tipo: string; asentamiento: string; dueno: string | null;
      modo_tenencia: string | null; precio_farycoins: number | null; periodo_horas: number | null; expira_en: string | null;
      impuesto_activo: boolean | number | null; impuesto_farycoins: number | null; impuesto_periodo_horas: number | null; impuesto_ultimo_cobro: string | null;
    }>(
      `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en,
              p.impuesto_activo, p.impuesto_farycoins, p.impuesto_periodo_horas, p.impuesto_ultimo_cobro
       FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno WHERE p.id = $1`,
      [id],
    );
    return r.rows.length > 0 ? this.filaAPropiedad(r.rows[0]) : null;
  }

  /** Mismo contrato que la implementación SQLite — ver el doc-comment de arriba. */
  async configurarImpuestoPropiedad(id: string, activo: boolean, farycoins: number | null, periodoHoras: number | null): Promise<void> {
    await this.pool.query(
      `UPDATE propiedades SET impuesto_activo = $1, impuesto_farycoins = $2, impuesto_periodo_horas = $3, impuesto_ultimo_cobro = $4 WHERE id = $5`,
      [activo, farycoins, periodoHoras, activo ? new Date().toISOString() : null, id],
    );
  }

  /** Mismo contrato/comentario que la implementación SQLite — ver arriba. */
  private async resolverImpuestoPropiedad(id: string): Promise<void> {
    const r = await this.pool.query<{
      dueno: number | null;
      impuesto_activo: boolean | number | null;
      impuesto_farycoins: number | null;
      impuesto_periodo_horas: number | null;
      impuesto_ultimo_cobro: string | null;
    }>(
      `SELECT dueno, impuesto_activo, impuesto_farycoins, impuesto_periodo_horas, impuesto_ultimo_cobro FROM propiedades WHERE id = $1`,
      [id],
    );
    const fila = r.rows[0];
    if (!fila || !fila.dueno || !fila.impuesto_activo || !fila.impuesto_farycoins || !fila.impuesto_periodo_horas || !fila.impuesto_ultimo_cobro) {
      return;
    }
    const periodoMs = fila.impuesto_periodo_horas * 3600_000;
    const transcurridoMs = Date.now() - new Date(fila.impuesto_ultimo_cobro).getTime();
    const periodos = Math.floor(transcurridoMs / periodoMs);
    if (periodos <= 0) return;
    const total = periodos * fila.impuesto_farycoins;
    const debito = await this.ajustarFarycoins(fila.dueno, -total);
    if (!debito.ok) return;
    const nuevoUltimoCobro = new Date(new Date(fila.impuesto_ultimo_cobro).getTime() + periodos * periodoMs).toISOString();
    await this.pool.query("UPDATE propiedades SET impuesto_ultimo_cobro = $1 WHERE id = $2", [nuevoUltimoCobro, id]);
    await this.creditarJarl(total);
  }

  async comprarOAlquilar(params: {
    id: string;
    tipo: "inmueble" | "habitacion" | "plantilla";
    asentamiento: string;
    jugadorNombre: string;
    modo: ModoTenencia;
    precioFarycoins: number;
    periodoHoras: number | null;
    /** Mismo contrato que la implementación SQLite — ver su doc-comment. */
    gremioId?: number;
  }): Promise<{ ok: true; saldoRestante: number; expiraEn: string | null } | { ok: false; motivo: string }> {
    await this.liberarSiVencida(params.id);
    const jugador = await this.obtenerOCrearJugador(params.jugadorNombre);
    const debito =
      params.gremioId != null
        ? await this.ajustarBancoGremio(params.gremioId, -params.precioFarycoins)
        : await this.ajustarFarycoins(jugador.id, -params.precioFarycoins);
    if (!debito.ok) return { ok: false, motivo: params.gremioId != null ? "el banco del gremio no tiene fondos suficientes" : "no tienes suficientes Farycoins" };

    const ahora = new Date().toISOString();
    const expiraEn =
      params.modo === "alquiler" && params.periodoHoras
        ? new Date(Date.now() + params.periodoHoras * 3600_000).toISOString()
        : null;

    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en, modo_tenencia, precio_farycoins, periodo_horas, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         tipo = EXCLUDED.tipo, asentamiento = EXCLUDED.asentamiento, dueno = EXCLUDED.dueno, asignada_en = EXCLUDED.asignada_en,
         modo_tenencia = EXCLUDED.modo_tenencia, precio_farycoins = EXCLUDED.precio_farycoins, periodo_horas = EXCLUDED.periodo_horas, expira_en = EXCLUDED.expira_en
       WHERE propiedades.dueno IS NULL
       RETURNING id`,
      [params.id, params.tipo, params.asentamiento, jugador.id, ahora, params.modo, params.precioFarycoins, params.periodoHoras, expiraEn],
    );

    if (r.rows.length === 0) {
      if (params.gremioId != null) await this.ajustarBancoGremio(params.gremioId, params.precioFarycoins);
      else await this.ajustarFarycoins(jugador.id, params.precioFarycoins); // reembolso: alguien se adelantó
      return { ok: false, motivo: "ya no está disponible" };
    }
    await this.creditarJarl(params.precioFarycoins);
    return { ok: true, saldoRestante: debito.saldo, expiraEn };
  }

  /** docs/GDD_Economia.md (pedido 2026-08-30): compras/alquileres de propiedad "se pagan al jarl" — se reparte a partes iguales entre los `JARL_NOMBRES` configurados (el resto, si no divide exacto, se pierde — nunca se crea dinero de más). Sin jarl configurado, no pasa nada (mismo comportamiento sumidero de antes). */
  private async creditarJarl(precioFarycoins: number): Promise<void> {
    const jarls = nombresJarlTalCual();
    if (jarls.length === 0 || precioFarycoins <= 0) return;
    const parte = Math.floor(precioFarycoins / jarls.length);
    if (parte <= 0) return;
    for (const nombreJarl of jarls) {
      const jugadorJarl = await this.obtenerOCrearJugador(nombreJarl);
      await this.ajustarFarycoins(jugadorJarl.id, parte);
    }
  }

  async renovarTenencia(
    id: string,
    jugadorNombre: string,
    periodoHoras: number,
    precioFarycoins: number,
  ): Promise<{ ok: true; expiraEn: string } | { ok: false; motivo: string }> {
    const prop = await this.obtenerPropiedad(id);
    if (!prop || prop.dueno?.toLowerCase() !== jugadorNombre.trim().toLowerCase()) {
      return { ok: false, motivo: "no eres el dueño de esta propiedad" };
    }
    if (prop.modoTenencia !== "alquiler" || prop.expiraEn == null) {
      return { ok: false, motivo: "esta propiedad no es de alquiler" };
    }
    const jugador = await this.obtenerOCrearJugador(jugadorNombre);
    const debito = await this.ajustarFarycoins(jugador.id, -precioFarycoins);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

    const nuevaExpira = new Date(new Date(prop.expiraEn).getTime() + periodoHoras * 3600_000).toISOString();
    await this.pool.query("UPDATE propiedades SET expira_en = $1 WHERE id = $2 AND dueno = $3", [
      nuevaExpira, id, jugador.id,
    ]);
    await this.creditarJarl(precioFarycoins);
    return { ok: true, expiraEn: nuevaExpira };
  }

  async listarStockTenderete(tenderoteId: string): Promise<ItemEnVentaTenderete[]> {
    const r = await this.pool.query<{ item_id: string; cantidad: number; precio_farycoins: number }>(
      "SELECT item_id, cantidad, precio_farycoins FROM tenderete_items WHERE tenderete_id = $1",
      [tenderoteId],
    );
    return r.rows.map((f) => ({ itemId: f.item_id, cantidad: f.cantidad, precioFarycoins: f.precio_farycoins }));
  }

  async reponerStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioFarycoins: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenderete_id, item_id) DO UPDATE SET
         cantidad = tenderete_items.cantidad + EXCLUDED.cantidad, precio_farycoins = EXCLUDED.precio_farycoins`,
      [tenderoteId, itemId, cantidad, precioFarycoins],
    );
  }

  async fijarPrecioTenderete(tenderoteId: string, itemId: string, precioFarycoins: number): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE tenderete_items SET precio_farycoins = $1 WHERE tenderete_id = $2 AND item_id = $3",
      [precioFarycoins, tenderoteId, itemId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async comprarDeTenderete(params: {
    tenderoteId: string;
    itemId: string;
    cantidad: number;
    compradorNombre: string;
    duenoNombre: string;
    descuento?: number;
    abonarACaja?: boolean;
  }): Promise<
    | { ok: true; saldoRestante: number; cantidadRestante: number; precioTotal: number }
    | { ok: false; motivo: string }
  > {
    const filaPrecio = await this.pool.query<{ precio_farycoins: number }>(
      "SELECT precio_farycoins FROM tenderete_items WHERE tenderete_id = $1 AND item_id = $2",
      [params.tenderoteId, params.itemId],
    );
    if (filaPrecio.rows.length === 0) return { ok: false, motivo: "ese ítem no está en venta aquí" };
    const descuento = Math.max(-1, Math.min(1, params.descuento ?? 0));
    const precioTotal = Math.round(filaPrecio.rows[0].precio_farycoins * params.cantidad * (1 - descuento));

    const comprador = await this.obtenerOCrearJugador(params.compradorNombre);
    const debito = await this.ajustarFarycoins(comprador.id, -precioTotal);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

    const stock = await this.pool.query<{ cantidad: number }>(
      `UPDATE tenderete_items SET cantidad = cantidad - $1 WHERE tenderete_id = $2 AND item_id = $3 AND cantidad >= $1
       RETURNING cantidad`,
      [params.cantidad, params.tenderoteId, params.itemId],
    );
    if (stock.rows.length === 0) {
      await this.ajustarFarycoins(comprador.id, precioTotal); // reembolso: se agotó justo antes
      return { ok: false, motivo: "no queda stock suficiente" };
    }

    if (params.abonarACaja) {
      await this.incrementarCajaTenderete(params.tenderoteId, precioTotal);
    } else {
      const vendedor = await this.obtenerOCrearJugador(params.duenoNombre, saldoInicialPara(params.duenoNombre));
      await this.ajustarFarycoins(vendedor.id, precioTotal);
    }
    return { ok: true, saldoRestante: debito.saldo, cantidadRestante: stock.rows[0].cantidad, precioTotal };
  }

  async obtenerCajaTenderete(tenderoteId: string): Promise<number> {
    const r = await this.pool.query<{ farycoins: number }>(
      "SELECT farycoins FROM tenderete_caja WHERE tenderete_id = $1",
      [tenderoteId],
    );
    return r.rows.length ? r.rows[0].farycoins : 0;
  }

  async incrementarCajaTenderete(tenderoteId: string, farycoins: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenderete_caja (tenderete_id, farycoins) VALUES ($1, $2)
       ON CONFLICT (tenderete_id) DO UPDATE SET farycoins = tenderete_caja.farycoins + EXCLUDED.farycoins`,
      [tenderoteId, farycoins],
    );
  }

  async recogerCajaTenderete(tenderoteId: string): Promise<number> {
    // mismo criterio "secuencial, sin transacción explícita" que el resto —
    // RETURNING de un UPDATE daría el valor YA vaciado, no el de antes.
    const fila = await this.pool.query<{ farycoins: number }>(
      "SELECT farycoins FROM tenderete_caja WHERE tenderete_id = $1",
      [tenderoteId],
    );
    const cantidad = fila.rows.length ? fila.rows[0].farycoins : 0;
    if (cantidad > 0) await this.pool.query("UPDATE tenderete_caja SET farycoins = 0 WHERE tenderete_id = $1", [tenderoteId]);
    return cantidad;
  }

  async sumarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioInicial: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenderete_id, item_id) DO UPDATE SET cantidad = tenderete_items.cantidad + EXCLUDED.cantidad`,
      [tenderoteId, itemId, cantidad, precioInicial],
    );
  }

  async consumirStockTenderete(tenderoteId: string, itemId: string, cantidad: number): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE tenderete_items SET cantidad = cantidad - $1 WHERE tenderete_id = $2 AND item_id = $3 AND cantidad >= $1",
      [cantidad, tenderoteId, itemId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async venderANpc(params: {
    npcNombre: string;
    itemId: string;
    cantidad: number;
    precioUnitario: number;
    vendedorNombre: string;
  }): Promise<{ ok: true; saldoRestante: number; precioTotal: number } | { ok: false; motivo: string }> {
    const precioTotal = Math.max(0, Math.round(params.precioUnitario * params.cantidad));
    const npc = await this.obtenerOCrearJugador(params.npcNombre, saldoInicialPara(params.npcNombre));
    const debitoNpc = await this.ajustarFarycoins(npc.id, -precioTotal);
    if (!debitoNpc.ok) return { ok: false, motivo: "el comerciante no tiene suficiente dinero ahora mismo" };
    const vendedor = await this.obtenerOCrearJugador(params.vendedorNombre);
    const abono = await this.ajustarFarycoins(vendedor.id, precioTotal);
    return { ok: true, saldoRestante: abono.saldo, precioTotal };
  }


  async resolverIngresoDiarioNpc(npcNombre: string, diaActual: number): Promise<{ diasAcreditados: number; saldo: number }> {
    const fila = await this.pool.query<{ ultimo_dia_ingreso: number }>("SELECT ultimo_dia_ingreso FROM npc_comerciantes WHERE nombre = $1", [npcNombre]);
    if (fila.rows.length === 0) {
      // primera vez que se ve a este NPC: fija el día de partida, sin retroactivo.
      await this.pool.query("INSERT INTO npc_comerciantes (nombre, ultimo_dia_ingreso) VALUES ($1, $2)", [npcNombre, diaActual]);
      const npc = await this.obtenerOCrearJugador(npcNombre, saldoInicialPara(npcNombre));
      return { diasAcreditados: 0, saldo: npc.farycoins };
    }
    const ultimoDia = fila.rows[0].ultimo_dia_ingreso;
    const diasAcreditados = Math.max(0, diaActual - ultimoDia);
    const npc = await this.obtenerOCrearJugador(npcNombre, saldoInicialPara(npcNombre));
    if (diasAcreditados === 0) return { diasAcreditados: 0, saldo: npc.farycoins };
    const r = await this.ajustarFarycoins(npc.id, diasAcreditados * INGRESO_DIARIO_NPC);
    await this.pool.query("UPDATE npc_comerciantes SET ultimo_dia_ingreso = $1 WHERE nombre = $2", [diaActual, npcNombre]);
    return { diasAcreditados, saldo: r.saldo };
  }

  async fijarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioFarycoins: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenderete_items (tenderete_id, item_id, cantidad, precio_farycoins) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenderete_id, item_id) DO UPDATE SET
         cantidad = EXCLUDED.cantidad, precio_farycoins = EXCLUDED.precio_farycoins`,
      [tenderoteId, itemId, cantidad, precioFarycoins],
    );
  }

  async resolverResetStockMercader(npcNombre: string, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = await this.pool.query<{ ultimo_reset_stock_ms: string | number | null }>(
      "SELECT ultimo_reset_stock_ms FROM npc_comerciantes WHERE nombre = $1",
      [npcNombre],
    );
    const bruto = fila.rows[0]?.ultimo_reset_stock_ms;
    const ultimo = bruto != null ? Number(bruto) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    await this.pool.query("UPDATE npc_comerciantes SET ultimo_reset_stock_ms = $1 WHERE nombre = $2", [ahoraMs, npcNombre]);
    return true;
  }

  async listarConstrucciones(): Promise<Construccion[]> {
    const r = await this.pool.query<{
      id: number;
      propiedad: string;
      objeto: string;
      categoria: string;
      x: number;
      y: number;
      rot: number;
      variante: number;
      extra: string | null;
    }>("SELECT id, propiedad, objeto, categoria, x, y, rot, variante, extra FROM construcciones");
    return r.rows.map((f) => ({
      ...f,
      extra: f.extra == null ? null : (JSON.parse(f.extra) as Record<string, unknown>),
    }));
  }

  async insertarConstruccion(c: NuevaConstruccion): Promise<number> {
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO construcciones (propiedad, objeto, categoria, x, y, rot, variante, extra, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        c.propiedad,
        c.objeto,
        c.categoria,
        c.x,
        c.y,
        c.rot,
        c.variante,
        c.extra == null ? null : JSON.stringify(c.extra),
        new Date().toISOString(),
      ]
    );
    return r.rows[0].id;
  }

  async borrarConstruccion(id: number): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM construcciones WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async actualizarExtraConstruccion(id: number, extra: Record<string, unknown> | null): Promise<void> {
    await this.pool.query("UPDATE construcciones SET extra = $1 WHERE id = $2", [
      extra == null ? null : JSON.stringify(extra), id,
    ]);
  }

  private filaAContrato(f: {
    id: number; origen_construccion_id: number; destino_tenderete_id: string; dueno: number; item_id: string;
    camino_ida: string; camino_vuelta: string; duracion_viaje_seg: number; carga_por_viaje: number;
    ultimo_viaje_resuelto: string; activo: number; trabajador_id: number | null;
  }): ContratoTransporte {
    return {
      id: f.id, origenConstruccionId: f.origen_construccion_id, destinoTenderoteId: f.destino_tenderete_id,
      dueno: f.dueno, itemId: f.item_id, caminoIda: JSON.parse(f.camino_ida), caminoVuelta: JSON.parse(f.camino_vuelta),
      duracionViajeSeg: f.duracion_viaje_seg, cargaPorViaje: f.carga_por_viaje,
      ultimoViajeResuelto: f.ultimo_viaje_resuelto, activo: f.activo === 1,
      trabajadorId: f.trabajador_id == null ? null : Number(f.trabajador_id),
    };
  }

  async crearContratoTransporte(c: NuevoContratoTransporte): Promise<ContratoTransporte> {
    const ahora = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO contratos_transporte
         (origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, creado_en, trabajador_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $9, $10) RETURNING id`,
      [
        c.origenConstruccionId, c.destinoTenderoteId, c.dueno, c.itemId,
        JSON.stringify(c.caminoIda), JSON.stringify(c.caminoVuelta),
        c.duracionViajeSeg, c.cargaPorViaje, ahora, c.trabajadorId ?? null,
      ],
    );
    return {
      id: r.rows[0].id, origenConstruccionId: c.origenConstruccionId, destinoTenderoteId: c.destinoTenderoteId,
      dueno: c.dueno, itemId: c.itemId, caminoIda: c.caminoIda, caminoVuelta: c.caminoVuelta,
      duracionViajeSeg: c.duracionViajeSeg, cargaPorViaje: c.cargaPorViaje, ultimoViajeResuelto: ahora, activo: true,
      trabajadorId: c.trabajadorId ?? null,
    };
  }

  async listarContratosTransporte(): Promise<ContratoTransporte[]> {
    const r = await this.pool.query<{
      id: number; origen_construccion_id: number; destino_tenderete_id: string; dueno: number; item_id: string;
      camino_ida: string; camino_vuelta: string; duracion_viaje_seg: number; carga_por_viaje: number;
      ultimo_viaje_resuelto: string; activo: number; trabajador_id: number | null;
    }>(
      "SELECT id, origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, trabajador_id FROM contratos_transporte WHERE activo = 1",
    );
    return r.rows.map((f) => this.filaAContrato(f));
  }

  async buscarContratoDeTrabajador(trabajadorId: number): Promise<ContratoTransporte | null> {
    const r = await this.pool.query<{
      id: number; origen_construccion_id: number; destino_tenderete_id: string; dueno: number; item_id: string;
      camino_ida: string; camino_vuelta: string; duracion_viaje_seg: number; carga_por_viaje: number;
      ultimo_viaje_resuelto: string; activo: number; trabajador_id: number | null;
    }>(
      "SELECT id, origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, trabajador_id FROM contratos_transporte WHERE activo = 1 AND trabajador_id = $1",
      [trabajadorId],
    );
    return r.rows[0] ? this.filaAContrato(r.rows[0]) : null;
  }

  async actualizarUltimoViajeContrato(id: number, ultimoViajeResuelto: string): Promise<void> {
    await this.pool.query("UPDATE contratos_transporte SET ultimo_viaje_resuelto = $1 WHERE id = $2", [ultimoViajeResuelto, id]);
  }

  async actualizarDuracionContrato(id: number, duracionViajeSeg: number): Promise<void> {
    await this.pool.query("UPDATE contratos_transporte SET duracion_viaje_seg = $1 WHERE id = $2", [duracionViajeSeg, id]);
  }

  async desactivarContratoTransporte(id: number): Promise<void> {
    await this.pool.query("UPDATE contratos_transporte SET activo = 0 WHERE id = $1", [id]);
  }

  async obtenerLimpiezaMazmorra(clave: string): Promise<string | null> {
    const r = await this.pool.query<{ limpiada_en: string | null }>(
      "SELECT limpiada_en FROM mazmorras_estado WHERE clave = $1",
      [clave],
    );
    return r.rows[0]?.limpiada_en ?? null;
  }

  async marcarMazmorraLimpiada(clave: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO mazmorras_estado (clave, limpiada_en) VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET limpiada_en = EXCLUDED.limpiada_en`,
      [clave, new Date().toISOString()],
    );
  }

  async obtenerOCrearAsentamiento(id: string, bando = "bandido"): Promise<Asentamiento> {
    const r = await this.pool.query(
      `INSERT INTO asentamientos (id, bando) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
       RETURNING id, bando, nivel_muralla, nivel_equipo, comida, madera, piedra, hierro`,
      [id, bando],
    );
    const f = r.rows[0];
    return {
      id: f.id, bando: f.bando, nivelMuralla: f.nivel_muralla, nivelEquipo: f.nivel_equipo,
      comida: f.comida, madera: f.madera, piedra: f.piedra, hierro: f.hierro,
    };
  }

  async listarAsentamientos(): Promise<Asentamiento[]> {
    const r = await this.pool.query(
      "SELECT id, bando, nivel_muralla, nivel_equipo, comida, madera, piedra, hierro FROM asentamientos",
    );
    return r.rows.map((f) => ({
      id: f.id, bando: f.bando, nivelMuralla: f.nivel_muralla, nivelEquipo: f.nivel_equipo,
      comida: f.comida, madera: f.madera, piedra: f.piedra, hierro: f.hierro,
    }));
  }

  async guardarAsentamiento(a: Asentamiento): Promise<void> {
    await this.pool.query(
      `INSERT INTO asentamientos (id, bando, nivel_muralla, nivel_equipo, comida, madera, piedra, hierro)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         bando = EXCLUDED.bando, nivel_muralla = EXCLUDED.nivel_muralla, nivel_equipo = EXCLUDED.nivel_equipo,
         comida = EXCLUDED.comida, madera = EXCLUDED.madera, piedra = EXCLUDED.piedra, hierro = EXCLUDED.hierro`,
      [a.id, a.bando, a.nivelMuralla, a.nivelEquipo, a.comida, a.madera, a.piedra, a.hierro],
    );
  }

  async listarTropas(asentamientoId: string): Promise<Tropa[]> {
    const r = await this.pool.query(
      "SELECT id, asentamiento_id, rango, estado FROM tropas_asentamiento WHERE asentamiento_id = $1",
      [asentamientoId],
    );
    return r.rows.map((f) => ({ id: f.id, asentamientoId: f.asentamiento_id, rango: f.rango, estado: f.estado }));
  }

  async crearTropa(asentamientoId: string, rango: RangoTropa): Promise<Tropa> {
    const n = await this.pool.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM tropas_asentamiento WHERE asentamiento_id = $1",
      [asentamientoId],
    );
    const id = `${asentamientoId}:${Number(n.rows[0].n)}`;
    await this.pool.query(
      "INSERT INTO tropas_asentamiento (id, asentamiento_id, rango, estado) VALUES ($1, $2, $3, 'vivo')",
      [id, asentamientoId, rango],
    );
    return { id, asentamientoId, rango, estado: "vivo" };
  }

  async marcarTropaMuerta(tropaId: string): Promise<void> {
    await this.pool.query("UPDATE tropas_asentamiento SET estado = 'muerto' WHERE id = $1", [tropaId]);
  }

  async listarFaunaSector(mapaId: string, sectorX: number, sectorY: number): Promise<FaunaSalvajeFila[]> {
    const r = await this.pool.query(
      `SELECT id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y,
              ultima_comida, ultima_bebida, gestando_desde, gestacion_duracion_dias, nacio_en,
              vida, vida_max, ataque
       FROM fauna_salvaje WHERE mapa_id = $1 AND sector_x = $2 AND sector_y = $3`,
      [mapaId, sectorX, sectorY],
    );
    return r.rows.map(filaFaunaSalvajeDesdeSql);
  }

  async guardarFaunaIndividuo(f: FaunaSalvajeFila): Promise<void> {
    await this.pool.query(
      `INSERT INTO fauna_salvaje
         (id, mapa_id, sector_x, sector_y, especie_id, sexo, etapa, estado, x, y,
          ultima_comida, ultima_bebida, gestando_desde, gestacion_duracion_dias, nacio_en,
          vida, vida_max, ataque)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO UPDATE SET
         sexo = EXCLUDED.sexo, etapa = EXCLUDED.etapa, estado = EXCLUDED.estado,
         x = EXCLUDED.x, y = EXCLUDED.y, ultima_comida = EXCLUDED.ultima_comida,
         ultima_bebida = EXCLUDED.ultima_bebida, gestando_desde = EXCLUDED.gestando_desde,
         gestacion_duracion_dias = EXCLUDED.gestacion_duracion_dias, nacio_en = EXCLUDED.nacio_en,
         vida = EXCLUDED.vida, vida_max = EXCLUDED.vida_max, ataque = EXCLUDED.ataque`,
      [
        f.id, f.mapaId, f.sectorX, f.sectorY, f.especieId, f.sexo, f.etapa, f.estado, f.x, f.y,
        f.ultimaComida, f.ultimaBebida, f.gestandoDesde, f.gestacionDuracionDias, f.nacioEn,
        f.vida, f.vidaMax, f.ataque,
      ],
    );
  }

  async listarHuevosSector(mapaId: string, sectorX: number, sectorY: number): Promise<FaunaHuevoFila[]> {
    const r = await this.pool.query(
      `SELECT id, mapa_id, sector_x, sector_y, especie_madre_id, x, y, puesto_en, duracion_dias
       FROM fauna_huevo WHERE mapa_id = $1 AND sector_x = $2 AND sector_y = $3`,
      [mapaId, sectorX, sectorY],
    );
    return r.rows.map(filaFaunaHuevoDesdeSql);
  }

  async guardarHuevo(h: FaunaHuevoFila): Promise<void> {
    await this.pool.query(
      `INSERT INTO fauna_huevo (id, mapa_id, sector_x, sector_y, especie_madre_id, x, y, puesto_en, duracion_dias)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y`,
      [h.id, h.mapaId, h.sectorX, h.sectorY, h.especieMadreId, h.x, h.y, h.puestoEn, h.duracionDias],
    );
  }

  async borrarHuevo(id: string): Promise<void> {
    await this.pool.query("DELETE FROM fauna_huevo WHERE id = $1", [id]);
  }

  async obtenerUltimaResolucionSector(mapaId: string, sectorX: number, sectorY: number): Promise<number | null> {
    const r = await this.pool.query<{ ultima_resolucion: string }>(
      "SELECT ultima_resolucion FROM fauna_sector_resuelto WHERE mapa_id = $1 AND sector_x = $2 AND sector_y = $3",
      [mapaId, sectorX, sectorY],
    );
    return r.rows.length > 0 ? Number(r.rows[0].ultima_resolucion) : null;
  }

  async marcarSectorResuelto(mapaId: string, sectorX: number, sectorY: number, momento: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO fauna_sector_resuelto (mapa_id, sector_x, sector_y, ultima_resolucion)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mapa_id, sector_x, sector_y) DO UPDATE SET ultima_resolucion = EXCLUDED.ultima_resolucion`,
      [mapaId, sectorX, sectorY, momento],
    );
  }

  async listarArbolesVivosSector(mapaId: string, sectorX: number, sectorY: number): Promise<ArbolVivoFila[]> {
    const r = await this.pool.query(
      `SELECT id, mapa_id, sector_x, sector_y, especie_id, x, y, etapa, origen, dia_plantado, estado
       FROM arboles_vivos WHERE mapa_id = $1 AND sector_x = $2 AND sector_y = $3`,
      [mapaId, sectorX, sectorY],
    );
    return r.rows.map(filaArbolVivoDesdeSql);
  }

  async guardarArbolVivo(a: ArbolVivoFila): Promise<void> {
    await this.pool.query(
      `INSERT INTO arboles_vivos (id, mapa_id, sector_x, sector_y, especie_id, x, y, etapa, origen, dia_plantado, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET etapa = EXCLUDED.etapa, estado = EXCLUDED.estado`,
      [a.id, a.mapaId, a.sectorX, a.sectorY, a.especieId, a.x, a.y, a.etapa, a.origen, a.diaPlantado, a.estado],
    );
  }

  async obtenerUltimaResolucionSectorBosque(mapaId: string, sectorX: number, sectorY: number): Promise<number | null> {
    const r = await this.pool.query(
      "SELECT ultima_resolucion FROM arboles_sector_resuelto WHERE mapa_id = $1 AND sector_x = $2 AND sector_y = $3",
      [mapaId, sectorX, sectorY],
    );
    return r.rows[0] ? Number(r.rows[0].ultima_resolucion) : null;
  }

  async marcarSectorBosqueResuelto(mapaId: string, sectorX: number, sectorY: number, momento: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO arboles_sector_resuelto (mapa_id, sector_x, sector_y, ultima_resolucion)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mapa_id, sector_x, sector_y) DO UPDATE SET ultima_resolucion = EXCLUDED.ultima_resolucion`,
      [mapaId, sectorX, sectorY, momento],
    );
  }

  async listarCadaveresMapa(mapaId: string): Promise<CadaverFila[]> {
    const r = await this.pool.query(
      "SELECT id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor, datos_visual FROM cadaveres WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaCadaverDesdeSql);
  }

  async crearCadaverBd(c: CadaverFila): Promise<void> {
    await this.pool.query(
      `INSERT INTO cadaveres (id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor, datos_visual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.id, c.mapaId, c.tipoOrigen, c.especieOrigenId, c.x, c.y, c.muertoEn, JSON.stringify(c.contenedor), c.datosVisual ?? ""],
    );
  }

  async actualizarContenedorCadaver(id: string, contenedor: Contenedor): Promise<void> {
    await this.pool.query("UPDATE cadaveres SET contenedor = $1 WHERE id = $2", [JSON.stringify(contenedor), id]);
  }

  async borrarCadaver(id: string): Promise<void> {
    await this.pool.query("DELETE FROM cadaveres WHERE id = $1", [id]);
  }

  async listarAnimalesGranjaMapa(mapaId: string): Promise<AnimalGranjaFila[]> {
    const r = await this.pool.query(
      "SELECT id, especie_id, mapa_id, propiedad_id, x, y, extra, en_venta_tenderete_id, en_venta_precio, creado_en FROM animales_granja WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaAnimalGranjaDesdeSql);
  }

  async crearAnimalGranjaBd(a: AnimalGranjaFila): Promise<void> {
    await this.pool.query(
      `INSERT INTO animales_granja (id, especie_id, mapa_id, propiedad_id, x, y, extra, en_venta_tenderete_id, en_venta_precio, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [a.id, a.especieId, a.mapaId, a.propiedadId, a.x, a.y, JSON.stringify(a.extra), a.enVentaTenderoteId, a.enVentaPrecio, a.creadoEn],
    );
  }

  async actualizarExtraAnimalGranja(id: string, extra: Record<string, unknown>): Promise<void> {
    await this.pool.query("UPDATE animales_granja SET extra = $1 WHERE id = $2", [JSON.stringify(extra), id]);
  }

  async borrarAnimalGranja(id: string): Promise<void> {
    await this.pool.query("DELETE FROM animales_granja WHERE id = $1", [id]);
  }

  async fijarVentaAnimalGranja(id: string, propiedadId: string, tenderoteId: string | null, precioFarycoins: number | null): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE animales_granja SET en_venta_tenderete_id = $1, en_venta_precio = $2 WHERE id = $3 AND propiedad_id = $4",
      [tenderoteId, precioFarycoins, id, propiedadId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listarAnimalesEnVentaTenderete(tenderoteId: string): Promise<AnimalGranjaFila[]> {
    const r = await this.pool.query(
      "SELECT id, especie_id, mapa_id, propiedad_id, x, y, extra, en_venta_tenderete_id, en_venta_precio, creado_en FROM animales_granja WHERE en_venta_tenderete_id = $1",
      [tenderoteId],
    );
    return r.rows.map(filaAnimalGranjaDesdeSql);
  }

  async comprarAnimalGranja(params: {
    id: string; tenderoteId: string; propiedadDestino: string; mapaIdDestino: string; x: number; y: number;
    compradorNombre: string; duenoNombre: string;
  }): Promise<{ ok: true; especieId: string; precioTotal: number } | { ok: false; motivo: string }> {
    const filaPrecio = await this.pool.query<{ especie_id: string; en_venta_precio: number | null }>(
      "SELECT especie_id, en_venta_precio FROM animales_granja WHERE id = $1 AND en_venta_tenderete_id = $2",
      [params.id, params.tenderoteId],
    );
    if (filaPrecio.rows.length === 0) return { ok: false, motivo: "ese animal ya no está en venta aquí" };
    const precioTotal = Number(filaPrecio.rows[0].en_venta_precio ?? 0);

    const comprador = await this.obtenerOCrearJugador(params.compradorNombre);
    const debito = await this.ajustarFarycoins(comprador.id, -precioTotal);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

    const r = await this.pool.query(
      `UPDATE animales_granja SET propiedad_id = $1, mapa_id = $2, x = $3, y = $4, en_venta_tenderete_id = NULL, en_venta_precio = NULL
       WHERE id = $5 AND en_venta_tenderete_id = $6`,
      [params.propiedadDestino, params.mapaIdDestino, params.x, params.y, params.id, params.tenderoteId],
    );
    if ((r.rowCount ?? 0) === 0) {
      await this.ajustarFarycoins(comprador.id, precioTotal); // reembolso: se vendió/quitó justo antes
      return { ok: false, motivo: "ese animal se vendió justo antes" };
    }

    const vendedor = await this.obtenerOCrearJugador(params.duenoNombre, saldoInicialPara(params.duenoNombre));
    await this.ajustarFarycoins(vendedor.id, precioTotal);
    return { ok: true, especieId: filaPrecio.rows[0].especie_id, precioTotal };
  }

  async transferirAnimalGranja(id: string, propiedadOrigen: string, propiedadDestino: string, mapaIdDestino: string, x: number, y: number): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE animales_granja SET propiedad_id = $1, mapa_id = $2, x = $3, y = $4, en_venta_tenderete_id = NULL, en_venta_precio = NULL
       WHERE id = $5 AND propiedad_id = $6`,
      [propiedadDestino, mapaIdDestino, x, y, id, propiedadOrigen],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async registrarMemoriaLider(
    diaIngame: number,
    evento: string,
    opciones?: { tipo?: "tropa_muerta" | "asentamiento_conquistado"; asentamientoId?: string; jugador?: string },
  ): Promise<void> {
    await this.pool.query(
      "INSERT INTO memoria_lider (dia_ingame, evento, creado_en, tipo, asentamiento_id, jugador) VALUES ($1, $2, $3, $4, $5, $6)",
      [diaIngame, evento, new Date().toISOString(), opciones?.tipo ?? null, opciones?.asentamientoId ?? null, opciones?.jugador ?? null],
    );
  }

  async memoriaLiderReciente(limite: number): Promise<MemoriaLider[]> {
    const r = await this.pool.query(
      "SELECT id, dia_ingame, evento, tipo, asentamiento_id, jugador FROM memoria_lider ORDER BY id DESC LIMIT $1",
      [limite],
    );
    return r.rows.map((f) => filaAMemoriaLider(f));
  }

  async historialJugadorEnAsentamiento(asentamientoId: string, jugador: string, limite: number): Promise<MemoriaLider[]> {
    const r = await this.pool.query(
      "SELECT id, dia_ingame, evento, tipo, asentamiento_id, jugador FROM memoria_lider WHERE asentamiento_id = $1 AND jugador = $2 ORDER BY id DESC LIMIT $3",
      [asentamientoId, jugador, limite],
    );
    return r.rows.map((f) => filaAMemoriaLider(f));
  }

  async guardarContenedor(jugadorId: number, contenedorId: string, contenedor: Contenedor): Promise<void> {
    await this.pool.query(
      `INSERT INTO inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (jugador_id, contenedor_id) DO UPDATE SET
         ancho = EXCLUDED.ancho, alto = EXCLUDED.alto, siguiente_id = EXCLUDED.siguiente_id, items = EXCLUDED.items`,
      [jugadorId, contenedorId, contenedor.ancho, contenedor.alto, contenedor.siguienteId, JSON.stringify(contenedor.items)],
    );
  }

  async cargarContenedor(jugadorId: number, contenedorId: string): Promise<Contenedor | null> {
    const r = await this.pool.query<{ ancho: number; alto: number; siguiente_id: number; items: string }>(
      "SELECT ancho, alto, siguiente_id, items FROM inventarios WHERE jugador_id = $1 AND contenedor_id = $2",
      [jugadorId, contenedorId],
    );
    const f = r.rows[0];
    if (!f) return null;
    return { ancho: f.ancho, alto: f.alto, siguienteId: f.siguiente_id, items: JSON.parse(f.items) as ItemInstancia[] };
  }

  async listarContenedores(jugadorId: number): Promise<Map<string, Contenedor>> {
    const r = await this.pool.query<{ contenedor_id: string; ancho: number; alto: number; siguiente_id: number; items: string }>(
      "SELECT contenedor_id, ancho, alto, siguiente_id, items FROM inventarios WHERE jugador_id = $1",
      [jugadorId],
    );
    const mapa = new Map<string, Contenedor>();
    for (const f of r.rows) {
      mapa.set(f.contenedor_id, { ancho: f.ancho, alto: f.alto, siguienteId: f.siguiente_id, items: JSON.parse(f.items) as ItemInstancia[] });
    }
    return mapa;
  }

  async guardarEquipo(jugadorId: number, slots: SlotsEquipo): Promise<void> {
    await this.pool.query("DELETE FROM equipo WHERE jugador_id = $1", [jugadorId]);
    for (const [slot, itemId] of Object.entries(slots)) {
      if (itemId) await this.pool.query("INSERT INTO equipo (jugador_id, slot, item_id) VALUES ($1, $2, $3)", [jugadorId, slot, itemId]);
    }
  }

  async cargarEquipo(jugadorId: number): Promise<SlotsEquipo> {
    const r = await this.pool.query<{ slot: string; item_id: string }>("SELECT slot, item_id FROM equipo WHERE jugador_id = $1", [
      jugadorId,
    ]);
    const slots: SlotsEquipo = {};
    for (const f of r.rows) slots[f.slot] = f.item_id;
    return slots;
  }

  async crearMascota(jugadorId: number, especieId: string): Promise<Mascota> {
    const ahora = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      "INSERT INTO mascotas (jugador_id, especie_id, ubicacion, propiedad_id, creado_en) VALUES ($1, $2, 'siguiendo', NULL, $3) RETURNING id",
      [jugadorId, especieId, ahora],
    );
    return { id: r.rows[0].id, jugadorId, especieId, ubicacion: "siguiendo", propiedadId: null, creadoEn: ahora, montura: false, arnes: false, arnesPesoMaximo: 0 };
  }

  async listarMascotas(jugadorId: number): Promise<Mascota[]> {
    const r = await this.pool.query(
      "SELECT id, jugador_id, especie_id, ubicacion, propiedad_id, creado_en, montura, arnes, arnes_peso_maximo FROM mascotas WHERE jugador_id = $1",
      [jugadorId],
    );
    return r.rows.map(filaAMascota);
  }

  async actualizarUbicacionMascota(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE mascotas SET ubicacion = $1, propiedad_id = $2 WHERE id = $3 AND jugador_id = $4",
      [ubicacion, propiedadId, id, jugadorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async ponerMonturaMascota(id: number, jugadorId: number): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE mascotas SET montura = TRUE WHERE id = $1 AND jugador_id = $2",
      [id, jugadorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async ponerArnesMascota(id: number, jugadorId: number, pesoMaximo: number): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE mascotas SET arnes = TRUE, arnes_peso_maximo = $1 WHERE id = $2 AND jugador_id = $3",
      [pesoMaximo, id, jugadorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async crearCompanero(jugadorId: number, companeroJugadorId: number, npcOrigenSlot: string, nombre: string): Promise<Companero> {
    const ahora = new Date().toISOString();
    const r = await this.pool.query(
      "INSERT INTO companeros (jugador_id, companero_jugador_id, npc_origen_slot, nombre, xp, ubicacion, propiedad_id, creado_en) VALUES ($1, $2, $3, $4, 0, 'siguiendo', NULL, $5) RETURNING id",
      [jugadorId, companeroJugadorId, npcOrigenSlot, nombre, ahora],
    );
    return { id: r.rows[0].id, jugadorId, companeroJugadorId, npcOrigenSlot, nombre, xp: 0, ubicacion: "siguiendo", propiedadId: null, creadoEn: ahora };
  }

  async listarCompaneros(jugadorId: number): Promise<Companero[]> {
    const r = await this.pool.query(
      "SELECT id, jugador_id, companero_jugador_id, npc_origen_slot, nombre, xp, ubicacion, propiedad_id, creado_en FROM companeros WHERE jugador_id = $1",
      [jugadorId],
    );
    return r.rows.map(filaACompanero);
  }

  async actualizarUbicacionCompanero(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE companeros SET ubicacion = $1, propiedad_id = $2 WHERE id = $3 AND jugador_id = $4",
      [ubicacion, propiedadId, id, jugadorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async actualizarXpCompanero(id: number, jugadorId: number, xp: number): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE companeros SET xp = $1 WHERE id = $2 AND jugador_id = $3",
      [xp, id, jugadorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async crearBarco(jugadorId: number, tipoId: string, mapaId: string, x: number, y: number): Promise<Barco> {
    const ahora = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      "INSERT INTO barcos (jugador_id, tipo_id, mapa_id, x, y, creado_en) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [jugadorId, tipoId, mapaId, x, y, ahora],
    );
    return { id: r.rows[0].id, jugadorId, tipoId, mapaId, x, y, creadoEn: ahora };
  }

  async listarBarcosDe(mapaId: string): Promise<Barco[]> {
    const r = await this.pool.query(
      "SELECT id, jugador_id, tipo_id, mapa_id, x, y, creado_en FROM barcos WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaABarco);
  }

  async actualizarPosicionBarco(id: number, mapaId: string, x: number, y: number): Promise<void> {
    await this.pool.query("UPDATE barcos SET mapa_id = $1, x = $2, y = $3 WHERE id = $4", [mapaId, x, y, id]);
  }

  async crearCarro(jugadorId: number, tipoId: string, mapaId: string, x: number, y: number, contenido: ContenidoCarro | null): Promise<Carro> {
    const ahora = new Date().toISOString();
    const contenidoJson = contenido == null ? null : JSON.stringify(contenido);
    const r = await this.pool.query<{ id: number }>(
      "INSERT INTO carros (jugador_id, tipo_id, mapa_id, x, y, creado_en, contenido) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [jugadorId, tipoId, mapaId, x, y, ahora, contenidoJson],
    );
    return { id: r.rows[0].id, jugadorId, tipoId, mapaId, x, y, creadoEn: ahora, contenido };
  }

  async listarCarrosDe(mapaId: string): Promise<Carro[]> {
    const r = await this.pool.query(
      "SELECT id, jugador_id, tipo_id, mapa_id, x, y, creado_en, contenido FROM carros WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaACarro);
  }

  async eliminarCarro(id: number): Promise<void> {
    await this.pool.query("DELETE FROM carros WHERE id = $1", [id]);
  }

  async actualizarContenidoCarro(id: number, contenido: ContenidoCarro | null): Promise<void> {
    await this.pool.query("UPDATE carros SET contenido = $1 WHERE id = $2", [contenido == null ? null : JSON.stringify(contenido), id]);
  }

  async crearConjuntoTiro(jugadorId: number, mascotaId: number, especieAnimalId: string, carroTipoId: string, mapaId: string, x: number, y: number, contenido: ContenidoCarro | null): Promise<ConjuntoTiro> {
    const ahora = new Date().toISOString();
    const contenidoJson = contenido == null ? null : JSON.stringify(contenido);
    const r = await this.pool.query<{ id: number }>(
      "INSERT INTO conjuntos_tiro (jugador_id, mascota_id, especie_animal_id, carro_tipo_id, mapa_id, x, y, creado_en, contenido) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
      [jugadorId, mascotaId, especieAnimalId, carroTipoId, mapaId, x, y, ahora, contenidoJson],
    );
    return { id: r.rows[0].id, jugadorId, mascotaId, especieAnimalId, carroTipoId, mapaId, x, y, creadoEn: ahora, contenido };
  }

  async listarConjuntosTiroDe(mapaId: string): Promise<ConjuntoTiro[]> {
    const r = await this.pool.query(
      "SELECT id, jugador_id, mascota_id, especie_animal_id, carro_tipo_id, mapa_id, x, y, creado_en, contenido FROM conjuntos_tiro WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaAConjuntoTiro);
  }

  async actualizarPosicionConjuntoTiro(id: number, mapaId: string, x: number, y: number): Promise<void> {
    await this.pool.query("UPDATE conjuntos_tiro SET mapa_id = $1, x = $2, y = $3 WHERE id = $4", [mapaId, x, y, id]);
  }

  async actualizarContenidoConjuntoTiro(id: number, contenido: ContenidoCarro | null): Promise<void> {
    await this.pool.query("UPDATE conjuntos_tiro SET contenido = $1 WHERE id = $2", [contenido == null ? null : JSON.stringify(contenido), id]);
  }

  async eliminarConjuntoTiro(id: number): Promise<void> {
    await this.pool.query("DELETE FROM conjuntos_tiro WHERE id = $1", [id]);
  }

  async guardarCasillaCultivo(c: CasillaCultivo): Promise<void> {
    await this.pool.query(
      `INSERT INTO casillas_cultivo (mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_id, dia_plantado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (mapa_id, idx_casilla) DO UPDATE SET
         x = EXCLUDED.x, y = EXCLUDED.y, dueno_id = EXCLUDED.dueno_id, estado = EXCLUDED.estado,
         semilla_id = EXCLUDED.semilla_id, dia_plantado = EXCLUDED.dia_plantado`,
      [c.mapaId, c.idxCasilla, c.x, c.y, c.duenoId, c.estado, c.semillaId, c.diaPlantado],
    );
  }

  async listarCasillasCultivoDe(mapaId: string): Promise<CasillaCultivo[]> {
    const r = await this.pool.query(
      "SELECT mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_id, dia_plantado FROM casillas_cultivo WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaACasillaCultivo);
  }

  async obtenerConfigMundo(clave: string): Promise<string | null> {
    const r = await this.pool.query<{ valor: string }>("SELECT valor FROM configuracion_mundo WHERE clave = $1", [clave]);
    return r.rows[0]?.valor ?? null;
  }

  async obtenerExploracion(jugadorId: number, mapaId: string): Promise<number[]> {
    const r = await this.pool.query<{ sectores: string }>("SELECT sectores FROM exploracion WHERE jugador_id = $1 AND mapa_id = $2", [jugadorId, mapaId]);
    return r.rows[0] ? (JSON.parse(r.rows[0].sectores) as number[]) : [];
  }

  async guardarExploracion(jugadorId: number, mapaId: string, sectores: number[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO exploracion (jugador_id, mapa_id, sectores) VALUES ($1, $2, $3)
       ON CONFLICT (jugador_id, mapa_id) DO UPDATE SET sectores = EXCLUDED.sectores`,
      [jugadorId, mapaId, JSON.stringify(sectores)],
    );
  }

  async fijarConfigMundo(clave: string, valor: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO configuracion_mundo (clave, valor) VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [clave, valor],
    );
  }

  async crearCultivoHibrido(c: CultivoHibrido): Promise<void> {
    await this.pool.query(
      `INSERT INTO cultivos_hibridos (semilla_id, cosecha_id, nombre, padre_a, padre_b, rasgos, dias_crecimiento, meses_siembra, cosecha_recurrente, cantidad_por_cosecha, color_debug, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        c.semillaId, c.cosechaId, c.nombre, c.padreA, c.padreB, JSON.stringify(c.rasgos),
        c.diasCrecimiento, JSON.stringify(c.mesesSiembra), c.cosechaRecurrente ? 1 : 0, c.cantidadPorCosecha, c.colorDebug, c.creadoEn,
      ],
    );
  }

  async listarCultivosHibridos(): Promise<CultivoHibrido[]> {
    const r = await this.pool.query("SELECT * FROM cultivos_hibridos");
    return r.rows.map(filaACultivoHibrido);
  }

  async renombrarCultivoHibrido(semillaId: string, nombre: string): Promise<void> {
    await this.pool.query("UPDATE cultivos_hibridos SET nombre = $1 WHERE semilla_id = $2", [nombre, semillaId]);
  }

  async crearPlatoCreado(p: PlatoCreado): Promise<void> {
    await this.pool.query(
      `INSERT INTO platos_creados (clave, item_id, nombre, ingredientes, vida, estamina, comida, bebida, color_debug, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [p.clave, p.itemId, p.nombre, JSON.stringify(p.ingredientes), p.vida, p.estamina, p.comida, p.bebida, p.colorDebug, p.creadoEn],
    );
  }

  async buscarPlatoPorClave(clave: string): Promise<PlatoCreado | null> {
    const r = await this.pool.query("SELECT * FROM platos_creados WHERE clave = $1", [clave]);
    return r.rows[0] ? filaAPlatoCreado(r.rows[0]) : null;
  }

  async listarPlatosCreados(): Promise<PlatoCreado[]> {
    const r = await this.pool.query("SELECT * FROM platos_creados");
    return r.rows.map(filaAPlatoCreado);
  }

  async resolverCooldownTejidoLegendario(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = await this.pool.query<{ ultimo_tejido_legendario_ms: string | number | null }>(
      "SELECT ultimo_tejido_legendario_ms FROM jugadores WHERE id = $1",
      [jugadorId],
    );
    const bruto = fila.rows[0]?.ultimo_tejido_legendario_ms;
    const ultimo = bruto != null ? Number(bruto) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    await this.pool.query("UPDATE jugadores SET ultimo_tejido_legendario_ms = $1 WHERE id = $2", [ahoraMs, jugadorId]);
    return true;
  }

  async crearPrendaGenerada(p: Omit<PrendaGenerada, "id" | "creadoEn">): Promise<PrendaGenerada> {
    const creadoEn = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO prendas_generadas (creador_id, prenda_base_id, material_id, detalle, tintes, nombre, prompt_texto, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [p.creadorId, p.prendaBaseId, p.materialId, JSON.stringify(p.detalle), JSON.stringify(p.tintes), p.nombre, p.promptTexto, creadoEn],
    );
    return { id: r.rows[0].id, creadoEn, ...p };
  }

  async obtenerPrendaGenerada(id: number): Promise<PrendaGenerada | null> {
    const r = await this.pool.query("SELECT * FROM prendas_generadas WHERE id = $1", [id]);
    return r.rows[0] ? filaAPrendaGenerada(r.rows[0]) : null;
  }

  async listarPrendasGeneradasDeCreador(creadorId: number): Promise<PrendaGenerada[]> {
    const r = await this.pool.query("SELECT * FROM prendas_generadas WHERE creador_id = $1", [creadorId]);
    return r.rows.map(filaAPrendaGenerada);
  }

  async resolverCooldownCarpinteriaLegendaria(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = await this.pool.query<{ ultimo_carpinteria_legendaria_ms: string | number | null }>(
      "SELECT ultimo_carpinteria_legendaria_ms FROM jugadores WHERE id = $1",
      [jugadorId],
    );
    const bruto = fila.rows[0]?.ultimo_carpinteria_legendaria_ms;
    const ultimo = bruto != null ? Number(bruto) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    await this.pool.query("UPDATE jugadores SET ultimo_carpinteria_legendaria_ms = $1 WHERE id = $2", [ahoraMs, jugadorId]);
    return true;
  }

  async crearMuebleGenerado(m: Omit<MuebleGenerado, "id" | "creadoEn">): Promise<MuebleGenerado> {
    const creadoEn = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO muebles_generados (creador_id, arquetipo_id, parametros, nombre, prompt_texto, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.creadorId, m.arquetipoId, JSON.stringify(m.parametros), m.nombre, m.promptTexto, creadoEn],
    );
    return { id: r.rows[0].id, creadoEn, ...m };
  }

  async obtenerMuebleGenerado(id: number): Promise<MuebleGenerado | null> {
    const r = await this.pool.query("SELECT * FROM muebles_generados WHERE id = $1", [id]);
    return r.rows[0] ? filaAMuebleGenerado(r.rows[0]) : null;
  }

  async listarMueblesGeneradosDeCreador(creadorId: number): Promise<MuebleGenerado[]> {
    const r = await this.pool.query("SELECT * FROM muebles_generados WHERE creador_id = $1", [creadorId]);
    return r.rows.map(filaAMuebleGenerado);
  }

  async resolverCooldownIngenieriaLegendaria(jugadorId: number, ahoraMs: number, ventanaMs: number): Promise<boolean> {
    const fila = await this.pool.query<{ ultimo_ingenieria_legendaria_ms: string | number | null }>(
      "SELECT ultimo_ingenieria_legendaria_ms FROM jugadores WHERE id = $1",
      [jugadorId],
    );
    const bruto = fila.rows[0]?.ultimo_ingenieria_legendaria_ms;
    const ultimo = bruto != null ? Number(bruto) : null;
    if (ultimo != null && ahoraMs - ultimo < ventanaMs) return false;
    await this.pool.query("UPDATE jugadores SET ultimo_ingenieria_legendaria_ms = $1 WHERE id = $2", [ahoraMs, jugadorId]);
    return true;
  }

  async crearEdificioGenerado(e: Omit<EdificioGenerado, "id" | "creadoEn">): Promise<EdificioGenerado> {
    const creadoEn = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO edificios_generados (creador_id, tipo_edificio, parametros, nombre, prompt_texto, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [e.creadorId, e.tipoEdificio, JSON.stringify(e.parametros), e.nombre, e.promptTexto, creadoEn],
    );
    return { id: r.rows[0].id, creadoEn, ...e };
  }

  async obtenerEdificioGenerado(id: number): Promise<EdificioGenerado | null> {
    const r = await this.pool.query("SELECT * FROM edificios_generados WHERE id = $1", [id]);
    return r.rows[0] ? filaAEdificioGenerado(r.rows[0]) : null;
  }

  async listarEdificiosGeneradosDeCreador(creadorId: number): Promise<EdificioGenerado[]> {
    const r = await this.pool.query("SELECT * FROM edificios_generados WHERE creador_id = $1", [creadorId]);
    return r.rows.map(filaAEdificioGenerado);
  }

  async crearLibroGenerado(l: Omit<LibroGenerado, "id" | "creadoEn">): Promise<LibroGenerado> {
    const creadoEn = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      "INSERT INTO libros_generados (autor_id, titulo, paginas, creado_en) VALUES ($1, $2, $3, $4) RETURNING id",
      [l.autorId, l.titulo, JSON.stringify(l.paginas), creadoEn],
    );
    return { id: r.rows[0].id, creadoEn, ...l };
  }

  async obtenerLibroGenerado(id: number): Promise<LibroGenerado | null> {
    const r = await this.pool.query("SELECT * FROM libros_generados WHERE id = $1", [id]);
    return r.rows[0] ? filaALibroGenerado(r.rows[0]) : null;
  }

  async actualizarLibroGenerado(id: number, titulo: string, paginas: string[]): Promise<void> {
    await this.pool.query("UPDATE libros_generados SET titulo = $1, paginas = $2 WHERE id = $3", [titulo, JSON.stringify(paginas), id]);
  }

  async cerrar(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Punto de entrada único (regla GDD §2: "el adaptador cambia de motor
 * solo"). `DATABASE_URL` presente → Postgres (Neon); si no, SQLite local.
 * `rutaSqlite` solo se usa en el segundo caso (tests pasan ":memory:").
 */
export async function crearAlmacenDatos(rutaSqlite?: string): Promise<IAlmacenDatos> {
  if (process.env.DATABASE_URL) {
    return AlmacenDatosPostgres.crear(process.env.DATABASE_URL);
  }
  return new AlmacenDatosSqlite(rutaSqlite);
}

// Alias histórico: el resto del código (y los tests existentes) siguen
// pudiendo hacer `new AlmacenDatos(":memory:")` para el motor SQLite directo.
export { AlmacenDatosSqlite as AlmacenDatos };
