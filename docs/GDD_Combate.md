# GDD — Combate: rejilla táctica por turnos

**ESTADO: ✅ IMPLEMENTADO (2026-08-30) — interactivo Y autosimulado.** Decisión del streamer: este sistema **SUSTITUYE** al daño directo simple que se había implementado mientras tanto (`server/src/combate/combate.ts` + mensaje `combate:atacar`) — ese queda INTERINO (sin borrar, sigue ahí) hasta que se decida retirarlo. Excepción explícita: **cuando ninguno de los combatientes es un jugador** (NPC vs animal, NPC vs NPC) NO se juega por turnos interactivos con UI — se AUTOSIMULA server-side, de golpe (§7). El streamer pidió explícitamente que la UI de esta primera pasada fuera **placeholder de testeo** ("simplemente para testeo... al final del proyecto se hará toda la UI") — así está construida: sin overlay de rejilla, sin retratos, solo texto y botones.

**Qué hay ya en pie, de verdad, no solo diseñado:**
- Motor puro (§2-3 de este documento, `server/src/combate/{combate,arenaCombate,pathfindingArena}.ts`) — 361 tests entre puro+integración.
- `CombateSchema`/`CombateUnidad` replicados (`server/src/rooms/schema/CombateState.ts`, `HubState.combates`).
- Los 5 mensajes del protocolo (§4) cableados en `RoomExteriorBase.ts` — funcionan en las 4 rooms (Hub/Region/Interior/Dungeon), no solo el Hub.
- `Enemigo` de mazmorra ya tiene vida/ataque/defensa (placeholder de balance, `DungeonRoom.poblarEnemigos`) — el hueco que este documento decía que rellenaría, relleno.
- Panel de cliente placeholder (`client/src/combate/panelCombate.ts`) + tecla **C** ataca al hostil más cercano (`client/src/game.ts`).
- Autosimulación NPC-vs-fauna peligrosa, disparador REAL cada 5s (`HubRoom.comprobarEncuentrosAutomaticos`, §7).
- **Verificado contra el servidor de verdad**, no solo tests puros: `client/test/combate.e2e.mjs` — arranca Colyseus+mapa demo, un cliente colyseus.js real inicia combate contra fauna salvaje activa, lo juega turno a turno (incluida la IA de la fauna atacando de vuelta) hasta la muerte, y comprueba que desaparece de `state.fauna` (cadáver creado). Encontró y corrigió un bug real: el cliente no puede leer `alcance` (campo solo-servidor) — el placeholder ataca primero y solo se acerca si el servidor responde "fuera de alcance", sin duplicar la regla de alcance en el cliente.

## 0. Por qué encaja donde ya está, sin inventar infraestructura nueva

Todo lo necesario para "coste cero" ya existe, solo hay que conectarlo — no hace falta una Room nueva, ni un tick, ni una rejilla de colisión distinta a la del mapa:

