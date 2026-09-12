import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { estadoCiclo } from "./cicloDia";
import { EfectosClima } from "./climaVisual";
import { EfectosClimaPantalla } from "./climaPantalla";

// Niebla/viento (docs/GDD_Clima.md, pedido del streamer: "que vea peor,
// pero que vea, una pequeña molestia — máximo 10/20% de opacidad, nunca
// tapar la pantalla"). CORREGIDO 2026-09-01: `THREE.Fog` satura a color
// SÓLIDO a partir de `far` (por diseño, no es una capa translúcida) — con
// un mapa isométrico grande eso tapaba la pantalla entera. Se sustituye
// por una capa 2D fija sobre el lienzo (`overlayClima`, DOM plano, mismo
// patrón que el `CSS2DRenderer` de las etiquetas): opacidad CONSTANTE,
// nunca depende de la profundidad de lo que haya detrás, así jamás llega
// a taparlo del todo por mucho que se aleje la cámara.
const OPACIDAD_POR_CLIMA: Record<string, number> = {
  niebla: 0.55,
  viento: 0.22, // el viento se nota sobre todo por el polvo moviéndose (climaVisual.ts), esta capa es solo un toque
};

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
  private readonly efectosClima: EfectosClima;
  private readonly efectosClimaPantalla: EfectosClimaPantalla;
  private readonly overlayClima: HTMLDivElement;
  /** Último clima resuelto (docs/GDD_Clima.md) — expuesto de solo lectura para depuración/tests, mismo criterio que el resto de sondas `window.__*`. */
  climaActual = "";

  constructor(contenedor: HTMLElement, ancho: number, alto: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // resize() llama a setSize(..., false) para NO dejar que Three fije el
    // tamaño CSS del canvas (solo la resolución interna) — sin este CSS
    // explícito, un <canvas> con solo el atributo width/height puesto (sin
    // style) se renderiza a TAMAÑO INTRÍNSECO = esos píxeles tal cual, que
    // con devicePixelRatio>1 (cualquier escalado de Windows por encima del
    // 100%, muy habitual) es más grande que el contenedor real — el navegador
    // recorta con el overflow:hidden del contenedor y solo se ve la esquina
    // superior-izquierda de un lienzo más grande, así que el jugador (bien
    // centrado DENTRO de ese lienzo) aparece desplazado hacia abajo-derecha
    // en la pantalla real. Bug real reportado jugando 2026-09-09 ("el pj
    // está abajo a la derecha, el nombre sí centrado" — el nombre usa
    // labelRenderer, que SÍ fija su propio style.width/height más abajo).
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
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

    // Niebla/viento (docs/GDD_Clima.md): capa 2D lisa por ENCIMA del lienzo
    // 3D pero por DEBAJO de las etiquetas (insertBefore) — nunca satura a
    // sólido como hacía THREE.Fog. Degradado RADIAL (pedido del streamer:
    // "el centro nítido, hacia los bordes más niebla, que se note") —
    // `ellipse farthest-side` (no `circle farthest-corner`) para que el
    // degradado llegue a tope en los 4 bordes por igual, no solo en las
    // esquinas; el tramo central (0-22%) se deja del todo transparente y
    // el resto sube fuerte para que se note de verdad. `style.opacity`
    // (ver actualizar()) escala el degradado ENTERO según el clima, así
    // el centro se queda siempre despejado sin importar la intensidad.
    this.overlayClima = document.createElement("div");
    Object.assign(this.overlayClima.style, {
      position: "absolute", top: "0", left: "0", right: "0", bottom: "0",
      background: "radial-gradient(ellipse farthest-side at center, rgba(210,222,228,0) 0%, rgba(210,222,228,0) 22%, rgba(210,222,228,0.75) 78%, rgba(210,222,228,1) 100%)",
      opacity: "0", pointerEvents: "none", transition: "opacity 1.5s linear",
    });
    contenedor.insertBefore(this.overlayClima, this.labelRenderer.domElement);

    // Lluvia/nieve como overlay 2D screen-space (docs/GDD_Clima.md,
    // climaPantalla.ts) — insertado DESPUÉS de la niebla y ANTES de las
    // etiquetas (insertBefore labelRenderer, mismo patrón que overlayClima
    // arriba), así el orden final de atrás hacia adelante queda: [canvas 3D]
    // [overlayClima niebla] [canvas 2D lluvia/nieve] [labelRenderer
    // nombres/vida] — los nombres siempre legibles por encima de la lluvia.
    this.efectosClimaPantalla = new EfectosClimaPantalla(contenedor, this.labelRenderer.domElement);

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

    this.efectosClima = new EfectosClima(this.scene);

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

    this.climaActual = ciclo.clima;
    // Niebla/viento: capa 2D de opacidad fija (docs/GDD_Clima.md, "que vea
    // peor, pero que vea" — 10/20% como mucho); el resto de climas la dejan
    // en 0 (transparente del todo).
    this.overlayClima.style.opacity = String(OPACIDAD_POR_CLIMA[ciclo.clima] ?? 0);
    // Lluvia/nieve: overlay 2D screen-space, mismo `ciclo.clima` que ya lee
    // overlayClima/efectosClima — sin rAF propio, dibuja dentro de este
    // mismo `actualizar()` (canvas 2D no necesita un paso de "presentar"
    // separado como WebGL).
    this.efectosClimaPantalla.actualizar(dt, ciclo.clima);
    // Polvo/charcos, siempre centrados en lo que la cámara está mirando
    // (objetivoCamara, no la posición de la cámara isométrica en sí) —
    // nunca fijos en coordenadas de mundo.
    this.efectosClima.actualizar(dt, ciclo.clima, this.objetivoCamara);
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
    this.efectosClimaPantalla.resize(ancho, alto);
    const aspecto = ancho / alto;
    const mitad = TAMANO_MUNDO_VISIBLE / 2;
    this.camera.left = -mitad * aspecto;
    this.camera.right = mitad * aspecto;
    this.camera.top = mitad;
    this.camera.bottom = -mitad;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Calidad gráfica (docs/GDD_Ajustes.md, pedido streamer 2026-09-09) —
   * "alta" es EXACTAMENTE el valor fijo que el constructor ya usaba
   * (cero cambio si nadie toca el ajuste). "baja" apaga sombras (coste real
   * medido en varias pasadas de rendimiento de esta sesión, CLAUDE.md) y
   * limita el pixel ratio a 1 — ambos cambiables en caliente sin recrear el
   * renderer. `antialias` NO se incluye: solo se puede fijar al construir
   * el `WebGLRenderer`, cambiarlo exigiría reconstruir toda la escena.
   */
  fijarCalidadGrafica(nivel: "baja" | "media" | "alta") {
    const pixelRatioMax = nivel === "alta" ? 2 : nivel === "media" ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioMax));
    this.renderer.shadowMap.enabled = nivel !== "baja";
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

  private readonly etiquetasInteractivas = new Map<string, { objeto: CSS2DObject; div: HTMLDivElement }>();

  /**
   * Etiqueta flotante CLICABLE, suelta en coordenadas de mundo — pensada
   * para "Entrar <Nombre>" sobre una puerta física bakeada
   * (docs/GDD_Sistema_Puertas.md, pedido streamer: "puerta física clicable
   * -> entrar a la instancia"). A diferencia de `añadirEntidad` (personajes:
   * nombre + barra de vida colgando de un rig que se mueve), esto es un
   * único `CSS2DObject` fijo, sin ningún `Object3D` "dueño" — se crea
   * OCULTA y el llamador decide cuándo mostrarla según la distancia real
   * del jugador local (mismo criterio "sin UI de targeting" que el resto
   * del juego, ver `hintAsiento` en game.ts).
   *
   * El div hijo lleva `pointerEvents:"auto"` A PROPÓSITO: `labelRenderer`
   * (el contenedor raíz de TODAS las etiquetas CSS2D) es
   * `pointerEvents:"none"` para no bloquear el raycast de clic sobre el
   * mundo 3D — pero un hijo puede reactivar `pointer-events` sin afectar al
   * resto del árbol (CSS estándar, no un truco propio de Three.js).
   * Verificado con un e2e real de Playwright (`page.mouse.click` sobre la
   * etiqueta en pantalla, nunca invocando el handler a mano) — no se dio
   * por bueno solo porque "debería funcionar" en teoría.
   *
   * DOS BUGS REALES encontrados con ese mismo e2e antes de dar esto por
   * bueno (ninguno se hubiera visto solo con `tsc`/tests unitarios):
   *
   * 1) `render()` de `CSS2DRenderer` reescribe `element.style.display` en
   *    CADA frame según su PROPIO criterio de profundidad/capa — pisando
   *    cualquier `div.style.display` puesto a mano desde fuera en cuanto
   *    llega el siguiente frame. Por eso `mostrarEtiquetaInteractiva`
   *    alterna `div.style.visibility` (que `CSS2DRenderer` JAMÁS toca),
   *    nunca `div.style.display`.
   *
   * 2) Poner `objeto.visible = false` (la propiedad del propio
   *    `CSS2DObject`, NO la del div) para "crearla oculta" fue la primera
   *    versión de este código y estaba MAL: `renderObject()` mira
   *    `object.visible===false` ANTES que nada y, si es `false`, hace
   *    `hideObject()` y `return` sin llegar NUNCA a la línea que insertó el
   *    `<div>` en el DOM (`domElement.appendChild(element)`) — así que el
   *    elemento no existía en el documento en absoluto hasta la primera vez
   *    que se marcara visible, y un test que esperase "en el DOM aunque
   *    oculta" (`state:"attached"`) nunca lo encontraba. `objeto.visible`
   *    se deja SIEMPRE en su valor por defecto (`true`) — el filtro de
   *    "visible" real de `renderObject()` solo mira la PROFUNDIDAD
   *    proyectada (`_vector.z`), nunca los límites X/Y de pantalla, así que
   *    un objeto lejos del jugador se sigue insertando en el DOM igual
   *    (solo con un `transform` que lo coloca fuera de la vista) — el div
   *    queda SIEMPRE adjunto, y `visibility:hidden/visible` decide de
   *    verdad si se ve y si es clicable (un elemento `visibility:hidden` no
   *    recibe eventos de puntero, exactamente el comportamiento que hacía
   *    falta).
   */
  añadirEtiquetaInteractiva(id: string, x: number, y: number, alturaY: number, texto: string, onClick: () => void) {
    this.quitarEtiquetaInteractiva(id);
    const [wx, wz] = this.posicionMundo(x, y);
    const div = document.createElement("div");
    div.textContent = texto;
    div.dataset.testid = id;
    div.style.cssText =
      "background:rgba(20,16,10,0.85);color:#f0e8d8;font:13px sans-serif;padding:4px 10px;border-radius:6px;border:1px solid #6a5a3a;white-space:nowrap;pointer-events:auto;cursor:pointer;visibility:hidden;";
    div.addEventListener("click", (e) => {
      e.stopPropagation(); // no debe colar el clic al raycast del lienzo detrás (menú de interacción, construcción...)
      onClick();
    });
    const objeto = new CSS2DObject(div);
    objeto.position.set(wx, alturaY, wz);
    this.scene.add(objeto);
    this.etiquetasInteractivas.set(id, { objeto, div });
  }

  /** Muestra/oculta una etiqueta interactiva ya creada (sin reconstruirla) — pensado para llamarse a ritmo bajo (500ms) según distancia, no en cada frame. Alterna `div.style.visibility`, NUNCA `div.style.display` ni `objeto.visible` (ver comentario de `añadirEtiquetaInteractiva`). */
  mostrarEtiquetaInteractiva(id: string, visible: boolean) {
    const e = this.etiquetasInteractivas.get(id);
    if (e) e.div.style.visibility = visible ? "visible" : "hidden";
  }

  quitarEtiquetaInteractiva(id: string) {
    const e = this.etiquetasInteractivas.get(id);
    if (!e) return;
    this.scene.remove(e.objeto);
    e.div.remove(); // mismo motivo que quitarEntidad: CSS2DRenderer no lo saca solo del DOM al quitar el Object3D de la escena
    this.etiquetasInteractivas.delete(id);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
