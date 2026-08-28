/**
 * Convierte el interior YA bakeado de un edificio (interiores/src/edificio.js,
 * el mismo JSON que ciudades/ escribe en `<rutaMapa>/interiores/<edificio>.json`)
 * en la rejilla de colisión que usa la simulación — mismo patrón que
 * mundo/mapaColision.ts para el exterior, pero a escala de habitación.
 *
 * v2 (docs/GDD_Sistema_Puertas.md): rejilla de la planta que se pida por
 * `nivel` (NUNCA plantas[0] a fuego: con bodega, el índice 0 es el sótano).
 * Las escaleras/trampillas (conectoresVerticales) de ESA planta se exponen
 * como `conectores`, cada uno con su casilla real — InteriorRoom los trata
 * como un portal más: pisarlos/interactuar cambia de planta (mismo mensaje
 * portal:usar/portal:ir que el resto del sistema de puertas). Las puertas
 * ENTRE salas de la MISMA planta (puertasConexion) siguen sin ser TP: son
 * solo un hueco físico en la pared, como pactó el usuario.
 */

import * as fs from "fs";
import * as path from "path";
import { MundoColision, TIPO } from "./colisiones";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");

interface DefElemento {
  capa?: string;
  anchorType?: string;
}

// Colisión PROPIA de interiores — NO la del catálogo de construcción
// (construccion/catalogo.ts: "todo bloquea salvo FLOOR_DECAL", pensado
// para lo poco que coloca un jugador). Un interior bakeado por
// interiores/ viene lleno de clutter decorativo ("suciedad": hojas
// secas, escombros, nidos de rata; "iluminacion": antorchas de pie) que
// NUNCA debería bloquear el paso — con la regla de construcción, una
// habitación de 20 casillas con 9 piezas de clutter salía casi
// intransitable (bug real, encontrado con flood-fill de prueba).
const CAPAS_QUE_NO_BLOQUEAN = new Set(["suciedad", "iluminacion"]);
let catalogoElementos: Record<string, DefElemento> | null = null;
function elementoEsSolido(id: string): boolean {
  if (!catalogoElementos) {
    catalogoElementos = JSON.parse(
      fs.readFileSync(path.join(RAIZ_REPO, "interiores", "catalogo", "elementos.json"), "utf8"),
    );
  }
  const def = catalogoElementos![id];
  if (!def) return false; // pieza desconocida: mejor pasable que atascar al jugador
  if (CAPAS_QUE_NO_BLOQUEAN.has(def.capa ?? "")) return false;
  return def.anchorType !== "FLOOR_DECAL";
}

interface ElementoColocado {
  id: string;
  x: number;
  y: number;
  ancho: number;
  largo: number;
}

interface SalaInterior {
  offsetX: number;
  offsetY: number;
  resultado: {
    ancho: number;
    largo: number;
    puerta: { lado: string; x: number; y: number };
    colocados: ElementoColocado[];
  };
}

interface PuertaConexion {
  x: number;
  y: number;
}

interface PosicionConector {
  x: number;
  y: number;
}

interface ConectorVertical {
  tipoConectorId: string;
  entreNiveles: [number, number];
  salaAbajo: string;
  salaArriba: string;
  posicionAbajo: PosicionConector;
  posicionArriba: PosicionConector;
  huella: [number, number];
}

interface InteriorBakeado {
  id: string;
  tipoEdificioId: string;
  plantas: { nivel: number; rol: string; salas: SalaInterior[]; puertasConexion?: PuertaConexion[] }[];
  conectoresVerticales?: ConectorVertical[];
}

/** Escalera/trampilla de ESTA planta, ya resuelta a "aquí está, a este nivel lleva". */
export interface ConectorInteractivo {
  x: number;
  y: number;
  huella: [number, number];
  tipoConectorId: string;
  destinoNivel: number;
  /** casilla del OTRO lado (en la rejilla de `destinoNivel`) donde aparece
   * quien lo cruza — las plantas no comparten XY (GDD_Bakeador_Interiores
   * sección 7), así que la posición de aquí NO sirve para el otro piso. */
  entradaDestino: { x: number; y: number };
}

export interface InteriorCargado extends MundoColision {
  id: string;
  nivel: number;
  rol: string;
  /** casilla de aparición al entrar (dentro de la primera sala de la planta) */
  spawnX: number;
  spawnY: number;
  conectores: ConectorInteractivo[];
}

