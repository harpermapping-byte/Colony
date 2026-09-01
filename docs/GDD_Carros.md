# GDD — Carros, Arneses de Tiro y Aperos de Labranza

**ESTADO: Fase 1 (cimientos) IMPLEMENTADA Y VERIFICADA — el resto sigue siendo propuesta, ver §14.** Pedido 2026-09-03, textual: que el buey (y en general "CUALQUIER ANIMAL QUE SE PUEDA MONTAR") pueda tirar de un carro o de una herramienta de labranza, con varios tipos de carro (personas, materiales, muebles, animales, líquidos, cada uno capoteado/descapotado), varios tamaños/materiales/colores, aperos de trabajo (arado, cultivadora), craftables por el ingeniero en distintos niveles, y que el trabajador NPC de transporte pueda usar una montura o montura+carro del jugador en vez de andar.

Es el sistema más grande pedido en esta sesión — toca movimiento/colisión real (no solo catálogo), un paradigma de inventario nuevo (muebles por capacidad, no rejilla) y una mecánica de labranza nueva. Siguiendo el mismo criterio que `docs/GDD_Combate.md` (documentar entero, pedir el OK, implementar después sin volver a preguntar lo acordado): el usuario dio el OK ("adelante") el 2026-09-04, y la Fase 1 (cimientos: arnés, carro:colocar/enganchar/desenganchar, ConjuntoTiroSchema, rama de velocidad, conjunto:montar/desmontar con `carreta_dos_plazas`) ya está implementada y verificada de punta a punta — ver §14.

## 0. Investigación previa (qué ya existe, para no reinventar ni contradecir nada)

Antes de diseñar se auditaron los tres sistemas más parecidos:

- **Montar montura** (`docs/GDD_Monturas.md`, `RoomExteriorBase.ts`): el jugador que monta se CONVIERTE en la entidad que se mueve — la mascota desaparece de `state.mascotas`, el rig visual del jugador se oculta (`rig.objeto.visible=false`, nunca se destruye) y se sustituye por el rig del animal. La velocidad se REEMPLAZA entera por `montura.velocidad * terreno` (`RoomExteriorBase.ts` ~10199). La colisión es un único círculo `RADIO_PJ=0.35` — **no existe hitbox propio por especie de montura, decisión ya tomada y documentada (GDD_Monturas §8)**. Hoy NO se renderiza ningún jinete (aunque `aplicarMonturaAlAnimal` ya acepta un objeto de jinete opcional, `game.ts` siempre pasa `null`) — no hay pasajeros, solo un jinete único fusionado.
- **Barcos** (`docs/GDD_Barcos.md`, `RoomExteriorBase.ts`): el precedente real de "varios ocupantes, un solo punto que colisiona". Un barco es una entidad propia en `state.barcos`; solo el input del CAPITÁN mueve la entidad de verdad (`moverAABB` con el círculo de siempre); cada pasajero se recoloca cada tick a un offset FIJO en círculo alrededor del capitán — pura cosmética, sin colisión propia. Si el barco no está sobre agua, el movimiento simplemente no avanza ese tick.
- **La velocidad ya es una máquina de ramas, no un número plano**: `vel = base * terreno`, y `montura`/`esCapitanBarco` son ramas que la SUSTITUYEN por completo (sin sprint/aguante/enfermedad/poción) — un carro es una tercera rama natural, sin tocar las dos anteriores.
- **Construcción es 100% estática**: toda `EntradaConstruible` tiene una `huella` fija anclada a una parcela concreta; nada se mueve después de colocarse. Un carro NO es una construcción — es más parecido a `silla_montar`/un barco: un ítem portátil que se "coloca" en el mundo (`barco:colocar` es el precedente exacto a reusar, no `construir`).
- **Agricultura NO es por casilla — hallazgo real que cambia el diseño de los aperos** (`docs/GDD_Agricultura.md`): no existe ningún verbo "labrar" ni una casilla "tierra lista". Sembrar es plantar UNA semilla dentro de una CONSTRUCCIÓN ya colocada (`bancal_cultivo`, huella 3×2, una planta por instancia) vía `cultivo:plantar {construccionId, instanciaId}`, sin cooldown de acción. No hay ningún precedente de "acción que afecta a varias casillas/instancias a la vez" en todo el proyecto. Esto obliga a adaptar lo pedido ("arar más rápido", "plantar en 2x2") a construcciones, no a casillas — ver §9.
- **Líquidos topan hoy en 2000ml** (`cubo_madera`, `docs/GDD_Inventario.md §9`) y no existe transferencia contenedor→contenedor, solo "llenar desde agua" y "vaciar en la olla". Una cisterna de carro necesita ese verbo nuevo.
- **El trabajador de transporte es hoy un agente abstracto** (`npcs_trabajadores`/`contratos_transporte`) sin ningún campo de equipo/montura — asignarle una montura/carro del jugador es una integración nueva de cero, aunque las tablas de propiedad (`mascotas.jugador_id`, futura `carros`) ya existen para apoyarla.

## 1. Decisión de arquitectura: "fusión estilo montura" + "pasajeros estilo barco"

Pedido literal: *"esto cambia un poco la forma de moverse al convertirse todo en una unión animal-carro-jugador(es)... pero si lo hacemos como una única forma mejor, igual que cuando el jugador monta montura"*. Se adopta exactamente eso, combinando los dos precedentes sin inventar un tercer modelo de movimiento:

- El **conductor** (quien engancha y monta primero) sustituye su movimiento exactamente igual que un jinete solo hoy — su `Player` sigue siendo la única entidad que de verdad llama a `moverAABB`, con la velocidad reemplazada por la del conjunto (§6). Visualmente el rig del conductor se oculta igual que al montar una mascota sola.
- Cualquier **pasajero adicional** (en carros de varios asientos) se trata exactamente como un pasajero de barco: recolocado cada tick a un offset FIJO relativo al conductor (uno por asiento del carro, ver `POSICION_POR_SLOT`-style tabla en §8.1), sin colisión propia, sin mover el conjunto con su propio input.
- **Colisión**: se mantiene el mismo círculo único `RADIO_PJ` en la posición del conductor — mismo criterio ya aceptado para monturas ("radio de colisión propio por especie" fue descoped explícitamente en GDD_Monturas §8). Un carro "más alargado" NO tiene hitbox elongado en esta propuesta — es una simplificación deliberada y consistente con el resto del proyecto, no un descuido. (Si el streamer quiere un hitbox real más largo más adelante, es una ampliación aparte sobre `moverAABB`, no bloquea esta fase.)
- Visualmente el conjunto SÍ se ve alargado (animal + carro + hasta N pasajeros en sus asientos) aunque colisione como un punto — mismo desfase ya aceptado en barcos (el barco entero se ve, pero solo el capitán colisiona).

