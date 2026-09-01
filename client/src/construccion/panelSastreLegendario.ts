/**
 * Panel del telar — Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre
 * legendario, pedido 2026-08-31): "le saldrá una pantallita con el
 * generador, los patrones a poner o elegir el color y el nombre, y podrá
 * elegir si ese que salió le gusta o si vuelve a generar". Mismo patrón DOM
 * flotante que `panelCofre.ts`, MÁS una vista previa 3D real (pedido
 * 2026-08-31, ronda 2: "en el bakeador debe verse una preview de la ropa
 * generada") — reusa el MISMO generador que pinta la ropa puesta en el
 * mundo (`generarPrendaVoxel`/`mallaDeVoxeles`), solo que aquí la malla
 * fusionada se cuelga sola en una escena Three.js pequeña y aislada dentro
 * del panel, girando, en vez de colgada de un pivote del rig. `interpretarPromptTejido`
 * (puerto TS, client/src/render3d/interpretarPrompt.ts) corre 100% en el
 * cliente y es determinista, así que "Generar" es instantáneo y gratis — el
 * servidor SIEMPRE reinterpreta el mismo texto por su cuenta al aceptar
 * (nunca se envían los parámetros calculados aquí como si fueran definitivos).
 */
import * as THREE from "three";
import prendasJson from "../../../ropa/catalogo/prendas.json";
import materialesJson from "../../../interiores/catalogo/materiales.json";
import { interpretarPromptTejido, type ResultadoInterpretacion } from "../render3d/interpretarPrompt";
import { generarPrendaVoxel } from "../render3d/generarPrendaVoxel";
import { mallaDeVoxeles } from "../render3d/voxelMalla";

const PRENDAS = prendasJson as Record<string, any>;
const MATERIALES = materialesJson as unknown as Record<string, { colorDebug: string }>;
const LADO_PREVIEW_PX = 220;

const NOMBRES_TIPO: Record<string, string> = { camisa: "Camisa/Túnica", pantalon: "Pantalón/Calzas", gorro: "Gorro/Sombrero" };
const NOMBRES_MATERIAL: Record<string, string> = { lino: "Lino", lana: "Lana", seda: "Seda", cuero: "Cuero" };
const NOMBRES_DETALLE: Record<string, string> = {
  cuello: "Cuello", mangas: "Mangas", bajo: "Bajo", corte: "Corte", cinturon: "Cinturón", borde: "Borde", forma: "Forma",
};

export interface DisenoSastre {
  id: number;
  prendaBaseId: string;
  materialId: string;
  nombre: string;
  creadoEn: string;
}

export interface OpcionesPanelSastreLegendario {
  contenedor: HTMLElement;
  aceptar(construccionId: number, texto: string, tintes: Record<string, string>, nombre: string): void;
  craftearCopia(construccionId: number, prendaGeneradaId: number): void;
  pedirMisDisenos(): void;
}

export class PanelSastreLegendario {
  private raiz: HTMLDivElement;
  private construccionId: number | null = null;
  private texto = "";
  private nombre = "";
  private tintes: Record<string, string> = {};
  private preview: ResultadoInterpretacion | null = null;
  private disenos: DisenoSastre[] = [];
  private error = "";

  // Vista previa 3D — contenedor/escena PERSISTENTES (creados una sola vez
  // en el constructor, nunca dentro del subárbol que `render()` destruye
  // con innerHTML="") para no perder el contexto WebGL ni reabrir un
  // renderer nuevo en cada tecla — se desengancha del DOM antes de limpiar
  // `raiz` y se vuelve a enganchar donde toque en cada `render()`.
  private previewDiv: HTMLDivElement;
  private previewRenderer: THREE.WebGLRenderer;
  private previewScene: THREE.Scene;
  private previewCamera: THREE.PerspectiveCamera;
  private previewMalla: THREE.Mesh | null = null;

