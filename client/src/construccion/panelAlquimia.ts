/**
 * Panel de alquimia/pociones — cierra el hueco documentado desde el diseño
 * original (docs/GDD_Pociones.md §8: "sin panel de cliente todavía", NI
 * SIQUIERA como placeholder — a diferencia de forja/cocina, que ya tenían
 * uno de testeo). Pedido streamer 2026-09-10 (mismo hilo que el panel de
 * crafteo genérico): "el tema de la alquimia recuerdo también teníamos
 * juego... necesitamos funcione también como el resto, marcaban que salía
 * si metías X y tal". El "marcaban" es el COLOR del líquido según qué
 * ingredientes metes (`docs/GDD_Pociones.md` §9, `alquimia.ts::colorPocion`)
 * — replicado aquí en `previsualizarColor` como preview EN VIVO mientras se
 * eligen ingredientes, sin esperar a colar de verdad.
 *
 * Dos pantallas en el mismo marco (mismo criterio que panelCocina.ts): la
 * de SELECCIÓN (elegir 2-6 ingredientes del inventario + frasco) y la de
 * SESIÓN (barra de temperatura con marcas de ventana óptima — MISMA UI que
 * panelForja.ts, mismo motor `estacionFuego.ts` por debajo).
 *
 * Mecánica de frasco (pedido streamer 2026-09-10, misma conversación:
 * "las pociones se pueden usar/consumir y se pierde, y se queda el
 * frasco... para craftear pociones necesitas el frasco + ingredientes") —
 * el servidor exige un `frasco_pocion` aparte de los ingredientes elegidos
 * (RoomExteriorBase.ts::manejarAlquimiaIniciar); este panel solo AVISA si
 * falta, nunca lo deja elegir como si fuera un ingrediente más.
 */