## 2. Arnés de tiro (`arma_arnes` / tipo `apero`) — lo que habilita tirar

Nuevo `tipo:"apero"` en `items/catalogo/items.json`, mismo patrón que `esMontura` (silla de montar) pero para tirar en vez de montar:

- **`EntradaCatalogoItem.esApero?: boolean`** (nuevo campo, reservado igual que `esMontura` lo estuvo antes de tener consumidor) — marca qué ítems son arneses de tiro.
- **Cualquier especie `montable`** puede llevar arnés — el pedido es explícito: *"tirados por CUALQUIER ANIMAL QUE SE PUEDA MONTAR"*. No hace falta un flag nuevo en `animales_rig.json`: se reusa `montable` (ya existe, ya cubre caballo/burro/buey/jabalí/ciervo y ahora sus hembras vía `heredaDe`, ver `docs/GDD_Generador_Personajes.md`).
- **Mensaje `mascota:ponerArnes {mascotaId?}`** — mismo mecanismo exacto que `mascota:ponerMontura` (§1 de GDD_Monturas): exige una mascota propia "siguiendo", `montable`, sin arnés puesto todavía; consume una unidad de un ítem `esApero:true`; persiste `arnes:true` en BD (`mascotas.arnes`, nueva columna) y en el Schema (`Mascota.arnes`).
- **Compatibilidad con silla de montar**: un animal puede llevar silla Y arnés a la vez (son ranuras distintas, `montura`/`arnes`, ambas booleanas en la misma fila de `mascotas`) — permite, por ejemplo, un caballo ensillado que además tira de un carruaje si el diseño de asientos lo admite (el conductor va en el pescante del carro, no a lomos).
- **Catálogo inicial**: `arnes_cuero` (tier básico, cualquier montable), `arnes_reforzado` (tier alto, requerido por los carros más pesados — carga/muebles/cisterna — ver `pesoMaximoArnes` en §7). **Excepción a la regla "todo lo inicial lleva receta"** (docs/GDD_Equipo.md §10/§11): estas 2 entradas ya existen en el catálogo (§14 "Progreso real") pero SIN receta todavía a propósito — craftear algo que hoy no hace nada al usarse (falta `mascota:ponerArnes`) sería engañoso; la receta se añade en el mismo commit que el mensaje de servidor que lo consume, no antes.

## 3. Enganchar / desenganchar

- **`carro:colocar {instanciaId, x, y}`** — mismo patrón EXACTO que `barco:colocar` (`docs/GDD_Barcos.md`): consume el ítem-carro del inventario, crea una entidad `CarroSchema` en un `state.carros` nuevo (Map, mismo criterio que `combates`/`construcciones`), sin dueño fijo mientras esté "aparcado" (cualquiera podría en teoría engancharlo, igual que un barco varado es de quien lo alcance primero — decisión consistente con lo ya aceptado, no una novedad).
- **`carro:enganchar {mascotaId, carroId}`** — el jugador hace click sobre SU animal (siguiendo, con `arnes:true`) estando dentro de `RADIO_INTERACCION` (2.2, la constante de siempre) de un carro `carro:colocar`-eado sin enganchar. Valida: animal con arnés, sin ya estar enganchado a otro conjunto, carro libre, y `pesoCarro <= pesoMaximoArnes` del arnés puesto (un arnés básico no tira de una cisterna llena). Efecto: la mascota sale de `state.mascotas`, el carro sale de `state.carros`, ambos se funden en una entidad nueva `ConjuntoTiroSchema` (§5) con `x,y` = donde estaba el animal.
- **`carro:desenganchar {conjuntoId}`** — inverso exacto: si nadie va montado, separa el conjunto de vuelta en una mascota (con `arnes:true` siguiendo de nuevo) y un carro aparcado (`carro:colocar` implícito en el mismo punto). Si alguien va montado, se rechaza (bajarse primero, mismo criterio que barcos: no se puede desamarrar con gente a bordo).
- El conjunto entero (animal enganchado + carro, sin nadie montado) puede **quedarse aparcado y quieto en el mundo** indefinidamente — mismo criterio que un barco varado o una mascota siguiendo: visible para cualquiera, pero solo el dueño puede montarlo salvo que decida lo contrario (permiso de "amigos"/gremio ya existe en otros sistemas de propiedad, se reutiliza tal cual, no hace falta inventarlo).

## 4. Montar el conjunto — mismo menú que montar solo

Pedido explícito: *"para montarse mismo menú para montarse sobre animal"*. Un `ConjuntoTiroSchema` se trata, a efectos de UI de cliente, como una mascota montable más — el mismo prompt/tecla que hoy dispara `mascota:montar` funciona igual, solo que el objetivo es un conjunto en vez de una mascota suelta:

- **`conjunto:montar {conjuntoId, asiento?}`** — si el conjunto tiene 1 solo asiento (carga/muebles/cisterna/aperos, sin sitio para pasajeros), `asiento` se ignora y el jugador es automáticamente el conductor. Si tiene N asientos (carros de personas), el primero en montar es el conductor (asiento 0) salvo que pida explícitamente otro asiento libre; los siguientes jugadores que monten ocupan asientos de pasajero.
- **`conjunto:desmontar`** — el conductor desmontando dejaría el conjunto sin nadie llevando las riendas: se para en el sitio (no colisiona con nadie porque no se mueve) hasta que alguien vuelva a montar como conductor o se desenganche. Un pasajero puede desmontar sin afectar al resto.
- Mismo criterio ya aceptado para monturas: **sin jinete/pasajero renderizado por ahora en el modelo del animal** (la silueta del rig del jugador se oculta igual que al montar solo) — el carro en sí SÍ se renderiza enganchado al animal, con cada pasajero como un mini-rig posicionado en su asiento (mismo patrón `aplicarMonturaAlAnimal`, extendido a "aplicar carro + N pasajeros").

## 5. Modelo de datos del conjunto

