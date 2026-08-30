# GDD — Cocina

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30), §3 AMPLIADA el mismo día con el paso de agua/hervor, y AMPLIADA DE NUEVO el mismo día con "cocina v2" (§8-§15): más vasijas (sartén, olla grande, tinaja de batidos), ensalada/bocadillo sin vasija, pan completo, quesos/mantequilla, y 9 recetas de crafteo nuevas repartidas en 5 oficios.** Piezas v1: `server/src/cocina/cocina.ts` (nuevo, puro: boost simple, hervor, cocción de vasija, clave/nombre de plato), `server/src/inventario/inventario.ts` (+`AportesCocina`, `aportesCocina`/`origenCocina`/`restauraMultiple` en `EntradaCatalogoItem`), `server/src/datos/bd.ts` (tabla `platos_creados`, dual SQLite/Postgres), `server/src/construccion/catalogo.ts` (+campo `cocina`), `server/src/rooms/base/RoomExteriorBase.ts` (mensajes `cocina:*` incluido `cocina:llenarAgua`, `manejarPersonajeConsumir` extendido a varios vitales a la vez), `items/catalogo/items.json` (16 ingredientes existentes con `aportesCocina`/`origenCocina` + 16 versiones `_cocinado` nuevas), `interiores/catalogo/exteriores.json` (`hoguera_campamento` + `cuenco_cocina`/`cazuela_cocina`/`olla_cocina`), cliente `client/src/cocina/panelCocina.ts` (cuenta atrás de hervor local) + `client/src/construccion/renderConstrucciones.ts` (`cocinaMasCercana`) + `client/src/game.ts`. Probado: `server/test/cocina.test.ts` (18 tests) + `server/test/platosCreadosBd.test.ts` (3 tests), suite completa de servidor 507/507, suite de interiores 34/34, `tsc --noEmit` limpio en `server/` y `client/`, `combate.e2e.mjs` en verde.

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

Confirmado por el streamer (2026-08-30): "para hacer guisos y sopas necesitas llenar la olla de agua y ponerla al fuego hasta que se caliente, un tiempo determinado". `cocina:llenarAgua {construccionId}` — marca la vasija `conAgua:true` y arranca el cronómetro (`calentandoDesde`). El hervor se **deriva** de ese timestamp, nunca se guarda un booleano aparte (mismo patrón perezoso que agua/fertilizante de agricultura): `estaHirviendo = conAgua && (ahora - calentandoDesde) >= TIEMPO_HERVIR_MS` (20 segundos REALES, no días de mundo — esto es un fogón encendido ahora mismo, `cocina/cocina.ts::TIEMPO_HERVIR_MS`).

**Cambio de contrato (pedido 2026-08-30, `docs/GDD_Inventario.md` §9):** el agua dejó de ser "libre". El streamer: *"para cocinar necesitas un ingrediente que sea agua, en este caso necesitarás meter un cubo con agua a la olla como ingrediente"*. `cocina:llenarAgua` ahora exige `{construccionId, instanciaId}` — `instanciaId` es un recipiente PROPIO (cantimplora/`cubo_madera`, llenado antes con `recipiente:llenar` junto al agua) que debe tener agua encima; se vacía ENTERO como ingrediente (todo-o-nada, no volumen parcial) y el resto del flujo (`conAgua`, cronómetro, `estaHirviendo`) sigue exactamente igual que antes. Sin recipiente con agua a mano, error "necesitas un recipiente (cantimplora/cubo) con agua para meter en la olla".

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

- **✅ Confirmado (2026-08-30): "sí, para hacer guisos y sopas necesitas llenar la olla de agua y ponerla al fuego hasta que se caliente"** — implementado tal cual (§3.1): `cocina:llenarAgua` + 20s reales de hervor antes de poder añadir ingredientes. ~~El agua es "libre"~~ **resuelto (2026-08-30, ver §3.1): ya cuesta un recipiente con agua** (cantimplora/`cubo_madera`, `docs/GDD_Inventario.md` §9) — deja de ser gratis.
- La calidad del plato depende del TIPO de ingrediente, no de la cantidad de cada uno (§4) — decisión de diseño para que "misma receta = mismo plato" tenga sentido con identidad cacheada.
- Sin caducidad ni deterioro de los platos cocinados — se comportan como cualquier otro consumible del inventario.
- Los 20 segundos de hervor (`TIEMPO_HERVIR_MS`) son un valor de partida — fácil de ajustar en `cocina/cocina.ts` sin tocar el resto.

---

# Cocina v2 (2026-08-30) — más vasijas, más formas de cocinar, vinculado a oficios

