import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { CombateSchema } from "./CombateState";

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

// Vitales (docs/GDD_Personaje.md) — comida/bebida/sueño decaen en horas
// REALES, estamina se regenera sola (nada la gasta todavía). SIN vida aquí
// a propósito: docs/GDD_Mecanicas.md §5.4 ya fijó Player.vida/vidaMax como
// la única fuente de HP ("nadie se cura solo con el tiempo", no negociable)
// — duplicarla aquí con un drenaje por tick la violaría de raíz. Sin
// persistencia entre sesiones — a diferencia del inventario (docs/GDD_Equipo
// §6bis), aquí SÍ es a propósito: volver con hambre/sed acumulados de una
// sesión que pudo quedar abierta días es peor experiencia que nacer lleno.
export class VitalesSchema extends Schema {
  @type("number") comida = 100;
  @type("number") bebida = 100;
  @type("number") sueno = 100;
  @type("number") estamina = 100;
  // Higiene (docs/GDD_Personaje.md §3.6, pedido explícito 2026-08-30): sube
  // con cada comida, al tope ensucia al jugador (`Player.sucio`); baja a 0
  // al usar una hoja (`higiene:cagar`). No decae sola, no tiene tick propio.
  @type("number") caca = 0;
  // Temperatura corporal (docs/GDD_Clima.md, pedido 2026-08-30): 0-100,
  // 50 = neutro/cómodo. Deriva sola hacia la temperatura del mundo cada
  // tick (`aplicarTemperaturaCorporal`) — fuera de rango gasta comida o
  // bebida más rápido y resta al vidaMax efectivo (ver aplicarInanicion).
  @type("number") temperatura = 50;
}

// Nivel de cada atributo (docs/GDD_Personaje.md) — YA derivado de la XP
// persistida en `jugador_atributos` (server/src/datos/bd.ts), nunca la XP en
// sí; se rellena OPORTUNISTAMENTE según se toque cada atributo en la sesión
// (mismo límite ya aceptado para gremioId/gremioNombre más abajo) — el que
// no se haya tocado aún se queda en 1 (nivel base, sin XP).
// Lista revisada 2026-08-30 (docs/GDD_Personaje.md §3): `liderazgo` sale
// (un único disparador real), entra `resistencia`; `sigilo` se retira
// entero (sin sistema al que engancharlo) y `comercio` se fusiona dentro
// de `carisma` (mismo atributo social: hablar, gremios Y mercado).
export class AtributosSchema extends Schema {
  @type("int8") fuerza = 1;
  @type("int8") destreza = 1;
  @type("int8") inteligencia = 1;
  @type("int8") resistencia = 1;
  @type("int8") carisma = 1;
}

// Anatomía por zona (server/src/personaje/anatomia.ts, pedido 2026-08-30):
// SOLO las banderas booleanas que el cliente necesita para pintar (ocultar
// malla amputada, mostrar prótesis de madera, iconos de estado) — los
// timestamps de "cicatrizando" (vendadoDesde/entablilladoDesde) son
// server-only (RoomExteriorBase.anatomiaTiemposPorSesion), mismo criterio
// que `calentandoDesde` de cocina.ts nunca viaja crudo al cliente: aquí solo
// llega `curando` ya derivado.
export class ZonaAnatomicaSchema extends Schema {
  @type("boolean") sangrado = false;
  @type("boolean") fractura = false;
  @type("boolean") infectado = false;
  @type("boolean") amputado = false;
  @type("boolean") protesis = false;
  @type("boolean") curando = false; // vendándose o entablillándose, fase de cicatrización en curso
}

