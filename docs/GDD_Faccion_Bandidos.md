# GDD — Facción Bandida: economía viva + líder IA

Punto de partida: una especificación que trajo el streamer (redactada por Gemini) para un sistema de facciones/economía de asentamientos/líder bandido con IA. La arquitectura general (SQLite perezoso, IA de baja frecuencia con fallback determinista, bajas reales sin respawn mágico) encaja bien con la filosofía del proyecto — pero la propuesta no conocía el estado real del código, así que aquí se reconcilia con lo que YA EXISTE antes de escribir nada. Fase de "afinar antes de programar", mismo patrón que se usó para el bakeador de mazmorras.

## 1. Lo que la propuesta acierta de raíz (se mantiene tal cual)

- **SQLite perezoso vía `IAlmacenDatos`** (`server/src/datos/bd.ts`): ya es el patrón establecido — `mazmorras_estado` (cooldown de dungeon) es el precedente exacto. Las tablas nuevas (`asentamientos`, `tropas_asentamiento`, `memoria_lider`) encajan ahí sin fricción, mismo motor dual SQLite dev/Postgres prod.
- **Tick perezoso, sin 3D/físicas**: coherente con "generar una vez, nunca en directo" y con cómo ya funciona el reloj de mundo (`tiempoMundo()`, derivado del reloj real, sin estado propio).
- **IA de baja frecuencia con fallback determinista**: el patrón correcto para no reventar el free tier — pero **no hace falta un módulo `estrategiaLider.ts` nuevo desde cero**: `server/src/ia/` YA tiene Gemini/Groq con fallback y memoria RAG anti-repetición (enganchado hoy al diálogo de NPCs vía `HubRoom.ts`, mensaje `npc:hablar`). Lo correcto es un prompt/modo nuevo DENTRO de ese módulo, no una segunda tubería de llamadas a IA con su propia gestión de rate-limit/claves.
- **Bajas reales, sin respawn mágico**: correcto y coherente con "las tropas muertas no reaparecen" — pero (ver §3) esto depende de que exista un concepto mínimo de combate, que hoy NO está diseñado.

## 2. Fricciones reales con la arquitectura actual (investigado en el código, no supuesto)

### 2.1 Las "aldeas bandidas" ya existen — como contenido de mazmorra, no como capa estratégica

`mazmorras/catalogo/tipos_dungeon.json` ya tiene 5 tipos de asentamiento hostil (`aldea_bandidos`, `poblado_orco`, `guarida_piratas`, `asentamiento_cultistas`, `campamento_barbaros_grande`), con su propio tier `asentamiento_hostil` en `ciudades/catalogo/asentamientos.json` (muralla tosca, sin plaza de mercado — construido esta sesión). Pero son **POIs de mazmorra**: instancia bakeada una vez, enemigos con cooldown de 1h vía `DungeonRoom`, sin economía ni progresión.

La propuesta de Gemini imagina una facción que **compite y progresa con el tiempo** (recursos, niveles de muralla/equipo) — eso es un concepto distinto: una civilización viva, no un dungeon con temática de poblado. **Pregunta real de diseño** (§5): ¿la economía/IA se engancha a ESOS mismos asentamientos hostiles ya bakeados (dándoles una segunda vida como "base de operaciones" de la facción, además de ser dungeon), o es una tercera capa de asentamiento en el mapa exterior, aparte del sistema de mazmorras?

### 2.2 "Swap de muralla GLB" no tiene mecanismo hoy — es fácil de añadir, pero no es gratis

Investigado: la muralla se bakea UNA VEZ (`ciudades/src/generar.js`, material `empalizada`/`muralla_piedra` decidido por el tier en `def.muralla.material`) y se exporta como dato estático dentro de `indice.json`. El cliente (`sectorVisual.ts`, función `crearMurallaSector`) construye la geometría UNA VEZ al cargar el sector, leyendo `mod.material` del JSON — no hay ningún camino reactivo para cambiarla en vivo. Añadir un "nivel de muralla" leído de la BD es viable (el material YA está keyed por dato, no a fuego en código) pero implica: **(a)** que el cliente sepa el `nivel_muralla` al construir el sector (nueva llamada o campo en el estado inicial de `RegionRoom`, no solo `indice.json`), y **(b)** decidir si se actualiza en vivo mientras un jugador ya está mirando la muralla, o solo la próxima vez que el sector se carga/recarga. Recomiendo lo segundo para v1 (mucho más simple, coherente con "streaming de sectores" que ya recarga al alejarse/acercarse) — a confirmar.