Pedido explícito del streamer el mismo día: ampliar variedad de comida y tipos de crafteo, todo entrelazado con lo que ya existe (oficios, mobiliario). Resumen de lo nuevo: sartén, olla grande, tinaja de batidos, ensalada, bocadillo, pan completo, quesos/mantequilla, y 9 recetas de crafteo repartidas en 5 oficios.

## 8. Familia de plato — corrección de diseño y generalización de la identidad

**Bug de v1 detectado y corregido al generalizar**: `clavePlato` cacheaba la identidad de un plato solo por el CONJUNTO de ingredientes, sin la vasija — así que cocinar "carne_roja" sola en una olla (Sopa) y luego en una sartén (Frito) habría reusado el mismo itemId cacheado, mostrando el nombre equivocado la segunda vez. Corregido: `clavePlato(familia, itemIds)` ahora antepone la **familia de plato** a la clave.

`familiaDePlato(vasija, ingredientes)` (`cocina/cocina.ts`) resuelve la familia — FIJA para casi todas las vasijas, DINÁMICA solo para la sartén:

| vasija (`cocina.vasija` en catálogo) | familia | prefijo del nombre |
|---|---|---|
| `cuenco` | sopa | Sopa |
| `cazuela` | guiso | Guiso |
| `olla` | sopa | Sopa (antes "Estofado" en v1 — corregido para que "en olla, sopas" cuadre con el pedido) |
| `olla_grande` | sopa | Sopa (misma familia que `olla`, solo más escala) |
| `cuenco_grande` (sartén) | frito SI todos los ingredientes son de origen animal, si no estofado | Frito / Estofado |
| `tinaja` | batido | Batido |
| — (sin vasija) | ensalada / bocadillo | Ensalada / Bocadillo |

`cocina.vasija` pasó de ser un enum cerrado (`"cuenco"\|"cazuela"\|"olla"`) a un string libre — cocina v2 añadió tipos que v1 no anticipaba, y la lista puede seguir creciendo sin tocar el tipo (CLAUDE.md §7).

## 9. Vasijas nuevas

Todas reusan el MISMO protocolo genérico que v1 (`cocina:llenarAgua`/`cocina:anadir`/`cocina:preparar`/`cocina:consultar`) — la generalización fue de datos, no de mensajes nuevos:

- **`cuenco_barro_grande`** (sartén) — `hierveAgua:false` (campo nuevo en `cocina`, default `true`): fuego directo, sin esperar hervor. Hasta 4 ingredientes distintos. Da **Frito** (solo carne/pescado/huevo — todo origen animal) o **Estofado** (en cuanto hay algo vegetal).
- **`olla_grande`** — hasta 20 raciones (capacidad = tope de raciones, ver §10), sigue exigiendo agua/hervor como la olla normal. Colocación EXCLUSIVA: pegada a una `estructura_palos` (huella 2x2, más grande que el resto de vasijas — un caldero de esa escala ocupa más).
- **`estructura_palos`** — trípode de madera sobre el fuego; prerrequisito de `olla_grande`. A su vez exige estar pegada a `hoguera_campamento` o `chimenea_cocina` (ver §11, mecanismo de adyacencia). También cocina "tal cual" como una hoguera normal.
- **`tinaja_batidos`** — sin fuego ni hervor. Filtro real de ingredientes (`aceptaEnVasija`): solo `leche` o algo con `categoriaRecurso` en `baya`/`fruta`/`fruta_cultivada` — "obviamente no con carne, sobre todo bayas y frutas", pedido explícito. Cualquier otro ingrediente da error "eso no sirve para un batido".
- **`chimenea_cocina`** — variante de interior de `hoguera_campamento`, mismo comportamiento (`esVasija:false`). La `chimenea` que coloca el bakeador de interiores en las casas es una pieza DISTINTA (decoración automática, capa `elementos.json`) — deliberadamente no enganchada aquí, sería una integración aparte (interactuar con mobiliario colocado por el bake, no por el jugador).

**Raciones topadas por capacidad** (corrección sobre v1, pedido explícito: "cada olla puede dar 6 cuencos llenos"): `cocinarPlato(ingredientes, capacidadMax)` ahora topa `platos` en la capacidad de la vasija — antes escalaba sin límite con la cantidad metida. La olla normal (capacidad 6) da como mucho 6 raciones por tanda; la olla grande (capacidad 20), hasta 20.

## 10. Mecanismo nuevo y reutilizable: "requiere construcción adyacente"

