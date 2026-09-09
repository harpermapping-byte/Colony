/**
 * Panel de mascotas — PLACEHOLDER de testeo (docs/GDD_Mascotas.md, mismo
 * criterio ya pactado con el streamer para combate: "que sean placeholder
 * sencillas... al final del proyecto se hará toda la UI"). Solo texto y
 * botones, sin arte de mascotas todavía.
 *
 * DOM plano inyectado sobre el canvas, mismo patrón que panelCombate.ts.
 */
import { crearMarcoPanel, type MarcoPanel } from "../ui/panelBase";

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
  private readonly marco: MarcoPanel;
  private mascotas: MascotaVista[] = [];
  private progreso: ProgresoDomesticar | null = null;

  constructor(private opciones: OpcionesPanelMascotas) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Mascotas", icono: "🐾", top: "16px" });
    // Esquina superior-derecha, misma zona que ocupaba antes de migrar.
    this.marco.raiz.style.left = "auto";
    this.marco.raiz.style.right = "16px";
    this.render();
  }

  alternar() {
    this.marco.alternar();
  }

  estaAbierto() {
    return this.marco.estaAbierto();
  }

  onCambioEstado(cb: () => void) {
    this.marco.onCambioEstado(cb);
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
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    const ayuda = document.createElement("div");
    ayuda.style.fontSize = "11px";
    ayuda.style.opacity = "0.8";
    ayuda.style.marginBottom = "6px";
    ayuda.textContent = "Tecla G: dar de comer (5 veces la convierte en tu mascota). Con silla puesta: N para ponérsela cerca, M para montar/desmontar, Espacio para saltar montado.";
    cuerpo.appendChild(ayuda);

    if (this.progreso) {
      const p = document.createElement("div");
      p.style.marginBottom = "8px";
      p.textContent = `Dándole de comer... faltan ${this.progreso.faltan} (${this.progreso.veces}/${this.progreso.veces + this.progreso.faltan})`;
      cuerpo.appendChild(p);
    }

    if (this.mascotas.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.textContent = "Todavía no tienes ninguna.";
      cuerpo.appendChild(vacio);
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
        llamar.className = "panel-colony-boton";
        llamar.textContent = "Llamar";
        llamar.onclick = () => this.opciones.llamar(m.id);
        fila.appendChild(llamar);
      } else {
        // Montura (docs/GDD_Monturas.md): sin silla, ofrece ponérsela (el
        // servidor exige especie montable + un ítem esMontura en el
        // inventario — aquí solo se pide, igual que el resto del panel).
        if (!m.montura) {
          const ponerSilla = document.createElement("button");
          ponerSilla.className = "panel-colony-boton";
          ponerSilla.textContent = "Poner silla";
          ponerSilla.onclick = () => this.opciones.ponerMontura(m.id);
          fila.appendChild(ponerSilla);
        }
        const dejar = document.createElement("button");
        dejar.className = "panel-colony-boton";
        dejar.textContent = "Dejar aquí";
        dejar.onclick = () => {
          const propiedadId = window.prompt("Id de la propiedad donde dejarla (docs/GDD_Propiedades.md):");
          if (propiedadId) this.opciones.dejarEnPropiedad(m.id, propiedadId);
        };
        fila.appendChild(dejar);
      }
      lista.appendChild(fila);
    }
    cuerpo.appendChild(lista);
  }
}
