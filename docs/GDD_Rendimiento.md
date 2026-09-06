# GDD — Rendimiento y escalado de sala (Hub/Región)

**ESTADO: investigación cerrada (2026-09-06), sin cambio de `maxClients` todavía** — pedido streamer: "si arregla el tema wasd... si necesitamos pasar mas procesos al cliente... que propondrias para pasar de 40 a 50 o 60". Este documento recoge la investigación real (con medidas, no especulación) y dos decisiones ya aplicadas + una pendiente de que el streamer la apruebe.

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
