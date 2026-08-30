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

// Un único líder bandido supremo (GDD §1): memoria GLOBAL, no por
// asentamiento — el registro de eventos que alimenta su contexto de IA.
export interface MemoriaLider {
  id: number;
  diaIngame: number;
  evento: string;
}

/**
 * Contrato único de persistencia — GDD_Construccion §2. Ambos motores lo
 * implementan tal cual; HubRoom solo conoce esta interfaz, nunca la clase
 * concreta (así el motor real es un detalle de `crearAlmacenDatos`).
 */
export interface IAlmacenDatos {
  obtenerOCrearJugador(nombre: string): Promise<Jugador>;
  /** Vida/vidaMax tras combate/comida/pociones (docs/GDD_Mecanicas.md §5.4) — sin regeneración automática, solo se llama en un evento explícito. */
  actualizarVidaJugador(jugadorId: number, vida: number, vidaMax: number): Promise<void>;
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
  cargarPropiedades(): Promise<Map<string, Propiedad>>;
  asignarPropiedad(id: string, tipo: string, asentamiento: string, duenoNombre: string | null): Promise<void>;
  /** Libera dueño Y cualquier tenencia comercial (modo/precio/periodo/expira) — el jarl revoca cualquier propiedad, compra o alquiler (docs/GDD_Propiedades.md). */
  revocarPropiedad(id: string): Promise<void>;
  // Propiedades comerciales (docs/GDD_Propiedades.md) — point-query, NUNCA
  // cacheadas en memoria de room (a diferencia de ContextoConstruccion): el
  // volumen por asentamiento es pequeño (decenas) y esto GARANTIZA que la
  // expiración de un alquiler se re-evalúa en cada toque real, sin caché que
  // pueda quedarse desfasada mientras la room sigue viva.
  /** Point-query — resuelve la expiración perezosa (alquiler vencido → libera la fila) ANTES de devolver. `null` = nunca se tocó (disponible, libre). */
  obtenerPropiedad(id: string): Promise<(Propiedad & { id: string }) | null>;
  /** Todo o nada: cobra el precio, y solo si la propiedad sigue libre (o su alquiler venció) se la queda — si no, reembolsa. */
  comprarOAlquilar(params: {
    id: string;
    tipo: "inmueble" | "habitacion" | "plantilla";
    asentamiento: string;
    jugadorNombre: string;
    modo: ModoTenencia;
    precioFarycoins: number;
    periodoHoras: number | null;
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
  /** Todo o nada: cobra al comprador, decrementa stock atómicamente (nunca por debajo de 0), acredita al vendedor — sin transacción SQL explícita, mismo patrón compare-and-swap por WHERE que el resto de mutaciones económicas. `descuento` (-1..1, docs/GDD_Personaje.md §3.3 bonus de Comercio + docs/GDD_Twitch.md El Corralito/Mercado en oferta) reduce (positivo) o sube (negativo, evento Twitch) el precio TOTAL que paga el comprador Y el que recibe el vendedor por igual (negociación, no regalo — no crea ni destruye Farycoins de la nada). */
  comprarDeTenderete(params: {
    tenderoteId: string;
    itemId: string;
    cantidad: number;
    compradorNombre: string;
    duenoNombre: string;
    descuento?: number;
  }): Promise<
    | { ok: true; saldoRestante: number; cantidadRestante: number; precioTotal: number }
    | { ok: false; motivo: string }
  >;
  /** Como reponerStockTenderete, pero SIN tocar el precio — usado por el transporte (docs/GDD_Produccion.md) para no pisar el precio que el dueño ya puso. `precioInicial` solo se usa si la fila no existía todavía. */
  sumarStockTenderete(tenderoteId: string, itemId: string, cantidad: number, precioInicial: number): Promise<void>;
  /** docs/GDD_Crafteo.md §4: descuenta insumo del almacén de una construcción (misma tabla `tenderete_items`, reusada como "qué hay guardado aquí" — sin cobro, sin precio). Compare-and-swap: `false` si no quedaba suficiente, nunca deja cantidad negativa. */
  consumirStockTenderete(tenderoteId: string, itemId: string, cantidad: number): Promise<boolean>;
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
  desactivarContratoTransporte(id: number): Promise<void>;
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
  // Cadáveres (docs/GDD_Agentes_Moviles.md, pedido 2026-08-30) — sin
  // sector, por mapa entero (las muertes son mucho menos frecuentes que
  // la población base de fauna).
  listarCadaveresMapa(mapaId: string): Promise<CadaverFila[]>;
  crearCadaverBd(c: CadaverFila): Promise<void>;
  /** Actualiza SOLO el contenedor (tras lootear) — el resto de campos de un cadáver no cambian nunca. */
  actualizarContenedorCadaver(id: string, contenedor: Contenedor): Promise<void>;
  borrarCadaver(id: string): Promise<void>;
  registrarMemoriaLider(diaIngame: number, evento: string): Promise<void>;
  memoriaLiderReciente(limite: number): Promise<MemoriaLider[]>;
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
  // Flags globales (docs/GDD_PvP.md, pedido 2026-08-30) — tabla genérica de un solo valor por clave.
  obtenerConfigMundo(clave: string): Promise<string | null>;
  fijarConfigMundo(clave: string, valor: string): Promise<void>;
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
  vida_max INTEGER NOT NULL DEFAULT 100
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
  expira_en TEXT
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
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contratos_origen ON contratos_transporte(origen_construccion_id);
CREATE INDEX IF NOT EXISTS idx_contratos_destino ON contratos_transporte(destino_tenderete_id);
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
-- sí) — vitales (vida/comida/bebida/sueño/estamina) NO se persisten, viven y
-- mueren con la sesión (ver server/src/personaje/vitales.ts).
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
  creado_en TEXT NOT NULL
);
-- Flags globales de un solo valor (pedido 2026-08-30: PvP apagado por
-- defecto, el jarl lo activa) — genérica a propósito, cualquier futuro
-- interruptor de mundo reusa esta MISMA tabla en vez de una columna nueva
-- cada vez ("las listas crecen, el código no").
CREATE TABLE IF NOT EXISTS configuracion_mundo (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS cadaveres (
  id TEXT PRIMARY KEY,
  mapa_id TEXT NOT NULL,
  tipo_origen TEXT NOT NULL,        -- 'animal' | 'npc' | 'jugador'
  especie_origen_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  muerto_en REAL NOT NULL,
  contenedor TEXT NOT NULL          -- JSON del Contenedor (loot), mismo patrón que construcciones.extra
);
CREATE INDEX IF NOT EXISTS idx_cadaveres_mapa ON cadaveres(mapa_id);
CREATE TABLE IF NOT EXISTS memoria_lider (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dia_ingame INTEGER NOT NULL,
  evento TEXT NOT NULL,
  creado_en TEXT NOT NULL
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
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS configuracion_mundo (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_cadaveres_mapa ON cadaveres(mapa_id);
CREATE TABLE IF NOT EXISTS memoria_lider (
  id SERIAL PRIMARY KEY,
  dia_ingame INTEGER NOT NULL,
  evento TEXT NOT NULL,
  creado_en TEXT NOT NULL
);
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
  }

  async obtenerOCrearJugador(nombre: string): Promise<Jugador> {
    const existente = this.bd
      .prepare("SELECT id, nombre, farycoins, vida, vida_max FROM jugadores WHERE nombre = ?")
      .get(nombre);
    if (existente) {
      return {
        id: Number(existente.id),
        nombre: String(existente.nombre),
        farycoins: Number(existente.farycoins),
        vida: Number(existente.vida),
        vidaMax: Number(existente.vida_max),
      };
    }
    const r = this.bd
      .prepare("INSERT INTO jugadores (nombre, creado_en) VALUES (?, ?)")
      .run(nombre, new Date().toISOString());
    return { id: Number(r.lastInsertRowid), nombre, farycoins: 0, vida: 100, vidaMax: 100 };
  }

  async obtenerFarycoins(jugadorId: number): Promise<number> {
    const fila = this.bd.prepare("SELECT farycoins FROM jugadores WHERE id = ?").get(jugadorId);
    return fila ? Number(fila.farycoins) : 0;
  }

  async actualizarVidaJugador(jugadorId: number, vida: number, vidaMax: number): Promise<void> {
    this.bd.prepare("UPDATE jugadores SET vida = ?, vida_max = ? WHERE id = ?").run(vida, vidaMax, jugadorId);
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
        `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en
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
    const fila = this.bd
      .prepare(
        `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en
         FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno WHERE p.id = ?`,
      )
      .get(id);
    return fila ? this.filaAPropiedad(fila) : null;
  }

  async comprarOAlquilar(params: {
    id: string;
    tipo: "inmueble" | "habitacion" | "plantilla";
    asentamiento: string;
    jugadorNombre: string;
    modo: ModoTenencia;
    precioFarycoins: number;
    periodoHoras: number | null;
  }): Promise<{ ok: true; saldoRestante: number; expiraEn: string | null } | { ok: false; motivo: string }> {
    this.liberarSiVencida(params.id);
    const jugador = await this.obtenerOCrearJugador(params.jugadorNombre);
    const debito = await this.ajustarFarycoins(jugador.id, -params.precioFarycoins);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

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
      await this.ajustarFarycoins(jugador.id, params.precioFarycoins); // reembolso: alguien se adelantó
      return { ok: false, motivo: "ya no está disponible" };
    }
    return { ok: true, saldoRestante: debito.saldo, expiraEn };
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

    const vendedor = await this.obtenerOCrearJugador(params.duenoNombre);
    await this.ajustarFarycoins(vendedor.id, precioTotal);
    return { ok: true, saldoRestante: debito.saldo, cantidadRestante: Number(stock.cantidad), precioTotal };
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
    };
  }

  async crearContratoTransporte(c: NuevoContratoTransporte): Promise<ContratoTransporte> {
    const ahora = new Date().toISOString();
    const r = this.bd
      .prepare(
        `INSERT INTO contratos_transporte
           (origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        c.origenConstruccionId, c.destinoTenderoteId, c.dueno, c.itemId,
        JSON.stringify(c.caminoIda), JSON.stringify(c.caminoVuelta),
        c.duracionViajeSeg, c.cargaPorViaje, ahora, ahora,
      );
    return {
      id: Number(r.lastInsertRowid), origenConstruccionId: c.origenConstruccionId, destinoTenderoteId: c.destinoTenderoteId,
      dueno: c.dueno, itemId: c.itemId, caminoIda: c.caminoIda, caminoVuelta: c.caminoVuelta,
      duracionViajeSeg: c.duracionViajeSeg, cargaPorViaje: c.cargaPorViaje, ultimoViajeResuelto: ahora, activo: true,
    };
  }

  async listarContratosTransporte(): Promise<ContratoTransporte[]> {
    const filas = this.bd
      .prepare(
        "SELECT id, origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo FROM contratos_transporte WHERE activo = 1",
      )
      .all();
    return filas.map((f) => this.filaAContrato(f));
  }

  async actualizarUltimoViajeContrato(id: number, ultimoViajeResuelto: string): Promise<void> {
    this.bd.prepare("UPDATE contratos_transporte SET ultimo_viaje_resuelto = ? WHERE id = ?").run(ultimoViajeResuelto, id);
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

  async listarCadaveresMapa(mapaId: string): Promise<CadaverFila[]> {
    const filas = this.bd
      .prepare(
        "SELECT id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor FROM cadaveres WHERE mapa_id = ?",
      )
      .all(mapaId);
    return filas.map(filaCadaverDesdeSql);
  }

  async crearCadaverBd(c: CadaverFila): Promise<void> {
    this.bd
      .prepare(
        `INSERT INTO cadaveres (id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.mapaId, c.tipoOrigen, c.especieOrigenId, c.x, c.y, c.muertoEn, JSON.stringify(c.contenedor));
  }

  async actualizarContenedorCadaver(id: string, contenedor: Contenedor): Promise<void> {
    this.bd.prepare("UPDATE cadaveres SET contenedor = ? WHERE id = ?").run(JSON.stringify(contenedor), id);
  }

  async borrarCadaver(id: string): Promise<void> {
    this.bd.prepare("DELETE FROM cadaveres WHERE id = ?").run(id);
  }

  async registrarMemoriaLider(diaIngame: number, evento: string): Promise<void> {
    this.bd
      .prepare("INSERT INTO memoria_lider (dia_ingame, evento, creado_en) VALUES (?, ?, ?)")
      .run(diaIngame, evento, new Date().toISOString());
  }

  async memoriaLiderReciente(limite: number): Promise<MemoriaLider[]> {
    const filas = this.bd
      .prepare("SELECT id, dia_ingame, evento FROM memoria_lider ORDER BY id DESC LIMIT ?")
      .all(limite);
    return filas.map((f) => ({ id: Number(f.id), diaIngame: Number(f.dia_ingame), evento: String(f.evento) }));
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
    return { id: Number(r.lastInsertRowid), jugadorId, especieId, ubicacion: "siguiendo", propiedadId: null, creadoEn: ahora };
  }

  async listarMascotas(jugadorId: number): Promise<Mascota[]> {
    const filas = this.bd.prepare("SELECT id, jugador_id, especie_id, ubicacion, propiedad_id, creado_en FROM mascotas WHERE jugador_id = ?").all(jugadorId);
    return filas.map(filaAMascota);
  }

  async actualizarUbicacionMascota(id: number, jugadorId: number, ubicacion: UbicacionMascota, propiedadId: string | null): Promise<boolean> {
    const r = this.bd
      .prepare("UPDATE mascotas SET ubicacion = ?, propiedad_id = ? WHERE id = ? AND jugador_id = ?")
      .run(ubicacion, propiedadId, id, jugadorId);
    return Number(r.changes) > 0;
  }

  async obtenerConfigMundo(clave: string): Promise<string | null> {
    const fila = this.bd.prepare("SELECT valor FROM configuracion_mundo WHERE clave = ?").get(clave);
    return fila ? String(fila.valor) : null;
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

  async obtenerOCrearJugador(nombre: string): Promise<Jugador> {
    // INSERT ... ON CONFLICT DO UPDATE + RETURNING: upsert real de Postgres,
    // devuelve la fila exista ya o se acabe de crear, en una sola ida y vuelta.
    const r = await this.pool.query<{ id: number; nombre: string; farycoins: number; vida: number; vida_max: number }>(
      `INSERT INTO jugadores (nombre, creado_en) VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre, farycoins, vida, vida_max`,
      [nombre, new Date().toISOString()]
    );
    return {
      id: r.rows[0].id,
      nombre: r.rows[0].nombre,
      farycoins: r.rows[0].farycoins,
      vida: r.rows[0].vida,
      vidaMax: r.rows[0].vida_max,
    };
  }

  async actualizarVidaJugador(jugadorId: number, vida: number, vidaMax: number): Promise<void> {
    await this.pool.query("UPDATE jugadores SET vida = $1, vida_max = $2 WHERE id = $3", [vida, vidaMax, jugadorId]);
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
    };
  }

  async cargarPropiedades(): Promise<Map<string, Propiedad>> {
    const r = await this.pool.query<{
      id: string; tipo: string; asentamiento: string; dueno: string | null;
      modo_tenencia: string | null; precio_farycoins: number | null; periodo_horas: number | null; expira_en: string | null;
    }>(
      `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en
       FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno`
    );
    const mapa = new Map<string, Propiedad>();
    for (const f of r.rows) {
      const { id, ...propiedad } = this.filaAPropiedad(f);
      mapa.set(id, propiedad);
    }
    return mapa;
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
    const r = await this.pool.query<{
      id: string; tipo: string; asentamiento: string; dueno: string | null;
      modo_tenencia: string | null; precio_farycoins: number | null; periodo_horas: number | null; expira_en: string | null;
    }>(
      `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno, p.modo_tenencia, p.precio_farycoins, p.periodo_horas, p.expira_en
       FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno WHERE p.id = $1`,
      [id],
    );
    return r.rows.length > 0 ? this.filaAPropiedad(r.rows[0]) : null;
  }

  async comprarOAlquilar(params: {
    id: string;
    tipo: "inmueble" | "habitacion" | "plantilla";
    asentamiento: string;
    jugadorNombre: string;
    modo: ModoTenencia;
    precioFarycoins: number;
    periodoHoras: number | null;
  }): Promise<{ ok: true; saldoRestante: number; expiraEn: string | null } | { ok: false; motivo: string }> {
    await this.liberarSiVencida(params.id);
    const jugador = await this.obtenerOCrearJugador(params.jugadorNombre);
    const debito = await this.ajustarFarycoins(jugador.id, -params.precioFarycoins);
    if (!debito.ok) return { ok: false, motivo: "no tienes suficientes Farycoins" };

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
      await this.ajustarFarycoins(jugador.id, params.precioFarycoins); // reembolso: alguien se adelantó
      return { ok: false, motivo: "ya no está disponible" };
    }
    return { ok: true, saldoRestante: debito.saldo, expiraEn };
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

    const vendedor = await this.obtenerOCrearJugador(params.duenoNombre);
    await this.ajustarFarycoins(vendedor.id, precioTotal);
    return { ok: true, saldoRestante: debito.saldo, cantidadRestante: stock.rows[0].cantidad, precioTotal };
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
    ultimo_viaje_resuelto: string; activo: number;
  }): ContratoTransporte {
    return {
      id: f.id, origenConstruccionId: f.origen_construccion_id, destinoTenderoteId: f.destino_tenderete_id,
      dueno: f.dueno, itemId: f.item_id, caminoIda: JSON.parse(f.camino_ida), caminoVuelta: JSON.parse(f.camino_vuelta),
      duracionViajeSeg: f.duracion_viaje_seg, cargaPorViaje: f.carga_por_viaje,
      ultimoViajeResuelto: f.ultimo_viaje_resuelto, activo: f.activo === 1,
    };
  }

  async crearContratoTransporte(c: NuevoContratoTransporte): Promise<ContratoTransporte> {
    const ahora = new Date().toISOString();
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO contratos_transporte
         (origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $9) RETURNING id`,
      [
        c.origenConstruccionId, c.destinoTenderoteId, c.dueno, c.itemId,
        JSON.stringify(c.caminoIda), JSON.stringify(c.caminoVuelta),
        c.duracionViajeSeg, c.cargaPorViaje, ahora,
      ],
    );
    return {
      id: r.rows[0].id, origenConstruccionId: c.origenConstruccionId, destinoTenderoteId: c.destinoTenderoteId,
      dueno: c.dueno, itemId: c.itemId, caminoIda: c.caminoIda, caminoVuelta: c.caminoVuelta,
      duracionViajeSeg: c.duracionViajeSeg, cargaPorViaje: c.cargaPorViaje, ultimoViajeResuelto: ahora, activo: true,
    };
  }

  async listarContratosTransporte(): Promise<ContratoTransporte[]> {
    const r = await this.pool.query<{
      id: number; origen_construccion_id: number; destino_tenderete_id: string; dueno: number; item_id: string;
      camino_ida: string; camino_vuelta: string; duracion_viaje_seg: number; carga_por_viaje: number;
      ultimo_viaje_resuelto: string; activo: number;
    }>(
      "SELECT id, origen_construccion_id, destino_tenderete_id, dueno, item_id, camino_ida, camino_vuelta, duracion_viaje_seg, carga_por_viaje, ultimo_viaje_resuelto, activo FROM contratos_transporte WHERE activo = 1",
    );
    return r.rows.map((f) => this.filaAContrato(f));
  }

  async actualizarUltimoViajeContrato(id: number, ultimoViajeResuelto: string): Promise<void> {
    await this.pool.query("UPDATE contratos_transporte SET ultimo_viaje_resuelto = $1 WHERE id = $2", [ultimoViajeResuelto, id]);
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

  async listarCadaveresMapa(mapaId: string): Promise<CadaverFila[]> {
    const r = await this.pool.query(
      "SELECT id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor FROM cadaveres WHERE mapa_id = $1",
      [mapaId],
    );
    return r.rows.map(filaCadaverDesdeSql);
  }

  async crearCadaverBd(c: CadaverFila): Promise<void> {
    await this.pool.query(
      `INSERT INTO cadaveres (id, mapa_id, tipo_origen, especie_origen_id, x, y, muerto_en, contenedor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [c.id, c.mapaId, c.tipoOrigen, c.especieOrigenId, c.x, c.y, c.muertoEn, JSON.stringify(c.contenedor)],
    );
  }

  async actualizarContenedorCadaver(id: string, contenedor: Contenedor): Promise<void> {
    await this.pool.query("UPDATE cadaveres SET contenedor = $1 WHERE id = $2", [JSON.stringify(contenedor), id]);
  }

  async borrarCadaver(id: string): Promise<void> {
    await this.pool.query("DELETE FROM cadaveres WHERE id = $1", [id]);
  }

  async registrarMemoriaLider(diaIngame: number, evento: string): Promise<void> {
    await this.pool.query("INSERT INTO memoria_lider (dia_ingame, evento, creado_en) VALUES ($1, $2, $3)", [
      diaIngame,
      evento,
      new Date().toISOString(),
    ]);
  }

  async memoriaLiderReciente(limite: number): Promise<MemoriaLider[]> {
    const r = await this.pool.query<{ id: number; dia_ingame: number; evento: string }>(
      "SELECT id, dia_ingame, evento FROM memoria_lider ORDER BY id DESC LIMIT $1",
      [limite],
    );
    return r.rows.map((f) => ({ id: f.id, diaIngame: f.dia_ingame, evento: f.evento }));
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
    return { id: r.rows[0].id, jugadorId, especieId, ubicacion: "siguiendo", propiedadId: null, creadoEn: ahora };
  }

  async listarMascotas(jugadorId: number): Promise<Mascota[]> {
    const r = await this.pool.query(
      "SELECT id, jugador_id, especie_id, ubicacion, propiedad_id, creado_en FROM mascotas WHERE jugador_id = $1",
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

  async obtenerConfigMundo(clave: string): Promise<string | null> {
    const r = await this.pool.query<{ valor: string }>("SELECT valor FROM configuracion_mundo WHERE clave = $1", [clave]);
    return r.rows[0]?.valor ?? null;
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
