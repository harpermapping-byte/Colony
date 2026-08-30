# GDD — Cocina

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30), §3 AMPLIADA el mismo día con el paso de agua/hervor.** Piezas: `server/src/cocina/cocina.ts` (nuevo, puro: boost simple, hervor, cocción de vasija, clave/nombre de plato), `server/src/inventario/inventario.ts` (+`AportesCocina`, `aportesCocina`/`origenCocina`/`restauraMultiple` en `EntradaCatalogoItem`), `server/src/datos/bd.ts` (tabla `platos_creados`, dual SQLite/Postgres), `server/src/construccion/catalogo.ts` (+campo `cocina`), `server/src/rooms/base/RoomExteriorBase.ts` (mensajes `cocina:*` incluido `cocina:llenarAgua`, `manejarPersonajeConsumir` extendido a varios vitales a la vez), `items/catalogo/items.json` (16 ingredientes existentes con `aportesCocina`/`origenCocina` + 16 versiones `_cocinado` nuevas), `interiores/catalogo/exteriores.json` (`hoguera_campamento` + `cuenco_cocina`/`cazuela_cocina`/`olla_cocina`), cliente `client/src/cocina/panelCocina.ts` (cuenta atrás de hervor local) + `client/src/construccion/renderConstrucciones.ts` (`cocinaMasCercana`) + `client/src/game.ts`. Probado: `server/test/cocina.test.ts` (18 tests) + `server/test/platosCreadosBd.test.ts` (3 tests), suite completa de servidor 507/507, suite de interiores 34/34, `tsc --noEmit` limpio en `server/` y `client/`, `combate.e2e.mjs` en verde.

Pedido del streamer (2026-08-30, resumen — texto completo en el historial): combinar ingredientes en cazuelas/ollas/cuencos para dar platos con buenos atributos; cocinar un ingrediente crudo tal cual, sencillo, con un boost modesto; cada ingrediente tiene SÍ O SÍ stats aleatorias de +vida/+estamina/+hambre/+bebida (todos quitan hambre, algunos también sed); en una vasija se hierve agua y se añaden ingredientes de un pequeño inventario stackeable, sale X cantidad de comida con X stats según los ingredientes; el nombre del plato se genera automático (deja que decida yo cómo); y se fomenta combinar materiales distintos (planta + carne) con un bonus. Mismo criterio de diseño que los injertos (combinación abierta + identidad permanente), construido reusando esa arquitectura.

## 1. Ingredientes (`AportesCocina`, en `items.json`)

16 recursos YA existentes en el catálogo (nada de ítems nuevos de materia prima — reuso total: 4 carnes, 4 pescados/marisco, 3 vegetales silvestres, 4 cultivos de agricultura, miel) llevan ahora `aportesCocina: {vida?, estamina?, comida, bebida?}` + `origenCocina: "vegetal"|"animal"`:

| ingrediente | vida | estamina | comida | bebida | origen |
|---|---|---|---|---|---|
| carne_roja | 6 | 1 | 10 | — | animal |
| carne_blanca | 4 | 3 | 9 | — | animal |
| carne_caza_mayor | 8 | 2 | 14 | — | animal |
| carne_exotica | 7 | 4 | 12 | — | animal |
| pescado_rio/lago | 4 | — | 8 | — | animal |
| pescado_mar | 5 | — | 9 | 2 | animal |
| marisco | 3 | 2 | 7 | — | animal |
| baya | 2 | — | 6 | 2 | vegetal |
| fruta | 2 | — | 7 | 4 | vegetal |
| fruto_seco | — | 4 | 10 | — | vegetal |
| trigo | — | — | 12 | — | vegetal |
| zanahoria | 3 | — | 6 | — | vegetal |
| tomate | 2 | — | 6 | 3 | vegetal |
| fresa | 1 | 1 | 5 | 2 | vegetal |
| miel | — | 6 | 5 | 1 | vegetal |

