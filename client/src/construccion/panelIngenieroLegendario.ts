/**
 * Panel de la mesa de planos — Ingeniero legendario
 * (docs/GDD_Ropa_Procedural.md §Ingeniero legendario). MISMO patrón visual
 * que `panelSastreLegendario.ts`/`panelCarpinteroLegendario.ts` (textarea,
 * Generar/Regenerar, preview 3D real, Aceptar, "Mis proyectos"). Alcance
 * reducido a propósito: aquí NO hay "tallar copia" ni item físico — el
 * proyecto queda persistente y listable, colocarlo en el mundo es backlog
 * documentado (ver GDD).
 *
 * Chrome visual migrado al marco compartido (pedido streamer 2026-09-09,
 * "TODA pantalla... debe salir así con esta estética") — mismo criterio que
 * los otros dos legendarios: X/clic-fuera/Escape los da `crearMarcoPanel`,
 * el botón "Cerrar" casero se retira por redundante.
 */
import * as THREE from "three";
import { interpretarPromptEdificio, type ResultadoInterpretacionEdificio } from "../render3d/interpretarPromptEdificio";
import { generarEdificioVoxel } from "../render3d/generarEdificioVoxel";
import { mallaDeVoxeles } from "../render3d/voxelMalla";
import { crearMarcoPanel, crearBoton, crearInput, type MarcoPanel } from "../ui/panelBase";

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
  private readonly marco: MarcoPanel;
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
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Mesa de planos — proyectar edificio legendario", icono: "📐", left: "50%", top: "50%", ancho: "320px" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "80vh";
    // Mismo motivo que los otros dos legendarios: cerrar por CUALQUIER vía
    // también apaga `construccionId` para que el bucle de giro deje de
    // renderizar en cuanto el panel deja de estar realmente abierto.
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto()) this.construccionId = null;
    });

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
    this.marco.abrir();
    this.opciones.pedirMisDisenos();
    this.render();
  }

  cerrar() {
    this.construccionId = null;
    this.marco.cerrar();
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
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (this.construccionId === null) return;

    const descripcion = document.createElement("div");
    descripcion.style.opacity = "0.85";
    descripcion.style.marginBottom = "8px";
    descripcion.textContent = "Describe el edificio (tipo, material, forma, techo, balcón, porche, ventanas...). 1 proyecto nuevo cada 24h. Colocarlo en el mundo llegará más adelante — de momento queda guardado como tu diseño.";
    cuerpo.appendChild(descripcion);

    const inputTexto = document.createElement("textarea");
    inputTexto.className = "panel-colony-input";
    inputTexto.value = this.texto;
    inputTexto.placeholder = "ej. casa noble de piedra con balcón y techo de teja";
    inputTexto.rows = 2;
    inputTexto.style.width = "100%";
    inputTexto.style.boxSizing = "border-box";
    inputTexto.style.margin = "4px 0";
    inputTexto.oninput = () => { this.texto = inputTexto.value; };
    cuerpo.appendChild(inputTexto);

    const inputNombre = crearInput({ placeholder: "Nombre del proyecto (opcional)" });
    inputNombre.value = this.nombre;
    inputNombre.style.width = "100%";
    inputNombre.style.boxSizing = "border-box";
    inputNombre.style.margin = "4px 0";
    inputNombre.oninput = () => { this.nombre = inputNombre.value; };
    cuerpo.appendChild(inputNombre);

    const filaBotones = document.createElement("div");
    filaBotones.style.margin = "6px 0";
    const btnGenerar = crearBoton(this.preview ? "🔄 Regenerar vista previa" : "Generar vista previa", () => this.generarPreview());
    btnGenerar.style.marginRight = "6px";
    filaBotones.appendChild(btnGenerar);
    cuerpo.appendChild(filaBotones);

    if (this.error) {
      const err = document.createElement("div");
      err.className = "panel-colony-error";
      err.textContent = this.error;
      cuerpo.appendChild(err);
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
      cuerpo.appendChild(caja);

      cuerpo.appendChild(this.previewDiv);

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
      cuerpo.appendChild(fila);

      const btnAceptar = crearBoton("✅ ¡Me gusta, proyectarlo!", () => this.opciones.aceptar(this.construccionId!, this.texto, this.nombre));
      btnAceptar.style.marginTop = "6px";
      cuerpo.appendChild(btnAceptar);
    }

    if (this.disenos.length > 0) {
      const tituloDisenos = document.createElement("div");
      tituloDisenos.style.fontWeight = "bold";
      tituloDisenos.style.marginTop = "12px";
      tituloDisenos.textContent = "Mis proyectos";
      cuerpo.appendChild(tituloDisenos);
      for (const d of this.disenos) {
        const fila = document.createElement("div");
        fila.style.margin = "3px 0";
        fila.textContent = `${d.nombre} (${NOMBRES_TIPO[d.tipoEdificio] ?? d.tipoEdificio})`;
        cuerpo.appendChild(fila);
      }
    }

    // Además de la X del marco (cierra por clic-fuera/Escape): botón de
    // texto explícito — un e2e real (carpinteroIngenieroLegendario.e2e.cjs)
    // depende de poder cerrar el panel hermano (carpintero) por texto antes
    // de abrir este, así que se conserva el mismo botón aquí también.
    const btnCerrar = crearBoton("Cerrar", () => this.cerrar());
    btnCerrar.style.marginTop = "10px";
    cuerpo.appendChild(btnCerrar);
  }
}
