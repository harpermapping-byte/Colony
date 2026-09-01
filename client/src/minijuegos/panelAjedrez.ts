/**
 * Panel de la mesa de AJEDREZ (docs/GDD_Mesas_Minijuego.md) — PLACEHOLDER
 * de testeo, mismo espíritu que `combate/panelCombate.ts`: "que sean
 * placeholder sencillas, la UI de verdad es una pasada final aparte". DOM
 * plano inyectado sobre el canvas, sin framework, mismo patrón que
 * `construccion/constructor.ts` (hoja de estilos propia inyectada una vez).
 *
 * Tablero con glifos unicode de ajedrez (♔♕♖♗♘♙ / ♚♛♜♝♞♟) leídos
 * directamente del campo FEN replicado — SIEMPRE en orientación blancas
 * abajo/negras arriba para los DOS jugadores (simplificación deliberada de
 * placeholder: voltear el tablero para negras es una mejora visual pura,
 * cero cambio de protocolo, queda para la pasada de UI final). El cliente
 * NUNCA valida una jugada — clic origen + clic destino solo PROPONE
 * "mesa:mover"; si es ilegal, el servidor responde "mesa:error" y el
 * tablero no cambia (se re-pinta siempre desde el `fen` autoritativo).
 */

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
  private readonly raiz: HTMLDivElement;
  private readonly celdas: HTMLDivElement[] = []; // 64, orden: rank8->rank1, a->h (mismo orden que el FEN)
  private readonly lineaEstado: HTMLDivElement;
  private readonly lineaGanador: HTMLDivElement;

  private construccionIdActivo: number | null = null;
  private colorPropio: "w" | "b" | null = null;
  private seleccionada: string | null = null;
  private ultimoFen = "";

  constructor(private readonly opciones: OpcionesPanelAjedrez) {
    this.inyectarEstilos();

    this.raiz = document.createElement("div");
    this.raiz.className = "panel-ajedrez";
    this.raiz.style.display = "none";

    const titulo = document.createElement("h3");
    titulo.textContent = "Ajedrez";
    this.raiz.appendChild(titulo);

    this.lineaEstado = document.createElement("div");
    this.lineaEstado.className = "estado";
    this.raiz.appendChild(this.lineaEstado);

    this.lineaGanador = document.createElement("div");
    this.lineaGanador.className = "ganador";
    this.lineaGanador.style.display = "none";
    this.raiz.appendChild(this.lineaGanador);

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
    this.raiz.appendChild(tablero);

    const levantarse = document.createElement("button");
    levantarse.className = "btn-levantarse";
    levantarse.textContent = "Levantarse";
    levantarse.onclick = () => opciones.enviarLevantarse();
    this.raiz.appendChild(levantarse);

    opciones.contenedor.appendChild(this.raiz);
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
      this.raiz.style.display = "none";
      this.seleccionada = null;
      return;
    }
    this.raiz.style.display = "block";
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
      .panel-ajedrez{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        background:rgba(20,16,10,0.92);color:#f0e8d8;font:13px sans-serif;padding:14px 16px;
        border-radius:8px;border:1px solid #6a5a3a;z-index:20;text-align:center}
      .panel-ajedrez h3{margin:0 0 8px;font-size:15px;letter-spacing:.5px}
      .panel-ajedrez .estado{margin-bottom:6px;min-height:16px}
      .panel-ajedrez .ganador{margin-bottom:8px;font-weight:bold;color:#ffd76a}
      .tablero-ajedrez{display:grid;grid-template-columns:repeat(8,40px);grid-template-rows:repeat(8,40px);
        border:2px solid #3a2f1e;margin:0 auto}
      .tablero-ajedrez .celda{display:flex;align-items:center;justify-content:center;
        font-size:28px;line-height:1;cursor:pointer;user-select:none}
      .tablero-ajedrez .celda.clara{background:#e8d9b5}
      .tablero-ajedrez .celda.oscura{background:#8a6a42}
      .tablero-ajedrez .celda.pieza-blanca{color:#fdfdfd;text-shadow:0 0 2px #000,0 0 1px #000}
      .tablero-ajedrez .celda.pieza-negra{color:#141414;text-shadow:0 0 2px #fff}
      .tablero-ajedrez .celda.sel{box-shadow:inset 0 0 0 3px #3ddc78}
      .panel-ajedrez .btn-levantarse{margin-top:10px;padding:5px 14px;cursor:pointer;
        background:transparent;border:1px solid #6a5a3a;border-radius:4px;color:#e2e8f0;font:12px sans-serif}
      .panel-ajedrez .btn-levantarse:hover{background:#2d3748}`;
    document.head.appendChild(estilos);
  }
}
