# GDD — Pesca (activa y pasiva)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `items/catalogo/items.json` (+`cana_pesca`, `cebo_pesca`), `server/src/mundo/colisiones.ts` (`casillaAguaCercana`), `server/src/personaje/pesca.ts` (nuevo, puro: `tocaPicar`/`elegirCaptura`), `server/src/rooms/base/RoomExteriorBase.ts` (`pesca:lanzar`/`pesca:interactuar`/`pesca:cancelar`, temporizadores con `Delayed`), `client/src/pesca/panelPesca.ts` + `client/src/game.ts` (tecla U, boya cosmética 3D). Pesca pasiva: `interiores/catalogo/exteriores.json` (+`trampa_pesca`, `cangrejera`, `batea_almejas`, todas con `produccion` + `requiereAgua`), `server/src/construccion/catalogo.ts` (+campo `requiereAgua`), `server/src/construccion/construccion.ts` (valida agua adyacente, reusa `hayAguaAdyacente` del molino). Probado: `server/test/pesca.test.ts` (6 tests nuevos), suite completa de servidor 460/460, suite de interiores 34/34, `tsc --noEmit` limpio en `server/` y `client/`, `combate.e2e.mjs` en verde.

Pedido del streamer (2026-08-30): *"necesitas caña con cebo e irte a una superficie de agua en la orilla con la caña en mano usar y procedes a lanzar la caña, se te ancla ahí en el sitio en la posición de pescar, y donde cayó el cebo sale una boyita pequeña (...) tiene probabilidad de que pique cada 5 segundos un pescado de los que tengamos en el listado, se mueve la boya 3 veces y si no se da click o alguna interacción que elijamos antes de esos 3 veces de movimiento de la boya, se pierde ese pez, si se da se pesca y aparece en inventario. también puedes pescar de forma pasiva con trampas, peces trampas, cangrejos, plataforma de criado de almejas (como las bateas)"*.

## 1. Pesca activa

### 1.1 Requisitos y lanzamiento (`pesca:lanzar`, sin payload)

Auto-apuntado sin UI de targeting (mismo criterio que "coger"/`combate:iniciar`). Requiere:
- `cana_pesca` en el inventario, sin estar rota (`estaRoto`, `inventario/desgaste.ts`) — nueva herramienta, `slotEquipo: manoPrincipal`, `durabilidadMax: 40`, `desgastePorUso: 1`.
- Al menos 1 `cebo_pesca` — nuevo recurso apilable (stackMax 20), se consume 1 por lanzamiento (`quitarItem`), acierte o no.
- El jugador está en **TIERRA** (`medioEn === TIPO.TIERRA`) — nunca se lanza desde dentro del agua.
- Hay una casilla de agua dentro de `RADIO_INTERACCION` (`casillaAguaCercana`, `mundo/colisiones.ts` — escaneo de vecindad acotado, mismo criterio que `recolectableCercano`).

Si todo encaja: se ancla la boya en esa casilla de agua (`pescaPorSesion`, guardado por sessionId — como mucho una pesca activa a la vez), se avisa al cliente (`pesca:lanzada {x,y}`) y arranca el temporizador de picada.

### 1.2 Picada (`personaje/pesca.ts`, puro)

Cada `INTERVALO_PICADA_MS` (5000 ms) mientras se espera, un roll (`tocaPicar`, `PROBABILIDAD_PICADA = 0.5`) decide si pica. Si no, se reprograma el mismo intervalo (espera indefinida hasta que el jugador cancele o se vaya). Si pica:

- Se elige YA la captura (`elegirCaptura`, reparto por peso sobre `TABLA_CAPTURAS`) — no al reaccionar, para que reaccionar a tiempo sea solo "confirmar que llegas", nunca un segundo roll.
- Se avisa al cliente (`pesca:pica`) y arranca una ventana de reacción (`VENTANA_REACCION_MS = 3 × 1200 ms = 3600 ms`, "la boya se mueve 3 veces" — el servidor trackea una única ventana total, los 3 "movimientos" son puramente la animación cosmética del cliente durante esa ventana, ver §3).
- **Se reacciona a tiempo** (`pesca:interactuar`, sin payload): se cancela el timer de escape, se añade la captura al inventario (`agregarItem`), se desgasta la caña 1 uso (`registrarUso`) y sigue pescando (nueva espera de 5s) — `pesca:capturado {itemId}`.
- **No se reacciona a tiempo**: el timer dispara, vuelve a fase "esperando" y sigue pescando — `pesca:escapado`.

### 1.3 Tabla de capturas

Sin distinción río/lago/mar por casilla en el servidor (el runtime solo conoce `TIPO.AGUA`/`AGUA_PROFUNDA`, no bioma de agua) — reparto genérico entre los 4 recursos de pesca ya existentes: `pescado_rio`(3) · `pescado_lago`(3) · `pescado_mar`(2) · `marisco`(2). Documentado como decisión explícita: cuando el servidor conozca el bioma de cada masa de agua, la tabla puede pasar a variar por región sin tocar la lógica de picada/reacción.

### 1.4 Cancelación

`pesca:cancelar`, moverse de verdad (mismo criterio que cancelar el sueño en cama al moverse) o desconectarse cortan la pesca — se limpia el timer activo (`Delayed.clear()`), sin devolver el cebo ya consumido.

### 1.5 Cliente (placeholder)

`panelPesca.ts` — texto de estado ("Pescando..." / "¡Pica! Pulsa U") + botón cancelar, mismo patrón que el resto de paneles placeholder de esta pasada. Tecla **U** ("usar"): lanza si no se está pescando, reacciona si está picando. Boya cosmética puramente LOCAL (no viaja por el Schema — nadie más necesita verla): una esfera roja que bobea suave mientras se espera y con más amplitud/velocidad mientras pica, en la posición devuelta por `pesca:lanzada`.

## 2. Pesca pasiva

Reusa el mecanismo de producción pasiva YA existente (`docs/GDD_Produccion.md`, el mismo de colmena/aserradero) — sin código nuevo en el servidor más allá de una validación de colocación. Tres construibles nuevos en `exteriores.json`:

| id | produce | intervalo | tope |
|---|---|---|---|
| `trampa_pesca` | `pescado_rio` x1 | 3 h | 8 |
| `cangrejera` | `marisco` x1 | 4 h | 8 |
| `batea_almejas` | `marisco` x2 | 3 h | 12 |

Los tres llevan `requiereAgua: true` — nuevo campo en `EntradaConstruible`, comprobado en `validarColocacion` (`construccion.ts`) con la MISMA función `hayAguaAdyacente` que ya usaba el molino de agua (`energia.fuente === "agua"`): la construcción sigue siempre sobre tierra (ninguna casilla de su huella puede ser agua, regla general de construcción), pero exige agua ortogonalmente adyacente a la huella. Se recolectan con el mensaje genérico ya existente `produccion:recolectar` — sin mensaje nuevo, "las listas crecen, el código no" (CLAUDE.md regla 7).

## 3. Decisiones a confirmar con el streamer

- Ventana de reacción de 3.6s (3 × 1.2s) y probabilidad de picada 50%/5s son valores de partida — fáciles de ajustar en `personaje/pesca.ts` sin tocar el resto.
- Sin distinción de bioma de agua (río/lago/mar) en el servidor — la tabla de capturas es la misma en cualquier masa de agua hasta que el runtime lea bioma por casilla.
- La boya de la pesca activa no se replica a otros jugadores (puramente local) — decisión de scope, no un olvido.
