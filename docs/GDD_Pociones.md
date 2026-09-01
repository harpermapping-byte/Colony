# GDD — Pociones: alquimia probabilística del curandero

## 0. Pedido del streamer (2026-09-01)

Reglas de negocio exactas que debía aplicar el servidor:

1. **Negativo** — 10% de probabilidad base de un efecto negativo (magnitud 1-5%). Cada ingrediente "corruptivo" ÚNICO distinto metido en la poción suma +25% acumulativo a esa probabilidad.
2. **Positivo** — bonos estándar 1-3% de magnitud; "cuantos más bonos positivos se intenten, mayor dificultad matemática calcula el servidor para que salgan". Cada ingrediente "catalizador/positivo" ÚNICO da un 25% acumulativo de forzar 2 o 3 bonos de golpe. Combinar varios catalizadores distintos ("mezcla avanzada") desbloquea hasta 4 bonos simultáneos, con magnitud subida a 5-15%.

Después, en un segundo pase (mismo día): "mismo sistema de activarse que la del herrero" (sesión interactiva real-time, no un crafteo instantáneo), un listado curado de qué materiales sirven de ingrediente ("esos serán los únicos que sirvan, el resto no dejará meterlos"), y la mesa: el `caldero` ya existente en el catálogo (decorativo hasta ahora) craftéandose a partir de curandero nivel 2.

## 1. Motor puro — `server/src/construccion/alquimia.ts`

### 1.1 Los 4 efectos posibles

En vez de inventar un catálogo de "tipos de efecto" nuevo, los 4 posibles bonos/penalizaciones son los 4 campos que YA existen en `StatsEquipo` (`server/src/inventario/inventario.ts`): `ataqueFisico`, `defensaFisica`, `ataqueMagico`, `defensaMagica`. Encaja exacto con "hasta 4 bonus simultáneos" de la mezcla avanzada — no es casualidad, es la señal de que el pool de efectos correcto era ese.

### 1.2 `prepararPocion(ingredientes, rnd?, cfg?)` — la tirada

Dado un array de `{itemId, corruptivo?, catalizador?}` (los flags los resuelve quien llama desde el catálogo, este módulo no toca `CatalogoItems` — mismo criterio de desacoplo que `pathfindingArena.ts`), calcula:

- **Negativo**: `probNegativo = min(1, 0.10 + 0.25 × corruptivosÚnicos)`. Si dispara: 1 stat al azar del pool de 4, magnitud `-(1 a 5)%`.
- **Positivo — mezcla avanzada** (`catalizadoresÚnicos >= 3`): SIEMPRE 4 bonos (los 4 stats), magnitud `5-15%` cada uno. Incondicional una vez desbloqueada.
- **Positivo — forzado** (si no hay mezcla avanzada): `probForzado = 0.25 × catalizadoresÚnicos`. Si dispara: 2 ó 3 bonos (50/50), magnitud estándar `1-3%`.
- **Positivo — intento estándar** (si no hay catalizador o no disparó el forzado): un intento por cada catalizador único usado, cada uno con `probÉxito = 0.7 / nºIntento` (decreciente armónica — intento 1: 70%, intento 2: 35%, intento 3: 23%...) — la interpretación concreta de "mayor dificultad matemática cuantos más se intenten" (el streamer no dio fórmula exacta, esta es la elegida, documentada y con los números en `CONFIG_ALQUIMIA_DEFECTO` para poder ajustarla sin tocar lógica).

Los stats de los bonos positivos salen de un Fisher-Yates del pool de 4 (`rnd` inyectable), nunca se repite un stat dentro de la misma tirada.

### 1.3 Sesión interactiva — "mismo sistema de activarse que la del herrero"

`estacionFuego.ts` (NUEVO, genérico) — extraído de `herreria.ts` para REUTILIZARSE: gestionar una temperatura entre avivar/enfriar durante un rato, terminar con una "pureza" 0..1 = fracción del tiempo total que la temperatura estuvo dentro de la ventana objetivo. Sin fases discretas de golpe (a diferencia de la forja): aquí es continuo, con muestreo interno cada 0.25s para que un hueco largo entre acciones no compute "todo dentro" o "todo fuera" en bloque.

