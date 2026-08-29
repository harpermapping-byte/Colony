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
import { Contenedor, ItemInstancia, SlotsEquipo } from "../inventario/inventario";

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
  obtenerFarycoins(jugadorId: number): Promise<number>;
  /** Suma (delta>0) o resta (delta<0) Farycoins de un jugador, TODO O NADA:
   * si restar dejaría el saldo negativo, no toca nada y `ok:false` — mismo
   * patrón compare-and-swap por WHERE que el resto de mutaciones económicas
   * del proyecto (una sola fila, no hace falta una transacción explícita).
   * Primitiva única reusada por gremios (depositar/retirar del banco),
   * mercado (pagar/cobrar) y propiedades (comprar/alquilar) — se decide UNA
   * vez, no en cada sistema por separado. */
  ajustarFarycoins(jugadorId: number, delta: number): Promise<{ ok: boolean; saldo: number }>;
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
    tipo: "inmueble" | "habitacion";
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
  listarConstrucciones(): Promise<Construccion[]>;
  insertarConstruccion(c: NuevaConstruccion): Promise<number>;
  borrarConstruccion(id: number): Promise<boolean>;
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
  farycoins INTEGER NOT NULL DEFAULT 0  -- moneda del mundo, saldo numérico (no ítem de inventario)
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
    if (!columnas.some((c) => String(c.name) === "farycoins")) {
      this.bd.exec("ALTER TABLE jugadores ADD COLUMN farycoins INTEGER NOT NULL DEFAULT 0");
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
  }

  async obtenerOCrearJugador(nombre: string): Promise<Jugador> {
    const existente = this.bd.prepare("SELECT id, nombre, farycoins FROM jugadores WHERE nombre = ?").get(nombre);
    if (existente) {
      return { id: Number(existente.id), nombre: String(existente.nombre), farycoins: Number(existente.farycoins) };
    }
    const r = this.bd
      .prepare("INSERT INTO jugadores (nombre, creado_en) VALUES (?, ?)")
      .run(nombre, new Date().toISOString());
    return { id: Number(r.lastInsertRowid), nombre, farycoins: 0 };
  }

  async obtenerFarycoins(jugadorId: number): Promise<number> {
    const fila = this.bd.prepare("SELECT farycoins FROM jugadores WHERE id = ?").get(jugadorId);
    return fila ? Number(fila.farycoins) : 0;
  }

  async ajustarFarycoins(jugadorId: number, delta: number): Promise<{ ok: boolean; saldo: number }> {
    const r = this.bd
      .prepare("UPDATE jugadores SET farycoins = farycoins + ? WHERE id = ? AND farycoins + ? >= 0")
      .run(delta, jugadorId, delta);
    const saldo = await this.obtenerFarycoins(jugadorId);
    return { ok: Number(r.changes) > 0, saldo };
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
    tipo: "inmueble" | "habitacion";
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
    const r = await this.pool.query<{ id: number; nombre: string; farycoins: number }>(
      `INSERT INTO jugadores (nombre, creado_en) VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre, farycoins`,
      [nombre, new Date().toISOString()]
    );
    return { id: r.rows[0].id, nombre: r.rows[0].nombre, farycoins: r.rows[0].farycoins };
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
    tipo: "inmueble" | "habitacion";
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
