/**
 * Panel de la mesa de AJEDREZ (docs/GDD_Mesas_Minijuego.md) — PLACEHOLDER
 * de testeo, mismo espíritu que `combate/panelCombate.ts`: "que sean
 * placeholder sencillas, la UI de verdad es una pasada final aparte". DOM
 * plano inyectado, sin framework.
 *
 * Tablero con glifos unicode de ajedrez (♔♕♖♗♘♙ / ♚♛♜♝♞♟) leídos
 * directamente del campo FEN replicado — SIEMPRE en orientación blancas
 * abajo/negras arriba para los DOS jugadores (simplificación deliberada de
 * placeholder: voltear el tablero para negras es una mejora visual pura,
 * cero cambio de protocolo, queda para la pasada de UI final). El cliente
 * NUNCA valida una jugada — clic origen + clic destino solo PROPONE
 * "mesa:mover"; si es ilegal, el servidor responde "mesa:error" y el
 * tablero no cambia (se re-pinta siempre desde el `fen` autoritativo).
 *
 * Chrome visual migrado al marco compartido (pedido streamer 2026-09-09,
 * "TODA pantalla... debe salir así con esta estética") — solo el
 * marco/cabecera/fondo que envuelve al tablero, el tablero en sí sigue con
 * sus propias casillas claras/oscuras y glifos (eso NO es "chrome", es la
 * pieza interactiva real, se deja intacta). `actualizar()` sigue siendo la
 * ÚNICA entrada pública, llamada en cada cambio de `room.state.mesasAjedrez`
 * — abre/cierra el marco según haya o no una mesa propia activa, así que un
 * clic en la X/fuera/Escape se sobrescribe en el siguiente patch de red
 * mientras se siga sentado (mismo comportamiento de fondo que ya tenía:
 * antes de esta migración tampoco había forma de ocultarlo sin levantarse).
 */
import { crearMarcoPanel, crearBoton, type MarcoPanel } from "../ui/panelBase";

export interface MesaAjedrezVista {
  sillaBlancas: string;
  sillaNegras: string;
  fen: string;
  fase: string; // "esperando" | "activo" | "terminado"
  turnoDe: string;
  ganador: string; // "" | "blancas" | "negras" | "tablas"
}

type MapaMesasAjedrez = Map<string, MesaAjedrezVista> | { entries(): IterableIterator<[string, MesaAjedrezVista]> };

export interface OpcionesPanelAjedrez {
  contenedor: HTMLElement;
  sessionIdPropio: string;
  enviarMover(construccionId: number, desde: string, hasta: string, promocion?: string): void;
  enviarLevantarse(): void;
}

