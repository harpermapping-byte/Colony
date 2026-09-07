/**
 * Vida en interiores (GDD_Agentes_Moviles.md v1.2/v1.3, pedido del
 * streamer 2026-08-28): cuando un jugador entra a un edificio, los NPCs
 * cuya rutina dice "estoy AQUÍ, en ESTA sala, a esta hora" aparecen de
 * verdad — casa (la familia socializando en el salón sale gratis: viven
 * en el mismo edificio, sus rutinas caen en franjas horarias parecidas) o
 * trabajo (el tendero vendiendo en su tienda de verdad, no solo en la
 * puerta).
 *
 * v1.4 (2026-09-08, pedido streamer: "no caminan entre salas... deberían
 * moverse entre salas sentarse en sillas dormir y tumbarse en su cama de
 * noche"): dos piezas nuevas sobre la base QUIETA de antes.
 * 1. Silla/cama REAL: si la sala resuelta por la rutina (`accionesPorSala.json`)
 *    tiene mobiliario `esCama`/`esSilla` de verdad (interiorColision.ts,
 *    bakeado por interiores/), el NPC se coloca en su casilla de
 *    interacción y `Npc.sentado`/`durmiendo` se enciende — el cliente ya
 *    anima la pose sola (game.ts, mismo `rig.actualizar` que el jugador).
 *    Sin mobiliario de ese tipo en la sala: cae al punto genérico de
 *    siempre (comportamiento IDÉNTICO al de antes de esta pasada).
 * 2. Caminar de verdad: cuando el objetivo de un NPC cambia (nueva sala,
 *    tramo distinto), en vez de teletransportarlo se calcula un camino
 *    real (`interiorColision.caminoEntre`, BFS acotado a ESTE edificio,
 *    NO viola "nada de A* en vivo" — ver el comentario de esa función) y
 *    se le hace avanzar una casilla por tick de `avanzarCaminos` — la
 *    interpolación+animación de marcha del cliente ya es genérica
 *    (game.ts: "un NPC es otro que se mueve por patches del servidor,
 *    nada más"), así que no hace falta tocar el cliente para que se vea
 *    caminar. Reserva de mueble (`reservas`) para que dos NPCs nunca
 *    compartan la misma silla/cama.
 */
import { MapSchema } from "@colyseus/schema";
import { Npc } from "../rooms/schema/HubState";
import { TramoRutina, tramoActivoPorHora } from "./agentes";
import { InteriorCargado, MuebleInteractivo, caminoEntre } from "./interiorColision";

// Jitter determinista por NPC (hash simple de su slotId): SOLO entra en
// juego si el ciclo de puntos de la sala se repite (más NPCs que puntos
// distintos) — así ni siquiera los que comparten punto por falta de sitio
// quedan exactamente apilados. Un mueble reservado (silla/cama) NUNCA
// lleva jitter: sentarse "un poco a un lado" de la silla se vería mal.
function jitterDe(slotId: string): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < slotId.length; i++) h = (h * 31 + slotId.charCodeAt(i)) >>> 0;
  const a = ((h % 1000) / 1000) * Math.PI * 2;
  const r = 0.1 + (((h >>> 8) % 1000) / 1000) * 0.12;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

// Acciones de rutina (poblacion/catalogo/perfilesSociales.json) que caen en
// una sala con silla real (accionesPorSala.json: comer/socializar/trabajar)
// Y de verdad se hacen SENTADO — vigilar/pregonar/trabajar de pie no cuentan
// aunque su sala tenga sillas. `dormir` es aparte (tumbado, no sentado).
const ACCIONES_SENTADO = new Set(["comer", "socializar", "beber", "cotillear", "contar_historias", "pedir_sentado"]);

export interface NpcConCasa {
  slotId: string;
  nombre: string;
  grito?: string;
  casaEdificioId?: string | null; // edificio (interior) donde "vive" — poblacion/src/generarRutina.js
  trabajoEdificioId?: string | null; // edificio (interior) donde "trabaja" — ídem
  rutina: TramoRutina[];
}

interface CaminoActivo {
  path: { x: number; y: number }[];
  idx: number;
  sentado: boolean;
  durmiendo: boolean;
}

/**
 * Estado en memoria (por instancia de `InteriorRoom` — se pierde al
 * destruirse la room, igual que el resto de "vida en interiores", nunca
 * persiste) de reservas de mueble y caminos en curso. Antes `poblarInterior`
 * era una función pura sin estado; ahora hace falta recordar QUÉ mueble
 * ocupa cada NPC (para no reasignarlo cada 20s) y POR DÓNDE va caminando.
 */
