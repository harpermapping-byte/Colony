# GDD — Economía (Farycoins)

**ESTADO: AMPLIACIÓN IMPLEMENTADA Y VERIFICADA (2026-08-30), CON EL INGRESO DIARIO DE NPC AÑADIDO EL MISMO DÍA (§3.4)** sobre una base de Farycoins ya existente (Gremios/Mercado/Propiedades, ver GDD respectivos). Piezas nuevas: `server/src/datos/bd.ts` (`SALDO_INICIAL_JUGADOR`, `SALDO_INICIAL_NPC_COMERCIANTE`, `INGRESO_DIARIO_NPC`, `saldoInicialPara`, `creditarJarl` en `comprarOAlquilar`/`renovarTenencia`, `venderANpc`, `resolverIngresoDiarioNpc` + tabla `npc_comerciantes`), `server/src/construccion/construccion.ts` (`nombresJarlTalCual`), `server/src/mercado/catalogoNpcComercio.ts` (nuevo, catálogo de tienda general), `server/src/mundo/agentes.ts` (`NpcBakeado.oficio`), `server/src/rooms/RegionRoom.ts` (`oficiosNpc`), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo `npc:*` de comercio + loot de Farycoins al matar un enemigo + ingreso diario resuelto en cada visita). Probado: `economia.test.ts` (13 tests), `datos.test.ts`/`animalesGranja.test.ts` reajustados a los nuevos saldos, suite completa de servidor 670/670, `tsc --noEmit` limpio, `combate.e2e.mjs` en verde.

Pedido del streamer (2026-08-30, verbatim): "a ver tema economia, el tema es cadaplayer cuando se crea tiene en su monedero (virtual en database) 20 farycoins, cada npc trader empieza con 500 farycoins, todos los npc tienda o vendedores comerciantes venden y compran objetos (ya decidiremos como aplicar que objetos compran y venden cada uno) por farycoins, alquilar comprar se hace con farycoins al jarl, si se aññadieran impuestos por parte jarl sobre propiedades es en farycoins, al matar npc pueden lotear de 1 a 20 farycoins aleatoriamente. si ves que habria que balancear con mas dinero y tal precios o cantidades lo dices. la idae es que con esto tengamos economia cerrada igualmente el jarl introduce con eventos mas dinero como recompensa añadiendo mas dinero al mercado."

**Confirmado con el streamer, dos decisiones que cambian código ya existente**: (a) comprar/alquilar propiedad pasa de ser un sumidero (el dinero desaparecía) a acreditarse de verdad al jugador jarl (`JARL_NOMBRES`); (b) el loot de 1-20 Farycoins al matar aplica SOLO a `enemigos` hostiles (bandidos/mazmorra, que ya tienen combate y muerte reales) — los NPCs civiles (aldeanos/tenderos) no son atacables hoy y se quedan fuera a propósito.

## 1. Lo que YA existía (no se tocó la lógica, solo se reusó)

`jugadores.farycoins` — saldo NUMÉRICO en la fila del jugador (nunca un ítem de inventario, decisión de diseño previa) con el primitivo atómico `ajustarFarycoins(id, delta)` (compare-and-swap por `WHERE farycoins + delta >= 0`, nunca dinero negativo, nunca hace falta transacción explícita). Todo lo económico del proyecto — Gremios, Mercado de jugadores, compra/venta de animales de granja, y ahora esta ampliación — se apoya en esa única función.

## 2. Saldo inicial (`SALDO_INICIAL_JUGADOR` = 20, `bd.ts`)

`obtenerOCrearJugador(nombre, saldoInicial = 20)` — el `saldoInicial` SOLO se aplica si la fila no existía todavía (un jugador que vuelve a conectar conserva lo que tenga, nunca se le resetea a 20). Aplica en SQLite (`INSERT ... VALUES (..., ?)`) y en Postgres (mismo INSERT, el `ON CONFLICT DO UPDATE` nunca toca la columna `farycoins`, así que una fila existente no se pisa).

## 3. NPCs comerciantes — saldo real + comercio real (v2 de GDD_Mercado.md, ahora sí implementado)

`docs/GDD_Mercado.md` dejaba explícitamente "vendedores NPC con economía real" para v2 — esta es esa pieza.

### 3.1 Identidad de un NPC comerciante

