import * as THREE from "three";
import { tiempoMundo } from "../mundo/tiempoMundo";

/**
 * Efectos visuales de clima (docs/GDD_Clima.md, pedido del streamer) —
 * PLACEHOLDER sencillo, mismo criterio que el resto del arte del proyecto
 * (se sustituye más adelante sin tocar la maquinaria): partículas de
 * lluvia/nieve cayendo, polvo a la deriva con viento, niebla que limita la
 * vista (una molestia pequeña, no ceguera) y charcos decorativos mientras
 * llueve. Todo sigue a la cámara — nunca fijo en el mundo, así vale para
 * un mapa de miles de casillas sin generar nada por streaming aparte.
 */

/** Dirección del viento del día (no hay sistema de viento de verdad todavía) — determinista por día de mundo, mismo criterio "nunca Math.random()" que el resto del proyecto, así el polvo siempre sopla igual mientras dure el día en vez de errático. */
function anguloVientoDelDia(dia: number): number {
  let h = dia | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

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
