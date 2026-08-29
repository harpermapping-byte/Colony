# GDD — Propiedades comerciales (inmuebles y habitaciones)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-29).** Piezas: `server/src/propiedades/propiedades.ts` (catálogo de precios + validación pura), `server/src/datos/bd.ts` (persistencia: 4 columnas nuevas en `propiedades`, `obtenerPropiedad`/`comprarOAlquilar`/`renovarTenencia`), `server/src/rooms/RegionRoom.ts` (`inmueble:*`, edificios enteros), `server/src/rooms/InteriorRoom.ts` (`habitacion:*`, habitaciones sueltas de taberna/posada, + control de acceso al interior de un inmueble alquilado/comprado), `ciudades/src/generar.js`+`index.js` (bake-time: flag `reservadoJugador`), `poblacion/src/asignarUbicacion.js` (excluye lo reservado del censo NPC). Probado: `server/test/propiedades.test.ts` (6/6, catálogo/precios), `server/test/datos.test.ts` (+7 tests de persistencia comercial), suite completa 160/160, `npx tsc --noEmit` limpio, bake real de prueba (`pueblo`, tier con taberna+reservas) + E2E manual contra un servidor Colyseus real: listar, comprar/alquilar con chequeo de saldo, conflicto de disponibilidad, control de acceso al interior (dueño/jarl vs. cualquiera), revocación del jarl (compra o alquiler), habitaciones sueltas — 12/12 comprobaciones OK.

Pedido del streamer (2026-08-29, junto con gremios/mercado/producción/motriz — ver `docs/Backlog_Mecanicas_Futuras.md`): *"...sistema propiedades (las parcelas exteriores e interiores, las habitaciones en albergues o tabernas si se alquila o compra, las viviendas o edificios que compren o alquilen los usuarios)..."*. Construido tras Gremios en el orden acordado (Farycoins → Gremios → **Propiedades** → Mercado → Producción → Motriz) porque Mercado necesita el registro de propiedad de una tienda para saber "quién vende ahí".

## 0. Decisiones de diseño

Preguntadas al streamer y confirmadas 2026-08-29:

- **Entrar al interior de una vivienda/tienda comprada o alquilada está RESTRINGIDO a dueño + jarl** (no abierto a cualquiera como el resto de interiores). Es el único sitio del proyecto con control de acceso a una room — implementado en `InteriorRoom.onJoin` (async, rechaza con `ServerError(403, ...)` si hay dueño y quien entra no lo es ni es jarl).
- **El jarl puede revocar CUALQUIER propiedad, compra o alquiler** — no solo alquileres activos. Coherente con que el jarl ya tiene autoridad total sobre parcelas (`docs/GDD_Construccion.md`); "comprar" no da inmunidad frente al jarl.
- **Qué se vende entero**: vivienda humilde (`casa_humilde`, `choza_pescador`), comercio (`tienda`), Y TAMBIÉN `casa_noble` y `taberna` (el streamer pidió ampliar más allá de la propuesta inicial "solo humilde+tienda"). Campo `ventaJugador: true` en `interiores/catalogo/tipos_edificio.json`.
- **Orden de implementación**: Propiedades se construye YA, con precios placeholder, aunque hoy nadie tiene Farycoins reales para comprar nada (el grifo de monedas llega con Mercado). Igual que Gremios se construyó antes de que hubiera nada que depositar en su banco.
- **Farycoins**: reusa la infraestructura de Gremios (`jugadores.farycoins`, `ajustarFarycoins` atómico) — ninguna columna/tabla nueva de saldo, solo se reutiliza.

## 1. Qué hay para comprar/alquilar

Dos formas distintas, cada una con su propio protocolo y su propia room:

- **Inmueble ENTERO** (vivienda o tienda) — protocolo `inmueble:*` en **RegionRoom** (aldea/ciudad/capital, cualquiera con edificios así marcados). Id: `i_<mapaId>:<edificioId>` (`edificioId` = el mismo id que ya usa `ciudades/` para el archivo de interior, p.ej. `i_pueblo-e2eprop5:taberna_e2eprop5:taberna:7`).
- **Habitación SUELTA** de taberna/posada (dormitorio individual o comunal en la planta alta) — protocolo `habitacion:*` en **InteriorRoom**, scoped a ESE edificio+nivel. Id: `h_<mapaId>:<edificioId>:<nivel>:<salaIndex>`.

Ninguna vivienda privada (`casa_humilde`, `casa_noble`...) vende habitaciones sueltas — sus dormitorios son parte del inmueble entero, no propiedad independiente. Solo `taberna`/`posada` tienen `salasAlquilables: true` en el catálogo.