`estructura_palos`/`olla_grande` necesitaban un requisito de colocación que no existía: no "agua junto a la huella" (ya cubierto por `hayAguaAdyacente`/`requiereAgua`, molino de agua y pesca pasiva) sino **otra construcción concreta** junto a la huella. Añadido de forma genérica en `server/src/construccion/construccion.ts::hayConstruibleAdyacente` + campo `requiereConstruibleAdyacente?: string | string[]` en `catalogo.ts` (acepta un id exacto o una lista — "cualquiera de estos vale"), comprobado en `validarColocacion` igual que el resto de reglas de adyacencia. Reutilizable para cualquier futura pieza que necesite "constrúyeme al lado de X" sin volver a escribir la comprobación.

Cadena resultante: `olla_grande` exige `estructura_palos` adyacente; `estructura_palos` exige `hoguera_campamento` o `chimenea_cocina` adyacente — así "la olla grande se pone exclusivamente sobre una hoguera con estructura de palos" (pedido literal) queda en dos pasos encadenados en vez de una comprobación multi-tipo de una sola vez.

## 11. Craftear las vasijas — vinculado a oficios, sin abrir "construcción cuesta materiales" para todo el juego

Pedido explícito: "olla se hace de barro o de metal, así que es un crafteo a añadir a herrería". `olla_barro` (alfarero) y `olla_metal` (herrero) son dos recetas alternativas — ninguna de las dos bloquea colocar la `olla_cocina` normal, que sigue gratis como CUALQUIER otro construible del juego hoy (ningún mueble cuesta materiales al colocarse, en ningún sistema — cambiar eso sería una decisión de arquitectura mayor, fuera del alcance de esta pasada).

Para las piezas GENUINAMENTE NUEVAS de cocina v2 sí se introdujo un mecanismo nuevo, acotado a ellas: `requiereItemColocar?: string` (`catalogo.ts`) — un itemId que hace falta tener en el inventario para colocar esa construible en concreto, consumido al colocarse (`"construir"`, `RoomExteriorBase.ts`). Se aplica a `cuenco_barro_grande`, `olla_grande` (exige `olla_metal` específicamente — un caldero de 20 raciones va reforzado, no de barro), `tinaja_batidos`, `recipiente_queso` y `estructura_palos`. El resto del juego, `olla_cocina`/`cuenco_cocina`/`cazuela_cocina`/`hoguera_campamento`/`chimenea_cocina` incluidas, sigue exactamente igual de gratis que siempre.

9 recetas nuevas en `items/catalogo/recetas.json` (mismo mecanismo `RecetaCrafteo` de `docs/GDD_Crafteo.md`, sin cambios):

| receta | oficio | mesa |
|---|---|---|
| `harina` | molinero | `molino_mano` |
| `masa_pan` | panadero | `amasadora`/`artesa_amasado` |
| `pan` | panadero | `horno_pan` |
| `olla_barro` | alfarero | `torno_alfarero` |
| `olla_metal` | herrero | `yunque_tocon` |
| `cuenco_barro_grande` | alfarero | `torno_alfarero` |
| `tinaja_batidos` | alfarero | `horno_ceramica` |
| `recipiente_queso` | alfarero | `torno_alfarero` |
| `estructura_palos` | carpintero | `banco_carpintero` |

`harina`/`masa_pan`/`pan` cierran de paso un hueco real: el molinero tenía edificio y NPC desde `docs/GDD_Profesiones.md` pero CERO recetas — ahora muele grano de verdad.

## 12. Asados directos al fuego — renombrados

Pedido explícito: "la carne pescado se podrá hacer directo en fuego solo y pasa a nombre y estado Asado". `cocina:simple` (sin vasija) ahora produce `asado_<itemId>` en vez del genérico `<itemId>_cocinado` cuando el ingrediente es de `origenCocina:"animal"` (carne ×4, pescado ×3, marisco, y el `huevo` frito — "asado_huevo", nuevo). El resto (fruta, baya, trigo...) se queda con el sufijo genérico "_cocinado", tiene más sentido para vegetales que "asado".

## 13. Ensalada y bocadillo — combinación abierta SIN vasija persistida

Dos verbos nuevos, mismo motor de identidad/caché que un plato de vasija (`clavePlato`/`nombrePlato`/`platos_creados`) pero SIN estado persistido en ninguna construcción — resuelven todo en un único mensaje, instantáneo:

