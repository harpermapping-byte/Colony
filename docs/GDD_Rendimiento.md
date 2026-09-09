# GDD — Rendimiento y escalado de sala (Hub/Región)

**ESTADO (2026-09-07): interest-management implementado de verdad (§5), `maxClients` sigue en 40 sin tocar** — pedido streamer: "si arregla el tema wasd... si necesitamos pasar mas procesos al cliente... que propondrias para pasar de 40 a 50 o 60", y más tarde "pues adelante iimplementarlo de verdad que estamos en fase final de juego y hay que cerrar cosas y optimizar a saco". Este documento recoge la investigación real (con medidas, no especulación), el diseño de interest-management y las decisiones ya aplicadas + una pendiente de que el streamer la apruebe (subir `maxClients`).

## 1. Bug real cerrado: WASD "atascado" al perder el foco

`client/src/game.ts` guardaba las teclas de movimiento en un `Set` (`teclas`) que solo se vaciaba tecla a tecla vía `keyup` — pero el navegador **no garantiza** ese evento si se cambia de pestaña/ventana con una tecla de movimiento pulsada (alt-tab, clicar en OBS, otra app captando el foco...). La tecla se quedaba "pegada" para siempre: el bucle de movimiento seguía leyendo `teclas.has("w")===true` y mandaba `input` como si se siguiera andando, o dejaba de reaccionar a soltarla de verdad al volver — el síntoma real que describió el streamer ("a veces no reconoce el WASD, va trabado").

**Arreglo**: dos listeners nuevos que vacían el Set entero —
```ts
window.addEventListener("blur", () => teclas.clear());
document.addEventListener("visibilitychange", () => { if (document.hidden) teclas.clear(); });
```
Al recuperar el foco, cualquier tecla nueva vuelve a construir el estado desde cero — sin residuo. **Verificado con un e2e Playwright real** (servidor+cliente reales, mantener W, disparar `blur` sin soltar la tecla, confirmar que la posición deja de avanzar, confirmar que una tecla nueva tras recuperar el foco mueve con normalidad). Nota de proceso: las primeras pasadas del propio test dieron falsos negativos por jitter de red/CPU del sandbox de pruebas (server+vite+chromium compitiendo por CPU en la misma máquina) — se resolvió alargando las esperas de asentamiento del test, no tocando el fix.

Esto es 100% cliente — no toca nada de lo que se investiga más abajo, es una corrección independiente.

## 2. "¿Pasar más proceso al cliente para desahogar el servidor?"

**No, no para nada que sea autoritativo** (validación de movimiento, colisión, resolución de combate, economía) — sería deshacer a propósito el diseño ya elegido (servidor autoritativo, el cliente solo manda intención vía `room.send(...)`) que es lo que evita los cheats más triviales (teletransporte, golpear sin alcance, duplicar ítems). Cambiar eso no es una optimización, es un cambio de arquitectura de seguridad — fuera de alcance sin que el streamer lo pida explícitamente.

Lo que **sí** es un margen real y ya explotado parcialmente: más interpolación/extrapolación puramente VISUAL en el cliente entre patches del servidor (el `factor = 1 - Math.exp(-12*dt)` que ya suaviza el movimiento de rigs en `game.ts`) — barato, no compromete la autoridad del servidor, y es la única categoría de "trabajo trasladable al cliente" que tiene sentido aquí.

## 3. Investigación de escalado 40→60: qué se midió de verdad

Se corrió el propio test de estrés real (`server/test/megaEstresTodasLasMecanicas.e2e.mjs`, colyseus.js puro contra un servidor real, sin bakes de producción) dos veces: un baseline a 40 sesiones (config actual) y una comparativa a 60 (`RoomExteriorBase.maxClients` y `N_VAGABUNDOS` subidos TEMPORALMENTE solo para la prueba, revertidos después — subir el tope de verdad es una decisión de producto, no solo técnica, ver §4).

