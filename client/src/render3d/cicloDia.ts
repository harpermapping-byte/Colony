/**
 * Ciclo día/noche VISUAL: convierte la hora de juego en el estado de la luz
 * (sol que recorre el cielo, sombras que giran con él, luna fría de noche,
 * ambiente y cielo que aclaran/oscurecen). Solo matemáticas puras — quien
 * aplica el resultado a Three es WorldScene, así esto se puede testear y
 * ajustar sin escena.
 *
 * Decisiones visuales (GDD_Tiempo_Mundo.md):
 * - El sol sale por el este (+X del mundo), culmina alto al mediodía y se
 *   pone por el oeste. La elevación nunca baja de ~14º mientras es de día:
 *   con menos, la caja de sombras de la ortográfica se degrada.
 * - Amanecer/atardecer tiñen el sol de cálido; el mediodía es neutro.
 * - La noche NO es negra (injugable): luna direccional fría y tenue que
 *   recorre el cielo igual que el sol, ambiente bajo y cielo azul oscuro.
 */
import * as THREE from "three";
import { tiempoMundo, HORA_AMANECER, HORA_ANOCHECER } from "../mundo/tiempoMundo";

export interface EstadoCiclo {
  /** dirección DESDE la que llega la luz, normalizada (se multiplica por la distancia del sol al objetivo) */
  direccionLuz: THREE.Vector3;
  colorLuz: THREE.Color;
  intensidadLuz: number;
  intensidadAmbiente: number;
  colorCielo: THREE.Color;
  hora: number;
}

const SOL_MEDIODIA = new THREE.Color("#fff6e8");
const SOL_HORIZONTE = new THREE.Color("#ffb877");
const LUNA = new THREE.Color("#93a9c9");
const CIELO_DIA = new THREE.Color("#6f9ec4");
const CIELO_HORIZONTE = new THREE.Color("#3d4a63");
const CIELO_NOCHE = new THREE.Color("#11151f");

const _dir = new THREE.Vector3();
const _color = new THREE.Color();
const _cielo = new THREE.Color();

/** t: progreso 0..1 del astro por el cielo → dirección de la luz (este→oeste, arco por el sur del encuadre). */
function arcoAstro(t: number, elevacionMax: number): THREE.Vector3 {
  const elevacion = THREE.MathUtils.degToRad(14 + (elevacionMax - 14) * Math.sin(t * Math.PI));
  const azimut = THREE.MathUtils.lerp(-0.85, 0.85, t) * Math.PI * 0.5; // -76º(este) → +76º(oeste)
  _dir.set(Math.sin(azimut), Math.tan(elevacion), 0.45).normalize();
  return _dir;
}

export function estadoCiclo(ahoraMs = Date.now()): EstadoCiclo {
  const { hora } = tiempoMundo(ahoraMs);
  const duracionDia = HORA_ANOCHECER - HORA_AMANECER;

  if (hora >= HORA_AMANECER && hora < HORA_ANOCHECER) {
    const t = (hora - HORA_AMANECER) / duracionDia;
    const altura = Math.sin(t * Math.PI); // 0 en los bordes, 1 al mediodía
    // hora dorada: las primeras/últimas 2.5 h de sol tiñen la luz y el
    // cielo de cálido; a partir de ahí el día es neutro (el criterio es
    // distancia al borde del día en horas, no altura — más legible y la
    // ventana no depende de la duración del día)
    const bordeHoras = Math.min(hora - HORA_AMANECER, HORA_ANOCHECER - hora);
    const neutro = THREE.MathUtils.clamp(bordeHoras / 2.5, 0, 1);
    return {
      direccionLuz: arcoAstro(t, 62),
      colorLuz: _color.copy(SOL_HORIZONTE).lerp(SOL_MEDIODIA, neutro),
      intensidadLuz: 0.5 + 0.5 * altura,
      intensidadAmbiente: 0.4 + 0.35 * altura,
      colorCielo: _cielo.copy(CIELO_HORIZONTE).lerp(CIELO_DIA, neutro),
      hora,
    };
  }

  // noche: la luna recorre el mismo arco durante las horas sin sol
  const duracionNoche = 24 - duracionDia;
  const horaNoche = hora >= HORA_ANOCHECER ? hora - HORA_ANOCHECER : hora + (24 - HORA_ANOCHECER);
  const t = horaNoche / duracionNoche;
  const profundidad = Math.sin(t * Math.PI); // 1 en plena madrugada
  return {
    direccionLuz: arcoAstro(t, 55),
    colorLuz: _color.copy(LUNA),
    intensidadLuz: 0.16,
    intensidadAmbiente: 0.3 - 0.08 * profundidad,
    colorCielo: _cielo.copy(CIELO_HORIZONTE).lerp(CIELO_NOCHE, THREE.MathUtils.clamp(profundidad * 2.5, 0, 1)),
    hora,
  };
}
