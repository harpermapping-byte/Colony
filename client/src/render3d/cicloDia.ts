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
 *
 * Estación y clima (docs/GDD_Clima.md, pedido 2026-08-30, "que sea muy
 * sutil"): un filtro de color por ESTACIÓN se multiplica sobre el cielo/luz
 * ya calculados por la hora (nunca los sustituye) y un factor de intensidad
 * por CLIMA los atenúa un poco en días nublados/de lluvia. Sin partículas
 * de lluvia/nieve ni nieve acumulable todavía — pedido explícitamente
 * aparte por el streamer, esto es solo el tinte de ambiente.
 */
import * as THREE from "three";
import { tiempoMundo, HORA_AMANECER, HORA_ANOCHECER } from "../mundo/tiempoMundo";
import { climaDelDia, type Estacion } from "../mundo/clima";

export interface EstadoCiclo {
  /** dirección DESDE la que llega la luz, normalizada (se multiplica por la distancia del sol al objetivo) */
  direccionLuz: THREE.Vector3;
  colorLuz: THREE.Color;
  intensidadLuz: number;
  intensidadAmbiente: number;
  colorCielo: THREE.Color;
  hora: number;
  /** clima del día — expuesto para que WorldScene (o UI futura) reaccione sin recalcular nada. */
  clima: string;
}

const SOL_MEDIODIA = new THREE.Color("#fff6e8");
const SOL_HORIZONTE = new THREE.Color("#ffb877");
const LUNA = new THREE.Color("#93a9c9");
const CIELO_DIA = new THREE.Color("#6f9ec4");
const CIELO_HORIZONTE = new THREE.Color("#3d4a63");
const CIELO_NOCHE = new THREE.Color("#11151f");

// Filtro estacional (pedido: "verano más luminoso, otoño beige, invierno
// blanco, primavera azulado/verde, MUY sutil") — multiplicadores cercanos a
// (1,1,1): un desplazamiento de tono, nunca un filtro plano que se note.
const FILTRO_ESTACION: Record<Estacion, THREE.Color> = {
  primavera: new THREE.Color(0.97, 1.01, 1.04),
  verano: new THREE.Color(1.04, 1.02, 0.97),
  otono: new THREE.Color(1.04, 0.99, 0.89),
  invierno: new THREE.Color(1.0, 1.02, 1.07),
};
const BLANCO = new THREE.Color(1, 1, 1);

// Intensidad por clima (estados posibles del día, docs/GDD_Clima.md) — solo
// atenúa luz/ambiente; "viento" casi no se nota en la luz (es un estado de
// ambiente, no de cielo cubierto). Sin nieve acumulable, solo el filtro.
const FACTOR_LUZ_CLIMA: Record<string, number> = {
  soleado: 1.0,
  nublado: 0.82,
  lluvia: 0.7,
  nieve: 0.88,
  viento: 0.95,
};

const _dir = new THREE.Vector3();
const _color = new THREE.Color();
const _cielo = new THREE.Color();
const _filtroLuz = new THREE.Color();

/** t: progreso 0..1 del astro por el cielo → dirección de la luz (este→oeste, arco por el sur del encuadre). */
function arcoAstro(t: number, elevacionMax: number): THREE.Vector3 {
  const elevacion = THREE.MathUtils.degToRad(14 + (elevacionMax - 14) * Math.sin(t * Math.PI));
  const azimut = THREE.MathUtils.lerp(-0.85, 0.85, t) * Math.PI * 0.5; // -76º(este) → +76º(oeste)
  _dir.set(Math.sin(azimut), Math.tan(elevacion), 0.45).normalize();
  return _dir;
}

export function estadoCiclo(ahoraMs = Date.now()): EstadoCiclo {
  const { hora, dia, estacion } = tiempoMundo(ahoraMs);
  const duracionDia = HORA_ANOCHECER - HORA_AMANECER;

  let resultado: EstadoCiclo;
  if (hora >= HORA_AMANECER && hora < HORA_ANOCHECER) {
    const t = (hora - HORA_AMANECER) / duracionDia;
    const altura = Math.sin(t * Math.PI); // 0 en los bordes, 1 al mediodía
    // hora dorada: las primeras/últimas 2.5 h de sol tiñen la luz y el
    // cielo de cálido; a partir de ahí el día es neutro (el criterio es
    // distancia al borde del día en horas, no altura — más legible y la
    // ventana no depende de la duración del día)
    const bordeHoras = Math.min(hora - HORA_AMANECER, HORA_ANOCHECER - hora);
    const neutro = THREE.MathUtils.clamp(bordeHoras / 2.5, 0, 1);
    resultado = {
      direccionLuz: arcoAstro(t, 62),
      colorLuz: _color.copy(SOL_HORIZONTE).lerp(SOL_MEDIODIA, neutro),
      intensidadLuz: 0.5 + 0.5 * altura,
      intensidadAmbiente: 0.4 + 0.35 * altura,
      colorCielo: _cielo.copy(CIELO_HORIZONTE).lerp(CIELO_DIA, neutro),
      hora,
      clima: "",
    };
  } else {
    // noche: la luna recorre el mismo arco durante las horas sin sol
    const duracionNoche = 24 - duracionDia;
    const horaNoche = hora >= HORA_ANOCHECER ? hora - HORA_ANOCHECER : hora + (24 - HORA_ANOCHECER);
    const t = horaNoche / duracionNoche;
    const profundidad = Math.sin(t * Math.PI); // 1 en plena madrugada
    resultado = {
      direccionLuz: arcoAstro(t, 55),
      colorLuz: _color.copy(LUNA),
      intensidadLuz: 0.16,
      intensidadAmbiente: 0.3 - 0.08 * profundidad,
      colorCielo: _cielo.copy(CIELO_HORIZONTE).lerp(CIELO_NOCHE, THREE.MathUtils.clamp(profundidad * 2.5, 0, 1)),
      hora,
      clima: "",
    };
  }

  aplicarEstacionYClima(resultado, dia, estacion as Estacion);
  return resultado;
}

/** Multiplica el filtro de estación sobre cielo/luz ya calculados por la hora, y atenúa intensidad según el clima del día — mutación en sitio sobre el resultado ya construido, nunca lo sustituye. */
function aplicarEstacionYClima(estado: EstadoCiclo, dia: number, estacion: Estacion): void {
  const filtro = FILTRO_ESTACION[estacion] ?? FILTRO_ESTACION.primavera;
  estado.colorCielo.multiply(filtro);
  // la luz se tiñe a la mitad de fuerza que el cielo — el sol/la luna ya
  // tienen su propio color calculado, esto solo lo desplaza un poco
  _filtroLuz.copy(BLANCO).lerp(filtro, 0.5);
  estado.colorLuz.multiply(_filtroLuz);

  estado.clima = climaDelDia(dia, estacion);
  const factor = FACTOR_LUZ_CLIMA[estado.clima] ?? 1;
  estado.intensidadLuz *= factor;
  estado.intensidadAmbiente *= factor;
}
