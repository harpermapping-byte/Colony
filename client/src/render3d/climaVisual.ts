import * as THREE from "three";

/**
 * Efectos visuales de clima (docs/GDD_Clima.md, pedido del streamer) —
 * PLACEHOLDER sencillo, mismo criterio que el resto del arte del proyecto
 * (se sustituye más adelante sin tocar la maquinaria): partículas de
 * lluvia/nieve cayendo, polvo a la deriva con viento, niebla que limita la
 * vista (una molestia pequeña, no ceguera) y charcos decorativos mientras
 * llueve. Todo sigue a la cámara — nunca fijo en el mundo, así vale para
 * un mapa de miles de casillas sin generar nada por streaming aparte.
 */

const RADIO_PARTICULAS = 13;
const ALTURA_PARTICULAS = 9;
const NUM_LLUVIA = 500;
const NUM_NIEVE = 300;
const NUM_POLVO = 200;
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
  private lluvia: THREE.Points;
  private nieveCayendo: THREE.Points;
  private polvo: THREE.Points;
  private charcos: THREE.Group;
  private charcosColocados = false;
  private tipoAnterior = "";

  constructor(scene: THREE.Scene) {
    this.lluvia = new THREE.Points(
      geometriaAlrededor(NUM_LLUVIA, RADIO_PARTICULAS, ALTURA_PARTICULAS),
      new THREE.PointsMaterial({ color: 0xaac8ff, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.lluvia.visible = false;
    this.nieveCayendo = new THREE.Points(
      geometriaAlrededor(NUM_NIEVE, RADIO_PARTICULAS, ALTURA_PARTICULAS),
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.nieveCayendo.visible = false;
    this.polvo = new THREE.Points(
      geometriaAlrededor(NUM_POLVO, RADIO_PARTICULAS, ALTURA_PARTICULAS * 0.4),
      new THREE.PointsMaterial({ color: 0xcbb98a, size: 0.06, transparent: true, opacity: 0.25, depthWrite: false }),
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

    scene.add(this.lluvia, this.nieveCayendo, this.polvo, this.charcos);
  }

  /** Recoloca los charcos al azar dentro de RADIO_CHARCOS del centro — solo se llama al EMPEZAR a llover, nunca por frame. */
  private recolocarCharcos(centro: THREE.Vector3): void {
    for (const hijo of this.charcos.children) {
      const angulo = Math.random() * Math.PI * 2;
      const radio = Math.random() * RADIO_CHARCOS;
      hijo.position.set(centro.x + Math.cos(angulo) * radio, 0.015, centro.z + Math.sin(angulo) * radio);
    }
  }

  /** Avanza la caída/deriva de partículas y activa/desactiva según el tipo de clima de esta franja horaria (docs/GDD_Clima.md). */
  actualizar(dt: number, tipo: string, centro: THREE.Vector3): void {
    this.lluvia.visible = tipo === "lluvia";
    this.nieveCayendo.visible = tipo === "nieve";
    this.polvo.visible = tipo === "viento";
    this.charcos.visible = tipo === "lluvia";

    if (tipo === "lluvia" && this.tipoAnterior !== "lluvia") this.recolocarCharcos(centro);
    this.tipoAnterior = tipo;

    this.lluvia.position.copy(centro);
    this.nieveCayendo.position.copy(centro);
    this.polvo.position.copy(centro);

    if (this.lluvia.visible) caerParticulas(this.lluvia, dt, 9, ALTURA_PARTICULAS);
    if (this.nieveCayendo.visible) caerParticulas(this.nieveCayendo, dt, 1.3, ALTURA_PARTICULAS, 0.4);
    if (this.polvo.visible) derivarParticulas(this.polvo, dt, 2.2);
  }
}

/** Partículas que caen a `velocidad` unidades/seg y reaparecen arriba al tocar el suelo — con deriva lateral opcional (nieve). */
function caerParticulas(puntos: THREE.Points, dt: number, velocidad: number, altura: number, derivaLateral = 0): void {
  const attr = puntos.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < attr.count; i++) {
    let y = attr.getY(i) - velocidad * dt;
    let x = attr.getX(i);
    if (derivaLateral) x += Math.sin(y * 0.7 + i) * derivaLateral * dt;
    if (y < 0) { y = altura; x = (Math.random() * 2 - 1) * RADIO_PARTICULAS; }
    attr.setX(i, x);
    attr.setY(i, y);
  }
  attr.needsUpdate = true;
}

/** Deriva horizontal continua (polvo de viento) — envuelve al salir del radio en vez de caer. */
function derivarParticulas(puntos: THREE.Points, dt: number, velocidad: number): void {
  const attr = puntos.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < attr.count; i++) {
    let x = attr.getX(i) + velocidad * dt;
    if (x > RADIO_PARTICULAS) x = -RADIO_PARTICULAS;
    attr.setX(i, x);
  }
  attr.needsUpdate = true;
}