Un NPC con `oficio: "tendero"` (`poblacion/catalogo/oficiosEdificios.json`, ya venía en `poblacion.json` pero se perdía al crear el `Npc` Schema — se amplió `NpcBakeado.oficio` para que sobreviva) tiene su PROPIO monedero: una fila normal de `jugadores` con nombre `npc:<slotId>` (prefijo `PREFIJO_NPC_COMERCIANTE`, nunca puede chocar con un nombre de jugador real). Nace con `SALDO_INICIAL_NPC_COMERCIANTE = 500` la primera vez que se le toca (`saldoInicialPara` detecta el prefijo `npc:` y decide 500 en vez de 20).

`RegionRoom` puebla `oficiosNpc: Map<slotId, oficio>` al cargar `poblacion.json` (solo RegionRoom carga población — el Hub no tiene aldeanos bakeados, así que el comercio con NPC solo existe en instancias de ciudad/aldea, coherente con dónde vive la población).

### 3.2 Protocolo `npc:*` — auto-apuntado por proximidad, SIN pasar por Mercado

Deliberadamente NO reusa `tenderete:*` (ese exige una fila en `propiedades` con dueño-jugador vía `duenoDeTenderete`; un NPC bakeado no tiene propiedad de jugador detrás). En vez de eso:

- `npc:comercioEscaparate {}` — auto-apunta al NPC "tendero" más cercano dentro de `RADIO_INTERACCION` (mismo criterio que mascota/cadáver/fauna), devuelve su catálogo de venta y compra.
- `npc:comprar {npcId, itemId, cantidad}` — el jugador paga, reusa `bd.comprarDeTenderete` TAL CUAL con `tenderoteId`/`duenoNombre` sintéticos (`npc:<slotId>`) sobre la MISMA tabla `tenderete_items` que el Mercado de jugadores — cero tabla nueva. Repone stock perezosamente (20 unidades de golpe, `REPOSICION_STOCK_NPC`) si se agota justo antes de comprar, nunca con un tick de fondo.
- `npc:vender {npcId, instanciaId, cantidad}` — el jugador entrega el ítem, el NPC paga con SU PROPIO saldo (`venderANpc`, nuevo en `bd.ts`) — **todo o nada**: si el NPC no tiene suficiente dinero (puede quedarse sin él), no se cobra nada. El ítem se CONSUME (no se acumula para revenderlo) — decisión v1 deliberadamente simple para no abrir un bucle comprar-barato/vender-caro contra el mismo NPC.

### 3.3 Catálogo de partida (`server/src/mercado/catalogoNpcComercio.ts`)

El streamer pidió dejar "qué compra/vende cada uno" para más adelante — esto es el catálogo de "tienda general" que hace el sistema funcionar HOY, con precios fijos y pequeño a propósito:

| vende (el NPC entrega) | precio | compra (el NPC recibe) | precio |
|---|---|---|---|
| antorcha_portatil | 5 | hierro | 2 |
| racion_viaje | 3 | lana | 1 |
| sal | 2 | cuero_curtido | 2 |
| hierba_curativa | 4 | piel_basta | 1 |
| | | trigo | 1 |
| | | miel | 2 |
| | | fruta | 1 |
| | | baya | 1 |

Todo tendero usa el MISMO catálogo por ahora (sin diferenciar por oficio/asentamiento) — cambiarlo es editar esas dos tablas, cero código nuevo.

### 3.4 Ingreso diario del NPC (`INGRESO_DIARIO_NPC` = 20, ampliación 2026-08-30)

Pedido del streamer, verbatim: "los npc cada dia reciben 20 farycoins tambien asi aumentan su dinero (como todo, solo si estan cargados o se acerca alguien etc)".

`resolverIngresoDiarioNpc(npcNombre, diaActual)` — nueva tabla `npc_comerciantes(nombre, ultimo_dia_ingreso)`, cálculo perezoso EXACTO al mismo patrón que `ultimoDiaEscapeChequeado` de ganadería: acredita `INGRESO_DIARIO_NPC` (20) por cada día de mundo transcurrido desde la última resolución, de golpe si nadie visitó al NPC en varios días — nunca un tick de fondo. Se llama en los TRES puntos donde un jugador "se acerca" a un NPC tendero: `npc:comercioEscaparate`, `npc:comprar`, `npc:vender` (en `comprar`/`vender`, ANTES de la transacción — así el ingreso de hoy ya cuenta para lo que el NPC puede pagar si le estás vendiendo algo). La primera vez que se ve a un NPC no le da nada retroactivo, solo fija el día de partida (evita que el NPC recién descubierto reciba un pago gigante por "todos los días desde el inicio del servidor").