- **`Enemigo` en `HubState.ts`** lleva desde su creación el comentario "Sin movimiento/combate todavía (el streamer lo explicará aparte): un enemigo aparece quieto en su punto" — es el hueco exacto que este documento rellena.
- **`items.json` ya tiene los stats de combate sin consumidor**: `ataqueFisico`, `ataqueMagico`, `alcance`, `cooldownMs`, `defensaFisica`, `defensaMagica` (confirmado por grep — ver nota de catálogo, ninguna función los lee todavía), más `durabilidadMax`/`desgastePorUso` y toda `server/src/inventario/desgaste.ts` ya escritos y probados (21 tests puros) pero **sin ninguna Room que los llame** — el combate es su primer consumidor real.
- **La rejilla de la arena NO es nueva**: `server/src/mundo/colisiones.ts` (`MundoColision.casillas`, `tipoEn()`) ya clasifica cada casilla como sólida o no, y tanto `InteriorRoom` como `DungeonRoom` guardan `this.mundo`/`this.interior` con esa rejilla cargada. La arena de combate es un recorte NxN de esa MISMA rejilla centrado en el encuentro — cero autoría nueva, el mapa ya bakeado es la arena.
- **`DungeonRoom.poblarEnemigos`** ya puebla `state.enemigos` con `Enemigo` reales (x, y, enemigoId, esBoss) al entrar en una mazmorra — el combate se dispara sobre esas entidades que ya existen, no hace falta un spawner nuevo.
- **El patrón de mensajes `xxx:accion`** (`crafteo:iniciar`/`crafteo:recolectar`, `refinamiento:depositar`, `motriz:accionar`) ya es el idioma del proyecto para "el cliente pide, el servidor valida y aplica" — el protocolo de combate es más de lo mismo, no un mecanismo nuevo.
- **La UI ya es HTML/DOM plano inyectado sobre el canvas** (`client/src/construccion/constructor.ts`: `document.createElement`, `<style>` inyectado, paneles con `display:block/none`) y el propio `WorldScene` ya monta un `CSS2DRenderer` superpuesto a la cámara 3D para etiquetas — la UI de combate (retratos, barra de turnos, hotbar) sigue exactamente ese mismo patrón, no hace falta React ni un framework nuevo (el cliente no usa ninguno).

## 1. Disparo del combate — sin Room nueva, sin conexión nueva

Un combate vive DENTRO de la room donde ya está el jugador (`InteriorRoom`/`DungeonRoom` para PvE de mazmorra y fauna peligrosa en interiores; `RegionRoom` para fauna peligrosa en exterior — mismo mecanismo en ambas, ambas heredan `RoomExteriorBase`). No hay transición de room ni reconexión: el "modo combate" es un sub-estado replicado que se activa y desactiva sobre la MISMA conexión, así que no cuesta nada nuevo en el patch channel.

**Disparo**:
- **Jugador ataca a un `Enemigo`/fauna peligrosa** dentro de `RADIO_INTERACCION` (ya existe, usado por `coger`/`portal:usar`) → `combate:iniciar {objetivoId}`.
- **Fauna con `disposicion:"hostil"` o `"neutral"` provocada** (radio de agro, dato ya en `baker/catalogo/animales.json` desde el "Costura 2026-08-29" del Backlog, sin consumidor todavía) inicia combate ella misma cuando el jugador entra en su `radioAgro` — se resuelve de forma perezosa, en el mismo tick de movimiento que ya recalcula colisiones, no un tick nuevo.
- Varios jugadores pueden unirse al MISMO combate si atacan al mismo objetivo dentro de un margen corto (co-op contra un boss) — el combate no es 1v1 forzoso.

Al iniciarse: el servidor recorta un área NxN (8x8 encuentro normal, 10x10 contra boss — el tamaño lo decide `esBoss` del `Enemigo`) centrada en el punto de contacto, usando `tipoEn()` sobre `this.mundo` para marcar cada casilla walkable/obstáculo — si el recorte choca con el borde del mapa/interior se desplaza para caber entero, nunca se genera geometría nueva.

## 2. Estado replicado — nuevas Schema, mismo patrón que `HubState.ts`