### 2.3 Movimiento de patrullas en vivo choca con una regla ya fijada: "nunca A* en directo"

Investigado: `server/src/mundo/agentes.ts` (el sistema que ya mueve NPCs de aldea con rutina horaria) tiene como regla explícita en su propio comentario de cabecera: si falta el camino bakeado, TELEPORT — **nunca A* en el tick**. Los NPCs solo andan por caminos precalculados en el bake (`poblacion.json`). Una patrulla bandida que la IA manda "al camino este" con una orden dinámica no puede inventar una ruta nueva en vivo sin romper esa regla (que existe por coste: A* en directo en un server gratuito de Render no escala).

Recomiendo que la IA del líder **elija entre rutas ya precalculadas al hornear el mapa** (el propio bakeador de caminos ya calcula A* entre POIs/asentamientos una vez, offline) en vez de pedirle a la IA coordenadas libres — más barato, más robusto (una salida de IA mal formada no puede generar una ruta imposible), y respeta la regla existente sin abrir una excepción nueva.

Por el lado de la identidad/aspecto de cada soldado de la patrulla, no hay fricción: `personajes/src/generarEnemigo.js` ya genera aspecto totalmente desacoplado de la posición (variante de un pool pre-bakeado, `assets/enemigos/pool.json`) — encaja sin tocarlo con una patrulla que sí se mueve, solo hace falta un `Enemigo`-como-schema con posición actualizable en vez de fija.

### 2.4 Las bajas reales dependen de un sistema de combate que hoy no existe

`docs/Backlog_Mecanicas_Futuras.md` tiene "Combate — sin diseñar" como sección aparte, y `DungeonRoom` documenta explícitamente que los enemigos "aparecen quietos, sin movimiento/combate todavía — el streamer lo explicará aparte". La propuesta de Gemini asume que ya existe un evento de "jugador mata a una tropa" que pueda escribir en SQLite — ese gancho no existe todavía.

Recomiendo escribir el sistema de facción/economía/IA **con una costura clara y vacía donde debería enganchar el combate** (una función `marcarTropaMuerta(tropaId)` que hoy nadie llama, mismo patrón que `marcarMazmorraLimpiada` en `DungeonRoom` — persistencia lista, disparador pendiente del sistema de combate real), en vez de bloquear todo el sistema a que combate exista primero. Así la economía/IA/visual puede construirse y probarse ya (con bajas simuladas a mano en tests), y combate lo conecta cuando le toque su turno.

## 3. Encaje concreto por pieza (adaptado, no la propuesta literal)

| Pieza de la propuesta | Encaje real |
|---|---|
| Tablas SQLite (`asentamientos`, `tropas_asentamiento`, `memoria_lider`) | Se mantienen, mismo patrón `IAlmacenDatos` que `mazmorras_estado`. |
| Tick perezoso de economía | Nuevo módulo `server/src/mundo/economiaAsentamientos.ts`, tickeado igual que `tiempoMundo()`/`GestorAgentes` — sin 3D, solo aritmética + SQLite. |
| `estrategiaLider.ts` con IA cada 20-30 min | Nuevo PROMPT/modo dentro de `server/src/ia/` existente, no módulo aislado — reusa cliente Gemini/Groq, fallback y rate-limit ya construidos. |
| Salida JSON de la IA con órdenes | La salida debe ser un ÍNDICE/id sobre opciones ya precalculadas (ruta de patrulla, qué aldea neutral atacar de una lista corta) — nunca coordenadas libres ni rutas inventadas (§2.3). |
| Swap de GLB de muralla por `nivel_muralla` | Viable, aplicado en el próximo build del sector (no reactivo en caliente) — necesita exponer `nivel_muralla` al cliente en el join de `RegionRoom`, no solo en `indice.json` estático. |
| Patrullas en vivo con `rigHumanoide`/`ropa/` por `nivel_equipo` | Reusa 100% `generarEnemigo.js` + el mismo mecanismo de pool pre-bakeado que ya usan los enemigos de mazmorra — la novedad real es que SÍ se mueven, sobre rutas pre-bakeadas (§2.3), con un `Enemigo`-schema con posición viva en vez de fija. |
| Bajas reales sin respawn | Costura lista (`marcarTropaMuerta`), disparador real pendiente del sistema de combate (§2.4) — no bloquea el resto. |

