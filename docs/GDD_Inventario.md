# GDD — Inventario, Contenedores y Objetos en el Mundo

Fase 1 (pedido del streamer 2026-08-29): **catálogo + servidor + persistencia**, sin UI de cliente ni la mecánica de "coger del mundo" todavía — esas son las fases 2 y 3, ver §7. El concepto general ya estaba decidido en `docs/Backlog_Mecanicas_Futuras.md` ("Inventario, contenedores y objetos en el mundo"); este documento cierra el diseño concreto y es ahora el contrato, mismo criterio que `GDD_Construccion.md`.

## 0. Visión pactada (recordatorio, ya decidida antes de esta fase)

- Estilo Project Zomboid: rejilla 2D real ("tetris"), no una lista con cantidad.
- **Peso y espacio son EJES DISTINTOS**: todo objeto pesa (cuenta contra el peso transportable, ligado a Fuerza) Y ocupa una huella en la rejilla — independientes entre sí.
- Contenedores además del cuerpo (mochilas, bolsos) amplían la capacidad.
- Objetos soltados en el mundo se ven en su sitio real en 3D, no un icono — mismo concepto que los "objetos sueltos de superficie" que ya coloca `interiores/catalogo/elementos.json`.
- **Servidor autoritativo, cliente solo predice/muestra** — arquitectura ya fijada para inventario/equipo.

## 1. Catálogo de ítems (`items/catalogo/items.json`)

Módulo nuevo, hermano de `ropa/`/`personajes/` (offline, sin dependencias, mismo patrón de catálogo del proyecto). 55 entradas hoy:

- **49 recursos** (`tipo:"recurso"`), uno por cada `categoriaRecurso*` distinto que ya existe en `baker/catalogo/{vegetacion,animales,rocas}.json` (madera_dura, carne_roja, pescado_rio, hierro, oro, baya...) — el ÍTEM de inventario es la misma categoría que ya usa el bakeador para lo recolectable, no un catálogo duplicado. Agrupados en 7 "familias mecánicas" (metal/mineral_ligero/piedra/madera/planta/carne/piel) que comparten huella/peso/stackMax; el `colorDebug` sí es individual por recurso.
- **6 ítems ilustrativos no-recurso** (`tipo:"equipable"|"herramienta"|"consumible"`): `mochila_cuero`, `bolsa_cinturon` (contenedores equipables), `hacha_talar`, `pico_minero`, `antorcha_portatil` (herramientas), `racion_viaje` (consumible) — prueban esas ramas del schema. NO es un catálogo cerrado de armas/armaduras: crece después con el mismo patrón ("las listas CRECEN, el código no").

Campos de cada entrada: `tipo`, `categoriaRecurso?` (solo recursos), `slotEquipo?` (solo equipables/herramientas — nombre de slot, ver §4), `huella:[ancho,alto]` (casillas de rejilla), `peso` (número, eje independiente de la huella), `apilable`+`stackMax?`, `esContenedor?:{ancho,alto}` (solo ítems-mochila — su rejilla PROPIA al equiparse), `variantes`, `colorDebug` (placeholder, mismo criterio que el resto de catálogos — el `.glb` real se bakea más adelante).

## 2. Lógica de rejilla (`server/src/inventario/inventario.ts`)

**Pura** (sin Colyseus ni red — testeada sola, mismo patrón que `construccion.ts`/`mundo/colisiones.ts`, 15 tests):

- `Contenedor = {ancho, alto, items: ItemInstancia[], siguienteId}`. `ItemInstancia = {id, itemId, cantidad, x, y, rot}`.
- **Rotación: solo 0/1** (no 0/90/180/270) — en una rejilla de casillas cuadradas, 180°/270° dan la MISMA huella ocupada que 0°/90°, así que dos estados bastan y simplifican toda la comprobación de hueco.
- `hayHueco`: límites de la rejilla + solapamiento real con huellas rotadas de lo ya colocado (no un simple conteo de casillas libres).
- `buscarHueco`: primer hueco libre fila a fila — determinista, no aleatorio.
- `agregarItem`: si el ítem es apilable, primero rellena pilas YA existentes con hueco (hasta `stackMax`) antes de abrir una pila nueva; si no cabe todo, aplica lo que SÍ entró y devuelve `sin_hueco` — nunca falla en silencio ni a medias sin decirlo.
- `moverItem`: mismo contenedor (reposicionar/rotar, ignora la propia instancia al comprobar hueco) o entre DOS contenedores distintos (cuerpo → mochila) — todo o nada, si no cabe en destino el origen no se toca.
- `pesoContenedor`: suma `peso × cantidad` de cada pila — independiente de cuántas casillas ocupe.
- `pesoMaximoTransportable(nivelFuerza)`: **✅ CONECTADA (2026-08-30)** — vive en `server/src/personaje/bonusAtributos.ts` (`20 + (nivel-1)×4`, nivel 1 = base sin bonus, nivel 10 = 56), sigue siendo un placeholder de balance (número de referencia, no cerrado) pero YA limita de verdad: `excedePesoMaximo` (`inventario.ts`) se comprueba antes de `coger`, recoger un crafteo y comprar en un tenderete — ver `docs/GDD_Personaje.md` §3.3.

