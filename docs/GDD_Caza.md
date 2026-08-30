# GDD — Caza, desollado y encurtido de pieles

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30) — LOOT/DESOLLADO REDISEÑADOS (2026-08-30, octava pasada).** Piezas: `server/src/mundo/lootCaza.ts` (qué itemId de "cadáver entero" da cada especie + su tabla de rendimiento completo, `sacrificarAnimalGranja` para ganadería), `server/src/mundo/despiece.ts` (NUEVO — procesar el cadáver ya recogido: desollar/despiezar, en el sitio o junto a mesa_despiece/mesa_corte), `server/src/mundo/cadaveres.ts` (sin cambios), `server/src/mundo/catalogoCombateFauna.ts` (`categoriaRecursoCarne`/`categoriaRecursoPiel`), `server/src/mundo/faunaSalvajeViva.ts` (rellena el cadáver al morir), `server/src/combate/arenaCombate.ts` (`jugarTurnoIAPasiva`, modo caza), `server/src/rooms/schema/CombateState.ts`+`HubState.ts` (`CombateUnidad.pasivo`, `CadaverSchema`), `server/src/combate/registroArenas.ts` (`ParticipanteArena.pasivo`), `server/src/rooms/ArenaCombateRoom.ts` (propaga `pasivo`), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo `oficio:*`/`cadaver:*`/`piel:raspar`/`curtidor:*`, detección de modo caza en `combate:iniciar`), `server/src/construccion/curtido.ts`+`catalogo.ts` (`EntradaCurtidor`), `interiores/catalogo/exteriores.json` (`cubo_sal`, `barril_curtido`), `items/catalogo/items.json` (34 ítems nuevos en la octava pasada: `grasa` + 33 cadáveres), `server/src/rooms/HubRoom.ts` (carga/expira cadáveres persistidos). Probado: `arenaCombate.test.ts` (+5 modo caza), `lootCaza.test.ts` (rehecho para el rediseño), `despiece.test.ts` (NUEVO), `despiece.e2e.mjs` (NUEVO, servidor real), `curtido.test.ts` (13), `catalogoCombateFauna.test.ts`/`faunaSalvajeViva.test.ts`/`inventario.test.ts`/`construccion.test.ts` (ampliados), suite completa 817/817, `tsc --noEmit` limpio en server y client.

Pedido del streamer (2026-08-30): cazar animales da loot automático (carne/tendones/tripas, según tamaño) al morir; desollar el cadáver con un cuchillo (oficio curtidor) da la piel aparte; 5% de probabilidad de cabeza-trofeo al desollar; la caza es un combate especial — se abre solo, sin ventana de espera, y la presa (si no es un depredador) nunca ataca, solo deambula; y un proceso de encurtido de pieles "realista": mobiliario-inventario donde metes material + la piel y, tras un tiempo, pasa al siguiente estado.

**Rediseño de loot/desollado (2026-08-30, octava pasada, pedido literal)**: "cuando matas un animal da su cadáver en el loteo, no da otra cosa... podrías coger su cadáver, transportarlo, despellejarlo ahí mismo o despiezarlo ahí mismo (tardas mucho más tiempo y da menos material)... en cambio si lo haces en [mesa_despiece/mesa_corte] te da más material, tardas mucho menos". Motivado por cerrar dos huecos reales encontrados al auditar "blueprints por mesa y nivel" (docs/GDD_Profesiones.md): `mesa_despiece` (carnicero, curtidor N1) y `mesa_corte` (sastre, curtidor N3) no tenían NINGUNA receta ni mecánica detrás — el "carnicero" absorbido por curtidor (docs/GDD_Profesiones.md §0) no hacía nada en el juego. Detalle completo en §2-§3 (reescritas).

## 0. Decisiones consultadas al streamer (AskUserQuestion, 2026-08-30)

1. **¿Quién puede desollar?** → *"Diseñar ahora un sistema mínimo de oficio de jugador"* — no existía ningún concepto de oficio EXCLUSIVO a nivel de jugador (solo XP no-exclusiva por NPC/receta, `jugador_oficios`). Se creó `Player.oficio` (string, vacío = ninguno), elegible gratis/instantáneo vía `oficio:elegir`, sin exclusividad real ni progresión — placeholder de balance explícito, ver §1.
2. **¿Cómo se relacionan lootear y desollar?** → *"Son estrictamente independientes"* (se descartó el auto-recogido). Si desuellas sin haber looteado antes, la carne/tendones/tripas que quedaran en el cadáver se **pierden** con él — el jugador tiene que acordarse de lootear primero. Ver §3.
3. **¿Alcance del trofeo?** → *"Solo el ítem, se queda en el inventario"* — sin mueble de pared/colgador todavía (depende de un menú de decoración sin diseñar). El trofeo es un `ItemInstancia` normal, se lleva/guarda como cualquier otro objeto.