Esto compensa directamente el punto que dejé abierto en §7 de la versión anterior de este documento ("el saldo de un NPC comerciante nunca se repone, puede secarse") — un NPC visitado con regularidad ahora gana 20/día de mundo, sin tope, independientemente de cuánto compre.

## 4. Comprar/alquilar propiedad → se paga AL JARL (antes desaparecía)

`comprarOAlquilar`/`renovarTenencia` (`bd.ts`, ambos backends) llaman a `creditarJarl(precioFarycoins)` justo después de confirmar la operación: reparte el precio a partes iguales entre los `JARL_NOMBRES` configurados (`nombresJarlTalCual()`, nuevo en `construccion.ts` — a diferencia de `esJarlGlobal`/`nombresJarl`, que comparan en minúsculas, este conserva las mayúsculas EXACTAS del nombre real del jugador jarl, para no crear una fila duplicada en `jugadores`). El resto de una división no exacta se pierde (nunca se crea dinero de la nada). **Sin ningún jarl configurado (`JARL_NOMBRES` vacío), el comportamiento es el de antes: el dinero desaparece** — mismo efecto sumidero, sin roturas.

## 5. Loot al matar un enemigo (1 a 20 Farycoins, `repartirLootFarycoinsPorMuerte`)

Enganchado en `finalizarMuerte`, rama `tipo === "enemigo"` — el ÚNICO tipo de combatiente con muerte real hoy fuera de jugador/fauna (los NPCs civiles no son atacables). Busca el combate de esa unidad (`combatePorUnidad`), identifica a los jugadores del bando GANADOR (bando contrario al del enemigo caído, `estado === "activo"`).

**Confirmado por el streamer (2026-08-30, resuelve la pregunta abierta de §7/§8 de la versión anterior): "el loot compartido, o sea sincronizado, de los NPCs"** — desde esta pasada es **UNA sola tirada 1-20 por muerte** (`1 + Math.floor(Math.random()*20)`), repartida a partes iguales entre TODOS los ganadores (división entera; el resto se pierde, mismo criterio que `creditarJarl` — nunca se crea dinero de la nada). Con más ganadores que Farycoins en la tirada, `porCabeza` puede caer a 0 y esa muerte no reparte nada — aceptable. Cada jugador sigue recibiendo su propio `economia:loot {motivo:"enemigo", farycoins, saldo}` con SU parte.

## 6. Impuestos del jarl sobre propiedades

**Confirmado por el streamer (2026-08-30): "es una decisión que toma el jarl, puede ponerlo o no y poner qué cantidad y cada cuánto tiempo"** — implementado tal cual, aplica a CUALQUIER propiedad (parcela, inmueble o habitación; las tres viven en la misma tabla `propiedades`).

- `propiedades` gana 4 columnas: `impuesto_activo`, `impuesto_farycoins` (cantidad por cobro), `impuesto_periodo_horas` (cada cuántas horas REALES), `impuesto_ultimo_cobro` (ISO, ancla del próximo cobro). Migradas con el mismo `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` que el resto de columnas añadidas a esta tabla.
- Mensaje `jarl:configurarImpuesto {propiedadId, activo, farycoins, periodoHoras}` — SOLO el jarl (`esJarl`, mismo guard que `parcela:asignar`/`revocar`). Al activar (o cambiar parámetros estando ya activo), `impuestoUltimoCobro` se resetea a AHORA — nunca cobra retroactivo de antes de la configuración.
- **Cobro perezoso** (`resolverImpuestoPropiedad` en `bd.ts`, privado, mismo patrón EXACTO que `resolverIngresoDiarioNpc`: cero timers/polling, cálculo por timestamp real): se resuelve dentro de `obtenerPropiedad` (point-query ya usado por compra/alquiler) y además se dispara explícitamente cuando el dueño toca su parcela vía `construir`/`recoger` en `RoomExteriorBase.ts` — cobra de golpe TODOS los periodos completos transcurridos desde el último cobro. Todo o nada por LOTE: si el dueño no puede pagar el lote completo, no se cobra nada y el reloj NO avanza — la deuda se acumula hasta que pueda pagar (sin mecanismo de embargo/desahucio todavía, backlog abierto si hace falta). Lo recaudado se acredita al jarl con la MISMA `creditarJarl` que ya usan compra/alquiler.
- 5 tests nuevos en `server/test/economia.test.ts`: activar/desactivar, cobro de un periodo transcurrido, deuda que no se cobra si no llega el saldo, y que una propiedad sin dueño nunca cobra.