**Corrección de implementación (§14 Fase 2, 2026-09-04)**: el sketch de abajo es el propuesto originalmente — al implementar se descartó meter `contenedorCarga`/`contenedorMuebles`/`jaula`/`liquido` en el Schema (ni `asientos` como `MapSchema`, los pasajeros de personas se resuelven por `ocupantesDeConjunto` server-only, mismo criterio que barcos). La carga real vive en memoria pura (`RoomExteriorBase.contenidoCarroPorClave`) y solo viaja como payload de mensaje bajo demanda — exactamente como ya hace un cofre (`ConstruccionViva.extra`, nunca replicado en Schema). El `ConjuntoTiroSchema` implementado de verdad es más pequeño que este sketch: solo `x, y, especieAnimalId, mascotaId, carroTipoId, conductorSessionId`.

```ts
// server/src/rooms/schema/HubState.ts (propuesta)
class ConjuntoTiroSchema extends Schema {
  id: string;
  especieAnimalId: string;      // qué especie tira (para el render del animal)
  mascotaId: string;            // referencia a la fila BD de la mascota fusionada
  carroTipoId: string;          // id de catálogo del carro/apero enganchado
  x: number; y: number;
  conductorSessionId: string;   // "" si nadie lleva las riendas
  asientos: MapSchema<string>;  // índice de asiento -> sessionId ocupante (pasajeros)
  // Estado de carga — depende de carroTipoId.categoria (ver §7):
  contenedorCarga?: Contenedor;             // categoría "materiales" (rejilla grande)
  contenedorMuebles?: ContenedorMuebles;    // categoría "muebles" (§8.3)
  jaula?: { mascotaId: string }[];          // categoría "animales"
  liquido?: { tipo: string; volumenMl: number; volumenMaxMl: number }; // categoría "líquidos"
}
state.carros: MapSchema<CarroSchema>;         // aparcados, sin enganchar
state.conjuntosTiro: MapSchema<ConjuntoTiroSchema>; // enganchados (con o sin conductor)
```

`mascotas` (BD) gana `arnes BOOLEAN`. Nueva tabla `carros` (mismo contrato dual SQLite/Postgres de siempre): `id, jugador_id, tipo_id, x, y, mapa_id, contenido JSON` (serializa `contenedorCarga`/`contenedorMuebles`/`jaula`/`liquido` según categoría — un solo campo JSON, igual de simple que `construcciones.extra`).

## 6. Velocidades — jerarquía pedida

Pedido literal: *"te mueves más rápido que andando pero más lento que en montura sola, menos con los aperos que esos mientras se usan cuesta más moverse"*.

Nueva rama en el cálculo de velocidad (`RoomExteriorBase.ts`, junto a `montura`/`esCapitanBarco`, mismo patrón — sustituye la velocidad entera, sin sprint/aguante):

```
VEL_ANDAR  <  velocidadConjunto (carro normal)  <  velocidadMontura (animal solo)
```

- **Carro normal (categorías personas/materiales/muebles/animales/líquidos)**: `velocidadConjunto = velocidadMontura(especieAnimalId) * factorCarro`, con `factorCarro` en `[0.6, 0.85]` según peso/categoría del catálogo (un carro de muebles cargado pesa más que un carruaje ligero — factor por entrada de catálogo, no fijo). Siempre ≥ `VEL_ANDAR` y < `velocidadMontura` sola.
- **Apero en uso activo** (arando/cultivando, §9): mientras `enUso:true`, velocidad ADICIONALMENTE reducida (`factorApero ≈ 0.4`) — el pedido es explícito en que trabajar cuesta más que solo desplazarse enganchado.
- Terreno (`this.mundo.velocidad[idx]`) se sigue aplicando igual que con monturas — un carro por barro pesado sigue siendo más lento que por camino llano, mismo mecanismo ya existente, cero código nuevo ahí.

## 7. Catálogo de carros — estructura común

`items/catalogo/items.json` gana `tipo:"carro"` (o `"apero_tiro"` para arado/cultivadora, ver §9) con estos campos comunes, además de los de siempre (huella/peso/durabilidadMax/prendaId visual):

```
categoria: "personas" | "materiales" | "muebles" | "animales" | "liquidos" | "labranza"
capotado: boolean            // con capota de tela o descapotado — variante visual + quitaCalor/quitaFrio como la ropa
pesoMaximoArnes: number       // qué arnés mínimo hace falta para tirar de este carro vacío
capacidad: <depende de categoria, ver 8.1-8.5>
nivelIngenieroMinimo: 2 | 3 | 4
```

`ropa/catalogo/equipo.json`-style: cada `carroTipoId` tiene una entrada visual companion (bloque de cajas simple, mismo nivel de fidelidad que el resto del arte placeholder del proyecto — CLAUDE.md punto 6) en un catálogo nuevo `carros/catalogo/visual.json` o reusando `taller-vox/` (a decidir en fase de implementación, no bloquea el diseño).

## 8. Los 5 tipos de carro

### 8.1 Transporte de personas (capoteado / descapotado)

- `capacidad: { asientos: N }` — el catálogo inicial: `carreta_dos_plazas` (2 asientos, descapotada, tier ingeniero 2), `diligencia_4` (4 asientos, capoteada, tier 3), `carruaje_noble_5` (5 asientos, capoteado, tapizado, tier 4 — pedido explícito: *"un carruaje más de noble en nivel 4, para transportar dentro 4 o 5 personas, como un carruaje/carroza visualmente"*).
- Cada asiento es un offset fijo relativo al conductor (mismo mecanismo que pasajeros de barco), tabla `POSICION_ASIENTO_POR_CARRO` — código, no catálogo (hecho estructural del carro, igual criterio que `POSICION_POR_SLOT` de `generarEquipo.js`).

### 8.2 Transporte de materiales (capoteado / descapotado)

- `capacidad: { contenedor: {ancho, alto} }` — una rejilla Tetris NORMAL (el `Contenedor` puro de siempre, `server/src/inventario/inventario.ts`), simplemente mucho más grande que una mochila (pedido: *"con su inventario enorme detrás"*) — ej. 12×8 frente a las 8×6 del cuerpo.
- Capoteado protege de lluvia/mojado si esa mecánica de clima llega a tocar mercancía (hoy no existe efecto de lluvia sobre ítems — se deja el campo `capotado` ya listo, sin consumidor todavía, mismo criterio "reservado" que ya usa el resto del catálogo).

### 8.3 Transporte de muebles — paradigma de inventario NUEVO

Pedido explícito: *"capacidad de muebles no inventario grid... caben 20 muebles o 30 dependiendo tamaño"*. Nunca ha existido en el proyecto un contenedor que no sea la rejilla Tetris — se propone un tipo nuevo, deliberadamente simple (no reinventa la rejilla, es su opuesto):