```ts
// server/src/rooms/schema/CombateState.ts (código real, actualizado tras §9.1/§9.3)
export class CombateUnidad extends Schema {
  @type("string") id = "";           // sessionId del jugador o clave del Enemigo/Fauna/Npc (misma clave que state.enemigos/fauna/npcs/players)
  @type("boolean") esJugador = false;
  @type("string") bando = "A";       // "A" | "B"
  @type("int8") gx = 0;              // coordenada DENTRO de la arena (0..ancho-1), no del mundo
  @type("int8") gy = 0;
  @type("number") hp = 0;
  @type("number") hpMax = 0;
  @type("int8") pa = 0;              // recurso ÚNICO de turno (§9.3) — mover/atacar/objeto/magia salen del mismo pool
  @type("int8") paMax = 0;
  @type("number") iniciativa = 0;    // fija el orden, calculada una vez al empezar
  @type("string") estado = "activo"; // "activo" | "caido" | "huido"
  // Campos SOLO servidor (sin @type, snapshot tomado al entrar en combate):
  ataqueFisico = 0;
  defensaFisica = 0;
  alcance = 1;
}

export class CombateSchema extends Schema {
  @type("number") gx0 = 0;           // origen de la arena en coordenadas de mundo (para pintar el overlay)
  @type("number") gy0 = 0;
  @type("int8") ancho = 8;
  @type("int8") alto = 8;
  @type(["int8"]) obstaculos = new ArraySchema<number>(); // 1 = obstáculo, índice gy*ancho+gx
  @type(["string"]) ordenTurnos = new ArraySchema<string>(); // ids de CombateUnidad, por iniciativa desc
  @type("int8") turnoActual = 0;     // índice sobre ordenTurnos
  @type({ map: CombateUnidad }) unidades = new MapSchema<CombateUnidad>();
  // Ventana de unión (§9.1): "pendiente" = todavía se puede sumar gente
  // (ordenTurnos vacío, nadie juega turno), "activo" = ventana cerrada,
  // combate jugable de verdad. cierraEn: epoch ms, 0 si ya no aplica.
  @type("string") fase = "activo";
  @type("number") cierraEn = 0;
}
```

En `HubState.ts`: `@type({ map: CombateSchema }) combates = new MapSchema<CombateSchema>();` — un Map, no un único combate, porque una `DungeonRoom` puede tener varios grupos peleando en salas distintas a la vez sin bloquearse entre sí (mismo criterio que `construcciones`/`plantillas` ya son Maps por id, no un singleton).

## 3. Lógica de turnos — event-driven, CERO tick nuevo

Nada de `clock.setInterval` por combate activo (violaría la regla del proyecto). Todo se resuelve dentro del handler del mensaje que lo dispara, exactamente como `manejarCrafteoIniciar`/`manejarProduccionRecolectar` ya resuelven su lógica al vuelo:

- `combate:iniciar {objetivoId}` → crea `CombateSchema`, calcula iniciativa de cada unidad (stat base + variación pequeña por semilla del combate, determinista para que sea reproducible en test), puebla `ordenTurnos`, pone AP/MP al máximo de la primera unidad.
- `combate:mover {combateId, gx, gy}` → valida turno del que envía el mensaje, valida que `gx,gy` es alcanzable con el MP restante (BFS simple sobre la rejilla NxN — 64/100 casillas, trivial, `server/src/combate/pathfindingArena.ts`, reusa el mismo criterio de sólido que `tipoEn()`), descuenta MP gastado, actualiza `gx,gy`.
- `combate:accion {combateId, habilidadId, objetivoId}` → valida AP suficiente, alcance (distancia Chebyshev ≤ `alcance` del arma equipada, leído de `items.json` vía `inventario.ts`), línea de visión (Bresenham sobre `obstaculos`), resuelve daño = `ataqueFisico/ataqueMagico` del atacante − `defensaFisica/defensaMagica` del objetivo (server-autoritativo, el cliente solo sugiere — mismo criterio que todo el proyecto), aplica `desgaste.ts` (`registrarUso` al arma, `aplicarDanoArmadura` a la armadura del objetivo — primer enganche real de ese módulo), descuenta AP.
- `combate:pasarTurno {combateId}` → avanza `turnoActual`, si da la vuelta completa recalcula regen de AP/MP de cada unidad viva.
- Turno de un `Enemigo` (no hay cliente que envíe el mensaje): se resuelve automáticamente, en el mismo instante en que le toca en `ordenTurnos` — un cálculo síncrono y barato (IA simple: acercarse al jugador más cercano dentro de su MP, atacar si está en alcance) hecho DENTRO de `combate:pasarTurno`/`combate:accion` del jugador anterior, nunca en un timer propio.
- Combate termina cuando un bando entero queda `"caido"`/`"huido"`: se aplica el resultado (loot, XP si se define más adelante, o para mazmorra: si eran los últimos enemigos de esa `DungeonRoom`, llama a `marcarMazmorraLimpiada` — el trigger que `GDD_Bakeador_Dungeons.md §7` deja pendiente "depende del sistema de combate", que pasa a estar conectado aquí) y borra el `CombateSchema` del Map — vuelve a movimiento libre normal, sin más estado que limpiar.
- Único timer aceptable, y acotado: un `clock.setTimeout` POR combate activo para forzar `pasarTurno` si el jugador no actúa en ~30s (AFK) — se crea al entrar en el turno de ese jugador y se cancela al recibir su mensaje; no es un tick global, es el mismo patrón puntual y acotado que ya se aceptó para la economía de bandidos (10 min) — nunca un intervalo por room/jugador corriendo indefinidamente.

