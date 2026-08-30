# GDD — Crecimiento de bosques

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30), alcance Hub (mapa principal).** Piezas: `baker/catalogo/vegetacion.json` (`crecimiento` en 28 especies maderables), `items/catalogo/items.json` (28 `semilla_<especie>`, `EntradaItem.crecimientoArbol`), `server/src/mundo/crecimientoBosques.ts` (reglas puras), `server/src/mundo/bosqueSector.ts` (resolución de sector), `server/src/mundo/bosquesVivos.ts` (`GestorBosques`, activación en vivo), `server/src/datos/bd.ts` (tablas `arboles_vivos`/`arboles_sector_resuelto`, 4 funciones), `server/src/rooms/schema/HubState.ts` (`ArbolVivoSchema`), `server/src/rooms/HubRoom.ts` (wiring + protocolo `arbol:*`), `client/src/game.ts` (render de árboles NUEVOS + tecla H). Probado: `crecimientoBosques.test.ts` (6), `bosqueSector.test.ts` (9), `arbolesVivos.test.ts` (4, persistencia BD), `bosquesVivos.test.ts` (10, gestor en vivo), suite completa del server en verde, `tsc --noEmit` limpio en server y client.

Pedido del streamer (2026-08-30): un árbol adulto tiene un radio y una probabilidad (distinta según lo prolífica que sea la especie) de que aparezca un arbolito joven dentro de ese radio; en unos meses de mundo (según especie) se convierte en árbol adulto. Al talar un árbol también se obtienen semillas plantables, con el mismo mecanismo de crecimiento — "si hay que añadir más árboles para tener más tipos de madera, hazlo, no preguntes".

## 0. Catálogo — 28 especies maderables, sin añadir ninguna nueva

`baker/catalogo/vegetacion.json` ya tenía 28 especies de árbol real (`colision:true` + `categoriaRecurso` empezando por `madera_`, de `roble`/`pino` a `palmera_datilera`/`arbol_carbonizado`) y `items/catalogo/items.json` ya tenía 6 tipos de madera distintos (`madera_dura`/`madera_blanda`/`madera_abedul`/`madera_sauce`/`madera_palmera`/`madera_carbonizada`, con `tier` de calidad) — el catálogo YA daba la variedad de madera pedida, así que no hizo falta ampliarlo. Los 11 árboles frutales/de fruto seco (`peral_silvestre`, `nogal`...) quedan **fuera de esta pasada**: no tienen `colision:true` (son atravesables, puramente decorativos hoy) y su recolección de fruta es un backlog aparte (`docs/Backlog_Mecanicas_Futuras.md`, "Recolectables con pool de puntos de spawn").

Campo nuevo por especie, `crecimiento: { radioPropagacion, probabilidadPropagacion, diasMaduracion }`, asignado por regla según el tipo de madera (más blanda = más rápida y prolífica, coherente con el `tier` 0/1 ya existente):

| tipo de madera | radio | probabilidad/resolución | maduración |
|---|---|---|---|
| blanda (general) | 5 | 4.5% | 120 días (~4 meses) |
| blanda — abedul | 6 | 5% | 100 días |
| blanda — sauce | 6 | 5% | 110 días |
| dura | 4 | 2% | 240 días (~8 meses) |
| palmera | 3 | 1.2% | 300 días |
| carbonizada | 2 | 0.8% | 270 días |

**Excepción explícita**: `pino` (el ejemplo literal del pedido, "por ejemplo pino... en 6 meses ingame") se dejó en 180 días exactos en vez de los 120 de la regla general de blanda — el resto de blandas sigue la regla.

## 1. Semillas — `semilla_<especieId>`, una por especie

`items/catalogo/items.json` gana 28 ítems `semilla_<especieId>` (tipo `"semilla"`, campo NUEVO `crecimientoArbol: { especieArbolId, diasMaduracion }` — duplica `diasMaduracion` del catálogo de vegetación a propósito, para no acoplar el catálogo de ítems al de vegetación). **No usan `cultivo`** (ese campo es solo agricultura de parcela, `docs/GDD_Agricultura.md`) — son un mecanismo paralelo, sin `mesesSiembra` ni rasgos de híbrido: una semilla de árbol se planta en cualquier época, en terreno abierto, no en un bancal.

## 2. Propagación silvestre — una tirada por árbol adulto elegible, nunca por día

Mismo criterio anti-explosión que `docs/GDD_Agentes_Moviles.md` (reproducción de fauna salvaje): **UNA tirada de propagación por árbol adulto vivo elegible cuando su sector se reactiva** (`server/src/mundo/bosqueSector.ts::resolverSectorBosque`), nunca una tirada por cada día transcurrido — así un sector abandonado 200 días de mundo no genera de golpe 200 intentos por árbol, solo uno. Si la tirada tiene éxito, nace un brote (`etapa:"joven"`) en un punto al azar dentro de `radioPropagacion` del árbol padre, solo si esa casilla está libre (transitable, sin colisión, sin otro árbol ya reclamándola en la misma resolución).

**Simplificación real frente al pedido original**: el pedido describía una comprobación "cada X tiempo" por árbol; la implementación la resuelve de forma perezosa por SECTOR (activado cuando un jugador se acerca, exactamente igual que la fauna salvaje) en vez de un tick por árbol — mismo espíritu, muchísimo más barato a escala de mapa completo.

## 3. Maduración — jóvenes que cumplen `diasMaduracion` pasan a adulto

Un brote (`joven`, de propagación o plantado) madura a `adulto` cuando `tiempoMundo().dia - diaPlantado >= diasMaduracion`, comprobado en la misma resolución de sector. Al madurar, su casilla se ENDURECE de verdad en el grid de colisión en vivo (`server/src/mundo/colisiones.ts`, mismo mecanismo que `aplicarColocacion` de construcción) — un árbol adulto nacido en el sistema bloquea el paso exactamente igual que uno del bake original. Un brote joven **no bloquea el paso**.

