/**
 * Contenedor de MUEBLES por CAPACIDAD — PURO (sin Colyseus/BD/fs),
 * hermano de inventario.ts (rejilla Tetris) para el carro de transporte
 * de muebles (docs/GDD_Carros.md §8.3, propuesta 2026-09-04, pendiente
 * de cablear a Colyseus). Deliberadamente el OPUESTO de la rejilla: sin
 * x/y/rotación, cada mueble ocupa un `tamano` fijo de catálogo y solo
 * importa que la suma quepa en `capacidadMax` — "caben 20 muebles o 30
 * dependiendo del tamaño", pedido literal del streamer.
 */

export interface MuebleGuardado {
  instanciaId: number;
  itemId: string;
  tamano: number;
}

export interface ContenedorMuebles {
  capacidadMax: number;
  muebles: MuebleGuardado[];
}

export function crearContenedorMuebles(capacidadMax: number): ContenedorMuebles {
  return { capacidadMax, muebles: [] };
}

export function capacidadUsada(c: ContenedorMuebles): number {
  return c.muebles.reduce((suma, m) => suma + m.tamano, 0);
}

export function cabeMueble(c: ContenedorMuebles, tamano: number): boolean {
  return capacidadUsada(c) + tamano <= c.capacidadMax;
}

export interface ResultadoMuebles {
  ok: boolean;
  motivo?: "tamano_invalido" | "ya_dentro" | "sin_capacidad" | "no_encontrado";
}

/** Mete un mueble (mutando `c` en el sitio, mismo criterio que `agregarItem` de inventario.ts) — rechaza tamaño no positivo, una instancia ya guardada dos veces, o que no quepa en la capacidad restante. */
export function meterMueble(c: ContenedorMuebles, mueble: MuebleGuardado): ResultadoMuebles {
  if (!(mueble.tamano > 0)) return { ok: false, motivo: "tamano_invalido" };
  if (c.muebles.some((m) => m.instanciaId === mueble.instanciaId)) return { ok: false, motivo: "ya_dentro" };
  if (!cabeMueble(c, mueble.tamano)) return { ok: false, motivo: "sin_capacidad" };
  c.muebles.push(mueble);
  return { ok: true };
}

/** Saca un mueble por su instanciaId (mutando `c` en el sitio). */
export function sacarMueble(c: ContenedorMuebles, instanciaId: number): ResultadoMuebles {
  const idx = c.muebles.findIndex((m) => m.instanciaId === instanciaId);
  if (idx === -1) return { ok: false, motivo: "no_encontrado" };
  c.muebles.splice(idx, 1);
  return { ok: true };
}