## 2. Bake-time: qué edificios están "reservados para jugador"

**Decisión propia, más simple que la propuesta original de sobreprovisionar edificios de más**: en vez de bakear viviendas EXTRA solo para vender (que exigiría inflar el censo de cada tier), `ciudades/src/generar.js` marca `reservadoJugador: true` en una fracción determinista (`FRACCION_RESERVADO_JUGADOR = 0.2`, placeholder de balance) de los edificios YA generados cuyo tipo tiene `ventaJugador` en el catálogo — nunca los obligatorios (mercado/ayuntamiento/templo, que no son vivienda). `poblacion/src/asignarUbicacion.js` (que lee el MISMO objeto `ciudad` en el mismo proceso, vía `exportarAsentamiento.js`) excluye esos edificios de vivienda/trabajo de NPC — nunca se censa una familia donde luego un jugador podría "comprar" y desalojarla.

**Esto exige que quien rebakee un asentamiento ejecute `ciudades/` y `poblacion/` EN ORDEN con el código actualizado** — si se regenera solo `poblacion/` sobre un `indice.json` viejo sin el flag, no hay garantía. No es un riesgo nuevo: el pipeline siempre ha sido "bakear ciudades, luego poblarla" en ese orden.

`indice.json.edificios[].reservadoJugador` viaja en el export de `ciudades/src/index.js`. `RegionRoom.onCreate` lee ese array UNA vez y construye `inmueblesVendibles: Map<edificioId, {tipoEdificioId}>` — filtrado además por `ventaJugadorPermitida()` (defensa en profundidad: aunque el bake mintiera, el catálogo cerrado manda).

## 3. Persistencia (`server/src/datos/bd.ts`)

Reusa la MISMA tabla `propiedades` que ya modelan las parcelas del jarl (mismo `dueno`, mismo "quién es dueño de qué") — 4 columnas nuevas, todas NULL para una parcela de siempre (cero cambio de comportamiento ahí):

```sql
ALTER TABLE propiedades ADD COLUMN modo_tenencia TEXT;      -- NULL | 'compra' | 'alquiler'
ALTER TABLE propiedades ADD COLUMN precio_farycoins INTEGER;
ALTER TABLE propiedades ADD COLUMN periodo_horas INTEGER;
ALTER TABLE propiedades ADD COLUMN expira_en TEXT;          -- ISO, horas REALES (Date.now()), no tiempoMundo()
```

Mismo patrón dual que Farycoins (`docs/GDD_Gremios.md` §4): SQLite usa `PRAGMA table_info` + `ALTER TABLE` condicional (sin `IF NOT EXISTS` portable), Postgres usa `ADD COLUMN IF NOT EXISTS` nativo.

- **`obtenerPropiedad(id)`** — point-query, NUNCA cacheada en memoria de room (a diferencia de `ContextoConstruccion`): resuelve la expiración perezosa ANTES de devolver — si es un alquiler vencido, libera la fila (dueno/modo/precio/periodo/expira → NULL) en la MISMA llamada. Se invoca solo desde "toques reales" (listar, comprar, alquilar, renovar, entrar al interior) — cero `setInterval` nuevo, mismo criterio "cálculo perezoso" de siempre.
- **`comprarOAlquilar(...)`** — todo o nada: cobra el precio con `ajustarFarycoins` (si falla por saldo, aborta ya); luego intenta tomar la propiedad con UN upsert atómico (`INSERT ... ON CONFLICT(id) DO UPDATE ... WHERE dueno IS NULL RETURNING id`, el mismo patrón en SQLite y Postgres — confirmado con test real que `node:sqlite` lo soporta) — si la cláusula `WHERE` no aplica (alguien se adelantó), reembolsa y devuelve `"ya no está disponible"`. Sin necesitar una transacción SQL explícita de dos pasos.
- **`renovarTenencia(...)`** — solo si sigue siendo un alquiler VIGENTE del mismo jugador; extiende `expiraEn` (+= periodoHoras, nunca resetea desde "ahora") y cobra el precio de nuevo.
- **`revocarPropiedad(id)`** (ya existía para parcelas) — ampliada para limpiar también las 4 columnas de tenencia comercial, no solo `dueno`: el jarl revoca cualquier propiedad de un golpe.

## 4. Precios (`interiores/catalogo/precios_propiedad.json`)

