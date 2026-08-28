import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  // posición en CASILLAS del mapa bakeado (float; 1 casilla = 1 unidad de
  // mundo en el cliente) — el servidor es la autoridad, el cliente interpola
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") name = "";
  // medio en el que está el PJ: "tierra" | "nadando" | "buceando"
  @type("string") estado = "tierra";
  // nivel de profundidad al bucear: 0 superficie, -1, -2 (solo en agua)
  @type("int8") nivel = 0;
}

// Agente móvil publicado (NPC de asentamiento; mañana bárbaros/fauna con el
// mismo esquema — GDD_Agentes_Moviles.md). La clave del map es su slotId
// del bake de poblacion/: el cliente busca ahí sus vóxeles (poblacion.json).
export class Npc extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") nombre = "";
  // acción del tramo de rutina activo ("trabajar", "dormir"...) — el
  // cliente puede animar/mostrar según esto sin lógica propia
  @type("string") accion = "";
  // false = bajo techo (en casa): el cliente no lo pinta en el exterior
  @type("boolean") visible = true;
  // frase de calle de los NPCs especiales ("¡Vendo melones!") — el cliente
  // la enseña en burbuja de vez en cuando; vacío = NPC sin pregón
  @type("string") grito = "";
}

export class HubState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
}