## 4. Fuera de alcance de esta primera pasada (documentado, no descartado)

- Sistema de combate en sí (quién gana un enfrentamiento, daño, PvP) — pieza aparte, "el streamer lo explicará".
- Extinción total de la facción bandida si se destruyen todas sus aldeas — mecánica de fin de partida/evento global, depende de que las bajas reales ya funcionen primero.
- Ataques de la facción bandida A una aldea neutral con daño real a SU muralla/edificios — depende de combate.

## 5. Decisiones (streamer, confirmadas)

1. **Dónde vive la facción**: se engancha a los asentamientos hostiles YA bakeados por el sistema de mazmorras (`asentamiento_hostil` — `aldea_bandidos`, `poblado_orco`, `guarida_piratas`, `asentamiento_cultistas`, `campamento_barbaros_grande`). Nada de un tipo de asentamiento nuevo: estos ganan progresión de verdad además de seguir siendo dungeon.
2. **Swap de muralla**: solo al (re)cargar el sector — nada reactivo en caliente. `RegionRoom` expone `nivel_muralla` en el join; `sectorVisual.ts` lo usa igual que hoy usa `mod.material`, sin nuevo camino de actualización mientras el jugador ya está mirando.
3. **Movimiento de patrullas**: la IA elige entre rutas pre-bakeadas por el bakeador de caminos (offline, una vez) — nunca coordenadas libres ni A* en directo. Respeta la regla ya fijada en `agentes.ts`.

## 6. Plan de implementación por fases

**Fase 1 (HECHA, este commit) — capa de datos + tick de economía, sin IA ni visual todavía:**
- Tablas SQLite (`asentamientos`, `tropas_asentamiento`, `memoria_lider`) en ambos motores (`server/src/datos/bd.ts`, SQLite dev / Postgres prod), mismo patrón que `mazmorras_estado`. `IAlmacenDatos` gana `obtenerOCrearAsentamiento`, `listarAsentamientos`, `guardarAsentamiento`, `listarTropas`, `crearTropa`, `marcarTropaMuerta`, `registrarMemoriaLider`, `memoriaLiderReciente`.
- `server/src/mundo/economiaAsentamientos.ts`: `calcularTick` (función PURA: estado + población viva → estado siguiente, sin tocar SQLite — se prueba sola) y `ejecutarTickEconomia` (el único punto que lee/escribe de verdad). Consumo de comida y producción de madera/piedra/hierro por tropa viva; sube `nivelMuralla` (máx. 2: empalizada/piedra) y `nivelEquipo` (máx. 3) al alcanzar el umbral de recursos, descontando el coste. La comida nunca baja de 0 (pasar hambre, no números negativos — morir de hambre de verdad es mecánica de vitales/combate, fuera de alcance).
- `marcarTropaMuerta(tropaId)`: costura lista para cuando exista combate, sin disparador todavía (mismo patrón que `marcarMazmorraLimpiada`) — una baja NUNCA vuelve a `vivo`.
- Tests: `server/test/datos.test.ts` (asentamientos/tropas/memoria del líder) + `server/test/economiaAsentamientos.test.ts` (9 tests: determinismo, comida nunca negativa, umbral de muralla/equipo exacto, tope de nivel, tick real contra SQLite con tropas muertas excluidas de la población). 83/83 tests del server en verde, tsc limpio.
- **Enganche real (HECHO, este commit)**: `RegionRoom.onCreate` lee `indice.json`; si `tier === "asentamiento_hostil"`, llama a `asegurarAsentamientoBandido(bd, mapaId)` (nuevo en `economiaAsentamientos.ts`) — crea la fila y una guarnición inicial fija (1 líder + 2 guardias + 4 reclutas) la PRIMERA vez que se descubre esa región, idempotente después (dos jugadores entrando, o un reinicio del proceso, no duplican nada). El tick de economía en sí vive en `server/src/index.ts`, UNA sola vez por proceso (no por room — si viviera en `RegionRoom` se repetiría una vez por cada aldea hostil cargada a la vez, recalculando TODOS los asentamientos en cada una): `crearAlmacenDatos()` una vez al arrancar, `setInterval` cada 10 minutos reales llamando a `ejecutarTickEconomia`. Verificado extremo a extremo: bake real con 8 asentamientos hostiles, servidor con BD temporal, cliente entra a una región `asentamiento_hostil` y el SQLite queda con la fila + las 7 tropas exactas, cero error de consola.
- **E2E permanente (añadido en paralelo, mismo día)**: `server/test/faccionBandidos.e2e.mjs` (`node server/test/faccionBandidos.e2e.mjs`) — banquea su propio `asentamiento_hostil` de prueba, arranca el servidor con BD temporal y `TICK_ECONOMIA_MS` acelerado (override nuevo en `index.ts`, mismo criterio que `HORA_FORZADA`/`BD_RUTA`, solo para tests), se une por Colyseus SIN navegador y comprueba desde FUERA de la room (leyendo la misma sqlite): guarnición sembrada con la composición exacta (1/2/4), el tick GLOBAL real produce recursos tras dos pulsos, y una SEGUNDA entrada a la misma región no duplica tropas (idempotencia real, no solo la que ya cubre el test unitario). Limpia sus propios artefactos al terminar.

