/**
 * Parcelas en el cliente — lectura del dato estático `parcelas.json` que
 * escribe la herramienta admin (GDD_Construccion §1) y utilidades visuales:
 * índice casilla→parcela para consultas O(1) y los bordes dibujados en el
 * suelo que solo se ven en modo construcción (§6).
 */
import * as THREE from "three";

export interface ParcelaDef {
  asentamiento: string;
  nombre: string;
  /** Filas de casillas incluidas como [y, x0, x1], ambos inclusive (formato del GDD §1). */
  runs: [number, number, number][];
  casillas: number;
  topeProps: number;
}

export interface ArchivoParcelas {
  version: number;
  mapa: string;
  siguienteId?: number;
  parcelas: Record<string, ParcelaDef>;
}

/**
 * Descarga `parcelas.json` del mapa. Tolerante a que no exista (mapas sin
 * parcelas pintadas aún, como el demo): 404 o fallo de red → null, sin
 * ruido en consola — el juego sigue y el modo construcción avisará.
 */
export async function cargarParcelas(rutaBase: string): Promise<ArchivoParcelas | null> {
  try {
    const r = await fetch(`${rutaBase}/parcelas.json`);
    if (!r.ok) return null;
    return (await r.json()) as ArchivoParcelas;
  } catch {
    return null;
  }
}

/**
 * Índice de pertenencia casilla→parcelaId con clave numérica
 * `y * anchoMapa + x` — exactamente el del GDD §1 (regla 4 del CLAUDE.md:
 * claves numéricas en estructuras consultadas por casilla).
 */
export function construirIndiceParcelas(archivo: ArchivoParcelas, anchoMapa: number): Map<number, string> {
  const indice = new Map<number, string>();
  for (const [id, parcela] of Object.entries(archivo.parcelas)) {
    for (const [y, x0, x1] of parcela.runs) {
      for (let x = x0; x <= x1; x++) indice.set(y * anchoMapa + x, id);
    }
  }
  return indice;
}

// Multiplicador de clave LOCAL a una parcela para detectar el contorno:
// independiente del ancho del mapa (vale hasta mapas de 65k casillas de
// ancho — el principal mide 3200).
const CLAVE_LOCAL = 1 << 16;

/**
 * Contorno de una parcela como líneas a ras de suelo (y=0.02, justo sobre
 * el plano del terreno para no pelear con el z-buffer): recorre las
 * casillas de los runs y dibuja cada arista cuya casilla vecina NO es de la
 * parcela — el resultado es el perímetro orgánico exacto, agujeros
 * incluidos. El llamador es responsable del dispose al quitarlo.
 */
export function crearBordesParcela(parcela: ParcelaDef, color: string): THREE.LineSegments {
  const dentro = new Set<number>();
  for (const [y, x0, x1] of parcela.runs) {
    for (let x = x0; x <= x1; x++) dentro.add(y * CLAVE_LOCAL + x);
  }

  const Y = 0.02;
  const puntos: number[] = [];
  const arista = (ax: number, az: number, bx: number, bz: number) => puntos.push(ax, Y, az, bx, Y, bz);
  for (const [y, x0, x1] of parcela.runs) {
    for (let x = x0; x <= x1; x++) {
      if (!dentro.has((y - 1) * CLAVE_LOCAL + x)) arista(x, y, x + 1, y); // norte
      if (!dentro.has((y + 1) * CLAVE_LOCAL + x)) arista(x, y + 1, x + 1, y + 1); // sur
      if (!dentro.has(y * CLAVE_LOCAL + x - 1)) arista(x, y, x, y + 1); // oeste
      if (!dentro.has(y * CLAVE_LOCAL + x + 1)) arista(x + 1, y, x + 1, y + 1); // este
    }
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.Float32BufferAttribute(puntos, 3));
  const material = new THREE.LineBasicMaterial({ color });
  return new THREE.LineSegments(geometria, material);
}
