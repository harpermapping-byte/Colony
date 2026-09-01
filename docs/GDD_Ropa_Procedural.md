# Generador procedural de ropa — decisión y estado (v1, 3 prendas de prueba)

Documento de referencia — léelo antes de tocar `ropa/` o ampliar su catálogo. Sigue el mismo patrón que `GDD_Bakeador_Interiores.md` (mobiliario): catálogo como fuente de verdad, generación offline, determinismo por semilla.

## Decisión (confirmada con el streamer)

La ropa (y más adelante armaduras, armas de mano y herramientas visibles) es un módulo nuevo, `ropa/`, con su propio catálogo — igual patrón que `interiores/` para mobiliario: una entrada de catálogo por prenda, generación procedural en vóxeles a partir de esa entrada + un material + una semilla.

Reglas de diseño acordadas:

1. **Una vez puesta, la prenda es UNA sola pieza pegada a la piel** — no tiene física propia, ni hueso propio, ni colisión propia. Se cuelga del pivote del rig que le toque (`client/src/render3d/rigHumanoide.ts`: `torso`, `piernaIzq`/`piernaDer`, `brazoIzq`/`brazoDer`, `cabeza`) y hereda su animación gratis, exactamente como ya preveía el comentario de `rigHumanoide.ts` sobre "la futura ropa". El cliente debe fusionar los vóxeles de cada prenda en una única geometría por prenda (o por personaje) antes de colgarla del pivote — no una entidad física independiente.
2. **Catálogo por profesión/oficio, no "dos prendas de cada"**: el catálogo de prendas arranca deliberadamente corto (3 entradas) y crece guiado por los oficios/tags que YA existen en `interiores/catalogo/tipos_edificio.json` (campo `temaTaller`: herrería, carpintería, sastre, curtiduría, alfarería, joyería, herbolista, destilería, molino, pescador, aserradero) y por `interiores/src/roomTags.js` (`COMUN_AGRICULTURA`, `ESPECIAL_NOBLEZA`, `COMUN_MILITAR`...). `ropa/catalogo/profesiones.json` es el cruce oficio → prendas típicas, igual que `tipos_edificio.json` es el cruce edificio → salas típicas.
3. **Materiales reutilizados, no duplicados**: la ropa usa el MISMO catálogo `interiores/catalogo/materiales.json` que ya usan los interiores (mismo `colorDebug`, misma escala de `riquezaTipica`) — solo se añadieron ahí las fibras que faltaban para vestuario: `lino`, `lana`, `seda` (y se documentó `cuero` también como material de ropa, que ya existía). Cero catálogo de materiales nuevo.
4. **Personalización por zonas, no toda la prenda**: cada prenda declara `zonasColor` (partes que el futuro creador de personaje puede tintar — ej. el cuerpo de una camisa, los puños, el cuello) y `zonasFijas` (partes que SIEMPRE usan el color del material, nunca tinte del jugador — ej. remiendos, cordones, ribetes). El material en sí también cambia el aspecto más allá del color: lino/lana/seda tienen `tintable` y una gama de colores histórica coherente (seda admite colores vivos/saturados, lana y lino solo tonos tierra — ver notas en `materiales.json`).
5. **Todas las caras construidas, siempre** (regla del streamer): cada vóxel/caja de una prenda (y del personaje) se construye con sus 6 caras, aunque una quede "debajo de la cabeza" o normalmente tapada — nada puede verse hueco/transparente desde ningún ángulo (con el agua translúcida el PJ se ve también desde abajo al bucear). Al fusionar vóxeles en una `BufferGeometry` en el cliente, la ÚNICA optimización permitida es quitar caras interiores compartidas entre dos vóxeles adyacentes de la misma prenda (invisibles por definición); jamás caras exteriores por "no se ve desde la cámara". El rig ya cumple (BoxGeometry completa); las vistas de prueba SVG también dibujan las 6 caras.
6. **Detalle = más vóxeles, no más geometría "suave"**: si una prenda necesita más definición (una costura, una hebilla, un remiendo), la resolución sube en `voxelResolucion` de esa prenda — sigue siendo el mismo estilo de bloques que el resto del proyecto (rig, mobiliario, props), nunca una malla lisa.

