import { Client, matchMaker } from "@colyseus/core";
import * as path from "path";
import { RoomExteriorBase, PA_MAX_COMBATE } from "./base/RoomExteriorBase";
import { cargarMapaColision } from "../mundo/mapaColision";
import { TIPO } from "../mundo/colisiones";
import { CombateSchema, CombateUnidad } from "./schema/CombateState";
import { Fauna, Enemigo } from "./schema/HubState";
import { calcularIniciativa, ordenarTurnos, UnidadCombate } from "../combate/arenaCombate";
import { tomarRosterArena, RetornoJugador } from "../combate/registroArenas";

export interface OpcionesArena {
  combateId: string;
  name?: string;
}

/**
 * Room instanciada de UN combate (docs/GDD_Combate.md §9.2, pedido
 * 2026-08-30): una por combate (`filterBy(["combateId"])`, mismo patrón de
 * instancia por clave que interior/mazmorra). Extiende RoomExteriorBase
 * TAL CUAL — hereda gratis el protocolo `combate:*` entero (mover/acción/
 * pasarTurno/huir ya cableados en `iniciarMovimiento()`), así que esta clase
 * SOLO monta el escenario inicial a partir del roster que dejó la room de
 * origen y gestiona la entrada/salida de jugadores.
 *
 * Los combatientes SIN cliente (fauna/enemigo) se recrean aquí como
 * entidades sintéticas (`state.fauna`/`state.enemigos`, mismo id que en la
 * room de origen) para que TODO el código de combate ya existente
 * (`statsCombatiente`/`aplicarVida`/`finalizarMuerte`, genérico por tipo de
 * entidad) funcione sin ningún cambio — al terminar, el resultado se
 * reenvía a la entidad REAL de la room de origen (`aplicarResultadoRemoto`,
 * vía `matchMaker.getLocalRoomById`, mismo proceso — "un solo servidor").
 */
export class ArenaCombateRoom extends RoomExteriorBase {
  private combateIdPropio!: string;
  private origenRoomId!: string;
  /** clave = NOMBRE del jugador (sessionId cambia al reconectar aquí — el nombre no) hasta que hace onJoin y se remapea a su sessionId real. */
  private retornosPorJugador = new Map<string, RetornoJugador>();

