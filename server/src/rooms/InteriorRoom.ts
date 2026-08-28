import { Client } from "@colyseus/core";
import * as path from "path";
import { RoomExteriorBase } from "./base/RoomExteriorBase";
import { cargarInterior, InteriorCargado } from "../mundo/interiorColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";

interface OpcionesInterior {
  name?: string;
  mapaId: string; // asentamiento del que cuelga este edificio
  edificio: string; // id único del interior (nombre de archivo sin .json)
}

/**
 * Instancia del interior de UN edificio — docs/GDD_Sistema_Puertas.md.
 * Una room por `edificio` (mismo patrón de instancia que RegionRoom): dos
 * jugadores que entran al MISMO edificio comparten room, otro edificio es
 * otra room. v1: solo planta baja (interiorColision.ts); sin construcción
 * ni propiedad — los interiores de ciudades/ no son de ningún jugador.
 */
export class InteriorRoom extends RoomExteriorBase {
  private interior!: InteriorCargado;

  async onCreate(options: OpcionesInterior) {
    if (!options?.mapaId || !options?.edificio) {
      throw new Error("InteriorRoom necesita options.mapaId y options.edificio");
    }
    const rutaArchivo = path.join(rutaDeMapaId(options.mapaId), "interiores", `${options.edificio}.json`);
    this.interior = cargarInterior(rutaArchivo);
    this.mundo = this.interior;
    console.log(`Interior "${this.interior.id}": ${this.interior.ancho}x${this.interior.alto} casillas`);
    this.iniciarMovimiento();

    // Dentro de un edificio la única puerta relevante es la salida — un
    // edificio es pequeño y sin ambigüedad, así que la interacción en
    // cualquier punto basta (sin buscar la casilla exacta de la puerta).
    this.onMessage("portal:usar", (client) => {
      client.send("portal:ir", { tipo: "volver" });
    });
  }

  onJoin(client: Client, options: OpcionesInterior) {
    this.crearJugador(client, options, this.interior.spawnX, this.interior.spawnY);
  }
}
