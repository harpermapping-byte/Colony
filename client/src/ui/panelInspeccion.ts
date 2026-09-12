/**
 * Panel de inspección (docs/GDD_UI_Paneles.md, pedido streamer 2026-09-12:
 * "al darle click sobre [un NPC/animal] podrás ver INFO sobre ese pj,
 * ciudad al que pertenece, nombre, oficio etc, familia si tiene esas
 * cosas") — mismo marco compartido que `panelCofre.ts` (tarjeta pequeña
 * cerca del centro, no a pantalla completa), SIN icono de dock: no hay
 * nada que alternar cuando no se está inspeccionando a nadie, se abre solo
 * al clicar (mismo criterio que panelCofre/panelTenderete).
 *
 * Deliberadamente genérico por FILAS (etiqueta+valor) en vez de una vista
 * por tipo — jugador/NPC/animal/mascota/compañero/enemigo/árbol comparten
 * el mismo "nombre + unas pocas líneas de datos", así que un único
 * `abrir(titulo, filas)` sirve para los siete sin duplicar HTML.
 */
import { crearMarcoPanel, type MarcoPanel } from "./panelBase";

export interface FilaInspeccion {
  etiqueta: string;
  valor: string;
}

export class PanelInspeccion {
  private readonly marco: MarcoPanel;

  constructor(contenedor: HTMLElement) {
    this.marco = crearMarcoPanel({ contenedor, titulo: "Inspeccionar", icono: "🔍", left: "50%", top: "30%", ancho: "260px" });
    this.marco.raiz.dataset.testid = "panel-inspeccion";
  }

  /** `icono` decora la cabecera (🧑 jugador, 🐾 animal, 🌳 árbol...) — puramente cosmético. */
  abrir(titulo: string, filas: FilaInspeccion[], icono = "🔍") {
    this.marco.cuerpo.innerHTML = "";
    const tabla = document.createElement("div");
    if (filas.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.opacity = "0.7";
      vacio.style.fontSize = "12px";
      vacio.textContent = "Sin más información.";
      tabla.appendChild(vacio);
    }
    for (const fila of filas) {
      const linea = document.createElement("div");
      linea.style.fontSize = "12px";
      linea.style.marginBottom = "4px";
      linea.style.display = "flex";
      linea.style.justifyContent = "space-between";
      linea.style.gap = "10px";
      const etiqueta = document.createElement("span");
      etiqueta.style.opacity = "0.75";
      etiqueta.textContent = fila.etiqueta;
      const valor = document.createElement("span");
      valor.style.fontWeight = "bold";
      valor.style.textAlign = "right";
      valor.textContent = fila.valor;
      linea.appendChild(etiqueta);
      linea.appendChild(valor);
      tabla.appendChild(linea);
    }
    this.marco.cuerpo.appendChild(tabla);
    (this.marco.raiz.querySelector(".panel-colony-cabecera span") as HTMLElement | null)?.replaceChildren(document.createTextNode(`${icono} ${titulo}`));
    this.marco.abrir();
  }

  /** "Cargando…" mientras se espera la respuesta del servidor (NPC, ver npc:inspeccionar) — evita un parpadeo en blanco. */
  abrirCargando(titulo: string, icono = "🔍") {
    this.abrir(titulo, [{ etiqueta: "", valor: "Cargando…" }], icono);
  }

  cerrar() {
    this.marco.cerrar();
  }
}
