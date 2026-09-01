/**
 * Panel del reclutador de NPCs trabajadores (docs/GDD_NPCs_Contratables.md,
 * pedido 2026-09-01) — mismo patrón DOM flotante que el resto de paneles
 * pulidos de esta pasada (`panelSastreLegendario.ts`, `panelCofre.ts`): sin
 * preview 3D (aquí no se genera geometría, solo se contrata/asigna), pero
 * con la misma atención a mostrar SIEMPRE el coste/estado ANTES de que el
 * jugador confirme nada. Dos secciones: contratar (checkboxes de oficio +
 * coste marginal en vivo) y gestionar tus trabajadores ya contratados
 * (mesa/receta/próximo pago/despedir).
 */
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

export interface CatalogoReclutadorVista {
  oficios: string[];
  costePorCantidad: number[]; // costePorCantidad[i] = coste de contratar con (i+1) oficios
  salarioBasePorOficioMes: number;
  diasPorMesTrabajador: number;
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

export interface OpcionesPanelReclutador {
  contenedor: HTMLElement;
  diaMundoActual(): number;
  contratar(oficios: string[]): void;
  asignarMesaAqui(trabajadorId: number): void;
  asignarReceta(trabajadorId: number, recetaId: string | null): void;
  despedir(trabajadorId: number): void;
  transporteContratar(): void;
}

const COLOR_FONDO = "rgba(20,15,8,0.96)";
const COLOR_BORDE = "#8a6a2a";
const COLOR_TEXTO = "#f0e4c8";

export class PanelReclutador {
  private raiz: HTMLDivElement;
  private abierto = false;
  private catalogo: CatalogoReclutadorVista | null = null;
  private trabajadores: TrabajadorVista[] = [];
  private seleccion = new Set<string>();
  private ultimoError = "";

