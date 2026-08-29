import { Room, Client } from "@colyseus/core";
import { HubState, Player, ObjetoMundoSchema } from "../schema/HubState";
import { MundoColision, moverAABB, medioEn, nivelMinimo, separarPJs, TIPO, RADIO_PJ } from "../../mundo/colisiones";
import { MapaCargado } from "../../mundo/mapaColision";
import { recolectableCercano } from "../../mundo/recolectables";
import { CatalogoItems, Contenedor, crearContenedor, cargarCatalogoItems, quitarItem } from "../../inventario/inventario";
import { intentarCoger, Cogible } from "../../inventario/cogerSoltar";
import { sincronizarContenedor } from "../../inventario/sincronizarSchema";

const VEL_ANDAR = 3.75;
const VEL_NADAR = 2.2;
const VEL_BUCEAR = 1.7;
export const TICK_HZ = 30;

/** Radio de interacción para portales Y para "coger" (fase 2 de inventario) —
 * antes repetido como 2.2 mágico en 3 sitios distintos (un portal por room),
 * ahora una única constante compartida. */
export const RADIO_INTERACCION = 2.2;

const ANCHO_CUERPO = 8;
const ALTO_CUERPO = 6;

/** Lo que hay para coger en un punto: cuánto entra al inventario y qué hacer con la FUENTE si entró. */
export interface ObjetoCogible extends Cogible {
  confirmar: () => void;
}

export interface Direccion {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Base común de las rooms de MOVIMIENTO LIBRE sobre una rejilla de
 * colisión (Hub, regiones/aldeas, interiores de edificio — docs/
 * GDD_Sistema_Puertas.md): input/movimiento/nadar-bucear/empuje PJ-PJ.
 * Cada subclase carga SU rejilla (exterior bakeada o interior de un
 * edificio) y llama a `iniciarMovimiento()` desde `onCreate`.
 */
export abstract class RoomExteriorBase extends Room<HubState> {
  maxClients = 40;
  protected inputs = new Map<string, Direccion>();
  protected mundo!: MundoColision;

  // --- inventario, fase 2 "coger/soltar" (docs/GDD_Inventario.md §7) ---
  // Contenedor PURO por sesión — fuente de verdad para agregarItem/quitarItem
  // (player.inventario.cuerpo, el Schema, es solo el espejo de red — se
  // sincroniza explícitamente tras cada mutación, ver sincronizarSchema.ts).
  // Sin persistencia ni jugador_id esta fase (alcance explícito del GDD):
  // vive y muere con la sesión, igual que `inputs`.
  protected inventarios = new Map<string, Contenedor>();
  protected catalogoItems: CatalogoItems = cargarCatalogoItems();
  private siguienteObjetoMundoId = 1;
  // Asignado por HubRoom/RegionRoom tras cargar su mapa — habilita "coger" de
  // recolectables del bake exterior sin que esta base conozca su tipo
  // concreto de room; InteriorRoom en cambio sobreescribe buscarCogibleEnMundo.
  protected mapaExterior?: MapaCargado;

  protected iniciarMovimiento() {
    this.setState(new HubState());
    this.setPatchRate(1000 / 15);

    this.onMessage("input", (client, dir: Direccion) => {
      this.inputs.set(client.sessionId, {
        x: clamp(dir?.x ?? 0, -1, 1),
        y: clamp(dir?.y ?? 0, -1, 1),
      });
    });

    this.onMessage("nivel", (client, delta: number) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const medio = medioEn(this.mundo, player.x, player.y);
      const minimo = nivelMinimo(medio);
      if (minimo === 0) return; // en tierra (o en un interior, sin agua) no hay niveles
      player.nivel = clamp(player.nivel + (delta > 0 ? 1 : -1), minimo, 0);
    });

    this.onMessage("coger", (client) => this.manejarCoger(client));
    this.onMessage("soltar", (client, msg: { instanciaId?: number; cantidad?: number }) => this.manejarSoltar(client, msg));

    this.setSimulationInterval(() => this.actualizarMovimiento(), 1000 / TICK_HZ);
  }

  protected nombreDe(client: Client): string | undefined {
    return this.state.players.get(client.sessionId)?.name;
  }