Por **riqueza** del tipo de edificio (`tipos_edificio.json[tipo].riqueza`: humilde/modesta/noble), no un número suelto por cada uno de los 40+ tipos — evita duplicar tablas (regla 7 CLAUDE.md). Habitaciones sueltas tienen su propio bloque por `tipoSalaId` (`dormitorio_comunal` solo alquiler; `dormitorio_individual` compra o alquiler). **Todos los números son placeholder puro** — el balance real es decisión del streamer, pendiente hasta que Mercado dé una fuente real de Farycoins.

## 5. Protocolo Colyseus

**RegionRoom** (inmuebles enteros — cualquier aldea/POI con `inmueblesVendibles` no vacío, no solo la capital):
- `"inmueble:listar"` → `client.send("inmueble:lista", [{id, tipoEdificioId, dueno, modoTenencia, precioFarycoins, expiraEn}])`.
- `"inmueble:comprar" { inmuebleId }` / `"inmueble:alquilar" { inmuebleId }` → precio resuelto server-side por riqueza (nunca confía en el cliente); éxito → `this.broadcast("inmueble:actualizado", {...})`; fallo → `client.send("inmueble:error", {motivo})`.
- `"inmueble:renovar" { inmuebleId }` — solo el dueño actual, mismo precio de alquiler de nuevo.
- `"inmueble:revocar" { inmuebleId }` — solo jarl (`esJarlGlobal`, independiente de `ContextoConstruccion` — funciona en CUALQUIER región, tenga o no construcción habilitada).

**InteriorRoom** (habitaciones sueltas — solo si `salasAlquilablesPermitidas(tipoEdificioId)`, hoy taberna/posada):
- `"habitacion:listar"` → `client.send("habitacion:lista", [{salaIndex, tipoSalaId, dueno, modoTenencia, precioFarycoins, expiraEn}])`, a partir de `this.interior.salasIndexadas` (nuevo campo, ver §6).
- `"habitacion:comprar" { salaIndex }` / `"habitacion:alquilar" { salaIndex }` / `"habitacion:renovar" { salaIndex }` — mismo flujo que inmueble, precio por `tipoSalaId`.

**Control de acceso** (InteriorRoom.onJoin, async): antes de crear al jugador, `obtenerPropiedad("i_<mapaId>:<edificio>")` — si tiene dueño, solo ese dueño o el jarl pueden unirse; cualquier otro recibe `ServerError(403, "esta vivienda es privada")` (colyseus.js lo propaga como rechazo de `joinOrCreate`). Aplica a CUALQUIER nivel/planta del edificio (el id no lleva nivel). Un inmueble nunca tocado, o cuya tenencia venció, sigue abierto a cualquiera — sin cambio de comportamiento para el 99% de interiores del juego.

## 6. Habitaciones con id estable (`server/src/mundo/interiorColision.ts`)

Hueco real que había que tapar: ninguna sala tenía id propio, solo se agrupaban por `tipoSalaId` (`salasPorTipo`, usado por "vida en interiores" para colocar NPCs). Añadido `salasIndexadas: {salaIndex, tipoSalaId, x, y}[]` — `salaIndex` es la posición 0-based dentro del array `salas` de ESA planta, YA determinista por semilla (`colocarSala` se siembra con `${semilla}:${nivel}:${i}`, `interiores/src/edificio.js`) — un campo DERIVADO en el loader del servidor, sin tocar el bakeador de interiores. Solo incluye salas de tipo `dormitorio_individual`/`dormitorio_comunal` (las únicas alquilables). También se añadió `tipoEdificioId` a `InteriorCargado` (antes se perdía al cargar) para poder gatear `salasAlquilablesPermitidas` sin abrir el JSON del bake dos veces.

## 7. Fuera de alcance de v1 (pendiente, no bloquea)

- Fuente real de Farycoins (llega con Mercado) — hasta entonces, precios reales y sistema funcionalmente probado pero sin uso jugable.
- Amueblar/decorar una habitación o inmueble alquilado (el constructor de `docs/GDD_Construccion.md` es para parcelas exteriores; amueblar interiores comprados es un hueco futuro).
- Permisos de invitado dentro de una vivienda privada (hoy es binario: dueño+jarl o nadie — sin lista blanca de "amigos que pueden entrar").
- Notificación al inquilino cuando su alquiler está por vencer — hoy solo se resuelve perezosamente cuando alguien toca la propiedad.
- Parcelas exteriores/interiores del Hub (`docs/GDD_Construccion.md`) y este sistema comparten tabla pero siguen siendo dos flujos distintos (jarl asigna gratis vs. compra/alquiler comercial) — unificar la UI de "todas mis propiedades" en el cliente es un pendiente de cliente, no de servidor.