## 3. Contenedores anidados — decisión de esta fase

El backlog lo dejaba abierto ("¿anidada dentro de la del cuerpo, o independiente?"). Decisión: **independientes**. Un ítem con `esContenedor:{ancho,alto}` (ej. `mochila_cuero`), al equiparse en su `slotEquipo`, aporta un `Contenedor` PROPIO (mapa `extras` en `InventarioSchema`, clave = slot o id de instancia), nunca fusionado dentro de la rejilla del cuerpo. Más simple de implementar y de razonar (cada contenedor se abre/inspecciona por separado, como en Project Zomboid de verdad) que una mega-rejilla fusionada.

## 4. Persistencia (`server/src/datos/bd.ts`)

Dos tablas nuevas, mismo contrato dual SQLite/Postgres (`IAlmacenDatos`) que el resto del juego:

```
inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items JSON) — PK (jugador_id, contenedor_id)
equipo      (jugador_id, slot, item_id)                                        — PK (jugador_id, slot)
```

`contenedor_id` es libre (`"cuerpo"`, `"mochila_1"`...) — un jugador puede tener varias filas en `inventarios`, una por contenedor. `guardarContenedor`/`guardarEquipo` son upsert (reemplazo completo del set de slots en el caso de equipo — más simple que upsert slot a slot). `cargarContenedor` devuelve `null` si el jugador nunca guardó ESE contenedor (nuevo) — quien llame decide el tamaño por defecto con `crearContenedor()`. 13 tests de roundtrip/aislamiento por jugador.

## 5. Schema de Colyseus (`server/src/rooms/schema/HubState.ts`)

Espejo de red de lo de arriba — la lógica pura sigue siendo la fuente de verdad, el Schema es solo cómo viaja al cliente:

```
Player.inventario: InventarioSchema
  cuerpo: ContenedorSchema { ancho, alto, items: ItemInstanciaSchema[] }
  extras: Map<string, ContenedorSchema>   // mochilas equipadas
  equipo: Map<string, string>              // slot -> itemId
```

Verificado con `toJSON()` sobre una instancia real de `Player` — anidación Schema→Schema→ArraySchema construida y serializada sin errores.

## 6. Slots de equipo — **mecanismo real desde `docs/GDD_Equipo.md` (2026-08-30)**

`espalda` (mochila), `cinturon` (bolsa pequeña), `manoPrincipal`/`manoSecundaria` (herramienta/arma/antorcha) ya existían aquí como nombres reservados, sin mecanismo. Ahora hay 19 slots reales (armadura cabeza/torso/piernas/brazos/manos incluida, accesorios, y un tercer contenedor `bandolera` — los 3 de mochila/cinturón/bandolera simultáneos) con `equiparItem`/`desequiparItem` de verdad, mensajes `equipo:equipar`/`equipo:desequipar`, y `Player.defensa`/`ataque` (más los nuevos `defensaMagica`/`ataqueMagico`) recalculados desde el equipo puesto — ver `docs/GDD_Equipo.md` para el diseño completo. Este documento sigue siendo la fuente de verdad de la rejilla/contenedores/peso; GDD_Equipo.md es la capa de equipo sobre ella, sin reescribir nada de esto.

## 7. Fase 2 — coger del mundo / soltar al suelo (implementada, 2026-08-29)

Diseñada con un workflow de investigación + 3 propuestas independientes + crítica adversarial de cada una (los 3 diseños tenían bugs reales: sincronización rota Schema↔puro, condiciones de carrera en el orden mundo/BD, un filtro `!obj.ac` que colaba TODO el pool en vez de solo la fracción activa, `agregarItem` dejando el contenedor a medias si la cantidad no cabe entera...). La implementación real fusiona lo mejor de las 3 y corrige TODOS esos bugs antes de escribir una línea — ver los tests citados abajo, cada uno prueba explícitamente el bug que evita.

