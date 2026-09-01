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
  // Líquidos (docs/GDD_Inventario.md §9, pedido 2026-08-30) — "" = recipiente
  // vacío o ni siquiera es un recipiente (mismo criterio que durabilidad: el
  // catálogo decide si el campo aplica). Sin Schema anidado para no complicar
  // el diff de red por un campo tan pequeño.
  @type("string") liquidoTipo = "";
  @type("number") liquidoVolumenMl = 0;
  @type("boolean") liquidoContaminada = false;
  // Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre legendario,
  // pedido 2026-08-31) — 0 = ítem normal de catálogo (comportamiento de
  // siempre). >0 = esta instancia concreta es una copia de un blueprint de
  // `prendas_generadas` (server/src/datos/bd.ts): el itemId sigue siendo el
  // "carrier" genérico del slot (huella/peso/apilable normales), pero el
  // aspecto real sale de `HubState.blueprintsRopa.get(String(prendaGeneradaId))`.
  @type("number") prendaGeneradaId = 0;
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
  // Sastre legendario — slot -> prendaGeneradaId (string, mismo criterio que
  // el resto de MapSchema con claves textuales) SOLO para los slots donde lo
  // equipado es una prenda legendaria; slots normales nunca tienen entrada
  // aquí (ausente = "resuelve por itemId de catálogo, como siempre" en
  // equipoVisual.ts). Separado de `equipo` a propósito: no toca el
  // significado ni el tipo de ese map ya existente.
  @type({ map: "number" }) equipoBlueprintRopa = new MapSchema<number>();
}

/**
 * Blueprint de una prenda legendaria (docs/GDD_Ropa_Procedural.md §Sastre
 * legendario) — espejo de red de `PrendaGenerada` (server/src/datos/bd.ts).
 * Vive en `HubState.blueprintsRopa`, GLOBAL a la room (no por jugador): así
 * cualquier cliente que vea a cualquier otro jugador con una prenda
 * legendaria puesta puede resolverla sin pedirla al servidor aparte —
 * cargada perezosamente la primera vez que hace falta (creación o equipar).
 */