export function cargarInterior(rutaArchivo: string, nivel = 0): InteriorCargado {
  const interior = JSON.parse(fs.readFileSync(rutaArchivo, "utf8")) as InteriorBakeado;
  // plantas[0] NO es siempre la planta baja: un edificio con bodega
  // (tieneBodega:true en tipos_edificio.json — casa_noble, taberna,
  // posada, casa_gremio, ayuntamiento...) trae la bodega en el índice 0
  // (bug real: cargaba el sótano como si fuera la entrada, con su propio
  // tamaño de rejilla — dejaba el resto del edificio fuera de la rejilla
  // de colisión entera). Buscar por `nivel` explícito, nunca por posición.
  const planta = interior.plantas.find((p) => p.nivel === nivel) ?? interior.plantas.find((p) => p.rol === "planta_baja") ?? interior.plantas[0];
  const salas = planta?.salas ?? [];
  if (salas.length === 0) throw new Error(`interior sin salas en la planta nivel=${nivel}: ${rutaArchivo}`);

  const puertas = planta.puertasConexion ?? [];
  const ancho = Math.max(...salas.map((s) => s.offsetX + s.resultado.ancho), ...puertas.map((p) => p.x + 1)) + 1;
  const alto = Math.max(...salas.map((s) => s.offsetY + s.resultado.largo), ...puertas.map((p) => p.y + 1)) + 1;
  const casillas = new Uint8Array(ancho * alto).fill(TIPO.SOLIDO); // fuera de toda sala = pared
  const velocidad = new Float32Array(ancho * alto).fill(1);

  for (const sala of salas) {
    const { offsetX, offsetY, resultado } = sala;
    for (let y = 0; y < resultado.largo; y++) {
      for (let x = 0; x < resultado.ancho; x++) {
        casillas[(offsetY + y) * ancho + (offsetX + x)] = TIPO.TIERRA;
      }
    }
    for (const item of resultado.colocados) {
      if (!elementoEsSolido(item.id)) continue; // decorativo/clutter: no bloquea
      for (let y = 0; y < item.largo; y++) {
        for (let x = 0; x < item.ancho; x++) {
          const idx = (offsetY + item.y + y) * ancho + (offsetX + item.x + x);
          if (idx >= 0 && idx < casillas.length) casillas[idx] = TIPO.SOLIDO;
        }
      }
    }
  }

  // Puertas de conexión REALES entre salas (interiores/src/edificio.js):
  // sin esto cada sala quedaba pisable por dentro pero sin ningún hueco
  // que la conectara con la de al lado o el pasillo — jugador atascado en
  // su cuarto. Se despeja la puerta Y su umbral (los 4 vecinos): el
  // mobiliario se coloca sin saber todavía dónde caerá esta puerta (se
  // decide después, entre salas, no dentro de colocarSala) y a veces
  // termina justo encima — sin esto, un mueble podía tapar la única
  // conexión entre dos salas (bug real, encontrado con flood-fill).
  for (const puerta of planta.puertasConexion ?? []) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = puerta.x + dx, y = puerta.y + dy;
      if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
      casillas[y * ancho + x] = TIPO.TIERRA;
    }
  }

  // Aparece cerca del centro de la primera sala (v1: no hay forma explícita
  // de saber cuál conecta con la puerta exterior — ver GDD_Sistema_Puertas.md),
  // corregido a la casilla pisable más cercana: el centro geométrico exacto
  // a veces cae encima de un mueble colocado ahí a propósito (una mesa, un
  // hogar) — spawn dentro de un sólido dejaba al jugador aislado del resto
  // de la sala en el flood-fill (bug real, encontrado con la prueba).
  const primera = salas[0];
  const centroX = Math.round(primera.offsetX + primera.resultado.ancho / 2);
  const centroY = Math.round(primera.offsetY + primera.resultado.largo / 2);
  const spawn = casillaPisableMasCercana(casillas, ancho, alto, centroX, centroY);

  // Garantía final de conectividad: el mobiliario se coloca sala a sala sin
  // saber nada de las salas vecinas, así que un cúmulo de clutter puede
  // (raro, pero pasa — bug real encontrado aquí) sellar por accidente el
  // único acceso a una sala más allá del umbral de su puerta, aunque la
  // puerta en sí esté despejada. En vez de intentar predecir todos los
  // casos, se COMPRUEBA con flood-fill real desde el spawn y, si una sala
  // queda fuera, se abre un pasillo recto de una casilla hasta ella — más
  // vale un mueble desaparecido en un caso raro que un jugador atascado.
  garantizarConectividad(casillas, ancho, alto, spawn, salas);

  // Conectores verticales (escaleras/trampillas) que tocan ESTA planta —
  // se despeja su huella como TIERRA (por si algún mueble cercano invadió
  // la casilla) y se exponen con el nivel al que llevan, para que
  // InteriorRoom los trate como un portal más.
  const conectores: ConectorInteractivo[] = [];
  for (const c of interior.conectoresVerticales ?? []) {
    const [nivelAbajo, nivelArriba] = c.entreNiveles;
    let posicion: PosicionConector | null = null;
    let entradaDestino: PosicionConector | null = null;
    let destinoNivel: number | null = null;
    if (nivelAbajo === nivel) { posicion = c.posicionAbajo; entradaDestino = c.posicionArriba; destinoNivel = nivelArriba; }
    else if (nivelArriba === nivel) { posicion = c.posicionArriba; entradaDestino = c.posicionAbajo; destinoNivel = nivelAbajo; }
    if (!posicion || !entradaDestino || destinoNivel === null) continue;

    const [hw, hl] = c.huella;
    for (let y = 0; y < hl; y++) {
      for (let x = 0; x < hw; x++) {
        const idx = (posicion.y + y) * ancho + (posicion.x + x);
        if (idx >= 0 && idx < casillas.length) casillas[idx] = TIPO.TIERRA;
      }
    }
    conectores.push({
      x: posicion.x, y: posicion.y, huella: c.huella, tipoConectorId: c.tipoConectorId,
      destinoNivel,
      // centro de la huella, no la esquina: aparecer en la esquina exacta
      // de un conector 1x3 deja al jugador pegado al borde en vez de en
      // medio del hueco (misma huella a ambos lados del conector).
      entradaDestino: { x: entradaDestino.x + hw / 2, y: entradaDestino.y + hl / 2 },
    });
  }

  return {
    id: interior.id,
    nivel,
    rol: planta.rol,
    ancho, alto, casillas, velocidad,
    spawnX: spawn.x + 0.5, spawnY: spawn.y + 0.5,
    conectores,
  };
}