const GLIFOS: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const FILAS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export class PanelAjedrez {
  private readonly marco: MarcoPanel;
  private readonly celdas: HTMLDivElement[] = []; // 64, orden: rank8->rank1, a->h (mismo orden que el FEN)
  private readonly lineaEstado: HTMLDivElement;
  private readonly lineaGanador: HTMLDivElement;

  private construccionIdActivo: number | null = null;
  private colorPropio: "w" | "b" | null = null;
  private seleccionada: string | null = null;
  private ultimoFen = "";

  constructor(private readonly opciones: OpcionesPanelAjedrez) {
    this.inyectarEstilos();

    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Ajedrez", icono: "♟️", left: "50%", top: "50%" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.cuerpo.style.textAlign = "center";
    // Clase extra (además de "panel-colony" del marco compartido) — un e2e
    // real (client/test/mesaAjedrez.e2e.cjs) espera ".panel-ajedrez" para
    // esperar a que el panel esté visible; se conserva para no romperlo.
    this.marco.raiz.classList.add("panel-ajedrez");

    this.lineaEstado = document.createElement("div");
    this.lineaEstado.className = "ajedrez-estado";
    this.marco.cuerpo.appendChild(this.lineaEstado);

    this.lineaGanador = document.createElement("div");
    this.lineaGanador.className = "ajedrez-ganador";
    this.lineaGanador.style.display = "none";
    this.marco.cuerpo.appendChild(this.lineaGanador);

    const tablero = document.createElement("div");
    tablero.className = "tablero-ajedrez";
    for (let i = 0; i < 64; i++) {
      const fila = Math.floor(i / 8);
      const col = i % 8;
      const celda = document.createElement("div");
      celda.className = `celda ${(fila + col) % 2 === 0 ? "clara" : "oscura"}`;
      // atributo estable para que un test (Playwright) pueda apuntar a una
      // casilla real por notación algebraica sin depender del índice interno
      celda.dataset.casilla = `${FILAS[col]}${8 - fila}`;
      celda.addEventListener("click", () => this.alClicCelda(i));
      tablero.appendChild(celda);
      this.celdas.push(celda);
    }
    this.marco.cuerpo.appendChild(tablero);

    const levantarse = crearBoton("Levantarse", () => opciones.enviarLevantarse());
    levantarse.style.marginTop = "10px";
    this.marco.cuerpo.appendChild(levantarse);
  }

  /** Llamar cada vez que cambie `room.state.mesasAjedrez` (onAdd/onRemove/onStateChange) — mismo patrón que PanelCombate.actualizar. */
  actualizar(mesasAjedrez: MapaMesasAjedrez): void {
    let id: string | null = null;
    let mesa: MesaAjedrezVista | null = null;
    for (const [mid, m] of mesasAjedrez.entries()) {
      if (m.sillaBlancas === this.opciones.sessionIdPropio || m.sillaNegras === this.opciones.sessionIdPropio) {
        id = mid;
        mesa = m;
        break;
      }
    }
    this.construccionIdActivo = id !== null ? Number(id) : null;

    if (!mesa) {
      this.marco.cerrar();
      this.seleccionada = null;
      return;
    }
    this.marco.abrir();
    this.colorPropio = mesa.sillaBlancas === this.opciones.sessionIdPropio ? "w" : "b";
    this.renderizar(mesa);
  }

  private renderizar(mesa: MesaAjedrezVista): void {
    if (mesa.fen !== this.ultimoFen) {
      this.seleccionada = null; // el tablero cambió de verdad (jugada propia o del rival): cualquier selección vieja ya no vale
      this.ultimoFen = mesa.fen;
    }
    this.pintarTablero(mesa.fen);

    if (mesa.fase === "esperando") {
      this.lineaEstado.textContent = `Sentado como ${this.colorPropio === "w" ? "blancas" : "negras"} — esperando rival...`;
      this.lineaGanador.style.display = "none";
    } else if (mesa.fase === "activo") {
      const esMiTurno = mesa.turnoDe === this.opciones.sessionIdPropio;
      this.lineaEstado.textContent = esMiTurno ? "Tu turno" : "Turno del rival";
      this.lineaGanador.style.display = "none";
    } else {
      // "terminado"
      const textoGanador =
        mesa.ganador === "tablas" ? "Tablas" : mesa.ganador === "blancas" ? "Jaque mate — ganan blancas" : "Jaque mate — ganan negras";
      this.lineaEstado.textContent = "Partida terminada";
      this.lineaGanador.textContent = textoGanador;
      this.lineaGanador.style.display = "block";
    }

    for (const celda of this.celdas) celda.classList.remove("sel");
    if (this.seleccionada) {
      const idx = this.indiceDeCasilla(this.seleccionada);
      if (idx !== null) this.celdas[idx].classList.add("sel");
    }
  }

  private pintarTablero(fen: string): void {
    const filasFen = fen.split(" ")[0].split("/"); // rank8 -> rank1
    let i = 0;
    for (const filaFen of filasFen) {
      for (const c of filaFen) {
        if (/\d/.test(c)) {
          const vacias = Number(c);
          for (let k = 0; k < vacias; k++) {
            this.celdas[i].textContent = "";
            i++;
          }
        } else {
          this.celdas[i].textContent = GLIFOS[c] ?? "";
          this.celdas[i].classList.toggle("pieza-blanca", c === c.toUpperCase());
          this.celdas[i].classList.toggle("pieza-negra", c === c.toLowerCase());
          i++;
        }
      }
    }
  }

  /** índice de celda 0-63 (orden rank8->rank1, a->h) <-> notación algebraica "e4". */
  private casillaDeIndice(idx: number): string {
    const fila = Math.floor(idx / 8); // 0 = rank8
    const col = idx % 8; // 0 = file a
    return `${FILAS[col]}${8 - fila}`;
  }

  private indiceDeCasilla(casilla: string): number | null {
    const col = FILAS.indexOf(casilla[0]);
    const rank = Number(casilla[1]);
    if (col === -1 || !rank) return null;
    return (8 - rank) * 8 + col;
  }

  private alClicCelda(idx: number): void {
    if (this.construccionIdActivo === null) return;
    const casilla = this.casillaDeIndice(idx);
    if (!this.seleccionada) {
      // Solo se puede EMPEZAR una selección sobre una pieza propia — el
      // cliente no valida jugadas, pero elegir sí filtra por color/turno
      // (mismo criterio que el resto del proyecto: feedback instantáneo,
      // la verdad final la dicta el servidor con "mesa:error" si discrepa).
      const esPropia = this.colorPropio === "w" ? this.celdas[idx].classList.contains("pieza-blanca") : this.celdas[idx].classList.contains("pieza-negra");
      if (esPropia) this.seleccionada = casilla;
      this.pintarSeleccion();
      return;
    }
    if (this.seleccionada === casilla) {
      this.seleccionada = null; // clic sobre la misma pieza: deseleccionar
      this.pintarSeleccion();
      return;
    }
    const desde = this.seleccionada;
    this.seleccionada = null;
    this.opciones.enviarMover(this.construccionIdActivo, desde, casilla);
    this.pintarSeleccion();
  }

  private pintarSeleccion(): void {
    for (const celda of this.celdas) celda.classList.remove("sel");
    if (this.seleccionada) {
      const idx = this.indiceDeCasilla(this.seleccionada);
      if (idx !== null) this.celdas[idx].classList.add("sel");
    }
  }

  private inyectarEstilos(): void {
    if (document.getElementById("estilos-ajedrez")) return;
    const estilos = document.createElement("style");
    estilos.id = "estilos-ajedrez";
    estilos.textContent = `
      .ajedrez-estado{margin-bottom:6px;min-height:16px}
      .ajedrez-ganador{margin-bottom:8px;font-weight:bold;color:var(--panel-acento)}
      .tablero-ajedrez{display:grid;grid-template-columns:repeat(8,40px);grid-template-rows:repeat(8,40px);
        border:2px solid #3a2f1e;margin:0 auto}
      .tablero-ajedrez .celda{display:flex;align-items:center;justify-content:center;
        font-size:28px;line-height:1;cursor:pointer;user-select:none}
      .tablero-ajedrez .celda.clara{background:#e8d9b5}
      .tablero-ajedrez .celda.oscura{background:#8a6a42}
      .tablero-ajedrez .celda.pieza-blanca{color:#fdfdfd;text-shadow:0 0 2px #000,0 0 1px #000}
      .tablero-ajedrez .celda.pieza-negra{color:#141414;text-shadow:0 0 2px #fff}
      .tablero-ajedrez .celda.sel{box-shadow:inset 0 0 0 3px #3ddc78}`;
    document.head.appendChild(estilos);
  }
}
