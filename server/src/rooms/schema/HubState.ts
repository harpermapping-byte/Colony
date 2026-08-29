import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

// Inventario (docs/Backlog_Mecanicas_Futuras.md "Inventario, contenedores y
// objetos en el mundo", pedido 2026-08-29 fase 1: catálogo + servidor +
// persistencia). Espejo de red de server/src/inventario/inventario.ts
// (Contenedor/ItemInstancia) — esa lógica es la fuente de verdad PURA
// (testeada sola, sin Colyseus); este Schema es solo cómo viaja al cliente.
// Servidor autoritativo, cliente solo predice/muestra (ya decidido).
export class ItemInstanciaSchema extends Schema {
  @type("number") id = 0; // id de INSTANCIA dentro de su contenedor, no de catálogo
  @type("string") itemId = ""; // id de items/catalogo/items.json
  @type("number") cantidad = 1;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") rot: 0 | 1 = 0; // 0 o 1 (90°) — rejilla cuadrada, 180/270 no aportan nada nuevo
}

export class ContenedorSchema extends Schema {
  @type("number") ancho = 0;
  @type("number") alto = 0;
  @type([ItemInstanciaSchema]) items = new ArraySchema<ItemInstanciaSchema>();
}

// Un jugador SIEMPRE tiene `cuerpo` (rejilla base). `extras` son contenedores
// adicionales de ítems equipados que declaran `esContenedor` en el catálogo
// (mochila, bolsa de cinturón...) — cada uno con su PROPIA rejilla,
// independiente de la del cuerpo (decisión de esta fase, no anidada).
// `equipo` es slot con nombre -> itemId equipado, no una rejilla.
export class InventarioSchema extends Schema {
  @type(ContenedorSchema) cuerpo = new ContenedorSchema();
  @type({ map: ContenedorSchema }) extras = new MapSchema<ContenedorSchema>();
  @type({ map: "string" }) equipo = new MapSchema<string>();
}

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
  @type(InventarioSchema) inventario = new InventarioSchema();
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

// Enemigo activo de una mazmorra (docs/GDD_Bakeador_Dungeons.md §4) — el bake
// coloca MUCHOS puntos de spawn candidatos; DungeonRoom elige en runtime un
// subconjunto acotado y lo publica aquí. `enemigoId` cruza con
// personajes/catalogo/enemigos.json, `variante` con el índice dentro de
// assets/enemigos/pool.json (el aspecto se generó offline, una vez —
// "generar una vez, nunca en directo"). Sin movimiento/combate todavía
// (el streamer lo explicará aparte): un enemigo aparece quieto en su punto.
export class Enemigo extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") enemigoId = "";
  @type("number") variante = 0;
  @type("boolean") esBoss = false;
}

// Fauna doméstica urbana (GDD_Agentes_Moviles.md v1.3): sin nombre, sin
// rutina — solo especie y qué está haciendo (server/src/mundo/fauna.ts la
// mueve por su radio de merodeo). El cliente busca su vox en fauna.json
// (assets/mapas/<asentamiento>/fauna.json) por esta misma clave del map.
export class Fauna extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") especieId = "";
  @type("string") accion = ""; // comer | sentarse | jugar | dormir | caminar
}

// Objeto soltado al mundo por un jugador (fase 2 de inventario, "soltar" —
// docs/GDD_Inventario.md §7). Sin persistencia esta fase: vive y muere con
// la room (memoria pura, igual que Enemigo/Fauna) — un reinicio de Render
// borra lo soltado sin recoger, decisión explícita documentada en el GDD.
// Aparece quieto, sin rot ni movimiento (mismo criterio que Enemigo).
export class ObjetoMundoSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") itemId = ""; // id de items/catalogo/items.json
  @type("number") cantidad = 1;
}

export class HubState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Enemigo }) enemigos = new MapSchema<Enemigo>();
  @type({ map: Fauna }) fauna = new MapSchema<Fauna>();
  @type({ map: ObjetoMundoSchema }) objetosMundo = new MapSchema<ObjetoMundoSchema>();
}
