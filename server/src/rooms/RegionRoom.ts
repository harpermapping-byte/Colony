import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";
import { GestorAgentes, NpcBakeado } from "../mundo/agentes";
import { tiempoMundo } from "../mundo/tiempoMundo";

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

  async onCreate(options: OpcionesRegion) {
    if (!options?.mapaId) throw new Error("RegionRoom necesita options.mapaId");
    this.mapaId = options.mapaId;
    const rutaMapa = rutaDeMapaId(options.mapaId);
    this.mapa = cargarMapaColision(rutaMapa);
    this.mundo = this.mapa;
    console.log(`Región "${this.mapa.nombre}" (${options.mapaId}): ${this.mapa.ancho}x${this.mapa.alto} casillas`);
    this.iniciarMovimiento();

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
}
