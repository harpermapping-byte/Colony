/**
 * Orquestador de la integración con Twitch (docs/GDD_Twitch.md, pedido
 * 2026-08-30) — UNA instancia por proceso (`obtenerGestorTwitch()`, mismo
 * criterio que `obtenerContextoGremios`/el tick de economía). Conecta los
 * módulos puros (titulos.ts, catalogoEventos.ts) con BD y con las rooms
 * activas vía registro.ts — es el ÚNICO sitio que sabe "qué pasa cuando
 * llega un comando de chat o se canjea un punto de canal", sin que las
 * Rooms ni el conector de Twitch (chatBot.ts) tengan que saberlo.
 *
 * "Modo Live": todo esto solo tiene efecto si `estaEnDirecto()` — por
 * defecto TRUE si no hay detección real de directo configurada (dev/tests
 * sin bloquear), con aviso en consola; en producción con credenciales de
 * Twitch, `estadoDirecto.ts` lo pone a su valor real.
 */
import { RolChat } from "./tipos";
import { resolverRol, tituloDe } from "./titulos";
import { EntradaEvento, TipoEvento, cooldownCumplido, elegirEventoAleatorio } from "./catalogoEventos";
import { buscarConexion, jugadoresConectados, roomsActivas } from "./registro";
import { esJarlGlobal } from "../construccion/construccion";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { obtenerContextoGremios } from "../gremios/contextoGremios";

const NOMBRE_STREAMER = process.env.TWITCH_CANAL ?? "el streamer";

export class GestorTwitch {
  private enDirecto: boolean;
  private ultimoCanje: Record<TipoEvento, number | null> = { malo: null, bueno: null };
  // Eventos de MUNDO (sin BD) activos ahora mismo — necesario para que una
  // room que se crea A MEDIO evento (un jugador viaja a una aldea nueva
  // mientras "Hay que trabajar" sigue activo) también lo reciba: sin esto,
  // `aplicarEvento` solo tocaba las rooms que YA existían en el instante del
  // canje, dejando fuera cualquier room futura hasta que el evento terminara.
  private eventosMundoActivos = new Set<string>();

  constructor() {
    const detectorConfigurado = !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
    this.enDirecto = !detectorConfigurado; // sin detección real, asumir directo para no bloquear pruebas — ver estadoDirecto.ts
    if (!detectorConfigurado) {
      console.warn("[twitch] TWITCH_CLIENT_ID/SECRET no configurados — 'en directo' se asume SIEMPRE true (modo prueba).");
    }
  }

  estaEnDirecto(): boolean {
    return this.enDirecto;
  }

  /** `estadoDirecto.ts` (detección real) o un admin (`twitch:forzarDirecto`, pruebas) llaman a esto. */
  fijarEnDirecto(valor: boolean): void {
    this.enDirecto = valor;
  }

  /**
   * Refresca el título social de un jugador según su rol de chat ACTUAL —
   * se llama en cada mensaje de chat (chatBot.ts trae los badges frescos
   * cada vez, cero caché de rol que pueda quedar desfasada). No hace nada
   * si ese nombre no está jugando ahora mismo.
   */
  actualizarRol(nombreTwitch: string, rol: RolChat, esSeguidor: boolean | undefined = undefined): void {
    const conexion = buscarConexion(nombreTwitch);
    if (!conexion) return;
    const rolResuelto = resolverRol(rol, esJarlGlobal(nombreTwitch), esSeguidor);
    conexion.room.fijarTituloTwitch(conexion.sessionId, tituloDe(rolResuelto, NOMBRE_STREAMER));
  }

  /**
   * `!curar` / `!comer` / `!beber` / `!cagar` (docs/GDD_Twitch.md) — solo
   * si el chatter está jugando AHORA (identidad v1: mismo nombre, sin
   * distinguir mayúsculas) y el streamer está en directo. Comandos
   * desconocidos o el chatter sin partida activa: no-op silencioso, un
   * chat de Twitch tiene demasiado ruido para responder a cada intento fallido.
   */
  manejarComandoChat(nombreTwitch: string, mensaje: string): void {
    if (!this.enDirecto) return;
    const comando = mensaje.trim().toLowerCase();
    if (!comando.startsWith("!")) return;
    const conexion = buscarConexion(nombreTwitch);
    if (!conexion) return;

    switch (comando) {
      case "!curar":
        conexion.room.curarCompleto(conexion.sessionId);
        break;
      case "!comer":
        conexion.room.llenarVital(conexion.sessionId, "comida");
        break;
      case "!beber":
        conexion.room.llenarVital(conexion.sessionId, "bebida");
        break;
      case "!cagar":
        conexion.room.vaciarCaca(conexion.sessionId);
        break;
    }
  }