## 4. Protocolo Colyseus — mismo idioma que crafteo/motriz

| Mensaje | Payload | Valida | Efecto |
|---|---|---|---|
| `combate:iniciar` | `{objetivoId}` | objetivo en `RADIO_INTERACCION`, no en combate ya | crea `CombateSchema`, puebla arena y orden de turnos |
| `combate:mover` | `{combateId, gx, gy}` | es su turno, casilla alcanzable con MP restante, no ocupada | actualiza `gx,gy`, descuenta MP |
| `combate:accion` | `{combateId, habilidadId, objetivoId}` | es su turno, AP suficiente, alcance+LoS | resuelve daño/efecto, descuenta AP, aplica desgaste |
| `combate:pasarTurno` | `{combateId}` | es su turno | avanza `turnoActual`, resuelve turnos de enemigo en cascada |
| `combate:huir` | `{combateId}` | es su turno, casilla de borde de arena alcanzable | marca `"huido"`, sale del combate sin loot |

Todos cuelgan de `RoomExteriorBase` junto a los handlers de crafteo/motriz que ya están ahí (línea ~194-196) — no hace falta una clase de Room nueva ni un router aparte.

## 5. Cliente — misma cámara isométrica, overlay nuevo encima

**Grid overlay**: un `THREE.Group` de planos finos semitransparentes, uno por casilla de la arena, usando la MISMA conversión `posicionMundo(x,y)` que ya usa `WorldScene.añadirEntidad` (1 casilla = 1 unidad de mundo, sin sistema de coordenadas nuevo) — color por estado: verde = alcanzable con el MP restante (llega al recalcular tras cada `combate:mover`/cambio de turno), rojo = alcance de habilidad seleccionada, amarillo = AoE de la habilidad al pasar el ratón, gris = obstáculo. Vive en `client/src/combate/overlayArena.ts`, añadido/quitado de la escena vía `worldScene.añadirEstatico/quitarEstatico` (ya existen, pensados exactamente para geometría que entra y sale).

**Diferenciación de unidades**: círculo de selección bajo cada unidad (anillo `THREE.RingGeometry` plano en el suelo, azul=aliado, rojo=enemigo, amarillo=turno activo — se recolorea con `ordenTurnos[turnoActual]`) + barra de HP, ambos como `CSS2DObject` reusando el mecanismo que `WorldScene` ya tiene para las etiquetas de nombre (`añadirEntidad`/`textoEtiqueta`) — se extiende ese mismo div con una barra en vez de crear un renderer nuevo.

**Cámara**: sin cambios de proyección — `WorldScene.seguirPunto()` ya existe y ya suaviza el movimiento; al entrar en combate simplemente apunta al centro de la arena (`gx0+ancho/2, gy0+alto/2`) en vez de seguir al jugador, y vuelve a seguirlo al terminar. Cero código de cámara nuevo.

