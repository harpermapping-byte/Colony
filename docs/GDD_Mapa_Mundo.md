# GDD — Mapa de mundo con niebla de guerra

Pedido literal del streamer (2026-08-31): *"saldrá en mapa el mapa, que es pues en la M (cambiar bind si alguna otra coincide, pues la M es mapa). Tú realmente como usuario ves tu mapa con niebla de guerra, al dar M se abre mapa de todo el mapa bakeado generado, pero claro no lo ves a no ser que vayas explorando y eso se va descubriendo alrededor tuyo en un radio el mapa. Marcándose POIs y ciudad capital y tus terrenos y propiedades en ese mapa, y que tenga permanencia claro. O sea que aunque mueras sigas teniendo eso descubierto, o si desconectas igual."*

## 0. Decisiones de arquitectura

- **Granularidad = SECTOR, no casilla** (`server/src/mundo/exploracion.ts`): el mapa principal es 3200x3200 casillas — persistir casilla a casilla por jugador sería carísimo de guardar y de pintar. Se reusa el MISMO tamaño de sector que ya usa el streaming del cliente (`tilesPorSector = tamanoSectorChunks * tamanoChunk`), así que "explorar" un sector entero (lo que YA carga el streaming al pasar cerca) es exactamente lo que revela niebla — cero concepto nuevo de tamaño, cero desajuste entre "lo que ves cargado" y "lo que queda marcado como visto".
- **Alcance: solo el Hub** (mundo persistente principal), igual que `anatomiaPorSesion`/`enfermedadesPorSesion` — ningún jugador carga anatomía/enfermedades persistidas fuera del Hub tampoco (mismo hueco ya aceptado en ese sistema); `RoomExteriorBase.tilesPorSectorExploracion` es `0` (niebla deshabilitada) en cualquier room que no sea `HubRoom`, que es la única que lo rellena en `onCreate`. Regiones/interiores no tienen "tu mapa" propio en este pedido.
- **Servidor autoritativo, revelado perezoso**: el servidor ya conoce la posición real de cada jugador cada tick (`actualizarMovimiento`) — revelar niebla ahí, comparando el sector actual contra el Set ya revelado en memoria, es gratis la inmensa mayoría de ticks (early-return si no hay sectores nuevos) y solo toca BD cuando aparece un sector genuinamente nuevo (mismo criterio "solo tocar BD en el evento discreto" que XP de Resistencia/producción). Nunca se confía en que el CLIENTE diga "he estado aquí" — cero superficie de trampa (un cliente modificado no puede revelarse el mapa entero de golpe).
- **Permanencia real**: tabla `exploracion (jugador_id, mapa_id, sectores JSON)`, cargada una vez en `HubRoom.onJoin` (best-effort, mismo criterio que vida/anatomía/enfermedades) y reescrita solo en revelados nuevos. Sobrevive a morir (nunca se toca al morir) y a desconectar (persistida en BD, no en memoria de sesión) — cumple literalmente "aunque mueras... o si desconectas igual".
- **Bug real encontrado y corregido durante la verificación visual**: pintar la niebla negra y "agujerearla" con `destination-out` DIRECTAMENTE sobre el mismo canvas que ya tenía el mapa dibujado borra también el mapa (un canvas no distingue "capa negra" de "capa de mapa" una vez pintadas — el compuesto opera sobre TODO lo ya dibujado ahí). Solución: la niebla se pinta en un `<canvas>` aparte (nunca añadido al DOM, solo buffer intermedio), y ESE canvas ya agujereado se compone encima del mapa al final con el modo normal (`source-over`), que sí respeta el alfa transparente de los agujeros. Confirmado con una captura real (servidor+cliente+Playwright): sin el fix, el área revelada salía tan negra como el resto; con el fix, se ve el terreno real bajo el punto amarillo del jugador.
- **POIs y ciudad capital: NO se marcan todavía** (hueco honesto, no un olvido) — el bakeador (`baker/`) no exporta ninguna lista de posiciones+nombres de POI a día de hoy (120 POIs se colocan directo en los sectores, sin manifest aparte); y el mapa "principal" que corre el streamer ni siquiera tiene todavía una ciudad capital horneada encima (`docs/GDD_Ciudad_Capital.md`: "no se horneó la capital final de producción... eso lo corre el streamer"). Marcar "tus terrenos y propiedades" SÍ se hizo (parcelas propias, dato ya disponible) — ver §2. Cuando exista ese dato de POIs, añadir sus marcadores es solo más entradas al mismo array de marcadores, sin tocar el mecanismo de niebla.
- **Bind M liberado**: "la M es mapa" — el toggle de montar/desmontar mascota (antes en M) se movió a **X** (libre, sin uso previo). N (poner silla) no cambia.