```ts
// server/src/inventario/inventario.ts (propuesta, módulo hermano de Contenedor)
interface ContenedorMuebles {
  capacidadMax: number;                    // ej. 30
  muebles: { instanciaId: number; itemId: string; tamano: number }[];
}
// tamano por entrada de catálogo (interiores/catalogo/elementos.json gana
// un campo `tamanoTransporte?: number`, 1=silla/taburete, 2=mesa pequeña/
// arcón, 3=mesa grande/cama, ausente = no transportable en carro de muebles)
function cabeMueble(c: ContenedorMuebles, tamano: number) {
  return c.muebles.reduce((s, m) => s + m.tamano, 0) + tamano <= c.capacidadMax;
}
```

Mensajes `carro:meterMueble {conjuntoId, instanciaId}` / `carro:sacarMueble {...}` — mismo espíritu que `cofre:meterItem`/`sacarItem` ya existente para el mobiliario-contenedor (`docs/GDD_Produccion.md §5ter`), pero por CAPACIDAD en vez de rejilla. Solo acepta ítems cuyo `itemId` de catálogo tenga `tamanoTransporte` (los muebles-ítem ya existentes: `silla`, `mesa_comedor`, `cama_individual`, `arcon` del carpintero legendario, más cualquier mueble futuro que se marque igual).

### 8.4 Transporte de animales (jaula)

- `capacidad: { plazas: N }` — el carro-jaula lleva mascotas propias YA domesticadas (no salvajes) sin montar, cada una ocupando 1 plaza (independiente de su tamaño real — simplificación deliberada, mismo nivel de detalle que el resto). `carro:meterAnimal {conjuntoId, mascotaId}` / `carro:sacarAnimal {...}`: la mascota sale de `state.mascotas`/dueña de seguir al jugador y pasa a `jaula[]` del conjunto; al sacarla vuelve a aparecer "siguiendo" junto al carro.
- Uso real: mover ganado recién comprado/criado entre propiedades sin tener que arrearlo a pie uno a uno.

### 8.5 Transporte de líquidos (cisterna)

Pedido: *"como si fuera una olla gigante o un cubo enorme, puede transportar MUCHOS LITROS... se conecta o desconecta con una manguera... click sobre el lugar extraer agua, verter líquido, sacar líquido"*.

- `capacidad: { volumenMaxMl: number }` — escala muy por encima de `cubo_madera` (2000ml): catálogo inicial `cisterna_pequena` (20 000 ml = 20 L, tier 2), `cisterna_grande` (80 000 ml = 80 L, tier 3).
- **`carro:conectarManguera {conjuntoId}`** — exige `casillaAguaCercana` del conjunto (helper YA existente, `colisiones.ts:114`, funciona con coordenadas puras — cero código nuevo ahí) → llena la cisterna entera igual que `recipiente:llenar` pero a la escala de la cisterna.
- **`carro:verterLiquido {conjuntoId, instanciaIdDestino}`** — mecanismo NUEVO (no existe transferencia contenedor→contenedor hoy, solo cisterna→olla vía vaciado total): vierte de la cisterna a OTRO recipiente portable (cantimplora, cubo) hasta llenarlo o hasta vaciar la cisterna, lo que ocurra antes — reusa `llenar`/`consumirVolumen` de `liquidos.ts` con una firma nueva de transferencia parcial (única pieza de lógica pura nueva de todo el sistema, pequeña y aislada).
- **`carro:desconectarManguera`** — corta la conexión, sin efecto de datos (la manguera es solo el gesto de "conectar", el volumen ya se transfirió al llenar).
- Uso real más allá de agua: si se permite `tipo` distinto de agua en el futuro (leche a granel de una granja grande, por ejemplo) el mismo mecanismo sirve sin cambios — se deja documentado como posible ampliación, no incluido en el alcance inicial (agua es lo único que hoy tiene fuente en el mundo).

## 9. Agricultura por casilla (NUEVA, en paralelo a la de construcción) + aperos

**Corrección 2026-09-04 (aclaración del streamer): habrá DOS agriculturas conviviendo, no una adaptada a la otra.** La versión anterior de este documento adaptaba el arado a colocar `bancal_cultivo` (construcción) porque esa era la ÚNICA agricultura que existía. El pedido real es otro: además de la agricultura de construcción (bancales/macetas, sin tocar, sigue igual para huertos/jardines pequeños), se añade una agricultura DIRECTA SOBRE LA CASILLA — labrar el suelo abierto a mano con **azada** o montado con **arado de tiro**, sembrar y cosechar ahí mismo, campos grandes tipo franja medieval en vez de un bancal por planta.

### 9.1 Modelo de datos — mismo patrón que `recolectables.ts`, pero CON persistencia

Un campo labrado tarda días en dar fruto (igual que un bancal) y un jugador no puede perder ese trabajo si el servidor reinicia (a diferencia de un recolectable silvestre, que si reaparece no rompe nada) — por eso, a diferencia de `recolectables.ts` (deliberadamente sin BD, "cálculo perezoso"), la casilla de cultivo SÍ se persiste, mismo contrato dual SQLite/Postgres de siempre:

```
casillas_cultivo (mapa_id, idx_casilla, x, y, dueno_id, estado, semilla_item_id?, dia_plantado?)
  -- estado: "labrada" (vacía, lista para sembrar) | "sembrada" (con cultivo creciendo)
  -- PK (mapa_id, idx_casilla)
```

En memoria: `Map<idxCasillaGlobal, EstadoCasillaCultivo>` cacheado por `rutaMapa`/mapa_id a nivel de PROCESO — mismo criterio exacto que `recolectablesDeMapa()` (`server/src/mundo/recolectables.ts`), salvo que aquí el Map se **hidrata desde `casillas_cultivo` al crear la room** en vez de nacer vacío del bake, y cada cambio (`labrar`/`plantar`/`cosechar`) escribe también a BD (mismo patrón "en memoria + persistido" que ya usa el inventario del jugador).

**Reusa el catálogo de semillas YA existente** (`DatosCultivo` en `inventario.ts`: `itemIdCosecha`, `diasCrecimiento`, `mesesSiembra`, `cosechaRecurrente`, `cantidadPorCosecha`) — mismas semillas, mismo tiempo de crecimiento, mismo calendario de meses de siembra que ya usa `bancal_cultivo`. Solo cambia DÓNDE vive la planta (una casilla abierta, no una construcción con huella), no las reglas de qué/cuándo se puede sembrar.

