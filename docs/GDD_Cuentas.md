# GDD — Cuentas de JUGADOR (login por contraseña)

**ESTADO: v2 — PANTALLA COMPLETA Y LOGIN OBLIGATORIO (2026-09-09).** v1 (panel flotante centrado, "seguir como invitado") queda descrita en la sección 5bis para referencia histórica. Piezas nuevas/tocadas en v2: `client/src/inicio/pantallaBienvenida.ts` (reescrito a pantalla completa), `client/src/main.ts` (`arrancarJuego` devuelve una Promise), `client/src/game.ts` (login de admin/Twitch ya NO se montan como paneles flotantes), `client/src/admin/panelLoginAdmin.ts` (**eliminado del repo**, sin consumidor). Probado: servidor 1303/1303 sin cambio de servidor en esta pasada (v2 es 100% cliente), `tsc --noEmit` limpio en cliente y servidor, cliente 37/37, `client/test/adminPanel.e2e.mjs` reescrito para el nuevo flujo y en verde, `client/test/chatUI.e2e.mjs` ampliado (minimizar/restaurar) y en verde, y varias sesiones de Playwright reales adicionales (login obligatorio sin botón de invitado, admin unificado con jugador sin recarga de página, Twitch en la propia pantalla y en Ajustes como fallback).

## 0bis. Pedido v2 (2026-09-09, mismo día, tras ver capturas de v1)

Mensaje textual del streamer (con erratas, preservado tal cual porque redefine el alcance): *"es que el login deberia ser para todos, no solo admin, el admin a tener su cuenta o contraseña podria hacerlo, pero deberia salir al inicio al entrar al juego por decirlo asi una pestaña entera toda la pantalla para que te loguees y/o creees cuenta y se almacene en nuestra Db con la Ip o algo asi cada vez que entres te recuerde o si no debas poner si o si el usuario, osea no puedes jugar isn poner usuario de esta manera la pantalla tapa todo y mientras va cargando el fondo el plawright mientras te logeas no? asi desaparecede ahi, el chat se iene quepoder minimizar con una teclacomo la X arriba derecha y lo de conectar twitch debe ir al crear cuenta o loguearse, y siu no lo hace se queda en ajustes loguearse con tiwtch"*.

Desglosado en decisiones tomadas (proceder directo, sin nueva ronda de preguntas — patrón ya establecido en esta sesión con este streamer, criterio de "cambio grande de diseño: proponer primero" ya cumplido en la v1 original):

1. **Login para TODOS, admin incluido, unificado en una única pantalla**: el admin ya no tiene un panel flotante aparte — su usuario/contraseña de `admin_cuentas` es una sección opcional DENTRO de la misma pantalla de bienvenida, que se AÑADE a la cuenta de jugador (obligatoria), nunca la sustituye.
2. **Pantalla completa** (antes: panel flotante centrado 300px).
3. **"Recordar" = el mecanismo YA construido** (`playerSession` en `localStorage`, TTL 30 días) — interpretado como suficiente: el streamer menciona "con la IP o algo así", pero un token de sesión ya cumple exactamente esa función (recuerda al jugador sin volver a teclear nada) de forma más fiable que una IP (compartida entre varios jugadores en la misma red, o cambiante con reconexiones de un ISP doméstico) — no se construyó nada basado en IP.
4. **Login obligatorio para jugar**: se retira "Seguir como invitado" para cualquier navegador real. El bypass de tests (`navigator.webdriver`, `?nombre=`/`?twitchSession=`/`?adminSession=`, sesión ya guardada) sigue exactamente igual — ninguno de los ~50 archivos de e2e del repo pasa por esta pantalla.
5. **"Cargando... mientras te logueas"**: la pantalla NO se retira al enviar el formulario — se queda tapando todo con un spinner "Cargando mundo..." hasta que `arrancarJuego()` (ahora devuelve una `Promise`) resuelve de verdad (conexión a Colyseus + carga de la escena 3D completa), y solo entonces desaparece. Interpretado como "carga en paralelo" en el sentido de que no hay un hueco de canvas en negro entre login y juego — NO se intentó unir a la sala ANTES de completar el login (uniría con una identidad de invitado que luego habría que descartar, más caro y más arriesgado que el problema que resuelve).
6. **Chat minimizable**: X (en realidad un botón "–"/"＋", mismo lenguaje visual redondo del resto del HUD) arriba-derecha de su propia cabecera.
7. **Twitch integrado en el login, con fallback en Ajustes**: enlace real en la pantalla de bienvenida; quien no lo use ahí lo tiene igual en el panel de Ajustes.

## 0ter. Pedido suelto en el mismo hilo: HUD de vitales

