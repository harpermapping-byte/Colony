/**
 * Mapa de mundo con niebla de guerra (docs/GDD_Mapa_Mundo.md, pedido
 * 2026-08-31): tecla M, overlay a pantalla completa sobre `mapa_general.png`
 * (ya bakeado, mismo asset estático que cualquier otro archivo del mapa).
 * Solo se ve lo que el jugador ya exploró — el servidor decide qué sectores
 * están revelados (persistente, sobrevive a morir/desconectar), este panel
 * solo pinta: niebla negra con agujeros donde ya se ha estado, tu posición
 * en vivo y tus propias parcelas.
 *
 * NO marca POIs ni la ciudad capital todavía — el bakeador no exporta hoy
 * ninguna lista de posiciones de POI (ver huecos honestos del GDD), así que
 * de momento el mapa es "terreno explorado + tú + lo tuyo", ampliable en
 * cuanto exista ese dato.
 */
import type { IndiceMapa } from "./formatoMapa";
import type { ArchivoParcelas } from "../construccion/parcelasCliente";
import { crearMarcoPanel, type MarcoPanel } from "../ui/panelBase";

export interface DatosExploracion {
  /** Claves de sector empaquetadas (mundo/exploracion.ts del servidor: sy*100000+sx) ya reveladas. */
  sectores: number[];
  tilesPorSector: number;
}

export interface OpcionesPanelMapaMundo {
  contenedor: HTMLElement;
  rutaMapa: string; // misma base que cargarIndice/cargarSector, ej. "/assets/mapas/principal"
  indice: IndiceMapa;
  parcelasArchivo: ArchivoParcelas | null;
  nombreJugador: string;
  /** parcelaId -> dueño actual (ModoConstruccion.estadoParcelas(), ya vivo en el cliente). */
  obtenerDuenos: () => Record<string, { dueno: string | null }>;
  /** Posición en vivo del jugador local, en casillas — null si aún no ha llegado el primer patch. */
  posicionJugador: () => { x: number; z: number } | null;
  /** Pide al servidor el snapshot de exploración actual — la respuesta llega por `aplicarExploracion`. */
  consultarExploracion(): void;
}

const ANCHO_EMPAQUETADO = 100000; // mismo valor que server/src/mundo/exploracion.ts — hay que mantenerlos iguales

function desempaquetarSector(clave: number): { sx: number; sy: number } {
  return { sx: clave % ANCHO_EMPAQUETADO, sy: Math.floor(clave / ANCHO_EMPAQUETADO) };
}

export class PanelMapaMundo {
  // Fondo oscurecido de pantalla completa — crearMarcoPanel da una tarjeta
  // flotante, no un overlay a pantalla completa; el mapa SÍ necesita
  // oscurecer todo detrás (mismo criterio que panelResumen.ts). La tarjeta
  // (`marco.raiz`) se monta DENTRO de este fondo para que "clic fuera de la
  // tarjeta" (el propio mecanismo de crearMarcoPanel, que mide contra
  // `marco.raiz`) caiga sobre el fondo y cierre exactamente igual que antes.
  private readonly fondo: HTMLDivElement;
  private readonly marco: MarcoPanel;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  // Niebla en un canvas APARTE, nunca pintado directo sobre el mapa: un
  // solo contexto no distingue "capa negra" de "capa de mapa" una vez
  // dibujadas — `destination-out` borraría literalmente el mapa también.
  // Se dibuja negra+agujereada aquí y se compone ENCIMA del mapa al final
  // con el modo normal (source-over), que sí respeta el alfa de los agujeros.
  private readonly nieblaCanvas: HTMLCanvasElement;
  private readonly nieblaCtx: CanvasRenderingContext2D;
  private readonly imagen: HTMLImageElement;
  private imagenLista = false;
  private exploracion: DatosExploracion | null = null;

  constructor(private readonly opciones: OpcionesPanelMapaMundo) {
    this.fondo = document.createElement("div");
    this.fondo.style.position = "fixed";
    this.fondo.style.inset = "0";
    this.fondo.style.background = "rgba(0,0,0,0.75)";
    this.fondo.style.display = "none";
    this.fondo.style.zIndex = "70";
    this.fondo.style.alignItems = "center";
    this.fondo.style.justifyContent = "center";
    opciones.contenedor.appendChild(this.fondo);

    this.marco = crearMarcoPanel({ contenedor: this.fondo, titulo: `Mapa — ${opciones.indice.nombre}`, icono: "🗺️" });
    this.marco.raiz.style.position = "relative"; // el fondo ya centra con flex — el position:absolute del tema rompería el centrado
    this.marco.onCambioEstado(() => {
      this.fondo.style.display = this.marco.estaAbierto() ? "flex" : "none";
      if (this.marco.estaAbierto()) {
        this.opciones.consultarExploracion(); // siempre pide fresco al abrir — barato, un solo mensaje
        if (this.imagenLista) this.dibujar();
      }
    });

    const cuerpo = this.marco.cuerpo;
    cuerpo.style.display = "flex";
    cuerpo.style.flexDirection = "column";
    cuerpo.style.alignItems = "center";

    this.canvas = document.createElement("canvas");
    this.canvas.style.border = "2px solid var(--panel-borde-tallado)";
    this.canvas.style.borderRadius = "4px";
    this.canvas.style.background = "#000";
    cuerpo.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.nieblaCanvas = document.createElement("canvas"); // nunca se añade al DOM, solo buffer intermedio
    this.nieblaCtx = this.nieblaCanvas.getContext("2d")!;

    const ayuda = document.createElement("div");
    ayuda.textContent = "Amarillo = tú · Verde = tus parcelas · Escape o M para cerrar";
    ayuda.style.color = "var(--panel-texto-tenue)";
    ayuda.style.font = "12px sans-serif";
    ayuda.style.marginTop = "8px";
    cuerpo.appendChild(ayuda);

    this.imagen = new Image();
    this.imagen.onload = () => { this.imagenLista = true; if (this.marco.estaAbierto()) this.dibujar(); };
    this.imagen.src = `${opciones.rutaMapa}/mapa_general.png`;
  }