**Reglas de labrado** (mismo nivel de rigor que `validarColocacion`, sin inventar un sistema de suelo/bioma nuevo — se deja explícitamente simple para esta fase): casilla dentro de una parcela PROPIA, walkable, sin colisión (sin construcción/prop encima), sin ya estar `labrada`/`sembrada`. Sin chequeo de tipo de suelo/humedad por ahora (mismo alcance reducido que ya se aceptó para `plantable` en construcciones — ampliable después si se quiere distinguir tierra fértil de pedregal).

### 9.2 Herramienta de mano: azada

- **`azada_hierro`** (`items/catalogo/items.json`, `tipo:"herramienta"`, `slotEquipo:"manoPrincipal"`, craftable por herrero desde nivel 1 — mismo patrón que `hacha_talar`/`pico_minero`) — sin ella no se puede labrar.
- **`cultivoCasilla:labrar {x,y}`** — casilla adyacente (`RADIO_INTERACCION`), exige azada equipada, aplica las reglas de 9.1, marca la casilla `"labrada"`. Con cooldown corto de acción (mismo criterio que recolectar a mano, no instantáneo pero rápido — cifra concreta en fase de contenido).
- **`cultivoCasilla:plantar {x,y, instanciaIdSemilla}`** — casilla `"labrada"` propia, consume 1 semilla del inventario (mismo catálogo de semillas de siempre), pasa a `"sembrada"` con `dia_plantado` = día de mundo actual.
- **`cultivoCasilla:cosechar {x,y}`** — casilla `"sembrada"` con `diasCrecimiento` cumplidos (mismo cálculo que ya usa `cultivo:cosechar` de bancales), entrega `cantidadPorCosecha` de `itemIdCosecha`, vuelve a `"labrada"` (o a "sin labrar", según `cosechaRecurrente` de la semilla — mismo campo ya existente).
- Uno a uno, sin automatismo — el azada es el equivalente manual, mismo ritmo que sembrar en un bancal hoy, la diferencia es DÓNDE se siembra (campo abierto, no una construcción con huella).

### 9.3 Arado de tiro (montado) — automatiza la azada, no la sustituye

- **`arado_madera`** (tier 2 ingeniero, categoría `"labranza"` de §7): se engancha como un carro (arnés + `carro:enganchar`), se monta con el mismo menú de siempre (§4). Click sobre el apero → **`apero:comenzarLabrar {conjuntoId}`**.
- Mientras `enUso:true` (velocidad reducida, §6), cada casilla NUEVA por la que pasa el conjunto dentro de la parcela propia se labra automáticamente — llama a la MISMA validación/efecto que `cultivoCasilla:labrar`, solo que disparada por el movimiento del conjunto en vez de un click manual. Sustituye repetición, no reglas — igual criterio que ya se aplicaba en la versión anterior de este documento, ahora sobre el sistema de casilla real en vez de bancales.
- **Cultivadora** (`cultivadora_semillas`, tier 3): mismo patrón — lleva un `Contenedor` pequeño de semillas cargado por el jugador; en modo `apero:comenzarCultivar`, siembra automáticamente (`cultivoCasilla:plantar` con la semilla cargada) cada casilla `"labrada"` propia dentro de un radio de 2 casillas del conjunto mientras se desplaza — el "planta en 2×2, más rápido que el jugador" pedido, ahora literal sobre casillas de verdad.
- **`apero:detener {conjuntoId}`** — corta el modo automático para ambos, vuelve a velocidad de carro normal.
- Ambos aperos son de **1 solo asiento**, sin pasajeros.

### 9.4 Relación con la agricultura de construcción (sin tocar)

`bancal_cultivo`/`maceta_*` siguen exactamente igual — para huertos pequeños, patios, interiores, macetas decorativas. La agricultura de casilla es la opción de CAMPO ABIERTO a gran escala (parcelas grandes, mismo espíritu que un campo de labranza medieval real). Un jugador puede tener las dos a la vez en su propiedad sin conflicto — son sistemas independientes que comparten únicamente el catálogo de semillas.

## 10. Ideas añadidas (invitación explícita del streamer: *"si se te ocurre algún uso real más, añádelo"*)

Tres ampliaciones que encajan en el mismo patrón sin inventar mecanismo nuevo, propuestas para valorar (no bloquean el resto si se descartan):

- **Rastrillo/grada** (`grada_madera`, tier 2): apero barato, mismo mecanismo que el arado pero para RECOLECCIÓN en vez de siembra — en modo `apero:comenzarCosechar`, cosecha automáticamente cada casilla `"sembrada"` madura del radio mientras se desplaza (`cultivoCasilla:cosechar` en batch, §9.2). Reusa la cosecha tal cual, mismo criterio que la cultivadora reusa plantar.
- **Carro cisterna también para riego** (`carro:regarEnLote`): con la cisterna ya llena, un modo "regar" análogo al arado/cultivadora sobre las casillas `"sembrada"` del radio — cero mecanismo nuevo (la agricultura de casilla no tiene riego propio todavía; si se implementa, este sería su consumidor natural), aprovecha que ya se pidió transporte de líquidos.
- **Carro-taller ambulante** (categoría nueva opcional, tier 4): un carro con una `mesa`/estación de crafteo de nivel 1 incorporada (yunque_tocon o banco_carpintero portátil) para craftear básico lejos de casa en una expedición larga — encaja con el espíritu "carro de mercader/expedición" sin inventar sistema de crafteo nuevo, solo coloca una mesa ya existente sobre el conjunto. Se deja como candidato de ampliación, no imprescindible para el MVP.

## 11. Crafteo — ingeniero, por niveles

Mismo patrón `nivelOficioMinimo` que ya usa TODO el catálogo construible (`construccion/catalogo.ts`), oficio `ingeniero`, mesa `mesa_planos_ingenieria` (la misma que ya usa el ingeniero legendario):

| Nivel | Ejemplos |
|---|---|
| 2 | `arnes_cuero`, `carreta_dos_plazas`, `carro_materiales_pequeno`, `carro_muebles_pequeno`, `arado_madera`, `cisterna_pequena` |
| 3 | `arnes_reforzado`, `diligencia_4`, `carro_materiales_grande`, `carro_muebles_grande`, `carro_jaula`, `cultivadora_semillas`, `cisterna_grande` |
| 4 | `carruaje_noble_5` (capoteado, tapizado, el más caro del catálogo) |