## 7. Balance — lo que pediste que comentara

- **20 Farycoins iniciales** cubren cómodamente el general store de partida (antorcha 5, ración 3, sal 2, hierba curativa 4) — un jugador nuevo puede comprar 3-4 cosas básicas sin depender de nada más. Parece razonable como arranque; si los precios de propiedades reales (`tipos_edificio.json[tipo].riqueza`, hoy placeholder) resultan mucho más altos que esto, 20 se queda corto para nada más que consumibles — no es un problema en sí (empujar a trabajar/comerciar antes de poder alquilar es la idea), pero vale la pena revisarlo cuando los precios de propiedad dejen de ser placeholder.
- **500 Farycoins por NPC comerciante + 20/día** (§3.4, resuelto): con el catálogo de compra actual (1-2 Farycoins por unidad de recurso común), 20/día alcanza para comprar 10-20 unidades de recurso diarias sin agotarse — un NPC visitado con regularidad ya no se seca. Si un NPC recibe muchas ventas de golpe (varios jugadores a la vez) puede seguir agotándose momentáneamente hasta el siguiente día de mundo; me parece razonable como fricción (anima a repartir las ventas entre varios tenderos) pero es la primera palanca si se ve demasiado restrictivo (subir el importe o la frecuencia).
- ~~1-20 Farycoins por enemigo muerto, independiente y aleatorio POR JUGADOR ganador~~ — **resuelto (2026-08-30, ver §5): ahora es UNA tirada compartida/sincronizada entre el bando ganador**, no una por cabeza.
- **Los faucets de Twitch ya existen** ("Lluvia de dinero" +10 a todos, "Bendición de gremio" +50 por gremio) — son la vía de "el jarl introduce más dinero con eventos" que pediste; no hace falta nada nuevo ahí salvo que quieras un evento adicional fuera de Twitch (comando de admin, por ejemplo).

## 8. Decisiones a confirmar con el streamer

- ~~Loot 1-20 es por JUGADOR, no por combate~~ — **resuelto (2026-08-30, ver §5): tirada compartida.**
- ~~Impuestos del jarl~~ — **resuelto (2026-08-30, ver §6): el JARL decide, por propiedad, si los activa o no, la cantidad, y cada cuánto tiempo se cobran. Implementado.**
- ~~Catálogo de compra/venta genérico, igual para todos los tenderos~~ (§3.3) — **resuelto (2026-08-31), ver §9: diferenciado por oficio, precio base ±20%/-50%.**
- **Sin wiring de cliente**: nada manda `npc:*` desde una tecla/UI todavía — mismo hueco que casi toda mecánica reciente de este proyecto, server-only por ahora.

## 9. Mercaderes NPC por oficio (pedido 2026-08-31)

Respuesta a la pregunta abierta de §8 ("diferenciarlo por oficio"). Pedido literal del streamer sobre el precio: *"el tema es que los vendedores tengan precios de compra más altos de lo normal — si pactas precio de algo en X pues el vendedor lo vende a 20% más y compra por 50% menos, y la gracia es que así las tiendas de player tienen margen de poner precio decente de X"* — un mercader NPC pone un SUELO/TECHO alrededor del precio "justo" de cada ítem, dejando hueco de margen real para que un Mercado de jugador compita por debajo.

**Reemplaza por completo** el catálogo plano "tienda general" de §3.3 (`catalogoNpcComercio.ts`, borrado) — "tendero" sigue existiendo, ya no como caso especial del código sino como un oficio más del catálogo nuevo.

