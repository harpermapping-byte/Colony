# GDD — Zonas PvP

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/mundo/pvp.ts` (nuevo, interruptor global), `server/src/datos/bd.ts` (tabla genérica `configuracion_mundo`), `server/src/rooms/base/RoomExteriorBase.ts` (`esZonaSeguraPropia`, gating en `manejarCombateIniciar`, mensaje `pvp:fijar`), `server/src/rooms/HubRoom.ts`/`RegionRoom.ts` (marcan su zona segura), `server/src/index.ts` (carga el último valor al arrancar), `client/src/game.ts` (`objetivoHostilMasCercano` ahora también apunta a otros jugadores). Probado: `server/test/pvp.test.ts` (5 tests nuevos), suite completa 453/453, `tsc --noEmit` limpio en `server/` y `client/`.

Pedido del streamer (2026-08-30): *"zonas pvp inicialmente todas menos la ciudad capital y alrededores de esta, pero esta opción la habilitará el jarl, inicialmente está deshabilitada pero si todo el sistema creado. El combate el mismo pero jugador contra jugador."*.

## 1. Interruptor global (`mundo/pvp.ts`)

Un único valor en memoria por proceso (`pvpGlobalHabilitado()`), respaldado en la tabla genérica `configuracion_mundo (clave, valor)` — nueva, pensada para cualquier flag global futuro de una sola clave/valor, no solo PvP. Arranca en `false` (seguro) hasta que `index.ts` lo carga UNA vez de BD al arrancar el proceso. El jarl lo cambia con el mensaje `pvp:fijar {on}` (jarl-only, `esJarlGlobal`), que persiste Y actualiza la memoria al instante, y hace `broadcast("pvp:actualizado", {on})` a todos.

## 2. Zonas seguras (`esZonaSeguraPropia`)

Campo por-room en `RoomExteriorBase` (`protected`, `false` por defecto — cualquier aldea/POI/interior/arena normal). Lo ponen a `true` explícitamente:

- **`HubRoom`** — el pueblo persistente donde vive todo el mundo, siempre a salvo.
- **`RegionRoom`** cuando `indice.tier === "capital_jarl"` — la ciudad capital y sus alrededores (el mismo campo `tier` que ya usaba el check de `asentamiento_hostil`).

La zona segura **siempre gana** al interruptor global, tenga el jarl el PvP activado o no: la condición real es `pvpGlobalHabilitado() && !esZonaSeguraPropia`.

**Confirmado por el streamer (2026-08-30): "el hub es zona segura"** — la interpretación de arriba queda cerrada, no era solo una lectura propia.

## 3. Combate PvP (`manejarCombateIniciar`)

Mismo sistema de combate táctico por turnos ya existente (`docs/GDD_Combate.md`) — sin mecánica nueva, solo un objetivo humano en vez de fauna/enemigo/NPC. El gating vive en el punto donde ya se resuelven las stats del objetivo: si `objetivoStats.esJugador` y la zona/interruptor no permiten PvP, el servidor rechaza con `combate:error` — el cliente nunca decide esto (servidor autoritativo, mismo criterio de todo el proyecto).

Cliente: `objetivoHostilMasCercano()` (tecla C) ahora también recorre `room.state.players` (excluyendo al propio) con el mismo criterio de auto-apuntado sin UI que fauna/enemigos — si el servidor rechaza, el jugador simplemente no entra en combate.

## 4. Decisiones confirmadas por el streamer (2026-08-30)

- ~~Hub tratado como zona segura~~ — **confirmado, ver §2: el Hub SÍ es zona segura, como cualquier región normal.**
- Sin límite geográfico fino ("alrededores de la ciudad capital"): la zona segura es la REGIÓN entera con `tier: "capital_jarl"`, no un radio alrededor de la muralla — sigue así, sin objeción del streamer.

## 5. PvP entre facciones (futuro, pedido 2026-08-30) — diseño confirmado, sin construir todavía

Confirmado por el streamer: *"el pvp solo será en un futuro contra otras facciones, quiero decir, cada jarl y cada mapa es una facción; cuando se genere otra, esa será otra facción en otro mapa, y con esa sí funcionará el pvp, mismo tipo de combate"*.

Lectura: el PvP dentro de UN MISMO mapa/jarl (lo que implementa este documento, §1-3) queda como está — el jarl lo activa/desactiva para SU propio mundo, Hub y capital siempre a salvo. El PvP contra otra FACCIÓN (otro jarl, en OTRO mapa exterior de producción — hoy el proyecto solo tiene `assets/mapas/principal/`, ver `docs/GDD_Barcos.md` §8 "bake de un segundo mapa exterior") reusaría el MISMO sistema de combate táctico (`docs/GDD_Combate.md`, §3 de este documento) contra jugadores de la otra facción, en vez de contra fauna/enemigo/NPC/jugador-mismo-mapa. No hay código que construir todavía — depende de que exista un segundo mapa/servidor con su propio jarl, que sigue sin bakearse (decisión del streamer, no bloqueada por diseño). Anotado aquí para no perder la decisión cuando llegue ese momento.
