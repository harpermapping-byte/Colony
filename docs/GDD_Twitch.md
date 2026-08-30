# GDD — Integración con Twitch (chat, roles, eventos de puntos de canal, login)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30) — solo la parte que no necesita autorización del streamer, más login de JUGADOR con Twitch (§7, mismo día).** Piezas: `server/src/twitch/` (tipos.ts, titulos.ts, catalogoEventos.ts, registro.ts, gestorTwitch.ts, chatBot.ts, estadoDirecto.ts, oauthLogin.ts, rutasOauth.ts), `server/src/rooms/base/RoomExteriorBase.ts` (implementa `RoomConectable`: comandos de chat, eventos de mundo, título social, login), `server/src/rooms/schema/HubState.ts` (`Player.tituloTwitch`, `HubState.oscuridadAbsoluta`), `server/src/index.ts` (bootstrap del bot de chat + detección de directo + rutas HTTP de login, una vez por proceso), `client/src/game.ts` (enlace "Conectar con Twitch", `twitchSession` persistido en `sessionStorage` a través de portales). Probado: `server/test/titulosTwitch.test.ts`, `catalogoEventosTwitch.test.ts`, `registroTwitch.test.ts`, `gestorTwitch.test.ts`, `oauthLoginTwitch.test.ts` (36 tests, puros — sin BD real, sin llamar a Twitch de verdad), suite completa de servidor 418/418, `tsc --noEmit` limpio en `server/` y `client/`, y los tres E2E (`combate.e2e.mjs`, `twitch.e2e.mjs`, `multijugador.e2e.mjs`) contra servidores Colyseus reales.

**Revisión multi-jugador (2026-08-30, pedido "testea varios players etc"):** `client/test/multijugador.e2e.mjs` (nuevo — el primer E2E del proyecto con DOS clientes reales a la vez) encontró y confirmó dos bugs reales, ambos corregidos en la misma pasada:
1. **`registro.ts:quitarJugador` borraba el registro de OTRO jugador con nombres duplicados** — identidad v1 no impide que dos jugadores usen el mismo nombre (`docs/GDD_Construccion.md`); si A y B entraban con el mismo nombre y A se desconectaba, el `onLeave` de A borraba el registro compartido y B (que seguía jugando) dejaba de recibir comandos de chat/títulos hasta reconectar. Fix: `quitarJugador(nombre, sessionId)` ahora solo borra si el registro actual sigue siendo el de ESA sesión. Verificado reintroduciendo el bug a propósito y confirmando que `multijugador.e2e.mjs` lo detecta (falla sin el fix, pasa con él).
2. **El Corralito y Mercado en oferta se pisaban si estaban activos a la vez** (pools distintos, cooldowns independientes — SÍ pueden coincidir): un único campo `modificadorPrecioEventoTwitch` asignado directamente hacía que terminar el que empezó primero borrara el efecto del segundo, que debía seguir activo. Fix: dos flags independientes (`eventoCorralitoActivo`/`eventoMercadoOfertaActivo`), el modificador final siempre se DERIVA de los dos, nunca se asigna suelto.
3. **Una room creada A MEDIO evento de mundo no se enteraba** (un jugador viaja a una aldea nueva mientras "Hay que trabajar"/"El Corralito"/etc. siguen activos — la room nueva no existía en el instante del canje, así que `aplicarEvento` nunca la tocaba). Fix: `gestorTwitch` guarda qué eventos de mundo están activos (`eventosMundoActivos`) y `aplicarEventosActivosA(room)` los aplica a cualquier room que se registre después — llamado desde `RoomExteriorBase.iniciarMovimiento()` justo tras `registrarRoom`.

Los tres bugs comparten la misma raíz: estado GLOBAL (registro de jugadores, modificadores de mundo) tocado por eventos que pueden llegar en cualquier orden o solaparse — el tipo de fallo que un único cliente/un único evento a la vez nunca habría sacado a la luz.

