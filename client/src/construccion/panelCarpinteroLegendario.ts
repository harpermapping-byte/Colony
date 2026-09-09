/**
 * Panel del banco de carpintero — Carpintero legendario
 * (docs/GDD_Ropa_Procedural.md §Carpintero legendario). MISMO patrón EXACTO
 * que `panelSastreLegendario.ts` (layout, textarea, Generar/Regenerar,
 * preview 3D real con framing dinámico por boundingSphere, swatch de color
 * en vivo, Aceptar, "Mis diseños") — solo cambia el generador que reusa
 * (`generarMuebleVoxel`/`interpretarPromptMueble` en vez de los de ropa).
 *
 * Chrome visual migrado al marco compartido (pedido streamer 2026-09-09,
 * "TODA pantalla... debe salir así con esta estética") — mismo criterio que
 * el telar: X/clic-fuera/Escape los da `crearMarcoPanel`, el botón "Cerrar"
 * casero se retira por redundante. Lógica de estado/preview/red intacta.
 */
import * as THREE from "three";
import { interpretarPromptMueble, type ResultadoInterpretacionMueble } from "../render3d/interpretarPromptMueble";
import { generarMuebleVoxel } from "../render3d/generarMuebleVoxel";
import { mallaDeVoxeles } from "../render3d/voxelMalla";
import { crearMarcoPanel, crearBoton, crearInput, type MarcoPanel } from "../ui/panelBase";

const LADO_PREVIEW_PX = 220;
const NOMBRES_TIPO: Record<string, string> = { silla: "Silla", mesa: "Mesa", cama: "Cama", arcon: "Arcón" };

export interface DisenoCarpintero {
  id: number;
  arquetipoId: string;
  nombre: string;
  creadoEn: string;
}

export interface OpcionesPanelCarpinteroLegendario {
  contenedor: HTMLElement;
  aceptar(construccionId: number, texto: string, nombre: string): void;
  tallarCopia(construccionId: number, muebleGeneradoId: number): void;
  pedirMisDisenos(): void;
}

export class PanelCarpinteroLegendario {
  private readonly marco: MarcoPanel;
  private construccionId: number | null = null;
  private texto = "";
  private nombre = "";
  private colorAcento = "";
  private preview: ResultadoInterpretacionMueble | null = null;
  private disenos: DisenoCarpintero[] = [];
  private error = "";

  // Preview 3D — mismo criterio de contenedor/escena PERSISTENTES que el
  // panel del telar (ver su comentario): no reabrir WebGL en cada render().
  private previewDiv: HTMLDivElement;
  private previewRenderer: THREE.WebGLRenderer;
  private previewScene: THREE.Scene;
  private previewCamera: THREE.PerspectiveCamera;
  private previewMalla: THREE.Mesh | null = null;

  constructor(private opciones: OpcionesPanelCarpinteroLegendario) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Banco de carpintero — tallar mueble legendario", icono: "🪚", left: "50%", top: "50%", ancho: "320px" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "80vh";
    // Mismo motivo que panelSastreLegendario.ts: cerrar por CUALQUIER vía
    // también apaga `construccionId`, para que el bucle de giro de abajo
    // deje de renderizar en cuanto el panel deja de estar realmente abierto.
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
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const luzDirigida = new THREE.DirectionalLight(0xffffff, 0.9);
    luzDirigida.position.set(2, 3, 2);
    this.previewScene.add(luzDirigida);