export class AnatomiaSchema extends Schema {
  @type(ZonaAnatomicaSchema) cabeza = new ZonaAnatomicaSchema();
  @type(ZonaAnatomicaSchema) torso = new ZonaAnatomicaSchema();
  @type(ZonaAnatomicaSchema) brazoIzq = new ZonaAnatomicaSchema();
  @type(ZonaAnatomicaSchema) brazoDer = new ZonaAnatomicaSchema();
  @type(ZonaAnatomicaSchema) piernaIzq = new ZonaAnatomicaSchema();
  @type(ZonaAnatomicaSchema) piernaDer = new ZonaAnatomicaSchema();
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
  @type(VitalesSchema) vitales = new VitalesSchema();
  @type(AtributosSchema) atributos = new AtributosSchema();
  // Gremio (pedido 2026-08-29) — visible a cualquiera en la room, como una
  // etiqueta de nametag más (nombre/color/emblema); el detalle completo
  // (banco, roster) SOLO viaja por mensaje privado "gremio:estado", nunca
  // por aquí. gremioId="" = sin gremio. Se rellena OPORTUNISTAMENTE: la
  // primera vez que el jugador toca algo de gremios en ESTA sesión (mismo
  // límite ya aceptado por jugador_id en fase 2 de inventario — no hay
  // onJoin async todavía) — el cliente debe pedir "gremio:estado" al
  // conectar para sincronizar su propia etiqueta si ya pertenece a uno.
  @type("string") gremioId = "";
  @type("string") gremioNombre = "";
  @type("string") gremioColor = "";
  @type("string") gremioEmblemaId = "";
  // Higiene (docs/GDD_Personaje.md §3.6, pedido explícito 2026-08-30):
  // true cuando `vitales.caca` llegó a 100 sin usar una hoja a tiempo — solo
  // se quita lavándose en agua (`higiene:lavar`). Estado del jugador, no de
  // una prenda concreta: todavía no existe un slot de equipo de pantalón
  // (ver §6) al que colgar este estado.
  @type("boolean") sucio = false;
  // Sueño en cama (docs/GDD_Personaje.md §3.6) — replicado solo para que el
  // cliente pueda mostrar una pose/animación de "durmiendo" más adelante; la
  // duración real vive server-only en `RoomExteriorBase.durmiendo`.
  @type("boolean") durmiendo = false;
  // Vida/Ataque/Defensa (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30):
  // todo jugador arranca con 100/100 — vidaMax/ataque/defensa varían en
  // vivo según equipo, atributos y magia (server/src/combate/combate.ts).
  // Sin regeneración automática: solo comida fuera de combate, pociones o
  // magia suben `vida` — nunca pasa el tiempo por sí solo.
  @type("number") vida = 100;
  @type("number") vidaMax = 100;
  // ataque/defensa: base + lo que sume el equipo físico (docs/GDD_Equipo.md,
  // recalculado en cada equipar/desequipar por `recalcularStatsJugador` en
  // RoomExteriorBase — nunca aquí, este Schema solo replica el resultado).
  @type("number") ataque = 3;
  @type("number") defensa = 0;
  // ataqueMagico/defensaMagica (docs/GDD_Personaje.md §0 — pedido original
  // del streamer, aplazado hasta que existiera equipo real): mismos ejes
  // que ataque/defensa pero para daño/resistencia mágicos. Se rellenan ya
  // desde el equipo (armadura/anillos con `defensaMagica`/`ataqueMagico`
  // en items/catalogo/items.json), aunque todavía no hay Combate mágico que
  // los consuma — mismo criterio "reservado, sin consumidor todavía" que ya
  // se usó para ataqueFisico/defensaFisica antes de que existiera Combate.
  @type("number") ataqueMagico = 0;
  @type("number") defensaMagica = 0;
  // Anatomía por zona (docs/GDD_Anatomia.md, pedido 2026-08-30): sangrado/
  // fractura/infección/amputación por zona, ver AnatomiaSchema arriba.
  @type(AnatomiaSchema) anatomia = new AnatomiaSchema();
  // Twitch (docs/GDD_Twitch.md, pedido 2026-08-30): título social sobre el
  // PJ según rol de chat (seguidor/sub/mod) o el nombre del streamer si es
  // jarl/admin — "" = sin título (ni seguidor de Twitch, ni nada puesto).
  // Puramente cosmético (docs/GDD_Mecanicas.md §5.11, "nunca ventaja de
  // poder") — se refresca solo, cada vez que ese jugador habla en el chat.
  @type("string") tituloTwitch = "";
  // Oficio de jugador (docs/GDD_Caza.md, pedido 2026-08-30): sistema MÍNIMO
  // v1 — "" = ninguno, se elige libremente con `oficio:elegir` (sin
  // requisito ni exclusividad real, cambiable en cualquier momento; no
  // reemplaza la XP por-oficio-y-jugador ya existente en `jugador_oficios`,
  // que sigue sin exclusividad). Hoy solo lo consume el gating de desollar
  // (curtidor/peletero); nada impide que más adelante otras recetas de
  // `items/catalogo/recetas.json` lo exijan también. Sin persistencia entre
  // sesiones todavía — mismo criterio que `atributos`/`vitales`/`gremioId`,
  // esperando el login real (ver `server/src/datos/bd.ts`, tabla `jugadores`).
  @type("string") oficio = "";
  // Montura (docs/GDD_Monturas.md, pedido 2026-08-30): "" = a pie. Montado,
  // el PJ y la mascota son UNA sola entidad física (docs/GDD_Mecanicas.md
  // §"Monturas acordado 2026-08-27) — el servidor solo simula al jugador,
  // con la velocidad/medio de la montura; la mascota desaparece de
  // state.mascotas mientras dura (RoomExteriorBase.manejarMascotaMontar).
  @type("string") monturaEspecieId = "";
  /** id de la fila `mascotas` (BD) que se está montando — 0 = ninguna. Para saber a cuál devolver el Schema al desmontar. */
  @type("number") monturaMascotaId = 0;
  /** docs/GDD_Barcos.md (pedido 2026-08-30) — id de la fila `barcos` (BD)/clave de state.barcos en la que va embarcado; 0 = ninguna. A diferencia de una montura animal, el Schema del barco NO desaparece (varias plazas) — el cliente solo oculta el rig humanoide mientras esto sea >0. */
  @type("number") barcoId = 0;
  /** Solo con barcoId>0: true = es quien pilota (su input mueve el barco), false = pasajero (se mueve con él). */
  @type("boolean") barcoCapitan = false;
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
  // Vida/Ataque/Defensa (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30):
  // NPCs humanoides SÍ tienen defensa (a diferencia de los animales). Estos
  // NPCs civiles de asentamiento no persisten individualmente (viven por
  // slotId del bake, ver mundo/agentes.ts) así que su vida no sobrevive a
  // un reinicio — coherente con el resto de su estado, ya efímero. Nadie
  // los ataca todavía (sin disparador de combate real, mismo hueco que el
  // resto de humanoides — ver docs/GDD_Agentes_Moviles.md).
  @type("number") vida = 30;
  @type("number") vidaMax = 30;
  @type("number") ataque = 5;
  @type("number") defensa = 2;
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
  // Vida/Ataque/Defensa (docs/GDD_Mecanicas.md §5.4 + docs/GDD_Combate.md,
  // pedido 2026-08-30): enemigo humanoide, igual que Npc, con defensa
  // propia. Poblado por DungeonRoom.poblarEnemigos con un placeholder de
  // balance (base/boss) — personajes/catalogo/enemigos.json todavía no
  // declara stats de combate por id, mismo hueco "SIN CONSUMIDOR" que el
  // resto de catálogos de combate.
  @type("number") vida = 40;
  @type("number") vidaMax = 40;
  @type("number") ataque = 8;
  @type("number") defensa = 4;
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
  // Vida/Ataque (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): los
  // animales NUNCA tienen defensa, solo vida — ver mundo/catalogoCombateFauna.ts.
  @type("number") vida = 0;
  @type("number") vidaMax = 0;
  @type("number") ataque = 0;
}

