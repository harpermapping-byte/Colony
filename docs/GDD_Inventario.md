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
- Nada de lo que toca "coger"/"soltar" se persistía en esta fase (ni recolectables consumidos, ni objetos soltados, ni el inventario `cuerpo`): un reinicio del proceso (Render free) lo reseteaba todo. **Actualizado (pedido 2026-08-30, ver `docs/GDD_Equipo.md §6bis`): el inventario del JUGADOR (`cuerpo` + mochilas/bandolera/cinturón + `equipo`) ya persiste de verdad entre sesiones**, con la misma identidad `jugador_id` que gremios/oficios/mascotas llevaban toda la fase usando (`obtenerOCrearJugador(nombre)` — el riesgo de suplantación por nombre duplicado señalado abajo sigue siendo el mismo que ya asume el resto del progreso del jugador, no es un riesgo nuevo de esto). Lo que SIGUE sin persistir a propósito, por ser estado del MUNDO y no del jugador: recolectables consumidos (vuelven a aparecer tras un reinicio) y objetos sueltos en el suelo (`objetosMundo`).
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

- **Fase 3 — UI de cliente**: rejilla arrastrable de verdad, hoy no existe nada. Tampoco hay render de `objetosMundo` en el suelo (necesita `$(room.state).objetosMundo.onAdd/onRemove` en `game.ts`, mismo patrón que `Enemigo`, y una categoría `items` nueva en `catalogoVisual.ts`/`assetCatalog.ts`). ~~ni de `mundo:objetoQuitado`~~ — **resuelto (2026-08-30)**, ver `docs/GDD_Bosques.md` §7: el cliente ya escucha `mundo:objetoQuitado` y retira el prop 3D bakeado (más el mismo mecanismo generalizado a árboles talados).
- ~~Persistencia de fase 2~~ — **resuelta (2026-08-30)** para el inventario del jugador (`cuerpo`/mochilas/`equipo`), ver `docs/GDD_Equipo.md §6bis`. Recolectables consumidos y objetos soltados en el suelo siguen sin persistir, a propósito (son estado del mundo, no del jugador — un reinicio de Render los repone).
- ~~Activar `esContenedor` en el mobiliario del mundo (`baul_tesoro`, `tinaja`, `baul_marinero`... — campo ya reservado, sin usar)~~ — **hecho a medias (2026-08-31)**, ver `docs/GDD_Produccion.md §5ter`: un mueble `esContenedor:true` ya es un `Contenedor` real, direccionable como destino de transporte (`cofre:<id>`) y accesible a mano (`cofre:consultar/meterItem/sacarItem`, dueño-o-jarl). Sigue pendiente el `lootTier` (`cofre_jefe` y los 5 contenedores únicos de mazmorra) para tablas de botín reales — "abrir contenedor" por proximidad de un cofre AJENO/hostil sigue fuera de alcance, y no hay UI (drag&drop/picker) todavía, solo protocolo.
- **Ampliar el catálogo curado de objetos "sobreSuperficie"**: hoy 32 de 83 ids — decisión de contenido del streamer, cero cambio de código.
- **`rocas.json`/`animales.json` sin ninguna entrada `desaparaceAlRecolectar`**: minado de minerales y caza de fauna quedan fuera de "coger" esta fase — decisión pendiente (¿una veta se agota igual que una planta, o necesita un sistema de golpes/durabilidad aparte?).
- **Casas de jugador** (`interiorGenerado.ts`, `amueblado:"vacio"`): no tienen nada que coger — decidir si esta fase debe amueblarlas también.
- ~~Integración con `HubRoom`: cargar el inventario de un jugador al entrar y guardarlo al salir~~ — **hecha (2026-08-30)**, y no solo en `HubRoom`: `crearJugador`/`onLeave` viven en `RoomExteriorBase`, así que Region/Interior/Dungeon la heredan igual — ver `docs/GDD_Equipo.md §6bis`.
- **Sistema de personaje**: ✅ Fuerza real conectada al peso transportable, ver arriba y `docs/GDD_Personaje.md` §3.3. **Zonas prohibidas para soltar objetos** sigue "sin diseñar" en el backlog, este documento no lo cierra.