## Referencia usada antes de generar (para que la silueta sea real, no inventada)

Antes de programar las 3 siluetas se buscó referencia real:

- **Camisa/túnica campesina**: túnica altomedieval de corte suelto pero NO bombacho (mito de Hollywood), cuello en V o redondo poco marcado, mangas hasta la muñeca. Fuente: [Construction of early medieval tunics — Projekt Forlǫg](https://sagy.vikingove.cz/en/construction-of-early-medieval-tunics/).
- **Pantalón/calza campesina**: ancho en la cadera, entallado hacia el tobillo, con cinturón (cuerda o cuero) — silueta estándar de calza de trabajo medieval, sin patrón específico de una sola fuente (no hay pantalón "puro" documentado igual de bien que la túnica; se optó por la silueta más citada en referencias de vestuario medieval genérico).
- **Gorro/cofia**: coif de lino ajustado al cráneo, con el borde inferior vuelto hacia fuera y cordón de atado bajo la barbilla — prenda cotidiana de los siglos XII-XV tanto para hombres como mujeres del pueblo llano. Fuentes: [Coif — Wikipedia](https://en.wikipedia.org/wiki/Coif), [Arming cap — Wikipedia](https://en.wikipedia.org/wiki/Arming_cap).

## Qué se implementó (v1)

- `interiores/catalogo/materiales.json` — añadidas fibras `lino`/`lana`/`seda` (documentadas con su uso y su gama de tinte histórica); `cuero` marcado también como material de ropa.
- `client/src/render3d/proporcionesRig.json` — medidas del rig (`altoPierna`, `altoTorso`, `ladoCabeza`, cajas de pierna/torso/brazo) extraídas de `rigHumanoide.ts` a JSON, para que `ropa/` lea las MISMAS medidas sin duplicarlas. `rigHumanoide.ts` ahora importa este JSON en vez de llevar las medidas a fuego — cero cambio de comportamiento (verificado con `tsc --noEmit`).
- `ropa/catalogo/prendas.json` — 3 prendas de prueba, una por slot (torso/piernas/cabeza): `camisa_lino_campesina`, `pantalon_lana_campesino`, `gorro_lino_campesino`. A propósito solo 3, no un catálogo completo — primero se valida el algoritmo.
- `ropa/catalogo/profesiones.json` — cruce oficio → tags de prenda + material preferido, para 12 oficios (los mismos `temaTaller` de interiores + campesino/noble/militar).
- `ropa/src/catalogo.js` — cargador del catálogo (mismo patrón que `interiores/src/catalogo.js`), lee `materiales.json` de interiores y `proporcionesRig.json` del cliente sin duplicarlos.
- `ropa/src/generarPrenda.js` — generador procedural: cada prenda es una pila de capas horizontales por parte del cuerpo (torso, cada manga, cada pierna, cabeza), con una función de silueta propia por `tipoPrenda` (camisa/pantalón/gorro) que da el vuelo del bajo, el entallado del puño/tobillo, el cinturón, el borde del gorro. PRNG determinista (`interiores/src/azar.js`, reutilizado tal cual) para la variación natural de color y para los remiendos. Cada vóxel sale con `{x,y,z,color,zona,parte,pivote}` — `pivote` dice a qué hueso del rig cuelga esa parte.
- `ropa/src/prueba_render_voxel.js` + `ropa/src/prueba_render_png.js` — vista de prueba isométrica (SVG, cero dependencias nuevas) + conversión a PNG con el Playwright global del entorno, para revisar las 3 prendas antes de tocar el cliente de verdad. Salida en `ropa/output/` (gitignored, igual que `baker/output/`/`interiores/output/`).

## Morfología del personaje (alto/bajo/gordo/delgado/hombre/mujer) — v1.1

Decisión confirmada con el streamer: la ropa debe acoplarse a la forma de CADA personaje desde el primer momento, no tener una talla fija.

Cómo se resolvió — **la prenda no tiene medidas propias, nunca**: se genera a partir de las medidas del cuerpo YA morfado + su margen de capa (`MARGEN_CAPA`). Los mismos tres valores de morfología (`altura`, `corpulencia`, `sexo`) alimentan al rig y al generador de ropa, así el acople es automático por construcción — no hay "ajuste de talla" posterior porque no hay tallas.

- `client/src/render3d/morfologia.json` — fuente única de las reglas: rangos de los sliders (`altura` 0.88–1.12, `corpulencia` 0.85–1.2), factores derivados por sexo (hombre: hombros 1.0/caderas 0.95; mujer: hombros 0.9/caderas 1.06) y el mapa `escalas` de qué factor multiplica qué medida de `proporcionesRig.json` (las alturas escalan con `altura`, los anchos/fondos con `corpulencia`, hombros/caderas además con el factor de sexo). **La cabeza no escala a propósito**: los gorros valen para cualquier morfología sin regenerar.
- `client/src/render3d/morfologia.ts` y `ropa/src/morfologia.js` — los dos aplicadores gemelos (TS para el rig, CJS para el generador). Son genéricos y diminutos (leer ruta del JSON, multiplicar): los NÚMEROS viven solo en el JSON; si se cambia el CÓMO se aplica, hay que tocar los dos (avisado en comentario de ambos).
- `rigHumanoide.ts` — `OpcionesRig.morfologia` opcional; el rig entero se construye sobre las proporciones morfadas de esa instancia (omitida = talla base, cero cambio para el código existente). `ALTO_RIG` sigue siendo la altura de talla base.
- `generarPrenda()` — `opciones.morfologia` opcional con la misma forma exacta.

Verificado con números (misma camisa, misma semilla, resolución de vóxeles constante — solo cambia el tamaño de celda): torso base 0.479 ancho × 0.508 alto; bajo+corpulento 0.575 × 0.447; alto+delgado 0.407 × 0.569; mujer 0.431 × 0.508 (hombros −10%, misma altura). Y visualmente con `prueba_render_voxel.js`, que genera las 3 morfologías extra de la camisa (`__bajo_ancho`, `__alto_delgado`, `__mujer`) desplazando también los PIVOTES morfados (hombros más anchos = mangas más separadas), igual que hará el rig real.

Pendiente de decidir cuando llegue el creador de personajes: dónde vive la morfología elegida (savegame/servidor) y si `corpulencia` se separa en dos sliders (musculatura vs grasa). El contrato con este módulo no cambia: `{ altura, corpulencia, sexo }` entra, prenda acoplada sale.

## Resultado de la primera pasada (revisado visualmente)

Las 3 siluetas ya leen como lo que son (túnica con mangas y bajo abierto, calza con cinturón marcado en la cadera y entallado al tobillo, cofia con borde vuelto y cordón) y la fusión con los pivotes del rig cuadra con `rigHumanoide.ts`. Pendiente de una segunda pasada guiada por el streamer una vez vea las imágenes — candidatos ya identificados para ajustar: el gorro sale más "de pico" (cono) que de cúpula por cómo se estrecha el radio hacia arriba, la manga larga queda muy tapada por el propio torso en la vista isométrica (habría que revisar el ángulo o el ancho de manga), y el vuelo del bajo de la camisa es de una sola fila — puede que necesite 2-3 filas para leerse bien a la escala real del juego.

## Qué falta (pendiente, no bloquea lo anterior)

- Ampliar `ropa/catalogo/prendas.json` con el resto de oficios de `profesiones.json` una vez el algoritmo esté afinado (una prenda de torso/piernas/cabeza — y luego capas/calzado/manos — por cada combinación oficio×riqueza que haga falta), siguiendo el mismo criterio: nada de "dos prendas porque sí", cada una debe cuadrar con un oficio o tag real ya existente.
- Slot de manos/pies/capa exterior todavía sin definir en `prendas.json` (solo torso/piernas/cabeza en esta v1).
- ~~Consumo real en el cliente~~ — **HECHO**: `client/src/render3d/voxelMalla.ts` + `personajeVoxel.ts` fusionan cada prenda en una malla por pivote (color por vértice, todas las caras) y la cuelgan del rig; validado en el juego real con la plaza demo de NPCs vestidos junto al spawn (ver GDD_Generador_Personajes v1.3). `generarPrenda()` emite ahora `tam` por vóxel con (x,y,z)=centro — contrato exacto con el cliente.
- Catálogo de armaduras/armas/herramientas (mencionado por el streamer como siguiente ampliación de este mismo módulo, no una lista aparte) — mismo patrón, pendiente de las primeras 3 prendas quedando aprobadas.
- Overrides de tinte por personaje (`tintes` en `generarPrenda()` ya existe como API, falta decidir dónde vive esa elección — savegame de personaje, servidor...).

## Ampliación 2026-08-30 (afinar parámetros antes de conectar IA)

- **Selector `elegirPrendaPorProfesion`/`elegirConjuntoPorProfesion`** (`ropa/src/elegirPrenda.js`, nuevo) — hasta ahora `tagsProfesion` (prendas.json) y `tagsPrenda` (profesiones.json) existían pero nada los cruzaba: cada NPC llevaba su `ropa` hardcodeada a mano. Puntúa cada prenda de un `tipoPrenda` por cuántos tags comparte con la profesión (más específico gana; "comun" es el mínimo común que casi todas comparten, así que siempre hay candidata) y elige determinista por semilla `ropa|<profesionId>` — misma profesión, mismo conjunto siempre. Usado desde `personajes/src/generarPersonaje.js` como fallback cuando un NPC no trae `ropa` en su entrada (los 39 NPCs ya curados a mano no se tocan).
- **`camisa_seda_noble`** (nueva prenda, `tagsProfesion:["noble"]`, `materialesCompatibles:["seda","lino"]`) — la seda (única fibra "de lujo, colores vivos" del catálogo de materiales) no la usaba NINGUNA prenda hasta ahora.
- **`detalle` como override real**: `generarPrenda(prendaId, {..., detalle: {mangas:"cortas"}})` — antes `detalle` era SIEMPRE el valor fijo del catálogo (una camisa solo podía salir con las mangas que trajera de serie); los generadores por tipoPrenda ya soportaban ambas ramas de cada campo (mangas largas/cortas, corte holgado/recto, bajo recto/estrecho...), solo nadie las pedía nunca con un valor distinto. Sin `detalle` en las opciones, comportamiento idéntico a siempre.
- Deliberadamente NO tocado: `materialesCompatibles` de `tabardo_guardia`/`pantalon_guardia`/`habito_sacerdote` (1 solo material cada uno) — es una decisión previa explícita del streamer ("tabardo de cuero IGUAL para todos... la uniformidad sale sola del catálogo"; hábito "de lana oscura para que se le reconozca por la calle"), no un hueco a rellenar.

## Sastre legendario (pedido 2026-08-31)

Pedido: a partir de cierto nivel alto de oficio, el sastre puede — desde el `telar` (mueble/estación real, ya existía en `interiores/catalogo/elementos.json` ligado a `tagsProfesion:["sastre"]`) — tejer **1 vez cada 24h reales** una prenda NUEVA, nunca antes existente, bakeada de verdad con el generador (nunca IA de imagen ni una textura pegada encima — eso era el diseño de un documento pegado en el chat que se descartó explícitamente por no encajar con nuestra arquitectura de vóxeles). El jugador describe la prenda con texto libre (imagen de referencia queda para más adelante, sin diseñar); solo el creador conoce el blueprint y puede craftear copias después, pero cualquiera puede comprar/llevar la prenda física resultante.

Evaluado primero un diccionario de palabras clave a mano frente a una IA de texto — se eligió el diccionario (cero coste, cero dependencia externa, encaja con "las listas crecen, el código no") con un listado deliberadamente amplio para dar mucha capacidad de personalización sin que sea IA de verdad.

### Cómo interpreta el texto (`ropa/src/interpretarPrompt.js` + puerto TS)

- **`ropa/catalogo/vocabularioLegendario.json`** — diccionario español→parámetros REALES del generador: `tipoPrenda` (camisa/pantalon/gorro), `detalle` (cuello/mangas/bajo/corte/cinturon/borde — los mismos campos que ya lee `generarPrenda.js`), `material` (lino/lana/seda/cuero), `color` (~30 entradas con hex) y `estilo` (10 paquetes tipo "noble"/"campesino"/"guerrero"/"pirata" que fijan material+detalle+color de una vez, pisables por palabras más específicas del mismo texto — "noble pero de lana" gana lana).
- **`interpretarPromptTejido(texto)`** — SIEMPRE devuelve parámetros válidos (nunca `null`, nunca a medias): resuelve un `prendaBaseId` real de `prendas.json` cuyo `materialesCompatibles` admita el material pedido (o cae al primero de ese tipo), mezcla el `detalle` pedido SOBRE el del arquetipo base (lo no mencionado hereda), y expone `colorHint` (o `null` si no detectó color). Texto vacío o sin ninguna palabra reconocida cae a un arquetipo por defecto — nunca revienta.
- **Autoritativo en servidor, gratis en cliente**: el cliente (`client/src/render3d/interpretarPrompt.ts`, puerto TS, mismo vocabulario JSON) lo usa para la vista previa instantánea del panel (sin red); el servidor SIEMPRE reinterpreta el mismo texto por su cuenta al aceptar — nunca se confían los parámetros que calculó el cliente.
- **Sin IA en absoluto** — ni de texto ni de imagen. El "generador" real sigue siendo el mismo `generarPrenda.js`/`generarPrendaVoxel.ts` de siempre; el diccionario solo decide QUÉ parámetros pasarle.

### Persistencia y red (`server/src/datos/bd.ts`, `HubState.ts`)

- **`prendas_generadas`** (tabla nueva, SQLite+Postgres): `id` autoincremental (NUNCA deduplicado por contenido como `platos_creados` — dos sastres con el mismo texto no comparten diseño), `creador_id`, `prenda_base_id`, `material_id`, `detalle`/`tintes` (JSON), `nombre`, `prompt_texto`.
- **Cooldown 24h REALES** (`jugadores.ultimo_tejido_legendario_ms`, `resolverCooldownTejidoLegendario`) — mismo patrón exacto que el reinicio de stock de mercaderes (§9 de GDD_Economia.md): `Date.now()`, nunca día de mundo.
- **`HubState.blueprintsRopa`** (`MapSchema<BlueprintRopaSchema>`, clave `String(id)`) — espejo de red del blueprint, GLOBAL a la room (no por jugador): cualquier cliente que vea a cualquier jugador con una prenda legendaria puesta la resuelve sin pedir nada aparte. Cargado perezosamente (se añade al crearse o craftear copia; nunca se precarga la BD entera).
- **`InventarioSchema.equipoBlueprintRopa`** (`MapSchema<number>`, slot→prendaGeneradaId) — paralelo a `equipo` (slot→itemId), solo con entrada en los slots donde lo equipado es legendario. `ItemInstancia.prendaGeneradaId`/`ItemInstanciaSchema.prendaGeneradaId` (0/ausente = ítem normal) viaja con la instancia física.
- **`equiparItem`/`desequiparItem`** (`server/src/inventario/inventario.ts`) extendidos: al equipar, el `prendaGeneradaId` de la instancia pasa a `equipoBlueprintRopa[slot]`; al desequipar, la instancia NUEVA que vuelve al cuerpo se re-etiqueta con el mismo id — sin esto, quitarse y volver a ponerse una prenda legendaria la habría convertido en una copia "en blanco" del catálogo (mismo tipo de bug que ya tenía aceptado `durabilidad` al craftear/equipar, aquí sí se cerró).
- **Límite conocido, documentado a propósito**: `equipoBlueprintRopa` vive SOLO en memoria por sesión — no se persiste todavía junto al resto de `equipo` en BD (`guardarEquipo`/`cargarEquipo` sin tocar). Un reinicio del servidor o una reconexión pierde la vinculación visual (el ítem sigue existiendo, con el `itemId` correcto, pero se vería con el aspecto ESTÁTICO del arquetipo hasta reequiparlo de nuevo tras crear otra copia) — pendiente real si se quiere cerrar del todo.

### Renderizado (`client/src/render3d/generarPrendaVoxel.ts`, `equipoVisual.ts`)

- `generarPrendaVoxel()` ganó `detalleOverride`/`tintes` opcionales (el comentario del código ya avisaba "se pueden añadir sin rediseño si hiciera falta" — así fue).
- `equipoVisual.ts::voxelesDePieza` acepta un `BlueprintRopaResuelto` opcional por slot: si está presente, sustituye TODO lo que decidiría el catálogo estático (material/detalle/tintes), usando el `prendaBaseId` del blueprint como arquetipo de silueta/zonasColor. `game.ts` resuelve `player.inventario.equipoBlueprintRopa` contra `room.state.blueprintsRopa` (JSON.parse de `detalleJson`/`tintesJson`) en cada cambio de equipo — así lo que se generó en el panel del telar se ve EXACTAMENTE igual puesto, para cualquier jugador que lo mire, tal y como se pidió.

### Ítem físico — sin catálogo nuevo

Los 7 arquetipos de `prendas.json` YA tienen su propia entrada 1:1 en `items/catalogo/items.json` (`camisa_lino_campesina`, `pantalon_lana_campesino`, `gorro_lino_campesino`, `tabardo_guardia`, `pantalon_guardia`, `camisa_seda_noble`, `habito_sacerdote` — "ropa civil craftable", docs/GDD_Profesiones.md 2026-08-30) — el `prendaBaseId` resuelto por el texto ES DIRECTAMENTE el itemId que se mete en el inventario, sin inventar ningún ítem "carrier" genérico nuevo.

### Recraftear copias (confirmado con el streamer: sí, sin límite de 1/día)

El cooldown de 24h SOLO gatea crear un blueprint NUEVO — `sastre:tejerCopia` (solo el creador, `blueprint.creadorId`) gasta insumos y da otra unidad cuando quiera. Insumos = los MISMOS reales que ya usan las recetas de ropa civil (`items/catalogo/recetas.json`): `tela_hilada` (genérico, cualquier fibra — lino/lana/seda comparten el mismo insumo porque hoy ninguna tiene uno propio distinto en el catálogo real) o `cuero_curtido` para cuero.

### Verificado

24 tests nuevos (`server/test/interpretarPromptRopa.test.ts` 11, `server/test/prendasGeneradasBd.test.ts` 7, 3 nuevos en `server/test/inventario.test.ts` sobre el round-trip de `prendaGeneradaId` al equipar/desequipar), suite completa de servidor 961/961, `tsc --noEmit` limpio en servidor y cliente.

**No verificado con Playwright/juego real todavía** (a diferencia de otras mecánicas de esta sesión) — el panel (`client/src/construccion/panelSastreLegendario.ts`) y el flujo completo click-telar→generar→aceptar→ver la prenda puesta no se han probado en vivo; la vista previa es en TEXTO (nombre del arquetipo/material/detalle resuelto + un swatch de color por zona), no un render 3D dentro del panel — más barato de construir, honesto sobre la limitación, pendiente de que el streamer lo pruebe y decida si hace falta subir a preview 3D real.
