/**
 * Panel de mascotas — PLACEHOLDER de testeo (docs/GDD_Mascotas.md, mismo
 * criterio ya pactado con el streamer para combate: "que sean placeholder
 * sencillas... al final del proyecto se hará toda la UI"). Solo texto y
 * botones, sin arte de mascotas todavía.
 *
 * DOM plano inyectado sobre el canvas, mismo patrón que panelCombate.ts.
 */

export interface MascotaVista {
  id: number;
  especieId: string;
  ubicacion: "siguiendo" | "propiedad";
  propiedadId: string | null;
  /** docs/GDD_Monturas.md — ya tiene silla puesta (mascota:ponerMontura), se puede montar. */
  montura: boolean;
}

export interface ProgresoDomesticar {
  veces: number;
  faltan: number;
}

export interface OpcionesPanelMascotas {
  contenedor: HTMLElement;
  llamar(mascotaId: number): void;
  dejarEnPropiedad(mascotaId: number, propiedadId: string): void;
  /** docs/GDD_Monturas.md — silla propia sobre esta mascota (sin mascotaId: el servidor auto-apunta igual, pero el botón ya sabe a cuál). */
  ponerMontura(mascotaId: number): void;
}

export class PanelMascotas {
  private raiz: HTMLDivElement;
  private mascotas: MascotaVista[] = [];
  private progreso: ProgresoDomesticar | null = null;

  constructor(private opciones: OpcionesPanelMascotas) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.right = "16px";
    this.raiz.style.top = "16px";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.minWidth = "220px";
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  /** Llamar al recibir "mascota:lista" del servidor. */
  actualizarListado(mascotas: MascotaVista[]) {
    this.mascotas = mascotas;
    this.render();
  }

  /** Llamar al recibir "mascota:progreso" (o null tras "mascota:domesticada"/al alejarse). */
  actualizarProgreso(progreso: ProgresoDomesticar | null) {
    this.progreso = progreso;
    this.render();
  }

  private render() {
    this.raiz.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "🐾 Mascotas";
    this.raiz.appendChild(titulo);

    const ayuda = document.createElement("div");
    ayuda.style.fontSize = "11px";
    ayuda.style.opacity = "0.8";
    ayuda.style.marginBottom = "6px";
    ayuda.textContent = "Tecla G: dar de comer (5 veces la convierte en tu mascota). Con silla puesta: N para ponérsela cerca, M para montar/desmontar, Espacio para saltar montado.";
    this.raiz.appendChild(ayuda);

    if (this.progreso) {
      const p = document.createElement("div");
      p.style.marginBottom = "8px";
      p.textContent = `Dándole de comer... faltan ${this.progreso.faltan} (${this.progreso.veces}/${this.progreso.veces + this.progreso.faltan})`;
      this.raiz.appendChild(p);
    }

    if (this.mascotas.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.textContent = "Todavía no tienes ninguna.";
      this.raiz.appendChild(vacio);
      return;
    }

    const lista = document.createElement("div");
    lista.style.display = "flex";
    lista.style.flexDirection = "column";
    lista.style.gap = "6px";
    for (const m of this.mascotas) {
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.alignItems = "center";
      fila.style.gap = "6px";

      const texto = document.createElement("span");
      const etiquetaMontura = m.montura ? " 🐴" : "";
      texto.textContent = `${m.especieId}${etiquetaMontura} (${m.ubicacion === "siguiendo" ? "te sigue" : `en propiedad ${m.propiedadId}`})`;
      fila.appendChild(texto);

      if (m.ubicacion === "propiedad") {
        const llamar = document.createElement("button");
        llamar.textContent = "Llamar";
        llamar.onclick = () => this.opciones.llamar(m.id);
        fila.appendChild(llamar);
      } else {
        // Montura (docs/GDD_Monturas.md): sin silla, ofrece ponérsela (el
        // servidor exige especie montable + un ítem esMontura en el
        // inventario — aquí solo se pide, igual que el resto del panel).
        if (!m.montura) {
          const ponerSilla = document.createElement("button");
          ponerSilla.textContent = "Poner silla";
          ponerSilla.onclick = () => this.opciones.ponerMontura(m.id);
          fila.appendChild(ponerSilla);
        }
        const dejar = document.createElement("button");
        dejar.textContent = "Dejar aquí";
        dejar.onclick = () => {
          const propiedadId = window.prompt("Id de la propiedad donde dejarla (docs/GDD_Propiedades.md):");
          if (propiedadId) this.opciones.dejarEnPropiedad(m.id, propiedadId);
        };
        fila.appendChild(dejar);
      }
      lista.appendChild(fila);
    }
    this.raiz.appendChild(lista);
  }
}