  /**
   * Canje de puntos de canal (docs/GDD_Twitch.md) — `tipo` viene del
   * `reward_id` configurado en Twitch (mapeo pendiente de credenciales
   * reales, ver GDD §4); mientras tanto lo dispara `twitch:simularCanje`
   * (jarl) para poder probarlo de punta a punta. Cooldown de 5 min POR
   * POOL — bueno y malo nunca se bloquean entre sí.
   */
  intentarCanje(tipo: TipoEvento): { ok: true; evento: EntradaEvento } | { ok: false; motivo: string } {
    if (!this.enDirecto) return { ok: false, motivo: "el streamer no está en directo" };
    if (!cooldownCumplido(this.ultimoCanje[tipo])) return { ok: false, motivo: "todavía en cooldown" };
    this.ultimoCanje[tipo] = Date.now();

    const evento = elegirEventoAleatorio(tipo);
    void this.aplicarEvento(evento); // efectos con BD son async; el canje en sí ya queda confirmado (mismo criterio "fire and forget" que otorgarXpAtributoPorSesion)
    return { ok: true, evento };
  }

  private async aplicarEvento(evento: EntradaEvento): Promise<void> {
    switch (evento.id) {
      case "lluvia_dinero":
        await this.aplicarLluviaDinero();
        return;
      case "bendicion_gremio":
        await this.aplicarBendicionGremio();
        return;
      default:
        // El resto son efectos de mundo puros (sin BD) — cada Room activa
        // se encarga de los suyos (jugadores presentes, mapa, tenderetes).
        this.eventosMundoActivos.add(evento.id);
        for (const room of roomsActivas()) room.aplicarEventoTwitch(evento.id, true);
        if (evento.duracionMs > 0) {
          // .unref(): un timer de hasta 5 min no debe mantener vivo el
          // proceso ni bloquear el test runner (Node espera a que todos los
          // timers referenciados terminen antes de salir).
          setTimeout(() => {
            this.eventosMundoActivos.delete(evento.id);
            for (const room of roomsActivas()) room.aplicarEventoTwitch(evento.id, false);
          }, evento.duracionMs).unref();
        } else {
          this.eventosMundoActivos.delete(evento.id); // instantáneo (no debería llegar aquí, por si acaso)
        }
        return;
    }
  }

  /**
   * Una room recién creada (`RoomExteriorBase.iniciarMovimiento`, justo tras
   * `registrarRoom`) llama a esto para ponerse al día con cualquier evento
   * de mundo YA activo — sin esto, viajar a una aldea nueva a mitad de
   * "Hay que trabajar"/"El Corralito" etc. dejaría esa room sin el efecto
   * hasta que el evento terminara solo en las rooms que ya existían.
   */
  aplicarEventosActivosA(room: { aplicarEventoTwitch(eventoId: string, activar: boolean): void }): void {
    for (const eventoId of this.eventosMundoActivos) room.aplicarEventoTwitch(eventoId, true);
  }

  private async aplicarLluviaDinero(): Promise<void> {
    const FARYCOINS_LLUVIA = 10;
    const bd = await obtenerBdCompartida();
    for (const nombre of jugadoresConectados()) {
      const conexion = buscarConexion(nombre);
      if (!conexion) continue;
      const jugador = await bd.obtenerOCrearJugador(nombre);
      await bd.ajustarFarycoins(jugador.id, FARYCOINS_LLUVIA);
    }
  }

  private async aplicarBendicionGremio(): Promise<void> {
    const FARYCOINS_BENDICION = 50;
    const bd = await obtenerBdCompartida();
    const ctx = await obtenerContextoGremios(bd);
    for (const gremio of ctx.porId.values()) {
      await bd.ajustarBancoGremio(gremio.id, FARYCOINS_BENDICION);
    }
  }
}

let instancia: GestorTwitch | null = null;

export function obtenerGestorTwitch(): GestorTwitch {
  if (!instancia) instancia = new GestorTwitch();
  return instancia;
}

/** SOLO para tests: fuerza una instancia nueva (limpia cooldowns/enDirecto entre casos). */
export function _resetGestorTwitchParaTests(): void {
  instancia = null;
}
