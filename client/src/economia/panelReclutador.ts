/**
 * Panel del reclutador de NPCs trabajadores (docs/GDD_NPCs_Contratables.md,
 * pedido 2026-09-01) — marco compartido (`panelBase.ts`, tema madera/
 * pergamino, X + clic fuera + Escape). Tres secciones: contratar (checkboxes
 * de oficio + coste marginal en vivo, incluye "transporte" desde la fusión
 * del pedido 2026-09-01) y gestionar tus trabajadores ya contratados —
 * mesa+receta para los oficios de mesa, RUTA origen→destino para
 * "transporte", ambos selectores poblados SOLO con construcciones reales
 * del jugador (`trabajador:misConstrucciones`, nunca inventadas) — y
 * despedir.
 *
 * `data-testid="panel-reclutador"` en `marco.raiz` (no en el `cuerpo`) es a
 * propósito: `client/test/panelReclutador.e2e.mjs` localiza selects con
 * `[data-testid="panel-reclutador"] select`, que sigue funcionando porque
 * `cuerpo` cuelga dentro de `raiz`.
 */
import { crearMarcoPanel, crearBoton, crearSubtitulo, crearLineaTexto } from "../ui/panelBase";
import recetasJson from "../../../items/catalogo/recetas.json";

interface RecetaCatalogo {
  oficio: string;
  mesas: string[];
  resultado: { itemId: string; cantidad: number };
}
const RECETAS = recetasJson as unknown as Record<string, RecetaCatalogo>;
/** Recetas agrupadas por oficio, calculado una vez — para el selector de receta filtrado a los oficios de cada trabajador. */
const RECETAS_POR_OFICIO = new Map<string, { id: string; etiqueta: string }[]>();
for (const [id, receta] of Object.entries(RECETAS)) {
  if (id.startsWith("_")) continue;
  const etiqueta = `${id} → ${receta.resultado.cantidad}x ${receta.resultado.itemId}`;
  if (!RECETAS_POR_OFICIO.has(receta.oficio)) RECETAS_POR_OFICIO.set(receta.oficio, []);
  RECETAS_POR_OFICIO.get(receta.oficio)!.push({ id, etiqueta });
}

/** Oficio de trabajador exclusivo para operar rutas (docs/GDD_NPCs_Contratables.md §Fusión con transporte) — nunca en OFICIOS_JUGADOR_VALIDOS del servidor, pero el catálogo del reclutador lo incluye igual que los 10 de mesa. */
const OFICIO_TRANSPORTE = "transporte";
/** Oficio de trabajador exclusivo del tenderete de mercado (docs/GDD_Mercado.md §12) — se plancha en un `puesto_mercado_jugador` con `asignarMesa`, sin receta. Más barato EN SOLITARIO que cualquier otro oficio (ver costeTenderoSolo/salarioTenderoSolo del catálogo). */
const OFICIO_TENDERO = "tendero";

export interface CatalogoReclutadorVista {
  oficios: string[];
  costePorCantidad: number[]; // costePorCantidad[i] = coste de contratar con (i+1) oficios
  salarioBasePorOficioMes: number;
  diasPorMesTrabajador: number;
  /** Mercado v2 (docs/GDD_Mercado.md §12) — coste/salario reales cuando la selección es EXACTAMENTE ["tendero"] (más barato que costePorCantidad[0]). */
  costeTenderoSolo: number;
  salarioTenderoSolo: number;
}

export interface TrabajadorVista {
  id: number;
  nombre: string;
  oficios: string[];
  construccionId: number | null;
  recetaId: string | null;
  fechaContratacionDia: number;
  ultimoPagoDia: number;
}

/** Ruta activa de un trabajador de oficio "transporte" (docs/GDD_NPCs_Contratables.md §Fusión con transporte) — viaja junto al listado de trabajadores, sin un segundo viaje de red. */
export interface RutaVista {
  trabajadorId: number;
  contratoId: number;
  origenConstruccionId: number;
  destinoTenderoteId: string;
  itemId: string;
}

/** Construcción real del jugador (docs/GDD_NPCs_Contratables.md §Panel de gestión) — para poblar los selectores de mesa/ruta, nunca una lista inventada. */
export interface ConstruccionVista {
  id: number;
  propiedad: string;
  objeto: string;
  categoria: string;
  esContenedor: boolean;
}