Pedido del streamer (2026-08-30, en varias pasadas de la misma conversación): integración con el chat de Twitch — comandos (`!curar`/`!comer`/`!beber`/`!cagar`), roles/títulos por seguidor/sub/mod, y eventos de "puntos de canal" (buenos/malos, aleatorios, con cooldown), todo activo SOLO cuando el streamer está en directo, y sin depender de datos privados suyos salvo donde la propia API de Twitch lo exige.

## 0. Qué necesita autorización tuya y qué no (decidido en la conversación de diseño)

Tres piezas, tres niveles de acceso distintos — **esta pasada construye las dos primeras enteras, la tercera queda con el mecanismo listo pero SIN conector real** (necesita que tú autorices una vez, ver §5):

1. **Saber si estás en directo** — información PÚBLICA de Twitch, cero dato tuyo. `estadoDirecto.ts` usa un token de APLICACIÓN (client credentials, `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` del proyecto) contra `GET /helix/streams`. ✅ implementado.
2. **Leer el chat y sus roles** (mod/VIP/sub) — con una cuenta de BOT aparte, nunca la tuya; los roles llegan gratis en los "badges" de cada mensaje de IRC, sin scope adicional. `chatBot.ts` (tmi.js). ✅ implementado.
3. **Bits, canjes de puntos de canal, tier real de sub, seguidor** — información PRIVADA de tu canal, la API de Twitch solo la da si TÚ autorizas un token con esos scopes. ⏳ pendiente — el mecanismo que reacciona a un canje YA existe y está probado (`gestorTwitch.intentarCanje`), pero hoy solo lo dispara `twitch:simularCanje` (jarl-only, para poder probarlo). Cuando quieras activarlo de verdad hace falta: autorizar una vez (flujo OAuth, un link que abres y aceptas — igual que conectar cualquier bot/overlay a tu canal) y montar el listener de EventSub (WebSocket, no necesita servidor público) que traduzca "canje real" → `gestorTwitch.intentarCanje(tipo)`. Mismo criterio "mecanismo listo, disparador pendiente" que el resto del proyecto.

## 1. Comandos de chat (`!curar` `!comer` `!beber` `!cagar`)

Solo si `estaEnDirecto()` (Modo Live) y el nombre de quien escribe en el chat coincide con un jugador conectado AHORA MISMO. Dos formas de "coincidir" (§7 añade la primera, mismo día):
- **Con login de Twitch** (recomendado): el jugador se conectó con su cuenta real (`Conectar con Twitch` en el cliente) — el chat lo reconoce por su LOGIN de Twitch de verdad, sin importar cómo se llame su PJ.
- **Sin login**: identidad v1 sigue siendo "nombre libre" (`docs/GDD_Construccion.md`) — el enlace chat↔partida es "el nombre del PJ coincide con quien escribe", sin passphrase ni handshake. Limitación conocida y documentada, no un descuido — sigue siendo el comportamiento por defecto para quien no inicia sesión.

| Comando | Efecto |
|---|---|
| `!curar` | `player.vida = player.vidaMax` — evento explícito, respeta "nadie se cura solo con el tiempo". |
| `!comer` | Llena `vitales.comida` al máximo (`restaurarVital`, mismo mecanismo que `racion_viaje`). |
| `!beber` | Llena `vitales.bebida` al máximo. |
| `!cagar` | Vacía `vitales.caca` a 0 — mismo efecto que usar una hoja de verdad (`docs/GDD_Personaje.md §3.6`), pero sin gastar inventario ni limpiar `sucio` (eso solo se quita lavándose en agua). |

Un comando/nombre desconocido es un no-op silencioso — un chat de Twitch tiene demasiado ruido para responder a cada intento fallido.

## 2. Roles y títulos sociales (`docs/GDD_Mecanicas.md §5.11`)

Puramente cosméticos, "nunca ventaja de poder" — se refrescan en CADA mensaje de chat (sin caché que pueda quedar desfasada):