`alquimia.ts` envuelve esto: `iniciarSesionAlquimia(ingredientes, rnd?)` tira `prepararPocion` DE UNA VEZ (congelado, igual que crafteo.ts congela `terminaEn` al iniciar) y arranca la `SesionEstacion`; `avivarAlquimia`/`enfriarAlquimia` delegan en `estacionFuego.ts`; `colarPocion` (termina la sesión) escala la MAGNITUD de cada efecto ya tirado por `FACTOR_PUREZA_MINIMO + (1-FACTOR_PUREZA_MINIMO) × pureza` (0.4 a 1.0 — gestión pésima del fuego sigue dando el 40% del efecto, nunca 0: los ingredientes son la parte fuerte del resultado, gestionar el caldero solo lo redondea). **Nunca cambia QUÉ stats salieron ni el signo** — solo su magnitud.

`CONFIG_ESTACION_ALQUIMIA`: ventana objetivo 55-80°, `duracionMinimaSeg: 8` (no se puede colar antes, evita "colar al segundo 1" con pureza artificialmente alta por poca muestra).

### 1.4 Ampliación del pool de efectos (pedido 2026-09-01)

Pedido literal: *"un bonus sea tambien mas velocidad, otro el doble xp por acciones de oficio, otro de x2 en produccion de crafteos, otro mas vida otro mas stamina otro mas carga de peso otro de sigilo(los bandidos no e atacaran ni animales) en negativo velocidad reducida vida reducida stamina reducida"*. Dos familias nuevas en `alquimia.ts`, un `EfectoPocion`/`BuffPocion` que pasó a discriminated union (`{categoria:"stat",...} | {categoria:"especial",...}`) para poder expresarlas sin forzar ninguna a la forma de la otra:

- **`StatAlquimia` de magnitud** — `velocidad`/`vida`/`estamina`/`carga` se suman a los 4 stats de combate ya existentes. `POOL_STATS_NEGATIVOS` (7: los 4 de combate + velocidad/vida/estamina) es el pool del efecto de riesgo — el streamer pidió negativo explícito para esos 3 pero NO para "carga", así que "carga reducida" NO existe (no se inventa contrapartida no pedida). `POOL_STATS_ALQUIMIA` (8) es el de negativos + carga, para los bonos positivos.
- **`EfectoEspecial` binario** — `xpOficioX2`/`produccionCrafteoX2`/`sigilo` no tienen magnitud continua (o están activos o no), así que viven en un pool aparte (`POOL_ESPECIALES_ALQUIMIA`, 3) que solo participa en los bonos POSITIVOS (nunca en el negativo — el streamer no pidió "media XP" ni nada parecido de contrapartida).

`prepararPocion` reutiliza el MISMO mecanismo de siempre sin tocar la lógica de probabilidades del pedido original: el negativo sigue tirando de un solo pool (ahora `POOL_STATS_NEGATIVOS`, 7 en vez de 4); los positivos siguen barajando-y-cortando un pool (ahora `[...POOL_STATS_ALQUIMIA, ...POOL_ESPECIALES_ALQUIMIA]`, 11 en vez de 4) y asignan magnitud SOLO a los que salen "stat" — un especial se cuela en la lista tal cual, sin tirada de magnitud. Efecto colateral querido: antes, con un pool de exactamente 4 elementos, "mezcla avanzada" (barajar+cortar en 4) daba SIEMPRE los 4 stats de combate — con 11 elementos sigue garantizando 4 bonos simultáneos de golpe (mismo contrato "incondicional una vez desbloqueada"), pero ahora CUÁLES de los 11 es genuinamente aleatorio. Verificado en un E2E real: una tirada real dio `vida + produccionCrafteoX2 + sigilo + defensaMagica`, otra dio los 4 stats de combate/vida — la variedad es real, no solo teórica.

**Cómo se aplica cada efecto nuevo** (todos en `RoomExteriorBase.ts`, ninguno pasa por `aplicarBuffsPocion`/`StatsConBuffs`, que se quedó EXCLUSIVAMENTE para los 4 stats de combate — ver §6 por qué):