*"ah y falta arriba izquierda un icono del personaje que te creas y su vida stamina hambre sed y tal como otros juegos"* — nuevo widget PERMANENTE (`client/src/ui/hudVitales.ts`, sin X, no es un panel del framework) arriba-izquierda: icono + 4 barras (❤️ vida, ⚡ estamina, 🍗 hambre = `vitales.comida`, 💧 sed = `vitales.bebida`), releídas cada 500ms desde `room.state.players.get(room.sessionId)` — `$(player).onChange` no burbujea cambios de un sub-schema anidado como `VitalesSchema` hasta el padre, y los vitales decaen en horas reales, no en ticks, así que un intervalo barato (mismo patrón ya usado en el archivo para proximidad a bancales) es más simple que cablear un segundo `onChange` por cada jugador remoto que se crea.

### 0quater. El icono es un RETRATO 3D real, no un emoji (mismo día, pedido de seguimiento)

*"se puede hacer que la cara del pj salga arriba no un emote?"* — el emoji inicial ("🙂") se sustituye por `client/src/render3d/retratoJugador.ts`: una CÁMARA propia de Three.js (`PerspectiveCamera`) colgada como HIJO del hueso `"cabeza"` del rig del jugador local (`rigHumanoide.ts`), renderizando a un `<canvas>` de 64×64 dentro del círculo del HUD. Reusa la MISMA escena que el mundo (mismo `THREE.Scene`, misma luz, mismo ciclo día/noche, mismo equipo puesto) en vez de clonar geometría — la separación entre "lo que ve la cámara del mundo" y "lo que ve el retrato" la hacen las CAPAS de Three.js (`Object3D.layers`): el rig del jugador local se marca en la capa 1 (`layers.enable(1)`, nunca desactiva la 0 — sigue viéndose en el mundo igual que siempre) y la cámara del retrato solo mira la capa 1 (`layers.set(1)`), así que el encuadre no tiene ni rastro de terreno/otros jugadores/fauna aunque comparta escena.

Como el hueso `cabeza` cuelga con rotación identidad y la cara está en +Z LOCAL (comentario ya existente en `rigHumanoide.ts`), colocar la cámara en local `(0, altura_ojos, +offset)` la deja mirando automáticamente hacia atrás (su -Z local) directo a la cara — cero cálculo de `lookAt` por frame, la jerarquía de la escena ya lo resuelve solo, y la cámara sigue al balanceo/animación de la cabeza por ser su hijo.

**Bug real encontrado y cerrado verificando con Playwright** (screenshot real, no solo `tsc`): el retrato salía NEGRO SÓLIDO al principio — Three.js filtra TAMBIÉN las luces por capa de cámara, no solo la geometría; sin marcar el sol/ambiente de `WorldScene` en la capa 1, la cámara del retrato no tenía NINGUNA luz activa y `MeshStandardMaterial` no emite nada sin luz. Arreglado con un `scene.traverse` en el constructor de `RetratoJugador` que activa la capa 1 en cualquier `THREE.Light` ya presente en la escena (el sol/ambiente ya existen cuando se construye, `WorldScene` se crea primero). Confirmado con captura real: se ve la cara (piel + ojos) del rig, no un cuadrado negro.

Equipo puesto (casco, etc.) se re-marca en la capa 1 cada vez que `aplicarEquipoAlRig` añade una pieza nueva (`actualizarEquipoVisual`, solo para el jugador local) — sin esto, una pieza equipada DESPUÉS de crear el rig se vería en el mundo pero no en el retrato.

Icono reducido de 40px a 30px (pedido streamer: "el círculo... debería ser más pequeño de lo que es"). Verificado con Playwright real (capturas + comprobación de que el `<canvas>` existe dentro del círculo en vez del emoji).

## 0. Pedido y decisiones (2026-09-09)

Pedido del streamer, dentro de un mensaje más amplio sobre placeholders de UI: *"es medieval rpg permanente el juego con cuentas por contraseña etc"*. Planteado primero (regla CLAUDE.md "proponer primero"), decisiones confirmadas vía pregunta directa:

1. **Backend real ya** (no un placeholder visual con lógica de mentira): hash real, tabla real, migración real de personajes ya jugados.
2. Los paneles/menús nuevos (no los ya existentes con tecla) se abren **solo desde el dock de iconos**, sin tecla propia — ver `docs/GDD_UI_Paneles.md`.
3. Prioridad: **menú principal + login + creación de personaje primero**, antes que el resto de placeholders de HUD in-game.

## 1. Identidad: reusa `jugadores`, NO una tabla `cuentas` aparte

