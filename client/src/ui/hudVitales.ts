/**
 * HUD de vitales del jugador local (pedido streamer 2026-09-09: "falta
 * arriba izquierda un icono del personaje que te creas y su vida stamina
 * hambre sed y tal como otros juegos"). A diferencia de todo lo demás en
 * `ui/`, esto NO es un panel de `crearMarcoPanel` — no tiene X, no se abre
 * ni se cierra: es HUD permanente, mismo criterio que la barra de vida
 * sobre la cabeza de cualquier jugador/NPC/fauna (`worldScene.ts::
 * actualizarVida`), no un menú.
 *
 * Icono PLACEHOLDER (un emoji fijo, no un retrato real): `Player` no
 * replica sexo/morfología/colores al cliente — el creador de personajes
 * (`personajes/`) nunca llegó a generar un retrato 2D, y todo el arte del
 * proyecto es placeholder por diseño (CLAUDE.md, "Filosofía técnica" #7).
 * Sustituir esto por un retrato real es trabajo de ARTE/catálogo futuro,
 * no un bug de esta pieza.
 *
 * `vida`/`vidaMax` viven sueltos en `Player` (fuente única de HP,
 * docs/GDD_Mecanicas.md §5.4); `estamina`/`comida`/`bebida` viven en
 * `Player.vitales` (docs/GDD_Personaje.md). Colyseus `$(player).onChange`
 * NO burbujea cambios de un sub-schema anidado como `vitales` hasta el
 * padre — en vez de cablear un `$(player.vitales).onChange` en cada sitio
 * donde se crea/destruye un jugador remoto, `game.ts` simplemente relee y
 * llama a `actualizar()` cada 500ms (mismo patrón ya usado en el propio
 * archivo para proximidad a bancales/mesas de injerto — "barato, no hace
 * falta 60hz", los vitales decaen en HORAS reales).
 */

export interface VitalesVisibles {
  vida: number;
  vidaMax: number;
  estamina: number;
  comida: number;
  bebida: number;
}

interface BarraVital {
  relleno: HTMLDivElement;
}

const DEFINICION_BARRAS: { clave: keyof Omit<VitalesVisibles, "vidaMax">; emoji: string; color: string; titulo: string }[] = [
  { clave: "vida", emoji: "❤️", color: "#c0392b", titulo: "Vida" },
  { clave: "estamina", emoji: "⚡", color: "#e0b84a", titulo: "Estamina" },
  { clave: "comida", emoji: "🍗", color: "#a0703a", titulo: "Hambre" },
  { clave: "bebida", emoji: "💧", color: "#3a8ec0", titulo: "Sed" },
];

export class HudVitales {
  private readonly barras = new Map<string, BarraVital>();

  constructor(contenedor: HTMLElement) {
    const raiz = document.createElement("div");
    raiz.className = "hud-vitales";

    const icono = document.createElement("div");
    icono.className = "hud-vitales-icono";
    icono.textContent = "🙂";
    icono.title = "Tu personaje";
    raiz.appendChild(icono);

    const barrasCont = document.createElement("div");
    barrasCont.className = "hud-vitales-barras";
    raiz.appendChild(barrasCont);

    for (const def of DEFINICION_BARRAS) {
      const fila = document.createElement("div");
      fila.className = "hud-vitales-fila";
      fila.title = def.titulo;

      const emoji = document.createElement("span");
      emoji.className = "hud-vitales-emoji";
      emoji.textContent = def.emoji;
      fila.appendChild(emoji);

      const pista = document.createElement("div");
      pista.className = "hud-vitales-pista";
      const relleno = document.createElement("div");
      relleno.className = "hud-vitales-relleno";
      relleno.style.background = def.color;
      pista.appendChild(relleno);
      fila.appendChild(pista);

      barrasCont.appendChild(fila);
      this.barras.set(def.clave, { relleno });
    }

    contenedor.appendChild(raiz);
  }

  actualizar(v: VitalesVisibles): void {
    const pct = (valor: number, max: number) => `${Math.max(0, Math.min(100, max > 0 ? (valor / max) * 100 : 0))}%`;
    this.barras.get("vida")!.relleno.style.width = pct(v.vida, v.vidaMax);
    this.barras.get("estamina")!.relleno.style.width = pct(v.estamina, 100);
    this.barras.get("comida")!.relleno.style.width = pct(v.comida, 100);
    this.barras.get("bebida")!.relleno.style.width = pct(v.bebida, 100);
  }
}