export class BlueprintRopaSchema extends Schema {
  @type("string") prendaBaseId = "";
  @type("string") materialId = "";
  @type("string") detalleJson = "{}";
  @type("string") tintesJson = "{}";
  @type("string") nombre = "";
  @type("number") creadorJugadorId = 0;
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
  // con cada comida, al tope suma a `Player.suciedad`; baja a 0 al usar una
  // hoja (`higiene:cagar`). No decae sola, no tiene tick propio.
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

// Enfermedades (docs/GDD_Enfermedades.md, pedido 2026-08-30): catarro
// (condición GLOBAL derivada de "¿alguna zona de anatomia está infectada?",
// ver server/src/personaje/enfermedades.ts) y gripe (frío de invierno) — solo
// las banderas que el cliente necesita para pintar/tose/tiritar; el reloj de
// curación (catarroDesde/gripeDesde) es server-only, mismo criterio que
// vendadoDesde/entablilladoDesde de AnatomiaSchema.
export class EnfermedadesSchema extends Schema {
  @type("boolean") catarro = false;
  @type("number") unguentosTomados = 0; // progreso 0..3 mientras sigue enfermo, para pintar "2/4" en el panel
  @type("boolean") gripe = false;
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
  // Suciedad (docs/GDD_Personaje.md §3.6, ronda 2 pedido 2026-08-30: "stat
  // de suciedad real, sube con `vitales.caca` al tope Y con cada acción de
  // trabajo — crafteo/recolección — y a partir de UMBRAL_SUCIEDAD_MOLESTO
  // los NPC tendero cobran un recargo y NPCs sueltan frases al pasar cerca").
  // 0-100, reemplaza el booleano `sucio` de la v1. Se limpia poco a poco
  // nadando/buceando (`RITMO_LIMPIEZA_AGUA_POR_HORA`) o de golpe con jabón
  // en el agua (`higiene:lavar`, consume 1 "jabon"). Estado del propio
  // jugador, no de una prenda concreta.
  @type("number") suciedad = 0;
  // Sueño en cama (docs/GDD_Personaje.md §3.6) — replicado solo para que el
  // cliente pueda mostrar una pose/animación de "durmiendo" más adelante; la
  // duración real vive server-only en `RoomExteriorBase.durmiendo`.
  @type("boolean") durmiendo = false;
  // Instrumentos musicales (docs/GDD_Instrumentos.md, pedido 2026-08-31):
  // true mientras tiene un MIDI sonando — mismo criterio que `durmiendo`,
  // replicado para que el rig de CUALQUIER cliente (incluido uno que se
  // acerque a mitad de canción) muestre la pose "tocando" sin depender del
  // broadcast puntual de "instrumento:tocando" (ese solo dispara el audio).
  @type("boolean") tocandoInstrumento = false;
  // Sentarse (pedido 2026-08-31, "click sobre el mueble... sentarte, para
  // levantarte es usar WASD") — mismo criterio que `durmiendo`: replicado
  // solo para la pose, la lógica real (Set de sessionIds) vive en
  // `RoomExteriorBase.sentado`. `sentadoSuelo` es una pose DISTINTA (pedido
  // explícito: "también puedes sentarte en el suelo, otra animación") sin
  // mueble real detrás, solo la posición donde ya estaba el jugador.
  // COMPARTIDO con el asiento genérico por proximidad (mecanismo paralelo,
  // mismo día — `RoomExteriorBase.sentadoEn`/`asientosOcupados`, protocolo
  // `asiento:*`): mismo campo, misma pose, dos caminos server-side distintos
  // para ponerlo a true sin colisión real (ver la nota en RoomExteriorBase).
  @type("boolean") sentado = false;
  @type("boolean") sentadoSuelo = false;
  // Debug godMode (admin:debug:godMode, Test Zone, pedido 2026-08-31):
  // jarl/superadmin-only, self-target — con esto activo el jugador no
  // pierde vida (daño ambiental/combate) ni comida/hidratación (ver el
  // guardia en `actualizarMovimiento`/`aplicarDanoEventosAmbientales`/
  // `aplicarUnidadesASchema` de RoomExteriorBase). Solo para pruebas, no
  // persiste en BD (se apaga solo al reconectar, como `durmiendo`).
  @type("boolean") godMode = false;
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
  // Enfermedades (docs/GDD_Enfermedades.md, pedido 2026-08-30): catarro
  // (por herida infectada) y gripe (por frío en invierno), ver EnfermedadesSchema arriba.
  @type(EnfermedadesSchema) enfermedades = new EnfermedadesSchema();
  // Twitch (docs/GDD_Twitch.md, pedido 2026-08-30): título social sobre el
  // PJ según rol de chat (seguidor/sub/mod) o el nombre del streamer si es
  // jarl/admin — "" = sin título (ni seguidor de Twitch, ni nada puesto).
  // Puramente cosmético (docs/GDD_Mecanicas.md §5.11, "nunca ventaja de
  // poder") — se refresca solo, cada vez que ese jugador habla en el chat.
  @type("string") tituloTwitch = "";
  // Oficio de jugador — RONDA 2 (docs/GDD_Profesiones.md, pedido 2026-08-30:
  // "sigue sin coste ni exclusividad real"). Reemplaza el `oficio` único de
  // la v1: EXACTAMENTE 2 slots ("" = vacío), elegidos hablando con el NPC
  // "maestro de oficios" (`oficio:elegir` en un slot vacío, gratis;
  // `oficio:cambiar` en un slot ocupado, cuesta `PRECIO_CAMBIO_OFICIO`
  // Farycoins y reinicia a 0 la XP del oficio que se quita —
  // `server/src/personaje/oficios.ts`). La XP de oficio
  // (`jugador_oficios`) solo se otorga si el oficio de la receta está en
  // uno de estos 2 slots (`tieneOficio`) — el crafteo en sí sigue abierto a
  // cualquiera, lo que exige el oficio elegido es progresar/tener bono.
  // SÍ persiste entre sesiones (`jugadores.oficio_1`/`oficio_2` en
  // server/src/datos/bd.ts), a diferencia de vitales/gremioId — es una
  // elección deliberada del jugador, no un estado de sesión.
  @type("string") oficio1 = "";
  @type("string") oficio2 = "";
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
  /** docs/GDD_Carros.md §4 (pedido 2026-09-03) — id de la fila `conjuntos_tiro` (BD)/clave de state.conjuntosTiro en la que va montado; 0 = ninguna. Mismo criterio que barcoId: el Schema del conjunto NO desaparece (varias plazas posibles), el cliente solo oculta el rig humanoide mientras esto sea >0. */
  @type("number") conjuntoId = 0;
  /** Solo con conjuntoId>0: true = lleva las riendas (su input mueve el conjunto entero), false = pasajero (se mueve con él, solo en carros de categoría "personas"). */
  @type("boolean") conjuntoConductor = false;
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
  // Patrulla bandida (docs/GDD_Faccion_Bandidos.md §7ter, pedido 2026-08-30):
  // el único Npc que ataca por su cuenta (verificarAgroFauna) y arrastra al
  // resto del grupo si andan cerca (cerrarVentanaCombate) — false para
  // cualquier civil normal de poblacion/, que sigue exactamente igual.
  @type("boolean") hostil = false;
  // NPC tutorial fijo — RONDA 3 (docs/GDD_Profesiones.md, pedido
  // 2026-08-30): "un NPC por cada mecánica... colocado a mano por el admin
  // o superadmin en su posición actual". "" = NPC normal de poblacion/.
  // `tipoTutorial` es el id de `poblacion/catalogo/npcsTutoriales.json`
  // (qué mecánica explica — el texto real de cada tutorial es contenido
  // pendiente, ver el catálogo); `equipo` es slot->itemId (MISMO shape que
  // `InventarioSchema.equipo` del jugador) resuelto del catálogo al
  // colocarlo, para que salga "vestido" reusando `equipoVisual.ts` tal
  // cual — nunca se genera ropa nueva para NPCs, se reusa el pipeline del jugador.
  @type("string") tipoTutorial = "";
  @type({ map: "string" }) equipo = new MapSchema<string>();
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
  /** docs/GDD_Carros.md §2 (pedido 2026-09-03) — tiene arnés puesto (mascota:ponerArnes) y por tanto se puede `carro:enganchar`. Ranura independiente de `montura`. Mientras está enganchada, esta entrada DESAPARECE del Schema (fusionada en ConjuntoTiroSchema) — vuelve a aparecer al desenganchar. */
  @type("boolean") arnes = false;
  /** docs/GDD_Carros.md §3 — SOLO con arnes:true: peso máximo de carro que puede tirar (del ítem `esApero` consumido). */
  @type("number") arnesPesoMaximo = 0;
}

// Compañero NPC (docs/GDD_Companeros.md, pedido 2026-08-30) — un Npc real de
// poblacion/ reclutado (contratar por diálogo+carisma, o comprado a un
// vendedor). Mismo criterio de vida que Mascota: solo existe en el Schema
// mientras está "siguiendo" a su dueño Y su dueño está en ESTA room — se
// spawnea al entrar y se borra al salir, nunca se persiste x/y (solo la fila
// BD vía datos/bd.ts). Reusa InventarioSchema tal cual (mismo truco que
// CadaverSchema.contenedor) — el compañero tiene contenedor propio + equipo.
export class CompaneroSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") nombre = "";
  /** slotId del Npc original en poblacion.json — el cliente reusa su MISMO vox (voxPorSlot), no genera un aspecto nuevo. */
  @type("string") npcOrigenSlot = "";
  /** Nombre del jugador dueño — SOLO para etiqueta, mismo criterio que Mascota.duenoNombre. */
  @type("string") duenoNombre = "";
  @type("number") vida = 0;
  @type("number") vidaMax = 0;
  @type("number") ataque = 0;
  @type("number") defensa = 0;
  @type("int8") nivel = 1;
  @type(InventarioSchema) inventario = new InventarioSchema();
  /** Burbuja de queja por hambre (docs/GDD_Companeros.md) — "" = nada que decir; mismo mecanismo de burbuja periódica que la tos del catarro (docs/GDD_Enfermedades.md). */
  @type("string") quejaTexto = "";
  /** Pedido 2026-08-31: "la gente que apoya debe poder decidir si se une o no, no autounirse" — antes el compañero se metía SIEMPRE en el combate de su dueño sin preguntar (manejarCombateUnirse); true = comportamiento de siempre (default, nada cambia si no lo tocas), false = se queda fuera. Lo decide el dueño desde panelCompanero.ts. */
  @type("boolean") participaEnCombate = true;
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

// Carro aparcado, SIN enganchar (docs/GDD_Carros.md §3, pedido 2026-09-03):
// mismo criterio exacto que Barco — se ancla donde se coloca (carro:colocar)
// y así se queda hasta que alguien lo engancha a un animal con arnés
// (carro:enganchar, momento en el que esta entrada desaparece y se funde en
// ConjuntoTiroSchema) o vuelve a desengancharse.
export class CarroSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") tipoId = "";
}

