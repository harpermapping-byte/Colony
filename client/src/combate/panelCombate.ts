/**
 * Panel de combate — PLACEHOLDER de testeo (docs/GDD_Combate.md, pedido
 * explícito 2026-08-30: "que sean placeholder sencillas... al final del
 * proyecto se hará toda la UI"). Sin arena/grid dibujado, sin retratos, sin
 * iconos de habilidad — solo texto y botones para poder JUGAR el combate y
 * comprobar que el protocolo funciona. La UI de verdad (overlay de rejilla,
 * paneles con arte) es trabajo de una pasada final aparte, ya documentada
 * como pendiente en el GDD.
 *
 * DOM plano inyectado sobre el canvas, mismo patrón que
 * client/src/construccion/constructor.ts — nada de framework.
 */

// Tipos mínimos de lo que necesitamos leer del Schema replicado — evita
// acoplar este módulo al tipo exacto de colyseus.js/@colyseus/schema.
interface UnidadCombateVista {
  id: string;
  bando: string;
  hp: number;
  hpMax: number;
  pa: number;
  paMax: number;
  estado: string;
  /** docs/GDD_Barcos.md (pedido 2026-08-30) — "" | "barco" | "nadando", puramente cosmético. */
  visual: string;
  barcoTipoId: string;
}

interface CombateVista {
  fase: string; // "pendiente" | "activo" (docs/GDD_Combate.md §9.1)
  cierraEn: number;
  turnoActual: number;
  ordenTurnos: { length: number; [i: number]: string; map<T>(fn: (id: string) => T): T[] };
  unidades: { get(id: string): UnidadCombateVista | undefined; values(): IterableIterator<UnidadCombateVista> };
}

export interface OpcionesPanelCombate {
  contenedor: HTMLElement;
  sessionIdPropio: string;
  enviarAccion(combateId: string, objetivoId: string): void;
  enviarPasarTurno(combateId: string): void;
  enviarHuir(combateId: string): void;
  enviarComenzarYa(combateId: string): void;
}

export class PanelCombate {
  private raiz: HTMLDivElement;
  private combateIdActivo: string | null = null;

  constructor(private opciones: OpcionesPanelCombate) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.bottom = "16px";
    this.raiz.style.transform = "translateX(-50%)";
    this.raiz.style.background = "rgba(20,16,10,0.88)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "13px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #6a5a3a";
    this.raiz.style.display = "none";
    this.raiz.style.minWidth = "260px";
    opciones.contenedor.appendChild(this.raiz);
  }

  /** Llamar cada vez que cambie `room.state.combates` (onAdd/onChange/onRemove). */
  actualizar(combates: Map<string, CombateVista> | { entries(): IterableIterator<[string, CombateVista]> }) {
    let combateId: string | null = null;
    let combate: CombateVista | null = null;
    for (const [id, c] of combates.entries()) {
      if (c.unidades.get(this.opciones.sessionIdPropio)) { combateId = id; combate = c; break; }
    }
    this.combateIdActivo = combateId;

    if (!combate || !combateId) {
      this.raiz.style.display = "none";
      return;
    }
    this.raiz.style.display = "block";
    this.renderizar(combateId, combate);
  }

  private renderizar(combateId: string, combate: CombateVista) {
    this.raiz.innerHTML = "";

    // Ventana de unión todavía abierta (docs/GDD_Combate.md §9.1) — sin
    // turnos que jugar todavía, solo la cuenta atrás y "comenzar ya".
    if (combate.fase === "pendiente") {
      const restante = Math.max(0, Math.round((combate.cierraEn - Date.now()) / 1000));
      const titulo = document.createElement("div");
      titulo.style.fontWeight = "bold";
      titulo.style.marginBottom = "6px";
      titulo.textContent = `⏳ Esperando refuerzos... (${restante}s) — ${[...combate.unidades.values()].length} combatientes`;
      this.raiz.appendChild(titulo);
      const comenzar = document.createElement("button");
      comenzar.textContent = "Comenzar ya";
      comenzar.onclick = () => this.opciones.enviarComenzarYa(combateId);
      this.raiz.appendChild(comenzar);
      return;
    }

    const propia = combate.unidades.get(this.opciones.sessionIdPropio)!;
    const idTurno = combate.ordenTurnos[combate.turnoActual];
    const esMiTurno = idTurno === this.opciones.sessionIdPropio;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    // WASD mueve en el grid (combate:mover, gasta PA) mientras es tu turno —
    // sin este aviso no hay forma de saber que las teclas de siempre hacen
    // algo distinto aquí dentro (pedido streamer: "movimiento del mundo en
    // general [...] en combate sí").
    titulo.textContent = esMiTurno ? "⚔ Tu turno — WASD para moverte" : `Turno de: ${idTurno}`;
    this.raiz.appendChild(titulo);

    const propiaDiv = document.createElement("div");
    propiaDiv.style.marginBottom = "6px";
    // Combate acuático (docs/GDD_Barcos.md, pedido 2026-08-30): puramente
    // informativo — "no da más bonus ni nada", solo para saber si eres el
    // capitán (visual="barco") o ibas de tripulación (visual="nadando").
    // Sin panel de aliados todavía (mismo límite ya aceptado del resto de
    // esta UI, ver cabecera del archivo) — solo se muestra de uno mismo.
    const indicadorVisual = propia.visual === "barco" ? ` 🚣${propia.barcoTipoId ? ` (${propia.barcoTipoId})` : ""}` : propia.visual === "nadando" ? " 🏊" : "";
    // PA (docs/GDD_Combate.md §9.3, pedido streamer): sin esto en pantalla el
    // jugador no tiene forma de saber cuánto le queda para mover/atacar/huir
    // — antes el panel solo mostraba HP, invisible del todo.
    propiaDiv.textContent = `Tú: ${Math.round(propia.hp)}/${Math.round(propia.hpMax)} HP — PA: ${propia.pa}/${propia.paMax} (${propia.estado})${indicadorVisual}`;
    this.raiz.appendChild(propiaDiv);

    const lista = document.createElement("div");
    lista.style.display = "flex";
    lista.style.flexDirection = "column";
    lista.style.gap = "4px";
    lista.style.marginBottom = "8px";
    for (const u of combate.unidades.values()) {
      if (u.id === this.opciones.sessionIdPropio || u.bando === propia.bando) continue; // enemigos: bando contrario
      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.justifyContent = "space-between";
      fila.style.gap = "8px";
      const texto = document.createElement("span");
      texto.textContent = `${u.id}: ${Math.round(u.hp)}/${Math.round(u.hpMax)} HP (${u.estado})`;
      fila.appendChild(texto);
      if (esMiTurno && u.estado === "activo") {
        const boton = document.createElement("button");
        boton.textContent = "Atacar";
        boton.onclick = () => this.opciones.enviarAccion(combateId, u.id);
        fila.appendChild(boton);
      }
      lista.appendChild(fila);
    }
    this.raiz.appendChild(lista);

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "8px";
    const pasar = document.createElement("button");
    pasar.textContent = "Pasar turno";
    pasar.disabled = !esMiTurno;
    pasar.onclick = () => this.opciones.enviarPasarTurno(combateId);
    const huir = document.createElement("button");
    huir.textContent = "Huir";
    huir.disabled = !esMiTurno;
    huir.onclick = () => this.opciones.enviarHuir(combateId);
    botones.appendChild(pasar);
    botones.appendChild(huir);
    this.raiz.appendChild(botones);
  }
}
