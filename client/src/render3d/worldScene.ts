import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

const TAMANO_MUNDO_VISIBLE = 16; // unidades de mundo visibles en el eje corto de la cámara

/**
 * Escena 3D del mundo — sustituye al render de Phaser (sprites planos) para
 * todo lo que NO sea suelo/terreno: props, objetos y personajes. El suelo
 * sigue siendo una textura plana (por ahora un plano placeholder gris; la
 * textura real de `assets/terrenos/` se engancha aquí más adelante sin
 * tocar el resto de esta clase).
 *
 * Cámara ortográfica en ángulo isométrico clásico: la geometría es 3D de
 * verdad (gira, tiene volumen), pero el encuadre da el mismo aspecto
 * 2.5D que ya se había validado en `interiores/src/prueba_render_iso.js`.
 */
export class WorldScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly entidades = new Map<string, THREE.Object3D>();

  constructor(contenedor: HTMLElement, ancho: number, alto: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    contenedor.appendChild(this.renderer.domElement);

    // Etiquetas de nombre (jugadores) como overlay HTML sincronizado con la
    // cámara 3D — mismo mecanismo que usan los ejemplos oficiales de Three
    // para HUD/nametags sobre geometría real.
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.top = "0";
    this.labelRenderer.domElement.style.left = "0";
    this.labelRenderer.domElement.style.pointerEvents = "none";
    contenedor.style.position = "relative";
    contenedor.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.posicionarCamaraIsometrica();

    this.scene.background = new THREE.Color(0x1a202c);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sol = new THREE.DirectionalLight(0xffffff, 0.9);
    sol.position.set(40, 60, 25);
    sol.target.position.set(24, 0, 24);
    sol.castShadow = true;
    // La cámara de sombra por defecto es una caja de ±5 unidades — se queda
    // corta para un mapa de decenas de casillas y recorta las sombras. Se
    // abre a todo el mapa demo; cuando haya mapas grandes, la luz deberá
    // seguir a la cámara (pendiente junto con la carga perezosa de sectores).
    sol.shadow.camera.left = -40;
    sol.shadow.camera.right = 40;
    sol.shadow.camera.top = 40;
    sol.shadow.camera.bottom = -40;
    sol.shadow.mapSize.set(2048, 2048);
    this.scene.add(sol, sol.target);

    // Suelo de emergencia MUY por debajo del terreno real (que añade
    // `terreno.ts` como estático): solo se ve si el mapa no carga, para que
    // el fallo sea visible en vez de un vacío negro confuso.
    const sueloEmergencia = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x2d3748 }),
    );
    sueloEmergencia.rotation.x = -Math.PI / 2;
    sueloEmergencia.position.y = -0.05;
    this.scene.add(sueloEmergencia);

    this.resize(ancho, alto);
  }

  /** Añade geometría estática del mundo (terreno, props bakeados) — no es una entidad con id. */
  añadirEstatico(objeto: THREE.Object3D) {
    this.scene.add(objeto);
  }

  private objetivoCamara = new THREE.Vector3(0, 0, 0);
  private destinoCamara = new THREE.Vector3(0, 0, 0);

  private posicionarCamaraIsometrica() {
    const distancia = 20;
    this.camera.position.set(
      this.objetivoCamara.x + distancia,
      this.objetivoCamara.y + distancia,
      this.objetivoCamara.z + distancia,
    );
    this.camera.lookAt(this.objetivoCamara);
  }

  /**
   * Centra la cámara isométrica sobre un punto del mundo (normalmente el
   * jugador local). El movimiento real es suavizado en `actualizar()` — la
   * cámara persigue el destino en vez de teletransportarse con cada patch
   * de red (15/seg darían tirones visibles).
   */
  seguirPunto(x: number, y: number, inmediato = false) {
    const [wx, wz] = this.posicionMundo(x, y);
    this.destinoCamara.set(wx, 0, wz);
    if (inmediato) {
      this.objetivoCamara.copy(this.destinoCamara);
      this.posicionarCamaraIsometrica();
    }
  }

  /** Avanza el estado dependiente del tiempo (por ahora, la persecución de cámara). */
  actualizar(dt: number) {
    const factor = 1 - Math.exp(-8 * dt);
    this.objetivoCamara.lerp(this.destinoCamara, factor);
    this.posicionarCamaraIsometrica();
  }

  resize(ancho: number, alto: number) {
    this.renderer.setSize(ancho, alto, false);
    this.labelRenderer.setSize(ancho, alto);
    const aspecto = ancho / alto;
    const mitad = TAMANO_MUNDO_VISIBLE / 2;
    this.camera.left = -mitad * aspecto;
    this.camera.right = mitad * aspecto;
    this.camera.top = mitad;
    this.camera.bottom = -mitad;
    this.camera.updateProjectionMatrix();
  }

  /** Coordenadas del servidor (x,y en plano top-down) -> plano XZ de Three (Y es la altura). */
  private posicionMundo(x: number, y: number): [number, number] {
    return [x, y]; // el servidor ya habla en casillas: 1 casilla = 1 unidad de mundo
  }

  añadirEntidad(idEntidad: string, objeto: THREE.Object3D, x: number, y: number, etiqueta?: string) {
    this.quitarEntidad(idEntidad);
    const [wx, wz] = this.posicionMundo(x, y);
    objeto.position.x = wx;
    objeto.position.z = wz;

    if (etiqueta) {
      const div = document.createElement("div");
      div.textContent = etiqueta;
      div.style.color = "#ffffff";
      div.style.fontSize = "12px";
      div.style.fontFamily = "sans-serif";
      div.style.textShadow = "0 1px 2px rgba(0,0,0,0.8)";
      const label = new CSS2DObject(div);
      label.position.set(0, 1.85, 0);
      objeto.add(label);
    }

    this.entidades.set(idEntidad, objeto);
    this.scene.add(objeto);
  }

  moverEntidad(idEntidad: string, x: number, y: number) {
    const objeto = this.entidades.get(idEntidad);
    if (!objeto) return;
    const [wx, wz] = this.posicionMundo(x, y);
    objeto.position.x = wx;
    objeto.position.z = wz;
  }

  quitarEntidad(idEntidad: string) {
    const objeto = this.entidades.get(idEntidad);
    if (!objeto) return;
    this.scene.remove(objeto);
    this.entidades.delete(idEntidad);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