`comida` siempre presente ("todos quitan hambre", pedido explícito); vida/estamina/bebida repartidos a mano por ingrediente, mismo estilo de magnitud que los ejemplos del streamer (zanahoria +3 vida). Nada crudo es comestible directamente — `manejarPersonajeConsumir` sigue exigiendo `tipo:"consumible"`, y estos 16 son `tipo:"recurso"` — hay que cocinarlos primero, coherente sin código extra.

## 2. Cocinar tal cual (`cocina:simple`, hoguera)

`hoguera_campamento` (construible nuevo, sin vasija — `cocina: {esVasija:false}`). `cocina:simple {construccionId, instanciaId}` consume 1 unidad del ingrediente crudo y entrega su versión `<itemId>_cocinado` — **precomputada en el catálogo** (16 entradas nuevas en `items.json`, no generadas en runtime: la transformación cruda→cocinada es 1:1 y acotada, a diferencia de la combinatoria abierta de la vasija, así que no hace falta el mecanismo dinámico de BD). Cada `_cocinado` es `tipo:"consumible"` con `restauraMultiple` = aporte crudo × 1.5 (redondeo hacia arriba, `cocinarSimple` en `cocina.ts`) — "da poco aumento", un boost modesto sobre comer crudo (que de hecho no se puede, ver §1).

## 3. Vasijas: cuenco, cazuela, olla (`cocina:anadir` + `cocina:preparar`)

Tres tamaños, mismo criterio que las macetas de agricultura — más capacidad = más tipos de ingrediente combinables a la vez, y el TAMAÑO decide la palabra del nombre automático (§4):

| vasija | capacidad (tipos distintos) | prefijo del nombre |
|---|---|---|
| `cuenco_cocina` | 2 | "Sopa" |
| `cazuela_cocina` | 4 | "Guiso" |
| `olla_cocina` | 6 | "Estofado" |

### 3.1 Llenar de agua y esperar a que hierva (`cocina:llenarAgua`)

Confirmado por el streamer (2026-08-30): "para hacer guisos y sopas necesitas llenar la olla de agua y ponerla al fuego hasta que se caliente, un tiempo determinado". `cocina:llenarAgua {construccionId}` — agua "libre" (no consume ningún ítem del inventario, mismo criterio que el agua de la pesca) — marca la vasija `conAgua:true` y arranca el cronómetro (`calentandoDesde`). El hervor se **deriva** de ese timestamp, nunca se guarda un booleano aparte (mismo patrón perezoso que agua/fertilizante de agricultura): `estaHirviendo = conAgua && (ahora - calentandoDesde) >= TIEMPO_HERVIR_MS` (20 segundos REALES, no días de mundo — esto es un fogón encendido ahora mismo, `cocina/cocina.ts::TIEMPO_HERVIR_MS`).

`cocina:anadir` ahora EXIGE `estaHirviendo` — error "primero llena la vasija de agua y ponla al fuego" si nunca se llenó, "el agua todavía no ha hervido" si está en ello. `cocina:preparar` vacía la vasija Y apaga el fuego (`conAgua` vuelve a `false`) — hay que volver a llenar y esperar para la siguiente tanda, no queda "precalentada" entre platos.

`cocina:anadir {construccionId, instanciaId, cantidad}` mete un ingrediente crudo del inventario del jugador en el "pequeño inventario stackeable" de la vasija (`viva.extra.cocina.ingredientes`, mismo patrón `extra` que produción/cultivo) — capado por TIPOS distintos (`capacidad`), sin tope propio en la cantidad de cada uno. `cocina:preparar {construccionId}` cocina todo lo que hay dentro y vacía la vasija.

### 3.2 Cliente: cuenta atrás local

`cocina:estado` manda `conAgua`/`hirviendo`/`segundosParaHervir` (todo resuelto en el servidor). El panel arranca un `setInterval` LOCAL de 1s para la cuenta atrás visual mientras se calienta — evita bombardear al servidor con `cocina:consultar` solo para refrescar un número; el servidor sigue siendo la única fuente de verdad (el temporizador local se descarta y se resincroniza en cuanto llega cualquier `cocina:estado` real).