## 1. Oficio de jugador — sistema mínimo (`Player.oficio`)

`@type("string") oficio = ""` en `HubState.ts`. `oficio:elegir { oficio }` lo cambia sin coste ni requisito (`oficio:""` lo quita); lista cerrada `OFICIOS_JUGADOR_VALIDOS` (`RoomExteriorBase.ts`) — desde la fusión de oficios (docs/GDD_Profesiones.md §0, 2026-08-30) son los **10 oficios finales**; "peletero"/"carnicero"/"sastre" ya NO son valores propios, viven todos dentro de **curtidor** (que los absorbió). Desollar/despiezar exige `player.oficio === "curtidor"`, sin excepción. Sin progresión de aprendizaje ni exclusividad — mecanismo mínimo a propósito, ver §7. **Mecanismo listo, disparador de cliente pendiente**: ningún key/UI lo manda todavía (mismo estado que `crafteo:iniciar`/`dormir:iniciar`/`produccion:recolectar`, ninguno tiene wiring de cliente hoy — precedente ya establecido en este proyecto).

## 2. Loot automático al matar — un ÚNICO ítem "cadáver entero" (`lootCaza.ts::rellenarLootCaza`)

**Rediseñado 2026-08-30 (octava pasada)** — antes esta sección daba carne+tendones+tripas SUELTOS directamente al morir; ahora da UN ÚNICO ítem, el "cadáver entero", y procesarlo (con el verbo que se quiera) es cosa de `despiece.ts` (§3). Al morir cualquier fauna salvaje (`faunaSalvajeViva.ts::matarIndividuo`, ya invocado en producción vía `HubRoom.onFaunaMuerta`), su `Cadaver.contenedor` (el cadáver del MUNDO, lootable con `cadaver:lootear`) se rellena SIEMPRE con `cadaverItemId(especie)` × 1 — nunca materiales sueltos.

El itemId codifica carne+piel+tamaño directamente (`cadaver_<categoriaRecursoCarne|generico>_<categoriaRecursoPiel|sinpiel>_<categoriaVida>`) — evita tener que guardar la especie exacta en un campo nuevo de `ItemInstancia`/Colyseus Schema (el jugador puede procesar el cadáver mucho después de matar al animal, ya lejos de la sesión de caza). `TABLA_CADAVERES` (tabla inversa en `lootCaza.ts`) recupera esos 3 datos solo con el itemId — cubre las **33 combinaciones reales** que hoy produce `baker/catalogo/animales.json` (verificado con un test que cruza el catálogo entero, docs/GDD_Caza.md §6); una especie con una combinación nueva exige añadir su fila ahí (mismo criterio "las listas crecen" del resto del proyecto).

`TABLA_LOOT_CAZA` (cria/pequeño/mediano/grande/alfa) sigue siendo la tabla de rendimiento — ahora es el rendimiento COMPLETO (procesar junto a mesa_despiece/mesa_corte), la fracción de "en el sitio" la aplica `despiece.ts`:

| categoriaVida | carne | tendones | tripas | grasa | piel | trofeo |
|---|---|---|---|---|---|---|
| cria | 1 | 1 | 1 | 1 | 1 | pequeña |
| pequeño | 2 | 1 | 1 | 1 | 1 | pequeña |
| mediano | 4 | 2 | 2 | 2 | 2 | mediana |
| grande | 7 | 3 | 3 | 4 | 3 | grande |
| alfa | 12 | 5 | 5 | 6 | 5 | grande |

`grasa` es nueva de esta pasada (subproducto de despiezar, junto a tendones/tripas). **Ganadería** (docs/GDD_Ganaderia.md, `manejarAnimalSacrificar`): sacrificar tu PROPIO animal sigue dando el rendimiento COMPLETO al instante y SIN pasar por el ítem cadáver (`sacrificarAnimalGranja`, misma tabla) — es tuyo, ya domesticado, no hace falta cazarlo/transportarlo/procesarlo, mismo criterio "sin oficio" de siempre.

