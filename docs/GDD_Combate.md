# GDD — Combate: rejilla táctica por turnos

**ESTADO: PROPUESTA DE DISEÑO (2026-08-29), pendiente de confirmación del streamer.** Responde al pedido explícito: un sistema de combate táctico por turnos sobre rejilla isométrica (arena 8x8/10x10, unidades diferenciadas visualmente, turnos con AP/MP, UI de combate, movimiento/alcance por rejilla), server-autoritativo en Colyseus a coste cero y renderizado en el cliente con la cámara isométrica que ya existe. Aquí solo se fija el CONTRATO — igual que Motriz/Profesiones/Crafteo, se aplica entero tras el OK.

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