| Efecto | Dónde engancha | Mecanismo |
|---|---|---|
| `velocidad` | `actualizarMovimiento` (multiplicador junto a fractura/gripe/crítico) | `factorBuffPocion` multiplicativo directo |
| `vida` | `vidaMaximaConBuffs` (helper), usado en `otorgarXpAtributo` rama resistencia, `aplicarInanicionA` (CADA tick — el que de verdad mantiene vidaMax al día con un buff que caduca) y `manejarPocionBeber` | `factorBuffPocion` multiplicativo directo sobre `vidaMaximaPorResistencia(nivel)` |
| `estamina` | gasto de sprint (`ESTAMINA_GASTO_POR_SEG_CORRIENDO`) en `actualizarMovimiento` | `factorGastoEstaminaPocion`, signo INVERTIDO: "+estamina" abarata el gasto, no sube un máximo (no existe: `VITAL_MAX` es un techo fijo compartido por los 5 vitales, `vitales.ts`) |
| `carga` | `pesoMaximoConBuffs` (helper), sustituye las 7 llamadas directas a `pesoMaximoTransportable` | `factorBuffPocion` multiplicativo directo |
| `xpOficioX2` | `xpConBuffPocion` (helper) envolviendo el `delta` en las 7 llamadas de gameplay a `bd.sumarXpOficio` (el `admin:debug:maxOficio` queda fuera, no es una ganancia real) | `tieneEspecialActivo` — SOLO XP de oficio, la de atributos (`otorgarXpAtributo`) no se pidió |
| `produccionCrafteoX2` | `manejarCrafteoIniciar` congela `bonusCantidadPocion` (1 = +100%) en `craftesEnCurso`, sumado a `bonusCantidad`/`bonusCantidadOficio` al recolectar — MISMA mecánica que los módulos de cantidad, cero código nuevo. Ampliado 2026-09-01 a `cocina:preparar`/`SesionCocina` (docs/GDD_Cocina.md §18.4): las raciones de un plato son "resultado.cantidad" igual que un crafteo | Alcance deliberado: crafteo.ts + cocina (insumos→cantidad). Herrería (`resultadoPerfecto`, una pieza de equipo única) y la propia poción (una instancia con tirada propia) quedan fuera — duplicar una espada encantada o una poción no tiene sentido de diseño |
| `sigilo` | `verificarAgroFauna`, ambos loops (fauna peligrosa Y patrullas bandidas) excluyen a quien `tieneSigiloActivo` de ser elegido `masCercano` | Alcance deliberado: solo PREVIENE un agro NUEVO — no interrumpe un combate ya en curso (el streamer pidió "no le atacarán", no "puede huir de en medio de una pelea") |

Los 4 stats de magnitud nuevos usan un factor **multiplicativo directo** sobre su base real (`1 + pct/100`, suelo `0.2` para no dejar nunca un stat en 0/negativo) — a propósito DISTINTO del aditivo-desde-referencia-fija de los 4 de combate (§6): `vidaMax`/peso máximo/velocidad NUNCA son 0 en la ruta normal (siempre hay algo de vida, de carga, de velocidad de partida), así que no existe el bug de "base 0 hace el buff inerte" que sí justificaba la referencia fija en ataque/defensa — multiplicar directo es más simple y además más intuitivo (un +15% de vida da más HP plano a nivel 10 que a nivel 1, proporcional).

## 2. Ingredientes — allowlist real (no "cualquier cosa")

"Esos serán los únicos que sirvan, el resto no dejará meterlos": 3 flags opcionales nuevos en `EntradaCatalogoItem` (`server/src/inventario/inventario.ts`) — `alquimiaIngrediente` (neutro, admitido pero sin efecto en la tirada), `alquimiaCorruptivo`, `alquimiaCatalizador`. `manejarAlquimiaIniciar` rechaza cualquier instancia cuyo catálogo no lleve NINGUNO de los 3.

Auditoría real del catálogo (`items/catalogo/items.json`, tipo `"recurso"`, temática hierba/hongo/raíz — se excluyó `hoja` a pesar del nombre: es el ítem de higiene `higiene:cagar`, no un ingrediente; se excluyeron baya/fruta/tomate/fresa: son cultivos de cocina, no de herboristería):

| itemId | flag | por qué |
|---|---|---|
| `hierba_venenosa`, `azufre` | corruptivo | tóxico/mineral inestable — 2 distintos posibles, `probNegativo` tope real 0.60 (0.10 + 0.25×2) |
| `hierba_curativa`, `flor_medicinal`, `hongo_medicinal` | catalizador | los 3 ingredientes "medicinales" reales — exactamente 3, así que la mezcla avanzada (≥3 catalizadores distintos) solo se desbloquea usando LOS TRES a la vez, un combo deliberado |
| `hierba_aromatica`, `hierba_comestible`, `hongo_comestible`, `raiz_comestible`, `miel`, `sal`, `baya`, `fruta` | ingrediente (neutro) | relleno — hace bulto en la mezcla (2-6 ingredientes por poción) sin arriesgar ni forzar nada |