### 3.1. Hallazgo real: el buffer de `@colyseus/schema` ya se quedaba corto a 40

El baseline a 40 sesiones (config previa, `Encoder.BUFFER_SIZE = 256 * 1024` fijado en una pasada anterior) disparó **91 avisos** de `buffer overflow` durante la prueba, pidiendo hasta **384 KB** en los picos de estado (combate multi-participante, trabajador+tenderete a la vez). Es decir: el ajuste de 256KB que ya existía en el repo **ya era insuficiente hoy, con 40 sesiones**, antes de tocar nada del tope.

Leyendo `node_modules/@colyseus/schema/lib/encoder/Encoder.js`: al detectar overflow el encoder se redimensiona y reencodifica solo (no tira el proceso, no pierde datos) — es un coste de RENDIMIENTO (ese reencodeo completo de más, 91 veces en la prueba) que un buffer bien dimensionado evita.

**Arreglado**: `server/src/index.ts` sube `Encoder.BUFFER_SIZE` de 256KB a **768KB** — margen real de 2x sobre el pico más alto observado (384KB). Repetido el mismo test a 60 sesiones CON este ajuste aplicado: **0 avisos de overflow** en toda la prueba. Este cambio ya está commiteado y no necesita ninguna decisión de producto — es puro ajuste técnico sin efecto visible para el jugador.

### 3.2. Confirmado leyendo el código: la colisión PJ-PJ NO es el cuello de botella

`server/src/mundo/colisiones.ts:separarPJs` es O(n²) sobre `<=maxClients` cuerpos, con el propio comentario del código ya documentando "barato de sobra a 30hz". A 60 jugadores son ~1770 pares de `Math.hypot` por tick de simulación (30hz) — trivial en términos absolutos, no hace falta tocarlo para llegar a 60.

### 3.3. Hallazgo real (amplificado, no nuevo) a 60 sesiones: el límite de SQLite en dev/test

El test a 60 sesiones metió **11 errores reales** de `attempt to write a readonly database` (`ERR_SQLITE_ERROR`, código 1032) durante la FASE 8 (8 jugadores entrando/saliendo de una aldea 3 veces seguidas, ráfaga de reconexión concurrente) — el baseline a 40 sesiones tuvo **0** de estos errores en la misma fase. Ninguno de los 11 tumbó el servidor ni hizo fallar ninguna aserción del test (`RESUMEN: 17 comprobaciones, 0 fallo(s)` en ambas pasadas) — quedaron como error logeado y absorbido, no como excepción sin capturar.

Esto confirma y agrava el límite YA documentado en `server/src/datos/bd.ts` (encontrado en el mega-estrés de 2026-09-02): `node:sqlite` es SÍNCRONO y bloquea el hilo único de Node bajo ráfagas de reconexión — con 40 sesiones ya costaba varios segundos de bloqueo, con 60 empieza a devolver errores duros de "base de datos de solo lectura" bajo el mismo tipo de ráfaga. **Esto es un límite de SQLite como motor de DESARROLLO/TEST, no del código de la mecánica** — en producción el backend real es Postgres/Neon (I/O de red async, sin este cuello de botella de hilo único); `bd.ts` ya soporta ambos backends con el mismo contrato. No se ha tocado código de producción por este hallazgo: no aplica ahí.

### 3.4. Gap arquitectónico real, confirmado pero no medido como bloqueante todavía: sin interest management

