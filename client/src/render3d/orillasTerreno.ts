/**
 * Caras VERTICALES del terreno de un sector (pedido streamer 2026-09-10: "el
 * terreno es plano, le falta en los bordes —sobre todo donde tenemos agua—
 * la parte vertical del terreno, ese borde que se debería generar").
 *
 * El terreno de un sector son dos planos horizontales (`sectorVisual.ts::
 * crearTerrenoSector`): el suelo a y=0 (translúcido donde hay agua) y el
 * lecho a y=-PROFUNDIDAD_FONDO. Entre la tierra y el agua no había NADA
 * vertical: mirando una orilla se veía el césped acabar de golpe y, a través
 * del agua, el lecho 1.5 unidades más abajo — sin la pared de tierra que une
 * ambos. Esto construye esa pared: un quad por cada arista tierra↔agua, del
 * suelo (y=0) al lecho (y=-profundidad), coloreado con un degradado del
 * color real de la casilla de tierra (más claro arriba, más oscuro abajo,
 * como una orilla de barro/tierra vista de canto), TODO en una única
 * BufferGeometry por sector (un draw call, igual de barato que el plano).
 *
 * Además, "faldón" en el BORDE DEL MAPA: en los sectores que tocan el límite
 * del mapa entero, una pared del mismo estilo cae por debajo de los dos
 * planos — sin ella, desde la cámara isométrica se veía el plano acabar en
 * el vacío como una hoja de papel flotando.
 *
 * Función PURA sobre arrays planos (sin canvas, sin Three) para poder
 * testearla en Node — `sectorVisual.ts` solo la convierte en una malla.
 *
 * Límite conocido y aceptado: las aristas tierra↔agua que caen JUSTO en la
 * frontera entre dos sectores no se dibujan (cada sector solo conoce sus
 * propias casillas) — 1 de cada 320 columnas/filas, y solo si además hay
 * una orilla exactamente ahí. Muy raro de notar; resolverlo exigiría que
 * cada sector conociera a sus vecinos en el streaming.
 */

export interface BordesMapaSector {
  oeste: boolean;
  este: boolean;
  norte: boolean;
  sur: boolean;
}

export interface GeometriaOrillas {
  posiciones: Float32Array;
  colores: Float32Array;
  normales: Float32Array;
  /** número de quads generados (4 vértices, 2 triángulos cada uno) */
  quads: number;
}

// Degradado vertical de la pared: arriba conserva más el color de la casilla
// (la hierba/arena que asoma por el borde), abajo se oscurece hacia tierra
// húmeda. Valores elegidos a ojo sobre el mapa principal real.
const FACTOR_ARRIBA = 0.78;
const FACTOR_ABAJO = 0.38;

/**
 * @param ancho/alto casillas del sector (local)
 * @param esAgua 1 por casilla local si es agua (agua/agua_profunda), 0 si tierra/otro
 * @param rgbSuelo 3 bytes por casilla local con el color pintado en el plano de suelo
 * @param profundidad altura de la pared de orilla (distancia entre suelo y lecho)
 * @param bordesMapa qué lados del sector coinciden con el borde del mapa entero
 * @param profundidadFaldon altura del faldón de borde de mapa (>= profundidad, cubre también el canto del lecho)
 */
export function construirOrillas(
  ancho: number,
  alto: number,
  esAgua: Uint8Array,
  rgbSuelo: Uint8Array,
  profundidad: number,
  bordesMapa: BordesMapaSector,
  profundidadFaldon: number = profundidad + 1,
): GeometriaOrillas {
  const posiciones: number[] = [];
  const colores: number[] = [];
  const normales: number[] = [];
  let quads = 0;

  const colorDe = (x: number, y: number, factor: number): [number, number, number] => {
    const i = (y * ancho + x) * 3;
    return [(rgbSuelo[i] / 255) * factor, (rgbSuelo[i + 1] / 255) * factor, (rgbSuelo[i + 2] / 255) * factor];
  };

  // Quad vertical entre (x0,z0) y (x1,z1) en el plano XZ local del sector,
  // desde yArriba hasta yAbajo, con normal fija (el material es DoubleSide,
  // la normal solo importa para el sombreado).
  const quad = (
    x0: number, z0: number, x1: number, z1: number,
    yArriba: number, yAbajo: number,
    n: [number, number, number],
    cArriba: [number, number, number], cAbajo: [number, number, number],
  ) => {
    // dos triángulos: (a0,b0,b1) (a0,b1,a1) — a=arriba, b=abajo
    posiciones.push(
      x0, yArriba, z0, x0, yAbajo, z0, x1, yAbajo, z1,
      x0, yArriba, z0, x1, yAbajo, z1, x1, yArriba, z1,
    );
    colores.push(...cArriba, ...cAbajo, ...cAbajo, ...cArriba, ...cAbajo, ...cArriba);
    for (let k = 0; k < 6; k++) normales.push(n[0], n[1], n[2]);
    quads++;
  };

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      if (esAgua[i]) continue; // solo las casillas de TIERRA levantan pared hacia el agua
      const cA = colorDe(x, y, FACTOR_ARRIBA);
      const cB = colorDe(x, y, FACTOR_ABAJO);
      // vecino oeste (x-1)
      if (x > 0 && esAgua[i - 1]) quad(x, y + 1, x, y, 0, -profundidad, [-1, 0, 0], cA, cB);
      // vecino este (x+1)
      if (x < ancho - 1 && esAgua[i + 1]) quad(x + 1, y, x + 1, y + 1, 0, -profundidad, [1, 0, 0], cA, cB);
      // vecino norte (y-1)
      if (y > 0 && esAgua[i - ancho]) quad(x, y, x + 1, y, 0, -profundidad, [0, 0, -1], cA, cB);
      // vecino sur (y+1)
      if (y < alto - 1 && esAgua[i + ancho]) quad(x + 1, y + 1, x, y + 1, 0, -profundidad, [0, 0, 1], cA, cB);
    }
  }

  // Faldón del borde del mapa: por cada casilla del lado que toca el límite
  // (tierra O agua — bajo el agua también hay que tapar el canto del lecho).
  // Una casilla de agua tapa desde el lecho hacia abajo (la pared por encima
  // del lecho se vería a través del agua como un muro raro dentro del río);
  // una de tierra, desde el suelo.
  const faldon = (x0: number, z0: number, x1: number, z1: number, n: [number, number, number], x: number, y: number) => {
    const agua = esAgua[y * ancho + x] === 1;
    const yArriba = agua ? -profundidad : 0;
    quad(x0, z0, x1, z1, yArriba, -profundidadFaldon, n, colorDe(x, y, FACTOR_ARRIBA), colorDe(x, y, FACTOR_ABAJO));
  };
  if (bordesMapa.oeste) for (let y = 0; y < alto; y++) faldon(0, y + 1, 0, y, [-1, 0, 0], 0, y);
  if (bordesMapa.este) for (let y = 0; y < alto; y++) faldon(ancho, y, ancho, y + 1, [1, 0, 0], ancho - 1, y);
  if (bordesMapa.norte) for (let x = 0; x < ancho; x++) faldon(x, 0, x + 1, 0, [0, 0, -1], x, 0);
  if (bordesMapa.sur) for (let x = 0; x < ancho; x++) faldon(x + 1, alto, x, alto, [0, 0, 1], x, alto - 1);

  return {
    posiciones: Float32Array.from(posiciones),
    colores: Float32Array.from(colores),
    normales: Float32Array.from(normales),
    quads,
  };
}