// Animal+carro fusionados (docs/GDD_Carros.md §1/§5, pedido 2026-09-03):
// mismo espíritu que montar solo (el conductor sustituye su movimiento
// entero por el del conjunto, RoomExteriorBase.actualizarMovimiento) pero
// SIEMPRE visible en el Schema como un barco (varias plazas posibles) — solo
// se oculta el rig humanoide de cada ocupante (Player.conjuntoId > 0).
// `especieAnimalId` es para el render del animal que tira; `mascotaId`
// cruza con la fila `mascotas` (BD) fusionada, para poder devolverla intacta
// al desenganchar. Sin conductor (conductorSessionId === ""): el conjunto
// entero está quieto, no colisiona con nadie (mismo criterio que un barco
// varado) — docs/GDD_Carros.md §13.
export class ConjuntoTiroSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") especieAnimalId = "";
  @type("number") mascotaId = 0;
  @type("string") carroTipoId = "";
  @type("string") conductorSessionId = "";
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

// Mesas de MINIJUEGO (docs/GDD_Mesas_Minijuego.md) — mueble craftable+
// colocable (mesa_ajedrez hoy, mismo esqueleto sirve para damas/blackjack a
// futuro cambiando solo el motor de reglas y el panel). MÁS LIGERO que
// combate a propósito: sin arena/room propia, vive inline en el estado de
// la room dueña de la construcción (Hub/Region/Interior). Clave del map en
// `HubState.mesasAjedrez` = String(construccionId) de la fila real de
// `construcciones` (GDD_Construccion §2) — así una mesa recién colocada no
// tiene entrada hasta que alguien se sienta (`RoomExteriorBase.ts` la crea
// perezosa) y una mesa vacía de nuevo se borra del map (sin acumular
// partidas fantasma sin jugadores).
export class MesaAjedrezSchema extends Schema {
  /** sessionId sentado, o "" si la silla está libre. */
  @type("string") sillaBlancas = "";
  @type("string") sillaNegras = "";
  /** Posición actual en notación FEN (chess.js) — arranca en la posición inicial estándar de ajedrez. */
  @type("string") fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  /** "esperando" (<2 sentados) | "activo" (las 2 sillas ocupadas, jugando) | "terminado" (jaque mate/tablas — el tablero final se queda visible hasta que alguien se levanta). */
  @type("string") fase = "esperando";
  /** sessionId a quien le toca mover; "" fuera de fase "activo". */
  @type("string") turnoDe = "";
  /** "" | "blancas" | "negras" | "tablas" — solo relevante en fase "terminado". */
  @type("string") ganador = "";
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
  // Identidad VISUAL (pedido 2026-09-01, GDD_Muerte_Respawn.md) — JSON de
  // `DatosVisualCadaver` (server/src/mundo/cadaveres.ts), "" si no hace
  // falta (fauna: `especieOrigenId` ya basta). El cliente la lee para
  // montar el MISMO rig+equipo que tenía en vida, en pose caída, en vez
  // de la caja genérica de antes.
  @type("string") datosVisual = "";
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
  @type({ map: CompaneroSchema }) companeros = new MapSchema<CompaneroSchema>();
  @type({ map: Barco }) barcos = new MapSchema<Barco>();
  @type({ map: CarroSchema }) carros = new MapSchema<CarroSchema>();
  @type({ map: ConjuntoTiroSchema }) conjuntosTiro = new MapSchema<ConjuntoTiroSchema>();
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
  // Mesas de ajedrez activas (docs/GDD_Mesas_Minijuego.md) — clave =
  // String(construccionId) del mueble "mesa_ajedrez" ya colocado. Entradas
  // perezosas: solo existen mientras al menos una silla está ocupada.
  @type({ map: MesaAjedrezSchema }) mesasAjedrez = new MapSchema<MesaAjedrezSchema>();
  // Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre legendario) —
  // clave = String(prendaGeneradaId), cargada perezosamente (nunca se
  // precarga la BD entera: solo entra aquí cuando alguien la crea o cuando
  // hace falta resolver un equipoBlueprintRopa que aún no está en el mapa).
  @type({ map: BlueprintRopaSchema }) blueprintsRopa = new MapSchema<BlueprintRopaSchema>();
}
