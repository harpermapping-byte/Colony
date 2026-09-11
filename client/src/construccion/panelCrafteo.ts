/**
 * Panel de crafteo genérico en mesa de oficio (docs/GDD_Crafteo.md, pedido
 * streamer 2026-09-10: "hay que hacer la UI de la conver... elegir oficio" —
 * en el mismo hilo, para crafteo: "los minijuegos de oficio y los sistemas
 * de crafteo... ¿tienen UI ya creada como el resto?"). Cierra el hueco
 * documentado desde el diseño original de `docs/GDD_Crafteo.md` §5 ("el
 * crafteo no tiene panel de cliente hoy" — ni siquiera Forja/Cocina eligen
 * receta de una lista, cada una tiene su propio protocolo de minijuego
 * aparte). Este panel es el primero que de verdad LISTA recetas de
 * `items/catalogo/recetas.json` (vía el mensaje nuevo de servidor
 * `crafteo:recetasDisponibles`, que nunca valida/consume — solo informa) y
 * dispara el mismo `crafteo:iniciar`/`crafteo:recolectar` que ya usaba
 * `window.__ajedrez.craftear` con un `recetaId` fijo a mano.
 *
 * Si la receta elegida usa `minijuego:"herreria"`, el servidor responde con
 * `crafteo:herreria:iniciado` en vez de `crafteo:iniciado` — este panel se
 * cierra solo (ver game.ts) y deja el testigo a `panelForja.ts`, que ya
 * sabía jugar ese protocolo.
 */