## 3. Procesar el cadáver — `cadaver:procesarIniciar`/`cadaver:procesarRecolectar` (`server/src/mundo/despiece.ts`)

**Rediseñado 2026-08-30 (octava pasada)** — el cadáver del MUNDO ya no se desuella directamente (`cadaver:desollar` eliminado); una vez looteado el ítem "cadáver entero" al inventario del jugador, se PROCESA desde ahí, en dos pasos (como cualquier crafteo): `cadaver:procesarIniciar { instanciaId, verbo: "desollar"|"despiezar", construccionId? }` arranca, `cadaver:procesarRecolectar` entrega cuando toca. Exige `player.oficio === "curtidor"` Y `cuchillo_desollar` en el inventario (no se consume, solo se desgasta) — igual que antes del rediseño.

- **"desollar"** → piel de la especie (`datos.piel`, si tiene) + tirada de trofeo (`PROBABILIDAD_TROFEO = 0.05`, IGUAL en el sitio que en mesa — el streamer no pidió que el trofeo cambiara).
- **"despiezar"** → carne (si la especie tiene `categoriaRecursoCarne`) + tendones + tripas + grasa.
- Puedes elegir cuál hacer (o solo uno) — el cadáver se consume igual con cualquiera de los dos, no hace falta desollar Y despiezar la misma pieza.

**En el sitio vs. en mesa** (`construccionId` opcional apuntando a una `mesa_despiece`/`mesa_corte` YA construida, mismo criterio de confianza en el cliente que `crafteo:iniciar` — la mesa nunca RECHAZA la acción, solo la mejora):

| | tiempo | rendimiento |
|---|---|---|
| En el sitio (sin mesa) | 3× (`MULTIPLICADOR_TIEMPO_CAMPO`) | 50% (`FRACCION_MATERIAL_CAMPO`, redondeado abajo, nunca 0 si la base era > 0) |
| Junto a mesa_despiece/mesa_corte | base (desollar 15s, despiezar 20s) | 100% |

Sin cola — un cadáver procesándose a la vez por sesión (`despiecesEnCurso`, mismo criterio que `craftesEnCurso`); un segundo `procesarIniciar` mientras el primero está en curso se rechaza. `cadaver:lootear` (verbo aparte, sin requisito de oficio) sigue igual: mueve lo que haya en el contenedor del cadáver del MUNDO (hoy, un único ítem cadáver) al inventario del jugador.

## 4. Caza como combate especial — sin ventana, presa pasiva

Reusa el pipeline de combate ENTERO (`docs/GDD_Combate.md §9`) — cero mecanismo nuevo de arena/turnos, solo dos ramas condicionales:

- **`manejarCombateIniciar`** detecta "modo caza": el objetivo es `Fauna` Y `!faunaEsPeligrosa(especieId)` (jabalí/lobo/oso siguen siendo combate normal). Si es modo caza: la unidad objetivo nace `pasivo: true`, se marca el `combateId` en `combatesSinAutoUnion`, y en vez de programar el timeout de 60s se llama a `cerrarVentanaCombate` **al instante** — el combate se abre solo, sin esperar a que nadie se una (pedido explícito).
- **`cerrarVentanaCombate`** salta sus dos bucles de auto-unión (Enemigo de mazmorra / Fauna peligrosa cercana) cuando el combate está en `combatesSinAutoUnion` — la caza es estrictamente 1 vs 1, nadie se suma sin que el jugador lo decida a propósito (co-op sigue siendo posible si OTRO jugador manda su propio `combate:iniciar` contra el mismo animal — eso es un camino distinto, "unirse al bando contrario de un combate ya existente", no auto-unión).
- **`jugarTurnoIAPasiva`** (`arenaCombate.ts`): en su turno, una unidad `pasivo:true` deambula un paso a una casilla adyacente libre (o se queda quieta) — **nunca ataca ni persigue**, esté el jugador a tiro o no. `jugarTurnoIA` despacha a esta función cuando `u.pasivo` es cierto; el resto de la IA (agresiva, `objetivoMasCercano`+perseguir+atacar) no cambia.