export class GestorVidaInterior {
  /** instanceId de mueble -> slotId que lo ocupa. */
  private reservas = new Map<string, string>();
  /** slotId -> instanceId que tiene reservado (inverso de `reservas`, para liberar rápido). */
  private muebleDe = new Map<string, string>();
  /** slotId -> clave del objetivo actual ("tipoSalaId:accion"), para detectar cuándo cambia de verdad. */
  private objetivoDe = new Map<string, string>();
  /** slotId -> camino en curso (si está a mitad de andar hacia su objetivo nuevo). */
  private caminos = new Map<string, CaminoActivo>();

  private liberar(slotId: string) {
    const instanceId = this.muebleDe.get(slotId);
    if (instanceId) { this.reservas.delete(instanceId); this.muebleDe.delete(slotId); }
  }

  private reservar(slotId: string, mueble: MuebleInteractivo): boolean {
    const ocupante = this.reservas.get(mueble.instanceId);
    if (ocupante && ocupante !== slotId) return false; // ya lo tiene otro NPC
    if (this.muebleDe.get(slotId) !== mueble.instanceId) this.liberar(slotId);
    this.reservas.set(mueble.instanceId, slotId);
    this.muebleDe.set(slotId, mueble.instanceId);
    return true;
  }

  /**
   * Reconstruye qué NPCs de `candidatos` están DENTRO de `edificioId` planta
   * `nivel` a la `hora` dada (en casa o en su trabajo — el que caiga en ESTE
   * edificio). Se llama al crear la room y cada vez que puede haber
   * cambiado el tramo activo (InteriorRoom la re-ejecuta con un intervalo
   * bajo, cada 20s). No mueve a nadie de golpe: si el objetivo cambió,
   * arma un camino real (`caminoEntre`) que `avanzarCaminos` recorre poco
   * a poco en un tick aparte, más rápido.
   */
  repoblar(
    salida: MapSchema<Npc>,
    candidatos: NpcConCasa[],
    edificioId: string,
    nivel: number,
    interior: InteriorCargado,
    hora: number,
  ) {
    const vistos = new Set<string>();
    // reparto sin repetir casilla: un contador por tipoSalaId, incrementado
    // cada vez que se coloca a alguien ahí en ESTA pasada
    const turnoPorSala = new Map<string, number>();
    // muebles ya asignados en ESTA pasada (para no dar la misma silla dos
    // veces si dos NPCs comparten sala Y acción, aparte de la reserva
    // persistente entre pasadas)
    const mueblesUsadosEstaPasada = new Set<string>();
    for (const npc of candidatos) {
      const enCasa = npc.casaEdificioId === edificioId;
      const enTrabajo = npc.trabajoEdificioId === edificioId;
      if (!enCasa && !enTrabajo) continue;
      const i = tramoActivoPorHora(npc.rutina, hora);
      if (i < 0) continue;
      const tramo = npc.rutina[i];
      // el tramo activo tiene que coincidir con el motivo por el que este
      // NPC podría estar AQUÍ (en casa si es su vivienda, trabajando si es
      // su tienda/taller) — un tramo con otro `lugar` ya se ve fuera, en la
      // puerta/ronda que resuelve el agente exterior (RegionRoom)
      const encaja = (tramo.lugar === "casa" && enCasa) || (tramo.lugar === "trabajo" && enTrabajo);
      if (!encaja) continue;
      const planta = tramo.sala?.planta ?? 0;
      if (planta !== nivel) { this.liberar(npc.slotId); continue; }

      const tipoSalaId = tramo.sala?.tipoSalaId;
      const muebles = tipoSalaId ? interior.mueblesPorSala.get(tipoSalaId) : undefined;
      let punto: { x: number; y: number };
      let sentado = false, durmiendo = false, muebleElegido: MuebleInteractivo | undefined;

      if (muebles && muebles.length > 0 && (tramo.accion === "dormir" || ACCIONES_SENTADO.has(tramo.accion))) {
        const quiereCama = tramo.accion === "dormir";
        const candidatosMueble = muebles.filter((m) => (quiereCama ? m.esCama : m.esSilla) && !mueblesUsadosEstaPasada.has(m.instanceId));
        // el que ya tenía reservado sigue teniéndolo con prioridad — para
        // no "cambiarle la cama" cada 20s sin motivo real
        const yaSuyo = candidatosMueble.find((m) => this.muebleDe.get(npc.slotId) === m.instanceId);
        muebleElegido = yaSuyo ?? candidatosMueble.find((m) => this.reservar(npc.slotId, m));
        if (muebleElegido) {
          mueblesUsadosEstaPasada.add(muebleElegido.instanceId);
          punto = { x: muebleElegido.x, y: muebleElegido.y };
          durmiendo = quiereCama;
          sentado = !quiereCama;
        }
      }
      if (!muebleElegido) {
        this.liberar(npc.slotId);
        const puntos = tipoSalaId ? interior.salasPorTipo.get(tipoSalaId) : undefined;
        if (puntos && puntos.length > 0) {
          const clave = tipoSalaId!;
          const turno = turnoPorSala.get(clave) ?? 0;
          turnoPorSala.set(clave, turno + 1);
          punto = puntos[turno % puntos.length];
        } else {
          punto = { x: interior.spawnX - 0.5, y: interior.spawnY - 0.5 };
        }
      }
      punto = punto!;

      vistos.add(npc.slotId);
      let esquema = salida.get(npc.slotId);
      const esNuevo = !esquema;
      if (!esquema) {
        esquema = new Npc();
        esquema.nombre = npc.nombre;
        esquema.grito = npc.grito ?? "";
        salida.set(npc.slotId, esquema);
      }
      esquema.accion = tramo.accion;
      esquema.visible = true;

      // objetivo real (casilla + pose) — solo si CAMBIÓ de verdad se arma
      // un camino nuevo; si es el mismo de la pasada anterior, se deja
      // seguir su camino en curso (o quieto si ya llegó) sin reiniciarlo.
      const claveObjetivo = `${Math.round(punto.x)},${Math.round(punto.y)}:${sentado}:${durmiendo}`;
      if (this.objetivoDe.get(npc.slotId) !== claveObjetivo) {
        this.objetivoDe.set(npc.slotId, claveObjetivo);
        const j = muebleElegido ? { dx: 0, dy: 0 } : jitterDe(npc.slotId);
        const destino = { x: punto.x + 0.5 + j.dx, y: punto.y + 0.5 + j.dy };
        if (esNuevo) {
          // primera aparición: sin animación de llegada, aparece ya puesto
          // (mismo criterio de siempre — "caminar" solo tiene sentido
          // cuando ya estaba visible en OTRO sitio de este mismo edificio)
          esquema.x = destino.x;
          esquema.y = destino.y;
          esquema.sentado = sentado;
          esquema.durmiendo = durmiendo;
          this.caminos.delete(npc.slotId);
        } else {
          const camino = caminoEntre(interior, { x: esquema.x, y: esquema.y }, punto);
          if (camino && camino.length > 0) {
            // se sienta/tumba solo al LLEGAR — de camino va de pie. El
            // último paso de `camino` ya es `punto` exacto (caminoEntre
            // se mete en el mueble aunque su casilla sea sólida).
            esquema.sentado = false;
            esquema.durmiendo = false;
            // idx=-1: `avanzarCaminos` incrementa ANTES de leer, así que el
            // primer tick de verdad avanza a path[0] (el primer paso real,
            // que ya está a una casilla del origen) — no lo saltamos.
            this.caminos.set(npc.slotId, { path: camino.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })), idx: -1, sentado, durmiendo });
          } else {
            // sin camino real (mismo sitio, o sala desconectada) — salto directo, como antes
            esquema.x = destino.x;
            esquema.y = destino.y;
            esquema.sentado = sentado;
            esquema.durmiendo = durmiendo;
            this.caminos.delete(npc.slotId);
          }
        }
      }
    }
    // quita a quien ya no toca estar aquí (cambió de tramo, o de planta)
    for (const slotId of [...salida.keys()]) {
      if (!vistos.has(slotId)) {
        salida.delete(slotId);
        this.liberar(slotId);
        this.objetivoDe.delete(slotId);
        this.caminos.delete(slotId);
      }
    }
  }

  /**
   * Avanza un paso (una casilla) el camino de cada NPC que tenga uno en
   * curso — pensado para un intervalo bastante más corto que `repoblar`
   * (p.ej. cada 500ms) para que la marcha se vea fluida; el cliente hace
   * el resto (interpolación entre patches, animación de zancada) sin
   * ningún cambio propio, igual que ya hace con jugadores/fauna.
   */
  avanzarCaminos(salida: MapSchema<Npc>) {
    if (this.caminos.size === 0) return;
    for (const [slotId, estado] of [...this.caminos.entries()]) {
      const esquema = salida.get(slotId);
      if (!esquema) { this.caminos.delete(slotId); continue; }
      estado.idx++;
      const siguiente = estado.path[estado.idx];
      if (!siguiente) {
        esquema.sentado = estado.sentado;
        esquema.durmiendo = estado.durmiendo;
        this.caminos.delete(slotId);
        continue;
      }
      esquema.x = siguiente.x;
      esquema.y = siguiente.y;
    }
  }
}
