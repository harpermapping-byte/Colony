import * as THREE from "three";
import { tiempoMundo } from "../mundo/tiempoMundo";

/**
 * Efectos visuales de clima 3D (docs/GDD_Clima.md, pedido del streamer):
 * polvo a la deriva con viento y charcos decorativos mientras llueve. Todo
 * sigue a la cámara — nunca fijo en el mundo, así vale para un mapa de
 * miles de casillas sin generar nada por streaming aparte.
 *
 * Lluvia/nieve YA NO viven aquí (2026-09-09, pedido streamer: "que las
 * lluvias nieves y tal estén en capa por encima del canvas") — se movieron
 * a `climaPantalla.ts`, un overlay 2D screen-space (canvas 2D, coordenadas
 * de píxel de pantalla en vez de radio de mundo alrededor de la cámara).
 * El problema de fondo era estructural, no solo de magnitud: cuánto "radio
 * de mundo" hace falta para cubrir el 100% del frustum de una cámara
 * ortográfica isométrica depende del aspect ratio de la ventana, del
 * ángulo isométrico fijo y del nivel de zoom — cualquier radio fijo (13,
 * luego 20 en la pasada anterior de esta misma sesión) es una aproximación
 * que puede volver a quedarse corta con solo cambiar el tamaño de ventana.
 * Un overlay 2D cubre el 100% del viewport por GARANTÍA ESTRUCTURAL (dibuja
 * en coordenadas de píxel de pantalla real), no por aproximación. Polvo y
 * charcos se quedan en 3D a propósito: el polvo es ambiental de fondo (no
 * necesita cobertura de pantalla completa) y los charcos son geometría de
 * suelo con perspectiva real (un overlay 2D no puede darles eso).
 */

/** Dirección del viento del día (no hay sistema de viento de verdad todavía) — determinista por día de mundo, mismo criterio "nunca Math.random()" que el resto del proyecto, así el polvo siempre sopla igual mientras dure el día en vez de errático. */
function anguloVientoDelDia(dia: number): number {
  let h = dia | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

// RADIO_PARTICULAS: sigue usándolo el polvo (ambiental de fondo, sin el
// problema de cobertura de pantalla completa que sí tenían lluvia/nieve —
// ver climaPantalla.ts para esas dos).
const RADIO_PARTICULAS = 20;
const ALTURA_PARTICULAS = 9;
const NUM_POLVO = 475;
const NUM_CHARCOS = 14;
const RADIO_CHARCOS = 10;

function geometriaAlrededor(n: number, radio: number, altura: number): THREE.BufferGeometry {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * radio;
    pos[i * 3 + 1] = Math.random() * altura;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * radio;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
}

export class EfectosClima {
  private polvo: THREE.Points;
  private charcos: THREE.Group;
  private tipoAnterior = "";

  constructor(scene: THREE.Scene) {
    this.polvo = new THREE.Points(
      geometriaAlrededor(NUM_POLVO, RADIO_PARTICULAS, ALTURA_PARTICULAS * 0.4),
      // Opacidad baja a propósito (pedido del streamer: "capa al 10/20% de
      // opacidad como máximo") — el viento se nota por el MOVIMIENTO del
      // polvo, no por taparlo todo.
      new THREE.PointsMaterial({ color: 0xcbb98a, size: 0.06, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.polvo.visible = false;

    // Charcos (docs/GDD_Clima.md: "no como un río, un sprite de charco" —
    // decorativos, sin efecto de juego): discos oscuros semitransparentes,
    // recolocados al azar alrededor del jugador cada vez que empieza a
    // llover. Puramente cosméticos y client-only, no se sincronizan ni se
    // guardan — por eso Math.random() aquí es correcto (no es generación
    // de mundo, es parpadeo visual efímero).
    this.charcos = new THREE.Group();
    const geoCharco = new THREE.CircleGeometry(0.6, 10);
    const matCharco = new THREE.MeshBasicMaterial({ color: 0x35435a, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < NUM_CHARCOS; i++) {
      const disco = new THREE.Mesh(geoCharco, matCharco);
      disco.rotation.x = -Math.PI / 2;
      disco.scale.setScalar(0.6 + Math.random() * 0.8);
      this.charcos.add(disco);
    }
    this.charcos.visible = false;

    scene.add(this.polvo, this.charcos);
  }

  /** Recoloca los charcos al azar dentro de RADIO_CHARCOS del centro — solo se llama al EMPEZAR a llover, nunca por frame. */
  private recolocarCharcos(centro: THREE.Vector3): void {
    for (const hijo of this.charcos.children) {
      const angulo = Math.random() * Math.PI * 2;
      const radio = Math.random() * RADIO_CHARCOS;
      hijo.position.set(centro.x + Math.cos(angulo) * radio, 0.015, centro.z + Math.sin(angulo) * radio);
    }
  }

  /** Avanza la deriva de partículas y activa/desactiva según el tipo de clima de esta franja horaria (docs/GDD_Clima.md). */
  actualizar(dt: number, tipo: string, centro: THREE.Vector3): void {
    this.polvo.visible = tipo === "viento";
    this.charcos.visible = tipo === "lluvia";

    if (tipo === "lluvia" && this.tipoAnterior !== "lluvia") this.recolocarCharcos(centro);
    this.tipoAnterior = tipo;

    this.polvo.position.copy(centro);

    if (this.polvo.visible) {
      // Dirección determinista por día (docs/GDD_Clima.md, pedido del
      // streamer: "se mueven según dirección del viento, si no hay
      // [sistema de viento todavía] aleatoria") — no hay un sistema de
      // viento real en el mundo, así que se deriva del día como el resto
      // del clima, nunca de un Math.random() por frame.
      const angulo = anguloVientoDelDia(tiempoMundo().dia);
      derivarParticulas(this.polvo, dt, 2.4, Math.cos(angulo), Math.sin(angulo));
    }
  }
}

/** Deriva en la dirección del viento (dirX,dirZ normalizado) — envuelve como un toroide al salir del radio en vez de caer, así el polvo nunca se agota. */
function derivarParticulas(puntos: THREE.Points, dt: number, velocidad: number, dirX: number, dirZ: number): void {
  const attr = puntos.geometry.getAttribute("position") as THREE.BufferAttribute;
  const paso = velocidad * dt;
  for (let i = 0; i < attr.count; i++) {
    let x = attr.getX(i) + dirX * paso;
    let z = attr.getZ(i) + dirZ * paso;
    if (x > RADIO_PARTICULAS) x -= RADIO_PARTICULAS * 2;
    else if (x < -RADIO_PARTICULAS) x += RADIO_PARTICULAS * 2;
    if (z > RADIO_PARTICULAS) z -= RADIO_PARTICULAS * 2;
    else if (z < -RADIO_PARTICULAS) z += RADIO_PARTICULAS * 2;
    attr.setX(i, x);
    attr.setZ(i, z);
  }
  attr.needsUpdate = true;
}