13 ingredientes admitidos en total. La mayoría (hierbas/hongos/raíz curandero, azufre, sal) YA existían en el catálogo desde antes (recolección/minería) pero sin receta que los consumiera; baya/fruta ya se usaban en cocina y ahora sirven también de relleno aquí.

## 3. Mesa — `caldero`

`interiores/catalogo/elementos.json::caldero` ya existía (decorativo, `sala_alquimia`/`NOCOMUN_ALQUIMIA_MAGIA`) pero sin `nivelOficioMinimo` — ahora `{ oficio: "curandero", nivel: 2 }` + `temasProfesion: ["alquimia"]`, igual que cualquier mesa de oficio del catálogo (mismo mecanismo de docs/GDD_Crafteo.md §7bis). No se craftea con la RecetaCrafteo de siempre: `manejarAlquimiaIniciar` es su PROPIO camino (ingredientes libres, no una lista fija de insumos), pero el gate de nivel se lee del MISMO catálogo de construcción (`cargarCatalogoConstruible().get("caldero").nivelOficioMinimo`), sin duplicar el número 2 en dos sitios.

## 4. Protocolo (`RoomExteriorBase.ts`)

- `alquimia:iniciar {construccionId, instanciaIds[]}` — valida caldero real + nivel de curandero + 2-6 ingredientes de la allowlist (sin repetir instancia) → descuenta YA (nunca se devuelve al cancelar, mismo criterio que crafteo/forja) → tira `prepararPocion` → `alquimia:iniciado {cfg, sesion}`.
- `alquimia:accion {accion:"avivar"|"enfriar"}` → `alquimia:progreso {sesion}`.
- `alquimia:colar` → resuelve pureza, entrega `pocion_alquimica` con la tirada real adjunta A LA INSTANCIA (`agregarItem` ganó un parámetro `extra?: Partial<ItemInstancia>` para esto — el bonus de una poción, a diferencia del de herrería, SÍ puede vivir en la instancia porque una poción se bebe directo del inventario, nunca pasa por un sistema que solo guarde `itemId` como el equipo — ver §5), otorga XP de curandero → `alquimia:completado {itemId, instanciaId, cantidad, pureza, efectos, xp, nivel, enSuelo}`.
- `alquimia:cancelar` → `alquimia:cancelado`.
- `pocion:beber {instanciaId}` → consume la poción, convierte sus efectos en `BuffPocion[]` con caducidad real (`crearBuffsPocion`, duración 10 min) guardados en `buffsPocionPorSesion` (efímero, como `montadoPorSesion` — nunca persistido, se pierde al desconectar) → recalcula stats YA (`recalcularStatsJugador`) → `pocion:bebida {efectos}`.

Igual que el minijuego de forja: movimiento bloqueado mientras `alquimiasEnCurso.has(sessionId)` (mismo `movimientoBloqueado` del handler genérico de `"input"`), doble-inicio rechazado, limpieza en `onLeave`.

## 5. Por qué el bonus vive en la INSTANCIA (a diferencia de herrería)

Decisión verificada contra el código real antes de implementar (mismo criterio que se usó para decidir el bonus de herrería, docs/GDD_Crafteo.md §7ter): `SlotsEquipo` (equipo del jugador) guarda SOLO el `itemId` por slot — un arma/armadura equipada pierde cualquier dato de instancia (por eso el bonus de herrería es un itemId de catálogo `_bonificado` aparte). Una POCIÓN nunca pasa por ahí: se bebe directo desde el inventario (`pocion:beber` lee `ItemInstancia.efectoPocion` y la consume en el momento), así que el resultado estocástico SÍ puede vivir como campo opcional en la instancia — mismo patrón que `durabilidad`/`liquido`, sin necesitar 1 entrada de catálogo por cada combinación posible de efectos (que sería intratable: los efectos son continuos, no discretos).

## 6. Aplicación del buff — por qué NO es un multiplicador sobre el stat propio (los 4 de combate)

Bug real encontrado (y corregido) durante la implementación: `defensaFisica`/`ataqueMagico`/`defensaMagica` valen **0** en el caso más común (sin armadura puesta, sin oficio de magia). Un buff `stat × (1 + pct/100)` sobre una base de 0 da SIEMPRE 0 — la poción sería inerte justo en el caso más frecuente. `aplicarBuffsPocion` calcula el % sobre `REFERENCIA_STAT_ALQUIMIA` (20, un arma/armadura tier 1-2 real del catálogo) y lo SUMA como bonus plano: `magnitudPct=15` → siempre `+3`, tenga el jugador algo equipado o no.