**Fases siguientes (fuera de esta pasada, documentadas para retomar):**
- Prompt/modo de líder dentro de `server/src/ia/` (reusa Gemini/Groq + fallback ya construidos) — cada 20-30 min reales, procesa `asentamientos`+`memoria_lider`, elige entre opciones pre-calculadas (no coordenadas libres).
- Patrullas en vivo: nuevo `Enemigo`-como-schema con posición actualizable, movidas sobre rutas pre-bakeadas por `RegionRoom` (mismo tick-rate que `GestorAgentes`), aspecto vía `generarEnemigo.js` + pool ya existente.
- `RegionRoom` expone `nivel_muralla` en el join; `sectorVisual.ts` lo lee además de/en vez de `indice.muralla.modulos[i].material`.
- Disparador real de `marcarTropaMuertaYVerificarConquista` desde el sistema de combate, cuando exista (ver §7, ya construida y probada la parte que no depende de combate).

## 7. Conquista: cuando muere la última tropa (HECHO, la costura — el disparador real sigue pendiente de combate)

Pedido del streamer: si los jugadores eliminan a TODA la guarnición de un asentamiento bandido, la facción lo pierde — pasa a asentamiento **neutral**, y su población CIVIL se regenera "con las mismas normas de generación que el resto de aldeas". Aclarado explícitamente: **no se re-bakea estructura ni decoración** (edificios/muralla/terreno siguen siendo el mismo bake de siempre) — solo cambian los NPCs y la jerarquía que vive dentro.

**Encaje con lo que ya existe**: "las mismas normas que el resto de aldeas" es literalmente `poblacion/` (censo → ubicación por oficio/vivienda real → perfil social → rutina → caminos bakeados, `poblacion/src/exportarAsentamiento.js`) — el mismo generador que ya puebla cualquier aldea neutral, nunca invocado hasta ahora para `asentamiento_hostil` porque esas aldeas usaban `DungeonRoom`+`enemigos.json` en su lugar. La pieza que faltaba para poder llamarlo tal cual:

- **`poblacion/catalogo/censo.json`** no tenía entrada para el tier `asentamiento_hostil` (`generarCenso` fallaba con "sin censo definido para el tier") — añadida: población modesta (4-7 aldeanos con familia, 1-2 guardias, algún vagabundo/chismosa/niño perdido), sin oficios de tienda/taller que este tier nunca tuvo edificio para (`tienda`/`panaderia`/`taller_sastre`/`alfareria` no están en su lista de edificios — meterlos habría generado NPCs sin trabajo real, mismo criterio que ya sigue el catálogo con "pescador").
- **`poblacion/catalogo/oficiosEdificios.json`**: `campamento_hostil` (el edificio obligatorio del tier, la antigua "casa del jefe" bandido) se añade a `guardia` junto a `torre_militar` (que ya estaba) — se convierte en el puesto de guardia del pueblo conquistado, sin inventar un oficio nuevo. `arena_combate` se queda sin oficio asociado (no tiene equivalente civil claro) — no revienta nada: `asignarUbicacion.js` ya tolera edificios sin oficio mapeado (se documenta ahí mismo, "v1 conocido").