import { crearMarcoPanel, crearBoton, crearLineaTexto, crearSubtitulo, type MarcoPanel } from "../ui/panelBase";
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItemCatalogo {
  nombre?: string;
  alquimiaIngrediente?: boolean;
  alquimiaCorruptivo?: boolean;
  alquimiaCatalizador?: boolean;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItemCatalogo>;
function nombreItem(itemId: string): string {
  return ITEMS[itemId]?.nombre ?? itemId;
}

// Mismo umbral/prioridad que alquimia.ts::colorPocion — replicado aquí SOLO
// para el preview en vivo, la tirada real (efectos) la sigue decidiendo el
// servidor al colar; esto nunca decide el resultado, solo lo anticipa.
const CATALIZADORES_PARA_MEZCLA_AVANZADA = 3;
const NOMBRE_COLOR: Record<string, string> = {
  clara: "Clara", toxica: "Tóxica", vital: "Vital", inestable: "Inestable", radiante: "Radiante",
};
const HEX_COLOR: Record<string, string> = {
  clara: "#cbd0d8", toxica: "#7ec850", vital: "#e0507a", inestable: "#c9922a", radiante: "#e0c840",
};
function previsualizarColor(itemIds: string[]): string {
  const corruptivos = new Set(itemIds.filter((id) => ITEMS[id]?.alquimiaCorruptivo));
  const catalizadores = new Set(itemIds.filter((id) => ITEMS[id]?.alquimiaCatalizador));
  if (catalizadores.size >= CATALIZADORES_PARA_MEZCLA_AVANZADA) return "radiante";
  if (corruptivos.size > 0 && catalizadores.size > 0) return "inestable";
  if (corruptivos.size > 0) return "toxica";
  if (catalizadores.size > 0) return "vital";
  return "clara";
}

export interface ItemInventarioVista {
  instanciaId: number;
  itemId: string;
  cantidad: number;
}

export interface SesionAlquimiaVista {
  fase: string; // "TRABAJANDO" | "TERMINADO"
  temperatura: number;
  segundosEnVentana: number;
  segundosTotales: number;
}

export interface ConfigAlquimiaVista {
  temperaturaObjetivoMin: number;
  temperaturaObjetivoMax: number;
  duracionMinimaSeg: number;
}

export interface EfectoPocionVista {
  categoria: "stat" | "especial";
  stat?: string;
  especial?: string;
  magnitudPct?: number;
}

export interface ResultadoAlquimiaVista {
  itemId: string;
  pureza: number;
  efectos: EfectoPocionVista[];
  enSuelo: boolean;
}

export interface OpcionesPanelAlquimia {
  contenedor: HTMLElement;
  obtenerInventario(): ItemInventarioVista[];
  enviarIniciar(construccionId: number, instanciaIds: number[]): void;
  enviarAvivar(): void;
  enviarEnfriar(): void;
  enviarColar(): void;
  enviarCancelar(): void;
}

type Vista = { tipo: "seleccion" } | { tipo: "sesion" } | { tipo: "resultado"; resultado: ResultadoAlquimiaVista };

const NOMBRE_STAT: Record<string, string> = {
  ataqueFisico: "Ataque", defensaFisica: "Defensa", ataqueMagico: "Ataque mágico", defensaMagica: "Defensa mágica",
  velocidad: "Velocidad", vida: "Vida máxima", estamina: "Estamina máxima", carga: "Carga máxima",
};
const NOMBRE_ESPECIAL: Record<string, string> = {
  xpOficioX2: "XP de oficio ×2 (10 min)", produccionCrafteoX2: "Producción de crafteo ×2 (10 min)", sigilo: "Sigilo (10 min)",
};

export class PanelAlquimia {
  private marco: MarcoPanel;
  private construccionId: number | null = null;
  private vista: Vista = { tipo: "seleccion" };
  private seleccionados = new Set<number>();
  private cfg: ConfigAlquimiaVista | null = null;
  private sesion: SesionAlquimiaVista | null = null;
  private error: string | null = null;

  constructor(private opciones: OpcionesPanelAlquimia) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Alquimia", icono: "🧪", left: "50%", top: "50%", ancho: "380px" });
    this.marco.raiz.dataset.testid = "panel-alquimia";
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "82vh";
    this.marco.cuerpo.style.overflowY = "auto";
    this.marco.onCambioEstado(() => {
      if (!this.marco.estaAbierto()) {
        this.construccionId = null;
        this.seleccionados.clear();
        this.vista = { tipo: "seleccion" };
      }
    });
  }

  abrir(construccionId: number) {
    this.construccionId = construccionId;
    this.seleccionados.clear();
    this.vista = { tipo: "seleccion" };
    this.error = null;
    this.marco.abrir();
    this.render();
  }

  mostrarIniciado(cfg: ConfigAlquimiaVista, sesion: SesionAlquimiaVista) {
    if (!this.marco.estaAbierto()) return;
    this.cfg = cfg;
    this.sesion = sesion;
    this.vista = { tipo: "sesion" };
    this.error = null;
    this.render();
  }

  actualizarProgreso(sesion: SesionAlquimiaVista) {
    if (!this.marco.estaAbierto() || this.vista.tipo !== "sesion") return;
    this.sesion = sesion;
    this.render();
  }

  mostrarResultado(resultado: ResultadoAlquimiaVista) {
    this.vista = { tipo: "resultado", resultado };
    this.marco.abrir();
    this.render();
  }

  mostrarCancelado() {
    if (!this.marco.estaAbierto()) return;
    this.vista = { tipo: "seleccion" };
    this.seleccionados.clear();
    this.render();
  }

  mostrarError(motivo: string) {
    if (!this.marco.estaAbierto()) return;
    this.error = motivo;
    this.render();
  }

  private barra(pct: number, color: string, alto = "14px"): HTMLDivElement {
    const fondo = document.createElement("div");
    Object.assign(fondo.style, {
      position: "relative", height: alto, background: "rgba(255,255,255,0.12)",
      borderRadius: "4px", overflow: "hidden", margin: "3px 0 8px",
    } as CSSStyleDeclaration);
    const relleno = document.createElement("div");
    Object.assign(relleno.style, {
      position: "absolute", left: "0", top: "0", bottom: "0",
      width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width 0.15s linear",
    } as CSSStyleDeclaration);
    fondo.appendChild(relleno);
    return fondo;
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    if (this.error) {
      const av = crearLineaTexto(`⚠ ${this.error}`);
      av.style.color = "var(--panel-error, #c94a3a)";
      cuerpo.appendChild(av);
    }

    if (this.vista.tipo === "seleccion") this.renderSeleccion(cuerpo);
    else if (this.vista.tipo === "sesion") this.renderSesion(cuerpo);
    else this.renderResultado(cuerpo, this.vista.resultado);
  }

  private renderSeleccion(cuerpo: HTMLElement) {
    const inventario = this.opciones.obtenerInventario();
    const frasco = inventario.find((it) => it.itemId === "frasco_pocion");
    const ingredientes = inventario.filter((it) => {
      const e = ITEMS[it.itemId];
      return e?.alquimiaIngrediente || e?.alquimiaCorruptivo || e?.alquimiaCatalizador;
    });

    cuerpo.appendChild(crearLineaTexto("Elige entre 2 y 6 ingredientes de tu inventario.", { tenue: true, fontSize: "0.85em" }));
    cuerpo.appendChild(crearLineaTexto(
      frasco ? `🧴 Frasco de poción: ×${frasco.cantidad}` : "🧴 Sin frasco de poción — hace falta uno para preparar CUALQUIER poción",
      { negrita: !frasco },
    ));
    if (!frasco) cuerpo.querySelector<HTMLDivElement>("div:last-child")!.style.color = "var(--panel-error, #c94a3a)";

    if (ingredientes.length === 0) {
      cuerpo.appendChild(crearLineaTexto("No tienes ningún ingrediente de alquimia. Recolecta hierbas, hongos, flores o sal.", { tenue: true }));
    } else {
      cuerpo.appendChild(crearSubtitulo(`Ingredientes (${this.seleccionados.size}/6)`));
      for (const it of ingredientes) {
        const fila = document.createElement("label");
        Object.assign(fila.style, { display: "flex", alignItems: "center", gap: "6px", padding: "2px 0", cursor: "pointer" } as CSSStyleDeclaration);
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = this.seleccionados.has(it.instanciaId);
        check.addEventListener("change", () => {
          if (check.checked) {
            if (this.seleccionados.size >= 6) { check.checked = false; return; }
            this.seleccionados.add(it.instanciaId);
          } else {
            this.seleccionados.delete(it.instanciaId);
          }
          this.render();
        });
        const e = ITEMS[it.itemId];
        const tipo = e?.alquimiaCorruptivo ? "☣" : e?.alquimiaCatalizador ? "✨" : "•";
        const etiqueta = document.createElement("span");
        etiqueta.textContent = `${tipo} ${nombreItem(it.itemId)} ×${it.cantidad}`;
        fila.append(check, etiqueta);
        cuerpo.appendChild(fila);
      }
    }

    const itemIdsSeleccionados = ingredientes.filter((it) => this.seleccionados.has(it.instanciaId)).map((it) => it.itemId);
    if (itemIdsSeleccionados.length >= 2) {
      const color = previsualizarColor(itemIdsSeleccionados);
      const preview = crearLineaTexto(`Probable resultado: poción ${NOMBRE_COLOR[color]}`, { negrita: true });
      preview.style.color = HEX_COLOR[color];
      cuerpo.appendChild(preview);
    }

    const boton = crearBoton("🧪 Preparar poción", () => {
      if (this.construccionId === null) return;
      this.opciones.enviarIniciar(this.construccionId, [...this.seleccionados]);
    });
    boton.disabled = !frasco || this.seleccionados.size < 2 || this.seleccionados.size > 6;
    boton.style.marginTop = "6px";
    cuerpo.appendChild(boton);
  }

  private renderSesion(cuerpo: HTMLElement) {
    const cfg = this.cfg!, sesion = this.sesion!;
    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "8px";
    titulo.textContent = sesion.fase === "TERMINADO" ? "✅ Lista para colar" : "🔥 Manteniendo el fuego del caldero";
    cuerpo.appendChild(titulo);

    const etiquetaTemp = document.createElement("div");
    etiquetaTemp.textContent = `🌡 Temperatura: ${Math.round(sesion.temperatura)}° (óptima ${cfg.temperaturaObjetivoMin}–${cfg.temperaturaObjetivoMax}°)`;
    cuerpo.appendChild(etiquetaTemp);
    const enOptima = sesion.temperatura >= cfg.temperaturaObjetivoMin && sesion.temperatura <= cfg.temperaturaObjetivoMax;
    const colorTemp = enOptima ? "#7ec850" : sesion.temperatura < cfg.temperaturaObjetivoMin ? "#5a8ac9" : "#c94a3a";
    const barraTemp = this.barra(sesion.temperatura, colorTemp);
    const zonaOptima = document.createElement("div");
    Object.assign(zonaOptima.style, {
      position: "absolute", top: "0", bottom: "0",
      left: `${cfg.temperaturaObjetivoMin}%`, width: `${cfg.temperaturaObjetivoMax - cfg.temperaturaObjetivoMin}%`,
      border: "1px dashed rgba(255,255,255,0.6)", boxSizing: "border-box",
    } as CSSStyleDeclaration);
    barraTemp.appendChild(zonaOptima);
    cuerpo.appendChild(barraTemp);

    // "restante"/pctPureza son una FOTO del último mensaje del servidor
    // (avivar/enfriar/iniciado) — sin reloj local (evita el mismo bug ya
    // cerrado en panelCrafteo.ts: redibujar sin más cada 500ms detectaba
    // el botón como "detached" a media pulsación real de Playwright). El
    // botón Colar NUNCA se deshabilita por esto: si el jugador espera sin
    // tocar nada, el SERVIDOR es quien de verdad sabe cuánto tiempo real ha
    // pasado — "demasiado pronto" ya tiene su propio error (mostrarError).
    const restante = Math.max(0, cfg.duracionMinimaSeg - sesion.segundosTotales);
    const pctPureza = sesion.segundosTotales > 0 ? (sesion.segundosEnVentana / sesion.segundosTotales) * 100 : 0;
    cuerpo.appendChild(crearLineaTexto(
      restante > 0 ? `⏳ Cuece desde hace ${sesion.segundosTotales.toFixed(0)}s (mínimo ${cfg.duracionMinimaSeg}s) — ${pctPureza.toFixed(0)}% del tiempo en su punto` : `Lista — ${pctPureza.toFixed(0)}% del tiempo en su punto (define la pureza)`,
    ));

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "8px";
    botones.style.flexWrap = "wrap";
    botones.appendChild(crearBoton("🔥 Avivar", () => this.opciones.enviarAvivar()));
    botones.appendChild(crearBoton("💧 Enfriar", () => this.opciones.enviarEnfriar()));
    botones.appendChild(crearBoton("⚗ Colar", () => this.opciones.enviarColar()));
    botones.appendChild(crearBoton("✕ Cancelar", () => this.opciones.enviarCancelar()));
    cuerpo.appendChild(botones);
  }

  private renderResultado(cuerpo: HTMLElement, resultado: ResultadoAlquimiaVista) {
    const color = resultado.itemId.replace("pocion_alquimica_", "");
    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.style.color = HEX_COLOR[color] ?? "inherit";
    titulo.textContent = `⚗ Poción ${NOMBRE_COLOR[color] ?? color} preparada (pureza ${(resultado.pureza * 100).toFixed(0)}%)`;
    cuerpo.appendChild(titulo);

    for (const e of resultado.efectos) {
      if (e.categoria === "especial") {
        cuerpo.appendChild(crearLineaTexto(`✨ ${NOMBRE_ESPECIAL[e.especial!] ?? e.especial}`));
      } else {
        const positivo = (e.magnitudPct ?? 0) >= 0;
        const linea = crearLineaTexto(`${positivo ? "▲" : "▼"} ${NOMBRE_STAT[e.stat!] ?? e.stat} ${positivo ? "+" : ""}${e.magnitudPct!.toFixed(1)}%`);
        linea.style.color = positivo ? "#7ec850" : "#c94a3a";
        cuerpo.appendChild(linea);
      }
    }
    if (resultado.enSuelo) {
      cuerpo.appendChild(crearLineaTexto("Sin hueco en el inventario — cayó al suelo", { tenue: true }));
    }

    const cerrar = crearBoton("Preparar otra", () => {
      this.vista = { tipo: "seleccion" };
      this.seleccionados.clear();
      this.render();
    });
    cerrar.style.marginTop = "8px";
    cuerpo.appendChild(cerrar);
  }
}
