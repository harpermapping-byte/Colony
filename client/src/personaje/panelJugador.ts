/**
 * Panel "Jugador" (docs/GDD_Equipo.md) — PLACEHOLDER de testeo, mismo
 * criterio ya pactado con el streamer para combate/mascotas: "que sean
 * placeholder sencillas... al final del proyecto se hará toda la UI".
 * DOM plano inyectado sobre el canvas, mismo patrón visual EXACTO que
 * panelMascotas.ts/panelCombate.ts (fondo oscuro semitransparente, texto
 * crema, borde marrón) — panel condicional (oculto hasta pulsar la tecla),
 * mismo criterio que panelCombate.ts.
 *
 * Dos pestañas (pedido streamer 2026-09-09, referencias visuales de otros
 * MMO voxel): **Equipo** — "muñeco de papel", una silueta central con los
 * 21 slots dispuestos alrededor en su posición anatómica (casco arriba,
 * pechera/cinturón/piernas en el centro, armas a los lados...) — y
 * **Inventario** — la rejilla real de "Cuerpo"/"Dentro de: X" de siempre.
 * Sigue siendo tosco a propósito (emoji + texto, sin arte de ítem todavía),
 * SOLO cambió la DISPOSICIÓN — equipar/desequipar/mover/drag&drop son
 * exactamente la misma mecánica ya probada (docs/GDD_Inventario.md §10):
 * arrastrar una celda a cualquier grid visible pide `inventario:mover`, el
 * servidor decide si cabe, aquí no se valida nada por adelantado.
 */