**Alcance decidido para esta fase — TODO EN MEMORIA, sin tabla de BD nueva, sin `jugador_id`:**
- Nada de lo que toca "coger"/"soltar" se persiste (ni recolectables consumidos, ni objetos soltados, ni el inventario `cuerpo`): un reinicio del proceso (Render free) lo resetea todo. Aceptado a propósito para no construir persistencia sobre una identidad de jugador que hoy solo es un nombre de texto libre (riesgo de suplantación ya señalado en la crítica: dos sesiones con el mismo nombre compartirían inventario si se persistiera por nombre).
- Por no tocar BD, `onJoin` sigue siendo SÍNCRONO en las 4 rooms (sin precedente de `onJoin` async en el proyecto todavía) — el Contenedor "cuerpo" nace vacío 8x6 en `crearJugador`, sincronizado al Schema en el acto.
- Alcance real de "coger" de interior: SOLO edificios bakeados por `ciudades/` (los que traen `sobreSuperficie` real). Las casas que construyen los jugadores (`interiorGenerado.ts`, `amueblado:"vacio"`) no tienen nada que coger todavía.
- "Abrir contenedor" (baúles/`esContenedor` del mobiliario, `lootTier`) sigue FUERA — solo proximidad automática, sin payload, mismo criterio que `portal:usar`.

**Piezas nuevas:**
- `server/src/inventario/cogerSoltar.ts` — `intentarCoger`: hace ATÓMICO de verdad lo que `agregarItem` no garantiza por sí solo (puede apilar parte y fallar al abrir pila nueva, dejando el contenedor a medias) snapshoteando y restaurando si falla. Test: `server/test/cogerSoltar.test.ts`.
- `server/src/inventario/sincronizarSchema.ts` — `sincronizarContenedor(schema, puro)`: el puente Contenedor→ContenedorSchema que faltaba en fase 1 (sin él, "coger" borraba del mundo pero el jugador nunca veía el ítem en su propio inventario replicado — bug real de una de las 3 propuestas). Test: `server/test/sincronizarSchema.test.ts`.
- `server/src/mundo/recolectables.ts` — recolectables exteriores vivos: `Map<idxCasillaGlobal, {itemId,x,y}>` cacheado por `rutaMapa` a nivel de PROCESO (no por room), para que una `RegionRoom` que se autodispone y se recrea (aldea vacía) no resetee lo ya cogido (granjeo trivial "sal y entra" detectado en la crítica). `recolectableCercano` busca solo la vecindad por clave, nunca el Map entero (puede tener decenas de miles de entradas en el mapa principal). Test: `server/test/recolectables.test.ts`.
- `server/src/mundo/mapaColision.ts` — `cargarMapaColision` puebla `recolectables` reutilizando el MISMO bucle que ya recorre `chunk.objetos` para colisión (sin duplicar el walk). **Bug de catálogo corregido antes de implementar**: `ac` se OMITE cuando el candidato nace activo y solo se guarda `ac:0` para los inactivos — así que "activo" es `obj.ac !== 0`, nunca `!obj.ac` (en JS `!undefined` y `!0` son ambos `true`; esa condición habría marcado como recolectable el 100% del pool, no solo la fracción activa). Test que compara contra un recuento de referencia independiente: `server/test/recolectables.test.ts`.
- `server/src/mundo/interiorColision.ts` — `InteriorCargado.objetosSueltos: Map<instanceId, {itemId,x,y}>`, poblado en el bucle que ya existía (antes descartaba `item.sobre`). Posición = la del MUEBLE host (un objeto "sobre" no tiene casilla propia). Test: `server/test/interiorColision.test.ts`.
- `server/src/rooms/base/RoomExteriorBase.ts` — `RADIO_INTERACCION = 2.2` (antes repetido como número mágico en 3 sitios de portales, ahora una constante compartida y reusada también por "coger"); `inventarios: Map<sessionId, Contenedor>`; mensajes `coger`/`soltar` compartidos por las 4 rooms; `buscarCogibleEnMundo` (override point: por defecto mira `mapaExterior`, `InteriorRoom` lo sobreescribe para `objetosSueltos`); `buscarObjetoSoltadoCercano` (universal, mira `HubState.objetosMundo`).
- `server/src/rooms/schema/HubState.ts` — `ObjetoMundoSchema` + `objetosMundo: MapSchema` (compartido por las 4 rooms): lo que sueltan los jugadores. Sin persistencia, replicado por Colyseus sin broadcast manual (incluida la foto inicial a quien se une después).
- `items/catalogo/items.json` — 32 nuevas entradas `tipo:"objeto"`, subconjunto CURADO de los 83 ids `sobreSuperficie` de `interiores/catalogo/elementos.json` (objetos genéricos de casa/taller: platos, herramientas, libros... no props narrativos únicos como `sello_jarl_mesa`). Ampliar esta lista es una decisión de CONTENIDO, no de código — el mecanismo de "coger" ya funciona para cualquier id que se dé de alta ahí.