Grep exhaustivo de `RoomExteriorBase.ts` confirma que NO existe ningún filtro de estado por distancia (`filterBy`/`StateView` de Colyseus, o equivalente casero): cada cliente conectado recibe HOY el patch del estado COMPLETO de la sala (todos los jugadores, NPCs, fauna, construcciones vivas...) sin importar lo lejos que estén. A 60 jugadores esto es más ancho de banda y más CPU de codificación por cliente conectado que a 40 — es el techo arquitectónico real de cara a escalar MÁS ALLÁ de 60-80 (no algo que el buffer o la colisión resuelvan), pero la prueba de 60 sesiones de esta pasada **no demostró que sea el cuello de botella límite todavía** (0 fallos, sin señales de saturación de CPU/red en el log). Implementarlo es un cambio de arquitectura no trivial (particionar el estado por proximidad, replicarlo distinto a cada cliente) — queda como candidato para cuando/si 60 no baste, no como trabajo de esta pasada.

## 4. Recomendación al streamer

1. **Ya aplicado, sin necesidad de aprobación** (ajustes puramente técnicos, sin efecto de producto): el fix de WASD (§1) y la subida del buffer del encoder a 768KB (§3.1).
2. **Pendiente de decisión del streamer**: subir `RoomExteriorBase.maxClients` de 40 a 50-60 de verdad. La evidencia de esta pasada (0 fallos funcionales a 60, con el buffer ya corregido) apoya que **técnicamente aguanta** — el único hallazgo negativo real (§3.3) es un límite de SQLite que NO aplica en producción (Postgres). Si se decide subirlo, recomendación: probarlo primero en el propio Render free (con Postgres real) antes de anunciarlo en directo, ya que esta pasada corrió en local con SQLite y no mide la latencia de red/CPU real del hosting gratuito.
3. **No se toca** (fuera de alcance sin pedido explícito): mover lógica autoritativa al cliente (§2) e interest management (§3.4) — el primero es un cambio de seguridad, el segundo es un cambio de arquitectura mayor; ninguno hace falta para llegar a 50-60.

## 5. Interest-management implementado de verdad (2026-09-07, pedido streamer: "pues adelante iimplementarlo de verdad que estamos en fase final de juego y hay que cerrar cosas y optimizar a saco")

Cierra el gap de §3.4, tras medir de verdad el coste real (pedido streamer: "mide ahoror real a ver si compensa el cambio") antes de decidir implementarlo.

### 5.1. Medición previa (justifica la decisión)

Servidor real levantado sobre `assets/mapas/testflat/` (208x128 casillas, mapa Hub fusionado con la aldea), 40 sesiones reales de `colyseus.js` conectadas, cada una auto-teleportada por `admin:debug:teleport` (vía `JARL_NOMBRES`) a una posición dispersa distinta de una rejilla 8x5, generando tráfico realista (`input` cada 300ms, 20s) mientras se instrumentaba el WebSocket crudo de cada cliente (`ws.onmessage`, `binaryType='arraybuffer'`, se cuenta `ev.data.byteLength` real, no estimado).

**Resultado medido**: ~20.9 KB/s por cliente de media, ~2.9 GB/h de tráfico total agregado del servidor con 40 sesiones dispersas activas — sin ningún recorte por distancia, cada cliente recibe posición/estado de los 40, aunque la inmensa mayoría estén a decenas o cientos de casillas sin verse nunca. A un radio de interés de 70 casillas, la ratio de vecinos realmente visibles desde una posición dispersa cae a ~1 de cada 3-4 — ahorro real, no estimado a ojo. Con esa medición se decidió que sí compensaba implementarlo.

### 5.2. Diseño

`@view()` de `@colyseus/schema` (StateView) aplicado SOLO a las 4 colecciones de mayor cardinalidad/rotación de `HubState` (`server/src/rooms/schema/HubState.ts`): `players`, `npcs`, `enemigos`, `fauna`. El resto (mascotas, compañeros, barcos, carros, objetosMundo, cadáveres, animalesGranja, combates, comercios, mesas de ajedrez, blueprints de ropa...) se deja SIN tagear a propósito — su cardinalidad/tamaño es mucho menor y no justificaba el riesgo/coste de tocarlas en esta pasada.