**UI de combate** (`client/src/combate/uiCombate.ts`), DOM plano igual que `constructor.ts`:
- Panel inferior-izquierdo: retrato + HP/Maná/Aguante/stats del héroe (lee `Player` + el ítem equipado vía `equipo` MapSchema).
- Panel inferior-derecho: mismo layout para el objetivo bajo el cursor/seleccionado.
- Barra inferior-central: iconos de habilidad con coste en AP superpuesto (deshabilitado en gris si no llega el AP restante), botón guardia, cambio de arma, consumibles, "pasar turno" — cada icono dispara `combate:accion`/`combate:pasarTurno`.
- Franja de orden de turnos: retratos en fila leyendo `ordenTurnos`, resaltando `turnoActual`.
- Panel superior-derecho: objetivos secundarios — placeholder vacío en esta primera pasada (no hay sistema de objetivos de misión todavía; se deja el hueco en el layout, sin datos que mostrar).

Todo el panel se muestra/oculta con `combate.activo` (colyseus `onChange`), mismo patrón que el panel de construcción ya hace con `_activo`.

## 6. Qué queda fuera de esta propuesta (a decidir después, con este contrato ya construido)

- El árbol de habilidades por arma/clase — aquí solo se fija que una "habilidad" cuesta AP, tiene alcance y puede tener AoE; el catálogo real de habilidades (ids, efectos, iconos) es trabajo posterior, como las recetas de Crafteo se rellenan oficio a oficio.
- PvP — el documento asume PvE (jugador contra `Enemigo`/fauna); si se activa combate entre jugadores es el mismo mecanismo (dos `CombateUnidad` con `esJugador:true`), pero el streamer ya apuntó que probablemente esté limitado/desactivado por defecto — se decide aparte.
- Recompensas (loot/XP) al ganar — se conecta con `jugador_oficios`/inventario cuando toque, no bloquea el mecanismo de turnos en sí.
- IA de enemigo más allá de "acercarse y golpear" (huir con poca vida, usar habilidades especiales de boss) — v1 cubre lo mínimo jugable, se afina con datos reales de playtesting.

## 7. Autosimulación cuando NO hay ningún jugador implicado (✅ confirmado 2026-08-30)

Pedido explícito: "en combates de NPC contra animales o NPC vs NPC se autosimule el combate" — sin turnos interactivos, sin UI, sin arena replicada a ningún cliente (nadie la está mirando). Mismo motor de reglas que el combate interactivo (§2-3: iniciativa, AP/MP, alcance, `calcularDanio`), pero resuelto SÍNCRONO y de una sentada, dentro del mismo handler/evento que detecta el encuentro — nunca un tick propio, mismo criterio "cálculo perezoso" de todo el proyecto.

- **Cuándo aplica**: cualquier combate donde `esJugador` es `false` en TODAS las unidades de ambos bandos — NPC humanoide (guardia/bandido) vs fauna peligrosa, NPC vs NPC (guarnición de un asentamiento hostil defendiéndose), fauna vs fauna si algún día se decide (depredador cazando, hoy sigue fuera per GDD_Agentes_Moviles.md). En cuanto CUALQUIER unidad tiene `esJugador:true`, el combate es interactivo (§1-6), nunca autosimulado.
- **Motor compartido, sin Schema**: `simularCombateAutomatico(bandoA, bandoB, arena, rnd)` (`server/src/combate/arenaCombate.ts`) reutiliza literalmente las mismas funciones puras que usará el camino interactivo (`ordenarTurnos`, `resolverAtaque`, `enAlcance`, pathfinding de arena) — NO es un sistema de combate aparte, es el mismo motor sin la capa de red/turnos-esperando-input. La IA de cada unidad en modo automático es la misma "acercarse al enemigo vivo más cercano y atacar si está en alcance" que ya describe §3 para el turno de un `Enemigo`.
- **Resultado**: se itera turno a turno en memoria (tope duro de iteraciones, p.ej. 50, para no colgarse si ninguno alcanza al otro) hasta que un bando queda entero `"caido"`, y se devuelve el estado final de vida de cada unidad — quien llama (el futuro sistema que detecte el encuentro: agro de fauna salvaje, guarnición bandida atacada) decide qué hacer con el resultado (aplicar HP final, generar cadáveres vía `matarIndividuo`/`crearCadaver` ya existentes, etc.). Determinista si se inyecta `rnd` fijo — mismo criterio de testeo que el resto del proyecto (`crearPRNG`/mulberry32).
- **✅ Disparador real ya cableado (esta misma pasada)**: `HubRoom.comprobarEncuentrosAutomaticos()`, cada 5s — recorre `state.npcs` × fauna salvaje ACTIVA (solo la de sectores cerca de jugadores, nunca las miles inactivas), y si alguna especie tiene `peligroso:true` (campo nuevo en `catalogoCombateFauna.ts`, viaja tal cual desde `baker/catalogo/animales.json`) dentro de 4 casillas de un NPC, resuelve el encuentro con `simularCombateAutomatico` y aplica el resultado (vida final, o `state.npcs.delete`/`onFaunaMuerta` si alguno cae). Un encuentro por pasada — sencillo a propósito, no una simulación masiva. **Sigue sin disparador para NPC-vs-NPC** (guarnición bandida vs guarnición): no existe ninguna entidad NPC-bandido viva en red todavía (`tropas_asentamiento` sigue siendo solo filas en BD, ver GDD_Faccion_Bandidos.md §2.4) — cuando exista, se conecta al MISMO `simularCombateAutomatico`, cero motor nuevo que escribir.