Insumos siguiendo el patrón ya establecido esta sesión: `madera_dura` (estructura) + `lingote_hierro`/`acero` (ejes/herrajes) + `cuero_curtido` (arnés/capota) + `tela_hilada` (capota de tela) en proporción creciente por tier — números concretos se fijan en la fase de implementación (catálogo, no diseño).

## 12. Integración con trabajador de transporte

Pedido: *"si compras una montura o tienes una montura y un carro... al NPC de transporte, en vez de ir andando, le puedas asignar monturas (de tu propiedad) o montura y carro"*.

- `npcs_trabajadores` (BD) gana `mascota_asignada_id`/`conjunto_asignado_id` nullable (mismo criterio que el `trabajador_id` que ya se añadió a `contratos_transporte` en la fase anterior — nullable, no rompe nada existente).
- Nuevo mensaje **`trabajador:asignarMontura {trabajadorId, mascotaId | conjuntoId}`** — exige que la mascota/conjunto sea propiedad del jugador Y no esté siendo usada por él mismo en ese momento (mismo tipo de comprobación que ya hace `mascota:montar` contra "ya montado").
- Efecto en `GestorAgentes` (quien mueve al trabajador cada tick): si tiene montura/conjunto asignado, su velocidad de ruta usa `velocidadMontura`/`velocidadConjunto` en vez de `VEL_ANDAR`, y si es un `conjuntoId` con carga (materiales/muebles), la ruta de transporte usa la capacidad de ESE contenedor en vez del "carga por viaje" abstracto que usa hoy — cierra el hueco real que ya detectó la auditoría de §0 ("ningún campo de equipo/mount en el trabajador").
- Si el jugador retira la mascota/conjunto asignado (la monta él mismo), el trabajador simplemente vuelve a andar a pie ese viaje — sin fallo duro, degradación consistente con el resto del proyecto.

## 13. Colisión — resumen explícito

- Conjunto sin conductor (aparcado, enganchado o no): NO colisiona con jugadores — es decorativo/estático, mismo criterio que un barco varado o un objeto soltado en el suelo.
- Conjunto CON conductor: un único círculo `RADIO_PJ` en la posición del conductor, exactamente como una montura sola hoy. Pasajeros/carga no añaden superficie de colisión.
- Interacción con parcelas/propiedad: enganchar/montar/usar aperos respeta la propiedad de siempre (un arado no puede labrar parcela ajena — mismo `validarColocacion` que ya impide construir fuera de tu parcela).

## 14. Fases de implementación propuestas (para cuando haya OK)

**Progreso real 2026-09-04 — adelantado tras el OK ("adelante") del streamer**: en un primer intento se adelantó SOLO lo que es lógica PURA y catálogo, con la sospecha (incorrecta) de que el sandbox no permitía instalar dependencias reales de Colyseus. **Corregido en la misma sesión**: el bloqueo no era del sandbox, era un fallo propio — este repo es un **monorepo con `npm workspaces`** (`package.json` de la RAÍZ: `"workspaces": ["server", "client"]`), así que `npm install` hay que correrlo desde `/home/user/Colony` (la raíz), NUNCA desde dentro de `server/` o `client/` sueltos — si se corre dentro de un workspace, npm resuelve igualmente el `node_modules` hoisted de la raíz (`npm root` así lo confirma) pero el propio directorio de trabajo del agente seguía comprobando `server/node_modules`, que lógicamente nunca tiene nada — de ahí la falsa sensación de "no persiste". Con `npm install` corrido una vez desde la raíz: `tsc --noEmit` limpio, **suite completa de servidor 1117/1117 en verde**, y un e2e real contra un servidor Colyseus + BD real + cliente `colyseus.js` real (`persistenciaEquipo.e2e.mjs`) pasando de punta a punta. **Aviso para cualquier agente futuro que trabaje en este repo en paralelo**: si `npm install`/`npx tsx --test` parece no encontrar `@colyseus/core`/`pg`/`colyseus.js`, antes de asumir un límite de entorno, comprobar `npm root` y correr `npm install` desde `/home/user/Colony` (no desde `server/`).

Con eso corregido, lo construido y probado en este primer intento (`node --test` real, en verde, sigue siendo válido y reutilizable):

- `server/src/mundo/cultivoCasilla.ts` + `server/test/cultivoCasilla.test.ts` (16 tests) — la máquina de estados pura de §9.1/9.2 (labrar/plantar/listaParaCosechar/cosechar), lista para que la capa de Room solo la llame y persista.
- `server/src/inventario/contenedorMuebles.ts` + `server/test/contenedorMuebles.test.ts` (7 tests) — el contenedor por capacidad de §8.3, mismo criterio.
- Catálogo (`items/catalogo/items.json`, +4 entradas, cada una con su `_nota` explícita "PENDIENTE de mecanismo de servidor"): `arnes_cuero`, `arnes_reforzado`, `azada_hierro`, `carreta_dos_plazas` — sin receta de crafteo TODAVÍA a propósito (a diferencia de la regla "todo lo inicial lleva receta" de la pasada anterior): craftear un ítem que hoy no hace nada al usarse sería engañoso, la receta se añade en el mismo commit que el mensaje que lo consume.
- `items/catalogo/nombreBonito.js` ganó `arnes→arnés` (excepción de acento) y `carreta_dos_plazas` en `EXCEPCIONES_FRASE`.
- `server/test/inventario.test.ts` actualizado (504→508).

**Fase 1 — cimientos: IMPLEMENTADA Y VERIFICADA (2026-09-04).** Todo lo que toca Colyseus de verdad, construido sobre la lógica pura ya probada en el primer intento:

