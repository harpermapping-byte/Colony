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
 *
 * Barra de acción (docs/GDD_Combate.md §10.4, pedido streamer 2026-09-03:
 * "acciones como barra de accion abajo... carencias [habilidades] o
 * pociones") — cierra el hueco "sin UI de cliente" que dejaron §10.1/§10.3:
 * golpe especial por familia de arma (`combate:accion` con `habilidadId`,
 * ya validado server-side contra el arma REAL equipada — este panel solo
 * sugiere, el servidor decide) y pociones bebibles en combate
 * (`pocion:beber`). Mismo patrón de import de catálogo que
 * panelJugador.ts/panelCofre.ts.
 */

import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItemCatalogo {
  nombre?: string;
  habilidadId?: string;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItemCatalogo>;

// Verbo/nombre de botón por habilidad — descripción exacta de cada familia
// en docs/GDD_Combate.md §10.1 (tabla de las 7 familias de arma). Un arma
// sin `habilidadId` reconocido aquí deja solo el botón "Atacar" normal, sin
// ningún cambio de comportamiento (pedido explícito).
const NOMBRE_HABILIDAD: Record<string, string> = {
  "daga:puntoDebil": "Punto débil",
  "espada:estocada": "Estocada",
  "hacha:tajoPesado": "Tajo pesado",
  "maza:aturdir": "Aturdir",
  "baston:barrido": "Barrido",
  "lanza:embiste": "Embestir",
  "arco:apuntar": "Apuntar y disparar",
};

// Poción bebible = ItemInstancia con `efectoPocion` (server/src/inventario/
// inventario.ts) — pero ESE campo nunca se replica al cliente: no está en
// ItemInstanciaSchema ni lo copia sincronizarSchema.ts (solo vive
// server-side, ver investigación en el commit de esta barra). El único
// punto real que crea instancias con `efectoPocion` es `entregarPocion`
// (manejarAlquimiaColar, RoomExteriorBase.ts), y SIEMPRE con uno de los 5
// itemId que arma `itemIdPocion()` (alquimia.ts: `pocion_alquimica_<color>`)
// — así que comprobar el prefijo del itemId es exactamente equivalente en
// la práctica al criterio real del servidor, sin depender de un campo que
// el cliente no puede ver.
const PREFIJO_ITEM_POCION = "pocion_alquimica_";

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

interface ItemInstanciaVista {
  id: number;
  itemId: string;
  cantidad: number;
}

interface InventarioVista {
  equipo: { get(slot: string): string | undefined };
  cuerpo: { items: Iterable<ItemInstanciaVista> };
}

/** Lo mínimo del Player propio (Schema replicado) que esta barra necesita — mismo patrón de "vista mínima" que CombateVista de arriba. */
interface JugadorPropioVista {
  inventario: InventarioVista;
}

export interface OpcionesPanelCombate {
  contenedor: HTMLElement;
  sessionIdPropio: string;
  /** `habilidadId` opcional: si se manda, el servidor valida que coincide con el arma REAL equipada (manoPrincipal) — si no coincide o se omite, cae al ataque base de siempre (docs/GDD_Combate.md §10.1). */
  enviarAccion(combateId: string, objetivoId: string, habilidadId?: string): void;
  enviarPasarTurno(combateId: string): void;
  enviarHuir(combateId: string): void;
  enviarComenzarYa(combateId: string): void;
  /** docs/GDD_Combate.md §10.3 — beber una poción a mitad de combate, mismo mensaje `pocion:beber` que fuera de combate. */
  enviarPocion(instanciaId: number): void;
  /** Player propio (Schema) para leer el arma equipada y las pociones del inventario — undefined si `room.state.players` todavía no tiene al jugador. */
  obtenerJugadorPropio(): JugadorPropioVista | undefined;
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

    // Arma equipada -> habilidad especial de su familia (docs/GDD_Combate.md
    // §10.1) — solo hace falta durante nuestro propio turno, para saber qué
    // botón extra ofrecer junto a "Atacar" en cada fila de enemigo de abajo.
    const jugador = this.opciones.obtenerJugadorPropio();
    const itemIdArma = jugador?.inventario.equipo.get("manoPrincipal");
    const habilidadId = itemIdArma ? ITEMS[itemIdArma]?.habilidadId : undefined;
    const nombreHabilidad = habilidadId ? NOMBRE_HABILIDAD[habilidadId] : undefined;

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
        // Botón extra con el golpe especial de la familia del arma equipada
        // (junto a "Atacar" normal, no en su lugar — arma sin familia
        // reconocida no añade nada aquí, comportamiento sin cambios).
        if (habilidadId && nombreHabilidad) {
          const botonHabilidad = document.createElement("button");
          botonHabilidad.textContent = nombreHabilidad;
          botonHabilidad.title = `Golpe especial de tu arma equipada (${itemIdArma})`;
          botonHabilidad.onclick = () => this.opciones.enviarAccion(combateId, u.id, habilidadId);
          fila.appendChild(botonHabilidad);
        }
      }
      lista.appendChild(fila);
    }
    this.raiz.appendChild(lista);

    // Pociones bebibles (docs/GDD_Combate.md §10.3) — solo durante nuestro
    // turno, mismo criterio que "Pasar turno"/"Huir" de abajo. El servidor
    // sigue siendo quien valida PA/aturdido/turno de verdad; aquí solo se
    // decide qué mostrar.
    if (esMiTurno) {
      const pociones = jugador ? [...jugador.inventario.cuerpo.items].filter((it) => it.itemId.startsWith(PREFIJO_ITEM_POCION)) : [];
      if (pociones.length > 0) {
        this.raiz.appendChild(this.subtitulo("Pociones"));
        const listaPociones = document.createElement("div");
        listaPociones.style.display = "flex";
        listaPociones.style.flexDirection = "column";
        listaPociones.style.gap = "4px";
        listaPociones.style.marginBottom = "8px";
        for (const it of pociones) {
          const fila = document.createElement("div");
          fila.style.display = "flex";
          fila.style.justifyContent = "space-between";
          fila.style.gap = "8px";
          const texto = document.createElement("span");
          texto.textContent = ITEMS[it.itemId]?.nombre ?? it.itemId;
          fila.appendChild(texto);
          const boton = document.createElement("button");
          boton.textContent = "Beber";
          boton.onclick = () => this.opciones.enviarPocion(it.id);
          fila.appendChild(boton);
          listaPociones.appendChild(fila);
        }
        this.raiz.appendChild(listaPociones);
      }
    }

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

  private subtitulo(texto: string): HTMLDivElement {
    const div = document.createElement("div");
    div.style.fontWeight = "bold";
    div.style.fontSize = "12px";
    div.style.marginTop = "4px";
    div.style.marginBottom = "2px";
    div.textContent = texto;
    return div;
  }
}