// Mascota (docs/GDD_Mascotas.md, pedido 2026-08-30): perro/gato urbano ya
// domesticado (5x "dar de comer" — server/src/rooms/base/RoomExteriorBase.ts).
// Solo existe en el Schema mientras está "siguiendo" a su dueño Y su dueño
// está en ESTA room — RoomExteriorBase la spawnea al entrar y la borra al
// salir (nunca se persiste su x/y, solo su fila en BD vía datos/bd.ts). Sin
// acción propia todavía, solo sigue — mismo criterio "mecanismo listo,
// sin más disparadores todavía" que el resto del proyecto.
export class Mascota extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") especieId = "";
  /** Nombre del jugador dueño — SOLO para la etiqueta del cliente, la lógica de "a quién sigue" vive en memoria del servidor (nunca en el Schema). */
  @type("string") duenoNombre = "";
  /** docs/GDD_Monturas.md — tiene silla puesta (mascota:ponerMontura) y por tanto se puede `mascota:montar`. Mientras el dueño la está montando, esta entrada DESAPARECE del Schema (fusionada en Player, ver monturaEspecieId) — vuelve a aparecer al desmontar. */
  @type("boolean") montura = false;
}

// Barco (docs/GDD_Barcos.md, pedido 2026-08-30): a diferencia de una
// mascota, un barco NO come/sigue/vuelve solo a casa — se ancla donde se
// coloca (server/src/datos/bd.ts:Barco) y así se queda hasta que alguien lo
// mueve pilotándolo. SIEMPRE visible en el Schema (a diferencia de Mascota,
// que desaparece al montarla): con varias plazas, el barco es su propia
// entidad en el mundo aunque haya jugadores embarcados — RoomExteriorBase
// solo oculta el rig humanoide de cada ocupante (Player.barcoId > 0),
// nunca borra este Schema.
export class Barco extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") tipoId = "";
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