## 4. Talar — `arbol:talar`, tecla H

Sin targeting: tala el árbol talable más cercano dentro de `RADIO_INTERACCION`, entre TODOS los árboles activos (del bake y nacidos en el sistema). Exige `hacha_talar` en el inventario (existía en el catálogo desde `docs/GDD_Caza.md` pero sin ningún gating real hasta ahora — primera vez que se usa). Recompensa:

- **Madera**: `categoriaRecurso` de esa especie (una de las 6 ya existentes), 3-5 unidades si era adulto, 1 si era joven.
- **Semilla**: solo de un adulto, 50% de posibilidades, `semilla_<especieId>`. Un brote joven todavía no da semilla propia.
- XP de Fuerza (mismo criterio que "coger" un objeto pesado).

Un árbol talado se persiste como `estado:"talado"` (nunca vuelve a "vivo") — no reaparece al reactivarse su sector, y su casilla se ablanda de vuelta a transitable.

## 5. Plantar — `arbol:plantar { instanciaId, x?, y? }`

Consume una semilla de tu inventario (por `instanciaId`, mismo criterio que `cultivo:plantar` de agricultura), la planta en `(x,y)` si se indica o donde estés parado por defecto, dentro de `RADIO_INTERACCION`. Exige casilla libre y sector activo (jugador cerca — coherente con cómo se llega a poder plantar). Nace `etapa:"joven"`, madura sola con el mismo mecanismo que un brote silvestre (§3) — no hay diferencia de comportamiento entre un árbol "silvestre" y uno "plantado" salvo el origen que queda registrado.

**Sin tecla de atajo todavía**: a diferencia de talar (sin argumentos), plantar necesita elegir QUÉ semilla del inventario — se deja para cuando exista la interfaz de inventario en rejilla (`docs/Backlog_Mecanicas_Futuras.md`, "Inventario... fase 3"), mismo criterio que otras acciones que necesitan seleccionar un ítem concreto.

## 6. Persistencia — solo la DIFERENCIA respecto al bake, no toda la población

**Decisión de diseño real, distinta de cómo se hizo con la fauna salvaje**: un árbol del bake que nadie ha tocado **nunca se persiste en BD** — se re-deriva del propio `sector_XXX_YYY.json` en cada resolución (lectura gratuita, ya está en disco). Solo se guardan dos cosas en la tabla `arboles_vivos`: los árboles de bake que se han talado alguna vez (`origen:"bake"`, `estado:"talado"`) y los nacidos en el sistema (`origen:"propagacion"|"plantado"`, jóvenes o adultos). Esto evita duplicar en BD la población entera de un bosque bakeado (potencialmente enorme en el mapa principal) — la fauna salvaje sí materializa el 100% de su población base al activar un sector por primera vez porque los animales tienen necesidades/vida que rastrear; un árbol sin tocar no tiene nada que rastrear.

Consecuencia práctica: `resolverSectorBosque` no distingue "primera activación" de "reactivación" como sí hace `faunaSalvajeSector.ts` — siempre resuelve igual, leyendo el bake fresco + lo persistido.

## 7. Límite conocido — árboles del bake NUNCA se sincronizan al cliente como entidad viva

Los árboles ORIGINALES del bake se siguen renderizando 100% como decoración estática del mapa (`InstancedMesh` por sector, cliente), exactamente igual que antes de esta mecánica — **nunca** se publican en `ArbolVivoSchema`/`state.arbolesVivos`, ni siquiera cuando su sector está activo. Razón: harían falta cambios en el pipeline de streaming de sectores del cliente (saber qué posiciones concretas del bake dejar de dibujar) para reconciliar la malla estática con la entidad viva, un trabajo de render aparte que esta pasada no cubre.

Efecto real, honesto: talar un árbol del bake SÍ funciona del todo en el servidor (dejas de chocar con él, recibes madera/semilla, queda marcado talado para siempre), pero su modelo 3D se queda visualmente en pie hasta que exista esa reconciliación — mismo tipo de límite ya aceptado en `docs/GDD_Inventario.md` §7 para "coger" un arbusto/seta del bake (el pickup ya funciona, el modelo tardó en desaparecer visualmente). Los árboles NUEVOS (brote de propagación o plantado) no tienen este problema — nacen ya como entidad viva de verdad, se renderizan y se borran del cliente con total normalidad.

## 8. Alcance — Hub (mapa principal) únicamente

`GestorBosques` solo se instancia en `HubRoom`, mismo criterio que `GestorFaunaSalvaje` (la fauna salvaje "de verdad", con sectores/persistencia, también es Hub-only — `RegionRoom` usa el `GestorFauna` urbano más simple). Las regiones/mapas secundarios no tienen crecimiento de bosques en esta v1 — extenderlo ahí es una iteración futura, no bloqueada por nada de este diseño (el mismo `GestorBosques` es reusable, solo falta la instancia + wiring en `RegionRoom`).

## 9. Reusa el intervalo de 8s que ya existía — cero tick nuevo

`GestorBosques.actualizarPorJugadores` se llama desde el MISMO `clock.setInterval` de 8s que ya usaba `GestorFaunaSalvaje` para activar/desactivar sectores (`HubRoom.ts`), reusando las mismas posiciones de jugador ya calculadas — ni un intervalo nuevo, coherente con la regla del proyecto "NO añadir polling ni trabajo de fondo". A diferencia de la fauna, `GestorBosques` no tiene `tick()`: los árboles no se mueven ni tienen necesidades, toda su resolución pasa en `activarSector` (perezosa, disparada solo por proximidad de jugador).