**Orden crítico de "coger" (por qué no hay condición de carrera):** buscar candidato → `intentarCoger` (atómico) → SOLO SI entró, borrar la fuente (mundo/mueble/drop) y sincronizar Schema. Al no haber ningún `await` en el camino (memoria pura, sin BD esta fase), el propio single-thread de los `onMessage` de Colyseus basta para que sea atómico — el bug de carrera que sí tenía una de las propuestas (borrar la fuente solo DESPUÉS de un `await` a BD) no puede darse aquí porque no hay ningún `await` de por medio.

Verificado además con un E2E manual contra un servidor Colyseus real (mapa sintético mínimo, recolectable a 1 casilla del spawn): spawn correcto, `coger` resuelve `categoriaRecurso` real, `mundo:objetoQuitado` se emite, un segundo `coger` en el mismo sitio da `nada_cerca` (no duplica), `soltar` crea la entrada en `objetosMundo`, un jugador que se une DESPUÉS ya la ve (replicación completa al join) y puede cogerla él.

## 8. Qué falta (fases siguientes, no bloquean esta)

- **Fase 3 — UI de cliente**: rejilla arrastrable de verdad, hoy no existe nada. Tampoco hay render de `objetosMundo` en el suelo (necesita `$(room.state).objetosMundo.onAdd/onRemove` en `game.ts`, mismo patrón que `Enemigo`, y una categoría `items` nueva en `catalogoVisual.ts`/`assetCatalog.ts`) ni de `mundo:objetoQuitado` (retirar el prop 3D bakeado que el jugador acaba de coger).
- **Persistencia de fase 2** (recolectables consumidos, objetos soltados, inventario `cuerpo`) — decisión explícita pendiente: si el streamer prefiere que nada de esto se pierda en un reinicio de Render, hace falta resolver antes `jugador_id` real por sesión (hoy la identidad solo es un nombre de texto libre, sin unicidad — riesgo de que dos sesiones con el mismo nombre compartan cuerpo si se persistiera tal cual) y tablas nuevas en `bd.ts` con el mismo patrón dual SQLite/Postgres que `construcciones`.
- **Activar `esContenedor` en el mobiliario del mundo** (`baul_tesoro`, `tinaja`, `baul_marinero` en `interiores/catalogo/elementos.json` — campo ya reservado, sin usar) y `lootTier` (`cofre_jefe` y los 5 contenedores únicos de mazmorra) para tablas de botín reales — "abrir contenedor" sigue fuera de alcance.
- **Ampliar el catálogo curado de objetos "sobreSuperficie"**: hoy 32 de 83 ids — decisión de contenido del streamer, cero cambio de código.
- **`rocas.json`/`animales.json` sin ninguna entrada `desaparaceAlRecolectar`**: minado de minerales y caza de fauna quedan fuera de "coger" esta fase — decisión pendiente (¿una veta se agota igual que una planta, o necesita un sistema de golpes/durabilidad aparte?).
- **Casas de jugador** (`interiorGenerado.ts`, `amueblado:"vacio"`): no tienen nada que coger — decidir si esta fase debe amueblarlas también.
- **Integración con `HubRoom`**: cargar el inventario de un jugador al entrar y guardarlo al salir — ligado a resolver `jugador_id` real, ver persistencia arriba.
- **Sistema de personaje**: ✅ Fuerza real conectada al peso transportable, ver arriba y `docs/GDD_Personaje.md` §3.3. **Zonas prohibidas para soltar objetos** sigue "sin diseñar" en el backlog, este documento no lo cierra.
