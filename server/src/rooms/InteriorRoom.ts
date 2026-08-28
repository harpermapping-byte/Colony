import { Client } from "@colyseus/core";
import * as path from "path";
import { RoomExteriorBase } from "./base/RoomExteriorBase";
import { cargarInterior, InteriorCargado } from "../mundo/interiorColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";

export interface OpcionesInterior {
  name?: string;
  mapaId: string; // asentamiento del que cuelga este edificio
  edificio: string; // id único del interior (nombre de archivo sin .json)
  nivel?: number; // planta en la que se entra (0 = planta baja, por defecto)
  entradaX?: number; // llegando por una escalera: casilla donde aparece en ESTA planta
  entradaY?: number;
}

/**
 * Instancia del interior de UN edificio — docs/GDD_Sistema_Puertas.md.
 * Una room por `edificio`+`nivel` (mismo patrón de instancia que
 * RegionRoom): dos jugadores en la MISMA planta del MISMO edificio
 * comparten room, otra planta es otra room — subir/bajar escaleras es un
 * portal más (cambia de room), igual que cruzar una puerta exterior; sin
 * construcción ni propiedad, los interiores de ciudades/ no son de ningún
 * jugador.
 */
export class InteriorRoom extends RoomExteriorBase {
  // protected (no private): DungeonRoom hereda de esta clase y reutiliza
  // TAL CUAL la carga + el portal:usar de escaleras/salida (docs/GDD_Bakeador_Dungeons.md) —
  // solo añade la población de enemigos encima, sin duplicar nada de esto.
  protected interior!: InteriorCargado;
  protected opciones!: OpcionesInterior;

  async onCreate(options: OpcionesInterior) {
    if (!options?.mapaId || !options?.edificio) {
      throw new Error("InteriorRoom necesita options.mapaId y options.edificio");
    }
    this.opciones = options;
    const rutaArchivo = path.join(rutaDeMapaId(options.mapaId), "interiores", `${options.edificio}.json`);
    this.interior = cargarInterior(rutaArchivo, options.nivel ?? 0);
    this.mundo = this.interior;
    console.log(
      `Interior "${this.interior.id}" nivel=${this.interior.nivel} (${this.interior.rol}): ` +
      `${this.interior.ancho}x${this.interior.alto} casillas, ${this.interior.conectores.length} conector(es)`,
    );
    this.iniciarMovimiento();

    // Interacción con la escalera/trampilla más cercana -> cambia de
    // planta (otra InteriorRoom, mismo edificio, distinto `nivel`); si no
    // hay ninguna cerca, se trata como la salida del edificio — pero SOLO
    // desde la planta baja: no hay forma de "salir" saltándose las
    // escaleras desde un piso alto o la bodega (regla explícita del
    // usuario: solo puertas exteriores y escaleras son TP).
    this.onMessage("portal:usar", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const conector = this.interior.conectores.find(
        (c) => Math.hypot(c.x + c.huella[0] / 2 - player.x, c.y + c.huella[1] / 2 - player.y) < 2.2,
      );
      if (conector) {
        client.send("portal:ir", {
          tipo: "interior",
          mapaId: this.opciones.mapaId,
          edificio: this.opciones.edificio,
          nivel: conector.destinoNivel,
          // casilla del conector YA en la rejilla de la planta destino — las
          // plantas no comparten XY, así que la posición de aquí (conector.x/y)
          // no vale para saber dónde aparecer allí (bug real: el jugador
          // aparecía en la coordenada de la escalera de ORIGEN, que en la
          // planta destino podía caer dentro de una pared).
          x: conector.entradaDestino.x,
          y: conector.entradaDestino.y,
        });
        return;
      }
      if (this.interior.rol === "planta_baja") {
        client.send("portal:ir", { tipo: "volver" });
      } else {
        client.send("portal:error", { motivo: "hay que usar la escalera" });
      }
    });
  }

  onJoin(client: Client, options: OpcionesInterior) {
    const x = options?.entradaX ?? this.interior.spawnX;
    const y = options?.entradaY ?? this.interior.spawnY;
    this.crearJugador(client, options, x, y);
  }
}