## 9. Líquidos portables (pedido 2026-08-30)

Pedido literal del streamer: *"como tenemos inventario líquidos ahora (amplia si quieres número de objetos por tamaños, a más grande más líquido puede tener dentro)... para luego coger en otros cuencos o objetos como cantimplora que almacene X cantidad de ese líquido"*. Y sobre cocina: *"para cocinar necesitas un ingrediente que sea agua, en este caso necesitarás meter un cubo con agua a la olla como ingrediente"* — la vieja mecánica de agua gratis (`cocina:llenarAgua` sin coste) queda **sustituida**, no ampliada.

**Modelo de datos** — mismo patrón que la durabilidad (`desgaste.ts`): campos opcionales añadidos a las interfaces YA existentes, ningún catálogo/tabla nuevo:
- `EntradaCatalogoItem.volumenMaxMl?: number` — SOLO presente en recipientes portables. Ausente = ese ítem nunca es un recipiente de líquido (la inmensa mayoría). "A más grande el recipiente, más `volumenMaxMl`" es una decisión de CONTENIDO (qué número lleva cada entrada), no de mecanismo.
- `ItemInstancia.liquido?: { tipo: string; volumenMl: number; contaminada?: boolean }` — ausente si el catálogo no declara `volumenMaxMl` (nunca es recipiente) O si lo es pero está vacío. **Llenar sustituye el contenido entero** — nunca "medio lleno de dos líquidos a la vez" (decisión de alcance para no arrastrar mezclas a esta fase).
- `server/src/inventario/liquidos.ts` (puro, sin Colyseus/BD/fs, mismo criterio que `desgaste.ts`): `esRecipienteLiquido`, `llenar`, `vaciar`, `tieneLiquido`, `consumirVolumen` (bebe hasta X ml, vacía si se agota, devuelve lo realmente bebido). 8 tests en `server/test/liquidos.test.ts`.
- Catálogo (`items/catalogo/items.json`): `cantimplora` (500ml, huella 1x1) y `cubo_madera` (2000ml, huella 1x1) — el cubo es el que se mete en la olla.

**Red (Colyseus)**: `ItemInstanciaSchema` gana `liquidoTipo`/`liquidoVolumenMl`/`liquidoContaminada` como campos PLANOS (sin Schema anidado, a propósito — es un campo pequeño, no merece complicar el diff de red). `""`/`0` = sin líquido, mismo criterio "campo vacío = no aplica" que el resto de la instancia. `sincronizarContenedor` es el único punto que traduce `ItemInstancia.liquido` → esos 3 campos.

**Mensajes nuevos** (`server/src/rooms/base/RoomExteriorBase.ts`):
- `recipiente:llenar { instanciaId }` — exige estar junto a agua (`casillaAguaCercana`, mismo helper que barcos/pesca/molino) y que la instancia sea un recipiente vacío o no; llena SIEMPRE al `volumenMaxMl` completo con `tipo:"agua"`. Responde `recipiente:llenado` o `recipiente:error`.
- `recipiente:beber { instanciaId }` — exige que tenga agua; bebe un "trago" (`VOLUMEN_TRAGO_ML=250`) y sube el vital `bebida` proporcionalmente (`BEBIDA_POR_TRAGO=15` a trago completo, menos si quedaba menos de un trago). Responde `recipiente:bebido`. **Sin UI de cliente todavía** — mismo criterio que `personaje:consumir` (que tampoco tiene wiring de cliente hoy): el mecanismo de servidor es lo que se pedía "de esqueleto", no la UI.
- `cocina:llenarAgua { construccionId, instanciaId }` — **cambio de contrato, rompe el uso anterior**: antes gratis (sin `instanciaId`), ahora exige `instanciaId` de un recipiente PROPIO con agua; lo vacía ENTERO (no volumen parcial) y activa `conAgua`/`calentandoDesde` en la vasija exactamente igual que antes. Decisión de alcance: el vertido es todo-o-nada, la vasija sigue con su modelo booleano de siempre — la complejidad volumétrica se queda confinada al recipiente portable, sin tocar `cocina.ts`. Ver `docs/GDD_Cocina.md` para el lado de la olla.

