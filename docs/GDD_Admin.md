# GDD — Cuentas de admin: jarl por mapa + superadmin

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/admin/` (passwordHash.ts, adminAuth.ts, rutasAdmin.ts, seedAdmin.ts), `server/src/datos/bd.ts` (tabla `admin_cuentas`, dual SQLite/Postgres), `server/src/construccion/construccion.ts` (`esJarlConSesionAdmin`, pura), `server/src/rooms/base/RoomExteriorBase.ts` (resolución de sesión en `crearJugador`/`onLeave`, `puedeActuarComoJarl`/`puedeActuarComoJarlEnJoin`), `server/src/rooms/RegionRoom.ts`/`InteriorRoom.ts` (sitios que antes llamaban a `esJarlGlobal` directo), `server/src/twitch/rutasOauth.ts` (el callback de Twitch también resuelve admin), `client/src/admin/` (panelLoginAdmin.ts, panelJarl.ts), `client/src/game.ts` (wiring). Probado: 39 tests nuevos puros/BD/HTTP (`passwordHash.test.ts`, `adminAuth.test.ts`, `adminCuentasBd.test.ts`, `rutasAdmin.test.ts`, `esJarlConSesionAdmin.test.ts`, `seedAdmin.test.ts`), suite completa de servidor 762/762, `tsc --noEmit` limpio en `server/` y `client/`, y dos E2E contra servidores reales: `client/test/admin.e2e.mjs` (HTTP+Colyseus, 14 comprobaciones) y `client/test/adminPanel.e2e.mjs` (visual con Playwright, formulario real + panel).

## 0. Pedido del streamer y decisiones (2026-08-30)

Pedido inicial: *"me gustaria definir que opciones/paneles nuevos y como se logea el admin jarl (inicialmente será uno pero si entran más streamers bakeo más mapas interconecto y habrá varios jarl que cada uno maneja su mapa y su capital, no otros mapas, aunque tengamos una cuenta de superadmin que sí pueda meterse en cualquiera)"*. Se discutió el diseño ANTES de tocar código (regla CLAUDE.md "cambios grandes de diseño: proponer primero"); respuesta final con luz verde:

> *"me gustaría que se pudiera loguear de admin pero sin el twitch también, osea ambas opciones, y con una contraseña que creamos ahora y ya se cambiará, de test. 1 jarl por mapa, el panel de superadmin es como el de jarl/admin pero algún comando más sí, adelante con todo."*

Requisitos confirmados, tal cual implementados:
1. **Login dual**: usuario/contraseña propios del juego, O una cuenta de Twitch ya vinculada — las dos opciones llevan a lo mismo (una `IdentidadAdmin` con rol + mapa).
2. **Contraseñas de test creadas por el propio sistema ahora**, con el mecanismo para cambiarlas ya construido (`POST /auth/admin/cambiar-password`) — ver `seedAdmin.ts`.
3. **1 jarl por mapa** — aplicado en BD (`asignarJarlDeMapa`) y en la autorización en vivo (`esJarlConSesionAdmin`).
4. **Panel de superadmin = panel de jarl + comandos extra** — una sola clase (`PanelJarl`) con una sección adicional cuando `esSuperadmin`.

## 1. Identidad: `admin_cuentas` — separada de `jugadores`

Tabla nueva (`server/src/datos/bd.ts`), **a propósito independiente** de `jugadores.nombre` (identidad v1 de PJ, libre y mutable — ver `docs/GDD_Construccion.md`): una cuenta de admin es una cuenta REAL, no un nombre de personaje.

```
admin_cuentas: id, usuario (UNIQUE), password_hash (NULL si solo Twitch), twitch_login (UNIQUE, NULL si solo contraseña), rol ("jarl"|"superadmin"), mapa_id (NULL salvo jarl con mapa asignado), creado_en
```

- `rol="jarl"` con `mapa_id=NULL` es un estado válido: una cuenta jarl recién creada, **sin mapa asignado todavía** (`crearCuentaAdmin` nunca asigna mapa directamente — ver §4).
- `rol="superadmin"` siempre lleva `mapa_id=NULL` (`asignarJarlDeMapa` lo rechaza explícitamente si se intenta).
- "1 jarl por mapa" vive en `asignarJarlDeMapa(mapaId, usuario)`: al asignar, a quien tuviera ese `mapa_id` antes se le pone a `NULL` (sigue siendo jarl, solo que sin mapa) — nunca se borra su cuenta.
- CRUD dual SQLite/Postgres (mismo patrón que el resto de `bd.ts`): `crearCuentaAdmin`, `obtenerCuentaAdminPorUsuario`, `obtenerCuentaAdminPorTwitchLogin`, `listarCuentasAdmin`, `actualizarPasswordAdmin`, `asignarJarlDeMapa`.

## 2. Contraseñas: `crypto.scrypt` nativo

`server/src/admin/passwordHash.ts` — sin dependencia nueva (`server/package.json` no traía bcrypt/argon2; el proyecto ya usaba `crypto.randomBytes` para los tokens de sesión de Twitch). `hashPassword` guarda `salt:hash` (ambos hex, salt de 16 bytes aleatoria por contraseña); `verificarPassword` compara con `timingSafeEqual` (no `===`, para no filtrar por timing) y nunca lanza ante un formato inesperado.

## 3. Sesión: mismo patrón que el login de Twitch

`server/src/admin/adminAuth.ts` — token opaco (`crypto.randomBytes(24)`), guardado EN MEMORIA (`Map<token, IdentidadAdmin & {expiraEn}>`, se pierde al reiniciar el proceso, igual que las sesiones de Twitch: no es grave, el streamer vuelve a loguearse), TTL de 6h con sliding expiration (se renueva en cada `resolverSesionAdmin` con éxito). `cerrarSesionesDeUsuario(usuario)` invalida TODAS las pestañas de un usuario a la vez — se usa al cambiar la contraseña, para forzar relogin en todas partes.

```ts
interface IdentidadAdmin { usuario: string; rol: "jarl" | "superadmin"; mapaId: string | null }
```

## 4. Rutas HTTP (`server/src/admin/rutasAdmin.ts`)

Mismo criterio que `twitch/rutasOauth.ts`: sobre el `http.Server` compartido (health check + WebSocket de Colyseus), sin Express, `if` sobre `req.url`. A diferencia del login de Twitch (redirect), estas son JSON in/out — y por eso, a diferencia de Twitch, **sí necesitan CORS**: el cliente hace `fetch()` cross-origin de verdad (Vercel/Render son orígenes distintos en producción, CLAUDE.md), lo que dispara un preflight `OPTIONS` que el server debe responder con las cabeceras `Access-Control-Allow-*` (mismo `CLIENT_URL` que ya usa el redirect de Twitch). Sin esto el navegador bloquea la respuesta aunque el server la procese bien — bug real encontrado por `adminPanel.e2e.mjs` (el formulario colgaba sin nunca completar el login) y corregido en la misma pasada.

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/admin/login` | cualquiera | `{usuario,password}` → `{token,usuario,rol,mapaId}`. Mismo error 401 tanto si el usuario no existe, la contraseña es incorrecta, o la cuenta solo se loguea por Twitch (`password_hash` NULL) — no da pistas de cuál. |
| `POST /auth/admin/cambiar-password` | sesión válida | `{token,passwordActual,passwordNueva}` → `{ok:true}`. Si la cuenta no tenía contraseña propia (solo Twitch), no exige `passwordActual` — es "ponerla por primera vez". Invalida TODAS las sesiones del usuario. |
| `POST /auth/admin/crear-cuenta` | **solo superadmin** | `{token,usuario,password,rol}` → nace con `mapaId:null` siempre (incluso si `rol:"jarl"`) — asignar el mapa es un paso aparte, para no duplicar la lógica de "1 jarl por mapa". |
| `POST /auth/admin/asignar-jarl` | **solo superadmin** | `{token,mapaId,usuario}` → aplica `asignarJarlDeMapa` (revoca al jarl anterior de ese mapa). Invalida las sesiones del usuario asignado (necesita re-loguearse para que su próxima sesión lleve el `mapaId` nuevo). |
| `POST /auth/admin/listar-cuentas` | **solo superadmin** | `{token}` → lista sanitizada (nunca expone `passwordHash`). |

