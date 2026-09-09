import * as THREE from "three";

/**
 * Vagabundeo/manada de la fauna DECORATIVA (obj.t==="a", `sectorVisual.ts`),
 * 100% CLIENTE — pedido streamer 2026-09-09: "la fauna decorativa se debe
 * mover... los patrones de manada que ya pusimos". Portado del algoritmo
 * REAL de la fauna VIVA simulada (`server/src/mundo/faunaSalvajeViva.ts`,
 * `elegirDestino`/`centroideManada`/`esGregario`) — mismas constantes,
 * mismo criterio de manada — para que se lea igual de creíble, pero sin
 * NINGUNA de las piezas que dependen de servidor/identidad persistente
 * (hambre/sed, reproducción, huida/caza, BD): la fauna decorativa no tiene
 * id, nunca colisiona, nunca es interactuable, y cada viewer anima su
 * propia copia local sin sincronizar nada entre jugadores — es un efecto
 * puramente cosmético, no una entidad de juego.
 *
 * Diferencia deliberada respecto al servidor: el servidor calcula el
 * "centro" del próximo paseo desde la posición ACTUAL (puede derivar sin
 * límite a lo largo de una vida persistida en BD); aquí el centro es
 * SIEMPRE la posición ORIGINAL del bake (`homeX/homeY`) — una sesión de
 * cliente no tiene el equivalente de "vida completa persistida", así que
 * limitar el paseo a un radio fijo alrededor de su sitio de bake evita que
 * un individuo derive lejos de su manada/decoración original en una sesión
 * larga.
 *
 * Rendimiento: la actualización PESADA (mover posiciones + recomponer
 * matrices de InstancedMesh) se throttlea a `INTERVALO_ACTUALIZACION_MS`
 * en vez de cada frame — a VEL=1 casilla/seg un paso discreto cada ~150ms
 * es visualmente indistinguible de 60hz, y evita recomponer miles de
 * matrices por frame en sectores densos (187.241 instancias en el bake
 * real de Vetrheim, "solo cuesta lo cercano" — CLAUDE.md filosofía #4).
 */

// Constantes PORTADAS 1:1 de server/src/mundo/faunaSalvajeViva.ts.
const RADIO_MERODEO = 3; // casillas, paseo corto alrededor de HOME
const VEL = 1.0; // casillas/seg
const RADIO_MANADA = 10; // casillas, radio de búsqueda de vecinos gregarios
const PESO_COHESION = 0.15; // cuánto se desplaza el centro del paseo hacia el centroide de manada
const PAUSA_TRAS_LLEGAR_MIN = 2;
const PAUSA_TRAS_LLEGAR_RANGO = 4; // 2-6s, igual que el servidor
const PAUSA_SIN_HUECO = 2; // si los 6 intentos de elegirDestino fallan

const INTERVALO_ACTUALIZACION_MS = 150;

export interface IndividuoFaunaDecorativa {
  especieId: string;
  gregario: boolean;
  instanciado: THREE.InstancedMesh;
  indice: number;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  rotY: number; // radianes actuales del vóxel (orientación visual)
  escala: number;
  destino: { x: number; y: number } | null;
  pausaRestante: number;
  /**
   * Especie acuática (`requiereAgua` en baker/catalogo/animales.json —
   * peces/fauna marina) — invierte el criterio de transitabilidad del
   * paseo: SOLO agua, nunca tierra. Bug real reportado jugando 2026-09-09
   * ("los peces se salen del agua"): el comprobador de transitabilidad
   * compartido trataba "agua = no transitable" para CUALQUIER especie,
   * correcto para tierra pero exactamente al revés para peces.
   */
  acuatico: boolean;
  /**
   * Recolectado/tala en vivo delante del jugador (docs/GDD_Bosques.md §7,
   * `ocultarPosicion` de `HandleSector`) — hoy NUNCA se dispara para fauna
   * decorativa (ninguna especie de `baker/catalogo/animales.json` declara
   * `desaparaceAlRecolectar`/`categoriaRecurso`, confirmado 2026-09-09), pero
   * si algún día una especie lo hiciera, sin esta bandera el bucle de
   * animación reescribiría su matriz al frame siguiente y la "reapareceria"
   * animada — encontrado razonando la arquitectura, cerrado desde el
   * diseño inicial en vez de dejarlo como trampa latente.
   */
  oculto: boolean;
}