  constructor(private opciones: OpcionesPanelReclutador) {
    this.raiz = document.createElement("div");
    this.raiz.dataset.testid = "panel-reclutador";
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "50%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = COLOR_FONDO;
    this.raiz.style.color = COLOR_TEXTO;
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "14px 18px";
    this.raiz.style.borderRadius = "8px";
    this.raiz.style.border = `1px solid ${COLOR_BORDE}`;
    this.raiz.style.minWidth = "380px";
    this.raiz.style.maxWidth = "460px";
    this.raiz.style.maxHeight = "78vh";
    this.raiz.style.overflowY = "auto";
    this.raiz.style.zIndex = "50";
    this.raiz.hidden = true;
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  estaAbierto(): boolean {
    return this.abierto;
  }

  abrir() {
    this.abierto = true;
    this.render();
  }

  cerrar() {
    this.abierto = false;
    this.render();
  }

  alternar() {
    this.abierto = !this.abierto;
    this.render();
  }

  actualizarCatalogo(catalogo: CatalogoReclutadorVista) {
    this.catalogo = catalogo;
    this.render();
  }

  actualizarTrabajadores(trabajadores: TrabajadorVista[]) {
    this.trabajadores = trabajadores;
    this.render();
  }

  /** Refleja `trabajador:error` (incluye los de `reclutador:contratar`, mismo canal único — ver GDD §2). */
  mostrarError(motivo: string) {
    this.ultimoError = motivo;
    this.render();
  }

  private costeActual(): number {
    if (!this.catalogo || this.seleccion.size === 0) return 0;
    return this.catalogo.costePorCantidad[this.seleccion.size - 1] ?? 0;
  }

  /** Coste MARGINAL de añadir un oficio más a la selección actual (lo que costaría el próximo, no el total) — la fórmula solo depende de la CANTIDAD ya elegida, no de cuál oficio sea. */
  private costeMarginalSiguiente(): number {
    if (!this.catalogo) return 0;
    const n = this.seleccion.size;
    const actual = n === 0 ? 0 : this.catalogo.costePorCantidad[n - 1] ?? 0;
    const conUnoMas = this.catalogo.costePorCantidad[n] ?? actual;
    return conUnoMas - actual;
  }

  private salarioMensual(t: TrabajadorVista): number {
    return (this.catalogo?.salarioBasePorOficioMes ?? 15) * Math.max(1, t.oficios.length);
  }

  private seccionContratar(): HTMLElement {
    const seccion = document.createElement("div");
    seccion.style.marginBottom = "10px";
    seccion.style.paddingBottom = "10px";
    seccion.style.borderBottom = `1px solid #4a3f2a`;
    if (!this.catalogo) {
      seccion.textContent = "Cargando catálogo...";
      return seccion;
    }

    const sub = document.createElement("div");
    sub.style.opacity = "0.85";
    sub.style.marginBottom = "4px";
    sub.textContent = "Elige 1 o más oficios — cuantos más, más caro (el coste de cada oficio crece con el anterior):";
    seccion.appendChild(sub);

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
    resumen.style.background = "rgba(255,255,255,0.06)";
    resumen.style.borderRadius = "5px";
    const lineaCoste = document.createElement("div");
    lineaCoste.style.fontWeight = "bold";
    lineaCoste.textContent = `Coste total: ${this.costeActual()} Farycoins (${this.seleccion.size} oficio${this.seleccion.size === 1 ? "" : "s"})`;
    resumen.appendChild(lineaCoste);
    if (this.seleccion.size < this.catalogo.oficios.length) {
      const lineaMarginal = document.createElement("div");
      lineaMarginal.style.opacity = "0.8";
      lineaMarginal.style.fontSize = "11px";
      lineaMarginal.textContent = `+1 oficio más costaría ${this.costeMarginalSiguiente()} Farycoins adicionales`;
      resumen.appendChild(lineaMarginal);
    }
    const lineaSalario = document.createElement("div");
    lineaSalario.style.opacity = "0.8";
    lineaSalario.style.fontSize = "11px";
    const salarioEstim = this.catalogo.salarioBasePorOficioMes * Math.max(1, this.seleccion.size);
    lineaSalario.textContent = this.seleccion.size > 0
      ? `Salario mensual una vez contratado: ${salarioEstim} Farycoins/mes`
      : "";
    resumen.appendChild(lineaSalario);
    seccion.appendChild(resumen);

    const filaBotones = document.createElement("div");
    filaBotones.style.marginTop = "6px";
    const contratar = document.createElement("button");
    contratar.textContent = "Contratar";
    contratar.disabled = this.seleccion.size === 0;
    contratar.onclick = () => {
      this.opciones.contratar([...this.seleccion]);
      this.seleccion.clear();
      this.render();
    };
    filaBotones.appendChild(contratar);

    const transporte = document.createElement("button");
    transporte.textContent = "Contratar transporte...";
    transporte.style.marginLeft = "8px";
    transporte.onclick = () => this.opciones.transporteContratar();
    filaBotones.appendChild(transporte);
    seccion.appendChild(filaBotones);

    return seccion;
  }

  private filaTrabajador(t: TrabajadorVista): HTMLElement {
    const fila = document.createElement("div");
    fila.style.border = "1px solid #4a3f2a";
    fila.style.borderRadius = "5px";
    fila.style.padding = "7px 8px";
    fila.style.margin = "5px 0";

    const cab = document.createElement("div");
    cab.style.fontWeight = "bold";
    cab.textContent = `${t.nombre} — ${t.oficios.join(", ")}`;
    fila.appendChild(cab);

    const dia = this.opciones.diaMundoActual();
    const diasPorMes = this.catalogo?.diasPorMesTrabajador ?? 30;
    const proximoPagoDia = t.ultimoPagoDia + diasPorMes;
    const diasRestantes = Math.max(0, proximoPagoDia - dia);

    const estado = document.createElement("div");
    estado.style.opacity = "0.85";
    estado.style.fontSize = "11px";
    estado.style.margin = "2px 0";
    const nombreMesa = t.construccionId != null ? `#${t.construccionId}` : "sin asignar";
    const nombreReceta = t.recetaId ?? "sin asignar";
    estado.textContent = `Mesa: ${nombreMesa} · Receta: ${nombreReceta} · ${t.recetaId && t.construccionId != null ? "craftando" : "esperando"}`;
    fila.appendChild(estado);

    const pago = document.createElement("div");
    pago.style.opacity = "0.85";
    pago.style.fontSize = "11px";
    pago.style.margin = "2px 0 6px";
    pago.textContent = `Salario: ${this.salarioMensual(t)}₣/mes · próximo pago en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"} (día ${proximoPagoDia})`;
    fila.appendChild(pago);

    const acciones = document.createElement("div");
    acciones.style.display = "flex";
    acciones.style.flexWrap = "wrap";
    acciones.style.alignItems = "center";
    acciones.style.gap = "6px";

    const asignarMesa = document.createElement("button");
    asignarMesa.textContent = "Asignar mesa aquí";
    asignarMesa.title = "Asigna la construcción más cercana a ti ahora mismo";
    asignarMesa.onclick = () => this.opciones.asignarMesaAqui(t.id);
    acciones.appendChild(asignarMesa);

    // Selector de receta: solo las recetas de OFICIOS que este trabajador
    // tiene — el catálogo completo de mesas/recetas ya vive en
    // items/catalogo/recetas.json, no hace falta pedirlo al servidor. La
    // validación real (mesa compatible con la receta) la sigue haciendo el
    // servidor al recibir trabajador:asignarReceta.
    const selectReceta = document.createElement("select");
    selectReceta.style.maxWidth = "180px";
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

    const asignarReceta = document.createElement("button");
    asignarReceta.textContent = "Asignar receta";
    asignarReceta.onclick = () => this.opciones.asignarReceta(t.id, selectReceta.value || null);
    acciones.appendChild(asignarReceta);

    const despedir = document.createElement("button");
    despedir.textContent = "Despedir";
    despedir.style.marginLeft = "auto";
    despedir.style.color = "#e08080";
    despedir.onclick = () => this.opciones.despedir(t.id);
    acciones.appendChild(despedir);

    fila.appendChild(acciones);
    return fila;
  }

  private render() {
    this.raiz.innerHTML = "";
    if (!this.abierto) {
      this.raiz.hidden = true;
      return;
    }
    this.raiz.hidden = false;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.fontSize = "14px";
    titulo.style.marginBottom = "8px";
    titulo.textContent = "🧑‍🔧 Reclutador de trabajadores";
    this.raiz.appendChild(titulo);

    this.raiz.appendChild(this.seccionContratar());

    if (this.ultimoError) {
      const err = document.createElement("div");
      err.style.color = "#e08080";
      err.style.margin = "4px 0 8px";
      err.textContent = this.ultimoError;
      this.raiz.appendChild(err);
    }

    const listaTitulo = document.createElement("div");
    listaTitulo.style.fontWeight = "bold";
    listaTitulo.style.margin = "6px 0";
    listaTitulo.textContent = `Tus trabajadores (${this.trabajadores.length})`;
    this.raiz.appendChild(listaTitulo);

    if (this.trabajadores.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.6";
      vacio.textContent = "(ninguno todavía)";
      this.raiz.appendChild(vacio);
    } else {
      // "próximo pago del grupo" (docs/GDD_NPCs_Contratables.md §8: el
      // ancla es el ultimoPagoDia MÁS ANTIGUO del grupo — todos cobran de
      // golpe ese día) — informativo, el cálculo real vive en el servidor.
      const anclaMinima = Math.min(...this.trabajadores.map((t) => t.ultimoPagoDia));
      const diasPorMes = this.catalogo?.diasPorMesTrabajador ?? 30;
      const proximoPagoGrupo = anclaMinima + diasPorMes;
      const diasRestantes = Math.max(0, proximoPagoGrupo - this.opciones.diaMundoActual());
      const totalSalarios = this.trabajadores.reduce((s, t) => s + this.salarioMensual(t), 0);
      const avisoGrupo = document.createElement("div");
      avisoGrupo.style.opacity = "0.85";
      avisoGrupo.style.fontSize = "11px";
      avisoGrupo.style.marginBottom = "4px";
      avisoGrupo.textContent = `Próximo pago del grupo en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"} (día ${proximoPagoGrupo}) — ${totalSalarios}₣ de golpe`;
      this.raiz.appendChild(avisoGrupo);
    }

    for (const t of this.trabajadores) this.raiz.appendChild(this.filaTrabajador(t));

    const cerrar = document.createElement("div");
    cerrar.style.textAlign = "right";
    cerrar.style.marginTop = "10px";
    const boton = document.createElement("button");
    boton.textContent = "Cerrar";
    boton.onclick = () => this.cerrar();
    cerrar.appendChild(boton);
    this.raiz.appendChild(cerrar);
  }
}
