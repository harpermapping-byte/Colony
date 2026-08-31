import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { estadoCiclo } from "./cicloDia";

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
  private ambiente!: THREE.AmbientLight;
  private sueloEmergencia!: THREE.Mesh;
  // dirección actual de la luz (la escribe el ciclo día/noche cada frame);
  // arranca en el ángulo fijo que tenía la escena antes del ciclo
  private direccionLuz = new THREE.Vector3(40, 60, 25).normalize();

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
    this.ambiente = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(this.ambiente);
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

  /** Avanza el estado dependiente del tiempo (persecución de cámara + ciclo día/noche + luz/suelo que siguen a la cámara). */
  actualizar(dt: number) {
    const factor = 1 - Math.exp(-8 * dt);
    this.objetivoCamara.lerp(this.destinoCamara, factor);
    this.posicionarCamaraIsometrica();
    // ciclo día/noche: el sol/la luna recorren el cielo con la hora de
    // juego (reloj de mundo determinista — GDD_Tiempo_Mundo.md). Son solo
    // asignaciones de números por frame: coste despreciable.
    const ciclo = estadoCiclo();
    this.direccionLuz.copy(ciclo.direccionLuz);
    this.sol.color.copy(ciclo.colorLuz);
    this.sol.intensity = ciclo.intensidadLuz;
    this.ambiente.intensity = ciclo.intensidadAmbiente;
    (this.scene.background as THREE.Color).copy(ciclo.colorCielo);
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
    // a lo largo de la dirección que marca el ciclo, a distancia fija del
    // objetivo — las sombras giran solas al moverse el astro
    const DISTANCIA_SOL = 75;
    this.sol.position.set(
      this.objetivoCamara.x + this.direccionLuz.x * DISTANCIA_SOL,
      this.direccionLuz.y * DISTANCIA_SOL,
      this.objetivoCamara.z + this.direccionLuz.z * DISTANCIA_SOL,
    );
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
      this.etiquetas.set(idEntidad, div);
    }

    // Barra de vida (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): oculta
    // hasta la primera llamada a `actualizarVida` (evita un rectángulo gris
    // vacío en entidades que aún no reportaron vida/vidaMax). Fondo oscuro
    // fijo + relleno de color que encoge/cambia de color con la vida.
    const fondo = document.createElement("div");
    fondo.style.width = "28px";
    fondo.style.height = "4px";
    fondo.style.background = "rgba(0,0,0,0.6)";
    fondo.style.border = "1px solid rgba(0,0,0,0.8)";
    fondo.style.display = "none";
    const relleno = document.createElement("div");
    relleno.style.height = "100%";
    relleno.style.width = "100%";
    relleno.style.background = "#4caf50";
    fondo.appendChild(relleno);
    const barra = new CSS2DObject(fondo);
    barra.position.set(0, 1.65, 0);
    objeto.add(barra);
    this.barrasVida.set(idEntidad, { fondo, relleno });

    this.entidades.set(idEntidad, objeto);
    this.scene.add(objeto);
  }

  private etiquetas = new Map<string, HTMLDivElement>();
  private barrasVida = new Map<string, { fondo: HTMLDivElement; relleno: HTMLDivElement }>();

  /** Actualiza la barra de vida flotante de una entidad — vidaMax<=0 la oculta (sin datos de combate todavía). */
  actualizarVida(idEntidad: string, vida: number, vidaMax: number) {
    const barra = this.barrasVida.get(idEntidad);
    if (!barra) return;
    if (vidaMax <= 0) {
      barra.fondo.style.display = "none";
      return;
    }
    barra.fondo.style.display = "block";
    const proporcion = Math.max(0, Math.min(1, vida / vidaMax));
    barra.relleno.style.width = `${proporcion * 100}%`;
    barra.relleno.style.background = proporcion > 0.5 ? "#4caf50" : proporcion > 0.25 ? "#e0b040" : "#d9453f";
  }

  /**
   * Cambia el texto de la etiqueta de una entidad — lo usan las burbujas de
   * pregón de los NPCs especiales ("¡Vendo melones!") alternando con el
   * nombre; en cursiva para que se distinga hablar de llamarse.
   */
  textoEtiqueta(idEntidad: string, texto: string, esGrito = false) {
    const div = this.etiquetas.get(idEntidad);
    if (!div) return;
    if (div.textContent !== texto) div.textContent = texto;
    div.style.fontStyle = esGrito ? "italic" : "normal";
    div.style.color = esGrito ? "#ffe9a8" : "#ffffff";
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
    // Bug real (encontrado probando companero:asignarTrabajo, docs/GDD_
    // Produccion.md §3bis): CSS2DRenderer NUNCA quita del DOM el <div> de un
    // CSS2DObject solo porque su Object3D padre salga de la escena — deja de
    // TRAVERSARLO, pero el elemento ya insertado en labelRenderer.domElement
    // se queda huérfano para siempre (el nombre flotante "sobrevivía" a la
    // entidad). Hay que sacarlo del DOM explícitamente aquí.
    this.etiquetas.get(idEntidad)?.remove();
    this.etiquetas.delete(idEntidad);
    this.barrasVida.get(idEntidad)?.fondo.remove();
    this.barrasVida.delete(idEntidad);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
