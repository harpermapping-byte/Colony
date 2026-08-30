# GDD — Caza, desollado y encurtido de pieles

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/mundo/lootCaza.ts` (loot automático + desollado), `server/src/mundo/cadaveres.ts` (ya existía, ahora expuesto por Schema/BD), `server/src/mundo/catalogoCombateFauna.ts` (`categoriaRecursoCarne`/`categoriaRecursoPiel`), `server/src/mundo/faunaSalvajeViva.ts` (rellena el cadáver al morir), `server/src/combate/arenaCombate.ts` (`jugarTurnoIAPasiva`, modo caza), `server/src/rooms/schema/CombateState.ts`+`HubState.ts` (`CombateUnidad.pasivo`, `CadaverSchema`), `server/src/combate/registroArenas.ts` (`ParticipanteArena.pasivo`), `server/src/rooms/ArenaCombateRoom.ts` (propaga `pasivo`), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo `oficio:*`/`cadaver:*`/`piel:raspar`/`curtidor:*`, detección de modo caza en `combate:iniciar`), `server/src/construccion/curtido.ts`+`catalogo.ts` (`EntradaCurtidor`), `interiores/catalogo/exteriores.json` (`cubo_sal`, `barril_curtido`), `items/catalogo/items.json` (9 ítems nuevos), `server/src/rooms/HubRoom.ts` (carga/expira cadáveres persistidos). Probado: `arenaCombate.test.ts` (+5 modo caza), `lootCaza.test.ts` (9), `curtido.test.ts` (13), `catalogoCombateFauna.test.ts`/`faunaSalvajeViva.test.ts`/`inventario.test.ts`/`construccion.test.ts` (ampliados), suite completa 473/473, `interiores` 34/34, `tsc --noEmit` limpio en server y client.

Pedido del streamer (2026-08-30): cazar animales da loot automático (carne/tendones/tripas, según tamaño) al morir; desollar el cadáver con un cuchillo (oficio peletero/curtidor) da la piel aparte, y el cadáver desaparece del todo; 5% de probabilidad de cabeza-trofeo al desollar; la caza es un combate especial — se abre solo, sin ventana de espera, y la presa (si no es un depredador) nunca ataca, solo deambula; y un proceso de encurtido de pieles "realista": mobiliario-inventario donde metes material + la piel y, tras un tiempo, pasa al siguiente estado — con cubos que se cargan a granel de sal/ácido y reaccionan al meter la piel.

## 0. Decisiones consultadas al streamer (AskUserQuestion, 2026-08-30)

1. **¿Quién puede desollar?** → *"Diseñar ahora un sistema mínimo de oficio de jugador"* — no existía ningún concepto de oficio EXCLUSIVO a nivel de jugador (solo XP no-exclusiva por NPC/receta, `jugador_oficios`). Se creó `Player.oficio` (string, vacío = ninguno), elegible gratis/instantáneo vía `oficio:elegir`, sin exclusividad real ni progresión — placeholder de balance explícito, ver §1.
2. **¿Cómo se relacionan lootear y desollar?** → *"Son estrictamente independientes"* (se descartó el auto-recogido). Si desuellas sin haber looteado antes, la carne/tendones/tripas que quedaran en el cadáver se **pierden** con él — el jugador tiene que acordarse de lootear primero. Ver §3.
3. **¿Alcance del trofeo?** → *"Solo el ítem, se queda en el inventario"* — sin mueble de pared/colgador todavía (depende de un menú de decoración sin diseñar). El trofeo es un `ItemInstancia` normal, se lleva/guarda como cualquier otro objeto.

## 1. Oficio de jugador — sistema mínimo (`Player.oficio`)

`@type("string") oficio = ""` en `HubState.ts`. `oficio:elegir { oficio }` lo cambia sin coste ni requisito (`oficio:""` lo quita); lista cerrada `OFICIOS_JUGADOR_VALIDOS` (`RoomExteriorBase.ts`): herrero/carpintero/picapedrero/curtidor/sastre/joyero/**peletero** (nuevo — mismos ids que `receta.oficio` de `items/catalogo/recetas.json`, más peletero que hoy no tiene recetas de crafteo, solo gatea caza). Sin progresión de aprendizaje ni exclusividad — mecanismo mínimo a propósito, ver §7. **Mecanismo listo, disparador de cliente pendiente**: ningún key/UI lo manda todavía (mismo estado que `crafteo:iniciar`/`dormir:iniciar`/`produccion:recolectar`, ninguno tiene wiring de cliente hoy — precedente ya establecido en este proyecto).

## 2. Loot automático al matar — `lootCaza.ts::rellenarLootCaza`

Al morir cualquier fauna salvaje (`faunaSalvajeViva.ts::matarIndividuo`, ya invocado en producción vía `HubRoom.onFaunaMuerta`), su `Cadaver.contenedor` se rellena SIEMPRE, sin desollar, con carne + tendones + tripas — cantidades por `categoriaVida` (`TABLA_LOOT_CAZA`, cria/pequeño/mediano/grande/alfa, cubre las 187 especies sin tabla por especie):

| categoriaVida | carne | tendones | tripas | piel (al desollar) | trofeo (al desollar) |
|---|---|---|---|---|---|
| cria | 1 | 1 | 1 | 1 | pequeña |
| pequeño | 2 | 1 | 1 | 1 | pequeña |
| mediano | 4 | 2 | 2 | 2 | mediana |
| grande | 7 | 3 | 3 | 3 | grande |
| alfa | 12 | 5 | 5 | 5 | grande |

`carne` sale como `especie.categoriaRecursoCarne` (nuevo campo, propagado por `catalogoCombateFauna.ts` desde `baker/catalogo/animales.json` — ya existía en el bake, solo faltaba exponerlo al combate). `tendones`/`tripas` son ítems genéricos, iguales para cualquier especie (nuevos, `items/catalogo/items.json`).

## 3. Desollado — `cadaver:desollar` (`RoomExteriorBase.ts::manejarCadaverDesollar`)

Exige `player.oficio` ∈ {curtidor, peletero} Y `cuchillo_desollar` en el inventario (herramienta nueva, no se consume). Da la piel de la especie (`especie.categoriaRecursoPiel`, si tiene — algunas no) y una tirada de trofeo (`PROBABILIDAD_TROFEO = 0.05`, `rnd` inyectable para test), y el cadáver **desaparece del todo** (`state.cadaveres`/`cadaveresPuros`/fila de BD borrados). **ESTRICTAMENTE independiente de `cadaver:lootear`** (decisión §0.2): no auto-recoge nada que quedara sin lootear — eso se pierde con el cadáver. `cadaver:lootear` (verbo aparte, sin requisito) mueve lo que quepa del contenedor del cadáver al jugador, sin desollar.

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

## 6. Ítems nuevos (`items/catalogo/items.json`, 119 → 128)

`tendones`, `tripas` (loot automático genérico) · `curtiente` (a granel, `barril_curtido`) · `cuchillo_desollar` (herramienta, no se consume, gatea desollar/raspar) · `cabeza_trofeo_pequena/mediana/grande` (trofeo 5%, solo ítem — §0.3) · `piel_salada`, `piel_raspada` (intermedios genéricos del encurtido, §5).

## 7. Pendiente (no bloquea v1)

- **Wiring de cliente**: ninguna tecla manda `oficio:elegir`/`curtidor:*`/`piel:raspar` todavía — mismo hueco que el resto de construcción/crafteo. `cadaver:lootear`/`cadaver:desollar` SÍ tienen tecla (L/K) y render placeholder del cadáver.
- **Trofeo de pared**: hoy es un ítem de inventario cualquiera — colgarlo en la pared depende de un menú de decoración de jugador sin diseñar (§0.3, decisión explícita de alcance).
- **Oficio sin progresión ni exclusividad real**: cambiar de oficio es gratis e instantáneo — si se quiere requisito/coste/aprendizaje es una iteración futura sobre el mismo campo (§0.1, decisión explícita de alcance mínimo).
- **Sin animación/feedback de "raspar"**: acción instantánea sin tiempo de espera — si se quiere que tarde, es cuestión de darle un `terminaEn` como `crafteo:iniciar`, sin rediseño.