| Rol | Título sobre el PJ |
|---|---|
| Jarl/admin (`JARL_NOMBRES`) | El nombre literal del streamer (`TWITCH_CANAL`) |
| Moderador | "Arguiñano" |
| Sub (cualquier tier) | "Cortesano" |
| Seguidor | "Condellano" — **pendiente**: el tier exacto de sub y el estado de seguidor no llegan por chat, necesitan Helix (§0.3); hasta entonces ningún jugador verá este título salvo que se cablee a mano. |
| Ninguno de los anteriores | Sin título (cadena vacía, pedido literal) |

Jerarquía si cumple varias a la vez: jarl > moderador > sub > seguidor (el más alto gana, no se acumulan). **Nota de alcance marcada al streamer**: "sub tier 2/3" no tiene título propio distinto de tier 1 en esta pasada — toda entrada de tier vive en `TITULOS` (`titulos.ts`), añadir una diferenciación es una línea más si se pide.

## 3. Eventos de puntos de canal — 9 acordados, dos pools con cooldown separado

Catálogo cerrado en `twitch/catalogoEventos.ts`. Cada canje (`intentarCanje("bueno"|"malo")`) elige UNO al azar de su pool y lo aplica — 5 min de cooldown POR POOL, bueno y malo nunca se bloquean entre sí (pedido literal).

**Malos:**

| Evento | Duración | Efecto |
|---|---|---|
| Tormenta de rayos | 5 min | ~1 impacto cada ~33s por jugador EXTERIOR (`!esInterior`), 25 de daño directo. En interior, a salvo. |
| Eclipse | 2 min | `state.oscuridadAbsoluta = true` — el cliente pinta oscuridad casi total, cerca de una fuente de luz se ve tenue (pendiente de cliente, ver §6). |
| Plaga de ratas | 2 min | ~10 ratas por jugador conectado, repartidas a lo largo del evento (también en interior) — vida/ataque mínimos ("molestan, no matan"), reusa el Schema `Fauna` (mismo render que fauna doméstica/mascotas), desaparecen todas al terminar el evento, se hayan cazado o no. |
| El Corralito | 5 min | Hambruna + crisis de mercado fusionadas (pedido literal): sube el precio de compra en tenderetes un 30% (mismo parámetro `descuento` de `comprarDeTenderete`, ahora también admite negativos). |
| Terremoto | 1 min | ~1 golpe cada ~25s por jugador, 12 de daño — a diferencia del rayo, SÍ afecta a interiores (un temblor no distingue techo). |

**Buenos:**

| Evento | Duración | Efecto |
|---|---|---|
| Lluvia de dinero | instantáneo | +10 Farycoins a TODOS los jugadores conectados ahora mismo (cualquier room). |
| Hay que trabajar | 5 min | x2 materiales Y x2 XP de atributo al recolectar/talar/minar (`manejarCoger`). |
| Mercado en oferta | 5 min | -20% en el precio de compra de tenderetes (mismo mecanismo que El Corralito, signo contrario). |
| Bendición de gremio | instantáneo | +50 Farycoins al banco de CADA gremio activo. |

Todos los números son placeholder de balance — mismo criterio "número de referencia, no decisión cerrada" que el resto del proyecto.

## 4. Arquitectura (por qué está montado así)

