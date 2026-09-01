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

## 6. Aplicación del buff — por qué NO es un multiplicador sobre el stat propio

Bug real encontrado (y corregido) durante la implementación: `defensaFisica`/`ataqueMagico`/`defensaMagica` valen **0** en el caso más común (sin armadura puesta, sin oficio de magia). Un buff `stat × (1 + pct/100)` sobre una base de 0 da SIEMPRE 0 — la poción sería inerte justo en el caso más frecuente. `aplicarBuffsPocion` calcula el % sobre `REFERENCIA_STAT_ALQUIMIA` (20, un arma/armadura tier 1-2 real del catálogo) y lo SUMA como bonus plano: `magnitudPct=15` → siempre `+3`, tenga el jugador algo equipado o no.

## 7. Verificación

- `server/test/estacionFuego.test.ts` (10 tests) — motor genérico de temperatura/pureza.
- `server/test/alquimia.test.ts` (21 tests) — las 3 reglas de negativo/positivo/mezcla avanzada exactas del pedido, la sesión interactiva, el escalado por pureza, el bug de stat-base-0 (regresión explícita).
- `server/test/alquimia.e2e.mjs` — protocolo real contra el servidor: allowlist de ingredientes, sesión completa (iniciar→avivar→colar), mezcla avanzada real (4 bonos garantizados con los 3 catalizadores del juego), buff real aplicado a `player.ataque`/`defensa` tras beber, cancelado sin devolución.

## 8. Pendiente (no mecanismo, contenido/UI)

- **Sin panel de cliente todavía** (mismo estado que crafteo/forja) — protocolo real vía `window.__test`.
- Cocina: pedido explícito de reutilizar `estacionFuego.ts` para un minijuego análogo en las vasijas de cocina existentes (`server/src/cocina/cocina.ts`, ya completo y determinista) — no abordado en esta pasada, mecanismo genérico ya listo para ello.