El flag `pasivo` viaja por TODA la tubería del combate porque el roster se traspasa de la room de origen a una `ArenaCombateRoom` nueva (§9.2 de GDD_Combate): `crearUnidadCombate` (stats) → `CombateUnidad.pasivo` (Schema, servidor) → `unidadDesdeSchema` (motor puro) → `ParticipanteArena.pasivo` (`registroArenas.ts`, el roster que cruza de room) → `ArenaCombateRoom.onCreate` (reconstruye la unidad ya con `pasivo`). Cortar cualquier eslabón de esta cadena rompería el modo caza en cuanto el jugador entra a la arena — **contrato para el futuro**: cualquier campo nuevo de `UnidadCombate` que deba sobrevivir al salto de room tiene que añadirse en los 5 puntos de esta cadena, no solo en el motor puro.

## 5. Encurtido de pieles — `cubo_sal` → raspar → `barril_curtido`

Pipeline (mi elección de balance, pedido explícito "tras X tiempo que determines tú"):

```
piel_cruda (piel_basta/fina/exotica/invierno/cuero_grueso/cuero_reptil, tier:0 "cuero")
  → [cubo_sal: sal a granel, 4h]         → piel_salada
  → [cuchillo_desollar: raspar, instantáneo, exige oficio] → piel_raspada
  → [barril_curtido: curtiente a granel, 6h] → cuero_curtido (tier:1 "cuero", YA existía — refino genérico, igual que el resto de familias de material)
```

`piel_salada`/`piel_raspada` son ítems **genéricos** (no varían por especie de origen) — igual que `cuero_curtido` ya lo era antes de esta feature; evita 6 cadenas paralelas idénticas por cada tipo de piel cruda.

### 5.1 `cubo_sal`/`barril_curtido` — mueble construible, NO decoración de bake

Van en `interiores/catalogo/exteriores.json` (no en `elementos.json`) a propósito: ese catálogo lo lee `construccion/catalogo.ts` para el menú de construcción del jugador pero **no** lo toca el bakeador de interiores/ciudades — cero riesgo de que aparezcan solos dentro de una `curtiduria` NPC generada offline, y cero campos de colocación de bake que mantener (`anchorType`/`allowedRoomTags`/`temasProfesion`... no aplican aquí). Se colocan con el "construir" normal de parcela como cualquier otro mueble (colmena, cama...).

Campo de catálogo nuevo, `EntradaCurtidor` (`construccion/catalogo.ts`):
```ts
{ materialCarga, materialPorUnidad, capacidadMaxMaterial, entradaItemId?, entradaFamilia?, entradaTier?, salida, horas }
```
`cubo_sal` acepta CUALQUIER piel cruda por `familiaMaterial:"cuero"` + `tier:0` (no por itemId exacto — nuevas pieles crudas futuras entran gratis, sin tocar este catálogo); `barril_curtido` acepta un itemId exacto (`piel_raspada`, el único intermedio de esa fase).

### 5.2 Reloj perezoso — `server/src/construccion/curtido.ts`, PURO

Mismo patrón que `produccion.ts`/`crafteo.ts` (nunca `cadaveres.ts`): **horas REALES** (`Date.now()`), no horas de mundo — sin tick de servidor, se resuelve comparando timestamps cuando alguien toca el mueble.

- `EstadoCurtidor { stock, lote?: { cantidad, iniciadoEn } }` — vive en `ConstruccionViva.extra.curtidor` (mismo hueco JSON que ya usa `produccion`/`interior`, persistido vía `actualizarExtraConstruccion` y recargado íntegro al reiniciar el servidor — ver el contrato ya escrito en `docs/GDD_Produccion.md §5`, que aplica aquí sin cambios).
- **UN lote a la vez** por mueble (`iniciarLoteCurtidor` devuelve `null` si ya hay uno en curso) — realista (una cuba, una tanda), y evita modelar colas.
- `curtidorListo`/`recolectarLoteCurtidor` — mismo "ok si `ahora - iniciadoEn >= horas*3_600_000`" que `crafteoListo`.

### 5.3 Protocolo Colyseus (`RoomExteriorBase.ts`)