## 5. Login CON Twitch, de paso

`twitch/rutasOauth.ts` — el callback de siempre (`/auth/twitch/callback`) ahora, tras resolver la identidad real de Twitch, comprueba si ese `twitch_login` está vinculado en `admin_cuentas` (`obtenerCuentaAdminPorTwitchLogin`); si lo está, crea TAMBIÉN una sesión de admin y añade `&adminSession=<token>` a la redirección de vuelta al cliente, junto a `twitchSession`/`twitchLogin` de siempre. El botón "Conectar con Twitch" que ya existía sirve para las dos cosas a la vez si la cuenta está vinculada — vincular una cuenta de Twitch a una de admin no tiene UI todavía (se hace a mano en BD o ampliando `crear-cuenta` más adelante; fuera de alcance de este pedido).

## 6. Autorización en las rooms: cero cambios en 18 sitios

El truco que evita tocar la mayoría del código de construcción: `ContextoConstruccion.jarls: Set<string>` (`construccion.ts`) es un `Set` MUTABLE, construido una vez en `iniciarConstruccion` desde `JARL_NOMBRES` (env, legado) pero **abierto a seguir creciendo** después. `RoomExteriorBase.crearJugador` resuelve la sesión de admin (mismo patrón que `twitchSession`, opción `adminSession` en el `joinOrCreate`) y, si esa cuenta es jarl DE ESTE mapa (`identidadAdmin.mapaId === this.asentamientoConstruccion`) o superadmin (cualquier mapa), inyecta el nombre de PJ actual (normalizado) en `ctx.jarls.add(...)`. `onLeave` deshace la inyección — pero SOLO si ese nombre no es TAMBIÉN un jarl legado por `JARL_NOMBRES` (`ctx.jarls` es un Set COMPARTIDO por toda la room, no por sesión: borrarlo a ciegas le quitaría el acceso a otro jugador con ese mismo nombre legado que siga conectado).