- **`server/src/mercado/catalogoMercaderes.json`** — pool de artículos candidatos POR OFICIO (`poblacion/catalogo/oficiosEdificios.json`/`npc.oficio`, mismo vocabulario), cada uno con un `precioBase` Farycoins/unidad fijado a mano al dar de alta la entrada (12 oficios de partida: tendero, herrero, panadero, tabernero, pescador, carpintero, curtidor, alfarero, apicultor, sastre, anciano_sabio, carnicero — lista abierta, añadir un oficio nuevo es solo JSON). `config` fija los valores por defecto de tamaño de selección/rango de stock/límite de compra diaria; cada oficio puede sobreescribirlos (mecanismo listo, sin usar todavía en los 12 de partida).
- **`server/src/mercado/catalogoMercaderes.ts`** — `MARGEN_VENTA_MERCADER=1.2`/`MARGEN_COMPRA_MERCADER=0.5` aplicados al MISMO `precioBase` (nunca dos catálogos de precio separados). `elegirArticulosDeMercader(npcId, oficio, entrada)`: selección DETERMINISTA de 5-10 artículos del pool (PRNG mulberry32 sembrado en `npcId|oficio`, mismo criterio "nada de Math.random() para identidad" que el resto del proyecto aunque esto no sea un bake offline) — el MISMO NPC ofrece SIEMPRE los mismos artículos, nunca cambia entre visitas (verificado en el playtest: dos `npc:comercioEscaparate` seguidos dan idéntica lista). Lo que SÍ cambia es cuánto stock/presupuesto tiene de cada uno.
- **Stock de venta y presupuesto de compra — reinicio DIARIO REAL, no día de mundo.** Pedido literal: *"reset cada 24 horas reales, no ligado al reloj de mundo"* — a propósito distinto del ingreso diario de §3.4 (que SÍ usa el día de mundo del reloj del juego). `bd.resolverResetStockMercader(npcNombre, Date.now(), 24h)`: cálculo perezoso por timestamp real (nueva columna `npc_comerciantes.ultimo_reset_stock_ms`, migrada en los dos backends), `true` solo cuando toca reiniciar — un NPC no visitado en 3 días hace UN reinicio absoluto a la siguiente visita, no recupera "3 reinicios acumulados" (no hay concepto de catch-up aquí, a diferencia del ingreso diario: el stock no es una deuda, es un valor que se re-sortea). Al reiniciar, cada artículo de la selección se re-sortea a un entero aleatorio dentro de `[stockMin,stockMax]` (`stockAleatorioEnRango`, Math.random() en vivo — mismo criterio ya sentado por el loot 1-20 de Farycoins de §5: economía VIVA, no generación offline) vía `bd.fijarStockTenderete` (nuevo, FIJA la cantidad en vez de sumarla — a diferencia de `reponerStockTenderete`).
- **Stock de venta**: reusa `tenderete_items` bajo `npc:<slotId>` (misma tabla y mismo id sintético que ya usaba el catálogo plano) — si se agota a media jornada real, se queda agotado hasta el siguiente reinicio: escasez a propósito, ya NO hay auto-reposición perezosa al comprar (la había en v1, quitada).
- **Límite de compra DIARIO por artículo** (pedido: "stock/límites configurables"): presupuesto de compra reusa la MISMA tabla `tenderete_items` bajo un namespace de id SEPARADO, `npc:<slotId>:compra` — cantidad = unidades que el NPC aún comprará HOY de ese ítem, decrementada con `consumirStockTenderete` (ya existía, reusado tal cual) tras cada venta del jugador al NPC. `manejarNpcVender` recorta la cantidad al presupuesto restante en vez de rechazar de más (si quedan 3 y el jugador ofrece 5, se venden 3) — solo rechaza si no queda nada.
- **Protocolo `npc:*` sin cambios de forma** (`comercioEscaparate`/`comprar`/`vender`) — solo cambia de dónde salen los precios/el stock. `npcMercaderMasCercano`/`esOficioMercader` sustituyen el chequeo `=== "tendero"` de v1 por "¿este oficio tiene pool en el catálogo?".
- **Verificado**: 13 tests nuevos (`server/test/mercaderes.test.ts` — selección determinista, acotada al pool, precios derivados con redondeo, `fijarStockTenderete` fija no suma, reinicio por timestamp real sin acumular), suite completa de servidor 906/906, `tsc --noEmit` limpio en cliente y servidor. Playtest real de punta a punta (servidor+cliente+Playwright): NPC "herrero" fijo plantado TEMPORALMENTE vía `npcsFijos.json` (mecanismo ya documentado en `npcsFijos.ts` — el catálogo de NPCs tutorial no soporta oficio real, `oficio:"npc_tutorial"` fijo; el de NPCs fijos por mapa sí), `npc:comercioEscaparate` muestra 6 artículos de un pool de 8 con precios exactos (`acero` base 7 → venta 8/compra 4, `hierro` base 3 → venta 4/compra 2...), una segunda visita da la MISMA selección, `npc:comprar` de 2 unidades de acero cobra 16₣ y dejó el saldo del jugador (20 iniciales) exactamente en 4 — archivo de prueba borrado al terminar, sin rastro en el mapa principal.