export interface OpcionesPanelReclutador {
  contenedor: HTMLElement;
  diaMundoActual(): number;
  contratar(oficios: string[]): void;
  asignarMesa(trabajadorId: number, construccionId: number): void;
  asignarReceta(trabajadorId: number, recetaId: string | null): void;
  asignarRuta(trabajadorId: number, origenConstruccionId: number, destino: { destinoConstruccionId?: number; destinoTenderoteId?: string }): void;
  despedir(trabajadorId: number): void;
  /** Pide `trabajador:misConstrucciones` — se llama al abrir el panel y tras cada acción, para que los selectores nunca queden desfasados. */
  refrescarConstrucciones(): void;
}

export class PanelReclutador {
  private readonly marco;
  private catalogo: CatalogoReclutadorVista | null = null;
  private trabajadores: TrabajadorVista[] = [];
  private rutas: RutaVista[] = [];
  private construcciones: ConstruccionVista[] = [];
  private seleccion = new Set<string>();
  private ultimoError = "";

  constructor(private opciones: OpcionesPanelReclutador) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Reclutador de trabajadores", icono: "🧑‍🔧", left: "50%", top: "50%", ancho: "420px" });
    this.marco.raiz.dataset.testid = "panel-reclutador";
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "78vh";
    this.render();
  }

  estaAbierto(): boolean {
    return this.marco.estaAbierto();
  }

  abrir() {
    this.opciones.refrescarConstrucciones();
    this.marco.abrir();
  }

  cerrar() {
    this.marco.cerrar();
  }

  alternar() {
    const abriendoAhora = !this.marco.estaAbierto();
    this.marco.alternar();
    if (abriendoAhora) this.opciones.refrescarConstrucciones();
  }

  actualizarCatalogo(catalogo: CatalogoReclutadorVista) {
    this.catalogo = catalogo;
    this.render();
  }

  actualizarTrabajadores(trabajadores: TrabajadorVista[], rutas: RutaVista[]) {
    this.trabajadores = trabajadores;
    this.rutas = rutas;
    this.render();
  }

  actualizarConstrucciones(construcciones: ConstruccionVista[]) {
    this.construcciones = construcciones;
    this.render();
  }

  /** Refleja `trabajador:error` (incluye los de `reclutador:contratar`, mismo canal único — ver GDD §2). */
  mostrarError(motivo: string) {
    this.ultimoError = motivo;
    this.render();
  }

  /** `true` si la selección actual es EXACTAMENTE un tendero en solitario (docs/GDD_Mercado.md §12) — el único caso con coste/salario propio, distinto de la fórmula genérica por cantidad. */
  private esTenderoSolo(): boolean {
    return this.seleccion.size === 1 && this.seleccion.has(OFICIO_TENDERO);
  }

  private costeActual(): number {
    if (!this.catalogo || this.seleccion.size === 0) return 0;
    if (this.esTenderoSolo()) return this.catalogo.costeTenderoSolo;
    return this.catalogo.costePorCantidad[this.seleccion.size - 1] ?? 0;
  }

  /** Coste MARGINAL de añadir un oficio más a la selección actual (lo que costaría el próximo, no el total) — la fórmula solo depende de la CANTIDAD ya elegida, no de cuál oficio sea (transporte incluido, mismo coste que cualquier otro — docs/GDD_NPCs_Contratables.md §Fusión con transporte). */
  private costeMarginalSiguiente(): number {
    if (!this.catalogo) return 0;
    const n = this.seleccion.size;
    const actual = n === 0 ? 0 : this.catalogo.costePorCantidad[n - 1] ?? 0;
    const conUnoMas = this.catalogo.costePorCantidad[n] ?? actual;
    return conUnoMas - actual;
  }

  private salarioMensual(t: TrabajadorVista): number {
    if (t.oficios.length === 1 && t.oficios[0] === OFICIO_TENDERO) return this.catalogo?.salarioTenderoSolo ?? 8;
    return (this.catalogo?.salarioBasePorOficioMes ?? 15) * Math.max(1, t.oficios.length);
  }

  private seccionContratar(): HTMLElement {
    const seccion = document.createElement("div");
    seccion.style.marginBottom = "10px";
    seccion.style.paddingBottom = "10px";
    seccion.style.borderBottom = "1px solid var(--panel-borde-tallado)";
    if (!this.catalogo) {
      seccion.textContent = "Cargando catálogo...";
      return seccion;
    }

    seccion.appendChild(crearLineaTexto("Elige 1 o más oficios — cuantos más, más caro (el coste de cada oficio crece con el anterior). \"transporte\" es un oficio más: el trabajador opera rutas en vez de una mesa.", { tenue: true, fontSize: "12px" }));

    for (const oficio of this.catalogo.oficios) {
      const fila = document.createElement("label");
      fila.style.display = "flex";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";
      fila.style.padding = "1px 0";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = this.seleccion.has(oficio);
      check.onchange = () => {
        if (check.checked) this.seleccion.add(oficio);
        else this.seleccion.delete(oficio);
        this.render();
      };
      fila.appendChild(check);
      const texto = document.createElement("span");
      texto.textContent = oficio;
      fila.appendChild(texto);
      seccion.appendChild(fila);
    }

    const resumen = document.createElement("div");
    resumen.style.margin = "8px 0 4px";
    resumen.style.padding = "6px 8px";
    resumen.style.background = "var(--panel-hover)";
    resumen.style.borderRadius = "5px";
    const lineaCoste = document.createElement("div");
    lineaCoste.style.fontWeight = "bold";
    lineaCoste.textContent = `Coste total: ${this.costeActual()} Farycoins (${this.seleccion.size} oficio${this.seleccion.size === 1 ? "" : "s"})`;
    resumen.appendChild(lineaCoste);
    if (this.seleccion.size < this.catalogo.oficios.length) {
      resumen.appendChild(crearLineaTexto(`+1 oficio más costaría ${this.costeMarginalSiguiente()} Farycoins adicionales`, { tenue: true, fontSize: "11px" }));
    }
    if (this.seleccion.size > 0) {
      const salarioEstim = this.esTenderoSolo()
        ? this.catalogo.salarioTenderoSolo
        : this.catalogo.salarioBasePorOficioMes * Math.max(1, this.seleccion.size);
      resumen.appendChild(crearLineaTexto(`Salario mensual una vez contratado: ${salarioEstim} Farycoins/mes`, { tenue: true, fontSize: "11px" }));
    }
    seccion.appendChild(resumen);

    const contratar = crearBoton("Contratar", () => {
      this.opciones.contratar([...this.seleccion]);
      this.seleccion.clear();
      this.render();
    });
    contratar.disabled = this.seleccion.size === 0;
    contratar.style.marginTop = "6px";
    seccion.appendChild(contratar);

    return seccion;
  }

  /** `<select>` de construcciones REALES del jugador (docs/GDD_NPCs_Contratables.md §Panel de gestión) — nunca una lista inventada, siempre `this.construcciones` (poblada desde `trabajador:misConstrucciones`). `filtro` opcional restringe a una categoría/tipo (p.ej. solo contenedores para destino de ruta). */
  private selectorConstrucciones(seleccionActual: number | null, filtro?: (c: ConstruccionVista) => boolean): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "panel-colony-input";
    select.style.maxWidth = "170px";
    const lista = filtro ? this.construcciones.filter(filtro) : this.construcciones;
    if (lista.length === 0) {
      const vacia = document.createElement("option");
      vacia.value = "";
      vacia.textContent = "(no tienes ninguna)";
      select.appendChild(vacia);
      select.disabled = true;
      return select;
    }
    for (const c of lista) {
      const opcion = document.createElement("option");
      opcion.value = String(c.id);
      opcion.textContent = `${c.objeto} #${c.id}`;
      if (c.id === seleccionActual) opcion.selected = true;
      select.appendChild(opcion);
    }
    return select;
  }

  private filaTrabajadorTransporte(t: TrabajadorVista): HTMLElement {
    const rutaActual = this.rutas.find((r) => r.trabajadorId === t.id) ?? null;

    const estado = crearLineaTexto(
      rutaActual
        ? `Ruta activa: construcción #${rutaActual.origenConstruccionId} → ${rutaActual.destinoTenderoteId} (transporta ${rutaActual.itemId})`
        : "Sin ruta asignada todavía",
      { tenue: true, fontSize: "11px" }
    );
    estado.style.margin = "2px 0 6px";

    const acciones = document.createElement("div");
    acciones.style.display = "flex";
    acciones.style.flexWrap = "wrap";
    acciones.style.alignItems = "center";
    acciones.style.gap = "6px";

    const etiquetaOrigen = document.createElement("span");
    etiquetaOrigen.style.opacity = "0.8";
    etiquetaOrigen.textContent = "Origen:";
    acciones.appendChild(etiquetaOrigen);
    const selectOrigen = this.selectorConstrucciones(rutaActual?.origenConstruccionId ?? null);
    acciones.appendChild(selectOrigen);

    const etiquetaDestino = document.createElement("span");
    etiquetaDestino.style.opacity = "0.8";
    etiquetaDestino.textContent = "Destino:";
    acciones.appendChild(etiquetaDestino);
    // el destino puede ser cualquier construcción propia (cofre, o su
    // propiedad como tenderete) — la distinción `esContenedor` la resuelve
    // este panel al enviar el mensaje, el jugador solo elige "dónde".
    const selectDestino = this.selectorConstrucciones(null, (c) => !rutaActual || c.id !== rutaActual.origenConstruccionId);
    acciones.appendChild(selectDestino);

    const asignar = crearBoton(rutaActual ? "Reasignar ruta" : "Asignar ruta", () => {
      const origenId = Number(selectOrigen.value);
      const destinoId = Number(selectDestino.value);
      if (!origenId || !destinoId) return;
      const destinoConstruccion = this.construcciones.find((c) => c.id === destinoId);
      const destino = destinoConstruccion?.esContenedor
        ? { destinoConstruccionId: destinoId }
        : { destinoTenderoteId: destinoConstruccion?.propiedad ?? "" };
      this.opciones.asignarRuta(t.id, origenId, destino);
    });
    asignar.disabled = this.construcciones.length === 0;
    acciones.appendChild(asignar);

    const despedir = crearBoton("Despedir", () => this.opciones.despedir(t.id));
    despedir.style.marginLeft = "auto";
    despedir.style.color = "var(--error-color)";
    acciones.appendChild(despedir);

    const contenedor = document.createElement("div");
    contenedor.appendChild(estado);
    contenedor.appendChild(acciones);
    return contenedor;
  }

  private filaTrabajadorMesa(t: TrabajadorVista): HTMLElement {
    const acciones = document.createElement("div");
    acciones.style.display = "flex";
    acciones.style.flexWrap = "wrap";
    acciones.style.alignItems = "center";
    acciones.style.gap = "6px";

    // Mesa: SOLO construcciones reales del jugador (docs/GDD_NPCs_Contratables.md
    // §Panel de gestión, pedido 2026-09-01) — antes era "la más cercana a
    // ti"; ahora un selector real, para poder reasignar sin desplazarse.
    const selectMesa = this.selectorConstrucciones(t.construccionId);
    acciones.appendChild(selectMesa);
    const asignarMesa = crearBoton("Asignar mesa", () => {
      const id = Number(selectMesa.value);
      if (id) this.opciones.asignarMesa(t.id, id);
    });
    asignarMesa.disabled = this.construcciones.length === 0;
    acciones.appendChild(asignarMesa);

    // Selector de receta: solo las recetas de OFICIOS que este trabajador
    // tiene — el catálogo completo de mesas/recetas ya vive en
    // items/catalogo/recetas.json, no hace falta pedirlo al servidor. La
    // validación real (mesa compatible con la receta) la sigue haciendo el
    // servidor al recibir trabajador:asignarReceta.
    const selectReceta = document.createElement("select");
    selectReceta.className = "panel-colony-input";
    selectReceta.style.maxWidth = "170px";
    const opcionVacia = document.createElement("option");
    opcionVacia.value = "";
    opcionVacia.textContent = "(sin receta)";
    selectReceta.appendChild(opcionVacia);
    for (const oficio of t.oficios) {
      for (const receta of RECETAS_POR_OFICIO.get(oficio) ?? []) {
        const opcion = document.createElement("option");
        opcion.value = receta.id;
        opcion.textContent = receta.etiqueta;
        if (receta.id === t.recetaId) opcion.selected = true;
        selectReceta.appendChild(opcion);
      }
    }
    acciones.appendChild(selectReceta);

    acciones.appendChild(crearBoton("Asignar receta", () => this.opciones.asignarReceta(t.id, selectReceta.value || null)));

    const despedir = crearBoton("Despedir", () => this.opciones.despedir(t.id));
    despedir.style.marginLeft = "auto";
    despedir.style.color = "var(--error-color)";
    acciones.appendChild(despedir);

    return acciones;
  }

  private filaTrabajador(t: TrabajadorVista): HTMLElement {
    const fila = document.createElement("div");
    fila.style.border = "1px solid var(--panel-borde-tallado)";
    fila.style.borderRadius = "5px";
    fila.style.padding = "7px 8px";
    fila.style.margin = "5px 0";

    const cab = document.createElement("div");
    cab.style.fontWeight = "bold";
    cab.textContent = `${t.nombre} — ${t.oficios.join(", ")}`;
    fila.appendChild(cab);

    const esTransporte = t.oficios.includes(OFICIO_TRANSPORTE);
    const dia = this.opciones.diaMundoActual();
    const diasPorMes = this.catalogo?.diasPorMesTrabajador ?? 30;
    const proximoPagoDia = t.ultimoPagoDia + diasPorMes;
    const diasRestantes = Math.max(0, proximoPagoDia - dia);

    if (!esTransporte) {
      const nombreMesa = t.construccionId != null ? `#${t.construccionId}` : "sin asignar";
      const nombreReceta = t.recetaId ?? "sin asignar";
      const estado = crearLineaTexto(`Mesa: ${nombreMesa} · Receta: ${nombreReceta} · ${t.recetaId && t.construccionId != null ? "craftando" : "esperando"}`, { tenue: true, fontSize: "11px" });
      estado.style.margin = "2px 0";
      fila.appendChild(estado);
    }

    // el salario mensual y el despido por impago aplican IGUAL a un
    // trabajador de "transporte" (docs/GDD_NPCs_Contratables.md §Fusión
    // con transporte) — se muestra el mismo aviso de pago que un oficio de mesa.
    const pago = crearLineaTexto(`Salario: ${this.salarioMensual(t)}₣/mes · próximo pago en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"} (día ${proximoPagoDia})`, { tenue: true, fontSize: "11px" });
    pago.style.margin = "2px 0 6px";
    fila.appendChild(pago);

    fila.appendChild(esTransporte ? this.filaTrabajadorTransporte(t) : this.filaTrabajadorMesa(t));
    return fila;
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    cuerpo.appendChild(this.seccionContratar());

    if (this.ultimoError) {
      const err = document.createElement("div");
      err.className = "panel-colony-error";
      err.style.margin = "4px 0 8px";
      err.textContent = this.ultimoError;
      cuerpo.appendChild(err);
    }

    cuerpo.appendChild(crearSubtitulo(`Tus trabajadores (${this.trabajadores.length})`));

    if (this.trabajadores.length === 0) {
      cuerpo.appendChild(crearLineaTexto("(ninguno todavía)", { tenue: true }));
    } else {
      // "próximo pago del grupo" (docs/GDD_NPCs_Contratables.md §8: el
      // ancla es el ultimoPagoDia MÁS ANTIGUO del grupo — todos cobran de
      // golpe ese día, transporte incluido) — informativo, el cálculo real
      // vive en el servidor.
      const anclaMinima = Math.min(...this.trabajadores.map((t) => t.ultimoPagoDia));
      const diasPorMes = this.catalogo?.diasPorMesTrabajador ?? 30;
      const proximoPagoGrupo = anclaMinima + diasPorMes;
      const diasRestantes = Math.max(0, proximoPagoGrupo - this.opciones.diaMundoActual());
      const totalSalarios = this.trabajadores.reduce((s, t) => s + this.salarioMensual(t), 0);
      cuerpo.appendChild(crearLineaTexto(`Próximo pago del grupo en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"} (día ${proximoPagoGrupo}) — ${totalSalarios}₣ de golpe`, { tenue: true, fontSize: "11px" }));
    }

    for (const t of this.trabajadores) cuerpo.appendChild(this.filaTrabajador(t));
  }
}