- **`server/src/mundo/catalogoCarros.ts`** (nuevo, mismo patrón que `catalogoBarcos.ts`): reduce `items.json` a `categoria/capotado/asientos/peso/nivelIngenieroMinimo` por `carroTipoId` (`tipo:"carro"`).
- **`server/src/datos/bd.ts`**: `Mascota` gana `arnes`/`arnesPesoMaximo` (columnas `arnes`/`arnes_peso_maximo`, con migración `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en SQLite igual que hizo `montura`); tablas nuevas `carros` (aparcados, mismo contrato que `barcos`) y `conjuntos_tiro` (animal+carro fusionados, con `especie_animal_id` denormalizado para no tener que cruzar contra `mascotas` al rehidratar); `IAlmacenDatos` gana `ponerArnesMascota`/`crearCarro`/`listarCarrosDe`/`eliminarCarro`/`crearConjuntoTiro`/`listarConjuntosTiroDe`/`actualizarPosicionConjuntoTiro`/`eliminarConjuntoTiro`, implementadas en SQLite y Postgres.
- **`server/src/rooms/schema/HubState.ts`**: `Mascota.arnes`/`arnesPesoMaximo`; `CarroSchema` (mismo shape que `Barco`); `ConjuntoTiroSchema` (`especieAnimalId`, `mascotaId`, `carroTipoId`, `conductorSessionId`); `Player.conjuntoId`/`conjuntoConductor` (mismo patrón que `barcoId`/`barcoCapitan`); `state.carros`/`state.conjuntosTiro`.
- **`server/src/rooms/base/RoomExteriorBase.ts`**: `mascota:ponerArnes` (idéntico a `mascota:ponerMontura`, ranura independiente); `carro:colocar` (idéntico a `barco:colocar` pero en tierra firme, no junto al agua); `carro:enganchar`/`carro:desenganchar` (funde/separa mascota+carro en `ConjuntoTiroSchema`, valida `pesoMaximoArnes` contra el peso del carro); `conjunto:montar`/`conjunto:desmontar` (mismo menú que montar solo — el conductor se decide por `conductorSessionId`, no por orden de llegada, para poder recuperar un conjunto aparcado sin desalojar pasajeros); nueva rama de velocidad en `actualizarMovimiento` (`FACTOR_CARRO_NORMAL=0.75` sobre `velocidadMontura` de la especie, con suelo de seguridad `>= VEL_ANDAR+0.25` que garantiza la jerarquía del §6 para cualquier especie de tiro); pasada de sincronización de pasajeros idéntica a la de barcos. `HubRoom.onCreate` rehidrata `carros`/`conjuntosTiro` del mapa igual que ya hacía con `barcos`.
- **Corrección de catálogo necesaria para el caso de uso principal**: `personajes/catalogo/animales_rig.json` — el buey NO tenía `montable`/`velocidadMontura` (una nota de una pasada anterior decía explícitamente "animal de tiro, no de monta", contradiciendo el pedido de esta sesión). Se corrigió a `montable:true, velocidadMontura:5.5` — sin esto, el caso de uso central del pedido ("que el buey pueda ser... montable") habría sido literalmente imposible. `server/test/catalogoMonturas.test.ts` actualizado para reflejar la corrección.
- **Recetas**: `arnes_cuero_craft`/`arnes_reforzado_craft`/`carreta_dos_plazas_craft` añadidas a `items/catalogo/recetas.json` en este mismo commit (regla de la sesión: receta solo cuando el mecanismo que la consume ya existe).
- **`server/test/carros.e2e.mjs`** (nuevo, mismo patrón que `barcos.e2e.mjs`/`monturas.e2e.mjs`): servidor Colyseus real + BD SQLite real + cliente `colyseus.js` real. Cubre el flujo completo: mascota sembrada sin arnés → `admin:debug:darItem` + `mascota:ponerArnes` (consume el ítem, persiste `arnesPesoMaximo`) → `carro:colocar` → `carro:enganchar` (funde en `ConjuntoTiroSchema`, ambos Maps de origen se vacían) → `conjunto:montar` (conductor) → movimiento real más rápido que a pie → `conjunto:desmontar` (se para en el sitio, sigue visible) → `carro:desenganchar` (separa de vuelta, el arnés sobrevive al ciclo). Verificado en verde junto al resto: **suite completa de servidor 1117/1117**, `tsc --noEmit` limpio, y los e2e de `barcos`/`monturas` ya existentes siguen pasando (código compartido no se rompió).

**Fase 2 — categorías de carga: IMPLEMENTADA Y VERIFICADA (2026-09-04).** Las 4 categorías de §8.2-8.5, sobre la base de Fase 1 sin tocarla:

- **`server/src/datos/bd.ts`**: nuevo tipo `ContenidoCarro` (`carga?: Contenedor`, `muebles?: ContenedorMuebles`, `jaula?: number[]`, `liquido?: {tipo,volumenMl,volumenMaxMl}` — como mucho UNA clave a la vez, la de la `categoria` real del carro); columna `contenido TEXT` en `carros`/`conjuntos_tiro` (migración `ALTER TABLE` en ambos backends, mismo patrón que `mascotas.arnes`); `crearCarro`/`crearConjuntoTiro` ganan el parámetro `contenido`, nuevos `actualizarContenidoCarro`/`actualizarContenidoConjuntoTiro`.
- **Decisión de arquitectura (corrige el sketch original de §5)**: la carga NO se replica en el Schema — mismo criterio EXACTO que un cofre de construcción (`ConstruccionViva.extra`, `cofre:consultar`/`meterItem`/`sacarItem`): vive en memoria como `Contenedor`/`ContenedorMuebles` puros (`RoomExteriorBase.contenidoCarroPorClave`, clave `"carro:<id>"`/`"conjunto:<id>"`) y se manda solo como payload de mensaje a quien la consulta, nunca a todo el mundo. Evita forzar `ContenedorSchema`/`ArraySchema` en `ConjuntoTiroSchema` para algo que un carro aparcado en la otra punta del mapa no necesita replicar a nadie.
- **`server/src/mundo/catalogoCarros.ts`**: `DatosCarro` gana `capacidadContenedor`/`capacidadMuebles`/`capacidadJaula`/`capacidadLiquidoMl` (una por categoría), leídos de `items.json`.
- **`server/src/inventario/liquidos.ts`**: única lógica pura nueva de todo el sistema (según lo previsto en §8.5) — `transferirLiquido(origen: LiquidoGranel, destino, entradaDestino)`: transferencia PARCIAL cisterna→recipiente portable, suma si es el mismo tipo, rechaza mezclar tipos distintos (todo o nada). 5 tests nuevos en `server/test/liquidos.test.ts` (13/13 en verde).
- **`items/catalogo/items.json`**: 7 carros nuevos — `carro_materiales_pequeno`/`grande` (rejilla 10×6/14×9), `carro_muebles_pequeno`/`grande` (capacidad 20/30), `carro_jaula` (4 plazas), `cisterna_pequena`/`grande` (20 000/80 000 ml) — todos con receta de ingeniero en el mismo commit (regla de la sesión). Además, `tamanoTransporte` (1=silla/taburete, 2=mesa pequeña/arcón, 3=mesa grande/cama) añadido a los "muebles-ítem" YA existentes del carpintero legendario (`silla`/`mesa_comedor`/`cama_individual`/`arcon` en `items.json` — resultó que ya existían como ítems portables, la referencia del §8.3 a "interiores/catalogo/elementos.json" en la propuesta original era incorrecta, corregido aquí).
- **`server/src/rooms/base/RoomExteriorBase.ts`**: `entidadCarroCercana` resuelve un carro aparcado O un conjunto enganchado indistintamente (`{id, tipo:"carro"|"conjunto"}`) — toda la carga funciona igual esté el carro parado o tirado por su animal. Mensajes nuevos: `carro:consultarCarga`/`meterCarga`/`sacarCarga` (materiales, mismo patrón que `cofre:*`), `carro:meterMueble`/`sacarMueble` (muebles, sobre `contenedorMuebles.ts` ya probado), `carro:meterAnimal`/`sacarAnimal` (jaula, reusa `quitarMascotaDeSchemaLocal`/`spawnearMascota`), `carro:consultarLiquido`/`conectarManguera`/`desconectarManguera`/`verterLiquido` (cisterna). La carga sobrevive intacta a `carro:enganchar`/`desenganchar` (se traslada entre `contenidoCarroPorClave` y la columna `contenido` del carro/conjunto de destino) — "la carga es del carro, no del animal".
- **`server/test/carrosCarga.e2e.mjs`** (nuevo): servidor Colyseus real + BD real. Cubre las 4 categorías de punta a punta sobre carros aparcados (meter/sacar materiales, meter/sacar mueble, enjaular/sacar un gato, conectar manguera junto a agua real del mapa demo + verter parcial a un cubo) y un ciclo enganchar→desenganchar de una cisterna con 18000ml que verifica el volumen EXACTO sobreviviendo sin alterarse. Verificado junto al resto: **suite completa de servidor 1122/1122**, `tsc --noEmit` limpio, `carros.e2e.mjs`/`barcos.e2e.mjs`/`monturas.e2e.mjs` (Fase 1 y sistemas previos) siguen en verde.

**Fase 3a — agricultura de casilla A MANO (§9.1/§9.2): IMPLEMENTADA Y VERIFICADA (2026-09-04).** Azada + `cultivoCasilla:labrar/plantar/cosechar`, siguiendo el propio plan del GDD ("verificado a mano ANTES de automatizarlo" — §9.3 arado/cultivadora queda para después de esto):

- **`server/src/mundo/cultivoCasillaVivo.ts`** (nuevo): caché de proceso por mapaId (`casillasCultivoDeMapa`), mismo criterio EXACTO que `recolectablesDeMapa` — el MISMO Map mientras el proceso viva, `esNuevo` distingue la primera vez (toca hidratar desde BD) de una recarga posterior.
- **`server/src/datos/bd.ts`**: nueva tabla `casillas_cultivo` (PK `(mapa_id, idx_casilla)`, dual SQLite/Postgres) — `guardarCasillaCultivo` (upsert `ON CONFLICT`) + `listarCasillasCultivoDe`.
- **`server/src/rooms/base/RoomExteriorBase.ts`**: la hidratación se cuelga de `iniciarConstruccion` (el método COMPARTIDO que ya llaman HubRoom Y RegionRoom) justo tras `this.ctxConstruccion = ctx` — así la agricultura de casilla funciona en cualquier mapa con parcelas reales, Hub y aldeas por igual, sin duplicar el hook en cada tipo de room. `cultivoCasilla:labrar` exige azada equipada en `manoPrincipal` y valida: dentro de una parcela PROPIA (`parcelaEn` + `esDuenoOJarlDe`, mismo helper que ya usa `cofre:*`), suelo `TIPO.TIERRA`, sin colisión (`ctx.ocupacion`), sin estar ya labrada. `cultivoCasilla:plantar`/`cosechar` reusan el MISMO catálogo de semillas (`DatosCultivo`) y las mismas funciones (`puedeSembrarEnMes`, cálculo de `tiempoMundo().dia`) que ya usa la agricultura de construcción — solo cambia dónde vive la planta.
- **`items/catalogo/recetas.json`**: `azada_hierro_craft` (herrero, nivel 1, `yunque_tocon`) — receta añadida en el mismo commit que `cultivoCasilla:labrar` (su mecanismo de servidor).
- **`server/test/cultivoCasilla.e2e.mjs`** (nuevo): servidor Colyseus real sobre `assets/mapas/testflat/` (tiene una parcela real `tf_0001` ya bakeada) con `DIA_FORZADO` para fijar el mes de siembra de forma determinista. Cubre: rechazo fuera de parcela, rechazo sobre una construcción real ya colocada, labrar+plantar+cosechar de verdad sobre suelo propio libre, rechazo de cosecha antes de tiempo, y una casilla sembrada MADURA directo en BD (para no depender de esperar días de mundo reales) que se hidrata al crear la room y se cosecha de verdad. Verificado junto al resto: **suite completa de servidor 1122/1122**, `tsc --noEmit` limpio, y los e2e de fases previas (`barcos`/`monturas`/`carros`/`carrosCarga`/`testZoneDebug`) siguen en verde.

**Sigue por hacer, sobre esta base ya probada:**

3. **Fase 3b — arado/cultivadora montados (§9.3)**: automatizan `cultivoCasilla:labrar`/`plantar` disparados por el movimiento del conjunto en vez de un click manual, más las ampliaciones de §10 si se aprueban.
4. **Fase 4 — niveles/catálogo completo**: el resto de tamaños/materiales/colores por categoría (incluidos los capoteados, sin catálogo todavía), `diligencia_4`/`carruaje_noble_5` a nivel 3/4.
5. **Fase 5 — trabajador de transporte**: asignación de montura/conjunto propio.

## 15. Decisiones abiertas para el streamer (antes de programar)

- **Hitbox elongado de verdad vs. círculo único**: esta propuesta usa el círculo único (§1, mismo criterio que monturas/barcos). Si se quiere colisión real más larga para el carro, es un cambio aparte sobre `moverAABB` con más riesgo — confirmar si el círculo único vale para el MVP.
- **Quién puede enganchar/montar un carro ajeno aparcado**: se propuso "cualquiera" por defecto (§3), iguales reglas que un barco varado — confirmar si se prefiere restringir a dueño/gremio desde el principio.
- **Nombres exactos de los primeros `carroTipoId`** de catálogo (§7/11) son ilustrativos — se cierran en la fase de contenido, no bloquean el diseño.