**Restricción real descubierta leyendo el código de `@colyseus/schema`** (`Schema.ts`, `static [$filter]`): un campo con `@view()` se filtra a CERO para cualquier cliente cuyo `client.view` sea `undefined` — no es "sin recorte", es "vacío". Como `HubState` es la MISMA clase de schema que comparten las 5 room types (`HubRoom`/`RegionRoom`/`InteriorRoom`/`DungeonRoom`/`ArenaCombateRoom`, todas hacen `this.setState(new HubState())` en la base `RoomExteriorBase`), tocar el schema obliga a que TODAS asignen una `StateView` a cada cliente — si solo Hub/Region lo hubieran hecho, Interior/Dungeon/Arena se habrían quedado sin ver jugadores/NPCs/fauna/enemigos de la nada.

**Implementación** (`RoomExteriorBase.ts`):
- `client.view = new StateView();` se asigna en `crearJugador()` — el ÚNICO punto de entrada compartido por las 4 room types (`HubRoom`/`RegionRoom`/`InteriorRoom`(+`DungeonRoom`)/`ArenaCombateRoom` lo llaman todas), así que ninguna se puede quedar sin asignarla.
- `protected actualizarVistaDeInteres(radioTiles: number | null)`: por cada cliente conectado con `Player` propio ya creado, evalúa las 4 colecciones — `radioTiles === null` (Interior/Dungeon/Arena: mapas pequeños y acotados) marca TODO visible siempre, comportamiento IDÉNTICO al de antes de este cambio; un `radioTiles` numérico (Hub/Region: mapas grandes) aplica distancia al cuadrado con histéresis de salida (`RADIO_INTERES_SALIDA_TILES = RADIO_INTERES_TILES + 15`, mismo patrón de doble-radio que ya usa `client/src/mapa/streamingSectores.ts` para el streaming de sectores de terreno — evita ADD/REMOVE en bucle a quien ronda justo el borde). Uno mismo (`id === client.sessionId`) siempre visible.
- Llamado desde 2 sitios por room type: una vez en `onJoin` (justo tras `crearJugador`, para que el cliente no se quede viendo estas 4 colecciones vacías hasta el primer tick periódico) y en un `setInterval` de `onCreate` — 500ms con `RADIO_INTERES_TILES` (70) en `HubRoom`/`RegionRoom`, 2000ms con `null` en `InteriorRoom` (cubre `DungeonRoom`, que llama a `super.onCreate`) y `ArenaCombateRoom`.
- Limpieza: `vistaActualPorSesion` (el `Map<sessionId, Set<clave>>` que trackea qué ve cada uno para poder decidir ADD/REMOVE incremental y aplicar la histéresis) se borra en `onLeave` — el propio `StateView` desaparece con la sesión, no hace falta revertir nada en él.

**Puramente de replicación**: la simulación del servidor (agro, colisión, combate, chat, economía...) sigue leyendo `this.state.*` completo en todos los sitios, sin cambio — un jugador fuera del radio de interés de otro sigue existiendo de verdad para el servidor, solo deja de viajar por la red hacia ESE cliente concreto.

### 5.3. Verificación