function floodFill(casillas: Uint8Array, ancho: number, alto: number, inicio: { x: number; y: number }): Uint8Array {
  const visitado = new Uint8Array(ancho * alto);
  if (casillas[inicio.y * ancho + inicio.x] === TIPO.SOLIDO) return visitado;
  const cola: [number, number][] = [[inicio.x, inicio.y]];
  visitado[inicio.y * ancho + inicio.x] = 1;
  while (cola.length) {
    const [x, y] = cola.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const idx = ny * ancho + nx;
      if (visitado[idx] || casillas[idx] === TIPO.SOLIDO) continue;
      visitado[idx] = 1;
      cola.push([nx, ny]);
    }
  }
  return visitado;
}

function garantizarConectividad(
  casillas: Uint8Array,
  ancho: number,
  alto: number,
  spawn: { x: number; y: number },
  salas: SalaInterior[],
) {
  for (const sala of salas) {
    const visitado = floodFill(casillas, ancho, alto, spawn);
    const cx = sala.offsetX + Math.floor(sala.resultado.ancho / 2);
    const cy = sala.offsetY + Math.floor(sala.resultado.largo / 2);
    // ¿algún tile de ESTA sala ya es alcanzable? (no solo el centro: el
    // centro puede ser un mueble)
    let yaConectada = false;
    for (let y = sala.offsetY; y < sala.offsetY + sala.resultado.largo && !yaConectada; y++) {
      for (let x = sala.offsetX; x < sala.offsetX + sala.resultado.ancho; x++) {
        if (visitado[y * ancho + x]) { yaConectada = true; break; }
      }
    }
    if (yaConectada) continue;

    // punto alcanzable más cercano al centro de la sala aislada
    let mejor: { x: number; y: number } | null = null;
    let mejorDist = Infinity;
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        if (!visitado[y * ancho + x]) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < mejorDist) { mejorDist = d; mejor = { x, y }; }
      }
    }
    if (!mejor) continue; // nada alcanzable en absoluto (no debería pasar)

    // pasillo recto en L, forzando TIERRA — feo pero garantiza el acceso
    let x = mejor.x, y = mejor.y;
    while (x !== cx) { x += x < cx ? 1 : -1; casillas[y * ancho + x] = TIPO.TIERRA; }
    while (y !== cy) { y += y < cy ? 1 : -1; casillas[y * ancho + x] = TIPO.TIERRA; }
  }
}

function casillaPisableMasCercana(
  casillas: Uint8Array,
  ancho: number,
  alto: number,
  x0: number,
  y0: number,
): { x: number; y: number } {
  const radioMax = Math.max(ancho, alto);
  for (let r = 0; r < radioMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
        if (casillas[y * ancho + x] !== TIPO.SOLIDO) return { x, y };
      }
    }
  }
  return { x: x0, y: y0 }; // sala enteramente sólida (no debería pasar): aparece ahí igualmente
}