## 1. Servidor — revelado y persistencia

- `server/src/mundo/exploracion.ts` (módulo PURO, mismo patrón que anatomia.ts/enfermedades.ts): `sectorDePosicion`, `sectoresARevelar` (radio configurable, `RADIO_REVELADO_SECTORES = 2` — un bloque 5x5 de sectores alrededor del jugador), `nuevasClavesReveladas` (diff contra lo ya revelado). Claves de sector empaquetadas como `sy*100000+sx` (un solo número, sin necesitar el ancho del mapa para empaquetar/desempaquetar).
- `RoomExteriorBase.revelarExploracionSiHaceFalta(sessionId, x, y)` — llamada desde `actualizarMovimiento` tras cada movimiento real (cualquier modo: andando/corriendo/nadando/montado/en barco), no-op barato si no hay sectores nuevos.
- `HubRoom.onCreate`: `this.tilesPorSectorExploracion = this.mapa.tilesPorSector` (nuevo campo en `MapaCargado`, `mundo/mapaColision.ts`).
- `HubRoom.onJoin`: carga `bd.obtenerExploracion(jugador.id, mapaId)` (best-effort) y revela YA el punto de aparición (sin esto, un jugador que no se mueva nunca vería nada bajo sus propios pies).
- `bd.ts`: tabla `exploracion` (SQLite + Postgres), `obtenerExploracion`/`guardarExploracion` — reescribe el array entero en cada revelado nuevo (los revelados son infrecuentes, no vale la pena una fila por sector).
- Protocolo: `mapa:consultarExploracion` (cliente → servidor, al abrir el mapa) → `mapa:exploracion { sectores, tilesPorSector }` (servidor → cliente, snapshot bajo demanda — sin push continuo, el revelado en sí ya ocurre solo mientras el jugador camina, reabrir el mapa simplemente pide lo último).

## 2. Cliente — `client/src/mapa/panelMapaMundo.ts`

Overlay a pantalla completa sobre `mapa_general.png` (asset ya bakeado, mismo mecanismo de fetch estático que `indice.json`/sectores). Un `<canvas>` visible + un `<canvas>` de niebla en memoria (nunca en el DOM, ver §0 sobre el bug de compositing):

1. Dibuja el mapa base.
2. Dibuja niebla negra en su canvas aparte, agujereada donde `sectores` (de la última respuesta `mapa:exploracion`) — cada agujero es el rectángulo del sector completo, escalado de casillas a píxeles de imagen.
3. Compone la niebla sobre el mapa (`source-over`).
4. Tus propias parcelas — punto verde por parcela cuyo dueño (`ModoConstruccion.estadoParcelas()`, ya vivo en el cliente) coincide con tu nombre; centroide de sus `runs`. **No verificado visualmente** (la sesión de prueba no tenía ninguna parcela propia asignada) — el código reusa el mismo dato/iteración que ya pinta los bordes de parcela en modo construcción, riesgo bajo.
5. Tu posición en vivo — punto amarillo, actualizado cada vez que se reabre/redibuja el mapa (no hay redibujado continuo mientras está abierto; abrir/cerrar M vuelve a pedir posición fresca).

Verificado con un playtest real (servidor+cliente+Playwright, capital sin bakear en el mapa de prueba): el mapa se abre con M, sin errores de consola, y la niebla muestra el terreno real (ríos, bosques, caminos) únicamente alrededor del punto de aparición del jugador — captura conservada en la sesión.

## 3. Huecos honestos que quedan

- **Sin marcadores de POI ni de ciudad capital** — ver §0, bloqueado por falta de datos de posición que el bakeador no exporta hoy. Cuando exista, es una entrada más al array de marcadores, no un rediseño.
- **Marcadores de parcelas propias sin verificar visualmente** — código construido pero la sesión de prueba no tenía ninguna parcela propia asignada para comprobarlo con una captura real.
- **Regiones/interiores sin niebla propia** — mismo hueco ya aceptado en anatomia/enfermedades (§0), solo el Hub persiste exploración.
- **Sin botón de "resetear mi niebla"** — ni para el jugador ni para el admin; si hiciera falta un día, es una fila menos en `exploracion`.
- **Redibujado no continuo** — el mapa no se actualiza en vivo mientras está abierto (posición del jugador, nuevos sectores revelados mientras exploras con el mapa abierto) — hay que cerrar y volver a abrir para refrescar. Alcance explícito, cerrar-y-abrir es barato y el pedido no especificaba tiempo real con el mapa ya abierto.
