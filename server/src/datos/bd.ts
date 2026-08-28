// Capa de persistencia del juego — GDD_Construccion §2 (el GDD es el contrato).
// Motor hoy: node:sqlite (DatabaseSync, integrado en Node 22 — CERO dependencias nuevas).
// Al cargar el módulo Node emite un ExperimentalWarning ("SQLite is an experimental
// feature"): es aceptable y esperado, el API síncrono que usamos es estable para SQL básico.
// Producción futura = Postgres (Neon) vía DATABASE_URL: mismo interfaz, SQL portable
// (evitamos sqlite-ismos donde se puede); hasta que exista el driver solo lo anunciamos.

import * as path from "node:path";

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

// Esquema EXACTO del GDD_Construccion §2 — no tocar aquí sin cambiar el GDD en el mismo commit.
const MIGRACIONES = `
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
`;

// Aviso una sola vez por proceso aunque se abran varios almacenes (p.ej. en tests).
let avisoPostgresDado = false;

export class AlmacenDatos {
  private bd: BaseDatosSync;

  constructor(ruta?: string) {
    // Postgres pendiente de driver (GDD §2): lo anunciamos y seguimos en SQLite.
    if (process.env.DATABASE_URL && !avisoPostgresDado) {
      avisoPostgresDado = true;
      console.log("DATABASE_URL detectada — driver Postgres pendiente, usando SQLite");
    }
    // __dirname = server/src/datos (o dist/datos compilado): dos niveles arriba = carpeta server.
    const rutaFinal =
      ruta ?? process.env.BD_RUTA ?? path.join(__dirname, "..", "..", "datos.sqlite");
    this.bd = new DatabaseSync(rutaFinal);
    // CREATE ... IF NOT EXISTS en todo: abrir dos veces el mismo archivo es inocuo.
    this.bd.exec(MIGRACIONES);
  }

  obtenerOCrearJugador(nombre: string): Jugador {
    const existente = this.bd
      .prepare("SELECT id, nombre FROM jugadores WHERE nombre = ?")
      .get(nombre);
    if (existente) return { id: Number(existente.id), nombre: String(existente.nombre) };
    const r = this.bd
      .prepare("INSERT INTO jugadores (nombre, creado_en) VALUES (?, ?)")
      .run(nombre, new Date().toISOString());
    return { id: Number(r.lastInsertRowid), nombre };
  }

  // Se llama UNA vez al arrancar la room (regla GDD §2: leer al arrancar, nunca polling).
  cargarPropiedades(): Map<string, Propiedad> {
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

  asignarPropiedad(
    id: string,
    tipo: string,
    asentamiento: string,
    duenoNombre: string | null
  ): void {
    // El dueño llega por NOMBRE (identidad v1) y puede no existir aún: se crea aquí,
    // igual que hace "parcela:asignar" en el protocolo (GDD §4).
    const duenoId = duenoNombre == null ? null : this.obtenerOCrearJugador(duenoNombre).id;
    const ahora = new Date().toISOString();
    // Upsert portable (UPDATE y, si no tocó fila, INSERT) en vez de ON CONFLICT de SQLite.
    const r = this.bd
      .prepare("UPDATE propiedades SET tipo = ?, asentamiento = ?, dueno = ?, asignada_en = ? WHERE id = ?")
      .run(tipo, asentamiento, duenoId, ahora, id);
    if (Number(r.changes) === 0) {
      this.bd
        .prepare(
          "INSERT INTO propiedades (id, tipo, asentamiento, dueno, asignada_en) VALUES (?, ?, ?, ?, ?)"
        )
        .run(id, tipo, asentamiento, duenoId, ahora);
    }
  }

  // Revocar deja la fila (las construcciones QUEDAN y pasan al jarl — decisión v1, GDD §4).
  revocarPropiedad(id: string): void {
    this.bd
      .prepare("UPDATE propiedades SET dueno = NULL, asignada_en = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  listarConstrucciones(): Construccion[] {
    const filas = this.bd
      .prepare(
        "SELECT id, propiedad, objeto, categoria, x, y, rot, variante, extra FROM construcciones"
      )
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

  insertarConstruccion(c: NuevaConstruccion): number {
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

  borrarConstruccion(id: number): boolean {
    const r = this.bd.prepare("DELETE FROM construcciones WHERE id = ?").run(id);
    return Number(r.changes) > 0;
  }

  cerrar(): void {
    this.bd.close();
  }
}