## 8. Qué queda fuera TODAVÍA de esta implementación (honesto, no diseño — código real pendiente)

- **UI de verdad**: el panel actual (`panelCombate.ts`) es texto+botones, sin overlay de rejilla, sin retratos, sin iconos de habilidad, sin franja de turnos con retratos — pedido explícito del streamer de dejarlo así hasta la pasada final de UI del proyecto entero.
- **Una sola "habilidad"**: no hay árbol de habilidades ni `habilidadId` real — `combate:accion` siempre es "golpear con lo que tengas" (coste fijo de PA, alcance fijo 1 = cuerpo a cuerpo). El campo `habilidadId` del protocolo (§4) está aceptado en el mensaje pero ignorado.
- **Sin línea de visión (Bresenham)**: el alcance es solo distancia Chebyshev, sin comprobar que no haya un obstáculo entre atacante y objetivo.
- **Corrección (2026-08-30): este hueco ya se cerró** — `ataqueFisico`/`defensaFisica` de cada unidad siguen saliendo de `Player.ataque`/`Player.defensa`, pero esos dos campos ya NO son base fija: `RoomExteriorBase.ts::recalcularStatsJugador` los recalcula sumando `calcularStatsEquipo()` de lo equipado (`player.ataque = ATAQUE_BASE_JUGADOR + stats.ataqueFisico`) cada vez que se equipa/desequipa o se carga el inventario — así que las armas/armaduras de `items.json` ya sí entran en el cálculo de daño, de forma indirecta a través de `Player`.
- **Sin `desgaste.ts` conectado**: ni `registrarUso` al arma ni `aplicarDanoArmadura` al objetivo se llaman desde `combate:accion` todavía.
- **`combate:huir` no valida "casilla de borde alcanzable"**: cualquier jugador puede huir en su turno sin comprobar posición — simplificación deliberada de esta pasada.
- **PA fijo para todo el mundo** (`PA_MAX_COMBATE` en `RoomExteriorBase.ts`, §9.3): no varía por unidad/clase/equipo.
- **Sin recompensas** (loot/XP) al ganar un combate interactivo.
- **Probado de verdad en HubRoom + arena instanciada** (`client/test/combate.e2e.mjs`, mapa demo, jugador vs fauna salvaje, flujo completo con ventana de unión + arena) y un E2E manual PvP en `RegionRoom` (§9) — el mismo código de `RoomExteriorBase` corre en `InteriorRoom`/`DungeonRoom` (jugador vs `Enemigo` de mazmorra, co-op multi-jugador contra el mismo objetivo) pero esos caminos NO tienen un e2e propio todavía, solo revisión de código.
- **El inventario NO viaja a la arena** (§9.2): el jugador entra a la room de arena con un inventario nuevo/vacío (`crearJugador` de base) — objetos consumibles del turno (§9.3) funcionan porque `personaje:consumir` no depende de qué room es, pero cualquier ítem que llevara encima antes de entrar no está disponible dentro del combate. Gap conocido, no bloquea el mecanismo de turnos.

