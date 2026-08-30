/**
 * Panel de cocina — PLACEHOLDER de testeo (docs/GDD_Cocina.md, mismo
 * criterio de placeholder que el resto de esta pasada). Se muestra solo
 * al acercarse a una hoguera o vasija; cambia de forma según cuál sea
 * (hoguera: un solo campo "cocinar tal cual"; vasija: añadir ingredientes
 * + botón preparar, con la lista actual de la vasija).
 */

export interface IngredienteVista {
  itemId: string;
  cantidad: number;
}

export interface EstadoCocinaVista {
  esVasija: boolean;
  /** id libre desde cocina v2 (docs/GDD_Cocina.md) — cuenco/cazuela/olla/cuenco_grande/olla_grande/tinaja. */
  vasija?: string;
  capacidad?: number;
  hierveAgua?: boolean;
  ingredientes: IngredienteVista[];
  conAgua: boolean;
  hirviendo: boolean;
  segundosParaHervir: number;
}

/** Nombre legible del tipo de vasija para el título del panel — placeholder de testeo, sin traducción curada por id (cocina v2 puede añadir vasijas nuevas sin tocar este panel). */
function nombreVasija(vasija: string | undefined): string {
  if (!vasija) return "Vasija";
  return vasija.replace(/_/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export interface OpcionesPanelCocina {
  contenedor: HTMLElement;
  cocinarSimple(construccionId: number, instanciaId: number): void;
  llenarAgua(construccionId: number, instanciaId: number): void;
  anadir(construccionId: number, instanciaId: number, cantidad: number): void;
  preparar(construccionId: number): void;
}

export class PanelCocina {
  private raiz: HTMLDivElement;
  private construccionId: number | null = null;
  private estado: EstadoCocinaVista | null = null;
  /** Cuenta atrás LOCAL mientras hierve el agua — evita tener que preguntarle al servidor cada segundo solo para refrescar un número (docs/GDD_Cocina.md). */
  private temporizadorHervor: ReturnType<typeof setInterval> | null = null;

  constructor(private opciones: OpcionesPanelCocina) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.right = "16px";
    this.raiz.style.bottom = "180px";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.minWidth = "220px";
    this.raiz.hidden = true;
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  /** construccionId=null cuando el jugador ya no está junto a ninguna estación de cocina. */
  actualizarCercania(construccionId: number | null, esVasija: boolean, vasija?: string, capacidad?: number, hierveAgua?: boolean) {
    this.construccionId = construccionId;
    this.estado = construccionId == null ? null : { esVasija, vasija, capacidad, hierveAgua, ingredientes: [], conAgua: false, hirviendo: false, segundosParaHervir: 0 };
    this.pararTemporizador();
    this.render();
  }

  /** Llamar al recibir "cocina:estado" (agua/hervor/ingredientes actuales de la vasija). */
  actualizarEstado(parcial: { ingredientes: IngredienteVista[]; conAgua: boolean; hirviendo: boolean; segundosParaHervir: number }) {
    if (!this.estado) return;
    this.estado = { ...this.estado, ...parcial };
    this.pararTemporizador();
    if (this.estado.conAgua && !this.estado.hirviendo && this.estado.segundosParaHervir > 0) {
      this.temporizadorHervor = setInterval(() => {
        if (!this.estado) return this.pararTemporizador();
        if (this.estado.segundosParaHervir <= 1) {
          this.estado = { ...this.estado, hirviendo: true, segundosParaHervir: 0 };
          this.pararTemporizador();
        } else {
          this.estado = { ...this.estado, segundosParaHervir: this.estado.segundosParaHervir - 1 };
        }
        this.render();
      }, 1000);
    }
    this.render();
  }

  private pararTemporizador() {
    if (this.temporizadorHervor != null) clearInterval(this.temporizadorHervor);
    this.temporizadorHervor = null;
  }

  private render() {
    this.raiz.innerHTML = "";
    if (this.construccionId == null || !this.estado) {
      this.raiz.hidden = true;
      return;
    }
    this.raiz.hidden = false;
    const id = this.construccionId;
    const e = this.estado;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = e.esVasija ? `🍲 ${nombreVasija(e.vasija)}` : "🔥 Fuego";
    this.raiz.appendChild(titulo);

    if (!e.esVasija) {
      const ayuda = document.createElement("div");
      ayuda.style.fontSize = "11px";
      ayuda.style.opacity = "0.8";
      ayuda.style.marginBottom = "6px";
      ayuda.textContent = "Cocina un ingrediente tal cual, sin combinar.";
      this.raiz.appendChild(ayuda);

      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.gap = "6px";
      const input = document.createElement("input");
      input.type = "number";
      input.placeholder = "id ingrediente";
      input.style.width = "100px";
      fila.appendChild(input);
      const boton = document.createElement("button");
      boton.textContent = "Cocinar";
      boton.onclick = () => {
        const iid = Number(input.value);
        if (Number.isFinite(iid) && iid > 0) this.opciones.cocinarSimple(id, iid);
        input.value = "";
      };
      fila.appendChild(boton);
      this.raiz.appendChild(fila);
      return;
    }

    const ayuda = document.createElement("div");
    ayuda.style.fontSize = "11px";
    ayuda.style.opacity = "0.8";
    ayuda.style.marginBottom = "6px";
    ayuda.textContent = `Hasta ${e.capacidad} ingredientes distintos — mezclar planta y carne da bonus.`;
    this.raiz.appendChild(ayuda);

    // Cocina v2 (docs/GDD_Cocina.md): cuenco_barro_grande (sartén) y
    // tinaja_batidos no necesitan agua ni hervor — directo a añadir.
    if (e.hierveAgua !== false) {
      if (!e.conAgua) {
        // Líquidos (docs/GDD_Inventario.md §9, pedido 2026-08-30): ya no es
        // agua gratis — hay que meter un recipiente (cantimplora/cubo) CON
        // agua, se vacía entero como ingrediente. Placeholder de testeo:
        // input con el id de instancia a mano, mismo criterio que el resto.
        const filaAgua = document.createElement("div");
        filaAgua.style.display = "flex";
        filaAgua.style.gap = "6px";
        filaAgua.style.marginBottom = "6px";
        const inputRecipiente = document.createElement("input");
        inputRecipiente.type = "number";
        inputRecipiente.placeholder = "id recipiente con agua";
        inputRecipiente.style.width = "150px";
        filaAgua.appendChild(inputRecipiente);
        const llenar = document.createElement("button");
        llenar.textContent = "💧 Meter agua y poner al fuego";
        llenar.onclick = () => {
          const iid = Number(inputRecipiente.value);
          if (Number.isFinite(iid) && iid > 0) this.opciones.llenarAgua(id, iid);
          inputRecipiente.value = "";
        };
        filaAgua.appendChild(llenar);
        this.raiz.appendChild(filaAgua);
        return;
      }
      if (!e.hirviendo) {
        const esperando = document.createElement("div");
        esperando.style.marginBottom = "6px";
        esperando.textContent = `🔥 Calentando... ${e.segundosParaHervir}s`;
        this.raiz.appendChild(esperando);
        return;
      }
    }

    if (e.ingredientes.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.style.marginBottom = "6px";
      vacio.textContent = "(vacía)";
      this.raiz.appendChild(vacio);
    } else {
      for (const ing of e.ingredientes) {
        const fila = document.createElement("div");
        fila.textContent = `${ing.itemId} x${ing.cantidad}`;
        this.raiz.appendChild(fila);
      }
    }

    const filaAnadir = document.createElement("div");
    filaAnadir.style.display = "flex";
    filaAnadir.style.gap = "6px";
    filaAnadir.style.margin = "8px 0";
    const inputId = document.createElement("input");
    inputId.type = "number";
    inputId.placeholder = "id ingrediente";
    inputId.style.width = "90px";
    const inputCantidad = document.createElement("input");
    inputCantidad.type = "number";
    inputCantidad.placeholder = "cantidad";
    inputCantidad.style.width = "70px";
    filaAnadir.appendChild(inputId);
    filaAnadir.appendChild(inputCantidad);
    const botonAnadir = document.createElement("button");
    botonAnadir.textContent = "Añadir";
    botonAnadir.onclick = () => {
      const iid = Number(inputId.value);
      const cantidad = Number(inputCantidad.value) || 1;
      if (Number.isFinite(iid) && iid > 0) this.opciones.anadir(id, iid, cantidad);
      inputId.value = "";
      inputCantidad.value = "";
    };
    filaAnadir.appendChild(botonAnadir);
    this.raiz.appendChild(filaAnadir);

    const preparar = document.createElement("button");
    preparar.textContent = "Preparar plato";
    preparar.disabled = e.ingredientes.length === 0;
    preparar.onclick = () => this.opciones.preparar(id);
    this.raiz.appendChild(preparar);
  }
}