**Regeneración determinista, no aleatoria**: `repoblarAsentamientoConquistado(rutaMapa)` (`server/src/mundo/economiaAsentamientos.ts`) lee `tier`+`semilla` del PROPIO `indice.json` del asentamiento (los mismos con los que se bakeó originalmente) y llama a `exportarAsentamiento(tier, semilla)` — como `generarCiudad` es determinista, esto reconstruye el layout de edificios BYTE A BYTE idéntico al ya bakeado (nunca se toca el `indice.json`, se verifica con test), solo que ahora corre la Fase 2-3 de población sobre él. El `poblacion.json` resultante se escribe al lado del `indice.json` de siempre — `RegionRoom` ya lo carga con un simple `fs.existsSync` en su `onCreate` (mismo camino que cualquier aldea, cero cambio de cliente/servidor aparte de esto), así que una región FRESCA (nadie dentro cuando se conquista, o alguien vuelve a entrar después) ve a los nuevos vecinos sin más — coherente con la decisión ya tomada de "nada reactivo en caliente" (§5.2, misma que la muralla).

**Transición y costura para combate** (`conquistarAsentamiento`/`marcarTropaMuertaYVerificarConquista`, mismo archivo): pasa `bando` a `"neutral"` en SQLite (idempotente — conquistar dos veces no repite nada), deja una línea en `memoria_lider` ("la aldea X ha caído...", contexto para la futura IA del líder), y dispara la repoblación. `ejecutarTickEconomia` deja de tocar un asentamiento en cuanto es `"neutral"` (su economía de guerra bandido ya no aplica; la progresión de una neutral por donaciones/misiones es Gemini §objetivo, fuera de alcance). Igual que con `marcarTropaMuerta`, **nada llama a esto en producción todavía** — depende de que exista combate para saber cuándo matar la última tropa de verdad; en cuanto ese sistema exista, solo tiene que llamar a `marcarTropaMuertaYVerificarConquista` en vez de `bd.marcarTropaMuerta` a secas y la conquista se dispara sola.

Probado extremo a extremo con una aldea hostil bakeada de verdad (`ciudades/hornearCiudad("asentamiento_hostil", ...)`): `repoblarAsentamientoConquistado` genera NPCs con rutina y ficha de vóxeles reales sin tocar el `indice.json`; `conquistarAsentamiento` cambia el bando, registra memoria e idempotente en la segunda llamada; `marcarTropaMuertaYVerificarConquista` no conquista hasta la última de 7 tropas, y no reconquista al repetir sobre una tropa ya muerta. 81/81 tests del server en verde, tsc limpio.

## 8. Asedio: el paso ANTES de poder conquistar (diseño, sin implementar — bloqueado por dependencias reales)

Pedido del streamer: no se puede entrar sin más a una aldea/castillo/ciudad bandida a matar a la guarnición — la entrada está **bloqueada** hasta que se la asedia. Para asediar, el jarl de la ciudad **capital** (del bando del jugador, no bandida) puede levantar un edificio **Taller de Máquinas de Asedio** en una parcela libre de su capital; una vez completado, con materiales se construyen **catapultas**, **torres de asedio** y **arietes** (coste de material distinto cada uno), y con eso se rompe la entrada de la aldea/castillo/ciudad bandida objetivo para poder entrar y matar a la guarnición (→ dispara la conquista de §7).

Esto es la pieza que falta ANTES de §7: hoy `marcarTropaMuertaYVerificarConquista` no tiene ninguna guardia de "¿está la entrada abierta?" — cualquiera podría entrar a un `asentamiento_hostil` y atacar sin haber asediado nada. El asedio es esa guardia.

### 8.1 Por qué esto NO se implementa todavía (dependencias duras, no elección de alcance)