A diferencia de `admin_cuentas` (deliberadamente separada de `jugadores`, ver `docs/GDD_Admin.md` — un admin no es un personaje), una cuenta de JUGADOR **es** su personaje: 1 cuenta = 1 nombre = 1 fila de `jugadores`. No se pidió multi-personaje por cuenta, así que no se construyó (CLAUDE.md: "no diseñar para hipotéticas necesidades futuras"). Cerraba además el hueco que el propio esquema documentaba desde el principio: `jugadores.nombre` llevaba el comentario `-- identidad v1 = nombre (hasta que haya login real; documentado)`.

```
jugadores: ...(columnas ya existentes)..., password_hash TEXT  -- NULL = personaje "legado" sin reclamar
```

Migración: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en Postgres (mismo patrón que `pos_x`/`pos_y` de 2026-09-07) + comprobación `PRAGMA table_info` en SQLite para BDs de dev ya creadas — **ningún personaje ya jugado en testflat/testzone/producción pierde nada**: su fila sigue existiendo con `password_hash=NULL` hasta que alguien la reclame.

## 2. Contraseñas y sesión: MISMO patrón que admin, sin duplicar código

`server/src/auth/jugadorAuth.ts` reusa `hashPassword`/`verificarPassword` de `admin/passwordHash.ts` tal cual (son funciones puras sin nada de "admin" real) — cero código de hashing duplicado. Sesión: token opaco en memoria, igual que `adminAuth.ts`/Twitch, con una diferencia deliberada: **TTL de 30 días** (no 6h) con sliding expiration, porque se espera que una cuenta de jugador dure semanas sin volver a teclear la contraseña — y el cliente la guarda en `localStorage` (no `sessionStorage`, que es para sesiones de directo cortas).

## 3. Rutas HTTP (`server/src/auth/rutasAuthJugador.ts`)

Mismo criterio que `rutasAdmin.ts`: JSON in/out sobre el `http.Server` compartido, con CORS (mismo `CLIENT_URL`).

| Ruta | Qué hace |
|---|---|
| `POST /auth/jugador/registro` | `{nombre,password}` → `{token,nombre}`. Cubre DOS casos con el mismo endpoint: nombre nuevo (nace un personaje) o nombre "legado" sin contraseña (se reclama). Si el nombre ya tiene contraseña, error 409. |
| `POST /auth/jugador/login` | `{nombre,password}` → `{token,nombre}`. 404 con mensaje que invita a "Crear cuenta" si el nombre existe pero sigue sin reclamar; 401 genérico si la contraseña no coincide. |

Validaciones: contraseña ≥6 caracteres, nombre 1-20 (mismo límite que `player.name.slice(0,20)` en `crearJugador` — evita la sorpresa de "mi nombre no es el que registré").

## 4. Server: `crearJugador` ancla la identidad real

`RoomExteriorBase.crearJugador` gana una tercera opción `playerSession` (mismo patrón que `twitchSession`/`adminSession`). Con sesión válida, **el nombre de la CUENTA manda sobre cualquier `options.name` que mande el cliente** — cierra el hueco de seguridad real que motivó todo esto: hasta ahora cualquiera podía "ser" cualquier jugador escribiendo su nombre en `?nombre=`. Sin `playerSession` (invitado, o cualquier test/e2e existente que no lo mande), el comportamiento es EXACTAMENTE el de siempre — nombre libre, cero regresión. El servidor manda `jugador:sesionConfirmada`/`jugador:sesionInvalida` al cliente (igual que `admin:sesionConfirmada`); el cliente limpia `localStorage` ante una sesión inválida (token caducado o servidor reiniciado) para no quedarse "pensando" que sigue logueado.

## 5. Cliente v1 (histórico): panel flotante, invitado permitido

`client/src/inicio/pantallaBienvenida.ts` era un panel construido con `panelBase.ts::crearMarcoPanel` (X arriba-derecha, clic fuera cierra, Escape cierra). Cerrar por CUALQUIER vía sin loguearse equivalía a "seguir como invitado". **Sustituido por completo en v2** (sección 5bis) — se deja esta nota solo para que quede constancia del cambio de diseño, no describe el código actual.

## 5bis. Cliente v2: pantalla completa, login obligatorio, admin/Twitch unificados

`mostrarPantallaBienvenida()` ya NO usa `crearMarcoPanel` — a diferencia de TODOS los demás paneles del proyecto, esta pantalla no tiene X, no cierra con clic-fuera ni con Escape: jugar sin cuenta ya no es una opción para un navegador real (pedido explícito "no puedes jugar sin poner usuario"), así que no puede tener ningún gesto que la salte. Es un `<div>` fijo `inset:0` con `z-index:300` (por encima de dock, overlays fullscreen de mapa/resumen y cualquier panel — ver `docs/GDD_UI_Paneles.md`), con una tarjeta centrada dentro.

