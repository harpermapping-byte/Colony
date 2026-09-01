# GDD — Mercado (tenderetes de jugador)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-29). Nota 2026-09-01: §4 corregida — "tenderetes de NPC con economía real" SÍ se implementó después, documentado en `docs/GDD_Economia.md` §9-§10, no aquí (es un cluster separado, ver mensaje original en §0).** Piezas: `server/src/datos/bd.ts` (tabla `tenderete_items`, `comprarDeTenderete`/`reponerStockTenderete`/`fijarPrecioTenderete`/`listarStockTenderete`), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo `tenderete:*`, compartido por las 4 rooms). Probado: `server/test/datos.test.ts` (+8 tests de persistencia comercial), suite completa 168/168, `npx tsc --noEmit` limpio, y E2E manual contra un servidor Colyseus real: reponer desde el cuerpo, control de dueño, cambiar precio sin tocar stock, escaparate público sin cantidad exacta, autocompra rechazada, compra con cobro/abono de Farycoins y entrega al cuerpo del comprador, agotado visible (no desaparece), y revocar la propiedad subyacente vacía el tenderete — 12/12 comprobaciones OK.

Pedido del streamer (2026-08-29, junto con gremios/propiedades/producción/motriz — ver `docs/Backlog_Mecanicas_Futuras.md`): *"...sistema tiendas NPC y tiendas de jugadores, hay que crear tenderetes en las plazas y mercados de la ciudad capital... el resto serán asignables por el jarl a jugadores donde pondrán sus objetos a la venta por monedas (Farycoins)... funciona automáticamente la tienda solo hay que renovar stock, tiene inventario que solo ve el dueño y el admin, y si lo que pone a la venta no tiene ya stock en el inventario desaparece de la venta o pone mejor fuera de stock..."* Tercero de los 5 clusters en construirse, tras Gremios y Propiedades (Farycoins → Gremios → Propiedades → **Mercado** → Producción → Motriz).

## 0. Decisión central: un tenderete NO es una entidad nueva

**Simplificación deliberada respecto al diseño original investigado** (que proponía una tabla `tenderetes` + slots bakeados offline en la plaza): un tenderete vive **SOBRE una propiedad que su dueño ya posee** —

- una **parcela** que el jarl le asignó (`parcela:asignar`, Hub o la ciudad capital — cualquier `RoomExteriorBase` con `ContextoConstruccion`), o
- un **inmueble/habitación** que compró o alquiló (`docs/GDD_Propiedades.md`).

`tenderoteId` es literalmente el **mismo id de propiedad** (`p_0001`, `i_<mapaId>:<edificio>`, `h_<mapaId>:<edificio>:<nivel>:<salaIndex>`). Consecuencias de esta decisión:

- **Cero bake nuevo**: no hace falta reservar posiciones de "puesto de mercado" en `ciudades/` — el jarl asignando una parcela YA es "darle a un jugador un sitio donde vender", exactamente el mecanismo que pedía el streamer.
- **Cero tabla `tenderetes` nueva**: la única tabla nueva es `tenderete_items` (qué vende, cuánto, a qué precio) — la propiedad YA registra quién puede gestionarlo.
- **Revocar la propiedad revoca el tenderete gratis**: `revocarPropiedad` (ya existente, usada por el jarl para parcelas e inmuebles) ahora TAMBIÉN vacía `tenderete_items` de esa id — ni un mensaje nuevo de administración, ni riesgo de tenderetes huérfanos.
- **Sin sistema de "tenderetes de NPC" en v1**: los vendedores NPC (`docs/GDD_Poblacion_NPCs.md`, `docs/GDD_Agentes_Moviles.md`) siguen exactamente igual que hoy — posición + rutina + grito, sin inventario de venta real. Darles una economía real (stock que se regenera solo, sin dueño humano) es una pieza separable y se deja para v2 — el pedido del streamer se centra en tenderetes de JUGADOR ("el resto serán asignables por el jarl a jugadores"), que es lo que v1 resuelve entero.
- **Sin "colocación libre estilo Hub"**: un tenderete se abre donde ya hay una propiedad tuya, nunca en cualquier punto del mapa — coherente con que las parcelas/inmuebles ya son el mecanismo de "dónde puedes actuar".

## 1. Persistencia (`server/src/datos/bd.ts`)

Única tabla nueva:

```sql
CREATE TABLE IF NOT EXISTS tenderete_items (
  tenderete_id TEXT NOT NULL,      -- id de una propiedad YA existente (parcela/inmueble/habitación)
  item_id TEXT NOT NULL,           -- catálogo items/catalogo/items.json
  cantidad INTEGER NOT NULL DEFAULT 0,
  precio_farycoins INTEGER NOT NULL,
  PRIMARY KEY (tenderete_id, item_id)
);
```

- **`reponerStockTenderete`**: upsert que **SUMA** a la cantidad existente (repone, nunca reemplaza) y actualiza el precio al último valor puesto.
- **`fijarPrecioTenderete`**: cambia SOLO el precio de un ítem YA repuesto — `false` si nunca se repuso ahí (hay que reponer antes de poder fijar precio, evita "vender aire").
- **`comprarDeTenderete`**: todo o nada, **sin transacción SQL explícita** — mismo patrón compare-and-swap por sentencia única que `ajustarFarycoins`/`comprarOAlquilar` (docs/GDD_Propiedades.md), encadenado en 3 pasos: (1) cobra al comprador (`ajustarFarycoins` negativo, aborta si no llega); (2) decrementa stock con `UPDATE ... WHERE cantidad >= ? RETURNING cantidad` (aborta y REEMBOLSA si no queda suficiente); (3) acredita al vendedor (`ajustarFarycoins` positivo, no puede fallar). **Decisión propia, distinta del diseño original** (que proponía `BEGIN/COMMIT/ROLLBACK` real): evita introducir la primera transacción SQL multi-sentencia del proyecto — el mismo resultado se logra con 3 operaciones cada una atómica por sí sola, igual que ya se hace en Propiedades.
- **Agotado nunca borra la fila** (`cantidad:0` sigue visible) — pedido explícito del streamer ("o pone mejor fuera de stock"), y evita el patrón "borrar antes de confirmar" que ya causó un bug real en `cogerSoltar.ts`.
- **`revocarPropiedad`** (ampliada): además de liberar dueño/tenencia, ahora también `DELETE FROM tenderete_items WHERE tenderete_id = ?`.