Resultado: los **18 sitios** que ya hacían `esJarl(ctx, nombre)` (`parcela:asignar/revocar`, `plantilla:colocar`, dueño-o-jarl de una construcción/refinamiento/curtidor/animal de granja/contrato de transporte...) reconocen automáticamente a un jarl/superadmin de sesión, **sin ningún cambio en esos call sites**.

Para los **7 sitios** que llamaban a `esJarlGlobal(nombre)` directamente (fuera de un `ContextoConstruccion` — pruebas de Twitch, PvP global, gestión privada de un tenderete, revocar un inmueble, entrar a una vivienda ajena): nuevo helper `puedeActuarComoJarl(client)` / `puedeActuarComoJarlEnJoin(nombre, options)` en `RoomExteriorBase`, que delega en la función PURA `esJarlConSesionAdmin(nombre, identidadAdmin, mapaIdDeEstaRoom)` (`construccion.ts`, testeada sola). `puedeActuarComoJarlEnJoin` existe aparte porque `InteriorRoom.onJoin` decide si deja entrar ANTES de llamar a `crearJugador` — en ese punto `adminSesionPorSesion` todavía no tiene nada para esa sesión, así que resuelve el token directo de `options`.

Un octavo sitio, `twitch/gestorTwitch.ts` (resolución de rol/título social por el LOGIN de Twitch de quien escribe en el chat), se deja **sin tocar** a propósito: no hay ninguna sesión de jugador de por medio ahí (es una cadena de texto del chat, no un `client` de Colyseus), así que no hay un punto natural donde enganchar `adminSesionPorSesion`. Sigue funcionando exactamente igual que antes (`esJarlGlobal` por `JARL_NOMBRES`).