- `tsc --noEmit` limpio en cliente y servidor.
- Servidor 1240/1240 (dos ejecuciones seguidas en verde; una ejecución previa dio 1239/1240 con un fallo no relacionado con este cambio — no reprodujo en la repetición inmediata, flake preexistente).
- Auditado `client/src/` (único consumidor real de estas 4 colecciones en el cliente): `game.ts` ya reacciona a `players`/`npcs`/`fauna`/`enemigos` con `onAdd`/`onRemove` reactivos de `@colyseus/schema` — el patrón correcto y ya compatible con interest-management sin cambio alguno (un ADD/REMOVE de StateView dispara los mismos callbacks que una entidad apareciendo/desapareciendo del mundo de verdad). No se encontró ningún código de cliente que asuma poder ver TODOS los jugadores/NPCs/fauna/enemigos de la sala sin importar la distancia (minimapa, lista de jugadores, chat — ninguno itera esas colecciones directamente fuera de `game.ts`).
- Sin e2e nuevo dedicado a interest-management en esta pasada (verificar tráfico reducido de verdad requeriría repetir el harness de medición de §5.1 con el cambio aplicado) — la garantía de "cero regresión" se apoya en: comportamiento IDÉNTICO demostrado por diseño para Interior/Dungeon/Arena (`radioTiles=null`), suite completa de servidor en verde (incluidos los E2E de combate/mazmorra/streaming existentes, que si algo se hubiera roto en la visibilidad de jugadores dentro de una arena/mazmorra habrían fallado), y la revisión manual de `game.ts` arriba. Pendiente real, no bloqueante: una repetición del harness de medición para confirmar el ahorro de ancho de banda en la práctica, y una sesión visual en Hub/Región con dos clientes reales separados por más de `RADIO_INTERES_TILES` confirmando que cada uno deja de ver al otro y vuelve a verlo al acercarse.

## 6. Playtest real de lag en navegador contra el mapa principal (2026-09-09, madrugada, pedido streamer: "necesito que hagas pruebas jugando desde navegadores, para ver el lag, optimizar todo lo posible... busca la forma de jugar BIEN y que esté OPTIMIZADO... haz de betatester y developer a la vez")

Primera vez que se pone un cliente real (servidor+Vite+Playwright, `client/test/streamingLagPlaytest.e2e.mjs`, nuevo) a saltar por `assets/mapas/principal` de verdad, en vez de razonar sobre el código o medir con un benchmark aislado. Metodología: `admin:debug:teleport` (jarl real vía `JARL_NOMBRES` env) para forzar materializaciones de sectores muy separados sin esperar a andar físicamente miles de casillas, con instrumentación real de página (waterfall de red por `sector_XXX_YYY.json`, CDP `Performance.getMetrics`/`Profiler` para heap y CPU, un rAF propio para frame timing).

### 6.1. Hallazgo crítico de entorno: este sandbox NO tiene GPU real

Antes de sacar ninguna conclusión de "cuánto tarda" hay que dejar esto por escrito para que ninguna sesión futura repita la investigación desde cero: Chromium en este entorno cae a **WebGL por software** (log de consola real: *"Automatic fallback to software WebGL has been deprecated"*) — no hay aceleración de GPU disponible. Confirmado con un perfil de CPU real (CDP `Profiler.start`/`stop`, 6s de muestreo en estado ESTABLE, sin materializar nada nuevo, cerca de la capital): **~99% del tiempo cae en `(program)`** (código nativo/driver — rasterización), mientras que TODA la lógica JS del juego junta (materializar sectores, mover fauna decorativa, actualizar matrices, `updateMatrixWorld`...) suma solo unos pocos cientos de ms sobre los 6000ms muestreados. **La lógica del juego está limpia — el cuello de botella medible aquí es la rasterización por software, un artefacto de este sandbox, no del código.** Cualquier número de fps/ms-por-frame medido en este entorno es por tanto NO representativo del hardware real del streamer (una GPU de verdad renderiza exactamente el patrón que este proyecto ya usa — InstancedMesh, pocos draw calls por lote — en órdenes de magnitud menos tiempo). Confirmado independientemente que NO es un problema de red/parseo: 9 fetches de sector (0.7-1.4MB cada uno) tardan 3-15ms cada uno por `curl` directo contra el mismo Vite dev server, y `JSON.parse` del sector más grande del mapa (1.38MB) tarda 13ms — ninguno de los dos explica ningún tirón real.

### 6.2. Validado end-to-end (SÍ es válido medir en cualquier entorno, no depende de GPU)