- ~~**La ciudad capital no existe bakeada todavía.**~~ **HECHO (2026-08-29), ver `docs/GDD_Ciudad_Capital.md`.** Nuevo tier `capital_jarl` (distinto del `capital` regional genérico que ya existía): radio 96, muralla de empalizada inicial, casco viejo apretado, y **parcelas reservadas** de verdad (20 normales + 16 especiales, sin edificio real encima, terreno intacto) — ahí es donde iría el Taller de Máquinas de Asedio.
- ~~**El sistema de construcción/parcelas hoy solo vive en el Hub.**~~ **HECHO (2026-08-29), ver `docs/GDD_Construccion.md` §1bis.** La capital (RegionRoom con `parcelasReservadas` en su bake) tiene ahora construcción/parcelas/jarl igual que el Hub — mismo protocolo, verificado con un E2E real.
- ~~**Falta dar de alta el Taller de Máquinas de Asedio como `construible:true`.**~~ **HECHO (2026-08-30).** `taller_asedio` ya es una entrada real de `interiores/catalogo/tipos_edificio.json` con `construible:true` + `proyectoJarl:true` (junto a los otros 12 proyectos especiales del jarl con interior, ver `docs/GDD_Construccion.md` §1bis) — `validarColocacion()` exige jarl + parcela `tipo:"especial"` + tope de 1 por asentamiento. Esto SOLO desbloquea el edificio en sí (aparece en el menú, genera su interior con la sala `taller_asedio` ya catalogada); las máquinas de asedio que fabricaría siguen bloqueadas por el punto de abajo.
- **Las máquinas de asedio rompen la muralla/puerta de la aldea bandida y permiten matar a la guarnición dentro — eso es combate**, que sigue "sin diseñar" (§2.4, §4). El asedio en sí (construir Taller → construir máquina → romper entrada) es mecánica de construcción/recursos, pero el "atacar la puerta hasta romperla" y "entrar a matar" son combate de verdad.

### 8.2 Encaje con lo que ya existe (para cuando se retome)

- ~~**Taller de Máquinas de Asedio** = un edificio más de `interiores/catalogo/tipos_edificio.json`...~~ **HECHO (2026-08-30)**: es el flag `proyectoJarl:true` (docs/GDD_Construccion.md §1bis) — mismo colocador de construcción estilo PZ que ya existe para el jugador, restringido a "solo el jarl, solo en una parcela especial reservada" (mismo `esJarl()` que ya usa asignar/revocar parcelas).
- **Catapulta/torre de asedio/ariete con coste de material distinto** = el mismo concepto YA decidido en el backlog ("Roles/profesiones y crafteo por planos — concepto decidido, árbol y recetas sin diseñar" y "Construcción de estructuras... Planos/blueprints, materiales requeridos") — no es un sistema nuevo, es una aplicación más de crafteo-por-plano una vez ese sistema exista.
- **"Entrada bloqueada hasta asediar"** = un estado más en la tabla `asentamientos` (`server/src/datos/bd.ts`), mismo patrón que `nivelMuralla`/`bando` — algo como `asediada: boolean` (o nivel de daño a la puerta, 0=cerrada→N=abierta) que el punto de entrada (portal/`RegionRoom.onCreate` o el manejador `portal:ir`) consulta antes de dejar pasar. Coherente con la regla ya fijada de "nada reactivo en caliente" (§5.2): se resuelve al (re)cargar el sector/portal, no a mitad de que alguien ya esté mirando la puerta.
- Las máquinas de asedio, una vez construidas, tienen que **viajar** hasta la aldea objetivo o desplegarse cerca — cómo se resuelve eso en el mapa exterior (entidad física que se empuja/transporta vs. algo más abstracto) es una decisión de diseño que toca cuando exista inventario/objetos en el mundo (backlog "Inventario, contenedores y objetos en el mundo") — no se cierra aquí.

### 8.3 Orden de dependencias para retomar esto

1. ~~Generador de capital (reglas nuevas, bakeador) — bloqueante de raíz.~~ **HECHO**, ver `docs/GDD_Ciudad_Capital.md`.
2. ~~Construcción/parcelas habilitado en la capital~~ **HECHO (2026-08-29)** + ~~Taller de Máquinas de Asedio dado de alta como `construible:true`~~ **HECHO (2026-08-30)**, ver `docs/GDD_Construccion.md` §1bis.
3. Sistema de crafteo por planos (backlog, sin diseñar) — para el Taller y las máquinas de asedio — **sigue sin resolver**.
4. Sistema de combate (backlog, sin diseñar) — para romper la puerta y matar a la guarnición — **sigue sin resolver**.
5. Con 1-4 en pie: estado `asediada` en `asentamientos` + guardia de entrada + disparo de §7 al matar a la última tropa CON la aldea asediada (no solo "sin más").