import itemsJson from "../../../items/catalogo/items.json";
import { crearMarcoPanel, crearSubtitulo, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";

interface EntradaItem {
  /** §9 de docs/GDD_Inventario.md: recipiente de líquido (cubo/cantimplora/regadera) — habilita "Llenar"/"Beber". */
  volumenMaxMl?: number;
  tipo?: string;
  slotEquipo?: string;
  peso?: number;
  huella?: [number, number];
  // Consumibles reales (comida/bebida/pociones que restauran un vital) —
  // MISMA condición que exige el servidor en `manejarPersonajeConsumir`
  // (`tipo==="consumible" && (restaura||restauraMultiple)`), replicada aquí
  // solo para decidir CUÁNDO mostrar el botón "Usar" — el servidor sigue
  // siendo quien valida y aplica de verdad, esto nunca resta ni cura nada
  // por sí mismo.
  restaura?: { vital: string; cantidad: number };
  restauraMultiple?: Record<string, number>;
}
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

// Los 19 huecos de equipo (docs/GDD_Equipo.md) con etiqueta legible —
// orden pensado para leer de arriba a abajo como un cuerpo real.
const SLOTS: { slot: string; etiqueta: string }[] = [
  { slot: "casco", etiqueta: "Casco" },
  { slot: "mascara", etiqueta: "Máscara" },
  { slot: "gafas", etiqueta: "Gafas" },
  { slot: "pechera", etiqueta: "Pechera" },
  { slot: "cuello", etiqueta: "Cuello" },
  { slot: "hombreras", etiqueta: "Hombreras" },
  { slot: "brazos", etiqueta: "Brazos" },
  { slot: "coderas", etiqueta: "Coderas" },
  { slot: "manos", etiqueta: "Manos" },
  { slot: "anilloIzquierdo", etiqueta: "Anillo Izq." },
  { slot: "anilloDerecho", etiqueta: "Anillo Der." },
  { slot: "brazalete", etiqueta: "Brazalete" },
  { slot: "cinturon", etiqueta: "Cinturón" },
  { slot: "piernas", etiqueta: "Piernas" },
  { slot: "rodilleras", etiqueta: "Rodilleras" },
  { slot: "zapatos", etiqueta: "Zapatos" },
  { slot: "espalda", etiqueta: "Espalda" },
  { slot: "capa", etiqueta: "Capa" },
  { slot: "bandolera", etiqueta: "Bandolera" },
  { slot: "manoPrincipal", etiqueta: "Mano principal" },
  { slot: "manoSecundaria", etiqueta: "Mano secundaria" },
];

// Emoji genérico por slot — puramente decorativo (sin arte de ítem propio
// todavía, ver GDD_Motor_3D_Props.md), pensado solo para reconocer la
// categoría de un vistazo en el "muñeco de papel" de abajo.
const EMOJI_SLOT: Record<string, string> = {
  casco: "🪖", mascara: "🎭", gafas: "🕶️", pechera: "🥋", cuello: "📿",
  hombreras: "🎽", brazos: "💪", coderas: "🦾", manos: "🧤",
  anilloIzquierdo: "💍", anilloDerecho: "💍", brazalete: "⌚", cinturon: "🎗️",
  piernas: "👖", rodilleras: "🦵", zapatos: "👢", espalda: "🎒", capa: "🧣",
  bandolera: "👝", manoPrincipal: "⚔️", manoSecundaria: "🛡️",
};

// Disposición anatómica del "muñeco de papel" (pedido streamer 2026-09-09,
// referencias de otros MMO voxel): grid de 3 columnas, la columna central
// lleva la silueta del personaje ("cuerpo", ocupa 2 filas) MÁS los slots
// que van sobre el torso/piernas/cabeza reales; las columnas laterales son
// los slots que cuelgan a los lados (brazos, armas, anillos...). "." es un
// hueco vacío del grid (sintaxis CSS `grid-template-areas`).
const FILAS_MUÑECO: [string, string, string][] = [
  ["gafas", "casco", "mascara"],
  ["hombreras", "cuerpo", "cuello"],
  ["manos", "cuerpo", "capa"],
  ["brazos", "pechera", "espalda"],
  ["coderas", "cinturon", "bandolera"],
  ["anilloIzquierdo", "piernas", "anilloDerecho"],
  ["brazalete", "rodilleras", "."],
  ["manoPrincipal", "zapatos", "manoSecundaria"],
];

// slot genérico de catálogo -> hueco(s) físico(s) reales donde puede caer
// (docs/GDD_Equipo.md, server/src/inventario/inventario.ts:GRUPOS_SLOT) —
// mismo criterio duplicado a propósito en el cliente solo para saber qué
// botones ofrecer, el servidor sigue siendo la única autoridad real.
const SLOTS_FISICOS_POR_DECLARADO: Record<string, string[]> = {
  anillo: ["anilloIzquierdo", "anilloDerecho"],
};

interface ItemInstanciaVista {
  id: number;
  itemId: string;
  cantidad: number;
  x: number;
  y: number;
  rot: 0 | 1;
  liquidoTipo?: string;
  liquidoVolumenMl?: number;
}

interface ContenedorVista {
  ancho: number;
  alto: number;
  items: Iterable<ItemInstanciaVista>;
}

/** Tamaño de celda del grid en px — puramente visual, sin relación con nada del servidor. */
const TAM_CELDA = 30;

export interface OpcionesPanelJugador {
  contenedor: HTMLElement;
  equipar(instanciaId: number, slot: string): void;
  desequipar(slot: string): void;
  /** docs/GDD_Inventario.md §10 — mover/soltar una instancia propia a (x,y) de `contenedorDestino` ("cuerpo" o un slot de mochila/bolsa puesta), misma rotación que ya tenía (el skeleton no ofrece rotar al vuelo). */
  mover(instanciaId: number, contenedorDestino: string, x: number, y: number, rot: 0 | 1): void;
  /** Pedido streamer 2026-09-06 ("intercambiar objetos"): arrastrar un ítem desde el cofre ABIERTO (panelCofre.ts) hasta esta rejilla — el hueco de destino lo decide el servidor solo (cofre:sacarItem ya lo hace así), sin (x,y) que pedirle. Opcional: fuera del Hub no hay ningún cofre abierto posible. */
  sacarDeCofre?(instanciaId: number): void;
  /**
   * "Usar" un ítem — comer/beber un consumible real (`personaje:consumir`)
   * o usar una hoja (`higiene:cagar`), decidido por `game.ts` según
   * `itemId` (docs/GDD_Personaje.md §3.6: "UI de personaje... icono de
   * necesitas cagar" era la única pieza que faltaba, el servidor ya
   * funcionaba de punta a punta). Opcional para no romper ningún consumidor
   * viejo del panel.
   */
  usarItem?(instanciaId: number, itemId: string): void;
  /** docs/GDD_Agricultura.md §9: llenar un recipiente junto al agua (recipiente:llenar) / beber de él (recipiente:beber). */
  llenarRecipiente?(instanciaId: number): void;
  beberRecipiente?(instanciaId: number): void;
}

export class PanelJugador {
  private readonly marco: MarcoPanel;
  private pestana: "equipo" | "inventario" = "equipo";
  private ultimoPlayer: any = null;

  constructor(private opciones: OpcionesPanelJugador) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Jugador", icono: "🧍", left: "16px", top: "16px" });
  }

  alternar() {
    this.marco.alternar();
  }

  estaVisible() {
    return this.marco.estaAbierto();
  }

  /** Alias de `estaVisible()` — dockHud.ts espera este nombre (mismo que expone crearMarcoPanel/PanelMapaMundo/PanelResumen). */
  estaAbierto() {
    return this.marco.estaAbierto();
  }

  onCambioEstado(cb: () => void) {
    this.marco.onCambioEstado(cb);
  }

  /** Llamar en cada cambio de `player` (onChange/onAdd de Colyseus) — reconstruye todo, mismo criterio "barato a esta frecuencia" que el resto de sincronizaciones del proyecto. */
  actualizar(player: any) {
    if (!this.marco.estaAbierto()) return; // evita reconstruir DOM en cada tick de red si el panel está cerrado
    this.render(player);
  }

  private render(player: any) {
    this.ultimoPlayer = player;
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = player.name || "Jugador";
    cuerpo.appendChild(titulo);

    cuerpo.appendChild(
      crearLineaTexto(
        `❤ ${Math.round(player.vida)}/${Math.round(player.vidaMax)}  ⚔ ${player.ataque} (${player.ataqueMagico} mág.)  🛡 ${player.defensa} (${player.defensaMagica} mág.)`,
      ),
    );
    const a = player.atributos;
    if (a) {
      cuerpo.appendChild(
        crearLineaTexto(`Fuerza ${a.fuerza} · Destreza ${a.destreza} · Inteligencia ${a.inteligencia} · Resistencia ${a.resistencia} · Carisma ${a.carisma}`, { fontSize: "11px" }),
      );
    }

    cuerpo.appendChild(this.pestanas());

    if (this.pestana === "equipo") {
      cuerpo.appendChild(this.renderMuñecoDePapel(player.inventario.equipo));
    } else {
      cuerpo.appendChild(crearSubtitulo("Cuerpo"));
      cuerpo.appendChild(this.renderGridContenedor("cuerpo", player.inventario.cuerpo));

      const extras: Map<string, any> = player.inventario.extras;
      for (const [slotExtra, contenedorExtra] of extras) {
        const etiquetaExtra = SLOTS.find((s) => s.slot === slotExtra)?.etiqueta ?? slotExtra;
        cuerpo.appendChild(crearSubtitulo(`Dentro de: ${etiquetaExtra}`));
        cuerpo.appendChild(this.renderGridContenedor(slotExtra, contenedorExtra));
      }
    }
  }

  private pestanas(): HTMLDivElement {
    const fila = document.createElement("div");
    fila.style.display = "flex";
    fila.style.gap = "4px";
    fila.style.margin = "8px 0";
    for (const [id, etiqueta] of [["equipo", "🧍 Equipo"], ["inventario", "🎒 Inventario"]] as const) {
      const boton = document.createElement("button");
      boton.textContent = etiqueta;
      boton.style.flex = "1";
      boton.style.padding = "4px 0";
      boton.style.background = this.pestana === id ? "rgba(255,255,255,0.14)" : "transparent";
      boton.style.color = "#f0e8d8";
      boton.style.border = "1px solid #6a5a3a";
      boton.style.borderRadius = "4px";
      boton.style.cursor = "pointer";
      boton.style.font = "inherit";
      boton.onclick = () => { this.pestana = id; this.render(this.ultimoPlayer); };
      fila.appendChild(boton);
    }
    return fila;
  }

  /**
   * "Muñeco de papel" (pedido streamer 2026-09-09) — silueta central +
   * los 21 slots de equipo colocados en su posición anatómica alrededor
   * (`FILAS_MUÑECO`). Mismo dato/mecánica que la lista de siempre: clic en
   * una celda equipada la desequipa (`opciones.desequipar`); equipar sigue
   * haciéndose desde la pestaña Inventario (el botón "Eq." sobre cada
   * ítem), no es un gesto de arrastrar sobre el muñeco todavía.
   */
  private renderMuñecoDePapel(equipo: Map<string, string>): HTMLDivElement {
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "64px 84px 64px";
    grid.style.gridTemplateRows = `repeat(${FILAS_MUÑECO.length}, 40px)`;
    grid.style.gridTemplateAreas = FILAS_MUÑECO.map((fila) => `"${fila.join(" ")}"`).join(" ");
    grid.style.gap = "3px";
    grid.style.justifyItems = "stretch";
    grid.style.margin = "0 auto 8px";
    grid.style.width = "fit-content";

    for (const { slot, etiqueta } of SLOTS) {
      const itemId = equipo.get(slot);
      const celda = document.createElement("div");
      celda.style.gridArea = slot;
      celda.style.display = "flex";
      celda.style.flexDirection = "column";
      celda.style.alignItems = "center";
      celda.style.justifyContent = "center";
      celda.style.background = itemId ? "rgba(184,168,120,0.18)" : "rgba(255,255,255,0.04)";
      celda.style.border = `1px solid ${itemId ? "#b8a878" : "#6a5a3a"}`;
      celda.style.borderRadius = "4px";
      celda.style.fontSize = "16px";
      celda.style.lineHeight = "1";
      celda.style.overflow = "hidden";
      celda.style.cursor = itemId ? "pointer" : "default";
      celda.title = `${etiqueta}: ${itemId || "vacío"}`;

      const icono = document.createElement("div");
      icono.textContent = EMOJI_SLOT[slot] ?? "❔";
      icono.style.opacity = itemId ? "1" : "0.35";
      celda.appendChild(icono);

      const nombre = document.createElement("div");
      nombre.textContent = itemId ? itemId.replace(/_/g, " ").slice(0, 12) : etiqueta;
      nombre.style.fontSize = "8px";
      nombre.style.opacity = itemId ? "0.9" : "0.45";
      nombre.style.textAlign = "center";
      nombre.style.padding = "0 2px";
      nombre.style.whiteSpace = "nowrap";
      nombre.style.overflow = "hidden";
      nombre.style.textOverflow = "ellipsis";
      nombre.style.maxWidth = "100%";
      celda.appendChild(nombre);

      if (itemId) celda.onclick = () => this.opciones.desequipar(slot);
      grid.appendChild(celda);
    }

    // Silueta central — puramente decorativa (sin arte de personaje 2D
    // todavía), solo para que el ojo lea "esto es el cuerpo" entre los slots.
    const silueta = document.createElement("div");
    silueta.style.gridArea = "cuerpo";
    silueta.style.display = "flex";
    silueta.style.alignItems = "center";
    silueta.style.justifyContent = "center";
    silueta.style.fontSize = "42px";
    silueta.style.opacity = "0.5";
    silueta.textContent = "🧍";
    grid.appendChild(silueta);

    return grid;
  }

  /**
   * Rejilla real de un contenedor (docs/GDD_Inventario.md §10) — celdas
   * absolutas dentro de una caja de `ancho x alto` casillas, una por
   * instancia, arrastrable con drag&drop nativo a CUALQUIER grid visible
   * (incluida ella misma, para reordenar). El drop calcula la celda a
   * partir del punto donde se suelta y delega toda la validación (¿cabe?
   * ¿es tuyo?) al servidor vía `opciones.mover` — aquí no se rechaza nada
   * por adelantado, solo se pide.
   */
  private renderGridContenedor(contenedorId: string, contenedor: ContenedorVista): HTMLDivElement {
    const grid = document.createElement("div");
    grid.style.position = "relative";
    grid.style.width = `${Math.max(1, contenedor.ancho) * TAM_CELDA}px`;
    grid.style.height = `${Math.max(1, contenedor.alto) * TAM_CELDA}px`;
    grid.style.background = `repeating-linear-gradient(0deg, transparent, transparent ${TAM_CELDA - 1}px, #4a3f2a ${TAM_CELDA}px), repeating-linear-gradient(90deg, transparent, transparent ${TAM_CELDA - 1}px, #4a3f2a ${TAM_CELDA}px)`;
    grid.style.border = "1px solid #6a5a3a";
    grid.style.marginBottom = "8px";

    grid.ondragover = (ev) => ev.preventDefault();
    grid.ondrop = (ev) => {
      ev.preventDefault();
      const datos = ev.dataTransfer?.getData("text/plain");
      if (!datos) return;
      let payload: { instanciaId: number; rot: 0 | 1; origen?: "jugador" | "cofre" };
      try {
        payload = JSON.parse(datos);
      } catch {
        return;
      }
      // Ítem soltado desde el cofre ABIERTO (panelCofre.ts, pedido streamer
      // 2026-09-06 "intercambiar objetos") — el hueco lo decide el servidor
      // solo (cofre:sacarItem ya funciona así), no hace falta el (x,y) de
      // dónde se soltó.
      if (payload.origen === "cofre") return this.opciones.sacarDeCofre?.(payload.instanciaId);
      const rect = grid.getBoundingClientRect();
      const x = Math.max(0, Math.min(Math.max(1, contenedor.ancho) - 1, Math.floor((ev.clientX - rect.left) / TAM_CELDA)));
      const y = Math.max(0, Math.min(Math.max(1, contenedor.alto) - 1, Math.floor((ev.clientY - rect.top) / TAM_CELDA)));
      this.opciones.mover(payload.instanciaId, contenedorId, x, y, payload.rot);
    };

    const lista = [...contenedor.items];
    for (const it of lista) {
      const entrada = ITEMS[it.itemId];
      const [wBase, hBase] = entrada?.huella ?? [1, 1];
      const w = it.rot === 1 ? hBase : wBase;
      const h = it.rot === 1 ? wBase : hBase;

      const celda = document.createElement("div");
      celda.draggable = true;
      celda.style.position = "absolute";
      celda.style.left = `${it.x * TAM_CELDA}px`;
      celda.style.top = `${it.y * TAM_CELDA}px`;
      celda.style.width = `${w * TAM_CELDA - 2}px`;
      celda.style.height = `${h * TAM_CELDA - 2}px`;
      celda.style.boxSizing = "border-box";
      celda.style.background = it.liquidoTipo ? "#3a5a6a" : "#3a3020";
      celda.style.border = "1px solid #b8a878";
      celda.style.borderRadius = "3px";
      celda.style.fontSize = "9px";
      celda.style.lineHeight = "1.2";
      celda.style.overflow = "hidden";
      celda.style.padding = "1px 2px";
      celda.style.cursor = "grab";
      const liquidoTxt = it.liquidoTipo ? ` (${it.liquidoTipo} ${it.liquidoVolumenMl}ml)` : "";
      celda.title = `${it.itemId} x${it.cantidad}${liquidoTxt}`;
      celda.textContent = `${it.itemId}${it.cantidad > 1 ? ` x${it.cantidad}` : ""}${liquidoTxt}`;
      celda.ondragstart = (ev) => {
        ev.dataTransfer?.setData("text/plain", JSON.stringify({ instanciaId: it.id, rot: it.rot, origen: "jugador" }));
      };

      const declarado = entrada?.slotEquipo;
      if (declarado) {
        const destinos = SLOTS_FISICOS_POR_DECLARADO[declarado] ?? [declarado];
        const botones = document.createElement("div");
        botones.style.position = "absolute";
        botones.style.bottom = "0";
        botones.style.right = "0";
        for (const slotFisico of destinos) {
          const boton = document.createElement("button");
          const etiqueta = SLOTS.find((s) => s.slot === slotFisico)?.etiqueta ?? slotFisico;
          boton.textContent = destinos.length > 1 ? `→${etiqueta}` : "Eq.";
          boton.style.fontSize = "8px";
          boton.style.padding = "0 2px";
          boton.onclick = (ev) => {
            ev.stopPropagation();
            this.opciones.equipar(it.id, slotFisico);
          };
          botones.appendChild(boton);
        }
        celda.appendChild(botones);
      }

      // "Usar" (comer/beber/hoja, ver comentario de `usarItem` en
      // OpcionesPanelJugador) — misma condición EXACTA que el servidor
      // exige para aceptar `personaje:consumir` (tipo consumible con
      // restaura/restauraMultiple), más el caso especial de la hoja
      // (`higiene:cagar`, tipo "recurso" a propósito — no restaura ningún
      // vital por sí sola). Esquina opuesta a "Eq." para que un ítem que
      // (en teoría) fuera ambas cosas a la vez no las solape.
      const esConsumibleReal = entrada?.tipo === "consumible" && !!(entrada.restaura || entrada.restauraMultiple);
      const esHoja = it.itemId === "hoja";
      if ((esConsumibleReal || esHoja) && this.opciones.usarItem) {
        const botonUsar = document.createElement("button");
        botonUsar.textContent = esHoja ? "🍃" : "Usar";
        botonUsar.title = esHoja ? "Usar hoja (higiene)" : "Comer/beber";
        botonUsar.style.position = "absolute";
        botonUsar.style.bottom = "0";
        botonUsar.style.left = "0";
        botonUsar.style.fontSize = "8px";
        botonUsar.style.padding = "0 2px";
        botonUsar.onclick = (ev) => {
          ev.stopPropagation();
          this.opciones.usarItem!(it.id, it.itemId);
        };
        celda.appendChild(botonUsar);
      }

      // Recipientes de líquido (cubo/cantimplora/regadera, §9): "Llenar" si
      // está vacío (el servidor exige estar junto al agua) o "Beber" si
      // lleva agua — regar una maceta gasta de aquí (docs/GDD_Agricultura.md §9).
      if (entrada?.volumenMaxMl && (this.opciones.llenarRecipiente || this.opciones.beberRecipiente)) {
        const conAgua = it.liquidoTipo === "agua" && (it.liquidoVolumenMl ?? 0) > 0;
        const boton = document.createElement("button");
        boton.textContent = conAgua ? "Beber" : "Llenar";
        boton.title = conAgua ? `Beber un trago (${it.liquidoVolumenMl}ml)` : "Llenar de agua (junto a un río/lago)";
        boton.setAttribute("data-testid", conAgua ? "recipiente-beber" : "recipiente-llenar");
        boton.style.position = "absolute";
        boton.style.bottom = "0";
        boton.style.left = "0";
        boton.style.fontSize = "8px";
        boton.style.padding = "0 2px";
        boton.onclick = (ev) => {
          ev.stopPropagation();
          if (conAgua) this.opciones.beberRecipiente?.(it.id);
          else this.opciones.llenarRecipiente?.(it.id);
        };
        celda.appendChild(boton);
      }

      grid.appendChild(celda);
    }

    if (lista.length === 0) {
      const vacio = document.createElement("div");
      vacio.style.position = "absolute";
      vacio.style.top = "4px";
      vacio.style.left = "4px";
      vacio.style.fontSize = "10px";
      vacio.style.opacity = "0.6";
      vacio.textContent = "(vacío)";
      grid.appendChild(vacio);
    }

    return grid;
  }
}