  protected crearJugador(client: Client, options: { name?: string }, x: number, y: number): Player {
    const player = new Player();
    player.x = x;
    player.y = y;
    player.name = options?.name?.slice(0, 20) || `Guest-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { x: 0, y: 0 });

    const contenedor = crearContenedor(ANCHO_CUERPO, ALTO_CUERPO);
    this.inventarios.set(client.sessionId, contenedor);
    sincronizarContenedor(player.inventario.cuerpo, contenedor); // sin esto el Schema se queda en ancho=0/alto=0 (bug real, ver crítica del diseño)

    return player;
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.inventarios.delete(client.sessionId);
  }

  /**
   * "Coger" sin payload: auto-apunta al interactuable más cercano dentro de
   * RADIO_INTERACCION (mismo criterio que "portal:usar" — el cliente no
   * tiene UI de targeting hoy). Prioridad: lo soltado por otros jugadores
   * (objetosMundo, universal a las 4 rooms vía HubState) antes que lo del
   * bake — caso raro de empate exacto, aceptado.
   *
   * Orden crítico (fijado tras la crítica adversarial del diseño): la fuente
   * NUNCA se borra antes de confirmar que agregarItem tuvo éxito. Como este
   * handler es 100% síncrono (memoria pura, sin ningún `await` de por medio
   * — decisión explícita de esta fase, ver GDD §7), no hay ninguna ventana
   * en la que un segundo "coger" pueda colarse entre "encontrar" y "borrar":
   * el propio single-thread de Colyseus basta para que sea atómico.
   */
  private manejarCoger(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;

    const candidato = this.buscarObjetoSoltadoCercano(player.x, player.y) ?? this.buscarCogibleEnMundo(player.x, player.y);
    if (!candidato) {
      client.send("coger:error", { motivo: "nada_cerca" });
      return;
    }

    const resultado = intentarCoger(contenedor, this.catalogoItems, candidato);
    if (!resultado.ok) {
      client.send("coger:error", { motivo: resultado.motivo ?? "sin_hueco" });
      return;
    }
    candidato.confirmar();
    sincronizarContenedor(player.inventario.cuerpo, contenedor);
  }

  /** Objeto soltado por CUALQUIER jugador (HubState.objetosMundo, compartido por las 4 rooms) más cercano dentro del radio. Universal: no requiere que la subclase sepa nada. */
  private buscarObjetoSoltadoCercano(x: number, y: number): ObjetoCogible | null {
    let mejorId: string | null = null;
    let mejorDist = Infinity;
    this.state.objetosMundo.forEach((o, id) => {
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < RADIO_INTERACCION && d < mejorDist) {
        mejorDist = d;
        mejorId = id;
      }
    });
    if (!mejorId) return null;
    const objetosMundo = this.state.objetosMundo;
    const idElegido = mejorId as string;
    const o = objetosMundo.get(idElegido)!;
    return {
      itemId: o.itemId,
      cantidad: o.cantidad,
      confirmar: () => objetosMundo.delete(idElegido), // MapSchema: el delete YA se replica solo a todos, sin broadcast manual
    };
  }

  /**
   * Recolectables del BAKE exterior — por defecto usa `mapaExterior` (Hub/
   * Region, tras cargar su mapa); InteriorRoom sobreescribe esto para sus
   * objetos "sobre" en vez de heredar este comportamiento.
   */
  protected buscarCogibleEnMundo(x: number, y: number): ObjetoCogible | null {
    if (!this.mapaExterior) return null;
    const encontrado = recolectableCercano(this.mapaExterior.recolectables, this.mapaExterior.ancho, x, y, RADIO_INTERACCION);
    if (!encontrado) return null;
    const mapa = this.mapaExterior;
    return {
      itemId: encontrado.item.itemId,
      cantidad: 1,
      confirmar: () => {
        mapa.recolectables.delete(encontrado.idx);
        this.broadcast("mundo:objetoQuitado", { origen: "exterior", x: encontrado.item.x, y: encontrado.item.y });
      },
    };
  }

  /**
   * "Soltar" — SOLO desde `cuerpo`, la pila ENTERA de una instancia (soltar
   * cantidad parcial es UI que no existe todavía, fuera de alcance de esta
   * fase). `quitarItem` ya es atómico por sí solo (falla sin tocar nada), no
   * hace falta el snapshot/restauración que sí necesita "coger".
   */
  private manejarSoltar(client: Client, msg: { instanciaId?: number; cantidad?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const contenedor = this.inventarios.get(client.sessionId);
    if (!contenedor) return;
    if (typeof msg?.instanciaId !== "number") return;

    const it = contenedor.items.find((i) => i.id === msg.instanciaId);
    if (!it) {
      client.send("soltar:error", { motivo: "no_encontrado" });
      return;
    }
    const cantidad = Math.max(1, Math.min(msg.cantidad ?? it.cantidad, it.cantidad));
    const itemId = it.itemId;

    const resultado = quitarItem(contenedor, msg.instanciaId, cantidad);
    if (!resultado.ok) {
      client.send("soltar:error", { motivo: resultado.motivo ?? "no_encontrado" });
      return;
    }

    const o = new ObjetoMundoSchema();
    o.x = Math.floor(player.x) + 0.5;
    o.y = Math.floor(player.y) + 0.5;
    o.itemId = itemId;
    o.cantidad = cantidad;
    this.state.objetosMundo.set(String(this.siguienteObjetoMundoId++), o); // MapSchema: se replica solo, incluida la foto inicial a quien se una después

    sincronizarContenedor(player.inventario.cuerpo, contenedor);
  }

  private actualizarMovimiento() {
    const dt = 1 / TICK_HZ;
    this.inputs.forEach((dir, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) return;

      const idx = Math.floor(player.y) * this.mundo.ancho + Math.floor(player.x);
      const medio = medioEn(this.mundo, player.x, player.y);
      let vel: number;
      if (medio === TIPO.AGUA || medio === TIPO.AGUA_PROFUNDA) {
        vel = player.nivel < 0 ? VEL_BUCEAR : VEL_NADAR;
      } else {
        vel = VEL_ANDAR * (this.mundo.velocidad[idx] ?? 1);
      }

      if (dir.x !== 0 || dir.y !== 0) {
        const norma = Math.hypot(dir.x, dir.y);
        const paso = (vel * dt) / norma;
        const destino = moverAABB(this.mundo, player.x, player.y, dir.x * paso, dir.y * paso);
        player.x = destino.x;
        player.y = destino.y;
      }

      const medioAhora = medioEn(this.mundo, player.x, player.y);
      if (medioAhora === TIPO.TIERRA || medioAhora === TIPO.SOLIDO) {
        player.nivel = 0;
        player.estado = "tierra";
      } else {
        player.nivel = clamp(player.nivel, nivelMinimo(medioAhora), 0);
        player.estado = player.nivel < 0 ? "buceando" : "nadando";
      }
    });

    const cuerpos = [...this.state.players.values()];
    separarPJs(this.mundo, cuerpos, RADIO_PJ);
  }
}