- **Cero fetches duplicados**: en una sesión de 8 teletransportes (incluida una revisita cercana y otra lejana al mismo sector, después de que el pool de 6 lo hubiera expulsado) se pidieron 22 sectores distintos por red — los 22, exactamente una vez cada uno. La caché de JSON (`maxSectoresCacheados`) y el pool de materializados-ocultos (`maxSectoresMaterializadosCacheados=6`) funcionan tal como se diseñaron, con un cliente real conectado por WebSocket, no solo en el test unitario aislado de `streaming.test.ts`.
- **El pool de sectores materializados-cacheados taponó en 6** de verdad (nunca más), confirmado varias veces en el mismo recorrido.
- **Ningún teleport se quedó colgado**: todos asentaron (`enVuelo===0 && materializando===0`) dentro del margen de la prueba — el peor caso observado fue de varios segundos, pero eso es exactamente lo que predice §6.1 (rasterización por software de un salto artificial a 9 sectores nuevos de golpe, algo que NUNCA pasa caminando normal — cruzar una frontera solo materializa 1-3 sectores nuevos, el resto del anillo 3x3 ya estaba de prefetch).
- **Cero errores de consola/página** durante todo el recorrido.
- El diseño de radio de streaming (`RADIO_CARGA_DEFECTO=192`/`RADIO_DESCARGA_DEFECTO=352` tiles, anillo 3x3 de sectores de 320 tiles como prefetch — bastante más que "pantalla + un poco" literal) se revisó a la luz de este playtest y se dejó TAL CUAL: los fetches son baratísimos (ver §6.1) y la lógica JS de materializar también, así que el margen de prefetch no es el cuello de botella y reducirlo solo arriesgaría pop-in visible al cruzar fronteras deprisa (sprint, montura) sin resolver nada real. Ver el docstring de `streamingSectores.ts` para el razonamiento original, que este playtest confirma que sigue siendo válido.

### 6.3. Optimización real aplicada, agnóstica de hardware: menos geometría en el pase de sombra

Único hallazgo con margen real de mejora en CUALQUIER hardware (no un artefacto del sandbox): **todos los `InstancedMesh` de props proyectaban sombra sin excepción** (`sectorVisual.ts`) — vegetación, rocas y fauna decorativa son, con diferencia, las capas con más instancias de cualquier sector real (187.241 instancias de fauna decorativa en todo el mapa, miles de plantas/rocas por sector) — cada una proyectando sombra multiplica el coste real del pase de shadow map (`PCFSoftShadowMap`, mapa 2048×2048) por ese mismo volumen, para un detalle que apenas se nota en cámara isométrica sobre objetos pequeños de fondo. Cerrado: `castShadow` ahora solo se deja en lo grande/prominente (edificios `e`, decoración urbana `m` — decenas por sector, sombra que sí se nota); vegetación (`v`)/rocas (`r`)/fauna decorativa (`a`) pierden `castShadow` pero mantienen `receiveShadow` (sí se ven pisadas por la sombra de un árbol/edificio cercano, que es lo que de verdad se nota). Medido en este mismo sandbox sin GPU el margen es modesto (~10-20%, dentro del ruido — coherente con §6.1: el cuello de botella dominante aquí sigue siendo la rasterización base, no las sombras) pero es una reducción real de trabajo de GPU en cualquier hardware, sin coste visual apreciable.

### 6.4. Pendiente real, honesto: sin confirmar en hardware real todavía

Todo lo de §6.2 está verificado de punta a punta con un cliente real. Lo que NO se puede confirmar desde este sandbox (documentado a propósito, no dado por bueno sin más, mismo criterio que el resto de esta sesión): si el fix de sombras de §6.3 se nota jugando de verdad, y si el rendimiento general (con GPU real) se siente fluido explorando el mapa grande recién rehorneado. Pendiente de que el streamer lo confirme jugando — si SIGUE notando lag en su máquina real tras esto, el siguiente paso correcto es abrir las DevTools reales de su navegador (pestaña Performance, grabar unos segundos caminando) en vez de seguir investigando a ciegas desde un sandbox sin GPU.