`aplicarBuffsPocion`/`StatsConBuffs` se quedaron EXCLUSIVAMENTE para estos 4 (filtran por `categoria==="stat"` y por un `STATS_COMBATE` fijo, ya no todo `POOL_STATS_ALQUIMIA`) porque `vidaMax`/velocidad/peso máximo no tienen el problema de base 0 — ver §1.4 para su propio `factorBuffPocion` multiplicativo, deliberadamente distinto.

## 7. Verificación

- `server/test/estacionFuego.test.ts` (10 tests) — motor genérico de temperatura/pureza.
- `server/test/alquimia.test.ts` (37 tests) — las 3 reglas de negativo/positivo/mezcla avanzada exactas del pedido, la sesión interactiva, el escalado por pureza, el bug de stat-base-0 (regresión explícita), el pool ampliado (§1.4: `POOL_STATS_NEGATIVOS` sin "carga", especiales colándose de verdad en mezcla avanzada barriendo semillas, `factorBuffPocion`/`factorGastoEstaminaPocion`/`tieneEspecialActivo` puros).
- `server/test/alquimia.e2e.mjs` — protocolo real contra el servidor: allowlist de ingredientes, sesión completa (iniciar→avivar→colar), mezcla avanzada real (4 bonos garantizados, composición variable con el pool ampliado — verificado en corridas reales con mezclas de stat/especial distintas), buff real aplicado a las stats de combate que la tirada haya tocado tras beber, cancelado sin devolución.
- `server/test/agroFauna.e2e.mjs`/`herreria.e2e.mjs` re-verificados tras esta pasada (sigilo toca `verificarAgroFauna`, xpOficioX2/producción tocan el mismo `otorgarXpAtributo`/`sumarXpOficio`/`craftesEnCurso` que usa crafteo/forja) — sin regresión.

## 8. Pendiente (no mecanismo, contenido/UI)

- **Sin panel de cliente todavía** (mismo estado que crafteo/forja) — protocolo real vía `window.__test`.
- ~~Cocina: pedido explícito de reutilizar `estacionFuego.ts` para un minijuego análogo en las vasijas de cocina existentes~~ **HECHO 2026-09-01** — ver `docs/GDD_Cocina.md` §18.
- Los efectos nuevos de §1.4 no tienen todavía ninguna UI que muestre "tienes sigilo activo"/"doble XP activa" al jugador — mismo estado que el resto del proyecto (placeholder primero, UI real al final).

## 9. Color del líquido según ingredientes — el "listado" para generar el 3D (ampliación 2026-09-01)

Pedido literal: *"generen en listado las pociones para generar luego su 3d, con diferente color de liquido dentro dependiendo que intgredientes tenga, esto hara que haya diferentes props de colores de las pociones y luego tendran atributos cada una segun su crafteo"*. Confirma exactamente el diseño de §5: los ATRIBUTOS (la tirada de `efectoPocion`) ya vivían en la INSTANCIA, nunca en el catálogo — lo que faltaba era que el COLOR (el catálogo, el "listado") variara con los ingredientes, para que `taller-vox` pueda pintar props realmente distintos.

### 9.1 Por qué 5 variantes fijas, no un color por combinación exacta

Mismo criterio que §5 ("intratable" un itemId por combinación de EFECTOS) aplicado ahora al COLOR: el color depende de qué ingredientes entraron, no del roll — así que dos pociones con los mismos ingredientes son SIEMPRE del mismo color, aunque la tirada de efectos salga distinta cada vez (matiz importante: color = función de `corruptivosUnicos`/`catalizadoresUnicos`/`mezclaAvanzada`, nunca de `efectos`). Un pool continuo (un color por cada combinación posible de los 13 ingredientes) sería tan intratable como un itemId por combinación de efectos — así que, igual que ahí, se fija un pool PEQUEÑO de 5 categorías con prioridad (`alquimia.ts::colorPocion`, primera que aplica gana):