## 4. Cómo sale el plato (`cocinarPlato`, `cocina.ts`)

- **Raciones** = unidades totales metidas / 2, redondeo hacia abajo, mínimo 1 si hay algo — "se creará X cantidad de comida según ingredientes".
- **Calidad del plato** (vida/estamina/comida/bebida por ración) = **media** de los aportes de los TIPOS de ingrediente distintos presentes — la CANTIDAD de cada uno solo afecta las raciones, no la calidad. Decisión explícita: así la misma receta siempre da el mismo plato (coherente con que el nombre/identidad se cachea, ver abajo), en vez de que "echar más carne" también suba las stats indefinidamente.
- **Bonus de mezcla**: ×1.2 a los 4 ejes si la vasija tiene AL MENOS un ingrediente `vegetal` Y uno `animal` a la vez — "se fomenta que se combinen materiales diferentes", pedido explícito.

## 5. Nombre e identidad del plato — combinación abierta, permanente

**Mismo diseño que los injertos** (§4 de `docs/GDD_Agricultura.md`): la identidad de un plato (nombre + itemId) se cachea por el **CONJUNTO de tipos de ingrediente usados** (`clavePlato` — itemIds distintos, ordenados, sin cantidades, "carne_roja|zanahoria" siempre es el mismo plato aunque una vez metas 2 zanahorias y otra vez 20). Primera vez que se cocina esa combinación: se genera el nombre automático (`nombrePlato` — "Guiso de Zanahoria y Carne Roja", el prefijo lo decide la vasija) y se registra **permanente** en la tabla `platos_creados` (BD, dual SQLite/Postgres, sobrevive a un reinicio); las siguientes veces que alguien cocine la MISMA combinación (en cualquier vasija de ese tamaño, en cualquier room), se reusa el mismo itemId — apilable con lo que ya tuviera. Cada room funde perezosamente los platos ya inventados en su copia en memoria del catálogo (`asegurarPlatosCargados`, igual patrón que `asegurarHibridosCargados`).

Respuesta directa a "¿nombres automáticos o calcular todas las combinaciones posibles?": ni lo uno ni lo otro — se generan **bajo demanda, la primera vez que se cocinan de verdad**, nunca se precomputa el árbol combinatorio completo (crecería sin límite con cada ingrediente nuevo que se añada al juego).

## 6. Comer un plato con varios vitales a la vez (`restauraMultiple`)

El sistema de consumo ya existente (`personaje:consumir`) solo sabía subir UN vital por ítem (`restaura: {vital, cantidad}`). Se añadió `restauraMultiple: {vida?, estamina?, comida?, bebida?}` — aditivo, no toca ningún consumible existente — y `manejarPersonajeConsumir` ahora aplica CADA eje presente en un solo consumo (mismo `curar()`/`restaurarVital()` de siempre, una vez por eje). Los ingredientes `_cocinado` y los platos de vasija usan `restauraMultiple`; los consumibles antiguos (poción, ración de viaje...) siguen con `restaura` tal cual.

## 7. Decisiones a confirmar con el streamer

- **✅ Confirmado (2026-08-30): "sí, para hacer guisos y sopas necesitas llenar la olla de agua y ponerla al fuego hasta que se caliente"** — implementado tal cual (§3.1): `cocina:llenarAgua` + 20s reales de hervor antes de poder añadir ingredientes. El agua es "libre" (no gasta ningún ítem) — a confirmar si eso debería costar algo (un cubo, cerca de una fuente de agua) o queda gratis como está.
- La calidad del plato depende del TIPO de ingrediente, no de la cantidad de cada uno (§4) — decisión de diseño para que "misma receta = mismo plato" tenga sentido con identidad cacheada.
- Sin caducidad ni deterioro de los platos cocinados — se comportan como cualquier otro consumible del inventario.
- Los 20 segundos de hervor (`TIEMPO_HERVIR_MS`) son un valor de partida — fácil de ajustar en `cocina/cocina.ts` sin tocar el resto.
