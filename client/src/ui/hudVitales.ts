/**
 * HUD de vitales del jugador local (pedido streamer 2026-09-09: "falta
 * arriba izquierda un icono del personaje que te creas y su vida stamina
 * hambre sed y tal como otros juegos"). A diferencia de todo lo demás en
 * `ui/`, esto NO es un panel de `crearMarcoPanel` — no tiene X, no se abre
 * ni se cierra: es HUD permanente, mismo criterio que la barra de vida
 * sobre la cabeza de cualquier jugador/NPC/fauna (`worldScene.ts::
 * actualizarVida`), no un menú.
 *
 * Icono: retrato 3D REAL del jugador (pedido streamer 2026-09-09: "que
 * salga la cara del pj arriba, no un emote") — `render3d/retratoJugador.ts`
 * renderiza la cabeza del rig a un `<canvas>` propio, que este archivo solo
 * monta dentro del marco circular; si `game.ts` no lo pasa (o mientras el
 * rig del jugador aún no existe, primeros frames tras el join) se ve un
 * emoji de reserva para no dejar el círculo vacío.
 *
 * `vida`/`vidaMax` viven sueltos en `Player` (fuente única de HP,
 * docs/GDD_Mecanicas.md §5.4); `estamina`/`comida`/`bebida`/`caca` viven en
 * `Player.vitales` (docs/GDD_Personaje.md). Colyseus `$(player).onChange`
 * NO burbujea cambios de un sub-schema anidado como `vitales` hasta el
 * padre — en vez de cablear un `$(player.vitales).onChange` en cada sitio
 * donde se crea/destruye un jugador remoto, `game.ts` simplemente relee y
 * llama a `actualizar()` cada 500ms (mismo patrón ya usado en el propio
 * archivo para proximidad a bancales/mesas de injerto — "barato, no hace
 * falta 60hz", los vitales decaen en HORAS reales).
 *
 * Barra "🫃 Necesidad" (pedido streamer 2026-09-09: "se puede añadir la
 * barra de cagar debajo, como de estómago, vinculada al nivel de cagar")
 * — cierra un pendiente que el propio diseño original ya preveía
 * (docs/GDD_Personaje.md §3.6: "icono de 'necesitas cagar' a partir del
 * 75% de `caca`") pero nunca llegó a construirse por ser "lo último" de UI.
 * A diferencia de las otras 4 barras, esta va CRECIENTE con la urgencia
 * (0=vacío/tranquilo, 100=ensucia si no se usa una hoja) — mismo sentido
 * que el propio campo del servidor, sin invertirlo, para no desincronizar
 * la lectura visual del dato real. Al 75%+ pulsa (`.urgente`,
 * `temaPaneles.css`) para que se note sin tener que fijarse en el ancho.
 */

export interface VitalesVisibles {
  vida: number;
  vidaMax: number;
  estamina: number;
  comida: number;
  bebida: number;
  caca: number;
  /** 0-100, 50=neutro (docs/GDD_Clima.md) — fuera de rango gasta comida/bebida más rápido y resta al vidaMax efectivo. Siempre visible: a diferencia de aire, tiene efecto en CUALQUIER momento, no solo buceando. */
  temperatura: number;
  /** 0-100, solo decae buceando de verdad (docs/GDD_Mecanicas.md §5.4) — auditoría de interacciones 2026-09-13: sin esto en el HUD, ahogarse (mata en ~1 min sin aire) era completamente invisible hasta que ya dolía. Solo se muestra mientras `estado==="buceando"`. */
  aire: number;
  estado: string;
}

interface BarraVital {
  relleno: HTMLDivElement;
  fila: HTMLDivElement;
}

const UMBRAL_URGENTE_CACA = 75;
// Zona "cómoda" de temperatura (docs/GDD_Clima.md: 50=neutro) — dentro de
// este margen no pulsa, fuera sí (mismo criterio visual que caca urgente).
const MARGEN_TEMPERATURA_COMODA = 15;