- **`twitch/registro.ts`** — un registro GLOBAL (una instancia por proceso) de qué jugador está en qué room con qué `sessionId`, y qué rooms están activas ahora mismo. Hacía falta porque un comando de chat o un canje son eventos GLOBALES (cualquier jugador, cualquier room) y cada Room de Colyseus solo conoce su propio `state.players` — sin esto, `gestorTwitch` no podría encontrar a nadie. Tipado contra la interfaz mínima `RoomConectable` (no `RoomExteriorBase` directamente) para poder testear sin levantar Colyseus.
- **`twitch/gestorTwitch.ts`** — el ÚNICO sitio que sabe "qué pasa cuando llega un comando o se canjea un punto de canal" (mismo patrón singleton que `obtenerContextoGremios`/el tick de economía en `index.ts`). Ni las Rooms ni `chatBot.ts` conocen esta lógica — solo llaman a sus métodos.
- **`RoomExteriorBase` implementa `RoomConectable`** — así CUALQUIER room (Hub/Region/Interior/Dungeon/Arena, todas heredan de esta base) reacciona a Twitch sin código propio. Se registra en `iniciarMovimiento()` y se da de baja en `onDispose()` (hook nuevo de Colyseus, antes sin usar en este proyecto).
- **Disparadores de prueba jarl-only** (`twitch:simularCanje`, `twitch:simularComando`, `twitch:forzarDirecto`) — llaman a las MISMAS funciones que el conector real, mismo criterio "mecanismo listo, disparador pendiente" ya usado en combate/mascotas. Permiten probar TODO el mecanismo end-to-end sin credenciales de Twitch.
- **Sin detección de directo configurada, `enDirecto` se asume `true`** (con aviso por consola) — para no bloquear pruebas en dev; en producción con `TWITCH_CLIENT_ID`/`SECRET` puestos, `estadoDirecto.ts` lo pone a su valor real cada 2 min (sondeo, no webhook — evita exponer un receptor público solo para esto).

## 5. Variables de entorno (para activar el conector real)

```
TWITCH_BOT_USERNAME   — cuenta de BOT (nunca la tuya), genera su token en twitchtokengenerator.com (scope chat:read)
TWITCH_BOT_TOKEN      — token OAuth de esa cuenta de bot (oauth:xxxxx)
TWITCH_CANAL          — tu nombre de usuario de Twitch (canal a escuchar/consultar)
TWITCH_CLIENT_ID      — Client ID de la app de Twitch (developer console, gratis, no necesita revisión)
TWITCH_CLIENT_SECRET  — Client Secret de esa misma app
TWITCH_REDIRECT_URI   — URL pública de /auth/twitch/callback (§7) — debe coincidir EXACTO con lo registrado en la app de Twitch
CLIENT_URL            — a dónde rebota el servidor tras el login (la URL del cliente, p.ej. https://tu-juego.vercel.app)
```

Con `TWITCH_BOT_USERNAME`/`TWITCH_BOT_TOKEN`/`TWITCH_CANAL` puestos: chat real, comandos y roles funcionan de punta a punta. Con `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` además: Modo Live deja de asumirse siempre activo, se sondea de verdad. Con `TWITCH_REDIRECT_URI`/`CLIENT_URL` además: el login de jugador (§7) queda activo. Ninguna de estas requiere tocar tu cuenta personal de Twitch como streamer — la de bits/canjes/seguidor sí (§0.3, pendiente); el login de §7 es cada JUGADOR autorizando la SUYA propia.

## 6. Fuera de alcance de esta pasada (pendiente, se afina después)

- **EventSub real de bits/canjes de puntos de canal/seguidor** — necesita que autorices un token de TU canal (flujo OAuth, una vez) y un listener de EventSub por WebSocket. El mapeo `reward_id → tipo` es una entrada de catálogo más cuando llegue.
- **Cliente sin render de "Eclipse"** — `state.oscuridadAbsoluta` ya está replicado, pero `client/src` todavía no lo lee para forzar oscuridad casi total ni para atenuar cerca de una fuente de luz — trabajo de render pendiente.
- **"Plaga de ratas" sin combate verificado** — las ratas usan el mismo Schema `Fauna` que la fauna doméstica y aparecen atacables por el mismo camino genérico que ya usa el cliente (`objetivoHostilMasCercano`), pero no se verificó si el combate instanciado en arena las acepta como objetivo válido de punta a punta — si no funcionara, siguen cumpliendo su función de incordio ambiental (desaparecen solas a los 2 min).
- **Tier real de sub (1/2/3) y estado de seguidor** — no llegan por chat de forma fiable (§0.3), el catálogo de títulos ya tiene el hueco (`titulos.ts`) para cuando se cablee Helix.
- **Login de jugador (§7) sigue siendo OPCIONAL** — sin él, el enlace chat↔partida cae a "mismo nombre" (identidad v1, `docs/GDD_Construccion.md`), como antes.

