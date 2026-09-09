import * as THREE from "three";

/**
 * Retrato en miniatura del personaje local (pedido streamer 2026-09-09:
 * "que salga la cara del pj arriba, no un emote") — sustituye el emoji
 * placeholder de `ui/hudVitales.ts` por una cámara PROPIA apuntando a la
 * cabeza real del rig del jugador, renderizada en un `<canvas>` pequeño.
 *
 * Reusa la MISMA escena que el mundo (`WorldScene.scene`) en vez de clonar
 * geometría/luces — misma iluminación, mismo ciclo día/noche, mismo equipo
 * puesto en cada momento, sin mantener un segundo estado sincronizado a
 * mano. La separación la hacen las CAPAS de Three.js (`Object3D.layers`):
 * la cámara del mundo sigue viendo solo la capa 0 de siempre (comportamiento
 * por defecto, cero cambio), esta cámara ve SOLO la capa 1 — basta con
 * `marcarVisible()` (activa la capa 1 en el rig ENTERO, `layers.enable`
 * nunca desactiva la 0) para que aparezca aquí sin que aparezca nada más
 * del mundo (terreno, otros jugadores, fauna...) en el encuadre.
 *
 * La cámara cuelga como HIJO del hueso "cabeza" (rigHumanoide.ts): un
 * `Object3D` hijo con rotación propia identidad mira por defecto hacia su
 * -Z LOCAL, que es justo la dirección de vuelta al origen del padre cuando
 * se le coloca en +Z local (rigHumanoide.ts: "la cara está en +Z local") —
 * cero cálculo de lookAt por frame, la jerarquía de la escena ya lo resuelve
 * solo, y la cámara sigue a la cabeza (posición Y ANIMACIÓN de balanceo)
 * automáticamente por ser su hijo.
 */
export class RetratoJugador {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camara: THREE.PerspectiveCamera;
  private cabezaActual: THREE.Object3D | null = null;

  constructor(private readonly scene: THREE.Scene, tamano = 64) {
    this.canvas = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(tamano, tamano, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";

    // Encuadre de busto: un poco por delante de la cara (LADO_CABEZA=0.32,
    // ver proporcionesRig.json) y a la altura de los ojos.
    this.camara = new THREE.PerspectiveCamera(30, 1, 0.05, 2);
    this.camara.position.set(0, 0.15, 0.6);
    this.camara.layers.set(1);

    // Three.js filtra TAMBIÉN las luces por capa de cámara, no solo la
    // geometría (bug real encontrado verificando con Playwright: sin esto
    // el retrato salía NEGRO SÓLIDO — MeshStandardMaterial no emite nada
    // sin ninguna luz activa en su capa). El sol/ambiente de WorldScene ya
    // existen en la escena en cuanto se construye este objeto (WorldScene
    // se crea primero) — un único traverse basta, no hace falta repetirlo.
    scene.traverse((o) => {
      if (o instanceof THREE.Light) o.layers.enable(1);
    });
  }

  /** Cuelga la cámara de la cabeza del rig del jugador local — llamar una vez al crear su rig (o al recrearlo, p.ej. tras respawn). */
  seguir(cabeza: THREE.Object3D) {
    this.cabezaActual = cabeza;
    cabeza.add(this.camara); // Object3D.add() reparenta solo si ya colgaba de otro sitio
  }

  /** Activa la capa 1 en TODA la jerarquía del rig (torso/brazos/piernas/equipo) — idempotente, volver a llamar tras equipar/desequipar algo para que la pieza nueva también aparezca aquí. */
  marcarVisible(raizRig: THREE.Object3D) {
    raizRig.traverse((o) => o.layers.enable(1));
  }

  render() {
    if (!this.cabezaActual) return;
    // `scene.background` es una propiedad de la escena, no de la cámara —
    // sin quitarlo aquí se vería el cielo/color de fondo del mundo detrás
    // de la cara. Swap-and-restore síncrono: la cámara del mundo ya
    // terminó su propio render() antes de que se llame a este método
    // (mismo bucle, mismo frame), así que no hay ningún hueco visible.
    const fondoPrevio = this.scene.background;
    this.scene.background = null;
    this.renderer.render(this.scene, this.camara);
    this.scene.background = fondoPrevio;
  }
}