const DEFINICION_BARRAS: { clave: keyof Omit<VitalesVisibles, "vidaMax" | "estado">; emoji: string; color: string; titulo: string }[] = [
  { clave: "vida", emoji: "❤️", color: "#c0392b", titulo: "Vida" },
  { clave: "estamina", emoji: "⚡", color: "#e0b84a", titulo: "Estamina" },
  { clave: "comida", emoji: "🍗", color: "#a0703a", titulo: "Hambre" },
  { clave: "bebida", emoji: "💧", color: "#3a8ec0", titulo: "Sed" },
  { clave: "caca", emoji: "🫃", color: "#6b7a3a", titulo: "Necesidad (usa una hoja antes de que llegue al tope)" },
  { clave: "temperatura", emoji: "🌡️", color: "#c0703a", titulo: "Temperatura corporal (50=cómodo; fuera de rango gasta comida/bebida más rápido)" },
  { clave: "aire", emoji: "🫧", color: "#3ab0c0", titulo: "Aire (buceando) — sin aire, ahoga en poco más de un minuto" },
];

export class HudVitales {
  private readonly barras = new Map<string, BarraVital>();

  constructor(contenedor: HTMLElement, retratoCanvas?: HTMLCanvasElement) {
    const raiz = document.createElement("div");
    raiz.className = "hud-vitales";

    const icono = document.createElement("div");
    icono.className = "hud-vitales-icono";
    icono.title = "Tu personaje";
    if (retratoCanvas) icono.appendChild(retratoCanvas);
    else icono.textContent = "🙂"; // reserva: sin cámara de retrato (no debería pasar en el juego real)
    raiz.appendChild(icono);

    const barrasCont = document.createElement("div");
    barrasCont.className = "hud-vitales-barras";
    raiz.appendChild(barrasCont);

    for (const def of DEFINICION_BARRAS) {
      const fila = document.createElement("div");
      fila.className = "hud-vitales-fila";
      fila.title = def.titulo;
      if (def.clave === "aire") fila.hidden = true; // solo visible buceando, ver actualizar()

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
      this.barras.set(def.clave, { relleno, fila });
    }

    contenedor.appendChild(raiz);
  }

  actualizar(v: VitalesVisibles): void {
    const pct = (valor: number, max: number) => `${Math.max(0, Math.min(100, max > 0 ? (valor / max) * 100 : 0))}%`;
    this.barras.get("vida")!.relleno.style.width = pct(v.vida, v.vidaMax);
    this.barras.get("estamina")!.relleno.style.width = pct(v.estamina, 100);
    this.barras.get("comida")!.relleno.style.width = pct(v.comida, 100);
    this.barras.get("bebida")!.relleno.style.width = pct(v.bebida, 100);
    const rellenoCaca = this.barras.get("caca")!.relleno;
    rellenoCaca.style.width = pct(v.caca, 100);
    rellenoCaca.classList.toggle("urgente", v.caca >= UMBRAL_URGENTE_CACA);

    const rellenoTemp = this.barras.get("temperatura")!.relleno;
    rellenoTemp.style.width = pct(v.temperatura, 100);
    rellenoTemp.classList.toggle("urgente", Math.abs(v.temperatura - 50) >= MARGEN_TEMPERATURA_COMODA);

    // Aire: SOLO relevante buceando (docs/GDD_Mecanicas.md §5.4) — el resto
    // del tiempo vale 100 y no aporta nada, se ocultaría la fila entera para
    // no ensuciar el HUD con una barra siempre llena e irrelevante.
    const filaAire = this.barras.get("aire")!;
    const buceando = v.estado === "buceando";
    filaAire.fila.hidden = !buceando;
    if (buceando) {
      filaAire.relleno.style.width = pct(v.aire, 100);
      filaAire.relleno.classList.toggle("urgente", v.aire < 30);
    }
  }
}
