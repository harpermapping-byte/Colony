/**
 * Panel de la mesa de planos — Ingeniero legendario
 * (docs/GDD_Ropa_Procedural.md §Ingeniero legendario). MISMO patrón visual
 * que `panelSastreLegendario.ts`/`panelCarpinteroLegendario.ts` (textarea,
 * Generar/Regenerar, preview 3D real, Aceptar, "Mis proyectos"). Alcance
 * reducido a propósito: aquí NO hay "tallar copia" ni item físico — el
 * proyecto queda persistente y listable, colocarlo en el mundo es backlog
 * documentado (ver GDD).
 */
import * as THREE from "three";
import { interpretarPromptEdificio, type ResultadoInterpretacionEdificio } from "../render3d/interpretarPromptEdificio";
import { generarEdificioVoxel } from "../render3d/generarEdificioVoxel";
import { mallaDeVoxeles } from "../render3d/voxelMalla";

const LADO_PREVIEW_PX = 220;
const NOMBRES_TIPO: Record<string, string> = { casa_humilde: "Casa Humilde", casa_noble: "Casa Noble", tienda: "Tienda", taberna: "Taberna" };

export interface ProyectoIngeniero {
  id: number;
  tipoEdificio: string;
  nombre: string;
  creadoEn: string;
}

export interface OpcionesPanelIngenieroLegendario {
  contenedor: HTMLElement;
  aceptar(construccionId: number, texto: string, nombre: string): void;
  pedirMisDisenos(): void;
}

export class PanelIngenieroLegendario {
  private raiz: HTMLDivElement;
  private construccionId: number | null = null;
  private texto = "";
  private nombre = "";
  private colorAcento = "";
  private preview: ResultadoInterpretacionEdificio | null = null;
  private disenos: ProyectoIngeniero[] = [];
  private error = "";

  private previewDiv: HTMLDivElement;
  private previewRenderer: THREE.WebGLRenderer;
  private previewScene: THREE.Scene;
  private previewCamera: THREE.PerspectiveCamera;
  private previewMalla: THREE.Mesh | null = null;

  constructor(private opciones: OpcionesPanelIngenieroLegendario) {
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
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const luzDirigida = new THREE.DirectionalLight(0xffffff, 0.9);
    luzDirigida.position.set(3, 4, 3);
    this.previewScene.add(luzDirigida);

    this.previewCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 20);
    this.previewCamera.position.set(3, 2.4, 3);
    this.previewCamera.lookAt(0, 0.8, 0);