  /** Respuesta del servidor a `mapa:consultarExploracion` — game.ts la reenvía aquí. */
  aplicarExploracion(datos: DatosExploracion): void {
    this.exploracion = datos;
    if (this.marco.estaAbierto()) this.dibujar();
  }

  alternar(): void {
    this.marco.alternar();
  }

  estaAbierto(): boolean {
    return this.marco.estaAbierto();
  }

  /** Dock (docs/GDD_UI_Paneles.md) — se dispara en cada abrir/cerrar por cualquier vía (X, clic fuera, Escape, M). */
  onCambioEstado(cb: () => void): void {
    this.marco.onCambioEstado(cb);
  }

  private dibujar(): void {
    const { indice, parcelasArchivo, nombreJugador } = this.opciones;
    const w = this.imagen.naturalWidth || 800;
    const h = this.imagen.naturalHeight || 800;
    // Tamaño en pantalla acotado a la ventana, conservando proporción del mapa.
    const maxW = Math.min(w, window.innerWidth - 80);
    const maxH = Math.min(h, window.innerHeight - 140);
    const escala = Math.min(maxW / w, maxH / h);
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${Math.round(w * escala)}px`;
    this.canvas.style.height = `${Math.round(h * escala)}px`;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.imagen, 0, 0, w, h);

    // Niebla: se dibuja negra+agujereada en su PROPIO canvas (nunca sobre
    // el mapa directamente — un único contexto no distingue "capa negra"
    // de "capa de mapa" una vez pintadas, así que destination-out ahí
    // borraría el mapa también) y se compone encima al final con el modo
    // normal, que sí respeta el alfa transparente de los agujeros.
    const anchoMundo = indice.anchoChunks * indice.tamanoChunk;
    const altoMundo = indice.altoChunks * indice.tamanoChunk;
    const pxPorCasillaX = w / anchoMundo;
    const pxPorCasillaY = h / altoMundo;

    this.nieblaCanvas.width = w;
    this.nieblaCanvas.height = h;
    const nctx = this.nieblaCtx;
    nctx.clearRect(0, 0, w, h);
    nctx.fillStyle = "#000";
    nctx.fillRect(0, 0, w, h);
    if (this.exploracion) {
      const { sectores, tilesPorSector } = this.exploracion;
      nctx.save();
      nctx.globalCompositeOperation = "destination-out";
      for (const clave of sectores) {
        const { sx, sy } = desempaquetarSector(clave);
        const px = sx * tilesPorSector * pxPorCasillaX;
        const py = sy * tilesPorSector * pxPorCasillaY;
        const pw = tilesPorSector * pxPorCasillaX;
        const ph = tilesPorSector * pxPorCasillaY;
        nctx.fillRect(px, py, pw, ph);
      }
      nctx.restore();
    }
    ctx.drawImage(this.nieblaCanvas, 0, 0);

    // Tus parcelas — un punto verde por parcela que te pertenece (centroide de sus runs).
    if (parcelasArchivo) {
      const duenos = this.opciones.obtenerDuenos();
      ctx.fillStyle = "#3ddc78";
      for (const [id, parcela] of Object.entries(parcelasArchivo.parcelas)) {
        if (duenos[id]?.dueno !== nombreJugador) continue;
        let sx = 0, sy = 0, n = 0;
        for (const [y, x0, x1] of parcela.runs) { sx += (x0 + x1) / 2; sy += y; n++; }
        if (n === 0) continue;
        const cx = (sx / n) * pxPorCasillaX;
        const cy = (sy / n) * pxPorCasillaY;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, 4 * escala) / escala, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Tu posición en vivo.
    const pos = this.opciones.posicionJugador();
    if (pos) {
      ctx.fillStyle = "#ffd94a";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = Math.max(1, 1.5 / escala);
      ctx.beginPath();
      ctx.arc(pos.x * pxPorCasillaX, pos.z * pxPorCasillaY, Math.max(4, 5 * escala) / escala, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
