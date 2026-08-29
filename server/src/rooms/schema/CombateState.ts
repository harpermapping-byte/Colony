import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

// Combate táctico por turnos en rejilla (docs/GDD_Combate.md, ✅
// CONFIRMADO 2026-08-30 — sustituye al daño directo simple de
// docs/GDD_Mecanicas.md §5.4, que queda interino hasta que este camino
// interactivo esté cableado del todo). Espejo de red del motor puro
// `server/src/combate/arenaCombate.ts` (UnidadCombate) — esa lógica es
// la fuente de verdad PURA (testeada sola, sin Colyseus); este Schema es
// solo cómo viaja al cliente. Servidor autoritativo, igual que el resto
// del proyecto.
export class CombateUnidad extends Schema {
  // sessionId del jugador, o clave del Enemigo/Fauna/Npc (misma clave que
  // state.enemigos/fauna/npcs/players) — así resolver el "objetivo real"
  // tras el combate (aplicar HP, matar, etc.) es un simple lookup por id.
  @type("string") id = "";
  @type("boolean") esJugador = false;
  @type("string") bando = "A"; // "A" | "B"
  @type("int8") gx = 0; // coordenada DENTRO de la arena (0..ancho-1), no del mundo
  @type("int8") gy = 0;
  @type("number") hp = 0;
  @type("number") hpMax = 0;
  @type("int8") ap = 0;
  @type("int8") apMax = 0;
  @type("int8") mp = 0;
  @type("int8") mpMax = 0;
  @type("number") iniciativa = 0;
  @type("string") estado = "activo"; // "activo" | "caido" | "huido"

  // --- Campos SOLO servidor (sin @type — no viajan al cliente) ---
  // El cliente no necesita saber el ataque/defensa exactos de cada unidad
  // para pintar la UI placeholder (solo HP/turno) — guardarlos aquí evita
  // volver a consultar la entidad viva (Player/Fauna/Npc/Enemigo) en cada
  // resolución de turno. Snapshot tomado al entrar en combate: si el
  // equipo/vida base cambiara a mitad de combate no se refleja aquí (fuera
  // de esta pasada — el equipo tampoco se calcula todavía, ver GDD_Mecanicas §5.4).
  ataqueFisico = 0;
  defensaFisica = 0;
  alcance = 1;
}

export class CombateSchema extends Schema {
  @type("number") gx0 = 0; // origen de la arena en coordenadas de mundo (overlay del cliente)
  @type("number") gy0 = 0;
  @type("int8") ancho = 8;
  @type("int8") alto = 8;
  @type(["int8"]) obstaculos = new ArraySchema<number>(); // 1 = obstáculo, índice gy*ancho+gx
  @type(["string"]) ordenTurnos = new ArraySchema<string>(); // ids de CombateUnidad, por iniciativa desc
  @type("int8") turnoActual = 0; // índice sobre ordenTurnos
  @type({ map: CombateUnidad }) unidades = new MapSchema<CombateUnidad>();
}