## 9. Combate INSTANCIADO en arena aparte + PA único (pedido 2026-08-30, ✅ IMPLEMENTADO y verificado 2026-08-29)

Con el v1 de arriba (§0-8) ya construido, probado y jugable tal cual (misma room, AP+MP, UI placeholder), el streamer pidió la siguiente vuelta: que el combate se INSTANCIE en un mapa de arena aparte en vez de resolverse en el sitio, con una ventana de tiempo para que se sumen más combatientes antes de empezar. Es un cambio real de arquitectura sobre código YA verificado con E2E, así que se documentó primero (esta sección) y se implementó tras el OK explícito del streamer — mismo criterio que el resto de sistemas grandes del proyecto.

**Verificación realizada**: 354/354 tests de `server` en verde, `tsc --noEmit` limpio en `client` y `server`, `client/test/combate.e2e.mjs` (jugador vs fauna salvaje del mapa demo, HubRoom → ventana pendiente → `comenzarYa` → arena instanciada → combate jugado hasta la muerte → `portal:ir` de vuelta al Hub → la fauna REAL del Hub, no la sintética de la arena, desaparece tras rejoin) y un E2E manual adicional en PvP (dos jugadores en una `region`, ventana de unión con ambos ya apuntados, `comenzarYa`, misma room de arena para los dos, `ordenTurnos` remapeado a `sessionId` real, combate jugado hasta el final, retorno exacto para el iniciador y fallback a Hub para el objetivo sin retorno propio, marcador de "combate en curso" visible a un tercer cliente espectador y borrado al terminar) — ambos en verde.

### 9.1 Ventana de unión — combate PENDIENTE antes de instanciar nada

`combate:iniciar {objetivoId}` (mismo trigger de §1) deja de crear la arena al instante — crea un `CombateSchema` con una fase `"pendiente"` en la room ACTUAL (exterior/interior donde se cruzaron), visible a todos ahí, con `cierraEn = Date.now() + 60_000`:

- **Jugadores** dentro de `RADIO_INTERACCION` del punto de origen ven un prompt "Unirse al combate" → `combate:unirse {combateId}`.
- **NPCs/fauna** dentro de ese MISMO `RADIO_INTERACCION` (2.2 — `RoomExteriorBase.ts:44`, la única constante de "cerca" que ya usa todo el proyecto, no se inventa un radio nuevo) se unen AUTOMÁTICAMENTE sin turno del jugador: extensión directa del agro que ya existe (`HubRoom.ts` — un animal ataca si el objetivo está a `< RADIO_INTERACCION`).
- Cualquier participante ya apuntado puede pulsar "Comenzar ya" (`combate:comenzarYa {combateId}`) para saltarse lo que quede de los 60s.

**Excepción — modo caza** (docs/GDD_Caza.md, pedido 2026-08-30): si el objetivo es Fauna NO peligrosa (`!faunaEsPeligrosa`, ver §5.4 de GDD_Mecanicas), `manejarCombateIniciar` NO abre ventana — cierra al instante (`cerrarVentanaCombate` síncrono, sin `clock.setTimeout`) y sin auto-unión de nada, ni siquiera Enemigo de mazmorra cercano (`combatesSinAutoUnion`, estrictamente 1 vs 1). La presa entra como unidad `pasivo:true`: en su turno deambula sin rumbo (`jugarTurnoIAPasiva`, `arenaCombate.ts`) y nunca ataca ni persigue, esté el jugador a tiro o no. Fauna peligrosa (jabalí/lobo/oso...) sigue el camino normal de esta sección.