**Balance de arranque** (ajustable como el resto de números del proyecto): cantimplora 500ml/trago de 250ml = 2 tragos; cubo 2000ml = 8 tragos (o 1 olla entera). `jarra_agua` (consumible existente) sigue dando 40 de bebida de un uso — un trago de cantimplora da 15, deliberadamente menor porque una cantimplora representa VARIOS tragos, no un consumible de un solo uso.

**Cliente**: panel de cocina (`panelCocina.ts`) cambia el botón "Llenar de agua" gratis por un input con el id de instancia del recipiente + botón "Meter agua y poner al fuego" — mismo criterio placeholder que el resto del panel.

## 10. Grid drag&drop entre contenedores (pedido 2026-08-30)

Pedido literal: *"gemini para afinar sistema de grid, si abro un inventario se me abre su grid y veré mi grid de inventario para mover y drag and drop y se traspasa etc"*, y sobre el alcance: *"todo pero la UI y todo es de momento de test, o sea no hay que hacer UI final ni nada, estamos generando el esqueleto de todo"* — se construyó el MECANISMO completo (mensaje de red + `moverItem` real, cross-container incluido), con UI deliberadamente tosca (no la fase de "UI final" de §8).

**Server**: `moverItem` (§ arriba, `server/src/inventario/inventario.ts`) ya existía y ya soportaba tanto reposicionar dentro del mismo contenedor como mover a otro (todo-o-nada, sin dejar el origen a medias si no cabe) — no hizo falta tocarlo. Piezas nuevas:
- `contenedorDe(inv, contenedorId)` — resuelve la clave de contenedor (`"cuerpo"` o un slot de `SLOTS_CONTENEDOR`) al `Contenedor` real, mismo vocabulario de claves que ya devolvía `buscarInstanciaJugador`.
- `RoomExteriorBase.manejarInventarioMover` (mensaje `inventario:mover { instanciaId, contenedorDestino?, x, y, rot? }`) — busca la instancia en CUALQUIER contenedor propio (`buscarInstanciaJugador`), resuelve el destino (`contenedorDestino` ausente = el mismo contenedor donde ya estaba, para reordenar sin que el cliente necesite saber en cuál está), llama a `moverItem` y sincroniza Schema + dispara persistencia en segundo plano (mismo patrón que equipar/desequipar). Responde `inventario:error` con el motivo si no cabe.

**Cliente** (`client/src/personaje/panelJugador.ts`, dentro del panel "Jugador" ya existente, tecla I): las secciones "Cuerpo" y cada "Dentro de: <mochila>" pasaron de lista de texto a una rejilla real — caja de `ancho x alto` casillas (fondo con líneas de grid via CSS `repeating-linear-gradient`, sin dependencias), una celda absolutamente posicionada por instancia según su `x`/`y`/`rot` reales (Schema replicado) y del tamaño de su `huella` de catálogo. Drag&drop nativo del navegador (`draggable`, `dragstart`/`dragover`/`drop`, sin librería): arrastrar cualquier celda a cualquier grid VISIBLE (el propio grid de origen incluido, para reordenar, o cualquier mochila/bolsa puesta que también esté pintada en el panel) calcula la celda de destino a partir del punto donde se suelta y manda `inventario:mover` — cero validación de "¿cabe?" en cliente, eso lo decide el servidor y si falla no pasa nada visualmente (el próximo `onChange` de Schema vuelve a pintar el estado real). Rotar al vuelo NO está en este pase (se suelta con la misma `rot` que ya tenía) — coherente con "esqueleto, no UI final". Un recipiente con líquido se pinta de otro color y con el volumen en el texto/tooltip.

## 11. "Nombre bonito" — regla permanente para TODO objeto/mueble (pedido 2026-08-30)

Pedido literal del streamer: *"items/mesas solo tienen el id de catálogo; el texto vistoso que describiste en su momento vive en el GDD, nunca en el juego"* — y sobre el alcance, explícito: **"Todo el catálogo ya"** (no solo las entradas nuevas de la sesión). Cierra el gap #3 del repaso de mecánicas pendientes junto con trofeo de pared/ropa civil/molinero (mismo pedido, ver `docs/GDD_Caza.md` y `docs/GDD_Profesiones.md`).