  async onCreate(options: OpcionesArena) {
    if (!options?.combateId) throw new Error("ArenaCombateRoom necesita options.combateId");
    this.combateIdPropio = options.combateId;

    const roster = tomarRosterArena(options.combateId);
    if (!roster) throw new Error(`Sin roster para el combate ${options.combateId} — ventana ya consumida o combate inexistente`);
    this.origenRoomId = roster.origenRoomId;

    const rutaMapa = path.join(__dirname, "..", "..", "..", "assets", "mapas", "arenas", roster.mapaArenaId);
    const mapa = cargarMapaColision(rutaMapa);
    this.mundo = mapa;
    this.iniciarMovimiento(); // cablea TODO el protocolo combate:* de la base, gratis

    const combate = new CombateSchema();
    combate.gx0 = 0; combate.gy0 = 0; combate.ancho = mapa.ancho; combate.alto = mapa.alto;
    for (let i = 0; i < mapa.casillas.length; i++) combate.obstaculos.push(mapa.casillas[i] === TIPO.SOLIDO ? 1 : 0);
    combate.fase = "activo";

    // Formación fresca (izquierda/derecha, repartidos alrededor de la fila
    // central) — NO se intenta preservar la posición exacta que tenían en
    // la rejilla provisional de la room de origen (esa solo servía para
    // validar alcance/co-op antes de cerrar la ventana, GDD §9.2).
    const filaCentral = Math.floor(mapa.alto / 2);
    const desplazamiento = (indice: number) => {
      if (indice === 0) return 0;
      const signo = indice % 2 === 1 ? 1 : -1;
      return signo * Math.ceil(indice / 2);
    };
    let contadorA = 0, contadorB = 0;

    const puras: UnidadCombate[] = [];
    for (const p of roster.participantes) {
      const esA = p.bando === "A";
      const gx = esA ? 1 : mapa.ancho - 2;
      const gy = Math.max(0, Math.min(mapa.alto - 1, filaCentral + desplazamiento(esA ? contadorA++ : contadorB++)));

      const cu = new CombateUnidad();
      cu.id = p.esJugador ? p.nombreJugador! : p.id;
      cu.esJugador = p.esJugador;
      cu.bando = p.bando;
      cu.gx = gx; cu.gy = gy;
      cu.hp = p.hp; cu.hpMax = p.hpMax;
      cu.pa = PA_MAX_COMBATE; cu.paMax = PA_MAX_COMBATE;
      cu.iniciativa = calcularIniciativa(10, Math.random);
      cu.estado = "activo";
      cu.ataqueFisico = p.ataqueFisico;
      cu.defensaFisica = p.defensaFisica;
      cu.alcance = p.alcance;
      cu.pasivo = p.pasivo ?? false;
      combate.unidades.set(cu.id, cu);
      puras.push({
        id: cu.id, esJugador: cu.esJugador, bando: cu.bando as "A" | "B", gx: cu.gx, gy: cu.gy,
        hp: cu.hp, hpMax: cu.hpMax, pa: cu.pa, paMax: cu.paMax, iniciativa: cu.iniciativa,
        estado: "activo", ataqueFisico: cu.ataqueFisico, defensaFisica: cu.defensaFisica, alcance: cu.alcance,
        pasivo: cu.pasivo,
      });

      if (p.esJugador) {
        // Sin retorno capturado (p.ej. el OBJETIVO de un combate:iniciar
        // PvP — nadie le preguntó nada, se vio arrastrado a la pelea): cae
        // al Hub, el mismo destino por defecto que ya usa el resto del
        // sistema de portales cuando no hay dónde volver más concreto.
        this.retornosPorJugador.set(p.nombreJugador!, p.retorno ?? { nombre: p.nombreJugador ?? "?", sala: "hub" });
      } else if (p.tipoEntidad === "fauna") {
        const f = new Fauna();
        f.x = gx; f.y = gy; f.especieId = p.especieId ?? ""; f.vida = p.hp; f.vidaMax = p.hpMax; f.ataque = p.ataqueFisico;
        this.state.fauna.set(p.id, f);
      } else if (p.tipoEntidad === "enemigo") {
        const e = new Enemigo();
        e.x = gx; e.y = gy; e.enemigoId = p.enemigoId ?? ""; e.variante = p.variante ?? 0; e.esBoss = p.esBoss ?? false;
        e.vida = p.hp; e.vidaMax = p.hpMax; e.ataque = p.ataqueFisico; e.defensa = p.defensaFisica;
        this.state.enemigos.set(p.id, e);
      }
    }

    for (const id of ordenarTurnos(puras)) combate.ordenTurnos.push(id);
    combate.turnoActual = 0;
    this.state.combates.set(options.combateId, combate);

    void this.avanzarTurnosIA(options.combateId); // por si el primer turno es de un no-jugador
  }

  async onJoin(client: Client, options: OpcionesArena) {
    const nombre = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;
    const combate = this.state.combates.get(this.combateIdPropio);
    const cu = combate?.unidades.get(nombre);
    if (!combate || !cu) {
      // No es un participante esperado de ESTE combate (roster ya consumido,
      // o alguien intentando entrar a una arena que no le corresponde) —
      // se rechaza en vez de dejarlo mirar un combate ajeno.
      client.leave();
      return;
    }

    const player = this.crearJugador(client, { name: nombre }, cu.gx, cu.gy);
    player.vida = cu.hp; player.vidaMax = cu.hpMax; player.ataque = cu.ataqueFisico; player.defensa = cu.defensaFisica;

    // Remapea la unidad de "nombre" (clave provisional, sessionId no existía
    // al montar el combate en onCreate) a su sessionId real de ESTA room.
    // `ordenTurnos` se reconstruye ENTERA (clear + push) en vez de mutar un
    // índice suelto (`arr[i] = x`) — con varios clientes ya conectados a la
    // room, la reasignación de índice suelta de ArraySchema no replicaba
    // bien a los clientes que se unen DESPUÉS (bug real encontrado en el
    // E2E: dejaba un "Bjorn" fantasma además del sessionId ya remapeado)
    // — clear+push es el mismo patrón que ya usa el resto del proyecto
    // para poblar arrays de Schema, sin ese problema.
    combate.unidades.delete(nombre);
    cu.id = client.sessionId;
    combate.unidades.set(client.sessionId, cu);
    const nuevoOrden = [...combate.ordenTurnos].map((id) => (id === nombre ? client.sessionId : id));
    combate.ordenTurnos.clear();
    for (const id of nuevoOrden) combate.ordenTurnos.push(id);
    const retorno = this.retornosPorJugador.get(nombre);
    if (retorno) {
      this.retornosPorJugador.delete(nombre);
      this.retornosPorJugador.set(client.sessionId, retorno);
    }
  }