  constructor(private opciones: OpcionesPanelSastreLegendario) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "50%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = "rgba(18,14,10,0.96)";
    this.raiz.style.color = "#f0e4c8";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "14px 16px";
    this.raiz.style.borderRadius = "8px";
    this.raiz.style.border = "1px solid #8a6a2a";
    this.raiz.style.minWidth = "280px";
    this.raiz.style.maxWidth = "340px";
    this.raiz.style.maxHeight = "80vh";
    this.raiz.style.overflowY = "auto";
    this.raiz.style.display = "none";
    this.raiz.style.zIndex = "50";
    opciones.contenedor.appendChild(this.raiz);

    this.previewDiv = document.createElement("div");
    this.previewDiv.style.width = `${LADO_PREVIEW_PX}px`;
    this.previewDiv.style.height = `${LADO_PREVIEW_PX}px`;
    this.previewDiv.style.margin = "6px auto";
    this.previewDiv.style.borderRadius = "6px";
    this.previewDiv.style.overflow = "hidden";
    this.previewDiv.style.border = "1px solid #5a4a2a";

    this.previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.previewRenderer.setSize(LADO_PREVIEW_PX, LADO_PREVIEW_PX);
    this.previewDiv.appendChild(this.previewRenderer.domElement);

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color("#241c14");
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const luzDirigida = new THREE.DirectionalLight(0xffffff, 0.9);
    luzDirigida.position.set(2, 3, 2);
    this.previewScene.add(luzDirigida);