## 2. Protocolo Colyseus (compartido, `RoomExteriorBase.ts`)

Los 5 mensajes funcionan en **cualquier room**: RegionRoom/HubRoom para tenderetes sobre una parcela, InteriorRoom para tenderetes dentro de un inmueble propio.

- **`"tenderete:escaparate" { tenderoteId }`** — público, cualquiera. `client.send("tenderete:escaparate", { tenderoteId, items: [{itemId, precioFarycoins, disponible}] })`. **Nunca expone la cantidad exacta** — solo `disponible: cantidad>0` — lo detallado es privado.
- **`"tenderete:gestion" { tenderoteId }`** — privado, **solo dueño o jarl** ("solo lo ve el dueño y el admin", pedido explícito). Devuelve cantidades EXACTAS.
- **`"tenderete:reponer" { tenderoteId, instanciaId, cantidad, precioFarycoins }`** — solo dueño. Saca del CUERPO (en memoria, misma fuente que "soltar") por `instanciaId` — snapshot+restaura si algo falla a medias, mismo mecanismo que `intentarCoger`/`manejarSoltar`.
- **`"tenderete:fijarPrecio" { tenderoteId, itemId, precioFarycoins }`** — solo dueño, no toca cantidad.
- **`"tenderete:comprar" { tenderoteId, itemId, cantidad }`** — cualquiera salvo el propio dueño. Tras el cobro en BD, mete el ítem en el CUERPO del comprador (`intentarCoger`); si el cuerpo no tiene hueco (raro — el cuerpo es independiente de la BD), se **compensa** devolviendo Farycoins Y stock al MISMO precio que ya tenía, y se informa el error — nunca se pierde ni duplica nada.

`duenoDeTenderete(tenderoteId)` (helper compartido) resuelve "quién puede gestionar esto" mirando primero `ContextoConstruccion.propiedades` (si esta room lo tiene — parcelas cacheadas del Hub/capital) y si no cae a `bd.obtenerPropiedad()` (inmuebles/habitaciones, o parcelas de otra room) — misma propiedad, dos caminos de lectura porque una vive en caché de room y la otra no.

## 3. Qué NO valida v1 (decisiones deliberadas)

- **Sin proximidad física**: comprar/gestionar un tenderete no exige estar de pie junto a él — igual que el banco de un gremio no exige estar en su sede. Simplifica el protocolo y es coherente con el resto del proyecto (nada más en Colony exige proximidad para una transacción económica).
- **Sin `economia:saldo` push**: el saldo de Farycoins no se empuja proactivamente al cliente tras cada transacción — el cliente lo pide indirectamente a través de cualquier flujo que ya lo devuelva (`tenderete:compraResultado.saldoRestante`, `gremio:estado`, `inmueble:*`). Un push dedicado es trivial de añadir cuando el cliente lo necesite.
- **Sin catálogo de precios base** (`precioBase` en `items.json`): el vendedor fija el precio libremente cada vez que repone — no hay precio "de referencia" del catálogo. Más simple, y más realista para un mercado de jugadores (el precio lo decide quien vende, no una tabla fija).

## 4. Fuera de alcance de v1 (pendiente, no bloquea)

- ~~Tenderetes de NPC con economía real (stock que se regenera solo sin dueño humano, cruzando `poblacion/catalogo/oficiosEdificios.json` con qué vende cada oficio) — hoy los NPC vendedores siguen siendo pura rutina/flavor, sin cambio.~~ **Resuelto (2026-08-31/09-01), ver `docs/GDD_Economia.md` §9-§10** — protocolo `npc:*` (`comercioEscaparate`/`comprar`/`vender`) con mercaderes por oficio (`server/src/mercado/catalogoMercaderes.json`, 12 oficios de partida), precio base ±20% venta/-50% compra sobre el pool de cada oficio, reinicio de stock/cupo cada 24h reales, Y precio EN VIVO por oferta/demanda (§10: sube al comprarse de golpe, baja al venderse de golpe, recalculado tras cada transacción). Corrección de documentación (2026-09-01): esta sección no se actualizó cuando esa pasada posterior lo implementó.
- **Impuesto o comisión del jarl sobre las ventas** — mencionado de pasada en el pedido original pero no confirmado; trivial de añadir como un porcentaje dentro de `comprarDeTenderete` si el streamer lo pide.
- **Notificación al vendedor de una venta mientras está desconectado** — se entera la próxima vez que consulte `tenderete:gestion` (coherente con "funciona sin que el dueño esté conectado", pedido explícito).
- **Fuente real de Farycoins** (sigue pendiente desde Propiedades) — Mercado es el primer sistema que genuinamente PUEDE generar ingresos jugables (vender objetos a otro jugador), pero no resuelve el faucet inicial (de dónde sale el primer Farycoin de la economía).
