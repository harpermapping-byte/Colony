# GDD — Cuentas de JUGADOR (login por contraseña)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-09-09).** Piezas: `server/src/auth/` (jugadorAuth.ts, rutasAuthJugador.ts), `server/src/datos/bd.ts` (columna `jugadores.password_hash`, dual SQLite/Postgres, métodos `obtenerCredencialesJugador`/`establecerPasswordJugador`), `server/src/rooms/base/RoomExteriorBase.ts` (`crearJugador` resuelve `playerSession`), `server/src/index.ts` (wiring de rutas), `client/src/inicio/pantallaBienvenida.ts`, `client/src/game.ts` (wiring del token). Probado: servidor 1303/1303, `tsc --noEmit` limpio en cliente y servidor, endpoints probados con curl contra un servidor real (registro, login, contraseña incorrecta, reclamo de personaje legado sin perder su saldo), y flujo de cliente completo con Playwright real (bienvenida visible sin sesión, crear cuenta arranca el juego, recargar con sesión guardada salta la pantalla, contraseña incorrecta no arranca el juego, la X cierra como invitado, `?nombre=` clásico sigue saltando la pantalla).

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

## 5. Cliente: pantalla de bienvenida NO bloqueante para nada existente

`client/src/inicio/pantallaBienvenida.ts` — panel construido con `panelBase.ts::crearMarcoPanel` (X arriba-derecha, clic fuera cierra, Escape cierra — ver `docs/GDD_UI_Paneles.md`). Cerrar por CUALQUIER vía sin loguearse equivale a "seguir como invitado" (comportamiento de siempre).

**`debeSaltarBienvenida()`** decide si esta pantalla debe mostrarse siquiera — riesgo real identificado y verificado: varios e2e reales del proyecto (`mecanicas.e2e.mjs`, `climaVisual.e2e.mjs`, `nieveNiveles.e2e.mjs`...) navegan a `/` sin `?nombre=`, confiando en el arranque inmediato. Salta la pantalla (arranca el juego exactamente como antes) si:
- `navigator.webdriver` es `true` — cubre CUALQUIER test Playwright/Selenium sin tener que auditar cada query param que use.
- La URL trae `?nombre=`/`?twitchSession=`/`?adminSession=` (flujos y tests ya existentes).
- Ya hay `playerSession` guardada en `localStorage`.

Verificado explícitamente contra `client/test/mecanicas.e2e.mjs` (comparado byte a byte contra el mismo test corrido con `git stash`, mismos 4 fallos preexistentes idénticos con y sin este cambio — cero regresión).

## 6. Pendiente real, no cerrado en esta pasada

- Sin verificación en producción real (Neon/Render) — solo probado contra SQLite de dev.
- Sin "cambiar contraseña" ni "cerrar sesión" para JUGADOR (sí existen para admin) — nadie lo pidió todavía.
- Sin recuperación de contraseña (no hay email en el sistema).
- La sesión se pierde al reiniciar el proceso del servidor (memoria, no BD) — mismo criterio ya aceptado para admin/Twitch; si se vuelve un problema real en producción (reinicios frecuentes), la mejora sería persistir la sesión en `jugadores` o una tabla de tokens.