## 7. Cuentas de test iniciales

`server/src/admin/seedAdmin.ts` — se siembran la PRIMERA vez que el servidor arranca con `admin_cuentas` vacía (idempotente: si ya hay alguna cuenta, no hace NADA — nunca pisa una cuenta ya creada o una contraseña ya cambiada). Llamado una vez por proceso desde `index.ts`, mismo criterio que el resto del bootstrap (`iniciarChatBot`, `cargarPvpDesdeBd`).

| Cuenta | Contraseña | Rol | Mapa |
|---|---|---|---|
| `jarl` | `colony-jarl-2026` | jarl | `principal` |
| `superadmin` | `colony-superadmin-2026` | superadmin | (cualquiera) |

**Cámbialas cuanto antes** (`POST /auth/admin/cambiar-password` o el botón "Cambiar" del panel) — son de test, tal como se pidió ("una contraseña que creamos ahora y ya se cambiará").

## 8. Cliente

- `client/src/admin/panelLoginAdmin.ts` — formulario placeholder (usuario/contraseña), `fetch` a `/auth/admin/login`; al entrar guarda el token en `sessionStorage` y **recarga la página** (`location.reload()`) para que el siguiente `joinOrCreate` mande `adminSession` — mismo ciclo que el redirect de Twitch (ahí la recarga la hace el propio navegador al volver de OAuth).
- `client/src/game.ts` — lee `adminSession` de la URL o `sessionStorage` (mismo patrón que `twitchSession`, sobrevive a `navegarA` al cruzar un portal porque eso recarga toda la página), lo manda en los 5 `joinOrCreate` (hub/hub_mapa/region/interior-o-mazmorra/arena), escucha `admin:sesionConfirmada` (server, un mensaje por join con `{usuario,rol,mapaId,esJarlAqui}`) y muestra el estado.
- `client/src/admin/panelJarl.ts` — se monta cuando `esJarlAqui` (jarl de este mapa) o `rol==="superadmin"` (siempre). PvP global (on/off), pruebas de Twitch (simular canje/comando, forzar directo), cambiar la propia contraseña; con `esSuperadmin`, sección extra: crear cuenta, asignar jarl a un mapa, listar cuentas (llamadas HTTP directas a `rutasAdmin.ts`, no mensajes de room — no hace falta estado replicado para esto).

## 9. Decisiones explícitas que NO se tomaron por el streamer (juicio propio, documentado)

- Los "comandos extra" del superadmin son **gestión de cuentas** (crear/asignar/listar) — el pedido decía "algún comando más sí" sin especificar cuáles; se eligió esto porque es la pieza que faltaba para que "más streamers → más mapas → más jarls" (la meta a futuro descrita en la conversación de diseño) sea operable sin tocar la BD a mano.
- Vincular una cuenta de Twitch existente a una cuenta de admin **no tiene UI** todavía (se hace escribiendo `twitch_login` a mano, p.ej. vía `crearCuentaAdmin`) — no se pidió explícitamente y hubiera ampliado bastante el alcance de esta pasada.
- `gestorTwitch.ts` (roles de chat) se deja intacto (ver §6) — ampliarlo a reconocer sesiones de admin por login de Twitch del CHAT es una pieza aparte, no pedida.

## 10. Pendiente real (backlog, no bloqueante)

- UI para vincular `twitch_login` a una cuenta de admin existente.
- El panel de jarl/superadmin es un placeholder de testeo (igual que el resto de paneles del proyecto) — sin arte, sin agrupar visualmente con los otros paneles (puede solaparse en pantallas pequeñas).
- `admin_cuentas` no tiene límite de intentos de login (rate limiting) — aceptable para un panel de admin de un streamer, no para un login público.