- **`cocina:ensalada`** — cortar verduras/frutas crudas con `cuchillo_cocina` (en inventario, no se consume — mismo gating que `cuchillo_desollar`) junto a CUALQUIER vasija (`esVasija:true`, sin exigir fuego/hervor). Solo acepta ingredientes con `categoriaRecurso` en `hortaliza`/`baya`/`fruta`/`fruta_cultivada` (`aptoParaEnsalada`) — al menos 2 tipos distintos.
- **`cocina:bocadillo`** — 2 `rebanada_pan` + 1 o más rellenos (cualquier consumible con `restauraMultiple`: quesos, asados, ensaladas...). "Sin cuenco ni olla ni nada", pedido literal — no exige estar junto a ninguna construcción. La propia rebanada cuenta como un ingrediente más en la media de stats (`aportesDesdeRestaura`, adaptador que reutiliza `cocinarPlato` para ingredientes YA cocinados en vez de crudos).
- **`cocina:cortarPan`** — 1 `pan` + `cuchillo_cocina` → 6 `rebanada_pan`. Mismo verbo de corte, sin combinar nada (no pasa por `cocinarPlato`).

## 14. Pan

Reaprovecha dos muebles de panadería que existían en el catálogo desde `docs/GDD_Profesiones.md` pero sin ninguna mecánica enganchada (`amasadora`, `horno_pan`) — receta de crafteo normal, sin mensajes nuevos:

`trigo` → (receta `harina`, molinero) → `harina` → (receta `masa_pan`, panadero, agua libre igual que el hervor) → `masa_pan` → (receta `pan`, panadero) → `pan` (comible, `restauraMultiple`) → (`cocina:cortarPan`) → 6× `rebanada_pan` → (`cocina:bocadillo` + relleno) → Bocadillo.

## 15. Quesos y mantequilla

Pedido explícito: "leche + algún ingrediente en un recipiente específico, al pasar tiempo da mantequilla o queso con stats potentes". Nuevo mueble `recipiente_queso` (`cocina.quesera:true` en el catálogo) + módulo puro `server/src/construccion/cuajado.ts`, mismo espíritu que el curtido de pieles (`curtido.ts`: lote único, resuelto por timestamp, sin tick de servidor) pero simplificado — no encaja igual de bien el modelo "material a granel + piezas discretas" del curtidor cuando solo hay UN insumo (leche) y el resultado depende de una elección booleana (con/sin sal), así que se escribió aparte en vez de forzar el encaje.

- `quesera:cargarLeche` — carga leche a granel (como el `curtidor:cargarMaterial`).
- `quesera:iniciarLote {conSal}` — arranca el lote; consume 4 `leche` de stock siempre, y si `conSal:true` exige y consume 1 `sal` del INVENTARIO del jugador en ese momento (no es stock a granel del mueble — 1 unidad no merece el mecanismo de "cargar material" completo).
- `quesera:recolectar` — sin sal y tras 2 horas reales da `mantequilla`; con sal y tras 8 horas reales da `queso` (cura más larga, stats más fuertes — pedido explícito "stats potentes" en ambos, más altos que un plato normal de vasija).

## 16. Resumen de huecos honestos que quedan

- **Cliente**: el panel de cocina (`panelCocina.ts`) sigue siendo el mismo PLACEHOLDER de testeo de v1 (inputs numéricos con el id del ítem a mano) — se generalizó lo mínimo para no mostrar mal las vasijas nuevas (título genérico, salta el paso de agua si `hierveAgua:false`), pero NO tiene botones/UI dedicada para ensalada, bocadillo, cortar pan ni la quesera — esos verbos están completos y probados en servidor, sin interfaz de cliente todavía. Mismo criterio que el resto del proyecto: toda la UI de este juego es placeholder a día de hoy.
- Sin distinción de tipo de leche por especie (vaca/cabra/oveja) — sigue siendo un único ítem genérico `leche`, mismo criterio que ya tenía Ganadería antes de esta pasada.
- `recipiente_queso` es un mueble único en el catálogo (sin variantes de capacidad tipo cuenco/cazuela/olla) — si hiciera falta una versión grande, se añade después, mismo patrón de catálogo.

## 17. Ampliación 2026-08-30: fallback al suelo y desgaste de `cuchillo_cocina`

Ver `docs/GDD_Crafteo.md` (sección de la misma ampliación) para el detalle técnico — se aplicó a la vez a los dos sistemas por ser el mismo mecanismo:

- **`cocina:preparar`, ensalada y bocadillo** ya no dan error "no tienes hueco" perdiendo el plato ya cocinado — usan `entregarOSoltar` (`RoomExteriorBase.ts`), que lo deja en el suelo a los pies del jugador si la mochila no tiene hueco o peso. `cocina:preparado` manda `enSuelo:boolean`.
- **`cuchillo_cocina`** (exigido para ensalada y cortar pan) ahora tiene `durabilidadMax:40, desgastePorUso:1` en `items.json` y pierde durabilidad real con cada corte — antes solo se comprobaba que estuviera en el inventario, nunca se desgastaba. Un cuchillo roto bloquea la acción.