### 9.2 Al cerrar la ventana — teleport a una room de arena nueva, placeholder en el origen, vuelta al terminar

- El servidor elige una arena (§9.4) y crea una room de arena NUEVA, una por combate (`filterBy(["combateId"])`, mismo patrón de instancia por clave que ya usan `interior`/`mazmorra`, `server/src/index.ts:28-32`) — manda a cada participante el MISMO mensaje que ya existe para cambiar de room, `client.send("portal:ir", {tipo:"combate", combateId, x, y})` (el cliente ya reacciona a esto y reconecta, `client/src/game.ts`) — cero mecanismo de teleport nuevo, el portal de siempre apuntando a otro sitio.
- **Placeholder en el mapa de origen**: al abrirse la arena, la room de origen deja un marcador (`MarcadorCombateSchema`: x, y, participantes) en un `MapSchema` nuevo de `HubState` (`combatesEnCurso`) mientras dure la pelea — visible a cualquiera que pase por ahí. Se borra al terminar.
- **Vuelta**: la room de arena guarda por participante `{tipoOrigen, mapaId, x, y}` capturado al entrar — al acabar el combate manda el `portal:ir` inverso a esas coordenadas exactas. Mismo patrón que `InteriorRoom.ts` ya usa para "salir por la puerta".
- Combate SIN jugadores (§7) sigue exactamente igual — la autosimulación NUNCA instancia nada.

### 9.3 Un único recurso de turno: PA (sustituye AP+MP del v1)

Colapsa `ap`/`apMax`/`mp`/`mpMax` de `CombateUnidad` en un solo `pa`/`paMax`, del que salen las cuatro acciones del turno:

- **Mover**: `pa` por casilla (Chebyshev, mismo cálculo de `casillasAlcanzables` en `pathfindingArena.ts`, solo cambia qué contador se resta).
- **Combate**: `pa` fijo por golpe (placeholder de balance).
- **Objetos**: mismo `personaje:consumir` (`docs/GDD_Personaje.md §4`), solo en el turno propio dentro de un combate activo, cuesta `pa`.
- **Magia**: sin catálogo de hechizos todavía (§8) — mismo hueco "habilidad con coste en `pa`" que una acción de combate normal.

### 9.4 Mapas de arena — bakeados por bioma/interior, uno elegido por combate

Arenas NxN pequeñas, mismo formato de sectores que el resto de bakeadores (compatible con `MundoColision`/`tipoEn()`, cero parser nuevo) — `assets/mapas/arenas/<bioma>/<variante>.json` (+ `interior/<variante>.json`). Catálogo nuevo (`mazmorras/catalogo/arenas.json` o similar) lista variantes por bioma; al cerrar la ventana de unión el servidor elige una determinista por semilla del combate (mismo `elegirPonderado`/PRNG mulberry32 de siempre) entre las del bioma/interior de origen. Bake tool nuevo y pequeño (reusa `mazmorras/src/celular.js` para el contorno — sin salas ni mobiliario, una arena es solo suelo+obstáculos). Esta pasada bakearía solo 1-2 arenas de PRUEBA — la producción real ("varias por bioma") la corre el streamer.

### 9.5 IA de NPC en la arena — ya cubierta por el motor existente, sin cambios

El patrón pedido ("a distancia atacan cuando pueden al más cercano, cuerpo a cuerpo se acercan a combatir") es EXACTAMENTE lo que `arenaCombate.ts:simularCombateAutomatico`/`objetivoMasCercano` ya hace: busca el enemigo vivo más cercano y, si `enAlcance()` (que depende del `alcance` propio — 1 melee, 4-9 a distancia), ataca; si no, se acerca con `pasoHacia`. La distinción melee/distancia es consecuencia del `alcance` de cada unidad, no un caso especial — el motor puro ya construido sirve tal cual para un turno interactivo, no solo para la autosimulación.