**`debeSaltarBienvenida()` no cambió** — sigue siendo el único punto que decide si esta pantalla se monta siquiera, y sigue cubriendo exactamente los mismos casos que en v1: `navigator.webdriver`, `?nombre=`/`?twitchSession=`/`?adminSession=`, o `playerSession` ya guardada. Toda la suite e2e (~50 archivos) sigue sin pasar nunca por esta pantalla, verificado de nuevo tras la reescritura (`chatUI.e2e.mjs`, `adminPanel.e2e.mjs` reescrito para el nuevo flujo, resto de la suite de `client/test` sin tocar).

**Admin unificado** (pedido: "el login deberia ser para todos... el admin a tener su cuenta o contraseña podria hacerlo"): sección plegable "¿Eres jarl o admin?" dentro de la misma tarjeta — campos usuario/contraseña de `admin_cuentas`, llama a `/auth/admin/login` y guarda el token en `sessionStorage` ANTES de que `iniciarJuego()` arranque (nunca hace falta `location.reload()`, a diferencia del viejo `panelLoginAdmin.ts`, que se ELIMINÓ del repo por quedarse sin consumidor). Un fallo aquí no bloquea la entrada como jugador — solo se avisa por consola. `game.ts` ya no monta ningún panel de login: solo queda un pequeño indicador de estado ("👑 Admin: conectando..." → "⭐ Superadmin: usuario") en la esquina superior-derecha, que se OCULTA en cuanto `PanelJarl` monta en esa misma esquina (bug real de superposición encontrado verificando con Playwright: la caja de estado y `PanelJarl` compartían posición, `PanelJarl` ya repite la identidad en su propia cabecera).

**Twitch integrado** (pedido: "lo de conectar twitch debe ir al crear cuenta o loguearse, y si no lo hace se queda en ajustes"): enlace real `/auth/twitch/login` dentro de la tarjeta de bienvenida (sustituye la caja suelta `cajaTwitch` que vivía en `game.ts`, ya eliminada) + la misma acción disponible como fallback en el panel de Ajustes (`docs/GDD_Ajustes.md`) para quien no lo conecte al entrar — `PanelAjustes` gana `serverUrlHttp`/`twitchYaConectando` y un método `actualizarTwitch(login)` llamado desde `room.onMessage("twitch:loginConfirmado", ...)`, cableado ahora a nivel global (antes solo dentro del bloque `if(SALA==="hub")`, así que Twitch ya se refleja en Ajustes en CUALQUIER tipo de sala, no solo el Hub).

**Pantalla de carga**: al enviar el formulario con éxito, la tarjeta cambia a un spinner "Cargando mundo..." y `mostrarPantallaBienvenida` espera (`await alContinuar()`) a que `arrancarJuego()` (`main.ts`, ahora devuelve `Promise<void>`) resuelva de verdad antes de retirar el overlay — cierra el hueco de canvas en negro que existía entre cerrar el login (instantáneo) y que apareciera el mundo (async).

**Bug real encontrado y cerrado verificando con Playwright, antes de dar esto por bueno**: `render()` reconstruye la tarjeta ENTERA en cada cambio (cambiar de pestaña, expandir la sección de admin) — sin guardar los valores tecleados en variables propias (`valorNombre`/`valorPassword`/`valorAdminUsuario`/`valorAdminPassword`, actualizadas por `oninput` y reinyectadas en cada `render()`), rellenar nombre/contraseña y LUEGO abrir "¿Eres jarl o admin?" borraba los dos primeros campos antes de poder pulsar "Entrar" — reproducido de verdad con un login de superadmin real (no hipotético), arreglado antes de verificar el resto del flujo.

## 6. Pendiente real, no cerrado en esta pasada

- Sin verificación en producción real (Neon/Render) — solo probado contra SQLite de dev.
- Sin "cambiar contraseña" ni "cerrar sesión" para JUGADOR (sí existen para admin) — nadie lo pidió todavía.
- Sin recuperación de contraseña (no hay email en el sistema).
- La sesión se pierde al reiniciar el proceso del servidor (memoria, no BD) — mismo criterio ya aceptado para admin/Twitch; si se vuelve un problema real en producción (reinicios frecuentes), la mejora sería persistir la sesión en `jugadores` o una tabla de tokens.
- "Recordar con la IP" tal cual lo pidió el streamer NO se implementó — se interpretó que el token de `localStorage` ya cumple la misma función de forma más fiable (ver sección 0bis punto 3); si de verdad quiere algo basado en IP además de esto, es una pieza nueva a definir con su propio alcance (¿qué hace con varios jugadores tras la misma IP doméstica?).