  /**
   * Combate resuelto (docs/GDD_Combate.md §9.2): cada jugador vuelve
   * exactamente a donde salió (`portal:ir` con lo que mandó al entrar en
   * combate); cada no-jugador aplica su resultado final sobre su entidad
   * REAL en la room de origen; se quita el marcador de "combate en curso"
   * de allí. La room de arena se autodispone sola en cuanto se vacía
   * (comportamiento por defecto de Colyseus) — sin lógica extra aquí.
   */
  protected onCombateResuelto(combateId: string, combate: CombateSchema): void {
    if (combateId !== this.combateIdPropio) return;

    let origen: RoomExteriorBase | undefined;
    try {
      origen = matchMaker.getLocalRoomById(this.origenRoomId) as unknown as RoomExteriorBase;
    } catch {
      origen = undefined; // la room de origen ya se vació y autodispuso — nada que limpiar ahí
    }

    for (const cu of combate.unidades.values()) {
      if (cu.esJugador) {
        // Un jugador "caído" ya recibió SU propio portal:ir de respawn
        // (docs/GDD_Muerte_Respawn.md, vía finalizarMuerte→manejarMuerteJugador,
        // llamado antes desde comprobarFinDeCombate) — mandarle también
        // "volverDeCombate" aquí lo reengancharía de vuelta al sitio donde
        // empezó la pelea, pisando su respawn real.
        if (cu.estado === "caido") continue;
        const retorno = this.retornosPorJugador.get(cu.id) ?? {};
        const c = this.clients.find((cl) => cl.sessionId === cu.id);
        c?.send("portal:ir", { tipo: "volverDeCombate", ...retorno });
      } else if (origen) {
        void origen.aplicarResultadoRemoto(cu.id, cu.hp, cu.estado as "activo" | "caido" | "huido");
      }
    }
    origen?.quitarMarcadorCombate(combateId);
  }

  /**
   * Un jugador muere DENTRO de una arena instanciada — sus coordenadas aquí
   * son internas de la arena (mundo/mapa de combate), no del mundo real, así
   * que el objeto perdido tiene que caer en la room de ORIGEN (docs/
   * GDD_Muerte_Respawn.md). Sin la puerta exacta por la que entró en juego
   * (`retorno.puertaX/Y` — no siempre viene, p.ej. un combate iniciado
   * directo en mitad del Hub), cae a un punto de referencia fijo del mapa
   * de origen en vez de nada — impreciso mejor que perder el objeto del todo.
   */
  protected roomYPosicionParaDrop(sessionId: string): { room: RoomExteriorBase; x: number; y: number } | null {
    let origen: RoomExteriorBase | undefined;
    try {
      origen = matchMaker.getLocalRoomById(this.origenRoomId) as unknown as RoomExteriorBase;
    } catch {
      origen = undefined; // la room de origen ya se autodispuso — el objeto se pierde, caso raro aceptado
    }
    if (!origen) return null;
    const retorno = this.retornosPorJugador.get(sessionId);
    const x = typeof retorno?.puertaX === "number" ? retorno.puertaX : 5;
    const y = typeof retorno?.puertaY === "number" ? retorno.puertaY : 5;
    return { room: origen, x, y };
  }
}
