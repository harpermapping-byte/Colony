import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") name = "";
}

export class HubState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