    this.previewCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 10);
    this.previewCamera.position.set(0.9, 0.7, 0.9);
    this.previewCamera.lookAt(0, 0, 0);

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
    const voxeles = generarMuebleVoxel({
      semilla: `previewMueble:${this.construccionId ?? 0}`,
      tipoMueble: this.preview.tipoMueble,
      colorMadera: this.preview.colorMadera,
      colorAcento: this.colorAcento || this.preview.colorAcento,
      tallado: this.preview.tallado,
      desgaste: this.preview.desgaste,
      roto: this.preview.roto,
      tapizado: this.preview.tapizado,
      incrustado: this.preview.incrustado,
      herraje: this.preview.herraje,
    });
    const malla = mallaDeVoxeles(voxeles);
    if (!malla) return;
    malla.geometry.computeBoundingSphere();
    const esfera = malla.geometry.boundingSphere!;
    malla.position.sub(esfera.center);
    this.previewScene.add(malla);
    this.previewMalla = malla;
    const distancia = Math.max(0.5, (esfera.radius / Math.sin((this.previewCamera.fov * Math.PI) / 360)) * 1.35);
    const direccion = new THREE.Vector3(0.9, 0.7, 0.9).normalize();
    this.previewCamera.position.copy(direccion.multiplyScalar(distancia));
    this.previewCamera.lookAt(0, 0, 0);
  }

  actualizarMisDisenos(disenos: DisenoCarpintero[]) {
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
    this.preview = interpretarPromptMueble(this.texto);
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
    descripcion.textContent = "Describe el mueble con palabras (tipo, madera, tallado, desgaste, color...). 1 diseño nuevo cada 24h — luego puedes tallar copias cuando quieras.";
    cuerpo.appendChild(descripcion);

    const inputTexto = document.createElement("textarea");
    inputTexto.className = "panel-colony-input";
    inputTexto.value = this.texto;
    inputTexto.placeholder = "ej. silla de roble noble tallada con incrustaciones doradas";
    inputTexto.rows = 2;
    inputTexto.style.width = "100%";
    inputTexto.style.boxSizing = "border-box";
    inputTexto.style.margin = "4px 0";
    inputTexto.oninput = () => { this.texto = inputTexto.value; };
    cuerpo.appendChild(inputTexto);

    const inputNombre = crearInput({ placeholder: "Nombre del mueble (opcional)" });
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
      linea(`Tipo: ${NOMBRES_TIPO[this.preview.tipoMueble] ?? this.preview.tipoMueble}`);
      linea(`Madera: ${this.preview.maderaId}`);
      const modificadores: string[] = [];
      if (this.preview.tallado) modificadores.push("tallado");
      if (this.preview.desgaste) modificadores.push("desgastado");
      if (this.preview.roto) modificadores.push("roto");
      if (this.preview.tapizado) modificadores.push("tapizado");
      if (this.preview.incrustado) modificadores.push("incrustado");
      if (this.preview.herraje) modificadores.push("con herrajes");
      if (modificadores.length) linea(`Acabado: ${modificadores.join(", ")}`);
      cuerpo.appendChild(caja);

      cuerpo.appendChild(this.previewDiv);

      if (this.preview.tapizado || this.preview.incrustado) {
        const fila = document.createElement("div");
        fila.style.display = "flex";
        fila.style.alignItems = "center";
        fila.style.gap = "6px";
        fila.style.margin = "6px 0";
        const span = document.createElement("span");
        span.textContent = "Color de acento";
        fila.appendChild(span);
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = this.colorAcento || this.preview.colorAcento || "#a08060";
        colorInput.oninput = () => { this.colorAcento = colorInput.value; this.actualizarMalla3D(); };
        fila.appendChild(colorInput);
        cuerpo.appendChild(fila);
      }

      const btnAceptar = crearBoton("✅ ¡Me gusta, tallarlo!", () => this.opciones.aceptar(this.construccionId!, this.texto, this.nombre));
      btnAceptar.style.marginTop = "6px";
      cuerpo.appendChild(btnAceptar);
    }

    if (this.disenos.length > 0) {
      const tituloDisenos = document.createElement("div");
      tituloDisenos.style.fontWeight = "bold";
      tituloDisenos.style.marginTop = "12px";
      tituloDisenos.textContent = "Mis diseños (tallar copia)";
      cuerpo.appendChild(tituloDisenos);
      for (const d of this.disenos) {
        const fila = document.createElement("div");
        fila.style.display = "flex";
        fila.style.justifyContent = "space-between";
        fila.style.alignItems = "center";
        fila.style.gap = "8px";
        fila.style.margin = "3px 0";
        const etiqueta = document.createElement("span");
        etiqueta.textContent = `${d.nombre} (${NOMBRES_TIPO[d.arquetipoId] ?? d.arquetipoId})`;
        fila.appendChild(etiqueta);
        const btn = crearBoton("Tallar copia", () => this.opciones.tallarCopia(this.construccionId!, d.id));
        fila.appendChild(btn);
        cuerpo.appendChild(fila);
      }
    }

    // Además de la X del marco (cierra por clic/fuera/Escape): un botón de
    // texto explícito — un e2e real (carpinteroIngenieroLegendario.e2e.cjs)
    // lo busca por texto para cerrar el panel del carpintero antes de pasar
    // al de ingeniero, así que se conserva.
    const btnCerrar = crearBoton("Cerrar", () => this.cerrar());
    btnCerrar.style.marginTop = "10px";
    cuerpo.appendChild(btnCerrar);
  }
}