    const animar = () => {
      requestAnimationFrame(animar);
      if (this.construccionId === null) return;
      if (this.previewMalla) this.previewMalla.rotation.y += 0.01;
      this.previewRenderer.render(this.previewScene, this.previewCamera);
    };
    animar();
  }

  abrir(construccionId: number) {
    this.construccionId = construccionId;
    this.texto = "";
    this.nombre = "";
    this.colorAcento = "";
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

  private actualizarMalla3D() {
    this.limpiarMalla3D();
    if (!this.preview) return;
    const voxeles = generarEdificioVoxel({
      semilla: `previewEdificio:${this.construccionId ?? 0}`,
      forma: this.preview.forma,
      colorMaterial: this.preview.colorMaterial,
      colorTecho: this.preview.colorTecho,
      colorAcento: this.colorAcento || this.preview.colorAcento,
      balcon: this.preview.balcon,
      porche: this.preview.porche,
      ventanasGrandes: this.preview.ventanasGrandes,
    });
    const malla = mallaDeVoxeles(voxeles);
    if (!malla) return;
    malla.geometry.computeBoundingSphere();
    const esfera = malla.geometry.boundingSphere!;
    malla.position.sub(esfera.center);
    this.previewScene.add(malla);
    this.previewMalla = malla;
    const distancia = Math.max(1.5, (esfera.radius / Math.sin((this.previewCamera.fov * Math.PI) / 360)) * 1.35);
    const direccion = new THREE.Vector3(0.75, 0.55, 0.75).normalize();
    this.previewCamera.position.copy(direccion.multiplyScalar(distancia));
    this.previewCamera.lookAt(0, 0, 0);
  }

  actualizarMisDisenos(disenos: ProyectoIngeniero[]) {
    this.disenos = disenos;
    if (this.construccionId !== null) this.render();
  }

  mostrarError(motivo: string) {
    if (this.construccionId === null) return;
    this.error = motivo;
    this.render();
  }

  confirmarCreado() {
    this.cerrar();
  }

  private generarPreview() {
    this.preview = interpretarPromptEdificio(this.texto);
    this.colorAcento = this.preview.colorAcento || this.colorAcento;
    this.error = "";
    this.actualizarMalla3D();
    this.render();
  }

  private render() {
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
    titulo.textContent = "📐 Mesa de planos — proyectar edificio legendario";
    this.raiz.appendChild(titulo);

    const descripcion = document.createElement("div");
    descripcion.style.opacity = "0.85";
    descripcion.style.marginBottom = "8px";
    descripcion.textContent = "Describe el edificio (tipo, material, forma, techo, balcón, porche, ventanas...). 1 proyecto nuevo cada 24h. Colocarlo en el mundo llegará más adelante — de momento queda guardado como tu diseño.";
    this.raiz.appendChild(descripcion);

    const inputTexto = document.createElement("textarea");
    inputTexto.value = this.texto;
    inputTexto.placeholder = "ej. casa noble de piedra con balcón y techo de teja";
    inputTexto.rows = 2;
    inputTexto.style.width = "100%";
    inputTexto.style.boxSizing = "border-box";
    inputTexto.style.margin = "4px 0";
    inputTexto.oninput = () => { this.texto = inputTexto.value; };
    this.raiz.appendChild(inputTexto);

    const inputNombre = document.createElement("input");
    inputNombre.value = this.nombre;
    inputNombre.placeholder = "Nombre del proyecto (opcional)";
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
      linea(`Tipo: ${NOMBRES_TIPO[this.preview.tipoEdificio] ?? this.preview.tipoEdificio}`);
      linea(`Material: ${this.preview.materialId}`);
      linea(`Forma: ${this.preview.forma}`);
      linea(`Techo: ${this.preview.techoId}`);
      const extras: string[] = [];
      if (this.preview.balcon) extras.push("balcón");
      if (this.preview.porche) extras.push("porche");
      if (this.preview.ventanasGrandes) extras.push("ventanas grandes");
      if (extras.length) linea(`Extras: ${extras.join(", ")}`);
      this.raiz.appendChild(caja);

      this.raiz.appendChild(this.previewDiv);

      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      fila.style.margin = "6px 0";
      const span = document.createElement("span");
      span.textContent = "Color de ventanas";
      fila.appendChild(span);
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = this.colorAcento || this.preview.colorAcento || "#bcdff0";
      colorInput.oninput = () => { this.colorAcento = colorInput.value; this.actualizarMalla3D(); };
      fila.appendChild(colorInput);
      this.raiz.appendChild(fila);

      const btnAceptar = document.createElement("button");
      btnAceptar.textContent = "✅ ¡Me gusta, proyectarlo!";
      btnAceptar.style.marginTop = "6px";
      btnAceptar.onclick = () => this.opciones.aceptar(this.construccionId!, this.texto, this.nombre);
      this.raiz.appendChild(btnAceptar);
    }

    if (this.disenos.length > 0) {
      const tituloDisenos = document.createElement("div");
      tituloDisenos.style.fontWeight = "bold";
      tituloDisenos.style.marginTop = "12px";
      tituloDisenos.textContent = "Mis proyectos";
      this.raiz.appendChild(tituloDisenos);
      for (const d of this.disenos) {
        const fila = document.createElement("div");
        fila.style.margin = "3px 0";
        fila.textContent = `${d.nombre} (${NOMBRES_TIPO[d.tipoEdificio] ?? d.tipoEdificio})`;
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
