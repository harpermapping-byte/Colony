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
}

export interface Propiedad {
  tipo: string;
  asentamiento: string;
  dueno: string | null; // resuelto a NOMBRE (identidad v1) — NULL = del jarl/asentamiento
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

/**
 * Contrato único de persistencia — GDD_Construccion §2. Ambos motores lo
 * implementan tal cual; HubRoom solo conoce esta interfaz, nunca la clase
 * concreta (así el motor real es un detalle de `crearAlmacenDatos`).
 */
export interface IAlmacenDatos {
  obtenerOCrearJugador(nombre: string): Promise<Jugador>;
  cargarPropiedades(): Promise<Map<string, Propiedad>>;
  asignarPropiedad(id: string, tipo: string, asentamiento: string, duenoNombre: string | null): Promise<void>;
  revocarPropiedad(id: string): Promise<void>;
  listarConstrucciones(): Promise<Construccion[]>;
  insertarConstruccion(c: NuevaConstruccion): Promise<number>;
  borrarConstruccion(id: number): Promise<boolean>;
  // Mazmorras (docs/GDD_Bakeador_Dungeons.md §4.2): cooldown de 1h tras
  // limpiar una planta, para que no se repueble al instante y se pueda
  // "farmear a saco". `clave` = mapaId:edificio:nivel.
  obtenerLimpiezaMazmorra(clave: string): Promise<string | null>;
  marcarMazmorraLimpiada(clave: string): Promise<void>;
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
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propiedades (
  id TEXT PRIMARY KEY,                  -- "p_0001" (parcela) o "i_<edificioId>_<sala>" (inmueble interior, futuro)
  tipo TEXT NOT NULL,                   -- 'parcela' | 'inmueble'
  asentamiento TEXT NOT NULL,
  dueno INTEGER,                        -- FK jugadores.id; NULL = del jarl/asentamiento
  asignada_en TEXT
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
`;

const MIGRACIONES_POSTGRES = `
CREATE TABLE IF NOT EXISTS jugadores (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propiedades (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  asentamiento TEXT NOT NULL,
  dueno INTEGER,
  asignada_en TEXT
);
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
  }

  async obtenerOCrearJugador(nombre: string): Promise<Jugador> {
    const existente = this.bd.prepare("SELECT id, nombre FROM jugadores WHERE nombre = ?").get(nombre);
    if (existente) return { id: Number(existente.id), nombre: String(existente.nombre) };
    const r = this.bd
      .prepare("INSERT INTO jugadores (nombre, creado_en) VALUES (?, ?)")
      .run(nombre, new Date().toISOString());
    return { id: Number(r.lastInsertRowid), nombre };
  }

  // Se llama UNA vez al arrancar la room (regla GDD §2: leer al arrancar, nunca polling).
  async cargarPropiedades(): Promise<Map<string, Propiedad>> {
    const filas = this.bd
      .prepare(
        // LEFT JOIN: una propiedad sin dueño (dueno NULL) debe salir igualmente, con dueno=null
        `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno
         FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno`
      )
      .all();
    const mapa = new Map<string, Propiedad>();
    for (const f of filas) {
      mapa.set(String(f.id), {
        tipo: String(f.tipo),
        asentamiento: String(f.asentamiento),
        dueno: f.dueno == null ? null : String(f.dueno),
      });
    }
    return mapa;
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

  // Revocar deja la fila (las construcciones QUEDAN y pasan al jarl — decisión v1, GDD §4).
  async revocarPropiedad(id: string): Promise<void> {
    this.bd.prepare("UPDATE propiedades SET dueno = NULL, asignada_en = ? WHERE id = ?").run(new Date().toISOString(), id);
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
    const r = await this.pool.query<{ id: number; nombre: string }>(
      `INSERT INTO jugadores (nombre, creado_en) VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre`,
      [nombre, new Date().toISOString()]
    );
    return { id: r.rows[0].id, nombre: r.rows[0].nombre };
  }

  async cargarPropiedades(): Promise<Map<string, Propiedad>> {
    const r = await this.pool.query<{ id: string; tipo: string; asentamiento: string; dueno: string | null }>(
      `SELECT p.id, p.tipo, p.asentamiento, j.nombre AS dueno
       FROM propiedades p LEFT JOIN jugadores j ON j.id = p.dueno`
    );
    const mapa = new Map<string, Propiedad>();
    for (const f of r.rows) {
      mapa.set(f.id, { tipo: f.tipo, asentamiento: f.asentamiento, dueno: f.dueno });
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
    await this.pool.query("UPDATE propiedades SET dueno = NULL, asignada_en = $1 WHERE id = $2", [
      new Date().toISOString(),
      id,
    ]);
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
