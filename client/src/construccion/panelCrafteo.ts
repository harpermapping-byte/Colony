/**
 * Panel de CRAFTEO en mesa (docs/GDD_Crafteo.md §10, 2026-09-11) — la UI
 * que faltaba desde el diseño original: hasta hoy `crafteo:iniciar` solo lo
 * disparaban sondas de test (`window.__ajedrez`, e2e), ningún jugador real
 * podía elegir una receta en una mesa desde el navegador.
 *
 * Se abre desde el menú de interacción de cualquier construcción cuyo id
 * aparezca en `mesas` de alguna receta (`items/catalogo/recetas.json`,
 * importado al bundle igual que hace panelReclutador.ts — el catálogo es
 * público, no hace falta pedirlo al servidor). Lista las recetas de ESA
 * mesa con lo que hace falta para cada una (nivel de oficio, insumos que
 * llevas encima frente a los que pide, minijuego si lo hay) y manda el
 * protocolo real: crafteo:iniciar → (crafteo:iniciado, progreso local
 * hasta `terminaEn`) → crafteo:recolectar → crafteo:completado. Todo lo
 * que se pinta como "puedes/no puedes" es solo una ayuda: el servidor sigue
 * validando cada crafteo de verdad (validarCrafteo), el botón nunca
 * sustituye esa validación.
 *
 * Subida de nivel: `crafteo:completado` trae la XP/nivel nuevos del
 * oficio; comparado con el nivel que ya conocíamos (de `oficio:estado`,
 * pedido al abrir el panel) se detecta el salto y se avisa con un toast
 * que lista las recetas que se acaban de desbloquear en ESE nivel — "subir
 * de oficio y ver nuevos crafteos" era invisible antes.
 */
