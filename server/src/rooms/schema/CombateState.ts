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
  // Recurso ÚNICO de turno (docs/GDD_Combate.md §9.3, pedido 2026-08-30):
  // mover, atacar, usar objeto y (cuando exista) magia salen del MISMO pool
  // — sustituye al AP+MP separados de la primera pasada.
  @type("int8") pa = 0;
  @type("int8") paMax = 0;
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
  /**
   * Munición a distancia (docs/GDD_Mecanicas.md §5.4, 2026-09-02) — SOLO
   * jugador con arma a distancia equipada (arco/ballesta/honda). "" = cuerpo
   * a cuerpo, no consume nada. `municionDisponible` es un SNAPSHOT tomado en
   * la room de origen al entrar en combate (cuántas unidades tenía en el
   * inventario real en ese momento) — se decrementa en cada disparo dentro
   * de la arena y BLOQUEA el ataque si llega a 0 (mismo criterio que "sin PA
   * suficiente"/"fuera de alcance": rechazo antes de gastar turno).
   * `municionConsumida` cuenta cuántas se han disparado de verdad — es lo
   * que `ArenaCombateRoom.onCombateResuelto` resta de verdad del inventario
   * al terminar el combate (`consumirMunicionDeSesion`, RoomExteriorBase.ts).
   * El chequeo/gasto por turno usa este snapshot y NUNCA el inventario en
   * vivo de la room donde se ejecute `combate:accion` (docs/GDD_Combate.md
   * §8/§9.2: `crearJugador` carga el inventario real en segundo plano
   * también en la arena, pero no hay garantía de que ya haya llegado en el
   * primer turno) — así el rechazo/gasto es determinista sin depender de
   * esa carrera.
   */
  municionId = "";
  municionDisponible = 0;
  municionConsumida = 0;
  /** docs/GDD_Caza.md — fauna no peligrosa en modo caza: deambula, nunca ataca (server/src/combate/arenaCombate.ts::jugarTurnoIAPasiva). */
  pasivo = false;
  /**
   * docs/GDD_Companeros.md (pedido 2026-08-30): sessionId del jugador dueño
   * SOLO si esta unidad es un compañero — "" para todo lo demás (jugador,
   * fauna, enemigo, npc hostil). El compañero NO tiene su propio hueco en
   * ordenTurnos: actúa DENTRO del turno de su dueño, como si fuera "él
   * mismo pudiendo mover y atacar dos veces" — mover/accion resuelven la
   * unidad objetivo por `unidadId` opcional, validado contra este campo.
   */
  duenoSessionId = "";

  // --- Combate acuático (docs/GDD_Barcos.md/GDD_Combate.md, pedido
  // 2026-08-30): SOLO cosmético — "no da más bonus ni nada", nunca leído
  // por la simulación (movimiento/ataque/turnos), solo para que el cliente
  // pinte al jugador en el barco o nadando en vez del rig normal. Snapshot
  // tomado UNA vez al entrar (RoomExteriorBase.cerrarVentanaCombate), nunca
  // tocado por el resto de esta clase.
  /** "" = normal, "barco" = el capitán (uno solo por barco), "nadando" = el resto de la tripulación que iba a bordo. */
  @type("string") visual = "";
  /** Solo con visual==="barco" — qué modelo de barco pintar debajo. */
  @type("string") barcoTipoId = "";
}

export class CombateSchema extends Schema {
  @type("number") gx0 = 0; // origen de la arena en coordenadas de mundo (overlay del cliente)
  @type("number") gy0 = 0;
  @type("int8") ancho = 8;
  @type("int8") alto = 8;
  @type(["int8"]) obstaculos = new ArraySchema<number>(); // 1 = obstáculo, índice gy*ancho+gx
  /**
   * Coste en PA de entrar en cada casilla (índice gy*ancho+gx, pedido
   * streamer: "2 PA si la casilla es terreno difícil/agua") — SOLO servidor
   * (sin @type, no viaja al cliente, mismo criterio que ataqueFisico/
   * defensaFisica de CombateUnidad): el cliente no necesita saberlo para
   * pintar la UI placeholder. Poblado por ArenaCombateRoom desde el terreno
   * real del bake; vacío (todo cuesta 1) en la arena PROVISIONAL de la
   * ventana de unión (RoomExteriorBase.construirArenaDeCombate), que nunca
   * llega a jugarse turno a turno de verdad.
   */
  costes: Uint8Array = new Uint8Array(0);
  @type(["string"]) ordenTurnos = new ArraySchema<string>(); // ids de CombateUnidad, por iniciativa desc
  @type("int8") turnoActual = 0; // índice sobre ordenTurnos
  @type({ map: CombateUnidad }) unidades = new MapSchema<CombateUnidad>();
  // Ventana de unión (docs/GDD_Combate.md §9.1, pedido 2026-08-30): "pendiente"
  // = todavía se puede sumar gente (combate:unirse/comenzarYa), ordenTurnos
  // vacío, nadie juega turno todavía; "activo" = ventana cerrada, se juega
  // de verdad. `cierraEn` epoch ms — 0 cuando ya no aplica (fase "activo").
  @type("string") fase = "activo";
  @type("number") cierraEn = 0;
}