- `curtidor:cargarMaterial { construccionId, instanciaId, cantidad? }` — carga el mueble con `materialCarga` (sal/curtiente) desde el cuerpo del jugador. Dueño de la parcela o jarl; **sin oficio** (tarea de mantenimiento, no artesanal). Capa por `capacidadMaxMaterial`.
- `curtidor:meterPiel { construccionId, instanciaId, cantidad? }` — arranca el lote: EXIGE oficio curtidor/peletero (el paso artesano de verdad), consume stock a granel + la piel del inventario. `curtidor:error` si ya hay lote, o si no hay material suficiente.
- `curtidor:recolectar { construccionId }` — entrega el resultado cuando `curtidorListo`; dueño o jarl.
- Los 3 exigen proximidad (`RADIO_INTERACCION`, es un mueble físico) y dueño-de-la-parcela-o-jarl (mismo criterio que `produccion:recolectar`/`refinamiento:depositar`).
- `piel:raspar { instanciaId, cantidad? }` — acción INSTANTÁNEA de inventario (sin construcción de por medio): mismo gate que desollar (oficio + `cuchillo_desollar`), `piel_salada` → `piel_raspada`, misma cantidad.

**Sin wiring de cliente todavía** (mismo estado que producción/crafteo/refinamiento — ninguno de esos tiene tecla/UI hoy tampoco).

## 6. Ítems nuevos (`items/catalogo/items.json`)

`curtiente` (a granel, `barril_curtido`) · `cuchillo_desollar` (herramienta, no se consume, gatea desollar/despiezar/raspar) · `cabeza_trofeo_pequena/mediana/grande` (trofeo 5%, solo ítem — §0.3) · `piel_salada`, `piel_raspada` (intermedios genéricos del encurtido, §5).

**Octava pasada (2026-08-30, rediseño de loot/desollado)**: `grasa` (subproducto genérico de despiezar, junto a `tendones`/`tripas`) + **33 ítems `cadaver_<carne>_<piel>_<tamano>`** — uno por cada combinación real de `categoriaRecursoCarne`×`categoriaRecursoPiel`×`categoriaVida` que produce hoy `baker/catalogo/animales.json` (verificado con un test de cobertura completa, `lootCaza.test.ts`). `tendones`/`tripas` (ya existentes) dejan de darse automáticamente al matar — ahora son resultado de procesar el cadáver (§3), igual que `grasa`.

## 7. Pendiente (no bloquea v1)

- **Wiring de cliente**: ninguna tecla manda `oficio:elegir`/`curtidor:*`/`piel:raspar` todavía — mismo hueco que el resto de construcción/crafteo. `cadaver:lootear` (L) y el nuevo `cadaver:procesarIniciar`/`procesarRecolectar` (K desuella, O despieza, octava pasada) SÍ tienen tecla y render placeholder del cadáver.
- **Trofeo de pared — CERRADO (2026-08-30)**: no hacía falta ningún menú de decoración nuevo — la MISMA sesión ya había creado el patrón `requiereItemColocar` + `colgadoEnPared`/`WALL_HIGH_FLOATING` para los objetos decorativos exclusivos (docs/GDD_Profesiones.md). 3 muebles nuevos en `elementos.json` (`trofeo_pared_pequena/mediana/grande`, sin oficio ni receta — el ítem YA se obtiene desollando), colocables con el "construir" de siempre en cualquier sala de estar/dormitorio/comedor (mismo `tiposSalaValidos` que `cuadro`, el decor de pared genérico ya existente).
- **Oficio sin progresión ni exclusividad real**: cambiar de oficio es gratis e instantáneo — si se quiere requisito/coste/aprendizaje es una iteración futura sobre el mismo campo (§0.1, decisión explícita de alcance mínimo).
- **Sin animación/feedback de "raspar"**: acción instantánea sin tiempo de espera — si se quiere que tarde, es cuestión de darle un `terminaEn` como `crafteo:iniciar`, sin rediseño.
- **`mesa_corte` sigue siendo, a la vez, la mesa de sastre** (docs/GDD_Profesiones.md, ropa civil craftable) — un jugador la usa para cortar tela/cuero de prendas Y para despiezar un cadáver; misma mesa física, dos oficios distintos que la comparten (decisión explícita, no una reconsolidación de edificios).
- **`mesa_destilado_esencias` (curandero N3) sigue sin ninguna receta/mecánica** — pedido aparte del streamer, "mesa de pociones con minijuego de mezclar líquidos"; deliberadamente fuera de alcance de esta pasada (funcionalidad de cliente nueva, no solo catálogo), se diseña en su propia sesión.
- **La bonificación de mesa no comprueba distancia real** (mismo criterio que `crafteo:iniciar` hoy: confía en el `construccionId` que manda el cliente) — cuando exista de verdad un cliente con UI de targeting para mesas, este mismo criterio de confianza aplicará a ambos por igual, no es una deuda propia de la caza.