function centroideManada(individuo: IndividuoFaunaDecorativa, mismaEspecie: IndividuoFaunaDecorativa[]): { x: number; y: number } | null {
  let sx = 0, sy = 0, n = 0;
  for (const otro of mismaEspecie) {
    if (otro === individuo || otro.oculto) continue;
    if (Math.hypot(otro.x - individuo.x, otro.y - individuo.y) <= RADIO_MANADA) {
      sx += otro.x; sy += otro.y; n++;
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

/** Mismo algoritmo que `elegirDestino` del servidor: hasta 6 intentos de ángulo/distancia aleatoria desde `base`, aceptando el primero transitable. */
function elegirDestino(
  individuo: IndividuoFaunaDecorativa,
  mismaEspecie: IndividuoFaunaDecorativa[],
  esTransitable: (x: number, y: number, acuatico: boolean) => boolean,
): { x: number; y: number } | null {
  let baseX = individuo.homeX;
  let baseY = individuo.homeY;
  if (individuo.gregario) {
    const centro = centroideManada(individuo, mismaEspecie);
    if (centro) {
      baseX += (centro.x - individuo.homeX) * PESO_COHESION;
      baseY += (centro.y - individuo.homeY) * PESO_COHESION;
    }
  }
  for (let intento = 0; intento < 6; intento++) {
    const angulo = Math.random() * Math.PI * 2;
    const distancia = Math.random() * RADIO_MERODEO;
    const cx = baseX + Math.cos(angulo) * distancia;
    const cy = baseY + Math.sin(angulo) * distancia;
    if (esTransitable(Math.round(cx), Math.round(cy), individuo.acuatico)) return { x: cx, y: cy };
  }
  return null;
}

/**
 * Animador de la fauna decorativa de UN sector materializado — agrupa los
 * individuos por especieId (para la búsqueda de vecinos de manada, sin
 * importar en qué InstancedMesh de variante esté cada uno) y avanza su
 * simulación con throttling interno.
 */
export class AnimadorFaunaDecorativaSector {
  private readonly individuos: IndividuoFaunaDecorativa[];
  private readonly porEspecie = new Map<string, IndividuoFaunaDecorativa[]>();
  private readonly esTransitable: (x: number, y: number, acuatico: boolean) => boolean;
  private acumuladoMs = 0;
  // Reutilizados entre llamadas — cero asignación por individuo/frame.
  private readonly matriz = new THREE.Matrix4();
  private readonly posicion = new THREE.Vector3();
  private readonly rotacion = new THREE.Quaternion();
  private readonly escalaVec = new THREE.Vector3();
  private readonly ejeY = new THREE.Vector3(0, 1, 0);

  constructor(individuos: IndividuoFaunaDecorativa[], esTransitable: (x: number, y: number, acuatico: boolean) => boolean) {
    this.individuos = individuos;
    this.esTransitable = esTransitable;
    for (const ind of individuos) {
      if (!this.porEspecie.has(ind.especieId)) this.porEspecie.set(ind.especieId, []);
      this.porEspecie.get(ind.especieId)!.push(ind);
    }
  }

  /** Llamar una vez por frame (game.ts::bucle) — internamente throttlea el trabajo pesado. */
  actualizar(dtMs: number): void {
    this.acumuladoMs += dtMs;
    if (this.acumuladoMs < INTERVALO_ACTUALIZACION_MS) return;
    const dt = this.acumuladoMs / 1000;
    this.acumuladoMs = 0;

    const instanciadosTocados = new Set<THREE.InstancedMesh>();
    for (const ind of this.individuos) {
      if (ind.oculto) continue; // recolectado en vivo — su matriz ya quedó a cero, nunca recomputar por encima
      if (ind.destino) {
        const dx = ind.destino.x - ind.x;
        const dy = ind.destino.y - ind.y;
        const distancia = Math.hypot(dx, dy);
        const paso = VEL * dt;
        if (distancia <= paso || distancia < 1e-4) {
          ind.x = ind.destino.x; ind.y = ind.destino.y;
          ind.destino = null;
          ind.pausaRestante = PAUSA_TRAS_LLEGAR_MIN + Math.random() * PAUSA_TRAS_LLEGAR_RANGO;
        } else {
          ind.rotY = Math.atan2(dx, dy); // orientado hacia el destino, mismo criterio que el rig humanoide (atan2(dx,dz))
          ind.x += (dx / distancia) * paso;
          ind.y += (dy / distancia) * paso;
        }
      } else if (ind.pausaRestante > 0) {
        ind.pausaRestante -= dt;
      } else {
        const destino = elegirDestino(ind, this.porEspecie.get(ind.especieId)!, this.esTransitable);
        if (destino) ind.destino = destino;
        else ind.pausaRestante = PAUSA_SIN_HUECO;
      }

      this.posicion.set(ind.x + 0.5, 0, ind.y + 0.5);
      this.rotacion.setFromAxisAngle(this.ejeY, ind.rotY);
      this.escalaVec.setScalar(ind.escala);
      this.matriz.compose(this.posicion, this.rotacion, this.escalaVec);
      ind.instanciado.setMatrixAt(ind.indice, this.matriz);
      instanciadosTocados.add(ind.instanciado);
    }
    for (const instanciado of instanciadosTocados) instanciado.instanceMatrix.needsUpdate = true;
  }
}