import recetasJson from "../../../items/catalogo/recetas.json";
import itemsJson from "../../../items/catalogo/items.json";
import { crearMarcoPanel, crearBoton, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";

export interface RecetaCatalogo {
  oficio: string;
  mesas: string[];
  nivelMinimo: number;
  insumos: { itemId: string; cantidad: number }[];
  resultado: { itemId: string; cantidad: number };
  tiempoBaseSeg: number;
  minijuego?: string;
  planoRequerido?: string;
  edificioRequerido?: string;
}

interface EntradaItem { nombre?: string }

export const RECETAS = Object.fromEntries(
  Object.entries(recetasJson as unknown as Record<string, RecetaCatalogo | string>).filter(([id, r]) => !id.startsWith("_") && typeof r === "object" && r !== null && Array.isArray((r as RecetaCatalogo).mesas)),
) as Record<string, RecetaCatalogo>;
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

/** Ids de construcción que son mesa de al menos una receta — el menú de interacción ofrece "Craftear" solo en estas. */
export const MESAS_CON_RECETAS = new Set<string>();
for (const receta of Object.values(RECETAS)) for (const mesa of receta.mesas) MESAS_CON_RECETAS.add(mesa);

export function nombreItem(itemId: string): string {
  return ITEMS[itemId]?.nombre ?? itemId.replace(/_/g, " ");
}

export function nombreOficio(oficio: string): string {
  return oficio ? oficio.charAt(0).toUpperCase() + oficio.slice(1) : "";
}

export function recetasDeMesa(objetoId: string): { id: string; receta: RecetaCatalogo }[] {
  return Object.entries(RECETAS)
    .filter(([, r]) => r.mesas.includes(objetoId))
    .map(([id, receta]) => ({ id, receta }))
    .sort((a, b) => a.receta.nivelMinimo - b.receta.nivelMinimo || a.id.localeCompare(b.id));
}

/** Recetas de un oficio que se desbloquean EXACTAMENTE en `nivel` (en cualquier mesa) — para el toast de subida de nivel. */
export function recetasDesbloqueadasEnNivel(oficio: string, nivel: number): { id: string; receta: RecetaCatalogo }[] {
  return Object.entries(RECETAS)
    .filter(([, r]) => r.oficio === oficio && r.nivelMinimo === nivel)
    .map(([id, receta]) => ({ id, receta }));
}

export interface OpcionesPanelCrafteo {
  contenedor: HTMLElement;
  enviarIniciar(recetaId: string, construccionId: number): void;
  enviarRecolectar(): void;
  /** Pide `oficio:estado` al servidor (XP/nivel reales de los oficios indicados). */
  consultarOficios(oficios: string[]): void;
  /** Ítems que el jugador lleva encima ahora mismo (itemId → cantidad sumada). */
  inventarioActual(): Map<string, number>;
  oficiosElegidos(): [string, string];
  toast(texto: string, tipo?: "info" | "error" | "danoHecho"): void;
}

interface CrafteoEnCurso { recetaId: string; terminaEn: number; construccionId: number; recolectarPedido: boolean }

export interface RecetaVista {
  id: string;
  nombre: string;
  oficio: string;
  nivelMinimo: number;
  nivelActual: number | null;
  desbloqueada: boolean;
  insumosOk: boolean;
  minijuego: string | null;
}

export class PanelCrafteo {
  private readonly marco: MarcoPanel;
  private mesa: { id: number; objeto: string; nombre: string } | null = null;
  private xp: Record<string, number> = {};
  private nivel: Record<string, number> = {};
  private enCurso: CrafteoEnCurso | null = null;
  private temporizador: number | null = null;
  private ultimaVista: RecetaVista[] = [];

  constructor(private readonly opciones: OpcionesPanelCrafteo) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Crafteo",
      icono: "🛠",
      left: "50%",
      top: "80px",
      ancho: "400px",
    });
    this.marco.raiz.style.transform = "translateX(-50%)";
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto()) this.detenerRefresco();
    });
  }

  estaAbierto(): boolean {
    return this.marco.estaAbierto();
  }

  /** Abre el panel para UNA mesa concreta (clic → "Craftear en …"). */
  abrir(construccionId: number, objetoId: string, nombreMesa: string): void {
    this.mesa = { id: construccionId, objeto: objetoId, nombre: nombreMesa };
    const oficios = [...new Set(recetasDeMesa(objetoId).map((r) => r.receta.oficio))];
    this.opciones.consultarOficios(oficios);
    this.marco.abrir();
    this.refrescar(true);
    this.detenerRefresco();
    // Los insumos cambian sin avisar (recoger del suelo, otro crafteo…): un
    // refresco barato mientras el panel esté a la vista, nunca por patch de red.
    this.temporizador = window.setInterval(() => this.refrescar(), 1000);
  }

  cerrar(): void {
    this.marco.cerrar();
  }

  /** `oficio:estado` — XP/nivel reales; ANTES del primer crafteo, para poder detectar el salto de nivel después. */
  actualizarOficios(m: { xp?: Record<string, number>; nivel?: Record<string, number> }): void {
    Object.assign(this.xp, m?.xp ?? {});
    Object.assign(this.nivel, m?.nivel ?? {});
    if (this.marco.estaAbierto()) this.refrescar();
  }

  onIniciado(m: { recetaId: string; terminaEn: number }): void {
    if (!this.mesa) return;
    this.enCurso = { recetaId: m.recetaId, terminaEn: m.terminaEn, construccionId: this.mesa.id, recolectarPedido: false };
    this.refrescar(true);
  }

  onCompletado(m: { recetaId?: string; itemId: string; cantidad: number; oficio?: string; xp?: number; nivel?: number; enSuelo?: boolean }): void {
    this.enCurso = null;
    const nombre = nombreItem(m.itemId);
    this.opciones.toast(`Has fabricado ${m.cantidad}× ${nombre}${m.enSuelo ? " (no cabía: al suelo)" : ""}`, "danoHecho");
    if (m.oficio && typeof m.nivel === "number") {
      const anterior = this.nivel[m.oficio];
      this.nivel[m.oficio] = m.nivel;
      if (typeof m.xp === "number") this.xp[m.oficio] = m.xp;
      if (typeof anterior === "number" && m.nivel > anterior) {
        const nuevas = recetasDesbloqueadasEnNivel(m.oficio, m.nivel).map((r) => nombreItem(r.receta.resultado.itemId));
        const lista = nuevas.length ? ` Nuevas recetas: ${nuevas.slice(0, 6).join(", ")}${nuevas.length > 6 ? "…" : ""}.` : "";
        this.opciones.toast(`¡${nombreOficio(m.oficio)} nivel ${m.nivel}!${lista}`, "info");
      }
    }
    this.refrescar();
  }

  onError(motivo: string): void {
    this.enCurso = null;
    this.opciones.toast(`Crafteo: ${motivo}`, "error");
    this.refrescar(true);
  }

  /** Sonda para tests — lo mismo que pinta la lista, en datos. */
  recetasVisibles(): RecetaVista[] {
    return this.ultimaVista;
  }

  nivelDe(oficio: string): number | null {
    return typeof this.nivel[oficio] === "number" ? this.nivel[oficio] : null;
  }

  private detenerRefresco(): void {
    if (this.temporizador !== null) { window.clearInterval(this.temporizador); this.temporizador = null; }
  }

  /** Barra/segundos restantes en su sitio + petición automática de recolectar al cumplirse `terminaEn` (con un pequeño margen para no adelantarse al reloj del servidor). */
  private actualizarProgreso(): void {
    if (!this.enCurso) return;
    const receta = RECETAS[this.enCurso.recetaId];
    const restante = Math.max(0, this.enCurso.terminaEn - Date.now());
    const total = Math.max(1, (receta?.tiempoBaseSeg ?? 1) * 1000);
    if (this.progresoTexto) this.progresoTexto.textContent = `Fabricando ${receta ? nombreItem(receta.resultado.itemId) : this.enCurso.recetaId}… ${Math.ceil(restante / 1000)}s`;
    if (this.progresoRelleno) this.progresoRelleno.style.width = `${Math.round((1 - Math.min(1, restante / total)) * 100)}%`;
    if (restante <= 0 && !this.enCurso.recolectarPedido) {
      this.enCurso.recolectarPedido = true;
      window.setTimeout(() => this.opciones.enviarRecolectar(), 250);
    }
  }

  private ultimaFirma = "";
  private progresoTexto: HTMLDivElement | null = null;
  private progresoRelleno: HTMLDivElement | null = null;

  /**
   * Reconstruye la lista SOLO si cambió algo que la afecte (inventario,
   * nivel, crafteo en curso sí/no) — reconstruir el DOM cada segundo
   * "por si acaso" dejaba los botones cambiando de nodo bajo el ratón
   * (un clic real podía caer en un botón recién destruido); la barra de
   * progreso se actualiza en su sitio sin tocar el resto.
   */
  private refrescar(forzar = false): void {
    if (!this.mesa) return;
    const inventario = this.opciones.inventarioActual();
    const [oficio1, oficio2] = this.opciones.oficiosElegidos();
    const firma = JSON.stringify([[...inventario.entries()].sort(), this.nivel, this.enCurso?.recetaId ?? null, oficio1, oficio2, this.mesa.id]);
    if (!forzar && firma === this.ultimaFirma) { this.actualizarProgreso(); return; }
    this.ultimaFirma = firma;
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    this.progresoTexto = null;
    this.progresoRelleno = null;
    cuerpo.appendChild(crearLineaTexto(this.mesa.nombre, { negrita: true }));

    if (this.enCurso) {
      const receta = RECETAS[this.enCurso.recetaId];
      const restante = Math.max(0, this.enCurso.terminaEn - Date.now());
      const total = Math.max(1, (receta?.tiempoBaseSeg ?? 1) * 1000);
      const fila = document.createElement("div");
      fila.dataset.testid = "crafteo-progreso";
      fila.style.margin = "6px 0 10px";
      this.progresoTexto = crearLineaTexto(`Fabricando ${receta ? nombreItem(receta.resultado.itemId) : this.enCurso.recetaId}… ${Math.ceil(restante / 1000)}s`);
      fila.appendChild(this.progresoTexto);
      const barra = document.createElement("div");
      barra.style.cssText = "height:8px;border:1px solid var(--panel-borde);border-radius:4px;overflow:hidden;background:rgba(0,0,0,0.25)";
      this.progresoRelleno = document.createElement("div");
      this.progresoRelleno.style.cssText = `height:100%;width:${Math.round((1 - Math.min(1, restante / total)) * 100)}%;background:var(--panel-acento)`;
      barra.appendChild(this.progresoRelleno);
      fila.appendChild(barra);
      cuerpo.appendChild(fila);
      this.actualizarProgreso();
    }

    const lista = recetasDeMesa(this.mesa.objeto);
    this.ultimaVista = [];
    if (lista.length === 0) cuerpo.appendChild(crearLineaTexto("Esta mesa no tiene recetas.", { tenue: true }));
    for (const { id, receta } of lista) {
      const nivelActual = this.nivelDe(receta.oficio);
      const desbloqueada = nivelActual !== null ? nivelActual >= receta.nivelMinimo : receta.nivelMinimo <= 1;
      const insumosOk = receta.insumos.every((i) => (inventario.get(i.itemId) ?? 0) >= i.cantidad);
      const elegido = receta.oficio === oficio1 || receta.oficio === oficio2;
      this.ultimaVista.push({ id, nombre: nombreItem(receta.resultado.itemId), oficio: receta.oficio, nivelMinimo: receta.nivelMinimo, nivelActual, desbloqueada, insumosOk, minijuego: receta.minijuego ?? null });

      const fila = document.createElement("div");
      fila.dataset.testid = `receta-${id}`;
      fila.dataset.desbloqueada = String(desbloqueada);
      fila.style.cssText = `display:flex;flex-direction:column;gap:2px;padding:6px 4px;border-top:1px solid var(--panel-borde);opacity:${desbloqueada ? 1 : 0.55}`;
      const cabecera = document.createElement("div");
      cabecera.style.cssText = "display:flex;align-items:center;gap:6px";
      const titulo = document.createElement("span");
      titulo.style.flex = "1";
      titulo.style.fontWeight = "bold";
      titulo.textContent = `${receta.resultado.cantidad}× ${nombreItem(receta.resultado.itemId)}${receta.minijuego ? " ⚒" : ""}`;
      cabecera.appendChild(titulo);
      const boton = crearBoton(this.enCurso ? "…" : "Craftear", () => {
        if (!this.mesa) return;
        this.opciones.enviarIniciar(id, this.mesa.id);
      });
      boton.dataset.testid = `craftear-${id}`;
      boton.disabled = !!this.enCurso || !desbloqueada || !insumosOk;
      cabecera.appendChild(boton);
      fila.appendChild(cabecera);

      const detalle = document.createElement("div");
      detalle.style.cssText = "font-size:12px;color:var(--panel-texto-tenue)";
      const nivelTxt = nivelActual === null ? `nivel ${receta.nivelMinimo}` : `nivel ${receta.nivelMinimo} (tienes ${nivelActual})`;
      detalle.textContent = `${nombreOficio(receta.oficio)} ${nivelTxt}${elegido ? "" : " · sin bono (oficio no elegido)"} · ${receta.tiempoBaseSeg}s${receta.minijuego ? ` · minijuego de ${receta.minijuego}` : ""}`;
      if (!desbloqueada) detalle.style.color = "var(--error-color)";
      fila.appendChild(detalle);

      const insumos = document.createElement("div");
      insumos.style.cssText = "font-size:12px;display:flex;flex-wrap:wrap;gap:4px 10px";
      for (const i of receta.insumos) {
        const tienes = inventario.get(i.itemId) ?? 0;
        const span = document.createElement("span");
        span.textContent = `${nombreItem(i.itemId)} ${tienes}/${i.cantidad}`;
        span.style.color = tienes >= i.cantidad ? "var(--panel-acento)" : "var(--error-color)";
        insumos.appendChild(span);
      }
      if (receta.planoRequerido) insumos.appendChild(Object.assign(document.createElement("span"), { textContent: `requiere ${nombreItem(receta.planoRequerido)} en el asentamiento` }));
      if (receta.edificioRequerido) insumos.appendChild(Object.assign(document.createElement("span"), { textContent: `requiere ${receta.edificioRequerido} construido` }));
      fila.appendChild(insumos);
      cuerpo.appendChild(fila);
    }
  }
}