// Marcador de "aquí hay un combate" (docs/GDD_Combate.md §9.2) — mientras un
// combate vive instanciado en su propia room de arena, la room de ORIGEN
// deja esto en el sitio exacto donde se cruzaron los combatientes; se borra
// al terminar el combate y volver todos. Puramente informativo (el cliente
// puede pintar un icono), sin datos de juego reales.
export class MarcadorCombateSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
}

// Comercio jugador-jugador (docs/GDD_Comercio.md, pedido 2026-08-30: "una
// pantallita que les salga a ambos como la del WoW"). Ofertas por INSTANCIA
// COMPLETA (nunca una pila parcial — pedido explícito), guardadas por el
// lado que la puso; `confirmadoA/B` se resetean a false en cuanto CUALQUIERA
// de los dos toca su oferta, para que nadie confirme sobre un trato viejo.
export class OfertaComercioSchema extends Schema {
  @type("number") instanciaId = 0;
  @type("string") itemId = "";
  @type("number") cantidad = 0;
}

export class ComercioSchema extends Schema {
  @type("string") jugadorA = "";
  @type("string") jugadorB = "";
  @type([OfertaComercioSchema]) ofertaA = new ArraySchema<OfertaComercioSchema>();
  @type([OfertaComercioSchema]) ofertaB = new ArraySchema<OfertaComercioSchema>();
  /** Animales de granja ofrecidos (docs/GDD_Ganaderia.md) — solo el id, un animal es una instancia entera, sin "cantidad" que fraccionar. */
  @type(["string"]) ofertaAnimalesA = new ArraySchema<string>();
  @type(["string"]) ofertaAnimalesB = new ArraySchema<string>();
  @type("boolean") confirmadoA = false;
  @type("boolean") confirmadoB = false;
}