## 7. Login de JUGADOR con Twitch (opcional, solo para el chat — pedido 2026-08-30)

Pedido literal: *"el tema es no podemos hacer que el jugador se conecte con su cuenta twitch (nombre) aunque luego su pj tenga otro?"* — sí, y con alcance DELIBERADAMENTE PEQUEÑO (decidido explícitamente con el streamer): esto identifica al jugador de cara al chat/títulos de Twitch, **nada más** — el nombre del PJ sigue siendo libre e independiente, y el resto del juego (gremios, propiedades, mascotas, economía) sigue funcionando por nombre de PJ exactamente igual que hasta ahora. La identidad REAL en toda la BD (sustituir `nombre` como clave en `jugadores`) es "login real", ya anotado como una de las últimas piezas del proyecto (`docs/GDD_Construccion.md`) — un cambio mucho más grande, descartado a propósito para esta pasada.

**Flujo** (Authorization Code de OAuth2, cada jugador autoriza SU PROPIA cuenta):
1. El cliente muestra un enlace "Conectar con Twitch" → `GET /auth/twitch/login` en el servidor.
2. El servidor redirige a Twitch con un `state` de un solo uso (CSRF).
3. El jugador acepta en Twitch → Twitch llama a `GET /auth/twitch/callback?code=...&state=...`.
4. El servidor intercambia el `code` por un token de USUARIO, pide su identidad real (`id`+`login`) a Helix `/users`, y la guarda tras un token de sesión propio (`oauthLogin.ts:crearSesionTwitch`) — nunca expone el token de Twitch al cliente.
5. Redirige al cliente (`CLIENT_URL`) con `?twitchSession=<token>&twitchLogin=<login>`. El cliente guarda el token en `sessionStorage` (sobrevive a `navegarA`, que recarga la página con otros query params al cruzar un portal) y lo manda en **cada** `joinOrCreate` — cruzar un portal/entrar a una mazmorra/arena es una conexión de Colyseus nueva, con su propio `crearJugador`.
6. `RoomExteriorBase.crearJugador` resuelve el token (`resolverSesionTwitch`, NO se borra al leer — dura 6h, se renueva en cada resolución) y registra al jugador en `twitch/registro.ts` bajo su LOGIN de Twitch real en vez de su nombre de PJ.

**Por qué esto arregla el bug de nombres duplicados de raíz**: antes del login, `registro.ts` solo podía usar el nombre del PJ como clave — con dos PJ del mismo nombre, uno "ganaba" el registro y el chat del otro se perdía (bug real encontrado y parcheado en la revisión multi-jugador, ver arriba). Con login, la clave es el login de Twitch, que es único de verdad — el parche por `sessionId` (arriba) sigue protegiendo a quien NO hace login.

Sin `TWITCH_REDIRECT_URI`/`CLIENT_URL` configurados, `/auth/twitch/login` responde `503` y todo sigue funcionando exactamente igual que sin esta pasada (identidad por nombre de PJ, como siempre).

Verificación: `server/test/oauthLoginTwitch.test.ts` (6, puros — genera/valida `state`, crea/resuelve sesión, credenciales incompletas) + `server/test/registroTwitch.test.ts` (+3, prioridad de `twitchLogin` sobre nombre de PJ) + `twitch.e2e.mjs` (+2: `/auth/twitch/login` sin credenciales responde 503, un `twitchSession` inventado no rompe el join). El intercambio real `code → identidad` (`intercambiarCodigoPorIdentidad`) necesita credenciales de Twitch de verdad — sin cubrir por test automático, mismo criterio que el resto de piezas que hablan con la API real de Twitch en este documento.