**Mecanismo — `items/catalogo/nombreBonito.js`** (CommonJS, sin dependencias, mismo patrón offline que el resto de generadores del proyecto): dado un id de catálogo (`hierro`, `cadaver_carne_roja_piel_fina_grande`, `gran_molino_agropecuario`...) devuelve su nombre en español correcto — no es una tabla de textos, son REGLAS de ortografía/gramática reales aplicadas al id:
- Separa el id por `_`, corrige ortografía palabra a palabra (ñ, tildes por terminación: `-ción/-sión`, `-ería/-uría`, esdrújulas `-ico/-ica`/`-icos/-icas`, agudas `-ón`) vía un diccionario de excepciones (`EXCEPCIONES_PALABRA`) para lo que ninguna terminación cubre (hiatos, esdrújulas irregulares, ñ).
- Decide, palabra a palabra, si es un ADJETIVO/participio (va pegado al sustantivo anterior — `ADJETIVOS`, más la regla genérica "termina en -ado/-ada/-ido/-ida → participio", con excepciones para sustantivos que solo coinciden en la terminación: `mercado`, `secado`, `amasado`...) o un SUSTANTIVO (necesita "de" delante — regla POR DEFECTO en español para sustantivo+sustantivo).
- `EXCEPCIONES_FRASE`: id completo → frase fijada a mano, solo para lo que la regla genérica no puede resolver sola (orden de palabras, "del"/"de la", herramientas de doble función tipo "Cuchillo de Fileteado y Filtro de Cobre").
- Casos especiales por prefijo: `cadaver_<carne>_<piel>_<tamano>` (docs/GDD_Caza.md) y `asado_<recurso>` (docs/GDD_Cocina.md) recomponen el id en sus partes reales en vez de trocearlo a ciegas.

**PRIMER BORRADOR**, no prosa pulida a mano una a una: ~1130 entradas se revisaron por reglas + muestreo (varias pasadas completas regenerando y leyendo la salida, más un pase final con el diccionario `hunspell -d es_ES` del sistema para detectar tildes que ninguna regla cubría), no cada nombre repasado individualmente. Algún compuesto raro puede leerse forzado — se corrige sobre la marcha añadiendo su caso a `EXCEPCIONES_FRASE`/`EXCEPCIONES_PALABRA`/`ADJETIVOS` según se note jugando, igual que el resto de catálogos del proyecto ("las listas crecen").

**Aplicado a los dos catálogos existentes**: `items/catalogo/items.json` (422 entradas reales, excluye las claves `_nota*`/`_camposConsumidores` de documentación) y `interiores/catalogo/elementos.json` (707 entradas reales) llevan ahora un campo `"nombre"` (primera propiedad de cada entrada) con el resultado de `nombreBonito(id)`. De paso se limpiaron dos entradas de `items.json` que estaban duplicadas al 100% (`tendones`/`tripas` definidas dos veces, la segunda copia muerta silenciosamente por cómo colapsa `JSON.parse` con claves repetidas).

**REGLA PERMANENTE desde ahora**: toda entrada nueva en `items/catalogo/items.json` o `interiores/catalogo/elementos.json` (objeto, mueble, herramienta, decoración...) lleva su campo `"nombre"` calculado con `node items/catalogo/nombreBonito.js <id>` (o `require`d) en el mismo commit que la da de alta — no un texto inventado a mano, para que la regla se mantenga consistente en todo el catálogo. Si el resultado automático suena forzado para ese id concreto, se añade su excepción a `nombreBonito.js` en vez de escribir el nombre a fuego en el catálogo.

**Pendiente real (fuera de esta fase)**: sin panel de cliente que muestre este campo todavía — sigue siendo el gap #1 del repaso de mecánicas (UI de crafteo/oficios/inventario no consume `items.json` en absoluto hoy). El campo `nombre` queda listo en el catálogo para cuando exista esa UI.
