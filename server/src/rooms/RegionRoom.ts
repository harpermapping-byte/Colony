import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";
import { GestorAgentes, NpcBakeado } from "../mundo/agentes";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { GestorFauna, FaunaSpawn } from "../mundo/fauna";
import { crearAlmacenDatos, IAlmacenDatos } from "../datos/bd";
import { ejecutarTickEconomia } from "../mundo/economiaAsentamientos";

// Un pulso de economía por hora DE JUEGO (docs/GDD_Faccion_Bandidos.md §6) —
// mismo ritmo que ya rige turnos de guardia/rutinas de NPC, no un número de
// balance inventado aparte. minutosRealesPorDia/24 = minutos reales por hora
// de juego (assets/mundo/tiempo.json: 30 min/día → 1.25 min/hora ≈ 75 s).
import * as tiempoJson from "../../../assets/mundo/tiempo.json";
// TICK_ECONOMIA_MS: mismo criterio que HORA_FORZADA — override SOLO para
// tests/depuración (un E2E real no puede esperar 75s por pulso); nunca en
// producción.
const MS_POR_TICK_ECONOMIA = Number(process.env.TICK_ECONOMIA_MS) || (tiempoJson.minutosRealesPorDia / 24) * 60_000;

interface OpcionesRegion {
  name?: string;
  mapaId: string;
  entradaX?: number;
  entradaY?: number;
}

/**
 * Instancia de una región exterior (aldea, POI...) fuera del Hub —
 * docs/GDD_Sistema_Puertas.md. Mismo formato de mapa que el Hub (sectores
 * bakeados, mismo motor de colisión), pero SIN el sistema de
 * construcción/parcelas/jarl: eso es propio del Hub (ver GDD_Construccion,
 * las regiones de ciudades/ no son terreno de jugadores todavía).
 *
 * Una instancia por `mapaId` (filterBy en index.ts): dos jugadores que
 * entran a la MISMA aldea caen en la MISMA room; otra aldea es otra room.
 */
export class RegionRoom extends RoomExteriorBase {
  private mapa!: MapaCargado;
  mapaId!: string;
  private bdFaccion: IAlmacenDatos | null = null;

  async onCreate(options: OpcionesRegion) {
    if (!options?.mapaId) throw new Error("RegionRoom necesita options.mapaId");
    this.mapaId = options.mapaId;
    const rutaMapa = rutaDeMapaId(options.mapaId);
    this.mapa = cargarMapaColision(rutaMapa);
    this.mundo = this.mapa;
    console.log(`Región "${this.mapa.nombre}" (${options.mapaId}): ${this.mapa.ancho}x${this.mapa.alto} casillas`);
    this.iniciarMovimiento();

    // Facción bandida (docs/GDD_Faccion_Bandidos.md §6, fase 1 — pendiente
    // dentro de la fase, ahora cerrado): un POI "asentamiento_hostil" (aldea
    // de bandidos/orcos/piratas/cultistas/bárbaros, mazmorras/catalogo/
    // tipos_dungeon.json) se banquea aquí la PRIMERA vez que alguien entra —
    // obtenerOCrearAsentamiento es idempotente, no duplica si ya existía. El
    // tick de economía (comida/madera/piedra/hierro, sube nivelMuralla/
    // nivelEquipo) solo corre mientras esta room concreta esté viva, MISMO
    // criterio de "perezoso" que GestorAgentes/GestorFauna — nadie paga por
    // simular una aldea bandida que nadie está visitando. Sembrar tropas de
    // verdad (cuántas, de qué rango) queda pendiente de una decisión de
    // diseño aparte (ver "Fases siguientes" del GDD) — con 0 tropas el tick
    // no hace nada dañino, solo no produce/consume todavía.
    const indice = JSON.parse(fs.readFileSync(path.join(rutaMapa, "indice.json"), "utf8")) as { tier?: string };
    if (indice.tier === "asentamiento_hostil") {
      this.bdFaccion = await crearAlmacenDatos();
      await this.bdFaccion.obtenerOCrearAsentamiento(this.mapaId);
      const bd = this.bdFaccion;
      this.clock.setInterval(() => {
        ejecutarTickEconomia(bd).catch((err) => console.error(`Tick de economía (${this.mapaId}) falló:`, err));
      }, MS_POR_TICK_ECONOMIA);
      console.log(`  Asentamiento bandido "${this.mapaId}" con economía activa (tick cada ${Math.round(MS_POR_TICK_ECONOMIA / 1000)}s reales)`);
    }

    // NPCs con rutina (GDD_Agentes_Moviles.md): si el bake trae población,
    // los agentes nacen recolocados según la hora del reloj de mundo y se
    // simulan a 10 hz (paseo, no combate) SOLO mientras la room viva — la
    // room autodispone al vaciarse, así una aldea sin jugadores cuesta cero.
    const rutaPoblacion = path.join(rutaMapa, "poblacion.json");
    if (fs.existsSync(rutaPoblacion)) {
      const poblacion = JSON.parse(fs.readFileSync(rutaPoblacion, "utf8")) as { npcs: NpcBakeado[] };
      const gestor = new GestorAgentes(this.state.npcs);
      gestor.iniciar(poblacion.npcs, tiempoMundo().hora);
      this.clock.setInterval(() => gestor.tick(0.1, tiempoMundo().hora), 100);
      console.log(`  ${gestor.cantidad} NPCs con rutina en el mapa`);
    }

    // Fauna doméstica (GDD_Agentes_Moviles.md v1.3): sin rutina horaria,
    // solo merodeo — se tickea más despacio (5 hz de sobra para un paseo).
    const rutaFauna = path.join(rutaMapa, "fauna.json");
    if (fs.existsSync(rutaFauna)) {
      const datos = JSON.parse(fs.readFileSync(rutaFauna, "utf8")) as { fauna: FaunaSpawn[] };
      const gestorFauna = new GestorFauna(this.state.fauna, this.mundo);
      gestorFauna.iniciar(datos.fauna);
      this.clock.setInterval(() => gestorFauna.tick(0.2), 200);
      console.log(`  ${gestorFauna.cantidad} animales sueltos en el mapa`);
    }

    // Puertas del asentamiento (docs/GDD_Sistema_Puertas.md): "interior" ->
    // entra al edificio; "exterior" con destino -> otra región/hub; sin
    // destino -> salida propia, vuelve a quien entró aquí.
    this.onMessage("portal:usar", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const portal = this.mapa.portales.find(
        (p) => Math.hypot(p.x + 0.5 - player.x, p.y + 0.5 - player.y) < 2.2,
      );
      if (!portal) return client.send("portal:error", { motivo: "no hay puerta cerca" });

      if (portal.tipo === "interior") {
        client.send("portal:ir", {
          tipo: "interior",
          mapaId: this.mapaId,
          edificio: portal.edificio,
          tipoEdificioId: portal.tipoEdificioId,
          esMazmorra: portal.esMazmorra ?? false,
          x: portal.x,
          y: portal.y,
        });
      } else if (portal.destino) {
        client.send("portal:ir", { tipo: portal.destino.tipo, mapaId: portal.destino.mapaId });
      } else {
        client.send("portal:ir", { tipo: "volver" });
      }
    });
  }

  onJoin(client: Client, options: OpcionesRegion) {
    const x = options?.entradaX ?? this.mapa.spawnX;
    const y = options?.entradaY ?? this.mapa.spawnY;
    this.crearJugador(client, options, x, y);
  }

  async onDispose() {
    await this.bdFaccion?.cerrar();
  }
}
