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
// server/src/rooms/schema/CombateState.ts
export class CombateUnidad extends Schema {
  @type("string") id = "";           // sessionId del jugador o clave del Enemigo (misma clave que state.enemigos/players)
  @type("boolean") esJugador = false;
  @type("int8") gx = 0;              // coordenada DENTRO de la arena (0..ancho-1), no del mundo
  @type("int8") gy = 0;
  @type("number") hp = 0;
  @type("number") hpMax = 0;
  @type("int8") ap = 0;              // puntos de acción del turno actual
  @type("int8") apMax = 0;
  @type("int8") mp = 0;              // puntos de movimiento del turno actual
  @type("int8") mpMax = 0;
  @type("number") iniciativa = 0;    // fija el orden, calculada una vez al empezar
  @type("string") estado = "activo"; // "activo" | "caido" | "huido"
}

export class CombateSchema extends Schema {
  @type("boolean") activo = false;
  @type("number") gx0 = 0;           // origen de la arena en coordenadas de mundo (para pintar el overlay)
  @type("number") gy0 = 0;
  @type("int8") ancho = 8;
  @type("int8") alto = 8;
  @type(["int8"]) obstaculos = new ArraySchema<number>(); // 1 bit por casilla ya resuelto server-side, walkable/no
  @type(["string"]) ordenTurnos = new ArraySchema<string>(); // ids de CombateUnidad, por iniciativa desc
  @type("int8") turnoActual = 0;     // índice sobre ordenTurnos
  @type("string") fase = "movimiento"; // "movimiento" | "accion" | "resolviendo"
  @type({ map: CombateUnidad }) unidades = new MapSchema<CombateUnidad>();
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

## 1bis. REVISIÓN — combate INSTANCIADO en arena aparte (pedido 2026-08-30, sustituye a §1 en el punto de "sin Room nueva")

El streamer pidió explícitamente que el combate NO ocurra en el sitio donde se cruzan los combatientes, sino que se teletransporten a una instancia de arena separada (bakeada por bioma, o de interior si el encuentro empezó bajo techo), con una ventana de tiempo antes para que se sumen más combatientes, y que al terminar se vuelva al mapa exterior de donde salieron. Esto SUSTITUYE la frase de §1 "no hace falta una Room nueva" — si la hace falta, una por combate, con el MISMO mecanismo de siempre (nada inventado):

- **Disparo → combate PENDIENTE, no arena todavía**: `combate:iniciar {objetivoId}` (mismo trigger de §1: atacar dentro de `RADIO_INTERACCION`, o fauna con agro) no teletransporta a nadie de inmediato — crea un `CombateSchema` con `fase:"pendiente"` en la room ACTUAL (exterior/interior), visible a todos ahí, con un `cierraEn = Date.now() + 60_000`.
- **Ventana de 60s, unirse**:
  - Jugadores dentro de `RADIO_INTERACCION` del punto de origen ven un prompt/botón "Unirse al combate" → `combate:unirse {combateId}`, se apuntan como participante.
  - NPCs/fauna dentro de ese MISMO `RADIO_INTERACCION` (2.2, la única constante de "cerca" que ya usa todo el proyecto — `RoomExteriorBase.ts:44` — no se inventa un radio de atracción nuevo) se unen AUTOMÁTICAMENTE, sin turno del jugador: es la extensión directa del agro que ya existe (`HubRoom.ts:232` — un animal ataca si el objetivo está a `< RADIO_INTERACCION`).
  - Cualquier participante ya apuntado puede pulsar "Comenzar ya" (`combate:comenzarYa {combateId}`) para saltarse lo que quede de los 60s.
- **Al cerrar la ventana** (timeout o "comenzar ya"): el servidor elige una arena (§8), crea una room de arena NUEVA (una por combate — `filterBy(["combateId"])`, mismo patrón de instancia por clave que ya usan `interior`/`mazmorra`, `server/src/index.ts:28-32`) y manda a CADA participante el MISMO mensaje que ya existe para cambiar de room: `client.send("portal:ir", {tipo:"combate", combateId, x, y})` — el cliente ya sabe reaccionar a esto (`client/src/game.ts:296-333`, reconecta con `client.joinOrCreate`), cero mecanismo de teleport nuevo, es el portal de siempre apuntando a un sitio distinto.
- **Placeholder en el mapa de origen**: al abrirse la arena, la room de origen NO simplemente pierde a esos jugadores/NPCs sin más — se deja un marcador (`MarcadorCombateSchema`: x, y, participantes) en un `MapSchema` nuevo de `HubState` (`combatesEnCurso`) mientras dure la pelea, visible a cualquiera que pase por ahí ("aquí hay una pelea"). Se borra al terminar el combate.
- **Vuelta al terminar**: la room de arena guarda, por participante, `{tipoOrigen, mapaId, x, y}` capturado al entrar — al acabar el combate (bando entero caído/huido) manda el `portal:ir` inverso a cada uno hacia esas coordenadas exactas, y borra su propio `CombateSchema`+marcador. Mismo patrón que ya usa `InteriorRoom.ts` para "salir por la puerta" (`tipo:"volver"`), aplicado a "volver de la arena".

**Combate SIN jugadores** (§7, ya confirmado) sigue exactamente igual — la autosimulación NUNCA instancia nada, es puramente en memoria dentro de la room donde se detecta el encuentro.

## 2bis. REVISIÓN — un único recurso de turno: PA (sustituye el AP/MP separado de §2-4)

El streamer pidió un solo pool de Puntos de Acción por turno del que salen las CUATRO acciones (mover, combate, objetos, magia) — no dos pools separados (AP para acciones, MP para mover) como fijaba §2-4 en la primera pasada. `CombateUnidad` pierde `mp`/`mpMax`, se queda con `pa`/`paMax`:

- **Mover**: cuesta `pa` por casilla (Chebyshev, 1 por paso incluida diagonal — mismo criterio que ya usa `casillasAlcanzables` en `pathfindingArena.ts`, ese cálculo no cambia, solo lo que se resta ahora es `pa` en vez de `mp`).
- **Combate** (`combate:accion`, ataque con arma equipada): cuesta un `pa` fijo por golpe (placeholder de balance, a afinar).
- **Objetos** (usar un consumible/objeto desde el turno): mismo `personaje:consumir` que ya existe (`docs/GDD_Personaje.md §4`) pero solo permitido en el turno propio dentro de un combate activo, cuesta `pa`.
- **Magia**: sin catálogo de hechizos todavía (fuera de alcance, como ya decía §6) — el hueco es el mismo "habilidad con coste en `pa`" que ya cubría una acción de combate normal, cuando exista.

## 8. Mapas de arena — bakeados por bioma/interior, uno elegido por combate

Arenas NxN pequeñas, MISMO formato de sectores que ya exporta el resto de bakeadores (compatible con `MundoColision`/`tipoEn()`, cero parser nuevo en el cliente ni servidor) — viven en `assets/mapas/arenas/<bioma>/<variante>.json` (uno más, `interior/<variante>.json`, para encuentros bajo techo). Catálogo `mazmorras/catalogo/arenas.json` (o similar, un array de ids por bioma) resuelve qué variantes existen; al cerrarse la ventana de unión el servidor elige una determinista por semilla del combate (mismo `elegirPonderado`/PRNG mulberry32 de siempre) entre las variantes del bioma/interior donde se originó la pelea. Bake tool nuevo y pequeño (reusa el generador de forma orgánica de `mazmorras/src/celular.js` para el contorno de obstáculos, sin salas ni mobiliario — una arena es solo suelo+obstáculos) — de esta pasada solo se bakean 1-2 arenas de PRUEBA (agentes solo hacen bakes pequeños, el streamer corre la producción real de "varias por bioma" cuando lo apruebe).

## 9. IA de NPC en combate — ya cubierta por el motor existente, sin cambios

El patrón pedido ("a distancia atacan cuando pueden al más cercano, cuerpo a cuerpo se acercan a combatir") es EXACTAMENTE lo que `arenaCombate.ts:simularCombateAutomatico`/`objetivoMasCercano` ya hace hoy: por cada unidad, busca el enemigo vivo más cercano y, si `enAlcance()` (que ya depende del `alcance` propio de cada unidad — 1 para melee, 4-9 para a distancia, mismos valores de `items.json`), ataca; si no, se acerca un paso con `pasoHacia`. La distinción melee/distancia no es un caso especial de la IA, es una consecuencia directa de qué `alcance` tenga la unidad — cero código nuevo aquí, el motor puro ya construido en esta misma sesión sirve tal cual para el turno de un `Enemigo`/NPC dentro de un combate interactivo, no solo para la autosimulación.

## 7. Autosimulación cuando NO hay ningún jugador implicado (✅ confirmado 2026-08-30)

Pedido explícito: "en combates de NPC contra animales o NPC vs NPC se autosimule el combate" — sin turnos interactivos, sin UI, sin arena replicada a ningún cliente (nadie la está mirando). Mismo motor de reglas que el combate interactivo (§2-3: iniciativa, AP/MP, alcance, `calcularDanio`), pero resuelto SÍNCRONO y de una sentada, dentro del mismo handler/evento que detecta el encuentro — nunca un tick propio, mismo criterio "cálculo perezoso" de todo el proyecto.

- **Cuándo aplica**: cualquier combate donde `esJugador` es `false` en TODAS las unidades de ambos bandos — NPC humanoide (guardia/bandido) vs fauna peligrosa, NPC vs NPC (guarnición de un asentamiento hostil defendiéndose), fauna vs fauna si algún día se decide (depredador cazando, hoy sigue fuera per GDD_Agentes_Moviles.md). En cuanto CUALQUIER unidad tiene `esJugador:true`, el combate es interactivo (§1-6), nunca autosimulado.
- **Motor compartido, sin Schema**: `simularCombateAutomatico(bandoA, bandoB, arena, rnd)` (`server/src/combate/arenaCombate.ts`) reutiliza literalmente las mismas funciones puras que usará el camino interactivo (`ordenarTurnos`, `resolverAtaque`, `enAlcance`, pathfinding de arena) — NO es un sistema de combate aparte, es el mismo motor sin la capa de red/turnos-esperando-input. La IA de cada unidad en modo automático es la misma "acercarse al enemigo vivo más cercano y atacar si está en alcance" que ya describe §3 para el turno de un `Enemigo`.
- **Resultado**: se itera turno a turno en memoria (tope duro de iteraciones, p.ej. 50, para no colgarse si ninguno alcanza al otro) hasta que un bando queda entero `"caido"`, y se devuelve el estado final de vida de cada unidad — quien llama (el futuro sistema que detecte el encuentro: agro de fauna salvaje, guarnición bandida atacada) decide qué hacer con el resultado (aplicar HP final, generar cadáveres vía `matarIndividuo`/`crearCadaver` ya existentes, etc.). Determinista si se inyecta `rnd` fijo — mismo criterio de testeo que el resto del proyecto (`crearPRNG`/mulberry32).
- **✅ Disparador real ya cableado (esta misma pasada)**: `HubRoom.comprobarEncuentrosAutomaticos()`, cada 5s — recorre `state.npcs` × fauna salvaje ACTIVA (solo la de sectores cerca de jugadores, nunca las miles inactivas), y si alguna especie tiene `peligroso:true` (campo nuevo en `catalogoCombateFauna.ts`, viaja tal cual desde `baker/catalogo/animales.json`) dentro de 4 casillas de un NPC, resuelve el encuentro con `simularCombateAutomatico` y aplica el resultado (vida final, o `state.npcs.delete`/`onFaunaMuerta` si alguno cae). Un encuentro por pasada — sencillo a propósito, no una simulación masiva. **Sigue sin disparador para NPC-vs-NPC** (guarnición bandida vs guarnición): no existe ninguna entidad NPC-bandido viva en red todavía (`tropas_asentamiento` sigue siendo solo filas en BD, ver GDD_Faccion_Bandidos.md §2.4) — cuando exista, se conecta al MISMO `simularCombateAutomatico`, cero motor nuevo que escribir.

## 8. Qué queda fuera TODAVÍA de esta implementación (honesto, no diseño — código real pendiente)

- **UI de verdad**: el panel actual (`panelCombate.ts`) es texto+botones, sin overlay de rejilla, sin retratos, sin iconos de habilidad, sin franja de turnos con retratos — pedido explícito del streamer de dejarlo así hasta la pasada final de UI del proyecto entero.
- **Una sola "habilidad"**: no hay árbol de habilidades ni `habilidadId` real — `combate:accion` siempre es "golpear con lo que tengas" (1 AP, alcance fijo 1 = cuerpo a cuerpo). El campo `habilidadId` del protocolo (§4) está aceptado en el mensaje pero ignorado.
- **Sin línea de visión (Bresenham)**: el alcance es solo distancia Chebyshev, sin comprobar que no haya un obstáculo entre atacante y objetivo.
- **Sin cálculo de equipo**: `ataqueFisico`/`defensaFisica` de cada unidad salen de `Player.ataque`/`Player.defensa` (base fija, sin armas/armaduras — mismo hueco de GDD_Mecanicas.md §5.4), NO de `items.json` todavía, aunque las armas del catálogo (`daga`, `arco_largo`...) ya tienen esos stats declarados.
- **Sin `desgaste.ts` conectado**: ni `registrarUso` al arma ni `aplicarDanoArmadura` al objetivo se llaman desde `combate:accion` todavía.
- **`combate:huir` no valida "casilla de borde alcanzable"**: cualquier jugador puede huir en su turno sin comprobar posición — simplificación deliberada de esta pasada.
- **AP/MP fijos para todo el mundo** (`AP_MAX_COMBATE`/`MP_MAX_COMBATE` en `RoomExteriorBase.ts`): no varían por unidad/clase/equipo.
- **Sin recompensas** (loot/XP) al ganar un combate interactivo.
- **Probado de verdad solo en HubRoom** (`client/test/combate.e2e.mjs`, mapa demo, jugador vs fauna salvaje) — el mismo código de `RoomExteriorBase` corre en `RegionRoom`/`InteriorRoom`/`DungeonRoom` (jugador vs `Enemigo` de mazmorra, co-op multi-jugador contra el mismo objetivo) pero esos caminos NO tienen un e2e propio todavía, solo revisión de código.
