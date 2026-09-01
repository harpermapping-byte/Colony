/**
 * Panel del reclutador de NPCs trabajadores (docs/GDD_NPCs_Contratables.md,
 * pedido 2026-09-01) — PLACEHOLDER de testeo, MISMO criterio ya pactado
 * para comercio/combate/mascotas ("placeholders sencillas, la UI final va
 * al final del proyecto"): DOM plano inyectado sobre el canvas, mismo
 * patrón que panelComercio.ts. Dos secciones: contratar (checkboxes de
 * oficio + coste en vivo) y gestionar tus trabajadores ya contratados
 * (asignar la mesa/receta, despedir).
 */

export interface CatalogoReclutadorVista {
  oficios: string[];
  costePorCantidad: number[]; // costePorCantidad[i] = coste de contratar con (i+1) oficios
}

export interface TrabajadorVista {
  id: number;
  nombre: string;
  oficios: string[];
  construccionId: number | null;
  recetaId: string | null;
}

export interface OpcionesPanelReclutador {
  contenedor: HTMLElement;
  contratar(oficios: string[]): void;
  asignarMesaAqui(trabajadorId: number): void;
  asignarReceta(trabajadorId: number, recetaId: string | null): void;
  despedir(trabajadorId: number): void;
  transporteContratar(): void;
}

export class PanelReclutador {
  private raiz: HTMLDivElement;
  private abierto = false;
  private catalogo: CatalogoReclutadorVista | null = null;
  private trabajadores: TrabajadorVista[] = [];
  private seleccion = new Set<string>();

  constructor(private opciones: OpcionesPanelReclutador) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "50%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = "rgba(20,16,10,0.94)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "14px 18px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.minWidth = "360px";
    this.raiz.style.maxHeight = "70vh";
    this.raiz.style.overflowY = "auto";
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

  private costeActual(): number {
    if (!this.catalogo || this.seleccion.size === 0) return 0;
    return this.catalogo.costePorCantidad[this.seleccion.size - 1] ?? 0;
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
    titulo.style.marginBottom = "8px";
    titulo.textContent = "🧑‍🔧 Reclutador de trabajadores";
    this.raiz.appendChild(titulo);

    if (this.catalogo) {
      const seccion = document.createElement("div");
      seccion.style.marginBottom = "10px";
      seccion.style.paddingBottom = "10px";
      seccion.style.borderBottom = "1px solid #4a3f2a";

      const sub = document.createElement("div");
      sub.style.opacity = "0.85";
      sub.style.marginBottom = "4px";
      sub.textContent = "Elige 1 o más oficios — cuantos más, más caro:";
      seccion.appendChild(sub);

      for (const oficio of this.catalogo.oficios) {
        const fila = document.createElement("label");
        fila.style.display = "flex";
        fila.style.alignItems = "center";
        fila.style.gap = "6px";
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

      const filaCoste = document.createElement("div");
      filaCoste.style.margin = "6px 0";
      filaCoste.textContent = `Coste: ${this.costeActual()} Farycoins`;
      seccion.appendChild(filaCoste);

      const contratar = document.createElement("button");
      contratar.textContent = "Contratar";
      contratar.disabled = this.seleccion.size === 0;
      contratar.onclick = () => {
        this.opciones.contratar([...this.seleccion]);
        this.seleccion.clear();
        this.render();
      };
      seccion.appendChild(contratar);

      const transporte = document.createElement("button");
      transporte.textContent = "Contratar transporte...";
      transporte.style.marginLeft = "8px";
      transporte.onclick = () => this.opciones.transporteContratar();
      seccion.appendChild(transporte);

      this.raiz.appendChild(seccion);
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
    }

    for (const t of this.trabajadores) {
      const fila = document.createElement("div");
      fila.style.border = "1px solid #4a3f2a";
      fila.style.borderRadius = "4px";
      fila.style.padding = "6px";
      fila.style.margin = "4px 0";

      const cab = document.createElement("div");
      cab.textContent = `${t.nombre} — ${t.oficios.join(", ")}`;
      fila.appendChild(cab);

      const estado = document.createElement("div");
      estado.style.opacity = "0.8";
      estado.style.fontSize = "11px";
      estado.textContent = `Mesa: ${t.construccionId ?? "sin asignar"} · Receta: ${t.recetaId ?? "sin asignar"}`;
      fila.appendChild(estado);

      const acciones = document.createElement("div");
      acciones.style.display = "flex";
      acciones.style.gap = "6px";
      acciones.style.marginTop = "4px";

      const asignarMesa = document.createElement("button");
      asignarMesa.textContent = "Asignar mesa aquí";
      asignarMesa.onclick = () => this.opciones.asignarMesaAqui(t.id);
      acciones.appendChild(asignarMesa);

      const inputReceta = document.createElement("input");
      inputReceta.type = "text";
      inputReceta.placeholder = "id de receta";
      inputReceta.style.width = "110px";
      inputReceta.value = t.recetaId ?? "";
      acciones.appendChild(inputReceta);

      const asignarReceta = document.createElement("button");
      asignarReceta.textContent = "Asignar receta";
      asignarReceta.onclick = () => this.opciones.asignarReceta(t.id, inputReceta.value.trim() || null);
      acciones.appendChild(asignarReceta);

      const despedir = document.createElement("button");
      despedir.textContent = "Despedir";
      despedir.onclick = () => this.opciones.despedir(t.id);
      acciones.appendChild(despedir);

      fila.appendChild(acciones);
      this.raiz.appendChild(fila);
    }

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