    this.previewCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 10);
    this.previewCamera.position.set(0.55, 0.35, 0.55);
    this.previewCamera.lookAt(0, 0, 0);

    // Bucle de giro lento — solo hace algo (y renderiza) mientras el panel
    // esté realmente abierto, para no gastar nada de fondo el resto del tiempo.
    const animar = () => {
      requestAnimationFrame(animar);
      if (this.construccionId === null) return;
      if (this.previewMalla) this.previewMalla.rotation.y += 0.012;
      this.previewRenderer.render(this.previewScene, this.previewCamera);
    };
    animar();
  }

  abrir(construccionId: number) {
    this.construccionId = construccionId;
    this.texto = "";
    this.nombre = "";
    this.tintes = {};
    this.preview = null;
    this.error = "";
    this.limpiarMalla3D();
    this.opciones.pedirMisDisenos();
    this.render();
  }

  cerrar() {
    this.construccionId = null;
    this.raiz.style.display = "none";
  }

  private limpiarMalla3D() {
    if (!this.previewMalla) return;
    this.previewScene.remove(this.previewMalla);
    this.previewMalla.geometry.dispose();
    this.previewMalla = null;
  }

  /** Regenera la malla 3D de la vista previa a partir de `this.preview`/`this.tintes` actuales — llamado tras Generar/Regenerar y tras cambiar cualquier color. */
  private actualizarMalla3D() {
    this.limpiarMalla3D();
    if (!this.preview) return;
    const base = PRENDAS[this.preview.prendaBaseId];
    const materialEntrada = MATERIALES[this.preview.materialId];
    if (!base || !materialEntrada) return;
    const voxeles = generarPrendaVoxel(base, materialEntrada, {
      semilla: `preview:${this.construccionId ?? 0}`,
      prendaId: this.preview.prendaBaseId,
      materialId: this.preview.materialId,
      detalleOverride: this.preview.detalle,
      tintes: this.tintes,
    });
    const malla = mallaDeVoxeles(voxeles);
    if (!malla) return;
    // Centrado: los vóxeles vienen posicionados relativos al pivote del rig
    // (hombro/cadera/cabeza), no al centro de su propia caja — sin esto la
    // prenda saldría descuadrada del encuadre de la cámara fija.
    malla.geometry.computeBoundingSphere();
    const esfera = malla.geometry.boundingSphere!;
    malla.position.sub(esfera.center);
    this.previewScene.add(malla);
    this.previewMalla = malla;
    // Encuadre dinámico: camisa/pantalón/gorro tienen tamaños MUY distintos
    // (una manga extendida suma bastante más que un gorro) — la distancia
    // de la cámara se recalcula cada vez a partir del radio real de la
    // malla, con margen, en vez de una distancia fija que solo cuadraba con
    // una prenda de referencia.
    const distancia = Math.max(0.35, (esfera.radius / Math.sin((this.previewCamera.fov * Math.PI) / 360)) * 1.35);
    const direccion = new THREE.Vector3(0.55, 0.35, 0.55).normalize();
    this.previewCamera.position.copy(direccion.multiplyScalar(distancia));
    this.previewCamera.lookAt(0, 0, 0);
  }

  actualizarMisDisenos(disenos: DisenoSastre[]) {
    this.disenos = disenos;
    if (this.construccionId !== null) this.render();
  }

  /** Refleja `sastre:error` — solo si el panel está abierto (llegó de este intento). */
  mostrarError(motivo: string) {
    if (this.construccionId === null) return;
    this.error = motivo;
    this.render();
  }

  /** Refleja `sastre:tejerResultado` — cierra el panel, el jugador ya la tiene en el inventario. */
  confirmarCreada() {
    this.cerrar();
  }

  private generarPreview() {
    this.preview = interpretarPromptTejido(this.texto);
    // Los colores explícitos que el jugador YA había elegido para zonas que
    // siguen existiendo en el nuevo arquetipo se mantienen; los de un
    // arquetipo distinto (cambió de camisa a pantalón, p.ej.) se descartan.
    const zonas = PRENDAS[this.preview.prendaBaseId]?.zonasColor ?? [];
    const nuevosTintes: Record<string, string> = {};
    for (const zona of zonas) nuevosTintes[zona] = this.tintes[zona] ?? this.preview.colorHint ?? "";
    this.tintes = nuevosTintes;
    this.error = "";
    this.actualizarMalla3D();
    this.render();
  }

  private render() {
    // Desenganchar el canvas de la vista previa ANTES de limpiar `raiz` —
    // innerHTML="" destruiría el nodo (y su contexto WebGL) si siguiera
    // dentro; así el MISMO renderer sobrevive de un render() al siguiente.
    this.previewDiv.remove();
    this.raiz.innerHTML = "";
    if (this.construccionId === null) {
      this.raiz.style.display = "none";
      return;
    }
    this.raiz.style.display = "block";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "8px";
    titulo.textContent = "🧵 Telar — tejer prenda legendaria";
    this.raiz.appendChild(titulo);

    const descripcion = document.createElement("div");
    descripcion.style.opacity = "0.85";
    descripcion.style.marginBottom = "8px";
    descripcion.textContent = "Describe la prenda con palabras (tipo, corte, material, color, estilo...). 1 diseño nuevo cada 24h — luego puedes craftear copias cuando quieras.";
    this.raiz.appendChild(descripcion);

    const inputTexto = document.createElement("textarea");
    inputTexto.value = this.texto;
    inputTexto.placeholder = "ej. túnica noble de seda púrpura con manga larga";
    inputTexto.rows = 2;
    inputTexto.style.width = "100%";
    inputTexto.style.boxSizing = "border-box";
    inputTexto.style.margin = "4px 0";
    inputTexto.oninput = () => { this.texto = inputTexto.value; };
    this.raiz.appendChild(inputTexto);

    const inputNombre = document.createElement("input");
    inputNombre.value = this.nombre;
    inputNombre.placeholder = "Nombre de la prenda (opcional)";
    inputNombre.style.width = "100%";
    inputNombre.style.boxSizing = "border-box";
    inputNombre.style.margin = "4px 0";
    inputNombre.oninput = () => { this.nombre = inputNombre.value; };
    this.raiz.appendChild(inputNombre);

    const filaBotones = document.createElement("div");
    filaBotones.style.margin = "6px 0";
    const btnGenerar = document.createElement("button");
    btnGenerar.textContent = this.preview ? "🔄 Regenerar vista previa" : "Generar vista previa";
    btnGenerar.style.marginRight = "6px";
    btnGenerar.onclick = () => this.generarPreview();
    filaBotones.appendChild(btnGenerar);
    this.raiz.appendChild(filaBotones);

    if (this.error) {
      const err = document.createElement("div");
      err.style.color = "#e08080";
      err.style.margin = "4px 0";
      err.textContent = this.error;
      this.raiz.appendChild(err);
    }

    if (this.preview) {
      const base = PRENDAS[this.preview.prendaBaseId];
      const caja = document.createElement("div");
      caja.style.background = "rgba(255,255,255,0.06)";
      caja.style.borderRadius = "6px";
      caja.style.padding = "8px";
      caja.style.margin = "6px 0";

      const linea = (texto: string) => {
        const d = document.createElement("div");
        d.textContent = texto;
        caja.appendChild(d);
      };
      linea(`Tipo: ${NOMBRES_TIPO[base.tipoPrenda] ?? base.tipoPrenda}`);
      linea(`Material: ${NOMBRES_MATERIAL[this.preview.materialId] ?? this.preview.materialId}`);
      for (const [campo, valor] of Object.entries(this.preview.detalle)) {
        if (valor == null || valor === false) continue;
        linea(`${NOMBRES_DETALLE[campo] ?? campo}: ${valor === true ? "sí" : String(valor)}`);
      }
      this.raiz.appendChild(caja);

      // Vista previa 3D real (pedido 2026-08-31, ronda 2) — MISMO nodo
      // reenganchado cada vez, ver comentario de `render()` arriba.
      this.raiz.appendChild(this.previewDiv);

      const zonas: string[] = base.zonasColor ?? [];
      if (zonas.length > 0) {
        const filaColores = document.createElement("div");
        filaColores.style.display = "flex";
        filaColores.style.flexWrap = "wrap";
        filaColores.style.gap = "8px";
        filaColores.style.margin = "6px 0";
        for (const zona of zonas) {
          const grupo = document.createElement("label");
          grupo.style.display = "flex";
          grupo.style.alignItems = "center";
          grupo.style.gap = "4px";
          const span = document.createElement("span");
          span.textContent = zona;
          grupo.appendChild(span);
          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.value = this.tintes[zona] || "#a08060";
          // Cambiar un color actualiza la malla 3D EN VIVO, sin tener que
          // pulsar Regenerar — no llama a this.render() (no hace falta
          // reconstruir el DOM entero por un color).
          colorInput.oninput = () => { this.tintes[zona] = colorInput.value; this.actualizarMalla3D(); };
          grupo.appendChild(colorInput);
          filaColores.appendChild(grupo);
        }
        this.raiz.appendChild(filaColores);
      }

      const btnAceptar = document.createElement("button");
      btnAceptar.textContent = "✅ ¡Me gusta, tejerla!";
      btnAceptar.style.marginTop = "6px";
      btnAceptar.onclick = () => this.opciones.aceptar(this.construccionId!, this.texto, this.tintes, this.nombre);
      this.raiz.appendChild(btnAceptar);
    }

    if (this.disenos.length > 0) {
      const tituloDisenos = document.createElement("div");
      tituloDisenos.style.fontWeight = "bold";
      tituloDisenos.style.marginTop = "12px";
      tituloDisenos.textContent = "Mis diseños (craftear copia)";
      this.raiz.appendChild(tituloDisenos);
      for (const d of this.disenos) {
        const fila = document.createElement("div");
        fila.style.display = "flex";
        fila.style.justifyContent = "space-between";
        fila.style.alignItems = "center";
        fila.style.gap = "8px";
        fila.style.margin = "3px 0";
        const etiqueta = document.createElement("span");
        etiqueta.textContent = `${d.nombre} (${NOMBRES_MATERIAL[d.materialId] ?? d.materialId})`;
        fila.appendChild(etiqueta);
        const btn = document.createElement("button");
        btn.textContent = "Craftear copia";
        btn.onclick = () => this.opciones.craftearCopia(this.construccionId!, d.id);
        fila.appendChild(btn);
        this.raiz.appendChild(fila);
      }
    }

    const btnCerrar = document.createElement("button");
    btnCerrar.textContent = "Cerrar";
    btnCerrar.style.marginTop = "10px";
    btnCerrar.onclick = () => this.cerrar();
    this.raiz.appendChild(btnCerrar);
  }
}