// Cadáver looteable (server/src/mundo/cadaveres.ts, docs/GDD_Caza.md) — la
// clave del map es `Cadaver.id` ("cadaver:<idFaunaOrigen>"). `contenedor`
// espeja el `Contenedor` puro del mismo modo que `InventarioSchema.cuerpo`
// (server/src/inventario/sincronizarSchema.ts). Antes de esta mecánica el
// cadáver solo existía en BD, invisible/inaccesible para cualquier jugador.
export class CadaverSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") tipoOrigen = ""; // "animal" | "npc" | "jugador"
  @type("string") especieOrigenId = "";
  @type(ContenedorSchema) contenedor = new ContenedorSchema();
}

// Animal de granja vivo (docs/GDD_Ganaderia.md, pedido 2026-08-30) — clave
// del map es `AnimalGranjaFila.id` ("animal:<especieId>:<epochMs>:<n>").
// Sin contenedor propio (a diferencia de CadaverSchema): la producción
// vive en BD (`extra`, server-only, nunca en el Schema) y se resuelve
// perezosamente, el cliente solo necesita saber dónde está y qué es.
export class AnimalGranjaSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") especieId = "";
  /** Nombre del dueño de la propiedad — SOLO para la etiqueta del cliente, mismo criterio que Mascota.duenoNombre. */
  @type("string") duenoNombre = "";
}

// Árbol vivo NUEVO (docs/GDD_Bosques.md, pedido 2026-08-30) — brote de
// propagación silvestre o plantado por un jugador; clave del map es
// `ArbolVivoFila.id`. Los árboles del bake original NUNCA aparecen aquí
// (siguen siendo decoración estática del cliente, ver GDD_Bosques.md
// "límite conocido") — solo lo que ha nacido en vivo desde este sistema.
export class ArbolVivoSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") especieId = "";
  @type("string") etapa = "joven"; // "joven" | "adulto"
}

export class HubState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Enemigo }) enemigos = new MapSchema<Enemigo>();
  @type({ map: Fauna }) fauna = new MapSchema<Fauna>();
  @type({ map: Mascota }) mascotas = new MapSchema<Mascota>();
  @type({ map: Barco }) barcos = new MapSchema<Barco>();
  @type({ map: ObjetoMundoSchema }) objetosMundo = new MapSchema<ObjetoMundoSchema>();
  @type({ map: CadaverSchema }) cadaveres = new MapSchema<CadaverSchema>();
  @type({ map: AnimalGranjaSchema }) animalesGranja = new MapSchema<AnimalGranjaSchema>();
  @type({ map: ArbolVivoSchema }) arbolesVivos = new MapSchema<ArbolVivoSchema>();
  // Evento Twitch "Eclipse" (docs/GDD_Twitch.md): oscuridad casi total
  // mientras esté activo, sin importar la hora del reloj de mundo — el
  // cliente decide cómo pintarlo (mucho más oscuro que la noche normal),
  // el servidor solo dice si toca o no.
  @type("boolean") oscuridadAbsoluta = false;
  // Combates activos (docs/GDD_Combate.md) — un Map, no un singleton: varios
  // grupos pueden pelear a la vez en la misma room sin bloquearse entre sí
  // (mismo criterio que construcciones/plantillas). En una room de ARENA
  // (docs/GDD_Combate.md §9.2) tiene como mucho UNA entrada, la del combate
  // que se instanció ahí; en el resto de rooms puede tener varias "pendiente"
  // en ventana de unión a la vez.
  @type({ map: CombateSchema }) combates = new MapSchema<CombateSchema>();
  // Combates instanciados en una arena aparte, vistos desde la room de
  // ORIGEN mientras duran (docs/GDD_Combate.md §9.2) — clave = combateId.
  @type({ map: MarcadorCombateSchema }) combatesEnCurso = new MapSchema<MarcadorCombateSchema>();
  // Comercios jugador-jugador activos (docs/GDD_Comercio.md) — clave =
  // comercioId, como máximo UNO por jugador a la vez (RoomExteriorBase lo
  // garantiza vía `comerciosPorSesion`).
  @type({ map: ComercioSchema }) comercios = new MapSchema<ComercioSchema>();
}