import { crearMarcoPanel, crearBoton, crearLineaTexto, crearSubtitulo, type MarcoPanel } from "../ui/panelBase";
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItemCatalogo {
  nombre?: string;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItemCatalogo>;
function nombreItem(itemId: string): string {
  return ITEMS[itemId]?.nombre ?? itemId;
}

export interface InsumoVista {
  itemId: string;
  cantidad: number;
}

export interface RecetaVista {
  id: string;
  oficio: string;
  nivelMinimo: number;
  insumos: InsumoVista[];
  resultado: InsumoVista;
  tiempoBaseSeg: number;
  minijuego: string | null;
  bloqueadaPorNivel: boolean;
  edificioFaltante: string | null;
  planoFaltante: string | null;
}

export interface OpcionesPanelCrafteo {
  contenedor: HTMLElement;
  /** ¿Tiene el jugador ya estos insumos? (game.ts lo resuelve contra su propio inventario replicado — este panel nunca duplica ese estado.) */
  tieneInsumos(insumos: InsumoVista[]): boolean;
  enviarPedirRecetas(construccionId: number): void;
  enviarIniciar(construccionId: number, recetaId: string): void;
  enviarRecolectar(): void;
}

export class PanelCrafteo {
  private marco: MarcoPanel;
  private construccionId: number | null = null;
  private nombreMesa = "";
  private recetas: RecetaVista[] | null = null; // null = todavía esperando la respuesta del servidor
  private craftenado: { recetaId: string; terminaEn: number } | null = null;
  private intervaloReloj: ReturnType<typeof setInterval> | null = null;

  constructor(private opciones: OpcionesPanelCrafteo) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Crafteo", icono: "🛠", left: "50%", top: "50%", ancho: "380px" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "80vh";
    this.marco.cuerpo.style.overflowY = "auto";
    // Mismo criterio que panelSastreLegendario.ts: cerrar por CUALQUIER vía
    // apaga el estado, para que no se quede "abierto" a medias sin sitio
    // donde pintar (y para el aviso de "cambia de minijuego" de abajo).
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto()) {
        this.construccionId = null;
        this.detenerReloj();
      }
    });
  }

  abrir(construccionId: number, nombreMesa: string) {
    this.construccionId = construccionId;
    this.nombreMesa = nombreMesa;
    this.recetas = null;
    this.craftenado = null;
    this.marco.abrir();
    this.render();
    this.opciones.enviarPedirRecetas(construccionId);
  }

  cerrar() {
    this.marco.cerrar();
  }

  /** Cierre silencioso desde game.ts cuando el servidor cambia a un minijuego aparte (forja) — sin volver a disparar onCambioEstado dos veces (cerrar() ya lo hace una). */
  cerrarPorMinijuegoAparte() {
    if (this.marco.estaAbierto()) this.cerrar();
  }

  actualizarRecetas(construccionId: number, recetas: RecetaVista[]) {
    if (construccionId !== this.construccionId || !this.marco.estaAbierto()) return;
    this.recetas = recetas;
    this.render();
  }

  marcarIniciado(recetaId: string, terminaEn: number) {
    if (!this.marco.estaAbierto()) return;
    this.craftenado = { recetaId, terminaEn };
    this.iniciarReloj();
    this.render();
  }

  marcarCompletado() {
    this.craftenado = null;
    this.detenerReloj();
    if (this.marco.estaAbierto() && this.construccionId !== null) {
      // Recarga el listado — el nivel/XP pudo subir con este mismo crafteo.
      this.opciones.enviarPedirRecetas(this.construccionId);
    }
  }

  marcarError(motivo: string) {
    if (!this.marco.estaAbierto()) return;
    this.craftenado = null;
    this.detenerReloj();
    this.render(motivo);
  }

  private iniciarReloj() {
    this.detenerReloj();
    this.intervaloReloj = setInterval(() => {
      if (!this.craftenado) return this.detenerReloj();
      this.render();
      // Deja de redibujar en cuanto está listo — el botón "Recolectar" ya
      // no cambia de texto y así no se reconstruye el DOM bajo un clic real
      // en curso (bug real encontrado con Playwright: el botón se detectaba
      // "detached" a media pulsación porque cada 500ms se recreaba entero,
      // sin necesidad — nada en la sesión cambia una vez lista).
      if (Date.now() >= this.craftenado.terminaEn) this.detenerReloj();
    }, 500);
  }

  private detenerReloj() {
    if (this.intervaloReloj !== null) {
      clearInterval(this.intervaloReloj);
      this.intervaloReloj = null;
    }
  }

  private render(error?: string) {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    cuerpo.appendChild(crearLineaTexto(this.nombreMesa, { negrita: true }));

    if (error) {
      const av = crearLineaTexto(`⚠ ${error}`);
      av.style.color = "var(--panel-error, #c94a3a)";
      cuerpo.appendChild(av);
    }

    if (this.craftenado) {
      const restanteMs = Math.max(0, this.craftenado.terminaEn - Date.now());
      const listo = restanteMs <= 0;
      const receta = this.recetas?.find((r) => r.id === this.craftenado!.recetaId);
      const nombreResultado = receta ? nombreItem(receta.resultado.itemId) : this.craftenado.recetaId;
      cuerpo.appendChild(crearLineaTexto(`⏳ Crafteando ${nombreResultado}...`, { negrita: true }));
      cuerpo.appendChild(crearLineaTexto(listo ? "¡Listo!" : `${Math.ceil(restanteMs / 1000)}s restantes`));
      cuerpo.appendChild(crearBoton(listo ? "📦 Recolectar" : "Esperando...", () => this.opciones.enviarRecolectar()));
      return;
    }

    if (this.recetas === null) {
      cuerpo.appendChild(crearLineaTexto("Cargando recetas..."));
      return;
    }
    if (this.recetas.length === 0) {
      cuerpo.appendChild(crearLineaTexto("Esta mesa no tiene ninguna receta asociada todavía."));
      return;
    }

    // Agrupado por nivel, más fácil de leer que una lista plana (mismo
    // criterio de progresión — nivel 1 arriba, avanzado abajo — que ya
    // documenta docs/GDD_Crafteo.md §2).
    const porNivel = new Map<number, RecetaVista[]>();
    for (const r of this.recetas) {
      if (!porNivel.has(r.nivelMinimo)) porNivel.set(r.nivelMinimo, []);
      porNivel.get(r.nivelMinimo)!.push(r);
    }
    for (const nivel of [...porNivel.keys()].sort((a, b) => a - b)) {
      cuerpo.appendChild(crearSubtitulo(`Nivel ${nivel}`));
      for (const r of porNivel.get(nivel)!) {
        cuerpo.appendChild(this.filaReceta(r));
      }
    }
  }

  private filaReceta(r: RecetaVista): HTMLDivElement {
    const fila = document.createElement("div");
    fila.style.marginBottom = "8px";
    fila.style.padding = "4px";
    fila.style.borderRadius = "4px";

    const tieneInsumos = this.opciones.tieneInsumos(r.insumos);
    const bloqueoTexto = r.bloqueadaPorNivel
      ? `nivel ${r.nivelMinimo} insuficiente`
      : r.edificioFaltante
        ? `hace falta ${r.edificioFaltante} en el asentamiento`
        : r.planoFaltante
          ? `hace falta ${r.planoFaltante} en el asentamiento`
          : !tieneInsumos
            ? "faltan insumos"
            : null;

    const cabecera = crearLineaTexto(
      `${r.resultado.cantidad}× ${nombreItem(r.resultado.itemId)}${r.minijuego ? " (minijuego)" : ""}`,
      { negrita: !bloqueoTexto },
    );
    if (bloqueoTexto) cabecera.style.opacity = "0.55";
    fila.appendChild(cabecera);

    const insumosTexto = r.insumos.map((i) => `${i.cantidad}× ${nombreItem(i.itemId)}`).join(", ");
    fila.appendChild(crearLineaTexto(insumosTexto, { tenue: true, fontSize: "0.85em" }));

    if (bloqueoTexto) {
      fila.appendChild(crearLineaTexto(`🔒 ${bloqueoTexto}`, { tenue: true, fontSize: "0.85em" }));
    } else {
      const boton = crearBoton("Craftear", () => this.opciones.enviarIniciar(this.construccionId!, r.id));
      fila.appendChild(boton);
    }
    return fila;
  }
}