1. **`radiante`** — mezcla avanzada (3+ catalizadores). Manda SIEMPRE, aunque también haya corruptivos — es el resultado más especial (4 bonos garantizados), su color no debe "perderse" dentro de "inestable".
2. **`inestable`** — corruptivo Y catalizador a la vez (sin llegar a mezcla avanzada) — dos fuerzas en pugna.
3. **`toxica`** — solo corruptivo.
4. **`vital`** — solo catalizador (1-2, sin mezcla avanzada).
5. **`clara`** — ni corruptivo ni catalizador (relleno neutro solamente) — la base.

### 9.2 Catálogo — 5 entradas reales, no una con tinte en caliente

`pocion_alquimica` (única, genérica) se sustituye por `pocion_alquimica_clara/toxica/vital/inestable/radiante` en `items/catalogo/items.json` — mismo `tipo:"consumible", apilable:false` de siempre (sigue sin apilar: cada instancia lleva su propia tirada de `efectoPocion`, el color NO cambia ese motivo), cada una con su propio `colorDebug` (regla CLAUDE.md #2: el color visual sale del catálogo, nunca se calcula en caliente ni se duplica en una tabla aparte):

| color | colorDebug | condición |
|---|---|---|
| clara | `#d9c078` (ámbar pálido) | sin corruptivo ni catalizador |
| toxica | `#5a9a3a` (verde) | solo corruptivo |
| vital | `#c94a5a` (rojo) | solo catalizador |
| inestable | `#8a4a9a` (morado) | corruptivo + catalizador |
| radiante | `#f0c840` (dorado) | mezcla avanzada |

`itemIdPocion(color)` (`alquimia.ts`) da el itemId real; `colarPocion` calcula `color` a partir de `resultadoBase` y lo devuelve en `ResultadoColarPocion` — `manejarAlquimiaColar` (`RoomExteriorBase.ts`) usa `itemIdPocion(resultado.color!)` tanto para `entregarPocion` (que ganó un parámetro `itemId`, antes hardcodeado) como para el `itemId` del evento `alquimia:completado`. `manejarPocionBeber` dejó de comprobar `item.itemId === "pocion_alquimica"` (ya no existe, y ahora hay 5 posibles) — el criterio real siempre fue `item.efectoPocion` presente, que es lo único que de verdad identifica "esto es una poción bebible" (bug encontrado y corregido en esta misma pasada: sin este cambio, beber CUALQUIER poción habría quedado roto).

### 9.3 Generación 3D — `taller-vox/generar_comida.js` ya sabía pintar, cero generador nuevo

`generarFrasco` (arquetipo FRASCO, ya existente desde antes de esta pasada) pinta el vidrio con una versión oscurecida de `v.colorDebug` y el LÍQUIDO con `v.colorDebug` directo — 100% dirigido por catálogo, sin ningún parámetro de color hardcodeado dentro del generador. Bastó con sustituir la entrada única de `IDS_FRASCO` por las 5 nuevas para que las 5 variantes salgan con su bote realmente distinto, verificado generando la muestra (`node generar_comida.js --muestra`): paletas `["#776a42","#d9c078",...]` (clara), `["#325520","#5a9a3a",...]` (tóxica), `["#846e23","#f0c840",...]` (radiante) — el vidrio y el líquido escalan juntos desde el mismo `colorDebug`.

**Sin generar ni subir ningún `.glb` en esta pasada** — eso sigue el flujo de aprobación pactado (CLAUDE.md: "generar → revisar en el visor → aprobar/rehacer → exportar y SUBIR SOLO LOS APROBADOS"), pendiente de que el streamer lo revise cuando decida. Lo que esta pasada deja listo es el "listado" (el catálogo con 5 itemIds reales y su `colorDebug`) para que ese paso, cuando llegue, no tenga que tocar ni el catálogo ni el generador.

### 9.4 Verificado

- `server/test/alquimia.test.ts` — `colorPocion` (los 5 casos + prioridad radiante-sobre-inestable) y `itemIdPocion` puros; `colarPocion` devuelve `color` correcto.
- `server/test/inventario.test.ts` — conteo de catálogo actualizado (464→468: -1 genérica + 5 variantes).
- `server/test/alquimia.e2e.mjs` — reverificado contra el servidor real: la combinación de 3 catalizadores+1 corruptivo entrega `pocion_alquimica_radiante` de verdad (no la genérica de antes).
- `taller-vox/generar_comida.js --muestra` — paletas de color confirmadas distintas por variante.
- Vista previa rápida (swatches, no el frasco 3D final) generada y enseñada al streamer antes de dar la pasada por cerrada.
