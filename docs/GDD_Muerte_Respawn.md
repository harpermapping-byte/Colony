# GDD — Muerte y respawn de jugador

**ACTUALIZACIÓN 2026-09-01**: identidad visual real del cadáver (jugador/npc/animal, pose "caído" del rig en vez de caja genérica) — ver §6.

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/personaje/respawn.ts` (nuevo, `resolverRespawn`), `server/src/rooms/base/RoomExteriorBase.ts` (`manejarMuerteJugador`/`procesarMuerteJugador`/`roomYPosicionParaDrop`, disparadores en `finalizarMuerte`/inanición/eventos ambientales), `server/src/rooms/ArenaCombateRoom.ts` (`roomYPosicionParaDrop` propio + no reenviar `volverDeCombate` a un caído), `server/src/inventario/desgaste.ts` (`aplicarPenalizacionMuerte`, ya existía pura y sin consumidor), `client/src/game.ts` (reenvía `entradaX/Y` en `portal:ir` tipo región). Probado: `server/test/respawn.test.ts` (5 tests nuevos), suite completa 453/453, `tsc --noEmit` limpio en `server/` y `client/`.

Pedido del streamer (2026-08-30): *"al morir pasa que respawneas en la cama de tu casa o propiedad y si no en el punto de spawn inicial, pierdes un 20% de durabilidad de todo tu equipo y pierdes el inventario (se queda en el cuerpo que se queda en donde moriste)"*.

## 1. Disparadores

`manejarMuerteJugador(sessionId)` es el único punto de entrada real — se llama desde **cualquier** camino que pueda dejar `vida <= 0`:

- Combate por turnos: `finalizarMuerte` (ya existía, antes solo hacía `vida = vidaMax`).
- Inanición/clima extremo y eventos Twitch de daño ambiental (rayo/terremoto): comprobados cada tick de `actualizarMovimiento`/`aplicarDanoEventosAmbientales`.

**Guardia de idempotencia** (`jugadoresMuriendo: Set<sessionId>`): imprescindible porque la función es `async` (espera a BD para el respawn) y `vida` no se resetea hasta el final — sin el guardia, el tick de 30hz que sigue viendo `vida<=0` durante la ventana async volvería a disparar todo el proceso (drop duplicado, respawn duplicado...) decenas de veces por segundo.

## 2. Qué pasa al morir (`procesarMuerteJugador`)

1. El contenedor `cuerpo` se separa en dos grupos según `tipo` del catálogo (`items/catalogo/items.json`): **"equipo"** (`herramienta`/`equipable`/`arma`) vs. **el resto**.
2. **Equipo**: `aplicarPenalizacionMuerte` (ya pura y testeada en `desgaste.ts`) le resta un 20% flat de durabilidad a cada pieza — se queda en el inventario del jugador.
3. **El resto**: cae al suelo como objetos sueltos normales (`ObjetoMundoSchema`, el MISMO mecanismo que "soltar" — recogible por cualquiera, él mismo incluido si vuelve a por ello). Esto NO pasa por el cadáver (§6) — son dos cosas separadas: el cadáver es un marcador visual/looteable en el sitio de la muerte (contenedor propio, vacío para jugador hoy — "ya veremos qué sale ahí" sigue sin decidir, docs/GDD_Caza.md), mientras que el inventario perdido de verdad cae disperso como objetos sueltos normales.
4. **Cadáver** (§6, pedido 2026-09-01): se publica un `Cadaver`/`CadaverSchema` (`tipoOrigen:"jugador"`) en la posición de la muerte, con la apariencia (equipo puesto) congelada en `datosVisual` — antes de esta fecha la muerte de un jugador NO dejaba cadáver, a diferencia de animal/npc.
5. Vida se repone a `vidaMax` y se resuelve el respawn (§3) antes de reenviar `portal:ir` al cliente muerto.

## 3. Dónde resucita (`personaje/respawn.ts::resolverRespawn`)

Busca, entre las **construcciones del propio jugador** (`bd.cargarPropiedades` + `bd.listarConstrucciones`, mismo par que ya usa el sistema de construcción del §GDD_Construccion.md), la primera con `catalogo[objeto].esCama === true` en una propiedad cuyo `dueno` coincide (insensible a mayúsculas). Si la encuentra, respawnea justo en esa casilla (`{tipo:"region", mapaId, x, y}`); si no —sin propiedad, sin cama construida, o la propiedad es de otro— cae al **Hub** (`{tipo:"hub"}`), el punto de spawn inicial.

Fuera de alcance explícito de esta v1 (documentado, no un olvido): una cama dentro de un inmueble COMPRADO pero sin decorar (sin construcción de jugador colocada) no cuenta — solo camas realmente construidas vía el sistema de parcelas.

## 4. Dónde caen los objetos (`roomYPosicionParaDrop`)

Por defecto, la posición real del propio jugador en SU room (Hub/Región/Interior: las coordenadas ya son las del mundo). `ArenaCombateRoom` lo sobreescribe porque sus coordenadas son internas a la instancia de combate: resuelve la room de ORIGEN vía `matchMaker.getLocalRoomById` (mismo mecanismo ya usado por `onCombateResuelto`) y usa `retorno.puertaX/puertaY` si el cliente los mandó; si no, cae en un (5,5) fijo — aproximado a propósito, sin más contexto de dónde entró el combatiente a la arena.

## 5. Decisiones a confirmar con el streamer

- ~~No existe todavía un sistema de "equipar" en vivo~~ — YA EXISTE (`equipo:equipar`/`equipo:desequipar`, docs/GDD_Equipo.md, posterior a la v1 de este documento): "equipo" en `procesarMuerteJugador` sigue aproximándose por `tipo` de ítem DENTRO de la mochila (armas/herramientas/equipables sueltos, penalizados y conservados) — eso es intencionalmente DISTINTO de lo PUESTO (`player.inventario.equipo`, lo que se ve en el rig), que ni se penaliza ni se pierde al morir hoy. `datosVisual` del cadáver (§6) sí lee lo puesto, no la mochila.
- El fallback de posición de drop en arena ((5,5) sin `retorno.puertaX/Y`) es impreciso — aceptable para v1, pendiente de mejorar si se nota en juego.

## 6. Identidad visual del cadáver (pedido 2026-09-01)

**Decisión del streamer**: *"vale creando la pose del rig esqueleto valdría, pues habrá que hacerlo con animales, npc, todos"* — el cadáver de jugador/NPC/animal debe verse como EL MISMO modelo que tenía en vida (mismo rig/ficha/equipo), tumbado, en vez de la caja genérica con 💀 que se usaba hasta ahora. Las mismas 3 categorías del `Cadaver`/`CadaverSchema` existente (`tipoOrigen: "animal"|"npc"|"jugador"`, `server/src/mundo/cadaveres.ts`) se extendieron con un campo `datosVisual` (string JSON, `DatosVisualCadaver` — "" si no hace falta ninguno) sincronizado en `CadaverSchema.datosVisual`. Los cadáveres de LOOT normales (`cadaver_*` de `items/catalogo/items.json` — carne/pescado cosechado) NO se tocan, son otra cosa.

**Rig humanoide** (`client/src/render3d/rigHumanoide.ts`): nueva pose `caido` (7º parámetro de `actualizar`, prioridad máxima sobre sentado/tumbado/tocando) — piernas/brazos/cabeza en ángulos asimétricos y desmadejados, distinta a `tumbado` (que es simétrica, para dormir en cama a propósito). `inclinarCaido(objeto, id)` vuelca el cuerpo entero de lado con una variación determinista por `id` (hash simple, NUNCA `Math.random()` — mismo cadáver, misma pose para cualquier cliente). Se aplica una única vez al construir el cadáver; un cadáver nunca vuelve a llamar `actualizar`.

**Rig de animal** (`client/src/render3d/animalVoxel.ts`): `crearAnimalVoxel(datos, {caido:true, id})` — pose específica por pivotes para las 3 plantillas pedidas (cuadrupedo: patas separadas + cabeza ladeada; ave: alas extendidas + patas encogidas; insecto: patas curvadas) más un volcado genérico de cuerpo entero (rotación 90° + reposicionado sobre el suelo vía bounding box) que vale para cualquier esqueleto — las plantillas fuera del pedido explícito (pez/serpiente/crustáceo/anfibio) solo reciben ese volcado genérico, suficiente para dejar de parecer una criatura viva de pie.

**Por `tipoOrigen`, qué guarda `datosVisual` y sus límites honestos**:

- **`jugador`**: el rig del jugador vivo no tiene morfología/color propios (`crearRigHumanoide({colorTunica:...})` fijo, game.ts) — su "apariencia" se reduce honestamente a lo que llevaba PUESTO: `equipo` (slot→itemId, espejo de `InventarioSchema.equipo`) + `equipoBlueprintRopa` (slot→id de prenda legendaria del sastre). `procesarMuerteJugador` (§2) publica el cadáver con esta foto congelada justo antes de reponer vida/resolver respawn.
- **`npc`**: 3 orígenes reales hoy, cada uno con su propio dato — jefe humanoide de mazmorra (`DungeonRoom`) y guarnición de cuartel bandido (`InteriorRoom`) guardan `{enemigoId, variante}` (la MISMA clave que usa el pool de figuras del cliente para pintar al enemigo vivo, `poolEnemigos[enemigoId][variante]` en game.ts — cadáver IDÉNTICO al enemigo en pie); patrulla bandida (`RegionRoom`) guarda `equipo` (su `Npc.equipo`, si llevaba algo puesto — hoy normalmente vacío). Los civiles reales de `poblacion/` (ficha bakeada completa, `voxPorSlot`) tienen el campo `slotId` ya soportado en el cliente, pero NADIE los mata todavía (ver límite ya documentado en otros GDD) — el camino existe para el día que ocurra, sin necesitar tocar nada más.
- **`animal`**: la fauna SALVAJE (única que muere hoy — la doméstica nunca se quita, `mundo/fauna.ts`) ya se renderiza en vivo con una caja-placeholder por ESPECIE, sin vóxel individual (`animalPlaceholder.ts` — ni siquiera la fauna salvaje activa usa el generador real por individuo hoy). `especieOrigenId` por sí solo ya reconstruye el mismo aspecto exacto que tenía viva; `datosVisual` se deja vacío a propósito.

**Servidor**: `Cadaver.datosVisual`/`CadaverSchema.datosVisual` (string JSON), persistido en BD (`cadaveres.datos_visual`, migración manual en SQLite vía `PRAGMA table_info` + `ADD COLUMN IF NOT EXISTS` en Postgres, mismo patrón ya usado por el resto de columnas añadidas después del `CREATE TABLE` original). Nuevo comando de Test Zone `admin:debug:matar {tipo, id}` (jarl/superadmin-only) — fuerza la muerte de cualquier combatiente yendo DIRECTO a `finalizarMuerte`/`manejarMuerteJugador` (el mismo camino final que ya usa el combate real, cadáver incluido) sin tener que jugar un combate entero para verificar esto en vivo.

**Verificado en vivo** (`client/test/cadaveresVisual.e2e.cjs`, Playwright + servidor real, no forma parte de la suite automática): jugador, animal (fauna salvaje del mapa demo) y NPC (jefe humanoide `liche_menor` de una mazmorra de `testzone`) muertos de verdad, con capturas confirmando el rig real tumbado en el sitio en vez de la caja — `client/test/capturas_cadaveres/*.png`.
