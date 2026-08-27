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
  private sol!: THREE.DirectionalLight;
  private sueloEmergencia!: THREE.Mesh;

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
    this.sol = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sol.castShadow = true;
    // La caja de sombra NO abarca el mapa (el principal mide 3200 casillas
    // — imposible): es una caja de ±48 unidades que SIGUE al objetivo de la
    // cámara (ver actualizar()), sobrando para todo lo visible en pantalla.
    this.sol.shadow.camera.left = -48;
    this.sol.shadow.camera.right = 48;
    this.sol.shadow.camera.top = 48;
    this.sol.shadow.camera.bottom = -48;
    this.sol.shadow.camera.far = 300;
    this.sol.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sol, this.sol.target);
    this.reposicionarSol();

    // Suelo de emergencia MUY por debajo del terreno real (que añade
    // `terreno.ts` como estático): solo se ve si el mapa no carga, para que
    // el fallo sea visible en vez de un vacío negro confuso.
    this.sueloEmergencia = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x2d3748 }),
    );
    this.sueloEmergencia.rotation.x = -Math.PI / 2;
    // por debajo del lecho del agua (-1.5, ver sectorVisual.ts): si
    // estuviera a ras de suelo taparía el fondo translúcido y al PJ buceando
    this.sueloEmergencia.position.y = -3;
    this.scene.add(this.sueloEmergencia);

    this.resize(ancho, alto);
  }

  /** Añade geometría estática del mundo (terreno, props bakeados) — no es una entidad con id. */
  añadirEstatico(objeto: THREE.Object3D) {
    this.scene.add(objeto);
  }

  /** Quita geometría estática (un sector soltado por el streaming) — liberar GPU es cosa del llamador. */
  quitarEstatico(objeto: THREE.Object3D) {
    this.scene.remove(objeto);
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

  /** Avanza el estado dependiente del tiempo (persecución de cámara + luz/suelo que la siguen). */
  actualizar(dt: number) {
    const factor = 1 - Math.exp(-8 * dt);
    this.objetivoCamara.lerp(this.destinoCamara, factor);
    this.posicionarCamaraIsometrica();
    this.reposicionarSol();
  }

  /**
   * El sol (y su caja de sombra) y el suelo de emergencia acompañan al
   * objetivo de la cámara — en un mapa de 3200 casillas ninguno puede ser
   * global: las sombras solo existen alrededor de lo visible y el suelo de
   * emergencia siempre queda debajo del jugador si el mapa fallara.
   */
  private reposicionarSol() {
    if (!this.sol) return;
    this.sol.position.set(this.objetivoCamara.x + 40, 60, this.objetivoCamara.z + 25);
    this.sol.target.position.set(this.objetivoCamara.x, 0, this.objetivoCamara.z);
    if (this.sueloEmergencia) {
      this.sueloEmergencia.position.x = this.objetivoCamara.x;
      this.sueloEmergencia.position.z = this.objetivoCamara.z;
    }
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
